from __future__ import annotations

from fastapi import Request
from fastapi.testclient import TestClient

import app as backend_app


def _reset_phase2_state() -> None:
    backend_app._INMEMORY_ADMIN_ROLES.clear()
    backend_app._RBAC_ACTOR_CACHE.clear()

    backend_app._INMEMORY_AUDIT_LEDGER_EVENTS.clear()
    backend_app._INMEMORY_AUDIT_LEDGER_ORDER.clear()
    backend_app._INMEMORY_AUDIT_LEDGER_STATE.clear()

    backend_app._INMEMORY_ALERT_POLICIES.clear()
    backend_app._INMEMORY_ALERT_DESTINATIONS.clear()
    backend_app._INMEMORY_ALERT_EVENTS.clear()

    backend_app._INMEMORY_SCHEDULER_TASKS.clear()
    backend_app._INMEMORY_SCHEDULER_RUNS.clear()
    backend_app._INMEMORY_SCHEDULER_LOCK.clear()

    backend_app._INMEMORY_COUPON_ANALYTICS_DAILY.clear()
    backend_app._INMEMORY_COUPON_SUB_ATTRIBUTIONS.clear()

    backend_app._INMEMORY_ENTITLEMENTS.clear()
    backend_app._INMEMORY_USER_PROFILES.clear()
    backend_app._INMEMORY_USER_ID_INDEX.clear()
    backend_app._INMEMORY_COUPONS.clear()
    backend_app._INMEMORY_COUPON_CODE_INDEX.clear()
    backend_app._INMEMORY_COUPON_REDEMPTIONS.clear()
    backend_app._INMEMORY_STRIPE_CUSTOMERS.clear()


def _empty_request() -> Request:
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/",
            "raw_path": b"/",
            "query_string": b"",
            "headers": [],
            "client": ("127.0.0.1", 12345),
            "server": ("testserver", 80),
        }
    )


def test_rbac_assignment_resolution_and_override_precedence(monkeypatch) -> None:
    _reset_phase2_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)

    backend_app._rbac_write_assignment(
        "operator_a",
        {
            "role": "support_ops",
            "allowOverrides": ["coupons.write"],
            "denyOverrides": ["users.write"],
            "status": "active",
            "updatedBy": "seed",
        },
    )

    actor = backend_app._resolve_actor("operator_a", _empty_request())
    assert actor["role"] == "support_ops"
    assert backend_app._has_permission(actor, "users.read") is True
    assert backend_app._has_permission(actor, "users.write") is False
    assert backend_app._has_permission(actor, "coupons.write") is True

    super_actor = {
        "uid": "root",
        "role": "super_admin",
        "status": "active",
        "allowOverrides": [],
        "denyOverrides": ["users.read"],
        "permissions": [],
    }
    assert backend_app._has_permission(super_actor, "users.read") is True


def test_rbac_bootstrap_fallback_for_legacy_admin_uid(monkeypatch) -> None:
    _reset_phase2_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)

    actor = backend_app._resolve_actor("local_admin", _empty_request())
    assert actor["role"] == "super_admin"
    assert actor["source"] in {"legacy_bootstrap", "admin_roles"}

    non_admin = backend_app._resolve_actor("plain_user", _empty_request())
    assert non_admin["status"] == "disabled"


def test_rbac_endpoint_gating_with_read_only_role(monkeypatch) -> None:
    _reset_phase2_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_USER_ID_REQUIRED", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)
    monkeypatch.setattr(backend_app, "_firebase_ready", lambda: False)

    backend_app._rbac_write_assignment(
        "ops_reader",
        {
            "role": "read_only_ops",
            "allowOverrides": [],
            "denyOverrides": [],
            "status": "active",
            "updatedBy": "seed",
        },
    )
    client = TestClient(backend_app.app)
    read_users = client.get("/admin/users", headers={"x-dev-uid": "ops_reader"})
    assert read_users.status_code == 200

    mutate_coupon = client.post(
        "/admin/coupons",
        headers={"x-dev-uid": "ops_reader"},
        json={
            "code": "DENYWRITE1",
            "couponType": "wallet_credit",
            "creditVf": 100,
            "usagePolicy": "single_per_user",
        },
    )
    assert mutate_coupon.status_code == 403
    assert "coupons.write" in str(mutate_coupon.json().get("detail"))


def test_audit_chain_append_and_tamper_detection(monkeypatch) -> None:
    _reset_phase2_state()
    monkeypatch.setattr(backend_app, "VF_AUDIT_LEDGER_ENABLED", True)

    first = backend_app._audit_append_event(
        action="users.update",
        resource_type="user",
        resource_id="u1",
        actor_uid="admin1",
        actor_role="super_admin",
    )
    second = backend_app._audit_append_event(
        action="coupons.create",
        resource_type="coupon",
        resource_id="c1",
        actor_uid="admin1",
        actor_role="super_admin",
    )
    assert first["ok"] is True
    assert second["ok"] is True

    verify_ok = backend_app._audit_verify_chain(limit=500)
    assert verify_ok["ok"] is True
    assert verify_ok["checked"] >= 2

    first_event_id = backend_app._INMEMORY_AUDIT_LEDGER_ORDER[0]
    backend_app._INMEMORY_AUDIT_LEDGER_EVENTS[first_event_id]["eventHash"] = "tampered"
    verify_bad = backend_app._audit_verify_chain(limit=500)
    assert verify_bad["ok"] is False
    assert verify_bad["mismatchAtSequence"] is not None


def test_alert_evaluator_respects_cooldown(monkeypatch) -> None:
    _reset_phase2_state()
    monkeypatch.setattr(backend_app, "VF_ALERT_ENGINE_ENABLED", True)
    monkeypatch.setattr(backend_app, "_alert_metric_sample", lambda _metric_key: 150.0)

    now_iso = backend_app._utc_now().isoformat()
    backend_app._alert_upsert_policy(
        "",
        {
            "name": "queue-depth",
            "metricKey": "queue_depth",
            "operator": "gte",
            "threshold": 100,
            "windowSec": 60,
            "cooldownSec": 3600,
            "severity": "warning",
            "enabled": True,
            "channels": ["in_app"],
            "createdAt": now_iso,
            "updatedAt": now_iso,
        },
    )

    first = backend_app._alert_evaluate_once()
    second = backend_app._alert_evaluate_once()
    assert first["opened"] == 1
    assert second["opened"] == 0
    assert len(backend_app._INMEMORY_ALERT_EVENTS) == 1


def test_scheduler_manual_run_records_runs_and_idempotency_key(monkeypatch) -> None:
    _reset_phase2_state()
    monkeypatch.setattr(backend_app, "VF_SCHEDULER_ENABLED", True)

    task = backend_app._scheduler_upsert_task(
        "",
        {
            "taskType": "coupon_abuse_scan",
            "cronExpr": "*/5 * * * *",
            "timezone": "UTC",
            "enabled": True,
            "dryRun": True,
            "payload": {},
            "concurrencyPolicy": "allow",
            "nextRunAt": backend_app._utc_now().isoformat(),
            "createdAt": backend_app._utc_now().isoformat(),
            "updatedAt": backend_app._utc_now().isoformat(),
        },
    )

    run_one = backend_app._scheduler_run_task(task["id"], requested_by="tester", dry_run_override=True)
    run_two = backend_app._scheduler_run_task(task["id"], requested_by="tester", dry_run_override=True)
    assert run_one["status"] == "completed"
    assert run_two["status"] == "completed"
    assert run_one["idempotencyKey"] == run_two["idempotencyKey"]
    assert len(backend_app._INMEMORY_SCHEDULER_RUNS) >= 2


def test_analytics_rate_math_definitions() -> None:
    row = {
        "checkoutsStarted": 20,
        "checkoutsCompleted": 15,
        "subscriptionsActivated": 10,
        "cancellationsWithin30d": 2,
        "grossAmount": 10000.0,
        "discountAmount": 2500.0,
        "netAmount": 7500.0,
    }
    computed = backend_app._analytics_compute_rates(dict(row))
    assert computed["conversionRate"] == 0.5
    assert computed["checkoutCompletionRate"] == 0.75
    assert computed["d30ChurnRate"] == 0.2
    assert computed["discountEfficiency"] == 3.0


def test_subscription_coupon_plan_specific_discount_checkout_selection(monkeypatch) -> None:
    _reset_phase2_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_require_stripe_ready", lambda: None)
    monkeypatch.setattr(backend_app, "STRIPE_PRICE_STARTER_MAX_INR", "price_starter_max_test")
    monkeypatch.setattr(backend_app, "STRIPE_PRICE_STARTER_RECURRING_INR", "price_starter_recurring_test")
    monkeypatch.setattr(backend_app, "STRIPE_PRICE_CREATOR_MAX_INR", "price_creator_max_test")
    monkeypatch.setattr(backend_app, "STRIPE_PRICE_CREATOR_RECURRING_INR", "price_creator_recurring_test")
    monkeypatch.setattr(backend_app, "STRIPE_PRICE_PRO_MAX_INR", "price_pro_max_test")
    monkeypatch.setattr(backend_app, "STRIPE_PRICE_PRO_RECURRING_INR", "price_pro_recurring_test")
    monkeypatch.setattr(backend_app, "STRIPE_PRICE_SCALE_MAX_INR", "price_scale_max_test")
    monkeypatch.setattr(backend_app, "STRIPE_PRICE_SCALE_RECURRING_INR", "price_scale_recurring_test")

    stripe_coupon_calls: list[dict] = []
    checkout_payloads: list[dict] = []

    class _FakeCoupon:
        counter = 0

        @classmethod
        def create(cls, **kwargs):
            cls.counter += 1
            stripe_coupon_calls.append(dict(kwargs))
            return {"id": f"cpn_phase2_{cls.counter}"}

        @staticmethod
        def delete(_coupon_id: str):
            return {"deleted": True}

    class _FakePromotionCode:
        @staticmethod
        def create(**_kwargs):
            return {"id": "promo_unused"}

        @staticmethod
        def modify(_promotion_id: str, **_kwargs):
            return {"ok": True}

    class _FakeCheckoutSession:
        @staticmethod
        def create(**kwargs):
            checkout_payloads.append(dict(kwargs))
            return {"id": "cs_phase2_1", "url": "https://example.test/checkout"}

    class _FakeCustomer:
        @staticmethod
        def create(**_kwargs):
            return {"id": "cus_phase2_1"}

    fake_stripe = type(
        "FakeStripe",
        (),
        {
            "Coupon": _FakeCoupon,
            "PromotionCode": _FakePromotionCode,
            "checkout": type("CheckoutNS", (), {"Session": _FakeCheckoutSession}),
            "Customer": _FakeCustomer,
        },
    )()
    monkeypatch.setattr(backend_app, "stripe", fake_stripe, raising=False)

    client = TestClient(backend_app.app)
    created = client.post(
        "/admin/coupons",
        headers={"x-dev-uid": "local_admin"},
        json={
            "code": "MULTIPLAN50",
            "couponType": "subscription_discount",
            "discountType": "percent",
            "planDiscounts": [
                {"plan": "pro", "discountType": "percent", "percentOff": 20},
                {"plan": "plus", "discountType": "percent", "percentOff": 35},
            ],
            "usagePolicy": "single_per_user",
        },
    )
    assert created.status_code == 200
    coupon = created.json()["coupon"]
    assert coupon["couponType"] == "subscription_discount"
    assert coupon["planDiscounts"]["pro"]["percentOff"] == 20
    assert coupon["planDiscounts"]["scale"]["percentOff"] == 35
    assert coupon["stripeCouponsByPlan"]["pro"] != coupon["stripeCouponsByPlan"]["scale"]
    assert str(coupon.get("stripePromotionCodeId") or "").strip() == ""

    checkout = client.post(
        "/billing/checkout-session",
        headers={"x-dev-uid": "user_plus_1"},
        json={"plan": "plus", "couponCode": "MULTIPLAN50"},
    )
    assert checkout.status_code == 200
    assert checkout_payloads, "expected Stripe checkout payload"
    discounts = checkout_payloads[0].get("discounts") or []
    assert discounts and isinstance(discounts, list)
    selected_coupon_id = str(discounts[0].get("coupon") or "")
    assert selected_coupon_id == coupon["stripeCouponsByPlan"]["scale"]
