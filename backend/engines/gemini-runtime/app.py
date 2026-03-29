import asyncio
import base64
import concurrent.futures
import hmac
import hashlib
import importlib.util
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

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

_SEGMENTATION_SPEC = importlib.util.spec_from_file_location(
    "gemini_runtime_segmentation",
    Path(__file__).with_name("segmentation.py"),
)
assert _SEGMENTATION_SPEC is not None and _SEGMENTATION_SPEC.loader is not None
_SEGMENTATION_MODULE = importlib.util.module_from_spec(_SEGMENTATION_SPEC)
_SEGMENTATION_SPEC.loader.exec_module(_SEGMENTATION_MODULE)
MAX_WORDS_PER_REQUEST = _SEGMENTATION_MODULE.MAX_WORDS_PER_REQUEST
SEGMENTATION_PROFILE = _SEGMENTATION_MODULE.SEGMENTATION_PROFILE
THREE_LANE_IDS = _SEGMENTATION_MODULE.THREE_LANE_IDS
MULTI_SPEAKER_FIRST_DIALOG_TRIGGER_CHARS = _SEGMENTATION_MODULE.MULTI_SPEAKER_FIRST_DIALOG_TRIGGER_CHARS
MULTI_SPEAKER_FIRST_DIALOG_STAGE_TARGETS = _SEGMENTATION_MODULE.MULTI_SPEAKER_FIRST_DIALOG_STAGE_TARGETS
MULTI_SPEAKER_FIRST_DIALOG_STAGE_HARD_CAPS = _SEGMENTATION_MODULE.MULTI_SPEAKER_FIRST_DIALOG_STAGE_HARD_CAPS
MULTI_SPEAKER_CONTINUATION_TARGET_CHARS = _SEGMENTATION_MODULE.MULTI_SPEAKER_CONTINUATION_TARGET_CHARS
MULTI_SPEAKER_CONTINUATION_HARD_CAP = _SEGMENTATION_MODULE.MULTI_SPEAKER_CONTINUATION_HARD_CAP
SINGLE_SPEAKER_STAGE_PLAN = _SEGMENTATION_MODULE.SINGLE_SPEAKER_STAGE_PLAN
build_progressive_sentence_aware_chunks = _SEGMENTATION_MODULE.build_progressive_sentence_aware_chunks
chunk_text_for_tts = _SEGMENTATION_MODULE.chunk_text_for_tts
count_words = _SEGMENTATION_MODULE.count_words
resolve_chunk_profile = _SEGMENTATION_MODULE.resolve_chunk_profile

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
    duplicate_key_memberships,
    flatten_pool_keys,
    list_pool_names as list_runtime_pool_names,
    load_pool_config as load_pool_config_shared,
    normalize_pool_config,
    overlay_cached_authoritative_free_pool as overlay_cached_runtime_free_pool_shared,
    read_key_file_text as read_runtime_key_file_text_shared,
    resolve_default_pool_hint as resolve_default_runtime_pool_hint,
    resolve_effective_keys as resolve_effective_keys_shared,
    save_pool_config as save_pool_config_shared,
    SOURCE_POLICY_PROVIDER_GEMINI_API,
    SOURCE_POLICY_PROVIDER_VERTEX,
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

try:
    from google.oauth2 import credentials as google_oauth2_credentials
except Exception:
    google_oauth2_credentials = None

try:
    from google.cloud import texttospeech_v1 as google_texttospeech
except Exception:
    google_texttospeech = None

try:
    from google.oauth2 import service_account as google_service_account
except Exception:
    google_service_account = None

APP_NAME = "gemini-runtime"
GEMINI_RUNTIME_ADMIN_TOKEN = str(os.getenv("GEMINI_RUNTIME_ADMIN_TOKEN") or "").strip()
TTS_UPSTREAM_PROVIDER_RUNTIME = "runtime"
TTS_UPSTREAM_PROVIDER_CLOUD_TTS = "texttospeech"
VF_GEMINI_SINGLE_POOL_ENFORCE = (
    str(os.getenv("VF_GEMINI_SINGLE_POOL_ENFORCE") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)


def _constant_time_equal(left: str, right: str) -> bool:
    return hmac.compare_digest(str(left or "").encode("utf-8"), str(right or "").encode("utf-8"))


def _require_runtime_admin(request: Request) -> None:
    expected = str(GEMINI_RUNTIME_ADMIN_TOKEN or "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="Runtime admin token is not configured.")
    provided_header = str(request.headers.get("x-admin-token") or "").strip()
    if provided_header and _constant_time_equal(provided_header, expected):
        return
    auth_header = str(request.headers.get("authorization") or "").strip()
    if auth_header.lower().startswith("bearer "):
        bearer = auth_header.split(" ", 1)[1].strip()
        if bearer and _constant_time_equal(bearer, expected):
            return
    raise HTTPException(status_code=403, detail="Admin authorization failed.")


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
    if tts_rpm_override is not None or tts_tpm_override is not None:
        for model_id, current in list(next_models.items()):
            if "tts" not in current.enabled_for:
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
SERVER_API_KEY = ""
SERVER_API_KEYS_RAW = ""
GEMINI_SLOT_CONFIG_FILE = str(os.getenv("GEMINI_API_POOLS_FILE") or (RUNTIME_ROOT / "config" / "gemini_api_pools.json")).strip()
DEFAULT_GEMINI_SLOT_CONFIG_FILE = RUNTIME_ROOT / "config" / "gemini_api_pools.json"
GEMINI_API_POOLS_FILE = (
    str(os.getenv("GEMINI_API_POOLS_FILE") or (RUNTIME_ROOT / "config" / "gemini_api_pools.json")).strip()
)
GEMINI_VERTEX_SECRET_DIR = (RUNTIME_ROOT / ".runtime" / "secrets" / "gemini").resolve()
GEMINI_VERTEX_SERVICE_ACCOUNT_FILE = str(
    os.getenv("VF_GEMINI_VERTEX_SERVICE_ACCOUNT_FILE")
    or (GEMINI_VERTEX_SECRET_DIR / "vertex-service-account.json")
).strip()
GEMINI_VERTEX_ACCESS_TOKEN_FILE = str(
    os.getenv("VF_GEMINI_VERTEX_ACCESS_TOKEN_FILE")
    or (GEMINI_VERTEX_SECRET_DIR / "vertex-access-token.txt")
).strip()
VF_TTS_UPSTREAM_PROVIDER = str(os.getenv("VF_TTS_UPSTREAM_PROVIDER") or TTS_UPSTREAM_PROVIDER_RUNTIME).strip().lower()
VF_TTS_TEXTTOSPEECH_ONLY = (
    str(os.getenv("VF_TTS_TEXTTOSPEECH_ONLY") or "0").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_TTS_TEXTTOSPEECH_VOICE_CACHE_TTL_SECONDS = max(
    60,
    int(os.getenv("VF_TTS_TEXTTOSPEECH_VOICE_CACHE_TTL_SECONDS", "1800")),
)
TTS_MODEL_FALLBACKS = list(ALLOCATOR_CONFIG.routes["tts"])
TEXT_MODEL_FALLBACKS = list(ALLOCATOR_CONFIG.routes["text"])
OCR_MODEL_FALLBACKS = list(ALLOCATOR_CONFIG.routes["ocr"])
TTS_ENGINE_DEFAULT = "PRIME"
TTS_ENGINE_KEYS = frozenset({"PRIME", "VECTOR", "DUNO"})
TTS_MODEL_CANDIDATES_BY_AUTH_MODE: Dict[str, Dict[str, list[str]]] = {
    SOURCE_POLICY_PROVIDER_GEMINI_API: {
        "VECTOR": [
            "gemini-2.5-flash-tts",
            "gemini-2.5-pro-tts",
        ],
        "PRIME": [
            "gemini-2.5-flash-tts",
            "gemini-2.5-pro-tts",
        ],
    },
    SOURCE_POLICY_PROVIDER_VERTEX: {
        "VECTOR": [
            "gemini-2.5-flash-tts",
            "gemini-2.5-pro-tts",
        ],
        "PRIME": [
            "gemini-2.5-flash-tts",
            "gemini-2.5-pro-tts",
        ],
    },
}
MODEL_DISCOVERY_TTL_SECONDS = max(60, int(os.getenv("GEMINI_MODEL_DISCOVERY_TTL_SECONDS", "600")))
MODEL_DISCOVERY_SCAN_LIMIT = max(20, int(os.getenv("GEMINI_MODEL_DISCOVERY_SCAN_LIMIT", "200")))
KEY_COOLDOWN_BASE_MS = max(1000, int(os.getenv("GEMINI_KEY_COOLDOWN_BASE_MS", "8000")))
KEY_COOLDOWN_MAX_MS = max(KEY_COOLDOWN_BASE_MS, int(os.getenv("GEMINI_KEY_COOLDOWN_MAX_MS", "120000")))
KEY_RETRY_LIMIT = max(1, int(os.getenv("GEMINI_KEY_RETRY_LIMIT", "8")))
KEY_WAIT_SLICE_MS = max(100, int(os.getenv("GEMINI_KEY_WAIT_SLICE_MS", "300")))
GEMINI_KEY_ROTATION_BURST = _read_positive_int_env("GEMINI_KEY_ROTATION_BURST")
KEY_TOTAL_TIMEOUT_MS = max(
    5000,
    int(os.getenv("GEMINI_KEY_TOTAL_TIMEOUT_MS", str(ALLOCATOR_CONFIG.default_wait_timeout_ms))),
)
KEY_AUTH_DISABLE_MS = max(60_000, int(os.getenv("GEMINI_KEY_AUTH_DISABLE_MS", "600000")))
ALLOCATOR_WAIT_SLICE_MS = max(100, int(os.getenv("GEMINI_ALLOCATOR_WAIT_SLICE_MS", "250")))
GEMINI_ALLOCATOR_DISABLE_RATE_LIMITS = (
    (os.getenv("GEMINI_ALLOCATOR_DISABLE_RATE_LIMITS") or "0").strip().lower()
    in {"1", "true", "yes", "on"}
)
GEMINI_TTS_SINGLE_REQUEST_TIMEOUT_MS = max(
    1000,
    int(os.getenv("GEMINI_TTS_SINGLE_REQUEST_TIMEOUT_MS", "22000")),
)
GEMINI_TTS_MULTI_REQUEST_TIMEOUT_MS = max(
    1000,
    int(os.getenv("GEMINI_TTS_MULTI_REQUEST_TIMEOUT_MS", "35000")),
)
GEMINI_TTS_ADMISSION_MAX_WAIT_MS = max(
    1000,
    int(os.getenv("GEMINI_TTS_ADMISSION_MAX_WAIT_MS", "7000")),
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
GEMINI_STUDIO_PAIR_GROUP_MAX_CONCURRENCY = max(
    1,
    int(os.getenv("GEMINI_STUDIO_PAIR_GROUP_MAX_CONCURRENCY", "6")),
)
GEMINI_MULTI_SPEAKER_WINDOW_PAUSE_MS = max(
    0,
    int(os.getenv("GEMINI_MULTI_SPEAKER_WINDOW_PAUSE_MS", "30")),
)
_CLOUD_TTS_CLIENTS: dict[str, Any] = {}
_CLOUD_TTS_CLIENT_LOCK = threading.Lock()
_CLOUD_TTS_VOICE_CACHE: dict[str, dict[str, Any]] = {}
_CLOUD_TTS_VOICE_CACHE_LOCK = threading.Lock()
_KNOWN_GEMINI_VOICE_GENDERS: dict[str, str] = {
    "fenrir": "male",
    "kore": "female",
    "alnilam": "male",
    "leda": "female",
    "iapetus": "male",
    "autonoe": "female",
    "enceladus": "male",
    "erinome": "female",
    "puck": "male",
    "charon": "male",
    "achernar": "female",
    "despina": "female",
    "algenib": "male",
    "algieba": "male",
    "zephyr": "female",
    "callirrhoe": "female",
    "achird": "male",
    "aoede": "female",
    "gacrux": "female",
    "laomedeia": "female",
    "orus": "male",
    "pulcherrima": "female",
    "rasalgethi": "male",
    "sadachbia": "male",
    "sadaltager": "male",
    "schedar": "male",
    "sulafat": "female",
    "umbriel": "male",
    "vindemiatrix": "female",
    "zubenelgenubi": "male",
}
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
    key_rotation_burst=GEMINI_KEY_ROTATION_BURST,
    disable_rate_limits=GEMINI_ALLOCATOR_DISABLE_RATE_LIMITS,
)
GEMINI_SPEAKER_KEY_AFFINITY_ENABLED = (
    (os.getenv("GEMINI_SPEAKER_KEY_AFFINITY_ENABLED") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
SPEAKER_KEY_AFFINITY_MAX = max(64, int(os.getenv("GEMINI_SPEAKER_KEY_AFFINITY_MAX", "4096")))
_SPEAKER_KEY_AFFINITY: Dict[str, Dict[str, Any]] = {}
GEMINI_SLOT_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
ERROR_CODE_SLOT_SET_MISSING = "GEMINI_SLOT_SET_MISSING"
ERROR_CODE_RUNTIME_SDK_UNAVAILABLE = "GEMINI_RUNTIME_SDK_UNAVAILABLE"
ERROR_CODE_ALL_SLOTS_AUTH_FAILED = "GEMINI_ALL_SLOTS_AUTH_FAILED"
ERROR_CODE_ALL_SLOTS_RATE_LIMITED = "GEMINI_ALL_SLOTS_RATE_LIMITED"
ERROR_CODE_SLOT_SET_OVERLOADED = "GEMINI_SLOT_SET_OVERLOADED"
ERROR_CODE_SLOT_SET_TIMEOUT = "GEMINI_SLOT_SET_TIMEOUT"
ERROR_CODE_ALLOCATOR_ACQUIRE_TIMEOUT = "GEMINI_ALLOCATOR_ACQUIRE_TIMEOUT"
ERROR_CODE_UPSTREAM_REQUEST_TIMEOUT = "GEMINI_UPSTREAM_REQUEST_TIMEOUT"
ERROR_CODE_UPSTREAM_MODEL_FAILED = "GEMINI_UPSTREAM_MODEL_FAILED"
SLOT_SET_MISSING_SUMMARY = (
    "Primary AI slot set is empty. Configure the backend-held service-account slots."
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
LOCALHOST_CORS_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$"
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
    if not GEMINI_SPEAKER_KEY_AFFINITY_ENABLED:
        return None
    if not speakers or not key_pool:
        return None
    key_pool_set = set(key_pool)
    with _KEY_STATE_LOCK:
        for speaker in speakers:
            normalized = _normalize_speaker_affinity_id(speaker)
            if not normalized:
                continue
            state = _SPEAKER_KEY_AFFINITY.get(normalized) or {}
            bound_key = str(state.get("key") or "").strip()
            if bound_key and bound_key in key_pool_set:
                return bound_key
    return None


def _bind_speakers_to_key(speakers: list[str], key: str) -> None:
    if not GEMINI_SPEAKER_KEY_AFFINITY_ENABLED:
        return
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
    if not GEMINI_SPEAKER_KEY_AFFINITY_ENABLED:
        return
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
        payload["detail"] = _sanitize_stage_event_detail(status, detail)
    print(json.dumps(payload, ensure_ascii=True), flush=True)


_PUBLIC_TTS_ERROR_ALLOWED_KEYS = {
    "errorCode",
    "classification",
    "summary",
    "reason",
    "trace_id",
    "retryAfterMs",
    "estimatedWaitMs",
    "timeoutMs",
    "elapsedMs",
    "attemptsUsed",
    "timedOut",
    "poolExhausted",
    "speechModeRequested",
    "speakerHint",
    "engine",
    "windowIndex",
    "windowTotal",
    "availableLanes",
}

_PUBLIC_TTS_ERROR_MESSAGE_BY_CODE = {
    ERROR_CODE_SLOT_SET_MISSING: "Primary AI slot set is not configured.",
    ERROR_CODE_RUNTIME_SDK_UNAVAILABLE: "Gemini runtime dependencies are unavailable.",
    ERROR_CODE_ALL_SLOTS_AUTH_FAILED: "All configured Gemini slots were rejected by upstream authentication.",
    ERROR_CODE_ALL_SLOTS_RATE_LIMITED: "Gemini capacity is temporarily rate limited.",
    ERROR_CODE_SLOT_SET_OVERLOADED: "Primary AI slot set is temporarily overloaded.",
    ERROR_CODE_SLOT_SET_TIMEOUT: "Primary AI slot set timed out while waiting for capacity.",
    ERROR_CODE_ALLOCATOR_ACQUIRE_TIMEOUT: "Gemini allocator timed out while waiting for capacity.",
    ERROR_CODE_UPSTREAM_REQUEST_TIMEOUT: "Gemini upstream request timed out.",
    ERROR_CODE_UPSTREAM_MODEL_FAILED: "Gemini TTS synthesis failed.",
}

_PUBLIC_TTS_ERROR_MESSAGE_BY_REASON = {
    "capacity_pressure": "Primary AI slot set is temporarily overloaded.",
}

_SENSITIVE_TTS_ERROR_TOKENS = (
    "__vf_masked_key__",
    "AIza",
    "keyfingerprint",
    "keystates",
    "keyattempts",
    "modelattempts",
    "traceback",
    "connectionpool",
    "requests.exceptions",
    "127.0.0.1",
    "localhost",
    "http://",
    "https://",
    "[errno",
)


def _default_public_tts_error_message(error_code: str = "", reason: str = "") -> str:
    safe_error_code = str(error_code or "").strip().upper()
    safe_reason = str(reason or "").strip().lower()
    if safe_error_code and safe_error_code in _PUBLIC_TTS_ERROR_MESSAGE_BY_CODE:
        return _PUBLIC_TTS_ERROR_MESSAGE_BY_CODE[safe_error_code]
    if safe_reason and safe_reason in _PUBLIC_TTS_ERROR_MESSAGE_BY_REASON:
        return _PUBLIC_TTS_ERROR_MESSAGE_BY_REASON[safe_reason]
    return "Gemini TTS request failed."


def _sanitize_public_tts_error_text(value: object, *, fallback: str, max_len: int = 220) -> str:
    text = str(value or "").strip()
    if not text:
        return fallback
    lowered = text.lower()
    if (
        text.startswith("{")
        or text.startswith("[")
        or "{" in text
        or "}" in text
        or "\n" in text
        or "\r" in text
        or any(token in lowered for token in _SENSITIVE_TTS_ERROR_TOKENS)
        or len(text) > max_len
    ):
        return fallback
    return text


def _sanitize_public_tts_error_payload(detail: Dict[str, object]) -> Dict[str, object]:
    error_code = str(detail.get("errorCode") or "").strip().upper()
    reason = str(detail.get("reason") or "").strip().lower()
    fallback = _default_public_tts_error_message(error_code, reason)
    safe: Dict[str, object] = {
        "error": _sanitize_public_tts_error_text(detail.get("error"), fallback=fallback),
    }
    for key in _PUBLIC_TTS_ERROR_ALLOWED_KEYS:
        if key not in detail:
            continue
        value = detail.get(key)
        if key in {"timedOut", "poolExhausted"}:
            safe[key] = bool(value)
        elif key in {
            "retryAfterMs",
            "estimatedWaitMs",
            "timeoutMs",
            "elapsedMs",
            "attemptsUsed",
            "windowIndex",
            "windowTotal",
            "availableLanes",
        }:
            safe[key] = max(0, _safe_int(value, 0))
        elif key == "summary":
            safe[key] = _sanitize_public_tts_error_text(value, fallback=str(safe["error"]))
        else:
            token = str(value or "").strip()
            if token:
                safe[key] = token
    return safe


def _sanitize_stage_event_detail(status: str, detail: Dict[str, object]) -> Dict[str, object]:
    if str(status or "").strip().lower() in {"error", "overloaded", "failed"}:
        return _sanitize_public_tts_error_payload(detail)
    return detail


class SynthesizeRequest(BaseModel):
    engine: Optional[str] = TTS_ENGINE_DEFAULT
    authMode: Optional[str] = None
    text: str = Field(min_length=1)
    model: Optional[str] = None
    modelCandidates: Optional[list[str]] = None
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
    sourcePolicy: Optional[Dict[str, Any]] = None


class BatchSynthesizeItem(SynthesizeRequest):
    id: Optional[str] = None


class BatchSynthesizeRequest(BaseModel):
    items: list[BatchSynthesizeItem] = Field(min_length=1)
    parallelism: Optional[int] = None


class TextGenerateRequest(BaseModel):
    userPrompt: str = Field(min_length=1)
    systemPrompt: Optional[str] = ""
    model: Optional[str] = None
    modelCandidates: Optional[list[str]] = None
    jsonMode: bool = False
    apiKey: Optional[str] = ""
    temperature: float = 0.7
    trace_id: Optional[str] = None


class CountTokensRequest(BaseModel):
    contents: str = Field(min_length=1)
    model: Optional[str] = None
    modelCandidates: Optional[list[str]] = None
    apiKey: Optional[str] = ""
    task: Optional[str] = "text"


class ApiPoolsConfigUpdateRequest(BaseModel):
    version: Optional[int] = None
    pools: dict[str, Any]
    fallbackChains: Optional[dict[str, Any]] = None
    planPools: Optional[dict[str, Any]] = None
    defaultFallbackChain: Optional[list[Any]] = None
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


def _is_native_audio_model(model_name: str) -> bool:
    token = _normalize_model_name(str(model_name or "")).lower()
    return "native-audio" in token or token.startswith("gemini-live-") or "-live-" in token


def _decode_inline_blob_data(raw_data: object) -> bytes:
    if isinstance(raw_data, bytes):
        return raw_data
    if isinstance(raw_data, str):
        try:
            return base64.b64decode(raw_data)
        except Exception:
            return b""
    return b""


def _extract_live_audio_chunks(message: object) -> list[bytes]:
    server_content = getattr(message, "server_content", None) or getattr(message, "serverContent", None)
    if server_content is None:
        return []
    model_turn = getattr(server_content, "model_turn", None) or getattr(server_content, "modelTurn", None)
    if model_turn is None:
        return []
    parts = list(getattr(model_turn, "parts", None) or [])
    out: list[bytes] = []
    for part in parts:
        inline_data = getattr(part, "inline_data", None) or getattr(part, "inlineData", None)
        if inline_data is None:
            continue
        mime_type = str(
            getattr(inline_data, "mime_type", None)
            or getattr(inline_data, "mimeType", None)
            or ""
        ).lower()
        if "audio/" not in mime_type:
            continue
        chunk = _decode_inline_blob_data(getattr(inline_data, "data", None))
        if chunk:
            out.append(chunk)
    return out


def _live_server_turn_complete(message: object) -> bool:
    server_content = getattr(message, "server_content", None) or getattr(message, "serverContent", None)
    if server_content is None:
        return False
    return bool(
        getattr(server_content, "generation_complete", False)
        or getattr(server_content, "generationComplete", False)
        or getattr(server_content, "turn_complete", False)
        or getattr(server_content, "turnComplete", False)
        or getattr(server_content, "interrupted", False)
    )


async def _synthesize_live_pcm_async(
    *,
    client: object,
    model_id: str,
    text_input: str,
    speech_config: object,
) -> tuple[bytes, Optional[Dict[str, int]]]:
    if types is None:
        raise RuntimeError("google-genai types are unavailable in runtime.")
    if not hasattr(client, "aio") or not hasattr(client.aio, "live"):
        raise RuntimeError("Gemini Live API client is unavailable in runtime.")

    live_config = types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        speech_config=speech_config,
    )

    audio_chunks: list[bytes] = []
    usage_metadata: Optional[Dict[str, int]] = None
    async with client.aio.live.connect(model=model_id, config=live_config) as session:
        await session.send_client_content(
            turns=types.Content(
                role="user",
                parts=[types.Part(text=text_input)],
            ),
            turn_complete=True,
        )
        async for message in session.receive():
            live_usage = extract_usage_metadata(message)
            if isinstance(live_usage, dict):
                usage_metadata = dict(live_usage)
            chunks = _extract_live_audio_chunks(message)
            if chunks:
                audio_chunks.extend(chunks)
            if _live_server_turn_complete(message) and audio_chunks:
                break
    if not audio_chunks:
        raise ValueError("No audio payload returned by Gemini Live API.")
    return b"".join(audio_chunks), usage_metadata


def _synthesize_live_pcm(
    *,
    client: object,
    model_id: str,
    text_input: str,
    speech_config: object,
    timeout_ms: int,
) -> tuple[bytes, Optional[Dict[str, int]]]:
    timeout_sec = max(1.0, float(timeout_ms) / 1000.0)
    coro = _synthesize_live_pcm_async(
        client=client,
        model_id=model_id,
        text_input=text_input,
        speech_config=speech_config,
    )
    try:
        return asyncio.run(asyncio.wait_for(coro, timeout=timeout_sec))
    except RuntimeError as exc:
        if "asyncio.run() cannot be called from a running event loop" not in str(exc):
            raise
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(
                lambda: asyncio.run(asyncio.wait_for(coro, timeout=timeout_sec))
            )
            return future.result(timeout=timeout_sec + 1.0)


def resolve_language_code(text: str, hint: Optional[str]) -> str:
    normalized = str(hint or "").strip().lower()
    if normalized.startswith("hi"):
        return "hi-IN"
    if normalized.startswith("en"):
        return "en-US"
    if re.search(r"[\u0900-\u097F]", str(text or "")):
        return "hi-IN"
    return "en-US"


_DEPRECATED_LIVE_MODEL_ALIASES: dict[str, str] = {
    "gemini-2.5-flash-native-audio-dialog": "gemini-2.5-flash-native-audio-latest",
    "gemini-2.5-flash-preview-native-audio-dialog": "gemini-2.5-flash-native-audio-latest",
    "gemini-2.5-flash-exp-native-audio-thinking-dialog": "gemini-2.5-flash-native-audio-latest",
}


def _normalize_model_name(model_name: str) -> str:
    normalized = normalize_model_name(model_name)
    if not normalized:
        return ""
    return _DEPRECATED_LIVE_MODEL_ALIASES.get(normalized.lower(), normalized)


def _normalize_runtime_engine(raw_engine: object, default: str = TTS_ENGINE_DEFAULT) -> str:
    token = str(raw_engine or "").strip().upper()
    if not token:
        return str(default or TTS_ENGINE_DEFAULT).strip().upper() or TTS_ENGINE_DEFAULT
    if token in TTS_ENGINE_KEYS:
        return token
    raise HTTPException(status_code=400, detail="Invalid engine. Use DUNO, VECTOR, or PRIME.")


def _normalize_tts_upstream_provider(raw_provider: object) -> str:
    token = str(raw_provider or "").strip().lower()
    if token in {
        TTS_UPSTREAM_PROVIDER_CLOUD_TTS,
        "cloud_tts",
        "cloud-tts",
        "cloud-text-to-speech",
    }:
        return TTS_UPSTREAM_PROVIDER_CLOUD_TTS
    return TTS_UPSTREAM_PROVIDER_RUNTIME


def _tts_upstream_provider_for_engine(engine: str) -> str:
    safe_engine = _normalize_runtime_engine(engine, default=TTS_ENGINE_DEFAULT)
    if safe_engine in {"PRIME", "VECTOR"} and (
        VF_TTS_TEXTTOSPEECH_ONLY
        or _normalize_tts_upstream_provider(VF_TTS_UPSTREAM_PROVIDER) == TTS_UPSTREAM_PROVIDER_CLOUD_TTS
    ):
        return TTS_UPSTREAM_PROVIDER_CLOUD_TTS
    return TTS_UPSTREAM_PROVIDER_RUNTIME


def _tts_provider_label(*, engine: str, auth_mode: str) -> str:
    upstream_provider = _tts_upstream_provider_for_engine(engine)
    if upstream_provider == TTS_UPSTREAM_PROVIDER_CLOUD_TTS:
        return "cloud-text-to-speech"
    return "gemini-api" if auth_mode == SOURCE_POLICY_PROVIDER_GEMINI_API else "vertex-ai"


def _resolve_cloud_tts_credentials_path(source_policy: Optional[dict[str, Any]] = None) -> Optional[Path]:
    policy = dict(source_policy or {})
    selected_slot_id = str(policy.get("selectedVertexSlotId") or policy.get("vertexSlotId") or "").strip()
    accounts = [dict(item) for item in list(policy.get("vertexAccounts") or []) if isinstance(item, dict)]
    raw_candidates: list[object] = []
    normalized_selected_slot_id = selected_slot_id.lower()
    if normalized_selected_slot_id:
        for account in accounts:
            slot_id = str(account.get("memberId") or account.get("slotId") or account.get("id") or "").strip().lower()
            if slot_id and slot_id == normalized_selected_slot_id:
                raw_candidates.extend(
                    [
                        account.get("vertexServiceAccountRef"),
                        account.get("serviceAccountRef"),
                        account.get("credentialsPath"),
                    ]
                )
                break
    raw_candidates.extend(
        [
            policy.get("vertexServiceAccountRef"),
            policy.get("serviceAccountRef"),
            os.getenv("GOOGLE_APPLICATION_CREDENTIALS"),
            GEMINI_VERTEX_SERVICE_ACCOUNT_FILE,
        ]
    )
    for raw_value in raw_candidates:
        raw_path = str(raw_value or "").strip()
        if not raw_path:
            continue
        path = Path(raw_path).expanduser()
        candidates: list[Path] = []
        if path.is_absolute():
            candidates.append(path)
        else:
            candidates.extend(
                [
                    (WORKSPACE_ROOT / path).resolve(),
                    (RUNTIME_ROOT / path).resolve(),
                    (Path(__file__).resolve().parent / path).resolve(),
                ]
            )
        for candidate in candidates:
            if candidate.exists() and candidate.is_file():
                return candidate.resolve()
    return None


def _cloud_tts_client_cache_key(source_policy: Optional[dict[str, Any]] = None) -> str:
    credentials_path = _resolve_cloud_tts_credentials_path(source_policy=source_policy)
    if credentials_path is None:
        return "default"
    return str(credentials_path)


def _build_cloud_tts_client(source_policy: Optional[dict[str, Any]] = None) -> Any:
    if google_texttospeech is None:
        raise RuntimeError("google-cloud-texttospeech is unavailable in runtime.")

    client_kwargs: Dict[str, Any] = {}
    credentials_path = _resolve_cloud_tts_credentials_path(source_policy=source_policy)
    if credentials_path is not None:
        if google_service_account is None:
            raise RuntimeError("google.oauth2.service_account is unavailable in runtime.")
        client_kwargs["credentials"] = google_service_account.Credentials.from_service_account_file(
            str(credentials_path)
        )
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(credentials_path)
    return google_texttospeech.TextToSpeechClient(**client_kwargs)


def _cloud_tts_client(source_policy: Optional[dict[str, Any]] = None) -> Any:
    cache_key = _cloud_tts_client_cache_key(source_policy=source_policy)
    cached = _CLOUD_TTS_CLIENTS.get(cache_key)
    if cached is not None:
        return cached
    with _CLOUD_TTS_CLIENT_LOCK:
        cached = _CLOUD_TTS_CLIENTS.get(cache_key)
        if cached is None:
            cached = _build_cloud_tts_client(source_policy=source_policy)
            _CLOUD_TTS_CLIENTS[cache_key] = cached
        return cached


def _cloud_tts_client_ready(source_policy: Optional[dict[str, Any]] = None) -> bool:
    if google_texttospeech is None:
        return False
    return _resolve_cloud_tts_credentials_path(source_policy=source_policy) is not None


def _cloud_tts_gender_hint(requested_voice: str) -> int:
    token = str(requested_voice or "").strip().lower()
    if not token:
        return int(getattr(google_texttospeech.SsmlVoiceGender, "NEUTRAL", 3)) if google_texttospeech is not None else 3
    if any(label in token for label in {"female", "woman", "girl"}):
        return int(getattr(google_texttospeech.SsmlVoiceGender, "FEMALE", 2)) if google_texttospeech is not None else 2
    if any(label in token for label in {"male", "man", "boy"}):
        return int(getattr(google_texttospeech.SsmlVoiceGender, "MALE", 1)) if google_texttospeech is not None else 1
    mapped = _KNOWN_GEMINI_VOICE_GENDERS.get(token)
    if mapped == "female":
        return int(getattr(google_texttospeech.SsmlVoiceGender, "FEMALE", 2)) if google_texttospeech is not None else 2
    if mapped == "male":
        return int(getattr(google_texttospeech.SsmlVoiceGender, "MALE", 1)) if google_texttospeech is not None else 1
    return int(getattr(google_texttospeech.SsmlVoiceGender, "NEUTRAL", 3)) if google_texttospeech is not None else 3


def _cloud_tts_list_voices(
    *,
    client: Any,
    language_code: str,
    source_policy: Optional[dict[str, Any]] = None,
) -> list[Any]:
    cache_key = f"{_cloud_tts_client_cache_key(source_policy=source_policy)}::{str(language_code or '').strip().lower() or 'default'}"
    now_ms = int(time.time() * 1000)
    with _CLOUD_TTS_VOICE_CACHE_LOCK:
        cached = dict(_CLOUD_TTS_VOICE_CACHE.get(cache_key) or {})
        if cached and (now_ms - int(cached.get("updatedAtMs") or 0)) < (VF_TTS_TEXTTOSPEECH_VOICE_CACHE_TTL_SECONDS * 1000):
            return list(cached.get("voices") or [])
    response = client.list_voices(language_code=language_code)
    voices = list(getattr(response, "voices", []) or [])
    with _CLOUD_TTS_VOICE_CACHE_LOCK:
        _CLOUD_TTS_VOICE_CACHE[cache_key] = {
            "updatedAtMs": now_ms,
            "voices": list(voices),
        }
    return voices


def _cloud_tts_voice_rank(name: str, *, engine: str, language_code: str) -> tuple[int, int]:
    safe_name = str(name or "").strip()
    lowered_name = safe_name.lower()
    locale_prefix = str(language_code or "").strip().lower()
    locale_score = 0 if lowered_name.startswith(locale_prefix) else 1
    if engine == "VECTOR":
        if "neural2" in lowered_name:
            return (locale_score, 0)
        if "studio" in lowered_name or "journey" in lowered_name:
            return (locale_score, 1)
        if "wavenet" in lowered_name:
            return (locale_score, 2)
        if "standard" in lowered_name:
            return (locale_score, 3)
        return (locale_score, 4)
    if "studio" in lowered_name or "journey" in lowered_name:
        return (locale_score, 0)
    if "neural2" in lowered_name:
        return (locale_score, 1)
    if "wavenet" in lowered_name:
        return (locale_score, 2)
    if "standard" in lowered_name:
        return (locale_score, 3)
    return (locale_score, 4)


def _select_cloud_tts_voice(
    *,
    client: Any,
    language_code: str,
    requested_voice: str,
    engine: str,
    source_policy: Optional[dict[str, Any]] = None,
) -> tuple[Any, Dict[str, Any]]:
    desired_gender = _cloud_tts_gender_hint(requested_voice)
    voices = _cloud_tts_list_voices(client=client, language_code=language_code, source_policy=source_policy)
    compatible = [voice for voice in voices if list(getattr(voice, "language_codes", []) or [])]
    if not compatible:
        params = google_texttospeech.VoiceSelectionParams(language_code=language_code)
        return params, {"requestedVoice": requested_voice, "resolvedVoice": "", "languageCode": language_code}

    gender_filtered = [
        voice for voice in compatible if int(getattr(voice, "ssml_gender", 0) or 0) == int(desired_gender)
    ]
    if gender_filtered:
        compatible = gender_filtered
    compatible = sorted(
        compatible,
        key=lambda voice: (
            _cloud_tts_voice_rank(str(getattr(voice, "name", "")), engine=engine, language_code=language_code),
            str(getattr(voice, "name", "")),
        ),
    )
    seed = str(requested_voice or language_code or engine).strip().lower() or language_code.lower()
    pick_index = int(hashlib.sha256(seed.encode("utf-8", errors="ignore")).hexdigest(), 16) % len(compatible)
    selected = compatible[pick_index]
    selected_name = str(getattr(selected, "name", "") or "").strip()
    selected_language = list(getattr(selected, "language_codes", []) or [])
    selected_language_code = str(selected_language[0] if selected_language else language_code).strip() or language_code
    params = google_texttospeech.VoiceSelectionParams(
        language_code=selected_language_code,
        name=selected_name or None,
        ssml_gender=getattr(selected, "ssml_gender", None),
    )
    return params, {
        "requestedVoice": requested_voice,
        "resolvedVoice": selected_name,
        "languageCode": selected_language_code,
        "gender": int(getattr(selected, "ssml_gender", 0) or 0),
    }


def _synthesize_window_with_cloud_tts(
    *,
    source_policy: dict[str, Any],
    text: str,
    requested_voice: str,
    language_code: str,
    speed: float,
    engine: str,
) -> tuple[bytes, Dict[str, Any]]:
    if google_texttospeech is None:
        raise RuntimeError("google-cloud-texttospeech is unavailable in runtime.")
    client = _cloud_tts_client(source_policy=source_policy)
    voice_params, voice_meta = _select_cloud_tts_voice(
        client=client,
        language_code=language_code,
        requested_voice=requested_voice,
        engine=engine,
        source_policy=source_policy,
    )
    bounded_speed = max(0.25, min(2.0, float(speed or 1.0)))
    response = client.synthesize_speech(
        request={
            "input": google_texttospeech.SynthesisInput(text=text),
            "voice": voice_params,
            "audio_config": google_texttospeech.AudioConfig(
                audio_encoding=google_texttospeech.AudioEncoding.LINEAR16,
                speaking_rate=bounded_speed,
            ),
        }
    )
    audio_content = bytes(getattr(response, "audio_content", b"") or b"")
    if not audio_content:
        raise RuntimeError("Cloud Text-to-Speech returned empty audio.")
    return audio_content, voice_meta


def _concat_wav_fragments(
    wav_chunks: list[bytes],
    *,
    pause_ms: int = 0,
) -> bytes:
    if not wav_chunks:
        return b""
    if len(wav_chunks) == 1 and pause_ms <= 0:
        return bytes(wav_chunks[0] or b"")

    output = io.BytesIO()
    sample_rate = 0
    sample_width = 0
    channels = 0
    with wave.open(output, "wb") as writer:
        for index, chunk in enumerate(wav_chunks):
            with wave.open(io.BytesIO(bytes(chunk or b"")), "rb") as reader:
                current_channels = int(reader.getnchannels() or 0)
                current_width = int(reader.getsampwidth() or 0)
                current_rate = int(reader.getframerate() or 0)
                if index == 0:
                    sample_rate = current_rate
                    sample_width = current_width
                    channels = current_channels
                    writer.setnchannels(channels)
                    writer.setsampwidth(sample_width)
                    writer.setframerate(sample_rate)
                elif (current_channels, current_width, current_rate) != (channels, sample_width, sample_rate):
                    raise RuntimeError("Cloud Text-to-Speech returned mismatched WAV fragments.")
                writer.writeframes(reader.readframes(int(reader.getnframes() or 0)))
            if pause_ms > 0 and index < (len(wav_chunks) - 1):
                pause_frames = int(round((float(sample_rate) * float(pause_ms)) / 1000.0))
                if pause_frames > 0:
                    writer.writeframes(b"\x00" * pause_frames * sample_width * channels)
    return output.getvalue()


def _wav_bytes_to_pcm16(wav_bytes: bytes) -> tuple[bytes, int]:
    with wave.open(io.BytesIO(bytes(wav_bytes or b"")), "rb") as reader:
        channels = max(1, int(reader.getnchannels() or 1))
        sample_width = max(1, int(reader.getsampwidth() or 2))
        sample_rate = max(1, int(reader.getframerate() or 24000))
        frames = bytes(reader.readframes(int(reader.getnframes() or 0)) or b"")
    if sample_width != 2:
        raise RuntimeError("Expected 16-bit PCM WAV from Cloud Text-to-Speech.")
    if channels == 2:
        try:
            import audioop
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError("audioop is unavailable for WAV downmix.") from exc
        frames = audioop.tomono(frames, 2, 0.5, 0.5)
        channels = 1
    if channels != 1:
        raise RuntimeError(f"Unsupported Cloud TTS channel count: {channels}")
    return frames, sample_rate


def _normalize_runtime_auth_mode(
    raw_mode: object,
    *,
    source_policy: Optional[dict[str, Any]] = None,
) -> str:
    mode_token = str(raw_mode or "").strip().lower()
    if mode_token in {SOURCE_POLICY_PROVIDER_GEMINI_API, SOURCE_POLICY_PROVIDER_VERTEX}:
        return mode_token
    policy = dict(source_policy or {})
    provider = str(policy.get("provider") or SOURCE_POLICY_PROVIDER_GEMINI_API).strip().lower()
    if provider == SOURCE_POLICY_PROVIDER_VERTEX:
        return SOURCE_POLICY_PROVIDER_VERTEX
    return SOURCE_POLICY_PROVIDER_GEMINI_API


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
    _ = path_hint
    return _resolve_api_pools_file_path()


def _configured_key_file_path() -> str:
    return str(_resolve_api_pools_file_path())


def _resolved_key_file_path() -> str:
    return str(_resolve_api_pools_file_path())


def _build_server_api_key_pool() -> list[str]:
    try:
        config, _meta = _load_api_pool_config(force=True)
        slot_ids = list(resolve_effective_keys_shared(config, resolve_default_runtime_pool_hint(config)))
        if slot_ids:
            return slot_ids
    except Exception:
        pass
    return ["slot_1", "slot_2", "slot_3"]


def _resolve_api_pools_file_path() -> Path:
    configured = str(os.getenv("GEMINI_API_POOLS_FILE") or GEMINI_API_POOLS_FILE).strip()
    path = Path(configured).expanduser()
    if path.is_absolute():
        return path
    return (RUNTIME_ROOT / path).resolve()


def _resolve_vertex_service_account_store_path(path_hint: str) -> Path:
    raw_hint = str(path_hint or GEMINI_VERTEX_SERVICE_ACCOUNT_FILE).strip()
    path = Path(raw_hint).expanduser()
    if path.is_absolute():
        return path.resolve()
    return (RUNTIME_ROOT / path).resolve()


def _resolve_vertex_access_token_store_path(path_hint: str) -> Path:
    raw_hint = str(path_hint or GEMINI_VERTEX_ACCESS_TOKEN_FILE).strip()
    path = Path(raw_hint).expanduser()
    if path.is_absolute():
        return path.resolve()
    return (RUNTIME_ROOT / path).resolve()


def _persist_vertex_service_account_json(raw_json: str, *, path_hint: str) -> tuple[str, dict[str, Any]]:
    payload: dict[str, Any]
    try:
        parsed = json.loads(str(raw_json or "").strip())
    except Exception as exc:  # noqa: BLE001
        raise ValueError("Invalid Vertex service-account JSON.") from exc
    if not isinstance(parsed, dict):
        raise ValueError("Vertex service-account JSON must be an object.")
    payload = dict(parsed)
    if str(payload.get("type") or "").strip() not in {"", "service_account"}:
        raise ValueError("Vertex service-account JSON must be a service_account credential.")

    target_path = _resolve_vertex_service_account_store_path(path_hint)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target_path.with_suffix(f"{target_path.suffix}.tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")
    os.replace(str(tmp_path), str(target_path))
    try:
        os.chmod(str(target_path), 0o600)
    except Exception:
        pass
    return str(target_path), payload


def _persist_vertex_access_token(raw_token: str, *, path_hint: str) -> str:
    token = str(raw_token or "").strip()
    if not token:
        raise ValueError("Vertex access token cannot be empty.")
    target_path = _resolve_vertex_access_token_store_path(path_hint)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target_path.with_suffix(f"{target_path.suffix}.tmp")
    tmp_path.write_text(f"{token}\n", encoding="utf-8")
    os.replace(str(tmp_path), str(target_path))
    try:
        os.chmod(str(target_path), 0o600)
    except Exception:
        pass
    return str(target_path)


def _default_vertex_project() -> str:
    for env_name in (
        "GOOGLE_CLOUD_PROJECT",
        "GOOGLE_PROJECT_ID",
        "GCP_PROJECT",
        "GCLOUD_PROJECT",
        "FIREBASE_PROJECT_ID",
        "VITE_FIREBASE_PROJECT_ID",
        "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    ):
        candidate = str(os.getenv(env_name) or "").strip()
        if candidate:
            return candidate
    return ""


def _default_vertex_location() -> str:
    return str(
        os.getenv("GOOGLE_CLOUD_LOCATION")
        or os.getenv("GOOGLE_CLOUD_REGION")
        or "us-central1"
    ).strip() or "us-central1"


def _sanitize_source_policy_for_response(source_policy: dict[str, Any]) -> dict[str, Any]:
    policy = dict(source_policy or {})
    policy.pop("vertexServiceAccountJson", None)
    policy.pop("serviceAccountJson", None)
    policy.pop("vertexServiceAccount", None)
    policy.pop("vertexAccessToken", None)
    policy.pop("accessToken", None)
    policy.pop("vertexApiKey", None)
    service_account_ref = str(policy.get("vertexServiceAccountRef") or "").strip()
    access_token_ref = str(policy.get("vertexAccessTokenRef") or "").strip()
    policy["vertexServiceAccountConfigured"] = bool(service_account_ref)
    policy["vertexAccessTokenConfigured"] = bool(access_token_ref)
    return policy


RUNTIME_GEMINI_MASKED_KEY_TOKEN_PREFIX = "__vf_masked_key__:"
RUNTIME_GEMINI_MASKED_KEY_TOKEN_RE = re.compile(r"^__vf_masked_key__:(?P<fp>[0-9a-f]{12})(?::(?P<hint>[a-z0-9]{0,8}))?$")


def _runtime_gemini_key_fingerprint(value: str) -> str:
    token = str(value or "").strip()
    if not token:
        return ""
    return hashlib.sha256(token.encode("utf-8", errors="ignore")).hexdigest()[:12]


def _runtime_mask_gemini_key_for_response(value: str) -> tuple[str, dict[str, Any]]:
    token = str(value or "").strip()
    if not token:
        return "", {"fingerprint": "", "masked": ""}
    fingerprint = _runtime_gemini_key_fingerprint(token)
    suffix = re.sub(r"[^a-z0-9]", "", token[-4:].lower())[:8]
    placeholder = f"{RUNTIME_GEMINI_MASKED_KEY_TOKEN_PREFIX}{fingerprint}"
    if suffix:
        placeholder = f"{placeholder}:{suffix}"
    masked = f"{token[:4]}...{token[-4:]}" if len(token) >= 8 else ("*" * len(token))
    return placeholder, {"fingerprint": fingerprint, "masked": masked}


def _runtime_build_gemini_fingerprint_lookup(config: dict[str, Any]) -> dict[str, str]:
    lookup: dict[str, str] = {}
    pools = config.get("pools") if isinstance(config.get("pools"), dict) else {}
    for pool_name in list_runtime_pool_names(config):
        keys = list((pools.get(pool_name) or {}).get("keys") or [])
        for key in keys:
            safe_key = str(key or "").strip()
            if not safe_key:
                continue
            fingerprint = _runtime_gemini_key_fingerprint(safe_key)
            if fingerprint and fingerprint not in lookup:
                lookup[fingerprint] = safe_key
    return lookup


def _restore_masked_runtime_gemini_keys_from_payload(
    raw_payload: dict[str, Any],
    *,
    current_config: dict[str, Any],
) -> dict[str, Any]:
    if not isinstance(raw_payload, dict):
        return {}
    pools = raw_payload.get("pools")
    if not isinstance(pools, dict):
        return dict(raw_payload)

    fingerprint_lookup = _runtime_build_gemini_fingerprint_lookup(current_config)
    restored_payload = dict(raw_payload)
    restored_pools: dict[str, Any] = {}
    for pool_name, pool_value in pools.items():
        row = dict(pool_value) if isinstance(pool_value, dict) else {}
        keys_raw = row.get("keys")
        if isinstance(keys_raw, list):
            restored_keys: list[str] = []
            seen: set[str] = set()
            for item in keys_raw:
                token = str(item or "").strip()
                if not token:
                    continue
                match = RUNTIME_GEMINI_MASKED_KEY_TOKEN_RE.match(token)
                if match:
                    fingerprint = str(match.group("fp") or "").strip().lower()
                    resolved = str(fingerprint_lookup.get(fingerprint) or "").strip()
                    if not resolved:
                        raise ValueError(
                            "Masked Gemini key placeholder could not be resolved. Refresh admin Gemini pools and retry."
                        )
                    token = resolved
                if token in seen:
                    continue
                seen.add(token)
                restored_keys.append(token)
            row["keys"] = restored_keys
        restored_pools[str(pool_name)] = row
    restored_payload["pools"] = restored_pools
    return restored_payload


def _sanitize_runtime_pool_config_for_response(config: dict[str, Any]) -> dict[str, Any]:
    public_config = dict(config or {})
    source_policy = public_config.get("sourcePolicy") if isinstance(public_config.get("sourcePolicy"), dict) else {}
    public_config["sourcePolicy"] = _sanitize_source_policy_for_response(dict(source_policy or {}))

    pools = public_config.get("pools") if isinstance(public_config.get("pools"), dict) else {}
    sanitized_pools: dict[str, Any] = {}
    key_metadata: dict[str, list[dict[str, Any]]] = {}
    for pool_name, pool_value in pools.items():
        pool_row = dict(pool_value) if isinstance(pool_value, dict) else {}
        keys_raw = pool_row.get("keys")
        masked_keys: list[str] = []
        metadata_rows: list[dict[str, Any]] = []
        if isinstance(keys_raw, list):
            for index, key in enumerate(keys_raw):
                placeholder, metadata = _runtime_mask_gemini_key_for_response(str(key or "").strip())
                if not placeholder:
                    continue
                masked_keys.append(placeholder)
                metadata_rows.append(
                    {
                        "index": index,
                        "fingerprint": str(metadata.get("fingerprint") or ""),
                        "masked": str(metadata.get("masked") or ""),
                    }
                )
        pool_row["keys"] = masked_keys
        pool_row["keyMetadata"] = metadata_rows
        sanitized_pools[str(pool_name)] = pool_row
        key_metadata[str(pool_name)] = metadata_rows
    public_config["pools"] = sanitized_pools
    public_config["keyMetadata"] = key_metadata
    return public_config


def _enforce_single_free_runtime_pool(
    config: dict[str, Any],
) -> tuple[dict[str, Any], bool, list[str]]:
    normalized = normalize_pool_config(config)
    return normalized, False, []


def _rewrite_free_plan_pool_for_vertex(config: dict[str, Any]) -> tuple[dict[str, Any], bool, str]:
    normalized = normalize_pool_config(config)
    return normalized, False, ""


def _sync_authoritative_runtime_free_pool(
    config: dict[str, Any],
) -> tuple[dict[str, Any], bool, list[str]]:
    normalized = normalize_pool_config(config)
    return normalized, False, []


def _load_api_pool_config(force: bool = False) -> tuple[dict[str, Any], dict[str, Any]]:
    global _API_POOLS_CACHE, _API_POOLS_META
    with _API_POOLS_LOCK:
        if not force and isinstance(_API_POOLS_CACHE, dict):
            return dict(_API_POOLS_CACHE), dict(_API_POOLS_META)
        file_path = _resolve_api_pools_file_path()
        config, meta = load_pool_config_shared(
            file_path=file_path,
            firestore_db=None,
            prefer_firestore=False,
        )
        config = normalize_pool_config(config)
        sync_warnings: list[str] = []
        config, synced_changed, sync_warnings = _sync_authoritative_runtime_free_pool(config)
        single_pool_warnings: list[str] = []
        config, single_pool_changed, single_pool_warnings = _enforce_single_free_runtime_pool(config)
        meta = dict(meta if isinstance(meta, dict) else {})
        meta["warnings"] = [*list(sync_warnings), *list(single_pool_warnings)]
        meta["sourcePolicy"] = dict(config.get("sourcePolicy") or {})
        _API_POOLS_CACHE = dict(config)
        _API_POOLS_META = dict(meta)
        all_keys = flatten_pool_keys(config)
        if all_keys:
            _RUNTIME_ALLOCATOR.ensure_keys(all_keys)
        return dict(config), dict(meta)


def _runtime_source_policy(force: bool = False) -> dict[str, Any]:
    config, _meta = _load_api_pool_config(force=force)
    policy = config.get("sourcePolicy") if isinstance(config.get("sourcePolicy"), dict) else {}
    return dict(policy)


def _resolve_vertex_credentials_path(source_policy: Optional[dict[str, Any]] = None) -> str:
    policy = dict(source_policy or {})
    raw_path = str(policy.get("vertexServiceAccountRef") or "").strip()
    if not raw_path:
        return ""
    path = Path(raw_path).expanduser()
    if path.is_absolute():
        return str(path.resolve())
    runtime_candidate = (RUNTIME_ROOT / path).resolve()
    if runtime_candidate.exists():
        return str(runtime_candidate)
    return str((WORKSPACE_ROOT / path).resolve())


def _resolve_vertex_access_token_path(source_policy: Optional[dict[str, Any]] = None) -> str:
    policy = dict(source_policy or {})
    raw_path = str(policy.get("vertexAccessTokenRef") or "").strip()
    if not raw_path:
        return ""
    path = Path(raw_path).expanduser()
    if path.is_absolute():
        return str(path.resolve())
    runtime_candidate = (RUNTIME_ROOT / path).resolve()
    if runtime_candidate.exists():
        return str(runtime_candidate)
    return str((WORKSPACE_ROOT / path).resolve())


def _read_vertex_access_token(source_policy: Optional[dict[str, Any]] = None) -> str:
    policy = dict(source_policy or {})
    path = _resolve_vertex_access_token_path(policy)
    if path:
        token_path = Path(path)
        try:
            if token_path.exists() and token_path.is_file():
                token = str(token_path.read_text(encoding="utf-8", errors="ignore")).strip()
                if token:
                    return token
        except Exception:
            pass
    return str(
        os.getenv("VF_GEMINI_VERTEX_ACCESS_TOKEN")
        or os.getenv("GOOGLE_OAUTH_ACCESS_TOKEN")
        or ""
    ).strip()


def _pool_keys_for_hint(pool_hint: Optional[str]) -> list[str]:
    config, _meta = _load_api_pool_config()
    effective_hint = str(pool_hint or "").strip() or resolve_default_runtime_pool_hint(config)
    return resolve_effective_keys_shared(config, effective_hint)


def _resolve_request_key_plan(request_key: str, pool_hint: Optional[str] = None) -> tuple[list[str], Optional[str]]:
    primary_pool = _pool_keys_for_hint(pool_hint)
    if not primary_pool:
        primary_pool = list(_SERVER_API_KEY_POOL)
    return primary_pool, None


def resolve_request_api_key_pool(request_key: str, pool_hint: Optional[str] = None) -> list[str]:
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
    _RUNTIME_ALLOCATOR.reset_rotation(next_index=0)
    if next_pool:
        _RUNTIME_ALLOCATOR.ensure_keys(list(next_pool))
    _load_api_pool_config(force=True)
    return next_pool


def _ensure_runtime_pool_or_raise(
    trace_id: str,
    api_key: Optional[str] = None,
    pool_hint: Optional[str] = None,
) -> tuple[list[str], Optional[str], list[str]]:
    source_policy = _runtime_source_policy()
    auth_mode = _normalize_runtime_auth_mode(None, source_policy=source_policy)
    if auth_mode == SOURCE_POLICY_PROVIDER_VERTEX:
        primary_key_pool = _pool_keys_for_hint(pool_hint)
        fallback_request_key = None
        effective_key_pool = list(primary_key_pool)
        _RUNTIME_ALLOCATOR.ensure_keys(effective_key_pool)
    else:
        primary_key_pool, fallback_request_key = _resolve_request_key_plan(
            str(api_key or "").strip(),
            pool_hint=pool_hint,
        )
        effective_key_pool = list(primary_key_pool)
        if fallback_request_key:
            effective_key_pool.append(fallback_request_key)
        if not effective_key_pool:
            refreshed_pool = list(_refresh_server_api_key_pool())
            if refreshed_pool:
                primary_key_pool = list(refreshed_pool)
                effective_key_pool = list(refreshed_pool)

    if not effective_key_pool:
        raise HTTPException(
            status_code=400,
            detail={
                "errorCode": ERROR_CODE_SLOT_SET_MISSING,
                "error": "Gemini slot pool is missing.",
                "summary": SLOT_SET_MISSING_SUMMARY,
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
    fallback_chains = config.get("fallbackChains") if isinstance(config.get("fallbackChains"), dict) else {}
    global_fallback = list(config.get("defaultFallbackChain") or [])
    direct_keys = list((pools.get(pool_name) or {}).get("keys") or [])
    effective_keys = resolve_effective_keys_shared(config, pool_name)
    snapshot = _RUNTIME_ALLOCATOR.snapshot(effective_keys)
    pool_meta = snapshot.get("pool") if isinstance(snapshot.get("pool"), dict) else {}
    return {
        "pool": pool_name,
        "directKeyCount": len(direct_keys),
        "effectiveKeyCount": len(effective_keys),
        "effectiveChain": list(fallback_chains.get(pool_name) or [pool_name, *[item for item in global_fallback if item != pool_name]]),
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
    config_public = _sanitize_runtime_pool_config_for_response(config)
    single_pool_marker = dict(config_public.get("singlePool") or {})
    if not single_pool_marker:
        single_pool_marker = {
            "enabled": bool(VF_GEMINI_SINGLE_POOL_ENFORCE),
            "canonicalPoolId": "free",
            "effectivePlanPools": {"free": "free", "pro": "free", "plus": "free"},
        }
    duplicates = duplicate_key_memberships(config)
    all_keys = flatten_pool_keys(config)
    summaries = {
        pool_name: _build_pool_summary(pool_name, config)
        for pool_name in list_runtime_pool_names(config)
    }
    pool_names = set(list_runtime_pool_names(config))
    plan_pools = config.get("planPools") if isinstance(config.get("planPools"), dict) else {}
    missing_plan_pools = {
        plan_key: str(plan_pools.get(plan_key) or "")
        for plan_key in ("free", "pro", "plus")
        if str(plan_pools.get(plan_key) or "").strip() and str(plan_pools.get(plan_key) or "").strip() not in pool_names
    }
    return {
        "ok": len(duplicates) == 0,
        "engine": APP_NAME,
        "timestampMs": int(time.time() * 1000),
        "config": config_public,
        "meta": meta,
        "validation": {
            "uniqueKeyMembership": bool(
                (config.get("constraints") or {}).get("uniqueKeyMembership", True)
            ),
            "duplicateKeys": duplicates,
            "missingPlanPools": missing_plan_pools,
        },
        "warnings": list((meta or {}).get("warnings") or []),
        "sourcePolicy": _sanitize_source_policy_for_response(dict(config.get("sourcePolicy") or {})),
        "singlePool": single_pool_marker,
        "poolSummaries": summaries,
        "allKeyCount": len(all_keys),
    }


def _admin_api_pools_usage_payload() -> dict[str, Any]:
    config, meta = _load_api_pool_config()
    pools = config.get("pools") if isinstance(config.get("pools"), dict) else {}
    fallback_chains = config.get("fallbackChains") if isinstance(config.get("fallbackChains"), dict) else {}
    global_fallback = list(config.get("defaultFallbackChain") or [])
    payload: dict[str, Any] = {}
    for pool_name in list_runtime_pool_names(config):
        direct_keys = list((pools.get(pool_name) or {}).get("keys") or [])
        effective_keys = resolve_effective_keys_shared(config, pool_name)
        direct_snapshot = _RUNTIME_ALLOCATOR.snapshot(direct_keys)
        effective_snapshot = _RUNTIME_ALLOCATOR.snapshot(effective_keys)
        payload[pool_name] = {
            "pool": pool_name,
            "directKeyCount": len(direct_keys),
            "effectiveKeyCount": len(effective_keys),
            "effectiveChain": list(fallback_chains.get(pool_name) or [pool_name, *[item for item in global_fallback if item != pool_name]]),
            "direct": direct_snapshot,
            "effective": effective_snapshot,
        }
    return {
        "ok": True,
        "engine": APP_NAME,
        "timestampMs": int(time.time() * 1000),
        "meta": meta,
        "warnings": list((meta or {}).get("warnings") or []),
        "sourcePolicy": _sanitize_source_policy_for_response(dict(config.get("sourcePolicy") or {})),
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


def _tts_model_fallback_enabled(source_policy: Optional[dict[str, Any]] = None) -> bool:
    policy = dict(source_policy or _runtime_source_policy())
    return bool(policy.get("ttsModelFallbackEnabled"))


def resolve_tts_model_candidates(
    engine: Optional[object] = None,
    auth_mode: Optional[str] = None,
    *,
    source_policy: Optional[dict[str, Any]] = None,
    client: Optional[object] = None,
    api_key: Optional[str] = None,
) -> list[str]:
    _ = client
    _ = api_key
    safe_engine = _normalize_runtime_engine(engine, default=TTS_ENGINE_DEFAULT)
    if safe_engine == "DUNO":
        return []

    policy = dict(source_policy or _runtime_source_policy())
    mode = _normalize_runtime_auth_mode(auth_mode, source_policy=policy)
    preferred = list((TTS_MODEL_CANDIDATES_BY_AUTH_MODE.get(mode) or {}).get(safe_engine) or [])
    configured = _normalize_model_name(str(TTS_MODEL or ""))
    route = list(TTS_MODEL_FALLBACKS)
    allocator_route = list(ALLOCATOR_CONFIG.routes.get("tts") or [])
    strict_tts_route = {
        _normalize_model_name(item)
        for item in list(ALLOCATOR_CONFIG.routes.get("tts") or [])
        if _normalize_model_name(item)
    }
    allow_fallback = _tts_model_fallback_enabled(policy)
    primary_candidates = [*preferred, configured, *route, *allocator_route]

    candidates: list[str] = []
    seen: set[str] = set()
    for raw in primary_candidates:
        token = _normalize_model_name(str(raw or ""))
        if not token:
            continue
        if strict_tts_route and token not in strict_tts_route:
            continue
        if token in seen:
            continue
        model_limit = ALLOCATOR_CONFIG.models.get(token)
        if model_limit is not None and "tts" not in model_limit.enabled_for:
            continue
        seen.add(token)
        candidates.append(token)
        if not allow_fallback:
            break
    return candidates


def _resolve_explicit_model_candidates(
    *,
    raw_candidates: Optional[list[str]],
    raw_model: Optional[str],
    task: str,
) -> tuple[list[str], list[str]]:
    normalized: list[str] = []
    invalid: list[str] = []
    seen: set[str] = set()

    requested = [str(item or "").strip() for item in list(raw_candidates or []) if str(item or "").strip()]
    single = str(raw_model or "").strip()
    if single:
        requested = [single, *requested]
    strict_task_route = {
        _normalize_model_name(item)
        for item in list(ALLOCATOR_CONFIG.routes.get(task) or [])
        if _normalize_model_name(item)
    }

    for candidate in requested:
        token = _normalize_model_name(candidate)
        if not token:
            continue
        if token in seen:
            continue
        seen.add(token)
        if strict_task_route and token not in strict_task_route:
            invalid.append(token)
            continue
        model_limit = ALLOCATOR_CONFIG.models.get(token)
        if model_limit is None or task not in model_limit.enabled_for:
            invalid.append(token)
            continue
        normalized.append(token)
    return normalized, invalid


def resolve_text_model_candidates() -> list[str]:
    # Strict allocator-driven route for non-TTS generation.
    return list(TEXT_MODEL_FALLBACKS)


def extract_text_content(response: object) -> str:
    # Avoid SDK `.text` accessor because it can warn when non-text parts
    # (for example `thought_signature`) are present in the response payload.
    candidates = getattr(response, "candidates", None) or []
    text_fragments: list[str] = []
    for cand in candidates:
        content = getattr(cand, "content", None)
        parts = getattr(content, "parts", None) or []
        for part in parts:
            text_value = str(getattr(part, "text", "") or "").strip()
            if text_value:
                text_fragments.append(text_value)
    if text_fragments:
        return "\n".join(text_fragments).strip()

    # Safe fallback for unexpected response shapes.
    primary = str(getattr(response, "text", "") or "").strip()
    if primary:
        return primary
    return ""


def _usage_int_value(source: object, *names: str) -> int:
    for name in names:
        try:
            value = getattr(source, name)
        except Exception:
            value = None
        if value is None and isinstance(source, dict):
            value = source.get(name)
        try:
            parsed = int(value or 0)
        except Exception:
            parsed = 0
        if parsed > 0:
            return parsed
    return 0


def extract_usage_metadata(response: object) -> Optional[Dict[str, int]]:
    raw = None
    for attr in ("usage_metadata", "usageMetadata"):
        try:
            raw = getattr(response, attr)
        except Exception:
            raw = None
        if raw is not None:
            break
    if raw is None:
        return None
    prompt_tokens = _usage_int_value(raw, "prompt_token_count", "promptTokenCount")
    output_tokens = _usage_int_value(
        raw,
        "candidates_token_count",
        "candidatesTokenCount",
        "output_token_count",
        "outputTokenCount",
    )
    total_tokens = _usage_int_value(raw, "total_token_count", "totalTokens", "totalTokenCount")
    if total_tokens <= 0:
        total_tokens = max(0, prompt_tokens + output_tokens)
    if total_tokens <= 0 and prompt_tokens <= 0 and output_tokens <= 0:
        return None
    return {
        "promptTokens": max(0, prompt_tokens),
        "outputTokens": max(0, output_tokens),
        "totalTokens": max(0, total_tokens),
    }


def _usage_metadata_totals(usage_metadata: Optional[Dict[str, int]]) -> Dict[str, int]:
    if not isinstance(usage_metadata, dict):
        return {"promptTokens": 0, "outputTokens": 0, "totalTokens": 0}
    prompt_tokens = max(0, int(usage_metadata.get("promptTokens") or 0))
    output_tokens = max(0, int(usage_metadata.get("outputTokens") or 0))
    total_tokens = max(0, int(usage_metadata.get("totalTokens") or 0))
    if total_tokens <= 0:
        total_tokens = max(0, prompt_tokens + output_tokens)
    return {
        "promptTokens": prompt_tokens,
        "outputTokens": output_tokens,
        "totalTokens": total_tokens,
    }


def _provider_usage_reported(usage_metadata: Optional[Dict[str, int]]) -> bool:
    totals = _usage_metadata_totals(usage_metadata)
    return any(int(totals.get(key) or 0) > 0 for key in ("promptTokens", "outputTokens", "totalTokens"))


def _merge_usage_metadata(items: list[Dict[str, int]]) -> Optional[Dict[str, int]]:
    if not items:
        return None
    prompt_tokens = sum(max(0, int(item.get("promptTokens") or 0)) for item in items)
    output_tokens = sum(max(0, int(item.get("outputTokens") or 0)) for item in items)
    total_tokens = sum(max(0, int(item.get("totalTokens") or 0)) for item in items)
    if total_tokens <= 0 and prompt_tokens <= 0 and output_tokens <= 0:
        return None
    if total_tokens <= 0:
        total_tokens = prompt_tokens + output_tokens
    return {
        "promptTokens": prompt_tokens,
        "outputTokens": output_tokens,
        "totalTokens": total_tokens,
    }


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


def _is_model_access_error(message: str) -> bool:
    lower = str(message or "").lower()
    if not lower:
        return False
    has_model_signal = (
        "model" in lower
        or "models/" in lower
        or "generatecontent" in lower
        or "speech" in lower and "tts" in lower
    )
    if not has_model_signal:
        return False
    return (
        "not found" in lower
        or "unsupported" in lower
        or "not supported" in lower
        or "not enabled" in lower
        or "is not available" in lower
        or "not available in this api version" in lower
        or "permission denied" in lower
        or "permission_denied" in lower
        or "for this endpoint" in lower
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


def _resolve_tts_route_model(model_candidates: Optional[list[str]] = None) -> str:
    candidates = [str(item or "").strip() for item in list(model_candidates or []) if str(item or "").strip()]
    if candidates:
        return str(candidates[0])
    route = list(ALLOCATOR_CONFIG.routes.get("tts") or [])
    if route:
        return str(route[0] or "").strip()
    return str(TTS_MODEL or "").strip()


def _effective_tts_route_limits(model_candidates: Optional[list[str]] = None) -> Dict[str, Any]:
    effective_candidates = model_candidates
    if effective_candidates is None:
        effective_candidates = resolve_tts_model_candidates(
            source_policy=_runtime_source_policy(),
        )
    tts_model = _resolve_tts_route_model(effective_candidates)
    model_limit = ALLOCATOR_CONFIG.models.get(tts_model)
    rpm_limit = (
        -1
        if GEMINI_ALLOCATOR_DISABLE_RATE_LIMITS
        else (max(0, int(model_limit.rpm)) if model_limit is not None else 0)
    )
    tpm_limit = (
        -1
        if GEMINI_ALLOCATOR_DISABLE_RATE_LIMITS
        else (max(0, int(model_limit.tpm)) if model_limit is not None else 0)
    )
    return {
        "model": tts_model,
        "rpm": rpm_limit,
        "tpm": tpm_limit,
        "windowSeconds": max(1, int(ALLOCATOR_CONFIG.window_seconds)),
        "defaultWaitTimeoutMs": max(1, int(ALLOCATOR_CONFIG.default_wait_timeout_ms)),
        "rateLimitsDisabled": GEMINI_ALLOCATOR_DISABLE_RATE_LIMITS,
    }


def _classification_for_error_code(error_code: str) -> str:
    code = str(error_code or "").strip().upper()
    if code == ERROR_CODE_UPSTREAM_REQUEST_TIMEOUT:
        return "upstream_timeout"
    if code in {ERROR_CODE_ALLOCATOR_ACQUIRE_TIMEOUT, ERROR_CODE_SLOT_SET_TIMEOUT}:
        return "acquire_timeout"
    if code == ERROR_CODE_SLOT_SET_OVERLOADED:
        return "capacity_overload"
    if code == ERROR_CODE_ALL_SLOTS_RATE_LIMITED:
        return "rate_limited"
    if code in {ERROR_CODE_ALL_SLOTS_AUTH_FAILED, ERROR_CODE_SLOT_SET_MISSING}:
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


def _estimate_tts_pool_pressure(
    key_pool: list[str],
    requested_tokens: int,
    *,
    model_candidates: Optional[list[str]] = None,
) -> Dict[str, Any]:
    snapshot = _RUNTIME_ALLOCATOR.snapshot(key_pool)
    key_states = list(snapshot.get("keys") or [])
    model_entries = list(snapshot.get("models") or [])
    model_entries_by_id: Dict[str, Dict[str, Any]] = {}
    for model_entry in model_entries:
        row = model_entry if isinstance(model_entry, dict) else {}
        model_id = str(row.get("model") or "").strip()
        if model_id and model_id not in model_entries_by_id:
            model_entries_by_id[model_id] = row
    candidate_models = [
        _normalize_model_name(str(item or ""))
        for item in list(model_candidates or [])
        if str(item or "").strip()
    ]
    if not candidate_models:
        candidate_models = [_resolve_tts_route_model()]
    tts_model = _resolve_tts_route_model(candidate_models)
    safe_requested_tokens = max(1, int(requested_tokens or 1))

    in_flight_total = 0
    available_lanes = 0
    candidate_models_with_lane_entries: set[str] = set()
    nearest_ready_ms: Optional[int] = None
    nearest_reset_ms: Optional[int] = None

    for key_entry in key_states:
        models = list((key_entry or {}).get("models") or [])
        for model_id in candidate_models:
            lane_entry = None
            for model in models:
                if str((model or {}).get("model") or "").strip() == model_id:
                    lane_entry = model or {}
                    break
            if lane_entry is None:
                continue
            candidate_models_with_lane_entries.add(model_id)

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

    # Snapshot key lanes only cover allocator-routed models. When strict engine
    # candidates point at non-routed models, fall back to per-model pool metadata
    # so grouped concurrency still reflects real allocator capacity.
    if available_lanes <= 0:
        for model_id in candidate_models:
            if model_id in candidate_models_with_lane_entries:
                continue
            model_entry = model_entries_by_id.get(model_id) or {}
            pool_meta = model_entry.get("pool") or {}
            available_keys = max(0, _safe_int(pool_meta.get("availableKeys"), 0))
            if available_keys > 0:
                available_lanes = max(available_lanes, available_keys)
            pool_reset = max(0, _safe_int(pool_meta.get("nextResetInMs"), 0))
            if pool_reset > 0:
                nearest_reset_ms = pool_reset if nearest_reset_ms is None else min(nearest_reset_ms, pool_reset)

    for model_id in candidate_models:
        tts_model_entry = model_entries_by_id.get(model_id)
        if not tts_model_entry:
            continue
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
        "ttsModelCandidates": candidate_models,
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
        "error": "Gemini slot set is temporarily overloaded.",
        "errorCode": ERROR_CODE_SLOT_SET_OVERLOADED,
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
        if _is_model_access_error(detail):
            if "no audio payload returned by gemini" not in lowered:
                saw_non_rate_non_noise = True
            continue
        if _is_auth_error(detail):
            saw_auth = True
        elif _is_rate_limit_error(detail):
            saw_rate = True
        else:
            if "no audio payload returned by gemini" not in lowered:
                saw_non_rate_non_noise = True
    if saw_auth and not saw_rate and not saw_non_rate_non_noise:
        return ERROR_CODE_ALL_SLOTS_AUTH_FAILED
    if saw_rate and not saw_auth and not saw_non_rate_non_noise:
        return ERROR_CODE_ALL_SLOTS_RATE_LIMITED
    return ERROR_CODE_UPSTREAM_MODEL_FAILED


def _build_genai_client(
    api_key: str,
    timeout_ms: int,
    *,
    auth_mode: str = SOURCE_POLICY_PROVIDER_GEMINI_API,
    source_policy: Optional[dict[str, Any]] = None,
) -> object:
    if genai is None:
        raise RuntimeError("google-genai SDK is unavailable in runtime.")
    bounded_timeout = max(1000, int(timeout_ms))
    safe_mode = _normalize_runtime_auth_mode(auth_mode, source_policy=source_policy)
    if safe_mode == SOURCE_POLICY_PROVIDER_VERTEX:
        policy = dict(source_policy or _runtime_source_policy())
        selected_slot_id = str(policy.get("selectedVertexSlotId") or policy.get("vertexSlotId") or "").strip()
        accounts = list(policy.get("vertexAccounts") or [])
        selected_account = None
        if selected_slot_id:
            for account in accounts:
                if not isinstance(account, dict):
                    continue
                slot_id = str(account.get("memberId") or account.get("slotId") or account.get("id") or "").strip()
                if slot_id and slot_id == selected_slot_id:
                    selected_account = dict(account)
                    break
        if selected_account is None and accounts:
            selected_account = dict(accounts[0]) if isinstance(accounts[0], dict) else None
        if selected_account is not None:
            policy = {**policy, **selected_account}
        project = str(policy.get("vertexProject") or _default_vertex_project() or "").strip()
        location = str(policy.get("vertexLocation") or _default_vertex_location()).strip()
        if not project:
            raise RuntimeError("Vertex mode is enabled but sourcePolicy.vertexProject is missing.")
        credentials_path = _resolve_vertex_credentials_path(policy)
        if not credentials_path:
            raise RuntimeError("Vertex mode is enabled but a service-account ref is missing.")
        if not Path(credentials_path).exists():
            raise RuntimeError(f"Vertex service-account file does not exist: {credentials_path}")
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = credentials_path
        client_kwargs: Dict[str, Any] = {
            "vertexai": True,
            "project": project,
            "location": location,
        }
        if google_oauth2_credentials is not None:
            try:
                from google.oauth2 import service_account as google_service_account  # type: ignore

                client_kwargs["credentials"] = google_service_account.Credentials.from_service_account_file(
                    credentials_path,
                    scopes=["https://www.googleapis.com/auth/cloud-platform"],
                )
            except Exception:
                pass
        if types is not None and hasattr(types, "HttpOptions"):
            try:
                http_options = types.HttpOptions(timeout=bounded_timeout)
                try:
                    return genai.Client(http_options=http_options, **client_kwargs)
                except TypeError:
                    return genai.Client(**client_kwargs)
            except Exception:
                return genai.Client(**client_kwargs)
        return genai.Client(**client_kwargs)
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


def _canonicalize_multi_speaker_identities(
    speaker_voices: list[Dict[str, str]],
    line_map: list[Dict[str, Any]],
) -> tuple[list[Dict[str, str]], list[Dict[str, Any]]]:
    canonical_by_key: Dict[str, str] = {}
    for entry in list(speaker_voices or []):
        speaker = re.sub(r"\s+", " ", str(entry.get("speaker") or "")).strip()
        if not speaker:
            continue
        speaker_key = speaker.lower()
        canonical_by_key.setdefault(speaker_key, speaker)
    for line in list(line_map or []):
        speaker = re.sub(r"\s+", " ", str(line.get("speaker") or "")).strip()
        if not speaker:
            continue
        speaker_key = speaker.lower()
        canonical_by_key.setdefault(speaker_key, speaker)

    normalized_speaker_voices: list[Dict[str, str]] = []
    seen_speakers: set[str] = set()
    for entry in list(speaker_voices or []):
        speaker = re.sub(r"\s+", " ", str(entry.get("speaker") or "")).strip()
        if not speaker:
            continue
        speaker_key = speaker.lower()
        if speaker_key in seen_speakers:
            continue
        seen_speakers.add(speaker_key)
        canonical_name = str(canonical_by_key.get(speaker_key) or speaker).strip() or speaker
        normalized_speaker_voices.append(
            {
                "speaker": canonical_name,
                "voiceName": str(entry.get("voiceName") or "").strip(),
            }
        )

    normalized_line_map: list[Dict[str, Any]] = []
    for line in list(line_map or []):
        safe_line = dict(line or {}) if isinstance(line, dict) else {}
        speaker = re.sub(r"\s+", " ", str(safe_line.get("speaker") or "")).strip()
        if speaker:
            speaker_key = speaker.lower()
            safe_line["speaker"] = str(canonical_by_key.get(speaker_key) or speaker).strip() or speaker
        normalized_line_map.append(safe_line)
    return normalized_speaker_voices, normalized_line_map


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
    model_candidates: Optional[list[str]] = None,
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
        model_candidates=model_candidates,
    )
    available_lanes = max(0, int(pressure.get("availableLanes") or 0))
    estimated_wait_ms = max(0, int(pressure.get("estimatedWaitMs") or 0))
    if available_lanes <= 0 and estimated_wait_ms <= 0:
        # When the allocator snapshot cannot see live lanes but there is no
        # wait pressure, fall back to the key pool size so we do not cap
        # grouped synthesis to a single worker.
        available_lanes = max(1, len(effective_key_pool))
    effective_concurrency = min(
        concurrency_cap,
        GEMINI_STUDIO_PAIR_GROUP_MAX_CONCURRENCY,
        len(groups),
        max(1, len(effective_key_pool)),
        available_lanes,
    )
    return max(1, int(effective_concurrency)), pressure


def _build_key_selection_metadata(key_indexes: list[int]) -> Dict[str, Any]:
    normalized_indexes: list[int] = []
    for raw_index in list(key_indexes or []):
        try:
            safe_index = int(raw_index)
        except Exception:
            continue
        if safe_index >= 0:
            normalized_indexes.append(safe_index)
    if not normalized_indexes:
        return {
            "firstKeySelectionIndex": -1,
            "finalKeySelectionIndex": -1,
            "keySelectionIndexes": [],
        }
    return {
        "firstKeySelectionIndex": int(normalized_indexes[0]),
        "finalKeySelectionIndex": int(normalized_indexes[-1]),
        "keySelectionIndexes": normalized_indexes,
    }


def _build_request_attempt_metadata(key_attempts: list[Dict[str, Any]]) -> Dict[str, Any]:
    normalized_attempts: list[Dict[str, Any]] = []
    key_indexes: list[int] = []
    error_kinds: list[str] = []
    statuses: list[str] = []
    speech_modes: list[str] = []
    for raw_attempt in list(key_attempts or []):
        attempt_row = dict(raw_attempt or {}) if isinstance(raw_attempt, dict) else {}
        try:
            key_index = int(attempt_row.get("keySelectionIndex"))
        except Exception:
            continue
        if key_index < 0:
            continue
        attempt_number = max(1, _safe_int(attempt_row.get("attempt"), len(normalized_attempts) + 1))
        status = str(attempt_row.get("status") or "").strip().lower()
        if status not in {"failed", "success"}:
            status = "success"
        error_kind = str(attempt_row.get("errorKind") or "").strip().lower()
        speech_mode = str(attempt_row.get("speechMode") or "").strip()
        normalized_attempts.append(
            {
                "attempt": attempt_number,
                "keySelectionIndex": key_index,
                "model": str(attempt_row.get("model") or "").strip(),
                "speechMode": speech_mode,
                "status": status,
                "errorKind": error_kind,
                "sameKeyRetry": bool(attempt_row.get("sameKeyRetry")),
            }
        )
        key_indexes.append(key_index)
        error_kinds.append(error_kind)
        statuses.append(status)
        speech_modes.append(speech_mode)
    if not normalized_attempts:
        return {
            "initialKeySelectionIndex": -1,
            "attemptCount": 0,
            "attemptKeySelectionIndexes": [],
            "attemptErrorKinds": [],
            "attemptStatuses": [],
            "attemptSpeechModes": [],
            "requestAttempts": [],
        }
    return {
        "initialKeySelectionIndex": int(key_indexes[0]),
        "attemptCount": len(normalized_attempts),
        "attemptKeySelectionIndexes": key_indexes,
        "attemptErrorKinds": error_kinds,
        "attemptStatuses": statuses,
        "attemptSpeechModes": speech_modes,
        "requestAttempts": normalized_attempts,
    }


def _synthesize_studio_pair_groups(
    *,
    engine: str,
    auth_mode: str,
    source_policy: Optional[dict[str, Any]],
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
    model_candidates_override: Optional[list[str]] = None,
) -> Dict[str, Any]:
    safe_engine = _normalize_runtime_engine(engine)
    explicit_candidates = [str(item or "").strip() for item in list(model_candidates_override or []) if str(item or "").strip()]
    model_candidates = explicit_candidates if explicit_candidates else resolve_tts_model_candidates(
        engine=safe_engine,
        auth_mode=auth_mode,
        source_policy=source_policy,
    )
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
        model_candidates=model_candidates,
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
                (
                    pcm_bytes,
                    model_used,
                    speech_mode_used,
                    key_index_used,
                    usage_metadata,
                    attempt_metadata,
                ) = _synthesize_pcm_result_with_attempts(
                    _synthesize_pcm_with_key_pool(
                        engine=safe_engine,
                        auth_mode=auth_mode,
                        source_policy=source_policy,
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
                        model_candidates_override=model_candidates,
                        include_usage_metadata=True,
                        include_attempt_metadata=True,
                    )
                )
                line_chunks, used_pause_boundaries = _split_int16_pcm_for_lines(pcm_bytes, group_weights)
                return {
                    "groupIndex": int(group.get("groupIndex", 0)),
                    "lines": group_lines,
                    "lineChunks": line_chunks,
                    "model": model_used,
                    "speechMode": speech_mode_used,
                    "keyIndex": int(key_index_used),
                    "attemptMetadata": attempt_metadata,
                    "splitMode": "pause" if used_pause_boundaries else "duration",
                    "attempts": attempt,
                    "usageMetadata": usage_metadata,
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
    attempt_key_indexes_used: list[int] = []
    attempt_error_kinds: list[str] = []
    attempt_statuses: list[str] = []
    usage_items: list[Dict[str, int]] = []
    pause_split_groups = 0
    duration_split_groups = 0

    for result in sorted(group_results, key=lambda item: int(item.get("groupIndex", 0))):
        models_used.append(str(result.get("model") or ""))
        speech_modes_used.append(str(result.get("speechMode") or ""))
        key_indexes_used.append(int(result.get("keyIndex", -1)))
        attempt_metadata = result.get("attemptMetadata") if isinstance(result.get("attemptMetadata"), dict) else {}
        for raw_index in list(attempt_metadata.get("attemptKeySelectionIndexes") or []):
            try:
                safe_index = int(raw_index)
            except Exception:
                continue
            if safe_index >= 0:
                attempt_key_indexes_used.append(safe_index)
        for raw_error_kind in list(attempt_metadata.get("attemptErrorKinds") or []):
            attempt_error_kinds.append(str(raw_error_kind or "").strip().lower())
        for raw_status in list(attempt_metadata.get("attemptStatuses") or []):
            attempt_statuses.append(str(raw_status or "").strip().lower())
        usage_metadata = result.get("usageMetadata")
        if isinstance(usage_metadata, dict):
            usage_items.append(dict(usage_metadata))
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
    key_selection_meta = _build_key_selection_metadata(key_indexes_used)
    key_selection_index = int(key_selection_meta["finalKeySelectionIndex"])
    initial_key_selection_index = (
        int(attempt_key_indexes_used[0])
        if attempt_key_indexes_used
        else int(key_selection_meta["firstKeySelectionIndex"])
    )
    diagnostics_payload: Dict[str, Any] = {
        "engine": safe_engine,
        "traceId": trace_id,
        "strategies": ["studio_pair_groups"],
        "recoveryUsed": bool(retry_once),
        "groupCount": len(groups),
        "lineCount": len(normalized_line_map),
        "concurrencyUsed": effective_concurrency,
        "keyPoolSize": len(effective_key_pool),
        "keySelectionIndex": key_selection_index,
        "initialKeySelectionIndex": initial_key_selection_index,
        "attemptCount": len(attempt_key_indexes_used),
        "attemptKeySelectionIndexes": attempt_key_indexes_used,
        "attemptErrorKinds": attempt_error_kinds,
        "attemptStatuses": attempt_statuses,
        "availableLanes": int(pool_pressure.get("availableLanes") or 0),
        "estimatedWaitMs": int(pool_pressure.get("estimatedWaitMs") or 0),
        "pauseSplitGroups": pause_split_groups,
        "durationSplitGroups": duration_split_groups,
        "lineChunkCount": len(ordered_line_chunks),
        "model": model_header,
        "speechModeUsed": "studio_pair_groups",
    }
    diagnostics_payload.update(key_selection_meta)
    merged_usage_metadata = _merge_usage_metadata(usage_items)
    if isinstance(merged_usage_metadata, dict):
        diagnostics_payload["usageMetadata"] = merged_usage_metadata
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
            "initialKeySelectionIndex": initial_key_selection_index,
            "attemptCount": len(attempt_key_indexes_used),
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
        "initialKeySelectionIndex": initial_key_selection_index,
        "attemptCount": len(attempt_key_indexes_used),
        "attemptKeySelectionIndexes": attempt_key_indexes_used,
        "attemptErrorKinds": attempt_error_kinds,
        "attemptStatuses": attempt_statuses,
        "firstKeySelectionIndex": int(key_selection_meta["firstKeySelectionIndex"]),
        "finalKeySelectionIndex": int(key_selection_meta["finalKeySelectionIndex"]),
        "keySelectionIndexes": list(key_selection_meta.get("keySelectionIndexes") or []),
        "keyPoolSize": len(effective_key_pool),
        "speakerHint": speaker_hint or None,
        "windowCount": len(groups),
        "diagnostics": diagnostics_payload,
        "usageMetadata": merged_usage_metadata,
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


def _build_line_map_single_speaker_windows(
    normalized_line_map: list[Dict[str, Any]],
    speaker_voices: list[Dict[str, str]],
    target_voice: str,
    language_code: str,
) -> list[Dict[str, Any]]:
    windows, _ = _build_multi_speaker_dialogue_lane_windows(
        normalized_line_map=normalized_line_map,
        speaker_voices=speaker_voices,
        target_voice=target_voice,
        language_code=language_code,
    )
    return windows


def _lane_affinity_speakers(lane_id: object) -> list[str]:
    safe_lane_id = re.sub(r"[^a-z0-9]+", "", str(lane_id or "").strip().lower()) or "l1"
    return [f"lane:{safe_lane_id}"]


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


def _build_single_speaker_segment_windows(
    *,
    text: str,
    language_code: str,
    speaker_voices: list[Dict[str, str]],
) -> tuple[list[Dict[str, Any]], Dict[str, Any]]:
    normalized_text = _normalize_synthesis_text(text)
    if not normalized_text:
        return [], {
            "enabled": False,
            "profile": None,
            "chunkCount": 0,
            "maxWordsPerChunk": MAX_WORDS_PER_REQUEST,
            "joinCrossfadeMs": 0,
            "laneCount": 0,
            "laneAssignments": [],
            "strategies": ["single_speaker_three_lane_scheduler"],
        }

    chunk_profile = resolve_chunk_profile(language_code, normalized_text)
    stage_plan = [dict(item) for item in list(chunk_profile.get("single_lane_plan") or list(SINGLE_SPEAKER_STAGE_PLAN))]
    stage_specs = [
        (
            max(1, int(stage.get("targetChars") or 4000)),
            max(1, int(stage.get("hardCharCap") or stage.get("targetChars") or 4000)),
        )
        for stage in stage_plan
    ]
    continuation_spec = stage_specs[-1] if stage_specs else (4000, 4000)
    chunks = [
        _normalize_synthesis_text(chunk)
        for chunk in build_progressive_sentence_aware_chunks(
            normalized_text,
            stages=stage_specs,
            continuation=continuation_spec,
            max_words_per_chunk=int(chunk_profile.get("max_words_per_chunk") or MAX_WORDS_PER_REQUEST),
        )
    ]
    chunks = [chunk for chunk in chunks if chunk]
    if not chunks:
        chunks = [normalized_text]

    lane_loads: Dict[str, int] = {lane_id: 0 for lane_id in THREE_LANE_IDS}
    windows: list[Dict[str, Any]] = []
    for chunk_index, chunk in enumerate(chunks):
        if chunk_index < len(stage_plan):
            lane_id = str(stage_plan[chunk_index].get("laneId") or THREE_LANE_IDS[min(chunk_index, len(THREE_LANE_IDS) - 1)]).upper()
        else:
            lane_id = min(
                THREE_LANE_IDS,
                key=lambda candidate: (int(lane_loads.get(candidate, 0)), THREE_LANE_IDS.index(candidate)),
            )
        lane_loads[lane_id] = int(lane_loads.get(lane_id, 0)) + len(chunk)
        windows.append(
            {
                "windowIndex": len(windows) + 1,
                "laneId": lane_id,
                "text": chunk,
                "speakerVoices": list(speaker_voices),
                "affinitySpeakers": _lane_affinity_speakers(lane_id),
                "pauseAfterMs": 0,
                "chunkIndex": chunk_index,
                "dialogueIndex": 0,
            }
        )

    lane_assignments = [str(window.get("laneId") or "") for window in windows]
    lane_count = len({lane for lane in lane_assignments if lane})
    return (
        windows,
        {
            "enabled": len(chunks) > 1,
            "profile": SEGMENTATION_PROFILE if len(chunks) > 1 else None,
            "chunkCount": len(chunks),
            "maxWordsPerChunk": int(chunk_profile.get("max_words_per_chunk") or MAX_WORDS_PER_REQUEST),
            "joinCrossfadeMs": int(chunk_profile.get("join_crossfade_ms") or 0),
            "laneCount": lane_count,
            "laneAssignments": lane_assignments,
            "strategies": ["single_speaker_three_lane_scheduler", "sentence_aware_chunking"],
        },
    )


def _build_multi_speaker_dialogue_lane_windows(
    *,
    normalized_line_map: list[Dict[str, Any]],
    speaker_voices: list[Dict[str, str]],
    target_voice: str,
    language_code: str,
) -> tuple[list[Dict[str, Any]], Dict[str, Any]]:
    voice_map: Dict[str, str] = {}
    for entry in speaker_voices:
        speaker = str(entry.get("speaker") or "").strip().lower()
        if not speaker:
            continue
        voice_map[speaker] = str(entry.get("voiceName") or target_voice).strip() or target_voice

    chunk_profile = resolve_chunk_profile(language_code, "\n".join(str(line.get("text") or "") for line in normalized_line_map))
    max_words_per_chunk = int(chunk_profile.get("max_words_per_chunk") or MAX_WORDS_PER_REQUEST)
    windows: list[Dict[str, Any]] = []
    dialogue_lanes: Dict[int, str] = {}

    for dialogue_index, line in enumerate(normalized_line_map):
        speaker = str(line.get("speaker") or "").strip()
        text = _normalize_synthesis_text(str(line.get("text") or ""))
        if not speaker or not text:
            continue
        line_index = int(line.get("lineIndex", dialogue_index))
        lane_id = THREE_LANE_IDS[dialogue_index % len(THREE_LANE_IDS)]
        dialogue_lanes[line_index] = lane_id
        voice_name = voice_map.get(speaker.lower(), target_voice)
        if dialogue_index == 0 and len(text) > MULTI_SPEAKER_FIRST_DIALOG_TRIGGER_CHARS:
            stages = list(zip(MULTI_SPEAKER_FIRST_DIALOG_STAGE_TARGETS, MULTI_SPEAKER_FIRST_DIALOG_STAGE_HARD_CAPS))
        else:
            stages = [(MULTI_SPEAKER_CONTINUATION_TARGET_CHARS, MULTI_SPEAKER_CONTINUATION_HARD_CAP)]
        chunks = [
            _normalize_synthesis_text(chunk)
            for chunk in build_progressive_sentence_aware_chunks(
                text,
                stages=stages,
                continuation=(MULTI_SPEAKER_CONTINUATION_TARGET_CHARS, MULTI_SPEAKER_CONTINUATION_HARD_CAP),
                max_words_per_chunk=max_words_per_chunk,
            )
        ]
        chunks = [chunk for chunk in chunks if chunk]
        if not chunks:
            chunks = [text]
        for chunk_index, chunk in enumerate(chunks):
            is_last_chunk_for_line = chunk_index == (len(chunks) - 1)
            pause_after_ms = GEMINI_MULTI_SPEAKER_WINDOW_PAUSE_MS if is_last_chunk_for_line else 0
            windows.append(
                {
                    "windowIndex": len(windows) + 1,
                    "laneId": lane_id,
                    "text": chunk,
                    "speakerVoices": [
                        {
                            "speaker": speaker,
                            "voiceName": voice_name,
                        }
                    ],
                    "speaker": speaker,
                    "lineIndex": line_index,
                    "dialogueIndex": dialogue_index,
                    "chunkIndex": chunk_index,
                    "pauseAfterMs": pause_after_ms,
                    "affinitySpeakers": _lane_affinity_speakers(lane_id),
                }
            )

    lane_assignments = [str(window.get("laneId") or "") for window in windows]
    lane_count = len({lane for lane in lane_assignments if lane})
    return (
        windows,
        {
            "profile": SEGMENTATION_PROFILE,
            "chunkCount": len(windows),
            "dialogueCount": len(normalized_line_map),
            "laneCount": lane_count,
            "laneAssignments": lane_assignments,
            "dialogueLanes": {str(key): value for key, value in dialogue_lanes.items()},
            "strategies": ["dialogue_three_lane_scheduler", "sentence_aware_chunking"],
        },
    )


def _execute_scheduled_window_plan(
    *,
    trace_id: str,
    safe_engine: str,
    requested_speech_mode: str,
    speech_mode_used: str,
    provider_label: str,
    windows: list[Dict[str, Any]],
    single_speaker_segmentation: Dict[str, Any],
    strategy_tokens: list[str],
    started_at_ms: int,
    key_pool_size: int,
    include_line_chunks: bool,
    synthesize_window_fn,
) -> Dict[str, Any]:
    if not windows:
        raise RuntimeError("Scheduled window plan is empty.")

    lane_windows: Dict[str, list[Dict[str, Any]]] = {}
    for window in windows:
        lane_id = str(window.get("laneId") or THREE_LANE_IDS[0]).upper()
        lane_windows.setdefault(lane_id, []).append(window)

    ordered_lane_ids = [lane_id for lane_id in THREE_LANE_IDS if lane_id in lane_windows]
    if not ordered_lane_ids:
        ordered_lane_ids = sorted(lane_windows.keys())

    def _run_lane(lane_id: str) -> list[Dict[str, Any]]:
        out: list[Dict[str, Any]] = []
        for lane_window in list(lane_windows.get(lane_id) or []):
            out.append(dict(synthesize_window_fn(lane_window) or {}))
        return out

    window_results: list[Dict[str, Any]] = []
    max_workers = max(1, min(len(ordered_lane_ids), len(THREE_LANE_IDS)))
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {executor.submit(_run_lane, lane_id): lane_id for lane_id in ordered_lane_ids}
        for future in concurrent.futures.as_completed(future_map):
            window_results.extend(list(future.result() or []))

    result_by_index: Dict[int, Dict[str, Any]] = {}
    models_used: list[str] = []
    speech_modes_used: list[str] = []
    key_indexes_used: list[int] = []
    attempt_key_indexes_used: list[int] = []
    attempt_error_kinds: list[str] = []
    attempt_statuses: list[str] = []
    usage_items: list[Dict[str, int]] = []
    resolved_voices: list[str] = []

    for result in window_results:
        window_index = int(result.get("windowIndex", -1))
        if window_index < 1:
            continue
        result_by_index[window_index] = result

    ordered_windows = sorted(windows, key=lambda item: int(item.get("windowIndex", 0)))
    final_pcm_chunks: list[bytes] = []
    line_pcm_by_index: Dict[int, list[bytes]] = {}

    for window in ordered_windows:
        window_index = int(window.get("windowIndex", -1))
        if window_index < 1 or window_index not in result_by_index:
            raise RuntimeError(f"Scheduled window result is missing for window {window_index}.")
        result = result_by_index[window_index]
        pcm_bytes = bytes(result.get("pcmBytes") or b"")
        if not pcm_bytes:
            raise RuntimeError(f"Scheduled window {window_index} returned empty audio.")
        model_used = str(result.get("model") or "").strip()
        if model_used:
            models_used.append(model_used)
        speech_mode = str(result.get("speechMode") or "").strip()
        if speech_mode:
            speech_modes_used.append(speech_mode)
        try:
            key_index = int(result.get("keyIndex", -1))
        except Exception:
            key_index = -1
        if key_index >= 0:
            key_indexes_used.append(key_index)
        attempt_metadata = result.get("attemptMetadata") if isinstance(result.get("attemptMetadata"), dict) else {}
        for raw_index in list(attempt_metadata.get("attemptKeySelectionIndexes") or []):
            try:
                safe_index = int(raw_index)
            except Exception:
                continue
            if safe_index >= 0:
                attempt_key_indexes_used.append(safe_index)
        for raw_error_kind in list(attempt_metadata.get("attemptErrorKinds") or []):
            attempt_error_kinds.append(str(raw_error_kind or "").strip().lower())
        for raw_status in list(attempt_metadata.get("attemptStatuses") or []):
            attempt_statuses.append(str(raw_status or "").strip().lower())
        usage_metadata = result.get("usageMetadata")
        if isinstance(usage_metadata, dict):
            usage_items.append(dict(usage_metadata))
        resolved_voice = str(result.get("resolvedVoice") or "").strip()
        if resolved_voice:
            resolved_voices.append(resolved_voice)
        final_pcm_chunks.append(pcm_bytes)
        line_index = int(window.get("lineIndex", -1))
        if line_index >= 0:
            line_pcm_by_index.setdefault(line_index, []).append(pcm_bytes)
        pause_after_ms = max(0, int(window.get("pauseAfterMs") or 0))
        if pause_after_ms > 0 and window_index < len(ordered_windows):
            pause_samples = int(round((24000 * float(pause_after_ms)) / 1000.0))
            if pause_samples > 0:
                final_pcm_chunks.append(b"\x00\x00" * pause_samples)

    final_pcm_bytes = b"".join(final_pcm_chunks)
    if not final_pcm_bytes:
        raise RuntimeError("Scheduled window plan returned empty audio.")

    wav_bytes = pcm16_to_wav(final_pcm_bytes, sample_rate=24000)
    model_header = next((item for item in models_used if item), "google-cloud-text-to-speech" if provider_label == "cloud-text-to-speech" else _normalize_model_name(TTS_MODEL))
    key_selection_meta = _build_key_selection_metadata(key_indexes_used)
    key_selection_index = int(key_selection_meta["finalKeySelectionIndex"])
    initial_key_selection_index = (
        int(attempt_key_indexes_used[0])
        if attempt_key_indexes_used
        else int(key_selection_meta["firstKeySelectionIndex"])
    )
    attempt_count = len(attempt_statuses) if attempt_statuses else len(ordered_windows)
    lane_assignments = [str(window.get("laneId") or "") for window in ordered_windows]
    line_chunks = [
        {
            "lineIndex": line_index,
            "pcmBytes": b"".join(list(line_pcm_by_index.get(line_index) or [])),
            "splitMode": "sentence_aware_lane_plan",
            "silenceFallback": False,
        }
        for line_index in sorted(line_pcm_by_index.keys())
    ]
    diagnostics_payload: Dict[str, Any] = {
        "engine": safe_engine,
        "traceId": trace_id,
        "chunkCount": len(ordered_windows),
        "windowCount": len(ordered_windows),
        "strategies": list(strategy_tokens or []),
        "recoveryUsed": False,
        "keyPoolSize": key_pool_size,
        "keySelectionIndex": key_selection_index,
        "initialKeySelectionIndex": initial_key_selection_index,
        "attemptCount": attempt_count,
        "attemptKeySelectionIndexes": attempt_key_indexes_used,
        "attemptErrorKinds": attempt_error_kinds,
        "attemptStatuses": attempt_statuses or ["success"] * len(ordered_windows),
        "segmentation": {
            "enabled": bool(single_speaker_segmentation.get("enabled")),
            "profile": single_speaker_segmentation.get("profile"),
            "chunkCount": int(single_speaker_segmentation.get("chunkCount") or len(ordered_windows)),
            "maxWordsPerChunk": int(single_speaker_segmentation.get("maxWordsPerChunk") or MAX_WORDS_PER_REQUEST),
            "joinCrossfadeMs": int(single_speaker_segmentation.get("joinCrossfadeMs") or 0),
            "laneCount": int(single_speaker_segmentation.get("laneCount") or len({lane for lane in lane_assignments if lane})),
            "laneAssignments": lane_assignments,
        },
        "model": model_header,
        "speechModeUsed": speech_mode_used,
        "provider": provider_label,
        "laneCount": len({lane for lane in lane_assignments if lane}),
        "lanesUsed": sorted({lane for lane in lane_assignments if lane}),
        "schedulerProfile": SEGMENTATION_PROFILE,
        "lineChunkCount": len(line_chunks),
    }
    diagnostics_payload.update(key_selection_meta)
    if resolved_voices:
        diagnostics_payload["resolvedVoices"] = resolved_voices
    diagnostics_payload.update(
        _build_realtime_metrics(
            wav_bytes=wav_bytes,
            processing_ms=max(0, int(time.time() * 1000) - started_at_ms),
        )
    )
    merged_usage_metadata = _merge_usage_metadata(usage_items)
    provider_usage_reported = _provider_usage_reported(merged_usage_metadata)
    usage_totals = _usage_metadata_totals(merged_usage_metadata)
    if provider_usage_reported:
        diagnostics_payload["usageMetadata"] = merged_usage_metadata

    _emit_stage_event(
        trace_id,
        "completed",
        "ok",
        {
            "bytes": len(wav_bytes),
            "model": model_header,
            "speechModeUsed": speech_mode_used,
            "speechModes": speech_modes_used or [speech_mode_used],
            "windowCount": len(ordered_windows),
            "keySelectionIndex": key_selection_index,
            "initialKeySelectionIndex": initial_key_selection_index,
            "attemptCount": attempt_count,
            "keyPoolSize": key_pool_size,
            "speakerHint": None,
            "providerUsageReported": provider_usage_reported,
            "promptTokens": int(usage_totals.get("promptTokens") or 0),
            "outputTokens": int(usage_totals.get("outputTokens") or 0),
            "totalTokens": int(usage_totals.get("totalTokens") or 0),
            "realtimeFactorX": diagnostics_payload.get("realtimeFactorX"),
            "provider": provider_label,
        },
    )
    return {
        "wavBytes": wav_bytes,
        "sampleRate": 24000,
        "lineChunks": line_chunks if include_line_chunks else [],
        "traceId": trace_id,
        "model": model_header,
        "speechModeUsed": speech_mode_used,
        "speechModes": speech_modes_used or [speech_mode_used],
        "speechModeRequested": requested_speech_mode,
        "keySelectionIndex": key_selection_index,
        "initialKeySelectionIndex": initial_key_selection_index,
        "attemptCount": attempt_count,
        "attemptKeySelectionIndexes": attempt_key_indexes_used,
        "attemptErrorKinds": attempt_error_kinds,
        "attemptStatuses": attempt_statuses or ["success"] * len(ordered_windows),
        "firstKeySelectionIndex": int(key_selection_meta["firstKeySelectionIndex"]),
        "finalKeySelectionIndex": int(key_selection_meta["finalKeySelectionIndex"]),
        "keySelectionIndexes": list(key_selection_meta.get("keySelectionIndexes") or []),
        "keyPoolSize": key_pool_size,
        "speakerHint": None,
        "windowCount": len(ordered_windows),
        "diagnostics": diagnostics_payload,
        "usageMetadata": merged_usage_metadata,
    }


def _synthesize_studio_pair_group_windows(
    *,
    engine: str,
    auth_mode: str,
    source_policy: Optional[dict[str, Any]],
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
    model_candidates_override: Optional[list[str]] = None,
) -> Dict[str, Any]:
    safe_engine = _normalize_runtime_engine(engine)
    line_windows = _build_line_map_word_windows(normalized_line_map, MAX_WORDS_PER_REQUEST)
    if not line_windows:
        raise HTTPException(status_code=400, detail="multi_speaker_line_map does not contain valid grouped dialogue.")

    aggregated_line_chunks: Dict[int, Dict[str, Any]] = {}
    models_used: list[str] = []
    speech_modes_used: list[str] = []
    key_indexes_used: list[int] = []
    attempt_key_indexes_used: list[int] = []
    attempt_error_kinds: list[str] = []
    attempt_statuses: list[str] = []
    usage_items: list[Dict[str, int]] = []
    total_group_count = 0
    total_pause_split_groups = 0
    total_duration_split_groups = 0
    max_concurrency_used = 0

    for line_window in line_windows:
        window_result = _synthesize_studio_pair_groups(
            engine=safe_engine,
            auth_mode=auth_mode,
            source_policy=source_policy,
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
            model_candidates_override=model_candidates_override,
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
        usage_metadata = window_result.get("usageMetadata")
        if isinstance(usage_metadata, dict):
            usage_items.append(dict(usage_metadata))
        diagnostics = window_result.get("diagnostics") if isinstance(window_result.get("diagnostics"), dict) else {}
        for raw_index in list(diagnostics.get("attemptKeySelectionIndexes") or []):
            try:
                safe_index = int(raw_index)
            except Exception:
                continue
            if safe_index >= 0:
                attempt_key_indexes_used.append(safe_index)
        for raw_error_kind in list(diagnostics.get("attemptErrorKinds") or []):
            attempt_error_kinds.append(str(raw_error_kind or "").strip().lower())
        for raw_status in list(diagnostics.get("attemptStatuses") or []):
            attempt_statuses.append(str(raw_status or "").strip().lower())
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
    key_selection_meta = _build_key_selection_metadata(key_indexes_used)
    key_selection_index = int(key_selection_meta["finalKeySelectionIndex"])
    initial_key_selection_index = (
        int(attempt_key_indexes_used[0])
        if attempt_key_indexes_used
        else int(key_selection_meta["firstKeySelectionIndex"])
    )
    diagnostics_payload: Dict[str, Any] = {
        "engine": safe_engine,
        "traceId": trace_id,
        "strategies": ["studio_pair_groups", "line_map_word_windows"] if len(line_windows) > 1 else ["studio_pair_groups"],
        "recoveryUsed": bool(retry_once),
        "groupCount": total_group_count,
        "lineCount": len(normalized_line_map),
        "windowCount": len(line_windows),
        "concurrencyUsed": max_concurrency_used,
        "keyPoolSize": len(effective_key_pool),
        "keySelectionIndex": key_selection_index,
        "initialKeySelectionIndex": initial_key_selection_index,
        "attemptCount": len(attempt_key_indexes_used),
        "attemptKeySelectionIndexes": attempt_key_indexes_used,
        "attemptErrorKinds": attempt_error_kinds,
        "attemptStatuses": attempt_statuses,
        "pauseSplitGroups": total_pause_split_groups,
        "durationSplitGroups": total_duration_split_groups,
        "lineChunkCount": len(ordered_line_chunks),
        "model": model_header,
        "speechModeUsed": "studio_pair_groups",
    }
    diagnostics_payload.update(key_selection_meta)
    diagnostics_payload.update(
        _build_realtime_metrics(
            wav_bytes=wav_bytes,
            processing_ms=max(0, int(time.time() * 1000) - started_at_ms),
        )
    )
    merged_usage_metadata = _merge_usage_metadata(usage_items)
    if isinstance(merged_usage_metadata, dict):
        diagnostics_payload["usageMetadata"] = merged_usage_metadata
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
            "initialKeySelectionIndex": initial_key_selection_index,
            "attemptCount": len(attempt_key_indexes_used),
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
        "initialKeySelectionIndex": initial_key_selection_index,
        "attemptCount": len(attempt_key_indexes_used),
        "attemptKeySelectionIndexes": attempt_key_indexes_used,
        "attemptErrorKinds": attempt_error_kinds,
        "attemptStatuses": attempt_statuses,
        "firstKeySelectionIndex": int(key_selection_meta["firstKeySelectionIndex"]),
        "finalKeySelectionIndex": int(key_selection_meta["finalKeySelectionIndex"]),
        "keySelectionIndexes": list(key_selection_meta.get("keySelectionIndexes") or []),
        "keyPoolSize": len(effective_key_pool),
        "speakerHint": speaker_hint or None,
        "windowCount": len(line_windows),
        "diagnostics": diagnostics_payload,
        "usageMetadata": merged_usage_metadata,
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


def _synthesize_pcm_result(
    result: object,
) -> tuple[bytes, str, str, int, Optional[Dict[str, int]]]:
    if isinstance(result, (tuple, list)):
        if len(result) == 5:
            pcm_bytes, model_used, speech_mode_used, key_index_used, usage_metadata = result
            normalized_usage = dict(usage_metadata) if isinstance(usage_metadata, dict) else None
            return (
                bytes(pcm_bytes or b""),
                str(model_used or ""),
                str(speech_mode_used or ""),
                int(key_index_used),
                normalized_usage,
            )
        if len(result) == 4:
            pcm_bytes, model_used, speech_mode_used, key_index_used = result
            return (
                bytes(pcm_bytes or b""),
                str(model_used or ""),
                str(speech_mode_used or ""),
                int(key_index_used),
                None,
            )
    raise RuntimeError("invalid_synthesis_result")


def _synthesize_pcm_result_with_attempts(
    result: object,
) -> tuple[bytes, str, str, int, Optional[Dict[str, int]], Dict[str, Any]]:
    if isinstance(result, (tuple, list)) and len(result) == 6:
        pcm_bytes, model_used, speech_mode_used, key_index_used, usage_metadata, attempt_metadata = result
        normalized_usage = dict(usage_metadata) if isinstance(usage_metadata, dict) else None
        normalized_attempts = dict(attempt_metadata) if isinstance(attempt_metadata, dict) else {}
        return (
            bytes(pcm_bytes or b""),
            str(model_used or ""),
            str(speech_mode_used or ""),
            int(key_index_used),
            normalized_usage,
            normalized_attempts,
        )
    pcm_bytes, model_used, speech_mode_used, key_index_used, usage_metadata = _synthesize_pcm_result(result)
    return (
        pcm_bytes,
        model_used,
        speech_mode_used,
        key_index_used,
        usage_metadata,
        _build_request_attempt_metadata([]),
    )


def _synthesize_pcm_with_key_pool(
    *,
    engine: str,
    auth_mode: str,
    source_policy: Optional[dict[str, Any]],
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
    model_candidates_override: Optional[list[str]] = None,
    include_usage_metadata: bool = False,
    include_attempt_metadata: bool = False,
) -> (
    tuple[bytes, str, str, int]
    | tuple[bytes, str, str, int, Optional[Dict[str, int]]]
    | tuple[bytes, str, str, int, Optional[Dict[str, int]], Dict[str, Any]]
):
    safe_engine = _normalize_runtime_engine(engine)
    explicit_candidates = [str(item or "").strip() for item in list(model_candidates_override or []) if str(item or "").strip()]
    model_candidates = explicit_candidates if explicit_candidates else resolve_tts_model_candidates(
        engine=safe_engine,
        auth_mode=auth_mode,
        source_policy=source_policy,
    )
    if not model_candidates:
        raise RuntimeError(f"No Gemini TTS model candidates available for engine={safe_engine}.")

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
    retry_preferred_key = str(preferred_key or "").strip() or None
    token_estimate = estimate_text_tokens(text_input)
    retry_limit = max(1, len(effective_key_pool) * max(1, len(model_candidates)))
    transient_same_key_retry_limit = 1
    transient_same_key_retries: Dict[tuple[str, str, str], int] = {}

    while True:
        remaining_budget_ms = _remaining_timeout_ms(started_at_ms, KEY_TOTAL_TIMEOUT_MS)
        if remaining_budget_ms <= 0:
            timed_out = True
            break

        effective_model_candidates = [
            model_id for model_id in model_candidates if model_id not in blocked_models
        ]
        if not effective_model_candidates:
            pool_exhausted = True
            break

        pressure = _estimate_tts_pool_pressure(
            key_pool=effective_key_pool,
            requested_tokens=token_estimate,
            model_candidates=effective_model_candidates,
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

        acquire = _RUNTIME_ALLOCATOR.acquire_for_models(
            model_candidates=effective_model_candidates,
            key_pool=effective_key_pool,
            requested_tokens=token_estimate,
            blocked_keys=blocked_keys,
            wait_timeout_ms=remaining_budget_ms,
            preferred_key=retry_preferred_key,
        )
        lease = acquire.lease
        if lease is None:
            timed_out = bool(acquire.timed_out)
            pool_exhausted = True
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
        retry_preferred_key = str(lease.key or "").strip() or retry_preferred_key
        if start_key_selection_index is None:
            start_key_selection_index = int(lease.key_index)
        key_fingerprint = _api_key_cache_key(lease.key)
        speech_mode, speech_config = speech_attempts[min(speech_index, max(0, len(speech_attempts) - 1))]
        attempt_entry: Dict[str, Any] = {
            "attempt": attempt,
            "keySelectionIndex": int(lease.key_index),
            "keyFingerprint": key_fingerprint,
            "model": lease.model_id,
            "speechMode": speech_mode,
            "windowIndex": window_index,
            "status": "pending",
        }
        key_attempts.append(attempt_entry)
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
                "attemptNumber": attempt,
                "attemptKind": "retry" if attempt > 1 else "initial",
                "isRetry": bool(attempt > 1),
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
            client = _build_genai_client(
                api_key=lease.key,
                timeout_ms=request_timeout_ms,
                auth_mode=auth_mode,
                source_policy={**source_policy, "selectedVertexSlotId": str(lease.key or "").strip()},
            )
            if _is_native_audio_model(lease.model_id):
                pcm_bytes, usage_metadata = _synthesize_live_pcm(
                    client=client,
                    model_id=lease.model_id,
                    text_input=text_input,
                    speech_config=speech_config,
                    timeout_ms=request_timeout_ms,
                )
            else:
                response = client.models.generate_content(
                    model=lease.model_id,
                    contents=text_input,
                    config=types.GenerateContentConfig(
                        response_modalities=["AUDIO"],
                        speech_config=speech_config,
                    ),
                )
                pcm_bytes = extract_pcm_bytes(response)
                usage_metadata = extract_usage_metadata(response)
            usage_totals = _usage_metadata_totals(usage_metadata)
            provider_usage_reported = _provider_usage_reported(usage_metadata)
            used_tokens = int(usage_totals.get("totalTokens") or 0) if provider_usage_reported else token_estimate
            _RUNTIME_ALLOCATOR.release(lease, success=True, used_tokens=used_tokens)
            _bind_speakers_to_key(affinity_speakers, lease.key)
            attempt_entry["status"] = "success"
            attempt_entry["errorKind"] = ""
            attempt_entry["requestTimeoutMs"] = request_timeout_ms
            normalized_usage = dict(usage_metadata) if isinstance(usage_metadata, dict) else None
            attempt_entry["providerUsageReported"] = provider_usage_reported
            attempt_entry["usageMetadata"] = usage_totals if provider_usage_reported else None
            if include_attempt_metadata:
                return (
                    pcm_bytes,
                    lease.model_id,
                    speech_mode,
                    int(lease.key_index),
                    normalized_usage if include_usage_metadata else None,
                    _build_request_attempt_metadata(key_attempts),
                )
            if include_usage_metadata:
                return pcm_bytes, lease.model_id, speech_mode, int(lease.key_index), normalized_usage
            return pcm_bytes, lease.model_id, speech_mode, int(lease.key_index)
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            detail = str(exc).strip().replace("\n", " ")
            error_kind = "other"
            allocator_error_kind = "other"
            retry_same_key = False
            if _is_timeout_error(detail):
                error_kind = "timeout"
                allocator_error_kind = "timeout"
                timed_out = True
            elif _is_model_access_error(detail):
                error_kind = "model_access"
                blocked_models.add(lease.model_id)
            elif _is_auth_error(detail):
                error_kind = "auth"
                allocator_error_kind = "auth"
                blocked_keys.add(lease.key)
                if retry_preferred_key == lease.key:
                    retry_preferred_key = None
                _evict_speaker_key_affinity_for_key(affinity_speakers, lease.key)
            elif _is_rate_limit_error(detail):
                error_kind = "rate_limit"
                allocator_error_kind = "rate_limit"
            else:
                if speech_index + 1 < len(speech_attempts):
                    speech_index += 1
                    retry_same_key = True
                else:
                    retry_signature = (lease.key, lease.model_id, speech_mode)
                    retry_count = int(transient_same_key_retries.get(retry_signature, 0))
                    if retry_count < transient_same_key_retry_limit:
                        transient_same_key_retries[retry_signature] = retry_count + 1
                        retry_same_key = True
                    else:
                        blocked_models.add(lease.model_id)
            attempt_entry["status"] = "failed"
            attempt_entry["errorKind"] = error_kind
            attempt_entry["sameKeyRetry"] = bool(retry_same_key)
            attempt_entry["requestTimeoutMs"] = request_timeout_ms
            _RUNTIME_ALLOCATOR.release(
                lease,
                success=False,
                used_tokens=0,
                error_kind=allocator_error_kind,
            )
            model_attempts.append(
                {
                    "attempt": attempt,
                    "model": lease.model_id,
                    "speechMode": speech_mode,
                    "keySelectionIndex": int(lease.key_index),
                    "keyFingerprint": key_fingerprint,
                    "requestTimeoutMs": request_timeout_ms,
                    "errorKind": error_kind,
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
        "ttsModelCandidates": model_candidates,
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


def _synthesize_windows_with_cloud_tts(
    *,
    source_policy: dict[str, Any],
    safe_engine: str,
    trace_id: str,
    text: str,
    target_voice: str,
    language_code: str,
    speaker_hint: str,
    requested_speech_mode: str,
    windows: list[Dict[str, Any]],
    single_speaker_segmentation: Dict[str, Any],
    pair_group_fallback_used: bool,
    pair_group_fallback_detail: str,
    use_windowed_multi: bool,
    speed: float,
    started_at_ms: int,
) -> Dict[str, Any]:
    wav_fragments: list[bytes] = []
    speech_modes_used: list[str] = []
    resolved_voices: list[str] = []
    attempt_statuses: list[str] = []

    for index, window in enumerate(windows, start=1):
        speaker_voices = list(window.get("speakerVoices") or [])
        requested_voice = (
            str(speaker_voices[0].get("voiceName") or target_voice).strip()
            if speaker_voices
            else target_voice
        ) or target_voice
        _emit_stage_event(
            trace_id,
            "synthesis",
            "retry",
            {
                "attemptNumber": index,
                "attemptKind": "retry" if index > 1 else "initial",
                "isRetry": bool(index > 1),
                "retryAttempt": index,
                "keyPoolSize": 0,
                "keySelectionIndex": -1,
                "keyFingerprint": "cloud_tts",
                "model": "google-cloud-text-to-speech",
                "speechMode": "single-speaker",
                "speakerHint": speaker_hint or None,
                "windowIndex": index,
                "windowTotal": len(windows),
                "requestedVoice": requested_voice,
            },
        )
        wav_bytes, voice_meta = _synthesize_window_with_cloud_tts(
            source_policy=source_policy,
            text=str(window.get("text") or ""),
            requested_voice=requested_voice,
            language_code=language_code,
            speed=speed,
            engine=safe_engine,
        )
        wav_fragments.append(wav_bytes)
        speech_modes_used.append("single-speaker")
        attempt_statuses.append("success")
        resolved_voice = str(voice_meta.get("resolvedVoice") or requested_voice).strip() or requested_voice
        resolved_voices.append(resolved_voice)

    wav_bytes = _concat_wav_fragments(
        wav_fragments,
        pause_ms=GEMINI_MULTI_SPEAKER_WINDOW_PAUSE_MS if len(wav_fragments) > 1 else 0,
    )
    if not wav_bytes:
        raise RuntimeError("Cloud Text-to-Speech returned empty audio.")

    if pair_group_fallback_used:
        speech_mode_used = "pair_group_split_fallback"
    elif use_windowed_multi:
        speech_mode_used = "text-order-two-speaker-windows"
    elif bool(single_speaker_segmentation.get("enabled")):
        speech_mode_used = "single-speaker-segmented"
    else:
        speech_mode_used = "single-speaker"

    diagnostics_payload: Dict[str, Any] = {
        "engine": safe_engine,
        "traceId": trace_id,
        "chunkCount": len(windows),
        "strategies": (
            ["pair_group_split_fallback", "single_speaker_line_windows"]
            if pair_group_fallback_used
            else (
                ["single_speaker_segmentation"]
                if bool(single_speaker_segmentation.get("enabled"))
                else ["single_speaker_cloud_tts"]
            )
        ),
        "recoveryUsed": bool(pair_group_fallback_used),
        "keyPoolSize": 0,
        "keySelectionIndex": -1,
        "initialKeySelectionIndex": -1,
        "attemptCount": len(windows),
        "attemptKeySelectionIndexes": [],
        "attemptErrorKinds": [],
        "attemptStatuses": attempt_statuses,
        "segmentation": {
            "enabled": bool(single_speaker_segmentation.get("enabled")),
            "profile": single_speaker_segmentation.get("profile"),
            "chunkCount": int(single_speaker_segmentation.get("chunkCount") or len(windows)),
            "maxWordsPerChunk": int(
                single_speaker_segmentation.get("maxWordsPerChunk") or MAX_WORDS_PER_REQUEST
            ),
            "joinCrossfadeMs": int(single_speaker_segmentation.get("joinCrossfadeMs") or 0),
        },
        "model": "google-cloud-text-to-speech",
        "speechModeUsed": speech_mode_used,
        "provider": "cloud-text-to-speech",
        "resolvedVoices": resolved_voices,
    }
    if pair_group_fallback_detail:
        diagnostics_payload["recoveryReason"] = pair_group_fallback_detail
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
            "model": "google-cloud-text-to-speech",
            "speechModeUsed": speech_mode_used,
            "speechModes": speech_modes_used,
            "windowCount": len(windows),
            "keySelectionIndex": -1,
            "initialKeySelectionIndex": -1,
            "attemptCount": len(windows),
            "keyPoolSize": 0,
            "speakerHint": speaker_hint or None,
            "providerUsageReported": False,
            "promptTokens": 0,
            "outputTokens": 0,
            "totalTokens": 0,
            "realtimeFactorX": diagnostics_payload.get("realtimeFactorX"),
            "recoveryUsed": bool(pair_group_fallback_used),
            "provider": "cloud-text-to-speech",
        },
    )
    return {
        "wavBytes": wav_bytes,
        "sampleRate": 24000,
        "lineChunks": [],
        "traceId": trace_id,
        "model": "google-cloud-text-to-speech",
        "speechModeUsed": speech_mode_used,
        "speechModes": speech_modes_used,
        "speechModeRequested": requested_speech_mode,
        "keySelectionIndex": -1,
        "initialKeySelectionIndex": -1,
        "attemptCount": len(windows),
        "attemptKeySelectionIndexes": [],
        "attemptErrorKinds": [],
        "attemptStatuses": attempt_statuses,
        "firstKeySelectionIndex": -1,
        "finalKeySelectionIndex": -1,
        "keySelectionIndexes": [],
        "keyPoolSize": 0,
        "speakerHint": speaker_hint or None,
        "windowCount": len(windows),
        "diagnostics": diagnostics_payload,
        "usageMetadata": {},
    }


def _synthesize_text_to_wav(payload: SynthesizeRequest) -> Dict[str, Any]:
    started_at_ms = int(time.time() * 1000)
    safe_engine = _normalize_runtime_engine(payload.engine, default=TTS_ENGINE_DEFAULT)
    source_policy = dict(_runtime_source_policy())
    if isinstance(payload.sourcePolicy, dict):
        source_policy = {**source_policy, **dict(payload.sourcePolicy)}
    auth_mode = _normalize_runtime_auth_mode(payload.authMode, source_policy=source_policy)
    cloud_tts_enabled = _tts_upstream_provider_for_engine(safe_engine) == TTS_UPSTREAM_PROVIDER_CLOUD_TTS
    text = _normalize_synthesis_text(payload.text)
    if not text:
        raise HTTPException(status_code=400, detail="Text is empty.")
    trace_id = _normalize_trace_id(payload.trace_id)
    explicit_model_candidates, invalid_model_candidates = _resolve_explicit_model_candidates(
        raw_candidates=payload.modelCandidates,
        raw_model=payload.model,
        task="tts",
    )
    if invalid_model_candidates and not explicit_model_candidates:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_model_candidates",
                "task": "tts",
                "invalid": invalid_model_candidates,
            },
        )
    if invalid_model_candidates and explicit_model_candidates:
        _emit_stage_event(
            trace_id,
            "preprocess",
            "model_candidates_partial_invalid",
            {
                "invalidModelCandidates": invalid_model_candidates,
                "selectedModelCandidates": explicit_model_candidates,
            },
        )
    model_candidates_override = explicit_model_candidates if explicit_model_candidates else None
    target_voice = str(payload.voiceName or payload.voice_id or "Fenrir").strip() or "Fenrir"
    normalized_speaker_voices = _normalize_speaker_voices(payload.speaker_voices or [], target_voice=target_voice)
    multi_speaker_mode = _normalize_multi_speaker_mode(payload.multi_speaker_mode)
    if multi_speaker_mode == "off":
        normalized_speaker_voices = []
    normalized_line_map = _normalize_multi_speaker_line_map(payload.multi_speaker_line_map)
    normalized_speaker_voices, normalized_line_map = _canonicalize_multi_speaker_identities(
        normalized_speaker_voices,
        normalized_line_map,
    )
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

    if cloud_tts_enabled:
        primary_key_pool = []
        fallback_request_key = None
        effective_key_pool: list[str] = []
    else:
        primary_key_pool, fallback_request_key, effective_key_pool = _resolve_tts_key_pool(
            payload.apiKey,
            trace_id=trace_id,
            pool_hint=payload.poolHint,
        )
    language_code = resolve_language_code(text, payload.language)
    speaker_hint = re.sub(r"\s+", " ", str(payload.speaker or "")).strip()
    word_count = count_words(text)
    allow_windowed_word_split = bool(cloud_tts_enabled and len(normalized_line_map) >= 2)
    if word_count > MAX_WORDS_PER_REQUEST and not use_studio_pair_groups and not allow_windowed_word_split:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "word_limit_exceeded",
                "maxWords": MAX_WORDS_PER_REQUEST,
                "actualWords": word_count,
            },
        )

    pair_group_fallback_used = False
    pair_group_fallback_detail = ""
    single_speaker_segmentation: Dict[str, Any] = {
        "enabled": False,
        "profile": None,
        "chunkCount": 1,
        "maxWordsPerChunk": MAX_WORDS_PER_REQUEST,
        "joinCrossfadeMs": 0,
        "laneCount": 0,
        "laneAssignments": [],
        "strategies": [],
    }
    scheduled_windows: Optional[list[Dict[str, Any]]] = None
    scheduled_strategy_tokens: list[str] = []
    scheduled_speech_mode_used = ""
    if use_studio_pair_groups:
        scheduled_windows, scheduled_meta = _build_multi_speaker_dialogue_lane_windows(
            normalized_line_map=normalized_line_map,
            speaker_voices=normalized_speaker_voices,
            target_voice=target_voice,
            language_code=language_code,
        )
        scheduled_strategy_tokens = [str(item or "").strip() for item in list(scheduled_meta.get("strategies") or []) if str(item or "").strip()]
        scheduled_speech_mode_used = requested_speech_mode
    elif requested_speech_mode == "single-speaker":
        scheduled_windows, single_speaker_segmentation = _build_single_speaker_segment_windows(
            text=text,
            language_code=language_code,
            speaker_voices=normalized_speaker_voices,
        )
        scheduled_strategy_tokens = [str(item or "").strip() for item in list(single_speaker_segmentation.get("strategies") or []) if str(item or "").strip()]
        scheduled_speech_mode_used = "single-speaker-segmented" if bool(single_speaker_segmentation.get("enabled")) else "single-speaker"

    raw_windows: list[Dict[str, Any]]
    if isinstance(scheduled_windows, list) and scheduled_windows:
        raw_windows = scheduled_windows
    elif use_windowed_multi:
        raw_windows = _build_text_order_two_speaker_windows(
            text=text,
            speaker_voices=normalized_speaker_voices,
            target_voice=target_voice,
        )
    else:
        raw_windows = [{"text": text, "speakerVoices": normalized_speaker_voices}]

    windows: list[Dict[str, Any]] = []
    for index, window in enumerate(raw_windows, start=1):
        window_text = _normalize_synthesis_text(str(window.get("text") or ""))
        if not window_text:
            continue
        window_speaker_voices = _normalize_speaker_voices(
            window.get("speakerVoices") or [],
            target_voice=target_voice,
        )
        safe_lane_id = str(window.get("laneId") or THREE_LANE_IDS[0]).upper()
        windows.append(
            {
                "windowIndex": int(window.get("windowIndex") or index),
                "laneId": safe_lane_id,
                "text": window_text,
                "speakerVoices": window_speaker_voices[:2],
                "lineIndex": int(window.get("lineIndex", -1)),
                "dialogueIndex": int(window.get("dialogueIndex", max(0, index - 1))),
                "chunkIndex": int(window.get("chunkIndex", 0)),
                "pauseAfterMs": max(0, int(window.get("pauseAfterMs") or 0)),
                "affinitySpeakers": [
                    str(item or "").strip()
                    for item in list(window.get("affinitySpeakers") or _lane_affinity_speakers(safe_lane_id))
                    if str(item or "").strip()
                ],
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
            "segmentation": "enabled" if bool(single_speaker_segmentation.get("enabled")) else "disabled",
            "segmentationProfile": single_speaker_segmentation.get("profile"),
            "segmentationChunkCount": int(single_speaker_segmentation.get("chunkCount") or 1),
            "segmentationMaxWordsPerChunk": int(
                single_speaker_segmentation.get("maxWordsPerChunk") or MAX_WORDS_PER_REQUEST
            ),
            "language": language_code,
            "speechModeRequested": requested_speech_mode,
            "speakerCount": len(normalized_speaker_voices),
            "windowCount": len(windows),
            "keyPoolSize": 0 if cloud_tts_enabled else len(effective_key_pool),
            "speakerHint": speaker_hint or None,
            "provider": "cloud-text-to-speech" if cloud_tts_enabled else _tts_provider_label(engine=safe_engine, auth_mode=auth_mode),
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
            "keyPoolSize": 0 if cloud_tts_enabled else len(effective_key_pool),
            "speakerHint": speaker_hint or None,
            "provider": "cloud-text-to-speech" if cloud_tts_enabled else _tts_provider_label(engine=safe_engine, auth_mode=auth_mode),
        },
    )

    if isinstance(scheduled_windows, list) and windows:
        provider_label = "cloud-text-to-speech" if cloud_tts_enabled else _tts_provider_label(engine=safe_engine, auth_mode=auth_mode)

        if cloud_tts_enabled:
            def _synthesize_scheduled_window(window: Dict[str, Any]) -> Dict[str, Any]:
                speaker_voices = list(window.get("speakerVoices") or [])
                requested_voice = (
                    str(speaker_voices[0].get("voiceName") or target_voice).strip()
                    if speaker_voices
                    else target_voice
                ) or target_voice
                window_index = int(window.get("windowIndex") or 1)
                lane_id = str(window.get("laneId") or "").strip().upper()
                window_source_policy = dict(source_policy)
                if lane_id in {"L1", "L2", "L3"}:
                    window_source_policy["selectedVertexSlotId"] = f"slot_{lane_id[-1]}"
                _emit_stage_event(
                    trace_id,
                    "synthesis",
                    "retry",
                    {
                        "attemptNumber": window_index,
                        "attemptKind": "initial",
                        "isRetry": False,
                        "retryAttempt": 1,
                        "keyPoolSize": 0,
                        "keySelectionIndex": -1,
                        "keyFingerprint": "cloud_tts",
                        "model": "google-cloud-text-to-speech",
                        "speechMode": "single-speaker",
                        "speakerHint": speaker_hint or None,
                        "windowIndex": window_index,
                        "windowTotal": len(windows),
                        "requestedVoice": requested_voice,
                        "laneId": str(window.get("laneId") or ""),
                    },
                )
                wav_bytes, voice_meta = _synthesize_window_with_cloud_tts(
                    source_policy=window_source_policy,
                    text=str(window.get("text") or ""),
                    requested_voice=requested_voice,
                    language_code=language_code,
                    speed=float(payload.speed or 1.0),
                    engine=safe_engine,
                )
                pcm_bytes, _sample_rate = _wav_bytes_to_pcm16(wav_bytes)
                return {
                    "windowIndex": window_index,
                    "pcmBytes": pcm_bytes,
                    "model": "google-cloud-text-to-speech",
                    "speechMode": "single-speaker",
                    "keyIndex": -1,
                    "attemptMetadata": {},
                    "usageMetadata": {},
                    "resolvedVoice": str((voice_meta or {}).get("resolvedVoice") or requested_voice).strip() or requested_voice,
                }
        else:
            def _synthesize_scheduled_window(window: Dict[str, Any]) -> Dict[str, Any]:
                window_index = int(window.get("windowIndex") or 1)
                window_speaker_voices = list(window.get("speakerVoices") or [])
                local_speaker_hint = ", ".join(
                    str(item.get("speaker") or "").strip()
                    for item in window_speaker_voices
                    if str(item.get("speaker") or "").strip()
                ).strip() or speaker_hint
                (
                    pcm_bytes,
                    model_used,
                    speech_mode,
                    key_index,
                    usage_metadata,
                    attempt_metadata,
                ) = _synthesize_pcm_result_with_attempts(
                    _synthesize_pcm_with_key_pool(
                        engine=safe_engine,
                        auth_mode=auth_mode,
                        source_policy=source_policy,
                        text_input=str(window.get("text") or ""),
                        trace_id=trace_id,
                        speaker_hint=local_speaker_hint,
                        language_code=language_code,
                        target_voice=target_voice,
                        speaker_voices=window_speaker_voices,
                        primary_key_pool=primary_key_pool,
                        fallback_request_key=fallback_request_key,
                        effective_key_pool=effective_key_pool,
                        speech_mode_requested=requested_speech_mode,
                        window_index=window_index,
                        window_total=len(windows),
                        affinity_speakers=[str(item or "").strip() for item in list(window.get("affinitySpeakers") or []) if str(item or "").strip()],
                        model_candidates_override=model_candidates_override,
                        include_usage_metadata=True,
                        include_attempt_metadata=True,
                    )
                )
                return {
                    "windowIndex": window_index,
                    "pcmBytes": pcm_bytes,
                    "model": model_used,
                    "speechMode": speech_mode,
                    "keyIndex": int(key_index),
                    "attemptMetadata": dict(attempt_metadata or {}),
                    "usageMetadata": dict(usage_metadata or {}) if isinstance(usage_metadata, dict) else {},
                }

        return _execute_scheduled_window_plan(
            trace_id=trace_id,
            safe_engine=safe_engine,
            requested_speech_mode=requested_speech_mode,
            speech_mode_used=scheduled_speech_mode_used or requested_speech_mode,
            provider_label=provider_label,
            windows=windows,
            single_speaker_segmentation=single_speaker_segmentation,
            strategy_tokens=scheduled_strategy_tokens,
            started_at_ms=started_at_ms,
            key_pool_size=0 if cloud_tts_enabled else len(effective_key_pool),
            include_line_chunks=return_line_chunks_requested,
            synthesize_window_fn=_synthesize_scheduled_window,
        )

    if cloud_tts_enabled:
        return _synthesize_windows_with_cloud_tts(
            source_policy=source_policy,
            safe_engine=safe_engine,
            trace_id=trace_id,
            text=text,
            target_voice=target_voice,
            language_code=language_code,
            speaker_hint=speaker_hint,
            requested_speech_mode=requested_speech_mode,
            windows=windows,
            single_speaker_segmentation=single_speaker_segmentation,
            pair_group_fallback_used=pair_group_fallback_used,
            pair_group_fallback_detail=pair_group_fallback_detail,
            use_windowed_multi=use_windowed_multi,
            speed=float(payload.speed or 1.0),
            started_at_ms=started_at_ms,
        )

    try:
        pcm_fragments: list[bytes] = []
        models_used: list[str] = []
        speech_modes_used: list[str] = []
        key_indexes_used: list[int] = []
        attempt_key_indexes_used: list[int] = []
        attempt_error_kinds: list[str] = []
        attempt_statuses: list[str] = []
        usage_items: list[Dict[str, int]] = []
        bridge_samples = int(round((24000 * GEMINI_MULTI_SPEAKER_WINDOW_PAUSE_MS) / 1000.0))
        bridge_pause_pcm = (b"\x00\x00" * bridge_samples) if bridge_samples > 0 else b""

        for index, window in enumerate(windows, start=1):
            window_affinity_speakers = _extract_affinity_speakers(
                speaker_hint=speaker_hint,
                speaker_voices=list(window.get("speakerVoices") or []),
            )
            (
                pcm_bytes,
                model_used,
                speech_mode_used,
                key_index_used,
                usage_metadata,
                attempt_metadata,
            ) = _synthesize_pcm_result_with_attempts(
                _synthesize_pcm_with_key_pool(
                    engine=safe_engine,
                    auth_mode=auth_mode,
                    source_policy=source_policy,
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
                    model_candidates_override=model_candidates_override,
                    include_usage_metadata=True,
                    include_attempt_metadata=True,
                )
            )
            if not pcm_bytes:
                raise RuntimeError("Gemini returned empty audio.")
            pcm_fragments.append(pcm_bytes)
            if index < len(windows) and bridge_pause_pcm:
                pcm_fragments.append(bridge_pause_pcm)
            models_used.append(model_used)
            speech_modes_used.append(speech_mode_used)
            key_indexes_used.append(key_index_used)
            for raw_index in list(attempt_metadata.get("attemptKeySelectionIndexes") or []):
                try:
                    safe_index = int(raw_index)
                except Exception:
                    continue
                if safe_index >= 0:
                    attempt_key_indexes_used.append(safe_index)
            for raw_error_kind in list(attempt_metadata.get("attemptErrorKinds") or []):
                attempt_error_kinds.append(str(raw_error_kind or "").strip().lower())
            for raw_status in list(attempt_metadata.get("attemptStatuses") or []):
                attempt_statuses.append(str(raw_status or "").strip().lower())
            if isinstance(usage_metadata, dict):
                usage_items.append(usage_metadata)

        final_pcm_bytes = b"".join(pcm_fragments)
        if not final_pcm_bytes:
            raise RuntimeError("Gemini returned empty audio.")
        wav_bytes = pcm16_to_wav(final_pcm_bytes, sample_rate=24000)
        unique_models = [item for item in models_used if item]
        model_header = unique_models[0] if unique_models else _normalize_model_name(TTS_MODEL)
        if pair_group_fallback_used:
            speech_mode_used = "pair_group_split_fallback"
        elif use_windowed_multi:
            speech_mode_used = "text-order-two-speaker-windows"
        elif bool(single_speaker_segmentation.get("enabled")):
            speech_mode_used = "single-speaker-segmented"
        else:
            speech_mode_used = speech_modes_used[0] if speech_modes_used else "single-speaker"
        key_selection_meta = _build_key_selection_metadata(key_indexes_used)
        key_selection_index = int(key_selection_meta["finalKeySelectionIndex"])
        initial_key_selection_index = (
            int(attempt_key_indexes_used[0])
            if attempt_key_indexes_used
            else int(key_selection_meta["firstKeySelectionIndex"])
        )
        diagnostics_payload: Dict[str, Any] = {
            "engine": safe_engine,
            "traceId": trace_id,
            "chunkCount": len(windows),
            "strategies": (
                ["pair_group_split_fallback", "single_speaker_line_windows"]
                if pair_group_fallback_used
                else (
                    ["single_speaker_segmentation"]
                    if bool(single_speaker_segmentation.get("enabled"))
                    else ["legacy_windows" if not use_windowed_multi else "text_order_two_speaker_windows"]
                )
            ),
            "recoveryUsed": bool(pair_group_fallback_used),
            "keyPoolSize": len(effective_key_pool),
            "keySelectionIndex": key_selection_index,
            "initialKeySelectionIndex": initial_key_selection_index,
            "attemptCount": len(attempt_key_indexes_used),
            "attemptKeySelectionIndexes": attempt_key_indexes_used,
            "attemptErrorKinds": attempt_error_kinds,
            "attemptStatuses": attempt_statuses,
            "segmentation": {
                "enabled": bool(single_speaker_segmentation.get("enabled")),
                "profile": single_speaker_segmentation.get("profile"),
                "chunkCount": int(single_speaker_segmentation.get("chunkCount") or len(windows)),
                "maxWordsPerChunk": int(
                    single_speaker_segmentation.get("maxWordsPerChunk") or MAX_WORDS_PER_REQUEST
                ),
                "joinCrossfadeMs": int(single_speaker_segmentation.get("joinCrossfadeMs") or 0),
            },
            "model": model_header,
            "speechModeUsed": speech_mode_used,
        }
        diagnostics_payload.update(key_selection_meta)
        if pair_group_fallback_detail:
            diagnostics_payload["recoveryReason"] = pair_group_fallback_detail
        diagnostics_payload.update(
            _build_realtime_metrics(
                wav_bytes=wav_bytes,
                processing_ms=max(0, int(time.time() * 1000) - started_at_ms),
            )
        )
        merged_usage_metadata = _merge_usage_metadata(usage_items)
        provider_usage_reported = _provider_usage_reported(merged_usage_metadata)
        usage_totals = _usage_metadata_totals(merged_usage_metadata)
        if provider_usage_reported:
            diagnostics_payload["usageMetadata"] = merged_usage_metadata

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
                "initialKeySelectionIndex": initial_key_selection_index,
                "attemptCount": len(attempt_key_indexes_used),
                "keyPoolSize": len(effective_key_pool),
                "speakerHint": speaker_hint or None,
                "providerUsageReported": provider_usage_reported,
                "promptTokens": int(usage_totals.get("promptTokens") or 0),
                "outputTokens": int(usage_totals.get("outputTokens") or 0),
                "totalTokens": int(usage_totals.get("totalTokens") or 0),
                "realtimeFactorX": diagnostics_payload.get("realtimeFactorX"),
                "recoveryUsed": bool(pair_group_fallback_used),
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
            "initialKeySelectionIndex": initial_key_selection_index,
            "attemptCount": len(attempt_key_indexes_used),
            "attemptKeySelectionIndexes": attempt_key_indexes_used,
            "attemptErrorKinds": attempt_error_kinds,
            "attemptStatuses": attempt_statuses,
            "firstKeySelectionIndex": int(key_selection_meta["firstKeySelectionIndex"]),
            "finalKeySelectionIndex": int(key_selection_meta["finalKeySelectionIndex"]),
            "keySelectionIndexes": list(key_selection_meta.get("keySelectionIndexes") or []),
            "keyPoolSize": len(effective_key_pool),
            "speakerHint": speaker_hint or None,
            "windowCount": len(windows),
            "diagnostics": diagnostics_payload,
            "usageMetadata": merged_usage_metadata,
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
                "engine": safe_engine,
                **parsed_error,
            }
        else:
            error_payload = {
                "error": f"Gemini TTS synthesis failed: {raw_error}",
                "errorCode": ERROR_CODE_UPSTREAM_MODEL_FAILED,
                "summary": raw_error[:220] if raw_error else "Gemini TTS synthesis failed.",
                "speechModeRequested": requested_speech_mode,
                "speakerHint": speaker_hint or None,
                "engine": safe_engine,
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
        public_error_payload = _sanitize_public_tts_error_payload(error_payload)
        _emit_stage_event(trace_id, "failed", "error", public_error_payload)
        error_code = str(error_payload.get("errorCode") or "").strip().upper()
        _record_error_classification(error_code)
        status_code = 502
        if error_code in {
            ERROR_CODE_SLOT_SET_OVERLOADED,
            ERROR_CODE_SLOT_SET_TIMEOUT,
            ERROR_CODE_ALLOCATOR_ACQUIRE_TIMEOUT,
            ERROR_CODE_ALL_SLOTS_RATE_LIMITED,
        }:
            status_code = 503
        elif error_code == ERROR_CODE_UPSTREAM_REQUEST_TIMEOUT:
            status_code = 504
        raise HTTPException(status_code=status_code, detail=public_error_payload) from exc


app = FastAPI(title=APP_NAME)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins("VF_CORS_ORIGINS"),
    allow_origin_regex=LOCALHOST_CORS_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health(engine: Optional[str] = None) -> JSONResponse:
    source_policy = _runtime_source_policy()
    auth_mode = _normalize_runtime_auth_mode(None, source_policy=source_policy)
    safe_engine = _normalize_runtime_engine(engine, default=TTS_ENGINE_DEFAULT)
    cloud_tts_enabled = _tts_upstream_provider_for_engine(safe_engine) == TTS_UPSTREAM_PROVIDER_CLOUD_TTS
    model_candidates = resolve_tts_model_candidates(
        engine=safe_engine,
        auth_mode=auth_mode,
        source_policy=source_policy,
    )
    model = model_candidates[0] if model_candidates else _resolve_tts_route_model()
    configured_pool = resolve_request_api_key_pool("")
    provider = _tts_provider_label(engine=safe_engine, auth_mode=auth_mode)
    tts_ready = _cloud_tts_client_ready(source_policy=source_policy) if cloud_tts_enabled else (genai is not None and types is not None)
    return JSONResponse(
        {
            "ok": tts_ready,
            "engine": APP_NAME,
            "requestedEngine": safe_engine,
            "authMode": auth_mode,
            "model": "google-cloud-text-to-speech" if cloud_tts_enabled else model,
            "modelCandidates": model_candidates,
            "supportsMultiSpeaker": not cloud_tts_enabled,
            "multiSpeakerMaxSpeakers": 0 if cloud_tts_enabled else 2,
            "geminiAvailable": genai is not None,
            "apiKeyConfigured": bool(configured_pool),
            "keyPoolSize": len(configured_pool),
            "ttsModelFallbackEnabled": _tts_model_fallback_enabled(source_policy),
            "ttsAllocatorRateLimitsDisabled": GEMINI_ALLOCATOR_DISABLE_RATE_LIMITS,
            "mode": "cloud-text-to-speech" if cloud_tts_enabled else "gemini-only",
            "device": "hosted",
            "device_mode": "remote",
            "provider": provider,
            "textProvider": "vertex-ai" if auth_mode == SOURCE_POLICY_PROVIDER_VERTEX else "gemini-api",
            "ttsProvider": provider,
            "provider_preference": ["hosted"],
            "gpu_enabled": False,
            "openvino_enabled": False,
            "local_inference": False,
            "batchDefaultParallelism": GEMINI_BATCH_DEFAULT_PARALLEL,
            "batchMaxParallelism": GEMINI_BATCH_MAX_PARALLEL,
            "segmentationProfile": SEGMENTATION_PROFILE,
        }
    )


@app.get("/v1/capabilities")
def capabilities(engine: Optional[str] = None) -> JSONResponse:
    source_policy = _runtime_source_policy()
    auth_mode = _normalize_runtime_auth_mode(None, source_policy=source_policy)
    safe_engine = _normalize_runtime_engine(engine, default=TTS_ENGINE_DEFAULT)
    cloud_tts_enabled = _tts_upstream_provider_for_engine(safe_engine) == TTS_UPSTREAM_PROVIDER_CLOUD_TTS
    model_candidates = resolve_tts_model_candidates(
        engine=safe_engine,
        auth_mode=auth_mode,
        source_policy=source_policy,
    )
    model = model_candidates[0] if model_candidates else _resolve_tts_route_model()
    configured_pool = resolve_request_api_key_pool("")
    provider = _tts_provider_label(engine=safe_engine, auth_mode=auth_mode)
    default_segmentation_profile = resolve_chunk_profile("en", "segment capabilities")
    hindi_segmentation_profile = resolve_chunk_profile("hi", "यह सेगमेंट प्रोफाइल है")
    return JSONResponse(
        {
            "engine": safe_engine,
            "runtime": APP_NAME,
            "ready": _cloud_tts_client_ready(source_policy=source_policy) if cloud_tts_enabled else (genai is not None and types is not None),
            "languages": ["multilingual"],
            "speed": {"min": 0.7, "max": 1.3, "default": 1.0},
            "supportsEmotion": False,
            "supportsStyle": False,
            "supportsSpeakerWav": False,
            "model": "google-cloud-text-to-speech" if cloud_tts_enabled else model,
            "modelCandidates": model_candidates,
            "supportsMultiSpeaker": not cloud_tts_enabled,
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
                "mode": "cloud-text-to-speech" if cloud_tts_enabled else ("gemini-only" if auth_mode == SOURCE_POLICY_PROVIDER_GEMINI_API else "vertex"),
                "authMode": auth_mode,
                "ttsAllocatorRateLimitsDisabled": GEMINI_ALLOCATOR_DISABLE_RATE_LIMITS,
                "device": "hosted",
                "deviceMode": "remote",
                "provider": provider,
                "textProvider": "vertex-ai" if auth_mode == SOURCE_POLICY_PROVIDER_VERTEX else "gemini-api",
                "ttsProvider": provider,
                "providerPreference": ["hosted"],
                "gpuEnabled": False,
                "openvinoEnabled": False,
                "localInference": False,
                "ttsModelFallbackEnabled": _tts_model_fallback_enabled(source_policy),
                "maxWordsPerRequest": MAX_WORDS_PER_REQUEST,
                "segmentation": "enabled",
                "segmentationProfile": SEGMENTATION_PROFILE,
                "segmentationProfiles": {
                    "default": default_segmentation_profile,
                    "hi": hindi_segmentation_profile,
                },
                "multiSpeakerMaxSpeakers": 0 if cloud_tts_enabled else 2,
                "supportsBatchSynthesis": True,
                "batchEndpoint": "/synthesize/batch",
                "structuredEndpoint": "/synthesize/structured",
                "batchMaxItems": GEMINI_BATCH_MAX_ITEMS,
                "batchDefaultParallelism": GEMINI_BATCH_DEFAULT_PARALLEL,
                "batchMaxParallelism": GEMINI_BATCH_MAX_PARALLEL,
                "multiSpeakerMaxSpeakersPerCall": 0 if cloud_tts_enabled else 2,
                "multiSpeakerBatchingMode": "single_speaker_windows" if cloud_tts_enabled else "studio_pair_groups_with_line_map_windows",
            },
        }
    )


def admin_api_pool_reload(request: Request) -> JSONResponse:
    _require_runtime_admin(request)
    raise HTTPException(status_code=405, detail="Gemini pool management has been removed.")
    refreshed_pool = list(_refresh_server_api_key_pool())
    config, _ = _load_api_pool_config(force=True)
    key_pool = list(resolve_request_api_key_pool("", pool_hint=resolve_default_runtime_pool_hint(config)))
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
    payload["poolConfig"] = _sanitize_runtime_pool_config_for_response(config)
    payload["poolConfigMeta"] = meta
    payload["warnings"] = list((meta or {}).get("warnings") or [])
    payload["sourcePolicy"] = _sanitize_source_policy_for_response(dict(config.get("sourcePolicy") or {}))
    return JSONResponse(payload)


@app.get("/v1/admin/api-pools")
def admin_api_pools(request: Request) -> JSONResponse:
    _require_runtime_admin(request)
    return JSONResponse(_admin_api_pools_payload())


def admin_api_pools_update(payload: ApiPoolsConfigUpdateRequest, request: Request) -> JSONResponse:
    _require_runtime_admin(request)
    raise HTTPException(status_code=405, detail="Gemini pool management has been removed.")
    current_config, _current_meta = _load_api_pool_config(force=True)
    current_source_policy = dict(current_config.get("sourcePolicy") or {})
    applied_overrides: list[str] = []
    local_warnings: list[str] = []
    raw_payload = payload.model_dump(exclude_none=True) if hasattr(payload, "model_dump") else payload.dict(exclude_none=True)
    try:
        raw_payload = _restore_masked_runtime_gemini_keys_from_payload(raw_payload, current_config=current_config)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    source_policy_requested = isinstance(raw_payload.get("sourcePolicy"), dict)
    raw_source_policy = dict(raw_payload.get("sourcePolicy") or {}) if source_policy_requested else {}
    vertex_service_account_json = str(
        raw_source_policy.get("vertexServiceAccountJson")
        or raw_source_policy.get("serviceAccountJson")
        or ""
    ).strip()
    vertex_access_token = str(
        raw_source_policy.get("vertexAccessToken")
        or raw_source_policy.get("accessToken")
        or raw_source_policy.get("vertexApiKey")
        or ""
    ).strip()
    if source_policy_requested:
        raw_source_policy.pop("vertexServiceAccountJson", None)
        raw_source_policy.pop("serviceAccountJson", None)
        raw_source_policy.pop("vertexAccessToken", None)
        raw_source_policy.pop("accessToken", None)
        raw_source_policy.pop("vertexApiKey", None)
        raw_payload["sourcePolicy"] = raw_source_policy

    normalized = normalize_pool_config(raw_payload)
    requested_source_policy = dict(normalized.get("sourcePolicy") or {})
    if source_policy_requested:
        next_source_policy = dict(current_source_policy)
        for key in raw_source_policy.keys():
            if key in requested_source_policy:
                next_source_policy[key] = requested_source_policy[key]
        if not next_source_policy:
            next_source_policy = dict(requested_source_policy)
        provider = str(next_source_policy.get("provider") or SOURCE_POLICY_PROVIDER_GEMINI_API).strip().lower()
        if vertex_service_account_json:
            if provider != SOURCE_POLICY_PROVIDER_VERTEX:
                provider = SOURCE_POLICY_PROVIDER_VERTEX
                next_source_policy["provider"] = provider
                applied_overrides.append("source_policy_provider_set_vertex")
            path_hint = str(next_source_policy.get("vertexServiceAccountRef") or "").strip()
            try:
                persisted_ref, credential_payload = _persist_vertex_service_account_json(
                    vertex_service_account_json,
                    path_hint=path_hint,
                )
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            next_source_policy["vertexServiceAccountRef"] = persisted_ref
            if not str(next_source_policy.get("vertexProject") or "").strip():
                inferred_project = str(credential_payload.get("project_id") or "").strip()
                if inferred_project:
                    next_source_policy["vertexProject"] = inferred_project
                    applied_overrides.append("vertex_project_inferred_from_service_account")
            if not str(next_source_policy.get("vertexLocation") or "").strip():
                next_source_policy["vertexLocation"] = _default_vertex_location()
        if vertex_access_token:
            if provider != SOURCE_POLICY_PROVIDER_VERTEX:
                provider = SOURCE_POLICY_PROVIDER_VERTEX
                next_source_policy["provider"] = provider
                applied_overrides.append("source_policy_provider_set_vertex")
            path_hint = str(next_source_policy.get("vertexAccessTokenRef") or "").strip()
            try:
                persisted_ref = _persist_vertex_access_token(
                    vertex_access_token,
                    path_hint=path_hint,
                )
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            next_source_policy["vertexAccessTokenRef"] = persisted_ref
        if provider == SOURCE_POLICY_PROVIDER_VERTEX:
            if not str(next_source_policy.get("vertexProject") or "").strip():
                inferred_project = _default_vertex_project()
                if inferred_project:
                    next_source_policy["vertexProject"] = inferred_project
                    applied_overrides.append("vertex_project_inferred_from_env")
            if not str(next_source_policy.get("vertexLocation") or "").strip():
                next_source_policy["vertexLocation"] = _default_vertex_location()
        normalized["sourcePolicy"] = next_source_policy
    elif current_source_policy:
        normalized["sourcePolicy"] = dict(current_source_policy)

    effective_source_policy = dict(normalized.get("sourcePolicy") or {})
    provider_token = str(
        effective_source_policy.get("provider") or SOURCE_POLICY_PROVIDER_GEMINI_API
    ).strip().lower()
    free_pool_locked = (
        provider_token != SOURCE_POLICY_PROVIDER_VERTEX
        and bool(effective_source_policy.get("freePoolLocked"))
    )
    normalized_pools = normalized.get("pools") if isinstance(normalized.get("pools"), dict) else {}
    deleting_free_pool = "free" not in normalized_pools

    if free_pool_locked and deleting_free_pool:
        next_source_policy = dict(effective_source_policy)
        next_source_policy["freePoolMode"] = "config_managed"
        next_source_policy["freePoolLocked"] = False
        normalized["sourcePolicy"] = next_source_policy
        applied_overrides.append("free_pool_authoritative_mode_disabled")
        local_warnings.append("Authoritative free-pool mode was disabled because the free pool was deleted.")
    elif free_pool_locked:
        current_pools = current_config.get("pools") if isinstance(current_config.get("pools"), dict) else {}
        locked_free_keys = list((current_pools.get("free") or {}).get("keys") or [])
        normalized_pools.setdefault("free", {"keys": []})
        normalized_pools["free"]["keys"] = locked_free_keys
        normalized["pools"] = normalized_pools
        applied_overrides.append("free_pool_locked_by_api_file")
        normalized["sourcePolicy"] = dict(effective_source_policy)
    normalized, _sync_changed, sync_warnings = _sync_authoritative_runtime_free_pool(normalized)
    normalized, vertex_free_changed, vertex_free_pool = _rewrite_free_plan_pool_for_vertex(normalized)
    if vertex_free_changed:
        applied_overrides.append(f"vertex_free_plan_pool:{vertex_free_pool}")
    single_pool_warnings: list[str] = []
    normalized, single_pool_changed, single_pool_warnings = _enforce_single_free_runtime_pool(normalized)
    if single_pool_changed:
        applied_overrides.append("single_pool_enforced:free")
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
    saved_public = _sanitize_runtime_pool_config_for_response(saved)
    return JSONResponse(
        {
            "ok": True,
            "reloaded": True,
            "engine": APP_NAME,
            "timestampMs": int(time.time() * 1000),
            "config": saved_public,
            "warnings": [*local_warnings, *list(sync_warnings), *list(single_pool_warnings)],
            "sourcePolicy": _sanitize_source_policy_for_response(dict(saved.get("sourcePolicy") or {})),
            "appliedOverrides": applied_overrides,
            "poolSummaries": {
                pool_name: _build_pool_summary(pool_name, saved)
                for pool_name in list_runtime_pool_names(saved)
            },
        }
    )


def admin_api_pools_reload(request: Request) -> JSONResponse:
    _require_runtime_admin(request)
    raise HTTPException(status_code=405, detail="Gemini pool management has been removed.")
    config, _ = _load_api_pool_config(force=True)
    key_pool = resolve_request_api_key_pool("", pool_hint=resolve_default_runtime_pool_hint(config))
    if key_pool:
        _RUNTIME_ALLOCATOR.ensure_keys(key_pool)
    payload = _admin_api_pools_payload()
    payload["reloaded"] = True
    return JSONResponse(payload)


@app.get("/v1/admin/api-pools/usage")
def admin_api_pools_usage(request: Request) -> JSONResponse:
    _require_runtime_admin(request)
    return JSONResponse(_admin_api_pools_usage_payload())


@app.post("/v1/generate-text")
def generate_text(payload: TextGenerateRequest) -> JSONResponse:
    user_prompt = str(payload.userPrompt or "").strip()
    if not user_prompt:
        raise HTTPException(status_code=400, detail="userPrompt is required.")

    system_prompt = str(payload.systemPrompt or "").strip()
    trace_id = _normalize_trace_id(payload.trace_id)
    source_policy = _runtime_source_policy()
    auth_mode = _normalize_runtime_auth_mode(None, source_policy=source_policy)
    primary_key_pool, fallback_request_key, effective_key_pool = _ensure_runtime_pool_or_raise(
        trace_id=trace_id,
        api_key="",
        pool_hint=None,
    )
    _ = primary_key_pool
    _ = fallback_request_key

    explicit_model_candidates, invalid_model_candidates = _resolve_explicit_model_candidates(
        raw_candidates=payload.modelCandidates,
        raw_model=payload.model,
        task="text",
    )
    if invalid_model_candidates:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_model_candidates",
                "task": "text",
                "invalid": invalid_model_candidates,
            },
        )

    model_candidates = explicit_model_candidates if explicit_model_candidates else resolve_text_model_candidates()
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

        effective_model_candidates = [
            model_id for model_id in model_candidates if model_id not in blocked_models
        ]
        if not effective_model_candidates:
            pool_exhausted = True
            break

        acquire = _RUNTIME_ALLOCATOR.acquire_for_models(
            model_candidates=effective_model_candidates,
            key_pool=effective_key_pool,
            requested_tokens=token_estimate,
            blocked_keys=blocked_keys,
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
            client = _build_genai_client(
                api_key=lease.key,
                timeout_ms=remaining_budget_ms,
                auth_mode=auth_mode,
                source_policy={**source_policy, "selectedVertexSlotId": str(lease.key or "").strip()},
            )
            response = client.models.generate_content(
                model=lease.model_id,
                contents=user_prompt,
                config=types.GenerateContentConfig(**config_payload),
            )
            text = extract_text_content(response)
            if not text:
                raise RuntimeError(f'{lease.model_id} returned empty text.')
            usage_metadata = extract_usage_metadata(response)
            usage_totals = _usage_metadata_totals(usage_metadata)
            provider_usage_reported = _provider_usage_reported(usage_metadata)
            used_tokens = int(usage_totals.get("totalTokens") or 0) if provider_usage_reported else token_estimate
            _RUNTIME_ALLOCATOR.release(lease, success=True, used_tokens=used_tokens)
            return JSONResponse(
                {
                    "ok": True,
                    "text": text,
                    "model": lease.model_id,
                    "keySelectionIndex": int(lease.key_index),
                    "trace_id": trace_id,
                    "usageMetadata": usage_metadata,
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
                used_tokens=0,
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
        "textModelCandidates": model_candidates,
    }
    _record_error_classification(error_code)
    status_code = 502
    if error_code in {
        ERROR_CODE_SLOT_SET_OVERLOADED,
        ERROR_CODE_SLOT_SET_TIMEOUT,
        ERROR_CODE_ALLOCATOR_ACQUIRE_TIMEOUT,
        ERROR_CODE_ALL_SLOTS_RATE_LIMITED,
    }:
        status_code = 503
    elif error_code == ERROR_CODE_UPSTREAM_REQUEST_TIMEOUT:
        status_code = 504
    raise HTTPException(status_code=status_code, detail=detail_payload)


@app.post("/v1/count-tokens")
def count_tokens(payload: CountTokensRequest) -> JSONResponse:
    contents = str(payload.contents or "").strip()
    if not contents:
        raise HTTPException(status_code=400, detail="contents is required.")
    task = str(payload.task or "text").strip().lower()
    if task not in {"text", "tts"}:
        task = "text"

    source_policy = _runtime_source_policy()
    auth_mode = _normalize_runtime_auth_mode(None, source_policy=source_policy)
    _, _, effective_key_pool = _ensure_runtime_pool_or_raise(
        trace_id="count_tokens",
        api_key=str(payload.apiKey or "").strip(),
        pool_hint=None,
    )
    if not effective_key_pool:
        raise HTTPException(status_code=503, detail="No Gemini slots available.")

    explicit_model_candidates, invalid_model_candidates = _resolve_explicit_model_candidates(
        raw_candidates=payload.modelCandidates,
        raw_model=payload.model,
        task=task,
    )
    if invalid_model_candidates:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_model_candidates",
                "task": "count_tokens",
                "invalid": invalid_model_candidates,
            },
        )

    if explicit_model_candidates:
        model_candidates = explicit_model_candidates
    elif task == "tts":
        model_candidates = resolve_tts_model_candidates(
            engine=TTS_ENGINE_DEFAULT,
            auth_mode=auth_mode,
            source_policy=source_policy,
        )
    else:
        model_candidates = resolve_text_model_candidates()
    if not model_candidates:
        raise HTTPException(status_code=500, detail="No model candidates available.")

    key = str(effective_key_pool[0] or "").strip()
    if not key:
        raise HTTPException(status_code=503, detail="No Gemini slots available.")
    model_id = str(model_candidates[0] or "").strip()

    try:
        client = _build_genai_client(
            api_key=key,
            timeout_ms=20_000,
            auth_mode=auth_mode,
            source_policy={**source_policy, "selectedVertexSlotId": key},
        )
        response = client.models.count_tokens(model=model_id, contents=contents)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Gemini countTokens failed: {exc}") from exc

    total_tokens = _usage_int_value(response, "total_tokens", "totalTokens", "totalTokenCount")
    if total_tokens <= 0:
        raise HTTPException(status_code=502, detail="Gemini countTokens returned no total tokens.")
    return JSONResponse(
        {
            "ok": True,
            "model": model_id,
            "totalTokens": total_tokens,
        }
    )


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
    usage_metadata = synthesis_result.get("usageMetadata")
    if isinstance(usage_metadata, dict) and usage_metadata:
        usage_header_payload = {
            **usage_metadata,
            "providerReported": True,
        }
        headers["X-VoiceFlow-Usage"] = quote(
            json.dumps(usage_header_payload, ensure_ascii=True, separators=(",", ":")),
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
            "firstKeySelectionIndex": synthesis_result.get("firstKeySelectionIndex"),
            "finalKeySelectionIndex": synthesis_result.get("finalKeySelectionIndex"),
            "keySelectionIndexes": synthesis_result.get("keySelectionIndexes"),
            "keyPoolSize": synthesis_result.get("keyPoolSize"),
            "windowCount": synthesis_result.get("windowCount"),
            "diagnostics": synthesis_result.get("diagnostics"),
            "usageMetadata": synthesis_result.get("usageMetadata"),
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
                    "firstKeySelectionIndex": synthesis_result.get("firstKeySelectionIndex"),
                    "finalKeySelectionIndex": synthesis_result.get("finalKeySelectionIndex"),
                    "keySelectionIndexes": synthesis_result.get("keySelectionIndexes"),
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
