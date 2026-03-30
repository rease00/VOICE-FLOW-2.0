from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import app as backend_app


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
        "admin": True,
        "iat": iat,
    }


def _auth_headers(uid: str, iat: int) -> dict[str, str]:
    return {"Authorization": f"Bearer {uid}:{iat}"}


def _reset_unlock_state() -> None:
    backend_app._INMEMORY_ADMIN_SESSION_UNLOCK.clear()
    backend_app._RBAC_ACTOR_CACHE.clear()


def test_admin_unlock_issue_verify_status_and_mutation_guard(monkeypatch) -> None:
    _reset_unlock_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "_verify_firebase_id_token", _fake_admin_claims)

    client = TestClient(backend_app.app)
    headers = _auth_headers("admin_unlock_user", 1710000000)

    issued = client.post("/admin/session-unlock/issue", headers=headers)
    assert issued.status_code == 200
    unlock_key = str((issued.json() or {}).get("unlockKey") or "").strip()
    assert unlock_key

    status_before = client.get("/admin/session-unlock/status", headers=headers)
    assert status_before.status_code == 200
    assert status_before.json()["status"]["hasIssuedKey"] is True
    assert status_before.json()["status"]["isUnlocked"] is False

    blocked = client.post("/admin/usage/reset-daily-all?dryRun=1", headers=headers)
    assert blocked.status_code == 403
    assert "X-Admin-Unlock" in str((blocked.json() or {}).get("detail") or "")

    verified = client.post(
        "/admin/session-unlock/verify",
        headers=headers,
        json={"unlockKey": unlock_key},
    )
    assert verified.status_code == 200
    unlock_token = str((verified.json() or {}).get("unlockToken") or "").strip()
    assert unlock_token

    allowed = client.post(
        "/admin/usage/reset-daily-all?dryRun=1",
        headers={**headers, "X-Admin-Unlock": f"Bearer {unlock_token}"},
    )
    assert allowed.status_code == 200
    assert allowed.json()["ok"] is True

    status_after = client.get("/admin/session-unlock/status", headers=headers)
    assert status_after.status_code == 200
    assert status_after.json()["status"]["isUnlocked"] is True


def test_admin_unlock_wrong_key_lockout(monkeypatch) -> None:
    _reset_unlock_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "_verify_firebase_id_token", _fake_admin_claims)
    monkeypatch.setattr(backend_app, "VF_ADMIN_UNLOCK_MAX_ATTEMPTS", 2)
    monkeypatch.setattr(backend_app, "VF_ADMIN_UNLOCK_LOCKOUT_SECONDS", 120)

    client = TestClient(backend_app.app)
    headers = _auth_headers("admin_lockout_user", 1710000001)

    issued = client.post("/admin/session-unlock/issue", headers=headers)
    assert issued.status_code == 200

    first_wrong = client.post(
        "/admin/session-unlock/verify",
        headers=headers,
        json={"unlockKey": "WRONGKEY01"},
    )
    assert first_wrong.status_code == 403

    second_wrong = client.post(
        "/admin/session-unlock/verify",
        headers=headers,
        json={"unlockKey": "WRONGKEY02"},
    )
    assert second_wrong.status_code == 403

    status_payload = client.get("/admin/session-unlock/status", headers=headers)
    assert status_payload.status_code == 200
    assert status_payload.json()["status"]["isLocked"] is True


def test_admin_unlock_rejects_expired_token_and_identity_mismatches(monkeypatch) -> None:
    _reset_unlock_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "_verify_firebase_id_token", _fake_admin_claims)

    client = TestClient(backend_app.app)
    headers_uid_a_iat_a = _auth_headers("admin_uid_a", 1710000100)

    issued = client.post("/admin/session-unlock/issue", headers=headers_uid_a_iat_a)
    assert issued.status_code == 200
    unlock_key = str((issued.json() or {}).get("unlockKey") or "").strip()
    assert unlock_key

    verified = client.post(
        "/admin/session-unlock/verify",
        headers=headers_uid_a_iat_a,
        json={"unlockKey": unlock_key},
    )
    assert verified.status_code == 200
    unlock_token = str((verified.json() or {}).get("unlockToken") or "").strip()
    assert unlock_token

    now_ms = backend_app._admin_unlock_now_ms()
    monkeypatch.setattr(backend_app, "_admin_unlock_now_ms", lambda: now_ms + (backend_app.VF_ADMIN_UNLOCK_TTL_SECONDS * 1000) + 1)
    expired = client.post(
        "/admin/usage/reset-daily-all?dryRun=1",
        headers={**headers_uid_a_iat_a, "X-Admin-Unlock": f"Bearer {unlock_token}"},
    )
    assert expired.status_code == 403
    assert "expired" in str((expired.json() or {}).get("detail") or "").lower()

    monkeypatch.setattr(backend_app, "_admin_unlock_now_ms", lambda: now_ms)
    session_mismatch = client.post(
        "/admin/usage/reset-daily-all?dryRun=1",
        headers={**_auth_headers("admin_uid_a", 1710000101), "X-Admin-Unlock": f"Bearer {unlock_token}"},
    )
    assert session_mismatch.status_code == 403
    assert "session mismatch" in str((session_mismatch.json() or {}).get("detail") or "").lower()

    uid_mismatch = client.post(
        "/admin/usage/reset-daily-all?dryRun=1",
        headers={**_auth_headers("admin_uid_b", 1710000100), "X-Admin-Unlock": f"Bearer {unlock_token}"},
    )
    assert uid_mismatch.status_code == 403
    assert "uid mismatch" in str((uid_mismatch.json() or {}).get("detail") or "").lower()


def test_billing_webhook_security_enforced_in_production(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_IS_PRODUCTION", True)
    monkeypatch.setattr(backend_app, "_razorpay_available", lambda: True)

    client = TestClient(backend_app.app)
    monkeypatch.setattr(backend_app, "_razorpay_webhook_secret", lambda: "")
    missing_secret = client.post("/billing/webhook", json={"type": "checkout.session.completed"})
    assert missing_secret.status_code == 503

    monkeypatch.setattr(backend_app, "_razorpay_webhook_secret", lambda: "whsec_security")
    unsigned = client.post("/billing/webhook", json={"type": "checkout.session.completed"})
    assert unsigned.status_code == 400
    assert "invalid razorpay webhook signature" in str((unsigned.json() or {}).get("detail") or "").lower()


def test_billing_webhook_unsigned_requires_explicit_local_dev_mode(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "_razorpay_available", lambda: True)
    monkeypatch.setattr(backend_app, "_razorpay_webhook_secret", lambda: "")
    monkeypatch.setattr(backend_app, "VF_IS_PRODUCTION", False)
    monkeypatch.setattr(backend_app, "VF_RAZORPAY_WEBHOOK_ALLOW_UNSIGNED", True)
    monkeypatch.setattr(backend_app, "VF_IS_LOCAL_DEV", False)

    client = TestClient(backend_app.app)
    blocked = client.post("/billing/webhook", json={"type": "noop.event", "data": {"object": {}}})
    assert blocked.status_code == 400
    assert "local development mode" in str((blocked.json() or {}).get("detail") or "").lower()

    monkeypatch.setattr(backend_app, "VF_IS_LOCAL_DEV", True)
    allowed = client.post("/billing/webhook", json={"type": "noop.event", "data": {"object": {}}})
    assert allowed.status_code == 200
    assert (allowed.json() or {}).get("ok") is True


def test_billing_redirect_override_rejects_non_allowlisted_origin(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_BILLING_REDIRECT_ALLOWLIST", frozenset({"https://app.voiceflow.test"}))
    with pytest.raises(HTTPException) as exc:
        backend_app._resolve_checkout_url_override(
            "https://evil.example/path?x=1",
            "https://app.voiceflow.test/billing/success",
        )
    assert exc.value.status_code == 400
    assert "allowlisted" in str(exc.value.detail).lower()


def test_docs_paths_not_exempt_when_docs_disabled(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_IS_PRODUCTION", True)
    monkeypatch.setattr(backend_app, "VF_DOCS_ENABLE", False)
    assert backend_app._auth_exempt_path("/docs") is False
    assert backend_app._auth_exempt_path("/openapi.json") is False
    assert backend_app._auth_exempt_path("/redoc") is False


def test_tts_engine_status_paths_require_auth(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    assert backend_app._auth_exempt_path("/tts/engines/status") is False
    assert backend_app._auth_exempt_path("/tts/engines/capabilities") is False
    assert backend_app._auth_exempt_path("/tts/engines/voices") is False


def test_video_asset_manifest_loader_removed() -> None:
    assert not hasattr(backend_app, "_load_video_pipeline_asset_sources")


def test_tts_engine_switch_requires_unlock_and_allows_ops_mutate_actor(monkeypatch) -> None:
    _reset_unlock_state()
    backend_app._INMEMORY_ADMIN_ROLES.clear()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "_verify_firebase_id_token", _fake_admin_claims)
    monkeypatch.setattr(backend_app, "_audit_append_event", lambda **kwargs: None)

    uid = "ops_switch_admin"
    backend_app._rbac_write_assignment(
        uid,
        {
            "role": backend_app.RBAC_ROLE_SUPER_ADMIN,
            "allowOverrides": [],
            "denyOverrides": [],
            "status": "active",
            "updatedBy": "seed",
        },
    )
    backend_app._rbac_invalidate_cache(uid)

    probe_results = [
        (False, "Runtime offline", "http://runtime.test/health"),
        (True, "Runtime online", "http://runtime.test/health"),
    ]

    def _probe(_engine: str):
        if probe_results:
            return probe_results.pop(0)
        return (True, "Runtime online", "http://runtime.test/health")

    monkeypatch.setattr(backend_app, "_probe_engine_runtime_health", _probe)
    monkeypatch.setattr(
        backend_app,
        "_run_tts_switch_with_retry",
        lambda engine, gpu, retries=2, keep_others=True: f"switched:{engine}:{gpu}:{retries}:{keep_others}",
    )

    client = TestClient(backend_app.app)
    headers = _auth_headers(uid, 1710000400)

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

    allowed = client.post(
        "/tts/engines/switch",
        headers={**headers, "X-Admin-Unlock": f"Bearer {unlock_token}"},
        json={"engine": "PRIME", "gpu": False},
    )
    assert allowed.status_code == 200
    allowed_payload = allowed.json() or {}
    assert bool(allowed_payload.get("ok")) is True
    assert str(allowed_payload.get("engine") or "") == "PRIME"

    missing_unlock = client.post(
        "/tts/engines/switch",
        headers=headers,
        json={"engine": "PRIME", "gpu": False},
    )
    assert missing_unlock.status_code == 403
    assert "admin-unlock" in str((missing_unlock.json() or {}).get("detail") or "").lower()

    now_ms = backend_app._admin_unlock_now_ms()
    monkeypatch.setattr(
        backend_app,
        "_admin_unlock_now_ms",
        lambda: now_ms + (backend_app.VF_ADMIN_UNLOCK_TTL_SECONDS * 1000) + 1,
    )
    expired_unlock = client.post(
        "/tts/engines/switch",
        headers={**headers, "X-Admin-Unlock": f"Bearer {unlock_token}"},
        json={"engine": "PRIME", "gpu": False},
    )
    assert expired_unlock.status_code == 403
    assert "expired" in str((expired_unlock.json() or {}).get("detail") or "").lower()
