from __future__ import annotations

from datetime import datetime, timezone
import time

from fastapi.testclient import TestClient

import app as backend_app


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
    backend_app._INMEMORY_ENTITLEMENTS.clear()
    backend_app._INMEMORY_USAGE_MONTHLY.clear()
    backend_app._INMEMORY_USAGE_DAILY.clear()
    backend_app._INMEMORY_USAGE_EVENTS.clear()
    backend_app._INMEMORY_USER_PROFILES.clear()
    backend_app._INMEMORY_USER_ID_INDEX.clear()
    backend_app._INMEMORY_GENERATION_HISTORY.clear()
    backend_app._INMEMORY_DAILY_USAGE_RESET_STATUS.clear()
    backend_app._INMEMORY_STRIPE_CUSTOMERS.clear()
    backend_app._INMEMORY_WALLET_DAILY.clear()
    backend_app._INMEMORY_WALLET_TRANSACTIONS.clear()
    backend_app._INMEMORY_COUPONS.clear()
    backend_app._INMEMORY_COUPON_REDEMPTIONS.clear()
    backend_app._TTS_SUCCESS_LIMITER.clear_all_local_state()


def _submit_tts_and_wait_status(
    client: TestClient,
    *,
    payload: dict,
    headers: dict[str, str],
    timeout_seconds: float = 8.0,
) -> tuple[int, object]:
    submit = client.post("/tts/synthesize", json=payload, headers=headers)
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
        poll = client.get(f"/tts/jobs/{job_id}", headers=headers)
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
    monkeypatch.setattr(backend_app, "VF_ADMIN_APPROVER_EMAILS", frozenset({"admin1@voiceflow.local"}))
    monkeypatch.setattr(
        backend_app,
        "_verify_firebase_id_token",
        lambda token: {
            "uid": "firebase_admin_user_unverified",
            "email": "admin1@voiceflow.local",
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


def test_runtime_status_endpoint_is_auth_exempt(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    client = TestClient(backend_app.app)
    response = client.get("/tts/engines/status", params={"engine": "GEM"})
    assert response.status_code == 200
    payload = response.json()
    assert payload.get("engines", {}).get("GEM", {}).get("engine") == "GEM"


def test_protected_preflight_returns_cors_success(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    client = TestClient(backend_app.app)
    headers = {
        "Origin": "http://localhost:3000",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization,x-dev-uid",
    }
    response = client.options("/account/profile", headers=headers)
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert "GET" in str(response.headers.get("access-control-allow-methods") or "")
    assert "authorization" in str(response.headers.get("access-control-allow-headers") or "").lower()


def test_auth_401_response_includes_cors_headers(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    client = TestClient(backend_app.app)
    response = client.get("/account/profile", headers={"Origin": "http://localhost:3000"})
    assert response.status_code == 401
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_tts_synthesize_does_not_enforce_daily_limit(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
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
        payload={"engine": "GEM", "text": "hello"},
        headers=headers,
    )
    second_code, _ = _submit_tts_and_wait_status(
        client,
        payload={"engine": "GEM", "text": "again"},
        headers=headers,
    )
    third_code, _ = _submit_tts_and_wait_status(
        client,
        payload={"engine": "GEM", "text": "third run should pass"},
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


def test_tts_synthesize_blocks_gem_for_free_plan(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeResponse())

    client = TestClient(backend_app.app)
    response = client.post(
        "/tts/synthesize",
        headers={"x-dev-uid": "free_gem_block_user"},
        json={"engine": "GEM", "text": "forbidden on free plan", "voice_id": "Fenrir"},
    )
    assert response.status_code == 403
    detail = response.json().get("detail") or {}
    assert detail.get("errorCode") == "VF_TTS_ENGINE_PLAN_FORBIDDEN"
    assert detail.get("plan") == "Free"
    assert detail.get("engine") == "GEM"
    assert set(detail.get("allowedEngines") or []) == {"KOKORO", "NEURAL2"}


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
        payload={"engine": "NEURAL2", "text": "runtime fail"},
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
    assert "GEM" in list((scale_ent.get("limits") or {}).get("allowedEngines") or [])

    free_response = client.get("/account/entitlements", headers={"x-dev-uid": free_uid})
    assert free_response.status_code == 200
    free_ent = free_response.json()["entitlements"]
    assert bool((free_ent.get("features") or {}).get("earlyAccess")) is False
    assert int((free_ent.get("limits") or {}).get("maxCharsPerGeneration") or 0) == 8000
    assert "GEM" not in list((free_ent.get("limits") or {}).get("allowedEngines") or [])


def test_admin_tts_synthesize_bypasses_daily_and_balance_limits(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
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
            payload={"engine": "GEM", "text": f"admin run {i}", "request_id": f"admin_req_{i}"},
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
                        "description": "VoiceFlow Pro monthly",
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
                        "description": "VoiceFlow Pro monthly",
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
    monkeypatch.setattr(backend_app, "stripe", _DummyStripe)
    monkeypatch.setattr(backend_app, "STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setattr(backend_app, "STRIPE_WEBHOOK_SECRET", "")
    monkeypatch.setattr(backend_app, "STRIPE_PRICE_PRO_MAX_INR", "price_pro_max_test")
    monkeypatch.setattr(backend_app, "STRIPE_PRICE_PRO_RECURRING_INR", "price_pro_recurring_test")

    client = TestClient(backend_app.app)
    event_payload = {
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "metadata": {"uid": "stripe_user_1", "plan": "pro"},
                "customer": "cus_test_123",
                "subscription": "sub_test_123",
                "customer_details": {"address": {"country": "IN"}},
            }
        },
    }
    response = client.post("/billing/webhook", json=event_payload)
    assert response.status_code == 200
    ent = backend_app._load_entitlement("stripe_user_1")
    assert ent["plan"] == "Pro"
    assert ent["monthlyVfLimit"] == backend_app.PLAN_LIMITS["pro"]["monthlyVfLimit"]


def test_billing_account_summary_returns_subscription_and_invoices(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "stripe", _DummyStripe)
    monkeypatch.setattr(backend_app, "STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setattr(backend_app, "STRIPE_PRICE_PRO_MAX_INR", "price_pro_max_test")
    monkeypatch.setattr(backend_app, "STRIPE_PRICE_PRO_RECURRING_INR", "price_pro_recurring_test")

    uid = "billing_summary_user"
    backend_app._INMEMORY_ENTITLEMENTS[uid] = {
        **backend_app._default_entitlement(uid),
        "plan": "Pro",
        "status": "active",
        "monthlyVfLimit": backend_app.PLAN_LIMITS["pro"]["monthlyVfLimit"],
        "stripeCustomerId": "cus_test_123",
        "subscriptionId": "sub_test_123",
        "billingCountry": "IN",
    }
    backend_app._INMEMORY_USER_PROFILES[uid] = {
        "uid": uid,
        "userId": "summary_user",
        "displayName": "Summary User",
        "email": "summary@example.com",
        "createdAt": "2026-01-01T00:00:00+00:00",
    }

    client = TestClient(backend_app.app)
    response = client.get("/billing/account-summary", headers={"x-dev-uid": uid})
    assert response.status_code == 200
    payload = response.json()["summary"]
    assert payload["plan"]["key"] == "pro"
    assert "dailyGenerationLimit" not in payload["plan"]
    assert payload["plan"]["pricing"]["discountPercent"] == 10
    assert int(payload["plan"]["ttsSuccessRpm"]) == int(
        backend_app._TTS_SUCCESS_LIMITER.quota_for_plan(backend_app._tts_success_bucket_for_plan("pro"))
    )
    assert payload["billing"]["hasPortalAccess"] is True
    assert payload["subscription"]["active"] is True
    assert payload["subscription"]["latestInvoiceId"] == "in_test_001"
    assert payload["paymentMethod"]["last4"] == "4242"
    assert len(payload["invoices"]) == 2
    assert payload["invoices"][0]["amountPaidMinor"] == 216000


def test_wallet_ad_reward_daily_cap(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    uid = "ad_reward_user"
    backend_app._INMEMORY_ENTITLEMENTS[uid] = {
        **backend_app._default_entitlement(uid),
        "plan": "Pro",
        "status": "active",
        "monthlyVfLimit": backend_app.PLAN_LIMITS["pro"]["monthlyVfLimit"],
        "vffBalance": 0.0,
        "vffMonthKey": backend_app._wallet_month_key(),
        "vffGrantMonthKey": backend_app._wallet_month_key(),
    }
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": uid}
    for _ in range(3):
        ok = client.post("/wallet/ad-reward/claim", headers=headers)
        assert ok.status_code == 200
    blocked = client.post("/wallet/ad-reward/claim", headers=headers)
    assert blocked.status_code == 429
    assert "Daily ad reward limit reached" in blocked.json()["detail"]


def test_free_wallet_ad_reward_respects_monthly_vff_cap(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    uid = "free_vff_cap_user"
    client = TestClient(backend_app.app)
    response = client.post("/wallet/ad-reward/claim", headers={"x-dev-uid": uid})

    assert response.status_code == 429
    assert "Monthly free VFF cap reached" in str(response.json().get("detail") or "")


def test_admin_wallet_ad_reward_bypasses_daily_cap(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    uid = "local_admin_rewards"
    backend_app._INMEMORY_ENTITLEMENTS[uid] = {
        **backend_app._default_entitlement(uid),
        "plan": "Pro",
        "status": "active",
        "monthlyVfLimit": backend_app.PLAN_LIMITS["pro"]["monthlyVfLimit"],
        "vffBalance": 0.0,
        "vffMonthKey": backend_app._wallet_month_key(),
        "vffGrantMonthKey": backend_app._wallet_month_key(),
    }
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": uid}
    claims = backend_app.VF_AD_REWARD_CLAIM_LIMIT_PER_DAY + 3
    latest_wallet = {}
    for _ in range(claims):
        ok = client.post("/wallet/ad-reward/claim", headers=headers)
        assert ok.status_code == 200
        latest_wallet = ((ok.json() or {}).get("entitlements") or {}).get("wallet") or {}
    assert int(latest_wallet.get("adClaimsToday") or 0) == claims
    expected_vff = claims * backend_app.VF_AD_REWARD_VFF_AMOUNT
    assert float(latest_wallet.get("vffBalance") or 0) == expected_vff


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
    monkeypatch.setattr(backend_app, "stripe", _DummyStripe)
    monkeypatch.setattr(backend_app, "STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setattr(backend_app, "STRIPE_WEBHOOK_SECRET", "")

    client = TestClient(backend_app.app)
    event_payload = {
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": "cs_token_pack_1",
                "metadata": {
                    "kind": "token_pack",
                    "uid": "wallet_user_1",
                    "packKey": "micro",
                    "packVf": "50000",
                    "standardAmountInr": "550",
                    "finalAmountInr": "550",
                },
                "customer": "cus_wallet_1",
                "amount_total": 55000,
                "currency": "inr",
            }
        },
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
    engine = "GEM"
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
