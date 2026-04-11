from __future__ import annotations

import pytest

from fastapi.testclient import TestClient

import app as backend_app


ADMIN_NOTICES_UNAVAILABLE = pytest.mark.skip(reason="Admin notices subsystem is absent in this fork.")


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
    if hasattr(backend_app, "_INMEMORY_ADMIN_BROADCAST_NOTICES"):
        backend_app._INMEMORY_ADMIN_BROADCAST_NOTICES.clear()


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
    monkeypatch.setattr(backend_app, "VF_NOTIFICATIONS_EMAIL_FROM", "V FLOW AI <notifications@v-flow-ai.local>")
    monkeypatch.setattr(backend_app, "threading", type("_ThreadModule", (), {"Thread": _InlineThread}))
    monkeypatch.setattr(backend_app, "_notification_email_for_uid", lambda _uid: "user@example.com")


def _admin_headers(uid: str = "local_admin") -> dict[str, str]:
    return {"x-dev-uid": uid}


def _auth_headers(uid: str, iat: int = 1710000000) -> dict[str, str]:
    return {"Authorization": f"Bearer {uid}:{iat}"}


def _fake_admin_claims(token: str) -> dict[str, object]:
    raw = str(token or "").strip()
    uid_raw, _, iat_raw = raw.partition(":")
    uid = uid_raw or "admin_unlock_user"
    try:
        iat = int(iat_raw or "1710000000")
    except Exception:
        iat = 1710000000
    return {
        "uid": uid,
        "admin": uid.startswith("local_admin"),
        "iat": iat,
    }


def _issue_admin_unlock_token(client: TestClient, *, uid: str = "local_admin") -> str:
    headers = _auth_headers(uid) if backend_app.VF_AUTH_ENFORCE else _admin_headers(uid)
    issued = client.post("/admin/session-unlock/issue", headers=headers)
    assert issued.status_code == 200
    unlock_key = str((issued.json() or {}).get("unlockKey") or "").strip()
    assert unlock_key

    verified = client.post(
        "/admin/session-unlock/verify",
        headers=headers,
        json={"unlockKey": unlock_key},
    )
    assert verified.status_code == 200
    unlock_token = str((verified.json() or {}).get("unlockToken") or "").strip()
    assert unlock_token
    return unlock_token


def _grant_admin_reader_via_api(
    client: TestClient,
    *,
    actor_uid: str,
    unlock_token: str,
    target_uid: str,
    permission: str,
    role: str = backend_app.RBAC_ROLE_READ_ONLY_OPS,
) -> None:
    actor_headers = _auth_headers(actor_uid) if backend_app.VF_AUTH_ENFORCE else _admin_headers(actor_uid)
    response = client.put(
        f"/admin/rbac/users/{target_uid}",
        headers={**actor_headers, "X-Admin-Unlock": f"Bearer {unlock_token}"},
        json={
            "role": role,
            "allowOverrides": [permission],
            "denyOverrides": [],
            "status": "active",
        },
    )
    assert response.status_code == 200


def _notification_item_ids(uid: str, *, actor: dict[str, object] | None = None) -> list[str]:
    actor_payload = actor or {
        "uid": uid,
        "role": "super_admin",
        "permissions": list(backend_app.RBAC_PERMISSIONS),
        "status": "active",
    }
    rows = backend_app._notification_list_items(uid, limit=1000, actor=actor_payload)
    return [str(row.get("id") or "") for row in rows]


def test_notification_endpoints_honor_rbac_actor_for_admin_inbox_and_preferences(monkeypatch) -> None:
    _reset_notification_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)

    backend_app._rbac_write_assignment(
        "read_only_ops_user",
        {
            "role": backend_app.RBAC_ROLE_READ_ONLY_OPS,
            "allowOverrides": [],
            "denyOverrides": [],
            "status": "active",
            "updatedBy": "seed",
        },
    )
    _open_alert(policy_id="billing_spend_threshold", resource_type="billing", resource_id="invoice_1")

    client = TestClient(backend_app.app)

    actor_response = client.get("/admin/actor", headers={"x-dev-uid": "read_only_ops_user"})
    assert actor_response.status_code == 200
    actor_payload = actor_response.json()["actor"]
    assert actor_payload["role"] == backend_app.RBAC_ROLE_READ_ONLY_OPS
    assert backend_app.PERM_BILLING_READ in list(actor_payload.get("permissions") or [])

    prefs_response = client.get("/account/notification-preferences", headers={"x-dev-uid": "read_only_ops_user"})
    assert prefs_response.status_code == 200
    assert prefs_response.json()["preferences"]["emailAdminAlerts"] is True

    inbox_response = client.get("/account/notifications", headers={"x-dev-uid": "read_only_ops_user"})
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


@ADMIN_NOTICES_UNAVAILABLE
def test_admin_broadcast_notice_requires_permission_and_unlock_via_api(monkeypatch) -> None:
    _reset_notification_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)
    monkeypatch.setattr(backend_app, "_verify_firebase_id_token", _fake_admin_claims)

    client = TestClient(backend_app.app)
    admin_unlock_token = _issue_admin_unlock_token(client, uid="local_admin")

    _grant_admin_reader_via_api(
        client,
        actor_uid="local_admin",
        unlock_token=admin_unlock_token,
        target_uid="support_broadcast_reader",
        permission=backend_app.PERM_SUPPORT_REPLY,
        role=backend_app.RBAC_ROLE_SUPPORT_OPS,
    )

    conversation_id = "conv_broadcast_notice_1"
    now_iso = backend_app._utc_now().isoformat()
    backend_app._support_conversation_upsert(
        conversation_id,
        {
            "uid": "support_broadcast_reader",
            "userId": "support_broadcast_reader_profile",
            "status": "open",
            "priority": "green",
            "lastMessageAt": now_iso,
            "assignedTo": "",
            "createdAt": now_iso,
            "updatedAt": now_iso,
        },
    )

    denied = client.post(
        f"/admin/support/conversations/{conversation_id}/resolve",
        headers=_auth_headers("support_broadcast_reader"),
    )
    assert denied.status_code == 403

    support_unlock_response = client.post(
        "/admin/session-unlock/issue",
        headers=_auth_headers("support_broadcast_reader"),
    )
    assert support_unlock_response.status_code == 200
    support_unlock_key = str((support_unlock_response.json() or {}).get("unlockKey") or "").strip()
    assert support_unlock_key

    support_verified = client.post(
        "/admin/session-unlock/verify",
        headers=_auth_headers("support_broadcast_reader"),
        json={"unlockKey": support_unlock_key},
    )
    assert support_verified.status_code == 200
    support_unlock_token = str((support_verified.json() or {}).get("unlockToken") or "").strip()
    assert support_unlock_token

    allowed = client.post(
        f"/admin/support/conversations/{conversation_id}/resolve",
        headers={
            **_auth_headers("support_broadcast_reader"),
            "X-Admin-Unlock": f"Bearer {support_unlock_token}",
        },
    )
    assert allowed.status_code == 200

    backend_app._notification_emit_admin_broadcast(
        event_code="admin.support.notice.opened",
        title="Support Broadcast",
        message="A support broadcast notice was published.",
        details="scope=admin\ncategory=support",
        severity="warning",
        category="system",
        entity_key="support_broadcast_1",
        dedupe_key="admin.support.notice.opened::support_broadcast_1",
        required_permission=backend_app.PERM_SUPPORT_READ,
        action_label="Open Support",
        action_target={"screen": "main", "tab": "ADMIN", "adminTab": "alerts"},
        email_eligible=False,
        metadata={"broadcastId": "support_broadcast_1"},
    )

    reader = client.get("/account/notifications", headers=_auth_headers("support_broadcast_reader"))
    assert reader.status_code == 200
    reader_codes = [str(item.get("eventCode") or "") for item in reader.json()["items"]]
    assert "admin.support.notice.opened" in reader_codes

    outsider = client.get("/account/notifications", headers=_auth_headers("plain_user"))
    assert outsider.status_code == 200
    assert outsider.json()["items"] == []


@ADMIN_NOTICES_UNAVAILABLE
def test_admin_broadcast_notice_replays_for_existing_and_late_recipients_without_duplicates(monkeypatch) -> None:
    _reset_notification_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)

    client = TestClient(backend_app.app)
    unlock_token = _issue_admin_unlock_token(client)

    _grant_admin_reader_via_api(
        client,
        actor_uid="local_admin",
        unlock_token=unlock_token,
        target_uid="existing_reader",
        permission=backend_app.PERM_GUARDIAN_READ,
    )

    first_rows = backend_app._notification_emit_admin_broadcast(
        event_code="admin.guardian.notice.opened",
        title="Guardian Broadcast",
        message="A guardian broadcast notice was published.",
        details="scope=admin\ncategory=guardian",
        severity="warning",
        category="system",
        entity_key="guardian_broadcast_1",
        dedupe_key="admin.guardian.notice.opened::guardian_broadcast_1",
        required_permission=backend_app.PERM_GUARDIAN_READ,
        action_label="Open Guardian",
        action_target={"screen": "main", "tab": "ADMIN", "adminTab": "guardian"},
        email_eligible=False,
        metadata={"broadcastId": "guardian_broadcast_1"},
    )
    existing_first_ids = _notification_item_ids("existing_reader")
    assert len(existing_first_ids) == 1
    assert any(str(row.get("uid") or "") == "existing_reader" for row in first_rows)

    future_before = client.get("/account/notifications", headers=_admin_headers("future_reader"))
    assert future_before.status_code == 200
    assert future_before.json()["items"] == []

    _grant_admin_reader_via_api(
        client,
        actor_uid="local_admin",
        unlock_token=unlock_token,
        target_uid="future_reader",
        permission=backend_app.PERM_GUARDIAN_READ,
    )

    second_rows = backend_app._notification_emit_admin_broadcast(
        event_code="admin.guardian.notice.opened",
        title="Guardian Broadcast",
        message="A guardian broadcast notice was published.",
        details="scope=admin\ncategory=guardian",
        severity="warning",
        category="system",
        entity_key="guardian_broadcast_1",
        dedupe_key="admin.guardian.notice.opened::guardian_broadcast_1",
        required_permission=backend_app.PERM_GUARDIAN_READ,
        action_label="Open Guardian",
        action_target={"screen": "main", "tab": "ADMIN", "adminTab": "guardian"},
        email_eligible=False,
        metadata={"broadcastId": "guardian_broadcast_1"},
    )
    assert any(str(row.get("uid") or "") == "future_reader" for row in second_rows)

    existing_after_ids = _notification_item_ids("existing_reader")
    future_after_ids = _notification_item_ids("future_reader")
    assert existing_after_ids == existing_first_ids
    assert len(future_after_ids) == 1
    assert client.get("/account/notifications", headers=_admin_headers("existing_reader")).json()["items"][0]["eventCode"] == "admin.guardian.notice.opened"
    assert client.get("/account/notifications", headers=_admin_headers("future_reader")).json()["items"][0]["eventCode"] == "admin.guardian.notice.opened"


@ADMIN_NOTICES_UNAVAILABLE
def test_admin_broadcast_notice_delete_hides_from_inbox(monkeypatch) -> None:
    _reset_notification_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)

    client = TestClient(backend_app.app)
    unlock_token = _issue_admin_unlock_token(client)
    _grant_admin_reader_via_api(
        client,
        actor_uid="local_admin",
        unlock_token=unlock_token,
        target_uid="deleter_reader",
        permission=backend_app.PERM_BILLING_READ,
    )

    rows = backend_app._notification_emit_admin_broadcast(
        event_code="admin.billing.notice.opened",
        title="Billing Broadcast",
        message="A billing broadcast notice was published.",
        details="scope=admin\ncategory=billing",
        severity="warning",
        category="system",
        entity_key="billing_broadcast_1",
        dedupe_key="admin.billing.notice.opened::billing_broadcast_1",
        required_permission=backend_app.PERM_BILLING_READ,
        action_label="Open Billing",
        action_target={"screen": "main", "tab": "ADMIN", "adminTab": "accounting"},
        email_eligible=False,
        metadata={"broadcastId": "billing_broadcast_1"},
    )
    item = next(row for row in rows if str(row.get("uid") or "") == "deleter_reader")
    assert _notification_item_ids("deleter_reader") == [str(item.get("id") or "")]

    deleted = backend_app._INMEMORY_NOTIFICATION_INBOX.get("deleter_reader", {}).pop(str(item.get("id") or ""), None)
    assert isinstance(deleted, dict)
    assert _notification_item_ids("deleter_reader") == []

    inbox = client.get("/account/notifications", headers=_admin_headers("deleter_reader"))
    assert inbox.status_code == 200
    assert inbox.json()["items"] == []


@ADMIN_NOTICES_UNAVAILABLE
def test_admin_broadcast_notice_expiry_excludes_stale_items(monkeypatch) -> None:
    _reset_notification_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)

    client = TestClient(backend_app.app)
    unlock_token = _issue_admin_unlock_token(client)
    _grant_admin_reader_via_api(
        client,
        actor_uid="local_admin",
        unlock_token=unlock_token,
        target_uid="expiry_reader",
        permission=backend_app.PERM_ALERTS_READ,
    )

    rows = backend_app._notification_emit_admin_broadcast(
        event_code="admin.alert.notice.opened",
        title="Alert Broadcast",
        message="An alert broadcast notice was published.",
        details="scope=admin\ncategory=alerts",
        severity="warning",
        category="system",
        entity_key="alert_broadcast_1",
        dedupe_key="admin.alert.notice.opened::alert_broadcast_1",
        required_permission=backend_app.PERM_ALERTS_READ,
        action_label="Open Alerts",
        action_target={"screen": "main", "tab": "ADMIN", "adminTab": "alerts"},
        email_eligible=False,
        metadata={"broadcastId": "alert_broadcast_1"},
    )
    item = next(row for row in rows if str(row.get("uid") or "") == "expiry_reader")
    raw_bucket = backend_app._INMEMORY_NOTIFICATION_INBOX.get("expiry_reader", {})
    raw_item = raw_bucket.get(str(item.get("id") or ""))
    assert isinstance(raw_item, dict)
    raw_item["expiresAtMs"] = 1
    raw_item["expiresAt"] = "1970-01-01T00:00:00+00:00"

    assert _notification_item_ids("expiry_reader") == []


@ADMIN_NOTICES_UNAVAILABLE
def test_admin_notices_create_requires_support_reply_and_unlock(monkeypatch) -> None:
    _reset_notification_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)
    monkeypatch.setattr(backend_app, "_verify_firebase_id_token", _fake_admin_claims)

    client = TestClient(backend_app.app)
    admin_unlock_token = _issue_admin_unlock_token(client, uid="local_admin")
    _grant_admin_reader_via_api(
        client,
        actor_uid="local_admin",
        unlock_token=admin_unlock_token,
        target_uid="support_notice_admin",
        permission=backend_app.PERM_SUPPORT_REPLY,
        role=backend_app.RBAC_ROLE_SUPPORT_OPS,
    )

    expires_at = (backend_app._utc_now() + backend_app.timedelta(hours=3)).isoformat()

    missing_permission = client.post(
        "/admin/notices",
        headers=_auth_headers("plain_user"),
        json={"message": "Missing permission", "expiresAt": expires_at},
    )
    assert missing_permission.status_code == 403

    missing_unlock = client.post(
        "/admin/notices",
        headers=_auth_headers("support_notice_admin"),
        json={"message": "Missing unlock", "expiresAt": expires_at},
    )
    assert missing_unlock.status_code == 403

    support_unlock_token = _issue_admin_unlock_token(client, uid="support_notice_admin")
    created = client.post(
        "/admin/notices",
        headers={
            **_auth_headers("support_notice_admin"),
            "X-Admin-Unlock": f"Bearer {support_unlock_token}",
        },
        json={
            "title": "Maintenance",
            "message": "Scheduled maintenance window",
            "details": "We will be back soon.",
            "expiresAt": expires_at,
        },
    )
    assert created.status_code == 200
    notice = created.json().get("notice") or {}
    assert str(notice.get("id") or "").strip()
    assert notice.get("status") == "active"
    assert str(notice.get("createdBy") or "") == "support_notice_admin"


@ADMIN_NOTICES_UNAVAILABLE
def test_admin_notices_sync_on_read_delivers_to_existing_future_and_admin_without_duplicates(monkeypatch) -> None:
    _reset_notification_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)

    client = TestClient(backend_app.app)
    unlock_token = _issue_admin_unlock_token(client, uid="local_admin")
    expires_at = (backend_app._utc_now() + backend_app.timedelta(days=2)).isoformat()

    created = client.post(
        "/admin/notices",
        headers={**_admin_headers("local_admin"), "X-Admin-Unlock": f"Bearer {unlock_token}"},
        json={
            "title": "System Notice",
            "message": "This is visible to every user.",
            "details": "Broadcast delivery test",
            "expiresAt": expires_at,
        },
    )
    assert created.status_code == 200
    notice = created.json().get("notice") or {}
    notice_id = str(notice.get("id") or "").strip()
    assert notice_id
    backend_app._notification_sync_admin_notices("existing_notice_user")
    backend_app._notification_sync_admin_notices("future_notice_user")

    list_response = client.get("/admin/notices?status=all&limit=20", headers=_admin_headers("local_admin"))
    assert list_response.status_code == 200
    listed = list_response.json().get("items") or []
    listed_notice = next((row for row in listed if str((row or {}).get("id") or "") == notice_id), None)
    assert isinstance(listed_notice, dict)
    assert bool(listed_notice.get("isActive")) is True
    assert bool(listed_notice.get("isExpired")) is False

    admin_items = client.get("/account/notifications", headers=_admin_headers("local_admin")).json().get("items") or []
    admin_notice_items = [
        row
        for row in admin_items
        if str((((row or {}).get("metadata") or {}).get("noticeId") or "")).strip() == notice_id
    ]
    assert len(admin_notice_items) == 1
    assert str(admin_notice_items[0].get("eventCode") or "") == "custom.message"
    assert str(admin_notice_items[0].get("audience") or "") == "all"

    existing_once = client.get("/account/notifications", headers=_admin_headers("existing_notice_user")).json().get("items") or []
    existing_match_once = [
        row
        for row in existing_once
        if str((((row or {}).get("metadata") or {}).get("noticeId") or "")).strip() == notice_id
    ]
    assert len(existing_match_once) == 1
    existing_id = str(existing_match_once[0].get("id") or "").strip()
    assert existing_id

    existing_twice = client.get("/account/notifications", headers=_admin_headers("existing_notice_user")).json().get("items") or []
    existing_match_twice = [
        row
        for row in existing_twice
        if str((((row or {}).get("metadata") or {}).get("noticeId") or "")).strip() == notice_id
    ]
    assert len(existing_match_twice) == 1
    assert str(existing_match_twice[0].get("id") or "").strip() == existing_id

    future_items = client.get("/account/notifications", headers=_admin_headers("future_notice_user")).json().get("items") or []
    future_match = [
        row
        for row in future_items
        if str((((row or {}).get("metadata") or {}).get("noticeId") or "")).strip() == notice_id
    ]
    assert len(future_match) == 1


def test_notifications_list_get_is_read_only(monkeypatch) -> None:
    _reset_notification_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)
    monkeypatch.setattr(backend_app, "VF_NOTIFICATIONS_SYNC_ON_READ", False)

    backend_app._INMEMORY_NOTIFICATION_INBOX["read_only_user"] = {
        "notification_1": {
            "id": "notification_1",
            "uid": "read_only_user",
            "title": "Hello",
            "message": "World",
            "eventCode": "custom.message",
            "createdAt": backend_app._utc_now().isoformat(),
            "updatedAt": backend_app._utc_now().isoformat(),
        }
    }

    def _fail_if_called(*_args, **_kwargs):
        raise AssertionError("GET /account/notifications must not sync or write notifications.")

    monkeypatch.setattr(backend_app, "_notification_sync_admin_notices", _fail_if_called)
    before = {key: dict(value) for key, value in backend_app._INMEMORY_NOTIFICATION_INBOX["read_only_user"].items()}

    client = TestClient(backend_app.app)
    response = client.get("/account/notifications", headers=_admin_headers("read_only_user"))

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["count"] == 1
    assert set(payload) == {"ok", "items", "count"}
    assert isinstance(payload["items"], list)
    assert payload["items"][0]["id"] == "notification_1"
    assert backend_app._INMEMORY_NOTIFICATION_INBOX["read_only_user"] == before
    assert backend_app._INMEMORY_NOTIFICATION_INBOX["read_only_user"]["notification_1"]["title"] == "Hello"


def test_notifications_list_get_can_sync_when_flag_enabled(monkeypatch) -> None:
    _reset_notification_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)
    monkeypatch.setattr(backend_app, "VF_NOTIFICATIONS_SYNC_ON_READ", True)

    called: dict[str, str] = {}

    def _sync(uid: str) -> int:
        called["uid"] = uid
        backend_app._INMEMORY_NOTIFICATION_INBOX.setdefault(uid, {})["notification_sync_1"] = {
            "id": "notification_sync_1",
            "uid": uid,
            "title": "Synced notice",
            "message": "Synced on read",
            "eventCode": "custom.message",
            "audience": "user",
            "status": "active",
            "createdAt": backend_app._utc_now().isoformat(),
            "updatedAt": backend_app._utc_now().isoformat(),
        }
        return 1

    monkeypatch.setattr(backend_app, "_notification_sync_admin_notices", _sync)

    client = TestClient(backend_app.app)
    response = client.get("/account/notifications", headers=_admin_headers("sync_user"))

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["count"] == 1
    assert called["uid"] == "sync_user"
    assert payload["items"][0]["id"] == "notification_sync_1"
    assert payload["items"][0]["title"] == "Synced notice"


def test_notifications_preserve_channel_audience_and_copy_fields(monkeypatch) -> None:
    _reset_notification_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)

    uid = "notification_shape_user"
    now_iso = backend_app._utc_now().isoformat()
    backend_app._INMEMORY_NOTIFICATION_INBOX.setdefault(uid, {})["notif_shape_1"] = {
        "id": "notif_shape_1",
        "uid": uid,
        "eventCode": "custom.message",
        "title": "Queue notice",
        "message": "Fallback message",
        "userMessage": "Servers are busy right now. Please try again in a little while.",
        "details": "Queue age exceeded 90 seconds.",
        "adminDetail": "trace_id=busy-123",
        "audience": "all",
        "roleScope": "all_users",
        "channel": "toast",
        "status": "active",
        "createdAt": now_iso,
        "updatedAt": now_iso,
    }

    client = TestClient(backend_app.app)
    response = client.get("/account/notifications", headers=_admin_headers(uid))

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["audience"] == "all"
    assert item["channel"] == "toast"
    assert item["roleScope"] == "all_users"
    assert item["message"] == "Servers are busy right now. Please try again in a little while."
    assert item["userMessage"] == "Servers are busy right now. Please try again in a little while."
    assert item["adminDetail"] == "trace_id=busy-123"


@ADMIN_NOTICES_UNAVAILABLE
def test_admin_notices_expired_and_deleted_not_returned_from_account_inbox(monkeypatch) -> None:
    _reset_notification_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)

    client = TestClient(backend_app.app)
    unlock_token = _issue_admin_unlock_token(client, uid="local_admin")

    expires_notice = client.post(
        "/admin/notices",
        headers={**_admin_headers("local_admin"), "X-Admin-Unlock": f"Bearer {unlock_token}"},
        json={
            "title": "Expiring Soon",
            "message": "This notice will expire.",
            "expiresAt": (backend_app._utc_now() + backend_app.timedelta(hours=4)).isoformat(),
        },
    )
    assert expires_notice.status_code == 200
    expires_notice_id = str((expires_notice.json().get("notice") or {}).get("id") or "").strip()
    assert expires_notice_id
    backend_app._notification_sync_admin_notices("expiry_delete_user")

    seeded_items = client.get("/account/notifications", headers=_admin_headers("expiry_delete_user")).json().get("items") or []
    assert any(
        str((((row or {}).get("metadata") or {}).get("noticeId") or "")).strip() == expires_notice_id
        for row in seeded_items
    )

    backend_app._admin_notice_upsert(
        expires_notice_id,
        {
            **(backend_app._admin_notice_get(expires_notice_id) or {}),
            "status": "active",
            "expiresAt": "1970-01-01T00:00:00+00:00",
        },
    )

    after_expiry = client.get("/account/notifications", headers=_admin_headers("expiry_delete_user")).json().get("items") or []
    assert not any(
        str((((row or {}).get("metadata") or {}).get("noticeId") or "")).strip() == expires_notice_id
        for row in after_expiry
    )

    delete_notice = client.post(
        "/admin/notices",
        headers={**_admin_headers("local_admin"), "X-Admin-Unlock": f"Bearer {unlock_token}"},
        json={
            "title": "Delete Me",
            "message": "This notice will be removed.",
            "expiresAt": (backend_app._utc_now() + backend_app.timedelta(hours=5)).isoformat(),
        },
    )
    assert delete_notice.status_code == 200
    delete_notice_id = str((delete_notice.json().get("notice") or {}).get("id") or "").strip()
    assert delete_notice_id
    backend_app._notification_sync_admin_notices("expiry_delete_user")

    before_delete = client.get("/account/notifications", headers=_admin_headers("expiry_delete_user")).json().get("items") or []
    assert any(
        str((((row or {}).get("metadata") or {}).get("noticeId") or "")).strip() == delete_notice_id
        for row in before_delete
    )

    deleted = client.delete(
        f"/admin/notices/{delete_notice_id}",
        headers={**_admin_headers("local_admin"), "X-Admin-Unlock": f"Bearer {unlock_token}"},
    )
    assert deleted.status_code == 200
    assert str((deleted.json().get("notice") or {}).get("status") or "") == "deleted"

    after_delete = client.get("/account/notifications", headers=_admin_headers("expiry_delete_user")).json().get("items") or []
    assert not any(
        str((((row or {}).get("metadata") or {}).get("noticeId") or "")).strip() == delete_notice_id
        for row in after_delete
    )


def test_notification_email_delivery_marks_retry_pending_without_raising(monkeypatch) -> None:
    _reset_notification_state()
    delivery = backend_app._notification_email_outbox_upsert(
        "",
        {
            "uid": "retry_user",
            "notificationId": "notif_retry_1",
            "eventCode": "support.reply.received",
            "to": "retry@example.com",
            "subject": "V FLOW AI: Retry",
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
            "engine": "PRIME",
            "createdAtMs": 1_000,
            "finishedAtMs": 31_000,
        },
        status="completed",
    )
    backend_app._notification_emit_tts_job_terminal(
        {
            "uid": "tts_user",
            "jobId": "tts_long",
            "engine": "PRIME",
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
