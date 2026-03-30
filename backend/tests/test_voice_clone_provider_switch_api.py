from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import app as backend_app


client = TestClient(backend_app.app)


def _reset_state() -> None:
    backend_app._INMEMORY_OPENVOICE_RUNTIME_CONFIG.clear()
    backend_app._VOICE_CLONE_STRESS_JOBS.clear()
    backend_app._INMEMORY_ADMIN_ROLES.clear()
    backend_app._RBAC_ACTOR_CACHE.clear()
    backend_app._INMEMORY_ENTITLEMENTS.clear()
    backend_app._INMEMORY_USER_PROFILES.clear()
    backend_app._INMEMORY_USER_ID_INDEX.clear()


@pytest.fixture(autouse=True)
def _provider_switch_isolation(monkeypatch: pytest.MonkeyPatch):
    _reset_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)
    monkeypatch.setattr(backend_app, "VF_USER_ID_REQUIRED", False)
    monkeypatch.setattr(backend_app, "_firebase_ready", lambda: False)
    monkeypatch.setattr(
        backend_app,
        "_openvoice_provider_runtime_probe",
        lambda provider: {
            "configured": provider == backend_app.OPENVOICE_PROVIDER_MODAL,
            "ready": provider == backend_app.OPENVOICE_PROVIDER_MODAL,
            "detail": "Modal VC runtime ready",
            "device": "nvidia-l4",
            "expectedGpuConcurrency": 2,
            "runtimeGpuConcurrency": 2,
            "concurrencyVerified": True,
        },
    )
    yield
    _reset_state()


def _seed_role(uid: str, role: str) -> None:
    backend_app._rbac_write_assignment(
        uid,
        {
            "role": role,
            "allowOverrides": [],
            "denyOverrides": [],
            "status": "active",
            "updatedBy": "seed",
        },
    )


def _admin_headers(uid: str) -> dict[str, str]:
    return {"x-dev-uid": uid}


def test_provider_get_requires_ops_read_and_returns_modal_only_status() -> None:
    _seed_role("billing_actor_user", backend_app.RBAC_ROLE_BILLING_OPS)
    _seed_role("ops_reader_user", backend_app.RBAC_ROLE_READ_ONLY_OPS)

    denied = client.get("/admin/voice-clone/provider", headers=_admin_headers("billing_actor_user"))
    assert denied.status_code == 403
    assert "Missing permission: ops.read" in str(denied.json().get("detail") or "")

    allowed = client.get("/v1/admin/voice-clone/provider", headers=_admin_headers("ops_reader_user"))
    assert allowed.status_code == 200
    payload = allowed.json()
    assert payload["ok"] is True
    assert payload["activeProvider"] == backend_app.OPENVOICE_PROVIDER_MODAL
    assert payload["defaultProvider"] == backend_app.OPENVOICE_PROVIDER_MODAL
    provider_status = payload.get("providerStatus") or {}
    assert provider_status.get("key") == backend_app.OPENVOICE_PROVIDER_MODAL
    assert provider_status.get("ready") is True
    assert provider_status.get("device") == "nvidia-l4"
    assert payload.get("expectedGpuConcurrency") == 2
    assert payload.get("runtimeGpuConcurrency") == 2
    assert payload.get("concurrencyVerified") is True
    assert "providers" not in payload
    assert "token" not in str(payload).lower()
    assert "url" not in str(provider_status).lower()


def test_provider_patch_requires_unlock_and_is_terminally_unsupported(monkeypatch: pytest.MonkeyPatch) -> None:
    _seed_role("voice_admin", backend_app.RBAC_ROLE_SUPER_ADMIN)
    unlock_calls: list[str] = []

    def _fake_unlock(request, *, expected_uid=None):  # noqa: ANN001
        _ = request
        unlock_calls.append(str(expected_uid or ""))
        return str(expected_uid or "")

    monkeypatch.setattr(backend_app, "_require_admin_mutation_unlock", _fake_unlock)

    first = client.patch(
        "/admin/voice-clone/provider",
        headers=_admin_headers("voice_admin"),
        json={"activeProvider": "modal"},
    )
    assert first.status_code == 410
    first_payload = first.json()
    assert first_payload["ok"] is False
    assert "no longer supported" in str(first_payload.get("detail") or "").lower()
    assert first_payload["activeProvider"] == backend_app.OPENVOICE_PROVIDER_MODAL

    second = client.patch(
        "/v1/admin/voice-clone/provider",
        headers=_admin_headers("voice_admin"),
        json={"activeProvider": "modal"},
    )
    assert second.status_code == 410
    second_payload = second.json()
    assert second_payload["ok"] is False
    assert second_payload["activeProvider"] == backend_app.OPENVOICE_PROVIDER_MODAL
    assert unlock_calls == ["voice_admin", "voice_admin"]
