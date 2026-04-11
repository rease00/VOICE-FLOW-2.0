from __future__ import annotations

import fnmatch
import time
import threading

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import app as backend_app


client = TestClient(backend_app.app)


def _reset_voice_clone_jobs() -> None:
    with backend_app._VOICE_CLONE_JOB_LOCK:
        backend_app._VOICE_CLONE_JOBS.clear()
        backend_app._VOICE_CLONE_JOB_REQUEST_INDEX.clear()


@pytest.fixture(autouse=True)
def _voice_clone_job_isolation(monkeypatch: pytest.MonkeyPatch):
    _reset_voice_clone_jobs()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_USER_ID_REQUIRED", False)
    monkeypatch.setattr(backend_app, "_firebase_ready", lambda: False)
    monkeypatch.setattr(backend_app, "_require_request_uid", lambda request: "test_uid")
    monkeypatch.setattr(backend_app, "_request_is_admin", lambda request, uid=None: True)
    yield
    _reset_voice_clone_jobs()


class _FakeRedis:
    def __init__(self) -> None:
        self.strings: dict[str, str] = {}

    def get(self, key):  # noqa: ANN001
        return self.strings.get(str(key))

    def set(self, key, value, ex=None, nx=False):  # noqa: ANN001
        safe_key = str(key)
        if nx and safe_key in self.strings:
            return False
        self.strings[safe_key] = str(value)
        _ = ex
        return True

    def delete(self, *keys):  # noqa: ANN001
        removed = 0
        for key in keys:
            removed += int(self.strings.pop(str(key), None) is not None)
        return removed

    def scan_iter(self, match=None, count=None):  # noqa: ANN001
        _ = count
        pattern = str(match or "*")
        for key in list(self.strings.keys()):
            if fnmatch.fnmatch(str(key), pattern):
                yield key


def _run_jobs_inline(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(backend_app, "_launch_voice_clone_job", lambda job_id: backend_app._run_voice_clone_job(job_id))


def test_openvoice_async_job_is_deduped_and_hides_audio_base64(monkeypatch: pytest.MonkeyPatch) -> None:
    _run_jobs_inline(monkeypatch)

    def _fake_openvoice_payload(payload, *, request=None, uid="", is_admin=False):  # noqa: ANN001
        _ = request
        assert uid == "test_uid"
        assert is_admin is True
        return {
            "ok": True,
            "status": "completed",
            "requestId": str(payload.requestId or ""),
            "traceId": str(payload.traceId or ""),
            "artifact": {
                "downloadUrl": "/artifacts/voice-clone.wav",
                "contentType": "audio/wav",
            },
            "clonedVoice": {
                "id": "clone_req_async_openvoice_001",
                "previewUrl": "/artifacts/voice-clone.wav",
            },
            "audioBase64": "UklGRg==",
        }

    monkeypatch.setattr(backend_app, "_openvoice_benchmark_payload", _fake_openvoice_payload)

    payload = {
        "durationSec": 1,
        "language": "EN",
        "text": "",
        "sourceVoiceId": "",
        "sourceVoiceName": "Voice cloning tab",
        "sourceVoiceEngine": "",
        "referenceAudioBase64": "dGVzdA==",
        "referenceAudioName": "reference.wav",
        "referenceAudioUrl": "",
        "sourceAudioBase64": "dGVzdA==",
        "sourceAudioName": "source.wav",
        "extractSourceVocals": True,
        "sourceSeparationModel": "htdemucs_ft",
        "sourceSeparationDevice": "cpu_only",
        "speed": 1,
        "requestId": "req_async_openvoice_001",
        "traceId": "req_async_openvoice_001",
        "regionHint": "",
        "regionSource": "frontend",
        "costMultiplier": 1,
    }

    started = client.post("/voice-clone/jobs/render", json=payload)
    assert started.status_code == 202
    started_body = started.json()
    assert started_body["ok"] is True
    assert started_body["status"] == "queued"
    job_id = str(started_body["jobId"] or "").strip()
    assert job_id

    status = client.get(f"/voice-clone/jobs/by-request/{payload['requestId']}")
    assert status.status_code == 200
    status_body = status.json()
    assert status_body["jobId"] == job_id
    assert status_body["kind"] == "voice_clone"
    assert status_body["status"] == "completed"
    assert status_body["result"]["artifact"]["downloadUrl"] == "/artifacts/voice-clone.wav"
    assert "audioBase64" not in status_body["result"]

    repeated = client.post("/voice-clone/jobs/render", json=payload)
    assert repeated.status_code == 200
    repeated_body = repeated.json()
    assert repeated_body["jobId"] == job_id
    assert repeated_body["status"] == "completed"
    assert "audioBase64" not in repeated_body["result"]


def test_openvoice_async_job_registry_survives_restart_and_dedupes_via_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_redis = _FakeRedis()
    monkeypatch.setattr(backend_app, "_tts_v2_session_redis_client", lambda: fake_redis)
    _run_jobs_inline(monkeypatch)

    def _fake_openvoice_payload(payload, *, request=None, uid="", is_admin=False):  # noqa: ANN001
        _ = request
        assert uid == "test_uid"
        assert is_admin is True
        return {
            "ok": True,
            "status": "completed",
            "requestId": str(payload.requestId or ""),
            "traceId": str(payload.traceId or ""),
            "artifact": {
                "downloadUrl": "/artifacts/voice-clone-durable.wav",
                "contentType": "audio/wav",
            },
            "clonedVoice": {
                "id": "clone_req_async_openvoice_durable",
                "previewUrl": "/artifacts/voice-clone-durable.wav",
            },
            "audioBase64": "UklGRg==",
        }

    monkeypatch.setattr(backend_app, "_openvoice_benchmark_payload", _fake_openvoice_payload)

    payload = {
        "durationSec": 1,
        "language": "EN",
        "text": "",
        "sourceVoiceId": "",
        "sourceVoiceName": "Voice cloning tab",
        "sourceVoiceEngine": "",
        "referenceAudioBase64": "dGVzdA==",
        "referenceAudioName": "reference.wav",
        "referenceAudioUrl": "",
        "sourceAudioBase64": "dGVzdA==",
        "sourceAudioName": "source.wav",
        "extractSourceVocals": True,
        "sourceSeparationModel": "htdemucs_ft",
        "sourceSeparationDevice": "cpu_only",
        "speed": 1,
        "requestId": "req_async_openvoice_durable_001",
        "traceId": "req_async_openvoice_durable_001",
        "regionHint": "",
        "regionSource": "frontend",
        "costMultiplier": 1,
    }

    first = client.post("/voice-clone/jobs/render", json=payload)
    assert first.status_code == 202
    first_body = first.json()
    job_id = str(first_body.get("jobId") or "").strip()
    assert job_id

    status = client.get(f"/voice-clone/jobs/by-request/{payload['requestId']}")
    assert status.status_code == 200
    assert status.json()["jobId"] == job_id
    assert status.json()["status"] == "completed"
    assert "audioBase64" not in status.json()["result"]

    _reset_voice_clone_jobs()

    repeated = client.post("/voice-clone/jobs/render", json=payload)
    assert repeated.status_code == 200
    repeated_body = repeated.json()
    assert repeated_body["jobId"] == job_id
    assert repeated_body["status"] == "completed"
    assert "audioBase64" not in repeated_body["result"]

    by_request = client.get(f"/voice-clone/jobs/by-request/{payload['requestId']}")
    assert by_request.status_code == 200
    by_request_body = by_request.json()
    assert by_request_body["jobId"] == job_id
    assert by_request_body["status"] == "completed"


def test_voice_clone_cancel_endpoint_wins_over_inflight_success(monkeypatch: pytest.MonkeyPatch) -> None:
    started_event = threading.Event()
    release = threading.Event()

    def _slow_success(payload, *, request=None, uid="", is_admin=False):  # noqa: ANN001
        _ = payload, request
        assert uid == "test_uid"
        assert is_admin is True
        started_event.set()
        release.wait(timeout=2.0)
        return {
            "ok": True,
            "status": "completed",
            "artifact": {"downloadUrl": "/artifacts/voice-clone.wav", "contentType": "audio/wav"},
            "clonedVoice": {"id": "clone_cancel_race", "previewUrl": "/artifacts/voice-clone.wav"},
            "audioBase64": "UklGRg==",
        }

    monkeypatch.setattr(backend_app, "_openvoice_benchmark_payload", _slow_success)

    payload = {
        "durationSec": 1,
        "language": "EN",
        "sourceVoiceName": "Voice cloning tab",
        "referenceAudioBase64": "dGVzdA==",
        "referenceAudioName": "reference.wav",
        "sourceAudioBase64": "dGVzdA==",
        "sourceAudioName": "source.wav",
        "extractSourceVocals": True,
        "sourceSeparationModel": "htdemucs_ft",
        "sourceSeparationDevice": "cpu_only",
        "speed": 1,
        "requestId": "req_cancel_race_001",
        "traceId": "req_cancel_race_001",
    }
    started = client.post("/voice-clone/jobs/render", json=payload)
    assert started.status_code == 202
    job_id = str(started.json().get("jobId") or "").strip()
    assert job_id
    assert started_event.wait(timeout=2.0), "Expected voice-clone worker to start before cancel."

    cancel = client.post(f"/voice-clone/jobs/{job_id}/cancel")
    assert cancel.status_code in {200, 202}
    release.set()

    deadline = time.time() + 4.0
    final = {}
    while time.time() < deadline:
        status = client.get(f"/voice-clone/jobs/{job_id}")
        assert status.status_code in {200, 202}
        final = status.json()
        if str(final.get("status") or "").lower() in {"cancelled", "completed", "failed"}:
            if status.status_code == 200:
                break
        time.sleep(0.05)

    assert str(final.get("status") or "").lower() == "cancelled"
    assert dict(final.get("result") or {}) == {}
    error = dict(final.get("error") or {})
    assert str(error.get("detail") or error.get("message") or "").strip()
    assert int(final.get("finishedAtMs") or 0) > 0
    assert str(final.get("finishedAt") or "").strip()
