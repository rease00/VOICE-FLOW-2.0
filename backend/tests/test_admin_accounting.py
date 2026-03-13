from __future__ import annotations

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
    header_payload = {"promptTokens": 120, "outputTokens": 45, "totalTokens": 165}
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
    assert str(updated.get("runtimeMode") or "") == "standard"
    assert str(updated.get("traceId") or "") == "trace_usage"


def test_scheduler_executes_accounting_monitor_task(monkeypatch) -> None:
    _reset_accounting_state()
    monkeypatch.setattr(backend_app, "VF_ACCOUNTING_MONITOR_ENABLED", True)
    result = backend_app._scheduler_execute_task(
        {"taskType": "accounting_monitor_daily"},
        requested_by="tester",
        dry_run=True,
    )
    assert result.get("ok") is True
    assert "anomalyCount" in result


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
