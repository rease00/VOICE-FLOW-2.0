from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app as backend_app


class _NoopThread:
    def __init__(self, target=None, args=(), kwargs=None, daemon: bool | None = None) -> None:
        self.target = target
        self.args = args
        self.kwargs = kwargs or {}
        self.daemon = daemon

    def start(self) -> None:
        return None


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> TestClient:
    monkeypatch.setattr(backend_app, "ARTIFACTS_DIR", tmp_path)
    monkeypatch.setattr(backend_app.threading, "Thread", _NoopThread)
    with backend_app.DUBBING_JOB_LOCK:
        backend_app.DUBBING_JOBS.clear()
    return TestClient(backend_app.app)


def _post_job_v2(client: TestClient, advanced_payload: dict[str, str]) -> dict:
    response = client.post(
        "/dubbing/jobs/v2",
        data={"advanced": json.dumps(advanced_payload)},
        files={"source_file": ("sample.wav", b"dummy", "audio/wav")},
    )
    return {"response": response, "payload": response.json()}


def test_dubbing_v2_rejects_legacy_xtts_mode(client: TestClient) -> None:
    result = _post_job_v2(client, {"xtts_mode": "clone"})
    response = result["response"]
    payload = result["payload"]
    assert response.status_code == 400
    assert "advanced.xtts_mode is no longer supported" in str(payload.get("detail"))


def test_dubbing_v2_rejects_legacy_tts_runtime(client: TestClient) -> None:
    result = _post_job_v2(client, {"tts_runtime": "xtts"})
    response = result["response"]
    payload = result["payload"]
    assert response.status_code == 400
    assert "advanced.tts_runtime is no longer supported" in str(payload.get("detail"))


@pytest.mark.parametrize(
    ("tts_route", "expected_engine"),
    [
        ("auto", "GEM"),
        ("gem_only", "GEM"),
        ("kokoro_only", "KOKORO"),
    ],
)
def test_dubbing_v2_accepts_tts_route_and_sets_supported_engine(
    client: TestClient,
    tts_route: str,
    expected_engine: str,
) -> None:
    result = _post_job_v2(client, {"tts_route": tts_route})
    response = result["response"]
    payload = result["payload"]
    assert response.status_code == 200
    assert payload.get("ok") is True

    job_id = str(payload["job_id"])
    with backend_app.DUBBING_JOB_LOCK:
        job = dict(backend_app.DUBBING_JOBS[job_id])

    assert job.get("engineExecuted") == expected_engine
    assert job.get("engineExecuted") in {"GEM", "KOKORO"}


def test_engine_executed_resolver_never_returns_xtts() -> None:
    assert backend_app._resolve_engine_executed_from_requests([]) == "GEM"
    assert (
        backend_app._resolve_engine_executed_from_requests(
            [{"engine": "KOKORO"}, {"engine": "GEM"}, {"engine": "GEM"}]
        )
        == "GEM"
    )
    assert (
        backend_app._resolve_engine_executed_from_requests(
            [{"engine": "KOKORO"}, {"engine": "GEM"}]
        )
        == "KOKORO"
    )
    assert (
        backend_app._resolve_engine_executed_from_requests(
            [{"engine": "XTTS"}, {"engine": "XTTS"}]
        )
        == "GEM"
    )
