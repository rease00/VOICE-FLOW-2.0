from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

import app as backend_app


def test_kokoro_browser_status_route_is_public(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    client = TestClient(backend_app.app)

    response = client.get("/models/kokoro/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert "ready" in payload
    assert payload["runtime"]["dtype"] == "q8"
    assert payload["runtime"]["modelFile"] == "onnx/model_quantized.onnx"


def test_kokoro_browser_asset_route_is_public_but_other_models_stay_protected(
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "LOCAL_MODEL_MIRROR_ROOT", tmp_path)
    mirror_dir = (tmp_path / backend_app.KOKORO_MODEL_REPO_ID).resolve()
    mirror_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(backend_app, "KOKORO_MODEL_MIRROR_DIR", mirror_dir)

    public_asset = mirror_dir / "config.json"
    public_asset.write_text('{"ok": true}', encoding="utf-8")

    private_asset = tmp_path / "voice-transfer" / "secret.bin"
    private_asset.parent.mkdir(parents=True, exist_ok=True)
    private_asset.write_bytes(b"secret")

    client = TestClient(backend_app.app)

    public_response = client.get(f"/models/{backend_app.KOKORO_MODEL_REPO_ID}/config.json")
    assert public_response.status_code == 200
    assert public_response.text == '{"ok": true}'

    private_response = client.get("/models/voice-transfer/secret.bin")
    assert private_response.status_code == 401
    assert "Missing bearer token" in str(private_response.json().get("detail") or "")
