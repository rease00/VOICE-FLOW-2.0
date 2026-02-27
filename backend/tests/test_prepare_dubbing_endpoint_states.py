from __future__ import annotations

from fastapi.testclient import TestClient

import app as backend_app


def _engine_by_health_url() -> dict[str, str]:
    return {url: engine for engine, url in backend_app.TTS_ENGINE_HEALTH_URLS.items()}


def test_prepare_skips_switch_when_services_already_online(monkeypatch) -> None:
    monkeypatch.setattr(
        backend_app,
        "_probe_runtime_health",
        lambda _url, timeout_sec=2.5: (True, "Runtime online"),
    )

    def _no_switch(*_args, **_kwargs):
        raise AssertionError("switch should not be called when runtime is already online")

    monkeypatch.setattr(backend_app, "_run_tts_switch_with_retry", _no_switch)

    client = TestClient(backend_app.app)
    response = client.post("/services/dubbing/prepare", json={"gpu": False})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    for item in payload["services"]:
        assert item["state"] == "online"
        assert item["attemptedSwitch"] is False
        assert int(item["waitedMs"]) == 0


def test_prepare_switches_offline_engine_once_and_polls(monkeypatch) -> None:
    health_map = _engine_by_health_url()
    switch_calls: list[str] = []
    wait_calls: list[str] = []

    def _probe(url: str, timeout_sec: float = 2.5):
        del timeout_sec
        engine = health_map[url]
        if engine == "GEM":
            return False, "offline"
        return True, "Runtime online"

    def _switch(engine: str, gpu: bool, retries: int = 2, keep_others: bool = True):
        del gpu, retries, keep_others
        switch_calls.append(engine)
        return f"switched:{engine}"

    def _wait(url: str, timeout_ms: int, poll_interval_ms: int = 1200):
        del timeout_ms, poll_interval_ms
        wait_calls.append(url)
        return True, "Runtime online", 1250

    monkeypatch.setattr(backend_app, "_probe_runtime_health", _probe)
    monkeypatch.setattr(backend_app, "_run_tts_switch_with_retry", _switch)
    monkeypatch.setattr(backend_app, "_wait_for_runtime_online", _wait)

    client = TestClient(backend_app.app)
    response = client.post("/services/dubbing/prepare", json={"gpu": True})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert switch_calls == ["GEM"]
    assert wait_calls == [backend_app.TTS_ENGINE_HEALTH_URLS["GEM"]]

    gem = next(item for item in payload["services"] if item["engine"] == "GEM")
    assert gem["state"] == "online"
    assert gem["attemptedSwitch"] is True
    assert int(gem["waitedMs"]) == 1250

    for engine in ("KOKORO",):
        item = next(result for result in payload["services"] if result["engine"] == engine)
        assert item["state"] == "online"
        assert item["attemptedSwitch"] is False


def test_prepare_returns_starting_and_failed_states_consistently(monkeypatch) -> None:
    health_map = _engine_by_health_url()
    switch_calls: list[str] = []

    def _probe(url: str, timeout_sec: float = 2.5):
        del timeout_sec
        engine = health_map[url]
        if engine in {"GEM", "KOKORO"}:
            return False, "offline"
        return True, "Runtime online"

    def _switch(engine: str, gpu: bool, retries: int = 2, keep_others: bool = True):
        del gpu, retries, keep_others
        switch_calls.append(engine)
        if engine == "KOKORO":
            raise RuntimeError("switch failed")
        return f"switched:{engine}"

    def _wait(url: str, timeout_ms: int, poll_interval_ms: int = 1200):
        del timeout_ms, poll_interval_ms
        engine = health_map[url]
        if engine == "GEM":
            return False, "Runtime is still starting.", 2000
        return True, "Runtime online", 0

    monkeypatch.setattr(backend_app, "_probe_runtime_health", _probe)
    monkeypatch.setattr(backend_app, "_run_tts_switch_with_retry", _switch)
    monkeypatch.setattr(backend_app, "_wait_for_runtime_online", _wait)

    client = TestClient(backend_app.app)
    response = client.post("/services/dubbing/prepare", json={"gpu": False})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert switch_calls == ["GEM", "KOKORO"]

    gem = next(item for item in payload["services"] if item["engine"] == "GEM")
    assert gem["state"] == "starting"
    assert gem["ok"] is True
    assert gem["attemptedSwitch"] is True
    assert int(gem["waitedMs"]) == 2000

    kokoro = next(item for item in payload["services"] if item["engine"] == "KOKORO")
    assert kokoro["state"] == "failed"
    assert kokoro["ok"] is False
    assert kokoro["attemptedSwitch"] is True
