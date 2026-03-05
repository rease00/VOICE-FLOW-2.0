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
    module_path = Path(__file__).resolve().parents[1] / "engines" / "llvc-runtime" / "app.py"
    module_name = f"llvc_runtime_app_test_{uuid4().hex}"

    env_backup = {
        "VF_LLVC_MODEL_REGISTRY_FILE": os.environ.get("VF_LLVC_MODEL_REGISTRY_FILE"),
        "VF_LLVC_MODELS_DIR": os.environ.get("VF_LLVC_MODELS_DIR"),
    }
    os.environ["VF_LLVC_MODEL_REGISTRY_FILE"] = str(registry_path)
    os.environ["VF_LLVC_MODELS_DIR"] = str(models_dir)

    try:
        spec = importlib.util.spec_from_file_location(module_name, module_path)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        if env_backup["VF_LLVC_MODEL_REGISTRY_FILE"] is None:
            os.environ.pop("VF_LLVC_MODEL_REGISTRY_FILE", None)
        else:
            os.environ["VF_LLVC_MODEL_REGISTRY_FILE"] = env_backup["VF_LLVC_MODEL_REGISTRY_FILE"]
        if env_backup["VF_LLVC_MODELS_DIR"] is None:
            os.environ.pop("VF_LLVC_MODELS_DIR", None)
        else:
            os.environ["VF_LLVC_MODELS_DIR"] = env_backup["VF_LLVC_MODELS_DIR"]


def test_llvc_runtime_convert_uses_svc_runtime(monkeypatch, tmp_path: Path) -> None:
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
                "id": "llvc_hq_cpu",
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
    registry_path = tmp_path / "llvc_model_registry.json"
    registry_path.write_text(json.dumps(registry), encoding="utf-8")

    runtime_module = _load_runtime_module(registry_path=registry_path, models_dir=models_dir)
    called = {"count": 0}

    def _fake_convert(*, assets, input_wav, output_wav, pitch_shift, f0_method, index_rate):
        _ = assets
        _ = input_wav
        _ = pitch_shift
        _ = f0_method
        _ = index_rate
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
            "model_name": "llvc_hq_cpu",
            "preset": "llvc_hq_cpu",
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
    assert response.headers.get("x-vf-llvc-backend-mode") == "real_svc"
    assert response.headers.get("x-vf-llvc-model-resolved") == "f_8312_32k-325"
