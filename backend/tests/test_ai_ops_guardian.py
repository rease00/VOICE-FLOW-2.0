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


def _health_engine_by_url() -> dict[str, str]:
    return {url: engine for engine, url in backend_app.TTS_ENGINE_HEALTH_URLS.items()}


def test_guardian_status_contract() -> None:
    _reset_ai_ops_state()
    client = TestClient(backend_app.app)
    response = client.get("/ops/guardian/status")
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

    health_map = _health_engine_by_url()
    switch_calls: list[str] = []
    switched: set[str] = set()

    def _probe(url: str, timeout_sec: float = 2.5):
        _ = timeout_sec
        engine = health_map[url]
        if engine == "GEM" and engine not in switched:
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
    response = client.post("/ops/guardian/scan", json={"autoFixMinor": True, "gpu": False})
    assert response.status_code == 200
    payload = response.json()
    assert any(item.get("id") == "runtime_single_offline" for item in payload.get("detectedIssues", []))
    assert any(item.get("action") == "restart_runtime" for item in payload.get("autoFixActions", []))
    assert switch_calls == ["GEM"]


def test_guardian_major_action_queues_approval_when_not_admin(monkeypatch) -> None:
    _reset_ai_ops_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_ADMIN_APPROVAL_TOKEN", "secret")
    monkeypatch.setattr(backend_app, "VF_ADMIN_APPROVER_UIDS", frozenset({"admin_user"}))

    client = TestClient(backend_app.app)
    response = client.post(
        "/ops/guardian/actions",
        json={"action": "restart_all_runtimes"},
        headers={"x-dev-uid": "non_admin"},
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
        headers={"x-dev-uid": "non_admin"},
    )
    assert queued.status_code == 202
    approval_id = queued.json()["approval"]["id"]

    decided = client.post(
        f"/ops/guardian/approvals/{approval_id}/decision",
        json={"approved": True, "adminToken": "secret"},
        headers={"x-dev-uid": "admin_user"},
    )
    assert decided.status_code == 200
    payload = decided.json()
    assert payload["approval"]["status"] == "executed"
    assert payload["execution"]["ok"] is True


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

    status = client.get("/ops/guardian/status")
    assert status.status_code == 200
    payload = status.json()
    assert len(payload["recentFrontendErrors"]) >= 1
    assert payload["recentFrontendErrors"][-1]["message"] == "Unhandled promise rejection"

