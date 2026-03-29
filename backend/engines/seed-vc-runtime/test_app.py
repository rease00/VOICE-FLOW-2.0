from __future__ import annotations

import base64
from pathlib import Path
import sys

from fastapi.testclient import TestClient

RUNTIME_ROOT = Path(__file__).resolve().parent
BACKEND_ROOT = RUNTIME_ROOT.parents[1]
WORKSPACE_ROOT = BACKEND_ROOT.parent
for candidate in (str(RUNTIME_ROOT), str(BACKEND_ROOT), str(WORKSPACE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

import app as runtime_app


def _client(monkeypatch, token: str = "test-token") -> TestClient:
    monkeypatch.setattr(runtime_app, "RUNTIME_TOKEN", token)
    return TestClient(runtime_app.app)


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
