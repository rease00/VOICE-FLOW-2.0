from __future__ import annotations

from fastapi.testclient import TestClient

import app as backend_app


def test_health_routes_expose_llvc_backend_and_separation(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "_get_ffmpeg_path", lambda: "ffmpeg")
    monkeypatch.setattr(backend_app.llvc_runtime, "ensure_engine", lambda: None)
    monkeypatch.setattr(
        backend_app.llvc_runtime,
        "health_payload",
        lambda: {
            "llvc": {
                "available": True,
                "currentModel": "p17_india_boy",
                "resolvedModelId": "f_8312_32k-325",
                "backendMode": "real_svc",
                "modelsDir": "models/llvc",
                "error": None,
            }
        },
    )
    monkeypatch.setattr(backend_app.source_separation_runtime, "ensure_available", lambda: True)
    monkeypatch.setattr(backend_app.source_separation_runtime, "import_error", None)

    client = TestClient(backend_app.app)
    response = client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload.get("llvc", {}).get("backendMode") == "real_svc"
    assert payload.get("llvc", {}).get("resolvedModelId") == "f_8312_32k-325"
    assert payload.get("sourceSeparation", {}).get("available") is True
    assert payload.get("sourceSeparation", {}).get("model") == backend_app.VF_DUB_PHASE1_MODEL
    assert "dereverbReady" in payload.get("sourceSeparation", {})
    assert payload.get("lipsync", {}).get("runtime") == "wav2lip-onnx"
