from __future__ import annotations

import json
import time
from pathlib import Path

import pytest
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


class _DummyRuntimeCapacityResponse:
    def __init__(self, status_code: int = 502) -> None:
        self.status_code = status_code
        self.content = b""
        self.headers = {
            "content-type": "application/json",
            "x-voiceflow-trace-id": "trace_capacity_123",
        }
        self.text = (
            '{"detail":{"errorCode":"GEMINI_KEY_POOL_OVERLOADED","summary":"capacity saturated","retryAfterMs":2200}}'
        )

    @property
    def ok(self) -> bool:
        return False

    def json(self) -> dict:
        return {
            "detail": {
                "errorCode": "GEMINI_KEY_POOL_OVERLOADED",
                "summary": "capacity saturated",
                "retryAfterMs": 2200,
            }
        }


class _DummyRuntimeUpstreamTimeoutResponse:
    def __init__(self, status_code: int = 502) -> None:
        self.status_code = status_code
        self.content = b""
        self.headers = {
            "content-type": "application/json",
            "x-voiceflow-trace-id": "trace_timeout_123",
        }
        self.text = (
            '{"detail":{"errorCode":"GEMINI_UPSTREAM_REQUEST_TIMEOUT","summary":"read timed out","retryAfterMs":1200}}'
        )

    @property
    def ok(self) -> bool:
        return False

    def json(self) -> dict:
        return {
            "detail": {
                "errorCode": "GEMINI_UPSTREAM_REQUEST_TIMEOUT",
                "summary": "read timed out",
                "retryAfterMs": 1200,
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
    backend_app._TTS_SUCCESS_LIMITER.clear_all_local_state()
    with backend_app._ADMIN_USAGE_LOCK:
        backend_app._ADMIN_USAGE_RECENT_EVENTS.clear()
        backend_app._ADMIN_USAGE_TOTALS.clear()


@pytest.fixture(autouse=True)
def _disable_post_tts_llvc(monkeypatch):
    monkeypatch.setattr(backend_app, "VF_TTS_POST_LLVC_ENABLED", False)
    monkeypatch.setattr(backend_app, "VF_TTS_POST_LLVC_REQUIRED", False)


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

    now_ms = int(time.time() * 1000)
    backend_app._history_append_item(
        uid,
        {"id": "old", "timestamp": now_ms - 3_000, "textPreview": "one", "engine": "GEM"},
    )
    backend_app._history_append_item(
        uid,
        {"id": "new", "timestamp": now_ms - 2_000, "textPreview": "two", "engine": "KOKORO"},
    )
    backend_app._history_append_item(
        uid,
        {"id": "newest", "timestamp": now_ms - 1_000, "textPreview": "three", "engine": "GEM"},
    )

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


def test_generation_history_default_retention_prunes_items_older_than_one_year(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    uid = "history_user_retention"
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": uid}

    now_ms = int(time.time() * 1000)
    old_timestamp = now_ms - backend_app.VF_GENERATION_HISTORY_RETENTION_MS - 1_000
    fresh_timestamp = now_ms - 60_000

    backend_app._history_append_item(
        uid,
        {"id": "expired", "timestamp": old_timestamp, "textPreview": "too old", "engine": "GEM"},
    )
    backend_app._history_append_item(
        uid,
        {"id": "fresh", "timestamp": fresh_timestamp, "textPreview": "still valid", "engine": "KOKORO"},
    )

    fetch = client.get("/account/generation-history?limit=10", headers=headers)
    assert fetch.status_code == 200
    payload = fetch.json()
    assert payload["ok"] is True
    assert [item["id"] for item in payload["items"]] == ["fresh"]

    row = backend_app._INMEMORY_GENERATION_HISTORY.get(uid) or {}
    decoded_items = backend_app._history_decode_items_gzip_b64(str(row.get("itemsGzipB64") or ""))
    assert [item.get("id") for item in decoded_items] == ["fresh"]


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


def test_admin_gemini_pools_syncs_authoritative_free_pool(monkeypatch, tmp_path: Path) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "GEMINI_API_POOLS_PREFER_FIRESTORE", False)

    free_a = _make_key(101)
    free_b = _make_key(102)
    pro_key = _make_key(103)
    keys_path = tmp_path / "API.txt"
    keys_path.write_text(f"{free_a}\n{free_b}\n", encoding="utf-8")
    pools_path = tmp_path / "gemini_api_pools.json"
    pools_path.write_text(
        json.dumps(
            {
                "version": 1,
                "pools": {
                    "free": {"keys": []},
                    "pro": {"keys": [pro_key]},
                    "pro_plus": {"keys": []},
                },
                "fallbackChains": {
                    "free": ["free"],
                    "pro": ["pro", "free"],
                    "pro_plus": ["pro_plus", "pro", "free"],
                },
                "constraints": {"uniqueKeyMembership": True},
            },
            ensure_ascii=True,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("GEMINI_API_KEYS_FILE", str(keys_path))
    monkeypatch.setenv("GEMINI_API_POOLS_FILE", str(pools_path))
    monkeypatch.setenv("GEMINI_API_KEYS", "")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("VF_GEMINI_API_KEY", "")
    monkeypatch.setenv("API_KEY", "")
    backend_app._GEMINI_POOLS_CACHE = None
    backend_app._GEMINI_POOLS_META = {}
    monkeypatch.setattr(backend_app, "_runtime_gemini_pool_snapshot", lambda: {"ok": True})

    client = TestClient(backend_app.app)
    response = client.get("/admin/gemini/pools", headers={"x-dev-uid": "local_admin"})
    assert response.status_code == 200
    payload = response.json()

    assert payload["config"]["pools"]["free"]["keys"] == [free_a, free_b]
    assert payload["config"]["pools"]["pro"]["keys"] == [pro_key]
    assert payload["sourcePolicy"]["freePoolLocked"] is True
    assert str(payload["sourcePolicy"]["freePoolMode"] or "").strip().lower() == "api_file_authoritative"
    assert payload.get("warnings") == []

    persisted = json.loads(pools_path.read_text(encoding="utf-8"))
    assert persisted["pools"]["free"]["keys"] == [free_a, free_b]


def test_admin_gemini_pools_put_ignores_free_edits_when_locked(monkeypatch, tmp_path: Path) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "GEMINI_API_POOLS_PREFER_FIRESTORE", False)

    free_key = _make_key(111)
    pro_key = _make_key(112)
    keys_path = tmp_path / "API.txt"
    keys_path.write_text(f"{free_key}\n", encoding="utf-8")
    pools_path = tmp_path / "gemini_api_pools.json"
    pools_path.write_text(
        json.dumps(
            {
                "version": 1,
                "pools": {
                    "free": {"keys": []},
                    "pro": {"keys": []},
                    "pro_plus": {"keys": []},
                },
                "fallbackChains": {
                    "free": ["free"],
                    "pro": ["pro", "free"],
                    "pro_plus": ["pro_plus", "pro", "free"],
                },
                "constraints": {"uniqueKeyMembership": True},
            },
            ensure_ascii=True,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("GEMINI_API_KEYS_FILE", str(keys_path))
    monkeypatch.setenv("GEMINI_API_POOLS_FILE", str(pools_path))
    backend_app._GEMINI_POOLS_CACHE = None
    backend_app._GEMINI_POOLS_META = {}
    monkeypatch.setattr(backend_app, "_runtime_gemini_pool_reload", lambda: {"ok": True})
    monkeypatch.setattr(backend_app, "_runtime_gemini_pool_snapshot", lambda: {"ok": True, "pool": {"keyCount": 2}})

    client = TestClient(backend_app.app)
    warm = client.get("/admin/gemini/pools", headers={"x-dev-uid": "local_admin"})
    assert warm.status_code == 200

    candidate_free = _make_key(119)
    update = client.put(
        "/admin/gemini/pools",
        headers={"x-dev-uid": "local_admin"},
        json={
            "version": 1,
            "pools": {
                "free": {"keys": [candidate_free]},
                "pro": {"keys": [pro_key]},
                "pro_plus": {"keys": []},
            },
            "fallbackChains": {
                "free": ["free"],
                "pro": ["pro", "free"],
                "pro_plus": ["pro_plus", "pro", "free"],
            },
            "constraints": {"uniqueKeyMembership": True},
        },
    )
    assert update.status_code == 200
    payload = update.json()
    assert "free_pool_locked_by_api_file" in list(payload.get("appliedOverrides") or [])
    assert payload["config"]["pools"]["free"]["keys"] == [free_key]
    assert payload["config"]["pools"]["pro"]["keys"] == [pro_key]


def test_admin_gemini_pools_missing_file_keeps_last_good(monkeypatch, tmp_path: Path) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "GEMINI_API_POOLS_PREFER_FIRESTORE", False)

    free_key = _make_key(121)
    keys_path = tmp_path / "API.txt"
    keys_path.write_text(f"{free_key}\n", encoding="utf-8")
    pools_path = tmp_path / "gemini_api_pools.json"
    pools_path.write_text(
        json.dumps(
            {
                "version": 1,
                "pools": {
                    "free": {"keys": []},
                    "pro": {"keys": []},
                    "pro_plus": {"keys": []},
                },
                "fallbackChains": {
                    "free": ["free"],
                    "pro": ["pro", "free"],
                    "pro_plus": ["pro_plus", "pro", "free"],
                },
                "constraints": {"uniqueKeyMembership": True},
            },
            ensure_ascii=True,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("GEMINI_API_KEYS_FILE", str(keys_path))
    monkeypatch.setenv("GEMINI_API_POOLS_FILE", str(pools_path))
    backend_app._GEMINI_POOLS_CACHE = None
    backend_app._GEMINI_POOLS_META = {}
    monkeypatch.setattr(backend_app, "_runtime_gemini_pool_reload", lambda: {"ok": True})
    monkeypatch.setattr(backend_app, "_runtime_gemini_pool_snapshot", lambda: {"ok": True, "pool": {"keyCount": 1}})

    client = TestClient(backend_app.app)
    initial = client.get("/admin/gemini/pools", headers={"x-dev-uid": "local_admin"})
    assert initial.status_code == 200
    assert initial.json()["config"]["pools"]["free"]["keys"] == [free_key]

    keys_path.unlink()
    backend_app._GEMINI_POOLS_CACHE = None
    backend_app._GEMINI_POOLS_META = {}

    reloaded = client.post("/admin/gemini/pools/reload", headers={"x-dev-uid": "local_admin"})
    assert reloaded.status_code == 200
    warnings = list(reloaded.json().get("warnings") or [])
    assert warnings

    refreshed = client.get("/admin/gemini/pools", headers={"x-dev-uid": "local_admin"})
    assert refreshed.status_code == 200
    payload = refreshed.json()
    assert payload["config"]["pools"]["free"]["keys"] == [free_key]
    assert list(payload.get("warnings") or [])


def test_admin_gemini_pools_supports_custom_pool_and_plan_mapping(monkeypatch, tmp_path: Path) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "GEMINI_API_POOLS_PREFER_FIRESTORE", False)

    free_key = _make_key(130)
    custom_key = _make_key(131)
    keys_path = tmp_path / "API.txt"
    keys_path.write_text(f"{free_key}\n", encoding="utf-8")
    pools_path = tmp_path / "gemini_api_pools.json"
    pools_path.write_text(
        json.dumps(
            {
                "version": 1,
                "pools": {
                    "free": {"keys": []},
                    "pro": {"keys": []},
                    "pro_plus": {"keys": []},
                },
                "fallbackChains": {
                    "free": ["free"],
                    "pro": ["pro", "free"],
                    "pro_plus": ["pro_plus", "pro", "free"],
                },
                "constraints": {"uniqueKeyMembership": True},
            },
            ensure_ascii=True,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("GEMINI_API_KEYS_FILE", str(keys_path))
    monkeypatch.setenv("GEMINI_API_POOLS_FILE", str(pools_path))
    backend_app._GEMINI_POOLS_CACHE = None
    backend_app._GEMINI_POOLS_META = {}
    monkeypatch.setattr(backend_app, "_runtime_gemini_pool_reload", lambda: {"ok": True})
    monkeypatch.setattr(backend_app, "_runtime_gemini_pool_snapshot", lambda: {"ok": True, "pool": {"keyCount": 2}})

    client = TestClient(backend_app.app)
    warm = client.get("/admin/gemini/pools", headers={"x-dev-uid": "local_admin"})
    assert warm.status_code == 200

    update = client.put(
        "/admin/gemini/pools",
        headers={"x-dev-uid": "local_admin"},
        json={
            "version": 1,
            "pools": {
                "free": {"keys": []},
                "pro": {"keys": []},
                "pro_plus": {"keys": []},
                "enterprise_gold": {"keys": [custom_key]},
            },
            "fallbackChains": {
                "free": ["free"],
                "pro": ["pro", "free"],
                "pro_plus": ["pro_plus", "pro", "free"],
                "enterprise_gold": ["enterprise_gold", "pro", "free"],
            },
            "planPools": {
                "free": "free",
                "pro": "pro",
                "plus": "enterprise_gold",
            },
            "defaultFallbackChain": ["enterprise_gold", "pro", "free"],
            "constraints": {"uniqueKeyMembership": True},
        },
    )
    assert update.status_code == 200
    payload = update.json()
    assert payload["config"]["planPools"]["plus"] == "enterprise_gold"
    assert payload["config"]["pools"]["enterprise_gold"]["keys"] == [custom_key]
    assert payload["config"]["defaultFallbackChain"] == ["enterprise_gold", "pro", "free"]
    assert "enterprise_gold" in payload["config"]["fallbackChains"]

    refreshed = client.get("/admin/gemini/pools", headers={"x-dev-uid": "local_admin"})
    assert refreshed.status_code == 200
    assert refreshed.json()["config"]["pools"]["enterprise_gold"]["keys"] == [custom_key]


def test_admin_gemini_pools_delete_free_disables_authoritative_mode(monkeypatch, tmp_path: Path) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "GEMINI_API_POOLS_PREFER_FIRESTORE", False)

    free_key = _make_key(140)
    pro_key = _make_key(141)
    keys_path = tmp_path / "API.txt"
    keys_path.write_text(f"{free_key}\n", encoding="utf-8")
    pools_path = tmp_path / "gemini_api_pools.json"
    pools_path.write_text(
        json.dumps(
            {
                "version": 1,
                "pools": {
                    "free": {"keys": []},
                    "pro": {"keys": [pro_key]},
                    "pro_plus": {"keys": []},
                },
                "fallbackChains": {
                    "free": ["free"],
                    "pro": ["pro", "free"],
                    "pro_plus": ["pro_plus", "pro", "free"],
                },
                "constraints": {"uniqueKeyMembership": True},
            },
            ensure_ascii=True,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("GEMINI_API_KEYS_FILE", str(keys_path))
    monkeypatch.setenv("GEMINI_API_POOLS_FILE", str(pools_path))
    backend_app._GEMINI_POOLS_CACHE = None
    backend_app._GEMINI_POOLS_META = {}
    monkeypatch.setattr(backend_app, "_runtime_gemini_pool_reload", lambda: {"ok": True})
    monkeypatch.setattr(backend_app, "_runtime_gemini_pool_snapshot", lambda: {"ok": True, "pool": {"keyCount": 1}})

    client = TestClient(backend_app.app)
    warm = client.get("/admin/gemini/pools", headers={"x-dev-uid": "local_admin"})
    assert warm.status_code == 200
    assert warm.json()["sourcePolicy"]["freePoolLocked"] is True

    update = client.put(
        "/admin/gemini/pools",
        headers={"x-dev-uid": "local_admin"},
        json={
            "version": 1,
            "pools": {
                "pro": {"keys": [pro_key]},
                "pro_plus": {"keys": []},
            },
            "fallbackChains": {
                "pro": ["pro"],
                "pro_plus": ["pro_plus", "pro"],
            },
            "planPools": {
                "free": "free",
                "pro": "pro",
                "plus": "pro_plus",
            },
            "defaultFallbackChain": ["pro", "pro_plus"],
            "constraints": {"uniqueKeyMembership": True},
        },
    )
    assert update.status_code == 200
    payload = update.json()
    assert "free_pool_authoritative_mode_disabled" in list(payload.get("appliedOverrides") or [])
    assert "free" not in payload["config"]["pools"]
    assert payload["sourcePolicy"]["freePoolLocked"] is False
    assert str(payload["sourcePolicy"]["freePoolMode"] or "").strip().lower() == "config_managed"

    backend_app._GEMINI_POOLS_CACHE = None
    backend_app._GEMINI_POOLS_META = {}
    after = client.get("/admin/gemini/pools", headers={"x-dev-uid": "local_admin"})
    assert after.status_code == 200
    assert "free" not in after.json()["config"]["pools"]


def test_admin_gemini_plan_mapping_missing_pool_falls_back_to_default_chain(monkeypatch, tmp_path: Path) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "GEMINI_API_POOLS_PREFER_FIRESTORE", False)

    free_key = _make_key(150)
    pro_key = _make_key(151)
    keys_path = tmp_path / "API.txt"
    keys_path.write_text(f"{free_key}\n", encoding="utf-8")
    pools_path = tmp_path / "gemini_api_pools.json"
    pools_path.write_text(
        json.dumps(
            {
                "version": 1,
                "pools": {
                    "free": {"keys": []},
                    "pro": {"keys": [pro_key]},
                },
                "fallbackChains": {
                    "free": ["free"],
                    "pro": ["pro", "free"],
                },
                "constraints": {"uniqueKeyMembership": True},
            },
            ensure_ascii=True,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("GEMINI_API_KEYS_FILE", str(keys_path))
    monkeypatch.setenv("GEMINI_API_POOLS_FILE", str(pools_path))
    backend_app._GEMINI_POOLS_CACHE = None
    backend_app._GEMINI_POOLS_META = {}
    monkeypatch.setattr(backend_app, "_runtime_gemini_pool_reload", lambda: {"ok": True})
    monkeypatch.setattr(backend_app, "_runtime_gemini_pool_snapshot", lambda: {"ok": True, "pool": {"keyCount": 2}})

    client = TestClient(backend_app.app)
    warm = client.get("/admin/gemini/pools", headers={"x-dev-uid": "local_admin"})
    assert warm.status_code == 200

    update = client.put(
        "/admin/gemini/pools",
        headers={"x-dev-uid": "local_admin"},
        json={
            "version": 1,
            "pools": {
                "free": {"keys": []},
                "pro": {"keys": [pro_key]},
            },
            "fallbackChains": {
                "free": ["free"],
                "pro": ["pro", "free"],
            },
            "planPools": {
                "free": "free",
                "pro": "pro",
                "plus": "enterprise_missing",
            },
            "defaultFallbackChain": ["pro", "free"],
            "constraints": {"uniqueKeyMembership": True},
        },
    )
    assert update.status_code == 200
    payload = update.json()
    assert payload["validation"]["missingPlanPools"]["plus"] == "enterprise_missing"
    keys = backend_app._resolve_gemini_plan_key_pool("plus")
    assert pro_key in keys
    assert free_key in keys


def test_admin_integrations_usage_requires_admin(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)
    denied = client.get("/admin/integrations/usage", headers={"x-dev-uid": "plain_dev_user"})
    assert denied.status_code == 403


def test_admin_integrations_usage_summary_and_export(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "local_admin"}

    client.get("/health")
    client.get("/system/version")

    summary = client.get("/admin/integrations/usage", headers=headers)
    assert summary.status_code == 200
    payload = summary.json()
    assert payload["ok"] is True
    assert "windows" in payload and "total" in payload["windows"]
    assert "integrations" in payload
    assert "gateway" in payload

    export_csv = client.get("/admin/integrations/usage/export?format=csv&window=24h", headers=headers)
    assert export_csv.status_code == 200
    assert "text/csv" in str(export_csv.headers.get("content-type") or "")
    assert "integration,endpoint,method,window" in export_csv.text


def test_tts_synthesize_returns_gateway_overload_detail(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(
        backend_app._TTS_GATEWAY_CONTROLLER,
        "acquire",
        lambda: (None, {"reason": "queue_timeout", "queueDepth": 12, "retryAfterMs": 1500}),
    )
    client = TestClient(backend_app.app)
    response = client.post(
        "/tts/synthesize",
        headers={"x-dev-uid": "local_admin"},
        json={
            "engine": "GEM",
            "text": "Gateway overload test.",
            "voice_id": "Fenrir",
        },
    )
    assert response.status_code == 503
    detail = response.json().get("detail") or {}
    assert detail.get("reason") == "queue_timeout"
    assert int(detail.get("queueDepth") or 0) == 12
    assert int(detail.get("retryAfterMs") or 0) == 1500


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


def test_tts_synthesize_normalizes_gem_capacity_errors_to_503(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeCapacityResponse(status_code=502))
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "local_admin"}

    response = client.post(
        "/tts/synthesize",
        headers=headers,
        json={
            "engine": "GEM",
            "text": "capacity mapping test",
            "voice_id": "Fenrir",
            "request_id": "req_capacity_1",
        },
    )
    assert response.status_code == 503
    payload = response.json()
    assert isinstance(payload.get("detail"), dict)
    assert payload["detail"].get("errorCode") == "GEMINI_KEY_POOL_OVERLOADED"
    assert int(payload["detail"].get("retryAfterMs") or 0) == 2200


def test_tts_synthesize_maps_gem_upstream_timeout_to_504(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(
        backend_app.requests,
        "post",
        lambda *args, **kwargs: _DummyRuntimeUpstreamTimeoutResponse(status_code=502),
    )
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "local_admin"}

    response = client.post(
        "/tts/synthesize",
        headers=headers,
        json={
            "engine": "GEM",
            "text": "timeout mapping test",
            "voice_id": "Fenrir",
            "request_id": "req_timeout_1",
        },
    )
    assert response.status_code == 504
    payload = response.json()
    assert isinstance(payload.get("detail"), dict)
    assert payload["detail"].get("errorCode") == "GEMINI_UPSTREAM_REQUEST_TIMEOUT"


def test_tts_synthesize_enforces_free_plan_success_limit(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeResponse())
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "burst_free_user"}
    payload = {
        "engine": "GEM",
        "text": "burst limit test",
        "voice_id": "Fenrir",
    }

    first = client.post("/tts/synthesize", headers=headers, json=payload)
    second = client.post("/tts/synthesize", headers=headers, json=payload)
    third = client.post("/tts/synthesize", headers=headers, json=payload)

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 429
    detail = third.json().get("detail") or {}
    assert detail.get("errorCode") == "RATE_LIMIT_USER"
    assert detail.get("reason") == "plan_success_limit_exceeded"
    assert detail.get("plan") == "Free"
    assert first.headers.get("x-ratelimit-success-limit") == "2"
    assert first.headers.get("x-ratelimit-success-remaining") == "1"
    assert second.headers.get("x-ratelimit-success-remaining") == "0"


def test_tts_synthesize_enforces_plan_char_limit(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "char_limit_user"}
    too_long_text = "a" * 8001
    response = client.post(
        "/tts/synthesize",
        headers=headers,
        json={
            "engine": "GEM",
            "text": too_long_text,
            "voice_id": "Fenrir",
        },
    )
    assert response.status_code == 400
    detail = response.json().get("detail") or {}
    assert detail.get("errorCode") == "VF_TTS_TEXT_TOO_LONG"
    assert int(detail.get("maxChars") or 0) == 8000


def test_tts_synthesize_enforces_pro_and_plus_success_limits(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeResponse())
    client = TestClient(backend_app.app)

    pro_uid = "burst_pro_user"
    plus_uid = "burst_plus_user"
    backend_app._write_entitlement(pro_uid, {"plan": "Pro"})
    backend_app._write_entitlement(plus_uid, {"plan": "Plus"})

    payload = {"engine": "GEM", "text": "burst plan test", "voice_id": "Fenrir"}

    for _ in range(5):
        assert client.post("/tts/synthesize", headers={"x-dev-uid": pro_uid}, json=payload).status_code == 200
    pro_blocked = client.post("/tts/synthesize", headers={"x-dev-uid": pro_uid}, json=payload)
    assert pro_blocked.status_code == 429
    assert (pro_blocked.json().get("detail") or {}).get("errorCode") == "RATE_LIMIT_USER"
    assert (pro_blocked.json().get("detail") or {}).get("plan") == "Pro"

    for _ in range(10):
        assert client.post("/tts/synthesize", headers={"x-dev-uid": plus_uid}, json=payload).status_code == 200
    plus_blocked = client.post("/tts/synthesize", headers={"x-dev-uid": plus_uid}, json=payload)
    assert plus_blocked.status_code == 429
    assert (plus_blocked.json().get("detail") or {}).get("errorCode") == "RATE_LIMIT_USER"
    assert (plus_blocked.json().get("detail") or {}).get("plan") == "Plus"


def test_tts_success_limit_does_not_count_failed_generation(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)

    calls = {"count": 0}

    def _runtime(*args, **kwargs):
        _ = args, kwargs
        calls["count"] += 1
        if calls["count"] == 2:
            return _DummyRuntimeCapacityResponse(status_code=500)
        return _DummyRuntimeResponse()

    monkeypatch.setattr(backend_app.requests, "post", _runtime)
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "success_only_user"}
    payload = {"engine": "GEM", "text": "success-only limit", "voice_id": "Fenrir"}

    first = client.post("/tts/synthesize", headers=headers, json=payload)
    failed = client.post("/tts/synthesize", headers=headers, json=payload)
    second_success = client.post("/tts/synthesize", headers=headers, json=payload)
    blocked = client.post("/tts/synthesize", headers=headers, json=payload)

    assert first.status_code == 200
    assert failed.status_code >= 500
    assert second_success.status_code == 200
    assert blocked.status_code == 429
    assert (blocked.json().get("detail") or {}).get("errorCode") == "RATE_LIMIT_USER"


def test_tts_success_limit_idempotency_key_does_not_double_count(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeResponse())
    client = TestClient(backend_app.app)
    uid = "idempotency_user"
    payload = {"engine": "GEM", "text": "idempotency success test", "voice_id": "Fenrir"}

    first = client.post("/tts/synthesize", headers={"x-dev-uid": uid, "Idempotency-Key": "idem-1"}, json=payload)
    second_same = client.post("/tts/synthesize", headers={"x-dev-uid": uid, "Idempotency-Key": "idem-1"}, json=payload)
    third = client.post("/tts/synthesize", headers={"x-dev-uid": uid, "Idempotency-Key": "idem-2"}, json=payload)
    blocked = client.post("/tts/synthesize", headers={"x-dev-uid": uid, "Idempotency-Key": "idem-3"}, json=payload)

    assert first.status_code == 200
    assert second_same.status_code == 200
    assert third.status_code == 200
    assert blocked.status_code == 429
    assert first.headers.get("x-ratelimit-success-remaining") == "1"
    assert second_same.headers.get("x-ratelimit-success-remaining") == "1"
    assert third.headers.get("x-ratelimit-success-remaining") == "0"


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
