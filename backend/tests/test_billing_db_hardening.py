from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from fastapi.testclient import TestClient

import app as backend_app


def _reset_inmemory_state() -> None:
    backend_app._INMEMORY_ENTITLEMENTS.clear()
    backend_app._INMEMORY_USAGE_MONTHLY.clear()
    backend_app._INMEMORY_USAGE_DAILY.clear()
    backend_app._INMEMORY_USAGE_EVENTS.clear()
    backend_app._INMEMORY_STRIPE_CUSTOMERS.clear()
    backend_app._INMEMORY_WALLET_DAILY.clear()
    backend_app._INMEMORY_WALLET_TRANSACTIONS.clear()
    backend_app._INMEMORY_COUPONS.clear()
    backend_app._INMEMORY_COUPON_CODE_INDEX.clear()
    backend_app._INMEMORY_COUPON_REDEMPTIONS.clear()
    backend_app._INMEMORY_STRIPE_WEBHOOK_EVENTS.clear()
    backend_app._INMEMORY_USER_PROFILES.clear()
    backend_app._INMEMORY_USER_ID_INDEX.clear()
    backend_app._FIREBASE_APP = None
    backend_app._FIRESTORE_DB = None
    backend_app._FIREBASE_INIT_ATTEMPTED = False
    backend_app._FIRESTORE_RETRY_LAST_ATTEMPT_MS = 0


class _DocMissing:
    exists = False

    def to_dict(self) -> dict:
        return {}


class _CollectionMissing:
    def document(self, _doc_id: str) -> _DocMissing:
        return _DocMissing()


class _FakeDbMissing:
    def collection(self, _name: str) -> _CollectionMissing:
        return _CollectionMissing()


def test_firestore_collection_retries_init_when_app_exists_and_db_missing(monkeypatch) -> None:
    _reset_inmemory_state()
    backend_app._FIREBASE_APP = object()
    backend_app._FIRESTORE_DB = None
    monkeypatch.setattr(backend_app, "VF_FIRESTORE_ENABLE", True)

    calls: list[bool] = []

    class _FakeDb:
        def collection(self, name: str):
            return {"collection": name}

    def _fake_init(*, force: bool = False) -> None:
        calls.append(bool(force))
        backend_app._FIRESTORE_DB = _FakeDb()

    monkeypatch.setattr(backend_app, "_init_firebase_clients", _fake_init)
    payload = backend_app._firestore_collection("entitlements")
    assert payload == {"collection": "entitlements"}
    assert calls and calls[0] is True


def test_user_profile_read_does_not_resurrect_local_fallback_when_firestore_missing() -> None:
    _reset_inmemory_state()
    backend_app._FIRESTORE_DB = _FakeDbMissing()
    backend_app._INMEMORY_USER_PROFILES["user_1"] = {"uid": "user_1", "userId": "legacy_user"}
    backend_app._INMEMORY_USER_ID_INDEX["legacy_user"] = {"uid": "user_1", "userId": "legacy_user"}

    assert backend_app._user_profile_read("user_1") is None
    assert backend_app._user_profile_find_by_user_id("legacy_user") is None


def test_user_profile_upsert_failfast_on_firestore_unavailable(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_FIRESTORE_ENABLE", True)
    monkeypatch.setattr(backend_app, "VF_USER_PROFILE_FAILFAST", True)
    monkeypatch.setattr(backend_app, "_firestore_collection", lambda _name: None)

    try:
        backend_app._user_profile_upsert("user_failfast", user_id="user_failfast")
        raise AssertionError("Expected HTTPException")
    except HTTPException as exc:
        assert exc.status_code == 503
        assert "temporarily unavailable" in str(exc.detail).lower()


def test_checkout_returns_502_when_stripe_customer_create_fails(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_require_stripe_ready", lambda: None)
    monkeypatch.setattr(backend_app, "_stripe_price_id_for_plan", lambda _plan, phase="first": "price_test_1")
    monkeypatch.setattr(backend_app, "_stripe_plan_prices_configured", lambda required_plan=None: True)
    monkeypatch.setattr(backend_app, "_load_entitlement", lambda _uid: backend_app._default_entitlement(_uid))

    class _Stripe:
        class Customer:
            @staticmethod
            def create(**_kwargs):
                raise RuntimeError("customer create failed")

        class checkout:
            class Session:
                @staticmethod
                def create(**_kwargs):
                    raise AssertionError("checkout session should not be created when customer creation fails")

    monkeypatch.setattr(backend_app, "stripe", _Stripe())
    client = TestClient(backend_app.app)
    response = client.post(
        "/billing/checkout-session",
        headers={"x-dev-uid": "checkout_user", "Idempotency-Key": "checkout_user:starter:1"},
        json={"plan": "starter"},
    )
    assert response.status_code == 502


def test_stripe_checkout_session_honors_idempotency_key(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_require_stripe_ready", lambda: None)
    monkeypatch.setattr(backend_app, "_stripe_price_id_for_plan", lambda _plan, phase="first": "price_test_1")
    monkeypatch.setattr(backend_app, "_stripe_plan_prices_configured", lambda required_plan=None: True)
    monkeypatch.setattr(backend_app, "_load_entitlement", lambda uid: backend_app._default_entitlement(uid))

    captured_sessions: list[dict[str, object]] = []

    class _Stripe:
        class Customer:
            @staticmethod
            def create(**kwargs):
                _ = kwargs
                return {"id": "cus_test_123"}

        class checkout:
            class Session:
                @staticmethod
                def create(**kwargs):
                    captured_sessions.append(dict(kwargs))
                    return {"id": "cs_test_123", "url": "https://checkout.test"}

    monkeypatch.setattr(backend_app, "stripe", _Stripe())
    client = TestClient(backend_app.app)
    response = client.post(
        "/billing/checkout-session",
        headers={"x-dev-uid": "checkout_user", "Idempotency-Key": "checkout_user:starter:1"},
        json={"plan": "starter"},
    )

    assert response.status_code == 200
    assert len(captured_sessions) == 1
    assert str(captured_sessions[0].get("idempotency_key") or "") == "checkout_user:starter:1"


def test_token_pack_checkout_session_honors_idempotency_key(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_require_stripe_ready", lambda: None)
    monkeypatch.setattr(backend_app, "_load_entitlement", lambda uid: backend_app._default_entitlement(uid))
    monkeypatch.setattr(backend_app, "_token_pack_config", lambda pack_key: {"priceInr": 499})
    monkeypatch.setattr(backend_app, "_token_pack_vf_for_pack", lambda pack_key: 650)
    monkeypatch.setattr(backend_app, "_token_pack_amount_inr_for_plan", lambda plan_name, pack_key: 499)

    captured_sessions: list[dict[str, object]] = []

    class _Stripe:
        class Customer:
            @staticmethod
            def create(**kwargs):
                _ = kwargs
                return {"id": "cus_test_456"}

        class checkout:
            class Session:
                @staticmethod
                def create(**kwargs):
                    captured_sessions.append(dict(kwargs))
                    return {"id": "cs_pack_test_123", "url": "https://checkout.test/pack"}

    monkeypatch.setattr(backend_app, "stripe", _Stripe())
    client = TestClient(backend_app.app)
    response = client.post(
        "/billing/token-pack/checkout-session",
        headers={"x-dev-uid": "token_pack_user", "Idempotency-Key": "token_pack_user:standard:1"},
        json={"pack": "standard"},
    )

    assert response.status_code == 200
    assert len(captured_sessions) == 1
    assert str(captured_sessions[0].get("idempotency_key") or "") == "token_pack_user:standard:1"


def test_billing_subscription_cancel_updates_stripe_and_syncs_entitlement(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_require_stripe_ready", lambda: None)
    monkeypatch.setattr(
        backend_app,
        "_load_entitlement",
        lambda _uid: {
            "plan": "Pro",
            "status": "active",
            "monthlyVfLimit": backend_app.PLAN_LIMITS["pro"]["monthlyVfLimit"],
            "stripeCustomerId": "cus_test_123",
            "subscriptionId": "sub_test_123",
            "billingCountry": "in",
        },
    )

    modify_calls: list[dict[str, object]] = []
    sync_calls: list[dict[str, object]] = []

    class _Stripe:
        class Subscription:
            @staticmethod
            def modify(subscription_id: str, **kwargs):
                modify_calls.append({"subscription_id": subscription_id, **kwargs})
                return {
                    "id": subscription_id,
                    "status": "active",
                    "cancel_at_period_end": bool(kwargs.get("cancel_at_period_end")),
                    "items": {"data": [{"price": {"id": "price_pro_monthly"}}]},
                }

    monkeypatch.setattr(backend_app, "stripe", _Stripe())
    monkeypatch.setattr(
        backend_app,
        "_sync_entitlement_from_subscription",
        lambda **kwargs: sync_calls.append(dict(kwargs)) or {"ok": True},
    )
    monkeypatch.setattr(
        backend_app,
        "_build_billing_account_summary",
        lambda _uid: {
            "subscription": {"id": "sub_test_123", "cancelAtPeriodEnd": True},
            "billing": {"stripeReady": True},
        },
    )

    client = TestClient(backend_app.app)
    response = client.post("/billing/subscription/cancel", headers={"x-dev-uid": "billing_user"})

    assert response.status_code == 200
    payload = response.json()
    assert payload.get("ok") is True
    assert payload.get("provider") == backend_app.BILLING_PROVIDER_STRIPE
    assert payload.get("subscription", {}).get("id") == "sub_test_123"
    assert "cancel" in str(payload.get("message") or "").lower()
    assert modify_calls == [{"subscription_id": "sub_test_123", "cancel_at_period_end": True}]
    assert sync_calls == [
        {
            "uid": "billing_user",
            "customer_id": "cus_test_123",
            "subscription_id": "sub_test_123",
            "subscription_status": "active",
            "price_id": "price_pro_monthly",
            "billing_country": "IN",
        }
    ]


def test_billing_subscription_resume_updates_stripe_and_syncs_entitlement(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_require_stripe_ready", lambda: None)
    monkeypatch.setattr(
        backend_app,
        "_load_entitlement",
        lambda _uid: {
            "plan": "Pro",
            "status": "active",
            "monthlyVfLimit": backend_app.PLAN_LIMITS["pro"]["monthlyVfLimit"],
            "stripeCustomerId": "cus_test_456",
            "subscriptionId": "sub_test_456",
            "billingCountry": "us",
        },
    )

    modify_calls: list[dict[str, object]] = []
    sync_calls: list[dict[str, object]] = []

    class _Stripe:
        class Subscription:
            @staticmethod
            def modify(subscription_id: str, **kwargs):
                modify_calls.append({"subscription_id": subscription_id, **kwargs})
                return {
                    "id": subscription_id,
                    "status": "active",
                    "cancel_at_period_end": bool(kwargs.get("cancel_at_period_end")),
                    "items": {"data": [{"price": {"id": "price_pro_monthly"}}]},
                }

    monkeypatch.setattr(backend_app, "stripe", _Stripe())
    monkeypatch.setattr(
        backend_app,
        "_sync_entitlement_from_subscription",
        lambda **kwargs: sync_calls.append(dict(kwargs)) or {"ok": True},
    )
    monkeypatch.setattr(
        backend_app,
        "_build_billing_account_summary",
        lambda _uid: {
            "subscription": {"id": "sub_test_456", "cancelAtPeriodEnd": False},
            "billing": {"stripeReady": True},
        },
    )

    client = TestClient(backend_app.app)
    response = client.post("/billing/subscription/resume", headers={"x-dev-uid": "billing_user"})

    assert response.status_code == 200
    payload = response.json()
    assert payload.get("ok") is True
    assert payload.get("provider") == backend_app.BILLING_PROVIDER_STRIPE
    assert payload.get("subscription", {}).get("id") == "sub_test_456"
    assert "resume" in str(payload.get("message") or "").lower()
    assert modify_calls == [{"subscription_id": "sub_test_456", "cancel_at_period_end": False}]
    assert sync_calls == [
        {
            "uid": "billing_user",
            "customer_id": "cus_test_456",
            "subscription_id": "sub_test_456",
            "subscription_status": "active",
            "price_id": "price_pro_monthly",
            "billing_country": "US",
        }
    ]


def test_billing_webhook_idempotent_by_event_id(monkeypatch) -> None:
    _reset_inmemory_state()
    first_allowed, first_row = backend_app._stripe_webhook_event_begin("evt_dedupe_1", "payment.captured")
    second_allowed, second_row = backend_app._stripe_webhook_event_begin("evt_dedupe_1", "payment.captured")

    assert first_allowed is True
    assert str(first_row.get("state") or "") == "processing"
    assert second_allowed is False
    assert str(second_row.get("state") or "") == "processing"

    backend_app._stripe_webhook_event_complete("evt_dedupe_1", status="succeeded")
    third_allowed, third_row = backend_app._stripe_webhook_event_begin("evt_dedupe_1", "payment.captured")
    assert third_allowed is False
    assert str(third_row.get("state") or "") == "succeeded"


def test_billing_webhook_retries_after_failed_processing(monkeypatch) -> None:
    _reset_inmemory_state()
    first_allowed, first_row = backend_app._stripe_webhook_event_begin("evt_retryable_1", "payment.captured")
    assert first_allowed is True
    assert str(first_row.get("state") or "") == "processing"

    backend_app._stripe_webhook_event_complete("evt_retryable_1", status="failed", error_detail="temporary billing failure")
    failed_row = dict(backend_app._INMEMORY_STRIPE_WEBHOOK_EVENTS.get("evt_retryable_1") or {})
    assert str(failed_row.get("state") or "") == "failed"
    assert "temporary billing failure" in str(failed_row.get("lastError") or "")

    retry_allowed, retry_row = backend_app._stripe_webhook_event_begin("evt_retryable_1", "payment.captured")
    assert retry_allowed is True
    assert str(retry_row.get("state") or "") == "processing"
    assert int(retry_row.get("attemptCount") or 0) >= 2

    backend_app._stripe_webhook_event_complete("evt_retryable_1", status="succeeded")
    final_row = dict(backend_app._INMEMORY_STRIPE_WEBHOOK_EVENTS.get("evt_retryable_1") or {})
    assert str(final_row.get("state") or "") == "succeeded"


def test_unknown_price_id_preserves_existing_plan() -> None:
    _reset_inmemory_state()
    uid = "preserve_plan_user"
    backend_app._INMEMORY_ENTITLEMENTS[uid] = {
        **backend_app._default_entitlement(uid),
        "plan": "Pro",
        "monthlyVfLimit": backend_app.PLAN_LIMITS["pro"]["monthlyVfLimit"],
        "status": "active",
    }
    payload = backend_app._sync_entitlement_from_subscription(
        uid=uid,
        customer_id="cus_1",
        subscription_id="sub_1",
        subscription_status="active",
        price_id="price_unknown_1",
    )
    assert payload["plan"] == "Pro"
    assert int(payload["monthlyVfLimit"] or 0) == backend_app.PLAN_LIMITS["pro"]["monthlyVfLimit"]


def test_token_pack_expiry_recalculation_migration(monkeypatch) -> None:
    _reset_inmemory_state()
    now = datetime(2026, 4, 1, 12, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(backend_app, "_utc_now", lambda: now)
    monkeypatch.setattr(backend_app, "VF_TOKEN_PACK_VALIDITY_MONTHS", 3)
    uid = "migration_user"
    backend_app._INMEMORY_ENTITLEMENTS[uid] = {
        **backend_app._default_entitlement(uid),
        "plan": "Pro",
        "paidVfLots": [
            {
                "id": "lot_keep",
                "amountTotal": 1000,
                "amountRemaining": 1000,
                "createdAt": "2026-03-01T00:00:00+00:00",
                "expiresAt": "2026-09-01T00:00:00+00:00",
                "source": "token_pack",
                "reason": "stripe_token_pack",
                "metadata": {"kind": "token_pack"},
            },
            {
                "id": "lot_expired",
                "amountTotal": 500,
                "amountRemaining": 500,
                "createdAt": "2025-11-01T00:00:00+00:00",
                "expiresAt": "2026-05-01T00:00:00+00:00",
                "source": "token_pack",
                "reason": "stripe_token_pack",
                "metadata": {"kind": "token_pack"},
            },
            {
                "id": "lot_manual",
                "amountTotal": 250,
                "amountRemaining": 250,
                "createdAt": "2026-03-20T00:00:00+00:00",
                "expiresAt": None,
                "source": "manual",
                "reason": "manual_adjustment",
                "metadata": {},
            },
        ],
    }
    summary = backend_app._recalculate_token_pack_expiry_migration(dry_run=False, requested_by="tester")
    assert summary["usersChanged"] == 1
    assert summary["tokenLotsSeen"] == 2
    assert summary["tokenLotsUpdated"] == 1
    assert summary["tokenLotsExpiredRemoved"] == 1
    migrated = backend_app._INMEMORY_ENTITLEMENTS[uid]
    lots = migrated.get("paidVfLots") or []
    by_id = {str(item.get("id") or ""): item for item in lots}
    assert "lot_expired" not in by_id
    assert by_id["lot_keep"]["expiresAt"] == "2026-06-01T00:00:00+00:00"
    assert by_id["lot_manual"]["expiresAt"] is None
