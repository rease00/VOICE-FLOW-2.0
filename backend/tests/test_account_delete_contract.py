from __future__ import annotations

from fastapi.testclient import TestClient

import app as backend_app


def test_account_delete_accepts_backend_confirmation_phrase(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)

    captured: dict[str, object] = {}

    def _fake_cleanup(uid: str, *, delete_auth_user: bool = True):
        captured["uid"] = uid
        captured["delete_auth_user"] = delete_auth_user
        return {
            "uid": uid,
            "profileBefore": {"uid": uid, "userId": "self_user"},
            "userIdBefore": "self_user",
            "deletionSummary": {
                "deletedCount": 2,
                "failedCount": 0,
                "collections": {"users": {"deletedCount": 1, "failedCount": 0}, "user_id_index": {"deletedCount": 1, "failedCount": 0}},
            },
        }

    monkeypatch.setattr(backend_app, "_delete_user_account_cleanup", _fake_cleanup)
    monkeypatch.setattr(backend_app, "_audit_append_event", lambda *args, **kwargs: None)

    client = TestClient(backend_app.app)
    response = client.post(
        "/account/delete",
        headers={"x-dev-uid": "self_user"},
        json={"confirmPhrase": "DELETE_MY_ACCOUNT"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "uid": "self_user",
        "deleted": True,
        "deletionSummary": {
            "deletedCount": 2,
            "failedCount": 0,
            "collections": {"users": {"deletedCount": 1, "failedCount": 0}, "user_id_index": {"deletedCount": 1, "failedCount": 0}},
        },
    }
    assert captured["uid"] == "self_user"
    assert captured["delete_auth_user"] is True


def test_account_delete_rejects_spaced_confirmation_phrase(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)

    cleanup_called = False

    def _fake_cleanup(*args, **kwargs):
        nonlocal cleanup_called
        cleanup_called = True
        return {"uid": "self_user", "profileBefore": {}, "userIdBefore": ""}

    monkeypatch.setattr(backend_app, "_delete_user_account_cleanup", _fake_cleanup)
    monkeypatch.setattr(backend_app, "_audit_append_event", lambda *args, **kwargs: None)

    client = TestClient(backend_app.app)
    response = client.post(
        "/account/delete",
        headers={"x-dev-uid": "self_user"},
        json={"confirmPhrase": "DELETE MY ACCOUNT"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "confirmPhrase must be DELETE_MY_ACCOUNT."
    assert cleanup_called is False


def test_delete_user_account_cleanup_returns_per_collection_summary(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "_FIRESTORE_DB", None)

    uid = "delete_summary_user"
    backend_app._INMEMORY_ENTITLEMENTS[uid] = {"uid": uid, "vffBalance": 0, "paidVfBalance": 0}
    backend_app._INMEMORY_USER_PROFILES[uid] = {"uid": uid, "userId": "delete_summary_user"}
    backend_app._INMEMORY_GENERATION_HISTORY[uid] = {"uid": uid, "requestId": "gen_1"}
    backend_app._INMEMORY_USAGE_MONTHLY[f"{uid}_month_1"] = {"uid": uid}
    backend_app._INMEMORY_USAGE_DAILY[f"{uid}_day_1"] = {"uid": uid}
    backend_app._INMEMORY_USAGE_EVENTS[f"{uid}_req_1"] = {"uid": uid, "requestId": "req_1"}
    backend_app._INMEMORY_WALLET_DAILY[f"{uid}_wallet_day_1"] = {"uid": uid}
    backend_app._INMEMORY_WALLET_TRANSACTIONS["wallet_tx_1"] = {"uid": uid, "amount": 99}
    backend_app._INMEMORY_COUPON_REDEMPTIONS["coupon_redemption_1"] = {"uid": uid, "couponId": "c1"}
    backend_app._INMEMORY_NOTIFICATION_PREFERENCES[uid] = {"uid": uid, "emailAdminAlerts": True}
    backend_app._INMEMORY_NOTIFICATION_EMAIL_OUTBOX["email_1"] = {"uid": uid, "status": "pending"}
    backend_app._INMEMORY_NOTIFICATION_INBOX[uid] = {"notice_1": {"uid": uid, "id": "notice_1"}}
    backend_app._INMEMORY_SUPPORT_CONVERSATIONS["conv_1"] = {"uid": uid}
    backend_app._INMEMORY_SUPPORT_MESSAGES["msg_1"] = {"uid": uid}
    backend_app._INMEMORY_READER_LEGAL_ACK[uid] = {"uid": uid}
    backend_app._INMEMORY_READER_PREFERENCES[uid] = {"uid": uid}
    backend_app._INMEMORY_READER_UPLOADS["upload_1"] = {"uid": uid}
    backend_app._INMEMORY_READER_PROGRESS[f"{uid}_progress_1"] = {"uid": uid}
    backend_app._INMEMORY_READER_CAST_MEMORY[f"{uid}_cast_1"] = {"uid": uid}
    backend_app._INMEMORY_READER_TRANSLATIONS[f"{uid}_translation_1"] = {"uid": uid}
    backend_app._INMEMORY_READER_SESSIONS["session_1"] = {"uid": uid}
    backend_app._INMEMORY_TTS_V2_SESSIONS["tts_session_1"] = {"uid": uid}
    backend_app._INMEMORY_TTS_V2_ACTIVE_SESSION_BY_UID[uid] = "tts_session_1"
    backend_app._INMEMORY_USER_ID_INDEX["delete_summary_user"] = {"uid": uid, "userId": "delete_summary_user"}

    deletion = backend_app._delete_user_account_cleanup(uid, delete_auth_user=False)
    summary = deletion["deletionSummary"]

    assert summary["collections"]["entitlements"]["deletedCount"] == 1
    assert summary["collections"]["users"]["deletedCount"] == 0
    assert summary["collections"]["user_profiles"]["deletedCount"] == 1
    assert summary["collections"]["generation_history"]["deletedCount"] == 1
    assert summary["collections"]["usage_monthly"]["deletedCount"] == 1
    assert summary["collections"]["usage_daily"]["deletedCount"] == 1
    assert summary["collections"]["usage_events"]["deletedCount"] == 1
    assert summary["collections"]["notification_inbox"]["deletedCount"] == 1
    assert summary["collections"]["notification_preferences"]["deletedCount"] == 1
    assert summary["collections"]["notification_email_outbox"]["deletedCount"] == 1
    assert summary["collections"]["support_conversations"]["deletedCount"] == 1
    assert summary["collections"]["support_messages"]["deletedCount"] == 1
    assert summary["collections"]["reader_legal_ack"]["deletedCount"] == 1
    assert summary["collections"]["reader_preferences"]["deletedCount"] == 1
    assert summary["collections"]["reader_uploads"]["deletedCount"] == 1
    assert summary["collections"]["reader_progress"]["deletedCount"] == 1
    assert summary["collections"]["reader_cast_memory"]["deletedCount"] == 1
    assert summary["collections"]["reader_translation_cache"]["deletedCount"] == 1
    assert summary["collections"]["reader_sessions"]["deletedCount"] == 1
    assert summary["collections"]["wallet_daily"]["deletedCount"] == 1
    assert summary["collections"]["wallet_transactions"]["deletedCount"] == 1
    assert summary["collections"]["coupon_redemptions"]["deletedCount"] == 1
    assert summary["collections"]["tts_v2_sessions"]["deletedCount"] == 2
    assert summary["collections"]["user_id_index"]["deletedCount"] == 1
    assert summary["deletedCount"] >= 10
    assert summary["failedCount"] == 0

    assert uid not in backend_app._INMEMORY_ENTITLEMENTS
    assert uid not in backend_app._INMEMORY_USER_PROFILES
    assert uid not in backend_app._INMEMORY_NOTIFICATION_INBOX
    assert uid not in backend_app._INMEMORY_NOTIFICATION_PREFERENCES
    assert uid not in backend_app._INMEMORY_TTS_V2_ACTIVE_SESSION_BY_UID
