from __future__ import annotations

import importlib.util
import json
import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

from shared.gemini_allocator import AllocatorConfig, GeminiRateAllocator, ModelLimit


def _load_gemini_runtime_module():
    workspace_root = Path(__file__).resolve().parents[1]
    runtime_dir = workspace_root / "engines" / "gemini-runtime"
    module_path = runtime_dir / "app.py"
    if str(workspace_root) not in sys.path:
        sys.path.insert(0, str(workspace_root))
    if str(runtime_dir) not in sys.path:
        sys.path.insert(0, str(runtime_dir))
    spec = importlib.util.spec_from_file_location("gemini_runtime_app", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _make_key(seed: int) -> str:
    return f"AIza{seed:030d}"


def test_parse_api_keys_dedupes_and_filters_invalid_tokens() -> None:
    runtime = _load_gemini_runtime_module()
    keys = runtime.parse_api_keys(
        "invalid,\n"
        "AIzaSyB8W3FmHkAsisibeWy9BIBDjPTnxfV8OgA,\n"
        "AIzaSyB8W3FmHkAsisibeWy9BIBDjPTnxfV8OgA,\n"
        "AIzaSySHORT"
    )
    assert keys == ["AIzaSyB8W3FmHkAsisibeWy9BIBDjPTnxfV8OgA"]


def test_runtime_routes_follow_locked_policy() -> None:
    runtime = _load_gemini_runtime_module()
    assert runtime.resolve_tts_model_candidates() == ["gemini-2.5-flash-preview-tts"]
    assert runtime.resolve_text_model_candidates() == [
        "gemini-2.5-flash",
        "gemini-3-flash",
        "gemini-2.5-flash-lite",
        "gemma-3-27b",
        "gemma-3-12b",
        "gemma-3-4b",
        "gemma-3-2b",
        "gemma-3-1b",
    ]
    assert runtime._RUNTIME_ALLOCATOR.route_models("ocr") == [
        "gemini-2.5-flash",
        "gemini-3-flash",
        "gemini-2.5-flash-lite",
    ]


def test_allocator_respects_per_model_rpm() -> None:
    runtime = _load_gemini_runtime_module()
    allocator = GeminiRateAllocator(runtime.ALLOCATOR_CONFIG, wait_slice_ms=100)
    key_pool = [_make_key(1)]
    tts_model = runtime.ALLOCATOR_CONFIG.routes["tts"][0]

    for _ in range(3):
        acquired = allocator.acquire_for_models(
            model_candidates=[tts_model],
            key_pool=key_pool,
            requested_tokens=1,
            wait_timeout_ms=1000,
        )
        assert acquired.lease is not None
        allocator.release(acquired.lease, success=True, used_tokens=1)

    blocked = allocator.acquire_for_models(
        model_candidates=[tts_model],
        key_pool=key_pool,
        requested_tokens=1,
        wait_timeout_ms=1000,
    )
    assert blocked.lease is None
    assert blocked.timed_out is True
    assert blocked.retry_after_ms > 0


def test_allocator_respects_per_model_tpm() -> None:
    runtime = _load_gemini_runtime_module()
    allocator = GeminiRateAllocator(runtime.ALLOCATOR_CONFIG, wait_slice_ms=100)
    key_pool = [_make_key(2)]
    tts_model = runtime.ALLOCATOR_CONFIG.routes["tts"][0]

    first = allocator.acquire_for_models(
        model_candidates=[tts_model],
        key_pool=key_pool,
        requested_tokens=6000,
        wait_timeout_ms=1000,
    )
    assert first.lease is not None
    allocator.release(first.lease, success=True, used_tokens=6000)

    second = allocator.acquire_for_models(
        model_candidates=[tts_model],
        key_pool=key_pool,
        requested_tokens=5000,
        wait_timeout_ms=1000,
    )
    assert second.lease is None
    assert second.timed_out is True
    assert second.retry_after_ms > 0


def test_allocator_waits_and_succeeds_when_window_resets() -> None:
    model_id = "test-flash"
    config = AllocatorConfig(
        version="test",
        window_seconds=1,
        default_wait_timeout_ms=3000,
        models={
            model_id: ModelLimit(
                model_id=model_id,
                rpm=1,
                tpm=100,
                enabled_for=frozenset({"tts", "text", "ocr"}),
            )
        },
        routes={"tts": [model_id], "text": [model_id], "ocr": [model_id]},
    )
    allocator = GeminiRateAllocator(config, wait_slice_ms=100)
    key_pool = [_make_key(3)]

    first = allocator.acquire_for_task(
        task="text",
        key_pool=key_pool,
        requested_tokens=10,
        wait_timeout_ms=1000,
    )
    assert first.lease is not None
    allocator.release(first.lease, success=True, used_tokens=10)

    started_ms = int(time.time() * 1000)
    second = allocator.acquire_for_task(
        task="text",
        key_pool=key_pool,
        requested_tokens=10,
        wait_timeout_ms=2500,
    )
    elapsed_ms = int(time.time() * 1000) - started_ms
    assert second.lease is not None
    assert second.timed_out is False
    assert second.waited_ms >= 700 or elapsed_ms >= 700
    allocator.release(second.lease, success=True, used_tokens=10)


def test_generate_text_quality_first_model_fallback_order() -> None:
    runtime = _load_gemini_runtime_module()
    key = _make_key(4)

    original_allocator = runtime._RUNTIME_ALLOCATOR
    original_pool = runtime._SERVER_API_KEY_POOL
    original_pool_set = runtime._SERVER_API_KEY_SET
    original_genai = runtime.genai
    original_types = runtime.types

    call_order: list[str] = []
    fail_models = set(runtime.resolve_text_model_candidates()[:2])

    class _DummyModels:
        def __init__(self, _api_key: str) -> None:
            self._api_key = _api_key

        def generate_content(self, **kwargs: object) -> object:
            model = str(kwargs.get("model") or "")
            call_order.append(model)
            if model in fail_models:
                raise RuntimeError(f"{model} temporary upstream failure")
            return type("_Resp", (), {"text": "ok"})()

    class _DummyClient:
        def __init__(self, api_key: str, http_options: object | None = None) -> None:
            self.api_key = api_key
            self.http_options = http_options
            self.models = _DummyModels(api_key)

    class _DummyGenai:
        Client = _DummyClient

    class _DummyTypes:
        class HttpOptions:
            def __init__(self, timeout: int) -> None:
                self.timeout = timeout

        class GenerateContentConfig:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

    try:
        runtime._RUNTIME_ALLOCATOR = GeminiRateAllocator(runtime.ALLOCATOR_CONFIG, wait_slice_ms=100)
        runtime._SERVER_API_KEY_POOL = (key,)
        runtime._SERVER_API_KEY_SET = frozenset({key})
        runtime.genai = _DummyGenai
        runtime.types = _DummyTypes

        response = runtime.generate_text(runtime.TextGenerateRequest(userPrompt="hello"))
        assert response.status_code == 200
        payload = json.loads(response.body.decode("utf-8"))
        assert payload["ok"] is True
        expected_prefix = runtime.resolve_text_model_candidates()[:3]
        assert call_order[:3] == expected_prefix
        assert payload["model"] == expected_prefix[2]
    finally:
        runtime._RUNTIME_ALLOCATOR = original_allocator
        runtime._SERVER_API_KEY_POOL = original_pool
        runtime._SERVER_API_KEY_SET = original_pool_set
        runtime.genai = original_genai
        runtime.types = original_types


def test_admin_api_pool_exposes_model_level_usage() -> None:
    runtime = _load_gemini_runtime_module()
    key = _make_key(5)

    original_allocator = runtime._RUNTIME_ALLOCATOR
    original_pool = runtime._SERVER_API_KEY_POOL
    original_pool_set = runtime._SERVER_API_KEY_SET

    try:
        runtime._RUNTIME_ALLOCATOR = GeminiRateAllocator(runtime.ALLOCATOR_CONFIG, wait_slice_ms=100)
        runtime._SERVER_API_KEY_POOL = (key,)
        runtime._SERVER_API_KEY_SET = frozenset({key})
        runtime._RUNTIME_ALLOCATOR.ensure_keys([key])
        lease_result = runtime._RUNTIME_ALLOCATOR.acquire_for_task(
            task="text",
            key_pool=[key],
            requested_tokens=20,
            wait_timeout_ms=1000,
        )
        assert lease_result.lease is not None
        runtime._RUNTIME_ALLOCATOR.release(lease_result.lease, success=True, used_tokens=20)

        client = TestClient(runtime.app)
        response = client.get("/v1/admin/api-pool")
        assert response.status_code == 200
        payload = response.json()
        assert payload["ok"] is True
        assert isinstance(payload.get("models"), list)
        assert len(payload["models"]) > 0
        first_model = payload["models"][0]
        assert "usage" in first_model
        assert "pool" in first_model
        assert "model" in first_model
    finally:
        runtime._RUNTIME_ALLOCATOR = original_allocator
        runtime._SERVER_API_KEY_POOL = original_pool
        runtime._SERVER_API_KEY_SET = original_pool_set


def test_admin_api_pool_reload_refreshes_keys_from_file(monkeypatch, tmp_path: Path) -> None:
    key1 = _make_key(21)
    key2 = _make_key(22)
    key_file = tmp_path / "runtime_keys.txt"
    key_file.write_text(f"{key1}\n", encoding="utf-8")

    monkeypatch.setenv("GEMINI_API_KEYS", "")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("GEMINI_API_KEYS_FILE", str(key_file))
    runtime = _load_gemini_runtime_module()
    client = TestClient(runtime.app)

    initial = client.get("/v1/admin/api-pool")
    assert initial.status_code == 200
    initial_payload = initial.json()
    assert int(initial_payload.get("pool", {}).get("keyCount", 0)) == 1
    assert str(initial_payload.get("configuredKeyFilePath") or "").strip() == str(key_file)
    assert str(initial_payload.get("keyFilePath") or "").strip() == str(key_file)

    key_file.write_text(f"{key1}\n{key2}\n", encoding="utf-8")
    reloaded = client.post("/v1/admin/api-pool/reload")
    assert reloaded.status_code == 200
    reload_payload = reloaded.json()
    assert reload_payload.get("ok") is True
    assert int(reload_payload.get("keyPoolSize", 0)) == 2
    assert str(reload_payload.get("configuredKeyFilePath") or "").strip() == str(key_file)
    assert str(reload_payload.get("keyFilePath") or "").strip() == str(key_file)

    latest = client.get("/v1/admin/api-pool")
    assert latest.status_code == 200
    latest_payload = latest.json()
    assert int(latest_payload.get("pool", {}).get("keyCount", 0)) == 2


def test_lazy_pool_self_heal_before_missing_error(monkeypatch) -> None:
    runtime = _load_gemini_runtime_module()
    key = _make_key(33)

    original_pool = runtime._SERVER_API_KEY_POOL
    original_pool_set = runtime._SERVER_API_KEY_SET
    original_genai = runtime.genai
    original_types = runtime.types

    class _DummyModels:
        def generate_content(self, **kwargs: object) -> object:
            return type("_Resp", (), {"text": "ok"})()

    class _DummyClient:
        def __init__(self, api_key: str, http_options: object | None = None) -> None:
            self.api_key = api_key
            self.http_options = http_options
            self.models = _DummyModels()

    class _DummyGenai:
        Client = _DummyClient

    class _DummyTypes:
        class HttpOptions:
            def __init__(self, timeout: int) -> None:
                self.timeout = timeout

        class GenerateContentConfig:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

    def _fake_refresh() -> tuple[str, ...]:
        runtime._SERVER_API_KEY_POOL = (key,)
        runtime._SERVER_API_KEY_SET = frozenset({key})
        return (key,)

    try:
        runtime._SERVER_API_KEY_POOL = tuple()
        runtime._SERVER_API_KEY_SET = frozenset()
        runtime.genai = _DummyGenai
        runtime.types = _DummyTypes
        monkeypatch.setattr(runtime, "_refresh_server_api_key_pool", _fake_refresh)
        _, _, effective = runtime._ensure_runtime_pool_or_raise(trace_id="lazy_self_heal_test", api_key=None)
        assert effective == [key]
    finally:
        runtime._SERVER_API_KEY_POOL = original_pool
        runtime._SERVER_API_KEY_SET = original_pool_set
        runtime.genai = original_genai
        runtime.types = original_types
