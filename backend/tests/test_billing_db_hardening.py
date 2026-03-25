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


def test_checkout_releases_coupon_reservation_when_customer_create_fails(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_require_stripe_ready", lambda: None)
    monkeypatch.setattr(backend_app, "_stripe_price_id_for_plan", lambda _plan, phase="first": "price_ok")
    monkeypatch.setattr(backend_app, "_stripe_plan_prices_configured", lambda: True)
    monkeypatch.setattr(
        backend_app,
        "_reserve_subscription_coupon_for_checkout",
        lambda _uid, _code, _plan: {"coupon": {"id": "coupon_1"}, "reservationId": "res_1"},
    )
    monkeypatch.setattr(backend_app, "_load_entitlement", lambda _uid: backend_app._default_entitlement(_uid))
    released: list[str] = []
    monkeypatch.setattr(
        backend_app,
        "_release_subscription_coupon_reservation",
        lambda reservation_id, reason="": released.append(f"{reservation_id}:{reason}"),
    )

    class _StripeFailCustomer:
        class Customer:
            @staticmethod
            def create(**_kwargs):
                raise RuntimeError("customer create failed")

    monkeypatch.setattr(backend_app, "stripe", _StripeFailCustomer)
    client = TestClient(backend_app.app)
    response = client.post(
        "/billing/checkout-session",
        headers={"x-dev-uid": "checkout_user"},
        json={"plan": "starter", "couponCode": "SAVE20"},
    )
    assert response.status_code == 502
    assert released == ["res_1:customer_create_failed"]


def test_billing_webhook_idempotent_by_event_id(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_IS_PRODUCTION", False)
    monkeypatch.setattr(backend_app, "VF_IS_LOCAL_DEV", True)
    monkeypatch.setattr(backend_app, "VF_STRIPE_WEBHOOK_ALLOW_UNSIGNED", True)
    monkeypatch.setattr(backend_app, "STRIPE_SECRET_KEY", "sk_test")
    monkeypatch.setattr(backend_app, "STRIPE_WEBHOOK_SECRET", "")
    monkeypatch.setattr(backend_app, "_require_stripe_ready", lambda: None)

    credit_calls: list[str] = []
    monkeypatch.setattr(
        backend_app,
        "_credit_paid_vf",
        lambda **kwargs: credit_calls.append(str(kwargs.get("uid") or "")),
    )
    client = TestClient(backend_app.app)
    event_payload = {
        "id": "evt_dedupe_1",
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
    assert second.json().get("duplicate") is True
    assert credit_calls == ["wallet_user_1"]


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

