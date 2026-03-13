from __future__ import annotations

import importlib.util
import json
import sys
import threading
import time
from pathlib import Path

import pytest
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


@pytest.fixture(autouse=True)
def _isolate_runtime_pool_config_file(monkeypatch, tmp_path: Path) -> None:
    pools_path = tmp_path / "gemini_api_pools.json"
    pools_path.write_text(
        json.dumps({"version": 1, "pools": {"free": {"keys": []}}}, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("GEMINI_API_POOLS_FILE", str(pools_path))


def _runtime_admin_client(runtime) -> TestClient:
    token = "test_runtime_admin_token"
    runtime.GEMINI_RUNTIME_ADMIN_TOKEN = token
    return TestClient(runtime.app, headers={"x-admin-token": token})


def test_allocator_reset_rotation_clears_next_index() -> None:
    allocator = GeminiRateAllocator(
        AllocatorConfig(
            version="test",
            window_seconds=60,
            default_wait_timeout_ms=5_000,
            models={
                "gemini-2.5-flash-preview-tts": ModelLimit(
                    model_id="gemini-2.5-flash-preview-tts",
                    rpm=10,
                    tpm=50_000,
                    enabled_for={"tts"},
                )
            },
            routes={"tts": ["gemini-2.5-flash-preview-tts"]},
        )
    )
    key_pool = [_make_key(1), _make_key(2)]

    acquire = allocator.acquire_for_task(task="tts", key_pool=key_pool, requested_tokens=200)
    assert acquire.lease is not None
    allocator.release(acquire.lease, success=True, used_tokens=200)
    assert int((allocator.snapshot(key_pool).get("pool") or {}).get("nextIndex") or 0) == 1

    allocator.reset_rotation(next_index=0)
    pool_snapshot = allocator.snapshot(key_pool).get("pool") or {}
    assert int(pool_snapshot.get("nextIndex") or 0) == 0
    assert str(pool_snapshot.get("activeBurstKey") or "") == "none"


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


def test_extract_text_content_reads_parts_without_response_text_accessor() -> None:
    runtime = _load_gemini_runtime_module()

    class _Part:
        def __init__(self, text: str = "") -> None:
            self.text = text

    class _Content:
        def __init__(self, parts: list[object]) -> None:
            self.parts = parts

    class _Candidate:
        def __init__(self, parts: list[object]) -> None:
            self.content = _Content(parts)

    class _Response:
        def __init__(self) -> None:
            self.candidates = [
                _Candidate([_Part("First line"), object(), _Part("Second line")]),
                _Candidate([_Part("Third line")]),
            ]

        @property
        def text(self) -> str:
            raise AssertionError("extract_text_content should not access response.text when text parts exist")

    assert runtime.extract_text_content(_Response()) == "First line\nSecond line\nThird line"


def test_runtime_routes_follow_locked_policy() -> None:
    runtime = _load_gemini_runtime_module()
    tts_candidates = runtime.resolve_tts_model_candidates()
    assert tts_candidates == ["gemini-2.5-flash-lite-preview-tts"]
    assert runtime.resolve_text_model_candidates() == [
        "gemini-3.1-flash-lite-preview",
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
        "gemini-3.1-flash-lite-preview",
        "gemini-2.5-flash",
        "gemini-3-flash",
        "gemini-2.5-flash-lite",
    ]


def test_tts_model_candidates_resolve_by_engine_and_provider() -> None:
    runtime = _load_gemini_runtime_module()

    neural2_gemini_strict = runtime.resolve_tts_model_candidates(
        engine="NEURAL2",
        auth_mode="gemini_api",
        source_policy={"provider": "gemini_api"},
    )
    neural2_gemini_fallback = runtime.resolve_tts_model_candidates(
        engine="NEURAL2",
        auth_mode="gemini_api",
        source_policy={"provider": "gemini_api", "ttsModelFallbackEnabled": True},
    )
    gem_vertex_strict = runtime.resolve_tts_model_candidates(
        engine="GEM",
        auth_mode="vertex",
        source_policy={"provider": "vertex"},
    )
    gem_vertex_fallback = runtime.resolve_tts_model_candidates(
        engine="GEM",
        auth_mode="vertex",
        source_policy={"provider": "vertex", "ttsModelFallbackEnabled": True},
    )

    assert neural2_gemini_strict == ["gemini-2.5-flash-preview-tts"]
    assert neural2_gemini_fallback[0] == "gemini-2.5-flash-preview-tts"
    assert "gemini-2.5-flash-tts" in neural2_gemini_fallback
    assert gem_vertex_strict == ["gemini-2.5-flash-lite-preview-tts"]
    assert gem_vertex_fallback[:2] == [
        "gemini-2.5-flash-lite-preview-tts",
        "gemini-2.5-flash-preview-tts",
    ]


def test_health_and_capabilities_report_tts_model_fallback_state() -> None:
    runtime = _load_gemini_runtime_module()
    client = TestClient(runtime.app)

    health_default = client.get("/health?engine=NEURAL2")
    assert health_default.status_code == 200
    assert health_default.json()["ttsModelFallbackEnabled"] is False
    assert health_default.json()["provider"] == "gemini-api"
    assert health_default.json()["gpu_enabled"] is False
    assert health_default.json()["openvino_enabled"] is False

    capabilities_default = client.get("/v1/capabilities?engine=NEURAL2")
    assert capabilities_default.status_code == 200
    assert capabilities_default.json()["metadata"]["ttsModelFallbackEnabled"] is False
    assert capabilities_default.json()["metadata"]["provider"] == "gemini-api"
    assert capabilities_default.json()["metadata"]["gpuEnabled"] is False
    assert capabilities_default.json()["metadata"]["openvinoEnabled"] is False

    pools_path = Path(runtime.GEMINI_API_POOLS_FILE)
    config = json.loads(pools_path.read_text(encoding="utf-8"))
    config["sourcePolicy"] = {
        "provider": "gemini_api",
        "ttsModelFallbackEnabled": True,
    }
    pools_path.write_text(json.dumps(config, ensure_ascii=True) + "\n", encoding="utf-8")
    runtime._API_POOLS_CACHE = None
    runtime._API_POOLS_META = {}
    runtime._load_api_pool_config(force=True)

    health_enabled = client.get("/health?engine=NEURAL2")
    assert health_enabled.status_code == 200
    assert health_enabled.json()["ttsModelFallbackEnabled"] is True
    assert health_enabled.json()["provider"] == "gemini-api"

    capabilities_enabled = client.get("/v1/capabilities?engine=NEURAL2")
    assert capabilities_enabled.status_code == 200
    assert capabilities_enabled.json()["metadata"]["ttsModelFallbackEnabled"] is True
    assert capabilities_enabled.json()["metadata"]["provider"] == "gemini-api"


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


def test_allocator_rotates_keys_in_three_request_bursts() -> None:
    model_id = "test-tts"
    config = AllocatorConfig(
        version="test",
        window_seconds=60,
        default_wait_timeout_ms=3000,
        models={
            model_id: ModelLimit(
                model_id=model_id,
                rpm=12,
                tpm=50000,
                enabled_for=frozenset({"tts", "text", "ocr"}),
            )
        },
        routes={"tts": [model_id], "text": [model_id], "ocr": [model_id]},
    )
    allocator = GeminiRateAllocator(config, wait_slice_ms=100, key_rotation_burst=3)
    key_pool = [_make_key(41), _make_key(42)]

    key_indexes: list[int] = []
    for _ in range(7):
        acquired = allocator.acquire_for_task(
            task="tts",
            key_pool=key_pool,
            requested_tokens=50,
            wait_timeout_ms=1000,
        )
        assert acquired.lease is not None
        key_indexes.append(int(acquired.lease.key_index))
        allocator.release(acquired.lease, success=True, used_tokens=50)

    assert key_indexes == [0, 0, 0, 1, 1, 1, 0]

    snapshot = allocator.snapshot(key_pool)
    pool_meta = snapshot.get("pool") or {}
    assert pool_meta.get("rotationMode") == "round_robin_burst_fixed"
    assert int(pool_meta.get("rotationBurst") or 0) == 3


def test_allocator_defaults_to_round_robin_forward() -> None:
    model_id = "test-tts-forward"
    config = AllocatorConfig(
        version="test",
        window_seconds=60,
        default_wait_timeout_ms=3000,
        models={
            model_id: ModelLimit(
                model_id=model_id,
                rpm=5,
                tpm=50000,
                enabled_for=frozenset({"tts", "text", "ocr"}),
            )
        },
        routes={"tts": [model_id], "text": [model_id], "ocr": [model_id]},
    )
    allocator = GeminiRateAllocator(config, wait_slice_ms=100)
    key_pool = [_make_key(51), _make_key(52)]

    key_indexes: list[int] = []
    for _ in range(7):
        acquired = allocator.acquire_for_task(
            task="tts",
            key_pool=key_pool,
            requested_tokens=50,
            wait_timeout_ms=1000,
        )
        assert acquired.lease is not None
        key_indexes.append(int(acquired.lease.key_index))
        allocator.release(acquired.lease, success=True, used_tokens=50)

    assert key_indexes == [0, 1, 0, 1, 0, 1, 0]

    snapshot = allocator.snapshot(key_pool)
    pool_meta = snapshot.get("pool") or {}
    assert pool_meta.get("rotationMode") == "round_robin_forward"
    assert pool_meta.get("rotationBurst") is None
    assert int(pool_meta.get("activeBurstTarget") or 0) == 0


def test_speaker_key_affinity_is_enabled_by_default(monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_SPEAKER_KEY_AFFINITY_ENABLED", raising=False)
    runtime = _load_gemini_runtime_module()
    key_pool = [_make_key(53), _make_key(54)]

    runtime._SPEAKER_KEY_AFFINITY.clear()
    assert runtime.GEMINI_SPEAKER_KEY_AFFINITY_ENABLED is True

    runtime._bind_speakers_to_key(["Narrator"], key_pool[0])

    assert runtime._resolve_affinity_preferred_key(["Narrator"], key_pool) == key_pool[0]


def test_allocator_only_advances_burst_on_successful_release() -> None:
    model_id = "test-tts-burst-release"
    config = AllocatorConfig(
        version="test",
        window_seconds=60,
        default_wait_timeout_ms=3000,
        models={
            model_id: ModelLimit(
                model_id=model_id,
                rpm=12,
                tpm=50000,
                enabled_for=frozenset({"tts", "text", "ocr"}),
            )
        },
        routes={"tts": [model_id], "text": [model_id], "ocr": [model_id]},
    )
    allocator = GeminiRateAllocator(config, wait_slice_ms=100, key_rotation_burst=3)
    key_pool = [_make_key(61), _make_key(62)]

    first = allocator.acquire_for_task(
        task="tts",
        key_pool=key_pool,
        requested_tokens=50,
        wait_timeout_ms=1000,
    )
    assert first.lease is not None
    allocator.release(first.lease, success=True, used_tokens=50)

    second = allocator.acquire_for_task(
        task="tts",
        key_pool=key_pool,
        requested_tokens=50,
        wait_timeout_ms=1000,
    )
    assert second.lease is not None
    assert int(second.lease.key_index) == 0
    allocator.release(second.lease, success=False, used_tokens=50, error_kind="other")

    third = allocator.acquire_for_task(
        task="tts",
        key_pool=key_pool,
        requested_tokens=50,
        wait_timeout_ms=1000,
    )
    assert third.lease is not None
    assert int(third.lease.key_index) == 0
    allocator.release(third.lease, success=True, used_tokens=50)

    fourth = allocator.acquire_for_task(
        task="tts",
        key_pool=key_pool,
        requested_tokens=50,
        wait_timeout_ms=1000,
    )
    assert fourth.lease is not None
    assert int(fourth.lease.key_index) == 0
    allocator.release(fourth.lease, success=True, used_tokens=50)

    fifth = allocator.acquire_for_task(
        task="tts",
        key_pool=key_pool,
        requested_tokens=50,
        wait_timeout_ms=1000,
    )
    assert fifth.lease is not None
    assert int(fifth.lease.key_index) == 1
    allocator.release(fifth.lease, success=True, used_tokens=50)


def test_allocator_other_failure_does_not_consume_lane_budget() -> None:
    model_id = "test-tts-local-failure"
    config = AllocatorConfig(
        version="test",
        window_seconds=60,
        default_wait_timeout_ms=3000,
        models={
            model_id: ModelLimit(
                model_id=model_id,
                rpm=2,
                tpm=50000,
                enabled_for=frozenset({"tts", "text", "ocr"}),
            )
        },
        routes={"tts": [model_id], "text": [model_id], "ocr": [model_id]},
    )
    allocator = GeminiRateAllocator(config, wait_slice_ms=100)
    key_pool = [_make_key(71)]

    first = allocator.acquire_for_task(
        task="tts",
        key_pool=key_pool,
        requested_tokens=50,
        wait_timeout_ms=1000,
    )
    assert first.lease is not None
    allocator.release(first.lease, success=True, used_tokens=50)

    second = allocator.acquire_for_task(
        task="tts",
        key_pool=key_pool,
        requested_tokens=50,
        wait_timeout_ms=1000,
    )
    assert second.lease is not None
    allocator.release(second.lease, success=False, used_tokens=50, error_kind="other")

    third = allocator.acquire_for_task(
        task="tts",
        key_pool=key_pool,
        requested_tokens=50,
        wait_timeout_ms=1000,
    )
    assert third.lease is not None
    allocator.release(third.lease, success=True, used_tokens=50)

    fourth = allocator.acquire_for_task(
        task="tts",
        key_pool=key_pool,
        requested_tokens=50,
        wait_timeout_ms=1000,
    )
    assert fourth.lease is None
    assert fourth.timed_out is True


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

        client = _runtime_admin_client(runtime)
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
    client = _runtime_admin_client(runtime)

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
    client = _runtime_admin_client(runtime)

    response = client.get("/v1/admin/api-pools")
    assert response.status_code == 200
    payload = response.json()
    _assert_masked_pool_keys(payload["config"], "free", 2)
    assert set((payload["config"].get("pools") or {}).keys()) == {"free"}
    assert payload["config"]["planPools"] == {"free": "free", "pro": "free", "plus": "free"}
    assert payload["sourcePolicy"]["freePoolLocked"] is True
    assert str(payload["sourcePolicy"]["freePoolMode"] or "").strip().lower() == "api_file_authoritative"
    assert any("Single-pool mode" in str(item) for item in list(payload.get("warnings") or []))

    persisted = json.loads(pools_file.read_text(encoding="utf-8"))
    persisted_keys = list((persisted.get("pools") or {}).get("free", {}).get("keys") or [])
    assert len(persisted_keys) == 2
    assert all(str(item).startswith("__vf_masked_key__:") for item in persisted_keys)
    persisted_text = pools_file.read_text(encoding="utf-8")
    assert free_a not in persisted_text
    assert free_b not in persisted_text


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
    client = _runtime_admin_client(runtime)

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
    _assert_masked_pool_keys(payload["config"], "free", 1)
    assert set((payload["config"].get("pools") or {}).keys()) == {"free"}
    assert "single_pool_enforced:free" in list(payload.get("appliedOverrides") or [])


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
    client = _runtime_admin_client(runtime)

    first = client.get("/v1/admin/api-pools")
    assert first.status_code == 200
    _assert_masked_pool_keys(first.json()["config"], "free", 1)

    key_file.unlink()

    reload_response = client.post("/v1/admin/api-pools/reload")
    assert reload_response.status_code == 200
    warnings = list(reload_response.json().get("warnings") or [])
    assert warnings

    latest = client.get("/v1/admin/api-pools")
    assert latest.status_code == 200
    latest_payload = latest.json()
    _assert_masked_pool_keys(latest_payload["config"], "free", 1)
    assert list(latest_payload.get("warnings") or [])


def test_admin_api_pools_supports_custom_pool_and_plan_mapping(monkeypatch, tmp_path: Path) -> None:
    free_key = _make_key(231)
    custom_key = _make_key(232)
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
    client = _runtime_admin_client(runtime)

    warm = client.get("/v1/admin/api-pools")
    assert warm.status_code == 200

    response = client.put(
        "/v1/admin/api-pools",
        json={
            "version": 1,
            "pools": {
                "free": {"keys": []},
                "pro": {"keys": []},
                "pro_plus": {"keys": []},
                "vip": {"keys": [custom_key]},
            },
            "fallbackChains": {
                "free": ["free"],
                "pro": ["pro", "free"],
                "pro_plus": ["pro_plus", "pro", "free"],
                "vip": ["vip", "pro", "free"],
            },
            "planPools": {
                "free": "free",
                "pro": "pro",
                "plus": "vip",
            },
            "defaultFallbackChain": ["vip", "pro", "free"],
            "constraints": {"uniqueKeyMembership": True},
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["config"]["planPools"] == {"free": "free", "pro": "free", "plus": "free"}
    _assert_masked_pool_keys(payload["config"], "free", 1)
    assert set((payload["config"].get("pools") or {}).keys()) == {"free"}

    refreshed = client.get("/v1/admin/api-pools")
    assert refreshed.status_code == 200
    _assert_masked_pool_keys(refreshed.json()["config"], "free", 1)


def test_admin_api_pools_delete_free_disables_authoritative_mode(monkeypatch, tmp_path: Path) -> None:
    free_key = _make_key(241)
    pro_key = _make_key(242)
    key_file = tmp_path / "runtime_api.txt"
    key_file.write_text(f"{free_key}\n", encoding="utf-8")
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
    monkeypatch.setenv("GEMINI_API_KEYS_FILE", str(key_file))
    monkeypatch.setenv("GEMINI_API_POOLS_FILE", str(pools_file))
    runtime = _load_gemini_runtime_module()
    client = _runtime_admin_client(runtime)

    warm = client.get("/v1/admin/api-pools")
    assert warm.status_code == 200
    assert warm.json()["sourcePolicy"]["freePoolLocked"] is True

    response = client.put(
        "/v1/admin/api-pools",
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
    assert response.status_code == 200
    payload = response.json()
    assert "free_pool_authoritative_mode_disabled" in list(payload.get("appliedOverrides") or [])
    assert "free" in payload["config"]["pools"]
    _assert_masked_pool_keys(payload["config"], "free", 1)
    assert payload["sourcePolicy"]["freePoolLocked"] is False
    assert str(payload["sourcePolicy"]["freePoolMode"] or "").strip().lower() == "config_managed"

    runtime._API_POOLS_CACHE = None
    runtime._API_POOLS_META = {}
    latest = client.get("/v1/admin/api-pools")
    assert latest.status_code == 200
    _assert_masked_pool_keys(latest.json()["config"], "free", 1)


def test_runtime_pool_hint_missing_pool_falls_back_to_default_chain(monkeypatch, tmp_path: Path) -> None:
    free_key = _make_key(251)
    pro_key = _make_key(252)
    key_file = tmp_path / "runtime_api.txt"
    key_file.write_text(f"{free_key}\n", encoding="utf-8")
    pools_file = tmp_path / "runtime_pools.json"
    pools_file.write_text(
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
    monkeypatch.setenv("GEMINI_API_KEYS", "")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("GEMINI_API_KEYS_FILE", str(key_file))
    monkeypatch.setenv("GEMINI_API_POOLS_FILE", str(pools_file))
    runtime = _load_gemini_runtime_module()
    client = _runtime_admin_client(runtime)

    warm = client.get("/v1/admin/api-pools")
    assert warm.status_code == 200

    response = client.put(
        "/v1/admin/api-pools",
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
    assert response.status_code == 200

    payload = client.get("/v1/admin/api-pools").json()
    assert payload["validation"]["missingPlanPools"] == {}
    assert payload["config"]["planPools"] == {"free": "free", "pro": "free", "plus": "free"}
    resolved_keys = runtime._pool_keys_for_hint("enterprise_missing")
    assert free_key in resolved_keys
    assert pro_key not in resolved_keys


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

    limits = runtime._effective_tts_route_limits()
    tts_model = str(limits.get("model") or runtime.resolve_tts_model_candidates()[0])
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
        source_policy = {
            **runtime._runtime_source_policy(),
            "ttsModelFallbackEnabled": True,
        }
        auth_mode = runtime._normalize_runtime_auth_mode(None, source_policy=source_policy)

        tts_model = str(runtime._effective_tts_route_limits().get("model") or runtime.resolve_tts_model_candidates()[0])
        monkeypatch.setattr(runtime, "resolve_tts_model_candidates", lambda *args, **kwargs: [tts_model])
        rpm_limit = int(runtime.ALLOCATOR_CONFIG.models[tts_model].rpm)
        for _ in range(rpm_limit):
            acquired = runtime._RUNTIME_ALLOCATOR.acquire_for_models(
                model_candidates=[tts_model],
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
                engine="GEM",
                auth_mode=auth_mode,
                source_policy=source_policy,
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


def test_model_access_error_falls_back_to_next_model_without_auth_disable(monkeypatch) -> None:
    runtime = _load_gemini_runtime_module()
    key = _make_key(72)

    original_allocator = runtime._RUNTIME_ALLOCATOR
    original_pool = runtime._SERVER_API_KEY_POOL
    original_pool_set = runtime._SERVER_API_KEY_SET
    original_genai = runtime.genai
    original_types = runtime.types
    original_speech_attempts = runtime._resolve_speech_attempts
    original_affinity_enabled = runtime.GEMINI_SPEAKER_KEY_AFFINITY_ENABLED
    original_affinity_state = dict(runtime._SPEAKER_KEY_AFFINITY)
    original_affinity_enabled = runtime.GEMINI_SPEAKER_KEY_AFFINITY_ENABLED
    original_affinity_state = dict(runtime._SPEAKER_KEY_AFFINITY)

    call_order: list[str] = []

    class _DummyInline:
        data = b"\x00\x00" * 4800

    class _DummyPart:
        inline_data = _DummyInline()

    class _DummyContent:
        parts = [_DummyPart()]

    class _DummyCandidate:
        content = _DummyContent()

    class _DummyResponse:
        candidates = [_DummyCandidate()]

    class _DummyModels:
        def generate_content(self, **kwargs: object) -> object:
            model = str(kwargs.get("model") or "")
            call_order.append(model)
            if model == "gemini-2.5-pro-preview-tts":
                raise RuntimeError("Model gemini-2.5-pro-preview-tts is not available in this API version.")
            return _DummyResponse()

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

    try:
        runtime._RUNTIME_ALLOCATOR = GeminiRateAllocator(runtime.ALLOCATOR_CONFIG, wait_slice_ms=100)
        runtime._SERVER_API_KEY_POOL = (key,)
        runtime._SERVER_API_KEY_SET = frozenset({key})
        runtime._RUNTIME_ALLOCATOR.ensure_keys([key])
        runtime.genai = _DummyGenai
        runtime.types = _DummyTypes
        runtime._resolve_speech_attempts = lambda *args, **kwargs: [("single-speaker", object())]
        source_policy = runtime._runtime_source_policy()
        auth_mode = runtime._normalize_runtime_auth_mode(None, source_policy=source_policy)
        monkeypatch.setattr(
            runtime,
            "resolve_tts_model_candidates",
            lambda *args, **kwargs: ["gemini-2.5-pro-preview-tts", "gemini-2.5-flash-preview-tts"],
        )

        pcm_bytes, model_used, speech_mode, key_index = runtime._synthesize_pcm_with_key_pool(
            text_input="Fallback model access test.",
            engine="GEM",
            auth_mode=auth_mode,
            source_policy=source_policy,
            trace_id="trace_model_access_fallback",
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

        assert call_order[:2] == ["gemini-2.5-pro-preview-tts", "gemini-2.5-flash-preview-tts"]
        assert model_used == "gemini-2.5-flash-preview-tts"
        assert speech_mode == "single-speaker"
        assert key_index == 0
        assert len(pcm_bytes) > 0

        snapshot = runtime._RUNTIME_ALLOCATOR.snapshot([key])
        key_rows = list(snapshot.get("keys") or [])
        assert key_rows
        assert str(key_rows[0].get("status") or "").strip().lower() != "auth_issue"
    finally:
        runtime._RUNTIME_ALLOCATOR = original_allocator
        runtime._SERVER_API_KEY_POOL = original_pool
        runtime._SERVER_API_KEY_SET = original_pool_set
        runtime.genai = original_genai
        runtime.types = original_types
        runtime._resolve_speech_attempts = original_speech_attempts


def test_multispeaker_retries_stay_on_same_key_and_only_rotate_after_successes(monkeypatch) -> None:
    runtime = _load_gemini_runtime_module()
    key_pool = [_make_key(81), _make_key(82)]

    original_allocator = runtime._RUNTIME_ALLOCATOR
    original_pool = runtime._SERVER_API_KEY_POOL
    original_pool_set = runtime._SERVER_API_KEY_SET
    original_genai = runtime.genai
    original_types = runtime.types
    original_speech_attempts = runtime._resolve_speech_attempts
    original_affinity_enabled = runtime.GEMINI_SPEAKER_KEY_AFFINITY_ENABLED
    original_affinity_state = dict(runtime._SPEAKER_KEY_AFFINITY)

    multi_config = object()
    single_config = object()
    call_pairs: list[tuple[str, object]] = []

    class _DummyInline:
        data = b"\x00\x00" * 4800

    class _DummyPart:
        inline_data = _DummyInline()

    class _DummyContent:
        parts = [_DummyPart()]

    class _DummyCandidate:
        content = _DummyContent()

    class _DummyResponse:
        candidates = [_DummyCandidate()]

    class _DummyModels:
        def __init__(self, api_key: str) -> None:
            self._api_key = api_key

        def generate_content(self, **kwargs: object) -> object:
            config = kwargs.get("config")
            speech_config = getattr(config, "kwargs", {}).get("speech_config") if config is not None else None
            call_pairs.append((self._api_key, speech_config))
            if speech_config is multi_config:
                raise RuntimeError("Synthetic multi-speaker failure.")
            return _DummyResponse()

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
        flash_limit = runtime.ALLOCATOR_CONFIG.models["gemini-2.5-flash-preview-tts"]
        tuned_models = dict(runtime.ALLOCATOR_CONFIG.models)
        tuned_models["gemini-2.5-flash-preview-tts"] = ModelLimit(
            model_id=flash_limit.model_id,
            rpm=12,
            tpm=flash_limit.tpm,
            enabled_for=flash_limit.enabled_for,
        )
        tuned_config = AllocatorConfig(
            version=f"{runtime.ALLOCATOR_CONFIG.version}-test-burst",
            window_seconds=runtime.ALLOCATOR_CONFIG.window_seconds,
            default_wait_timeout_ms=runtime.ALLOCATOR_CONFIG.default_wait_timeout_ms,
            models=tuned_models,
            routes=runtime.ALLOCATOR_CONFIG.routes,
        )
        runtime._RUNTIME_ALLOCATOR = GeminiRateAllocator(tuned_config, wait_slice_ms=100, key_rotation_burst=3)
        runtime._SERVER_API_KEY_POOL = tuple(key_pool)
        runtime._SERVER_API_KEY_SET = frozenset(key_pool)
        runtime._RUNTIME_ALLOCATOR.ensure_keys(key_pool)
        runtime.genai = _DummyGenai
        runtime.types = _DummyTypes
        runtime.GEMINI_SPEAKER_KEY_AFFINITY_ENABLED = False
        runtime._SPEAKER_KEY_AFFINITY.clear()
        runtime._resolve_speech_attempts = lambda *args, **kwargs: [
            ("multi-speaker", multi_config),
            ("single-speaker", single_config),
        ]
        monkeypatch.setattr(runtime, "resolve_tts_model_candidates", lambda *args, **kwargs: ["gemini-2.5-flash-preview-tts"])

        final_key_indexes: list[int] = []
        for idx in range(4):
            pcm_bytes, model_used, speech_mode, key_index = runtime._synthesize_pcm_with_key_pool(
                text_input=f"Grouped request {idx + 1}.",
                engine="GEM",
                auth_mode=runtime._normalize_runtime_auth_mode(None, source_policy=runtime._runtime_source_policy()),
                source_policy=runtime._runtime_source_policy(),
                trace_id=f"trace_multispeaker_retry_{idx}",
                speaker_hint="A, B",
                language_code="en",
                target_voice="Fenrir",
                speaker_voices=[
                    {"speaker": "A", "voiceName": "Fenrir"},
                    {"speaker": "B", "voiceName": "Kore"},
                ],
                primary_key_pool=key_pool,
                fallback_request_key=None,
                effective_key_pool=key_pool,
                speech_mode_requested="studio_pair_groups",
                window_index=1,
                window_total=1,
                affinity_speakers=["A", "B"],
            )
            assert pcm_bytes
            assert model_used == "gemini-2.5-flash-preview-tts"
            assert speech_mode == "single-speaker"
            final_key_indexes.append(int(key_index))

        assert final_key_indexes == [0, 0, 0, 1]

        grouped_calls = [call_pairs[index:index + 2] for index in range(0, len(call_pairs), 2)]
        assert len(grouped_calls) == 4
        for key_calls in grouped_calls:
            assert len(key_calls) == 2
            assert key_calls[0][0] == key_calls[1][0]
            assert key_calls[0][1] is multi_config
            assert key_calls[1][1] is single_config
    finally:
        runtime._RUNTIME_ALLOCATOR = original_allocator
        runtime._SERVER_API_KEY_POOL = original_pool
        runtime._SERVER_API_KEY_SET = original_pool_set
        runtime.genai = original_genai
        runtime.types = original_types
        runtime._resolve_speech_attempts = original_speech_attempts
        runtime.GEMINI_SPEAKER_KEY_AFFINITY_ENABLED = original_affinity_enabled
        runtime._SPEAKER_KEY_AFFINITY.clear()
        runtime._SPEAKER_KEY_AFFINITY.update(original_affinity_state)


def test_single_speaker_transient_retry_stays_on_same_key(monkeypatch) -> None:
    runtime = _load_gemini_runtime_module()
    key_pool = [_make_key(91), _make_key(92)]

    original_allocator = runtime._RUNTIME_ALLOCATOR
    original_pool = runtime._SERVER_API_KEY_POOL
    original_pool_set = runtime._SERVER_API_KEY_SET
    original_genai = runtime.genai
    original_types = runtime.types
    original_speech_attempts = runtime._resolve_speech_attempts

    key_attempt_counters = {key_pool[0]: 0, key_pool[1]: 0}
    call_order: list[str] = []

    class _DummyInline:
        data = b"\x00\x00" * 4800

    class _DummyPart:
        inline_data = _DummyInline()

    class _DummyContent:
        parts = [_DummyPart()]

    class _DummyCandidate:
        content = _DummyContent()

    class _DummyResponse:
        candidates = [_DummyCandidate()]

    class _DummyModels:
        def __init__(self, api_key: str) -> None:
            self._api_key = api_key

        def generate_content(self, **kwargs: object) -> object:
            call_order.append(self._api_key)
            current_count = int(key_attempt_counters.get(self._api_key, 0))
            key_attempt_counters[self._api_key] = current_count + 1
            if self._api_key == key_pool[0] and current_count == 0:
                raise RuntimeError("Synthetic transient upstream failure.")
            return _DummyResponse()

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
        flash_limit = runtime.ALLOCATOR_CONFIG.models["gemini-2.5-flash-preview-tts"]
        tuned_models = dict(runtime.ALLOCATOR_CONFIG.models)
        tuned_models["gemini-2.5-flash-preview-tts"] = ModelLimit(
            model_id=flash_limit.model_id,
            rpm=12,
            tpm=flash_limit.tpm,
            enabled_for=flash_limit.enabled_for,
        )
        tuned_config = AllocatorConfig(
            version=f"{runtime.ALLOCATOR_CONFIG.version}-test-transient",
            window_seconds=runtime.ALLOCATOR_CONFIG.window_seconds,
            default_wait_timeout_ms=runtime.ALLOCATOR_CONFIG.default_wait_timeout_ms,
            models=tuned_models,
            routes=runtime.ALLOCATOR_CONFIG.routes,
        )
        runtime._RUNTIME_ALLOCATOR = GeminiRateAllocator(tuned_config, wait_slice_ms=100, key_rotation_burst=3)
        runtime._SERVER_API_KEY_POOL = tuple(key_pool)
        runtime._SERVER_API_KEY_SET = frozenset(key_pool)
        runtime._RUNTIME_ALLOCATOR.ensure_keys(key_pool)
        runtime.genai = _DummyGenai
        runtime.types = _DummyTypes
        runtime._resolve_speech_attempts = lambda *args, **kwargs: [("single-speaker", object())]
        monkeypatch.setattr(runtime, "resolve_tts_model_candidates", lambda *args, **kwargs: ["gemini-2.5-flash-preview-tts"])

        (
            pcm_bytes,
            model_used,
            speech_mode,
            key_index,
            usage_metadata,
            attempt_metadata,
        ) = runtime._synthesize_pcm_result_with_attempts(
            runtime._synthesize_pcm_with_key_pool(
                text_input="Transient same-key retry test.",
                engine="GEM",
                auth_mode=runtime._normalize_runtime_auth_mode(None, source_policy=runtime._runtime_source_policy()),
                source_policy=runtime._runtime_source_policy(),
                trace_id="trace_single_transient_retry",
                speaker_hint="",
                language_code="en",
                target_voice="Fenrir",
                speaker_voices=[],
                primary_key_pool=key_pool,
                fallback_request_key=None,
                effective_key_pool=key_pool,
                speech_mode_requested="single-speaker",
                window_index=1,
                window_total=1,
                affinity_speakers=[],
                include_usage_metadata=True,
                include_attempt_metadata=True,
            )
        )

        assert pcm_bytes
        assert model_used == "gemini-2.5-flash-preview-tts"
        assert speech_mode == "single-speaker"
        assert key_index == 0
        assert usage_metadata is None
        assert call_order == [key_pool[0], key_pool[0]]
        assert int(attempt_metadata.get("initialKeySelectionIndex", -1)) == 0
        assert list(attempt_metadata.get("attemptKeySelectionIndexes") or []) == [0, 0]
        assert list(attempt_metadata.get("attemptErrorKinds") or []) == ["other", ""]
        assert list(attempt_metadata.get("attemptStatuses") or []) == ["failed", "success"]
    finally:
        runtime._RUNTIME_ALLOCATOR = original_allocator
        runtime._SERVER_API_KEY_POOL = original_pool
        runtime._SERVER_API_KEY_SET = original_pool_set
        runtime.genai = original_genai
        runtime.types = original_types
        runtime._resolve_speech_attempts = original_speech_attempts


def test_synthesize_text_to_wav_reports_initial_key_attempt_metadata(monkeypatch) -> None:
    runtime = _load_gemini_runtime_module()
    key_pool = [_make_key(93), _make_key(94)]

    original_allocator = runtime._RUNTIME_ALLOCATOR
    original_pool = runtime._SERVER_API_KEY_POOL
    original_pool_set = runtime._SERVER_API_KEY_SET
    original_genai = runtime.genai
    original_types = runtime.types
    original_speech_attempts = runtime._resolve_speech_attempts

    key_attempt_counters = {key_pool[0]: 0, key_pool[1]: 0}

    class _DummyInline:
        data = b"\x00\x00" * 4800

    class _DummyPart:
        inline_data = _DummyInline()

    class _DummyContent:
        parts = [_DummyPart()]

    class _DummyCandidate:
        content = _DummyContent()

    class _DummyResponse:
        candidates = [_DummyCandidate()]

    class _DummyModels:
        def __init__(self, api_key: str) -> None:
            self._api_key = api_key

        def generate_content(self, **kwargs: object) -> object:
            current_count = int(key_attempt_counters.get(self._api_key, 0))
            key_attempt_counters[self._api_key] = current_count + 1
            if self._api_key == key_pool[0] and current_count == 0:
                raise RuntimeError("Synthetic transient upstream failure.")
            return _DummyResponse()

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
        flash_limit = runtime.ALLOCATOR_CONFIG.models["gemini-2.5-flash-preview-tts"]
        tuned_models = dict(runtime.ALLOCATOR_CONFIG.models)
        tuned_models["gemini-2.5-flash-preview-tts"] = ModelLimit(
            model_id=flash_limit.model_id,
            rpm=12,
            tpm=flash_limit.tpm,
            enabled_for=flash_limit.enabled_for,
        )
        tuned_config = AllocatorConfig(
            version=f"{runtime.ALLOCATOR_CONFIG.version}-test-request-attempts",
            window_seconds=runtime.ALLOCATOR_CONFIG.window_seconds,
            default_wait_timeout_ms=runtime.ALLOCATOR_CONFIG.default_wait_timeout_ms,
            models=tuned_models,
            routes=runtime.ALLOCATOR_CONFIG.routes,
        )
        runtime._RUNTIME_ALLOCATOR = GeminiRateAllocator(tuned_config, wait_slice_ms=100, key_rotation_burst=3)
        runtime._SERVER_API_KEY_POOL = tuple(key_pool)
        runtime._SERVER_API_KEY_SET = frozenset(key_pool)
        runtime._RUNTIME_ALLOCATOR.ensure_keys(key_pool)
        runtime.genai = _DummyGenai
        runtime.types = _DummyTypes
        runtime._resolve_speech_attempts = lambda *args, **kwargs: [("single-speaker", object())]
        monkeypatch.setattr(runtime, "resolve_tts_model_candidates", lambda *args, **kwargs: ["gemini-2.5-flash-preview-tts"])

        result = runtime._synthesize_text_to_wav(
            runtime.SynthesizeRequest(
                text="Request diagnostics metadata test.",
                engine="GEM",
                voiceName="Fenrir",
                trace_id="trace_request_attempt_metadata",
                model="gemini-2.5-flash-preview-tts",
                modelCandidates=["gemini-2.5-flash-preview-tts"],
            )
        )

        diagnostics = result.get("diagnostics") or {}
        assert int(result.get("initialKeySelectionIndex", -1)) == 0
        assert int(result.get("keySelectionIndex", -1)) == 0
        assert int(diagnostics.get("initialKeySelectionIndex", -1)) == 0
        assert int(diagnostics.get("attemptCount") or 0) == 2
        assert list(diagnostics.get("attemptKeySelectionIndexes") or []) == [0, 0]
        assert list(diagnostics.get("attemptErrorKinds") or []) == ["other", ""]
        assert list(diagnostics.get("attemptStatuses") or []) == ["failed", "success"]
    finally:
        runtime._RUNTIME_ALLOCATOR = original_allocator
        runtime._SERVER_API_KEY_POOL = original_pool
        runtime._SERVER_API_KEY_SET = original_pool_set
        runtime.genai = original_genai
        runtime.types = original_types
        runtime._resolve_speech_attempts = original_speech_attempts


def test_studio_pair_groups_adaptive_concurrency_respects_pool_pressure(monkeypatch) -> None:
    runtime = _load_gemini_runtime_module()
    source_policy = runtime._runtime_source_policy()
    auth_mode = runtime._normalize_runtime_auth_mode(None, source_policy=source_policy)

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
        engine="GEM",
        auth_mode=auth_mode,
        source_policy=source_policy,
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


def test_pool_pressure_handles_non_routed_tts_candidates() -> None:
    runtime = _load_gemini_runtime_module()
    key_pool = [_make_key(301), _make_key(302)]
    runtime._RUNTIME_ALLOCATOR.ensure_keys(key_pool)

    pressure = runtime._estimate_tts_pool_pressure(
        key_pool=key_pool,
        requested_tokens=120,
        model_candidates=["gemini-2.5-pro-tts"],
    )

    assert int(pressure.get("keyPoolSize") or 0) == len(key_pool)
    assert int(pressure.get("availableLanes") or 0) >= len(key_pool)


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
    client = _runtime_admin_client(runtime)

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
