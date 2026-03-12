from __future__ import annotations

from datetime import datetime
import types

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
    backend_app._INMEMORY_GENERATION_HISTORY.clear()
    backend_app._INMEMORY_DAILY_USAGE_RESET_STATUS.clear()
    backend_app._TTS_SUCCESS_LIMITER.clear_all_local_state()


def _parse_iso_datetime(value: str) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def test_coupon_creation_defaults_to_six_month_expiry(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)

    response = client.post(
        "/admin/coupons",
        headers={"x-dev-uid": "local_admin"},
        json={
            "code": "EXPDEFAULT6M",
            "couponType": "wallet_credit",
            "creditVf": 1000,
            "usagePolicy": "single_per_user",
        },
    )
    assert response.status_code == 200
    coupon = response.json()["coupon"]
    created_at = _parse_iso_datetime(coupon["createdAt"])
    expires_at = _parse_iso_datetime(coupon["expiresAt"])
    expected = backend_app._add_months_utc(created_at, backend_app.COUPON_DEFAULT_VALIDITY_MONTHS)
    assert expires_at == expected


def test_coupon_create_supports_subscription_discount_with_stripe_sync(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_require_stripe_ready", lambda: None)

    stripe_calls: dict[str, dict] = {}

    class _FakeCoupon:
        @staticmethod
        def create(**kwargs):
            stripe_calls["coupon"] = dict(kwargs)
            return {"id": "cpn_fake_123"}

    class _FakePromotionCode:
        @staticmethod
        def create(**kwargs):
            stripe_calls["promotion"] = dict(kwargs)
            return {"id": "promo_fake_123"}

        @staticmethod
        def modify(_promotion_id: str, **_kwargs):
            return {"ok": True}

    fake_stripe = types.SimpleNamespace(Coupon=_FakeCoupon, PromotionCode=_FakePromotionCode)
    monkeypatch.setattr(backend_app, "stripe", fake_stripe, raising=False)

    client = TestClient(backend_app.app)
    response = client.post(
        "/admin/coupons",
        headers={"x-dev-uid": "local_admin"},
        json={
            "code": "SUBDISC25",
            "couponType": "subscription_discount",
            "discountType": "percent",
            "percentOff": 25,
            "appliesToPlans": ["pro"],
            "usagePolicy": "single_per_user",
        },
    )
    assert response.status_code == 200
    coupon = response.json()["coupon"]
    assert coupon["couponType"] == "subscription_discount"
    assert coupon["discountType"] == "percent"
    assert float(coupon["percentOff"]) == 25.0
    assert coupon["appliesToPlans"] == ["pro"]
    assert coupon["subscriptionDuration"] == "first_invoice_only"
    assert coupon["stripeCouponId"] == "cpn_fake_123"
    assert coupon["stripePromotionCodeId"] == "promo_fake_123"
    assert stripe_calls["coupon"]["duration"] == "once"
    assert stripe_calls["promotion"]["code"] == "SUBDISC25"


def test_coupon_generate_unique_code_retries_collision(monkeypatch) -> None:
    _reset_inmemory_state()
    backend_app._INMEMORY_COUPON_CODE_INDEX["COLLIDE"] = "coupon_existing"
    generated = iter(["COLLIDE", "UNIQUE123"])
    monkeypatch.setattr(
        backend_app,
        "_generate_coupon_code",
        lambda *args, **kwargs: str(next(generated)),
    )
    code = backend_app._coupon_generate_unique_code(attempts=2)
    assert code == "UNIQUE123"


def test_wallet_coupon_usage_policies_are_enforced(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)

    create_single_global = client.post(
        "/admin/coupons",
        headers={"x-dev-uid": "local_admin"},
        json={
            "code": "ONEGLOBAL",
            "couponType": "wallet_credit",
            "creditVf": 100,
            "usagePolicy": "single_global",
        },
    )
    assert create_single_global.status_code == 200
    ok_global = client.post("/wallet/coupons/redeem", headers={"x-dev-uid": "user_a"}, json={"code": "oneglobal"})
    blocked_global = client.post("/wallet/coupons/redeem", headers={"x-dev-uid": "user_b"}, json={"code": "ONEGLOBAL"})
    assert ok_global.status_code == 200
    assert blocked_global.status_code == 400

    create_single_per_user = client.post(
        "/admin/coupons",
        headers={"x-dev-uid": "local_admin"},
        json={
            "code": "ONEPERUSER",
            "couponType": "wallet_credit",
            "creditVf": 120,
            "usagePolicy": "single_per_user",
        },
    )
    assert create_single_per_user.status_code == 200
    first_user_a = client.post("/wallet/coupons/redeem", headers={"x-dev-uid": "user_a"}, json={"code": "ONEPERUSER"})
    second_user_a = client.post("/wallet/coupons/redeem", headers={"x-dev-uid": "user_a"}, json={"code": "ONEPERUSER"})
    first_user_b = client.post("/wallet/coupons/redeem", headers={"x-dev-uid": "user_b"}, json={"code": "ONEPERUSER"})
    assert first_user_a.status_code == 200
    assert second_user_a.status_code == 409
    assert first_user_b.status_code == 200

    create_max_redemptions = client.post(
        "/admin/coupons",
        headers={"x-dev-uid": "local_admin"},
        json={
            "code": "MAXTWO",
            "couponType": "wallet_credit",
            "creditVf": 150,
            "usagePolicy": "max_redemptions",
            "usageLimit": 2,
        },
    )
    assert create_max_redemptions.status_code == 200
    assert client.post("/wallet/coupons/redeem", headers={"x-dev-uid": "user_a"}, json={"code": "MAXTWO"}).status_code == 200
    assert client.post("/wallet/coupons/redeem", headers={"x-dev-uid": "user_b"}, json={"code": "MAXTWO"}).status_code == 200
    assert client.post("/wallet/coupons/redeem", headers={"x-dev-uid": "user_c"}, json={"code": "MAXTWO"}).status_code == 400


def test_legacy_coupon_records_remain_redeemable_with_backfill(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    now = backend_app._utc_now().isoformat()
    backend_app._INMEMORY_COUPONS["legacy_coupon_1"] = {
        "id": "legacy_coupon_1",
        "code": "LEGACYREDEEM",
        "creditVf": 250,
        "active": True,
        "createdAt": now,
        "updatedAt": now,
    }
    backend_app._inmemory_rebuild_coupon_index_locked()
    client = TestClient(backend_app.app)

    redeem = client.post("/wallet/coupons/redeem", headers={"x-dev-uid": "legacy_user"}, json={"code": "legacyredeem"})
    assert redeem.status_code == 200
    payload = redeem.json()
    assert int(payload["creditedVf"]) == 250

    normalized = backend_app._INMEMORY_COUPONS["legacy_coupon_1"]
    assert normalized["couponType"] == "wallet_credit"
    assert str(normalized.get("expiresAt") or "").strip()


def test_admin_limit_bypass_disabled_by_default(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_ADMIN_COUPON_LIMIT_BYPASS", False)
    client = TestClient(backend_app.app)

    created = client.post(
        "/admin/coupons",
        headers={"x-dev-uid": "local_admin"},
        json={
            "code": "NOBYPASS",
            "couponType": "wallet_credit",
            "creditVf": 99,
            "usagePolicy": "single_global",
        },
    )
    assert created.status_code == 200
    first = client.post("/wallet/coupons/redeem", headers={"x-dev-uid": "local_admin"}, json={"code": "NOBYPASS"})
    second = client.post("/wallet/coupons/redeem", headers={"x-dev-uid": "local_admin"}, json={"code": "NOBYPASS"})
    assert first.status_code == 200
    assert second.status_code == 400


def test_sensitive_ops_and_runtime_routes_require_admin(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)
    plain_headers = {"x-dev-uid": "plain_user"}

    assert client.get("/runtime/logs/tail?service=media-backend", headers=plain_headers).status_code == 403
    assert client.post("/tts/engines/switch", headers=plain_headers, json={"engine": "GEM", "gpu": False}).status_code == 403
    assert client.post("/services/dubbing/prepare", headers=plain_headers, json={"gpu": False}).status_code == 404
    assert client.post("/ops/guardian/scan", headers=plain_headers, json={"autoFixMinor": False}).status_code == 403
    assert client.get("/ops/guardian/approvals", headers=plain_headers).status_code == 403
    assert client.post("/ops/guardian/actions", headers=plain_headers, json={"action": "enable_soft_shedding"}).status_code == 403


def test_runtime_gemini_admin_calls_forward_runtime_token(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "GEMINI_RUNTIME_ADMIN_TOKEN", "runtime_token_123")
    seen_headers: list[dict | None] = []

    class _Response:
        status_code = 200
        text = ""

        @property
        def ok(self) -> bool:
            return True

        def json(self) -> dict:
            return {"ok": True, "pool": {"keyCount": 1}}

    def _fake_get(_url: str, timeout: float = 5.0, headers: dict | None = None):
        _ = timeout
        seen_headers.append(headers)
        return _Response()

    monkeypatch.setattr(backend_app.requests, "get", _fake_get)
    payload = backend_app._runtime_gemini_pool_snapshot()
    assert payload["ok"] is True
    assert seen_headers
    assert seen_headers[0] == {"x-admin-token": "runtime_token_123"}


def test_coupon_phase1_analytics_event_emission_compatibility(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_ANALYTICS_V2_ENABLED", True)
    backend_app._INMEMORY_COUPON_ANALYTICS_DAILY.clear()

    result = backend_app._analytics_record_coupon_event(
        event_type="checkout_started",
        provider="stripe",
        coupon_code="compatv2",
        coupon_kind="subscription_discount",
        plan="pro",
        amounts={"grossAmount": 499.0, "discountAmount": 99.0, "netAmount": 400.0},
        metadata={"source": "phase1_test"},
    )
    assert result["ok"] is True

    keys = list(backend_app._INMEMORY_COUPON_ANALYTICS_DAILY.keys())
    assert keys, "expected analytics daily row"
    row = backend_app._INMEMORY_COUPON_ANALYTICS_DAILY[keys[0]]
    assert row["couponCode"] == "COMPATV2"
    assert row["provider"] == "stripe"
    assert int(row["checkoutsStarted"]) >= 1
