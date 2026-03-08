from __future__ import annotations

import importlib.util
import json
import os
import shutil
import sys
import wave
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient


def _tiny_wav_bytes(duration_frames: int = 400, sample_rate: int = 32000) -> bytes:
    payload = BytesIO()
    with wave.open(payload, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"\x00\x00" * max(1, int(duration_frames)))
    return payload.getvalue()


def _load_runtime_module(registry_path: Path, models_dir: Path):
    module_path = Path(__file__).resolve().parents[1] / "engines" / "voice-transfer-runtime" / "app.py"
    module_name = f"llvc_runtime_app_test_{uuid4().hex}"

    env_backup = {
        "VF_VOICE_TRANSFER_MODEL_REGISTRY_FILE": os.environ.get("VF_VOICE_TRANSFER_MODEL_REGISTRY_FILE"),
        "VF_VOICE_TRANSFER_MODELS_DIR": os.environ.get("VF_VOICE_TRANSFER_MODELS_DIR"),
        "VF_VOICE_TRANSFER_BACKEND_MODE": os.environ.get("VF_VOICE_TRANSFER_BACKEND_MODE"),
    }
    os.environ["VF_VOICE_TRANSFER_MODEL_REGISTRY_FILE"] = str(registry_path)
    os.environ["VF_VOICE_TRANSFER_MODELS_DIR"] = str(models_dir)

    try:
        spec = importlib.util.spec_from_file_location(module_name, module_path)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        if env_backup["VF_VOICE_TRANSFER_MODEL_REGISTRY_FILE"] is None:
            os.environ.pop("VF_VOICE_TRANSFER_MODEL_REGISTRY_FILE", None)
        else:
            os.environ["VF_VOICE_TRANSFER_MODEL_REGISTRY_FILE"] = env_backup["VF_VOICE_TRANSFER_MODEL_REGISTRY_FILE"]
        if env_backup["VF_VOICE_TRANSFER_MODELS_DIR"] is None:
            os.environ.pop("VF_VOICE_TRANSFER_MODELS_DIR", None)
        else:
            os.environ["VF_VOICE_TRANSFER_MODELS_DIR"] = env_backup["VF_VOICE_TRANSFER_MODELS_DIR"]
        if env_backup["VF_VOICE_TRANSFER_BACKEND_MODE"] is None:
            os.environ.pop("VF_VOICE_TRANSFER_BACKEND_MODE", None)
        else:
            os.environ["VF_VOICE_TRANSFER_BACKEND_MODE"] = env_backup["VF_VOICE_TRANSFER_BACKEND_MODE"]


def test_voice_transfer_runtime_convert_uses_svc_runtime(monkeypatch, tmp_path: Path) -> None:
    models_dir = tmp_path / "models_llvc"
    (models_dir / "models" / "rvc").mkdir(parents=True, exist_ok=True)
    (models_dir / "models" / "embeddings").mkdir(parents=True, exist_ok=True)
    (models_dir / "models" / "f0").mkdir(parents=True, exist_ok=True)

    (models_dir / "models" / "rvc" / "f_8312_32k-325.pth").write_bytes(b"checkpoint")
    (models_dir / "models" / "embeddings" / "checkpoint_best_legacy_500.pt").write_bytes(b"embed")
    (models_dir / "models" / "f0" / "rmvpe.pt").write_bytes(b"f0")

    registry = {
        "version": 1,
        "models": [
            {
                "id": "voice_transfer_hq_cpu",
                "checkpointPath": "models/rvc/f_8312_32k-325.pth",
                "indexPath": "models/rvc/f_8312_32k-325.index",
                "embedderPath": "models/embeddings/checkpoint_best_legacy_500.pt",
                "f0ModelPath": "models/f0/rmvpe.pt",
                "resolvedModelId": "f_8312_32k-325",
                "sampleRate": 32000,
                "qualityTier": "hq",
                "enabled": True,
            }
        ],
    }
    registry_path = tmp_path / "voice_transfer_model_registry.json"
    registry_path.write_text(json.dumps(registry), encoding="utf-8")

    runtime_module = _load_runtime_module(registry_path=registry_path, models_dir=models_dir)
    called = {"count": 0}

    captured = {"backend_mode": None}

    def _fake_convert(*, assets, input_wav, output_wav, pitch_shift, f0_method, index_rate, backend_mode=None):
        _ = assets
        _ = input_wav
        _ = pitch_shift
        _ = f0_method
        _ = index_rate
        captured["backend_mode"] = backend_mode
        called["count"] += 1
        Path(output_wav).write_bytes(_tiny_wav_bytes())
        return {"resolvedModelId": "f_8312_32k-325", "indexUsed": False, "f0Method": "rmvpe"}

    def _fake_convert_media(input_path: str, output_path: str, *, sample_rate: int, channels: int = 1):
        _ = input_path
        _ = sample_rate
        _ = channels
        Path(output_path).write_bytes(_tiny_wav_bytes())

    def _fake_mastering(input_wav: str, output_wav: str, *, sample_rate: int, preset: str):
        _ = sample_rate
        _ = preset
        shutil.copy2(input_wav, output_wav)

    monkeypatch.setattr(runtime_module.svc_runtime, "convert", _fake_convert)
    monkeypatch.setattr(runtime_module, "_convert_media_to_wav", _fake_convert_media)
    monkeypatch.setattr(runtime_module, "_apply_llvc_mastering_filter", _fake_mastering)

    client = TestClient(runtime_module.app)
    response = client.post(
        "/v1/convert",
        files={"file": ("input.wav", _tiny_wav_bytes(), "audio/wav")},
        data={
            "model_name": "voice_transfer_hq_cpu",
            "preset": "voice_transfer_hq_cpu",
            "pitch_shift": "0",
            "index_rate": "0.5",
            "filter_radius": "3",
            "rms_mix_rate": "1.0",
            "protect": "0.33",
            "f0_method": "rmvpe",
        },
    )

    assert response.status_code == 200
    assert called["count"] == 1
    assert captured["backend_mode"] is None
    assert response.headers.get("x-vf-voice-transfer-preset") == "voice_transfer_hq_cpu"
    assert response.headers.get("x-vf-voice-transfer-backend-mode") == "w_okada_rvc_onnx"
    assert response.headers.get("x-vf-voice-transfer-model-resolved") == "f_8312_32k-325"


def test_voice_transfer_runtime_convert_ignores_legacy_backend_mode(monkeypatch, tmp_path: Path) -> None:
    models_dir = tmp_path / "models_llvc"
    (models_dir / "models" / "rvc").mkdir(parents=True, exist_ok=True)
    (models_dir / "models" / "embeddings").mkdir(parents=True, exist_ok=True)
    (models_dir / "models" / "f0").mkdir(parents=True, exist_ok=True)

    (models_dir / "models" / "rvc" / "f_8312_32k-325.pth").write_bytes(b"checkpoint")
    (models_dir / "models" / "embeddings" / "checkpoint_best_legacy_500.pt").write_bytes(b"embed")
    (models_dir / "models" / "f0" / "rmvpe.pt").write_bytes(b"f0")

    registry = {
        "version": 1,
        "models": [
            {
                "id": "voice_transfer_hq_cpu",
                "checkpointPath": "models/rvc/f_8312_32k-325.pth",
                "indexPath": "models/rvc/f_8312_32k-325.index",
                "embedderPath": "models/embeddings/checkpoint_best_legacy_500.pt",
                "f0ModelPath": "models/f0/rmvpe.pt",
                "resolvedModelId": "f_8312_32k-325",
                "sampleRate": 32000,
                "qualityTier": "hq",
                "enabled": True,
            }
        ],
    }
    registry_path = tmp_path / "voice_transfer_model_registry.json"
    registry_path.write_text(json.dumps(registry), encoding="utf-8")

    runtime_module = _load_runtime_module(registry_path=registry_path, models_dir=models_dir)
    captured = {"backend_mode": None}

    def _fake_convert(*, assets, input_wav, output_wav, pitch_shift, f0_method, index_rate, backend_mode=None):
        _ = assets
        _ = input_wav
        _ = pitch_shift
        _ = f0_method
        _ = index_rate
        captured["backend_mode"] = backend_mode
        Path(output_wav).write_bytes(_tiny_wav_bytes())
        return {"resolvedModelId": "f_8312_32k-325", "indexUsed": False, "f0Method": "rmvpe"}

    def _fake_convert_media(input_path: str, output_path: str, *, sample_rate: int, channels: int = 1):
        _ = input_path
        _ = sample_rate
        _ = channels
        Path(output_path).write_bytes(_tiny_wav_bytes())

    def _fake_mastering(input_wav: str, output_wav: str, *, sample_rate: int, preset: str):
        _ = sample_rate
        _ = preset
        shutil.copy2(input_wav, output_wav)

    monkeypatch.setattr(runtime_module.svc_runtime, "convert", _fake_convert)
    monkeypatch.setattr(runtime_module, "_convert_media_to_wav", _fake_convert_media)
    monkeypatch.setattr(runtime_module, "_apply_llvc_mastering_filter", _fake_mastering)

    client = TestClient(runtime_module.app)
    response = client.post(
        "/v1/convert",
        files={"file": ("input.wav", _tiny_wav_bytes(), "audio/wav")},
        data={
            "model_name": "voice_transfer_hq_cpu",
            "preset": "voice_transfer_hq_cpu",
            "backend_mode": "pytorch",
        },
    )

    assert response.status_code == 200
    assert captured["backend_mode"] is None
    assert response.headers.get("x-vf-voice-transfer-preset") == "voice_transfer_hq_cpu"
    assert response.headers.get("x-vf-voice-transfer-backend-mode") == "w_okada_rvc_onnx"


def test_voice_transfer_runtime_convert_auto_preset_prefers_hq_for_short_audio(monkeypatch, tmp_path: Path) -> None:
    models_dir = tmp_path / "models_llvc"
    (models_dir / "models" / "rvc").mkdir(parents=True, exist_ok=True)
    (models_dir / "models" / "embeddings").mkdir(parents=True, exist_ok=True)
    (models_dir / "models" / "f0").mkdir(parents=True, exist_ok=True)

    (models_dir / "models" / "rvc" / "f_8312_32k-325.pth").write_bytes(b"checkpoint")
    (models_dir / "models" / "embeddings" / "checkpoint_best_legacy_500.pt").write_bytes(b"embed")
    (models_dir / "models" / "f0" / "rmvpe.pt").write_bytes(b"f0")

    registry = {
        "version": 1,
        "models": [
            {
                "id": "voice_transfer_hq_cpu",
                "checkpointPath": "models/rvc/f_8312_32k-325.pth",
                "indexPath": "models/rvc/f_8312_32k-325.index",
                "embedderPath": "models/embeddings/checkpoint_best_legacy_500.pt",
                "f0ModelPath": "models/f0/rmvpe.pt",
                "resolvedModelId": "f_8312_32k-325",
                "sampleRate": 32000,
                "qualityTier": "hq",
                "enabled": True,
            }
        ],
    }
    registry_path = tmp_path / "voice_transfer_model_registry.json"
    registry_path.write_text(json.dumps(registry), encoding="utf-8")

    runtime_module = _load_runtime_module(registry_path=registry_path, models_dir=models_dir)
    captured = {"mastering_preset": None}

    def _fake_convert(*, assets, input_wav, output_wav, pitch_shift, f0_method, index_rate, backend_mode=None):
        _ = assets
        _ = input_wav
        _ = pitch_shift
        _ = f0_method
        _ = index_rate
        _ = backend_mode
        Path(output_wav).write_bytes(_tiny_wav_bytes())
        return {"resolvedModelId": "f_8312_32k-325", "indexUsed": False, "f0Method": "rmvpe"}

    def _fake_convert_media(input_path: str, output_path: str, *, sample_rate: int, channels: int = 1):
        _ = input_path
        _ = sample_rate
        _ = channels
        Path(output_path).write_bytes(_tiny_wav_bytes(duration_frames=32000 * 2))

    def _fake_mastering(input_wav: str, output_wav: str, *, sample_rate: int, preset: str):
        _ = input_wav
        _ = sample_rate
        captured["mastering_preset"] = preset
        Path(output_wav).write_bytes(_tiny_wav_bytes())

    monkeypatch.setattr(runtime_module.svc_runtime, "convert", _fake_convert)
    monkeypatch.setattr(runtime_module, "_convert_media_to_wav", _fake_convert_media)
    monkeypatch.setattr(runtime_module, "_apply_llvc_mastering_filter", _fake_mastering)

    client = TestClient(runtime_module.app)
    response = client.post(
        "/v1/convert",
        files={"file": ("input.wav", _tiny_wav_bytes(), "audio/wav")},
        data={
            "model_name": "voice_transfer_hq_cpu",
            "preset": "auto_cpu",
        },
    )

    assert response.status_code == 200
    assert captured["mastering_preset"] == "voice_transfer_hq_cpu"
    assert response.headers.get("x-vf-voice-transfer-preset-requested") == "auto_cpu"
    assert response.headers.get("x-vf-voice-transfer-preset") == "voice_transfer_hq_cpu"
    assert int(response.headers.get("x-vf-voice-transfer-input-duration-ms") or 0) >= 2000


def test_voice_transfer_runtime_convert_auto_preset_prefers_realtime_for_long_audio(monkeypatch, tmp_path: Path) -> None:
    models_dir = tmp_path / "models_llvc"
    (models_dir / "models" / "rvc").mkdir(parents=True, exist_ok=True)
    (models_dir / "models" / "embeddings").mkdir(parents=True, exist_ok=True)
    (models_dir / "models" / "f0").mkdir(parents=True, exist_ok=True)

    (models_dir / "models" / "rvc" / "f_8312_32k-325.pth").write_bytes(b"checkpoint")
    (models_dir / "models" / "embeddings" / "checkpoint_best_legacy_500.pt").write_bytes(b"embed")
    (models_dir / "models" / "f0" / "rmvpe.pt").write_bytes(b"f0")

    registry = {
        "version": 1,
        "models": [
            {
                "id": "voice_transfer_hq_cpu",
                "checkpointPath": "models/rvc/f_8312_32k-325.pth",
                "indexPath": "models/rvc/f_8312_32k-325.index",
                "embedderPath": "models/embeddings/checkpoint_best_legacy_500.pt",
                "f0ModelPath": "models/f0/rmvpe.pt",
                "resolvedModelId": "f_8312_32k-325",
                "sampleRate": 32000,
                "qualityTier": "hq",
                "enabled": True,
            }
        ],
    }
    registry_path = tmp_path / "voice_transfer_model_registry.json"
    registry_path.write_text(json.dumps(registry), encoding="utf-8")

    runtime_module = _load_runtime_module(registry_path=registry_path, models_dir=models_dir)
    captured = {"mastering_preset": None}

    def _fake_convert(*, assets, input_wav, output_wav, pitch_shift, f0_method, index_rate, backend_mode=None):
        _ = assets
        _ = input_wav
        _ = pitch_shift
        _ = f0_method
        _ = index_rate
        _ = backend_mode
        Path(output_wav).write_bytes(_tiny_wav_bytes())
        return {"resolvedModelId": "f_8312_32k-325", "indexUsed": False, "f0Method": "rmvpe"}

    def _fake_convert_media(input_path: str, output_path: str, *, sample_rate: int, channels: int = 1):
        _ = input_path
        _ = sample_rate
        _ = channels
        Path(output_path).write_bytes(_tiny_wav_bytes(duration_frames=32000 * 12))

    def _fake_mastering(input_wav: str, output_wav: str, *, sample_rate: int, preset: str):
        _ = input_wav
        _ = sample_rate
        captured["mastering_preset"] = preset
        Path(output_wav).write_bytes(_tiny_wav_bytes())

    monkeypatch.setattr(runtime_module.svc_runtime, "convert", _fake_convert)
    monkeypatch.setattr(runtime_module, "_convert_media_to_wav", _fake_convert_media)
    monkeypatch.setattr(runtime_module, "_apply_llvc_mastering_filter", _fake_mastering)

    client = TestClient(runtime_module.app)
    response = client.post(
        "/v1/convert",
        files={"file": ("input.wav", _tiny_wav_bytes(), "audio/wav")},
        data={
            "model_name": "voice_transfer_hq_cpu",
            "preset": "auto_cpu",
        },
    )

    assert response.status_code == 200
    assert captured["mastering_preset"] == "tts_realtime"
    assert response.headers.get("x-vf-voice-transfer-preset-requested") == "auto_cpu"
    assert response.headers.get("x-vf-voice-transfer-preset") == "tts_realtime"
    assert int(response.headers.get("x-vf-voice-transfer-input-duration-ms") or 0) >= 12_000
