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
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "ARTIFACTS_DIR", tmp_path)
    monkeypatch.setattr(backend_app.threading, "Thread", _NoopThread)
    with backend_app.DUBBING_JOB_LOCK:
        backend_app.DUBBING_JOBS.clear()
    return TestClient(backend_app.app)


def _post_job_v2(
    client: TestClient,
    advanced_payload: dict[str, object],
    *,
    include_voice_model: bool = True,
) -> dict:
    payload = dict(advanced_payload)
    if include_voice_model:
        payload = {"voice_model": "p17_india_boy", **payload}
    response = client.post(
        "/dubbing/jobs/v2",
        data={"advanced": json.dumps(payload)},
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


def test_dubbing_v2_defaults_voice_model_when_omitted(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(backend_app, "_resolve_llvc_model_name_for_runtime", lambda _value: "voice_transfer_hq_cpu")
    result = _post_job_v2(client, {}, include_voice_model=False)
    response = result["response"]
    payload = result["payload"]
    assert response.status_code == 200
    assert payload.get("ok") is True

    job_id = str(payload["job_id"])
    with backend_app.DUBBING_JOB_LOCK:
        job = dict(backend_app.DUBBING_JOBS[job_id])

    advanced = job.get("advanced") if isinstance(job.get("advanced"), dict) else {}
    assert str(advanced.get("voice_model") or "") == "voice_transfer_hq_cpu"


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

    policy = job.get("policyEnforcement") if isinstance(job.get("policyEnforcement"), dict) else {}
    assert str(policy.get("requestedTtsRoute") or "") == tts_route
    assert str(policy.get("appliedTtsRoute") or "") == tts_route
    assert job.get("engineExecuted") == expected_engine
    assert job.get("pipelineVersion") == backend_app.VF_DUB_PIPELINE_VERSION
    assert "directorJson" in job
    assert "isochronyStats" in job
    assert "voiceTransferMetrics" in job
    assert "videoSyncMetrics" in job
    assert "tokenUsage" in job
    assert "assets" in job
    assert "thinkingPolicy" in job


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


@pytest.mark.parametrize(
    ("profile", "expected"),
    [
        ("cpu_quality", "cpu_quality"),
        ("cpu_balanced", "cpu_balanced"),
        ("cpu_fast", "cpu_fast"),
        ("invalid_profile_token", "cpu_quality"),
    ],
)
def test_dubbing_v2_normalizes_processing_profile(
    client: TestClient,
    profile: str,
    expected: str,
) -> None:
    result = _post_job_v2(client, {"processing_profile": profile})
    response = result["response"]
    payload = result["payload"]
    assert response.status_code == 200
    assert payload.get("ok") is True

    job_id = str(payload["job_id"])
    with backend_app.DUBBING_JOB_LOCK:
        job = dict(backend_app.DUBBING_JOBS[job_id])
    assert job.get("processingProfile") == expected


def test_dubbing_v2_accepts_clip_window_and_stores_normalized_bounds(client: TestClient) -> None:
    result = _post_job_v2(client, {"clip_window": {"start_ms": 120, "end_ms": 980}})
    response = result["response"]
    payload = result["payload"]
    assert response.status_code == 200
    assert payload.get("ok") is True

    job_id = str(payload["job_id"])
    with backend_app.DUBBING_JOB_LOCK:
        job = dict(backend_app.DUBBING_JOBS[job_id])
    assert job.get("clipWindow") == {"start_ms": 120, "end_ms": 980}


def test_dubbing_v2_initializes_live_qos_and_speaker_stats_defaults(client: TestClient) -> None:
    result = _post_job_v2(client, {})
    response = result["response"]
    payload = result["payload"]
    assert response.status_code == 200
    assert payload.get("ok") is True

    job_id = str(payload["job_id"])
    with backend_app.DUBBING_JOB_LOCK:
        job = dict(backend_app.DUBBING_JOBS[job_id])

    live = job.get("live") if isinstance(job.get("live"), dict) else {}
    speaker_stats = job.get("speakerStats") if isinstance(job.get("speakerStats"), dict) else {}
    qos_state = job.get("qosState") if isinstance(job.get("qosState"), dict) else {}

    assert bool(live.get("enabled")) is True
    assert str(live.get("mode") or "") == "progressive_audio"
    assert int(job.get("chunkCursorNext") or 0) == 0
    assert int(speaker_stats.get("detectedSpeakers") or 0) == 0
    assert int(speaker_stats.get("mappedSpeakers") or 0) == 0
    assert str(qos_state.get("selectedProfile") or "") == "cpu_quality"


def test_dubbing_v2_normalizes_new_policy_fields(client: TestClient) -> None:
    result = _post_job_v2(
        client,
        {
            "multispeaker_policy": "AUTO_DIARIZE",
            "voice_binding_policy": "unknown",
            "qos_policy": "invalid",
            "hardware_policy": "cpu_only",
            "timeout_policy": "fixed",
            "live_play_mode": "off",
            "live_chunk_target_ms": 25000,
            "max_speaker_count": 88,
        },
    )
    response = result["response"]
    payload = result["payload"]
    assert response.status_code == 200
    assert payload.get("ok") is True

    job_id = str(payload["job_id"])
    with backend_app.DUBBING_JOB_LOCK:
        job = dict(backend_app.DUBBING_JOBS[job_id])

    live = job.get("live") if isinstance(job.get("live"), dict) else {}
    assert bool(live.get("enabled")) is False
    assert str(live.get("mode") or "") == "off"


def test_select_dubbing_qos_state_respects_requested_fast_profile() -> None:
    selected, qos, overrides = backend_app._select_dubbing_qos_state(
        requested_profile="cpu_fast",
        qos_policy="adaptive_hq_first",
        hardware_policy="cpu_only",
        transcript_override="hello",
    )
    assert selected == "cpu_fast"
    assert str(qos.get("selectedProfile") or "") == "cpu_fast"
    assert str(overrides.get("voice_transfer_preset") or "") == "tts_realtime"


def test_select_dubbing_qos_state_degrades_long_quality_profile_to_balanced() -> None:
    selected, qos, overrides = backend_app._select_dubbing_qos_state(
        requested_profile="cpu_quality",
        qos_policy="adaptive_hq_first",
        hardware_policy="cpu_only",
        transcript_override=("line\n" * 7000),
    )
    assert selected == "cpu_balanced"
    assert bool(qos.get("downgraded")) is True
    assert str(qos.get("reason") or "") == "long_script_timeout_risk"
    assert str(overrides.get("voice_transfer_preset") or "") == "tts_realtime"


@pytest.mark.parametrize(
    "clip_window",
    [
        {"start_ms": -1, "end_ms": 100},
        {"start_ms": 100, "end_ms": 100},
        {"start_ms": 220, "end_ms": 120},
        {"start_ms": "abc", "end_ms": 220},
        {"start_ms": 120},
        "bad-shape",
    ],
)
def test_dubbing_v2_rejects_invalid_clip_window(client: TestClient, clip_window: object) -> None:
    result = _post_job_v2(client, {"clip_window": clip_window})
    response = result["response"]
    payload = result["payload"]
    assert response.status_code == 400
    assert "advanced.clip_window" in str(payload.get("detail"))
