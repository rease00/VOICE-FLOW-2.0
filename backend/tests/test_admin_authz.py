from __future__ import annotations

from fastapi.testclient import TestClient

import backend.app as backend_app


def _reset_inmemory_state() -> None:
    backend_app._INMEMORY_ENTITLEMENTS.clear()
    backend_app._INMEMORY_USAGE_MONTHLY.clear()
    backend_app._INMEMORY_USAGE_DAILY.clear()
    backend_app._INMEMORY_USAGE_EVENTS.clear()
    backend_app._INMEMORY_STRIPE_CUSTOMERS.clear()
    backend_app._INMEMORY_WALLET_DAILY.clear()
    backend_app._INMEMORY_WALLET_TRANSACTIONS.clear()
    backend_app._INMEMORY_COUPONS.clear()
    backend_app._INMEMORY_COUPON_REDEMPTIONS.clear()


def test_admin_endpoint_requires_bearer_when_auth_enforced(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    client = TestClient(backend_app.app)
    response = client.get("/admin/users")
    assert response.status_code == 401
    assert "Missing bearer token" in str(response.json().get("detail"))


def test_admin_endpoint_rejects_non_admin_bearer(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "_verify_firebase_id_token", lambda _token: {"uid": "plain_user"})
    monkeypatch.setattr(backend_app, "_admin_list_users", lambda limit, search="": [])
    client = TestClient(backend_app.app)
    response = client.get("/admin/users", headers={"Authorization": "Bearer token_plain"})
    assert response.status_code == 403
    assert "Admin access required." in str(response.json().get("detail"))


def test_admin_endpoint_accepts_admin_claim_bearer(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(
        backend_app,
        "_verify_firebase_id_token",
        lambda _token: {"uid": "claim_admin_user", "admin": True},
    )
    monkeypatch.setattr(
        backend_app,
        "_admin_list_users",
        lambda limit, search="": [{"uid": "claim_admin_user"}],
    )
    client = TestClient(backend_app.app)
    response = client.get("/admin/users", headers={"Authorization": "Bearer token_admin_claim"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["count"] == 1


def test_admin_endpoint_accepts_firestore_admin_without_claim(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "_verify_firebase_id_token", lambda _token: {"uid": "firestore_admin_user"})
    monkeypatch.setattr(
        backend_app,
        "_firestore_user_is_admin",
        lambda uid: str(uid) == "firestore_admin_user",
    )
    monkeypatch.setattr(backend_app, "_admin_list_users", lambda limit, search="": [])
    client = TestClient(backend_app.app)
    response = client.get("/admin/users", headers={"Authorization": "Bearer token_firestore_admin"})
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_admin_endpoint_allows_local_admin_uid_only_in_dev_mode(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_admin_list_users", lambda limit, search="": [])
    client = TestClient(backend_app.app)

    local_admin = client.get("/admin/users", headers={"x-dev-uid": "local_admin"})
    assert local_admin.status_code == 200

    non_admin = client.get("/admin/users", headers={"x-dev-uid": "plain_dev_user"})
    assert non_admin.status_code == 403


def test_auth_token_without_uid_is_rejected(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "_verify_firebase_id_token", lambda _token: {"sub": "no_uid_present"})
    client = TestClient(backend_app.app)
    response = client.get("/account/entitlements", headers={"Authorization": "Bearer token_missing_uid"})
    assert response.status_code == 401
    assert "did not include uid" in str(response.json().get("detail"))
