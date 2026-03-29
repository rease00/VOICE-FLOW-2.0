from __future__ import annotations

import time
import uuid

from fastapi.testclient import TestClient
import pytest

import app as backend_app
from services.queue.redis_queue import WeightedInMemoryQueue


client = TestClient(backend_app.app)


@pytest.fixture(autouse=True)
def _reset_refresh_billing_state(monkeypatch: pytest.MonkeyPatch):
    queue = backend_app._TTS_JOB_QUEUE
    original_redis = getattr(queue, "_redis", None)
    setattr(queue, "_redis", None)
    with getattr(queue, "_lock", backend_app._INMEMORY_LOCK):
        if hasattr(queue, "_jobs"):
            queue._jobs.clear()
        if hasattr(queue, "_job_lanes"):
            queue._job_lanes.clear()
        if hasattr(queue, "_compat_queue"):
            queue._compat_queue = WeightedInMemoryQueue(getattr(queue, "_weights", None))

    with backend_app._INMEMORY_LOCK:
        backend_app._INMEMORY_ENTITLEMENTS.clear()
        backend_app._INMEMORY_USAGE_MONTHLY.clear()
        backend_app._INMEMORY_USAGE_DAILY.clear()
        backend_app._INMEMORY_USAGE_EVENTS.clear()

    monkeypatch.setattr(backend_app, "_firestore_collection", lambda _name: None)
    yield
    setattr(queue, "_redis", original_redis)


def test_usage_settlement_prorates_partial_processed_chars() -> None:
    uid = "settle_partial_user"
    request_id = "settle_partial_req_01"
    backend_app._reserve_usage(uid, request_id, "PRIME", 100)
    settlement = backend_app._finalize_usage(
        uid,
        request_id,
        success=False,
        error_detail="cancelled_abandoned",
        processed_chars=25,
        terminal_reason="cancelled_abandoned",
    )
    event = backend_app._INMEMORY_USAGE_EVENTS.get(f"{uid}_{request_id}") or {}
    assert settlement.get("billedChars") == 25
    assert float(settlement.get("billedVfCost") or 0.0) > 0.0
    assert float(settlement.get("refundedVfCost") or 0.0) > 0.0
    assert settlement.get("settlementKind") == "partial"
    assert event.get("status") == "committed"
    assert int(event.get("processedChars") or 0) == 25
    assert str(event.get("terminalReason") or "") == "cancelled_abandoned"


def test_refresh_replay_same_request_id_keeps_single_usage_reservation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(
        backend_app,
        "_tts_v2_synthesize_chunk",
        lambda payload, text, lane_id: backend_app.TtsV2SynthChunk(audio=b"RIFF" + (b"\x00" * 256), media_type="audio/wav", headers={}),
    )

    uid = "refresh_replay_user"
    request_id = f"refresh_replay_{uuid.uuid4().hex[:16]}"
    session = client.post("/tts/v2/sessions", headers={"x-dev-uid": uid})
    assert session.status_code == 201
    session_key = str(session.json().get("sessionKey") or "").strip()
    assert session_key

    payload = {
        "request_id": request_id,
        "mode": "single_speaker",
        "engine": "VECTOR",
        "text": "Refresh replay should not reserve usage twice for the same request id.",
    }
    headers = {
        "x-dev-uid": uid,
        "x-vf-tts-session-key": session_key,
        "Idempotency-Key": request_id,
    }
    first = client.post("/tts/v2/jobs", headers=headers, json=payload)
    second = client.post("/tts/v2/jobs", headers=headers, json=payload)
    assert first.status_code in {200, 202}
    assert second.status_code in {200, 202}
    assert str(first.json().get("jobId") or "") == request_id
    assert str(second.json().get("jobId") or "") == request_id

    deadline = time.time() + 6.0
    terminal_payload: dict[str, object] = {}
    while time.time() < deadline:
        poll = client.get(f"/tts/v2/jobs/{request_id}", headers={"x-dev-uid": uid})
        assert poll.status_code == 200
        terminal_payload = poll.json()
        if str(terminal_payload.get("status") or "").strip().lower() in {"completed", "cancelled", "failed"}:
            break
        time.sleep(0.05)

    assert str(terminal_payload.get("status") or "").strip().lower() == "completed"
    event = backend_app._INMEMORY_USAGE_EVENTS.get(f"{uid}_{request_id}") or {}
    assert event
    assert str(event.get("status") or "").strip().lower() == "committed"
    assert int(event.get("billedChars") or 0) > 0
    assert len([k for k in backend_app._INMEMORY_USAGE_EVENTS.keys() if str(k).startswith(f"{uid}_{request_id}")]) == 1


def test_usage_settlement_zero_processed_reverts_generation_count() -> None:
    uid = "settle_zero_user"
    request_id = "settle_zero_req_01"
    reservation = backend_app._reserve_usage(uid, request_id, "PRIME", 120)
    month_doc_id = str(((reservation.get("event") or {}).get("monthDocId")) or "")
    assert month_doc_id
    monthly_before = backend_app._INMEMORY_USAGE_MONTHLY.get(month_doc_id) or {}
    assert int(monthly_before.get("generationCount") or 0) == 1

    settlement = backend_app._finalize_usage(
        uid,
        request_id,
        success=False,
        error_detail="cancelled_abandoned",
        processed_chars=0,
        terminal_reason="cancelled_abandoned",
    )
    event = backend_app._INMEMORY_USAGE_EVENTS.get(f"{uid}_{request_id}") or {}
    monthly_after = backend_app._INMEMORY_USAGE_MONTHLY.get(month_doc_id) or {}
    assert settlement.get("billedChars") == 0
    assert float(settlement.get("billedVfCost") or 0.0) == 0.0
    assert event.get("status") == "reverted"
    assert int(monthly_after.get("generationCount") or 0) == 0


def test_mark_job_cancelled_abandoned_updates_queue_and_usage() -> None:
    uid = "abandon_user"
    request_id = "abandon_req_01"
    now_ms = int(time.time() * 1000)
    queued = backend_app._TTS_JOB_QUEUE.submit(
        lane="free",
        payload={
            "jobId": request_id,
            "requestId": request_id,
            "uid": uid,
            "engine": "PRIME",
            "status": "running",
            "createdAtMs": now_ms,
            "updatedAtMs": now_ms,
            "liveState": {
                "enabled": True,
                "chunks": [{"index": 0, "textChars": 10}],
                "playableChunks": 1,
                "playableDurationMs": 1200,
                "chunkCursorNext": 1,
            },
        },
    )
    assert str(queued.get("jobId") or "") == request_id
    backend_app._reserve_usage(uid, request_id, "PRIME", 100)

    backend_app._mark_job_cancelled_abandoned(
        job_id=request_id,
        uid=uid,
        request_id=request_id,
        engine="PRIME",
        trace_id=request_id,
        processed_chars=10,
    )
    job = backend_app._TTS_JOB_QUEUE.get(request_id) or {}
    event = backend_app._INMEMORY_USAGE_EVENTS.get(f"{uid}_{request_id}") or {}
    billing = job.get("billing") if isinstance(job.get("billing"), dict) else {}
    assert str(job.get("status") or "") == "cancelled"
    assert str(job.get("statusReason") or "") == "cancelled_abandoned"
    assert int(billing.get("billedChars") or 0) == 10
    assert str(event.get("terminalReason") or "") == "cancelled_abandoned"
    assert int(event.get("billedChars") or 0) == 10


def test_process_worker_marks_cancelled_abandoned_when_lease_expired() -> None:
    uid = "abandon_worker_user"
    request_id = "abandon_worker_req_01"
    now_ms = int(time.time() * 1000)
    backend_app._TTS_JOB_QUEUE.submit(
        lane="free",
        payload={
            "jobId": request_id,
            "requestId": request_id,
            "traceId": request_id,
            "uid": uid,
            "engine": "VECTOR",
            "status": "queued",
            "createdAtMs": now_ms - 100_000,
            "updatedAtMs": now_ms - 95_000,
            "lastClientSeenAtMs": now_ms - 95_000,
            "disconnectGraceMs": 90_000,
            "leaseExpiresAtMs": now_ms - 5_000,
            "liveState": {
                "enabled": True,
                "chunks": [{"index": 0, "textChars": 14}],
                "playableChunks": 1,
                "playableDurationMs": 1000,
                "chunkCursorNext": 1,
            },
        },
    )
    backend_app._reserve_usage(uid, request_id, "VECTOR", 100)

    record = backend_app._TTS_JOB_QUEUE.reserve_next(worker_id="lease-expired-worker")
    assert isinstance(record, dict)
    backend_app._process_tts_job(record, worker_id="lease-expired-worker")

    job = backend_app._TTS_JOB_QUEUE.get(request_id) or {}
    event = backend_app._INMEMORY_USAGE_EVENTS.get(f"{uid}_{request_id}") or {}
    assert str(job.get("status") or "") == "cancelled"
    assert str(job.get("statusReason") or "") == "cancelled_abandoned"
    assert str(event.get("terminalReason") or "") == "cancelled_abandoned"
    assert int(event.get("billedChars") or 0) == 14


def test_usage_events_settlement_migration_dry_run_and_apply(monkeypatch: pytest.MonkeyPatch) -> None:
    backend_app._INMEMORY_USAGE_EVENTS["legacy_u_legacy_req"] = {
        "uid": "legacy_u",
        "requestId": "legacy_req",
        "status": "committed",
        "engine": "PRIME",
        "chars": 80,
        "vfCost": 4.0,
        "chargeBreakdown": {"vff": 4.0, "monthlyVf": 0.0, "paidVf": 0.0, "paidVfLots": []},
        "updatedAt": "2026-03-01T00:00:00+00:00",
    }
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(
        backend_app,
        "_require_permission",
        lambda request, perm: ("admin_test", {"role": "super_admin"}),
    )
    monkeypatch.setattr(
        backend_app,
        "_require_admin_mutation_unlock",
        lambda request, expected_uid=None: "unlock",
    )
    monkeypatch.setattr(backend_app, "_audit_append_event", lambda **kwargs: None)

    dry_run_response = client.post(
        "/admin/billing/usage-events/settlement-migration",
        headers={"x-dev-uid": "admin_test"},
        json={"dryRun": True, "limit": 100},
    )
    assert dry_run_response.status_code == 200
    dry_payload = dry_run_response.json()
    assert bool(dry_payload.get("dryRun")) is True
    assert int(dry_payload.get("eventsBackfilled") or 0) >= 1
    legacy_after_dry = backend_app._INMEMORY_USAGE_EVENTS.get("legacy_u_legacy_req") or {}
    assert "reservedChars" not in legacy_after_dry

    apply_response = client.post(
        "/admin/billing/usage-events/settlement-migration",
        headers={"x-dev-uid": "admin_test"},
        json={"dryRun": False, "limit": 100},
    )
    assert apply_response.status_code == 200
    applied = backend_app._INMEMORY_USAGE_EVENTS.get("legacy_u_legacy_req") or {}
    assert int(applied.get("reservedChars") or 0) == 80
    assert str(applied.get("settlementKind") or "") in {"full", "partial", "none", "pending"}

    second_apply_response = client.post(
        "/admin/billing/usage-events/settlement-migration",
        headers={"x-dev-uid": "admin_test"},
        json={"dryRun": False, "limit": 100},
    )
    assert second_apply_response.status_code == 200
    second_payload = second_apply_response.json()
    assert int(second_payload.get("eventsBackfilled") or 0) == 0
    assert int(second_payload.get("eventsUnchanged") or 0) >= 1


def test_tts_job_status_payload_exposes_lease_and_settlement_fields() -> None:
    now_ms = int(time.time() * 1000)
    payload = backend_app._tts_job_status_payload(
        {
            "jobId": "lease_job_01",
            "requestId": "lease_job_01",
            "traceId": "lease_job_01",
            "status": "running",
            "statusReason": "client_poll",
            "engine": "PRIME",
            "lane": "free",
            "createdAtMs": now_ms - 1000,
            "updatedAtMs": now_ms,
            "leaseExpiresAtMs": now_ms + 90_000,
            "disconnectGraceMs": 90_000,
            "lastClientSeenAtMs": now_ms,
            "reservedChars": 100,
            "reservedVfCost": 5.0,
            "processedChars": 20,
            "billedChars": 20,
            "billedVfCost": 1.0,
            "refundedVfCost": 4.0,
            "settlementKind": "partial",
            "terminalReason": "cancelled_abandoned",
        },
        include_chunks=False,
        include_result=False,
        include_chunk_audio=False,
    )
    assert str(payload.get("statusReason") or "") == "client_poll"
    assert int(payload.get("leaseExpiresAtMs") or 0) > now_ms
    assert int(payload.get("disconnectGraceMs") or 0) == 90_000
    assert int(payload.get("billedChars") or 0) == 20
    assert float(payload.get("billedVfCost") or 0.0) == 1.0
    billing = payload.get("billing") if isinstance(payload.get("billing"), dict) else {}
    assert int(billing.get("processedChars") or 0) == 20
    assert str(billing.get("settlementKind") or "") == "partial"
