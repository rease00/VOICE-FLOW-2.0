from __future__ import annotations

from datetime import timedelta
import json
from urllib.parse import quote

from fastapi.testclient import TestClient

import app as backend_app


def _reset_accounting_state() -> None:
    backend_app._INMEMORY_ADMIN_ROLES.clear()
    backend_app._RBAC_ACTOR_CACHE.clear()
    backend_app._INMEMORY_AUDIT_LEDGER_EVENTS.clear()
    backend_app._INMEMORY_AUDIT_LEDGER_ORDER.clear()
    backend_app._INMEMORY_AUDIT_LEDGER_STATE.clear()
    backend_app._INMEMORY_ALERT_EVENTS.clear()
    backend_app._INMEMORY_ALERT_POLICIES.clear()
    backend_app._INMEMORY_ALERT_DESTINATIONS.clear()
    backend_app._INMEMORY_ACCOUNTING_DAILY_ROLLUP.clear()
    backend_app._INMEMORY_ACCOUNTING_MONITOR_RUNS.clear()
    backend_app._INMEMORY_USAGE_EVENTS.clear()
    backend_app._INMEMORY_SCHEDULER_TASKS.clear()
    backend_app._INMEMORY_SCHEDULER_RUNS.clear()


def test_admin_accounting_read_endpoints_require_billing_read(monkeypatch) -> None:
    _reset_accounting_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)

    backend_app._rbac_write_assignment(
        "billing_reader",
        {
            "role": backend_app.RBAC_ROLE_BILLING_OPS,
            "allowOverrides": [],
            "denyOverrides": [],
            "status": "active",
            "updatedBy": "seed",
        },
    )

    client = TestClient(backend_app.app)
    denied = client.get("/admin/accounting/summary", headers={"x-dev-uid": "plain_user"})
    assert denied.status_code == 403

    allowed = client.get("/admin/accounting/summary", headers={"x-dev-uid": "billing_reader"})
    assert allowed.status_code == 200
    payload = allowed.json()
    assert payload.get("ok") is True
    assert isinstance(payload.get("summary"), dict)

    timeseries = client.get("/admin/accounting/timeseries", headers={"x-dev-uid": "billing_reader"})
    assert timeseries.status_code == 200
    assert timeseries.json().get("ok") is True

    records = client.get("/admin/accounting/records", headers={"x-dev-uid": "billing_reader"})
    assert records.status_code == 200
    assert records.json().get("ok") is True


def test_admin_accounting_monitor_run_requires_billing_write_and_unlock(monkeypatch) -> None:
    _reset_accounting_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(
        backend_app,
        "_verify_firebase_id_token",
        lambda _token: {"uid": "billing_writer", "admin": True, "iat": 1710000000},
    )

    client = TestClient(backend_app.app)
    auth_headers = {"Authorization": "Bearer billing_writer:1710000000"}

    blocked = client.post(
        "/admin/accounting/monitor/run",
        headers=auth_headers,
        json={"dryRun": True},
    )
    assert blocked.status_code == 403
    assert "X-Admin-Unlock" in str((blocked.json() or {}).get("detail") or "")

    issued = client.post("/admin/session-unlock/issue", headers=auth_headers)
    assert issued.status_code == 200
    unlock_key = str((issued.json() or {}).get("unlockKey") or "").strip()
    assert unlock_key

    verified = client.post(
        "/admin/session-unlock/verify",
        headers=auth_headers,
        json={"unlockKey": unlock_key},
    )
    assert verified.status_code == 200
    unlock_token = str((verified.json() or {}).get("unlockToken") or "").strip()
    assert unlock_token

    allowed = client.post(
        "/admin/accounting/monitor/run",
        headers={**auth_headers, "X-Admin-Unlock": f"Bearer {unlock_token}"},
        json={"dryRun": True},
    )
    assert allowed.status_code == 200
    payload = allowed.json()
    assert payload.get("ok") is True
    assert isinstance(payload.get("runId"), str)


def test_runtime_usage_header_parsing_and_usage_event_attachment() -> None:
    _reset_accounting_state()
    header_payload = {"promptTokens": 120, "outputTokens": 45, "totalTokens": 165, "providerReported": True}
    encoded = quote(json.dumps(header_payload, separators=(",", ":")))
    parsed = backend_app._parse_runtime_usage_header(encoded)
    assert parsed == header_payload

    uid = "usage_user"
    request_id = "usage_req_1"
    event_doc_id = f"{uid}_{request_id}"
    backend_app._INMEMORY_USAGE_EVENTS[event_doc_id] = {
        "uid": uid,
        "requestId": request_id,
        "status": "reserved",
    }
    backend_app._usage_event_attach_runtime_usage(uid, request_id, parsed, mode="standard", trace_id="trace_usage")
    updated = backend_app._INMEMORY_USAGE_EVENTS[event_doc_id]
    assert (updated.get("runtimeUsage") or {}).get("totalTokens") == 165
    assert (updated.get("runtimeUsage") or {}).get("providerReported") is True
    assert str(updated.get("runtimeMode") or "") == "standard"
    assert str(updated.get("traceId") or "") == "trace_usage"


def test_accounting_usage_events_skip_fallback_token_estimates_without_provider_usage() -> None:
    _reset_accounting_state()
    now = backend_app._utc_now()
    event_doc_id = "ghost_user_ghost_req"
    backend_app._INMEMORY_USAGE_EVENTS[event_doc_id] = {
        "id": event_doc_id,
        "uid": "ghost_user",
        "requestId": "ghost_req",
        "status": "committed",
        "engine": "PRIME",
        "chars": 120,
        "createdAt": now.isoformat(),
        "updatedAt": now.isoformat(),
    }

    rows = backend_app._accounting_list_usage_events(now - timedelta(minutes=1), now + timedelta(minutes=1))
    assert len(rows) == 1
    row = rows[0]
    assert row.get("totalTokens") == 0
    assert row.get("promptTokens") == 0
    assert row.get("outputTokens") == 0
    assert row.get("fallbackEstimated") is False
    assert int(row.get("estimatedTokens") or 0) > 0
    assert row.get("providerReported") is False


def test_scheduler_executes_accounting_monitor_task(monkeypatch) -> None:
    _reset_accounting_state()
    monkeypatch.setattr(backend_app, "VF_ACCOUNTING_MONITOR_ENABLED", True)
    assert backend_app.VF_SCHEDULER_TICK_SECONDS == 60
    result = backend_app._scheduler_execute_task(
        {"taskType": "accounting_monitor_daily"},
        requested_by="tester",
        dry_run=True,
    )
    assert result.get("ok") is True
    assert "anomalyCount" in result


def test_scheduler_executes_billing_reconciliation_task(monkeypatch) -> None:
    _reset_accounting_state()
    captured: list[bool] = []

    def _fake_reconcile(*, dry_run: bool = False):
        captured.append(bool(dry_run))
        return {"ok": True, "dryRun": bool(dry_run), "usageScanned": 2, "webhookFailed": 1}

    monkeypatch.setattr(backend_app, "_billing_usage_webhook_reconciliation", _fake_reconcile)
    result = backend_app._scheduler_execute_task(
        {"taskType": "billing_usage_webhook_reconciliation"},
        requested_by="tester",
        dry_run=True,
    )
    assert result.get("ok") is True
    assert result.get("dryRun") is True
    assert result.get("usageScanned") == 2
    assert captured == [True]


def test_billing_usage_reconciliation_uses_finalize_helper_for_stale_reserved_events(monkeypatch) -> None:
    _reset_accounting_state()
    uid = "reconcile_user"
    request_id = "reconcile_request_1"
    now = backend_app._utc_now()
    month_doc_id = backend_app._inmemory_usage_month_doc_id(uid, now)
    day_doc_id = backend_app._inmemory_usage_day_doc_id(uid, now)

    entitlement = backend_app._default_entitlement(uid)
    entitlement["vffBalance"] = 0.0
    entitlement = backend_app._append_paid_vf_credit_lot(
        entitlement,
        amount=500,
        reason="stripe_token_pack",
        transaction_id="reconcile_lot_1",
        metadata={"kind": "token_pack"},
        now=now,
    )
    backend_app._INMEMORY_ENTITLEMENTS[uid] = entitlement
    paid_balance_before_reserve = float(entitlement.get("paidVfBalance") or 0)

    monthly_usage, daily_usage = backend_app._usage_defaults(uid, now)
    monthly_usage["monthlyFreeVfUsed"] = float(entitlement.get("monthlyVfLimit") or 0)
    backend_app._INMEMORY_USAGE_MONTHLY[month_doc_id] = monthly_usage
    backend_app._INMEMORY_USAGE_DAILY[day_doc_id] = daily_usage

    reservation = backend_app._reserve_usage(uid, request_id, "PRIME", 12)
    assert reservation["ok"] is True
    paid_balance_after_reserve = float(backend_app._load_entitlement(uid).get("paidVfBalance") or 0)
    assert paid_balance_after_reserve <= paid_balance_before_reserve
    reserved_event = dict(reservation["event"] or {})
    reserved_event["updatedAt"] = "2024-01-01T00:00:00+00:00"
    reserved_event["createdAt"] = "2024-01-01T00:00:00+00:00"
    backend_app._INMEMORY_USAGE_EVENTS[f"{uid}_{request_id}"] = reserved_event

    original_finalize = backend_app._finalize_usage
    finalize_calls: list[tuple[str, str, bool, str]] = []

    def _spy_finalize(spy_uid: str, spy_request_id: str, success: bool, error_detail: str = "") -> None:
        finalize_calls.append((spy_uid, spy_request_id, bool(success), str(error_detail)))
        original_finalize(spy_uid, spy_request_id, success, error_detail)

    monkeypatch.setattr(backend_app, "_finalize_usage", _spy_finalize)

    result = backend_app._billing_usage_webhook_reconciliation(dry_run=False)

    assert result["ok"] is True
    assert result["usageReverted"] == 1
    assert finalize_calls == [(uid, request_id, False, "reconciler_stale_reserved")]

    reverted_event = backend_app._INMEMORY_USAGE_EVENTS[f"{uid}_{request_id}"]
    assert str(reverted_event.get("status") or "") == "reverted"
    assert abs(float(backend_app._load_entitlement(uid).get("paidVfBalance") or 0) - paid_balance_before_reserve) < 1e-6
    assert int((backend_app._INMEMORY_USAGE_MONTHLY[month_doc_id] or {}).get("generationCount") or 0) == 0
    assert int((backend_app._INMEMORY_USAGE_DAILY[day_doc_id] or {}).get("generationCount") or 0) == 0


def test_accounting_summary_exposes_cloud_run_source_warning_when_bigquery_unconfigured(monkeypatch) -> None:
    _reset_accounting_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)
    monkeypatch.setattr(backend_app, "VF_ACCOUNTING_BQ_PROJECT", "")
    monkeypatch.setattr(backend_app, "VF_ACCOUNTING_BQ_DATASET", "")
    monkeypatch.setattr(backend_app, "VF_ACCOUNTING_BQ_TABLE", "")

    backend_app._rbac_write_assignment(
        "billing_reader",
        {
            "role": backend_app.RBAC_ROLE_BILLING_OPS,
            "allowOverrides": [],
            "denyOverrides": [],
            "status": "active",
            "updatedBy": "seed",
        },
    )

    client = TestClient(backend_app.app)
    response = client.get("/admin/accounting/summary", headers={"x-dev-uid": "billing_reader"})
    assert response.status_code == 200
    payload = response.json() or {}
    assert payload.get("ok") is True
    cloud_source = str(((payload.get("sourceStatus") or {}).get("cloudRunCpu") or "")).lower()
    assert cloud_source in {"partial", "unavailable"}
    warnings = [str(item or "") for item in (payload.get("warnings") or [])]
    assert any("Cloud Run CPU" in item for item in warnings)
