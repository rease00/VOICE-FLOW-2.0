from __future__ import annotations

import importlib.util
import json
import sys
import threading
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
    fake_valid_key = "AIza" + ("Z" * 35)
    keys = runtime.parse_api_keys(
        "invalid,\n"
        f"{fake_valid_key},\n"
        f"{fake_valid_key},\n"
        "AIzaSySHORT"
    )
    assert keys == [fake_valid_key]


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
    rpm_limit = int(runtime.ALLOCATOR_CONFIG.models[tts_model].rpm)

    for _ in range(rpm_limit):
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
    tpm_limit = int(runtime.ALLOCATOR_CONFIG.models[tts_model].tpm)
    first_tokens = max(1, int(tpm_limit * 0.7))
    second_tokens = max(1, int(tpm_limit * 0.4))

    first = allocator.acquire_for_models(
        model_candidates=[tts_model],
        key_pool=key_pool,
        requested_tokens=first_tokens,
        wait_timeout_ms=1000,
    )
    assert first.lease is not None
    allocator.release(first.lease, success=True, used_tokens=first_tokens)

    second = allocator.acquire_for_models(
        model_candidates=[tts_model],
        key_pool=key_pool,
        requested_tokens=second_tokens,
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


def test_admin_api_pools_syncs_authoritative_free_pool(monkeypatch, tmp_path: Path) -> None:
    free_a = _make_key(24)
    free_b = _make_key(25)
    pro_key = _make_key(26)
    key_file = tmp_path / "runtime_api.txt"
    key_file.write_text(f"{free_a}\n{free_b}\n", encoding="utf-8")
    pools_file = tmp_path / "runtime_pools.json"
    pools_file.write_text(
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
    monkeypatch.setenv("GEMINI_API_KEYS", "")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("API_KEY", "")
    monkeypatch.setenv("GEMINI_API_KEYS_FILE", str(key_file))
    monkeypatch.setenv("GEMINI_API_POOLS_FILE", str(pools_file))
    runtime = _load_gemini_runtime_module()
    client = TestClient(runtime.app)

    response = client.get("/v1/admin/api-pools")
    assert response.status_code == 200
    payload = response.json()
    assert payload["config"]["pools"]["free"]["keys"] == [free_a, free_b]
    assert payload["config"]["pools"]["pro"]["keys"] == [pro_key]
    assert payload["sourcePolicy"]["freePoolLocked"] is True
    assert str(payload["sourcePolicy"]["freePoolMode"] or "").strip().lower() == "api_file_authoritative"
    assert payload.get("warnings") == []

    persisted = json.loads(pools_file.read_text(encoding="utf-8"))
    assert persisted["pools"]["free"]["keys"] == [free_a, free_b]


def test_admin_api_pools_update_ignores_free_edits_when_locked(monkeypatch, tmp_path: Path) -> None:
    free_key = _make_key(27)
    pro_key = _make_key(28)
    key_file = tmp_path / "runtime_api.txt"
    key_file.write_text(f"{free_key}\n", encoding="utf-8")
    pools_file = tmp_path / "runtime_pools.json"
    pools_file.write_text(
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
    monkeypatch.setenv("GEMINI_API_KEYS", "")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("GEMINI_API_KEYS_FILE", str(key_file))
    monkeypatch.setenv("GEMINI_API_POOLS_FILE", str(pools_file))
    runtime = _load_gemini_runtime_module()
    client = TestClient(runtime.app)

    warm = client.get("/v1/admin/api-pools")
    assert warm.status_code == 200

    candidate_free = _make_key(29)
    response = client.put(
        "/v1/admin/api-pools",
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
    assert response.status_code == 200
    payload = response.json()
    assert "free_pool_locked_by_api_file" in list(payload.get("appliedOverrides") or [])
    assert payload["config"]["pools"]["free"]["keys"] == [free_key]
    assert payload["config"]["pools"]["pro"]["keys"] == [pro_key]


def test_admin_api_pools_missing_file_keeps_last_good(monkeypatch, tmp_path: Path) -> None:
    free_key = _make_key(30)
    key_file = tmp_path / "runtime_api.txt"
    key_file.write_text(f"{free_key}\n", encoding="utf-8")
    pools_file = tmp_path / "runtime_pools.json"
    pools_file.write_text(
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
    monkeypatch.setenv("GEMINI_API_KEYS", "")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("GEMINI_API_KEYS_FILE", str(key_file))
    monkeypatch.setenv("GEMINI_API_POOLS_FILE", str(pools_file))
    runtime = _load_gemini_runtime_module()
    client = TestClient(runtime.app)

    first = client.get("/v1/admin/api-pools")
    assert first.status_code == 200
    assert first.json()["config"]["pools"]["free"]["keys"] == [free_key]

    key_file.unlink()
    runtime._API_POOLS_CACHE = None
    runtime._API_POOLS_META = {}

    reload_response = client.post("/v1/admin/api-pools/reload")
    assert reload_response.status_code == 200
    warnings = list(reload_response.json().get("warnings") or [])
    assert warnings

    latest = client.get("/v1/admin/api-pools")
    assert latest.status_code == 200
    latest_payload = latest.json()
    assert latest_payload["config"]["pools"]["free"]["keys"] == [free_key]
    assert list(latest_payload.get("warnings") or [])


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


def test_allocator_tts_limits_can_be_overridden_by_env(monkeypatch) -> None:
    monkeypatch.setenv("GEMINI_TTS_ALLOCATOR_RPM", "9")
    monkeypatch.setenv("GEMINI_TTS_ALLOCATOR_TPM", "22000")
    monkeypatch.setenv("GEMINI_ALLOCATOR_DEFAULT_WAIT_TIMEOUT_MS", "25000")
    runtime = _load_gemini_runtime_module()

    tts_model = runtime.resolve_tts_model_candidates()[0]
    model_limit = runtime.ALLOCATOR_CONFIG.models[tts_model]
    assert int(model_limit.rpm) == 9
    assert int(model_limit.tpm) == 22000
    assert int(runtime.ALLOCATOR_CONFIG.default_wait_timeout_ms) == 25000


def test_tts_pool_capacity_fast_fails_with_overload_payload(monkeypatch) -> None:
    runtime = _load_gemini_runtime_module()
    key = _make_key(71)

    original_allocator = runtime._RUNTIME_ALLOCATOR
    original_pool = runtime._SERVER_API_KEY_POOL
    original_pool_set = runtime._SERVER_API_KEY_SET
    original_speech_attempts = runtime._resolve_speech_attempts

    try:
        runtime._RUNTIME_ALLOCATOR = GeminiRateAllocator(runtime.ALLOCATOR_CONFIG, wait_slice_ms=100)
        runtime._SERVER_API_KEY_POOL = (key,)
        runtime._SERVER_API_KEY_SET = frozenset({key})
        runtime._RUNTIME_ALLOCATOR.ensure_keys([key])
        runtime._resolve_speech_attempts = lambda *args, **kwargs: [("single-speaker", object())]

        tts_model = runtime.resolve_tts_model_candidates()[0]
        rpm_limit = int(runtime.ALLOCATOR_CONFIG.models[tts_model].rpm)
        for _ in range(rpm_limit):
            acquired = runtime._RUNTIME_ALLOCATOR.acquire_for_task(
                task="tts",
                key_pool=[key],
                requested_tokens=1,
                wait_timeout_ms=1000,
            )
            assert acquired.lease is not None
            runtime._RUNTIME_ALLOCATOR.release(acquired.lease, success=True, used_tokens=1)

        started_ms = int(time.time() * 1000)
        try:
            runtime._synthesize_pcm_with_key_pool(
                text_input="Overload check text.",
                trace_id="trace_overload_fast_fail",
                speaker_hint="",
                language_code="en",
                target_voice="Fenrir",
                speaker_voices=[],
                primary_key_pool=[key],
                fallback_request_key=None,
                effective_key_pool=[key],
                speech_mode_requested="single-speaker",
                window_index=1,
                window_total=1,
                affinity_speakers=[],
            )
            raise AssertionError("Expected capacity overload RuntimeError.")
        except RuntimeError as exc:
            elapsed_ms = max(0, int(time.time() * 1000) - started_ms)
            payload = json.loads(str(exc))
            assert payload.get("errorCode") == runtime.ERROR_CODE_KEY_POOL_OVERLOADED
            assert int(payload.get("retryAfterMs") or 0) > 0
            assert elapsed_ms < 5000
    finally:
        runtime._RUNTIME_ALLOCATOR = original_allocator
        runtime._SERVER_API_KEY_POOL = original_pool
        runtime._SERVER_API_KEY_SET = original_pool_set
        runtime._resolve_speech_attempts = original_speech_attempts


def test_studio_pair_groups_adaptive_concurrency_respects_pool_pressure(monkeypatch) -> None:
    runtime = _load_gemini_runtime_module()

    monkeypatch.setattr(
        runtime,
        "_estimate_tts_pool_pressure",
        lambda *args, **kwargs: {
            "keyPoolSize": 3,
            "availableLanes": 2,
            "inFlight": 6,
            "estimatedWaitMs": 0,
            "retryAfterMs": 0,
            "ttsModel": runtime.resolve_tts_model_candidates()[0],
            "keyStates": [],
        },
    )

    lock = threading.Lock()
    state = {"active": 0, "peak": 0}

    def _fake_synthesize_pcm_with_key_pool(*args, **kwargs):
        with lock:
            state["active"] += 1
            state["peak"] = max(state["peak"], state["active"])
        try:
            time.sleep(0.02)
            return (b"\x00\x00" * 4800, runtime.resolve_tts_model_candidates()[0], "multi-speaker", 0)
        finally:
            with lock:
                state["active"] = max(0, state["active"] - 1)

    monkeypatch.setattr(runtime, "_synthesize_pcm_with_key_pool", _fake_synthesize_pcm_with_key_pool)

    line_map = [
        {"lineIndex": 0, "speaker": "A", "text": "Hello there from speaker A."},
        {"lineIndex": 1, "speaker": "B", "text": "Replying now from speaker B."},
        {"lineIndex": 2, "speaker": "A", "text": "Another sentence from A to force grouping."},
        {"lineIndex": 3, "speaker": "B", "text": "Another response from B to force grouping."},
        {"lineIndex": 4, "speaker": "A", "text": "One more line from A for extra load."},
        {"lineIndex": 5, "speaker": "B", "text": "Final line from B to close the dialogue."},
    ]
    speaker_voices = [
        {"speaker": "A", "voiceName": "Fenrir"},
        {"speaker": "B", "voiceName": "Kore"},
    ]

    result = runtime._synthesize_studio_pair_groups(
        trace_id="trace_adaptive_groups",
        target_voice="Fenrir",
        language_code="en",
        speaker_hint="",
        normalized_speaker_voices=speaker_voices,
        normalized_line_map=line_map,
        primary_key_pool=[_make_key(81), _make_key(82), _make_key(83)],
        fallback_request_key=None,
        effective_key_pool=[_make_key(81), _make_key(82), _make_key(83)],
        requested_concurrency=7,
        retry_once=False,
    )
    diagnostics = result.get("diagnostics") or {}
    assert int(diagnostics.get("concurrencyUsed") or 0) <= 2
    assert state["peak"] <= 2


def test_timeout_classification_distinguishes_upstream_vs_acquire() -> None:
    runtime = _load_gemini_runtime_module()

    upstream_code = runtime._classify_terminal_error_code(
        model_attempts=[{"error": "The read operation timed out"}],
        timed_out=True,
        pool_exhausted=False,
    )
    acquire_code = runtime._classify_terminal_error_code(
        model_attempts=[],
        timed_out=True,
        pool_exhausted=True,
    )

    assert upstream_code == runtime.ERROR_CODE_UPSTREAM_REQUEST_TIMEOUT
    assert acquire_code == runtime.ERROR_CODE_ALLOCATOR_ACQUIRE_TIMEOUT


def test_admin_api_pool_includes_effective_limits_and_error_classes() -> None:
    runtime = _load_gemini_runtime_module()
    client = TestClient(runtime.app)

    runtime._record_error_classification(runtime.ERROR_CODE_UPSTREAM_REQUEST_TIMEOUT)
    response = client.get("/v1/admin/api-pool")
    assert response.status_code == 200
    payload = response.json()

    assert isinstance(payload.get("effectiveTtsLimits"), dict)
    limits = payload["effectiveTtsLimits"]
    assert int(limits.get("rpm") or 0) >= 1
    assert int(limits.get("tpm") or 0) >= 1
    counts = payload.get("recentErrorClassCounts") or {}
    assert int(counts.get("upstream_timeout") or 0) >= 1
