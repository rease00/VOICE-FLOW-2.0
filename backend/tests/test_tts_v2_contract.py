from __future__ import annotations

import json
from collections import deque
import time
import uuid
import wave
from io import BytesIO

from fastapi.testclient import TestClient
import pytest
import requests

import app as backend_app
from services.queue.redis_queue import WeightedInMemoryQueue


client = TestClient(backend_app.app)


@pytest.fixture(autouse=True)
def _reset_tts_engine_state() -> None:
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


def _wav_bytes(duration_ms: int = 40, sample_rate: int = 24000) -> bytes:
    frame_count = max(1, int((sample_rate * max(1, duration_ms)) / 1000))
    out = BytesIO()
    with wave.open(out, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"\x00\x00" * frame_count)
    return out.getvalue()


def _issue_session_key(uid: str) -> str:
    response = client.post("/tts/v2/sessions", headers={"x-dev-uid": uid})
    assert response.status_code == 201
    session_key = str(response.json().get("sessionKey") or "").strip()
    assert session_key
    return session_key


def _dev_headers(uid: str, *, include_session: bool = True, request_id: str | None = None) -> dict[str, str]:
    headers = {"x-dev-uid": uid}
    if include_session:
        headers["x-vf-tts-session-key"] = _issue_session_key(uid)
    if request_id:
        headers["Idempotency-Key"] = str(request_id)
    return headers


def _make_probe_response() -> requests.Response:
    response = requests.Response()
    response.status_code = 200
    response._content = b"{}"  # type: ignore[attr-defined]
    response.headers = requests.structures.CaseInsensitiveDict({"content-type": "application/json"})
    response.url = "http://example.test/health"
    return response


def _slot_probe_json(payload: dict[str, object]) -> str:
    source_policy = payload.get("sourcePolicy") if isinstance(payload.get("sourcePolicy"), dict) else {}
    if isinstance(source_policy, dict):
        selected_slot = str(source_policy.get("selectedVertexSlotId") or "").strip()
        if selected_slot:
            return selected_slot
    pool_hint = str(payload.get("poolHint") or "").strip()
    if pool_hint:
        return pool_hint
    return str(payload.get("_probeSlotId") or "").strip()


def _slot_probe_headers(headers: dict[str, object]) -> str:
    safe_headers = headers if isinstance(headers, dict) else {}
    slot_id = str(safe_headers.get("x-vf-slot-id") or "").strip().lower()
    if slot_id:
        return slot_id
    lane_id = str(safe_headers.get("x-vf-lane-id") or "").strip().upper()
    if lane_id == "L1":
        return "slot_1"
    if lane_id == "L2":
        return "slot_2"
    if lane_id == "L3":
        return "slot_3"
    return ""


def test_tts_v2_job_create_requires_request_id(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    response = client.post(
        "/tts/v2/jobs",
        headers=_dev_headers("v2_reqid_missing"),
        json={"mode": "single_speaker", "engine": "VECTOR", "text": "hello"},
    )
    assert response.status_code == 400


def test_tts_v2_job_create_requires_session_key(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    request_id = f"test_{uuid.uuid4().hex}"
    response = client.post(
        "/tts/v2/jobs",
        headers=_dev_headers("v2_missing_session", include_session=False, request_id=request_id),
        json={
            "request_id": request_id,
            "mode": "single_speaker",
            "engine": "VECTOR",
            "text": "hello",
        },
    )
    assert response.status_code == 401
    detail = str(response.json().get("detail") or "").lower()
    assert "x-vf-tts-session-key" in detail


def test_tts_v2_job_create_rejects_invalid_session_key(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    request_id = f"test_{uuid.uuid4().hex}"
    response = client.post(
        "/tts/v2/jobs",
        headers={
            "x-dev-uid": "v2_invalid_session",
            "x-vf-tts-session-key": f"invalid_{uuid.uuid4().hex}",
            "Idempotency-Key": request_id,
        },
        json={
            "request_id": request_id,
            "mode": "single_speaker",
            "engine": "VECTOR",
            "text": "hello",
        },
    )
    assert response.status_code == 401
    assert "invalid or expired tts session key" in str(response.json().get("detail") or "").lower()


def test_tts_v2_job_create_rejects_expired_session_key(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    uid = "v2_expired_session"
    session_key = _issue_session_key(uid)
    request_id = f"test_{uuid.uuid4().hex}"
    with backend_app._TTS_V2_SESSION_LOCK:
        row = dict(backend_app._INMEMORY_TTS_V2_SESSIONS.get(session_key) or {})
        row["expiresAtMs"] = int(time.time() * 1000) - 1
        backend_app._INMEMORY_TTS_V2_SESSIONS[session_key] = row
        backend_app._INMEMORY_TTS_V2_ACTIVE_SESSION_BY_UID[uid] = session_key
    response = client.post(
        "/tts/v2/jobs",
        headers={
            "x-dev-uid": uid,
            "x-vf-tts-session-key": session_key,
            "Idempotency-Key": request_id,
        },
        json={
            "request_id": request_id,
            "mode": "single_speaker",
            "engine": "VECTOR",
            "text": "hello",
        },
    )
    assert response.status_code == 401
    assert "expired" in str(response.json().get("detail") or "").lower()


def test_tts_v2_job_create_rejects_session_ownership_mismatch(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    owner_uid = "v2_session_owner"
    other_uid = "v2_session_other"
    session_key = _issue_session_key(owner_uid)
    request_id = f"test_{uuid.uuid4().hex}"
    with backend_app._TTS_V2_SESSION_LOCK:
        backend_app._INMEMORY_TTS_V2_ACTIVE_SESSION_BY_UID[other_uid] = session_key
    response = client.post(
        "/tts/v2/jobs",
        headers={
            "x-dev-uid": other_uid,
            "x-vf-tts-session-key": session_key,
            "Idempotency-Key": request_id,
        },
        json={
            "request_id": request_id,
            "mode": "single_speaker",
            "engine": "VECTOR",
            "text": "hello",
        },
    )
    assert response.status_code == 403
    assert "ownership mismatch" in str(response.json().get("detail") or "").lower()


def test_tts_v2_session_key_ttl_defaults_to_30_minutes(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    response = client.post("/tts/v2/sessions", headers={"x-dev-uid": "v2_session_ttl"})
    assert response.status_code == 201
    payload = response.json()
    assert int(payload.get("ttlSeconds") or 0) == 1800
    created_at = int(payload.get("createdAtMs") or 0)
    expires_at = int(payload.get("expiresAtMs") or 0)
    delta_ms = expires_at - created_at
    assert 1_790_000 <= delta_ms <= 1_800_000


def test_tts_v2_session_probe_selects_lowest_rtt_and_tie_breaks_by_slot_id(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_tts_v2_session_redis_client", lambda: None)

    pools_config = {
        "sourcePolicy": {
            "provider": "vertex",
            "vertexAccounts": [
                {"memberId": "slot_2", "vertexLocation": "europe-west1"},
                {"memberId": "slot_1", "vertexLocation": "us-central1"},
                {"memberId": "slot_3", "vertexLocation": "asia-south1"},
            ],
        }
    }
    probe_calls: list[str] = []
    probe_urls: list[str] = []
    probe_latency_ms = {"slot_1": 10, "slot_2": 10, "slot_3": 18}

    def _fake_load_gemini_api_pools():
        return pools_config, {}

    def _fake_probe(*args, **kwargs):
        _ = kwargs
        url = str(args[1] if len(args) > 1 else "")
        probe_urls.append(url)
        headers = dict(kwargs.get("headers") or {})
        slot_id = _slot_probe_headers(headers)
        probe_calls.append(slot_id)
        time.sleep(probe_latency_ms.get(slot_id, 1) / 1000.0)
        return _make_probe_response()

    monkeypatch.setattr(backend_app, "_load_gemini_api_pools", _fake_load_gemini_api_pools)
    monkeypatch.setattr(backend_app, "_runtime_http_request", _fake_probe)

    response = client.post(
        "/tts/v2/sessions",
        headers={"x-dev-uid": "session_probe_user"},
        json={"probeAllSlotRegions": True},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["selectedRegion"] == "us-central1"
    assert payload["pinnedVertexSlotId"] == "slot_1"
    assert payload["pinnedLaneId"] == "L1"
    assert int(payload["latencyMs"]) >= 0
    assert str(payload["pinSource"] or "").strip()
    assert set(probe_calls) == {"slot_1", "slot_2", "slot_3"}
    assert probe_urls and all(
        "googleapis.com" in url and "texttospeech.googleapis.com" in url and url.endswith("/v1/voices")
        for url in probe_urls
    )

    session_key = str(payload.get("sessionKey") or "").strip()
    with backend_app._TTS_V2_SESSION_LOCK:
        row = dict(backend_app._INMEMORY_TTS_V2_SESSIONS.get(session_key) or {})
    assert row["pinnedVertexSlotId"] == "slot_1"
    assert row["pinnedLaneId"] == "L1"
    assert row["selectedRegion"] == "us-central1"
    assert int(row["latencyMs"]) == 10
    assert str(row["pinSource"] or "").strip()


def test_tts_v2_session_does_not_probe_slots_by_default(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_tts_v2_session_redis_client", lambda: None)
    pools_config = {
        "sourcePolicy": {
            "provider": "vertex",
            "vertexAccounts": [
                {"memberId": "slot_1", "vertexLocation": "us-central1"},
                {"memberId": "slot_2", "vertexLocation": "europe-west1"},
            ],
        }
    }
    probe_calls: list[str] = []
    probe_urls: list[str] = []

    def _fake_load_gemini_api_pools():
        return pools_config, {}

    def _fake_probe(*args, **kwargs):
        _ = kwargs
        url = str(args[1] if len(args) > 1 else "")
        probe_urls.append(url)
        probe_calls.append("called")
        return _make_probe_response()

    monkeypatch.setattr(backend_app, "_load_gemini_api_pools", _fake_load_gemini_api_pools)
    monkeypatch.setattr(backend_app, "_runtime_http_request", _fake_probe)

    response = client.post(
        "/tts/v2/sessions",
        headers={"x-dev-uid": "session_probe_default_off_user"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert not str(payload.get("pinnedVertexSlotId") or "").strip()
    assert not str(payload.get("selectedRegion") or "").strip()
    assert not probe_calls
    assert not probe_urls


def test_tts_v2_session_metadata_round_trips_via_redis_stub(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    pools_config = {
        "sourcePolicy": {
            "provider": "vertex",
            "vertexAccounts": [
                {"memberId": "slot_1", "vertexLocation": "us-central1"},
                {"memberId": "slot_2", "vertexLocation": "europe-west1"},
            ],
        }
    }

    class _FakeRedis:
        def __init__(self) -> None:
            self.store: dict[str, str] = {}

        def get(self, key: str):
            return self.store.get(key)

        def set(self, key: str, value: str, ex: int | None = None):
            _ = ex
            self.store[key] = value
            return True

        def delete(self, key: str):
            self.store.pop(key, None)
            return 1

        def pipeline(self, transaction: bool = True):
            _ = transaction
            return self

        def execute(self):
            return []

    fake_redis = _FakeRedis()
    probe_calls: list[str] = []
    probe_urls: list[str] = []

    def _fake_load_gemini_api_pools():
        return pools_config, {}

    def _fake_probe(*args, **kwargs):
        _ = kwargs
        url = str(args[1] if len(args) > 1 else "")
        probe_urls.append(url)
        headers = dict(kwargs.get("headers") or {})
        slot_id = _slot_probe_headers(headers)
        probe_calls.append(slot_id)
        return _make_probe_response()

    monkeypatch.setattr(backend_app, "_load_gemini_api_pools", _fake_load_gemini_api_pools)
    monkeypatch.setattr(backend_app, "_runtime_http_request", _fake_probe)
    monkeypatch.setattr(backend_app, "_tts_v2_session_redis_client", lambda: fake_redis)

    session_response = client.post(
        "/tts/v2/sessions",
        headers={"x-dev-uid": "session_redis_user"},
        json={"probeAllSlotRegions": True},
    )
    assert session_response.status_code == 201
    session_payload = session_response.json()
    session_key = str(session_payload.get("sessionKey") or "").strip()
    assert session_key
    assert set(probe_calls) == {"slot_1", "slot_2"}
    assert probe_urls and all(
        "googleapis.com" in url and "texttospeech.googleapis.com" in url and url.endswith("/v1/voices")
        for url in probe_urls
    )

    uid_key = backend_app._tts_v2_session_uid_key("session_redis_user")
    record_key = backend_app._tts_v2_session_record_key(session_key)
    assert fake_redis.get(uid_key) == session_key
    stored = json.loads(str(fake_redis.get(record_key) or "{}"))
    assert stored["sessionKey"] == session_key
    assert stored["pinnedVertexSlotId"] == "slot_1"
    assert stored["pinnedLaneId"] == "L1"

    class _DummyRequest:
        def __init__(self, headers: dict[str, str]) -> None:
            self.headers = headers

    read_row = backend_app._require_tts_v2_session(
        _DummyRequest({
            "x-vf-tts-session-key": session_key,
        }),
        "session_redis_user",
    )
    assert read_row["sessionKey"] == session_key
    assert read_row["pinnedVertexSlotId"] == "slot_1"
    assert read_row["pinnedLaneId"] == "L1"


def test_tts_v2_job_create_rejects_forbidden_fields(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    request_id = f"test_{uuid.uuid4().hex}"
    payload = {
        "request_id": request_id,
        "mode": "single_speaker",
        "engine": "VECTOR",
        "text": "hello",
        "apiKey": "should-not-be-accepted",
    }
    response = client.post(
        "/tts/v2/jobs",
        headers=_dev_headers("v2_forbid_fields", request_id=request_id),
        json=payload,
    )
    assert response.status_code == 422


def test_tts_v2_job_create_rejects_provider_key_and_credential_fields(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    base_payload = {
        "request_id": f"test_{uuid.uuid4().hex}",
        "mode": "single_speaker",
        "engine": "VECTOR",
        "text": "hello",
    }
    for key, value in (
        ("providerApiKey", "should-not-be-accepted"),
        ("vertexServiceAccountRef", "slot_2"),
        ("sourcePolicy", {"selectedVertexSlotId": "slot_3"}),
        ("credentialsPath", "C:/secrets/service-account.json"),
    ):
        payload = dict(base_payload)
        payload[key] = value
        response = client.post(
            "/tts/v2/jobs",
            headers=_dev_headers(f"v2_forbid_{key}", request_id=str(payload["request_id"])),
            json=payload,
        )
        assert response.status_code == 422


def test_tts_v2_job_create_is_idempotent_for_same_request_id(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(
        backend_app,
        "_tts_v2_synthesize_chunk",
        lambda payload, text, lane_id: backend_app.TtsV2SynthChunk(audio=_wav_bytes(), media_type="audio/wav", headers={}),
    )
    request_id = f"test_{uuid.uuid4().hex}"
    payload = {
        "request_id": request_id,
        "mode": "single_speaker",
        "engine": "VECTOR",
        "text": "One line only.",
    }
    headers = _dev_headers("idem_user", request_id=request_id)
    first = client.post("/tts/v2/jobs", headers=headers, json=payload)
    second = client.post("/tts/v2/jobs", headers=headers, json=payload)
    assert first.status_code in {200, 202}
    assert second.status_code in {200, 202}
    first_job_id = str(first.json().get("jobId") or "")
    second_job_id = str(second.json().get("jobId") or "")
    assert first_job_id == request_id
    assert second_job_id == request_id


def test_tts_v2_engine_uses_shared_queue_prefix() -> None:
    assert str(getattr(backend_app._TTS_V2_ENGINE._queue, "key_prefix", "") or "") == str(backend_app.VF_TTS_QUEUE_KEY_PREFIX)


def test_tts_v2_job_create_resolves_existing_same_owner_durable_job(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    engine = backend_app._TTS_V2_ENGINE
    request_id = f"test_{uuid.uuid4().hex}"
    monkeypatch.setattr(engine, "_claim_idempotency", lambda rid, uid: (False, uid))
    monkeypatch.setattr(engine._queue, "is_redis_enabled", lambda: True)
    monkeypatch.setattr(
        engine._queue,
        "get",
        lambda job_id: {
            "jobId": job_id,
            "requestId": job_id,
            "traceId": job_id,
            "uid": "idem_owner",
            "status": "queued",
            "engine": "VECTOR",
            "text": "same owner durable job",
            "planKey": "free",
            "payload": {
                "request_id": job_id,
                "trace_id": job_id,
                "uid": "idem_owner",
                "text": "same owner durable job",
                "engine": "VECTOR",
                "mode": "single_speaker",
            },
            "result": {},
            "error": {},
            "statusCode": 0,
            "createdAtMs": int(time.time() * 1000),
            "updatedAtMs": int(time.time() * 1000),
        },
    )

    job = engine.create_job(
        uid="idem_owner",
        is_admin=False,
        plan_key="free",
        payload={
            "request_id": request_id,
            "trace_id": request_id,
            "mode": "single_speaker",
            "engine": "VECTOR",
            "text": "same owner durable job",
        },
    )

    assert job.id == request_id
    assert job.uid == "idem_owner"
    assert str(job.status or "").lower() == "queued"


def test_tts_v2_cancel_auth_checks_before_queue_mutation(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    engine = backend_app._TTS_V2_ENGINE
    request_id = f"test_{uuid.uuid4().hex}"
    cancel_calls: list[str] = []

    monkeypatch.setattr(engine._queue, "is_redis_enabled", lambda: True)
    monkeypatch.setattr(
        engine._queue,
        "get",
        lambda job_id: {
            "jobId": job_id,
            "requestId": job_id,
            "traceId": job_id,
            "uid": "cancel_owner",
            "status": "queued",
            "engine": "VECTOR",
            "text": "owner job",
            "planKey": "free",
            "payload": {
                "request_id": job_id,
                "trace_id": job_id,
                "uid": "cancel_owner",
                "text": "owner job",
                "engine": "VECTOR",
                "mode": "single_speaker",
            },
            "result": {},
            "error": {},
            "statusCode": 0,
            "createdAtMs": int(time.time() * 1000),
            "updatedAtMs": int(time.time() * 1000),
        },
    )

    def _cancel(job_id: str):
        cancel_calls.append(job_id)
        return {"jobId": job_id, "requestId": job_id}

    monkeypatch.setattr(engine._queue, "cancel", _cancel)

    with pytest.raises(backend_app.TtsV2AuthorizationError):
        engine.cancel_job(uid="other_user", is_admin=False, job_id=request_id)

    assert cancel_calls == []


def test_tts_v2_lane_uses_backend_slot_binding(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    expected_slot_by_lane = {"L1": "slot_1", "L2": "slot_2", "L3": "slot_3"}
    captured: list[tuple[str, str]] = []

    def _capture_slot(payload, text, lane_id):
        _ = text
        source_policy = dict((payload or {}).get("sourcePolicy") or {})
        captured.append((str(lane_id or ""), str(source_policy.get("selectedVertexSlotId") or "")))
        return backend_app.TtsV2SynthChunk(audio=_wav_bytes(80), media_type="audio/wav", headers={})

    monkeypatch.setattr(backend_app, "_tts_v2_synthesize_chunk", _capture_slot)
    request_id = f"test_{uuid.uuid4().hex}"
    dense_text = "\n".join(
        [
            (
                f"Speaker {index}: This is a long scripted line {index} with enough words to force "
                "multiple planned chunks and lane dispatch across startup ordering."
            )
            for index in range(1, 20)
        ]
    )
    submit = client.post(
        "/tts/v2/jobs",
        headers=_dev_headers("lane_binding_user", request_id=request_id),
        json={
            "request_id": request_id,
            "mode": "single_speaker",
            "engine": "VECTOR",
            "text": dense_text,
        },
    )
    assert submit.status_code == 202

    deadline = time.time() + 3.0
    while time.time() < deadline:
        poll = client.get(f"/tts/v2/jobs/{request_id}", headers={"x-dev-uid": "lane_binding_user"})
        assert poll.status_code == 200
        lanes_seen = {lane_id for lane_id, _ in captured if lane_id in expected_slot_by_lane}
        if lanes_seen == {"L1", "L2", "L3"}:
            break
        time.sleep(0.05)

    client.post(f"/tts/v2/jobs/{request_id}/cancel", headers={"x-dev-uid": "lane_binding_user"})
    assert captured
    lanes_seen = set()
    for lane_id, slot_id in captured:
        if lane_id in expected_slot_by_lane:
            lanes_seen.add(lane_id)
            assert slot_id == expected_slot_by_lane[lane_id]
    assert lanes_seen == {"L1", "L2", "L3"}


def test_tts_v2_gemini_jobs_honor_pinned_lane_and_slot_metadata(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    session_key = _issue_session_key("gemini_pin_user")
    with backend_app._TTS_V2_SESSION_LOCK:
        backend_app._INMEMORY_TTS_V2_SESSIONS[session_key] = {
            "uid": "gemini_pin_user",
            "sessionKey": session_key,
            "createdAtMs": int(time.time() * 1000),
            "expiresAtMs": int(time.time() * 1000) + 1800_000,
            "ttlSeconds": 1800,
            "pinnedVertexSlotId": "slot_2",
            "pinnedLaneId": "L2",
            "selectedRegion": "europe-west1",
            "latencyMs": 7,
            "pinSource": "session-sticky",
        }
        backend_app._INMEMORY_TTS_V2_ACTIVE_SESSION_BY_UID["gemini_pin_user"] = session_key

    captured: list[tuple[str, str]] = []

    def _capture_slot(payload, text, lane_id):
        _ = text
        source_policy = dict((payload or {}).get("sourcePolicy") or {})
        captured.append((str(lane_id or ""), str(source_policy.get("selectedVertexSlotId") or "")))
        return backend_app.TtsV2SynthChunk(audio=_wav_bytes(60), media_type="audio/wav", headers={})

    monkeypatch.setattr(backend_app, "_tts_v2_synthesize_chunk", _capture_slot)
    request_id = f"test_{uuid.uuid4().hex}"
    response = client.post(
        "/tts/v2/jobs",
        headers={
            "x-dev-uid": "gemini_pin_user",
            "x-vf-tts-session-key": session_key,
            "Idempotency-Key": request_id,
        },
        json={
            "request_id": request_id,
            "mode": "single_speaker",
            "engine": "VECTOR",
            "text": "Pinned lane should be used.",
        },
    )
    assert response.status_code == 202

    deadline = time.time() + 3.0
    while time.time() < deadline:
        poll = client.get(
            f"/tts/v2/jobs/{response.json().get('jobId')}",
            headers={"x-dev-uid": "gemini_pin_user"},
        )
        assert poll.status_code == 200
        if str(poll.json().get("status") or "").lower() == "completed":
            break
        time.sleep(0.05)

    assert captured
    lane_id, slot_id = captured[0]
    assert lane_id == "L2"
    assert slot_id == "slot_2"


def test_tts_v2_duno_jobs_ignore_pinned_session_metadata(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    session_key = _issue_session_key("duno_pin_user")
    with backend_app._TTS_V2_SESSION_LOCK:
        backend_app._INMEMORY_TTS_V2_SESSIONS[session_key] = {
            "uid": "duno_pin_user",
            "sessionKey": session_key,
            "createdAtMs": int(time.time() * 1000),
            "expiresAtMs": int(time.time() * 1000) + 1800_000,
            "ttlSeconds": 1800,
            "pinnedVertexSlotId": "slot_3",
            "pinnedLaneId": "L3",
            "selectedRegion": "asia-south1",
            "latencyMs": 6,
            "pinSource": "session-sticky",
        }
        backend_app._INMEMORY_TTS_V2_ACTIVE_SESSION_BY_UID["duno_pin_user"] = session_key

    captured: list[tuple[str, str]] = []

    def _capture_slot(payload, text, lane_id):
        _ = text
        source_policy = dict((payload or {}).get("sourcePolicy") or {})
        captured.append((str(lane_id or ""), str(source_policy.get("selectedVertexSlotId") or "")))
        return backend_app.TtsV2SynthChunk(audio=_wav_bytes(60), media_type="audio/wav", headers={})

    monkeypatch.setattr(backend_app, "_tts_v2_synthesize_chunk", _capture_slot)
    request_id = f"test_{uuid.uuid4().hex}"
    response = client.post(
        "/tts/v2/jobs",
        headers={
            "x-dev-uid": "duno_pin_user",
            "x-vf-tts-session-key": session_key,
            "Idempotency-Key": request_id,
        },
        json={
            "request_id": request_id,
            "mode": "single_speaker",
            "engine": "DUNO",
            "text": "Duno should not receive pin metadata.",
        },
    )
    assert response.status_code == 202

    deadline = time.time() + 3.0
    while time.time() < deadline:
        poll = client.get(
            f"/tts/v2/jobs/{response.json().get('jobId')}",
            headers={"x-dev-uid": "duno_pin_user"},
        )
        assert poll.status_code == 200
        if str(poll.json().get("status") or "").lower() == "completed":
            break
        time.sleep(0.05)

    assert captured
    _lane_id, slot_id = captured[0]
    assert slot_id == ""


def test_tts_v2_session_probe_failure_falls_back_without_blocking_job_creation(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_tts_v2_session_redis_client", lambda: None)
    monkeypatch.setattr(
        backend_app,
        "_load_gemini_api_pools",
        lambda: (
            {
                "sourcePolicy": {
                    "provider": "vertex",
                    "vertexAccounts": [
                        {"memberId": "slot_1", "vertexLocation": "us-central1"},
                        {"memberId": "slot_2", "vertexLocation": "europe-west1"},
                    ],
                }
            },
            {},
        ),
    )

    def _fail_probe(*args, **kwargs):
        _ = args, kwargs
        raise requests.exceptions.Timeout("probe timeout")

    monkeypatch.setattr(backend_app, "_runtime_http_request", _fail_probe)

    response = client.post(
        "/tts/v2/sessions",
        headers={"x-dev-uid": "fallback_user"},
        json={"probeAllSlotRegions": True},
    )
    assert response.status_code == 201
    payload = response.json()
    assert not str(payload.get("pinnedVertexSlotId") or "").strip()

    session_key = str(payload.get("sessionKey") or "").strip()
    monkeypatch.setattr(
        backend_app,
        "_tts_v2_synthesize_chunk",
        lambda payload, text, lane_id: backend_app.TtsV2SynthChunk(audio=_wav_bytes(60), media_type="audio/wav", headers={}),
    )
    request_id = f"test_{uuid.uuid4().hex}"
    job = client.post(
        "/tts/v2/jobs",
        headers={
            "x-dev-uid": "fallback_user",
            "x-vf-tts-session-key": session_key,
            "Idempotency-Key": request_id,
        },
        json={
            "request_id": request_id,
            "mode": "single_speaker",
            "engine": "VECTOR",
            "text": "Fallback still creates jobs.",
        },
    )
    assert job.status_code in {200, 202}


def test_tts_v2_error_payloads_redact_secret_like_runtime_details(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)

    secret_path = r"C:\runtime\secrets\vertex-service-account.json"
    secret_marker = "GOOGLE_APPLICATION_CREDENTIALS"
    private_key_marker = "private_key"

    def _failing_synth(payload, text, lane_id):
        _ = payload, text, lane_id
        raise backend_app.TtsV2RuntimeSynthesisError(
            f"{secret_marker}={secret_path}; {private_key_marker}=BEGIN",
            status_code=500,
            retryable=False,
            detail={"error": f"upstream failed with {secret_path} and {private_key_marker}"},
        )

    monkeypatch.setattr(backend_app, "_tts_v2_synthesize_chunk", _failing_synth)
    request_id = f"test_{uuid.uuid4().hex}"
    submit = client.post(
        "/tts/v2/jobs",
        headers=_dev_headers("redact_user", request_id=request_id),
        json={
            "request_id": request_id,
            "mode": "single_speaker",
            "engine": "VECTOR",
            "text": "hello secure world",
        },
    )
    assert submit.status_code == 202

    deadline = time.time() + 12.0
    status_payload = {}
    while time.time() < deadline:
        poll = client.get(
            f"/tts/v2/jobs/{request_id}",
            headers={"x-dev-uid": "redact_user"},
            params={"includeChunks": True},
        )
        assert poll.status_code == 200
        status_payload = poll.json()
        if str(status_payload.get("status") or "").lower() in {"failed", "cancelled"}:
            break
        time.sleep(0.05)

    raw_status = str(status_payload)
    assert str(status_payload.get("status") or "").lower() == "failed"
    assert secret_marker not in raw_status
    assert secret_path not in raw_status
    assert private_key_marker not in raw_status

    result = client.get(f"/tts/v2/jobs/{request_id}/result/audio", headers={"x-dev-uid": "redact_user"})
    assert result.status_code >= 400
    raw_result = str(result.json())
    assert secret_marker not in raw_result
    assert secret_path not in raw_result
    assert private_key_marker not in raw_result


def test_reader_tts_job_creation_routes_through_v2_helper(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)

    def _legacy_submit(*args, **kwargs):
        _ = args, kwargs
        raise AssertionError("Reader should not call legacy _submit_tts_job anymore.")

    captured: dict[str, object] = {}

    def _fake_create_tts_v2_job_response(request, payload, *, require_session=True):
        _ = request
        captured["require_session"] = require_session
        captured["payload"] = dict(payload or {})
        return backend_app.JSONResponse(
            {
                "jobId": str(payload.get("request_id") or ""),
                "requestId": str(payload.get("request_id") or ""),
                "status": "queued",
                "engine": "VECTOR",
            },
            status_code=202,
        )

    monkeypatch.setattr(backend_app, "_submit_tts_job", _legacy_submit)
    monkeypatch.setattr(backend_app, "_create_tts_v2_job_response", _fake_create_tts_v2_job_response)

    request = backend_app._reader_internal_request("reader_v2_user")
    session = {"audioEngine": "tts_hd"}
    request_id = f"reader_{uuid.uuid4().hex}"
    speaker_voices = [{"speaker": f"Speaker {idx}", "voice_id": f"v{idx}"} for idx in range(1, 7)]
    job_id = backend_app._reader_create_tts_job(
        request,
        session=session,
        text="Speaker 1: hello\nSpeaker 2: world",
        request_id=request_id,
        voice_id="v22",
        language="en",
        multi_speaker_mode="studio_pair_groups",
        line_map=[{"lineIndex": 0, "speaker": "Speaker 1", "text": "hello"}],
        speaker_voices=speaker_voices,
    )

    assert job_id == request_id
    assert captured["require_session"] is False
    payload = dict(captured["payload"] or {})
    assert payload["request_id"] == request_id
    assert payload["mode"] == "multi_speaker"
    assert "apiKey" not in payload
    assert "providerApiKey" not in payload


def test_tts_v2_job_cancel_stays_cancelled(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)

    def _slow_synth(payload, text, lane_id):
        _ = payload, text, lane_id
        time.sleep(0.2)
        return backend_app.TtsV2SynthChunk(audio=_wav_bytes(120), media_type="audio/wav", headers={})

    monkeypatch.setattr(backend_app, "_tts_v2_synthesize_chunk", _slow_synth)
    request_id = f"test_{uuid.uuid4().hex}"
    submit = client.post(
        "/tts/v2/jobs",
        headers=_dev_headers("cancel_user", request_id=request_id),
        json={
            "request_id": request_id,
            "mode": "single_speaker",
            "engine": "VECTOR",
            "text": "First.\nSecond.\nThird.",
        },
    )
    assert submit.status_code == 202
    cancel = client.post(f"/tts/v2/jobs/{request_id}/cancel", headers={"x-dev-uid": "cancel_user"})
    assert cancel.status_code == 200
    poll = client.get(f"/tts/v2/jobs/{request_id}", headers={"x-dev-uid": "cancel_user"})
    assert poll.status_code == 200
    assert str(poll.json().get("status") or "").lower() == "cancelled"


def test_tts_v2_cancel_releases_lane_inflight(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)

    def _slow_synth(payload, text, lane_id):
        _ = payload, text, lane_id
        time.sleep(0.25)
        return backend_app.TtsV2SynthChunk(audio=_wav_bytes(120), media_type="audio/wav", headers={})

    monkeypatch.setattr(backend_app, "_tts_v2_synthesize_chunk", _slow_synth)
    request_id = f"test_{uuid.uuid4().hex}"
    lines = "\n".join(
        [
            f"Speaker {index}: This is chunk line {index} with enough words to force chunk scheduling."
            for index in range(1, 10)
        ]
    )
    submit = client.post(
        "/tts/v2/jobs",
        headers=_dev_headers("cancel_release_user", request_id=request_id),
        json={
            "request_id": request_id,
            "mode": "single_speaker",
            "engine": "VECTOR",
            "text": lines,
        },
    )
    assert submit.status_code == 202
    cancel = client.post(f"/tts/v2/jobs/{request_id}/cancel", headers={"x-dev-uid": "cancel_release_user"})
    assert cancel.status_code == 200

    deadline = time.time() + 3.0
    last_payload = {}
    while time.time() < deadline:
        poll = client.get(f"/tts/v2/jobs/{request_id}", headers={"x-dev-uid": "cancel_release_user"})
        assert poll.status_code == 200
        last_payload = poll.json()
        lanes = list(last_payload.get("lanes") or [])
        if str(last_payload.get("status") or "").lower() == "cancelled" and lanes and all(
            int(lane.get("inflight") or 0) == 0 for lane in lanes
        ):
            break
        time.sleep(0.05)

    lanes = list(last_payload.get("lanes") or [])
    assert lanes, "Expected lane snapshot in status payload."
    assert all(int(lane.get("inflight") or 0) == 0 for lane in lanes)


def test_tts_v2_cross_user_access_denied(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(
        backend_app,
        "_tts_v2_synthesize_chunk",
        lambda payload, text, lane_id: backend_app.TtsV2SynthChunk(audio=_wav_bytes(), media_type="audio/wav", headers={}),
    )
    request_id = f"test_{uuid.uuid4().hex}"
    submit = client.post(
        "/tts/v2/jobs",
        headers=_dev_headers("owner_user", request_id=request_id),
        json={
            "request_id": request_id,
            "mode": "single_speaker",
            "engine": "VECTOR",
            "text": "hello world",
        },
    )
    assert submit.status_code == 202
    forbidden = client.get(f"/tts/v2/jobs/{request_id}", headers={"x-dev-uid": "other_user"})
    assert forbidden.status_code == 403


def test_tts_v2_request_id_conflict_rejects_cross_user_create(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(
        backend_app,
        "_tts_v2_synthesize_chunk",
        lambda payload, text, lane_id: backend_app.TtsV2SynthChunk(audio=_wav_bytes(), media_type="audio/wav", headers={}),
    )
    request_id = f"test_{uuid.uuid4().hex}"
    payload = {
        "request_id": request_id,
        "mode": "single_speaker",
        "engine": "VECTOR",
        "text": "idempotent create",
    }
    first = client.post("/tts/v2/jobs", headers=_dev_headers("owner_user", request_id=request_id), json=payload)
    assert first.status_code == 202

    second = client.post("/tts/v2/jobs", headers=_dev_headers("other_user", request_id=request_id), json=payload)
    assert second.status_code == 409


def test_reader_job_status_summary_prefers_v2_jobs(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)

    def _legacy_get(*args, **kwargs):
        _ = args, kwargs
        raise AssertionError("Reader job status should prefer V2 before legacy queue.")

    monkeypatch.setattr(backend_app._TTS_JOB_QUEUE, "get", _legacy_get)
    monkeypatch.setattr(
        backend_app._TTS_V2_ENGINE,
        "get_job",
        lambda *, uid, is_admin, job_id: object(),
    )
    monkeypatch.setattr(
        backend_app._TTS_V2_ENGINE,
        "status_payload",
        lambda **kwargs: {
            "status": "running",
            "engine": "VECTOR",
            "chunkCursorNext": 3,
            "live": {"playableChunks": 2, "playableDurationMs": 3800},
        },
    )

    summary = backend_app._reader_job_status_summary("reader_summary_user", "job_v2_summary")
    assert summary["status"] == "running"
    assert summary["engine"] == "VECTOR"
    assert summary["chunkCursorNext"] == 3
    assert summary["playableChunks"] == 2
    assert summary["playableDurationMs"] == 3800


def test_reader_export_prefers_v2_result_audio(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)

    def _legacy_get(*args, **kwargs):
        _ = args, kwargs
        raise AssertionError("Reader export should prefer V2 result audio before legacy queue.")

    monkeypatch.setattr(backend_app._TTS_JOB_QUEUE, "get", _legacy_get)
    monkeypatch.setattr(
        backend_app._TTS_V2_ENGINE,
        "get_result_audio",
        lambda *, uid, is_admin, job_id: (_wav_bytes(200), "audio/wav"),
    )

    audio = backend_app._reader_tts_job_result_audio_bytes("reader_export_user", "job_v2_export", is_admin=False)
    assert audio == _wav_bytes(200)


def test_reader_delete_prefers_v2_cancel(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    calls = {"v2": 0, "legacy": 0}

    def _v2_cancel(*, uid, is_admin, job_id):
        _ = uid, is_admin, job_id
        calls["v2"] += 1
        return object()

    def _legacy_cancel(*args, **kwargs):
        _ = args, kwargs
        calls["legacy"] += 1
        raise AssertionError("Reader delete should not reach legacy queue cancel when V2 is available.")

    monkeypatch.setattr(backend_app._TTS_V2_ENGINE, "cancel_job", _v2_cancel)
    monkeypatch.setattr(backend_app._TTS_JOB_QUEUE, "cancel", _legacy_cancel)

    cancelled = backend_app._reader_cancel_tts_job("reader_cancel_user", "job_v2_cancel", is_admin=False)
    assert cancelled is True
    assert calls["v2"] == 1
    assert calls["legacy"] == 0
