from __future__ import annotations

import pytest
import uuid
from fastapi.testclient import TestClient

import app as backend_app


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
    backend_app._INMEMORY_ACCOUNTING_DAILY_ROLLUP.clear()
    backend_app._INMEMORY_ACCOUNTING_MONITOR_RUNS.clear()
    backend_app._INMEMORY_USER_PROFILES.clear()
    backend_app._INMEMORY_USER_ID_INDEX.clear()
    backend_app._TTS_SUCCESS_LIMITER.clear_all_local_state()


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
    detail = str(response.json().get("detail") or "")
    assert "Missing permission: users.read" in detail


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


def test_admin_endpoint_requires_allowlisted_uid_in_dev_mode(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_ADMIN_APPROVER_UIDS", frozenset({"local_admin"}))
    monkeypatch.setattr(backend_app, "_admin_list_users", lambda limit, search="": [])
    client = TestClient(backend_app.app)

    local_admin = client.get("/admin/users", headers={"x-dev-uid": "local_admin"})
    assert local_admin.status_code == 200

    non_admin = client.get("/admin/users", headers={"x-dev-uid": "plain_dev_user"})
    assert non_admin.status_code == 403


def test_admin_allowlist_env_helper_ignores_public_fallbacks(monkeypatch) -> None:
    monkeypatch.delenv("VF_ADMIN_APPROVER_UIDS", raising=False)
    monkeypatch.delenv("VF_ADMIN_APPROVER_EMAILS", raising=False)
    monkeypatch.setenv("NEXT_PUBLIC_VF_ADMIN_APPROVER_UIDS", "public_admin")
    monkeypatch.setenv("NEXT_PUBLIC_VF_ADMIN_APPROVER_EMAILS", "public@example.com")
    monkeypatch.setenv("VITE_VF_ADMIN_APPROVER_UIDS", "vite_admin")
    monkeypatch.setenv("VITE_VF_ADMIN_APPROVER_EMAILS", "vite@example.com")

    assert backend_app._server_only_allowlist_env("VF_ADMIN_APPROVER_UIDS") == frozenset()
    assert backend_app._server_only_allowlist_env("VF_ADMIN_APPROVER_EMAILS") == frozenset()

    monkeypatch.setenv("VF_ADMIN_APPROVER_UIDS", "server_admin, second_admin")
    monkeypatch.setenv("VF_ADMIN_APPROVER_EMAILS", "Admin@One.com, Second@Two.com")

    assert backend_app._server_only_allowlist_env("VF_ADMIN_APPROVER_UIDS") == frozenset({"server_admin", "second_admin"})
    assert backend_app._server_only_allowlist_env("VF_ADMIN_APPROVER_EMAILS") == frozenset({"Admin@One.com", "Second@Two.com"})


def test_admin_actor_requires_ops_read_permission(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)

    backend_app._rbac_write_assignment(
        "billing_actor_user",
        {
            "role": backend_app.RBAC_ROLE_BILLING_OPS,
            "allowOverrides": [],
            "denyOverrides": [],
            "status": "active",
            "updatedBy": "seed",
        },
    )
    backend_app._rbac_write_assignment(
        "ops_reader_user",
        {
            "role": backend_app.RBAC_ROLE_READ_ONLY_OPS,
            "allowOverrides": [],
            "denyOverrides": [],
            "status": "active",
            "updatedBy": "seed",
        },
    )

    client = TestClient(backend_app.app)
    denied = client.get("/admin/actor", headers={"x-dev-uid": "billing_actor_user"})
    assert denied.status_code == 403
    assert "Missing permission: ops.read" in str((denied.json() or {}).get("detail") or "")

    allowed = client.get("/admin/actor", headers={"x-dev-uid": "ops_reader_user"})
    assert allowed.status_code == 200
    payload = allowed.json()
    assert payload.get("ok") is True
    assert str(((payload.get("actor") or {}).get("role") or "")).strip() == backend_app.RBAC_ROLE_READ_ONLY_OPS


def test_auth_token_without_uid_is_rejected(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "_verify_firebase_id_token", lambda _token: {"sub": "no_uid_present"})
    client = TestClient(backend_app.app)
    response = client.get("/account/entitlements", headers={"Authorization": "Bearer token_missing_uid"})
    assert response.status_code == 401
    assert "did not include uid" in str(response.json().get("detail"))


def test_admin_queue_metrics_permission_path_does_not_trigger_profile_writes(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(
        backend_app,
        "_verify_firebase_id_token",
        lambda _token: {"uid": "claim_admin_user", "admin": True},
    )
    monkeypatch.setattr(backend_app, "_tts_queue_metrics_snapshot", lambda: {"ok": True, "queue": {}, "workers": {}, "engines": {}, "telemetry": {}})

    def _fail_if_called(*_args, **_kwargs):
        raise AssertionError("_resolve_request_user_id should not run during admin permission checks.")

    monkeypatch.setattr(backend_app, "_resolve_request_user_id", _fail_if_called)
    client = TestClient(backend_app.app)
    response = client.get("/admin/tts/queue/metrics", headers={"Authorization": "Bearer token_admin_claim"})
    assert response.status_code == 200
    assert response.json().get("ok") is True


def test_admin_gemini_pools_permission_path_does_not_trigger_profile_writes(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(
        backend_app,
        "_verify_firebase_id_token",
        lambda _token: {"uid": "claim_admin_user", "admin": True},
    )
    monkeypatch.setattr(
        backend_app,
        "_load_gemini_api_pools",
        lambda force=False: (
            {
                "version": 1,
                "pools": {"free": {"keys": []}},
                "fallbackChains": {"free": ["free"]},
                "sourcePolicy": {"freePoolLocked": False, "freePoolMode": "config_managed"},
            },
            {"warnings": []},
        ),
    )
    monkeypatch.setattr(backend_app, "_backend_gemini_pool_snapshot", lambda: {"ok": True, "pool": {"keyCount": 0}})
    monkeypatch.setattr(backend_app, "_runtime_gemini_pool_snapshot", lambda: {"ok": True, "pool": {"keyCount": 0}})
    monkeypatch.setattr(backend_app, "_gemini_pools_validation", lambda _config: {"isValid": True})

    def _fail_if_called(*_args, **_kwargs):
        raise AssertionError("_resolve_request_user_id should not run during admin permission checks.")

    monkeypatch.setattr(backend_app, "_resolve_request_user_id", _fail_if_called)
    client = TestClient(backend_app.app)
    response = client.get("/admin/gemini/pools", headers={"Authorization": "Bearer token_admin_claim"})
    assert response.status_code == 200
    assert response.json().get("ok") is True


class _FakeDocSnapshot:
    def __init__(self, payload: dict | None) -> None:
        self._payload = dict(payload or {})
        self.exists = payload is not None

    def to_dict(self) -> dict:
        return dict(self._payload)


class _FakeDocRef:
    def __init__(self, store: dict[str, dict], doc_id: str) -> None:
        self._store = store
        self._doc_id = doc_id

    def get(self, transaction=None) -> _FakeDocSnapshot:
        _ = transaction
        return _FakeDocSnapshot(self._store.get(self._doc_id))

    def set(self, payload: dict, merge: bool = False) -> None:
        if merge and self._doc_id in self._store:
            current = dict(self._store.get(self._doc_id) or {})
            current.update(dict(payload or {}))
            self._store[self._doc_id] = current
            return
        self._store[self._doc_id] = dict(payload or {})

    def delete(self) -> None:
        self._store.pop(self._doc_id, None)


class _FakeCollection:
    def __init__(self, store: dict[str, dict]) -> None:
        self._store = store

    def document(self, doc_id: str) -> _FakeDocRef:
        return _FakeDocRef(self._store, str(doc_id))


class _FakeFirestoreDb:
    def __init__(self, initial: dict[str, dict[str, dict]] | None = None) -> None:
        self._collections = dict(initial or {})

    def collection(self, name: str) -> _FakeCollection:
        bucket = self._collections.setdefault(str(name), {})
        return _FakeCollection(bucket)

    def transaction(self) -> object:
        return object()


class _TxRollbackIdFailureFirestore:
    @staticmethod
    def transactional(func):
        _ = func

        def _wrapped(_transaction_obj):
            raise RuntimeError("The transaction has no transaction ID, so it cannot be rolled back.")

        return _wrapped


class _TxServiceDisabledFirestore:
    @staticmethod
    def transactional(func):
        _ = func

        def _wrapped(_transaction_obj):
            raise RuntimeError(
                "403 Cloud Firestore API has not been used in project voiceflow-000f before or it is disabled. "
                "reason: SERVICE_DISABLED service: firestore.googleapis.com"
            )

        return _wrapped


class _FakeAuthRecord:
    def __init__(
        self,
        uid: str,
        *,
        email: str = "",
        display_name: str = "",
        disabled: bool = False,
        custom_claims: dict | None = None,
    ) -> None:
        self.uid = uid
        self.email = email
        self.display_name = display_name
        self.disabled = disabled
        self.custom_claims = dict(custom_claims or {})


class _FakeListUsersPage:
    def __init__(self, records: list[_FakeAuthRecord]) -> None:
        self._records = list(records)

    def iterate_all(self):
        return iter(self._records)


class _FakeFirebaseAuthAdmin:
    def __init__(self, records: list[_FakeAuthRecord]) -> None:
        self._records = list(records)

    def list_users(self) -> _FakeListUsersPage:
        return _FakeListUsersPage(self._records)

    def get_user(self, uid: str) -> _FakeAuthRecord:
        raise AssertionError(f"get_user should not be called during admin user listing for {uid}")


def test_user_profile_upsert_falls_back_on_firestore_transaction_id_failure(monkeypatch) -> None:
    _reset_inmemory_state()
    fake_db = _FakeFirestoreDb()
    monkeypatch.setattr(backend_app, "_FIRESTORE_DB", fake_db)
    monkeypatch.setattr(backend_app, "firebase_firestore", _TxRollbackIdFailureFirestore)

    row = backend_app._user_profile_upsert(
        "uid_fallback_1",
        user_id="fallback_user",
        display_name="Fallback User",
        email="fallback@example.com",
        created_by="test",
        updated_by="test",
    )
    assert row["uid"] == "uid_fallback_1"
    assert row["userId"] == "fallback_user"

    profile_doc = fake_db.collection(backend_app.USER_PROFILES_COLLECTION).document("uid_fallback_1").get()
    assert profile_doc.exists is True
    assert profile_doc.to_dict().get("userId") == "fallback_user"

    index_doc = fake_db.collection(backend_app.USER_ID_INDEX_COLLECTION).document("fallback_user").get()
    assert index_doc.exists is True
    assert index_doc.to_dict().get("uid") == "uid_fallback_1"


def test_user_profile_upsert_fallback_preserves_user_id_collision_409(monkeypatch) -> None:
    _reset_inmemory_state()
    fake_db = _FakeFirestoreDb(
        {
            backend_app.USER_ID_INDEX_COLLECTION: {
                "taken_user": {
                    "userId": "taken_user",
                    "uid": "uid_existing",
                    "createdAt": "2026-01-01T00:00:00+00:00",
                    "updatedAt": "2026-01-01T00:00:00+00:00",
                }
            }
        }
    )
    monkeypatch.setattr(backend_app, "_FIRESTORE_DB", fake_db)
    monkeypatch.setattr(backend_app, "firebase_firestore", _TxRollbackIdFailureFirestore)

    with pytest.raises(backend_app.HTTPException) as exc_info:
        backend_app._user_profile_upsert(
            "uid_fallback_2",
            user_id="taken_user",
            display_name="Collision User",
            email="collision@example.com",
            created_by="test",
            updated_by="test",
        )
    assert exc_info.value.status_code == 409
    assert "already exists" in str(exc_info.value.detail).lower()


def test_user_profile_upsert_service_disabled_error_is_sanitized(monkeypatch) -> None:
    _reset_inmemory_state()
    fake_db = _FakeFirestoreDb()
    monkeypatch.setattr(backend_app, "_FIRESTORE_DB", fake_db)
    monkeypatch.setattr(backend_app, "firebase_firestore", _TxServiceDisabledFirestore)
    row = backend_app._user_profile_upsert(
        "uid_service_disabled_1",
        user_id="service_blocked_user",
        display_name="Service Blocked",
        email="blocked@example.com",
        created_by="test",
        updated_by="test",
    )
    assert row["uid"] == "uid_service_disabled_1"
    assert row["userId"] == "service_blocked_user"
    profile = backend_app._user_profile_read("uid_service_disabled_1")
    assert isinstance(profile, dict)
    assert str(profile.get("userId") or "") == "service_blocked_user"


def test_account_profile_routes_allow_userid_when_firestore_service_disabled(monkeypatch) -> None:
    _reset_inmemory_state()
    fake_db = _FakeFirestoreDb()
    monkeypatch.setattr(backend_app, "_FIRESTORE_DB", fake_db)
    monkeypatch.setattr(backend_app, "firebase_firestore", _TxServiceDisabledFirestore)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "VF_USER_ID_REQUIRED", True)
    monkeypatch.setattr(
        backend_app,
        "_verify_firebase_id_token",
        lambda _token: {
            "uid": "uid_service_disabled_route",
            "email": "admin1@voiceflow-000f.firebaseapp.com",
            "email_verified": True,
        },
    )
    client = TestClient(backend_app.app)

    save_response = client.post(
        "/account/profile",
        headers={"Authorization": "Bearer test_token"},
        json={"userId": "admin1"},
    )
    assert save_response.status_code == 200
    saved_payload = save_response.json()
    assert saved_payload.get("ok") is True
    assert str((saved_payload.get("profile") or {}).get("userId") or "") == "admin1"

    read_response = client.get(
        "/account/profile",
        headers={"Authorization": "Bearer test_token"},
    )
    assert read_response.status_code == 200
    read_payload = read_response.json()
    assert read_payload.get("ok") is True
    assert bool(read_payload.get("requiredUserId")) is False
    assert str((read_payload.get("profile") or {}).get("userId") or "") == "admin1"


def test_admin_users_endpoint_repairs_colliding_backfill_user_ids(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_ADMIN_APPROVER_UIDS", frozenset({"local_admin"}))
    monkeypatch.setattr(backend_app, "_firebase_ready", lambda: True)
    monkeypatch.setattr(backend_app, "_firestore_collection", lambda _name: None)
    monkeypatch.setattr(
        backend_app,
        "firebase_auth",
        _FakeFirebaseAuthAdmin(
            [
                _FakeAuthRecord("uid_existing", email="same@example.com", display_name="Same"),
                _FakeAuthRecord("uid_new_1234", email="same@example.com", display_name="Same Clone"),
            ]
        ),
    )
    backend_app._INMEMORY_USER_PROFILES["uid_existing"] = {
        "uid": "uid_existing",
        "userId": "same",
        "displayName": "Same",
        "email": "same@example.com",
        "status": "active",
        "createdAt": "2026-01-01T00:00:00+00:00",
        "updatedAt": "2026-01-01T00:00:00+00:00",
        "createdBy": "seed",
        "updatedBy": "seed",
    }
    backend_app._INMEMORY_USER_ID_INDEX["same"] = {
        "userId": "same",
        "uid": "uid_existing",
        "createdAt": "2026-01-01T00:00:00+00:00",
        "updatedAt": "2026-01-01T00:00:00+00:00",
    }

    client = TestClient(backend_app.app)
    response = client.get("/admin/users", headers={"x-dev-uid": "local_admin"})
    assert response.status_code == 200
    payload = response.json()
    users_by_uid = {str(item.get("uid") or ""): item for item in payload.get("users") or []}
    assert users_by_uid["uid_new_1234"]["userId"] == "same_1234"
    assert users_by_uid["uid_existing"]["userId"] == "same"
    profile = backend_app._INMEMORY_USER_PROFILES.get("uid_new_1234") or {}
    assert str(profile.get("userId") or "") == "same_1234"


def test_admin_users_endpoint_does_not_create_default_entitlement_or_usage_docs(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_ADMIN_APPROVER_UIDS", frozenset({"local_admin"}))
    monkeypatch.setattr(backend_app, "_firebase_ready", lambda: True)
    monkeypatch.setattr(backend_app, "_firestore_collection", lambda _name: None)
    monkeypatch.setattr(
        backend_app,
        "firebase_auth",
        _FakeFirebaseAuthAdmin([_FakeAuthRecord("uid_reader_1", email="reader@example.com", display_name="Reader One")]),
    )

    client = TestClient(backend_app.app)
    response = client.get("/admin/users", headers={"x-dev-uid": "local_admin"})
    assert response.status_code == 200
    payload = response.json()
    assert payload.get("count") == 1
    row = (payload.get("users") or [])[0]
    assert row["plan"] == "Free"
    assert row["wallet"]["paidVfBalance"] == 0
    assert row["wallet"]["vffBalance"] == pytest.approx(float(backend_app.VF_FREE_MONTHLY_VFF_GRANT))
    assert row["usage"]["monthlyVfUsed"] == 0
    assert row["usage"]["dailyGenerationUsed"] == 0
    assert backend_app._INMEMORY_ENTITLEMENTS == {}
    assert backend_app._INMEMORY_USAGE_MONTHLY == {}
    assert backend_app._INMEMORY_USAGE_DAILY == {}


def test_admin_users_search_handles_missing_profiles_from_firebase_listing(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_ADMIN_APPROVER_UIDS", frozenset({"local_admin"}))
    monkeypatch.setattr(backend_app, "_firebase_ready", lambda: True)
    monkeypatch.setattr(backend_app, "_firestore_collection", lambda _name: None)
    monkeypatch.setattr(
        backend_app,
        "firebase_auth",
        _FakeFirebaseAuthAdmin(
            [
                _FakeAuthRecord("uid_other_1", email="other@example.com", display_name="Other User"),
                _FakeAuthRecord("uid_search_9999", display_name="Search User"),
            ]
        ),
    )

    client = TestClient(backend_app.app)
    response = client.get("/admin/users?q=search_user", headers={"x-dev-uid": "local_admin"})
    assert response.status_code == 200
    payload = response.json()
    assert payload.get("count") == 1
    row = (payload.get("users") or [])[0]
    assert row["uid"] == "uid_search_9999"
    assert row["userId"] == "search_user"


class _DummyRuntimeResponse:
    def __init__(self, status_code: int = 200, content: bytes = b"RIFF" + b"\x00" * 256) -> None:
        self.status_code = status_code
        self.content = content
        self.headers = {"content-type": "audio/wav"}
        self.text = "runtime error"

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self) -> dict:
        return {}


def test_account_profile_admin_does_not_require_userid(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "VF_USER_ID_REQUIRED", True)
    monkeypatch.setattr(
        backend_app,
        "_verify_firebase_id_token",
        lambda _token: {"uid": "claim_admin_profile", "admin": True},
    )
    client = TestClient(backend_app.app)

    response = client.get("/account/profile", headers={"Authorization": "Bearer token_admin_claim"})
    assert response.status_code == 200
    payload = response.json()
    assert payload.get("ok") is True
    assert bool(payload.get("requiredUserId")) is False


def test_account_profile_upsert_rejects_admin(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(
        backend_app,
        "_verify_firebase_id_token",
        lambda _token: {"uid": "claim_admin_profile_set", "admin": True},
    )
    client = TestClient(backend_app.app)

    response = client.post(
        "/account/profile",
        headers={"Authorization": "Bearer token_admin_claim"},
        json={"userId": "admin_should_not_set"},
    )
    assert response.status_code == 403
    assert "do not use userid" in str(response.json().get("detail") or "").lower()


def test_admin_can_submit_tts_without_userid_profile(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "VF_USER_ID_REQUIRED", True)
    monkeypatch.setattr(
        backend_app,
        "_verify_firebase_id_token",
        lambda _token: {"uid": "claim_admin_tts", "admin": True},
    )
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeResponse())
    client = TestClient(backend_app.app)
    session = client.post("/tts/v2/sessions", headers={"Authorization": "Bearer token_admin_claim"})
    assert session.status_code == 201
    session_key = str(session.json().get("sessionKey") or "").strip()
    assert session_key

    response = client.post(
        "/tts/v2/jobs",
        headers={
            "Authorization": "Bearer token_admin_claim",
            "x-vf-tts-session-key": session_key,
        },
        json={
            "request_id": f"test_{uuid.uuid4().hex}",
            "mode": "single_speaker",
            "engine": "PRIME",
            "text": "admin synthesis bypass check",
        },
    )
    assert response.status_code == 202
