from __future__ import annotations

from fastapi.testclient import TestClient

import app as backend_app


class _InlineThread:
    def __init__(
        self,
        group=None,
        target=None,
        name=None,
        args=(),
        kwargs=None,
        *,
        daemon=None,
    ) -> None:
        _ = group, name, daemon
        self._target = target
        self._args = args
        self._kwargs = kwargs or {}

    def start(self) -> None:
        if callable(self._target):
            self._target(*self._args, **self._kwargs)

    def join(self, timeout=None) -> None:
        _ = timeout


def _reset_notification_state() -> None:
    backend_app._INMEMORY_ADMIN_ROLES.clear()
    backend_app._RBAC_ACTOR_CACHE.clear()

    backend_app._INMEMORY_ALERT_POLICIES.clear()
    backend_app._INMEMORY_ALERT_DESTINATIONS.clear()
    backend_app._INMEMORY_ALERT_EVENTS.clear()

    backend_app._INMEMORY_AUDIT_LEDGER_EVENTS.clear()
    backend_app._INMEMORY_AUDIT_LEDGER_ORDER.clear()
    backend_app._INMEMORY_AUDIT_LEDGER_STATE.clear()

    backend_app._INMEMORY_SUPPORT_CONVERSATIONS.clear()
    backend_app._INMEMORY_SUPPORT_MESSAGES.clear()
    backend_app._INMEMORY_SUPPORT_AI_RUNS.clear()
    backend_app._INMEMORY_SUPPORT_AI_POLICY.clear()

    backend_app._INMEMORY_USER_PROFILES.clear()
    backend_app._INMEMORY_USER_ID_INDEX.clear()

    backend_app._INMEMORY_NOTIFICATION_INBOX.clear()
    backend_app._INMEMORY_NOTIFICATION_PREFERENCES.clear()
    backend_app._INMEMORY_NOTIFICATION_EMAIL_OUTBOX.clear()


def _open_alert(
    *,
    policy_id: str,
    resource_type: str,
    resource_id: str,
    severity: str = "warning",
    reason: str = "threshold_exceeded",
) -> dict:
    now_iso = backend_app._utc_now().isoformat()
    return backend_app._alert_upsert_event(
        "",
        {
            "policyId": policy_id,
            "resourceType": resource_type,
            "resourceId": resource_id,
            "status": "open",
            "severity": severity,
            "openedAt": now_iso,
            "lastTriggeredAt": now_iso,
            "resolvedAt": None,
            "samples": [{"ts": now_iso, "reason": reason}],
            "channels": ["in_app"],
            "delivery": [],
        },
    )


def _notification_event_codes(uid: str) -> list[str]:
    rows = backend_app._notification_list_items(uid, limit=1000, actor={"uid": uid, "role": "super_admin", "permissions": list(backend_app.RBAC_PERMISSIONS), "status": "active"})
    return [str(row.get("eventCode") or "") for row in rows]


def _enable_notification_email(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_NOTIFICATIONS_EMAIL_ENABLED", True)
    monkeypatch.setattr(backend_app, "RESEND_API_KEY", "re_test_notifications")
    monkeypatch.setattr(backend_app, "VF_NOTIFICATIONS_EMAIL_FROM", "Voice Flow <notifications@voiceflow.local>")
    monkeypatch.setattr(backend_app, "threading", type("_ThreadModule", (), {"Thread": _InlineThread}))
    monkeypatch.setattr(backend_app, "_notification_email_for_uid", lambda _uid: "user@example.com")


def test_notification_endpoints_honor_rbac_actor_for_admin_inbox_and_preferences(monkeypatch) -> None:
    _reset_notification_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)

    backend_app._rbac_write_assignment(
        "billing_ops_user",
        {
            "role": backend_app.RBAC_ROLE_BILLING_OPS,
            "allowOverrides": [],
            "denyOverrides": [],
            "status": "active",
            "updatedBy": "seed",
        },
    )
    _open_alert(policy_id="billing_spend_threshold", resource_type="billing", resource_id="invoice_1")

    client = TestClient(backend_app.app)

    actor_response = client.get("/admin/actor", headers={"x-dev-uid": "billing_ops_user"})
    assert actor_response.status_code == 200
    actor_payload = actor_response.json()["actor"]
    assert actor_payload["role"] == backend_app.RBAC_ROLE_BILLING_OPS
    assert backend_app.PERM_BILLING_READ in list(actor_payload.get("permissions") or [])

    prefs_response = client.get("/account/notification-preferences", headers={"x-dev-uid": "billing_ops_user"})
    assert prefs_response.status_code == 200
    assert prefs_response.json()["preferences"]["emailAdminAlerts"] is True

    inbox_response = client.get("/account/notifications", headers={"x-dev-uid": "billing_ops_user"})
    assert inbox_response.status_code == 200
    items = list(inbox_response.json()["items"] or [])
    assert len(items) == 1
    assert items[0]["eventCode"] == "admin.alert.opened"
    assert items[0]["requiredPermission"] == backend_app.PERM_BILLING_READ

    plain_response = client.get("/account/notifications", headers={"x-dev-uid": "plain_user"})
    assert plain_response.status_code == 200
    assert plain_response.json()["items"] == []


def test_admin_alert_broadcast_filters_recipients_by_permission(monkeypatch) -> None:
    _reset_notification_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)

    backend_app._rbac_write_assignment("billing_user", {"role": backend_app.RBAC_ROLE_BILLING_OPS, "status": "active", "updatedBy": "seed"})
    backend_app._rbac_write_assignment("support_user", {"role": backend_app.RBAC_ROLE_SUPPORT_OPS, "status": "active", "updatedBy": "seed"})
    backend_app._rbac_write_assignment("reader_user", {"role": backend_app.RBAC_ROLE_READ_ONLY_OPS, "status": "active", "updatedBy": "seed"})

    _open_alert(policy_id="billing_spend_threshold", resource_type="billing", resource_id="invoice_9")
    _open_alert(policy_id="support_unresolved", resource_type="support_conversation", resource_id="conv_9")

    client = TestClient(backend_app.app)

    billing_items = client.get("/account/notifications", headers={"x-dev-uid": "billing_user"}).json()["items"]
    support_items = client.get("/account/notifications", headers={"x-dev-uid": "support_user"}).json()["items"]
    reader_items = client.get("/account/notifications", headers={"x-dev-uid": "reader_user"}).json()["items"]

    assert {item["requiredPermission"] for item in billing_items} == {backend_app.PERM_BILLING_READ}
    assert {item["requiredPermission"] for item in support_items} == {backend_app.PERM_SUPPORT_READ}
    assert {item["requiredPermission"] for item in reader_items} == {
        backend_app.PERM_BILLING_READ,
        backend_app.PERM_SUPPORT_READ,
    }


def test_support_reply_and_resolution_create_user_inbox_items_and_email(monkeypatch) -> None:
    _reset_notification_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)
    _enable_notification_email(monkeypatch)
    monkeypatch.setattr(backend_app, "_notification_send_email_via_resend", lambda **_kwargs: (True, "email_ok_1"))

    now_iso = backend_app._utc_now().isoformat()
    backend_app._support_conversation_upsert(
        "conv_support_1",
        {
            "uid": "customer_uid",
            "userId": "customer1",
            "status": "open",
            "priority": "green",
            "lastMessageAt": now_iso,
            "assignedTo": "",
            "createdAt": now_iso,
            "updatedAt": now_iso,
        },
    )

    client = TestClient(backend_app.app)
    reply = client.post(
        "/admin/support/conversations/conv_support_1/reply",
        headers={"x-dev-uid": "local_admin"},
        json={"text": "We investigated the issue and pushed a fix."},
    )
    assert reply.status_code == 200

    resolved = client.post(
        "/admin/support/conversations/conv_support_1/resolve",
        headers={"x-dev-uid": "local_admin"},
    )
    assert resolved.status_code == 200

    inbox = client.get("/account/notifications", headers={"x-dev-uid": "customer_uid"})
    assert inbox.status_code == 200
    event_codes = [str(item.get("eventCode") or "") for item in inbox.json()["items"]]
    assert "support.reply.received" in event_codes
    assert "support.conversation.resolved" in event_codes

    outbox_rows = list(backend_app._INMEMORY_NOTIFICATION_EMAIL_OUTBOX.values())
    assert len(outbox_rows) == 2
    assert {str(row.get("status") or "") for row in outbox_rows} == {"delivered"}


def test_notification_email_delivery_marks_retry_pending_without_raising(monkeypatch) -> None:
    _reset_notification_state()
    delivery = backend_app._notification_email_outbox_upsert(
        "",
        {
            "uid": "retry_user",
            "notificationId": "notif_retry_1",
            "eventCode": "support.reply.received",
            "to": "retry@example.com",
            "subject": "Voice Flow: Retry",
            "text": "Retry body",
            "status": "pending",
            "attempts": 0,
            "createdAt": backend_app._utc_now().isoformat(),
            "updatedAt": backend_app._utc_now().isoformat(),
        },
    )
    monkeypatch.setattr(backend_app, "_notification_send_email_via_resend", lambda **_kwargs: (False, "temporary_network_failure"))

    updated = backend_app._notification_attempt_email_delivery(str(delivery.get("id") or ""))

    assert updated["status"] == "retry_pending"
    assert int(updated["attempts"] or 0) == 1
    assert "temporary_network_failure" in str(updated.get("lastError") or "")
    assert int(updated.get("nextAttemptAtMs") or 0) > 0


def test_tts_completed_email_only_sends_for_long_running_jobs(monkeypatch) -> None:
    _reset_notification_state()
    _enable_notification_email(monkeypatch)
    monkeypatch.setattr(backend_app, "VF_NOTIFICATIONS_JOB_EMAIL_MIN_DURATION_MS", 90_000)
    monkeypatch.setattr(backend_app, "_notification_send_email_via_resend", lambda **_kwargs: (True, "email_ok_tts"))

    backend_app._notification_emit_tts_job_terminal(
        {
            "uid": "tts_user",
            "jobId": "tts_short",
            "engine": "GEM",
            "createdAtMs": 1_000,
            "finishedAtMs": 31_000,
        },
        status="completed",
    )
    backend_app._notification_emit_tts_job_terminal(
        {
            "uid": "tts_user",
            "jobId": "tts_long",
            "engine": "GEM",
            "createdAtMs": 1_000,
            "finishedAtMs": 91_500,
        },
        status="completed",
    )

    outbox_rows = list(backend_app._INMEMORY_NOTIFICATION_EMAIL_OUTBOX.values())
    assert len(outbox_rows) == 1
    assert str(outbox_rows[0].get("notificationId") or "").strip()

    event_codes = _notification_event_codes("tts_user")
    assert "tts.job.completed" in event_codes
