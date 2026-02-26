from __future__ import annotations

from fastapi.testclient import TestClient

import backend.app as backend_app


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
    backend_app._INMEMORY_STRIPE_CUSTOMERS.clear()


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
