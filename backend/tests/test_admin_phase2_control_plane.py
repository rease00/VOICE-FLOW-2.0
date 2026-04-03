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
    backend_app._INMEMORY_AUDIO_GENERATION_AUDIT.clear()

    backend_app._INMEMORY_COUPON_ANALYTICS_DAILY.clear()
    backend_app._INMEMORY_COUPON_SUB_ATTRIBUTIONS.clear()
    backend_app._INMEMORY_ACCOUNTING_DAILY_ROLLUP.clear()
    backend_app._INMEMORY_ACCOUNTING_MONITOR_RUNS.clear()

    backend_app._INMEMORY_ENTITLEMENTS.clear()
    backend_app._INMEMORY_USER_PROFILES.clear()
    backend_app._INMEMORY_USER_ID_INDEX.clear()
    backend_app._INMEMORY_COUPONS.clear()
    backend_app._INMEMORY_COUPON_CODE_INDEX.clear()
    backend_app._INMEMORY_COUPON_REDEMPTIONS.clear()
    backend_app._INMEMORY_STRIPE_CUSTOMERS.clear()
    backend_app._INMEMORY_WALLET_TRANSACTIONS.clear()


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


def test_audio_metadata_admin_endpoints_require_audit_read_and_log_exports(monkeypatch) -> None:
    _reset_phase2_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)

    row = backend_app._audio_generation_audit_create(
        {
            "auditId": "audit_audio_meta_1",
            "uid": "user_audio_meta_1",
            "userId": "user_audio_meta_1",
            "identityType": "email",
            "identityValue": "user@example.com",
            "email": "user@example.com",
            "submittedAt": backend_app._utc_now().isoformat(),
            "status": "completed",
            "engine": "PRIME",
            "requestId": "req_audio_meta_1",
            "jobId": "req_audio_meta_1",
            "traceId": "trace_audio_meta_1",
            "inputText": "Audit export coverage text.",
            "sourceIp": "203.0.113.8",
            "paymentRefType": "invoice",
            "paymentRef": "in_audio_meta_1",
        }
    )
    assert row["auditId"] == "audit_audio_meta_1"

    backend_app._rbac_write_assignment(
        "audit_reader",
        {
            "role": "read_only_ops",
            "allowOverrides": [],
            "denyOverrides": [],
            "status": "active",
            "updatedBy": "seed",
        },
    )

    client = TestClient(backend_app.app)

    denied = client.get("/admin/audio-metadata/records", headers={"x-dev-uid": "plain_user"})
    assert denied.status_code == 403

    listed = client.get("/admin/audio-metadata/records", headers={"x-dev-uid": "audit_reader"})
    assert listed.status_code == 200
    assert listed.json()["count"] == 1

    detail = client.get("/admin/audio-metadata/records/audit_audio_meta_1", headers={"x-dev-uid": "audit_reader"})
    assert detail.status_code == 200
    assert detail.json()["record"]["inputText"] == "Audit export coverage text."

    exported = client.get("/admin/audio-metadata/export.csv", headers={"x-dev-uid": "audit_reader"})
    assert exported.status_code == 200
    assert "audit_audio_meta_1" in exported.text
    assert "Audit export coverage text." in exported.text

    actions = [str(item.get("action") or "") for item in backend_app._INMEMORY_AUDIT_LEDGER_EVENTS.values()]
    assert "audio_metadata_view" in actions
    assert "audio_metadata_export" in actions


def test_audio_metadata_repair_migration_dry_run_apply_verify_logs_audit_events(monkeypatch) -> None:
    _reset_phase2_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_firestore_collection", lambda _name: None)
    monkeypatch.setattr(
        backend_app,
        "_require_permission",
        lambda _request, _permission: ("audio_admin", {"role": backend_app.RBAC_ROLE_SUPER_ADMIN}),
    )
    monkeypatch.setattr(backend_app, "_require_admin_mutation_unlock", lambda _request, expected_uid=None: str(expected_uid or "audio_admin"))

    backend_app._INMEMORY_AUDIO_GENERATION_AUDIT["audit_repair_1"] = {
        "auditId": "audit_repair_1",
        "uid": "user_audio_repair",
        "submittedAt": "2026-03-29T00:00:00+00:00",
        "status": "received",
        "engine": "GEM PRO",
        "requestId": "req_audio_repair_1",
        "jobId": "job_audio_repair_1",
        "traceId": "trace_audio_repair_1",
        "inputText": "repair contract coverage",
    }

    client = TestClient(backend_app.app)

    dry_run = client.post("/admin/engine-canonicalization/migrate", json={"mode": "dry_run"})
    assert dry_run.status_code == 200
    dry_payload = dry_run.json()
    assert dry_payload["mode"] == "dry_run"
    assert dry_payload["dryRun"] is True
    assert dry_payload["collections"]["audio_generation_audit"]["changed"] == 1
    assert backend_app._INMEMORY_AUDIO_GENERATION_AUDIT["audit_repair_1"]["engine"] == "GEM PRO"

    apply_response = client.post("/admin/engine-canonicalization/migrate", json={"mode": "apply"})
    assert apply_response.status_code == 200
    apply_payload = apply_response.json()
    assert apply_payload["mode"] == "apply"
    assert apply_payload["applied"] is True
    assert backend_app._INMEMORY_AUDIO_GENERATION_AUDIT["audit_repair_1"]["engine"] == "PRIME"

    verify_response = client.post("/admin/engine-canonicalization/migrate", json={"mode": "verify"})
    assert verify_response.status_code == 200
    verify_payload = verify_response.json()
    assert verify_payload["mode"] == "verify"
    assert verify_payload["verified"] is True
    assert verify_payload["ok"] is True

    actions = [str(item.get("action") or "") for item in backend_app._INMEMORY_AUDIT_LEDGER_EVENTS.values()]
    assert actions.count("engine_canonicalization_migrate") == 3


def test_audio_metadata_retention_cleanup_removes_only_expired_records(monkeypatch) -> None:
    _reset_phase2_state()
    monkeypatch.setattr(backend_app, "VF_SCHEDULER_ENABLED", True)

    now = backend_app._utc_now()
    expired_submitted = now.replace(year=now.year - 6).isoformat()
    fresh_submitted = now.isoformat()

    backend_app._audio_generation_audit_create(
        {
            "auditId": "audit_expired",
            "uid": "expired_user",
            "submittedAt": expired_submitted,
            "status": "failed",
            "inputText": "expired",
            "sourceIp": "198.51.100.10",
        }
    )
    backend_app._audio_generation_audit_create(
        {
            "auditId": "audit_fresh",
            "uid": "fresh_user",
            "submittedAt": fresh_submitted,
            "status": "completed",
            "inputText": "fresh",
            "sourceIp": "198.51.100.11",
        }
    )

    result = backend_app._scheduler_execute_task(
        {"taskType": "audio_generation_audit_retention_cleanup"},
        requested_by="tester",
        dry_run=False,
    )
    assert result["ok"] is True
    assert result["deletedCount"] == 1
    assert "audit_expired" not in backend_app._INMEMORY_AUDIO_GENERATION_AUDIT
    assert "audit_fresh" in backend_app._INMEMORY_AUDIO_GENERATION_AUDIT


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
    monkeypatch.setattr(backend_app, "_razorpay_available", lambda: True)
    monkeypatch.setattr(backend_app, "_razorpay_key_id", lambda: "rzp_test_key")
    monkeypatch.setattr(backend_app, "_razorpay_key_secret", lambda: "rzp_test_secret")
    monkeypatch.setattr(
        backend_app,
        "_razorpay_plan_id_for_plan",
        lambda plan, phase="recurring": f"{plan}_{phase}_plan",
    )

    stripe_coupon_calls: list[dict] = []

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
            "Customer": _FakeCustomer,
        },
    )()
    monkeypatch.setattr(backend_app, "stripe", fake_stripe, raising=False)
    monkeypatch.setattr(
        backend_app.razorpay_billing,
        "create_customer",
        lambda **_kwargs: {"customer_id": "cus_phase2_1", "id": "cus_phase2_1"},
    )
    monkeypatch.setattr(
        backend_app.razorpay_billing,
        "create_subscription",
        lambda *args, **_kwargs: {"subscription_id": "scale_recurring_plan", "id": "scale_recurring_plan"},
    )

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
        headers={"x-dev-uid": "user_plus_1", "Idempotency-Key": "user_plus_1:plus:multiplan50"},
        json={"plan": "plus", "couponCode": "MULTIPLAN50"},
    )
    assert checkout.status_code == 200
    payload = checkout.json()
    assert payload["provider"] == "razorpay"
    assert payload["kind"] == "subscription"
    assert payload["subscriptionId"] == "scale_recurring_plan"
    assert payload["subscriptionOptions"]["subscription_id"] == "scale_recurring_plan"
    assert payload["subscriptionOptions"]["key"] == "rzp_test_key"
    assert payload["subscriptionOptions"]["notes"]["plan"] == "scale"
    assert payload["subscriptionOptions"]["notes"]["couponCode"] == "MULTIPLAN50"
