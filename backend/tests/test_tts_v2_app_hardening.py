from __future__ import annotations

import time
from collections import deque
from io import BytesIO
import wave

from fastapi.testclient import TestClient
import pytest

import app as backend_app
from services.queue.redis_queue import WeightedInMemoryQueue


client = TestClient(backend_app.app)


@pytest.fixture(autouse=True)
def _reset_app_hardening_state() -> None:
    engine = backend_app._TTS_V2_ENGINE
    queue = getattr(engine, "_queue", None)
    with engine._jobs_lock:
        engine._jobs.clear()
        engine._request_to_job.clear()
        engine._idem_local.clear()
        engine._threads.clear()
    with engine._lane_lock:
        engine._lane_rr = deque(["L1", "L2", "L3"])
    for lane in list(getattr(engine, "_lanes", {}).values()):
        with lane.lock:
            lane.unhealthy_until_ms = 0
            lane.inflight = 0
            lane.failures = 0
            lane.starts.clear()
            lane.sem = type(lane.sem)(max(1, int(lane.max_inflight)))
    if queue is not None:
        with getattr(queue, "_lock", engine._jobs_lock):
            getattr(queue, "_jobs", {}).clear()
            getattr(queue, "_job_lanes", {}).clear()
            if hasattr(queue, "_compat_queue"):
                queue._compat_queue = WeightedInMemoryQueue(getattr(queue, "_weights", None))
    with backend_app._TTS_V2_SESSION_LOCK:
        backend_app._INMEMORY_TTS_V2_SESSIONS.clear()
        backend_app._INMEMORY_TTS_V2_ACTIVE_SESSION_BY_UID.clear()
    with backend_app._TTS_ENGINE_METRICS_LOCK:
        anomalies = backend_app._TTS_QUEUE_TELEMETRY.get("reconciliationAnomalies")
        if hasattr(anomalies, "clear"):
            anomalies.clear()
    yield


def _issue_session_key(uid: str) -> str:
    response = client.post("/tts/v2/sessions", headers={"x-dev-uid": uid})
    assert response.status_code == 201
    session_key = str(response.json().get("sessionKey") or "").strip()
    assert session_key
    return session_key


def _wav_bytes(duration_ms: int = 40, sample_rate: int = 24000) -> bytes:
    frame_count = max(1, int((sample_rate * max(1, duration_ms)) / 1000))
    out = BytesIO()
    with wave.open(out, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"\x00\x00" * frame_count)
    return out.getvalue()


def test_tts_v2_pinned_lane_unhealthy_triggers_temporary_failover(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    session_key = _issue_session_key("failover_user")
    with backend_app._TTS_V2_SESSION_LOCK:
        backend_app._INMEMORY_TTS_V2_SESSIONS[session_key] = {
            "uid": "failover_user",
            "sessionKey": session_key,
            "createdAtMs": int(time.time() * 1000),
            "expiresAtMs": int(time.time() * 1000) + 1800_000,
            "ttlSeconds": 1800,
            "pinnedVertexSlotId": "slot_1",
            "pinnedLaneId": "L1",
            "selectedRegion": "us-central1",
            "latencyMs": 4,
            "pinSource": "session-sticky",
        }
        backend_app._INMEMORY_TTS_V2_ACTIVE_SESSION_BY_UID["failover_user"] = session_key

    pinned_lane = backend_app._TTS_V2_ENGINE._lanes["L1"]
    with pinned_lane.lock:
        pinned_lane.unhealthy_until_ms = int(time.time() * 1000) + 60_000

    captured_lanes: list[str] = []

    def _capture_lane(payload, text, lane_id):
        _ = payload, text
        captured_lanes.append(str(lane_id or "").strip())
        return backend_app.TtsV2SynthChunk(audio=_wav_bytes(60), media_type="audio/wav", headers={})

    monkeypatch.setattr(backend_app, "_tts_v2_synthesize_chunk", _capture_lane)

    submit = client.post(
        "/tts/v2/jobs",
        headers={
            "x-dev-uid": "failover_user",
            "x-vf-tts-session-key": session_key,
            "Idempotency-Key": "test_failover_job_01",
        },
        json={
            "request_id": "test_failover_job_01",
            "mode": "single_speaker",
            "engine": "VECTOR",
            "text": "Pinned lane is unhealthy, so the request should fail over cleanly.",
        },
    )
    assert submit.status_code == 202

    deadline = time.time() + 8.0
    last_payload = {}
    while time.time() < deadline:
        poll = client.get(
            "/tts/v2/jobs/test_failover_job_01",
            headers={"x-dev-uid": "failover_user"},
        )
        assert poll.status_code == 200
        last_payload = poll.json()
        if str(last_payload.get("status") or "").lower() == "completed":
            break
        time.sleep(0.05)

    assert str(last_payload.get("status") or "").lower() == "completed"
    assert captured_lanes
    assert captured_lanes[0] != "L1"


def test_tts_v2_status_forces_chunk_audio_off_for_non_admin(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        backend_app._TTS_V2_ENGINE,
        "get_job",
        lambda *, uid, is_admin, job_id: {
            "jobId": job_id,
            "requestId": job_id,
            "uid": uid,
            "status": "completed",
            "engine": "VECTOR",
        },
    )

    def _status_payload(**kwargs):
        captured["include_chunk_audio"] = kwargs.get("include_chunk_audio")
        return {
            "ok": True,
            "jobId": str((kwargs.get("job") or {}).get("jobId") or ""),
            "requestId": str((kwargs.get("job") or {}).get("requestId") or ""),
            "status": "completed",
        }

    monkeypatch.setattr(backend_app._TTS_V2_ENGINE, "status_payload", _status_payload)

    response = client.get(
        "/tts/v2/jobs/chunk_audio_user",
        headers={"x-dev-uid": "chunk_audio_user"},
        params={"includeChunkAudio": True},
    )
    assert response.status_code == 200
    assert captured["include_chunk_audio"] is False


def test_production_boot_guard_rejects_dev_auth_flags(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_IS_PRODUCTION", True)
    monkeypatch.setattr(backend_app, "VF_DEV_UID_HEADER_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_ENABLE_DEV_ADMIN_LOGIN", False)
    monkeypatch.setattr(backend_app, "_razorpay_webhook_secret", lambda: "whsec_live")

    with pytest.raises(RuntimeError):
        backend_app._assert_production_bootstrap_secrets()


def test_production_boot_guard_rejects_missing_webhook_secret(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_IS_PRODUCTION", True)
    monkeypatch.setattr(backend_app, "VF_DEV_UID_HEADER_ENABLED", False)
    monkeypatch.setattr(backend_app, "VF_ENABLE_DEV_ADMIN_LOGIN", False)
    monkeypatch.setattr(backend_app, "_razorpay_webhook_secret", lambda: "")

    with pytest.raises(RuntimeError):
        backend_app._assert_production_bootstrap_secrets()
