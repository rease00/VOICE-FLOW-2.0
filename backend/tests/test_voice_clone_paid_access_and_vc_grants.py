from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import app as backend_app


def _reset_inmemory_state() -> None:
    backend_app._INMEMORY_ENTITLEMENTS.clear()
    backend_app._INMEMORY_USAGE_MONTHLY.clear()
    backend_app._INMEMORY_USAGE_DAILY.clear()
    backend_app._INMEMORY_USAGE_EVENTS.clear()
    backend_app._INMEMORY_WALLET_DAILY.clear()
    backend_app._INMEMORY_WALLET_TRANSACTIONS.clear()
    backend_app._INMEMORY_USER_PROFILES.clear()
    backend_app._INMEMORY_USER_ID_INDEX.clear()
    backend_app._INMEMORY_ADMIN_ROLES.clear()
    backend_app._TTS_SUCCESS_LIMITER.clear_all_local_state()


def test_voice_clone_paid_access_requires_active_paid_plan_and_vc_balance() -> None:
    _reset_inmemory_state()

    with pytest.raises(HTTPException) as free_exc:
        backend_app._voice_clone_require_paid_access("free_user")
    assert free_exc.value.status_code == 403
    assert "paid plan" in str(free_exc.value.detail).lower()

    backend_app._write_entitlement(
        "paid_zero_vc_user",
        {
            "plan": "Starter",
            "status": "active",
            "vcFreeBalance": 0,
            "vcGrantedBalance": 0,
            "vcPaidBalance": 0,
        },
    )
    with pytest.raises(HTTPException) as zero_exc:
        backend_app._voice_clone_require_paid_access("paid_zero_vc_user")
    assert zero_exc.value.status_code == 429
    assert "vc balance" in str(zero_exc.value.detail).lower()

    backend_app._write_entitlement(
        "paid_granted_vc_user",
        {
            "plan": "Starter",
            "status": "active",
            "vcFreeBalance": 0,
            "vcGrantedBalance": 3,
            "vcPaidBalance": 0,
        },
    )
    entitlement, is_admin, plan_key = backend_app._voice_clone_require_paid_access("paid_granted_vc_user")
    assert is_admin is False
    assert plan_key == "starter"
    assert float(entitlement.get("vcSpendableBalance") or 0) == pytest.approx(3.0)


def test_voice_clone_paid_access_allows_admin_bypass_without_vc_balance() -> None:
    _reset_inmemory_state()
    entitlement, is_admin, plan_key = backend_app._voice_clone_require_paid_access("admin_voice_clone_user", is_admin=True)
    assert is_admin is True
    assert plan_key == "free"
    assert float(entitlement.get("vcSpendableBalance") or 0) == pytest.approx(0.0)


def test_admin_vc_grant_requires_super_admin_and_updates_granted_balance(monkeypatch: pytest.MonkeyPatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)
    monkeypatch.setattr(
        backend_app,
        "_require_admin_mutation_unlock",
        lambda _request, expected_uid=None: str(expected_uid or "billing_admin_user"),
    )
    monkeypatch.setattr(backend_app, "_audit_append_event", lambda **kwargs: None)

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
        "billing_admin_user",
        {
            "role": backend_app.RBAC_ROLE_SUPER_ADMIN,
            "allowOverrides": [],
            "denyOverrides": [],
            "status": "active",
            "updatedBy": "seed",
        },
    )
    backend_app._write_entitlement(
        "target_wallet_user",
        {
            "plan": "Starter",
            "status": "active",
            "vcFreeBalance": 1,
            "vcGrantedBalance": 0,
            "vcPaidBalance": 2,
        },
    )

    client = TestClient(backend_app.app)

    denied = client.post(
        "/admin/billing/users/target_wallet_user/vc-grants",
        headers={"x-dev-uid": "billing_actor_user"},
        json={"amount": 5, "note": "bonus grant"},
    )
    assert denied.status_code == 403
    assert "super_admin" in str((denied.json() or {}).get("detail") or "").lower()

    granted = client.post(
        "/admin/billing/users/target_wallet_user/vc-grants",
        headers={"x-dev-uid": "billing_admin_user"},
        json={"amount": 5, "note": "bonus grant", "requestId": "grant_req_001"},
    )
    assert granted.status_code == 200
    granted_body = granted.json() or {}
    assert granted_body.get("ok") is True
    assert float((granted_body.get("wallet") or {}).get("vcGrantedBalance") or 0) == pytest.approx(5.0)
    assert float((granted_body.get("wallet") or {}).get("vcSpendableBalance") or 0) == pytest.approx(8.0)
    assert len(list(granted_body.get("items") or [])) >= 1

    listed = client.get(
        "/admin/billing/users/target_wallet_user/vc-grants",
        headers={"x-dev-uid": "billing_admin_user"},
    )
    assert listed.status_code == 200
    items = list((listed.json() or {}).get("items") or [])
    assert len(items) >= 1
    latest = items[0]
    assert float(latest.get("amount") or 0) == pytest.approx(5.0)
    assert str(latest.get("note") or "") == "bonus grant"
    assert float(((latest.get("before") or {}).get("vcSpendableBalance") or 0)) == pytest.approx(3.0)
    assert float(((latest.get("after") or {}).get("vcSpendableBalance") or 0)) == pytest.approx(8.0)
