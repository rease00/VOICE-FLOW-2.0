from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

import app as backend_app


class _DummyRuntimeResponse:
    def __init__(self, status_code: int = 200, content: bytes = b"RIFF" + b"\x00" * 512) -> None:
        self.status_code = status_code
        self.content = content
        self.headers = {
            "content-type": "audio/wav",
            "x-voiceflow-trace-id": "trace_test_123",
        }
        self.text = "runtime error"

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self) -> dict:
        return {}


class _DummyRuntimeErrorResponse:
    def __init__(self, status_code: int = 400) -> None:
        self.status_code = status_code
        self.content = b""
        self.headers = {
            "content-type": "application/json",
            "x-voiceflow-trace-id": "trace_error_123",
        }
        self.text = '{"detail":{"errorCode":"GEMINI_API_KEY_MISSING","summary":"pool empty"}}'

    @property
    def ok(self) -> bool:
        return False

    def json(self) -> dict:
        return {
            "detail": {
                "errorCode": "GEMINI_API_KEY_MISSING",
                "summary": "pool empty",
            }
        }


def _make_key(seed: int) -> str:
    return f"AIza{seed:030d}"


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
    backend_app._INMEMORY_GENERATION_HISTORY.clear()
    backend_app._INMEMORY_DAILY_USAGE_RESET_STATUS.clear()


def test_tts_synthesize_writes_compressed_history_blob(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeResponse())
    client = TestClient(backend_app.app)
    uid = "history_user_1"
    headers = {"x-dev-uid": uid}

    response = client.post(
        "/tts/synthesize",
        headers=headers,
        json={
            "engine": "GEM",
            "text": "Hello from history persistence test.",
            "voice_id": "Fenrir",
            "request_id": "req_hist_1",
        },
    )
    assert response.status_code == 200

    row = backend_app._INMEMORY_GENERATION_HISTORY.get(uid) or {}
    assert row.get("codec") == backend_app.VF_GENERATION_HISTORY_CODEC
    assert isinstance(row.get("itemsGzipB64"), str) and row.get("itemsGzipB64")

    decoded_items = backend_app._history_decode_items_gzip_b64(str(row.get("itemsGzipB64") or ""))
    assert len(decoded_items) == 1
    item = decoded_items[0]
    assert item.get("requestId") == "req_hist_1"
    assert item.get("traceId") == "trace_test_123"
    assert item.get("engine") == "GEM"
    assert item.get("status") == "completed"
    assert "audioUrl" not in item


def test_generation_history_endpoints_return_newest_and_support_clear(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    uid = "history_user_2"
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": uid}

    backend_app._history_append_item(uid, {"id": "old", "timestamp": 1000, "textPreview": "one", "engine": "GEM"})
    backend_app._history_append_item(uid, {"id": "new", "timestamp": 2000, "textPreview": "two", "engine": "KOKORO"})
    backend_app._history_append_item(uid, {"id": "newest", "timestamp": 3000, "textPreview": "three", "engine": "GEM"})

    fetch = client.get("/account/generation-history?limit=2", headers=headers)
    assert fetch.status_code == 200
    payload = fetch.json()
    assert payload["ok"] is True
    assert payload["count"] == 2
    assert payload["items"][0]["id"] == "newest"
    assert payload["items"][1]["id"] == "new"

    cleared = client.delete("/account/generation-history", headers=headers)
    assert cleared.status_code == 200
    refetch = client.get("/account/generation-history?limit=10", headers=headers)
    assert refetch.status_code == 200
    assert refetch.json()["items"] == []


def test_admin_gemini_pool_status_requires_admin(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_backend_gemini_pool_snapshot", lambda: {"ok": True, "pool": {"keyCount": 1}})
    monkeypatch.setattr(backend_app, "_runtime_gemini_pool_snapshot", lambda: {"ok": True, "pool": {"keyCount": 1}})
    client = TestClient(backend_app.app)

    denied = client.get("/admin/gemini/pool/status", headers={"x-dev-uid": "plain_dev_user"})
    assert denied.status_code == 403

    allowed = client.get("/admin/gemini/pool/status", headers={"x-dev-uid": "local_admin"})
    assert allowed.status_code == 200
    payload = allowed.json()
    assert payload["ok"] is True
    assert payload["backend"]["pool"]["keyCount"] == 1


def test_admin_gemini_pool_reload_uses_file_keys(monkeypatch, tmp_path: Path) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    key_a = _make_key(11)
    key_b = _make_key(12)
    keys_path = tmp_path / "api_keys.txt"
    keys_path.write_text(f"{key_a}\ninvalid\n{key_b}\n{key_a}\n", encoding="utf-8")

    monkeypatch.setenv("GEMINI_API_KEYS_FILE", str(keys_path))
    monkeypatch.setenv("GEMINI_API_KEYS", "")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("API_KEY", "")
    monkeypatch.setenv("VF_GEMINI_API_KEY", "")

    captured_keys: list[str] = []
    monkeypatch.setattr(backend_app.BACKEND_GEMINI_ALLOCATOR, "ensure_keys", lambda keys: captured_keys.extend(keys))
    monkeypatch.setattr(
        backend_app,
        "_backend_gemini_pool_snapshot",
        lambda: {
            "ok": True,
            "pool": {"keyCount": len(captured_keys)},
            "source": backend_app._gemini_pool_source_diagnostics(),
        },
    )
    monkeypatch.setattr(backend_app, "_runtime_gemini_pool_reload", lambda: {"ok": True})
    monkeypatch.setattr(backend_app, "_runtime_gemini_pool_snapshot", lambda: {"ok": True, "pool": {"keyCount": 2}})

    client = TestClient(backend_app.app)
    response = client.post("/admin/gemini/pool/reload", headers={"x-dev-uid": "local_admin"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert captured_keys == [key_a, key_b]
    source = payload["backend"]["source"]
    assert source["fileExists"] is True
    assert source["fileKeyCount"] == 2


def test_tts_synthesize_forwards_structured_runtime_error(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeErrorResponse())
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "local_admin"}

    response = client.post(
        "/tts/synthesize",
        headers=headers,
        json={
            "engine": "GEM",
            "text": "Structured error forward test.",
            "voice_id": "Fenrir",
            "request_id": "req_err_struct_1",
        },
    )
    assert response.status_code == 400
    payload = response.json()
    assert isinstance(payload.get("detail"), dict)
    assert payload["detail"].get("errorCode") == "GEMINI_API_KEY_MISSING"
    assert payload["detail"].get("trace_id") == "trace_error_123"


def test_wallet_spendable_now_includes_vff_for_gem() -> None:
    entitlement = {"paidVfBalance": 300, "vffBalance": 200, "monthlyVfLimit": 1000}
    monthly = {"monthlyFreeVfUsed": 100}
    gem_spendable = backend_app._wallet_spendable_now(entitlement, monthly, "GEM")
    kokoro_spendable = backend_app._wallet_spendable_now(entitlement, monthly, "KOKORO")
    assert gem_spendable == 1400
    assert kokoro_spendable == 1400


def test_wallet_charge_breakdown_is_free_first_for_all_engines() -> None:
    entitlement = {"paidVfBalance": 300, "vffBalance": 200, "monthlyVfLimit": 1000}
    monthly = {"monthlyFreeVfUsed": 900}
    gem = backend_app._wallet_charge_breakdown(entitlement, monthly, "GEM", 250)
    kokoro = backend_app._wallet_charge_breakdown(entitlement, monthly, "KOKORO", 250)
    assert gem == {"vff": 150, "monthlyVf": 100, "paidVf": 0}
    assert kokoro == {"vff": 150, "monthlyVf": 100, "paidVf": 0}


def test_admin_reset_daily_usage_all_requires_admin(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)
    denied = client.post("/admin/usage/reset-daily-all", headers={"x-dev-uid": "plain_user"})
    assert denied.status_code == 403


def test_admin_reset_daily_usage_all_dryrun_then_execute(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "local_admin"}

    day_key = backend_app._usage_day_key()
    period_key = backend_app._usage_day_period_label()
    backend_app._INMEMORY_USAGE_DAILY[f"user_a_{day_key}"] = {
        "uid": "user_a",
        "periodKey": period_key,
        "generationCount": 4,
        "vfUsed": 100,
    }
    backend_app._INMEMORY_USAGE_DAILY[f"user_b_{day_key}"] = {
        "uid": "user_b",
        "periodKey": period_key,
        "generationCount": 2,
        "vfUsed": 80,
    }
    backend_app._INMEMORY_USAGE_DAILY["legacy_user_19990101"] = {
        "uid": "legacy_user",
        "periodKey": "1999-01-01",
        "generationCount": 9,
        "vfUsed": 900,
    }

    dry = client.post("/admin/usage/reset-daily-all?dryRun=1", headers=headers)
    assert dry.status_code == 200
    dry_payload = dry.json()
    assert dry_payload["dryRun"] is True
    assert dry_payload["usersAffected"] == 2
    assert dry_payload["docsCleared"] == 2
    assert len(backend_app._INMEMORY_USAGE_DAILY) == 3

    run = client.post("/admin/usage/reset-daily-all", headers=headers)
    assert run.status_code == 200
    run_payload = run.json()
    assert run_payload["dryRun"] is False
    assert run_payload["usersAffected"] == 2
    assert run_payload["docsCleared"] == 2
    assert len(backend_app._INMEMORY_USAGE_DAILY) == 1
    assert "legacy_user_19990101" in backend_app._INMEMORY_USAGE_DAILY

    status = client.get("/admin/usage/reset-daily-all/status", headers=headers)
    assert status.status_code == 200
    status_payload = status.json()
    assert status_payload["status"] == "available"
    assert status_payload["lastRun"]["docsCleared"] == 2
