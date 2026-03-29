from __future__ import annotations

from fastapi.testclient import TestClient

import app as backend_app


def _reset_ai_ops_state() -> None:
    with backend_app.AI_OPS_LOCK:
        backend_app.AI_OPS_STATE.clear()
        backend_app.AI_OPS_STATE.update(
            {
                "startedAtMs": int(backend_app.time.time() * 1000),
                "maintenanceMode": False,
                "temporarySheddingUntilMs": 0,
                "inFlightTotal": 0,
                "inFlightPeak": 0,
                "routeStats": {},
                "recentErrors": [],
                "frontendErrors": [],
                "lastAutoFixAtMs": {},
                "pendingApprovals": {},
                "approvalOrder": [],
                "actionHistory": [],
            }
        )


def _health_engines_by_url() -> dict[str, list[str]]:
    mapping: dict[str, list[str]] = {}
    for engine, url in backend_app.TTS_ENGINE_HEALTH_URLS.items():
        mapping.setdefault(url, []).append(engine)
    return mapping


def _next_engine_for_health_url(
    health_map: dict[str, list[str]],
    call_counts: dict[str, int],
    url: str,
) -> str:
    engines = list(health_map.get(url) or [])
    if not engines:
        return "PRIME"
    seen = int(call_counts.get(url) or 0)
    call_counts[url] = seen + 1
    return engines[seen % len(engines)]


def test_guardian_status_contract(monkeypatch) -> None:
    _reset_ai_ops_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)
    response = client.get("/ops/guardian/status", headers={"x-dev-uid": "local_admin"})
    assert response.status_code == 200
    payload = response.json()
    assert "ok" in payload
    assert "mode" in payload
    assert "concurrency" in payload
    assert "runtimes" in payload
    assert "geminiPool" in payload
    assert "issues" in payload
    assert "pendingApprovalCount" in payload
    assert "recentErrors" in payload
    assert "recentFrontendErrors" in payload


def test_guardian_scan_auto_fixes_single_offline_runtime(monkeypatch) -> None:
    _reset_ai_ops_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_AI_OPS_ENABLE_AUTOFIX_MINOR", True)

    health_map = _health_engines_by_url()
    call_counts: dict[str, int] = {}
    switch_calls: list[str] = []
    switched: set[str] = set()

    def _probe(url: str, timeout_sec: float = 2.5):
        _ = timeout_sec
        engine = _next_engine_for_health_url(health_map, call_counts, url)
        if engine == "PRIME" and engine not in switched:
            return False, "offline"
        return True, "Runtime online"

    def _switch(engine: str, gpu: bool, retries: int = 2, keep_others: bool = True):
        _ = gpu, retries, keep_others
        switch_calls.append(engine)
        switched.add(engine)
        return f"switched:{engine}"

    monkeypatch.setattr(backend_app, "_probe_runtime_health", _probe)
    monkeypatch.setattr(backend_app, "_run_tts_switch_with_retry", _switch)

    client = TestClient(backend_app.app)
    response = client.post(
        "/ops/guardian/scan",
        json={"autoFixMinor": True, "gpu": False},
        headers={"x-dev-uid": "local_admin"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert any(item.get("id") == "runtime_single_offline" for item in payload.get("detectedIssues", []))
    assert any(item.get("action") == "restart_runtime" for item in payload.get("autoFixActions", []))
    assert switch_calls == ["PRIME"]


def test_guardian_major_action_queues_approval_when_admin_token_missing(monkeypatch) -> None:
    _reset_ai_ops_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_ADMIN_APPROVAL_TOKEN", "secret")
    monkeypatch.setattr(backend_app, "VF_ADMIN_APPROVER_UIDS", frozenset({"admin_user"}))

    client = TestClient(backend_app.app)
    response = client.post(
        "/ops/guardian/actions",
        json={"action": "restart_all_runtimes"},
        headers={"x-dev-uid": "local_admin"},
    )
    assert response.status_code == 202
    payload = response.json()
    assert payload["action"] == "restart_all_runtimes"
    assert payload["severity"] == "major"
    assert payload["approval"]["status"] == "pending"


def test_guardian_major_approval_executes_with_valid_admin(monkeypatch) -> None:
    _reset_ai_ops_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_ADMIN_APPROVAL_TOKEN", "secret")
    monkeypatch.setattr(backend_app, "VF_ADMIN_APPROVER_UIDS", frozenset({"admin_user"}))

    monkeypatch.setattr(
        backend_app,
        "_run_tts_switch_with_retry",
        lambda engine, gpu, retries=2, keep_others=True: f"switched:{engine}:{gpu}:{retries}:{keep_others}",
    )
    monkeypatch.setattr(backend_app, "_probe_runtime_health", lambda _url, timeout_sec=2.5: (True, "Runtime online"))

    client = TestClient(backend_app.app)
    queued = client.post(
        "/ops/guardian/actions",
        json={"action": "restart_all_runtimes"},
        headers={"x-dev-uid": "local_admin"},
    )
    assert queued.status_code == 202
    approval_id = queued.json()["approval"]["id"]

    decided = client.post(
        f"/ops/guardian/approvals/{approval_id}/decision",
        json={"approved": True},
        headers={"x-dev-uid": "admin_user"},
    )
    assert decided.status_code == 200
    payload = decided.json()
    assert payload["approval"]["status"] == "executed"
    assert payload["execution"]["ok"] is True


def test_guardian_minor_action_allows_firestore_admin_without_token_when_unconfigured(monkeypatch) -> None:
    _reset_ai_ops_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "VF_ADMIN_APPROVAL_TOKEN", "")
    monkeypatch.setattr(backend_app, "VF_ADMIN_APPROVER_UIDS", frozenset())
    monkeypatch.setattr(backend_app, "_verify_firebase_id_token", lambda _token: {"uid": "firestore_admin_user"})
    monkeypatch.setattr(backend_app, "_firestore_user_is_admin", lambda uid: str(uid) == "firestore_admin_user")
    monkeypatch.setattr(
        backend_app,
        "_require_admin_mutation_unlock",
        lambda request, expected_uid=None: str(expected_uid or "firestore_admin_user"),
    )
    monkeypatch.setattr(
        backend_app,
        "_ai_ops_execute_action",
        lambda action, payload, gpu=False, initiator="", approval_id=None: {
            "ok": True,
            "action": action,
            "payload": payload,
            "gpu": bool(gpu),
            "initiator": initiator,
            "approvalId": approval_id,
        },
    )

    client = TestClient(backend_app.app)
    response = client.post(
        "/ops/guardian/actions",
        json={"action": "refresh_gemini_pool"},
        headers={"Authorization": "Bearer token_firestore_admin"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload.get("ok") is True
    assert payload.get("action") == "refresh_gemini_pool"
    assert payload.get("severity") == "minor"


def test_guardian_minor_action_rejects_admin_when_allowlist_configured_and_uid_missing(monkeypatch) -> None:
    _reset_ai_ops_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "VF_ADMIN_APPROVAL_TOKEN", "")
    monkeypatch.setattr(backend_app, "VF_ADMIN_APPROVER_UIDS", frozenset({"different_admin"}))
    monkeypatch.setattr(backend_app, "_verify_firebase_id_token", lambda _token: {"uid": "firestore_admin_user"})
    monkeypatch.setattr(backend_app, "_firestore_user_is_admin", lambda uid: str(uid) == "firestore_admin_user")
    monkeypatch.setattr(
        backend_app,
        "_require_admin_mutation_unlock",
        lambda request, expected_uid=None: str(expected_uid or "firestore_admin_user"),
    )

    client = TestClient(backend_app.app)
    response = client.post(
        "/ops/guardian/actions",
        json={"action": "refresh_gemini_pool"},
        headers={"Authorization": "Bearer token_firestore_admin"},
    )
    assert response.status_code == 403
    detail = str(response.json().get("detail") or "")
    assert "uid_not_allowlisted" in detail


def test_guardian_minor_action_ignores_legacy_admin_token_when_configured(monkeypatch) -> None:
    _reset_ai_ops_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "VF_ADMIN_APPROVAL_TOKEN", "secret")
    monkeypatch.setattr(backend_app, "VF_ADMIN_APPROVER_UIDS", frozenset())
    monkeypatch.setattr(backend_app, "_verify_firebase_id_token", lambda _token: {"uid": "firestore_admin_user"})
    monkeypatch.setattr(backend_app, "_firestore_user_is_admin", lambda uid: str(uid) == "firestore_admin_user")
    monkeypatch.setattr(
        backend_app,
        "_require_admin_mutation_unlock",
        lambda request, expected_uid=None: str(expected_uid or "firestore_admin_user"),
    )
    # Keep this test hermetic: the real action rotates pool files on disk.
    monkeypatch.setattr(
        backend_app,
        "_ai_ops_execute_action",
        lambda action, payload, gpu=False, initiator="", approval_id=None: {
            "ok": True,
            "action": action,
            "payload": payload,
            "gpu": bool(gpu),
            "initiator": initiator,
            "approvalId": approval_id,
        },
    )

    client = TestClient(backend_app.app)
    response = client.post(
        "/ops/guardian/actions",
        json={"action": "refresh_gemini_pool"},
        headers={"Authorization": "Bearer token_firestore_admin"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload.get("action") == "refresh_gemini_pool"
    assert payload.get("severity") == "minor"


def test_guardian_concurrency_guard_observe_vs_enforce(monkeypatch) -> None:
    _reset_ai_ops_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)

    client = TestClient(backend_app.app)
    with backend_app.AI_OPS_LOCK:
        backend_app.AI_OPS_STATE["inFlightTotal"] = int(backend_app.VF_AI_OPS_CONCURRENCY_HARD_LIMIT)

    monkeypatch.setattr(backend_app, "VF_AI_OPS_MODE", "observe")
    observe_response = client.get("/account/entitlements")
    assert observe_response.status_code == 200

    with backend_app.AI_OPS_LOCK:
        backend_app.AI_OPS_STATE["inFlightTotal"] = int(backend_app.VF_AI_OPS_CONCURRENCY_HARD_LIMIT)
    monkeypatch.setattr(backend_app, "VF_AI_OPS_MODE", "enforce")
    enforce_response = client.get("/account/entitlements")
    assert enforce_response.status_code == 503
    assert enforce_response.json()["reason"] == "hard_concurrency_limit"


def test_guardian_frontend_error_ingestion_and_status(monkeypatch) -> None:
    _reset_ai_ops_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)

    client = TestClient(backend_app.app)
    report = client.post(
        "/ops/guardian/frontend-errors",
        json={
            "message": "Unhandled promise rejection",
            "route": "/studio",
            "component": "MainApp",
            "severity": "error",
        },
    )
    assert report.status_code == 200
    report_payload = report.json()
    assert report_payload["accepted"] is True

    status = client.get("/ops/guardian/status", headers={"x-dev-uid": "local_admin"})
    assert status.status_code == 200
    payload = status.json()
    assert len(payload["recentFrontendErrors"]) >= 1
    assert payload["recentFrontendErrors"][-1]["message"] == "Unhandled promise rejection"


def test_guardian_mutate_requires_guardian_mutate_permission(monkeypatch) -> None:
    _reset_ai_ops_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)
    backend_app._INMEMORY_ADMIN_ROLES.clear()
    backend_app._INMEMORY_ADMIN_ROLES["rbac_read_only"] = {
        "uid": "rbac_read_only",
        "role": "read_only_ops",
        "allowOverrides": [],
        "denyOverrides": [],
        "status": "active",
        "version": 1,
    }
    backend_app._rbac_invalidate_cache("rbac_read_only")

    client = TestClient(backend_app.app)
    read_status = client.get("/ops/guardian/status", headers={"x-dev-uid": "rbac_read_only"})
    assert read_status.status_code == 200

    mutate_scan = client.post(
        "/ops/guardian/scan",
        json={"autoFixMinor": False},
        headers={"x-dev-uid": "rbac_read_only"},
    )
    assert mutate_scan.status_code == 403
    assert "guardian.mutate" in str(mutate_scan.json().get("detail"))


def test_guardian_scan_requires_unlock_and_short_circuits_when_missing(monkeypatch) -> None:
    _reset_ai_ops_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(
        backend_app,
        "_verify_firebase_id_token",
        lambda _token: {"uid": "guardian_admin", "admin": True, "iat": 1710000200},
    )

    calls = {"status": 0}

    def _status_stub(*, include_route_stats: bool = False):
        _ = include_route_stats
        calls["status"] += 1
        return {"ok": True, "issues": []}

    monkeypatch.setattr(backend_app, "_ai_ops_build_status", _status_stub)
    client = TestClient(backend_app.app)

    response = client.post(
        "/ops/guardian/scan",
        json={"autoFixMinor": False},
        headers={"Authorization": "Bearer guardian_admin"},
    )
    assert response.status_code == 403
    assert "x-admin-unlock" in str((response.json() or {}).get("detail") or "").lower()
    assert calls["status"] == 0
