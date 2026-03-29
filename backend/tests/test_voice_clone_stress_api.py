from __future__ import annotations

import base64
import io
import wave

import pytest
from fastapi.testclient import TestClient

import app as backend_app


client = TestClient(backend_app.app)


def _reset_stress_state() -> None:
    backend_app._VOICE_CLONE_STRESS_JOBS.clear()
    backend_app._RBAC_ACTOR_CACHE.clear()
    backend_app._INMEMORY_ADMIN_ROLES.clear()
    backend_app._INMEMORY_ENTITLEMENTS.clear()
    backend_app._INMEMORY_USER_PROFILES.clear()
    backend_app._INMEMORY_USER_ID_INDEX.clear()


@pytest.fixture(autouse=True)
def _stress_test_isolation(monkeypatch: pytest.MonkeyPatch):
    _reset_stress_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)
    monkeypatch.setattr(backend_app, "VF_USER_ID_REQUIRED", False)
    monkeypatch.setattr(backend_app, "_firebase_ready", lambda: False)
    yield
    _reset_stress_state()


def _seed_role(uid: str, role: str) -> None:
    backend_app._rbac_write_assignment(
        uid,
        {
            "role": role,
            "allowOverrides": [],
            "denyOverrides": [],
            "status": "active",
            "updatedBy": "seed",
        },
    )


def _admin_headers(uid: str) -> dict[str, str]:
    return {"x-dev-uid": uid}


def _wav_b64(*, duration_sec: float = 0.2, sample_rate: int = 24_000) -> str:
    frame_count = max(1, int(duration_sec * sample_rate))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"\x00\x00" * frame_count)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _stress_payload(
    target: str,
    *,
    start_rpm: int = 2,
    step_rpm: int = 2,
    max_rpm: int = 4,
    step_duration_sec: int = 5,
    concurrency: int = 1,
    max_failure_rate: float = 0.0,
    max_p95_ms: int = 20_000,
    warmup_requests: int = 0,
    request_timeout_sec: float = 1.0,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "benchmarkTarget": target,
        "config": {
            "startRpm": start_rpm,
            "stepRpm": step_rpm,
            "maxRpm": max_rpm,
            "stepDurationSec": step_duration_sec,
            "concurrency": concurrency,
            "maxFailureRate": max_failure_rate,
            "maxP95Ms": max_p95_ms,
            "warmupRequests": warmup_requests,
            "requestTimeoutSec": request_timeout_sec,
        },
        "text": "stress benchmark sample",
        "voiceName": "Fenrir",
    }
    if target == "OPENVOICE_L4_VC":
        payload.update(
            {
                "referenceAudioBase64": _wav_b64(duration_sec=0.2),
                "referenceAudioName": "reference.wav",
                "sourceAudioBase64": _wav_b64(duration_sec=0.2),
                "sourceAudioName": "source.wav",
            }
        )
    return payload


def test_voice_clone_stress_admin_routes_require_ops_mutate(monkeypatch: pytest.MonkeyPatch) -> None:
    _seed_role("voice_reader", backend_app.RBAC_ROLE_READ_ONLY_OPS)
    _seed_role("voice_admin", backend_app.RBAC_ROLE_SUPER_ADMIN)
    monkeypatch.setattr(backend_app, "_launch_voice_clone_stress_job", lambda job_id: None)

    denied = client.post(
        "/admin/voice-clone/stress/start",
        headers=_admin_headers("voice_reader"),
        json=_stress_payload("OPENVOICE_L4_VC"),
    )
    assert denied.status_code == 403
    assert "Missing permission: ops.mutate" in str(denied.json().get("detail") or "")

    started = client.post(
        "/admin/voice-clone/stress/start",
        headers=_admin_headers("voice_admin"),
        json=_stress_payload("OPENVOICE_L4_VC"),
    )
    assert started.status_code == 202
    body = started.json()
    assert body["ok"] is True
    assert body["status"] == "queued"
    job_id = str(body["jobId"])
    assert job_id

    status = client.get(f"/admin/voice-clone/stress/{job_id}", headers=_admin_headers("voice_admin"))
    assert status.status_code == 200
    assert status.json()["status"] == "queued"

    cancelled = client.post(f"/admin/voice-clone/stress/{job_id}/cancel", headers=_admin_headers("voice_admin"))
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"

    status_after_cancel = client.get(f"/admin/voice-clone/stress/{job_id}", headers=_admin_headers("voice_admin"))
    assert status_after_cancel.status_code == 200
    assert status_after_cancel.json()["status"] == "cancelled"


def test_voice_clone_stress_start_rejects_invalid_ramp_bounds() -> None:
    _seed_role("voice_admin", backend_app.RBAC_ROLE_SUPER_ADMIN)

    response = client.post(
        "/admin/voice-clone/stress/start",
        headers=_admin_headers("voice_admin"),
        json=_stress_payload("OPENVOICE_L4_VC", start_rpm=40, step_rpm=10, max_rpm=20),
    )
    assert response.status_code == 400
    assert "maxRpm must be greater than or equal to startRpm" in str(response.json().get("detail") or "")


def test_voice_clone_stress_v1_admin_route_aliases_work(monkeypatch: pytest.MonkeyPatch) -> None:
    _seed_role("voice_admin", backend_app.RBAC_ROLE_SUPER_ADMIN)
    monkeypatch.setattr(backend_app, "_launch_voice_clone_stress_job", lambda job_id: None)

    started = client.post(
        "/v1/admin/voice-clone/stress/start",
        headers=_admin_headers("voice_admin"),
        json=_stress_payload("OPENVOICE_L4_VC"),
    )
    assert started.status_code == 202
    body = started.json()
    assert body["ok"] is True
    job_id = str(body["jobId"])
    assert job_id

    status = client.get(f"/v1/admin/voice-clone/stress/{job_id}", headers=_admin_headers("voice_admin"))
    assert status.status_code == 200
    assert status.json()["status"] == "queued"

    cancelled = client.post(f"/v1/admin/voice-clone/stress/{job_id}/cancel", headers=_admin_headers("voice_admin"))
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"


def test_voice_clone_stress_openvoice_ramp_stops_on_failure_and_stays_no_billing(monkeypatch: pytest.MonkeyPatch) -> None:
    _seed_role("voice_admin", backend_app.RBAC_ROLE_SUPER_ADMIN)

    calls: list[dict[str, object]] = []

    class FakeOpenVoiceClient:
        def __init__(self) -> None:
            self.call_count = 0

        def health(self) -> dict[str, object]:
            return {"ok": True, "state": "online", "detail": "ready", "device": "cuda:L4", "warm": True}

        def capabilities(self) -> dict[str, object]:
            return {"ok": True, "supportsVC": True, "engine": "SEED_VC"}

        def vc(self, payload, *, timeout_sec=None):  # noqa: ANN001
            self.call_count += 1
            calls.append(dict(payload))
            if self.call_count >= 2:
                raise RuntimeError("intentional step failure")
            return {
                "ok": True,
                "status": "completed",
                "requestId": str(payload.get("requestId") or "req"),
                "traceId": str(payload.get("traceId") or "trace"),
                "mode": "vc",
                "runKind": payload.get("runKind") or "warm",
                "timings": {"vcMs": 25, "gpuSeconds": 0.025},
                "runtime": {"device": "cuda:L4", "vcProvider": "seed-vc-gpu"},
                "notes": ["mock-vc"],
            }

    def _fail_if_artifact_write(*_args, **_kwargs):
        raise AssertionError("stress runs must not write artifacts")

    def _fail_if_separation(*_args, **_kwargs):
        raise AssertionError("stress runs must not enable demucs/source extraction")

    fake_openvoice_client = FakeOpenVoiceClient()
    monkeypatch.setattr(backend_app, "_resolve_openvoice_client", lambda provider=None: (provider or "cloud_run", fake_openvoice_client))
    monkeypatch.setattr(backend_app, "save_openvoice_artifact", _fail_if_artifact_write)
    monkeypatch.setattr(backend_app, "build_openvoice_artifact_url", _fail_if_artifact_write)
    monkeypatch.setattr(backend_app, "_ensure_source_separation", _fail_if_separation)

    job_id = "vcs_openvoice_ramp"
    backend_app._VOICE_CLONE_STRESS_JOBS[job_id] = {
        "jobId": job_id,
        "benchmarkTarget": "OPENVOICE_L4_VC",
        "status": "queued",
        "config": {
            "startRpm": 2,
            "stepRpm": 2,
            "maxRpm": 4,
            "stepDurationSec": 5,
            "concurrency": 1,
            "maxFailureRate": 0.0,
            "maxP95Ms": 20_000,
            "warmupRequests": 0,
            "requestTimeoutSec": 1.0,
        },
        "progress": {"currentStep": 0, "stepsCompleted": 0, "totalSteps": 2},
        "runtimePreflight": {},
        "runtimeDeviceSamples": [],
        "steps": [],
        "summary": {},
        "createdAtMs": 0,
        "updatedAtMs": 0,
        "startedAtMs": 0,
        "finishedAtMs": 0,
        "createdAt": "",
        "updatedAt": "",
        "startedAt": "",
        "finishedAt": "",
        "_requestPayload": {
            "mode": "vc",
            "runKind": "warm",
            "durationSec": 15,
            "language": "EN",
            "text": "",
            "sourceVoiceId": "",
            "sourceVoiceName": "stress-test",
            "sourceVoiceEngine": "PRIME",
            "referenceAudioBase64": _wav_b64(duration_sec=0.2),
            "referenceAudioName": "reference.wav",
            "referenceAudioUrl": "",
            "sourceAudioBase64": _wav_b64(duration_sec=0.2),
            "sourceAudioName": "source.wav",
            "speed": 1.0,
            "regionHint": "",
            "regionSource": "admin-stress",
            "costMultiplier": 1.0,
            "uid": "voice_admin",
        },
        "_actorUid": "voice_admin",
        "_cancelRequested": False,
        "expiresAtUnix": 0,
    }

    monkeypatch.setattr(
        backend_app,
        "_voice_clone_stress_runtime_preflight",
        lambda target, provider=None: {"target": target, "provider": provider or "cloud_run", "ready": True, "detail": "", "device": "cuda:L4", "health": {}, "capabilities": {}},
    )

    backend_app._run_voice_clone_stress_job(job_id)
    row = backend_app._VOICE_CLONE_STRESS_JOBS[job_id]

    assert row["status"] == "completed"
    assert row["summary"]["stopReason"] == "threshold_breach"
    assert row["summary"]["maxSustainableRpm"] == 2.0
    assert row["summary"]["lastPassingStepIndex"] == 1
    assert row["summary"]["totalRequests"] == 2
    assert row["summary"]["totalSuccess"] == 1
    assert row["summary"]["totalFailure"] == 1
    assert row["runtimeDeviceSamples"] == ["cuda:L4"]
    assert row["providerSnapshot"] == "cloud_run"
    assert len(row["steps"]) == 2
    assert row["steps"][0]["pass"] is True
    assert row["steps"][1]["pass"] is False
    assert len(calls) == 2
    assert all(call.get("costMultiplier") == 1.0 for call in calls)
    assert all("extractSourceVocals" not in call for call in calls)
    assert all(call.get("sourceVoiceEngine") == "PRIME" for call in calls)
    assert all(call.get("sourceVoiceName") == "stress-test" for call in calls)
    assert fake_openvoice_client.call_count == 2


def test_voice_clone_stress_cancel_transitions_to_cancelled_and_halts_dispatch(monkeypatch: pytest.MonkeyPatch) -> None:
    _seed_role("voice_admin", backend_app.RBAC_ROLE_SUPER_ADMIN)

    calls: list[dict[str, object]] = []

    class FakeOpenVoiceClient:
        def health(self) -> dict[str, object]:
            return {"ok": True, "state": "online", "detail": "ready", "device": "cuda:L4", "warm": True}

        def capabilities(self) -> dict[str, object]:
            return {"ok": True, "supportsVC": True, "engine": "SEED_VC"}

        def vc(self, payload, *, timeout_sec=None):  # noqa: ANN001
            calls.append(dict(payload))
            backend_app._VOICE_CLONE_STRESS_JOBS["vcs_cancel"]["_cancelRequested"] = True
            return {
                "ok": True,
                "status": "completed",
                "requestId": str(payload.get("requestId") or "req"),
                "traceId": str(payload.get("traceId") or "trace"),
                "mode": "vc",
                "runKind": payload.get("runKind") or "warm",
                "timings": {"vcMs": 10, "gpuSeconds": 0.01},
                "runtime": {"device": "cuda:L4"},
            }

    fake_openvoice_client = FakeOpenVoiceClient()
    monkeypatch.setattr(backend_app, "_resolve_openvoice_client", lambda provider=None: (provider or "cloud_run", fake_openvoice_client))
    monkeypatch.setattr(backend_app, "_voice_clone_stress_runtime_preflight", lambda target, provider=None: {"target": target, "provider": provider or "cloud_run", "ready": True, "detail": "", "device": "cuda:L4", "health": {}, "capabilities": {}})

    job_id = "vcs_cancel"
    backend_app._VOICE_CLONE_STRESS_JOBS[job_id] = {
        "jobId": job_id,
        "benchmarkTarget": "OPENVOICE_L4_VC",
        "status": "queued",
        "config": {
            "startRpm": 60,
            "stepRpm": 60,
            "maxRpm": 60,
            "stepDurationSec": 5,
            "concurrency": 1,
            "maxFailureRate": 0.0,
            "maxP95Ms": 20_000,
            "warmupRequests": 0,
            "requestTimeoutSec": 1.0,
        },
        "progress": {"currentStep": 0, "stepsCompleted": 0, "totalSteps": 1},
        "runtimePreflight": {},
        "runtimeDeviceSamples": [],
        "steps": [],
        "summary": {},
        "createdAtMs": 0,
        "updatedAtMs": 0,
        "startedAtMs": 0,
        "finishedAtMs": 0,
        "createdAt": "",
        "updatedAt": "",
        "startedAt": "",
        "finishedAt": "",
        "_requestPayload": {
            "mode": "vc",
            "runKind": "warm",
            "durationSec": 15,
            "language": "EN",
            "text": "",
            "sourceVoiceId": "",
            "sourceVoiceName": "stress-test",
            "sourceVoiceEngine": "PRIME",
            "referenceAudioBase64": _wav_b64(duration_sec=0.2),
            "referenceAudioName": "reference.wav",
            "referenceAudioUrl": "",
            "sourceAudioBase64": _wav_b64(duration_sec=0.2),
            "sourceAudioName": "source.wav",
            "speed": 1.0,
            "regionHint": "",
            "regionSource": "admin-stress",
            "costMultiplier": 1.0,
            "uid": "voice_admin",
        },
        "_actorUid": "voice_admin",
        "_cancelRequested": False,
        "expiresAtUnix": 0,
    }

    backend_app._run_voice_clone_stress_job(job_id)
    row = backend_app._VOICE_CLONE_STRESS_JOBS[job_id]

    assert row["status"] == "cancelled"
    assert row["summary"]["stopReason"] == "cancel_requested"
    assert row["summary"]["totalRequests"] == 1
    assert row["summary"]["totalSuccess"] == 1
    assert row["summary"]["totalFailure"] == 0
    assert len(calls) == 1
    assert row["steps"][0]["pass"] is True
    assert row["providerSnapshot"] == "cloud_run"


def test_voice_clone_stress_gemini_flash_pins_prime_and_reports_throughput(monkeypatch: pytest.MonkeyPatch) -> None:
    _seed_role("voice_admin", backend_app.RBAC_ROLE_SUPER_ADMIN)

    synth_calls: list[tuple[dict[str, object], str | None]] = []

    def _fake_synth(payload_base: dict[str, object], text: str | None = None, lane_id: str | None = None):
        synth_calls.append((dict(payload_base), text))
        return {"audioBytes": b"fake", "mediaType": "audio/wav", "headers": {}, "usageTokens": 0}

    monkeypatch.setattr(backend_app, "_tts_v2_synthesize_chunk", _fake_synth)
    monkeypatch.setattr(backend_app, "_voice_clone_stress_runtime_preflight", lambda target, provider=None: {"target": target, "provider": provider or "cloud_run", "ready": True, "detail": "", "device": "gemini-runtime", "engineStatus": {}, "model": "gemini-2.5-flash"})

    job_id = "vcs_gemini"
    backend_app._VOICE_CLONE_STRESS_JOBS[job_id] = {
        "jobId": job_id,
        "benchmarkTarget": "GEMINI_FLASH_TTS",
        "status": "queued",
        "config": {
            "startRpm": 30,
            "stepRpm": 30,
            "maxRpm": 30,
            "stepDurationSec": 5,
            "concurrency": 1,
            "maxFailureRate": 0.0,
            "maxP95Ms": 20_000,
            "warmupRequests": 0,
            "requestTimeoutSec": 1.0,
        },
        "progress": {"currentStep": 0, "stepsCompleted": 0, "totalSteps": 1},
        "runtimePreflight": {},
        "runtimeDeviceSamples": [],
        "steps": [],
        "summary": {},
        "createdAtMs": 0,
        "updatedAtMs": 0,
        "startedAtMs": 0,
        "finishedAtMs": 0,
        "createdAt": "",
        "updatedAt": "",
        "startedAt": "",
        "finishedAt": "",
        "_requestPayload": {
            "text": "stress benchmark sample",
            "voiceName": "Fenrir",
        },
        "_actorUid": "voice_admin",
        "_cancelRequested": False,
        "expiresAtUnix": 0,
    }

    backend_app._run_voice_clone_stress_job(job_id)
    row = backend_app._VOICE_CLONE_STRESS_JOBS[job_id]

    assert row["status"] == "completed"
    assert row["summary"]["stopReason"] == "max_rpm_reached"
    assert row["summary"]["maxSustainableRpm"] == 30.0
    assert row["summary"]["totalRequests"] == 3
    assert row["steps"][0]["requestCount"] == 3
    assert row["steps"][0]["successCount"] == 3
    assert row["steps"][0]["errorCount"] == 0
    assert row["steps"][0]["achievedRpm"] > 0
    assert row["runtimeDeviceSamples"] == ["gemini-runtime"]

    assert len(synth_calls) == 3
    for payload_base, text in synth_calls:
        assert text == "stress benchmark sample"
        assert payload_base["engine"] == "PRIME"
        assert payload_base["model"] == "gemini-2.5-flash"
        assert payload_base["modelCandidates"] == ["gemini-2.5-flash"]
