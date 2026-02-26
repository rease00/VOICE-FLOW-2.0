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

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from segmentation import (
    MAX_WORDS_PER_REQUEST,
    count_words,
)

RUNTIME_ROOT = Path(__file__).resolve().parents[2]
if str(RUNTIME_ROOT) not in sys.path:
    sys.path.insert(0, str(RUNTIME_ROOT))

from shared.gemini_allocator import (
    GeminiRateAllocator,
    LaneLease,
    api_key_fingerprint,
    estimate_text_tokens,
    load_allocator_config,
    normalize_model_name,
    parse_api_keys as parse_api_keys_shared,
    is_valid_api_key as is_valid_api_key_shared,
)

try:
    from google import genai
    from google.genai import types
except Exception:
    genai = None
    types = None

APP_NAME = "gemini-runtime"
ALLOCATOR_CONFIG = load_allocator_config()
TTS_MODEL = os.getenv("GEMINI_TTS_MODEL", ALLOCATOR_CONFIG.routes["tts"][0]).strip()
if normalize_model_name(TTS_MODEL) not in ALLOCATOR_CONFIG.routes["tts"]:
    TTS_MODEL = ALLOCATOR_CONFIG.routes["tts"][0]
SERVER_API_KEY = (os.getenv("API_KEY") or os.getenv("GEMINI_API_KEY") or "").strip()
SERVER_API_KEYS_RAW = os.getenv("GEMINI_API_KEYS", "")
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
GEMINI_BATCH_MAX_ITEMS = max(1, int(os.getenv("GEMINI_BATCH_MAX_ITEMS", "64")))
GEMINI_BATCH_MAX_PARALLEL = max(1, int(os.getenv("GEMINI_BATCH_MAX_PARALLEL", "4")))
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
ERROR_CODE_KEY_POOL_TIMEOUT = "GEMINI_KEY_POOL_TIMEOUT"
ERROR_CODE_UPSTREAM_MODEL_FAILED = "GEMINI_UPSTREAM_MODEL_FAILED"
MAX_PUBLIC_SUMMARY_ITEMS = 3
MAX_PUBLIC_SUMMARY_CHARS = 220
DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
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
    apiKey: Optional[str] = ""
    speed: float = 1.0
    language: Optional[str] = None
    emotion: Optional[str] = None
    style: Optional[str] = None
    speaker: Optional[str] = None
    trace_id: Optional[str] = None


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


def _build_server_api_key_pool() -> list[str]:
    pool: list[str] = []
    seen = set()
    for candidate in [*parse_api_keys(SERVER_API_KEYS_RAW), SERVER_API_KEY]:
        token = str(candidate or "").strip()
        if not token or token in seen:
            continue
        if not _is_valid_gemini_api_key(token):
            continue
        seen.add(token)
        pool.append(token)
    return pool


def _resolve_request_key_plan(request_key: str) -> tuple[list[str], Optional[str]]:
    request_token = str(request_key or "").strip()
    primary_pool = list(_SERVER_API_KEY_POOL)
    fallback_request_key: Optional[str] = None
    if request_token and _is_valid_gemini_api_key(request_token) and request_token not in _SERVER_API_KEY_SET:
        fallback_request_key = request_token
    if not primary_pool and fallback_request_key:
        primary_pool = [fallback_request_key]
        fallback_request_key = None
    return primary_pool, fallback_request_key


def resolve_request_api_key_pool(request_key: str) -> list[str]:
    primary_pool, fallback_request_key = _resolve_request_key_plan(request_key)
    if fallback_request_key:
        return [*primary_pool, fallback_request_key]
    return primary_pool


_SERVER_API_KEY_POOL = tuple(_build_server_api_key_pool())
_SERVER_API_KEY_SET = frozenset(_SERVER_API_KEY_POOL)


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


def _classify_terminal_error_code(model_attempts: list[Dict[str, Any]], timed_out: bool) -> str:
    if timed_out:
        return ERROR_CODE_KEY_POOL_TIMEOUT
    if not model_attempts:
        return ERROR_CODE_UPSTREAM_MODEL_FAILED
    saw_auth = False
    saw_rate = False
    saw_non_rate_non_noise = False
    for attempt in model_attempts:
        detail = str(attempt.get("error") or "").strip()
        lowered = detail.lower()
        if _is_timeout_error(detail):
            return ERROR_CODE_KEY_POOL_TIMEOUT
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


def _remaining_timeout_ms(started_at_ms: int, total_timeout_ms: int) -> int:
    elapsed = max(0, int(time.time() * 1000) - started_at_ms)
    return max(0, int(total_timeout_ms) - elapsed)


def _resolve_tts_key_pool(api_key: Optional[str], trace_id: str) -> tuple[list[str], Optional[str], list[str]]:
    primary_key_pool, fallback_request_key = _resolve_request_key_plan(str(api_key or "").strip())
    effective_key_pool = list(primary_key_pool)
    if fallback_request_key:
        effective_key_pool.append(fallback_request_key)
    if not effective_key_pool:
        raise HTTPException(
            status_code=400,
            detail={
                "errorCode": ERROR_CODE_API_KEY_MISSING,
                "error": "Gemini API key is missing.",
                "summary": "Gemini key pool is empty. Configure GEMINI_API_KEYS or GEMINI_API_KEY.",
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
            break

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
    error_code = _classify_terminal_error_code(model_attempts=model_attempts, timed_out=timed_out)
    detail_payload = {
        "error": "Gemini model attempts failed.",
        "errorCode": error_code,
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
    text = _normalize_synthesis_text(payload.text)
    if not text:
        raise HTTPException(status_code=400, detail="Text is empty.")
    trace_id = _normalize_trace_id(payload.trace_id)
    target_voice = str(payload.voiceName or payload.voice_id or "Fenrir").strip() or "Fenrir"
    normalized_speaker_voices = _normalize_speaker_voices(payload.speaker_voices or [], target_voice=target_voice)
    use_windowed_multi = len(normalized_speaker_voices) > 2
    if use_windowed_multi:
        requested_speech_mode = "text-order-two-speaker-windows"
    elif len(normalized_speaker_voices) == 2:
        requested_speech_mode = "multi-speaker"
    else:
        requested_speech_mode = "single-speaker"

    primary_key_pool, fallback_request_key, effective_key_pool = _resolve_tts_key_pool(payload.apiKey, trace_id=trace_id)
    language_code = resolve_language_code(text, payload.language)
    speaker_hint = re.sub(r"\s+", " ", str(payload.speaker or "")).strip()
    word_count = count_words(text)
    if word_count > MAX_WORDS_PER_REQUEST:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "word_limit_exceeded",
                "maxWords": MAX_WORDS_PER_REQUEST,
                "actualWords": word_count,
            },
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
            },
        )
        return {
            "wavBytes": wav_bytes,
            "traceId": trace_id,
            "model": model_header,
            "speechModeUsed": speech_mode_used,
            "speechModes": speech_modes_used,
            "speechModeRequested": requested_speech_mode,
            "keySelectionIndex": key_selection_index,
            "keyPoolSize": len(effective_key_pool),
            "speakerHint": speaker_hint or None,
            "windowCount": len(windows),
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
        error_payload["trace_id"] = trace_id
        if "retryAfterMs" not in error_payload:
            key_states = error_payload.get("keyStates") if isinstance(error_payload.get("keyStates"), list) else []
            error_payload["retryAfterMs"] = _retry_after_from_key_states(key_states)
        _emit_stage_event(trace_id, "failed", "error", error_payload)
        raise HTTPException(status_code=502, detail=error_payload) from exc


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
            "batchDefaultParallelism": GEMINI_BATCH_MAX_PARALLEL,
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
                "batchMaxItems": GEMINI_BATCH_MAX_ITEMS,
                "batchDefaultParallelism": GEMINI_BATCH_MAX_PARALLEL,
                "batchMaxParallelism": GEMINI_BATCH_MAX_PARALLEL,
                "multiSpeakerMaxSpeakersPerCall": 2,
                "multiSpeakerBatchingMode": "text_order_two_speaker_windows",
            },
        }
    )


@app.get("/v1/admin/api-pool")
def admin_api_pool() -> JSONResponse:
    key_pool = resolve_request_api_key_pool("")
    snapshot = _RUNTIME_ALLOCATOR.snapshot(key_pool)
    payload = dict(snapshot)
    payload["ok"] = True
    payload["engine"] = APP_NAME
    payload["timestampMs"] = int(time.time() * 1000)
    return JSONResponse(payload)


@app.post("/v1/generate-text")
def generate_text(payload: TextGenerateRequest) -> JSONResponse:
    user_prompt = str(payload.userPrompt or "").strip()
    if not user_prompt:
        raise HTTPException(status_code=400, detail="userPrompt is required.")

    system_prompt = str(payload.systemPrompt or "").strip()
    trace_id = _normalize_trace_id(payload.trace_id)
    primary_key_pool, fallback_request_key = _resolve_request_key_plan(str(payload.apiKey or "").strip())
    effective_key_pool = list(primary_key_pool)
    if fallback_request_key:
        effective_key_pool.append(fallback_request_key)
    if not effective_key_pool:
        raise HTTPException(
            status_code=400,
            detail={
                "errorCode": ERROR_CODE_API_KEY_MISSING,
                "error": "Gemini API key is missing.",
                "summary": "Gemini key pool is empty. Configure GEMINI_API_KEYS or GEMINI_API_KEY.",
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
    error_code = _classify_terminal_error_code(model_attempts=model_attempts, timed_out=timed_out)
    detail_payload: Dict[str, Any] = {
        "error": "Gemini text generation failed.",
        "errorCode": error_code,
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
    raise HTTPException(status_code=502, detail=detail_payload)


@app.post("/synthesize")
def synthesize(payload: SynthesizeRequest) -> Response:
    synthesis_result = _synthesize_text_to_wav(payload)
    return Response(
        content=synthesis_result["wavBytes"],
        media_type="audio/wav",
        headers={
            "X-VoiceFlow-Trace-Id": str(synthesis_result.get("traceId") or ""),
            "X-VoiceFlow-Model": str(synthesis_result.get("model") or ""),
            "X-VoiceFlow-Speech-Mode": str(synthesis_result.get("speechModeUsed") or ""),
        },
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

    requested_parallelism = payload.parallelism if payload.parallelism is not None else GEMINI_BATCH_MAX_PARALLEL
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
