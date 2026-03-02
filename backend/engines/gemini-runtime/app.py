import base64
import concurrent.futures
import io
import json
import os
import sys
import re
import threading
import time
import wave
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import quote

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from segmentation import (
    MAX_WORDS_PER_REQUEST,
    count_words,
)

RUNTIME_ROOT = Path(__file__).resolve().parents[2]
WORKSPACE_ROOT = RUNTIME_ROOT.parent
if str(RUNTIME_ROOT) not in sys.path:
    sys.path.insert(0, str(RUNTIME_ROOT))

from shared.env_loader import load_backend_env_files
from shared.gemini_allocator import (
    AllocatorConfig,
    GeminiRateAllocator,
    LaneLease,
    ModelLimit,
    api_key_fingerprint,
    estimate_text_tokens,
    load_allocator_config,
    normalize_model_name,
    parse_api_keys as parse_api_keys_shared,
    is_valid_api_key as is_valid_api_key_shared,
)
from shared.gemini_api_pools import (
    POOL_NAMES,
    duplicate_key_memberships,
    flatten_pool_keys,
    load_pool_config as load_pool_config_shared,
    normalize_pool_config,
    normalize_pool_name as normalize_pool_name_shared,
    resolve_effective_keys as resolve_effective_keys_shared,
    save_pool_config as save_pool_config_shared,
    sync_authoritative_free_pool as sync_authoritative_free_pool_shared,
)
from shared.gemini_multi_speaker import (
    build_studio_pair_groups as build_studio_pair_groups_shared,
    normalize_multi_speaker_line_map as normalize_multi_speaker_line_map_shared,
    split_int16_pcm_for_lines as split_int16_pcm_for_lines_shared,
)

load_backend_env_files(Path(__file__).resolve())

try:
    from google import genai
    from google.genai import types
except Exception:
    genai = None
    types = None

APP_NAME = "gemini-runtime"


def _read_positive_int_env(name: str) -> Optional[int]:
    raw = str(os.getenv(name) or "").strip()
    if not raw:
        return None
    try:
        value = int(raw)
    except Exception:
        return None
    if value <= 0:
        return None
    return value


def _apply_allocator_env_overrides(config: AllocatorConfig) -> AllocatorConfig:
    tts_rpm_override = _read_positive_int_env("GEMINI_TTS_ALLOCATOR_RPM")
    tts_tpm_override = _read_positive_int_env("GEMINI_TTS_ALLOCATOR_TPM")
    wait_timeout_override = _read_positive_int_env("GEMINI_ALLOCATOR_DEFAULT_WAIT_TIMEOUT_MS")

    if (
        tts_rpm_override is None
        and tts_tpm_override is None
        and wait_timeout_override is None
    ):
        return config

    next_models: Dict[str, ModelLimit] = dict(config.models)
    tts_route = list(config.routes.get("tts") or [])
    if tts_rpm_override is not None or tts_tpm_override is not None:
        for model_id in tts_route:
            current = next_models.get(model_id)
            if current is None:
                continue
            next_models[model_id] = ModelLimit(
                model_id=current.model_id,
                rpm=tts_rpm_override if tts_rpm_override is not None else int(current.rpm),
                tpm=tts_tpm_override if tts_tpm_override is not None else int(current.tpm),
                enabled_for=current.enabled_for,
            )

    return AllocatorConfig(
        version=config.version,
        window_seconds=int(config.window_seconds),
        default_wait_timeout_ms=(
            wait_timeout_override
            if wait_timeout_override is not None
            else int(config.default_wait_timeout_ms)
        ),
        models=next_models,
        routes={task: list(route) for task, route in config.routes.items()},
    )


ALLOCATOR_CONFIG = _apply_allocator_env_overrides(load_allocator_config())
TTS_MODEL = os.getenv("GEMINI_TTS_MODEL", ALLOCATOR_CONFIG.routes["tts"][0]).strip()
if normalize_model_name(TTS_MODEL) not in ALLOCATOR_CONFIG.routes["tts"]:
    TTS_MODEL = ALLOCATOR_CONFIG.routes["tts"][0]
SERVER_API_KEY = (os.getenv("API_KEY") or os.getenv("GEMINI_API_KEY") or "").strip()
SERVER_API_KEYS_RAW = os.getenv("GEMINI_API_KEYS", "")
GEMINI_API_KEYS_FILE = str(os.getenv("GEMINI_API_KEYS_FILE") or "").strip()
DEFAULT_GEMINI_API_KEYS_FILE = WORKSPACE_ROOT / "API.txt"
GEMINI_API_POOLS_FILE = (
    str(os.getenv("GEMINI_API_POOLS_FILE") or (RUNTIME_ROOT / "config" / "gemini_api_pools.json")).strip()
)
TTS_MODEL_FALLBACKS = list(ALLOCATOR_CONFIG.routes["tts"])
TEXT_MODEL_FALLBACKS = list(ALLOCATOR_CONFIG.routes["text"])
OCR_MODEL_FALLBACKS = list(ALLOCATOR_CONFIG.routes["ocr"])
MODEL_DISCOVERY_TTL_SECONDS = max(60, int(os.getenv("GEMINI_MODEL_DISCOVERY_TTL_SECONDS", "600")))
MODEL_DISCOVERY_SCAN_LIMIT = max(20, int(os.getenv("GEMINI_MODEL_DISCOVERY_SCAN_LIMIT", "200")))
KEY_COOLDOWN_BASE_MS = max(1000, int(os.getenv("GEMINI_KEY_COOLDOWN_BASE_MS", "8000")))
KEY_COOLDOWN_MAX_MS = max(KEY_COOLDOWN_BASE_MS, int(os.getenv("GEMINI_KEY_COOLDOWN_MAX_MS", "120000")))
KEY_RETRY_LIMIT = max(1, int(os.getenv("GEMINI_KEY_RETRY_LIMIT", "8")))
KEY_WAIT_SLICE_MS = max(100, int(os.getenv("GEMINI_KEY_WAIT_SLICE_MS", "1000")))
KEY_TOTAL_TIMEOUT_MS = max(
    5000,
    int(os.getenv("GEMINI_KEY_TOTAL_TIMEOUT_MS", str(ALLOCATOR_CONFIG.default_wait_timeout_ms))),
)
KEY_AUTH_DISABLE_MS = max(60_000, int(os.getenv("GEMINI_KEY_AUTH_DISABLE_MS", "600000")))
ALLOCATOR_WAIT_SLICE_MS = max(100, int(os.getenv("GEMINI_ALLOCATOR_WAIT_SLICE_MS", "500")))
GEMINI_TTS_SINGLE_REQUEST_TIMEOUT_MS = max(
    1000,
    int(os.getenv("GEMINI_TTS_SINGLE_REQUEST_TIMEOUT_MS", "45000")),
)
GEMINI_TTS_MULTI_REQUEST_TIMEOUT_MS = max(
    1000,
    int(os.getenv("GEMINI_TTS_MULTI_REQUEST_TIMEOUT_MS", "90000")),
)
GEMINI_TTS_ADMISSION_MAX_WAIT_MS = max(
    1000,
    int(os.getenv("GEMINI_TTS_ADMISSION_MAX_WAIT_MS", "18000")),
)
GEMINI_TTS_ADMISSION_SOFT_MARGIN_MS = max(
    0,
    int(os.getenv("GEMINI_TTS_ADMISSION_SOFT_MARGIN_MS", "1200")),
)
GEMINI_BATCH_MAX_ITEMS = max(1, int(os.getenv("GEMINI_BATCH_MAX_ITEMS", "64")))
GEMINI_BATCH_DEFAULT_PARALLEL = max(
    1,
    int(
        (
            os.getenv("GEMINI_BATCH_DEFAULT_PARALLEL")
            or os.getenv("GEMINI_BATCH_MAX_PARALLEL")
            or "4"
        )
    ),
)
GEMINI_BATCH_MAX_PARALLEL = max(
    GEMINI_BATCH_DEFAULT_PARALLEL,
    int(
        (
            os.getenv("GEMINI_BATCH_PARALLEL_LIMIT")
            or os.getenv("GEMINI_BATCH_MAX_PARALLEL")
            or "8"
        )
    ),
)
GEMINI_STUDIO_PAIR_GROUP_MAX_CONCURRENCY = 7
GEMINI_MULTI_SPEAKER_WINDOW_PAUSE_MS = max(
    0,
    int(os.getenv("GEMINI_MULTI_SPEAKER_WINDOW_PAUSE_MS", "30")),
)
KEY_DAILY_LIMIT = max(0, int(os.getenv("GEMINI_KEY_DAILY_LIMIT", "0")))
POOL_OVERALL_DAILY_LIMIT = max(0, int(os.getenv("GEMINI_POOL_OVERALL_DAILY_LIMIT", "0")))
_DISCOVERED_TTS_MODELS_CACHE: Dict[str, Dict[str, object]] = {}
_KEY_STATE_LOCK = threading.Lock()
_KEY_STATES: Dict[str, Dict[str, int]] = {}
_KEY_USAGE_DAY_KEY = time.strftime("%Y-%m-%d", time.gmtime())
_SERVER_API_KEY_POOL: tuple[str, ...] = tuple()
_SERVER_API_KEY_SET: frozenset[str] = frozenset()
_SERVER_POOL_NEXT_INDEX = 0
_API_POOLS_LOCK = threading.Lock()
_API_POOLS_CACHE: Optional[dict[str, Any]] = None
_API_POOLS_META: dict[str, Any] = {}
_LEGACY_ACTIVE_LEASES: Dict[str, list[LaneLease]] = {}
_RUNTIME_ALLOCATOR = GeminiRateAllocator(
    ALLOCATOR_CONFIG,
    auth_disable_ms=KEY_AUTH_DISABLE_MS,
    wait_slice_ms=ALLOCATOR_WAIT_SLICE_MS,
)
SPEAKER_KEY_AFFINITY_MAX = max(64, int(os.getenv("GEMINI_SPEAKER_KEY_AFFINITY_MAX", "4096")))
_SPEAKER_KEY_AFFINITY: Dict[str, Dict[str, Any]] = {}
GEMINI_API_KEY_PATTERN = re.compile(r"^AIza[A-Za-z0-9_-]{30,}$")
ERROR_CODE_API_KEY_MISSING = "GEMINI_API_KEY_MISSING"
ERROR_CODE_RUNTIME_SDK_UNAVAILABLE = "GEMINI_RUNTIME_SDK_UNAVAILABLE"
ERROR_CODE_ALL_KEYS_AUTH_FAILED = "GEMINI_ALL_KEYS_AUTH_FAILED"
ERROR_CODE_ALL_KEYS_RATE_LIMITED = "GEMINI_ALL_KEYS_RATE_LIMITED"
ERROR_CODE_KEY_POOL_OVERLOADED = "GEMINI_KEY_POOL_OVERLOADED"
ERROR_CODE_KEY_POOL_TIMEOUT = "GEMINI_KEY_POOL_TIMEOUT"
ERROR_CODE_ALLOCATOR_ACQUIRE_TIMEOUT = "GEMINI_ALLOCATOR_ACQUIRE_TIMEOUT"
ERROR_CODE_UPSTREAM_REQUEST_TIMEOUT = "GEMINI_UPSTREAM_REQUEST_TIMEOUT"
ERROR_CODE_UPSTREAM_MODEL_FAILED = "GEMINI_UPSTREAM_MODEL_FAILED"
KEY_POOL_MISSING_SUMMARY = (
    "Gemini key pool is empty. Configure GEMINI_API_KEYS_FILE (preferred), GEMINI_API_KEYS, or GEMINI_API_KEY."
)
MAX_PUBLIC_SUMMARY_ITEMS = 3
MAX_PUBLIC_SUMMARY_CHARS = 220
MAX_ERROR_CLASS_EVENTS = 300
_ERROR_CLASS_LOCK = threading.Lock()
_ERROR_CLASS_EVENTS: list[Dict[str, Any]] = []
DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
_DIALOGUE_LINE_PATTERN = re.compile(r"^\s*([^:\n]{1,120})\s*:\s*(.+)$")


def _parse_cors_origins(env_var: str) -> list[str]:
    raw = (os.getenv(env_var) or "").strip()
    if not raw:
        return DEFAULT_CORS_ORIGINS
    values = [item.strip() for item in raw.split(",") if item.strip()]
    return values or DEFAULT_CORS_ORIGINS


def _new_trace_id() -> str:
    return f"gem_{int(time.time() * 1000):x}_{os.urandom(3).hex()}"


def _normalize_trace_id(value: Optional[str]) -> str:
    token = re.sub(r"[^a-zA-Z0-9._:-]", "", str(value or "").strip())
    if token:
        return token[:96]
    return _new_trace_id()


def _normalize_speaker_affinity_id(value: object) -> str:
    token = re.sub(r"\s+", " ", str(value or "")).strip().lower()
    token = re.sub(r"[^a-z0-9 _.\-:]", "", token)
    if not token:
        return ""
    return token[:120]


def _extract_affinity_speakers(speaker_hint: str, speaker_voices: list[Dict[str, str]]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    candidates: list[object] = [speaker_hint]
    candidates.extend(entry.get("speaker") for entry in speaker_voices if isinstance(entry, dict))
    for raw in candidates:
        normalized = _normalize_speaker_affinity_id(raw)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        out.append(normalized)
    return out


def _prune_speaker_affinity_locked() -> None:
    overflow = len(_SPEAKER_KEY_AFFINITY) - SPEAKER_KEY_AFFINITY_MAX
    if overflow <= 0:
        return
    ordered = sorted(
        _SPEAKER_KEY_AFFINITY.items(),
        key=lambda item: int((item[1] or {}).get("updated_ms", 0)),
    )
    for speaker, _ in ordered[:overflow]:
        _SPEAKER_KEY_AFFINITY.pop(speaker, None)


def _resolve_affinity_preferred_key(speakers: list[str], key_pool: list[str]) -> Optional[str]:
    if not speakers or not key_pool:
        return None
    key_pool_set = set(key_pool)
    with _KEY_STATE_LOCK:
        for speaker in speakers:
            state = _SPEAKER_KEY_AFFINITY.get(speaker) or {}
            bound_key = str(state.get("key") or "").strip()
            if bound_key and bound_key in key_pool_set:
                return bound_key
    return None


def _bind_speakers_to_key(speakers: list[str], key: str) -> None:
    bound_key = str(key or "").strip()
    if not speakers or not bound_key:
        return
    now_ms = int(time.time() * 1000)
    with _KEY_STATE_LOCK:
        for speaker in speakers:
            normalized = _normalize_speaker_affinity_id(speaker)
            if not normalized:
                continue
            _SPEAKER_KEY_AFFINITY[normalized] = {"key": bound_key, "updated_ms": now_ms}
        _prune_speaker_affinity_locked()


def _evict_speaker_key_affinity_for_key(speakers: list[str], key: str) -> None:
    failed_key = str(key or "").strip()
    if not failed_key or not speakers:
        return
    with _KEY_STATE_LOCK:
        for speaker in speakers:
            normalized = _normalize_speaker_affinity_id(speaker)
            if not normalized:
                continue
            state = _SPEAKER_KEY_AFFINITY.get(normalized) or {}
            if str(state.get("key") or "").strip() == failed_key:
                _SPEAKER_KEY_AFFINITY.pop(normalized, None)


def _emit_stage_event(trace_id: str, stage: str, status: str, detail: Optional[Dict[str, object]] = None) -> None:
    payload: Dict[str, object] = {
        "event": "synthesis_stage",
        "engine": APP_NAME,
        "trace_id": trace_id,
        "stage": stage,
        "status": status,
        "ts": int(time.time() * 1000),
    }
    if detail:
        payload["detail"] = detail
    print(json.dumps(payload, ensure_ascii=True), flush=True)


class SynthesizeRequest(BaseModel):
    text: str = Field(min_length=1)
    voiceName: Optional[str] = None
    voice_id: Optional[str] = None
    speaker_voices: Optional[list[Dict[str, str]]] = None
    multi_speaker_mode: Optional[str] = None
    multi_speaker_max_concurrency: Optional[int] = None
    multi_speaker_retry_once: Optional[bool] = None
    multi_speaker_line_map: Optional[list[Dict[str, Any]]] = None
    apiKey: Optional[str] = ""
    speed: float = 1.0
    language: Optional[str] = None
    emotion: Optional[str] = None
    style: Optional[str] = None
    speaker: Optional[str] = None
    trace_id: Optional[str] = None
    return_line_chunks: Optional[bool] = None
    poolHint: Optional[str] = None


class BatchSynthesizeItem(SynthesizeRequest):
    id: Optional[str] = None


class BatchSynthesizeRequest(BaseModel):
    items: list[BatchSynthesizeItem] = Field(min_length=1)
    parallelism: Optional[int] = None


class TextGenerateRequest(BaseModel):
    userPrompt: str = Field(min_length=1)
    systemPrompt: Optional[str] = ""
    jsonMode: bool = False
    apiKey: Optional[str] = ""
    temperature: float = 0.7
    trace_id: Optional[str] = None


class ApiPoolsConfigUpdateRequest(BaseModel):
    version: Optional[int] = None
    pools: dict[str, Any]
    fallbackChains: Optional[dict[str, Any]] = None
    constraints: Optional[dict[str, Any]] = None
    sourcePolicy: Optional[dict[str, Any]] = None


def pcm16_to_wav(pcm_bytes: bytes, sample_rate: int = 24000) -> bytes:
    if len(pcm_bytes) % 2 != 0:
        raise ValueError("Gemini audio payload has invalid PCM length.")

    out = io.BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm_bytes)
    return out.getvalue()


def extract_pcm_bytes(response: object) -> bytes:
    candidates = getattr(response, "candidates", None) or []
    for cand in candidates:
        content = getattr(cand, "content", None)
        parts = getattr(content, "parts", None) or []
        for part in parts:
            inline_data = getattr(part, "inline_data", None)
            if inline_data is None:
                continue
            data = getattr(inline_data, "data", None)
            if data is None:
                continue
            if isinstance(data, bytes):
                return data
            if isinstance(data, str):
                return base64.b64decode(data)
    raise ValueError("No audio payload returned by Gemini.")


def resolve_language_code(text: str, hint: Optional[str]) -> str:
    normalized = str(hint or "").strip().lower()
    if normalized.startswith("hi"):
        return "hi"
    if re.search(r"[\u0900-\u097F]", str(text or "")):
        return "hi"
    return "en"


def _normalize_model_name(model_name: str) -> str:
    return normalize_model_name(model_name)


def _supports_generate_content(actions: object) -> bool:
    if not isinstance(actions, list) or len(actions) == 0:
        return True
    return any("generatecontent" in str(action or "").lower() for action in actions)


def _api_key_cache_key(api_key: str) -> str:
    return api_key_fingerprint(api_key)


def _is_valid_gemini_api_key(token: str) -> bool:
    return is_valid_api_key_shared(token)


def parse_api_keys(raw: str) -> list[str]:
    return parse_api_keys_shared(raw)


def _default_key_state() -> Dict[str, int]:
    return {
        "in_flight": 0,
        "cooldown_until_ms": 0,
        "rate_limit_strikes": 0,
        "last_used_ms": 0,
        "requests_total": 0,
        "success_total": 0,
        "failure_total": 0,
        "rate_limited_total": 0,
        "auth_failed_total": 0,
    }


def _reset_key_usage_counters(state: Dict[str, int]) -> None:
    state["requests_total"] = 0
    state["success_total"] = 0
    state["failure_total"] = 0
    state["rate_limited_total"] = 0
    state["auth_failed_total"] = 0


def _maybe_reset_key_usage_locked() -> None:
    global _KEY_USAGE_DAY_KEY
    current_day_key = time.strftime("%Y-%m-%d", time.gmtime())
    if current_day_key == _KEY_USAGE_DAY_KEY:
        return
    for state in _KEY_STATES.values():
        _reset_key_usage_counters(state)
    _KEY_USAGE_DAY_KEY = current_day_key


def _compute_overall_daily_limit(key_count: int) -> Optional[int]:
    if POOL_OVERALL_DAILY_LIMIT > 0:
        return POOL_OVERALL_DAILY_LIMIT
    if KEY_DAILY_LIMIT > 0:
        return KEY_DAILY_LIMIT * max(0, key_count)
    return None


def _resolve_key_file_path(path_hint: str) -> Path:
    raw_hint = str(path_hint or "").strip()
    candidates: list[Path] = []
    if raw_hint:
        hint_path = Path(raw_hint).expanduser()
        if hint_path.is_absolute():
            candidates.append(hint_path)
        else:
            candidates.append(RUNTIME_ROOT / hint_path)
            candidates.append(WORKSPACE_ROOT / hint_path)
    candidates.append(DEFAULT_GEMINI_API_KEYS_FILE)

    first_candidate: Optional[Path] = None
    seen: set[str] = set()
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except Exception:
            resolved = candidate
        marker = str(resolved)
        if marker in seen:
            continue
        seen.add(marker)
        if first_candidate is None:
            first_candidate = resolved
        try:
            if resolved.exists() and resolved.is_file():
                return resolved
        except Exception:
            continue
    return first_candidate or DEFAULT_GEMINI_API_KEYS_FILE


def _configured_key_file_path() -> str:
    return str(os.getenv("GEMINI_API_KEYS_FILE") or GEMINI_API_KEYS_FILE).strip()


def _resolved_key_file_path() -> str:
    return str(_resolve_key_file_path(_configured_key_file_path()))


def _build_server_api_key_pool() -> list[str]:
    file_tokens: list[str] = []
    path_hint = str(os.getenv("GEMINI_API_KEYS_FILE") or GEMINI_API_KEYS_FILE).strip()
    runtime_keys_raw = str(os.getenv("GEMINI_API_KEYS") or SERVER_API_KEYS_RAW).strip()
    runtime_single_key = str(os.getenv("GEMINI_API_KEY") or SERVER_API_KEY).strip()
    try:
        key_file = _resolve_key_file_path(path_hint)
        if key_file.exists() and key_file.is_file():
            file_tokens = parse_api_keys(key_file.read_text(encoding="utf-8", errors="ignore"))
    except Exception:
        file_tokens = []
    pool: list[str] = []
    seen = set()
    for candidate in [*parse_api_keys(runtime_keys_raw), *file_tokens, runtime_single_key]:
        token = str(candidate or "").strip()
        if not token or token in seen:
            continue
        if not _is_valid_gemini_api_key(token):
            continue
        seen.add(token)
        pool.append(token)
    return pool


def _resolve_api_pools_file_path() -> Path:
    configured = str(os.getenv("GEMINI_API_POOLS_FILE") or GEMINI_API_POOLS_FILE).strip()
    path = Path(configured).expanduser()
    if path.is_absolute():
        return path
    return (RUNTIME_ROOT / path).resolve()


def _sync_authoritative_runtime_free_pool(
    config: dict[str, Any],
) -> tuple[dict[str, Any], bool, list[str]]:
    configured_file_path = _configured_key_file_path()
    if configured_file_path:
        candidate = Path(configured_file_path).expanduser()
        if candidate.is_absolute():
            resolved_file_path = candidate.resolve()
        else:
            runtime_candidate = (RUNTIME_ROOT / candidate).resolve()
            resolved_file_path = runtime_candidate if runtime_candidate.exists() else (WORKSPACE_ROOT / candidate).resolve()
    else:
        resolved_file_path = DEFAULT_GEMINI_API_KEYS_FILE.resolve()
    file_exists = False
    file_keys: list[str] = []
    try:
        file_exists = bool(resolved_file_path.exists() and resolved_file_path.is_file())
        if file_exists:
            file_keys = parse_api_keys(
                resolved_file_path.read_text(encoding="utf-8", errors="ignore")
            )
    except Exception:
        file_exists = False
        file_keys = []
    return sync_authoritative_free_pool_shared(
        config,
        file_keys,
        str(resolved_file_path),
        file_exists=file_exists,
        failure_mode="keep_last_good",
    )


def _load_api_pool_config(force: bool = False) -> tuple[dict[str, Any], dict[str, Any]]:
    global _API_POOLS_CACHE, _API_POOLS_META
    with _API_POOLS_LOCK:
        if not force and isinstance(_API_POOLS_CACHE, dict):
            return dict(_API_POOLS_CACHE), dict(_API_POOLS_META)
        file_path = _resolve_api_pools_file_path()
        bootstrap_keys = list(_SERVER_API_KEY_POOL)
        config, meta = load_pool_config_shared(
            file_path=file_path,
            firestore_db=None,
            prefer_firestore=False,
            bootstrap_free_keys=bootstrap_keys,
        )
        if not flatten_pool_keys(config):
            legacy_pool = _build_server_api_key_pool()
            if legacy_pool:
                config = normalize_pool_config(config)
                config["pools"]["free"]["keys"] = list(legacy_pool)
        sync_warnings: list[str] = []
        config, synced_changed, sync_warnings = _sync_authoritative_runtime_free_pool(config)
        if synced_changed:
            try:
                config = save_pool_config_shared(
                    file_path=file_path,
                    config=config,
                    firestore_db=None,
                )
            except Exception:
                sync_warnings.append(
                    "Authoritative free-pool sync could not be persisted; using in-memory pool config."
                )
        meta = dict(meta if isinstance(meta, dict) else {})
        meta["warnings"] = list(sync_warnings)
        meta["sourcePolicy"] = dict(config.get("sourcePolicy") or {})
        _API_POOLS_CACHE = dict(config)
        _API_POOLS_META = dict(meta)
        all_keys = flatten_pool_keys(config)
        if all_keys:
            _RUNTIME_ALLOCATOR.ensure_keys(all_keys)
        return dict(config), dict(meta)


def _pool_keys_for_hint(pool_hint: Optional[str]) -> list[str]:
    config, _meta = _load_api_pool_config()
    return resolve_effective_keys_shared(config, normalize_pool_name_shared(pool_hint))


def _resolve_request_key_plan(request_key: str, pool_hint: Optional[str] = None) -> tuple[list[str], Optional[str]]:
    request_token = str(request_key or "").strip()
    primary_pool = _pool_keys_for_hint(pool_hint)
    meta_source = str((_API_POOLS_META or {}).get("source") or "").strip().lower()
    if meta_source in {"default", "bootstrap"}:
        primary_pool = list(_SERVER_API_KEY_POOL)
    if not primary_pool:
        primary_pool = list(_SERVER_API_KEY_POOL)
    fallback_request_key: Optional[str] = None
    if request_token and _is_valid_gemini_api_key(request_token) and request_token not in set(primary_pool):
        fallback_request_key = request_token
    if not primary_pool and fallback_request_key:
        primary_pool = [fallback_request_key]
        fallback_request_key = None
    return primary_pool, fallback_request_key


def resolve_request_api_key_pool(request_key: str, pool_hint: Optional[str] = "pro_plus") -> list[str]:
    primary_pool, fallback_request_key = _resolve_request_key_plan(request_key, pool_hint=pool_hint)
    if fallback_request_key:
        return [*primary_pool, fallback_request_key]
    return primary_pool


_SERVER_API_KEY_POOL = tuple(_build_server_api_key_pool())
_SERVER_API_KEY_SET = frozenset(_SERVER_API_KEY_POOL)


def _refresh_server_api_key_pool() -> tuple[str, ...]:
    global _SERVER_API_KEY_POOL, _SERVER_API_KEY_SET, _SERVER_POOL_NEXT_INDEX
    next_pool = tuple(_build_server_api_key_pool())
    with _KEY_STATE_LOCK:
        _SERVER_API_KEY_POOL = next_pool
        _SERVER_API_KEY_SET = frozenset(next_pool)
        _SERVER_POOL_NEXT_INDEX = 0
    if next_pool:
        _RUNTIME_ALLOCATOR.ensure_keys(list(next_pool))
    _load_api_pool_config(force=True)
    return next_pool


def _ensure_runtime_pool_or_raise(
    trace_id: str,
    api_key: Optional[str] = None,
    pool_hint: Optional[str] = None,
) -> tuple[list[str], Optional[str], list[str]]:
    primary_key_pool, fallback_request_key = _resolve_request_key_plan(
        str(api_key or "").strip(),
        pool_hint=pool_hint,
    )
    effective_key_pool = list(primary_key_pool)
    if fallback_request_key:
        effective_key_pool.append(fallback_request_key)

    # When the in-memory server pool is empty, force a refresh before honoring cached config pools.
    if not _SERVER_API_KEY_POOL and not str(api_key or "").strip():
        refreshed_pool = list(_refresh_server_api_key_pool())
        if refreshed_pool:
            primary_key_pool = list(refreshed_pool)
            fallback_request_key = None
            effective_key_pool = list(refreshed_pool)

    if not effective_key_pool:
        _load_api_pool_config(force=True)
        refreshed_pool = list(_refresh_server_api_key_pool())
        if refreshed_pool:
            primary_key_pool, fallback_request_key = _resolve_request_key_plan(
                str(api_key or "").strip(),
                pool_hint=pool_hint,
            )
            if not primary_key_pool:
                primary_key_pool = refreshed_pool
            effective_key_pool = list(primary_key_pool)
            if fallback_request_key and fallback_request_key not in effective_key_pool:
                effective_key_pool.append(fallback_request_key)

    if not effective_key_pool:
        raise HTTPException(
            status_code=400,
            detail={
                "errorCode": ERROR_CODE_API_KEY_MISSING,
                "error": "Gemini API key is missing.",
                "summary": KEY_POOL_MISSING_SUMMARY,
                "trace_id": trace_id,
                "retryAfterMs": 0,
            },
        )

    if genai is None or types is None:
        raise HTTPException(
            status_code=503,
            detail={
                "errorCode": ERROR_CODE_RUNTIME_SDK_UNAVAILABLE,
                "error": "google-genai SDK is unavailable in runtime.",
                "summary": "Gemini runtime dependencies are unavailable. Install runtime requirements.",
                "trace_id": trace_id,
                "retryAfterMs": 0,
            },
        )

    for key in effective_key_pool:
        _ensure_key_state(key)
    return primary_key_pool, fallback_request_key, effective_key_pool


def _ensure_key_state(key: str) -> None:
    _RUNTIME_ALLOCATOR.ensure_keys([key])


def _acquire_key_for_request(
    pool: list[str],
    blocked: set[str],
    fallback_request_key: Optional[str] = None,
    preferred_key: Optional[str] = None,
) -> tuple[Optional[str], int, int]:
    effective_pool = list(pool)
    fallback_key = str(fallback_request_key or "").strip()
    if fallback_key and fallback_key not in effective_pool:
        effective_pool.append(fallback_key)
    if not effective_pool:
        return None, -1, 0
    acquire = _RUNTIME_ALLOCATOR.acquire_for_task(
        task="text",
        key_pool=effective_pool,
        requested_tokens=1,
        blocked_keys=blocked,
        wait_timeout_ms=KEY_WAIT_SLICE_MS,
        preferred_key=preferred_key,
    )
    if acquire.lease is None:
        return None, -1, max(0, int(acquire.retry_after_ms))
    key = str(acquire.lease.key)
    _LEGACY_ACTIVE_LEASES.setdefault(key, []).append(acquire.lease)
    return key, int(acquire.lease.key_index), 0


def _release_key(key: str, success: bool) -> None:
    lease_stack = _LEGACY_ACTIVE_LEASES.get(str(key))
    if not lease_stack:
        return
    lease = lease_stack.pop()
    if not lease_stack:
        _LEGACY_ACTIVE_LEASES.pop(str(key), None)
    _RUNTIME_ALLOCATOR.release(lease, success=success, used_tokens=lease.reserved_tokens)


def _apply_rate_limit_cooldown(key: str) -> int:
    safe_key = str(key or "").strip()
    if not safe_key:
        return _RUNTIME_ALLOCATOR.window_ms
    model_id = resolve_text_model_candidates()[0] if resolve_text_model_candidates() else ""
    if model_id:
        _RUNTIME_ALLOCATOR.mark_rate_limited(safe_key, model_id)
    return _RUNTIME_ALLOCATOR.window_ms


def _record_auth_failure(key: str) -> None:
    safe_key = str(key or "").strip()
    if not safe_key:
        return
    _RUNTIME_ALLOCATOR.mark_auth_failed(safe_key)


def _key_snapshot(pool: list[str]) -> list[Dict[str, Any]]:
    snapshot = _RUNTIME_ALLOCATOR.snapshot(pool)
    keys = snapshot.get("keys")
    if isinstance(keys, list):
        return keys
    return []


def _build_pool_summary(pool_name: str, config: dict[str, Any]) -> dict[str, Any]:
    pools = config.get("pools") if isinstance(config.get("pools"), dict) else {}
    direct_keys = list((pools.get(pool_name) or {}).get("keys") or [])
    effective_keys = resolve_effective_keys_shared(config, pool_name)
    snapshot = _RUNTIME_ALLOCATOR.snapshot(effective_keys)
    pool_meta = snapshot.get("pool") if isinstance(snapshot.get("pool"), dict) else {}
    return {
        "pool": pool_name,
        "directKeyCount": len(direct_keys),
        "effectiveKeyCount": len(effective_keys),
        "effectiveChain": list(config.get("fallbackChains", {}).get(pool_name) or []),
        "allocator": {
            "keyCount": int(pool_meta.get("keyCount") or 0),
            "healthyKeys": int(pool_meta.get("healthyKeys") or 0),
            "unhealthyKeys": int(pool_meta.get("unhealthyKeys") or 0),
            "atLimitKeys": int(pool_meta.get("atLimitKeys") or 0),
            "inFlightTotal": int(pool_meta.get("inFlightTotal") or 0),
            "nextResetInMs": int(pool_meta.get("nextResetInMs") or 0),
        },
    }


def _admin_api_pools_payload() -> dict[str, Any]:
    config, meta = _load_api_pool_config()
    duplicates = duplicate_key_memberships(config)
    all_keys = flatten_pool_keys(config)
    summaries = {
        pool_name: _build_pool_summary(pool_name, config)
        for pool_name in POOL_NAMES
    }
    return {
        "ok": len(duplicates) == 0,
        "engine": APP_NAME,
        "timestampMs": int(time.time() * 1000),
        "config": config,
        "meta": meta,
        "validation": {
            "uniqueKeyMembership": bool(
                (config.get("constraints") or {}).get("uniqueKeyMembership", True)
            ),
            "duplicateKeys": duplicates,
        },
        "warnings": list((meta or {}).get("warnings") or []),
        "sourcePolicy": dict(config.get("sourcePolicy") or {}),
        "poolSummaries": summaries,
        "allKeyCount": len(all_keys),
    }


def _admin_api_pools_usage_payload() -> dict[str, Any]:
    config, meta = _load_api_pool_config()
    pools = config.get("pools") if isinstance(config.get("pools"), dict) else {}
    payload: dict[str, Any] = {}
    for pool_name in POOL_NAMES:
        direct_keys = list((pools.get(pool_name) or {}).get("keys") or [])
        effective_keys = resolve_effective_keys_shared(config, pool_name)
        direct_snapshot = _RUNTIME_ALLOCATOR.snapshot(direct_keys)
        effective_snapshot = _RUNTIME_ALLOCATOR.snapshot(effective_keys)
        payload[pool_name] = {
            "pool": pool_name,
            "directKeyCount": len(direct_keys),
            "effectiveKeyCount": len(effective_keys),
            "effectiveChain": list(config.get("fallbackChains", {}).get(pool_name) or []),
            "direct": direct_snapshot,
            "effective": effective_snapshot,
        }
    return {
        "ok": True,
        "engine": APP_NAME,
        "timestampMs": int(time.time() * 1000),
        "meta": meta,
        "warnings": list((meta or {}).get("warnings") or []),
        "sourcePolicy": dict(config.get("sourcePolicy") or {}),
        "usage": payload,
    }


def discover_dynamic_tts_models(client: object, api_key: str) -> list[str]:
    cache_key = _api_key_cache_key(api_key)
    now = time.time()
    cached = _DISCOVERED_TTS_MODELS_CACHE.get(cache_key)
    if cached and float(cached.get("expires", 0)) > now:
        cached_models = cached.get("models")
        if isinstance(cached_models, list):
            return [_normalize_model_name(str(item or "")) for item in cached_models if str(item or "").strip()]

    discovered: list[str] = []
    seen = set()
    try:
        pager = client.models.list(config={"query_base": True, "page_size": 100})
        scanned = 0
        for model in pager:
            scanned += 1
            if scanned > MODEL_DISCOVERY_SCAN_LIMIT:
                break
            model_name = _normalize_model_name(getattr(model, "name", ""))
            if not model_name:
                continue
            lower = model_name.lower()
            if "gemini" not in lower or "tts" not in lower:
                continue
            if not _supports_generate_content(getattr(model, "supported_actions", None)):
                continue
            if model_name in seen:
                continue
            seen.add(model_name)
            discovered.append(model_name)
    except Exception as exc:  # noqa: BLE001
        print(
            json.dumps(
                {
                    "event": "model_discovery",
                    "engine": APP_NAME,
                    "status": "error",
                    "detail": str(exc)[:200],
                },
                ensure_ascii=True,
            ),
            flush=True,
        )

    _DISCOVERED_TTS_MODELS_CACHE[cache_key] = {
        "expires": now + MODEL_DISCOVERY_TTL_SECONDS,
        "models": discovered,
    }
    return discovered


def resolve_tts_model_candidates(client: Optional[object] = None, api_key: Optional[str] = None) -> list[str]:
    # Strict allocator-driven route for TTS. Dynamic discovery is intentionally ignored.
    configured = _normalize_model_name(str(TTS_MODEL or ""))
    route = list(TTS_MODEL_FALLBACKS)
    if configured and configured in route:
        return [configured, *[item for item in route if item != configured]]
    return route


def resolve_text_model_candidates() -> list[str]:
    # Strict allocator-driven route for non-TTS generation.
    return list(TEXT_MODEL_FALLBACKS)


def extract_text_content(response: object) -> str:
    primary = str(getattr(response, "text", "") or "").strip()
    if primary:
        return primary

    candidates = getattr(response, "candidates", None) or []
    for cand in candidates:
        content = getattr(cand, "content", None)
        parts = getattr(content, "parts", None) or []
        for part in parts:
            text_value = str(getattr(part, "text", "") or "").strip()
            if text_value:
                return text_value
    return ""


def _is_auth_error(message: str) -> bool:
    lower = str(message or "").lower()
    return (
        "api key" in lower
        or "api_key_invalid" in lower
        or "invalid api key" in lower
        or "api key not valid" in lower
        or "permission_denied" in lower
        or "permission denied" in lower
        or "unauthorized" in lower
        or "forbidden" in lower
        or "invalid argument" in lower and "api" in lower
    )


def _is_rate_limit_error(message: str) -> bool:
    lower = str(message or "").lower()
    return (
        "429" in lower
        or "quota exceeded" in lower
        or "insufficient_quota" in lower
        or "resource_exhausted" in lower
        or "resource exhausted" in lower
        or "rate limit" in lower
        or "quota" in lower
        or "too many requests" in lower
    )


def _is_timeout_error(message: str) -> bool:
    lower = str(message or "").lower()
    return (
        "timed out" in lower
        or "timeout" in lower
        or "deadline exceeded" in lower
        or "504" in lower
    )


def _retry_after_from_key_states(key_states: list[Dict[str, Any]]) -> int:
    ready_values: list[int] = []
    for state in key_states:
        try:
            ready_in_ms = int(state.get("readyInMs", 0))
        except Exception:
            ready_in_ms = 0
        if ready_in_ms > 0:
            ready_values.append(ready_in_ms)
    if not ready_values:
        return 0
    return min(ready_values)


def _safe_int(value: object, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return int(default)


def _resolve_tts_route_model() -> str:
    route = list(ALLOCATOR_CONFIG.routes.get("tts") or [])
    if route:
        return str(route[0] or "").strip()
    return str(TTS_MODEL or "").strip()


def _effective_tts_route_limits() -> Dict[str, Any]:
    tts_model = _resolve_tts_route_model()
    model_limit = ALLOCATOR_CONFIG.models.get(tts_model)
    return {
        "model": tts_model,
        "rpm": max(0, int(model_limit.rpm)) if model_limit is not None else 0,
        "tpm": max(0, int(model_limit.tpm)) if model_limit is not None else 0,
        "windowSeconds": max(1, int(ALLOCATOR_CONFIG.window_seconds)),
        "defaultWaitTimeoutMs": max(1, int(ALLOCATOR_CONFIG.default_wait_timeout_ms)),
    }


def _classification_for_error_code(error_code: str) -> str:
    code = str(error_code or "").strip().upper()
    if code == ERROR_CODE_UPSTREAM_REQUEST_TIMEOUT:
        return "upstream_timeout"
    if code in {ERROR_CODE_ALLOCATOR_ACQUIRE_TIMEOUT, ERROR_CODE_KEY_POOL_TIMEOUT}:
        return "acquire_timeout"
    if code == ERROR_CODE_KEY_POOL_OVERLOADED:
        return "capacity_overload"
    if code == ERROR_CODE_ALL_KEYS_RATE_LIMITED:
        return "rate_limited"
    if code in {ERROR_CODE_ALL_KEYS_AUTH_FAILED, ERROR_CODE_API_KEY_MISSING}:
        return "auth"
    if code == ERROR_CODE_RUNTIME_SDK_UNAVAILABLE:
        return "misconfig"
    return "upstream_failure"


def _record_error_classification(error_code: str) -> None:
    classification = _classification_for_error_code(error_code)
    now_ms = int(time.time() * 1000)
    with _ERROR_CLASS_LOCK:
        _ERROR_CLASS_EVENTS.append(
            {
                "ts": now_ms,
                "classification": classification,
                "errorCode": str(error_code or "").strip(),
            }
        )
        if len(_ERROR_CLASS_EVENTS) > MAX_ERROR_CLASS_EVENTS:
            del _ERROR_CLASS_EVENTS[: len(_ERROR_CLASS_EVENTS) - MAX_ERROR_CLASS_EVENTS]


def _recent_error_class_counts() -> Dict[str, int]:
    counts: Dict[str, int] = {}
    with _ERROR_CLASS_LOCK:
        events = list(_ERROR_CLASS_EVENTS)
    for item in events:
        classification = str(item.get("classification") or "").strip().lower()
        if not classification:
            continue
        counts[classification] = counts.get(classification, 0) + 1
    return counts


print(
    json.dumps(
        {
            "event": "allocator_limits",
            "engine": APP_NAME,
            "task": "tts",
            "effectiveTtsLimits": _effective_tts_route_limits(),
        },
        ensure_ascii=True,
    ),
    flush=True,
)


def _estimate_tts_pool_pressure(key_pool: list[str], requested_tokens: int) -> Dict[str, Any]:
    snapshot = _RUNTIME_ALLOCATOR.snapshot(key_pool)
    key_states = list(snapshot.get("keys") or [])
    model_entries = list(snapshot.get("models") or [])
    tts_model = _resolve_tts_route_model()
    safe_requested_tokens = max(1, int(requested_tokens or 1))

    in_flight_total = 0
    available_lanes = 0
    nearest_ready_ms: Optional[int] = None
    nearest_reset_ms: Optional[int] = None

    for key_entry in key_states:
        models = list((key_entry or {}).get("models") or [])
        lane_entry = None
        for model in models:
            if str((model or {}).get("model") or "").strip() == tts_model:
                lane_entry = model or {}
                break
        if lane_entry is None:
            continue

        ready_in_ms = max(0, _safe_int(lane_entry.get("readyInMs"), 0))
        lane_usage = lane_entry.get("usage") or {}
        lane_remaining = lane_entry.get("remaining") or {}
        lane_window = lane_entry.get("window") or {}

        rpm_remaining = max(0, _safe_int(lane_remaining.get("rpm"), 0))
        tpm_remaining = max(0, _safe_int(lane_remaining.get("tpm"), 0))
        in_flight_total += max(0, _safe_int(lane_usage.get("inFlightRequests"), 0))
        reset_in_ms = max(0, _safe_int(lane_window.get("resetsInMs"), 0))

        if ready_in_ms <= 0:
            rpm_slots = max(0, rpm_remaining)
            tpm_slots = max(0, tpm_remaining // safe_requested_tokens)
            lane_slots = 0
            if rpm_slots > 0 and tpm_slots > 0:
                lane_slots = min(rpm_slots, tpm_slots)
            available_lanes += max(0, lane_slots)
            if lane_slots <= 0 and reset_in_ms > 0:
                nearest_reset_ms = (
                    reset_in_ms
                    if nearest_reset_ms is None
                    else min(nearest_reset_ms, reset_in_ms)
                )
        else:
            nearest_ready_ms = (
                ready_in_ms if nearest_ready_ms is None else min(nearest_ready_ms, ready_in_ms)
            )

    tts_model_entry = None
    for model in model_entries:
        if str((model or {}).get("model") or "").strip() == tts_model:
            tts_model_entry = model or {}
            break
    if tts_model_entry:
        pool_meta = tts_model_entry.get("pool") or {}
        pool_reset = max(0, _safe_int(pool_meta.get("nextResetInMs"), 0))
        if pool_reset > 0:
            nearest_reset_ms = pool_reset if nearest_reset_ms is None else min(nearest_reset_ms, pool_reset)

    estimated_wait_ms = 0
    wait_candidates = [value for value in [nearest_ready_ms, nearest_reset_ms] if value is not None and int(value) > 0]
    if available_lanes <= 0 and wait_candidates:
        estimated_wait_ms = min(int(value) for value in wait_candidates)

    retry_after_ms = max(
        _retry_after_from_key_states(key_states),
        int(estimated_wait_ms),
    )
    if in_flight_total <= 0:
        in_flight_total = max(0, _safe_int((snapshot.get("pool") or {}).get("inFlightTotal"), 0))
    return {
        "keyPoolSize": len(key_pool),
        "availableLanes": max(0, int(available_lanes)),
        "inFlight": max(0, int(in_flight_total)),
        "estimatedWaitMs": max(0, int(estimated_wait_ms)),
        "retryAfterMs": max(0, int(retry_after_ms)),
        "ttsModel": tts_model,
        "keyStates": key_states,
    }


def _resolve_admission_wait_budget_ms(remaining_budget_ms: int) -> int:
    remaining = max(1, int(remaining_budget_ms))
    budget = min(remaining, GEMINI_TTS_ADMISSION_MAX_WAIT_MS)
    if GEMINI_TTS_ADMISSION_SOFT_MARGIN_MS > 0 and remaining > GEMINI_TTS_ADMISSION_SOFT_MARGIN_MS:
        budget = min(budget, remaining - GEMINI_TTS_ADMISSION_SOFT_MARGIN_MS)
    return max(1, int(budget))


def _build_overload_detail_payload(
    *,
    trace_id: str,
    speech_mode_requested: str,
    window_index: int,
    window_total: int,
    attempt: int,
    timeout_ms: int,
    pressure: Dict[str, Any],
) -> Dict[str, Any]:
    retry_after_ms = max(250, int(pressure.get("retryAfterMs") or 0))
    available_lanes = max(0, int(pressure.get("availableLanes") or 0))
    estimated_wait_ms = max(retry_after_ms, int(pressure.get("estimatedWaitMs") or 0))
    key_pool_size = max(0, int(pressure.get("keyPoolSize") or 0))
    return {
        "error": "Gemini key pool is temporarily overloaded.",
        "errorCode": ERROR_CODE_KEY_POOL_OVERLOADED,
        "classification": "capacity_overload",
        "reason": "capacity_pressure",
        "summary": (
            f"Gemini TTS capacity is saturated (availableLanes={available_lanes}, "
            f"keyPoolSize={key_pool_size})."
        )[:220],
        "trace_id": trace_id,
        "timeoutMs": int(timeout_ms),
        "retryAfterMs": retry_after_ms,
        "estimatedWaitMs": estimated_wait_ms,
        "keyPoolSize": key_pool_size,
        "availableLanes": available_lanes,
        "inFlight": max(0, int(pressure.get("inFlight") or 0)),
        "ttsModel": str(pressure.get("ttsModel") or ""),
        "windowIndex": max(1, int(window_index)),
        "windowTotal": max(1, int(window_total)),
        "attemptsUsed": max(0, int(attempt)),
        "speechModeRequested": speech_mode_requested,
        "keyStates": list(pressure.get("keyStates") or []),
    }


def _normalize_summary_fragment(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _truncate_summary(value: str, limit: int = MAX_PUBLIC_SUMMARY_CHARS) -> str:
    clean = _normalize_summary_fragment(value)
    if not clean:
        return ""
    if len(clean) <= limit:
        return clean
    if limit <= 3:
        return clean[:limit]
    return f"{clean[: max(0, limit - 3)].rstrip()}..."


def _summarize_terminal_failure(
    model_errors: list[str],
    last_exc: Optional[Exception],
    default_summary: str,
) -> str:
    if model_errors:
        unique_fragments: list[str] = []
        seen = set()
        for raw in model_errors:
            normalized = _normalize_summary_fragment(raw)
            if not normalized:
                continue
            key = normalized.lower()
            if key in seen:
                continue
            seen.add(key)
            unique_fragments.append(normalized)
        if unique_fragments:
            visible = unique_fragments[:MAX_PUBLIC_SUMMARY_ITEMS]
            omitted = max(0, len(unique_fragments) - len(visible))
            summary = " | ".join(visible)
            if omitted > 0:
                summary = f"{summary} (+{omitted} more)"
            return _truncate_summary(summary, MAX_PUBLIC_SUMMARY_CHARS)
    if last_exc is not None:
        return _truncate_summary(str(last_exc), MAX_PUBLIC_SUMMARY_CHARS)
    return _truncate_summary(default_summary, MAX_PUBLIC_SUMMARY_CHARS)


def _classify_terminal_error_code(
    model_attempts: list[Dict[str, Any]],
    timed_out: bool,
    pool_exhausted: bool,
) -> str:
    if timed_out:
        if pool_exhausted or not model_attempts:
            error_code = ERROR_CODE_ALLOCATOR_ACQUIRE_TIMEOUT
        else:
            error_code = ERROR_CODE_ALLOCATOR_ACQUIRE_TIMEOUT
            for attempt in model_attempts:
                detail = str(attempt.get("error") or "").strip()
                if _is_timeout_error(detail):
                    error_code = ERROR_CODE_UPSTREAM_REQUEST_TIMEOUT
                    break
        # #region agent log
        try:
            import json as _agent_json  # type: ignore[import-not-found]
            with open("debug-d5d65f.log", "a", encoding="utf-8") as _agent_f:
                _agent_f.write(
                    _agent_json.dumps(
                        {
                            "sessionId": "d5d65f",
                            "runId": "pre-fix",
                            "hypothesisId": "H_timeout_classification",
                            "location": "backend/engines/gemini-runtime/app.py:_classify_terminal_error_code",
                            "message": "Classified terminal timeout error code",
                            "data": {
                                "timed_out": bool(timed_out),
                                "pool_exhausted": bool(pool_exhausted),
                                "model_attempt_count": len(model_attempts),
                                "error_code": error_code,
                            },
                            "timestamp": int(time.time() * 1000),
                        }
                    )
                    + "\n"
                )
        except Exception:
            pass
        # #endregion
        return error_code
    if not model_attempts:
        return ERROR_CODE_UPSTREAM_MODEL_FAILED
    saw_auth = False
    saw_rate = False
    saw_non_rate_non_noise = False
    for attempt in model_attempts:
        detail = str(attempt.get("error") or "").strip()
        lowered = detail.lower()
        if _is_timeout_error(detail):
            return ERROR_CODE_UPSTREAM_REQUEST_TIMEOUT
        if _is_auth_error(detail):
            saw_auth = True
        elif _is_rate_limit_error(detail):
            saw_rate = True
        else:
            if "no audio payload returned by gemini" not in lowered:
                saw_non_rate_non_noise = True
    if saw_auth and not saw_rate and not saw_non_rate_non_noise:
        return ERROR_CODE_ALL_KEYS_AUTH_FAILED
    if saw_rate and not saw_auth and not saw_non_rate_non_noise:
        return ERROR_CODE_ALL_KEYS_RATE_LIMITED
    return ERROR_CODE_UPSTREAM_MODEL_FAILED


def _build_genai_client(api_key: str, timeout_ms: int) -> object:
    if genai is None:
        raise RuntimeError("google-genai SDK is unavailable in runtime.")
    bounded_timeout = max(1000, int(timeout_ms))
    if types is not None and hasattr(types, "HttpOptions"):
        try:
            http_options = types.HttpOptions(timeout=bounded_timeout)
            try:
                return genai.Client(api_key=api_key, http_options=http_options)
            except TypeError:
                # Some test doubles only accept api_key.
                return genai.Client(api_key=api_key)
        except Exception:
            return genai.Client(api_key=api_key)
    return genai.Client(api_key=api_key)


def _normalize_synthesis_text(raw_text: str) -> str:
    normalized_lines = [
        re.sub(r"\s+", " ", str(line or "")).strip()
        for line in str(raw_text or "").splitlines()
    ]
    text = "\n".join([line for line in normalized_lines if line]).strip()
    if text:
        return text
    return re.sub(r"\s+", " ", str(raw_text or "")).strip()


def _normalize_speaker_voices(raw_speaker_voices: object, target_voice: str) -> list[Dict[str, str]]:
    normalized_speaker_voices: list[Dict[str, str]] = []
    seen_speakers = set()
    if not isinstance(raw_speaker_voices, list):
        return normalized_speaker_voices
    for item in raw_speaker_voices:
        if not isinstance(item, dict):
            continue
        speaker = re.sub(r"\s+", " ", str(item.get("speaker") or "")).strip()
        if not speaker:
            continue
        speaker_key = speaker.lower()
        if speaker_key in seen_speakers:
            continue
        seen_speakers.add(speaker_key)
        voice_name = (
            str(item.get("voiceName") or item.get("voice_id") or item.get("voice") or "").strip()
            or target_voice
        )
        normalized_speaker_voices.append(
            {
                "speaker": speaker,
                "voiceName": voice_name,
            }
        )
    return normalized_speaker_voices


def _build_text_order_two_speaker_windows(
    text: str,
    speaker_voices: list[Dict[str, str]],
    target_voice: str,
) -> list[Dict[str, Any]]:
    if len(speaker_voices) <= 2:
        return [{"text": text, "speakerVoices": speaker_voices}]

    lines = [line.strip() for line in str(text or "").splitlines() if line.strip()]
    if not lines:
        return [{"text": text, "speakerVoices": []}]

    voice_map: Dict[str, str] = {}
    for entry in speaker_voices:
        speaker = str(entry.get("speaker") or "").strip()
        if not speaker:
            continue
        voice_map[speaker.lower()] = str(entry.get("voiceName") or target_voice).strip() or target_voice

    windows: list[Dict[str, Any]] = []
    active_lines: list[str] = []
    active_speakers: list[str] = []
    active_keys: set[str] = set()

    def flush_window() -> None:
        if not active_lines:
            return
        speaker_entries = [
            {
                "speaker": speaker,
                "voiceName": voice_map.get(speaker.lower(), target_voice),
            }
            for speaker in active_speakers
        ]
        windows.append(
            {
                "text": "\n".join(active_lines).strip(),
                "speakerVoices": speaker_entries,
            }
        )
        active_lines.clear()
        active_speakers.clear()
        active_keys.clear()

    for line in lines:
        matched = _DIALOGUE_LINE_PATTERN.match(line)
        if matched:
            speaker = re.sub(r"\s+", " ", matched.group(1)).strip()
            speaker_key = speaker.lower()
            if speaker_key and speaker_key not in active_keys and len(active_keys) >= 2:
                flush_window()
            if speaker_key and speaker_key not in active_keys:
                active_keys.add(speaker_key)
                active_speakers.append(speaker)
        active_lines.append(line)

    flush_window()
    if not windows:
        return [{"text": text, "speakerVoices": []}]
    return windows


def _normalize_multi_speaker_mode(raw_mode: object) -> str:
    token = str(raw_mode or "").strip().lower()
    if token in {"studio_pair_groups", "legacy_windows", "off"}:
        return token
    if not token:
        return "legacy_windows"
    return "legacy_windows"


def _normalize_multi_speaker_line_map(raw_line_map: object) -> list[Dict[str, Any]]:
    normalized = normalize_multi_speaker_line_map_shared(raw_line_map)
    out: list[Dict[str, Any]] = []
    for item in normalized:
        text = _normalize_synthesis_text(str(item.get("text") or ""))
        if not text:
            continue
        out.append(
            {
                "lineIndex": int(item.get("lineIndex", 0)),
                "speaker": str(item.get("speaker") or "").strip(),
                "text": text,
            }
        )
    return out


def _split_int16_pcm_for_lines(pcm_bytes: bytes, line_weights: list[float]) -> tuple[list[bytes], bool]:
    return split_int16_pcm_for_lines_shared(pcm_bytes, line_weights)


def _build_studio_pair_groups(
    line_map: list[Dict[str, Any]],
    speaker_voices: list[Dict[str, str]],
    target_voice: str,
) -> list[Dict[str, Any]]:
    return build_studio_pair_groups_shared(line_map, speaker_voices, target_voice)


def _resolve_adaptive_group_concurrency(
    *,
    groups: list[Dict[str, Any]],
    requested_concurrency: int,
    effective_key_pool: list[str],
) -> tuple[int, Dict[str, Any]]:
    concurrency_cap = max(1, int(requested_concurrency))
    group_token_estimate = max(
        1,
        max(
            (
                estimate_text_tokens(str(group.get("text") or ""))
                for group in groups
            ),
            default=1,
        ),
    )
    pressure = _estimate_tts_pool_pressure(
        key_pool=effective_key_pool,
        requested_tokens=group_token_estimate,
    )
    available_lanes = max(1, int(pressure.get("availableLanes") or 0))
    effective_concurrency = min(
        concurrency_cap,
        GEMINI_STUDIO_PAIR_GROUP_MAX_CONCURRENCY,
        len(groups),
        max(1, len(effective_key_pool)),
        available_lanes,
    )
    return max(1, int(effective_concurrency)), pressure


def _synthesize_studio_pair_groups(
    *,
    trace_id: str,
    target_voice: str,
    language_code: str,
    speaker_hint: str,
    normalized_speaker_voices: list[Dict[str, str]],
    normalized_line_map: list[Dict[str, Any]],
    primary_key_pool: list[str],
    fallback_request_key: Optional[str],
    effective_key_pool: list[str],
    requested_concurrency: int,
    retry_once: bool,
) -> Dict[str, Any]:
    groups = _build_studio_pair_groups(
        line_map=normalized_line_map,
        speaker_voices=normalized_speaker_voices,
        target_voice=target_voice,
    )
    if not groups:
        raise HTTPException(status_code=400, detail="multi_speaker_line_map does not contain valid grouped dialogue.")

    effective_concurrency, pool_pressure = _resolve_adaptive_group_concurrency(
        groups=groups,
        requested_concurrency=requested_concurrency,
        effective_key_pool=effective_key_pool,
    )
    max_attempts = 2 if retry_once else 1

    _emit_stage_event(
        trace_id,
        "synthesis",
        "start",
        {
            "strategy": "studio_pair_groups",
            "lineCount": len(normalized_line_map),
            "groupCount": len(groups),
            "concurrency": effective_concurrency,
            "keyPoolSize": len(effective_key_pool),
            "availableLanes": int(pool_pressure.get("availableLanes") or 0),
            "estimatedWaitMs": int(pool_pressure.get("estimatedWaitMs") or 0),
            "retryOnce": bool(retry_once),
        },
    )

    def run_group(group: Dict[str, Any]) -> Dict[str, Any]:
        group_lines: list[Dict[str, Any]] = list(group.get("lines") or [])
        group_weights = [
            float(max(1, len(str(line.get("text") or "").strip().split())))
            for line in group_lines
        ]
        last_exc: Optional[Exception] = None
        for attempt in range(1, max_attempts + 1):
            try:
                pcm_bytes, model_used, speech_mode_used, key_index_used = _synthesize_pcm_with_key_pool(
                    text_input=str(group.get("text") or ""),
                    trace_id=trace_id,
                    speaker_hint=speaker_hint or ", ".join(group.get("speakers") or []),
                    language_code=language_code,
                    target_voice=target_voice,
                    speaker_voices=list(group.get("speakerVoices") or []),
                    primary_key_pool=primary_key_pool,
                    fallback_request_key=fallback_request_key,
                    effective_key_pool=effective_key_pool,
                    speech_mode_requested="studio_pair_groups",
                    window_index=int(group.get("groupIndex", 0)) + 1,
                    window_total=len(groups),
                    affinity_speakers=[str(value) for value in list(group.get("speakers") or [])],
                )
                line_chunks, used_pause_boundaries = _split_int16_pcm_for_lines(pcm_bytes, group_weights)
                return {
                    "groupIndex": int(group.get("groupIndex", 0)),
                    "lines": group_lines,
                    "lineChunks": line_chunks,
                    "model": model_used,
                    "speechMode": speech_mode_used,
                    "keyIndex": int(key_index_used),
                    "splitMode": "pause" if used_pause_boundaries else "duration",
                    "attempts": attempt,
                }
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if attempt >= max_attempts:
                    break
        if last_exc is None:
            raise RuntimeError("group_synthesis_failed")
        raise last_exc

    group_results: list[Dict[str, Any]] = []
    group_errors: list[Dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=effective_concurrency) as executor:
        future_map = {executor.submit(run_group, group): group for group in groups}
        for future in concurrent.futures.as_completed(future_map):
            group = future_map[future]
            try:
                result = future.result()
                group_results.append(result)
            except Exception as exc:  # noqa: BLE001
                detail = str(exc).strip()
                parsed_detail = _normalize_error_payload(detail) if detail else None
                group_errors.append(
                    {
                        "groupIndex": int(group.get("groupIndex", -1)),
                        "speakers": list(group.get("speakers") or []),
                        "error": parsed_detail or {"summary": detail or "Group synthesis failed."},
                    }
                )

    if group_errors:
        detail_payload = {
            "error": "Gemini grouped multi-speaker synthesis failed.",
            "errorCode": ERROR_CODE_UPSTREAM_MODEL_FAILED,
            "summary": f"{len(group_errors)} grouped synthesis task(s) failed.",
            "trace_id": trace_id,
            "strategy": "studio_pair_groups",
            "groupCount": len(groups),
            "failedGroups": group_errors,
        }
        raise RuntimeError(json.dumps(detail_payload, ensure_ascii=True))

    line_audio_by_index: Dict[int, bytes] = {}
    line_split_mode_by_index: Dict[int, str] = {}
    models_used: list[str] = []
    speech_modes_used: list[str] = []
    key_indexes_used: list[int] = []
    pause_split_groups = 0
    duration_split_groups = 0

    for result in sorted(group_results, key=lambda item: int(item.get("groupIndex", 0))):
        models_used.append(str(result.get("model") or ""))
        speech_modes_used.append(str(result.get("speechMode") or ""))
        key_indexes_used.append(int(result.get("keyIndex", -1)))
        if str(result.get("splitMode") or "") == "pause":
            pause_split_groups += 1
        else:
            duration_split_groups += 1
        line_chunks = list(result.get("lineChunks") or [])
        group_lines = list(result.get("lines") or [])
        for idx, line in enumerate(group_lines):
            line_index = int(line.get("lineIndex", -1))
            if line_index < 0:
                continue
            chunk = line_chunks[idx] if idx < len(line_chunks) else b""
            line_audio_by_index[line_index] = bytes(chunk)
            line_split_mode_by_index[line_index] = str(result.get("splitMode") or "duration")

    ordered_line_indexes = [int(line.get("lineIndex", -1)) for line in normalized_line_map]
    ordered_line_indexes = [index for index in ordered_line_indexes if index >= 0]
    final_chunks: list[bytes] = []
    ordered_line_chunks: list[Dict[str, Any]] = []
    for line_index in ordered_line_indexes:
        chunk = bytes(line_audio_by_index.get(line_index, b""))
        silence_fallback = False
        if not chunk:
            chunk = b"\x00\x00" * 240  # 10ms silence fallback.
            silence_fallback = True
        final_chunks.append(chunk)
        ordered_line_chunks.append(
            {
                "lineIndex": line_index,
                "pcmBytes": chunk,
                "splitMode": "silence" if silence_fallback else str(line_split_mode_by_index.get(line_index, "duration")),
                "silenceFallback": silence_fallback,
            }
        )

    final_pcm_bytes = b"".join(final_chunks)
    if not final_pcm_bytes:
        raise RuntimeError("Gemini grouped synthesis returned empty audio.")

    wav_bytes = pcm16_to_wav(final_pcm_bytes, sample_rate=24000)
    unique_models = [model for model in models_used if model]
    model_header = unique_models[0] if unique_models else _normalize_model_name(TTS_MODEL)
    key_selection_index = key_indexes_used[0] if key_indexes_used else -1
    diagnostics_payload: Dict[str, Any] = {
        "engine": "GEM",
        "traceId": trace_id,
        "strategies": ["studio_pair_groups"],
        "recoveryUsed": bool(retry_once),
        "groupCount": len(groups),
        "lineCount": len(normalized_line_map),
        "concurrencyUsed": effective_concurrency,
        "keyPoolSize": len(effective_key_pool),
        "availableLanes": int(pool_pressure.get("availableLanes") or 0),
        "estimatedWaitMs": int(pool_pressure.get("estimatedWaitMs") or 0),
        "pauseSplitGroups": pause_split_groups,
        "durationSplitGroups": duration_split_groups,
        "lineChunkCount": len(ordered_line_chunks),
    }
    _emit_stage_event(
        trace_id,
        "completed",
        "ok",
        {
            "strategy": "studio_pair_groups",
            "bytes": len(wav_bytes),
            "groupCount": len(groups),
            "lineCount": len(normalized_line_map),
            "concurrency": effective_concurrency,
            "pauseSplitGroups": pause_split_groups,
            "durationSplitGroups": duration_split_groups,
            "keySelectionIndex": key_selection_index,
            "lineChunkCount": len(ordered_line_chunks),
        },
    )
    return {
        "wavBytes": wav_bytes,
        "sampleRate": 24000,
        "lineChunks": ordered_line_chunks,
        "traceId": trace_id,
        "model": model_header,
        "speechModeUsed": "studio_pair_groups",
        "speechModes": speech_modes_used,
        "speechModeRequested": "studio_pair_groups",
        "keySelectionIndex": key_selection_index,
        "keyPoolSize": len(effective_key_pool),
        "speakerHint": speaker_hint or None,
        "windowCount": len(groups),
        "diagnostics": diagnostics_payload,
    }


def _build_line_map_word_windows(
    normalized_line_map: list[Dict[str, Any]],
    max_words: int,
) -> list[list[Dict[str, Any]]]:
    safe_max_words = max(1, int(max_words))
    if not normalized_line_map:
        return []
    windows: list[list[Dict[str, Any]]] = []
    current: list[Dict[str, Any]] = []
    current_words = 0
    for line in normalized_line_map:
        text = _normalize_synthesis_text(str(line.get("text") or ""))
        if not text:
            continue
        line_words = max(1, count_words(text))
        if current and (current_words + line_words) > safe_max_words:
            windows.append(current)
            current = []
            current_words = 0
        current.append(
            {
                "lineIndex": int(line.get("lineIndex", 0)),
                "speaker": str(line.get("speaker") or "").strip(),
                "text": text,
            }
        )
        current_words += line_words
        if current_words >= safe_max_words:
            windows.append(current)
            current = []
            current_words = 0
    if current:
        windows.append(current)
    return windows


def _build_realtime_metrics(wav_bytes: bytes, processing_ms: int) -> Dict[str, Any]:
    audio_duration_sec = 0.0
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as handle:
            frames = int(handle.getnframes() or 0)
            frame_rate = int(handle.getframerate() or 0)
            if frame_rate > 0 and frames > 0:
                audio_duration_sec = float(frames) / float(frame_rate)
    except Exception:
        audio_duration_sec = 0.0
    safe_processing_sec = max(0.001, float(max(0, int(processing_ms))) / 1000.0)
    realtime_factor_x = float(audio_duration_sec) / safe_processing_sec
    target_realtime_x = 150.0
    return {
        "processingMs": int(max(0, int(processing_ms))),
        "audioDurationSec": round(float(audio_duration_sec), 4),
        "realtimeFactorX": round(float(realtime_factor_x), 4),
        "targetRealtimeX": target_realtime_x,
        "targetMet": bool(realtime_factor_x >= target_realtime_x),
    }


def _synthesize_studio_pair_group_windows(
    *,
    trace_id: str,
    target_voice: str,
    language_code: str,
    speaker_hint: str,
    normalized_speaker_voices: list[Dict[str, str]],
    normalized_line_map: list[Dict[str, Any]],
    primary_key_pool: list[str],
    fallback_request_key: Optional[str],
    effective_key_pool: list[str],
    requested_concurrency: int,
    retry_once: bool,
    started_at_ms: int,
    include_line_chunks: bool,
) -> Dict[str, Any]:
    line_windows = _build_line_map_word_windows(normalized_line_map, MAX_WORDS_PER_REQUEST)
    if not line_windows:
        raise HTTPException(status_code=400, detail="multi_speaker_line_map does not contain valid grouped dialogue.")

    aggregated_line_chunks: Dict[int, Dict[str, Any]] = {}
    models_used: list[str] = []
    speech_modes_used: list[str] = []
    key_indexes_used: list[int] = []
    total_group_count = 0
    total_pause_split_groups = 0
    total_duration_split_groups = 0
    max_concurrency_used = 0

    for line_window in line_windows:
        window_result = _synthesize_studio_pair_groups(
            trace_id=trace_id,
            target_voice=target_voice,
            language_code=language_code,
            speaker_hint=speaker_hint,
            normalized_speaker_voices=normalized_speaker_voices,
            normalized_line_map=line_window,
            primary_key_pool=primary_key_pool,
            fallback_request_key=fallback_request_key,
            effective_key_pool=effective_key_pool,
            requested_concurrency=requested_concurrency,
            retry_once=retry_once,
        )
        for item in list(window_result.get("lineChunks") or []):
            line_index = int(item.get("lineIndex", -1))
            if line_index < 0:
                continue
            aggregated_line_chunks[line_index] = {
                "lineIndex": line_index,
                "pcmBytes": bytes(item.get("pcmBytes") or b""),
                "splitMode": str(item.get("splitMode") or "duration"),
                "silenceFallback": bool(item.get("silenceFallback")),
            }
        models_used.append(str(window_result.get("model") or ""))
        speech_modes_used.extend([str(mode) for mode in list(window_result.get("speechModes") or []) if str(mode or "").strip()])
        key_indexes_used.append(int(window_result.get("keySelectionIndex", -1)))
        diagnostics = window_result.get("diagnostics") if isinstance(window_result.get("diagnostics"), dict) else {}
        total_group_count += int(diagnostics.get("groupCount", 0) or 0)
        total_pause_split_groups += int(diagnostics.get("pauseSplitGroups", 0) or 0)
        total_duration_split_groups += int(diagnostics.get("durationSplitGroups", 0) or 0)
        max_concurrency_used = max(max_concurrency_used, int(diagnostics.get("concurrencyUsed", 0) or 0))

    ordered_line_indexes = [int(line.get("lineIndex", -1)) for line in normalized_line_map]
    ordered_line_indexes = [index for index in ordered_line_indexes if index >= 0]
    ordered_line_chunks: list[Dict[str, Any]] = []
    final_pcm_chunks: list[bytes] = []
    for line_index in ordered_line_indexes:
        item = aggregated_line_chunks.get(line_index) or {}
        chunk = bytes(item.get("pcmBytes") or b"")
        silence_fallback = False
        if not chunk:
            chunk = b"\x00\x00" * 240
            silence_fallback = True
        final_pcm_chunks.append(chunk)
        ordered_line_chunks.append(
            {
                "lineIndex": line_index,
                "pcmBytes": chunk,
                "splitMode": "silence" if silence_fallback else str(item.get("splitMode") or "duration"),
                "silenceFallback": bool(item.get("silenceFallback")) or silence_fallback,
            }
        )

    final_pcm_bytes = b"".join(final_pcm_chunks)
    if not final_pcm_bytes:
        raise RuntimeError("Gemini grouped synthesis returned empty audio.")

    wav_bytes = pcm16_to_wav(final_pcm_bytes, sample_rate=24000)
    model_header = next((item for item in models_used if item), _normalize_model_name(TTS_MODEL))
    key_selection_index = key_indexes_used[0] if key_indexes_used else -1
    diagnostics_payload: Dict[str, Any] = {
        "engine": "GEM",
        "traceId": trace_id,
        "strategies": ["studio_pair_groups", "line_map_word_windows"] if len(line_windows) > 1 else ["studio_pair_groups"],
        "recoveryUsed": bool(retry_once),
        "groupCount": total_group_count,
        "lineCount": len(normalized_line_map),
        "windowCount": len(line_windows),
        "concurrencyUsed": max_concurrency_used,
        "keyPoolSize": len(effective_key_pool),
        "pauseSplitGroups": total_pause_split_groups,
        "durationSplitGroups": total_duration_split_groups,
        "lineChunkCount": len(ordered_line_chunks),
    }
    diagnostics_payload.update(
        _build_realtime_metrics(
            wav_bytes=wav_bytes,
            processing_ms=max(0, int(time.time() * 1000) - started_at_ms),
        )
    )
    _emit_stage_event(
        trace_id,
        "completed",
        "ok",
        {
            "strategy": "studio_pair_groups",
            "bytes": len(wav_bytes),
            "windowCount": len(line_windows),
            "groupCount": total_group_count,
            "lineCount": len(normalized_line_map),
            "keySelectionIndex": key_selection_index,
            "realtimeFactorX": diagnostics_payload.get("realtimeFactorX"),
        },
    )
    return {
        "wavBytes": wav_bytes,
        "sampleRate": 24000,
        "lineChunks": ordered_line_chunks if include_line_chunks else [],
        "traceId": trace_id,
        "model": model_header,
        "speechModeUsed": "studio_pair_groups",
        "speechModes": speech_modes_used or ["studio_pair_groups"],
        "speechModeRequested": "studio_pair_groups",
        "keySelectionIndex": key_selection_index,
        "keyPoolSize": len(effective_key_pool),
        "speakerHint": speaker_hint or None,
        "windowCount": len(line_windows),
        "diagnostics": diagnostics_payload,
    }


def _remaining_timeout_ms(started_at_ms: int, total_timeout_ms: int) -> int:
    elapsed = max(0, int(time.time() * 1000) - started_at_ms)
    return max(0, int(total_timeout_ms) - elapsed)


def _resolve_tts_key_pool(
    api_key: Optional[str],
    trace_id: str,
    pool_hint: Optional[str] = None,
) -> tuple[list[str], Optional[str], list[str]]:
    return _ensure_runtime_pool_or_raise(trace_id=trace_id, api_key=api_key, pool_hint=pool_hint)


def _build_single_speech_config(language_code: str, voice_name: str) -> object:
    return types.SpeechConfig(
        language_code=language_code,
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(
                voice_name=voice_name
            )
        ),
    )


def _build_multi_speaker_speech_config(language_code: str, speaker_voices: list[Dict[str, str]]) -> Optional[object]:
    if len(speaker_voices) != 2:
        return None
    if not hasattr(types, "MultiSpeakerVoiceConfig") or not hasattr(types, "SpeakerVoiceConfig"):
        return None
    speaker_voice_configs = [
        types.SpeakerVoiceConfig(
            speaker=entry["speaker"],
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=entry["voiceName"]
                )
            ),
        )
        for entry in speaker_voices
    ]
    if len(speaker_voice_configs) != 2:
        return None
    return types.SpeechConfig(
        language_code=language_code,
        multi_speaker_voice_config=types.MultiSpeakerVoiceConfig(
            speaker_voice_configs=speaker_voice_configs
        ),
    )


def _resolve_speech_attempts(
    language_code: str,
    target_voice: str,
    speaker_voices: list[Dict[str, str]],
) -> list[tuple[str, object]]:
    single_voice = target_voice
    if len(speaker_voices) == 1:
        single_voice = str(speaker_voices[0].get("voiceName") or target_voice).strip() or target_voice
    single_speech_config = _build_single_speech_config(language_code=language_code, voice_name=single_voice)
    speech_attempts: list[tuple[str, object]] = [("single-speaker", single_speech_config)]
    multi_speech_config = _build_multi_speaker_speech_config(
        language_code=language_code,
        speaker_voices=speaker_voices,
    )
    if multi_speech_config is not None:
        speech_attempts = [("multi-speaker", multi_speech_config), ("single-speaker", single_speech_config)]
    return speech_attempts


def _synthesize_pcm_with_key_pool(
    *,
    text_input: str,
    trace_id: str,
    speaker_hint: str,
    language_code: str,
    target_voice: str,
    speaker_voices: list[Dict[str, str]],
    primary_key_pool: list[str],
    fallback_request_key: Optional[str],
    effective_key_pool: list[str],
    speech_mode_requested: str,
    window_index: int,
    window_total: int,
    affinity_speakers: list[str],
) -> tuple[bytes, str, str, int]:
    last_exc: Optional[Exception] = None
    model_errors: list[str] = []
    model_attempts: list[Dict[str, Any]] = []
    key_attempts: list[Dict[str, Any]] = []
    blocked_keys: set[str] = set()
    blocked_models: set[str] = set()
    speech_attempts = _resolve_speech_attempts(
        language_code=language_code,
        target_voice=target_voice,
        speaker_voices=speaker_voices,
    )
    speech_index = 0
    attempt = 0
    started_at_ms = int(time.time() * 1000)
    timed_out = False
    pool_exhausted = False
    start_key_selection_index: Optional[int] = None
    preferred_key = _resolve_affinity_preferred_key(affinity_speakers, effective_key_pool)
    token_estimate = estimate_text_tokens(text_input)
    retry_limit = max(1, len(effective_key_pool) * max(1, len(resolve_tts_model_candidates())))

    while True:
        remaining_budget_ms = _remaining_timeout_ms(started_at_ms, KEY_TOTAL_TIMEOUT_MS)
        if remaining_budget_ms <= 0:
            timed_out = True
            # #region agent log
            try:
                import json as _agent_json  # type: ignore[import-not-found]
                with open("debug-d5d65f.log", "a", encoding="utf-8") as _agent_f:
                    _agent_f.write(
                        _agent_json.dumps(
                            {
                                "sessionId": "d5d65f",
                                "runId": "pre-fix",
                                "hypothesisId": "H_timeout_budget",
                                "location": "backend/engines/gemini-runtime/app.py:_synthesize_pcm_with_key_pool_loop_timeout",
                                "message": "Key pool synthesis loop exhausted total timeout budget",
                                "data": {
                                    "timed_out": True,
                                    "pool_exhausted": pool_exhausted,
                                    "attempt": attempt,
                                    "keyPoolSize": len(effective_key_pool),
                                },
                                "timestamp": int(time.time() * 1000),
                            }
                        )
                        + "\n"
                    )
            except Exception:
                pass
            # #endregion
            break

        pressure = _estimate_tts_pool_pressure(
            key_pool=effective_key_pool,
            requested_tokens=token_estimate,
        )
        admission_budget_ms = _resolve_admission_wait_budget_ms(remaining_budget_ms)
        estimated_wait_ms = max(0, int(pressure.get("estimatedWaitMs") or 0))
        available_lanes = max(0, int(pressure.get("availableLanes") or 0))
        if available_lanes <= 0 and estimated_wait_ms > admission_budget_ms:
            overload_payload = _build_overload_detail_payload(
                trace_id=trace_id,
                speech_mode_requested=speech_mode_requested,
                window_index=window_index,
                window_total=window_total,
                attempt=attempt,
                timeout_ms=KEY_TOTAL_TIMEOUT_MS,
                pressure=pressure,
            )
            _emit_stage_event(trace_id, "synthesis", "overloaded", overload_payload)
            raise RuntimeError(json.dumps(overload_payload, ensure_ascii=True))

        acquire = _RUNTIME_ALLOCATOR.acquire_for_task(
            task="tts",
            key_pool=effective_key_pool,
            requested_tokens=token_estimate,
            blocked_keys=blocked_keys,
            blocked_models=blocked_models,
            wait_timeout_ms=remaining_budget_ms,
            preferred_key=preferred_key if attempt == 0 else None,
        )
        lease = acquire.lease
        if lease is None:
            timed_out = bool(acquire.timed_out)
            pool_exhausted = True
            # #region agent log
            try:
                import json as _agent_json  # type: ignore[import-not-found]
                with open("debug-d5d65f.log", "a", encoding="utf-8") as _agent_f:
                    _agent_f.write(
                        _agent_json.dumps(
                            {
                                "sessionId": "d5d65f",
                                "runId": "pre-fix",
                                "hypothesisId": "H_acquire_behavior",
                                "location": "backend/engines/gemini-runtime/app.py:_synthesize_pcm_with_key_pool_acquire_none",
                                "message": "Allocator acquire_for_task returned no lease",
                                "data": {
                                    "timed_out": bool(acquire.timed_out),
                                    "waited_ms": int(acquire.waited_ms),
                                    "retry_after_ms": int(acquire.retry_after_ms),
                                    "pool_exhausted": True,
                                    "remaining_budget_ms": remaining_budget_ms,
                                    "keyPoolSize": len(effective_key_pool),
                                },
                                "timestamp": int(time.time() * 1000),
                            }
                        )
                        + "\n"
                    )
            except Exception:
                pass
            # #endregion
            if acquire.retry_after_ms > 0:
                _emit_stage_event(
                    trace_id,
                    "synthesis",
                    "pool_exhausted",
                    {
                        "retryAttempt": attempt + 1,
                        "waitMs": acquire.retry_after_ms,
                        "keyPoolSize": len(effective_key_pool),
                        "speakerHint": speaker_hint or None,
                        "windowIndex": window_index,
                        "windowTotal": window_total,
                    },
                )
            break

        attempt += 1
        if start_key_selection_index is None:
            start_key_selection_index = int(lease.key_index)
        key_fingerprint = _api_key_cache_key(lease.key)
        key_attempts.append(
            {
                "attempt": attempt,
                "keySelectionIndex": int(lease.key_index),
                "keyFingerprint": key_fingerprint,
                "model": lease.model_id,
                "windowIndex": window_index,
            }
        )

        speech_mode, speech_config = speech_attempts[min(speech_index, max(0, len(speech_attempts) - 1))]
        mode_timeout_ms = (
            GEMINI_TTS_MULTI_REQUEST_TIMEOUT_MS
            if speech_mode == "multi-speaker"
            else GEMINI_TTS_SINGLE_REQUEST_TIMEOUT_MS
        )
        request_timeout_ms = max(1000, min(mode_timeout_ms, remaining_budget_ms))
        _emit_stage_event(
            trace_id,
            "synthesis",
            "retry",
            {
                "retryAttempt": attempt,
                "keyPoolSize": len(effective_key_pool),
                "keySelectionIndex": int(lease.key_index),
                "keyFingerprint": key_fingerprint,
                "model": lease.model_id,
                "speechMode": speech_mode,
                "speakerHint": speaker_hint or None,
                "windowIndex": window_index,
                "windowTotal": window_total,
            },
        )

        try:
            client = _build_genai_client(api_key=lease.key, timeout_ms=request_timeout_ms)
            response = client.models.generate_content(
                model=lease.model_id,
                contents=text_input,
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=speech_config,
                ),
            )
            pcm_bytes = extract_pcm_bytes(response)
            _RUNTIME_ALLOCATOR.release(lease, success=True, used_tokens=token_estimate)
            _bind_speakers_to_key(affinity_speakers, lease.key)
            return pcm_bytes, lease.model_id, speech_mode, int(lease.key_index)
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            detail = str(exc).strip().replace("\n", " ")
            error_kind = "other"
            if _is_timeout_error(detail):
                error_kind = "timeout"
                timed_out = True
            elif _is_auth_error(detail):
                error_kind = "auth"
                blocked_keys.add(lease.key)
                _evict_speaker_key_affinity_for_key(affinity_speakers, lease.key)
            elif _is_rate_limit_error(detail):
                error_kind = "rate_limit"
            else:
                if speech_index + 1 < len(speech_attempts):
                    speech_index += 1
                else:
                    blocked_models.add(lease.model_id)
            _RUNTIME_ALLOCATOR.release(
                lease,
                success=False,
                used_tokens=token_estimate,
                error_kind=error_kind,
            )
            model_attempts.append(
                {
                    "attempt": attempt,
                    "model": lease.model_id,
                    "speechMode": speech_mode,
                    "keySelectionIndex": int(lease.key_index),
                    "keyFingerprint": key_fingerprint,
                    "requestTimeoutMs": request_timeout_ms,
                    "error": detail[:200],
                }
            )
            if detail:
                model_errors.append(f"{lease.model_id}/{speech_mode}: {detail[:160]}")
            if timed_out:
                break

    allocator_snapshot = _RUNTIME_ALLOCATOR.snapshot(effective_key_pool)
    key_states = list(allocator_snapshot.get("keys") or [])
    summary = _summarize_terminal_failure(
        model_errors=model_errors,
        last_exc=last_exc,
        default_summary="Gemini TTS synthesis failed after exhausting key/model attempts.",
    )
    error_code = _classify_terminal_error_code(
        model_attempts=model_attempts,
        timed_out=timed_out,
        pool_exhausted=pool_exhausted,
    )
    detail_payload = {
        "error": "Gemini model attempts failed.",
        "errorCode": error_code,
        "classification": _classification_for_error_code(error_code),
        "summary": summary,
        "retryLimit": retry_limit,
        "attemptsUsed": attempt,
        "keyPoolSize": len(effective_key_pool),
        "timedOut": timed_out,
        "poolExhausted": pool_exhausted,
        "startKeySelectionIndex": start_key_selection_index,
        "timeoutMs": KEY_TOTAL_TIMEOUT_MS,
        "elapsedMs": max(0, int(time.time() * 1000) - started_at_ms),
        "trace_id": trace_id,
        "retryAfterMs": _retry_after_from_key_states(key_states),
        "keyAttempts": key_attempts,
        "modelAttempts": model_attempts[-50:],
        "keyStates": key_states,
        "speechModeRequested": speech_mode_requested,
    }
    raise RuntimeError(json.dumps(detail_payload, ensure_ascii=True)) from last_exc


def _normalize_error_payload(raw_error: str) -> Dict[str, Any] | None:
    if not raw_error.startswith("{") or not raw_error.endswith("}"):
        return None
    try:
        payload = json.loads(raw_error)
    except Exception:  # noqa: BLE001
        return None
    if isinstance(payload, dict):
        return payload
    return None


def _synthesize_text_to_wav(payload: SynthesizeRequest) -> Dict[str, Any]:
    started_at_ms = int(time.time() * 1000)
    text = _normalize_synthesis_text(payload.text)
    if not text:
        raise HTTPException(status_code=400, detail="Text is empty.")
    trace_id = _normalize_trace_id(payload.trace_id)
    target_voice = str(payload.voiceName or payload.voice_id or "Fenrir").strip() or "Fenrir"
    normalized_speaker_voices = _normalize_speaker_voices(payload.speaker_voices or [], target_voice=target_voice)
    multi_speaker_mode = _normalize_multi_speaker_mode(payload.multi_speaker_mode)
    if multi_speaker_mode == "off":
        normalized_speaker_voices = []
    normalized_line_map = _normalize_multi_speaker_line_map(payload.multi_speaker_line_map)
    return_line_chunks_requested = bool(payload.return_line_chunks)
    try:
        requested_pair_concurrency = (
            int(payload.multi_speaker_max_concurrency)
            if payload.multi_speaker_max_concurrency is not None
            else GEMINI_STUDIO_PAIR_GROUP_MAX_CONCURRENCY
        )
    except Exception:
        requested_pair_concurrency = GEMINI_STUDIO_PAIR_GROUP_MAX_CONCURRENCY
    requested_pair_concurrency = max(
        1,
        min(GEMINI_STUDIO_PAIR_GROUP_MAX_CONCURRENCY, requested_pair_concurrency),
    )
    retry_group_once = True if payload.multi_speaker_retry_once is None else bool(payload.multi_speaker_retry_once)
    use_studio_pair_groups = (
        multi_speaker_mode == "studio_pair_groups"
        and len(normalized_speaker_voices) >= 2
        and len(normalized_line_map) >= 2
    )
    use_windowed_multi = len(normalized_speaker_voices) > 2
    if use_studio_pair_groups:
        requested_speech_mode = "studio_pair_groups"
    elif use_windowed_multi:
        requested_speech_mode = "text-order-two-speaker-windows"
    elif len(normalized_speaker_voices) == 2:
        requested_speech_mode = "multi-speaker"
    else:
        requested_speech_mode = "single-speaker"

    primary_key_pool, fallback_request_key, effective_key_pool = _resolve_tts_key_pool(
        payload.apiKey,
        trace_id=trace_id,
        pool_hint=payload.poolHint,
    )
    language_code = resolve_language_code(text, payload.language)
    speaker_hint = re.sub(r"\s+", " ", str(payload.speaker or "")).strip()
    word_count = count_words(text)
    if word_count > MAX_WORDS_PER_REQUEST and not use_studio_pair_groups:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "word_limit_exceeded",
                "maxWords": MAX_WORDS_PER_REQUEST,
                "actualWords": word_count,
            },
        )

    if use_studio_pair_groups:
        return _synthesize_studio_pair_group_windows(
            trace_id=trace_id,
            target_voice=target_voice,
            language_code=language_code,
            speaker_hint=speaker_hint,
            normalized_speaker_voices=normalized_speaker_voices,
            normalized_line_map=normalized_line_map,
            primary_key_pool=primary_key_pool,
            fallback_request_key=fallback_request_key,
            effective_key_pool=effective_key_pool,
            requested_concurrency=requested_pair_concurrency,
            retry_once=retry_group_once,
            started_at_ms=started_at_ms,
            include_line_chunks=return_line_chunks_requested,
        )

    raw_windows: list[Dict[str, Any]]
    if use_windowed_multi:
        raw_windows = _build_text_order_two_speaker_windows(
            text=text,
            speaker_voices=normalized_speaker_voices,
            target_voice=target_voice,
        )
    else:
        raw_windows = [{"text": text, "speakerVoices": normalized_speaker_voices}]

    windows: list[Dict[str, Any]] = []
    for window in raw_windows:
        window_text = _normalize_synthesis_text(str(window.get("text") or ""))
        if not window_text:
            continue
        window_speaker_voices = _normalize_speaker_voices(
            window.get("speakerVoices") or [],
            target_voice=target_voice,
        )
        windows.append(
            {
                "text": window_text,
                "speakerVoices": window_speaker_voices[:2],
            }
        )
    if not windows:
        raise HTTPException(status_code=400, detail="Text is empty.")

    _emit_stage_event(
        trace_id,
        "preprocess",
        "done",
        {
            "voice": target_voice,
            "textChars": len(text),
            "wordCount": word_count,
            "segmentation": "disabled",
            "language": language_code,
            "speechModeRequested": requested_speech_mode,
            "speakerCount": len(normalized_speaker_voices),
            "windowCount": len(windows),
            "keyPoolSize": len(effective_key_pool),
            "speakerHint": speaker_hint or None,
        },
    )
    _emit_stage_event(
        trace_id,
        "synthesis",
        "start",
        {
            "voice": target_voice,
            "textChars": len(text),
            "speechModeRequested": requested_speech_mode,
            "windowCount": len(windows),
            "keyPoolSize": len(effective_key_pool),
            "speakerHint": speaker_hint or None,
        },
    )

    try:
        pcm_fragments: list[bytes] = []
        models_used: list[str] = []
        speech_modes_used: list[str] = []
        key_indexes_used: list[int] = []
        bridge_samples = int(round((24000 * GEMINI_MULTI_SPEAKER_WINDOW_PAUSE_MS) / 1000.0))
        bridge_pause_pcm = (b"\x00\x00" * bridge_samples) if bridge_samples > 0 else b""

        for index, window in enumerate(windows, start=1):
            window_affinity_speakers = _extract_affinity_speakers(
                speaker_hint=speaker_hint,
                speaker_voices=list(window.get("speakerVoices") or []),
            )
            pcm_bytes, model_used, speech_mode_used, key_index_used = _synthesize_pcm_with_key_pool(
                text_input=str(window["text"]),
                trace_id=trace_id,
                speaker_hint=speaker_hint,
                language_code=language_code,
                target_voice=target_voice,
                speaker_voices=list(window.get("speakerVoices") or []),
                primary_key_pool=primary_key_pool,
                fallback_request_key=fallback_request_key,
                effective_key_pool=effective_key_pool,
                speech_mode_requested=requested_speech_mode,
                window_index=index,
                window_total=len(windows),
                affinity_speakers=window_affinity_speakers,
            )
            if not pcm_bytes:
                raise RuntimeError("Gemini returned empty audio.")
            pcm_fragments.append(pcm_bytes)
            if index < len(windows) and bridge_pause_pcm:
                pcm_fragments.append(bridge_pause_pcm)
            models_used.append(model_used)
            speech_modes_used.append(speech_mode_used)
            key_indexes_used.append(key_index_used)

        final_pcm_bytes = b"".join(pcm_fragments)
        if not final_pcm_bytes:
            raise RuntimeError("Gemini returned empty audio.")
        wav_bytes = pcm16_to_wav(final_pcm_bytes, sample_rate=24000)
        unique_models = [item for item in models_used if item]
        model_header = unique_models[0] if unique_models else _normalize_model_name(TTS_MODEL)
        if len(windows) > 1:
            speech_mode_used = "text-order-two-speaker-windows"
        else:
            speech_mode_used = speech_modes_used[0] if speech_modes_used else "single-speaker"
        key_selection_index = key_indexes_used[0] if key_indexes_used else -1
        diagnostics_payload: Dict[str, Any] = {
            "engine": "GEM",
            "traceId": trace_id,
            "chunkCount": len(windows),
            "strategies": ["legacy_windows" if not use_windowed_multi else "text_order_two_speaker_windows"],
            "recoveryUsed": False,
            "keyPoolSize": len(effective_key_pool),
        }
        diagnostics_payload.update(
            _build_realtime_metrics(
                wav_bytes=wav_bytes,
                processing_ms=max(0, int(time.time() * 1000) - started_at_ms),
            )
        )

        _emit_stage_event(
            trace_id,
            "completed",
            "ok",
            {
                "bytes": len(wav_bytes),
                "model": model_header,
                "speechModeUsed": speech_mode_used,
                "speechModes": speech_modes_used,
                "windowCount": len(windows),
                "keySelectionIndex": key_selection_index,
                "keyPoolSize": len(effective_key_pool),
                "speakerHint": speaker_hint or None,
                "realtimeFactorX": diagnostics_payload.get("realtimeFactorX"),
            },
        )
        return {
            "wavBytes": wav_bytes,
            "sampleRate": 24000,
            "lineChunks": [],
            "traceId": trace_id,
            "model": model_header,
            "speechModeUsed": speech_mode_used,
            "speechModes": speech_modes_used,
            "speechModeRequested": requested_speech_mode,
            "keySelectionIndex": key_selection_index,
            "keyPoolSize": len(effective_key_pool),
            "speakerHint": speaker_hint or None,
            "windowCount": len(windows),
            "diagnostics": diagnostics_payload,
        }
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raw_error = str(exc).strip()
        parsed_error = _normalize_error_payload(raw_error)
        if parsed_error is not None:
            error_payload = {
                "error": "Gemini TTS synthesis failed.",
                "speechModeRequested": requested_speech_mode,
                "speakerHint": speaker_hint or None,
                **parsed_error,
            }
        else:
            error_payload = {
                "error": f"Gemini TTS synthesis failed: {raw_error}",
                "errorCode": ERROR_CODE_UPSTREAM_MODEL_FAILED,
                "summary": raw_error[:220] if raw_error else "Gemini TTS synthesis failed.",
                "speechModeRequested": requested_speech_mode,
                "speakerHint": speaker_hint or None,
            }
        if not str(error_payload.get("errorCode") or "").strip():
            error_payload["errorCode"] = ERROR_CODE_UPSTREAM_MODEL_FAILED
        if not str(error_payload.get("summary") or "").strip():
            error_payload["summary"] = str(error_payload.get("error") or "Gemini TTS synthesis failed.")[:220]
        if not str(error_payload.get("classification") or "").strip():
            error_payload["classification"] = _classification_for_error_code(str(error_payload.get("errorCode") or ""))
        error_payload["trace_id"] = trace_id
        if "retryAfterMs" not in error_payload:
            key_states = error_payload.get("keyStates") if isinstance(error_payload.get("keyStates"), list) else []
            error_payload["retryAfterMs"] = _retry_after_from_key_states(key_states)
        _emit_stage_event(trace_id, "failed", "error", error_payload)
        error_code = str(error_payload.get("errorCode") or "").strip().upper()
        _record_error_classification(error_code)
        status_code = 502
        if error_code in {
            ERROR_CODE_KEY_POOL_OVERLOADED,
            ERROR_CODE_KEY_POOL_TIMEOUT,
            ERROR_CODE_ALLOCATOR_ACQUIRE_TIMEOUT,
            ERROR_CODE_ALL_KEYS_RATE_LIMITED,
        }:
            status_code = 503
        elif error_code == ERROR_CODE_UPSTREAM_REQUEST_TIMEOUT:
            status_code = 504
        raise HTTPException(status_code=status_code, detail=error_payload) from exc


app = FastAPI(title=APP_NAME)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins("VF_CORS_ORIGINS"),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> JSONResponse:
    model_candidates = resolve_tts_model_candidates()
    configured_pool = resolve_request_api_key_pool("")
    return JSONResponse(
        {
            "ok": genai is not None and types is not None,
            "engine": APP_NAME,
            "model": TTS_MODEL,
            "modelCandidates": model_candidates,
            "supportsMultiSpeaker": True,
            "multiSpeakerMaxSpeakers": 2,
            "geminiAvailable": genai is not None,
            "apiKeyConfigured": bool(configured_pool),
            "keyPoolSize": len(configured_pool),
            "mode": "gemini-only",
        }
    )


@app.get("/v1/capabilities")
def capabilities() -> JSONResponse:
    model_candidates = resolve_tts_model_candidates()
    configured_pool = resolve_request_api_key_pool("")
    return JSONResponse(
        {
            "engine": "GEM",
            "runtime": APP_NAME,
            "ready": genai is not None and types is not None,
            "languages": ["multilingual"],
            "speed": {"min": 0.7, "max": 1.3, "default": 1.0},
            "supportsEmotion": False,
            "supportsStyle": False,
            "supportsSpeakerWav": False,
            "model": TTS_MODEL,
            "modelCandidates": model_candidates,
            "supportsMultiSpeaker": True,
            "supportsBatchSynthesis": True,
            "batchEndpoint": "/synthesize/batch",
            "batchMaxItems": GEMINI_BATCH_MAX_ITEMS,
            "batchDefaultParallelism": GEMINI_BATCH_DEFAULT_PARALLEL,
            "batchMaxParallelism": GEMINI_BATCH_MAX_PARALLEL,
            "voiceCount": None,
            "emotionCount": 0,
            "metadata": {
                "apiKeyConfigured": bool(configured_pool),
                "keyPoolSize": len(configured_pool),
                "mode": "gemini-only",
                "maxWordsPerRequest": MAX_WORDS_PER_REQUEST,
                "segmentation": "disabled",
                "multiSpeakerMaxSpeakers": 2,
                "supportsBatchSynthesis": True,
                "batchEndpoint": "/synthesize/batch",
                "structuredEndpoint": "/synthesize/structured",
                "batchMaxItems": GEMINI_BATCH_MAX_ITEMS,
                "batchDefaultParallelism": GEMINI_BATCH_DEFAULT_PARALLEL,
                "batchMaxParallelism": GEMINI_BATCH_MAX_PARALLEL,
                "multiSpeakerMaxSpeakersPerCall": 2,
                "multiSpeakerBatchingMode": "studio_pair_groups_with_line_map_windows",
            },
        }
    )


@app.get("/v1/admin/api-pool")
def admin_api_pool() -> JSONResponse:
    key_pool = resolve_request_api_key_pool("", pool_hint="pro_plus")
    snapshot = _RUNTIME_ALLOCATOR.snapshot(key_pool)
    payload = dict(snapshot)
    payload["ok"] = True
    payload["engine"] = APP_NAME
    payload["timestampMs"] = int(time.time() * 1000)
    payload["configuredKeyFilePath"] = _configured_key_file_path()
    payload["keyFilePath"] = _resolved_key_file_path()
    payload["effectiveTtsLimits"] = _effective_tts_route_limits()
    payload["recentErrorClassCounts"] = _recent_error_class_counts()
    config, meta = _load_api_pool_config()
    payload["poolConfig"] = config
    payload["poolConfigMeta"] = meta
    payload["warnings"] = list((meta or {}).get("warnings") or [])
    payload["sourcePolicy"] = dict(config.get("sourcePolicy") or {})
    return JSONResponse(payload)


@app.post("/v1/admin/api-pool/reload")
def admin_api_pool_reload() -> JSONResponse:
    refreshed_pool = list(_refresh_server_api_key_pool())
    _load_api_pool_config(force=True)
    key_pool = list(resolve_request_api_key_pool("", pool_hint="pro_plus"))
    if not key_pool:
        key_pool = list(refreshed_pool)
    snapshot = _RUNTIME_ALLOCATOR.snapshot(key_pool)
    payload = dict(snapshot if isinstance(snapshot, dict) else {})
    payload["ok"] = True
    payload["engine"] = APP_NAME
    payload["reloaded"] = True
    payload["timestampMs"] = int(time.time() * 1000)
    payload["keyPoolSize"] = len(key_pool)
    payload["configuredKeyFilePath"] = _configured_key_file_path()
    payload["keyFilePath"] = _resolved_key_file_path()
    payload["effectiveTtsLimits"] = _effective_tts_route_limits()
    payload["recentErrorClassCounts"] = _recent_error_class_counts()
    config, meta = _load_api_pool_config()
    payload["poolConfig"] = config
    payload["poolConfigMeta"] = meta
    payload["warnings"] = list((meta or {}).get("warnings") or [])
    payload["sourcePolicy"] = dict(config.get("sourcePolicy") or {})
    return JSONResponse(payload)


@app.get("/v1/admin/api-pools")
def admin_api_pools() -> JSONResponse:
    return JSONResponse(_admin_api_pools_payload())


@app.put("/v1/admin/api-pools")
def admin_api_pools_update(payload: ApiPoolsConfigUpdateRequest) -> JSONResponse:
    current_config, _current_meta = _load_api_pool_config(force=True)
    current_source_policy = dict(current_config.get("sourcePolicy") or {})
    free_pool_locked = bool(current_source_policy.get("freePoolLocked"))
    applied_overrides: list[str] = []
    raw_payload = payload.model_dump(exclude_none=True) if hasattr(payload, "model_dump") else payload.dict(exclude_none=True)
    normalized = normalize_pool_config(raw_payload)
    if free_pool_locked:
        current_pools = current_config.get("pools") if isinstance(current_config.get("pools"), dict) else {}
        locked_free_keys = list((current_pools.get("free") or {}).get("keys") or [])
        normalized["pools"]["free"]["keys"] = locked_free_keys
        applied_overrides.append("free_pool_locked_by_api_file")
    if current_source_policy:
        normalized["sourcePolicy"] = dict(current_source_policy)
    normalized, _sync_changed, sync_warnings = _sync_authoritative_runtime_free_pool(normalized)
    duplicates = duplicate_key_memberships(normalized)
    if duplicates and bool((normalized.get("constraints") or {}).get("uniqueKeyMembership", True)):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "duplicate_key_membership",
                "duplicateKeys": duplicates,
            },
        )

    saved = save_pool_config_shared(
        file_path=_resolve_api_pools_file_path(),
        config=normalized,
        firestore_db=None,
    )
    _load_api_pool_config(force=True)
    all_keys = flatten_pool_keys(saved)
    if all_keys:
        _RUNTIME_ALLOCATOR.ensure_keys(all_keys)
    return JSONResponse(
        {
            "ok": True,
            "reloaded": True,
            "engine": APP_NAME,
            "timestampMs": int(time.time() * 1000),
            "config": saved,
            "warnings": list(sync_warnings),
            "sourcePolicy": dict(saved.get("sourcePolicy") or {}),
            "appliedOverrides": applied_overrides,
            "poolSummaries": {
                pool_name: _build_pool_summary(pool_name, saved)
                for pool_name in POOL_NAMES
            },
        }
    )


@app.post("/v1/admin/api-pools/reload")
def admin_api_pools_reload() -> JSONResponse:
    _load_api_pool_config(force=True)
    key_pool = resolve_request_api_key_pool("", pool_hint="pro_plus")
    if key_pool:
        _RUNTIME_ALLOCATOR.ensure_keys(key_pool)
    payload = _admin_api_pools_payload()
    payload["reloaded"] = True
    return JSONResponse(payload)


@app.get("/v1/admin/api-pools/usage")
def admin_api_pools_usage() -> JSONResponse:
    return JSONResponse(_admin_api_pools_usage_payload())


@app.post("/v1/generate-text")
def generate_text(payload: TextGenerateRequest) -> JSONResponse:
    user_prompt = str(payload.userPrompt or "").strip()
    if not user_prompt:
        raise HTTPException(status_code=400, detail="userPrompt is required.")

    system_prompt = str(payload.systemPrompt or "").strip()
    trace_id = _normalize_trace_id(payload.trace_id)
    primary_key_pool, fallback_request_key, effective_key_pool = _ensure_runtime_pool_or_raise(
        trace_id=trace_id,
        api_key=str(payload.apiKey or "").strip(),
        pool_hint="pro_plus",
    )

    model_candidates = resolve_text_model_candidates()
    if not model_candidates:
        raise HTTPException(status_code=500, detail="No text model candidates available.")

    bounded_temperature = max(0.0, min(1.5, float(payload.temperature or 0.7)))
    config_payload: Dict[str, Any] = {"temperature": bounded_temperature}
    if payload.jsonMode:
        config_payload["response_mime_type"] = "application/json"
    if system_prompt:
        config_payload["system_instruction"] = system_prompt

    blocked_keys: set[str] = set()
    blocked_models: set[str] = set()
    key_attempts: list[Dict[str, Any]] = []
    model_attempts: list[Dict[str, Any]] = []
    model_errors: list[str] = []
    last_exc: Optional[Exception] = None
    attempt = 0
    attempt_budget = max(1, len(effective_key_pool) * max(1, len(model_candidates)))
    started_at_ms = int(time.time() * 1000)
    timed_out = False
    pool_exhausted = False
    start_key_selection_index: Optional[int] = None
    token_estimate = estimate_text_tokens(f"{system_prompt}\n{user_prompt}")

    while True:
        remaining_budget_ms = _remaining_timeout_ms(started_at_ms, KEY_TOTAL_TIMEOUT_MS)
        if remaining_budget_ms <= 0:
            timed_out = True
            break

        acquire = _RUNTIME_ALLOCATOR.acquire_for_task(
            task="text",
            key_pool=effective_key_pool,
            requested_tokens=token_estimate,
            blocked_keys=blocked_keys,
            blocked_models=blocked_models,
            wait_timeout_ms=remaining_budget_ms,
        )
        lease = acquire.lease
        if lease is None:
            timed_out = bool(acquire.timed_out)
            pool_exhausted = True
            break

        attempt += 1
        if start_key_selection_index is None:
            start_key_selection_index = int(lease.key_index)
        key_fingerprint = _api_key_cache_key(lease.key)
        key_attempts.append(
            {
                "attempt": attempt,
                "keySelectionIndex": int(lease.key_index),
                "keyFingerprint": key_fingerprint,
                "model": lease.model_id,
            }
        )
        try:
            client = _build_genai_client(api_key=lease.key, timeout_ms=remaining_budget_ms)
            response = client.models.generate_content(
                model=lease.model_id,
                contents=user_prompt,
                config=types.GenerateContentConfig(**config_payload),
            )
            text = extract_text_content(response)
            if not text:
                raise RuntimeError(f'{lease.model_id} returned empty text.')
            _RUNTIME_ALLOCATOR.release(lease, success=True, used_tokens=token_estimate)
            return JSONResponse(
                {
                    "ok": True,
                    "text": text,
                    "model": lease.model_id,
                    "keySelectionIndex": int(lease.key_index),
                    "trace_id": trace_id,
                }
            )
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            detail = str(exc).strip().replace("\n", " ")
            error_kind = "other"
            if _is_auth_error(detail):
                error_kind = "auth"
                blocked_keys.add(lease.key)
            elif _is_rate_limit_error(detail):
                error_kind = "rate_limit"
            elif _is_timeout_error(detail):
                error_kind = "timeout"
                timed_out = True
            else:
                blocked_models.add(lease.model_id)
            _RUNTIME_ALLOCATOR.release(
                lease,
                success=False,
                used_tokens=token_estimate,
                error_kind=error_kind,
            )
            model_attempts.append(
                {
                    "attempt": attempt,
                    "model": lease.model_id,
                    "keySelectionIndex": int(lease.key_index),
                    "keyFingerprint": key_fingerprint,
                    "error": detail[:200],
                }
            )
            if detail:
                model_errors.append(f"{lease.model_id}: {detail[:160]}")
            if timed_out:
                break

    allocator_snapshot = _RUNTIME_ALLOCATOR.snapshot(effective_key_pool)
    key_states = list(allocator_snapshot.get("keys") or [])
    summary = _summarize_terminal_failure(
        model_errors=model_errors,
        last_exc=last_exc,
        default_summary="Gemini text generation failed after exhausting key/model attempts.",
    )
    error_code = _classify_terminal_error_code(
        model_attempts=model_attempts,
        timed_out=timed_out,
        pool_exhausted=pool_exhausted,
    )
    detail_payload: Dict[str, Any] = {
        "error": "Gemini text generation failed.",
        "errorCode": error_code,
        "classification": _classification_for_error_code(error_code),
        "summary": summary,
        "retryLimit": attempt_budget,
        "attemptsUsed": attempt,
        "keyPoolSize": len(effective_key_pool),
        "timedOut": timed_out,
        "poolExhausted": pool_exhausted,
        "startKeySelectionIndex": start_key_selection_index,
        "timeoutMs": KEY_TOTAL_TIMEOUT_MS,
        "elapsedMs": max(0, int(time.time() * 1000) - started_at_ms),
        "trace_id": trace_id,
        "retryAfterMs": _retry_after_from_key_states(key_states),
        "keyAttempts": key_attempts,
        "modelAttempts": model_attempts[-50:],
        "keyStates": key_states,
    }
    _record_error_classification(error_code)
    status_code = 502
    if error_code in {
        ERROR_CODE_KEY_POOL_OVERLOADED,
        ERROR_CODE_KEY_POOL_TIMEOUT,
        ERROR_CODE_ALLOCATOR_ACQUIRE_TIMEOUT,
        ERROR_CODE_ALL_KEYS_RATE_LIMITED,
    }:
        status_code = 503
    elif error_code == ERROR_CODE_UPSTREAM_REQUEST_TIMEOUT:
        status_code = 504
    raise HTTPException(status_code=status_code, detail=detail_payload)


@app.post("/synthesize")
def synthesize(payload: SynthesizeRequest) -> Response:
    synthesis_result = _synthesize_text_to_wav(payload)
    headers = {
        "X-VoiceFlow-Trace-Id": str(synthesis_result.get("traceId") or ""),
        "X-VoiceFlow-Model": str(synthesis_result.get("model") or ""),
        "X-VoiceFlow-Speech-Mode": str(synthesis_result.get("speechModeUsed") or ""),
    }
    diagnostics = synthesis_result.get("diagnostics")
    if isinstance(diagnostics, dict) and diagnostics:
        headers["X-VoiceFlow-Diagnostics"] = quote(
            json.dumps(diagnostics, ensure_ascii=True, separators=(",", ":")),
            safe="",
        )
    return Response(
        content=synthesis_result["wavBytes"],
        media_type="audio/wav",
        headers=headers,
    )


@app.post("/synthesize/structured")
def synthesize_structured(payload: SynthesizeRequest) -> JSONResponse:
    payload_data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
    payload_data["return_line_chunks"] = True
    structured_payload = SynthesizeRequest(**payload_data)
    synthesis_result = _synthesize_text_to_wav(structured_payload)
    line_chunks_out: list[Dict[str, Any]] = []
    for item in list(synthesis_result.get("lineChunks") or []):
        line_index = int(item.get("lineIndex", -1))
        if line_index < 0:
            continue
        pcm_bytes = bytes(item.get("pcmBytes") or b"")
        wav_chunk = pcm16_to_wav(pcm_bytes if pcm_bytes else (b"\x00\x00" * 240), sample_rate=24000)
        line_chunks_out.append(
            {
                "lineIndex": line_index,
                "audioBase64": base64.b64encode(wav_chunk).decode("ascii"),
                "contentType": "audio/wav",
                "splitMode": str(item.get("splitMode") or "duration"),
                "silenceFallback": bool(item.get("silenceFallback")),
            }
        )
    return JSONResponse(
        {
            "ok": True,
            "engine": APP_NAME,
            "traceId": synthesis_result.get("traceId"),
            "model": synthesis_result.get("model"),
            "speechModeUsed": synthesis_result.get("speechModeUsed"),
            "speechModes": synthesis_result.get("speechModes"),
            "speechModeRequested": synthesis_result.get("speechModeRequested"),
            "keySelectionIndex": synthesis_result.get("keySelectionIndex"),
            "keyPoolSize": synthesis_result.get("keyPoolSize"),
            "windowCount": synthesis_result.get("windowCount"),
            "diagnostics": synthesis_result.get("diagnostics"),
            "wavBase64": base64.b64encode(bytes(synthesis_result.get("wavBytes") or b"")).decode("ascii"),
            "contentType": "audio/wav",
            "lineChunks": line_chunks_out,
        }
    )


@app.post("/synthesize/batch")
def synthesize_batch(payload: BatchSynthesizeRequest) -> JSONResponse:
    items = list(payload.items or [])
    if not items:
        raise HTTPException(status_code=400, detail="items must contain at least one request.")
    if len(items) > GEMINI_BATCH_MAX_ITEMS:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "batch_limit_exceeded",
                "maxItems": GEMINI_BATCH_MAX_ITEMS,
                "actualItems": len(items),
            },
        )

    requested_parallelism = payload.parallelism if payload.parallelism is not None else GEMINI_BATCH_DEFAULT_PARALLEL
    if requested_parallelism < 1:
        raise HTTPException(status_code=400, detail="parallelism must be >= 1.")
    if requested_parallelism > GEMINI_BATCH_MAX_PARALLEL:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "parallelism_limit_exceeded",
                "maxParallelism": GEMINI_BATCH_MAX_PARALLEL,
                "requestedParallelism": requested_parallelism,
            },
        )

    effective_parallelism = min(int(requested_parallelism), len(items))
    if _SERVER_API_KEY_POOL:
        effective_parallelism = min(effective_parallelism, len(_SERVER_API_KEY_POOL))
    effective_parallelism = max(1, effective_parallelism)

    def run_item(index: int, item: BatchSynthesizeItem) -> Dict[str, Any]:
        item_trace_id = _normalize_trace_id(item.trace_id)
        _emit_stage_event(
            item_trace_id,
            "batch_item",
            "start",
            {"index": index, "parallelism": effective_parallelism},
        )
        try:
            synthesis_result = _synthesize_text_to_wav(item)
            _emit_stage_event(
                str(synthesis_result.get("traceId") or item_trace_id),
                "batch_item",
                "done",
                {
                    "index": index,
                    "bytes": len(bytes(synthesis_result.get("wavBytes") or b"")),
                    "speechModeUsed": synthesis_result.get("speechModeUsed"),
                },
            )
            return {
                "index": index,
                "id": item.id,
                "ok": True,
                "audioBase64": base64.b64encode(bytes(synthesis_result["wavBytes"])).decode("ascii"),
                "contentType": "audio/wav",
                "trace_id": synthesis_result.get("traceId"),
                "meta": {
                    "model": synthesis_result.get("model"),
                    "speechModeRequested": synthesis_result.get("speechModeRequested"),
                    "speechModeUsed": synthesis_result.get("speechModeUsed"),
                    "speechModes": synthesis_result.get("speechModes"),
                    "windowCount": synthesis_result.get("windowCount"),
                    "keySelectionIndex": synthesis_result.get("keySelectionIndex"),
                    "keyPoolSize": synthesis_result.get("keyPoolSize"),
                    "speakerHint": synthesis_result.get("speakerHint"),
                },
            }
        except HTTPException as exc:
            detail_payload = exc.detail if isinstance(exc.detail, dict) else {"message": str(exc.detail)}
            trace_value = str(detail_payload.get("trace_id") or item_trace_id)
            _emit_stage_event(
                trace_value,
                "batch_item",
                "error",
                {"index": index, "statusCode": exc.status_code, "error": detail_payload},
            )
            return {
                "index": index,
                "id": item.id,
                "ok": False,
                "trace_id": trace_value,
                "error": {
                    "statusCode": exc.status_code,
                    **detail_payload,
                },
            }
        except Exception as exc:  # noqa: BLE001
            detail_text = str(exc).strip() or "Gemini batch item synthesis failed."
            _emit_stage_event(
                item_trace_id,
                "batch_item",
                "error",
                {"index": index, "statusCode": 500, "error": detail_text},
            )
            return {
                "index": index,
                "id": item.id,
                "ok": False,
                "trace_id": item_trace_id,
                "error": {
                    "statusCode": 500,
                    "error": detail_text,
                    "errorCode": ERROR_CODE_UPSTREAM_MODEL_FAILED,
                    "summary": detail_text[:220],
                },
            }

    results: list[Dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=effective_parallelism) as executor:
        futures = [executor.submit(run_item, index, item) for index, item in enumerate(items)]
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())

    ordered_items = sorted(results, key=lambda entry: int(entry.get("index", 0)))
    succeeded = sum(1 for item in ordered_items if bool(item.get("ok")))
    failed = max(0, len(ordered_items) - succeeded)
    return JSONResponse(
        {
            "ok": failed == 0,
            "engine": APP_NAME,
            "summary": {
                "requested": len(items),
                "succeeded": succeeded,
                "failed": failed,
                "parallelismUsed": effective_parallelism,
            },
            "items": ordered_items,
        }
    )
