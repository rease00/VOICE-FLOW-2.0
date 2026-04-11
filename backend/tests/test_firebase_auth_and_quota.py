from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from pathlib import Path
import time
import uuid

import pytest
from fastapi.testclient import TestClient

import app as backend_app
from services.admission.redis_limits import SuccessQuotaDecision, SuccessQuotaLimiter, SuccessQuotaReservation, SuccessQuotaSnapshot
from services.queue.redis_queue import WeightedInMemoryQueue

class _DummyRuntimeResponse:
    def __init__(self, status_code: int = 200, content: bytes = b"RIFF" + b"\x00" * 256, json_payload: dict | None = None) -> None:
        self.status_code = status_code
        self.content = content
        self._json_payload = json_payload or {}
        self.headers = {"content-type": "audio/wav"}
        self.text = "runtime error"

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self) -> dict:
        return self._json_payload

def _reset_inmemory_state() -> None:
    for name in (
        "_INMEMORY_ENTITLEMENTS",
        "_INMEMORY_USAGE_MONTHLY",
        "_INMEMORY_USAGE_DAILY",
        "_INMEMORY_USAGE_EVENTS",
        "_INMEMORY_USER_PROFILES",
        "_INMEMORY_USER_ID_INDEX",
        "_INMEMORY_GENERATION_HISTORY",
        "_INMEMORY_DAILY_USAGE_RESET_STATUS",
        "_INMEMORY_STRIPE_CUSTOMERS",
        "_INMEMORY_WALLET_DAILY",
        "_INMEMORY_WALLET_TRANSACTIONS",
        "_INMEMORY_COUPONS",
        "_INMEMORY_COUPON_REDEMPTIONS",
        "_INMEMORY_STRIPE_WEBHOOK_EVENTS",
        "_INMEMORY_REQUEST_IDEMPOTENCY",
        "_INMEMORY_VC_USAGE_EVENTS",
    ):
        store = getattr(backend_app, name, None)
        if hasattr(store, "clear"):
            store.clear()
    backend_app._TTS_SUCCESS_LIMITER.clear_all_local_state()

    engine = backend_app._TTS_V2_ENGINE
    queue = getattr(engine, "_queue", None)
    with engine._jobs_lock:
        engine._jobs.clear()
        engine._request_to_job.clear()
        engine._idem_local.clear()
        engine._threads.clear()
        engine._job_cache_order.clear()
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
            getattr(queue, "_job_cache_order", deque()).clear()
            if hasattr(queue, "_lane_rr"):
                queue._lane_rr = deque(queue._weighted_lane_order())
            if hasattr(queue, "_compat_queue"):
                queue._compat_queue = WeightedInMemoryQueue(getattr(queue, "_weights", None))
    with backend_app._TTS_V2_SESSION_LOCK:
        backend_app._INMEMORY_TTS_V2_SESSIONS.clear()
        backend_app._INMEMORY_TTS_V2_ACTIVE_SESSION_BY_UID.clear()

def test_tts_v2_synthesize_chunk_forwards_request_identity(monkeypatch) -> None:
    captured_payload: dict[str, object] = {}

    def _fake_runtime_request(*args, **kwargs):
        _ = args
        captured_payload.update(dict(kwargs.get("json") or {}))
        return _DummyRuntimeResponse()

    monkeypatch.setattr(backend_app, "_runtime_url_for_engine", lambda _engine: "http://runtime")
    monkeypatch.setattr(backend_app, "_runtime_synthesize_path_for_engine", lambda _engine: "/v1/synthesize")
    monkeypatch.setattr(backend_app, "_runtime_tts_request_with_gemini_failover", _fake_runtime_request)

    result = backend_app._tts_v2_synthesize_chunk(
        {
            "engine": "VECTOR",
            "text": "identity check",
            "requestId": "req_identity_123",
            "idempotencyKey": "idem_identity_123",
            "trace_id": "trace_identity_123",
        }
    )

    assert result["audioBytes"]
    assert str(captured_payload.get("requestId") or "") == "req_identity_123"
    assert str(captured_payload.get("request_id") or "") == "req_identity_123"
    assert str(captured_payload.get("idempotencyKey") or "") == "idem_identity_123"
    assert str(captured_payload.get("idempotency_key") or "") == "idem_identity_123"

def _submit_tts_and_wait_status(
    client: TestClient,
    *,
    payload: dict,
    headers: dict[str, str],
    timeout_seconds: float = 8.0,
) -> tuple[int, object]:
    safe_headers = dict(headers or {})
    if "x-vf-tts-session-key" not in {str(k).lower(): v for k, v in safe_headers.items()}:
        issue = client.post("/tts/v2/sessions", headers=safe_headers)
        if issue.status_code == 201:
            session_key = str(issue.json().get("sessionKey") or "").strip()
            if session_key:
                safe_headers["x-vf-tts-session-key"] = session_key
    safe_payload = dict(payload or {})
    if not str(safe_payload.get("request_id") or "").strip():
        safe_payload["request_id"] = f"test_{uuid.uuid4().hex}"
    if not str(safe_headers.get("Idempotency-Key") or "").strip():
        safe_headers["Idempotency-Key"] = str(safe_payload["request_id"])
    if not str(safe_payload.get("mode") or "").strip():
        safe_payload["mode"] = "single_speaker"
    submit = client.post("/tts/v2/jobs", json=safe_payload, headers=safe_headers)
    if submit.status_code != 202:
        return submit.status_code, submit

    submit_payload = submit.json() if submit.headers.get("content-type", "").startswith("application/json") else {}
    job_id = str(
        (submit_payload or {}).get("jobId")
        or (submit_payload or {}).get("job_id")
        or (submit_payload or {}).get("requestId")
        or (submit_payload or {}).get("request_id")
        or ""
    ).strip()
    if not job_id:
        return submit.status_code, submit

    deadline = time.time() + max(1.0, float(timeout_seconds))
    while time.time() < deadline:
        poll = client.get(f"/tts/v2/jobs/{job_id}", headers=safe_headers)
        if poll.status_code != 200:
            return poll.status_code, poll
        status_payload = poll.json()
        status = str(status_payload.get("status") or "").strip().lower()
        if status == "completed":
            return 200, poll
        if status == "failed":
            return int(status_payload.get("statusCode") or 500), poll
        if status == "cancelled":
            return 409, poll
        time.sleep(0.05)
    return submit.status_code, submit

def test_auth_enforcement_blocks_missing_token(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    client = TestClient(backend_app.app)
    response = client.get("/account/entitlements")
    assert response.status_code == 401

def test_auth_enforcement_accepts_valid_token(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "VF_REQUIRE_EMAIL_VERIFIED", True)
    monkeypatch.setattr(backend_app, "VF_USER_ID_REQUIRED", False)
    monkeypatch.setattr(
        backend_app,
        "_verify_firebase_id_token",
        lambda token: {
            "uid": "firebase_user_1",
            "email": "verified@example.com",
            "email_verified": True,
        },
    )
    client = TestClient(backend_app.app)
    response = client.get("/account/entitlements", headers={"Authorization": "Bearer valid_token"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["entitlements"]["uid"] == "firebase_user_1"

def test_auth_enforcement_blocks_unverified_email_token(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "VF_REQUIRE_EMAIL_VERIFIED", True)
    monkeypatch.setattr(backend_app, "VF_USER_ID_REQUIRED", False)
    monkeypatch.setattr(
        backend_app,
        "_verify_firebase_id_token",
        lambda token: {
            "uid": "firebase_user_unverified",
            "email": "pending@example.com",
            "email_verified": False,
        },
    )
    client = TestClient(backend_app.app)
    response = client.get("/account/entitlements", headers={"Authorization": "Bearer valid_token"})
    assert response.status_code == 403
    payload = response.json()
    assert payload.get("detail") == "Email verification required."
    assert payload.get("errorCode") == "VF_EMAIL_NOT_VERIFIED"

def test_auth_enforcement_allows_unverified_admin_email_allowlist(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "VF_REQUIRE_EMAIL_VERIFIED", True)
    monkeypatch.setattr(backend_app, "VF_USER_ID_REQUIRED", False)
    monkeypatch.setattr(backend_app, "VF_ADMIN_APPROVER_EMAILS", frozenset({"admin1@v-flow-ai.local"}))
    monkeypatch.setattr(
        backend_app,
        "_verify_firebase_id_token",
        lambda token: {
            "uid": "firebase_admin_user_unverified",
            "email": "admin1@v-flow-ai.local",
            "email_verified": False,
            "admin": False,
        },
    )
    client = TestClient(backend_app.app)
    response = client.get("/account/entitlements", headers={"Authorization": "Bearer valid_token"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["entitlements"]["uid"] == "firebase_admin_user_unverified"

def test_auth_enforcement_allows_phone_only_token_without_email_claim(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "VF_REQUIRE_EMAIL_VERIFIED", True)
    monkeypatch.setattr(backend_app, "VF_USER_ID_REQUIRED", False)
    monkeypatch.setattr(
        backend_app,
        "_verify_firebase_id_token",
        lambda token: {"uid": "firebase_phone_user"},
    )
    client = TestClient(backend_app.app)
    response = client.get("/account/entitlements", headers={"Authorization": "Bearer valid_token"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["entitlements"]["uid"] == "firebase_phone_user"

def test_verify_firebase_id_token_checks_revocation(monkeypatch) -> None:
    _reset_inmemory_state()
    backend_app._FIREBASE_APP = object()
    calls: list[tuple[str, bool]] = []

    class _FirebaseAuth:
        @staticmethod
        def verify_id_token(id_token, check_revoked=False, clock_skew_seconds=0):
            calls.append((str(id_token), bool(check_revoked), int(clock_skew_seconds)))
            return {"uid": "revocation_user"}

    monkeypatch.setattr(backend_app, "firebase_auth", _FirebaseAuth())

    claims = backend_app._verify_firebase_id_token("token_123")
    assert claims["uid"] == "revocation_user"
    assert calls == [("token_123", True, 60)]

def test_runtime_status_endpoint_requires_auth_when_enforced(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    client = TestClient(backend_app.app)
    response = client.get("/tts/engines/status", params={"engine": "PRIME"})
    assert response.status_code == 401

@pytest.mark.parametrize("origin", ["http://localhost:3000", "http://127.0.0.1:43123"])
def test_protected_preflight_returns_cors_success(monkeypatch, origin: str) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    client = TestClient(backend_app.app)
    headers = {
        "Origin": origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization,x-dev-uid",
    }
    response = client.options("/account/profile", headers=headers)
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == origin
    assert "GET" in str(response.headers.get("access-control-allow-methods") or "")
    assert "authorization" in str(response.headers.get("access-control-allow-headers") or "").lower()

@pytest.mark.parametrize("origin", ["http://localhost:3000", "http://127.0.0.1:43123"])
def test_auth_401_response_includes_cors_headers(monkeypatch, origin: str) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    client = TestClient(backend_app.app)
    response = client.get("/account/profile", headers={"Origin": origin})
    assert response.status_code == 401
    assert response.headers.get("access-control-allow-origin") == origin

def test_tts_synthesize_does_not_enforce_daily_limit(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_TTS_UPSTREAM_PROVIDER", "runtime")
    monkeypatch.setattr(backend_app, "VF_TTS_TEXTTOSPEECH_ONLY", False)
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeResponse())
    uid = "quota_user_daily"
    backend_app._INMEMORY_ENTITLEMENTS[uid] = {
        **backend_app._default_entitlement(uid),
        "plan": "Plus",
        "monthlyVfLimit": 100000,
    }

    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": uid}
    first_code, _ = _submit_tts_and_wait_status(
        client,
        payload={"engine": "PRIME", "text": "hello"},
        headers=headers,
    )
    second_code, _ = _submit_tts_and_wait_status(
        client,
        payload={"engine": "PRIME", "text": "again"},
        headers=headers,
    )
    third_code, _ = _submit_tts_and_wait_status(
        client,
        payload={"engine": "PRIME", "text": "third run should pass"},
        headers=headers,
    )

    assert first_code == 200
    assert second_code == 200
    assert third_code == 200

    ent = client.get("/account/entitlements", headers=headers)
    assert ent.status_code == 200
    payload = ent.json()["entitlements"]
    daily_payload = payload.get("daily") or {}
    assert int(daily_payload.get("generationUsed") or 0) == 3
    assert "generationLimit" not in daily_payload
    assert "generationRemaining" not in daily_payload

def test_tts_v2_job_create_blocks_gem_for_free_plan(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeResponse())

    client = TestClient(backend_app.app)
    session = client.post("/tts/v2/sessions", headers={"x-dev-uid": "free_gem_block_user"})
    assert session.status_code == 201
    session_key = str(session.json().get("sessionKey") or "").strip()
    assert session_key
    request_id = f"test_{uuid.uuid4().hex}"
    response = client.post(
        "/tts/v2/jobs",
        headers={
            "x-dev-uid": "free_gem_block_user",
            "x-vf-tts-session-key": session_key,
            "Idempotency-Key": request_id,
        },
        json={
            "request_id": request_id,
            "mode": "single_speaker",
            "engine": "PRIME",
            "text": "forbidden on free plan",
            "voice_id": "Fenrir",
        },
    )
    assert response.status_code == 403
    detail = response.json().get("detail") or {}
    assert detail.get("errorCode") == "VF_TTS_ENGINE_PLAN_FORBIDDEN"
    assert detail.get("plan") == "Free"
    assert detail.get("engine") == "PRIME"
    assert set(detail.get("allowedEngines") or []) == {"VECTOR"}

def test_prime_is_allowed_for_paid_wallet_balance(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_USER_ID_REQUIRED", False)
    monkeypatch.setattr(backend_app, "VF_TTS_UPSTREAM_PROVIDER", "runtime")
    monkeypatch.setattr(backend_app, "VF_TTS_TEXTTOSPEECH_ONLY", False)
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeResponse())

    uid = "paid_wallet_prime_user"
    backend_app._INMEMORY_ENTITLEMENTS[uid] = {
        **backend_app._default_entitlement(uid),
        "plan": "Free",
        "paidVfBalance": 125,
    }

    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": uid}

    entitlements_response = client.get("/account/entitlements", headers=headers)
    assert entitlements_response.status_code == 200
    entitlements_payload = entitlements_response.json()["entitlements"]
    assert "PRIME" in list((entitlements_payload.get("limits") or {}).get("allowedEngines") or [])

    summary_response = client.get("/billing/account-summary", headers=headers)
    assert summary_response.status_code == 200
    summary_payload = summary_response.json()["summary"]
    assert "PRIME" in list((summary_payload.get("plan") or {}).get("allowedEngines") or [])

    response_code, _ = _submit_tts_and_wait_status(
        client,
        payload={"engine": "PRIME", "text": "paid balance unlocks prime"},
        headers=headers,
    )
    assert response_code in {200, 202}

def test_prime_is_allowed_for_paid_plan_with_zero_balance(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_USER_ID_REQUIRED", False)
    monkeypatch.setattr(backend_app, "VF_TTS_UPSTREAM_PROVIDER", "runtime")
    monkeypatch.setattr(backend_app, "VF_TTS_TEXTTOSPEECH_ONLY", False)
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeResponse())

    uid = "paid_plan_zero_balance_user"
    backend_app._INMEMORY_ENTITLEMENTS[uid] = {
        **backend_app._default_entitlement(uid),
        "plan": "Pro",
        "paidVfBalance": 0,
    }

    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": uid}

    entitlements_response = client.get("/account/entitlements", headers=headers)
    assert entitlements_response.status_code == 200
    entitlements_payload = entitlements_response.json()["entitlements"]
    assert "PRIME" in list((entitlements_payload.get("limits") or {}).get("allowedEngines") or [])

    response_code, _ = _submit_tts_and_wait_status(
        client,
        payload={"engine": "PRIME", "text": "paid plan unlocks prime"},
        headers=headers,
    )
    assert response_code == 200

def test_default_entitlement_uses_free_wallet_policy() -> None:
    _reset_inmemory_state()
    entitlement = backend_app._default_entitlement("free_wallet_defaults")

    assert entitlement["monthlyVfLimit"] == backend_app.PLAN_LIMITS["free"]["monthlyVfLimit"] == 1000
    assert float(entitlement["vffBalance"] or 0) == float(backend_app.VF_FREE_MONTHLY_VFF_GRANT)
    assert str(entitlement.get("vffGrantMonthKey") or "") == backend_app._wallet_month_key()

def test_normalize_entitlement_wallet_migrates_free_vff_grant_and_cap() -> None:
    _reset_inmemory_state()
    month_key = backend_app._wallet_month_key()
    normalized = backend_app._normalize_entitlement_wallet(
        {
            "plan": "Free",
            "monthlyVfLimit": 10000,
            "paidVfBalance": 0,
            "vffBalance": 0,
            "vffMonthKey": month_key,
        }
    )
    assert normalized["monthlyVfLimit"] == backend_app.PLAN_LIMITS["free"]["monthlyVfLimit"] == 1000
    assert float(normalized.get("vffBalance") or 0) == float(backend_app.VF_FREE_MONTHLY_VFF_GRANT)
    assert str(normalized.get("vffGrantMonthKey") or "") == month_key

    rollover = backend_app._normalize_entitlement_wallet(
        {
            "plan": "Free",
            "monthlyVfLimit": 5000,
            "paidVfBalance": 0,
            "vffBalance": backend_app.VF_FREE_MONTHLY_VFF_CAP + 2500,
            "vffMonthKey": "2000-01",
            "vffGrantMonthKey": "2000-01",
        }
    )
    assert rollover["monthlyVfLimit"] == backend_app.PLAN_LIMITS["free"]["monthlyVfLimit"]
    assert float(rollover.get("vffBalance") or 0) == float(backend_app.VF_FREE_MONTHLY_VFF_GRANT)
    assert str(rollover.get("vffMonthKey") or "") == month_key

def test_tts_synthesize_reverts_usage_on_runtime_failure(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_TTS_UPSTREAM_PROVIDER", "runtime")
    monkeypatch.setattr(backend_app, "VF_TTS_TEXTTOSPEECH_ONLY", False)
    uid = "quota_user_revert"
    backend_app._INMEMORY_ENTITLEMENTS[uid] = {
        **backend_app._default_entitlement(uid),
        "monthlyVfLimit": 8000,
    }
    monkeypatch.setattr(
        backend_app.requests,
        "post",
        lambda *args, **kwargs: _DummyRuntimeResponse(status_code=500, content=b"", json_payload={"detail": "boom"}),
    )

    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": uid}
    failed_code, _ = _submit_tts_and_wait_status(
        client,
        payload={"engine": "VECTOR", "text": "runtime fail"},
        headers=headers,
    )
    assert failed_code == 500

    ent = client.get("/account/entitlements", headers=headers)
    assert ent.status_code == 200
    payload = ent.json()["entitlements"]
    assert payload["daily"]["generationUsed"] == 0
    assert payload["monthly"]["vfUsed"] == 0

def test_entitlements_include_engine_char_caps_and_early_access(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_USER_ID_REQUIRED", False)
    scale_uid = "entitlements_scale_user"
    free_uid = "entitlements_free_user"
    backend_app._user_profile_upsert(
        scale_uid,
        user_id="entscale1",
        created_by="test",
        updated_by="test",
        allow_existing_immutable=True,
    )
    backend_app._user_profile_upsert(
        free_uid,
        user_id="entfree1",
        created_by="test",
        updated_by="test",
        allow_existing_immutable=True,
    )
    backend_app._write_entitlement(scale_uid, {"plan": "Scale"})

    client = TestClient(backend_app.app)
    scale_response = client.get("/account/entitlements", headers={"x-dev-uid": scale_uid})
    assert scale_response.status_code == 200
    scale_ent = scale_response.json()["entitlements"]
    assert bool((scale_ent.get("features") or {}).get("earlyAccess")) is True
    assert int((scale_ent.get("limits") or {}).get("maxCharsPerGeneration") or 0) == 15000
    assert "PRIME" in list((scale_ent.get("limits") or {}).get("allowedEngines") or [])

    free_response = client.get("/account/entitlements", headers={"x-dev-uid": free_uid})
    assert free_response.status_code == 200
    free_ent = free_response.json()["entitlements"]
    assert bool((free_ent.get("features") or {}).get("earlyAccess")) is False
    assert int((free_ent.get("limits") or {}).get("maxCharsPerGeneration") or 0) == 8000
    assert "PRIME" not in list((free_ent.get("limits") or {}).get("allowedEngines") or [])

def test_admin_reconcile_allowed_engines_dry_run_and_apply(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_USER_ID_REQUIRED", False)
    monkeypatch.setattr(backend_app, "_require_permission", lambda _request, _permission: ("admin_user", {"role": "super_admin"}))
    monkeypatch.setattr(backend_app, "_require_admin_mutation_unlock", lambda _request, expected_uid=None: expected_uid or "admin_user")

    free_uid = "reconcile_free_user"
    paid_wallet_uid = "reconcile_paid_wallet_user"
    paid_plan_uid = "reconcile_paid_plan_user"
    backend_app._INMEMORY_ENTITLEMENTS[free_uid] = {
        **backend_app._default_entitlement(free_uid),
        "plan": "Free",
        "paidVfBalance": 0,
        "allowedEngines": ["VECTOR", "PRIME"],
    }
    backend_app._INMEMORY_ENTITLEMENTS[paid_wallet_uid] = {
        **backend_app._default_entitlement(paid_wallet_uid),
        "plan": "Free",
        "paidVfBalance": 50,
        "allowedEngines": ["VECTOR"],
    }
    backend_app._INMEMORY_ENTITLEMENTS[paid_plan_uid] = {
        **backend_app._default_entitlement(paid_plan_uid),
        "plan": "Pro",
        "paidVfBalance": 0,
        "allowedEngines": ["VECTOR"],
    }

    client = TestClient(backend_app.app)

    dry_run = client.post("/admin/entitlements/reconcile-allowed-engines", json={"dryRun": True})
    assert dry_run.status_code == 200
    dry_run_payload = dry_run.json()
    assert dry_run_payload["scanned"] >= 3
    assert dry_run_payload["changed"] == 3
    assert dry_run_payload["unchanged"] == 0
    assert dry_run_payload["failures"] == 0
    assert set(dry_run_payload["sampleUserIds"]) == {free_uid, paid_wallet_uid, paid_plan_uid}
    assert backend_app._INMEMORY_ENTITLEMENTS[free_uid]["allowedEngines"] == ["VECTOR", "PRIME"]
    assert backend_app._INMEMORY_ENTITLEMENTS[paid_wallet_uid]["allowedEngines"] == ["VECTOR"]
    assert backend_app._INMEMORY_ENTITLEMENTS[paid_plan_uid]["allowedEngines"] == ["VECTOR"]

    apply_run = client.post("/admin/entitlements/reconcile-allowed-engines", json={"dryRun": False})
    assert apply_run.status_code == 200
    apply_payload = apply_run.json()
    assert apply_payload["scanned"] >= 3
    assert apply_payload["changed"] == 3
    assert apply_payload["unchanged"] == 0
    assert apply_payload["failures"] == 0
    assert set(apply_payload["sampleUserIds"]) == {free_uid, paid_wallet_uid, paid_plan_uid}
    assert backend_app._INMEMORY_ENTITLEMENTS[free_uid]["allowedEngines"] == ["VECTOR"]
    assert backend_app._INMEMORY_ENTITLEMENTS[paid_wallet_uid]["allowedEngines"] == ["VECTOR", "PRIME"]
    assert backend_app._INMEMORY_ENTITLEMENTS[paid_plan_uid]["allowedEngines"] == ["VECTOR", "PRIME"]

def test_admin_tts_synthesize_bypasses_daily_and_balance_limits(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_TTS_UPSTREAM_PROVIDER", "runtime")
    monkeypatch.setattr(backend_app, "VF_TTS_TEXTTOSPEECH_ONLY", False)
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeResponse())
    uid = "local_admin_unlimited"
    backend_app._INMEMORY_ENTITLEMENTS[uid] = {
        **backend_app._default_entitlement(uid),
        "monthlyVfLimit": 0,
        "vffBalance": 0,
        "paidVfBalance": 0,
    }

    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": uid}
    for i in range(3):
        response_code, _ = _submit_tts_and_wait_status(
            client,
            payload={"engine": "PRIME", "text": f"admin run {i}", "request_id": f"admin_req_{i}"},
            headers=headers,
        )
        assert response_code == 200

    ent = client.get("/account/entitlements", headers=headers)
    assert ent.status_code == 200
    payload = ent.json()["entitlements"]
    assert payload["daily"]["generationUsed"] == 3
    assert payload["monthly"]["vfUsed"] > 0

    event = backend_app._INMEMORY_USAGE_EVENTS.get(f"{uid}_admin_req_2")
    assert isinstance(event, dict)
    assert bool((event.get("limitBypass") or {}).get("enabled")) is True

class _DummyStripe:
    api_key = ""

    class Customer:
        @staticmethod
        def create(**kwargs):
            _ = kwargs
            return {"id": "cus_test_123"}

        @staticmethod
        def retrieve(customer_id, **kwargs):
            _ = kwargs
            return {
                "id": customer_id,
                "invoice_settings": {
                    "default_payment_method": {
                        "id": "pm_test_123",
                        "card": {
                            "brand": "visa",
                            "last4": "4242",
                            "exp_month": 12,
                            "exp_year": 2030,
                            "funding": "credit",
                        },
                    }
                },
            }

    class checkout:
        class Session:
            @staticmethod
            def create(**kwargs):
                _ = kwargs
                return {"id": "cs_test_123", "url": "https://checkout.test"}

    class billing_portal:
        class Session:
            @staticmethod
            def create(**kwargs):
                _ = kwargs
                return {"url": "https://portal.test"}

    class Webhook:
        @staticmethod
        def construct_event(payload, sig_header, secret):
            _ = sig_header
            _ = secret
            import json

            return json.loads(payload.decode("utf-8"))

    class Subscription:
        @staticmethod
        def retrieve(subscription_id, **kwargs):
            _ = kwargs
            return {
                "id": subscription_id,
                "status": "active",
                "current_period_start": 1761955200,
                "current_period_end": 1764547200,
                "cancel_at_period_end": False,
                "default_payment_method": {
                    "id": "pm_test_123",
                    "card": {
                        "brand": "visa",
                        "last4": "4242",
                        "exp_month": 12,
                        "exp_year": 2030,
                        "funding": "credit",
                    },
                },
                "items": {
                    "data": [
                        {
                            "price": {"id": backend_app.STRIPE_PRICE_PRO_RECURRING_INR},
                        }
                    ]
                },
                "latest_invoice": {"id": "in_test_001"},
            }

    class Invoice:
        @staticmethod
        def list(**kwargs):
            _ = kwargs
            return {
                "data": [
                    {
                        "id": "in_test_001",
                        "number": "VF-1001",
                        "status": "paid",
                        "description": "V FLOW AI Pro monthly",
                        "currency": "inr",
                        "amount_due": 216000,
                        "amount_paid": 216000,
                        "amount_remaining": 0,
                        "created": 1761955200,
                        "status_transitions": {"paid_at": 1761955300},
                        "hosted_invoice_url": "https://invoice.test/1001",
                        "invoice_pdf": "https://invoice.test/1001.pdf",
                        "billing_reason": "subscription_cycle",
                    },
                    {
                        "id": "in_test_002",
                        "number": "VF-1000",
                        "status": "paid",
                        "description": "V FLOW AI Pro monthly",
                        "currency": "inr",
                        "amount_due": 216000,
                        "amount_paid": 216000,
                        "amount_remaining": 0,
                        "created": 1759276800,
                        "status_transitions": {"paid_at": 1759276900},
                        "hosted_invoice_url": "https://invoice.test/1000",
                        "invoice_pdf": "https://invoice.test/1000.pdf",
                        "billing_reason": "subscription_cycle",
                    },
                ]
            }

def test_billing_webhook_updates_entitlement(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_IS_PRODUCTION", False)
    monkeypatch.setattr(backend_app, "VF_IS_LOCAL_DEV", True)
    monkeypatch.setattr(backend_app, "VF_RAZORPAY_WEBHOOK_ALLOW_UNSIGNED", True)
    monkeypatch.setattr(backend_app, "_razorpay_available", lambda: True)
    monkeypatch.setattr(backend_app, "_razorpay_webhook_secret", lambda: "")
    monkeypatch.setattr(
        backend_app,
        "_razorpay_plan_id_for_plan",
        lambda plan, phase="recurring": f"{plan}_{phase}_plan",
    )

    client = TestClient(backend_app.app)
    event_payload = {
        "id": "evt_sub_1",
        "event": "subscription.activated",
        "payload": {
            "subscription": {
                "entity": {
                    "id": "sub_test_123",
                    "plan_id": "pro_recurring_plan",
                    "customer_id": "cus_test_123",
                    "status": "active",
                    "notes": {"uid": "stripe_user_1"},
                    "current_start": 1761955200,
                    "current_end": 1764547200,
                    "start_at": 1761955200,
                    "charge_at": 1764547200,
                    "latest_invoice_id": "in_test_001",
                }
            }
        },
    }
    response = client.post("/billing/webhook", json=event_payload)
    assert response.status_code == 200
    ent = backend_app._load_entitlement("stripe_user_1")
    assert ent["plan"] == "Pro"
    assert ent["monthlyVfLimit"] == backend_app.PLAN_LIMITS["pro"]["monthlyVfLimit"]

def test_tts_v2_create_prechecks_success_quota_before_reserving_usage(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    reserve_attempts: list[tuple[str, str, str]] = []
    usage_calls: list[tuple[str, str]] = []

    def _fail_reserve(uid, plan_name, plan_key, trace_id, *, request_fingerprint):
        reserve_attempts.append((uid, plan_name, request_fingerprint))
        raise backend_app.HTTPException(status_code=429, detail={"errorCode": "VF_TEST_QUOTA"})

    monkeypatch.setattr(backend_app, "_reserve_tts_success_quota", _fail_reserve)
    monkeypatch.setattr(
        backend_app,
        "_reserve_usage",
        lambda uid, request_id, *_args, **_kwargs: usage_calls.append((uid, request_id)),
    )
    monkeypatch.setattr(
        backend_app._TTS_V2_ENGINE,
        "create_job",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("create_job should not run after quota precheck failure")),
    )

    client = TestClient(backend_app.app)
    session_response = client.post("/tts/v2/sessions", headers={"x-dev-uid": "quota_precheck_user"})
    assert session_response.status_code == 201
    session_key = str(session_response.json().get("sessionKey") or "").strip()
    request_id = f"test_{uuid.uuid4().hex}"
    response = client.post(
        "/tts/v2/jobs",
        headers={
            "x-dev-uid": "quota_precheck_user",
            "x-vf-tts-session-key": session_key,
            "Idempotency-Key": request_id,
        },
        json={
            "request_id": request_id,
            "mode": "single_speaker",
            "engine": "VECTOR",
            "text": "hello world",
        },
    )
    assert response.status_code == 429
    assert reserve_attempts == [("quota_precheck_user", "Free", request_id)]
    assert usage_calls == []


def test_reserve_tts_success_quota_fails_closed_when_redis_is_required(monkeypatch) -> None:
    _reset_inmemory_state()
    metric_calls: list[str] = []

    class _FailClosedLimiter:
        def reserve_success(self, uid: str, plan_key: str, request_fingerprint: str = "") -> SuccessQuotaReservation:
            _ = uid, plan_key, request_fingerprint
            raise RuntimeError("Redis is required for success quota reservations.")

        def is_redis_required(self) -> bool:
            return True

        def is_redis_enabled(self) -> bool:
            return False

    monkeypatch.setattr(backend_app, "_TTS_SUCCESS_LIMITER", _FailClosedLimiter())
    monkeypatch.setattr(
        backend_app,
        "_record_tts_success_quota_reservation_metric",
        lambda metric_key, increment=1: metric_calls.extend([str(metric_key)] * max(1, int(increment))),
    )

    with pytest.raises(backend_app.HTTPException) as exc_info:
        backend_app._reserve_tts_success_quota(
            "quota_user",
            "Free",
            "free",
            "trace_redis_fail_closed",
            request_fingerprint="trace_redis_fail_closed",
        )

    assert exc_info.value.status_code == 503
    detail = dict(exc_info.value.detail or {})
    assert detail.get("errorCode") == backend_app.ADMISSION_DEPENDENCY_UNAVAILABLE
    assert detail.get("reason") == "redis_unavailable_for_reservation"
    assert detail.get("dependency") == "redis"
    assert metric_calls.count("reservation_denied_redis_unavailable") >= 1


def test_reserve_tts_success_quota_records_idempotent_reuse_metric(monkeypatch) -> None:
    _reset_inmemory_state()
    metric_calls: list[str] = []
    reused_reservation = SuccessQuotaReservation(
        allowed=True,
        reserved=False,
        committed=True,
        released=False,
        counted=False,
        idempotent_reuse=True,
        reservation_id="reservation_reused_1",
        backend="redis",
        redis_available=True,
        redis_required=True,
        snapshot=SuccessQuotaSnapshot(limit=5, used=2, remaining=3, reset_at_ms=1_762_000_000_000, window_seconds=60),
        error="",
    )

    class _ReuseLimiter:
        def reserve_success(self, uid: str, plan_key: str, request_fingerprint: str = "") -> SuccessQuotaReservation:
            _ = uid, plan_key, request_fingerprint
            return reused_reservation

        def is_redis_required(self) -> bool:
            return True

        def is_redis_enabled(self) -> bool:
            return True

    monkeypatch.setattr(backend_app, "_TTS_SUCCESS_LIMITER", _ReuseLimiter())
    monkeypatch.setattr(
        backend_app,
        "_record_tts_success_quota_reservation_metric",
        lambda metric_key, increment=1: metric_calls.extend([str(metric_key)] * max(1, int(increment))),
    )

    reservation, headers = backend_app._reserve_tts_success_quota(
        "quota_user",
        "Pro",
        "pro",
        "trace_idempotent_reuse",
        request_fingerprint="trace_idempotent_reuse",
    )

    assert reservation.idempotent_reuse is True
    assert int(headers.get("X-RateLimit-Success-Remaining") or 0) == 3
    assert "reservation_idempotent_reuse" in metric_calls


def test_tts_v2_create_attaches_success_quota_reservation_payload(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    reservation = SuccessQuotaReservation(
        allowed=True,
        reserved=True,
        committed=False,
        released=False,
        counted=True,
        idempotent_reuse=False,
        reservation_id="reservation-123",
        backend="memory",
        redis_available=False,
        redis_required=False,
        snapshot=SuccessQuotaSnapshot(limit=2, used=1, remaining=1, reset_at_ms=1_762_000_000_000, window_seconds=60),
        error="",
    )
    reserve_headers = {"X-RateLimit-Success-Limit": "2", "X-RateLimit-Success-Remaining": "1", "X-RateLimit-Success-Reset": "1762000000"}
    monkeypatch.setattr(backend_app, "_reserve_tts_success_quota", lambda *args, **kwargs: (reservation, reserve_headers))
    monkeypatch.setattr(backend_app, "_reserve_usage", lambda *args, **kwargs: None)

    captured: dict[str, object] = {}

    def _fake_create_job(**kwargs):
        captured["payload"] = dict(kwargs.get("payload") or {})
        return {
            "jobId": "job_reservation_1",
            "requestId": str((kwargs.get("payload") or {}).get("request_id") or ""),
            "traceId": str((kwargs.get("payload") or {}).get("trace_id") or ""),
            "status": "queued",
            "engine": str((kwargs.get("payload") or {}).get("engine") or "PRIME"),
            "payload": dict(kwargs.get("payload") or {}),
        }

    monkeypatch.setattr(backend_app._TTS_V2_ENGINE, "create_job", _fake_create_job)
    monkeypatch.setattr(
        backend_app._TTS_V2_ENGINE,
        "status_payload",
        lambda job, include_chunks=False, include_result=False: {
            "ok": True,
            "accepted": True,
            "jobId": str((job or {}).get("jobId") or "job_reservation_1"),
            "requestId": str((job or {}).get("requestId") or ""),
            "traceId": str((job or {}).get("traceId") or ""),
            "status": "queued",
        },
    )

    client = TestClient(backend_app.app)
    session_response = client.post("/tts/v2/sessions", headers={"x-dev-uid": "reservation_payload_user"})
    assert session_response.status_code == 201
    session_key = str(session_response.json().get("sessionKey") or "").strip()
    request_id = f"test_{uuid.uuid4().hex}"
    response = client.post(
        "/tts/v2/jobs",
        headers={
            "x-dev-uid": "reservation_payload_user",
            "x-vf-tts-session-key": session_key,
            "Idempotency-Key": request_id,
        },
        json={
            "request_id": request_id,
            "mode": "single_speaker",
            "engine": "VECTOR",
            "text": "hello world",
        },
    )
    assert response.status_code == 202
    payload = captured.get("payload") or {}
    assert isinstance(payload, dict)
    quota_payload = payload.get("successQuotaReservation") or {}
    assert isinstance(quota_payload, dict)
    assert quota_payload["reservationId"] == "reservation-123"
    assert payload["successQuotaReservationToken"] == "reservation-123"
    assert int(quota_payload.get("snapshot", {}).get("used") or 0) == 1

def test_success_quota_reservation_lifecycle_uses_memory_fallback() -> None:
    limiter = SuccessQuotaLimiter(redis_url="", window_seconds=30, idempotency_ttl_seconds=120)

    first = limiter.reserve_success("quota_user", "free", "fp-1")
    assert first.allowed is True
    assert first.reserved is True
    assert first.committed is False
    assert first.counted is True
    assert first.idempotent_reuse is False
    assert first.backend == "memory"
    assert first.redis_available is False
    assert first.snapshot.used == 1

    reused = limiter.reserve_success("quota_user", "free", "fp-1")
    assert reused.allowed is True
    assert reused.reserved is False
    assert reused.committed is False
    assert reused.counted is False
    assert reused.idempotent_reuse is True
    assert reused.reservation_id == first.reservation_id
    assert reused.snapshot.used == 1

    committed = limiter.commit_success_reservation(first)
    assert committed.allowed is True
    assert committed.reserved is False
    assert committed.committed is True
    assert committed.released is False
    assert committed.snapshot.used == 1

    legacy = limiter.commit_success("quota_user", "free", "fp-1")
    assert legacy.allowed is True
    assert legacy.counted is False
    assert legacy.idempotent_reuse is True
    assert legacy.snapshot.used == 1

    second = limiter.reserve_success("quota_user", "free", "fp-2")
    assert second.allowed is True
    assert second.reserved is True
    assert second.counted is True
    assert second.snapshot.used == 2

    released = limiter.release_success_reservation(second)
    assert released.allowed is True
    assert released.released is True
    assert released.snapshot.used == 1

    after_release = limiter.reserve_success("quota_user", "free", "fp-3")
    assert after_release.allowed is True
    assert after_release.counted is True
    assert after_release.snapshot.used == 2

def test_success_quota_reservation_requires_redis_when_configured() -> None:
    limiter = SuccessQuotaLimiter(redis_url="", require_redis=True)

    assert limiter.is_redis_enabled() is False
    assert limiter.is_redis_required() is True

    with pytest.raises(RuntimeError):
        limiter.reserve_success("quota_user", "free", "fp-1")

    with pytest.raises(RuntimeError):
        limiter.commit_success("quota_user", "free", "fp-1")

    with pytest.raises(RuntimeError):
        limiter.peek("quota_user", "free")

def test_billing_account_summary_returns_subscription_and_invoices(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_razorpay_available", lambda: True)
    monkeypatch.setattr(backend_app, "_razorpay_key_id", lambda: "rzp_test_key")
    monkeypatch.setattr(backend_app, "_razorpay_key_secret", lambda: "rzp_test_secret")
    monkeypatch.setattr(
        backend_app,
        "_razorpay_plan_id_for_plan",
        lambda plan, phase="recurring": f"{plan}_{phase}_plan",
    )
    monkeypatch.setattr(
        backend_app.razorpay_billing,
        "fetch_customer",
        lambda **_kwargs: {"customer_id": "cus_test_123", "id": "cus_test_123", "name": "Summary User"},
    )
    monkeypatch.setattr(
        backend_app.razorpay_billing,
        "fetch_subscription",
        lambda **_kwargs: {
            "subscription_id": "sub_test_123",
            "plan_id": "pro_recurring_plan",
            "customer_id": "cus_test_123",
            "status": "active",
            "current_start": 1761955200,
            "current_end": 1764547200,
            "start_at": 1761955200,
            "charge_at": 1764547200,
            "latest_invoice_id": "in_test_001",
        },
    )
    monkeypatch.setattr(
        backend_app.razorpay_billing,
        "list_customer_payments",
        lambda *_args, **_kwargs: {
            "items": [
                {
                    "payment_id": "pay_test_001",
                    "id": "pay_test_001",
                    "status": "captured",
                    "amount_minor": 216000,
                    "currency": "INR",
                    "method": "card",
                    "created_at": 1759276800,
                    "raw": {
                        "id": "pm_test_123",
                        "card": {
                            "brand": "visa",
                            "last4": "4242",
                            "exp_month": 12,
                            "exp_year": 2030,
                            "funding": "credit",
                        },
                    },
                },
                {
                    "payment_id": "pay_test_002",
                    "id": "pay_test_002",
                    "status": "captured",
                    "amount_minor": 120000,
                    "currency": "INR",
                    "method": "card",
                    "created_at": 1759190400,
                    "raw": {
                        "id": "pm_test_456",
                        "card": {
                            "brand": "visa",
                            "last4": "1111",
                            "exp_month": 11,
                            "exp_year": 2031,
                            "funding": "debit",
                        },
                    },
                },
            ]
        },
    )
    monkeypatch.setattr(
        backend_app.razorpay_billing,
        "list_customer_subscriptions",
        lambda *_args, **_kwargs: {
            "items": [
                {
                    "subscription_id": "sub_test_123",
                    "plan_id": "pro_recurring_plan",
                    "customer_id": "cus_test_123",
                    "status": "active",
                    "current_start": 1761955200,
                    "current_end": 1764547200,
                    "start_at": 1761955200,
                    "charge_at": 1764547200,
                    "latest_invoice_id": "in_test_001",
                }
            ]
        },
    )

    uid = "billing_summary_user"
    backend_app._INMEMORY_ENTITLEMENTS[uid] = {
        **backend_app._default_entitlement(uid),
        "plan": "Pro",
        "status": "active",
        "monthlyVfLimit": backend_app.PLAN_LIMITS["pro"]["monthlyVfLimit"],
        "razorpayCustomerId": "cus_test_123",
        "subscriptionId": "sub_test_123",
        "billingCountry": "IN",
    }
    backend_app._INMEMORY_USER_PROFILES[uid] = {
        "uid": uid,
        "userId": "summary_user",
        "displayName": "Summary User",
        "email": "summary@example.com",
        "billingProfile": {
            "companyName": "Summary User Studio",
            "billingEmail": "billing@summary.example.com",
            "addressLine1": "1 Residency Road",
            "city": "Bengaluru",
            "country": "India",
        },
        "createdAt": "2026-01-01T00:00:00+00:00",
    }

    client = TestClient(backend_app.app)
    response = client.get("/billing/account-summary", headers={"x-dev-uid": uid})
    assert response.status_code == 200
    payload = response.json()["summary"]
    assert payload["plan"]["key"] == "pro"
    assert "dailyGenerationLimit" not in payload["plan"]
    assert payload["plan"]["pricing"]["discountPercent"] == 0
    assert payload["plan"]["vcTokenPackDiscountPercent"] == 5
    assert int(payload["plan"]["ttsSuccessRpm"]) == int(
        backend_app._TTS_SUCCESS_LIMITER.quota_for_plan(backend_app._tts_success_bucket_for_plan("pro"))
    )
    assert payload["billing"]["hasPortalAccess"] is True
    assert payload["subscription"]["active"] is True
    assert payload["subscription"]["latestInvoiceId"] == "in_test_001"
    assert payload["paymentMethod"]["last4"] == "4242"
    assert payload["profile"]["billingProfile"]["companyName"] == "Summary User Studio"
    assert len(payload["invoices"]) == 2
    assert payload["invoices"][0]["amountPaidMinor"] == 216000

def test_wallet_coupon_redeem_once_per_user(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    uid = "coupon_user_1"
    backend_app._INMEMORY_COUPONS["coupon_1"] = {
        "id": "coupon_1",
        "code": "WELCOME1000",
        "creditVf": 1000,
        "active": True,
        "redeemedCount": 0,
        "maxRedemptions": 100,
    }
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": uid}

    first = client.post("/wallet/coupons/redeem", json={"code": "WELCOME1000"}, headers=headers)
    assert first.status_code == 200
    assert first.json()["creditedVf"] == 1000
    ent = backend_app._load_entitlement(uid)
    assert ent["paidVfBalance"] == 1000

    second = client.post("/wallet/coupons/redeem", json={"code": "WELCOME1000"}, headers=headers)
    assert second.status_code == 409

def test_admin_wallet_coupon_redeem_bypasses_user_and_max_limits(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_ADMIN_COUPON_LIMIT_BYPASS", True)
    uid = "local_admin_coupon"
    backend_app._INMEMORY_COUPONS["coupon_admin"] = {
        "id": "coupon_admin",
        "code": "ADMIN1000",
        "creditVf": 1000,
        "active": True,
        "redeemedCount": 0,
        "maxRedemptions": 1,
    }
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": uid}

    first = client.post("/wallet/coupons/redeem", json={"code": "ADMIN1000"}, headers=headers)
    second = client.post("/wallet/coupons/redeem", json={"code": "ADMIN1000"}, headers=headers)
    third = client.post("/wallet/coupons/redeem", json={"code": "ADMIN1000"}, headers=headers)
    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 200

    ent = backend_app._load_entitlement(uid)
    assert ent["paidVfBalance"] == 3000
    assert backend_app._INMEMORY_COUPONS["coupon_admin"]["redeemedCount"] == 3
    assert len(backend_app._INMEMORY_COUPON_REDEMPTIONS) == 3

def test_token_pack_webhook_is_idempotent(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_IS_PRODUCTION", False)
    monkeypatch.setattr(backend_app, "VF_IS_LOCAL_DEV", True)
    monkeypatch.setattr(backend_app, "VF_RAZORPAY_WEBHOOK_ALLOW_UNSIGNED", True)
    monkeypatch.setattr(backend_app, "_razorpay_available", lambda: True)
    monkeypatch.setattr(backend_app, "_razorpay_webhook_secret", lambda: "")

    client = TestClient(backend_app.app)
    event_payload = {
        "id": "evt_token_pack_1",
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_token_pack_1",
                    "order_id": "order_token_pack_1",
                    "notes": {
                        "kind": "token_pack",
                        "uid": "wallet_user_1",
                        "packKey": "micro",
                        "packVf": "50000",
                        "standardAmountInr": "550",
                        "finalAmountInr": "550",
                    },
                    "customer_id": "cus_wallet_1",
                    "amount": 55000,
                    "currency": "INR",
                }
            }
        }
    }
    first = client.post("/billing/webhook", json=event_payload)
    second = client.post("/billing/webhook", json=event_payload)
    assert first.status_code == 200
    assert second.status_code == 200
    entitlement = backend_app._load_entitlement("wallet_user_1")
    assert entitlement["paidVfBalance"] == 50000
    lots = entitlement.get("paidVfLots") or []
    assert len(lots) == 1
    lot = lots[0]
    assert lot.get("source") == "token_pack"
    assert str(lot.get("expiresAt") or "").strip()

def test_token_pack_webhook_uses_amount_fallback_when_final_amount_missing(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_IS_PRODUCTION", False)
    monkeypatch.setattr(backend_app, "VF_IS_LOCAL_DEV", True)
    monkeypatch.setattr(backend_app, "VF_RAZORPAY_WEBHOOK_ALLOW_UNSIGNED", True)
    monkeypatch.setattr(backend_app, "_razorpay_available", lambda: True)
    monkeypatch.setattr(backend_app, "_razorpay_webhook_secret", lambda: "")
    monkeypatch.setattr(backend_app, "_firestore_collection", lambda _name: None)
    captured: list[dict] = []
    monkeypatch.setattr(
        backend_app,
        "_credit_paid_vf",
        lambda **kwargs: captured.append(dict(kwargs)),
    )

    client = TestClient(backend_app.app)
    event_payload = {
        "id": "evt_token_pack_fallback_1",
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_token_pack_fallback_1",
                    "order_id": "order_token_pack_fallback_1",
                    "notes": {
                        "kind": "token_pack",
                        "uid": "wallet_fallback_user",
                        "packKey": "micro",
                        "packVf": "50000",
                        "standardAmountInr": "550",
                    },
                    "customer_id": "cus_wallet_fallback_1",
                    "amount": 55000,
                    "currency": "INR",
                }
            }
        },
    }
    response = client.post("/billing/webhook", json=event_payload)
    assert response.status_code == 200
    assert len(captured) == 1
    assert captured[0]["amount"] == 50000
    assert int((captured[0].get("metadata") or {}).get("finalAmountInr") or 0) == 550

def test_vc_token_pack_webhook_credits_vc_wallet(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_IS_PRODUCTION", False)
    monkeypatch.setattr(backend_app, "VF_IS_LOCAL_DEV", True)
    monkeypatch.setattr(backend_app, "VF_RAZORPAY_WEBHOOK_ALLOW_UNSIGNED", True)
    monkeypatch.setattr(backend_app, "_razorpay_available", lambda: True)
    monkeypatch.setattr(backend_app, "_razorpay_webhook_secret", lambda: "")

    client = TestClient(backend_app.app)
    event_payload = {
        "id": "evt_vc_token_pack_1",
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_vc_token_pack_1",
                    "order_id": "order_vc_token_pack_1",
                    "notes": {
                        "kind": "vc_token_pack",
                        "uid": "vc_wallet_user_1",
                        "packKey": "pro",
                        "packVc": "1500",
                        "standardAmountInr": "3000",
                        "finalAmountInr": "2850",
                        "discountPercent": "5",
                    },
                    "customer_id": "cus_vc_wallet_1",
                    "amount": 285000,
                    "currency": "INR",
                }
            }
        },
    }
    first = client.post("/billing/webhook", json=event_payload)
    second = client.post("/billing/webhook", json=event_payload)
    assert first.status_code == 200
    assert second.status_code == 200
    entitlement = backend_app._load_entitlement("vc_wallet_user_1")
    assert entitlement["vcPaidBalance"] == 1500

def test_wallet_vc_convert_requires_config(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_VC_CONVERSION_RATE", 0.0)
    client = TestClient(backend_app.app)
    response = client.post(
        "/wallet/vc/convert",
        json={"vfAmount": 10},
        headers={"x-dev-uid": "vc_convert_user"},
    )
    assert response.status_code == 503
    detail = response.json().get("detail") or {}
    assert str(detail.get("errorCode") or "") == "VC_CONVERSION_CONFIG_REQUIRED"

def test_wallet_vc_convert_debits_paid_vf_and_credits_vc(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_VC_CONVERSION_RATE", 2.5)
    uid = "vc_convert_success_user"
    backend_app._credit_paid_vf(
        uid=uid,
        amount=120,
        reason="seed_wallet",
        transaction_id="seed_wallet_credit",
        metadata={"kind": "seed"},
    )
    client = TestClient(backend_app.app)
    response = client.post(
        "/wallet/vc/convert",
        json={"vfAmount": 40},
        headers={"x-dev-uid": uid},
    )
    assert response.status_code == 200
    payload = response.json()
    assert float(payload["vfDebited"]) == 40.0
    assert float(payload["vcCredited"]) == 100.0
    entitlement = backend_app._load_entitlement(uid)
    assert float(entitlement["paidVfBalance"]) == 80.0
    assert float(entitlement["vcPaidBalance"]) == 100.0

def test_wallet_vc_convert_returns_429_when_paid_vf_is_insufficient(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_VC_CONVERSION_RATE", 1.0)
    uid = "vc_convert_insufficient_user"
    backend_app._credit_paid_vf(
        uid=uid,
        amount=5,
        reason="seed_wallet",
        transaction_id="seed_wallet_credit_insufficient",
        metadata={"kind": "seed"},
    )
    client = TestClient(backend_app.app)
    response = client.post(
        "/wallet/vc/convert",
        json={"vfAmount": 15},
        headers={"x-dev-uid": uid},
    )
    assert response.status_code == 429

def test_vc_token_pack_checkout_requires_config(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_razorpay_available", lambda: True)
    monkeypatch.setattr(backend_app, "VC_TOKEN_PACK_CATALOG", {})
    client = TestClient(backend_app.app)
    response = client.post(
        "/billing/vc-token-pack/checkout-session",
        json={"pack": "standard"},
        headers={"x-dev-uid": "vc_checkout_user", "Idempotency-Key": "vc_checkout_user:vc:standard:1"},
    )
    assert response.status_code == 503
    detail = response.json().get("detail") or {}
    assert str(detail.get("errorCode") or "") == "VC_TOKEN_PACK_CONFIG_REQUIRED"

def test_vc_token_pack_checkout_session_returns_razorpay_payload(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_razorpay_available", lambda: True)
    monkeypatch.setattr(
        backend_app,
        "VC_TOKEN_PACK_CATALOG",
        {
            "starter": {"vc": 55, "priceInr": 110},
            "standard": {"vc": 200, "priceInr": 400},
            "growth": {"vc": 500, "priceInr": 1000},
            "pro": {"vc": 1500, "priceInr": 3000},
            "scale": {"vc": 2600, "priceInr": 5000},
        },
    )
    captured_orders: list[dict] = []

    def _fake_create_one_time_order(**kwargs):
        captured_orders.append(dict(kwargs))
        return {"id": "order_vc_pack_1", "order_id": "order_vc_pack_1"}

    monkeypatch.setattr(backend_app.razorpay_billing, "create_one_time_order", _fake_create_one_time_order)

    client = TestClient(backend_app.app)
    response = client.post(
        "/billing/vc-token-pack/checkout-session",
        json={"pack": "starter"},
        headers={"x-dev-uid": "vc_checkout_success_user", "Idempotency-Key": "vc_checkout_success_user:vc:starter:1"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["packKey"] == "starter"
    assert int(body["packVc"]) == 55
    assert int(body["standardAmountInr"]) == 110
    assert int(body["finalAmountInr"]) == 110
    assert int(body["discountPercent"]) == 0
    assert len(captured_orders) == 1
    notes = captured_orders[0].get("notes") or {}
    assert str(notes.get("kind") or "") == "vc_token_pack"
    assert int(notes.get("packVc") or 0) == 55
    assert int(notes.get("standardAmountInr") or 0) == 110
    assert int(notes.get("finalAmountInr") or 0) == 110
    assert int(notes.get("discountPercent") or 0) == 0

@pytest.mark.parametrize(
    ("plan_name", "pack_key", "expected_vc", "expected_standard", "expected_final"),
    [
        ("Pro", "growth", 500, 1000, 950),
        ("Scale", "scale", 2600, 5000, 4750),
    ],
)
def test_vc_token_pack_checkout_applies_plan_discount(
    monkeypatch,
    plan_name,
    pack_key,
    expected_vc,
    expected_standard,
    expected_final,
) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_razorpay_available", lambda: True)
    monkeypatch.setattr(
        backend_app,
        "VC_TOKEN_PACK_CATALOG",
        {
            "starter": {"vc": 55, "priceInr": 110},
            "standard": {"vc": 200, "priceInr": 400},
            "growth": {"vc": 500, "priceInr": 1000},
            "pro": {"vc": 1500, "priceInr": 3000},
            "scale": {"vc": 2600, "priceInr": 5000},
        },
    )
    monkeypatch.setattr(
        backend_app,
        "_load_entitlement",
        lambda uid: {
            **backend_app._default_entitlement(uid),
            "plan": plan_name,
        },
    )
    captured_orders: list[dict] = []

    def _fake_create_one_time_order(**kwargs):
        captured_orders.append(dict(kwargs))
        return {"id": f"order_{pack_key}_discount", "order_id": f"order_{pack_key}_discount"}

    monkeypatch.setattr(backend_app.razorpay_billing, "create_one_time_order", _fake_create_one_time_order)

    client = TestClient(backend_app.app)
    response = client.post(
        "/billing/vc-token-pack/checkout-session",
        json={"pack": pack_key},
        headers={"x-dev-uid": f"{pack_key}_discount_user", "Idempotency-Key": f"{pack_key}_discount_user:vc:{pack_key}:1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["packKey"] == pack_key
    assert int(body["packVc"]) == expected_vc
    assert int(body["standardAmountInr"]) == expected_standard
    assert int(body["finalAmountInr"]) == expected_final
    assert int(body["discountPercent"]) == 5
    assert len(captured_orders) == 1
    notes = captured_orders[0].get("notes") or {}
    assert int(notes.get("standardAmountInr") or 0) == expected_standard
    assert int(notes.get("finalAmountInr") or 0) == expected_final
    assert int(notes.get("discountPercent") or 0) == 5

def test_vc_monthly_grants_normalized_for_pro_and_scale() -> None:
    _reset_inmemory_state()
    now = datetime(2026, 3, 15, tzinfo=timezone.utc)
    month_key = backend_app._wallet_month_key(now)

    pro_wallet = backend_app._normalize_entitlement_wallet(
        {
            "uid": "pro_user",
            "plan": "Pro",
            "vcMonthKey": "2026-02",
            "vcGrantMonthKey": "2026-02",
            "vcFreeBalance": 0,
            "vcPaidBalance": 0,
        },
        now,
    )
    scale_wallet = backend_app._normalize_entitlement_wallet(
        {
            "uid": "scale_user",
            "plan": "Scale",
            "vcMonthKey": "2026-02",
            "vcGrantMonthKey": "2026-02",
            "vcFreeBalance": 0,
            "vcPaidBalance": 0,
        },
        now,
    )
    free_wallet = backend_app._normalize_entitlement_wallet(
        {
            "uid": "free_user",
            "plan": "Free",
            "vcMonthKey": "2026-02",
            "vcGrantMonthKey": "2026-02",
            "vcFreeBalance": 0,
            "vcPaidBalance": 0,
        },
        now,
    )

    assert str(pro_wallet.get("vcMonthKey") or "") == month_key
    assert str(scale_wallet.get("vcMonthKey") or "") == month_key
    assert str(free_wallet.get("vcMonthKey") or "") == month_key
    assert float(pro_wallet.get("vcFreeBalance") or 0) == float(backend_app.VC_FREE_MONTHLY_GRANT_BY_PLAN["pro"])
    assert float(scale_wallet.get("vcFreeBalance") or 0) == float(backend_app.VC_FREE_MONTHLY_GRANT_BY_PLAN["scale"])
    assert float(free_wallet.get("vcFreeBalance") or 0) == 0.0

def test_billing_webhook_rejects_oversized_payload(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_IS_PRODUCTION", False)
    monkeypatch.setattr(backend_app, "VF_IS_LOCAL_DEV", True)
    monkeypatch.setattr(backend_app, "VF_RAZORPAY_WEBHOOK_ALLOW_UNSIGNED", True)
    monkeypatch.setattr(backend_app, "VF_BILLING_WEBHOOK_MAX_BODY_BYTES", 128)
    monkeypatch.setattr(backend_app, "_razorpay_available", lambda: True)
    monkeypatch.setattr(backend_app, "_razorpay_webhook_secret", lambda: "")

    client = TestClient(backend_app.app)
    oversized = "x" * 512
    response = client.post(
        "/billing/webhook",
        data=oversized,
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 413

def test_process_tts_job_finalizes_cancelled_usage(monkeypatch) -> None:
    _reset_inmemory_state()
    finalize_calls: list[tuple[str, str, bool, str]] = []
    monkeypatch.setattr(
        backend_app._TTS_JOB_QUEUE,
        "mark_running",
        lambda job_id, worker_id=None: {
            "jobId": job_id,
            "requestId": "cancel_req_1",
            "traceId": "cancel_req_1",
            "uid": "cancel_user",
            "engine": "VECTOR",
            "status": "cancelled",
        },
    )
    monkeypatch.setattr(backend_app, "_audio_generation_audit_ids_from_job", lambda _job: [])
    monkeypatch.setattr(
        backend_app,
        "_finalize_usage",
        lambda uid, request_id, success, error_detail="": finalize_calls.append((uid, request_id, bool(success), str(error_detail))),
    )
    monkeypatch.setattr(backend_app, "_record_tts_terminal_event", lambda **_kwargs: None)
    monkeypatch.setattr(backend_app, "_audio_generation_audit_mark_terminal", lambda *args, **kwargs: None)

    backend_app._process_tts_job({"jobId": "cancel_req_1"}, "worker-1")
    assert finalize_calls == [("cancel_user", "cancel_req_1", False, "cancelled")]

def test_process_tts_job_finalizes_after_mark_completed(monkeypatch) -> None:
    _reset_inmemory_state()
    call_order: list[str] = []
    monkeypatch.setattr(
        backend_app._TTS_JOB_QUEUE,
        "mark_running",
        lambda job_id, worker_id=None: {
            "jobId": job_id,
            "requestId": "success_req_1",
            "traceId": "success_req_1",
            "uid": "success_user",
            "engine": "VECTOR",
            "status": "queued",
            "text": "hello",
            "voiceId": "voice_1",
            "voiceName": "Voice 1",
            "planName": "Free",
            "planKey": "free",
            "payload": {"engine": "VECTOR", "text": "hello"},
            "adminLimitBypass": True,
        },
    )
    monkeypatch.setattr(backend_app, "_audio_generation_audit_ids_from_job", lambda _job: [])
    monkeypatch.setattr(backend_app, "_record_tts_job_started", lambda **_kwargs: None)
    monkeypatch.setattr(backend_app, "_audio_generation_audit_update", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_runtime_url_for_engine", lambda _engine: "http://runtime")
    monkeypatch.setattr(backend_app, "_runtime_synthesize_path_for_engine", lambda _engine: "/v1/synthesize")
    monkeypatch.setattr(backend_app, "_post_tts_conversion_status_for_engine", lambda **_kwargs: "")
    monkeypatch.setattr(
        backend_app,
        "_runtime_tts_request_with_gemini_failover",
        lambda *args, **kwargs: _DummyRuntimeResponse(content=_DummyRuntimeResponse().content),
    )
    monkeypatch.setattr(
        backend_app,
        "_persist_tts_result_audio",
        lambda *args, **kwargs: call_order.append("persist") or {"path": "result.wav"},
    )
    monkeypatch.setattr(
        backend_app._TTS_JOB_QUEUE,
        "mark_completed",
        lambda *args, **kwargs: call_order.append("mark_completed") or {"jobId": "success_req_1", "requestId": "success_req_1"},
    )
    monkeypatch.setattr(
        backend_app,
        "_usage_event_attach_runtime_usage",
        lambda *args, **kwargs: call_order.append("attach_usage"),
    )
    monkeypatch.setattr(
        backend_app,
        "_finalize_usage",
        lambda *args, **kwargs: call_order.append("finalize"),
    )
    monkeypatch.setattr(
        backend_app,
        "_build_tts_history_item",
        lambda *args, **kwargs: call_order.append("history"),
    )
    monkeypatch.setattr(backend_app, "_audio_generation_audit_mark_terminal", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_record_tts_terminal_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_notification_emit_tts_job_terminal", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_record_tts_runtime_latency", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_admin_usage_record_runtime_call", lambda *args, **kwargs: None)

    backend_app._process_tts_job({"jobId": "success_req_1"}, "worker-1")
    assert call_order[:4] == ["persist", "mark_completed", "attach_usage", "finalize"]

def test_process_tts_job_uses_payload_when_upstream_payload_missing(monkeypatch) -> None:
    _reset_inmemory_state()
    call_order: list[str] = []
    captured_runtime_payload: dict[str, object] = {}
    monkeypatch.setattr(
        backend_app._TTS_JOB_QUEUE,
        "mark_running",
        lambda job_id, worker_id=None: {
            "jobId": job_id,
            "requestId": "payload_req_1",
            "traceId": "payload_req_1",
            "uid": "payload_user",
            "engine": "VECTOR",
            "status": "queued",
            "text": "hello",
            "voiceId": "voice_1",
            "voiceName": "Voice 1",
            "planName": "Free",
            "planKey": "free",
            "payload": {"engine": "VECTOR", "text": "hello from payload"},
            "adminLimitBypass": True,
        },
    )
    monkeypatch.setattr(backend_app, "_audio_generation_audit_ids_from_job", lambda _job: [])
    monkeypatch.setattr(backend_app, "_record_tts_job_started", lambda **_kwargs: None)
    monkeypatch.setattr(backend_app, "_audio_generation_audit_update", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_runtime_url_for_engine", lambda _engine: "http://runtime")
    monkeypatch.setattr(backend_app, "_runtime_synthesize_path_for_engine", lambda _engine: "/v1/synthesize")
    monkeypatch.setattr(backend_app, "_post_tts_conversion_status_for_engine", lambda **_kwargs: "")

    def _fake_runtime_request(*args, **kwargs):
        _ = args
        captured_runtime_payload.update(dict(kwargs.get("json") or {}))
        return _DummyRuntimeResponse(content=_DummyRuntimeResponse().content)

    monkeypatch.setattr(backend_app, "_runtime_tts_request_with_gemini_failover", _fake_runtime_request)
    monkeypatch.setattr(
        backend_app,
        "_persist_tts_result_audio",
        lambda *args, **kwargs: call_order.append("persist") or {"path": "result.wav"},
    )
    monkeypatch.setattr(
        backend_app._TTS_JOB_QUEUE,
        "mark_completed",
        lambda *args, **kwargs: call_order.append("mark_completed") or {"jobId": "payload_req_1", "requestId": "payload_req_1"},
    )
    monkeypatch.setattr(
        backend_app,
        "_usage_event_attach_runtime_usage",
        lambda *args, **kwargs: call_order.append("attach_usage"),
    )
    monkeypatch.setattr(
        backend_app,
        "_finalize_usage",
        lambda *args, **kwargs: call_order.append("finalize"),
    )
    monkeypatch.setattr(
        backend_app,
        "_build_tts_history_item",
        lambda *args, **kwargs: call_order.append("history"),
    )
    monkeypatch.setattr(backend_app, "_audio_generation_audit_mark_terminal", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_record_tts_terminal_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_notification_emit_tts_job_terminal", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_record_tts_runtime_latency", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_admin_usage_record_runtime_call", lambda *args, **kwargs: None)

    backend_app._process_tts_job({"jobId": "payload_req_1"}, "worker-1")
    assert captured_runtime_payload["text"] == "hello from payload"
    assert captured_runtime_payload["engine"] == "VECTOR"
    assert call_order[:4] == ["persist", "mark_completed", "attach_usage", "finalize"]

def test_process_tts_job_updates_audio_audit_lifecycle_and_terminal_fields(monkeypatch) -> None:
    _reset_inmemory_state()
    audit_id = "audit_submit_123"
    backend_app._audio_generation_audit_create(
        {
            "auditId": audit_id,
            "uid": "submit_user",
            "userId": "submit_user",
            "submittedAt": backend_app._utc_now().isoformat(),
            "status": "received",
            "engine": "VECTOR",
            "requestId": "req_submit_123",
            "jobId": "job_submit_123",
            "traceId": "trace_submit_123",
            "inputText": "audio audit lifecycle",
            "sourceIp": "203.0.113.9",
        }
    )

    monkeypatch.setattr(
        backend_app._TTS_JOB_QUEUE,
        "mark_running",
        lambda job_id, worker_id=None: {
            "jobId": job_id,
            "requestId": "req_submit_123",
            "traceId": "trace_submit_123",
            "uid": "submit_user",
            "engine": "VECTOR",
            "status": "queued",
            "text": "audio audit lifecycle",
            "voiceId": "voice_1",
            "voiceName": "Voice 1",
            "planName": "Free",
            "planKey": "free",
            "payload": {"engine": "VECTOR", "text": "audio audit lifecycle"},
            "audioAuditIds": [audit_id],
        },
    )
    monkeypatch.setattr(backend_app, "_record_tts_job_started", lambda **_kwargs: None)
    monkeypatch.setattr(backend_app, "_runtime_url_for_engine", lambda _engine: "http://runtime")
    monkeypatch.setattr(backend_app, "_runtime_synthesize_path_for_engine", lambda _engine: "/v1/synthesize")
    monkeypatch.setattr(backend_app, "_post_tts_conversion_status_for_engine", lambda **_kwargs: "")
    monkeypatch.setattr(
        backend_app,
        "_runtime_tts_request_with_gemini_failover",
        lambda *args, **kwargs: _DummyRuntimeResponse(content=_DummyRuntimeResponse().content),
    )
    monkeypatch.setattr(
        backend_app,
        "_persist_tts_result_audio",
        lambda *args, **kwargs: {"path": "result.wav"},
    )
    monkeypatch.setattr(
        backend_app._TTS_JOB_QUEUE,
        "mark_completed",
        lambda *args, **kwargs: {
            "jobId": "job_submit_123",
            "requestId": "req_submit_123",
            "audioAuditIds": [audit_id],
        },
    )
    monkeypatch.setattr(backend_app, "_usage_event_attach_runtime_usage", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_finalize_usage", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_build_tts_history_item", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_record_tts_terminal_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_notification_emit_tts_job_terminal", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_record_tts_runtime_latency", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_admin_usage_record_runtime_call", lambda *args, **kwargs: None)

    backend_app._process_tts_job({"jobId": "job_submit_123"}, "worker-1")

    row = backend_app._audio_generation_audit_get(audit_id)
    assert isinstance(row, dict)
    assert row["status"] == "completed"
    assert row["jobId"] == "job_submit_123"
    assert row["requestId"] == "req_submit_123"
    assert row["traceId"] == "trace_submit_123"
    assert str(row.get("audioCreatedAt") or "").strip()
    assert str(row.get("terminalAt") or "").strip()

def test_process_tts_job_commits_success_quota_reservation_on_success(monkeypatch) -> None:
    _reset_inmemory_state()
    call_order: list[str] = []
    reservation = SuccessQuotaReservation(
        allowed=True,
        reserved=True,
        committed=False,
        released=False,
        counted=True,
        idempotent_reuse=False,
        reservation_id="reservation-worker-success",
        backend="memory",
        redis_available=False,
        redis_required=False,
        snapshot=SuccessQuotaSnapshot(limit=2, used=1, remaining=1, reset_at_ms=1_762_000_000_000, window_seconds=60),
        error="",
    )

    class _FakeLimiter:
        def __init__(self) -> None:
            self.commits: list[SuccessQuotaReservation] = []
            self.releases: list[SuccessQuotaReservation] = []

        def commit_success_reservation(self, value):
            self.commits.append(value)
            call_order.append("commit_reservation")
            data = dict(value.__dict__)
            data["committed"] = True
            data["reserved"] = False
            data["counted"] = False
            return SuccessQuotaReservation(**data)

        def release_success_reservation(self, value):
            self.releases.append(value)
            call_order.append("release_reservation")
            data = dict(value.__dict__)
            data["released"] = True
            data["reserved"] = False
            data["counted"] = False
            return SuccessQuotaReservation(**data)

        def commit_success(self, *args, **kwargs):
            raise AssertionError("legacy commit path should not run when reservation is present")

        def peek(self, *args, **kwargs):
            return reservation.snapshot

    fake_limiter = _FakeLimiter()
    monkeypatch.setattr(backend_app, "_TTS_SUCCESS_LIMITER", fake_limiter)
    reservation_payload = backend_app._serialize_tts_success_quota_reservation(
        reservation,
        uid="worker_success_user",
        plan_name="Free",
        plan_key="free",
        trace_id="success_req_1",
        request_fingerprint="success_req_1",
    )
    monkeypatch.setattr(
        backend_app._TTS_JOB_QUEUE,
        "mark_running",
        lambda job_id, worker_id=None: {
            "jobId": job_id,
            "requestId": "success_req_1",
            "traceId": "success_req_1",
            "uid": "worker_success_user",
            "engine": "VECTOR",
            "status": "queued",
            "planName": "Free",
            "planKey": "free",
            "payload": {
                "request_id": "success_req_1",
                "trace_id": "success_req_1",
                "engine": "VECTOR",
                "text": "hello",
                "successQuotaReservation": reservation_payload,
            },
        },
    )
    monkeypatch.setattr(backend_app, "_audio_generation_audit_ids_from_job", lambda _job: [])
    monkeypatch.setattr(backend_app, "_record_tts_job_started", lambda **_kwargs: None)
    monkeypatch.setattr(backend_app, "_audio_generation_audit_update", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_runtime_url_for_engine", lambda _engine: "http://runtime")
    monkeypatch.setattr(backend_app, "_runtime_synthesize_path_for_engine", lambda _engine: "/v1/synthesize")
    monkeypatch.setattr(backend_app, "_post_tts_conversion_status_for_engine", lambda **_kwargs: "")
    monkeypatch.setattr(
        backend_app,
        "_runtime_tts_request_with_gemini_failover",
        lambda *args, **kwargs: _DummyRuntimeResponse(content=_DummyRuntimeResponse().content),
    )
    monkeypatch.setattr(
        backend_app,
        "_persist_tts_result_audio",
        lambda *args, **kwargs: call_order.append("persist") or {"path": "result.wav"},
    )
    monkeypatch.setattr(
        backend_app._TTS_JOB_QUEUE,
        "mark_completed",
        lambda *args, **kwargs: call_order.append("mark_completed") or {"jobId": "success_req_1", "requestId": "success_req_1", "status": "completed"},
    )
    monkeypatch.setattr(
        backend_app,
        "_usage_event_attach_runtime_usage",
        lambda *args, **kwargs: call_order.append("attach_usage"),
    )
    monkeypatch.setattr(
        backend_app,
        "_finalize_usage",
        lambda *args, **kwargs: call_order.append("finalize"),
    )
    monkeypatch.setattr(
        backend_app,
        "_build_tts_history_item",
        lambda *args, **kwargs: call_order.append("history"),
    )
    monkeypatch.setattr(backend_app, "_audio_generation_audit_mark_terminal", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_record_tts_terminal_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_notification_emit_tts_job_terminal", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_record_tts_runtime_latency", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_admin_usage_record_runtime_call", lambda *args, **kwargs: None)

    backend_app._process_tts_job({"jobId": "success_req_1"}, "worker-1")
    assert call_order[:5] == ["persist", "mark_completed", "commit_reservation", "attach_usage", "finalize"]
    assert len(fake_limiter.commits) == 1
    assert len(fake_limiter.releases) == 0

def test_process_tts_job_releases_success_quota_reservation_on_cancel(monkeypatch) -> None:
    _reset_inmemory_state()
    release_calls: list[SuccessQuotaReservation] = []
    reservation = SuccessQuotaReservation(
        allowed=True,
        reserved=True,
        committed=False,
        released=False,
        counted=True,
        idempotent_reuse=False,
        reservation_id="reservation-worker-cancel",
        backend="memory",
        redis_available=False,
        redis_required=False,
        snapshot=SuccessQuotaSnapshot(limit=2, used=1, remaining=1, reset_at_ms=1_762_000_000_000, window_seconds=60),
        error="",
    )
    reservation_payload = backend_app._serialize_tts_success_quota_reservation(
        reservation,
        uid="worker_cancel_user",
        plan_name="Free",
        plan_key="free",
        trace_id="cancel_req_1",
        request_fingerprint="cancel_req_1",
    )

    class _FakeLimiter:
        def release_success_reservation(self, value):
            release_calls.append(value)
            return value

    monkeypatch.setattr(backend_app, "_TTS_SUCCESS_LIMITER", _FakeLimiter())
    monkeypatch.setattr(
        backend_app._TTS_JOB_QUEUE,
        "mark_running",
        lambda job_id, worker_id=None: {
            "jobId": job_id,
            "requestId": "cancel_req_1",
            "traceId": "cancel_req_1",
            "uid": "worker_cancel_user",
            "engine": "VECTOR",
            "status": "cancelled",
            "planName": "Free",
            "planKey": "free",
            "payload": {
                "request_id": "cancel_req_1",
                "trace_id": "cancel_req_1",
                "engine": "VECTOR",
                "text": "hello",
                "successQuotaReservation": reservation_payload,
            },
        },
    )
    finalize_calls: list[tuple[str, str, bool, str]] = []
    monkeypatch.setattr(
        backend_app,
        "_finalize_usage",
        lambda uid, request_id, success, error_detail="": finalize_calls.append((uid, request_id, bool(success), str(error_detail))),
    )
    monkeypatch.setattr(backend_app, "_record_tts_terminal_event", lambda **_kwargs: None)
    monkeypatch.setattr(backend_app, "_audio_generation_audit_ids_from_job", lambda _job: [])
    monkeypatch.setattr(backend_app, "_audio_generation_audit_mark_terminal", lambda *args, **kwargs: None)

    backend_app._process_tts_job({"jobId": "cancel_req_1"}, "worker-1")
    assert finalize_calls == [("worker_cancel_user", "cancel_req_1", False, "cancelled")]
    assert len(release_calls) == 1

def test_process_tts_job_falls_back_to_direct_success_commit_when_reservation_commit_is_none(monkeypatch) -> None:
    _reset_inmemory_state()
    call_order: list[str] = []
    direct_commit_calls: list[dict] = []
    snapshot = SuccessQuotaSnapshot(limit=2, used=1, remaining=1, reset_at_ms=1_762_000_000_000, window_seconds=60)

    monkeypatch.setattr(
        backend_app._TTS_JOB_QUEUE,
        "mark_running",
        lambda job_id, worker_id=None: {
            "jobId": job_id,
            "requestId": "fallback_req_1",
            "traceId": "fallback_req_1",
            "uid": "worker_fallback_user",
            "engine": "VECTOR",
            "status": "queued",
            "planName": "Free",
            "planKey": "free",
            "payload": {
                "request_id": "fallback_req_1",
                "trace_id": "fallback_req_1",
                "engine": "VECTOR",
                "text": "hello",
                "successQuotaReservation": {"reservationId": "invalid_payload"},
            },
        },
    )
    monkeypatch.setattr(backend_app, "_audio_generation_audit_ids_from_job", lambda _job: [])
    monkeypatch.setattr(backend_app, "_record_tts_job_started", lambda **_kwargs: None)
    monkeypatch.setattr(backend_app, "_audio_generation_audit_update", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_runtime_url_for_engine", lambda _engine: "http://runtime")
    monkeypatch.setattr(backend_app, "_runtime_synthesize_path_for_engine", lambda _engine: "/v1/synthesize")
    monkeypatch.setattr(backend_app, "_post_tts_conversion_status_for_engine", lambda **_kwargs: "")
    monkeypatch.setattr(
        backend_app,
        "_runtime_tts_request_with_gemini_failover",
        lambda *args, **kwargs: _DummyRuntimeResponse(content=_DummyRuntimeResponse().content),
    )
    monkeypatch.setattr(
        backend_app,
        "_persist_tts_result_audio",
        lambda *args, **kwargs: call_order.append("persist") or {"path": "result.wav"},
    )
    monkeypatch.setattr(
        backend_app._TTS_JOB_QUEUE,
        "mark_completed",
        lambda *args, **kwargs: call_order.append("mark_completed") or {"jobId": "fallback_req_1", "requestId": "fallback_req_1", "status": "completed"},
    )
    monkeypatch.setattr(
        backend_app,
        "_usage_event_attach_runtime_usage",
        lambda *args, **kwargs: call_order.append("attach_usage"),
    )
    monkeypatch.setattr(
        backend_app,
        "_finalize_usage",
        lambda *args, **kwargs: call_order.append("finalize"),
    )
    monkeypatch.setattr(
        backend_app,
        "_build_tts_history_item",
        lambda *args, **kwargs: call_order.append("history"),
    )
    monkeypatch.setattr(backend_app, "_audio_generation_audit_mark_terminal", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_record_tts_terminal_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_notification_emit_tts_job_terminal", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_record_tts_runtime_latency", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_admin_usage_record_runtime_call", lambda *args, **kwargs: None)
    monkeypatch.setattr(backend_app, "_commit_tts_success_quota_reservation", lambda _payload: None)

    def _fake_commit_tts_success_quota(uid, plan_name, plan_key, trace_id, *, request_fingerprint):
        direct_commit_calls.append(
            {
                "uid": uid,
                "plan_name": plan_name,
                "plan_key": plan_key,
                "trace_id": trace_id,
                "request_fingerprint": request_fingerprint,
            }
        )
        call_order.append("commit_direct")
        return SuccessQuotaDecision(
            allowed=True,
            counted=True,
            idempotent_reuse=False,
            snapshot=snapshot,
        )

    monkeypatch.setattr(backend_app, "_commit_tts_success_quota", _fake_commit_tts_success_quota)

    backend_app._process_tts_job({"jobId": "fallback_req_1"}, "worker-1")

    assert len(direct_commit_calls) == 1
    assert call_order[:5] == ["persist", "mark_completed", "commit_direct", "attach_usage", "finalize"]

def test_token_pack_lot_has_6_month_expiry_window() -> None:
    _reset_inmemory_state()
    uid = "token_lot_expiry_user"
    now = datetime(2026, 1, 12, 9, 30, tzinfo=timezone.utc)
    entitlement = backend_app._default_entitlement(uid)

    entitlement = backend_app._append_paid_vf_credit_lot(
        entitlement,
        amount=25000,
        reason="stripe_token_pack",
        transaction_id="token_pack_tx_1",
        metadata={"kind": "token_pack"},
        now=now,
    )

    lots = entitlement.get("paidVfLots") or []
    assert len(lots) == 1
    lot = lots[0]
    assert lot.get("source") == "token_pack"
    assert float(entitlement.get("paidVfBalance") or 0) == 25000
    assert lot.get("expiresAt") == backend_app._add_months_utc(
        now,
        backend_app.VF_TOKEN_PACK_VALIDITY_MONTHS,
    ).isoformat()

def test_token_pack_lots_expire_independently_per_purchase() -> None:
    _reset_inmemory_state()
    uid = "token_lot_independent_user"
    first_purchase = datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)
    second_purchase = datetime(2026, 2, 20, 14, 45, tzinfo=timezone.utc)
    entitlement = backend_app._default_entitlement(uid)

    entitlement = backend_app._append_paid_vf_credit_lot(
        entitlement,
        amount=10000,
        reason="stripe_token_pack",
        transaction_id="token_pack_tx_a",
        metadata={"kind": "token_pack"},
        now=first_purchase,
    )
    entitlement = backend_app._append_paid_vf_credit_lot(
        entitlement,
        amount=20000,
        reason="stripe_token_pack",
        transaction_id="token_pack_tx_b",
        metadata={"kind": "token_pack"},
        now=second_purchase,
    )

    lots = entitlement.get("paidVfLots") or []
    assert len(lots) == 2
    by_id = {str(lot.get("id") or ""): lot for lot in lots}
    assert by_id["token_pack_tx_a"]["expiresAt"] == backend_app._add_months_utc(
        first_purchase,
        backend_app.VF_TOKEN_PACK_VALIDITY_MONTHS,
    ).isoformat()
    assert by_id["token_pack_tx_b"]["expiresAt"] == backend_app._add_months_utc(
        second_purchase,
        backend_app.VF_TOKEN_PACK_VALIDITY_MONTHS,
    ).isoformat()

def test_paid_vf_lot_spend_and_restore_is_lossless() -> None:
    _reset_inmemory_state()
    uid = "token_lot_restore_user"
    now = datetime(2026, 3, 1, 8, 0, tzinfo=timezone.utc)
    entitlement = backend_app._default_entitlement(uid)
    entitlement = backend_app._append_paid_vf_credit_lot(
        entitlement,
        amount=100,
        reason="stripe_token_pack",
        transaction_id="lot_early",
        metadata={"kind": "token_pack"},
        now=now,
    )
    entitlement = backend_app._append_paid_vf_credit_lot(
        entitlement,
        amount=60,
        reason="stripe_token_pack",
        transaction_id="lot_later",
        metadata={"kind": "token_pack"},
        now=datetime(2026, 3, 15, 8, 0, tzinfo=timezone.utc),
    )
    original = backend_app._normalize_entitlement_wallet(entitlement, now)

    consumed_lots, debits, spent, remaining_total = backend_app._consume_paid_vf_lots(
        original,
        130,
        now,
    )
    assert spent == 130
    assert remaining_total == 30
    assert [entry.get("lotId") for entry in debits] == ["lot_early", "lot_later"]
    assert [entry.get("amount") for entry in debits] == [100, 30]

    post_reservation = {**original, "paidVfLots": consumed_lots, "paidVfBalance": remaining_total}
    restored = backend_app._restore_paid_vf_lots(post_reservation, debits, now=now)
    restored_lots = restored.get("paidVfLots") or []
    restored_by_id = {str(lot.get("id") or ""): lot for lot in restored_lots}
    assert float(restored.get("paidVfBalance") or 0) == 160
    assert float((restored_by_id["lot_early"] or {}).get("amountRemaining") or 0) == 100
    assert float((restored_by_id["lot_later"] or {}).get("amountRemaining") or 0) == 60

def test_usage_reserve_revert_restores_paid_vf_lot_debits() -> None:
    _reset_inmemory_state()
    uid = "usage_revert_paid_lot_user"
    request_id = "usage_revert_paid_lot_request"
    engine = "PRIME"
    char_count = 10
    now = backend_app._utc_now()
    month_doc_id = backend_app._inmemory_usage_month_doc_id(uid, now)

    entitlement = backend_app._default_entitlement(uid)
    entitlement["vffBalance"] = 0.0
    entitlement = backend_app._append_paid_vf_credit_lot(
        entitlement,
        amount=500,
        reason="stripe_token_pack",
        transaction_id="usage_lot_primary",
        metadata={"kind": "token_pack"},
        now=now,
    )
    backend_app._INMEMORY_ENTITLEMENTS[uid] = entitlement

    monthly_usage, _ = backend_app._usage_defaults(uid, now)
    monthly_usage["monthlyFreeVfUsed"] = float(entitlement.get("monthlyVfLimit") or 0)
    backend_app._INMEMORY_USAGE_MONTHLY[month_doc_id] = monthly_usage

    initial_paid_balance = float(entitlement.get("paidVfBalance") or 0)
    reservation = backend_app._reserve_usage(uid, request_id, engine, char_count)
    assert reservation["ok"] is True
    assert reservation["alreadyReserved"] is False

    reserved_event = reservation["event"]
    charge_breakdown = reserved_event.get("chargeBreakdown") or {}
    assert float(charge_breakdown.get("paidVf") or 0) > 0
    assert isinstance(charge_breakdown.get("paidVfLots"), list)
    assert charge_breakdown.get("paidVfLots")

    reserved_entitlement = backend_app._load_entitlement(uid)
    assert float(reserved_entitlement.get("paidVfBalance") or 0) < initial_paid_balance

    backend_app._finalize_usage(uid, request_id, success=False, error_detail="forced failure")

    reverted_event = backend_app._INMEMORY_USAGE_EVENTS[f"{uid}_{request_id}"]
    assert str(reverted_event.get("status") or "") == "reverted"

    reverted_entitlement = backend_app._load_entitlement(uid)
    reverted_lots = reverted_entitlement.get("paidVfLots") or []
    reverted_by_id = {str(lot.get("id") or ""): lot for lot in reverted_lots}
    assert abs(float(reverted_entitlement.get("paidVfBalance") or 0) - initial_paid_balance) < 1e-6
    assert abs(float((reverted_by_id["usage_lot_primary"] or {}).get("amountRemaining") or 0) - initial_paid_balance) < 1e-6

    reverted_monthly = backend_app._INMEMORY_USAGE_MONTHLY[str(reserved_event.get("monthDocId") or "")]
    reverted_daily = backend_app._INMEMORY_USAGE_DAILY[str(reserved_event.get("dayDocId") or "")]
    assert int(reverted_monthly.get("generationCount") or 0) == 0
    assert int(reverted_daily.get("generationCount") or 0) == 0

def test_legacy_paid_vf_balance_is_preserved_as_non_expiring_lot() -> None:
    _reset_inmemory_state()
    uid = "legacy_paid_balance_user"
    backend_app._INMEMORY_ENTITLEMENTS[uid] = {
        **backend_app._default_entitlement(uid),
        "paidVfBalance": 777,
        "paidVfLots": [],
    }
    normalized = backend_app._normalize_entitlement_wallet(backend_app._load_entitlement(uid))
    lots = normalized.get("paidVfLots") or []
    assert len(lots) == 1
    assert float(normalized.get("paidVfBalance") or 0) == 777
    assert lots[0].get("source") == "legacy"
    assert lots[0].get("expiresAt") is None

def test_subscription_upgrade_applies_monthly_limit_immediately_and_preserves_paid_balances(monkeypatch) -> None:
    _reset_inmemory_state()
    uid = "plan_upgrade_user"
    monkeypatch.setattr(backend_app, "STRIPE_PRICE_PRO_RECURRING_INR", "price_pro_recurring_test")
    backend_app._INMEMORY_ENTITLEMENTS[uid] = {
        **backend_app._default_entitlement(uid),
        "plan": "Starter",
        "monthlyVfLimit": backend_app.PLAN_LIMITS["starter"]["monthlyVfLimit"],
        "vffBalance": 900,
        "paidVfBalance": 1200,
    }
    month_key = backend_app._usage_month_key()
    backend_app._INMEMORY_USAGE_MONTHLY[f"{uid}_{month_key}"] = {
        "uid": uid,
        "periodKey": backend_app._usage_month_period_label(),
        "vfUsed": 20000,
        "monthlyFreeVfUsed": 20000,
    }

    backend_app._sync_entitlement_from_subscription(
        uid=uid,
        customer_id="cus_upgrade_1",
        subscription_id="sub_upgrade_1",
        subscription_status="active",
        price_id="price_pro_recurring_test",
    )
    ent = backend_app._load_entitlement(uid)
    usage_payload = backend_app._entitlement_usage_payload(uid)
    wallet = usage_payload.get("wallet") or {}

    assert ent["plan"] == "Pro"
    assert int(ent["monthlyVfLimit"]) == backend_app.PLAN_LIMITS["pro"]["monthlyVfLimit"]
    assert int(wallet.get("monthlyFreeRemaining") or 0) == backend_app.PLAN_LIMITS["pro"]["monthlyVfLimit"] - 20000
    assert float(ent.get("paidVfBalance") or 0) == 1200
    assert float(ent.get("vffBalance") or 0) == 900

def test_subscription_downgrade_removes_old_plan_surplus_and_preserves_paid_balances(monkeypatch) -> None:
    _reset_inmemory_state()
    uid = "plan_downgrade_user"
    monkeypatch.setattr(backend_app, "STRIPE_PRICE_STARTER_RECURRING_INR", "price_starter_recurring_test")
    backend_app._INMEMORY_ENTITLEMENTS[uid] = {
        **backend_app._default_entitlement(uid),
        "plan": "Pro",
        "monthlyVfLimit": backend_app.PLAN_LIMITS["pro"]["monthlyVfLimit"],
        "vffBalance": 450,
        "paidVfBalance": 6400,
    }
    month_key = backend_app._usage_month_key()
    backend_app._INMEMORY_USAGE_MONTHLY[f"{uid}_{month_key}"] = {
        "uid": uid,
        "periodKey": backend_app._usage_month_period_label(),
        "vfUsed": 120000,
        "monthlyFreeVfUsed": 120000,
    }

    backend_app._sync_entitlement_from_subscription(
        uid=uid,
        customer_id="cus_downgrade_1",
        subscription_id="sub_downgrade_1",
        subscription_status="active",
        price_id="price_starter_recurring_test",
    )
    ent = backend_app._load_entitlement(uid)
    usage_payload = backend_app._entitlement_usage_payload(uid)
    wallet = usage_payload.get("wallet") or {}

    assert ent["plan"] == "Starter"
    assert int(ent["monthlyVfLimit"]) == backend_app.PLAN_LIMITS["starter"]["monthlyVfLimit"]
    assert int(wallet.get("monthlyFreeRemaining") or 0) == 0
    assert float(ent.get("paidVfBalance") or 0) == 6400
    assert float(ent.get("vffBalance") or 0) == 450
