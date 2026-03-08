from __future__ import annotations

import shutil
import wave
from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient

import app as backend_app


def _tiny_wav_bytes(duration_frames: int = 300, sample_rate: int = 40000) -> bytes:
    payload = BytesIO()
    with wave.open(payload, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"\x00\x00" * max(1, int(duration_frames)))
    return payload.getvalue()


def test_voice_transfer_convert_separate_stem_default_true(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app.source_separation_runtime, "ensure_available", lambda: True)

    speech_path = tmp_path / "speech.wav"
    speech_path.write_bytes(_tiny_wav_bytes())
    background_path = tmp_path / "background.wav"
    background_path.write_bytes(_tiny_wav_bytes())

    monkeypatch.setattr(
        backend_app,
        "_ensure_source_separation",
        lambda source_path, model_name: (speech_path, background_path, "cache_key"),
    )

    def _fake_convert_media(input_path: str, output_path: str, *, sample_rate: int, channels: int = 1):
        _ = input_path
        _ = sample_rate
        _ = channels
        Path(output_path).write_bytes(_tiny_wav_bytes())

    monkeypatch.setattr(backend_app, "_convert_media_to_wav", _fake_convert_media)
    monkeypatch.setattr(backend_app.llvc_adapter, "health", lambda: (True, "llvc_ready"))

    def _fake_llvc_convert(input_wav: str, output_wav: str, **kwargs):
        _ = input_wav
        _ = kwargs
        Path(output_wav).write_bytes(_tiny_wav_bytes())
        return {
            "x-vf-voice-transfer-model-resolved": "f_8312_32k-325",
            "x-vf-voice-transfer-backend-mode": "w_okada_rvc_onnx",
        }

    monkeypatch.setattr(backend_app.llvc_adapter, "convert", _fake_llvc_convert)

    client = TestClient(backend_app.app)
    response = client.post(
        "/voice-transfer/convert",
        files={"file": ("input.wav", _tiny_wav_bytes(), "audio/wav")},
        data={
            "model_name": "p17_india_boy",
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
    assert response.headers.get("x-vf-source-separated") == "1"
    assert response.headers.get("x-vf-separation-model") == backend_app.SEPARATION_MODEL
    assert response.headers.get("x-vf-voice-transfer-model-resolved") == "f_8312_32k-325"
    assert response.headers.get("x-vf-voice-transfer-backend-mode") == "w_okada_rvc_onnx"


def test_voice_transfer_convert_separate_stem_false_skips_demucs(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    def _raise_if_called(*args, **kwargs):
        raise AssertionError("_ensure_source_separation should not be called when separate_stem=false")

    monkeypatch.setattr(backend_app, "_ensure_source_separation", _raise_if_called)

    def _fake_convert_media(input_path: str, output_path: str, *, sample_rate: int, channels: int = 1):
        _ = input_path
        _ = sample_rate
        _ = channels
        Path(output_path).write_bytes(_tiny_wav_bytes())

    monkeypatch.setattr(backend_app, "_convert_media_to_wav", _fake_convert_media)
    monkeypatch.setattr(backend_app.llvc_adapter, "health", lambda: (True, "llvc_ready"))

    def _fake_llvc_convert(input_wav: str, output_wav: str, **kwargs):
        _ = input_wav
        _ = kwargs
        Path(output_wav).write_bytes(_tiny_wav_bytes())
        return {
            "x-vf-voice-transfer-model-resolved": "f_8312_32k-325",
            "x-vf-voice-transfer-backend-mode": "w_okada_rvc_onnx",
        }

    monkeypatch.setattr(backend_app.llvc_adapter, "convert", _fake_llvc_convert)

    client = TestClient(backend_app.app)
    response = client.post(
        "/voice-transfer/convert",
        files={"file": ("input.wav", _tiny_wav_bytes(), "audio/wav")},
        data={
            "model_name": "p17_india_boy",
            "preset": "voice_transfer_hq_cpu",
            "pitch_shift": "0",
            "index_rate": "0.5",
            "filter_radius": "3",
            "rms_mix_rate": "1.0",
            "protect": "0.33",
            "f0_method": "rmvpe",
            "separate_stem": "false",
        },
    )

    assert response.status_code == 200
    assert response.headers.get("x-vf-source-separated") == "0"
    assert response.headers.get("x-vf-separation-model") == ""


def test_voice_transfer_convert_ignores_legacy_backend_mode(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)

    def _fake_convert_media(input_path: str, output_path: str, *, sample_rate: int, channels: int = 1):
        _ = input_path
        _ = sample_rate
        _ = channels
        Path(output_path).write_bytes(_tiny_wav_bytes())

    monkeypatch.setattr(backend_app, "_convert_media_to_wav", _fake_convert_media)
    monkeypatch.setattr(backend_app.llvc_adapter, "health", lambda: (True, "llvc_ready"))
    captured = {"backend_mode": None}

    def _fake_llvc_convert(input_wav: str, output_wav: str, **kwargs):
        _ = input_wav
        captured["backend_mode"] = kwargs.get("backend_mode")
        Path(output_wav).write_bytes(_tiny_wav_bytes())
        return {
            "x-vf-voice-transfer-model-resolved": "f_8312_32k-325",
            "x-vf-voice-transfer-backend-mode": "w_okada_rvc_onnx",
        }

    monkeypatch.setattr(backend_app.llvc_adapter, "convert", _fake_llvc_convert)

    client = TestClient(backend_app.app)
    response = client.post(
        "/voice-transfer/convert",
        files={"file": ("input.wav", _tiny_wav_bytes(), "audio/wav")},
        data={
            "model_name": "p17_india_boy",
            "preset": "voice_transfer_hq_cpu",
            "backend_mode": "pytorch",
            "separate_stem": "false",
        },
    )

    assert response.status_code == 200
    assert captured["backend_mode"] is None
    assert response.headers.get("x-vf-voice-transfer-backend-mode") == "w_okada_rvc_onnx"


def test_voice_transfer_convert_surfaces_runtime_selected_auto_preset(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)

    def _fake_convert_media(input_path: str, output_path: str, *, sample_rate: int, channels: int = 1):
        _ = input_path
        _ = sample_rate
        _ = channels
        Path(output_path).write_bytes(_tiny_wav_bytes())

    monkeypatch.setattr(backend_app, "_convert_media_to_wav", _fake_convert_media)
    monkeypatch.setattr(backend_app.llvc_adapter, "health", lambda: (True, "llvc_ready"))

    def _fake_llvc_convert(input_wav: str, output_wav: str, **kwargs):
        _ = input_wav
        _ = kwargs
        Path(output_wav).write_bytes(_tiny_wav_bytes())
        return {
            "x-vf-voice-transfer-model-resolved": "f_8312_32k-325",
            "x-vf-voice-transfer-backend-mode": "w_okada_rvc_onnx",
            "x-vf-voice-transfer-preset-requested": "auto_cpu",
            "x-vf-voice-transfer-preset": "tts_realtime",
            "x-vf-voice-transfer-input-duration-ms": "12000",
        }

    monkeypatch.setattr(backend_app.llvc_adapter, "convert", _fake_llvc_convert)

    client = TestClient(backend_app.app)
    response = client.post(
        "/voice-transfer/convert",
        files={"file": ("input.wav", _tiny_wav_bytes(), "audio/wav")},
        data={
            "model_name": "p17_india_boy",
            "preset": "auto_cpu",
            "separate_stem": "false",
        },
    )

    assert response.status_code == 200
    assert response.headers.get("x-vf-voice-transfer-preset-requested") == "auto_cpu"
    assert response.headers.get("x-vf-voice-transfer-preset") == "tts_realtime"
    assert response.headers.get("x-vf-voice-transfer-input-duration-ms") == "12000"
