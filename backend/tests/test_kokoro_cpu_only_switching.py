from __future__ import annotations

from fastapi.testclient import TestClient

import app as backend_app


def test_duno_switch_endpoint_uses_modal_health_url_and_forces_cpu_mode(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    probe_calls: list[tuple[str, float]] = []
    switch_calls: list[tuple[str, bool, int, bool]] = []

    monkeypatch.setitem(
        backend_app.TTS_ENGINE_HEALTH_URLS,
        "DUNO",
        "https://duno-modal.example/health",
    )

    def _probe(_url: str, timeout_sec: float = 2.5):
        probe_calls.append((_url, float(timeout_sec)))
        return True, "Runtime online"

    def _switch(engine: str, gpu: bool, retries: int = 2, keep_others: bool = True):
        switch_calls.append((engine, gpu, retries, keep_others))
        return f"switched:{engine}"

    monkeypatch.setattr(backend_app, "_probe_runtime_health", _probe)
    monkeypatch.setattr(backend_app, "_run_tts_switch_with_retry", _switch)

    client = TestClient(backend_app.app)
    response = client.post(
        "/tts/engines/switch",
        json={"engine": "DUNO", "gpu": True},
        headers={"x-dev-uid": "local_admin"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["engine"] == "DUNO"
    assert payload["gpuMode"] is False
    assert [url for url, _timeout in probe_calls] == ["https://duno-modal.example/health"]
    assert all(
        timeout >= backend_app.VF_TTS_STATUS_PROBE_TIMEOUT_REMOTE_SEC
        for _url, timeout in probe_calls
    )
    assert switch_calls == []
