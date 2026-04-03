from __future__ import annotations

import base64
import io
import importlib.util
from pathlib import Path
import sys
import wave

from fastapi.testclient import TestClient

RUNTIME_ROOT = Path(__file__).resolve().parent
APP_PATH = RUNTIME_ROOT / "app.py"
_SPEC = importlib.util.spec_from_file_location("seed_vc_runtime_app", APP_PATH)
if _SPEC is None or _SPEC.loader is None:
    raise RuntimeError(f"Unable to load Seed VC runtime module from {APP_PATH}.")
runtime_app = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = runtime_app
_SPEC.loader.exec_module(runtime_app)
runtime_app.OpenVoiceRequest.model_rebuild()


def _client(monkeypatch, token: str = "test-token") -> TestClient:
    monkeypatch.setattr(runtime_app, "RUNTIME_TOKEN", token)
    return TestClient(runtime_app.app)


def _build_wav_bytes(*, duration_sec: float = 0.2, sample_rate: int = 24_000) -> bytes:
    frame_count = max(1, int(duration_sec * sample_rate))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(b"\x00\x00" * frame_count)
    return buffer.getvalue()


def test_health_requires_bearer_token(monkeypatch) -> None:
    client = _client(monkeypatch)
    response = client.get("/health")
    assert response.status_code == 401
    assert response.json()["detail"] == "Missing bearer token."


def test_vc_returns_deterministic_audio(monkeypatch) -> None:
    client = _client(monkeypatch)
    payload = {
        "mode": "vc",
        "requestId": "req-1",
        "traceId": "trace-1",
        "text": "hello world",
        "referenceAudioBase64": base64.b64encode(b"reference").decode("ascii"),
        "sourceAudioBase64": base64.b64encode(b"source").decode("ascii"),
    }
    response = client.post("/v1/vc", json=payload, headers={"authorization": "Bearer test-token"})
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["mode"] == "vc"
    assert body["audioBase64"]
    assert body["runtime"]["device"]
    assert body["runtime"]["vcProvider"] == "seed-vc-cloud-run"


def test_separate_requires_bearer_token_and_returns_stems(monkeypatch) -> None:
    client = _client(monkeypatch)
    source_audio = base64.b64encode(_build_wav_bytes()).decode("ascii")
    payload = {
        "requestId": "sep-1",
        "traceId": "trace-1",
        "sourceAudioBase64": source_audio,
        "sourceAudioName": "source.wav",
        "sourceSeparationModel": "htdemucs_ft",
        "sourceSeparationDevice": "cpu_only",
    }

    unauthorized = client.post("/v1/separate", json=payload)
    assert unauthorized.status_code == 401
    assert unauthorized.json()["detail"] == "Missing bearer token."

    response = client.post("/v1/separate", json=payload, headers={"authorization": "Bearer test-token"})
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["status"] == "completed"
    assert body["requestId"] == "sep-1"
    assert body["traceId"] == "trace-1"
    assert body["vocalsAudioBase64"]
    assert body["backgroundAudioBase64"]
    assert body["runtime"]["sourceSeparation"]["provider"] == "cloud_run"
    assert body["runtime"]["sourceSeparation"]["cacheHit"] is False
