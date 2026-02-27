from __future__ import annotations

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
    backend_app._INMEMORY_GENERATION_HISTORY.clear()
    backend_app._INMEMORY_DAILY_USAGE_RESET_STATUS.clear()
    backend_app._INMEMORY_STRIPE_CUSTOMERS.clear()
    backend_app._INMEMORY_WALLET_DAILY.clear()
    backend_app._INMEMORY_WALLET_TRANSACTIONS.clear()
    backend_app._INMEMORY_COUPONS.clear()
    backend_app._INMEMORY_COUPON_REDEMPTIONS.clear()


def test_auth_enforcement_blocks_missing_token(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    client = TestClient(backend_app.app)
    response = client.get("/account/entitlements")
    assert response.status_code == 401


def test_auth_enforcement_accepts_valid_token(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "_verify_firebase_id_token", lambda token: {"uid": "firebase_user_1"})
    client = TestClient(backend_app.app)
    response = client.get("/account/entitlements", headers={"Authorization": "Bearer valid_token"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["entitlements"]["uid"] == "firebase_user_1"


def test_tts_synthesize_enforces_daily_limit(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeResponse())
    uid = "quota_user_daily"
    backend_app._INMEMORY_ENTITLEMENTS[uid] = {
        **backend_app._default_entitlement(uid),
        "dailyGenerationLimit": 2,
        "monthlyVfLimit": 100000,
    }

    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": uid}
    first = client.post("/tts/synthesize", json={"engine": "GEM", "text": "hello"}, headers=headers)
    second = client.post("/tts/synthesize", json={"engine": "GEM", "text": "again"}, headers=headers)
    third = client.post("/tts/synthesize", json={"engine": "GEM", "text": "blocked"}, headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 429
    assert "Daily generation limit reached" in third.json()["detail"]


def test_tts_synthesize_reverts_usage_on_runtime_failure(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    uid = "quota_user_revert"
    backend_app._INMEMORY_ENTITLEMENTS[uid] = {
        **backend_app._default_entitlement(uid),
        "dailyGenerationLimit": 30,
        "monthlyVfLimit": 8000,
    }
    monkeypatch.setattr(
        backend_app.requests,
        "post",
        lambda *args, **kwargs: _DummyRuntimeResponse(status_code=500, content=b"", json_payload={"detail": "boom"}),
    )

    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": uid}
    failed = client.post("/tts/synthesize", json={"engine": "GEM", "text": "runtime fail"}, headers=headers)
    assert failed.status_code == 500

    ent = client.get("/account/entitlements", headers=headers)
    assert ent.status_code == 200
    payload = ent.json()["entitlements"]
    assert payload["daily"]["generationUsed"] == 0
    assert payload["monthly"]["vfUsed"] == 0


def test_admin_tts_synthesize_bypasses_daily_and_balance_limits(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeResponse())
    uid = "local_admin_unlimited"
    backend_app._INMEMORY_ENTITLEMENTS[uid] = {
        **backend_app._default_entitlement(uid),
        "dailyGenerationLimit": 1,
        "monthlyVfLimit": 0,
        "vffBalance": 0,
        "paidVfBalance": 0,
    }

    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": uid}
    for i in range(3):
        response = client.post(
            "/tts/synthesize",
            json={"engine": "GEM", "text": f"admin run {i}", "request_id": f"admin_req_{i}"},
            headers=headers,
        )
        assert response.status_code == 200

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
        def retrieve(subscription_id):
            _ = subscription_id
            return {
                "status": "active",
                "items": {
                    "data": [
                        {
                            "price": {"id": backend_app.STRIPE_PRICE_PRO_INR},
                        }
                    ]
                },
            }


def test_billing_webhook_updates_entitlement(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "stripe", _DummyStripe)
    monkeypatch.setattr(backend_app, "STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setattr(backend_app, "STRIPE_WEBHOOK_SECRET", "")
    monkeypatch.setattr(backend_app, "STRIPE_PRICE_PRO_INR", "price_pro_test")
    monkeypatch.setattr(backend_app, "STRIPE_PRICE_PLUS_INR", "price_plus_test")

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


def test_wallet_ad_reward_daily_cap(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    uid = "ad_reward_user"
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": uid}
    for _ in range(3):
        ok = client.post("/wallet/ad-reward/claim", headers=headers)
        assert ok.status_code == 200
    blocked = client.post("/wallet/ad-reward/claim", headers=headers)
    assert blocked.status_code == 429
    assert "Daily ad reward limit reached" in blocked.json()["detail"]


def test_admin_wallet_ad_reward_bypasses_daily_cap(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    uid = "local_admin_rewards"
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": uid}
    claims = backend_app.VF_AD_REWARD_CLAIM_LIMIT_PER_DAY + 3
    for _ in range(claims):
        ok = client.post("/wallet/ad-reward/claim", headers=headers)
        assert ok.status_code == 200
    ent = client.get("/account/entitlements", headers=headers)
    assert ent.status_code == 200
    payload = ent.json()["entitlements"]
    assert payload["wallet"]["adClaimsToday"] == claims
    assert payload["wallet"]["vffBalance"] == claims * backend_app.VF_AD_REWARD_VFF_AMOUNT


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
                    "packVf": "100000",
                    "finalAmountInr": "499",
                },
                "customer": "cus_wallet_1",
                "amount_total": 49900,
                "currency": "inr",
            }
        },
    }
    first = client.post("/billing/webhook", json=event_payload)
    second = client.post("/billing/webhook", json=event_payload)
    assert first.status_code == 200
    assert second.status_code == 200
    entitlement = backend_app._load_entitlement("wallet_user_1")
    assert entitlement["paidVfBalance"] == 100000
