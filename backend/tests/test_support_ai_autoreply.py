from __future__ import annotations

import json

from fastapi.testclient import TestClient

import app as backend_app


def _reset_support_ai_state() -> None:
    backend_app._INMEMORY_SUPPORT_CONVERSATIONS.clear()
    backend_app._INMEMORY_SUPPORT_MESSAGES.clear()
    backend_app._INMEMORY_SUPPORT_AI_RUNS.clear()
    backend_app._INMEMORY_SUPPORT_AI_POLICY.clear()
    backend_app._INMEMORY_ALERT_EVENTS.clear()
    backend_app._INMEMORY_AUDIT_LEDGER_EVENTS.clear()
    backend_app._INMEMORY_AUDIT_LEDGER_ORDER.clear()
    backend_app._INMEMORY_AUDIT_LEDGER_STATE.clear()

    backend_app._INMEMORY_USER_PROFILES.clear()
    backend_app._INMEMORY_USER_ID_INDEX.clear()
    backend_app._INMEMORY_ENTITLEMENTS.clear()
    backend_app._INMEMORY_USAGE_MONTHLY.clear()
    backend_app._INMEMORY_USAGE_DAILY.clear()


def _enable_support_ai(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_USER_ID_REQUIRED", False)
    monkeypatch.setattr(backend_app, "VF_SUPPORT_INBOX_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_SUPPORT_AI_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_SUPPORT_AI_AUTOREPLY_ENABLED", True)


def test_support_ai_critical_tag_escalates_without_ai_reply(monkeypatch) -> None:
    _reset_support_ai_state()
    _enable_support_ai(monkeypatch)
    backend_app._support_ai_policy_patch(
        {
            "enabled": True,
            "confidenceThreshold": 0.0,
            "maxAutoRepliesPerConversation": 2,
            "allowedActions": ["classify_message", "retrieve_kb_snippets", "emit_support_reply"],
            "blockedTopics": ["chargeback"],
            "requireHumanForTags": ["security"],
        },
        updated_by="test_support_ai",
    )

    client = TestClient(backend_app.app)
    response = client.post(
        "/support/messages",
        headers={"x-dev-uid": "critical_uid"},
        json={"text": "My account was hacked and I saw unauthorized access from another location."},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["aiMode"] == "escalated"
    assert str(payload.get("aiReason") or "").startswith("critical_tag:security")
    assert payload["conversation"]["status"] == "needs_human"
    assert payload["conversation"]["priority"] in {"yellow", "red"}
    assert payload["conversation"]["priority"] != "green"
    assert len(payload["messages"]) == 1
    assert payload["messages"][0]["fromType"] == "user"

    conversation_id = str(payload["conversation"]["conversationId"])
    rows = backend_app._support_list_messages(conversation_id, limit=100)
    assert all(str(row.get("fromType") or "").strip().lower() != "ai" for row in rows)


def test_support_ai_non_critical_reply_uses_deterministic_limited_context(monkeypatch) -> None:
    _reset_support_ai_state()
    _enable_support_ai(monkeypatch)
    backend_app._support_ai_policy_patch(
        {
            "enabled": True,
            "confidenceThreshold": 0.5,
            "maxAutoRepliesPerConversation": 2,
            "allowedActions": ["classify_message", "retrieve_kb_snippets", "emit_support_reply"],
            "blockedTopics": ["legal_notice", "fraud", "chargeback"],
            "requireHumanForTags": ["billing_dispute", "account_lock", "security"],
        },
        updated_by="test_support_ai",
    )

    uid = "noncritical_uid"
    backend_app._user_profile_upsert(
        uid,
        user_id="user_noncritical",
        created_by="test_support_ai",
        updated_by="test_support_ai",
        force_change=True,
        allow_existing_immutable=True,
    )
    backend_app._write_entitlement(
        uid,
        {
            "plan": "Pro",
            "status": "active",
            "paidVfBalance": 125.0,
            "vffBalance": 40.0,
            "monthlyVfLimit": 300000,
            "dailyGenerationLimit": 5,
        },
    )
    monthly, daily = backend_app._usage_defaults(uid)
    monthly["vfUsed"] = 321.0
    daily["generationCount"] = 2
    backend_app._INMEMORY_USAGE_MONTHLY[backend_app._inmemory_usage_month_doc_id(uid)] = monthly
    backend_app._INMEMORY_USAGE_DAILY[backend_app._inmemory_usage_day_doc_id(uid)] = daily

    client = TestClient(backend_app.app)
    response = client.post(
        "/support/messages",
        headers={"x-dev-uid": uid},
        json={"text": "Audio generation failed once in studio, can you help me retry?"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["aiMode"] == "ai_reply"
    assert payload["conversation"]["status"] == "ai_answered"
    assert payload["conversation"]["priority"] == "green"
    assert len(payload["messages"]) == 2
    assert payload["messages"][1]["fromType"] == "ai"
    reply_text = str(payload["messages"][1]["text"] or "")
    assert "plan Pro (active)" in reply_text
    assert "wallet free 40 VF and paid 125 VF" in reply_text
    assert "usage monthly 321/300000 VF and daily 2/5" in reply_text


def test_support_ai_context_scope_is_limited_to_allowed_account_fields() -> None:
    _reset_support_ai_state()
    uid = "scope_guard_uid"
    backend_app._write_entitlement(
        uid,
        {
            "plan": "Starter",
            "status": "active",
            "paidVfBalance": 77.0,
            "vffBalance": 11.0,
            "monthlyVfLimit": 50000,
            "dailyGenerationLimit": 9,
            "stripeCustomerId": "cus_sensitive",
            "subscriptionId": "sub_sensitive",
            "latestInvoiceId": "in_sensitive",
        },
    )
    monthly, daily = backend_app._usage_defaults(uid)
    monthly["vfUsed"] = 123.0
    daily["generationCount"] = 4
    backend_app._INMEMORY_USAGE_MONTHLY[backend_app._inmemory_usage_month_doc_id(uid)] = monthly
    backend_app._INMEMORY_USAGE_DAILY[backend_app._inmemory_usage_day_doc_id(uid)] = daily

    context = backend_app._support_ai_build_limited_account_context(uid, "scope_user")
    assert set(context.keys()) == {"uid", "userId", "plan", "accountStatus", "wallet", "usage"}
    assert set(context["wallet"].keys()) == {"vffBalance", "paidVfBalance"}
    assert set(context["usage"].keys()) == {
        "monthlyVfUsed",
        "monthlyVfLimit",
        "dailyGenerationUsed",
        "dailyGenerationLimit",
    }
    serialized = json.dumps(context, sort_keys=True)
    assert "stripeCustomerId" not in serialized
    assert "subscriptionId" not in serialized
    assert "latestInvoiceId" not in serialized

