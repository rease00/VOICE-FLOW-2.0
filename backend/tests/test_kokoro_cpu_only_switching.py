from __future__ import annotations

from fastapi.testclient import TestClient

import app as backend_app


def test_kokoro_switch_endpoint_forces_cpu_mode(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    probe_count = {"value": 0}
    switch_calls: list[tuple[str, bool, int, bool]] = []

    def _probe(_url: str, timeout_sec: float = 2.5):
        del timeout_sec
        probe_count["value"] += 1
        if probe_count["value"] == 1:
            return False, "offline"
        return True, "Runtime online"

    def _switch(engine: str, gpu: bool, retries: int = 2, keep_others: bool = True):
        switch_calls.append((engine, gpu, retries, keep_others))
        return f"switched:{engine}"

    monkeypatch.setattr(backend_app, "_probe_runtime_health", _probe)
    monkeypatch.setattr(backend_app, "_run_tts_switch_with_retry", _switch)

    client = TestClient(backend_app.app)
    response = client.post(
        "/tts/engines/switch",
        json={"engine": "KOKORO", "gpu": True},
        headers={"x-dev-uid": "local_admin"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["engine"] == "KOKORO"
    assert payload["gpuMode"] is False
    assert switch_calls == [("KOKORO", False, 2, True)]
