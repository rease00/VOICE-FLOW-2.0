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
            "x-voiceflow-model": "gemini-2.5-flash-preview-tts",
            "x-voiceflow-speech-mode": "single-speaker",
            "x-voiceflow-diagnostics": "%7B%22keySelectionIndex%22%3A0%7D",
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


class _DummyRuntimeSensitiveErrorResponse:
    def __init__(self, status_code: int = 502) -> None:
        self.status_code = status_code
        self.content = b""
        self.headers = {
            "content-type": "application/json",
            "x-voiceflow-trace-id": "trace_sensitive_123",
        }
        self.text = (
            '{"detail":{"error":"Gemini model attempts failed.","errorCode":"GEMINI_UPSTREAM_MODEL_FAILED",'
            '"summary":"404 NOT_FOUND. {\\"error\\":{\\"message\\":\\"models/gemini-2.5-flash-preview-tts\\"}}",'
            '"retryAfterMs":1700,"trace_id":"trace_sensitive_123","speechModeRequested":"single-speaker",'
            '"keyAttempts":[{"keyFingerprint":"AIzaSyAA...ZZZZ"}],'
            '"modelAttempts":[{"model":"gemini-2.5-flash-preview-tts","error":"404 NOT_FOUND"}],'
            '"keyStates":[{"fingerprint":"abcd1234efgh","status":"auth_issue"}]}}'
        )

    @property
    def ok(self) -> bool:
        return False

    def json(self) -> dict:
        return {
            "detail": {
                "error": "Gemini model attempts failed.",
                "errorCode": "GEMINI_UPSTREAM_MODEL_FAILED",
                "summary": '404 NOT_FOUND. {"error":{"message":"models/gemini-2.5-flash-preview-tts"}}',
                "retryAfterMs": 1700,
                "trace_id": "trace_sensitive_123",
                "speechModeRequested": "single-speaker",
                "keyAttempts": [{"keyFingerprint": "AIzaSyAA...ZZZZ"}],
                "modelAttempts": [{"model": "gemini-2.5-flash-preview-tts", "error": "404 NOT_FOUND"}],
                "keyStates": [{"fingerprint": "abcd1234efgh", "status": "auth_issue"}],
            }
        }


def _make_key(seed: int) -> str:
    return f"AIza{seed:030d}"


def _assert_masked_pool_keys(config: dict[str, object], pool_name: str, expected_count: int) -> None:
    pools = config.get("pools")
    assert isinstance(pools, dict)
    pool_row = pools.get(pool_name)
    assert isinstance(pool_row, dict)
    keys = list(pool_row.get("keys") or [])
    assert len(keys) == expected_count
    assert all(str(item).startswith("__vf_masked_key__:") for item in keys)
    metadata = list(pool_row.get("keyMetadata") or [])
    assert len(metadata) == expected_count


def _reset_inmemory_state() -> None:
    backend_app._INMEMORY_ENTITLEMENTS.clear()
    backend_app._INMEMORY_USAGE_MONTHLY.clear()
    backend_app._INMEMORY_USAGE_DAILY.clear()
    backend_app._INMEMORY_USAGE_EVENTS.clear()
    backend_app._INMEMORY_USER_PROFILES.clear()
    backend_app._INMEMORY_USER_ID_INDEX.clear()
    backend_app._INMEMORY_STRIPE_CUSTOMERS.clear()
    backend_app._INMEMORY_WALLET_DAILY.clear()
    backend_app._INMEMORY_WALLET_TRANSACTIONS.clear()
    backend_app._INMEMORY_COUPONS.clear()
    backend_app._INMEMORY_COUPON_REDEMPTIONS.clear()
    backend_app._INMEMORY_GENERATION_HISTORY.clear()
    backend_app._INMEMORY_AUDIO_GENERATION_AUDIT.clear()
    backend_app._INMEMORY_DAILY_USAGE_RESET_STATUS.clear()
    backend_app._TTS_SUCCESS_LIMITER.clear_all_local_state()
    with backend_app._ADMIN_USAGE_LOCK:
        backend_app._ADMIN_USAGE_RECENT_EVENTS.clear()
        backend_app._ADMIN_USAGE_TOTALS.clear()


@pytest.fixture(autouse=True)
def _isolate_gemini_pool_config_file(monkeypatch, tmp_path: Path) -> None:
    pools_path = tmp_path / "gemini_api_pools.json"
    pools_path.write_text(
        json.dumps({"version": 1, "pools": {"free": {"keys": []}}}, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("GEMINI_API_POOLS_FILE", str(pools_path))


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
    backend_app._write_entitlement(uid, {"plan": "Pro"})
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
    assert item.get("voiceId") == "Fenrir"
    assert item.get("voiceName") == "Arjun India Male"
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


def test_generation_history_fetch_rewrites_legacy_rows_when_sanitized_content_changes(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    uid = "history_user_legacy_rewrite"
    now_ms = int(time.time() * 1000)
    legacy_item = {
        "id": "legacy_row_1",
        "timestamp": now_ms - 1_000,
        "status": "completed",
        "engine": "GEM",
        "voiceName": "AI Voice",
        "voiceId": "fenir",
        "chars": 11,
        "textPreview": "legacy text",
        "requestId": "legacy_req_1",
        "traceId": "legacy_trace_1",
    }
    backend_app._history_write_row(
        uid,
        {
            "uid": uid,
            "updatedAt": backend_app._safe_now_iso(),
            "itemCount": 1,
            "latestAtMs": now_ms - 1_000,
            "codec": backend_app.VF_GENERATION_HISTORY_CODEC,
            "itemsGzipB64": backend_app._history_encode_items_gzip_b64([legacy_item]),
        },
    )

    items = backend_app._history_get_items(uid, limit=10)
    assert len(items) == 1
    assert items[0]["id"] == "legacy_row_1"
    assert items[0]["voiceId"] == "Fenrir"
    assert items[0]["voiceName"] == "Arjun India Male"

    stored_row = backend_app._INMEMORY_GENERATION_HISTORY.get(uid) or {}
    stored_items = backend_app._history_decode_items_gzip_b64(str(stored_row.get("itemsGzipB64") or ""))
    assert len(stored_items) == 1
    assert stored_items[0]["voiceId"] == "Fenrir"
    assert stored_items[0]["voiceName"] == "Arjun India Male"


def test_tts_synthesize_writes_audio_metadata_record_on_success(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeResponse())
    client = TestClient(backend_app.app)
    uid = "audio_meta_user_success"
    backend_app._write_entitlement(uid, {"plan": "Pro"})

    response = client.post(
        "/tts/synthesize",
        headers={
            "x-dev-uid": uid,
            "x-forwarded-for": "198.51.100.24, 10.0.0.10",
        },
        json={
            "engine": "GEM",
            "text": "Audio metadata success coverage text.",
            "voice_id": "Fenrir",
            "request_id": "req_audio_meta_success",
        },
    )
    assert response.status_code == 200

    rows = list(backend_app._INMEMORY_AUDIO_GENERATION_AUDIT.values())
    assert len(rows) == 1
    record = rows[0]
    assert record["requestId"] == "req_audio_meta_success"
    assert record["jobId"] == "req_audio_meta_success"
    assert record["status"] == "completed"
    assert record["inputText"] == "Audio metadata success coverage text."
    assert record["sourceIp"] == "198.51.100.24"
    assert record["ipHash"] == backend_app._hash_sha256_hex("198.51.100.24")
    assert record["audioCreatedAt"]
    assert record["terminalAt"]
    assert record["paymentRef"] == ""


def test_tts_synthesize_validation_failure_writes_audio_metadata_record(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)

    response = client.post(
        "/tts/jobs",
        headers={"x-dev-uid": "audio_meta_user_failed"},
        json={"engine": "GEM", "text": "   ", "request_id": "req_audio_meta_failed"},
    )
    assert response.status_code == 400

    rows = list(backend_app._INMEMORY_AUDIO_GENERATION_AUDIT.values())
    assert len(rows) == 1
    record = rows[0]
    assert record["requestId"] == "req_audio_meta_failed"
    assert record["status"] == "failed"
    assert record["audioCreatedAt"] == ""
    assert record["failureCode"] == "http_400"
    assert "text is required" in str(record["failureDetail"] or "").lower()


def test_tts_synthesize_uses_wallet_payment_reference_fallback(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeResponse())
    client = TestClient(backend_app.app)
    uid = "audio_meta_wallet_user"
    backend_app._write_entitlement(uid, {"plan": "Pro", "subscriptionId": None, "latestInvoiceId": None})
    backend_app._INMEMORY_WALLET_TRANSACTIONS["wallet_tx_paid_1"] = {
        "id": "wallet_tx_paid_1",
        "uid": uid,
        "kind": "credit",
        "bucket": "paidVF",
        "amount": 150000,
        "reason": "stripe_token_pack",
        "metadata": {
            "provider": "stripe",
            "paymentIntentId": "pi_audio_meta_123",
            "invoiceId": "in_audio_meta_123",
        },
        "createdAt": backend_app._utc_now().isoformat(),
    }

    response = client.post(
        "/tts/synthesize",
        headers={"x-dev-uid": uid},
        json={
            "engine": "GEM",
            "text": "Wallet fallback coverage text.",
            "request_id": "req_audio_meta_wallet",
        },
    )
    assert response.status_code == 200

    rows = list(backend_app._INMEMORY_AUDIO_GENERATION_AUDIT.values())
    assert len(rows) == 1
    record = rows[0]
    assert record["paymentRefType"] == "payment_intent"
    assert record["paymentRef"] == "pi_audio_meta_123"


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

    _assert_masked_pool_keys(payload["config"], "free", 2)
    assert set((payload["config"].get("pools") or {}).keys()) == {"free"}
    assert payload["config"]["planPools"] == {"free": "free", "pro": "free", "plus": "free"}
    assert payload["sourcePolicy"]["freePoolLocked"] is True
    assert str(payload["sourcePolicy"]["freePoolMode"] or "").strip().lower() == "api_file_authoritative"
    assert any("Single-pool mode" in str(item) for item in list(payload.get("warnings") or []))

    persisted = json.loads(pools_path.read_text(encoding="utf-8"))
    persisted_keys = list((persisted.get("pools") or {}).get("free", {}).get("keys") or [])
    assert len(persisted_keys) == 2
    assert all(str(item).startswith("__vf_masked_key__:") for item in persisted_keys)
    persisted_text = pools_path.read_text(encoding="utf-8")
    assert free_a not in persisted_text
    assert free_b not in persisted_text


def test_admin_gemini_pools_rotate_persists_authoritative_file_order(monkeypatch, tmp_path: Path) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "GEMINI_API_POOLS_PREFER_FIRESTORE", False)

    free_a = _make_key(104)
    free_b = _make_key(105)
    free_c = _make_key(106)
    keys_path = tmp_path / "API.txt"
    keys_path.write_text(f"{free_a}\n{free_b}\n{free_c}\n", encoding="utf-8")
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
    monkeypatch.setattr(
        backend_app,
        "_runtime_gemini_pool_reload",
        lambda: {"ok": True, "reloaded": True},
    )
    monkeypatch.setattr(
        backend_app,
        "_runtime_gemini_pool_snapshot",
        lambda: {"ok": True, "pool": {"keyCount": 3}},
    )

    client = TestClient(backend_app.app)
    warm = client.get("/admin/gemini/pools", headers={"x-dev-uid": "local_admin"})
    assert warm.status_code == 200

    rotated = client.post(
        "/admin/gemini/pools/rotate",
        headers={"x-dev-uid": "local_admin"},
        json={"steps": 1},
    )
    assert rotated.status_code == 200
    payload = rotated.json()
    assert payload["ok"] is True
    assert payload["rotation"]["storageMode"] == "api_file_authoritative"
    assert int(payload["rotation"]["stepsApplied"]) == 1
    assert payload["rotation"]["beforeHead"]["fingerprint"] != payload["rotation"]["afterHead"]["fingerprint"]
    _assert_masked_pool_keys(payload["config"], "free", 3)

    rotated_keys = backend_app._read_gemini_keys_from_file(str(keys_path))
    assert rotated_keys == [free_b, free_c, free_a]

    backend_app._GEMINI_POOLS_CACHE = None
    backend_app._GEMINI_POOLS_META = {}
    refreshed = client.get("/admin/gemini/pools", headers={"x-dev-uid": "local_admin"})
    assert refreshed.status_code == 200
    refreshed_payload = refreshed.json()
    _assert_masked_pool_keys(refreshed_payload["config"], "free", 3)
    key_metadata = list(((refreshed_payload["config"].get("pools") or {}).get("free") or {}).get("keyMetadata") or [])
    assert key_metadata
    assert str(key_metadata[0].get("fingerprint") or "") == backend_app._gemini_key_fingerprint(free_b)


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
    _assert_masked_pool_keys(payload["config"], "free", 1)
    assert set((payload["config"].get("pools") or {}).keys()) == {"free"}
    assert "single_pool_enforced:free" in list(payload.get("appliedOverrides") or [])


def test_admin_gemini_pools_persists_tts_model_fallback_toggle(monkeypatch, tmp_path: Path) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "GEMINI_API_POOLS_PREFER_FIRESTORE", False)

    free_key = _make_key(131)
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
    warm = client.get("/admin/gemini/pools", headers={"x-dev-uid": "local_admin"})
    assert warm.status_code == 200
    assert warm.json()["sourcePolicy"]["ttsModelFallbackEnabled"] is True

    update = client.put(
        "/admin/gemini/pools",
        headers={"x-dev-uid": "local_admin"},
        json={
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
            "sourcePolicy": {
                "ttsModelFallbackEnabled": True,
            },
        },
    )
    assert update.status_code == 200
    payload = update.json()
    assert payload["sourcePolicy"]["ttsModelFallbackEnabled"] is True
    assert payload["config"]["sourcePolicy"]["ttsModelFallbackEnabled"] is True

    backend_app._GEMINI_POOLS_CACHE = None
    backend_app._GEMINI_POOLS_META = {}
    refreshed = client.get("/admin/gemini/pools", headers={"x-dev-uid": "local_admin"})
    assert refreshed.status_code == 200
    assert refreshed.json()["sourcePolicy"]["ttsModelFallbackEnabled"] is True

    persisted = json.loads(pools_path.read_text(encoding="utf-8"))
    assert bool((persisted.get("sourcePolicy") or {}).get("ttsModelFallbackEnabled")) is True


def test_admin_gemini_pools_persists_vertex_access_token_reference(monkeypatch, tmp_path: Path) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "GEMINI_API_POOLS_PREFER_FIRESTORE", False)

    free_key = _make_key(133)
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
    vertex_token_path = tmp_path / "vertex-access-token.txt"
    monkeypatch.setenv("GEMINI_API_KEYS_FILE", str(keys_path))
    monkeypatch.setenv("GEMINI_API_POOLS_FILE", str(pools_path))
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "voiceflow-000f")
    monkeypatch.setattr(backend_app, "GEMINI_VERTEX_ACCESS_TOKEN_FILE", str(vertex_token_path), raising=False)
    backend_app._GEMINI_POOLS_CACHE = None
    backend_app._GEMINI_POOLS_META = {}
    monkeypatch.setattr(backend_app, "_runtime_gemini_pool_reload", lambda: {"ok": True})
    monkeypatch.setattr(backend_app, "_runtime_gemini_pool_snapshot", lambda: {"ok": True, "pool": {"keyCount": 0}})

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
            },
            "fallbackChains": {
                "free": ["free"],
                "pro": ["pro", "free"],
                "pro_plus": ["pro_plus", "pro", "free"],
            },
            "constraints": {"uniqueKeyMembership": True},
            "sourcePolicy": {
                "provider": "vertex",
                "vertexAccessToken": "AQ.test.vertex.token",
            },
        },
    )
    assert update.status_code == 200
    payload = update.json()
    assert payload["sourcePolicy"]["provider"] == "vertex"
    assert payload["sourcePolicy"]["vertexAccessTokenConfigured"] is True
    assert payload["sourcePolicy"]["freePoolLocked"] is False
    assert payload["sourcePolicy"].get("vertexAccessToken") is None
    assert str(payload["sourcePolicy"].get("vertexProject") or "").strip() == "voiceflow-000f"
    assert vertex_token_path.exists()
    assert vertex_token_path.read_text(encoding="utf-8").strip() == "AQ.test.vertex.token"
    assert str(payload["sourcePolicy"]["vertexAccessTokenRef"] or "").strip() == str(vertex_token_path)

    persisted = json.loads(pools_path.read_text(encoding="utf-8"))
    persisted_policy = persisted.get("sourcePolicy") or {}
    assert str(persisted_policy.get("vertexAccessTokenRef") or "").strip() == str(vertex_token_path)
    assert str(persisted_policy.get("provider") or "").strip() == "vertex"


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
    _assert_masked_pool_keys(initial.json()["config"], "free", 1)

    keys_path.unlink()

    reloaded = client.post("/admin/gemini/pools/reload", headers={"x-dev-uid": "local_admin"})
    assert reloaded.status_code == 200
    warnings = list(reloaded.json().get("warnings") or [])
    assert warnings

    refreshed = client.get("/admin/gemini/pools", headers={"x-dev-uid": "local_admin"})
    assert refreshed.status_code == 200
    payload = refreshed.json()
    _assert_masked_pool_keys(payload["config"], "free", 1)
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
    assert payload["config"]["planPools"] == {"free": "free", "pro": "free", "plus": "free"}
    assert payload["config"]["defaultFallbackChain"] == ["free"]
    _assert_masked_pool_keys(payload["config"], "free", 1)
    assert set((payload["config"].get("pools") or {}).keys()) == {"free"}

    refreshed = client.get("/admin/gemini/pools", headers={"x-dev-uid": "local_admin"})
    assert refreshed.status_code == 200
    _assert_masked_pool_keys(refreshed.json()["config"], "free", 1)


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
    assert "free" in payload["config"]["pools"]
    _assert_masked_pool_keys(payload["config"], "free", 1)
    assert payload["sourcePolicy"]["freePoolLocked"] is False
    assert str(payload["sourcePolicy"]["freePoolMode"] or "").strip().lower() == "config_managed"

    backend_app._GEMINI_POOLS_CACHE = None
    backend_app._GEMINI_POOLS_META = {}
    after = client.get("/admin/gemini/pools", headers={"x-dev-uid": "local_admin"})
    assert after.status_code == 200
    _assert_masked_pool_keys(after.json()["config"], "free", 1)


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
    assert payload["validation"]["missingPlanPools"] == {}
    assert payload["config"]["planPools"] == {"free": "free", "pro": "free", "plus": "free"}
    keys = backend_app._resolve_gemini_plan_key_pool("plus")
    assert free_key in keys
    assert pro_key not in keys


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


def test_tts_synthesize_forwards_runtime_metadata_headers(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeResponse())
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "local_admin"}

    response = client.post(
        "/tts/synthesize",
        headers=headers,
        json={
            "engine": "GEM",
            "text": "Header forward test.",
            "voice_id": "Fenrir",
            "request_id": "req_header_forward_1",
        },
    )

    assert response.status_code == 200
    assert response.headers.get("x-voiceflow-trace-id") == "trace_test_123"
    assert response.headers.get("x-voiceflow-model") == "gemini-2.5-flash-preview-tts"
    assert response.headers.get("x-voiceflow-speech-mode") == "single-speaker"
    assert response.headers.get("x-voiceflow-diagnostics") == "%7B%22keySelectionIndex%22%3A0%7D"


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


def test_tts_synthesize_redacts_runtime_key_pool_internals_from_error_detail(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(
        backend_app.requests,
        "post",
        lambda *args, **kwargs: _DummyRuntimeSensitiveErrorResponse(status_code=502),
    )
    client = TestClient(backend_app.app)

    response = client.post(
        "/tts/synthesize",
        headers={"x-dev-uid": "local_admin"},
        json={
            "engine": "GEM",
            "text": "sanitize sensitive runtime detail",
            "voice_id": "Fenrir",
            "request_id": "req_sensitive_1",
        },
    )

    assert response.status_code == 502
    detail = response.json()["detail"]
    assert detail.get("errorCode") == "GEMINI_UPSTREAM_MODEL_FAILED"
    assert detail.get("trace_id") == "trace_sensitive_123"
    assert "keyStates" not in detail
    assert "keyAttempts" not in detail
    assert "modelAttempts" not in detail
    assert "AIza" not in json.dumps(detail)
    assert "404 NOT_FOUND" not in str(detail.get("summary") or "")


def test_tts_synthesize_enforces_free_plan_success_limit(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeResponse())
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "burst_free_user"}
    payload = {
        "engine": "NEURAL2",
        "text": "burst limit test",
        "voice_id": "v2",
    }

    free_limit = max(1, int(getattr(backend_app, "VF_TTS_SUCCESS_LIMIT_FREE", 2) or 2))
    responses = [client.post("/tts/synthesize", headers=headers, json=payload) for _ in range(free_limit)]
    blocked = client.post("/tts/synthesize", headers=headers, json=payload)

    assert all(resp.status_code == 200 for resp in responses)
    assert blocked.status_code == 429
    detail = blocked.json().get("detail") or {}
    assert detail.get("errorCode") == "RATE_LIMIT_USER"
    assert detail.get("reason") == "plan_success_limit_exceeded"
    assert detail.get("plan") == "Free"
    assert responses[0].headers.get("x-ratelimit-success-limit") == str(free_limit)
    assert responses[0].headers.get("x-ratelimit-success-remaining") == str(max(0, free_limit - 1))
    assert responses[-1].headers.get("x-ratelimit-success-remaining") == "0"


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
            "engine": "NEURAL2",
            "text": too_long_text,
            "voice_id": "v2",
        },
    )
    assert response.status_code == 400
    detail = response.json().get("detail") or {}
    assert detail.get("errorCode") == "VF_TTS_TEXT_TOO_LONG"
    assert int(detail.get("maxChars") or 0) == 8000


def test_tts_synthesize_enforces_pro_and_scale_success_limits(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeResponse())
    client = TestClient(backend_app.app)

    pro_uid = "burst_pro_user"
    plus_uid = "burst_plus_user"
    backend_app._write_entitlement(pro_uid, {"plan": "Pro"})
    backend_app._write_entitlement(plus_uid, {"plan": "Plus"})

    payload = {"engine": "GEM", "text": "burst plan test", "voice_id": "Fenrir"}
    pro_limit = max(1, int(getattr(backend_app, "VF_TTS_SUCCESS_LIMIT_PRO", 5) or 5))
    scale_limit = max(1, int(getattr(backend_app, "VF_TTS_SUCCESS_LIMIT_SCALE", 10) or 10))
    assert int((backend_app.TTS_PLAN_GUARDRAILS.get("pro") or {}).get("rpm") or 0) == 5
    assert int((backend_app.TTS_PLAN_GUARDRAILS.get("scale") or {}).get("rpm") or 0) == 10
    assert int((backend_app.TTS_PLAN_GUARDRAILS.get("starter") or {}).get("rpm") or 0) == 5
    assert int((backend_app.TTS_PLAN_GUARDRAILS.get("creator") or {}).get("rpm") or 0) == 5

    pro_responses = [client.post("/tts/synthesize", headers={"x-dev-uid": pro_uid}, json=payload) for _ in range(pro_limit)]
    pro_blocked = client.post("/tts/synthesize", headers={"x-dev-uid": pro_uid}, json=payload)
    assert all(resp.status_code == 200 for resp in pro_responses)
    assert pro_blocked.status_code == 429
    pro_detail = pro_blocked.json().get("detail") or {}
    assert pro_detail.get("errorCode") == "RATE_LIMIT_USER"
    assert pro_detail.get("plan") == "Pro"
    assert pro_responses[0].headers.get("x-ratelimit-success-limit") == str(pro_limit)
    assert pro_responses[0].headers.get("x-ratelimit-success-remaining") == str(max(0, pro_limit - 1))
    assert pro_responses[-1].headers.get("x-ratelimit-success-remaining") == "0"

    scale_responses = [client.post("/tts/synthesize", headers={"x-dev-uid": plus_uid}, json=payload) for _ in range(scale_limit)]
    plus_blocked = client.post("/tts/synthesize", headers={"x-dev-uid": plus_uid}, json=payload)
    assert all(resp.status_code == 200 for resp in scale_responses)
    assert plus_blocked.status_code == 429
    plus_detail = plus_blocked.json().get("detail") or {}
    assert plus_detail.get("errorCode") == "RATE_LIMIT_USER"
    assert plus_detail.get("plan") == "Scale"
    assert scale_responses[0].headers.get("x-ratelimit-success-limit") == str(scale_limit)
    assert scale_responses[0].headers.get("x-ratelimit-success-remaining") == str(max(0, scale_limit - 1))
    assert scale_responses[-1].headers.get("x-ratelimit-success-remaining") == "0"


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
    payload = {"engine": "NEURAL2", "text": "success-only limit", "voice_id": "v2"}

    first = client.post("/tts/synthesize", headers=headers, json=payload)
    failed = client.post("/tts/synthesize", headers=headers, json=payload)
    free_limit = max(1, int(getattr(backend_app, "VF_TTS_SUCCESS_LIMIT_FREE", 2) or 2))
    additional_successes = [
        client.post("/tts/synthesize", headers=headers, json=payload)
        for _ in range(max(0, free_limit - 1))
    ]
    blocked = client.post("/tts/synthesize", headers=headers, json=payload)

    assert first.status_code == 200
    assert failed.status_code >= 500
    assert all(resp.status_code == 200 for resp in additional_successes)
    assert blocked.status_code == 429
    assert (blocked.json().get("detail") or {}).get("errorCode") == "RATE_LIMIT_USER"


def test_tts_success_limit_idempotency_key_does_not_double_count(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeResponse())
    client = TestClient(backend_app.app)
    uid = "idempotency_user"
    payload = {"engine": "NEURAL2", "text": "idempotency success test", "voice_id": "v2"}

    free_limit = max(2, int(getattr(backend_app, "VF_TTS_SUCCESS_LIMIT_FREE", 2) or 2))
    first = client.post("/tts/synthesize", headers={"x-dev-uid": uid, "Idempotency-Key": "idem-1"}, json=payload)
    second_same = client.post("/tts/synthesize", headers={"x-dev-uid": uid, "Idempotency-Key": "idem-1"}, json=payload)
    extra_unique = [
        client.post("/tts/synthesize", headers={"x-dev-uid": uid, "Idempotency-Key": f"idem-{idx}"}, json=payload)
        for idx in range(2, free_limit + 1)
    ]
    blocked = client.post(
        "/tts/synthesize",
        headers={"x-dev-uid": uid, "Idempotency-Key": f"idem-{free_limit + 1}"},
        json=payload,
    )

    assert first.status_code == 200
    assert second_same.status_code == 200
    assert all(resp.status_code == 200 for resp in extra_unique)
    assert blocked.status_code == 429
    assert first.headers.get("x-ratelimit-success-remaining") == str(max(0, free_limit - 1))
    assert second_same.headers.get("x-ratelimit-success-remaining") == str(max(0, free_limit - 1))
    assert extra_unique[-1].headers.get("x-ratelimit-success-remaining") == "0"


def test_tts_synthesize_rejects_cross_user_request_id_collision(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_resolve_request_user_id", lambda _request, uid: f"{uid}_id")
    monkeypatch.setattr(backend_app, "_require_user_id_ready", lambda _request, uid: {"uid": uid, "userId": f"{uid}_id"})
    monkeypatch.setattr(backend_app.requests, "post", lambda *args, **kwargs: _DummyRuntimeResponse())
    client = TestClient(backend_app.app)
    shared_request_id = "req_cross_user_collision_1"

    first = client.post(
        "/tts/synthesize?wait_ms=0",
        headers={"x-dev-uid": "collision_user_a"},
        json={
            "engine": "NEURAL2",
            "text": "first tenant payload",
            "voice_id": "v2",
            "request_id": shared_request_id,
        },
    )
    assert first.status_code == 202
    first_payload = first.json()
    assert first_payload.get("jobId") == shared_request_id

    second = client.post(
        "/tts/synthesize?wait_ms=0",
        headers={"x-dev-uid": "collision_user_b"},
        json={
            "engine": "NEURAL2",
            "text": "second tenant payload",
            "voice_id": "v2",
            "request_id": shared_request_id,
        },
    )
    assert second.status_code == 409
    detail = second.json().get("detail") or {}
    assert detail.get("errorCode") == backend_app.REQUEST_ID_CONFLICT
    assert detail.get("reason") == "request_id_owner_conflict"
    assert detail.get("jobId") == shared_request_id

    usage_key = f"collision_user_b_{shared_request_id}"
    usage_event = backend_app._INMEMORY_USAGE_EVENTS.get(usage_key) or {}
    assert usage_event.get("status") == "reverted"
    assert str(usage_event.get("error") or "") == "request_id_owner_conflict"


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


def test_admin_cleanup_entitlements_daily_generation_limit_requires_admin(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)
    denied = client.post("/admin/entitlements/cleanup-daily-generation-limit", headers={"x-dev-uid": "plain_user"})
    assert denied.status_code == 403


def test_admin_cleanup_entitlements_daily_generation_limit_dryrun_then_execute(monkeypatch) -> None:
    _reset_inmemory_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "local_admin"}

    backend_app._INMEMORY_ENTITLEMENTS["legacy_a"] = {
        **backend_app._default_entitlement("legacy_a"),
        "dailyGenerationLimit": 30,
    }
    backend_app._INMEMORY_ENTITLEMENTS["legacy_b"] = {
        **backend_app._default_entitlement("legacy_b"),
        "dailyGenerationLimit": 15,
    }
    backend_app._INMEMORY_ENTITLEMENTS["clean_user"] = {
        **backend_app._default_entitlement("clean_user"),
    }

    dry = client.post("/admin/entitlements/cleanup-daily-generation-limit?dryRun=1", headers=headers)
    assert dry.status_code == 200
    dry_payload = dry.json()
    assert dry_payload["dryRun"] is True
    assert dry_payload["docsWithLegacyField"] == 2
    assert dry_payload["docsCleared"] == 0
    assert "dailyGenerationLimit" in backend_app._INMEMORY_ENTITLEMENTS["legacy_a"]
    assert "dailyGenerationLimit" in backend_app._INMEMORY_ENTITLEMENTS["legacy_b"]

    run = client.post("/admin/entitlements/cleanup-daily-generation-limit", headers=headers)
    assert run.status_code == 200
    run_payload = run.json()
    assert run_payload["dryRun"] is False
    assert run_payload["docsWithLegacyField"] == 2
    assert run_payload["docsCleared"] == 2
    assert "dailyGenerationLimit" not in backend_app._INMEMORY_ENTITLEMENTS["legacy_a"]
    assert "dailyGenerationLimit" not in backend_app._INMEMORY_ENTITLEMENTS["legacy_b"]
