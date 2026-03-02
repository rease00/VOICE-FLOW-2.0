from __future__ import annotations

import base64
import csv
import gzip
import json
import hashlib
import mimetypes
import os
import calendar
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
import wave
from collections import defaultdict, deque
from io import BytesIO, StringIO
from pathlib import Path
from typing import Any, Optional, Dict, List
from urllib import error as urllib_error
from urllib.parse import urlparse
from urllib import request as urllib_request

import requests
from bs4 import BeautifulSoup
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel
try:
    from PIL import Image  # type: ignore
except Exception:
    Image = None  # type: ignore
try:
    from rapidocr_onnxruntime import RapidOCR  # type: ignore
except Exception:
    RapidOCR = None  # type: ignore
try:
    import firebase_admin  # type: ignore
    from firebase_admin import auth as firebase_auth  # type: ignore
    from firebase_admin import credentials as firebase_credentials  # type: ignore
    from firebase_admin import firestore as firebase_firestore  # type: ignore
except Exception:
    firebase_admin = None  # type: ignore
    firebase_auth = None  # type: ignore
    firebase_credentials = None  # type: ignore
    firebase_firestore = None  # type: ignore
try:
    import stripe  # type: ignore
except Exception:
    stripe = None  # type: ignore

APP_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = APP_ROOT
WORKSPACE_ROOT = APP_ROOT.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from shared.env_loader import load_backend_env_files
from shared.gemini_allocator import (
    GeminiRateAllocator,
    estimate_text_tokens,
    load_allocator_config,
    parse_api_keys as parse_api_keys_shared,
)
from shared.gemini_api_pools import (
    POOL_NAMES,
    duplicate_key_memberships,
    flatten_pool_keys,
    load_pool_config as load_pool_config_shared,
    normalize_pool_config as normalize_gemini_pool_config,
    plan_key_to_pool_hint,
    resolve_effective_keys as resolve_effective_pool_keys,
    save_pool_config as save_pool_config_shared,
    sync_authoritative_free_pool as sync_authoritative_free_pool_shared,
)
from shared.gemini_multi_speaker import normalize_multi_speaker_line_map as normalize_multi_speaker_line_map_shared
from services.admission.redis_limits import SuccessQuotaDecision, SuccessQuotaLimiter
from services.errors.codes import ENGINE_OVERLOADED, QUEUE_TIMEOUT, RATE_LIMIT_USER, extract_error_code
from services.queue.redis_queue import TtsJobQueue, normalize_lane

load_backend_env_files(Path(__file__).resolve())
ARTIFACTS_DIR = APP_ROOT / "artifacts"
RUNTIME_LOG_DIR = PROJECT_ROOT / ".runtime" / "logs"
MODELS_DIR = Path(os.getenv("VF_RVC_MODELS_DIR", str(APP_ROOT / "models" / "rvc"))).resolve()
BOOTSTRAP_SCRIPT = PROJECT_ROOT / "scripts" / "bootstrap-services.mjs"
WHISPER_MODEL_SIZE = os.getenv("VF_WHISPER_MODEL", "small")
WHISPER_DEVICE = os.getenv("VF_WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE = os.getenv("VF_WHISPER_COMPUTE", "int8")
WHISPER_BEAM_SIZE = max(1, int((os.getenv("VF_WHISPER_BEAM_SIZE") or "5").strip() or "5"))
RVC_DEVICE = os.getenv("VF_RVC_DEVICE", "cpu:0")
ENABLE_RVC_FALLBACK = (
    (os.getenv("VF_ENABLE_RVC_FALLBACK") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
RVC_FALLBACK_MODEL_ID = "vf_low_cpu_timbre"
LHQ_SVC_PILOT_ENABLED = (
    (os.getenv("VF_ENABLE_LHQ_SVC_PILOT") or "0").strip().lower()
    in {"1", "true", "yes", "on"}
)
LHQ_SVC_PILOT_MODEL_ID = "lhq_svc_pilot"
VOICE_CONVERSION_POLICIES = {"AUTO_RELIABLE", "LHQ_PILOT"}
VOICE_CONVERSION_FALLBACK_REASONS = {
    "lhq_missing_clone_parity",
    "lhq_unhealthy",
    "lhq_timeout",
    "lhq_quality_gate_failed",
}
SEPARATION_MODEL = (os.getenv("VF_SOURCE_SEPARATION_MODEL") or "htdemucs_ft").strip() or "htdemucs_ft"
SEPARATION_DEVICE = (os.getenv("VF_SOURCE_SEPARATION_DEVICE") or "cpu").strip() or "cpu"
SEPARATION_TIMEOUT_SEC = max(60, int((os.getenv("VF_SOURCE_SEPARATION_TIMEOUT_SEC") or "1200").strip() or "1200"))
SEPARATION_SAMPLE_RATE = max(16000, int((os.getenv("VF_SOURCE_SEPARATION_SAMPLE_RATE") or "44100").strip() or "44100"))
SEPARATION_CACHE_DIR = ARTIFACTS_DIR / "source-separation-cache"
TTS_LIVE_ARTIFACTS_DIR = ARTIFACTS_DIR / "tts-live"
ENABLE_SOURCE_SEPARATION = (
    (os.getenv("VF_ENABLE_SOURCE_SEPARATION") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
ENABLE_GOOGLE_ASR_FALLBACK = (
    (os.getenv("VF_ENABLE_GOOGLE_ASR_FALLBACK") or "").strip().lower()
    in {"1", "true", "yes", "on"}
)
ENABLE_TRANSCRIBE_EMOTION_CAPTURE = (
    (os.getenv("VF_TRANSCRIBE_EMOTION_CAPTURE") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
TRANSCRIBE_EMOTION_MAX_SEGMENTS = max(
    0,
    int((os.getenv("VF_TRANSCRIBE_EMOTION_MAX_SEGMENTS") or "140").strip() or "140"),
)
TRANSCRIBE_EMOTION_MIN_SECONDS = max(
    0.0,
    float((os.getenv("VF_TRANSCRIBE_EMOTION_MIN_SECONDS") or "0.45").strip() or "0.45"),
)
TTS_EMOTION_HELPER_URL = (os.getenv("VF_TTS_EMOTION_HELPER_URL") or "").strip()
TTS_EMOTION_HELPER_TIMEOUT_SEC = max(
    2.0,
    float((os.getenv("VF_TTS_EMOTION_HELPER_TIMEOUT_SEC") or "14").strip() or "14"),
)
GEMINI_RUNTIME_URL = (os.getenv("VF_GEMINI_RUNTIME_URL") or "http://127.0.0.1:7810").strip().rstrip("/")
KOKORO_RUNTIME_URL = (os.getenv("VF_KOKORO_RUNTIME_URL") or "http://127.0.0.1:7820").strip().rstrip("/")
RVC_RUNTIME_URL = (os.getenv("VF_RVC_RUNTIME_URL") or "http://127.0.0.1:7830").strip().rstrip("/")
VF_TTS_POST_RVC_ENABLED = (
    (os.getenv("VF_TTS_POST_RVC_ENABLED") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_TTS_POST_RVC_REQUIRED = (
    (os.getenv("VF_TTS_POST_RVC_REQUIRED") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_TTS_POST_RVC_TIMEOUT_SEC = max(
    15,
    int((os.getenv("VF_TTS_POST_RVC_TIMEOUT_SEC") or "180").strip() or "180"),
)
VF_TTS_POST_RVC_PRESET = str(os.getenv("VF_TTS_POST_RVC_PRESET") or "tts_realtime").strip() or "tts_realtime"
VF_TTS_LIVE_STREAM_ENABLED = (
    (os.getenv("VF_TTS_LIVE_STREAM_ENABLED") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_TTS_LIVE_CHUNK_LIMIT_DEFAULT = max(
    1,
    int((os.getenv("VF_TTS_LIVE_CHUNK_LIMIT_DEFAULT") or "2").strip() or "2"),
)
VF_TTS_LIVE_CHUNK_LIMIT_MAX = max(
    VF_TTS_LIVE_CHUNK_LIMIT_DEFAULT,
    int((os.getenv("VF_TTS_LIVE_CHUNK_LIMIT_MAX") or "8").strip() or "8"),
)
VF_TTS_LIVE_ARTIFACT_TTL_MS = max(
    60_000,
    int((os.getenv("VF_TTS_LIVE_ARTIFACT_TTL_MS") or "900000").strip() or "900000"),
)
VF_TTS_LIVE_CHUNK_CHARS_DEFAULT = max(
    120,
    int((os.getenv("VF_TTS_LIVE_CHUNK_CHARS_DEFAULT") or "420").strip() or "420"),
)
VF_TTS_LIVE_CHUNK_WORDS_DEFAULT = max(
    24,
    int((os.getenv("VF_TTS_LIVE_CHUNK_WORDS_DEFAULT") or "80").strip() or "80"),
)
VF_TTS_LIVE_CHUNK_CHARS_MAX = max(
    VF_TTS_LIVE_CHUNK_CHARS_DEFAULT,
    int((os.getenv("VF_TTS_LIVE_CHUNK_CHARS_MAX") or "2200").strip() or "2200"),
)
VF_TTS_LIVE_CHUNK_WORDS_MAX = max(
    VF_TTS_LIVE_CHUNK_WORDS_DEFAULT,
    int((os.getenv("VF_TTS_LIVE_CHUNK_WORDS_MAX") or "420").strip() or "420"),
)
VF_RVC_MODEL_CACHE_TTL_MS = max(
    500,
    int((os.getenv("VF_RVC_MODEL_CACHE_TTL_MS") or "5000").strip() or "5000"),
)
VOICE_PROFILE_BANK_FILE = Path(
    os.getenv("VF_VOICE_PROFILE_BANK_FILE", str(APP_ROOT / "config" / "voice_profile_bank.v1.json"))
).resolve()
VOICE_ID_MAP_FILE = Path(
    os.getenv("VF_VOICE_ID_MAP_FILE", str(APP_ROOT / "config" / "voice_id_map.v1.json"))
).resolve()
APP_BUILD_TIME = datetime.now(timezone.utc).isoformat()
API_VERSION = "1.2.0"
VF_AUTH_ENFORCE = (
    (os.getenv("VF_AUTH_ENFORCE") or "0").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_DEV_BYPASS_UID = (os.getenv("VF_DEV_BYPASS_UID") or "dev_local_user").strip() or "dev_local_user"
FIREBASE_SERVICE_ACCOUNT_JSON = (os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON") or "").strip()
STRIPE_SECRET_KEY = (os.getenv("STRIPE_SECRET_KEY") or "").strip()
STRIPE_WEBHOOK_SECRET = (os.getenv("STRIPE_WEBHOOK_SECRET") or "").strip()
STRIPE_PRICE_PRO_INR = (os.getenv("STRIPE_PRICE_PRO_INR") or "").strip()
STRIPE_PRICE_PLUS_INR = (os.getenv("STRIPE_PRICE_PLUS_INR") or "").strip()
STRIPE_PORTAL_RETURN_URL = (os.getenv("STRIPE_PORTAL_RETURN_URL") or "http://127.0.0.1:3000").strip()
STRIPE_CHECKOUT_SUCCESS_URL = (
    (os.getenv("STRIPE_CHECKOUT_SUCCESS_URL") or "http://127.0.0.1:3000?billing=success").strip()
)
STRIPE_CHECKOUT_CANCEL_URL = (
    (os.getenv("STRIPE_CHECKOUT_CANCEL_URL") or "http://127.0.0.1:3000?billing=cancel").strip()
)
VF_DAILY_GENERATION_LIMIT = max(1, int((os.getenv("VF_DAILY_GENERATION_LIMIT") or "30").strip() or "30"))
VF_ENGINE_RATES = {
    "GEM": 1,
    "KOKORO": 1,
}
VF_ENGINE_PLAN_RATES: dict[str, dict[str, int]] = {
    "KOKORO": {"free": 1, "pro": 1, "plus": 1},
    "GEM": {"free": 1, "pro": 1, "plus": 1},
}
PLAN_LIMITS: dict[str, dict[str, Any]] = {
    "free": {"plan": "Free", "monthlyVfLimit": 10000, "dailyGenerationLimit": VF_DAILY_GENERATION_LIMIT},
    "pro": {"plan": "Pro", "monthlyVfLimit": 200000, "dailyGenerationLimit": VF_DAILY_GENERATION_LIMIT},
    "plus": {"plan": "Plus", "monthlyVfLimit": 500000, "dailyGenerationLimit": VF_DAILY_GENERATION_LIMIT},
}
TTS_PLAN_GUARDRAILS: dict[str, dict[str, int]] = {
    "free": {"rpm": 2, "maxChars": 8000},
    "pro": {"rpm": 5, "maxChars": 10000},
    "plus": {"rpm": 10, "maxChars": 10000},
}
TTS_PLAN_BURST_WINDOW_SECONDS = 60
VF_TTS_SUCCESS_LIMIT_FREE = max(
    1,
    int((os.getenv("VF_TTS_SUCCESS_LIMIT_FREE") or str(TTS_PLAN_GUARDRAILS["free"]["rpm"])).strip() or "2"),
)
VF_TTS_SUCCESS_LIMIT_PRO = max(
    1,
    int((os.getenv("VF_TTS_SUCCESS_LIMIT_PRO") or str(TTS_PLAN_GUARDRAILS["pro"]["rpm"])).strip() or "5"),
)
VF_TTS_SUCCESS_LIMIT_PLUS = max(
    1,
    int((os.getenv("VF_TTS_SUCCESS_LIMIT_PLUS") or str(TTS_PLAN_GUARDRAILS["plus"]["rpm"])).strip() or "10"),
)
TTS_SUCCESS_PLAN_LIMITS: dict[str, int] = {
    "free": VF_TTS_SUCCESS_LIMIT_FREE,
    "pro": VF_TTS_SUCCESS_LIMIT_PRO,
    "plus": VF_TTS_SUCCESS_LIMIT_PLUS,
}
VF_TTS_SUCCESS_WINDOW_SECONDS = max(
    10,
    int((os.getenv("VF_TTS_SUCCESS_WINDOW_SECONDS") or str(TTS_PLAN_BURST_WINDOW_SECONDS)).strip() or str(TTS_PLAN_BURST_WINDOW_SECONDS)),
)
VF_TTS_SUCCESS_IDEMPOTENCY_TTL_SECONDS = max(
    60,
    int((os.getenv("VF_TTS_SUCCESS_IDEMPOTENCY_TTL_SECONDS") or "86400").strip() or "86400"),
)
VF_REDIS_URL = str(os.getenv("VF_REDIS_URL") or os.getenv("REDIS_URL") or "").strip()
VF_AD_REWARD_CLAIM_LIMIT_PER_DAY = max(1, int((os.getenv("VF_AD_REWARD_CLAIM_LIMIT_PER_DAY") or "3").strip() or "3"))
VF_AD_REWARD_VFF_AMOUNT = max(1, int((os.getenv("VF_AD_REWARD_VFF_AMOUNT") or "1000").strip() or "1000"))
VF_TOKEN_PACK_VF_AMOUNT = max(1, int((os.getenv("VF_TOKEN_PACK_VF_AMOUNT") or "100000").strip() or "100000"))
VF_TOKEN_PACK_BASE_INR = max(1, int((os.getenv("VF_TOKEN_PACK_BASE_INR") or "499").strip() or "499"))
VF_GENERATION_HISTORY_MAX_ITEMS = max(
    10,
    int((os.getenv("VF_GENERATION_HISTORY_MAX_ITEMS") or "200").strip() or "200"),
)
VF_GENERATION_HISTORY_RETENTION_DAYS = max(
    1,
    int((os.getenv("VF_GENERATION_HISTORY_RETENTION_DAYS") or "365").strip() or "365"),
)
VF_GENERATION_HISTORY_RETENTION_MS = VF_GENERATION_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000
VF_GENERATION_HISTORY_PREVIEW_CHARS = max(
    40,
    int((os.getenv("VF_GENERATION_HISTORY_PREVIEW_CHARS") or "220").strip() or "220"),
)
VF_GENERATION_HISTORY_CODEC = "gzip+base64+json"
GEMINI_API_KEYS_FILE = str(os.getenv("GEMINI_API_KEYS_FILE") or "").strip()
DEFAULT_GEMINI_API_KEYS_FILE = WORKSPACE_ROOT / "API.txt"
GEMINI_API_POOLS_FILE = str(
    os.getenv("GEMINI_API_POOLS_FILE") or (APP_ROOT / "config" / "gemini_api_pools.json")
).strip()
GEMINI_API_POOLS_PREFER_FIRESTORE = (
    (os.getenv("VF_GEMINI_API_POOLS_PREFER_FIRESTORE") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
GEMINI_ALLOCATOR_CONFIG = load_allocator_config()
BACKEND_GEMINI_ALLOCATOR_WAIT_TIMEOUT_MS = max(
    5000,
    int(
        (
            os.getenv("VF_BACKEND_GEMINI_ALLOCATOR_TIMEOUT_MS")
            or str(GEMINI_ALLOCATOR_CONFIG.default_wait_timeout_ms)
        ).strip()
        or str(GEMINI_ALLOCATOR_CONFIG.default_wait_timeout_ms)
    ),
)
BACKEND_GEMINI_ALLOCATOR = GeminiRateAllocator(
    GEMINI_ALLOCATOR_CONFIG,
    auth_disable_ms=max(60_000, int((os.getenv("VF_BACKEND_GEMINI_AUTH_DISABLE_MS") or "600000").strip() or "600000")),
    wait_slice_ms=max(100, int((os.getenv("VF_BACKEND_GEMINI_WAIT_SLICE_MS") or "500").strip() or "500")),
)
ENABLE_LOCAL_OCR = (
    (os.getenv("VF_ENABLE_LOCAL_OCR") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
_LOCAL_OCR_ENGINE: Any = None

LANGUAGE_CODE_ALIASES = {
    "auto": "auto",
    "original": "auto",
    "hindi": "hi",
    "hi-in": "hi",
    "english": "en",
    "en-us": "en",
    "en-gb": "en",
    "spanish": "es",
    "french": "fr",
    "german": "de",
    "portuguese": "pt",
    "arabic": "ar",
    "korean": "ko",
    "japanese": "ja",
    "chinese": "zh",
}

TRANSCRIBE_LANGUAGE_ALIASES = {
    "auto": None,
    "original": None,
    "chinese": "zh",
    "mandarin": "zh",
    "zh": "zh",
    "zh-cn": "zh",
    "zh-sg": "zh",
    "zh-tw": "zh",
    "zh-hk": "zh",
    "japanese": "ja",
    "japanis": "ja",
    "japan": "ja",
    "ja": "ja",
    "russian": "ru",
    "russia": "ru",
    "ru": "ru",
    "english": "en",
    "en": "en",
    "en-us": "en",
    "en-gb": "en",
    "hindi": "hi",
    "hi": "hi",
    "hi-in": "hi",
    "bengali": "bn",
    "bangla": "bn",
    "bn": "bn",
    "bn-bd": "bn",
    "es": "es",
    "es-es": "es",
    "spanish": "es",
    "fr": "fr",
    "fr-fr": "fr",
    "french": "fr",
    "de": "de",
    "de-de": "de",
    "german": "de",
    "pt": "pt",
    "pt-br": "pt",
    "portuguese": "pt",
    "ar": "ar",
    "ar-sa": "ar",
    "arabic": "ar",
    "ko": "ko",
    "ko-kr": "ko",
    "korean": "ko",
}
SUPPORTED_TRANSCRIBE_LANGUAGE_CODES = {"zh", "ja", "ru", "en", "hi", "bn", "es", "fr", "de", "pt", "ar", "ko"}
GOOGLE_ASR_LANGUAGE_HINTS = {
    "zh": "zh-CN",
    "ja": "ja-JP",
    "ru": "ru-RU",
    "en": "en-US",
    "hi": "hi-IN",
    "bn": "bn-BD",
    "es": "es-ES",
    "fr": "fr-FR",
    "de": "de-DE",
    "pt": "pt-BR",
    "ar": "ar-SA",
    "ko": "ko-KR",
}

DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
MODELS_DIR.mkdir(parents=True, exist_ok=True)
SEPARATION_CACHE_DIR.mkdir(parents=True, exist_ok=True)
TTS_LIVE_ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)


TTS_ENGINE_HEALTH_URLS = {
    "GEM": "http://127.0.0.1:7810/health",
    "KOKORO": "http://127.0.0.1:7820/health",
}
TTS_ENGINE_CAPABILITIES_URLS = {
    engine: health_url.rsplit("/health", 1)[0] + "/v1/capabilities"
    for engine, health_url in TTS_ENGINE_HEALTH_URLS.items()
}
DUBBING_PREPARE_ENGINE_WAIT_MS = {
    "GEM": max(5_000, int((os.getenv("VF_DUBBING_PREPARE_WAIT_GEM_MS") or "20000").strip() or "20000")),
    "KOKORO": max(5_000, int((os.getenv("VF_DUBBING_PREPARE_WAIT_KOKORO_MS") or "90000").strip() or "90000")),
}
DUBBING_PREPARE_POLL_INTERVAL_MS = max(
    250,
    int((os.getenv("VF_DUBBING_PREPARE_POLL_INTERVAL_MS") or "1200").strip() or "1200"),
)
TTS_ENGINE_ALIASES = {
    "GEM": "GEM",
    "GEMINI": "GEM",
    "KOKORO": "KOKORO",
}
ENGINE_DISPLAY_NAMES = {
    "GEM": "PRO",
    "KOKORO": "BASIC",
}
CONVERSION_POLICY_DISPLAY_NAMES = {
    "AUTO_RELIABLE": "AUTO_RELIABLE",
    "LHQ_PILOT": "LHQ_PILOT",
}
EXECUTED_ENGINE_DISPLAY_NAMES = {
    "LHQ_SVC": "LHQ-SVC (Pilot)",
    "GEM": "PRO",
    "KOKORO": "BASIC",
    "RVC_FALLBACK": "RVC Fallback",
    "RVC": "RVC",
}

RUNTIME_LOG_FILES = {
    "media-backend": RUNTIME_LOG_DIR / "media-backend.log",
    "gemini-runtime": RUNTIME_LOG_DIR / "gemini-runtime.log",
    "kokoro-runtime": RUNTIME_LOG_DIR / "kokoro-runtime.log",
}
RUNTIME_LOG_ALIASES = {
    "backend": "media-backend",
    "media": "media-backend",
    "media-backend": "media-backend",
    "gem": "gemini-runtime",
    "gemini": "gemini-runtime",
    "gemini-runtime": "gemini-runtime",
    "kokoro": "kokoro-runtime",
    "kokoro-runtime": "kokoro-runtime",
}
RUNTIME_LOG_MAX_BYTES = 262_144
RUNTIME_LOG_MAX_LINES = 400

VF_AI_OPS_CONCURRENCY_SOFT_LIMIT = max(
    2,
    int((os.getenv("VF_AI_OPS_CONCURRENCY_SOFT_LIMIT") or "24").strip() or "24"),
)
VF_AI_OPS_CONCURRENCY_HARD_LIMIT = max(
    VF_AI_OPS_CONCURRENCY_SOFT_LIMIT + 1,
    int(
        (
            os.getenv("VF_AI_OPS_CONCURRENCY_HARD_LIMIT")
            or str(max(32, VF_AI_OPS_CONCURRENCY_SOFT_LIMIT + 8))
        ).strip()
        or str(max(32, VF_AI_OPS_CONCURRENCY_SOFT_LIMIT + 8))
    ),
)
VF_AI_OPS_AUTOFIX_COOLDOWN_MS = max(
    30_000,
    int((os.getenv("VF_AI_OPS_AUTOFIX_COOLDOWN_MS") or "180000").strip() or "180000"),
)
VF_AI_OPS_MAX_RECENT_ERRORS = max(
    20,
    int((os.getenv("VF_AI_OPS_MAX_RECENT_ERRORS") or "120").strip() or "120"),
)
VF_AI_OPS_MAX_FRONTEND_ERRORS = max(
    10,
    int((os.getenv("VF_AI_OPS_MAX_FRONTEND_ERRORS") or "80").strip() or "80"),
)
VF_AI_OPS_MAX_ACTION_HISTORY = max(
    20,
    int((os.getenv("VF_AI_OPS_MAX_ACTION_HISTORY") or "200").strip() or "200"),
)
VF_AI_OPS_MAX_PENDING_APPROVALS = max(
    5,
    int((os.getenv("VF_AI_OPS_MAX_PENDING_APPROVALS") or "80").strip() or "80"),
)
_AI_OPS_VALID_MODES = {"observe", "enforce", "manual"}
VF_AI_OPS_MODE = (os.getenv("VF_AI_OPS_MODE") or "observe").strip().lower()
if VF_AI_OPS_MODE not in _AI_OPS_VALID_MODES:
    VF_AI_OPS_MODE = "observe"
VF_AI_OPS_ENABLE_AUTOFIX_MINOR = (
    (os.getenv("VF_AI_OPS_ENABLE_AUTOFIX_MINOR") or "0").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_TTS_GATEWAY_MAX_ACTIVE = max(
    1,
    int((os.getenv("VF_TTS_GATEWAY_MAX_ACTIVE") or "100").strip() or "100"),
)
VF_TTS_GATEWAY_QUEUE_MAX = max(
    1,
    int((os.getenv("VF_TTS_GATEWAY_QUEUE_MAX") or "300").strip() or "300"),
)
VF_TTS_GATEWAY_QUEUE_WAIT_TIMEOUT_MS = max(
    500,
    int((os.getenv("VF_TTS_GATEWAY_QUEUE_WAIT_TIMEOUT_MS") or "30000").strip() or "30000"),
)
VF_TTS_QUEUE_ENABLED = (
    (os.getenv("VF_TTS_QUEUE_ENABLED") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_TTS_QUEUE_SYNC_WAIT_MS = max(
    500,
    int((os.getenv("VF_TTS_QUEUE_SYNC_WAIT_MS") or "3000").strip() or "3000"),
)
VF_TTS_QUEUE_MAX_DEPTH = max(
    1,
    int((os.getenv("VF_TTS_QUEUE_MAX_DEPTH") or "5000").strip() or "5000"),
)
VF_TTS_QUEUE_JOB_TTL_MS = max(
    5_000,
    int((os.getenv("VF_TTS_QUEUE_JOB_TTL_MS") or "300000").strip() or "300000"),
)
VF_TTS_QUEUE_MAX_ATTEMPTS = max(
    1,
    int((os.getenv("VF_TTS_QUEUE_MAX_ATTEMPTS") or "4").strip() or "4"),
)
VF_TTS_QUEUE_BACKOFF_BASE_MS = max(
    100,
    int((os.getenv("VF_TTS_QUEUE_BACKOFF_BASE_MS") or "450").strip() or "450"),
)
VF_TTS_QUEUE_WORKER_COUNT = max(
    1,
    int((os.getenv("VF_TTS_QUEUE_WORKER_COUNT") or "4").strip() or "4"),
)
VF_TTS_ENGINE_CONCURRENCY_GEM = max(
    1,
    int((os.getenv("VF_TTS_ENGINE_CONCURRENCY_GEM") or "12").strip() or "12"),
)
VF_TTS_ENGINE_CONCURRENCY_KOKORO = max(
    1,
    int((os.getenv("VF_TTS_ENGINE_CONCURRENCY_KOKORO") or "8").strip() or "8"),
)
VF_TTS_QUEUE_METRICS_WINDOW = max(
    20,
    int((os.getenv("VF_TTS_QUEUE_METRICS_WINDOW") or "800").strip() or "800"),
)
VF_TTS_QUEUE_KEY_PREFIX = str(os.getenv("VF_TTS_QUEUE_KEY_PREFIX") or "vf:tts:jobs").strip() or "vf:tts:jobs"
VF_TTS_LANE_WEIGHTS = {
    "pro_plus": 10,
    "pro": 5,
    "free": 2,
}
VF_ADMIN_USAGE_RECENT_EVENT_CAP = max(
    1000,
    int((os.getenv("VF_ADMIN_USAGE_RECENT_EVENT_CAP") or "80000").strip() or "80000"),
)
VF_ADMIN_USAGE_TOTAL_SAMPLE_CAP = max(
    128,
    int((os.getenv("VF_ADMIN_USAGE_TOTAL_SAMPLE_CAP") or "2048").strip() or "2048"),
)
USAGE_WINDOW_24H_MS = 24 * 60 * 60 * 1000
USAGE_WINDOW_7D_MS = 7 * 24 * 60 * 60 * 1000
VF_ADMIN_APPROVAL_TOKEN = (os.getenv("VF_ADMIN_APPROVAL_TOKEN") or "").strip()
VF_ADMIN_APPROVER_UIDS = frozenset(
    {
        token
        for token in [item.strip() for item in (os.getenv("VF_ADMIN_APPROVER_UIDS") or "").split(",")]
        if token
    }
)


class _TtsGatewayLease:
    def __init__(self, controller: "TtsGatewayController", *, queued: bool, wait_ms: int, queue_depth: int) -> None:
        self._controller = controller
        self.queued = bool(queued)
        self.wait_ms = max(0, int(wait_ms))
        self.queue_depth = max(0, int(queue_depth))
        self._released = False

    def release(self) -> None:
        if self._released:
            return
        self._released = True
        self._controller.release()


class TtsGatewayController:
    def __init__(self, *, max_active: int, queue_max: int, queue_wait_timeout_ms: int) -> None:
        self.max_active = max(1, int(max_active))
        self.queue_max = max(1, int(queue_max))
        self.queue_wait_timeout_ms = max(500, int(queue_wait_timeout_ms))
        self._lock = threading.Lock()
        self._condition = threading.Condition(self._lock)
        self._active = 0
        self._waiting = 0
        self._stats = {
            "accepted": 0,
            "queuedAccepted": 0,
            "rejectedQueueFull": 0,
            "rejectedQueueTimeout": 0,
            "totalQueueWaitMs": 0,
            "peakActive": 0,
            "peakWaiting": 0,
            "updatedAtMs": 0,
        }

    def _retry_after_ms_locked(self) -> int:
        estimated_cycles = max(1, self._waiting + 1)
        cycle_ms = max(250, self.queue_wait_timeout_ms // max(1, self.max_active))
        return max(250, min(self.queue_wait_timeout_ms, estimated_cycles * cycle_ms))

    def acquire(self) -> tuple[Optional[_TtsGatewayLease], Optional[dict[str, Any]]]:
        started_ms = int(time.time() * 1000)
        with self._condition:
            if self._active < self.max_active:
                self._active += 1
                self._stats["accepted"] = int(self._stats.get("accepted", 0)) + 1
                self._stats["peakActive"] = max(int(self._stats.get("peakActive", 0)), self._active)
                self._stats["updatedAtMs"] = started_ms
                return _TtsGatewayLease(self, queued=False, wait_ms=0, queue_depth=self._waiting), None

            if self._waiting >= self.queue_max:
                self._stats["rejectedQueueFull"] = int(self._stats.get("rejectedQueueFull", 0)) + 1
                self._stats["updatedAtMs"] = started_ms
                detail = {
                    "error": "TTS gateway is overloaded.",
                    "reason": "queue_full",
                    "queueDepth": int(self._waiting),
                    "maxActive": int(self.max_active),
                    "queueMax": int(self.queue_max),
                    "retryAfterMs": self._retry_after_ms_locked(),
                }
                return None, detail

            self._waiting += 1
            self._stats["peakWaiting"] = max(int(self._stats.get("peakWaiting", 0)), self._waiting)
            deadline_ms = started_ms + self.queue_wait_timeout_ms

            while True:
                now_ms = int(time.time() * 1000)
                if self._active < self.max_active:
                    self._waiting = max(0, self._waiting - 1)
                    self._active += 1
                    wait_ms = max(0, now_ms - started_ms)
                    self._stats["accepted"] = int(self._stats.get("accepted", 0)) + 1
                    self._stats["queuedAccepted"] = int(self._stats.get("queuedAccepted", 0)) + 1
                    self._stats["totalQueueWaitMs"] = int(self._stats.get("totalQueueWaitMs", 0)) + wait_ms
                    self._stats["peakActive"] = max(int(self._stats.get("peakActive", 0)), self._active)
                    self._stats["updatedAtMs"] = now_ms
                    return _TtsGatewayLease(self, queued=True, wait_ms=wait_ms, queue_depth=self._waiting), None

                remaining_ms = deadline_ms - now_ms
                if remaining_ms <= 0:
                    self._waiting = max(0, self._waiting - 1)
                    self._stats["rejectedQueueTimeout"] = int(self._stats.get("rejectedQueueTimeout", 0)) + 1
                    self._stats["updatedAtMs"] = now_ms
                    detail = {
                        "error": "TTS gateway queue wait timed out.",
                        "reason": "queue_timeout",
                        "queueDepth": int(self._waiting),
                        "maxActive": int(self.max_active),
                        "queueMax": int(self.queue_max),
                        "waitTimeoutMs": int(self.queue_wait_timeout_ms),
                        "retryAfterMs": self._retry_after_ms_locked(),
                    }
                    return None, detail

                self._condition.wait(timeout=max(0.05, float(remaining_ms) / 1000.0))

    def release(self) -> None:
        with self._condition:
            self._active = max(0, self._active - 1)
            self._stats["updatedAtMs"] = int(time.time() * 1000)
            self._condition.notify(1)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            accepted = int(self._stats.get("accepted", 0))
            queued_accepted = int(self._stats.get("queuedAccepted", 0))
            avg_queue_wait = (
                round(float(self._stats.get("totalQueueWaitMs", 0)) / float(queued_accepted), 2)
                if queued_accepted > 0
                else 0.0
            )
            return {
                "config": {
                    "maxActive": int(self.max_active),
                    "queueMax": int(self.queue_max),
                    "queueWaitTimeoutMs": int(self.queue_wait_timeout_ms),
                },
                "state": {
                    "active": int(self._active),
                    "queueDepth": int(self._waiting),
                    "capacityUsedPct": round((float(self._active) / float(max(1, self.max_active))) * 100.0, 2),
                },
                "stats": {
                    "accepted": accepted,
                    "queuedAccepted": queued_accepted,
                    "rejectedQueueFull": int(self._stats.get("rejectedQueueFull", 0)),
                    "rejectedQueueTimeout": int(self._stats.get("rejectedQueueTimeout", 0)),
                    "avgQueueWaitMs": avg_queue_wait,
                    "peakActive": int(self._stats.get("peakActive", 0)),
                    "peakQueueDepth": int(self._stats.get("peakWaiting", 0)),
                    "updatedAtMs": int(self._stats.get("updatedAtMs", 0)),
                },
            }


def _engine_display_name(engine: str) -> str:
    key = str(engine or "").strip().upper()
    return ENGINE_DISPLAY_NAMES.get(key, key)


def _conversion_policy_display_name(policy: str) -> str:
    key = str(policy or "").strip().upper()
    return CONVERSION_POLICY_DISPLAY_NAMES.get(key, key)


def _executed_engine_display_name(engine_executed: str) -> str:
    key = str(engine_executed or "").strip().upper()
    return EXECUTED_ENGINE_DISPLAY_NAMES.get(key, key)

NOVEL_IDEA_ALLOWED_HOSTS = {
    "webnovel": ("webnovel.com",),
    "pocketnovel": ("pocketnovel.com",),
}
NOVEL_IDEA_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 VoiceFlow/1.0"
)


def _parse_cors_origins(env_var: str, default: list[str]) -> list[str]:
    raw = (os.getenv(env_var) or "").strip()
    if not raw:
        return default
    values = [item.strip() for item in raw.split(",") if item.strip()]
    return values or default


def _safe_upload_name(filename: Optional[str], fallback: str) -> str:
    if not filename:
        return fallback
    base = Path(filename).name.strip()
    if not base:
        return fallback
    safe = "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "_" for ch in base)
    safe = safe.lstrip(".")
    if not safe:
        return fallback
    return safe[:128]


_VOICE_PROFILE_BANK_CACHE: dict[str, Any] = {"mtime": 0.0, "payload": {}}
_VOICE_ID_MAP_CACHE: dict[str, Any] = {"mtime": 0.0, "payload": {}}
_RVC_MODEL_CACHE_LOCK = threading.Lock()
_RVC_MODEL_CACHE: dict[str, Any] = {
    "updatedAtMs": 0,
    "models": [],
    "fallbackAvailable": bool(ENABLE_RVC_FALLBACK),
}


def _read_json_file_cached(path: Path, cache: dict[str, Any]) -> dict[str, Any]:
    try:
        stat = path.stat()
    except Exception:
        cache["mtime"] = 0.0
        cache["payload"] = {}
        return {}
    mtime = float(stat.st_mtime)
    if cache.get("payload") and float(cache.get("mtime") or 0.0) == mtime:
        payload = cache.get("payload")
        return payload if isinstance(payload, dict) else {}
    try:
        # Accept UTF-8 BOM-prefixed JSON config files.
        parsed = json.loads(path.read_text(encoding="utf-8-sig"))
        if not isinstance(parsed, dict):
            parsed = {}
    except Exception:
        parsed = {}
    cache["mtime"] = mtime
    cache["payload"] = parsed
    return parsed


def _load_voice_profile_bank() -> dict[str, Any]:
    payload = _read_json_file_cached(VOICE_PROFILE_BANK_FILE, _VOICE_PROFILE_BANK_CACHE)
    profiles = payload.get("profiles")
    if not isinstance(profiles, list):
        profiles = []
    normalized_profiles: list[dict[str, Any]] = []
    for row in profiles:
        if not isinstance(row, dict):
            continue
        profile_id = str(row.get("profileId") or "").strip()
        if not profile_id:
            continue
        normalized_profiles.append(
            {
                **row,
                "profileId": profile_id,
                "displayName": str(row.get("displayName") or profile_id).strip() or profile_id,
                "country": str(row.get("country") or "Unknown").strip() or "Unknown",
                "gender": str(row.get("gender") or "Unknown").strip() or "Unknown",
                "ageGroup": str(row.get("ageGroup") or "Unknown").strip() or "Unknown",
                "styleTag": str(row.get("styleTag") or "").strip(),
                "rvcModelName": str(row.get("rvcModelName") or "").strip(),
            }
        )
    return {"version": payload.get("version") or "0", "profiles": normalized_profiles}


def _load_voice_id_map() -> dict[str, Any]:
    payload = _read_json_file_cached(VOICE_ID_MAP_FILE, _VOICE_ID_MAP_CACHE)
    engines = payload.get("engines") if isinstance(payload.get("engines"), dict) else {}
    normalized_engines: dict[str, dict[str, Any]] = {}
    for engine_key, raw_engine_payload in engines.items():
        normalized_engine = _normalize_engine_name(str(engine_key or "GEM"))
        source = raw_engine_payload if isinstance(raw_engine_payload, dict) else {}
        voice_to_profile_raw = source.get("voiceToProfile") if isinstance(source.get("voiceToProfile"), dict) else {}
        voice_to_profile: dict[str, str] = {}
        for raw_key, raw_value in voice_to_profile_raw.items():
            source_id = str(raw_key or "").strip()
            profile_id = str(raw_value or "").strip()
            if not source_id or not profile_id:
                continue
            voice_to_profile[source_id] = profile_id
            voice_to_profile[source_id.lower()] = profile_id
        runtime_voices = source.get("runtimeVoices")
        if not isinstance(runtime_voices, list):
            runtime_voices = []
        normalized_engines[normalized_engine] = {
            "voiceToProfile": voice_to_profile,
            "runtimeVoices": [item for item in runtime_voices if isinstance(item, dict)],
        }
    return {"version": payload.get("version") or "0", "engines": normalized_engines}


def _profile_index() -> dict[str, dict[str, Any]]:
    payload = _load_voice_profile_bank()
    index: dict[str, dict[str, Any]] = {}
    for profile in payload.get("profiles") or []:
        if not isinstance(profile, dict):
            continue
        profile_id = str(profile.get("profileId") or "").strip()
        if profile_id:
            index[profile_id] = profile
    return index


def _default_profile_reference_relpath(profile_id: str) -> str:
    safe_profile_id = re.sub(r"[^a-zA-Z0-9_\-\.]+", "_", str(profile_id or "").strip()).strip("._")
    if not safe_profile_id:
        return ""
    return f"assets/voice_profiles/reference/{safe_profile_id}.wav"


def _resolve_profile_reference_path(profile: dict[str, Any]) -> tuple[Optional[Path], str, bool]:
    profile_id = str(profile.get("profileId") or "").strip()
    raw_reference = str(profile.get("referencePath") or "").strip()

    candidates: list[tuple[Path, str]] = []
    if raw_reference:
        raw_path = Path(raw_reference)
        if raw_path.is_absolute():
            abs_path = raw_path
            try:
                rel_path = abs_path.resolve().relative_to(APP_ROOT).as_posix()
            except Exception:
                rel_path = abs_path.as_posix()
        else:
            rel_path = raw_reference.replace("\\", "/").lstrip("/")
            abs_path = APP_ROOT / rel_path
        candidates.append((abs_path, rel_path))

    default_rel_path = _default_profile_reference_relpath(profile_id)
    if default_rel_path:
        default_abs_path = APP_ROOT / default_rel_path
        if all(item[0] != default_abs_path for item in candidates):
            candidates.append((default_abs_path, default_rel_path))

    fallback: tuple[Optional[Path], str, bool] = (None, "", False)
    for abs_path, rel_path in candidates:
        resolved = abs_path.resolve()
        exists = resolved.exists() and resolved.is_file()
        if exists:
            return resolved, rel_path, True
        if fallback[0] is None:
            fallback = (resolved, rel_path, False)
    return fallback


def _profile_preview_url(profile_id: str) -> str:
    return f"/tts/voice-profiles/{profile_id}/reference"


def _decorate_profile_with_reference(profile: dict[str, Any]) -> dict[str, Any]:
    out = dict(profile)
    profile_id = str(profile.get("profileId") or "").strip()
    _, rel_path, exists = _resolve_profile_reference_path(profile)
    declared_downloaded = bool(profile.get("isDownloaded"))
    out["isDownloaded"] = bool(exists or declared_downloaded)
    out["referenceExists"] = bool(exists)
    if rel_path:
        out["referencePath"] = rel_path
    if profile_id and (rel_path or exists):
        out["previewUrl"] = _profile_preview_url(profile_id)
    return out


def _resolve_mapped_profile(
    engine: str,
    voice_id: str,
    *,
    voice_name: str = "",
) -> Optional[dict[str, Any]]:
    mapping = _load_voice_id_map()
    engines = mapping.get("engines") if isinstance(mapping.get("engines"), dict) else {}
    safe_engine = _normalize_engine_name(engine)
    engine_payload = engines.get(safe_engine) if isinstance(engines.get(safe_engine), dict) else {}
    voice_to_profile = engine_payload.get("voiceToProfile") if isinstance(engine_payload.get("voiceToProfile"), dict) else {}
    candidates = [
        str(voice_id or "").strip(),
        str(voice_name or "").strip(),
        str(voice_id or "").strip().lower(),
        str(voice_name or "").strip().lower(),
    ]
    profile_id = ""
    for candidate in candidates:
        if not candidate:
            continue
        mapped = str(voice_to_profile.get(candidate) or "").strip()
        if mapped:
            profile_id = mapped
            break
    if not profile_id:
        return None
    return _profile_index().get(profile_id)


def _resolve_mapped_model_name(engine: str, voice_id: str, *, voice_name: str = "") -> tuple[Optional[str], Optional[str]]:
    profile = _resolve_mapped_profile(engine, voice_id, voice_name=voice_name)
    if not isinstance(profile, dict):
        return None, None
    profile_id = str(profile.get("profileId") or "").strip() or None
    mapped_model_name = str(profile.get("rvcModelName") or "").strip() or profile_id or ""
    resolved_model_name = _resolve_rvc_model_name_for_runtime(mapped_model_name)
    if not resolved_model_name:
        return None, profile_id
    return resolved_model_name, profile_id


def _rvc_runtime_model_snapshot(*, force_refresh: bool = False) -> tuple[set[str], bool]:
    now_ms = int(time.time() * 1000)
    with _RVC_MODEL_CACHE_LOCK:
        updated_at_ms = int(_RVC_MODEL_CACHE.get("updatedAtMs") or 0)
        if (
            not force_refresh
            and updated_at_ms > 0
            and (now_ms - updated_at_ms) < VF_RVC_MODEL_CACHE_TTL_MS
        ):
            cached_models = _RVC_MODEL_CACHE.get("models")
            cached_fallback = bool(_RVC_MODEL_CACHE.get("fallbackAvailable"))
            model_set = {str(item).strip() for item in list(cached_models or []) if str(item).strip()}
            return model_set, cached_fallback

    fallback_available = bool(ENABLE_RVC_FALLBACK)
    models: list[str] = []
    try:
        payload = rvc_runtime.health_payload()
        nested = payload.get("rvc") if isinstance(payload.get("rvc"), dict) else {}
        if isinstance(nested, dict):
            fallback_available = bool(nested.get("fallbackAvailable")) or fallback_available
    except Exception:
        fallback_available = bool(ENABLE_RVC_FALLBACK)

    try:
        models = [str(item).strip() for item in rvc_runtime.list_models() if str(item).strip()]
    except Exception:
        models = []

    if fallback_available and RVC_FALLBACK_MODEL_ID not in models:
        models = [RVC_FALLBACK_MODEL_ID, *models]

    with _RVC_MODEL_CACHE_LOCK:
        _RVC_MODEL_CACHE["updatedAtMs"] = now_ms
        _RVC_MODEL_CACHE["models"] = list(models)
        _RVC_MODEL_CACHE["fallbackAvailable"] = bool(fallback_available)

    return set(models), bool(fallback_available)


def _resolve_rvc_model_name_for_runtime(mapped_model_name: str) -> str:
    desired = str(mapped_model_name or "").strip()
    available_models, fallback_available = _rvc_runtime_model_snapshot()
    if desired:
        if not available_models or desired in available_models:
            return desired
    if fallback_available:
        return RVC_FALLBACK_MODEL_ID
    return desired


def _apply_mapped_voice_fields(engine: str, voice_id: str, base: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    profile = _resolve_mapped_profile(engine, voice_id, voice_name=str(base.get("voice") or ""))
    if not isinstance(profile, dict):
        return out
    mapped_name = str(profile.get("displayName") or "").strip()
    if mapped_name:
        out["name"] = mapped_name
        out["mapped_name"] = mapped_name
    out["profile_id"] = str(profile.get("profileId") or "").strip()
    out["country"] = str(profile.get("country") or "Unknown").strip() or "Unknown"
    out["age_group"] = str(profile.get("ageGroup") or "Unknown").strip() or "Unknown"
    style_tag = str(profile.get("styleTag") or "").strip()
    if style_tag:
        out["style_tag"] = style_tag
    _, rel_path, exists = _resolve_profile_reference_path(profile)
    declared_downloaded = bool(profile.get("isDownloaded"))
    out["is_downloaded"] = bool(exists or declared_downloaded)
    out["reference_exists"] = bool(exists)
    if rel_path:
        out["reference_path"] = rel_path
    if out.get("profile_id"):
        out["preview_url"] = _profile_preview_url(str(out.get("profile_id")))
    return out


def _voice_mapping_catalog_payload() -> dict[str, Any]:
    profile_bank = _load_voice_profile_bank()
    mapping = _load_voice_id_map()
    profiles = profile_bank.get("profiles") or []
    decorated_profiles = [
        _decorate_profile_with_reference(profile)
        for profile in profiles
        if isinstance(profile, dict)
    ]
    return {
        "ok": True,
        "version": {
            "profileBank": profile_bank.get("version"),
            "voiceMap": mapping.get("version"),
        },
        "profiles": decorated_profiles,
        "engines": mapping.get("engines") or {},
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
    }


def _resolve_node_bin() -> str:
    explicit = (os.getenv("VF_NODE_BIN") or "").strip()
    if explicit:
        return explicit

    detected = shutil.which("node") or shutil.which("node.exe")
    if detected:
        return detected

    windows_fallback = Path("/mnt/c/Program Files/nodejs/node.exe")
    if windows_fallback.exists():
        return str(windows_fallback)

    return "node"


NODE_BIN = _resolve_node_bin()


def _cleanup_paths(*paths: str) -> None:
    for raw in paths:
        if not raw:
            continue
        try:
            path = Path(raw)
            if path.is_file():
                path.unlink(missing_ok=True)
            elif path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
        except Exception:
            # Non-fatal cleanup
            pass


def _run(cmd: list[str], *, timeout: Optional[int] = None) -> None:
    proc = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"Command failed: {' '.join(cmd)}")


def _get_ffmpeg_path() -> str:
    env_ffmpeg = os.getenv("VF_FFMPEG_PATH")
    if env_ffmpeg:
        return env_ffmpeg

    try:
        import imageio_ffmpeg  # type: ignore

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg:
            return ffmpeg

    raise RuntimeError(
        "FFmpeg binary not found. Install imageio-ffmpeg dependency or set VF_FFMPEG_PATH."
    )


def _convert_media_to_wav(
    input_path: str,
    output_path: str,
    *,
    sample_rate: int = 44100,
    channels: int = 1,
) -> None:
    ffmpeg = _get_ffmpeg_path()
    _run(
        [
            ffmpeg,
            "-y",
            "-i",
            input_path,
            "-vn",
            "-ac",
            str(max(1, int(channels))),
            "-ar",
            str(sample_rate),
            "-sample_fmt",
            "s16",
            output_path,
        ]
    )


def _build_atempo_filter_chain(rate: float) -> str:
    # FFmpeg atempo supports [0.5, 2.0], so split larger/smaller factors into valid chunks.
    safe_rate = max(0.25, min(4.0, float(rate)))
    chunks: list[str] = []
    while safe_rate > 2.0:
        chunks.append("atempo=2.0")
        safe_rate /= 2.0
    while safe_rate < 0.5:
        chunks.append("atempo=0.5")
        safe_rate /= 0.5
    chunks.append(f"atempo={safe_rate:.6f}")
    return ",".join(chunks)


def _convert_with_low_cpu_timbre(
    input_wav: str,
    output_wav: str,
    *,
    pitch_shift: int = 0,
    sample_rate: int = 40000,
) -> None:
    ffmpeg = _get_ffmpeg_path()
    shift = max(-12, min(12, int(pitch_shift)))
    pitch_factor = pow(2.0, shift / 12.0)
    tempo_rate = 1.0 / pitch_factor
    atempo = _build_atempo_filter_chain(tempo_rate)
    audio_filter = (
        f"asetrate={sample_rate * pitch_factor:.4f},"
        f"aresample={sample_rate},"
        f"{atempo},"
        "highpass=f=70,"
        "lowpass=f=12000,"
        "acompressor=threshold=-14dB:ratio=2.2:attack=8:release=120"
    )
    _run(
        [
            ffmpeg,
            "-y",
            "-i",
            input_wav,
            "-vn",
            "-af",
            audio_filter,
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "-sample_fmt",
            "s16",
            output_wav,
        ]
    )


def _convert_with_lhq_pilot_timbre(
    input_wav: str,
    output_wav: str,
    *,
    pitch_shift: int = 0,
    sample_rate: int = 40000,
) -> None:
    ffmpeg = _get_ffmpeg_path()
    shift = max(-12, min(12, int(pitch_shift)))
    pitch_factor = pow(2.0, shift / 12.0)
    tempo_rate = 1.0 / pitch_factor
    atempo = _build_atempo_filter_chain(tempo_rate)
    # LHQ pilot flavor: stronger presence + mild stereo-like widening illusion collapsed to mono.
    audio_filter = (
        f"asetrate={sample_rate * pitch_factor:.4f},"
        f"aresample={sample_rate},"
        f"{atempo},"
        "highpass=f=60,"
        "lowpass=f=14000,"
        "equalizer=f=1800:t=q:w=1.1:g=2.0,"
        "equalizer=f=5200:t=q:w=1.2:g=1.4,"
        "acompressor=threshold=-16dB:ratio=2.0:attack=8:release=130"
    )
    _run(
        [
            ffmpeg,
            "-y",
            "-i",
            input_wav,
            "-vn",
            "-af",
            audio_filter,
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "-sample_fmt",
            "s16",
            output_wav,
        ],
        timeout=60,
    )


def _normalize_transcribe_language(raw_language: str) -> Optional[str]:
    token = str(raw_language or "").strip().lower()
    if not token:
        return None
    token = token.replace("_", "-")

    direct = TRANSCRIBE_LANGUAGE_ALIASES.get(token)
    if direct in SUPPORTED_TRANSCRIBE_LANGUAGE_CODES:
        return direct
    if direct is None and token in TRANSCRIBE_LANGUAGE_ALIASES:
        return None

    collapsed = re.sub(r"[^a-z\-]", "", token)
    direct = TRANSCRIBE_LANGUAGE_ALIASES.get(collapsed)
    if direct in SUPPORTED_TRANSCRIBE_LANGUAGE_CODES:
        return direct
    if direct is None and collapsed in TRANSCRIBE_LANGUAGE_ALIASES:
        return None

    prefix = collapsed.split("-", 1)[0]
    if prefix in SUPPORTED_TRANSCRIBE_LANGUAGE_CODES:
        return prefix

    raise ValueError(
        "Unsupported transcription language. Use auto or one of: "
        "Chinese (zh), Japanese (ja), Russian (ru), English (en), Hindi (hi), Bengali (bn), "
        "Spanish (es), French (fr), German (de), Portuguese (pt), Arabic (ar), Korean (ko)."
    )


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1_048_576), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _resolve_stem_variant(raw_stem: str) -> str:
    token = str(raw_stem or "").strip().lower()
    if token in {"speech", "vocals", "vocal", "dialogue", "voice"}:
        return "speech"
    if token in {"background", "music", "bed", "instrumental", "accompaniment", "bg", "no_vocals"}:
        return "background"
    raise ValueError("Invalid stem. Use speech or background.")


def _format_mmss(seconds: float) -> str:
    total = max(0, int(seconds))
    minutes = total // 60
    remain = total % 60
    return f"{minutes:02d}:{remain:02d}"


def _wav_duration_seconds(path: str) -> float:
    with wave.open(path, "rb") as wav_file:
        frames = wav_file.getnframes()
        sample_rate = wav_file.getframerate()
        if sample_rate <= 0:
            return 0.0
        return float(frames) / float(sample_rate)


def _format_mmss_precise(seconds: float) -> str:
    value = max(0.0, float(seconds))
    minutes = int(value // 60.0)
    remain = value - (minutes * 60.0)
    return f"{minutes:02d}:{remain:05.2f}"


def _canonical_emotion_label(value: str) -> str:
    token = (value or "").strip().lower()
    if not token:
        return "Neutral"

    alias_map = {
        "concerned": "Empathetic",
        "amused": "Playful",
        "worried": "Anxious",
        "joy": "Happy",
        "surprise": "Surprised",
        "fear": "Fearful",
        "disgust": "Disgusted",
    }
    if token in alias_map:
        return alias_map[token]

    title_token = " ".join(part.capitalize() for part in re.split(r"[\s_\-]+", token) if part.strip())
    return title_token or "Neutral"


def _infer_emotion_from_text(text: str) -> str:
    value = (text or "").strip().lower()
    if not value:
        return "Neutral"

    if "!" in value and re.search(r"\b(no|stop|run|now|help|nah)\b", value):
        return "Shouting"
    if re.search(r"\b(cry|sob|tears|à¤°à¥‹|à¤°à¥‹à¤¨à¤¾|crying)\b", value):
        return "Crying"
    if re.search(r"\b(laugh|haha|lol|à¤¹à¤à¤¸|à¤¹à¤‚à¤¸|laughing)\b", value):
        return "Laughing"
    if re.search(r"\b(angry|furious|mad|gussa|à¤—à¥à¤¸à¥à¤¸à¤¾)\b", value):
        return "Angry"
    if re.search(r"\b(sad|hurt|broken|à¤¦à¥à¤–|à¤‰à¤¦à¤¾à¤¸)\b", value):
        return "Sad"
    if re.search(r"\b(worried|afraid|scared|à¤¡à¤°|à¤­à¤¯)\b", value):
        return "Anxious"
    if re.search(r"\b(whisper|slowly|à¤§à¥€à¤°à¥‡|à¤«à¥à¤¸à¤«à¥à¤¸)\b", value):
        return "Whispering"
    if re.search(r"\b(excited|awesome|great|à¤µà¤¾à¤¹|à¤•à¤®à¤¾à¤²)\b", value):
        return "Excited"
    if re.search(r"\b(please|kindly|thanks|thank you|à¤§à¤¨à¥à¤¯à¤µà¤¾à¤¦)\b", value):
        return "Calm"
    return "Neutral"


def _slice_audio_segment_to_wav(
    source_wav_path: str,
    target_wav_path: str,
    *,
    start: float,
    end: float,
    sample_rate: int = 16000,
) -> None:
    if end <= start:
        raise RuntimeError("Invalid segment bounds for slicing.")

    ffmpeg = _get_ffmpeg_path()
    _run(
        [
            ffmpeg,
            "-y",
            "-ss",
            f"{max(0.0, start):.3f}",
            "-to",
            f"{max(0.0, end):.3f}",
            "-i",
            source_wav_path,
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "-sample_fmt",
            "s16",
            target_wav_path,
        ]
    )


def _detect_emotion_from_segment_audio(
    segment_wav_path: str,
    *,
    language_hint: Optional[str],
    fallback_text: str = "",
) -> tuple[str, str, Optional[float]]:
    inferred = _infer_emotion_from_text(fallback_text)
    if not TTS_EMOTION_HELPER_URL:
        return inferred, "text-heuristic", None

    try:
        with open(segment_wav_path, "rb") as handle:
            response = requests.post(
                TTS_EMOTION_HELPER_URL,
                files={"file": ("segment.wav", handle, "audio/wav")},
                data={"language": language_hint or "auto"},
                timeout=TTS_EMOTION_HELPER_TIMEOUT_SEC,
            )
        if not response.ok:
            return inferred, "text-heuristic", None
        payload = response.json()
        emotion_raw = str(payload.get("emotion") or "").strip()
        confidence_value = payload.get("confidence")
        confidence = None
        if isinstance(confidence_value, (int, float)):
            confidence = max(0.0, min(1.0, float(confidence_value)))
        if emotion_raw:
            return _canonical_emotion_label(emotion_raw), "tts-emotion-helper", confidence
    except Exception:
        return inferred, "text-heuristic", None

    return inferred, "text-heuristic", None


def _is_video_file(path: Path) -> bool:
    return path.suffix.lower() in {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}


def _parse_timestamped_script(text: str) -> list[dict[str, Any]]:
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    segments: list[dict[str, Any]] = []
    timestamp_re = re.compile(r"^[\[\(]?(?P<start>\d{1,2}:\d{2}(?:\.\d{1,2})?)(?:\s*-\s*(?P<end>\d{1,2}:\d{2}(?:\.\d{1,2})?))?[\]\)]?\s*(?P<rest>.*)$")

    def to_seconds(token: str) -> float:
        parts = token.split(":")
        if len(parts) != 2:
            return 0.0
        minutes = float(parts[0])
        seconds = float(parts[1])
        return max(0.0, minutes * 60.0 + seconds)

    for line in lines:
        match = timestamp_re.match(line)
        if match:
            start = to_seconds(match.group("start") or "0:00")
            end = to_seconds(match.group("end") or "") if match.group("end") else None
            rest = match.group("rest") or ""
            segments.append(
                {
                    "start": start,
                    "end": end,
                    "text": rest.strip(),
                    "speaker": "Speaker",
                }
            )
        else:
            segments.append({"start": None, "end": None, "text": line, "speaker": "Speaker"})
    return segments


def _build_script_from_segments(segments: list[dict[str, Any]]) -> str:
    lines = []
    for seg in segments:
        start = float(seg.get("start") or 0.0)
        end = seg.get("end")
        label = _format_mmss_precise(start)
        if isinstance(end, (int, float)) and end > start:
            label = f"{label}-{_format_mmss_precise(float(end))}"
        emotion = seg.get("emotion")
        speaker = seg.get("speaker") or "Speaker"
        text = seg.get("text") or ""
        if emotion:
            lines.append(f"({label}) {speaker} ({emotion}): {text}")
        else:
            lines.append(f"({label}) {speaker}: {text}")
    return "\n".join(lines)


def _normalize_segment_bounds(segments: list[dict[str, Any]], fallback_duration: float = 2.0) -> None:
    for idx, seg in enumerate(segments):
        start = seg.get("start")
        end = seg.get("end")
        if start is None:
            continue
        if end is None or end <= start:
            next_start = None
            if idx + 1 < len(segments):
                next_start = segments[idx + 1].get("start")
            if isinstance(next_start, (int, float)) and next_start > start:
                seg["end"] = float(next_start)
            else:
                seg["end"] = float(start) + fallback_duration


def _transcribe_with_whisper(
    audio_path: Path,
    *,
    language: Optional[str],
    task: str,
    return_words: bool,
) -> dict[str, Any]:
    runtime = whisper_runtime.ensure_model()
    segments_out: list[dict[str, Any]] = []
    detected_language = None
    seg_iter, info = runtime.transcribe(
        str(audio_path),
        language=language,
        task=task,
        beam_size=WHISPER_BEAM_SIZE,
        word_timestamps=bool(return_words),
    )
    if info is not None:
        detected_language = getattr(info, "language", None)
    for segment in seg_iter:
        words_payload = []
        if return_words and getattr(segment, "words", None):
            for word in segment.words:
                words_payload.append(
                    {
                        "start": float(word.start),
                        "end": float(word.end),
                        "word": word.word,
                        "probability": getattr(word, "probability", None),
                    }
                )
        segments_out.append(
            {
                "start": float(segment.start),
                "end": float(segment.end),
                "text": segment.text.strip(),
                "words": words_payload,
                "speaker": "Speaker",
            }
        )
    return {"language": detected_language, "segments": segments_out}


def _load_audio_mono(path: Path, target_sr: int) -> tuple[Any, int]:
    try:
        import librosa  # type: ignore
        audio, sr = librosa.load(str(path), sr=target_sr, mono=True)
        return audio, sr
    except Exception:
        import soundfile as sf  # type: ignore
        audio, sr = sf.read(str(path))
        if audio is None:
            return [], target_sr
        if hasattr(audio, "ndim") and audio.ndim > 1:
            audio = audio.mean(axis=1)
        if sr != target_sr:
            try:
                import librosa  # type: ignore
                audio = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
                sr = target_sr
            except Exception:
                pass
        return audio, sr


def _write_wav(path: Path, audio: Any, sr: int) -> None:
    import soundfile as sf  # type: ignore

    sf.write(str(path), audio, sr, subtype="PCM_16")


def _time_stretch_to_duration(audio: Any, sr: int, target_sec: float) -> Any:
    if target_sec <= 0:
        return audio
    current = float(len(audio)) / float(sr) if sr > 0 else 0.0
    if current <= 0:
        return audio
    rate = current / target_sec
    if rate <= 0:
        return audio
    try:
        import librosa  # type: ignore

        return librosa.effects.time_stretch(audio, rate=rate)
    except Exception:
        return audio


def _extract_prosody_features(audio: Any, sr: int, hop_length: int = 256) -> dict[str, Any]:
    try:
        import librosa  # type: ignore
        rms = librosa.feature.rms(y=audio, hop_length=hop_length)[0]
    except Exception:
        rms = None

    try:
        import pyworld  # type: ignore

        f0, t = pyworld.dio(audio.astype("float64"), sr, frame_period=hop_length * 1000.0 / sr)
        f0 = pyworld.stonemask(audio.astype("float64"), f0, t, sr)
    except Exception:
        f0 = None
    return {"rms": rms, "f0": f0, "sr": sr, "hop_length": hop_length}


def _apply_energy_envelope(audio: Any, source_rms: Any) -> Any:
    if source_rms is None:
        return audio
    try:
        import numpy as np  # type: ignore
        import librosa  # type: ignore

        target_rms = librosa.feature.rms(y=audio, hop_length=256)[0]
        if target_rms is None or len(target_rms) == 0:
            return audio
        source = source_rms
        if len(source) != len(target_rms):
            source = np.interp(
                np.linspace(0, len(source) - 1, num=len(target_rms)),
                np.arange(len(source)),
                source,
            )
        gain = np.divide(source, target_rms + 1e-6)
        gain = np.clip(gain, 0.5, 2.5)
        envelope = np.repeat(gain, 256)
        if len(envelope) < len(audio):
            envelope = np.pad(envelope, (0, len(audio) - len(envelope)), mode="edge")
        return audio * envelope[: len(audio)]
    except Exception:
        return audio


def _apply_prosody_transfer(audio: Any, sr: int, source_f0: Any) -> Any:
    if source_f0 is None:
        return audio
    try:
        import numpy as np  # type: ignore
        import pyworld  # type: ignore

        f0_synth, t = pyworld.dio(audio.astype("float64"), sr, frame_period=10.0)
        f0_synth = pyworld.stonemask(audio.astype("float64"), f0_synth, t, sr)
        sp = pyworld.cheaptrick(audio.astype("float64"), f0_synth, t, sr)
        ap = pyworld.d4c(audio.astype("float64"), f0_synth, t, sr)
        src = source_f0
        if len(src) != len(f0_synth):
            src = np.interp(
                np.linspace(0, len(src) - 1, num=len(f0_synth)),
                np.arange(len(src)),
                src,
            )
        src = np.nan_to_num(src)
        synthesized = pyworld.synthesize(src.astype("float64"), sp, ap, sr)
        return synthesized.astype("float32")
    except Exception:
        return audio


def _phoneme_stress_profile(text: str) -> list[int]:
    try:
        from g2p_en import G2p  # type: ignore
    except Exception:
        return []
    g2p = G2p()
    phones = g2p(text)
    stress = []
    for phone in phones:
        digits = re.findall(r"\d", phone)
        if digits:
            stress.append(int(digits[-1]))
        else:
            stress.append(0)
    return stress


def _apply_stress_shaping(audio: Any, sr: int, stress: list[int]) -> Any:
    if not stress:
        return audio
    try:
        import numpy as np  # type: ignore
        segment_len = max(1, int(len(audio) / max(1, len(stress))))
        shaped = audio.copy()
        for idx, value in enumerate(stress):
            if value <= 0:
                continue
            start = idx * segment_len
            end = min(len(audio), start + segment_len)
            gain = 1.0 + min(0.15 * value, 0.4)
            shaped[start:end] *= gain
        return np.clip(shaped, -1.0, 1.0)
    except Exception:
        return audio


def _mix_audio_arrays(speech: Any, background: Optional[Any]) -> Any:
    if background is None:
        return speech
    try:
        import numpy as np  # type: ignore
        length = max(len(speech), len(background))
        speech_pad = np.pad(speech, (0, max(0, length - len(speech))))
        bg_pad = np.pad(background, (0, max(0, length - len(background))))
        mixed = speech_pad + bg_pad
        mixed = np.clip(mixed, -1.0, 1.0)
        return mixed
    except Exception:
        return speech


class RvcRuntime:
    def __init__(self) -> None:
        self.base_url = RVC_RUNTIME_URL
        self.import_error: Optional[str] = None
        self._current_model: Optional[str] = None
        self._health_payload: dict[str, Any] = {}

    def _request_json(self, method: str, path: str, *, payload: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        try:
            if method.upper() == "GET":
                response = requests.get(url, timeout=25)
            else:
                response = requests.post(url, json=payload or {}, timeout=30)
        except Exception as exc:  # noqa: BLE001
            self.import_error = f"rvc-runtime unreachable: {exc}"
            raise RuntimeError(self.import_error) from exc
        if not response.ok:
            detail = response.text[:220] if response.text else f"HTTP {response.status_code}"
            raise RuntimeError(f"rvc-runtime {path} failed: {detail}")
        try:
            parsed = response.json()
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"rvc-runtime {path} returned invalid JSON: {exc}") from exc
        return parsed if isinstance(parsed, dict) else {}

    def ensure_engine(self) -> Any:
        payload = self._request_json("GET", "/v1/health")
        self._health_payload = payload
        rvc_payload = payload.get("rvc") if isinstance(payload.get("rvc"), dict) else {}
        available = bool(rvc_payload.get("available"))
        self._current_model = str(rvc_payload.get("currentModel") or "").strip() or self._current_model
        if not available and not bool(rvc_payload.get("fallbackAvailable")):
            detail = str(rvc_payload.get("error") or payload.get("detail") or "rvc_runtime_unavailable")
            self.import_error = detail
            raise RuntimeError(detail)
        self.import_error = None
        return payload

    def list_models(self) -> list[str]:
        payload = self._request_json("GET", "/v1/models")
        models = payload.get("models") if isinstance(payload.get("models"), list) else []
        current_model = str(payload.get("currentModel") or "").strip()
        if current_model:
            self._current_model = current_model
        return [str(item).strip() for item in models if str(item).strip()]

    def load_model(self, model_name: str, version: str = "v2") -> None:
        payload = self._request_json(
            "POST",
            "/v1/load-model",
            payload={"modelName": model_name, "version": version},
        )
        current_model = str(payload.get("currentModel") or "").strip()
        if current_model:
            self._current_model = current_model

    def current_model(self) -> Optional[str]:
        return self._current_model

    def health_payload(self) -> dict[str, Any]:
        try:
            self.ensure_engine()
        except Exception:
            pass
        return dict(self._health_payload)

    def convert_file(self, input_wav: str, output_wav: str, **kwargs: Any) -> None:
        model_name = str(kwargs.get("model_name") or "").strip()
        if not model_name:
            raise RuntimeError("rvc_model_required")
        preset = _normalize_rvc_preset(str(kwargs.get("preset") or VF_TTS_POST_RVC_PRESET))
        with Path(input_wav).open("rb") as handle:
            response = requests.post(
                f"{self.base_url}/v1/convert",
                files={"file": ("input.wav", handle, "audio/wav")},
                data={
                    "model_name": model_name,
                    "preset": preset,
                    "pitch_shift": str(int(kwargs.get("pitch_shift") or 0)),
                    "index_rate": str(float(kwargs.get("index_rate") or 0.5)),
                    "filter_radius": str(int(kwargs.get("filter_radius") or 3)),
                    "rms_mix_rate": str(float(kwargs.get("rms_mix_rate") or 1.0)),
                    "protect": str(float(kwargs.get("protect") or 0.33)),
                    "f0_method": str(kwargs.get("f0_method") or "rmvpe"),
                },
                timeout=VF_TTS_POST_RVC_TIMEOUT_SEC,
            )
        if not response.ok:
            detail = response.text[:240] if response.text else f"HTTP {response.status_code}"
            raise RuntimeError(f"rvc-runtime /v1/convert failed: {detail}")
        Path(output_wav).write_bytes(bytes(response.content or b""))


class VoiceConversionAdapter:
    name = "base"
    supports_one_shot_clone = False
    supports_realtime = False
    recommended_use_cases: list[str] = []

    def health(self) -> tuple[bool, str]:
        return False, "adapter_not_implemented"

    def prepare_voice(self, profile: dict[str, Any]) -> dict[str, Any]:
        return profile

    def convert(self, input_wav: str, output_wav: str, **kwargs: Any) -> None:
        raise RuntimeError("convert_not_implemented")


class KokoroCloneAdapter(VoiceConversionAdapter):
    name = "KOKORO"
    supports_one_shot_clone = True
    supports_realtime = False
    recommended_use_cases = ["dubbing", "one_shot_clone"]

    def health(self) -> tuple[bool, str]:
        return _probe_runtime_health(TTS_ENGINE_HEALTH_URLS["KOKORO"], timeout_sec=2.5)


class RvcAdapter(VoiceConversionAdapter):
    name = "RVC"
    supports_one_shot_clone = False
    supports_realtime = True
    recommended_use_cases = ["covers", "voice_conversion"]

    def health(self) -> tuple[bool, str]:
        try:
            rvc_runtime.ensure_engine()
            return True, "rvc_ready"
        except Exception as exc:  # noqa: BLE001
            return False, str(exc)

    def convert(self, input_wav: str, output_wav: str, **kwargs: Any) -> None:
        rvc_runtime.convert_file(input_wav, output_wav, **kwargs)


class LhqSvcAdapter(VoiceConversionAdapter):
    name = "LHQ_SVC"
    supports_one_shot_clone = False
    supports_realtime = False
    recommended_use_cases = ["covers_pilot", "non_clone_conversion"]

    def health(self) -> tuple[bool, str]:
        if not LHQ_SVC_PILOT_ENABLED:
            return False, "lhq_pilot_disabled"
        return True, "lhq_pilot_ready"

    def convert(self, input_wav: str, output_wav: str, **kwargs: Any) -> None:
        if not LHQ_SVC_PILOT_ENABLED:
            raise RuntimeError("lhq_pilot_disabled")
        _convert_with_lhq_pilot_timbre(
            input_wav,
            output_wav,
            pitch_shift=int(kwargs.get("pitch_shift") or 0),
            sample_rate=int(kwargs.get("sample_rate") or 40000),
        )


class WhisperRuntime:
    def __init__(self) -> None:
        self.model: Any = None
        self.import_error: Optional[str] = None

    def ensure_model(self) -> Any:
        if self.model is not None:
            return self.model

        try:
            from faster_whisper import WhisperModel  # type: ignore
        except Exception as exc:
            self.import_error = f"faster-whisper import failed: {exc}"
            raise RuntimeError(self.import_error) from exc

        try:
            self.model = WhisperModel(
                WHISPER_MODEL_SIZE,
                device=WHISPER_DEVICE,
                compute_type=WHISPER_COMPUTE,
            )
        except Exception as exc:
            self.import_error = f"Whisper model init failed: {exc}"
            raise RuntimeError(self.import_error) from exc

        return self.model


class SourceSeparationRuntime:
    def __init__(self) -> None:
        self.import_error: Optional[str] = None
        self._checked = False
        self._available = False
        self._lock = threading.Lock()
        self._models: dict[str, Any] = {}

    def ensure_available(self) -> bool:
        if not ENABLE_SOURCE_SEPARATION:
            self._checked = True
            self._available = False
            self.import_error = "Source separation disabled (VF_ENABLE_SOURCE_SEPARATION=0)."
            return False

        with self._lock:
            if self._checked:
                return self._available
            try:
                import demucs  # type: ignore  # noqa: F401
                self._available = True
                self.import_error = None
            except Exception as exc:
                self._available = False
                self.import_error = f"demucs import failed: {exc}"
            self._checked = True
            return self._available

    @property
    def available(self) -> bool:
        if not self._checked:
            self.ensure_available()
        return self._available

    def get_model(self, model_name: str) -> Any:
        normalized = (model_name or "").strip() or SEPARATION_MODEL
        if not self.ensure_available():
            raise RuntimeError(self.import_error or "Demucs runtime unavailable.")

        with self._lock:
            cached = self._models.get(normalized)
            if cached is not None:
                return cached
            from demucs.pretrained import get_model  # type: ignore
            model = get_model(name=normalized, repo=None)
            model.cpu()
            model.eval()
            self._models[normalized] = model
            return model


rvc_runtime = RvcRuntime()
whisper_runtime = WhisperRuntime()
source_separation_runtime = SourceSeparationRuntime()
source_separation_lock = threading.Lock()
kokoro_clone_adapter = KokoroCloneAdapter()
rvc_adapter = RvcAdapter()
lhq_svc_adapter = LhqSvcAdapter()
app = FastAPI(title="VoiceFlow Media Backend", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins("VF_CORS_ORIGINS", DEFAULT_CORS_ORIGINS),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_FIREBASE_APP = None
_FIRESTORE_DB = None
_FIREBASE_INIT_ERROR: Optional[str] = None
_INMEMORY_ENTITLEMENTS: dict[str, dict[str, Any]] = {}
_INMEMORY_USAGE_MONTHLY: dict[str, dict[str, Any]] = {}
_INMEMORY_USAGE_DAILY: dict[str, dict[str, Any]] = {}
_INMEMORY_USAGE_EVENTS: dict[str, dict[str, Any]] = {}
_INMEMORY_STRIPE_CUSTOMERS: dict[str, str] = {}
_INMEMORY_WALLET_DAILY: dict[str, dict[str, Any]] = {}
_INMEMORY_WALLET_TRANSACTIONS: dict[str, dict[str, Any]] = {}
_INMEMORY_COUPONS: dict[str, dict[str, Any]] = {}
_INMEMORY_COUPON_REDEMPTIONS: dict[str, dict[str, Any]] = {}
_INMEMORY_GENERATION_HISTORY: dict[str, dict[str, Any]] = {}
_INMEMORY_DAILY_USAGE_RESET_STATUS: dict[str, Any] = {}
_INMEMORY_LOCK = threading.Lock()
_TTS_SUCCESS_LIMITER = SuccessQuotaLimiter(
    redis_url=VF_REDIS_URL,
    plan_limits=TTS_SUCCESS_PLAN_LIMITS,
    window_seconds=VF_TTS_SUCCESS_WINDOW_SECONDS,
    idempotency_ttl_seconds=VF_TTS_SUCCESS_IDEMPOTENCY_TTL_SECONDS,
)
_TTS_GATEWAY_CONTROLLER = TtsGatewayController(
    max_active=VF_TTS_GATEWAY_MAX_ACTIVE,
    queue_max=VF_TTS_GATEWAY_QUEUE_MAX,
    queue_wait_timeout_ms=VF_TTS_GATEWAY_QUEUE_WAIT_TIMEOUT_MS,
)
_TTS_JOB_QUEUE = TtsJobQueue(
    redis_url=VF_REDIS_URL,
    key_prefix=VF_TTS_QUEUE_KEY_PREFIX,
    lane_weights=VF_TTS_LANE_WEIGHTS,
)
_TTS_JOB_WORKER_LOCK = threading.Lock()
_TTS_JOB_WORKER_THREADS: list[threading.Thread] = []
_TTS_ENGINE_CONCURRENCY_LIMITS: dict[str, int] = {
    "GEM": int(VF_TTS_ENGINE_CONCURRENCY_GEM),
    "KOKORO": int(VF_TTS_ENGINE_CONCURRENCY_KOKORO),
}
_TTS_ENGINE_SEMAPHORES: dict[str, threading.Semaphore] = {
    engine: threading.Semaphore(max(1, int(limit)))
    for engine, limit in _TTS_ENGINE_CONCURRENCY_LIMITS.items()
}
_TTS_ENGINE_ACTIVE_COUNTS: dict[str, int] = {engine: 0 for engine in _TTS_ENGINE_CONCURRENCY_LIMITS}
_TTS_ENGINE_QUEUE_COUNTS: dict[str, dict[str, int]] = {
    engine: {"queued": 0, "running": 0}
    for engine in _TTS_ENGINE_CONCURRENCY_LIMITS
}
_TTS_ENGINE_RUNNING_JOB_IDS: dict[str, set[str]] = {
    engine: set()
    for engine in _TTS_ENGINE_CONCURRENCY_LIMITS
}
_TTS_ENGINE_QUEUED_JOB_IDS: dict[str, set[str]] = {
    engine: set()
    for engine in _TTS_ENGINE_CONCURRENCY_LIMITS
}
_TTS_ENGINE_ENQUEUED_AT_MS: dict[str, int] = {}
_TTS_ENGINE_METRICS_LOCK = threading.Lock()
_TTS_QUEUE_TELEMETRY: dict[str, Any] = {
    "enqueueToStartMs": deque(maxlen=VF_TTS_QUEUE_METRICS_WINDOW),
    "runtimeLatencyMs": deque(maxlen=VF_TTS_QUEUE_METRICS_WINDOW),
    "engineSemaphoreWaitMs": deque(maxlen=VF_TTS_QUEUE_METRICS_WINDOW),
    "liveFirstChunkLatencyMs": deque(maxlen=VF_TTS_QUEUE_METRICS_WINDOW),
    "liveChunkCount": deque(maxlen=VF_TTS_QUEUE_METRICS_WINDOW),
    "liveChunkRvcLatencyMs": deque(maxlen=VF_TTS_QUEUE_METRICS_WINDOW),
    "terminalEvents": deque(maxlen=VF_TTS_QUEUE_METRICS_WINDOW),
    "runtimeLatencyByEngine": {
        "GEM": deque(maxlen=VF_TTS_QUEUE_METRICS_WINDOW),
        "KOKORO": deque(maxlen=VF_TTS_QUEUE_METRICS_WINDOW),
    },
    "semaphoreWaitByEngine": {
        "GEM": deque(maxlen=VF_TTS_QUEUE_METRICS_WINDOW),
        "KOKORO": deque(maxlen=VF_TTS_QUEUE_METRICS_WINDOW),
    },
}
_GEMINI_POOLS_LOCK = threading.Lock()
_GEMINI_POOLS_CACHE: Optional[dict[str, Any]] = None
_GEMINI_POOLS_META: dict[str, Any] = {}
_ADMIN_USAGE_LOCK = threading.Lock()
_ADMIN_USAGE_RECENT_EVENTS: deque[dict[str, Any]] = deque()
_ADMIN_USAGE_TOTALS: dict[str, dict[str, Any]] = {}


def _init_firebase_clients() -> None:
    global _FIREBASE_APP, _FIRESTORE_DB, _FIREBASE_INIT_ERROR
    if firebase_admin is None or firebase_auth is None:
        _FIREBASE_INIT_ERROR = "firebase-admin dependency is unavailable."
        return
    if _FIREBASE_APP is not None:
        return
    try:
        if FIREBASE_SERVICE_ACCOUNT_JSON:
            cred_payload = json.loads(FIREBASE_SERVICE_ACCOUNT_JSON)
            cred = firebase_credentials.Certificate(cred_payload)
            _FIREBASE_APP = firebase_admin.initialize_app(cred)
        else:
            _FIREBASE_APP = firebase_admin.initialize_app()
        if firebase_firestore is not None:
            _FIRESTORE_DB = firebase_firestore.client()
        _FIREBASE_INIT_ERROR = None
    except Exception as exc:  # noqa: BLE001
        _FIREBASE_APP = None
        _FIRESTORE_DB = None
        _FIREBASE_INIT_ERROR = str(exc)


def _stripe_available() -> bool:
    return stripe is not None and bool(STRIPE_SECRET_KEY)


if _stripe_available():
    stripe.api_key = STRIPE_SECRET_KEY  # type: ignore[attr-defined]

_init_firebase_clients()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _usage_month_key(now: Optional[datetime] = None) -> str:
    dt = now or _utc_now()
    return dt.strftime("%Y%m")


def _usage_day_key(now: Optional[datetime] = None) -> str:
    dt = now or _utc_now()
    return dt.strftime("%Y%m%d")


def _usage_month_period_label(now: Optional[datetime] = None) -> str:
    dt = now or _utc_now()
    return dt.strftime("%Y-%m")


def _usage_day_period_label(now: Optional[datetime] = None) -> str:
    dt = now or _utc_now()
    return dt.strftime("%Y-%m-%d")


def _wallet_month_key(now: Optional[datetime] = None) -> str:
    dt = now or _utc_now()
    return dt.strftime("%Y-%m")


def _safe_now_iso(now: Optional[datetime] = None) -> str:
    return (now or _utc_now()).isoformat()


def _history_sanitize_item(item: dict[str, Any]) -> dict[str, Any]:
    safe = dict(item or {})
    payload: dict[str, Any] = {
        "id": str(safe.get("id") or uuid.uuid4().hex),
        "timestamp": _as_positive_int(safe.get("timestamp") or int(time.time() * 1000)),
        "status": str(safe.get("status") or "completed").strip().lower() or "completed",
        "engine": str(safe.get("engine") or "GEM").strip().upper() or "GEM",
        "voiceName": str(safe.get("voiceName") or safe.get("voice_name") or "").strip()[:120],
        "voiceId": str(safe.get("voiceId") or safe.get("voice_id") or "").strip()[:120],
        "chars": _as_positive_int(safe.get("chars")),
        "textPreview": str(safe.get("textPreview") or "").strip()[:VF_GENERATION_HISTORY_PREVIEW_CHARS],
        "requestId": str(safe.get("requestId") or safe.get("request_id") or "").strip()[:120],
        "traceId": str(safe.get("traceId") or safe.get("trace_id") or "").strip()[:120],
    }
    payload["text"] = payload["textPreview"]
    return payload


def _history_prune_expired_items(items: list[dict[str, Any]], now_ms: Optional[int] = None) -> list[dict[str, Any]]:
    safe_now_ms = _as_positive_int(now_ms or int(time.time() * 1000))
    cutoff_ms = max(0, safe_now_ms - VF_GENERATION_HISTORY_RETENTION_MS)
    safe_items: list[dict[str, Any]] = []
    for item in list(items or []):
        if not isinstance(item, dict):
            continue
        sanitized = _history_sanitize_item(item)
        timestamp_ms = _as_positive_int(sanitized.get("timestamp"))
        if timestamp_ms < cutoff_ms:
            continue
        safe_items.append(sanitized)
    safe_items.sort(key=lambda item: _as_positive_int(item.get("timestamp")), reverse=True)
    if len(safe_items) > VF_GENERATION_HISTORY_MAX_ITEMS:
        safe_items = safe_items[:VF_GENERATION_HISTORY_MAX_ITEMS]
    return safe_items


def _history_encode_items_gzip_b64(items: list[dict[str, Any]]) -> str:
    serialized = json.dumps(items, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    compressed = gzip.compress(serialized, compresslevel=9)
    return base64.b64encode(compressed).decode("ascii")


def _history_decode_items_gzip_b64(blob: str) -> list[dict[str, Any]]:
    token = str(blob or "").strip()
    if not token:
        return []
    try:
        compressed = base64.b64decode(token.encode("ascii"), validate=False)
        raw = gzip.decompress(compressed)
        parsed = json.loads(raw.decode("utf-8"))
        if not isinstance(parsed, list):
            return []
        out: list[dict[str, Any]] = []
        for item in parsed:
            if isinstance(item, dict):
                out.append(_history_sanitize_item(item))
        return out
    except Exception:
        return []


def _history_row_from_items(uid: str, items: list[dict[str, Any]], now_iso: Optional[str] = None) -> dict[str, Any]:
    normalized_uid = str(uid or "").strip()
    safe_items = _history_prune_expired_items(
        [item for item in list(items or []) if isinstance(item, dict)]
    )
    latest_at_ms = max([_as_positive_int(item.get("timestamp")) for item in safe_items], default=0)
    return {
        "uid": normalized_uid,
        "updatedAt": str(now_iso or _safe_now_iso()),
        "itemCount": len(safe_items),
        "latestAtMs": latest_at_ms,
        "codec": VF_GENERATION_HISTORY_CODEC,
        "itemsGzipB64": _history_encode_items_gzip_b64(safe_items),
    }


def _history_get_row(uid: str) -> dict[str, Any]:
    safe_uid = str(uid or "").strip()
    if not safe_uid:
        return {}
    collection = _firestore_collection("generation_history")
    if collection is None:
        with _INMEMORY_LOCK:
            return dict(_INMEMORY_GENERATION_HISTORY.get(safe_uid) or {})
    try:
        doc = collection.document(safe_uid).get()
    except Exception:
        return {}
    if not doc.exists:
        return {}
    payload = doc.to_dict() or {}
    payload["uid"] = safe_uid
    return payload


def _history_get_items(uid: str, limit: int = 30) -> list[dict[str, Any]]:
    safe_uid = str(uid or "").strip()
    safe_limit = max(1, min(200, int(limit)))
    row = _history_get_row(safe_uid)
    items = _history_decode_items_gzip_b64(str(row.get("itemsGzipB64") or ""))
    if not items:
        return []
    pruned_items = _history_prune_expired_items(items)
    if len(pruned_items) != len(items):
        _history_write_row(safe_uid, _history_row_from_items(safe_uid, pruned_items, now_iso=_safe_now_iso()))
    return pruned_items[:safe_limit]


def _history_write_row(uid: str, row: dict[str, Any]) -> None:
    safe_uid = str(uid or "").strip()
    if not safe_uid:
        return
    collection = _firestore_collection("generation_history")
    payload = dict(row or {})
    payload["uid"] = safe_uid
    if collection is None:
        with _INMEMORY_LOCK:
            _INMEMORY_GENERATION_HISTORY[safe_uid] = payload
        return
    try:
        collection.document(safe_uid).set(payload, merge=True)
    except Exception:
        with _INMEMORY_LOCK:
            _INMEMORY_GENERATION_HISTORY[safe_uid] = payload


def _history_append_item(uid: str, item: dict[str, Any]) -> None:
    safe_uid = str(uid or "").strip()
    if not safe_uid:
        return
    current = _history_get_items(safe_uid, limit=VF_GENERATION_HISTORY_MAX_ITEMS)
    next_items = _history_prune_expired_items([_history_sanitize_item(item), *current])
    row = _history_row_from_items(safe_uid, next_items, now_iso=_safe_now_iso())
    _history_write_row(safe_uid, row)


def _history_clear(uid: str) -> None:
    safe_uid = str(uid or "").strip()
    if not safe_uid:
        return
    collection = _firestore_collection("generation_history")
    if collection is None:
        with _INMEMORY_LOCK:
            _INMEMORY_GENERATION_HISTORY.pop(safe_uid, None)
        return
    try:
        collection.document(safe_uid).delete()
    except Exception:
        with _INMEMORY_LOCK:
            _INMEMORY_GENERATION_HISTORY.pop(safe_uid, None)


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    token = str(value or "").strip().lower()
    return token in {"1", "true", "yes", "on"}


def _default_entitlement(uid: str) -> dict[str, Any]:
    _ = uid
    defaults = PLAN_LIMITS["free"]
    return {
        "plan": defaults["plan"],
        "status": "free_active",
        "monthlyVfLimit": defaults["monthlyVfLimit"],
        "dailyGenerationLimit": defaults["dailyGenerationLimit"],
        "stripeCustomerId": None,
        "subscriptionId": None,
        "currencyMode": "INR_BASE_AUTO_FX",
        "billingCountry": None,
        "paidVfBalance": 0,
        "vffBalance": 0,
        "vffMonthKey": _wallet_month_key(),
        "updatedAt": _safe_now_iso(),
    }


def _normalize_plan_name(value: str) -> str:
    token = str(value or "").strip().lower()
    if token in {"pro", "plus", "free"}:
        return PLAN_LIMITS[token]["plan"]
    return PLAN_LIMITS["free"]["plan"]


def _plan_key_from_name(plan_name: str) -> str:
    token = str(plan_name or "").strip().lower()
    if token in {"free", "pro", "plus"}:
        return token
    return "free"


def _plan_config(plan_name: str) -> dict[str, Any]:
    return PLAN_LIMITS[_plan_key_from_name(plan_name)]


def _tts_guardrail_for_plan(plan_name: str) -> tuple[str, dict[str, int]]:
    plan_key = _plan_key_from_name(plan_name)
    guardrails = TTS_PLAN_GUARDRAILS.get(plan_key) or TTS_PLAN_GUARDRAILS["free"]
    return plan_key, {
        "rpm": _TTS_SUCCESS_LIMITER.quota_for_plan(plan_key),
        "maxChars": max(1, int(guardrails.get("maxChars") or 1)),
    }


def _success_rate_limit_headers(snapshot: Any) -> dict[str, str]:
    reset_at_ms = max(0, int(getattr(snapshot, "reset_at_ms", 0) or 0))
    reset_epoch_sec = max(0, reset_at_ms // 1000)
    return {
        "X-RateLimit-Success-Limit": str(max(1, int(getattr(snapshot, "limit", 1) or 1))),
        "X-RateLimit-Success-Remaining": str(max(0, int(getattr(snapshot, "remaining", 0) or 0))),
        "X-RateLimit-Success-Reset": str(reset_epoch_sec),
    }


def _enforce_tts_plan_guardrails(uid: str, text_chars: int, trace_id: str) -> tuple[str, str, dict[str, int]]:
    entitlement = _load_entitlement(uid)
    plan_name = _normalize_plan_name(str(entitlement.get("plan") or "Free"))
    plan_key, guardrails = _tts_guardrail_for_plan(plan_name)
    max_chars = max(1, int(guardrails.get("maxChars") or 1))
    actual_chars = max(0, int(text_chars))
    if actual_chars > max_chars:
        raise HTTPException(
            status_code=400,
            detail={
                "errorCode": "VF_TTS_TEXT_TOO_LONG",
                "reason": "plan_char_limit_exceeded",
                "plan": plan_name,
                "maxChars": max_chars,
                "actualChars": actual_chars,
                "trace_id": trace_id,
            },
        )
    return plan_name, plan_key, guardrails


def _precheck_tts_success_quota(uid: str, plan_name: str, plan_key: str, trace_id: str) -> dict[str, str]:
    snapshot = _TTS_SUCCESS_LIMITER.peek(uid, plan_key)
    if int(snapshot.remaining) <= 0:
        retry_after_ms = max(250, int(snapshot.reset_at_ms) - int(time.time() * 1000))
        detail = {
            "errorCode": RATE_LIMIT_USER,
            "reason": "plan_success_limit_exceeded",
            "plan": plan_name,
            "windowSeconds": int(snapshot.window_seconds),
            "limit": int(snapshot.limit),
            "used": int(snapshot.used),
            "retryAfterMs": retry_after_ms,
            "trace_id": trace_id,
        }
        headers = _success_rate_limit_headers(snapshot)
        headers["Retry-After"] = str(max(1, int((retry_after_ms + 999) // 1000)))
        raise HTTPException(status_code=429, detail=detail, headers=headers)
    return _success_rate_limit_headers(snapshot)


def _commit_tts_success_quota(
    uid: str,
    plan_name: str,
    plan_key: str,
    trace_id: str,
    *,
    request_fingerprint: str,
) -> SuccessQuotaDecision:
    decision = _TTS_SUCCESS_LIMITER.commit_success(uid, plan_key, request_fingerprint=request_fingerprint)
    if decision.allowed:
        return decision
    retry_after_ms = max(250, int(decision.snapshot.reset_at_ms) - int(time.time() * 1000))
    detail = {
        "errorCode": RATE_LIMIT_USER,
        "reason": "plan_success_limit_exceeded",
        "plan": plan_name,
        "windowSeconds": int(decision.snapshot.window_seconds),
        "limit": int(decision.snapshot.limit),
        "used": int(decision.snapshot.used),
        "retryAfterMs": retry_after_ms,
        "trace_id": trace_id,
    }
    headers = _success_rate_limit_headers(decision.snapshot)
    headers["Retry-After"] = str(max(1, int((retry_after_ms + 999) // 1000)))
    raise HTTPException(status_code=429, detail=detail, headers=headers)


def _engine_rate_for_plan(plan_name: str, engine: str) -> int:
    plan_key = _plan_key_from_name(plan_name)
    engine_key = str(engine or "").strip().upper()
    rates = VF_ENGINE_PLAN_RATES.get(engine_key) or {}
    if plan_key in rates:
        return _as_positive_int(rates[plan_key]) or 1
    return _as_positive_int(VF_ENGINE_RATES.get(engine_key)) or 1


def _round_inr(value: float) -> int:
    try:
        return max(1, int(round(float(value))))
    except Exception:
        return 1


def _billing_status_from_subscription(subscription_status: str) -> str:
    status = str(subscription_status or "").strip().lower()
    if status in {"active", "trialing"}:
        return "active"
    if status in {"past_due", "unpaid"}:
        return "past_due"
    if status in {"canceled", "incomplete_expired"}:
        return "cancelled"
    return status or "unknown"


def _firebase_ready() -> bool:
    return _FIREBASE_APP is not None and firebase_auth is not None


def _verify_firebase_id_token(id_token: str) -> dict[str, Any]:
    if not _firebase_ready():
        raise RuntimeError(_FIREBASE_INIT_ERROR or "Firebase is not configured.")
    assert firebase_auth is not None
    claims = firebase_auth.verify_id_token(id_token)  # type: ignore[no-any-return]
    if not isinstance(claims, dict):
        raise RuntimeError("Invalid auth claims.")
    return claims


def _inmemory_usage_month_doc_id(uid: str, now: Optional[datetime] = None) -> str:
    return f"{uid}_{_usage_month_key(now)}"


def _inmemory_usage_day_doc_id(uid: str, now: Optional[datetime] = None) -> str:
    return f"{uid}_{_usage_day_key(now)}"


def _month_window_bounds(now: Optional[datetime] = None) -> tuple[str, str]:
    dt = now or _utc_now()
    month_start = datetime(dt.year, dt.month, 1, tzinfo=timezone.utc)
    last_day = calendar.monthrange(dt.year, dt.month)[1]
    month_end = datetime(dt.year, dt.month, last_day, 23, 59, 59, tzinfo=timezone.utc)
    return month_start.isoformat(), month_end.isoformat()


def _day_window_bounds(now: Optional[datetime] = None) -> tuple[str, str]:
    dt = now or _utc_now()
    day_start = datetime(dt.year, dt.month, dt.day, 0, 0, 0, tzinfo=timezone.utc)
    day_end = datetime(dt.year, dt.month, dt.day, 23, 59, 59, tzinfo=timezone.utc)
    return day_start.isoformat(), day_end.isoformat()


def _as_positive_int(value: Any) -> int:
    try:
        number = int(value)
    except Exception:
        number = 0
    return max(0, number)


def _auth_exempt_path(path: str) -> bool:
    normalized = str(path or "").strip()
    if normalized in {
        "/health",
        "/system/version",
        "/billing/webhook",
        "/openapi.json",
        "/docs",
        "/docs/oauth2-redirect",
        "/redoc",
    }:
        return True
    return normalized.startswith("/docs")


@app.middleware("http")
async def _firebase_auth_middleware(request: Request, call_next: Any) -> Response:
    if not VF_AUTH_ENFORCE:
        return await call_next(request)

    if _auth_exempt_path(request.url.path):
        return await call_next(request)

    auth_header = str(request.headers.get("Authorization") or "").strip()
    if not auth_header.lower().startswith("bearer "):
        return JSONResponse(status_code=401, content={"detail": "Missing bearer token."})

    id_token = auth_header.split(" ", 1)[1].strip()
    if not id_token:
        return JSONResponse(status_code=401, content={"detail": "Missing bearer token."})

    try:
        claims = _verify_firebase_id_token(id_token)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=401, content={"detail": f"Invalid auth token: {exc}"})

    uid = str(claims.get("uid") or "")
    if not uid:
        return JSONResponse(status_code=401, content={"detail": "Auth token did not include uid."})

    request.state.uid = uid
    request.state.auth_claims = claims
    return await call_next(request)


@app.middleware("http")
async def _ai_ops_observer_middleware(request: Request, call_next: Any) -> Response:
    path = str(request.url.path or "/")
    method = str(request.method or "GET").upper()
    throttle_payload = _ai_ops_throttle_payload(path)
    if throttle_payload is not None:
        _ai_ops_record_rejected_request(path, throttle_payload)
        _admin_usage_record_http(path, method, status_code=503, elapsed_ms=0)
        return JSONResponse(status_code=503, content=throttle_payload)

    started_ms = int(time.time() * 1000)
    _ai_ops_request_started(path)
    status_code = 500
    error_detail = ""
    try:
        response = await call_next(request)
        status_code = int(getattr(response, "status_code", 200))
        return response
    except Exception as exc:  # noqa: BLE001
        error_detail = str(exc)
        status_code = 500
        raise
    finally:
        elapsed_ms = max(0, int(time.time() * 1000) - started_ms)
        _ai_ops_request_finished(path, status_code=status_code, elapsed_ms=elapsed_ms, error_detail=error_detail)
        _admin_usage_record_http(path, method, status_code=status_code, elapsed_ms=elapsed_ms)


def _require_request_uid(request: Request) -> str:
    uid = str(getattr(request.state, "uid", "") or "").strip()
    if uid:
        return uid
    if not VF_AUTH_ENFORCE:
        header_uid = str(request.headers.get("x-dev-uid") or "").strip()
        return header_uid or VF_DEV_BYPASS_UID
    raise HTTPException(status_code=401, detail="Authentication required.")


def _firestore_user_is_admin(uid: str) -> bool:
    safe_uid = str(uid or "").strip()
    if not safe_uid:
        return False
    users_collection = _firestore_collection("users")
    if users_collection is None:
        return False
    try:
        doc = users_collection.document(safe_uid).get()
    except Exception:
        return False
    if not doc.exists:
        return False
    payload = doc.to_dict() or {}
    if _as_bool(payload.get("isAdmin")) or _as_bool(payload.get("admin")):
        return True
    role = str(payload.get("role") or "").strip().lower()
    if role == "admin":
        return True
    roles = payload.get("roles")
    if isinstance(roles, list):
        for item in roles:
            if str(item or "").strip().lower() == "admin":
                return True
    return False


def _request_claim_is_admin(request: Request) -> bool:
    claims = getattr(request.state, "auth_claims", None)
    if not isinstance(claims, dict):
        return False
    return _as_bool(claims.get("admin"))


def _request_is_admin(request: Request, uid: Optional[str] = None) -> bool:
    safe_uid = str(uid or "").strip()
    if not safe_uid:
        safe_uid = str(getattr(request.state, "uid", "") or "").strip()
    if not safe_uid and not VF_AUTH_ENFORCE:
        header_uid = str(request.headers.get("x-dev-uid") or "").strip()
        safe_uid = header_uid or VF_DEV_BYPASS_UID
    if not safe_uid:
        return False
    if _request_claim_is_admin(request):
        return True
    if safe_uid in VF_ADMIN_APPROVER_UIDS:
        return True
    if not VF_AUTH_ENFORCE and safe_uid.startswith("local_admin"):
        return True
    if _firestore_user_is_admin(safe_uid):
        return True
    return False


def _require_admin_uid(request: Request) -> str:
    uid = _require_request_uid(request)
    if _request_is_admin(request, uid):
        return uid
    raise HTTPException(status_code=403, detail="Admin access required.")


def _firestore_collection(name: str) -> Any:
    if _FIRESTORE_DB is None:
        return None
    return _FIRESTORE_DB.collection(name)


def _normalize_entitlement_wallet(entitlement: dict[str, Any], now: Optional[datetime] = None) -> dict[str, Any]:
    current = now or _utc_now()
    month_key = _wallet_month_key(current)
    normalized = dict(entitlement or {})
    normalized["paidVfBalance"] = _as_positive_int(normalized.get("paidVfBalance"))
    saved_month = str(normalized.get("vffMonthKey") or "").strip()
    if saved_month != month_key:
        normalized["vffBalance"] = 0
        normalized["vffMonthKey"] = month_key
    else:
        normalized["vffBalance"] = _as_positive_int(normalized.get("vffBalance"))
        normalized["vffMonthKey"] = saved_month or month_key
    return normalized


def _monthly_free_remaining(entitlement: dict[str, Any], monthly: dict[str, Any]) -> int:
    monthly_limit = _as_positive_int(entitlement.get("monthlyVfLimit"))
    monthly_free_used = _as_positive_int(monthly.get("monthlyFreeVfUsed"))
    return max(0, monthly_limit - monthly_free_used)


def _wallet_spendable_now(entitlement: dict[str, Any], monthly: dict[str, Any], engine: str) -> int:
    safe_engine = str(engine or "").strip().upper()
    monthly_remaining = _monthly_free_remaining(entitlement, monthly)
    paid_balance = _as_positive_int(entitlement.get("paidVfBalance"))
    vff_balance = _as_positive_int(entitlement.get("vffBalance"))
    if safe_engine not in {"GEM", "KOKORO"}:
        return monthly_remaining + paid_balance
    return monthly_remaining + vff_balance + paid_balance


def _wallet_charge_breakdown(
    entitlement: dict[str, Any],
    monthly: dict[str, Any],
    engine: str,
    vf_cost: int,
) -> dict[str, int]:
    remaining = _as_positive_int(vf_cost)
    breakdown = {"vff": 0, "monthlyVf": 0, "paidVf": 0}
    if remaining <= 0:
        return breakdown
    monthly_remaining = _monthly_free_remaining(entitlement, monthly)
    paid_balance = _as_positive_int(entitlement.get("paidVfBalance"))
    vff_balance = _as_positive_int(entitlement.get("vffBalance"))

    def spend(bucket: str, available: int) -> None:
        nonlocal remaining
        if remaining <= 0:
            return
        use = min(max(0, available), remaining)
        if use <= 0:
            return
        breakdown[bucket] = use
        remaining -= use

    # Unified cross-engine spending order: monthly free -> VFF -> paid VF.
    spend("monthlyVf", monthly_remaining)
    spend("vff", vff_balance)
    spend("paidVf", paid_balance)
    return breakdown


def _wallet_daily_doc_id(uid: str, now: Optional[datetime] = None) -> str:
    return f"{uid}_{_usage_day_key(now)}"


def _ad_claims_today(uid: str, now: Optional[datetime] = None) -> int:
    current = now or _utc_now()
    doc_id = _wallet_daily_doc_id(uid, current)
    collection = _firestore_collection("wallet_daily")
    if collection is None:
        with _INMEMORY_LOCK:
            row = _INMEMORY_WALLET_DAILY.get(doc_id) or {}
            return _as_positive_int(row.get("adClaimCount"))
    doc = collection.document(doc_id).get()
    if not doc.exists:
        return 0
    payload = doc.to_dict() or {}
    return _as_positive_int(payload.get("adClaimCount"))


def _load_entitlement(uid: str) -> dict[str, Any]:
    defaults = _default_entitlement(uid)
    collection = _firestore_collection("entitlements")
    if collection is None:
        with _INMEMORY_LOCK:
            existing = _INMEMORY_ENTITLEMENTS.get(uid)
            if not existing:
                _INMEMORY_ENTITLEMENTS[uid] = {**defaults}
            current = _normalize_entitlement_wallet(_INMEMORY_ENTITLEMENTS[uid])
            _INMEMORY_ENTITLEMENTS[uid] = current
            return {**current}
    doc = collection.document(uid).get()
    if not doc.exists:
        collection.document(uid).set(defaults)
        return {**defaults}
    payload = doc.to_dict() or {}
    merged = {**defaults, **payload}
    plan_cfg = _plan_config(_normalize_plan_name(str(merged.get("plan") or "Free")))
    merged["plan"] = plan_cfg["plan"]
    merged["monthlyVfLimit"] = _as_positive_int(merged.get("monthlyVfLimit") or plan_cfg["monthlyVfLimit"])
    if merged["monthlyVfLimit"] <= 0:
        merged["monthlyVfLimit"] = plan_cfg["monthlyVfLimit"]
    merged["dailyGenerationLimit"] = _as_positive_int(
        merged.get("dailyGenerationLimit") or plan_cfg["dailyGenerationLimit"]
    ) or plan_cfg["dailyGenerationLimit"]
    merged = _normalize_entitlement_wallet(merged)
    return merged


def _write_entitlement(uid: str, payload: dict[str, Any]) -> None:
    patch = {**payload, "updatedAt": _safe_now_iso()}
    if "monthlyVfLimit" in patch:
        patch["monthlyVfLimit"] = _as_positive_int(patch.get("monthlyVfLimit"))
    if "dailyGenerationLimit" in patch:
        patch["dailyGenerationLimit"] = _as_positive_int(patch.get("dailyGenerationLimit"))
    if "paidVfBalance" in patch:
        patch["paidVfBalance"] = _as_positive_int(patch.get("paidVfBalance"))
    if "vffBalance" in patch:
        patch["vffBalance"] = _as_positive_int(patch.get("vffBalance"))
    if "vffMonthKey" in patch:
        patch["vffMonthKey"] = str(patch.get("vffMonthKey") or _wallet_month_key()).strip() or _wallet_month_key()

    collection = _firestore_collection("entitlements")
    if collection is None:
        with _INMEMORY_LOCK:
            current = _normalize_entitlement_wallet(_INMEMORY_ENTITLEMENTS.get(uid) or _default_entitlement(uid))
            current.update(patch)
            _INMEMORY_ENTITLEMENTS[uid] = _normalize_entitlement_wallet(current)
        return
    collection.document(uid).set(patch, merge=True)


def _link_customer_uid(customer_id: str, uid: str) -> None:
    safe_customer = str(customer_id or "").strip()
    safe_uid = str(uid or "").strip()
    if not safe_customer or not safe_uid:
        return
    collection = _firestore_collection("stripe_customers")
    if collection is None:
        with _INMEMORY_LOCK:
            _INMEMORY_STRIPE_CUSTOMERS[safe_customer] = safe_uid
        return
    collection.document(safe_customer).set({"uid": safe_uid, "updatedAt": _utc_now().isoformat()}, merge=True)


def _resolve_uid_from_customer(customer_id: str) -> str:
    safe_customer = str(customer_id or "").strip()
    if not safe_customer:
        return ""
    collection = _firestore_collection("stripe_customers")
    if collection is None:
        with _INMEMORY_LOCK:
            return str(_INMEMORY_STRIPE_CUSTOMERS.get(safe_customer) or "")
    doc = collection.document(safe_customer).get()
    if not doc.exists:
        return ""
    payload = doc.to_dict() or {}
    return str(payload.get("uid") or "")


def _usage_defaults(uid: str, now: Optional[datetime] = None) -> tuple[dict[str, Any], dict[str, Any]]:
    current = now or _utc_now()
    monthly = {
        "uid": uid,
        "periodKey": _usage_month_period_label(current),
        "vfUsed": 0,
        "monthlyFreeVfUsed": 0,
        "generationCount": 0,
        "byEngine": {
            "GEM": {"chars": 0, "vf": 0},
            "KOKORO": {"chars": 0, "vf": 0},
        },
        "updatedAt": current.isoformat(),
    }
    daily = {
        "uid": uid,
        "periodKey": _usage_day_period_label(current),
        "vfUsed": 0,
        "generationCount": 0,
        "byEngine": {
            "GEM": {"chars": 0, "vf": 0},
            "KOKORO": {"chars": 0, "vf": 0},
        },
        "updatedAt": current.isoformat(),
    }
    return monthly, daily


def _load_usage_windows(uid: str, now: Optional[datetime] = None) -> tuple[dict[str, Any], dict[str, Any]]:
    current = now or _utc_now()
    monthly_doc_id = _inmemory_usage_month_doc_id(uid, current)
    daily_doc_id = _inmemory_usage_day_doc_id(uid, current)
    default_monthly, default_daily = _usage_defaults(uid, current)

    monthly_collection = _firestore_collection("usage_monthly")
    daily_collection = _firestore_collection("usage_daily")
    if monthly_collection is None or daily_collection is None:
        with _INMEMORY_LOCK:
            monthly = _INMEMORY_USAGE_MONTHLY.get(monthly_doc_id) or {**default_monthly}
            daily = _INMEMORY_USAGE_DAILY.get(daily_doc_id) or {**default_daily}
            _INMEMORY_USAGE_MONTHLY[monthly_doc_id] = monthly
            _INMEMORY_USAGE_DAILY[daily_doc_id] = daily
            return {**monthly}, {**daily}

    monthly_ref = monthly_collection.document(monthly_doc_id)
    daily_ref = daily_collection.document(daily_doc_id)
    monthly_doc = monthly_ref.get()
    daily_doc = daily_ref.get()
    if not monthly_doc.exists:
        monthly_ref.set(default_monthly)
    if not daily_doc.exists:
        daily_ref.set(default_daily)
    monthly = monthly_doc.to_dict() if monthly_doc.exists else default_monthly
    daily = daily_doc.to_dict() if daily_doc.exists else default_daily
    return {**default_monthly, **(monthly or {})}, {**default_daily, **(daily or {})}


def _reserve_usage(
    uid: str,
    request_id: str,
    engine: str,
    char_count: int,
    bypass_limits: bool = False,
    bypass_reason: str = "",
) -> dict[str, Any]:
    safe_engine = str(engine or "").strip().upper()
    if safe_engine not in VF_ENGINE_RATES:
        safe_engine = "GEM"
    safe_chars = _as_positive_int(char_count)
    now = _utc_now()
    monthly_doc_id = _inmemory_usage_month_doc_id(uid, now)
    daily_doc_id = _inmemory_usage_day_doc_id(uid, now)
    event_doc_id = f"{uid}_{request_id}"

    if _firestore_collection("usage_events") is None:
        with _INMEMORY_LOCK:
            entitlement = _normalize_entitlement_wallet(_INMEMORY_ENTITLEMENTS.get(uid) or _default_entitlement(uid), now)
            _INMEMORY_ENTITLEMENTS[uid] = entitlement
            monthly = _INMEMORY_USAGE_MONTHLY.get(monthly_doc_id) or _usage_defaults(uid, now)[0]
            daily = _INMEMORY_USAGE_DAILY.get(daily_doc_id) or _usage_defaults(uid, now)[1]
            event = _INMEMORY_USAGE_EVENTS.get(event_doc_id)
            if event and str(event.get("status")) in {"reserved", "committed"}:
                return {"ok": True, "alreadyReserved": True, "event": event, "monthly": monthly, "daily": daily, "entitlement": entitlement}

            monthly.setdefault("monthlyFreeVfUsed", _as_positive_int(monthly.get("monthlyFreeVfUsed")))

            plan_cfg = _plan_config(_normalize_plan_name(str(entitlement.get("plan") or "Free")))
            daily_limit = _as_positive_int(entitlement.get("dailyGenerationLimit") or plan_cfg["dailyGenerationLimit"])
            rate = _engine_rate_for_plan(str(entitlement.get("plan") or "Free"), safe_engine)
            vf_cost = safe_chars * rate

            if not bypass_limits and _as_positive_int(daily.get("generationCount")) + 1 > daily_limit:
                raise HTTPException(status_code=429, detail="Daily generation limit reached.")

            charge_breakdown = _wallet_charge_breakdown(entitlement, monthly, safe_engine, vf_cost)
            covered = (
                _as_positive_int(charge_breakdown.get("vff"))
                + _as_positive_int(charge_breakdown.get("monthlyVf"))
                + _as_positive_int(charge_breakdown.get("paidVf"))
            )
            if not bypass_limits and covered < vf_cost:
                raise HTTPException(status_code=429, detail="Insufficient VF balance for this generation.")

            entitlement["vffBalance"] = max(0, _as_positive_int(entitlement.get("vffBalance")) - _as_positive_int(charge_breakdown.get("vff")))
            entitlement["paidVfBalance"] = max(0, _as_positive_int(entitlement.get("paidVfBalance")) - _as_positive_int(charge_breakdown.get("paidVf")))
            entitlement["updatedAt"] = now.isoformat()

            monthly["vfUsed"] = _as_positive_int(monthly.get("vfUsed")) + vf_cost
            monthly["monthlyFreeVfUsed"] = _as_positive_int(monthly.get("monthlyFreeVfUsed")) + _as_positive_int(charge_breakdown.get("monthlyVf"))
            monthly["generationCount"] = _as_positive_int(monthly.get("generationCount")) + 1
            monthly_engine = dict((monthly.get("byEngine") or {}).get(safe_engine) or {})
            monthly_engine["chars"] = _as_positive_int(monthly_engine.get("chars")) + safe_chars
            monthly_engine["vf"] = _as_positive_int(monthly_engine.get("vf")) + vf_cost
            monthly.setdefault("byEngine", {})[safe_engine] = monthly_engine
            monthly["updatedAt"] = now.isoformat()

            daily["vfUsed"] = _as_positive_int(daily.get("vfUsed")) + vf_cost
            daily["generationCount"] = _as_positive_int(daily.get("generationCount")) + 1
            daily_engine = dict((daily.get("byEngine") or {}).get(safe_engine) or {})
            daily_engine["chars"] = _as_positive_int(daily_engine.get("chars")) + safe_chars
            daily_engine["vf"] = _as_positive_int(daily_engine.get("vf")) + vf_cost
            daily.setdefault("byEngine", {})[safe_engine] = daily_engine
            daily["updatedAt"] = now.isoformat()

            event_payload = {
                "uid": uid,
                "requestId": request_id,
                "status": "reserved",
                "engine": safe_engine,
                "chars": safe_chars,
                "vfCost": vf_cost,
                "rate": rate,
                "monthDocId": monthly_doc_id,
                "dayDocId": daily_doc_id,
                "chargeBreakdown": {
                    "vff": _as_positive_int(charge_breakdown.get("vff")),
                    "monthlyVf": _as_positive_int(charge_breakdown.get("monthlyVf")),
                    "paidVf": _as_positive_int(charge_breakdown.get("paidVf")),
                },
                "limitBypass": {
                    "enabled": bool(bypass_limits),
                    "reason": str(bypass_reason or "").strip(),
                },
                "createdAt": now.isoformat(),
                "updatedAt": now.isoformat(),
            }

            _INMEMORY_ENTITLEMENTS[uid] = entitlement
            _INMEMORY_USAGE_MONTHLY[monthly_doc_id] = monthly
            _INMEMORY_USAGE_DAILY[daily_doc_id] = daily
            _INMEMORY_USAGE_EVENTS[event_doc_id] = event_payload
            return {"ok": True, "alreadyReserved": False, "event": event_payload, "monthly": monthly, "daily": daily, "entitlement": entitlement}

    assert _FIRESTORE_DB is not None
    assert firebase_firestore is not None

    entitlements_ref = _FIRESTORE_DB.collection("entitlements").document(uid)
    monthly_ref = _FIRESTORE_DB.collection("usage_monthly").document(monthly_doc_id)
    daily_ref = _FIRESTORE_DB.collection("usage_daily").document(daily_doc_id)
    event_ref = _FIRESTORE_DB.collection("usage_events").document(event_doc_id)

    transaction = _FIRESTORE_DB.transaction()

    @firebase_firestore.transactional
    def _apply(transaction_obj: Any) -> dict[str, Any]:
        entitlement_doc = entitlements_ref.get(transaction=transaction_obj)
        entitlement = entitlement_doc.to_dict() if entitlement_doc.exists else _default_entitlement(uid)
        entitlement = _normalize_entitlement_wallet(entitlement, now)
        plan_cfg = _plan_config(_normalize_plan_name(str(entitlement.get("plan") or "Free")))
        daily_limit = _as_positive_int(entitlement.get("dailyGenerationLimit") or plan_cfg["dailyGenerationLimit"])
        rate = _engine_rate_for_plan(str(entitlement.get("plan") or "Free"), safe_engine)
        vf_cost = safe_chars * rate

        monthly_doc = monthly_ref.get(transaction=transaction_obj)
        daily_doc = daily_ref.get(transaction=transaction_obj)
        default_monthly, default_daily = _usage_defaults(uid, now)
        monthly = {**default_monthly, **(monthly_doc.to_dict() or {})} if monthly_doc.exists else {**default_monthly}
        daily = {**default_daily, **(daily_doc.to_dict() or {})} if daily_doc.exists else {**default_daily}
        monthly.setdefault("monthlyFreeVfUsed", _as_positive_int(monthly.get("monthlyFreeVfUsed")))

        event_doc = event_ref.get(transaction=transaction_obj)
        if event_doc.exists:
            existing_event = event_doc.to_dict() or {}
            if str(existing_event.get("status")) in {"reserved", "committed"}:
                return {"ok": True, "alreadyReserved": True, "event": existing_event, "monthly": monthly, "daily": daily, "entitlement": entitlement}
        if not bypass_limits and _as_positive_int(daily.get("generationCount")) + 1 > daily_limit:
            raise RuntimeError("Daily generation limit reached.")

        charge_breakdown = _wallet_charge_breakdown(entitlement, monthly, safe_engine, vf_cost)
        covered = (
            _as_positive_int(charge_breakdown.get("vff"))
            + _as_positive_int(charge_breakdown.get("monthlyVf"))
            + _as_positive_int(charge_breakdown.get("paidVf"))
        )
        if not bypass_limits and covered < vf_cost:
            raise RuntimeError("Insufficient VF balance for this generation.")

        entitlement["vffBalance"] = max(0, _as_positive_int(entitlement.get("vffBalance")) - _as_positive_int(charge_breakdown.get("vff")))
        entitlement["paidVfBalance"] = max(0, _as_positive_int(entitlement.get("paidVfBalance")) - _as_positive_int(charge_breakdown.get("paidVf")))
        entitlement["updatedAt"] = now.isoformat()

        monthly["vfUsed"] = _as_positive_int(monthly.get("vfUsed")) + vf_cost
        monthly["monthlyFreeVfUsed"] = _as_positive_int(monthly.get("monthlyFreeVfUsed")) + _as_positive_int(charge_breakdown.get("monthlyVf"))
        monthly["generationCount"] = _as_positive_int(monthly.get("generationCount")) + 1
        monthly_engine = dict((monthly.get("byEngine") or {}).get(safe_engine) or {})
        monthly_engine["chars"] = _as_positive_int(monthly_engine.get("chars")) + safe_chars
        monthly_engine["vf"] = _as_positive_int(monthly_engine.get("vf")) + vf_cost
        monthly.setdefault("byEngine", {})[safe_engine] = monthly_engine
        monthly["updatedAt"] = now.isoformat()

        daily["vfUsed"] = _as_positive_int(daily.get("vfUsed")) + vf_cost
        daily["generationCount"] = _as_positive_int(daily.get("generationCount")) + 1
        daily_engine = dict((daily.get("byEngine") or {}).get(safe_engine) or {})
        daily_engine["chars"] = _as_positive_int(daily_engine.get("chars")) + safe_chars
        daily_engine["vf"] = _as_positive_int(daily_engine.get("vf")) + vf_cost
        daily.setdefault("byEngine", {})[safe_engine] = daily_engine
        daily["updatedAt"] = now.isoformat()

        event_payload = {
            "uid": uid,
            "requestId": request_id,
            "status": "reserved",
            "engine": safe_engine,
            "chars": safe_chars,
            "vfCost": vf_cost,
            "rate": rate,
            "monthDocId": monthly_doc_id,
            "dayDocId": daily_doc_id,
            "chargeBreakdown": {
                "vff": _as_positive_int(charge_breakdown.get("vff")),
                "monthlyVf": _as_positive_int(charge_breakdown.get("monthlyVf")),
                "paidVf": _as_positive_int(charge_breakdown.get("paidVf")),
            },
            "limitBypass": {
                "enabled": bool(bypass_limits),
                "reason": str(bypass_reason or "").strip(),
            },
            "createdAt": now.isoformat(),
            "updatedAt": now.isoformat(),
        }

        transaction_obj.set(entitlements_ref, entitlement, merge=True)
        transaction_obj.set(monthly_ref, monthly, merge=True)
        transaction_obj.set(daily_ref, daily, merge=True)
        transaction_obj.set(event_ref, event_payload, merge=True)
        return {"ok": True, "alreadyReserved": False, "event": event_payload, "monthly": monthly, "daily": daily, "entitlement": entitlement}

    try:
        return _apply(transaction)
    except RuntimeError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc


def _finalize_usage(uid: str, request_id: str, success: bool, error_detail: str = "") -> None:
    event_doc_id = f"{uid}_{request_id}"
    now = _utc_now().isoformat()

    if _firestore_collection("usage_events") is None:
        with _INMEMORY_LOCK:
            event = _INMEMORY_USAGE_EVENTS.get(event_doc_id)
            if not event:
                return
            status = str(event.get("status") or "")
            if status == "committed":
                return
            if success:
                event["status"] = "committed"
                event["updatedAt"] = now
                _INMEMORY_USAGE_EVENTS[event_doc_id] = event
                return
            if status == "reserved":
                monthly = _INMEMORY_USAGE_MONTHLY.get(str(event.get("monthDocId") or ""))
                daily = _INMEMORY_USAGE_DAILY.get(str(event.get("dayDocId") or ""))
                entitlement = _normalize_entitlement_wallet(_INMEMORY_ENTITLEMENTS.get(uid) or _default_entitlement(uid))
                engine = str(event.get("engine") or "GEM").upper()
                vf_cost = _as_positive_int(event.get("vfCost"))
                chars = _as_positive_int(event.get("chars"))
                charge_breakdown = event.get("chargeBreakdown") if isinstance(event.get("chargeBreakdown"), dict) else {}
                refund_vff = _as_positive_int(charge_breakdown.get("vff"))
                refund_paid = _as_positive_int(charge_breakdown.get("paidVf"))
                refund_monthly = _as_positive_int(charge_breakdown.get("monthlyVf"))
                if monthly is not None:
                    monthly["vfUsed"] = max(0, _as_positive_int(monthly.get("vfUsed")) - vf_cost)
                    monthly["monthlyFreeVfUsed"] = max(0, _as_positive_int(monthly.get("monthlyFreeVfUsed")) - refund_monthly)
                    monthly["generationCount"] = max(0, _as_positive_int(monthly.get("generationCount")) - 1)
                    monthly_engine = dict((monthly.get("byEngine") or {}).get(engine) or {})
                    monthly_engine["vf"] = max(0, _as_positive_int(monthly_engine.get("vf")) - vf_cost)
                    monthly_engine["chars"] = max(0, _as_positive_int(monthly_engine.get("chars")) - chars)
                    monthly.setdefault("byEngine", {})[engine] = monthly_engine
                    monthly["updatedAt"] = now
                if daily is not None:
                    daily["vfUsed"] = max(0, _as_positive_int(daily.get("vfUsed")) - vf_cost)
                    daily["generationCount"] = max(0, _as_positive_int(daily.get("generationCount")) - 1)
                    daily_engine = dict((daily.get("byEngine") or {}).get(engine) or {})
                    daily_engine["vf"] = max(0, _as_positive_int(daily_engine.get("vf")) - vf_cost)
                    daily_engine["chars"] = max(0, _as_positive_int(daily_engine.get("chars")) - chars)
                    daily.setdefault("byEngine", {})[engine] = daily_engine
                    daily["updatedAt"] = now
                if refund_vff > 0 or refund_paid > 0:
                    entitlement["vffBalance"] = _as_positive_int(entitlement.get("vffBalance")) + refund_vff
                    entitlement["paidVfBalance"] = _as_positive_int(entitlement.get("paidVfBalance")) + refund_paid
                    entitlement["updatedAt"] = now
                    _INMEMORY_ENTITLEMENTS[uid] = entitlement
            event["status"] = "reverted"
            event["updatedAt"] = now
            event["error"] = str(error_detail or "")
            _INMEMORY_USAGE_EVENTS[event_doc_id] = event
        return

    assert _FIRESTORE_DB is not None
    assert firebase_firestore is not None
    event_ref = _FIRESTORE_DB.collection("usage_events").document(event_doc_id)
    transaction = _FIRESTORE_DB.transaction()

    @firebase_firestore.transactional
    def _apply(transaction_obj: Any) -> None:
        event_doc = event_ref.get(transaction=transaction_obj)
        if not event_doc.exists:
            return
        event = event_doc.to_dict() or {}
        status = str(event.get("status") or "")
        if status == "committed":
            return
        if success:
            transaction_obj.set(event_ref, {"status": "committed", "updatedAt": now}, merge=True)
            return
        if status != "reserved":
            transaction_obj.set(event_ref, {"status": "reverted", "updatedAt": now, "error": str(error_detail)}, merge=True)
            return
        entitlements_ref = _FIRESTORE_DB.collection("entitlements").document(uid)
        monthly_ref = _FIRESTORE_DB.collection("usage_monthly").document(str(event.get("monthDocId") or ""))
        daily_ref = _FIRESTORE_DB.collection("usage_daily").document(str(event.get("dayDocId") or ""))
        entitlement_doc = entitlements_ref.get(transaction=transaction_obj)
        monthly_doc = monthly_ref.get(transaction=transaction_obj)
        daily_doc = daily_ref.get(transaction=transaction_obj)
        entitlement = _normalize_entitlement_wallet(
            entitlement_doc.to_dict() if entitlement_doc.exists else _default_entitlement(uid)
        )
        engine = str(event.get("engine") or "GEM").upper()
        vf_cost = _as_positive_int(event.get("vfCost"))
        chars = _as_positive_int(event.get("chars"))
        charge_breakdown = event.get("chargeBreakdown") if isinstance(event.get("chargeBreakdown"), dict) else {}
        refund_vff = _as_positive_int(charge_breakdown.get("vff"))
        refund_paid = _as_positive_int(charge_breakdown.get("paidVf"))
        refund_monthly = _as_positive_int(charge_breakdown.get("monthlyVf"))
        if monthly_doc.exists:
            monthly = monthly_doc.to_dict() or {}
            monthly["vfUsed"] = max(0, _as_positive_int(monthly.get("vfUsed")) - vf_cost)
            monthly["monthlyFreeVfUsed"] = max(0, _as_positive_int(monthly.get("monthlyFreeVfUsed")) - refund_monthly)
            monthly["generationCount"] = max(0, _as_positive_int(monthly.get("generationCount")) - 1)
            monthly_engine = dict((monthly.get("byEngine") or {}).get(engine) or {})
            monthly_engine["vf"] = max(0, _as_positive_int(monthly_engine.get("vf")) - vf_cost)
            monthly_engine["chars"] = max(0, _as_positive_int(monthly_engine.get("chars")) - chars)
            monthly.setdefault("byEngine", {})[engine] = monthly_engine
            monthly["updatedAt"] = now
            transaction_obj.set(monthly_ref, monthly, merge=True)
        if daily_doc.exists:
            daily = daily_doc.to_dict() or {}
            daily["vfUsed"] = max(0, _as_positive_int(daily.get("vfUsed")) - vf_cost)
            daily["generationCount"] = max(0, _as_positive_int(daily.get("generationCount")) - 1)
            daily_engine = dict((daily.get("byEngine") or {}).get(engine) or {})
            daily_engine["vf"] = max(0, _as_positive_int(daily_engine.get("vf")) - vf_cost)
            daily_engine["chars"] = max(0, _as_positive_int(daily_engine.get("chars")) - chars)
            daily.setdefault("byEngine", {})[engine] = daily_engine
            daily["updatedAt"] = now
            transaction_obj.set(daily_ref, daily, merge=True)
        if refund_vff > 0 or refund_paid > 0:
            entitlement["vffBalance"] = _as_positive_int(entitlement.get("vffBalance")) + refund_vff
            entitlement["paidVfBalance"] = _as_positive_int(entitlement.get("paidVfBalance")) + refund_paid
            entitlement["updatedAt"] = now
            transaction_obj.set(entitlements_ref, entitlement, merge=True)
        transaction_obj.set(event_ref, {"status": "reverted", "updatedAt": now, "error": str(error_detail)}, merge=True)

    _apply(transaction)


def _entitlement_usage_payload(uid: str) -> dict[str, Any]:
    entitlement = _normalize_entitlement_wallet(_load_entitlement(uid))
    monthly, daily = _load_usage_windows(uid)
    monthly_used = _as_positive_int(monthly.get("vfUsed"))
    monthly_limit = _as_positive_int(entitlement.get("monthlyVfLimit"))
    monthly_free_used = _as_positive_int(monthly.get("monthlyFreeVfUsed"))
    daily_used = _as_positive_int(daily.get("generationCount"))
    daily_limit = _as_positive_int(entitlement.get("dailyGenerationLimit"))
    plan_name = _normalize_plan_name(str(entitlement.get("plan") or "Free"))
    plan_key = _plan_key_from_name(plan_name)
    month_key = _wallet_month_key()
    if str(entitlement.get("vffMonthKey") or "") != month_key:
        entitlement["vffBalance"] = 0
        entitlement["vffMonthKey"] = month_key
    vff_balance = _as_positive_int(entitlement.get("vffBalance"))
    paid_balance = _as_positive_int(entitlement.get("paidVfBalance"))
    monthly_free_remaining = max(0, monthly_limit - monthly_free_used)
    ad_claims_today = _ad_claims_today(uid)
    month_start, month_end = _month_window_bounds()
    day_start, day_end = _day_window_bounds()
    return {
        "uid": uid,
        "plan": plan_name,
        "status": str(entitlement.get("status") or "free_active"),
        "monthly": {
            "vfLimit": monthly_limit,
            "vfUsed": monthly_used,
            "monthlyFreeVfUsed": monthly_free_used,
            "vfRemaining": monthly_free_remaining,
            "generationCount": _as_positive_int(monthly.get("generationCount")),
            "periodKey": str(monthly.get("periodKey") or _usage_month_period_label()),
            "windowStartUtc": month_start,
            "windowEndUtc": month_end,
            "byEngine": monthly.get("byEngine") or {},
        },
        "daily": {
            "generationLimit": daily_limit,
            "generationUsed": daily_used,
            "generationRemaining": max(0, daily_limit - daily_used),
            "vfUsed": _as_positive_int(daily.get("vfUsed")),
            "periodKey": str(daily.get("periodKey") or _usage_day_period_label()),
            "windowStartUtc": day_start,
            "windowEndUtc": day_end,
            "byEngine": daily.get("byEngine") or {},
        },
        "billing": {
            "stripeCustomerId": entitlement.get("stripeCustomerId"),
            "subscriptionId": entitlement.get("subscriptionId"),
            "currencyMode": entitlement.get("currencyMode") or "INR_BASE_AUTO_FX",
            "billingCountry": entitlement.get("billingCountry"),
        },
        "wallet": {
            "monthlyFreeRemaining": monthly_free_remaining,
            "monthlyFreeLimit": monthly_limit,
            "vffBalance": vff_balance,
            "paidVfBalance": paid_balance,
            "spendableNowByEngine": {
                "KOKORO": monthly_free_remaining + vff_balance + paid_balance,
                "GEM": monthly_free_remaining + vff_balance + paid_balance,
            },
            "adClaimsToday": ad_claims_today,
            "adClaimsDailyLimit": VF_AD_REWARD_CLAIM_LIMIT_PER_DAY,
            "vffMonthKey": str(entitlement.get("vffMonthKey") or month_key),
        },
        "limits": {
            "vfRates": {
                "KOKORO": _engine_rate_for_plan(plan_key, "KOKORO"),
                "GEM": _engine_rate_for_plan(plan_key, "GEM"),
            },
            "monthlyPlanCaps": {
                "Free": PLAN_LIMITS["free"]["monthlyVfLimit"],
                "Pro": PLAN_LIMITS["pro"]["monthlyVfLimit"],
                "Plus": PLAN_LIMITS["plus"]["monthlyVfLimit"],
            },
        },
    }

DUBBING_JOBS: dict[str, dict[str, Any]] = {}
DUBBING_JOB_LOCK = threading.Lock()

AI_OPS_LOCK = threading.Lock()
AI_OPS_STATE: dict[str, Any] = {
    "startedAtMs": int(time.time() * 1000),
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
AI_OPS_MINOR_ACTIONS = frozenset(
    {
        "restart_runtime",
        "refresh_gemini_pool",
        "enable_soft_shedding",
    }
)
AI_OPS_MAJOR_ACTIONS = frozenset(
    {
        "restart_all_runtimes",
        "set_maintenance_mode",
    }
)
AI_OPS_CONCURRENCY_EXEMPT_PATHS = frozenset(
    {
        "/health",
        "/system/version",
        "/ops/guardian/status",
        "/ops/guardian/scan",
        "/ops/guardian/approvals",
    }
)


class AiOpsScanRequest(BaseModel):
    autoFixMinor: bool = True
    includeRouteStats: bool = False
    gpu: bool = False


class AiOpsActionRequest(BaseModel):
    action: str
    payload: Optional[dict[str, Any]] = None
    adminToken: Optional[str] = None
    gpu: bool = False
    requireApproval: bool = True


class AiOpsApprovalDecisionRequest(BaseModel):
    approved: bool = True
    adminToken: Optional[str] = None
    note: Optional[str] = None


class FrontendErrorReportRequest(BaseModel):
    message: str
    route: Optional[str] = None
    component: Optional[str] = None
    severity: str = "error"
    stack: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class LoadRvcModelRequest(BaseModel):
    modelName: str
    version: str = "v2"


class SwitchTtsEngineRequest(BaseModel):
    engine: str
    gpu: bool = False


class PrepareDubbingServicesRequest(BaseModel):
    gpu: bool = False


class NovelIdeaExtractRequest(BaseModel):
    source: str
    url: str


class NovelImportSplitRequest(BaseModel):
    rawText: str
    strategy: str = "auto"


class BillingCheckoutSessionRequest(BaseModel):
    plan: str
    successUrl: Optional[str] = None
    cancelUrl: Optional[str] = None


class BillingPortalSessionRequest(BaseModel):
    returnUrl: Optional[str] = None


class BillingTokenPackCheckoutSessionRequest(BaseModel):
    successUrl: Optional[str] = None
    cancelUrl: Optional[str] = None


class CouponCreateRequest(BaseModel):
    code: str
    creditVf: int
    expiresAt: Optional[str] = None
    maxRedemptions: Optional[int] = None
    active: bool = True
    note: Optional[str] = None


class CouponPatchRequest(BaseModel):
    active: Optional[bool] = None
    expiresAt: Optional[str] = None
    maxRedemptions: Optional[int] = None
    note: Optional[str] = None


class CouponRedeemRequest(BaseModel):
    code: str


class AdminUserPatchRequest(BaseModel):
    plan: Optional[str] = None
    paidVfDelta: Optional[int] = None
    vffDelta: Optional[int] = None
    disabled: Optional[bool] = None


class AdminResetPasswordRequest(BaseModel):
    newPassword: str


class GeminiApiPoolsUpdateRequest(BaseModel):
    version: Optional[int] = None
    pools: dict[str, Any]
    fallbackChains: Optional[dict[str, Any]] = None
    constraints: Optional[dict[str, Any]] = None
    sourcePolicy: Optional[dict[str, Any]] = None


class TtsSynthesizeRequest(BaseModel):
    engine: str = "GEM"
    text: str
    voiceName: Optional[str] = None
    voice_id: Optional[str] = None
    voiceId: Optional[str] = None
    language: Optional[str] = None
    speed: Optional[float] = None
    emotion: Optional[str] = None
    style: Optional[str] = None
    trace_id: Optional[str] = None
    request_id: Optional[str] = None
    speaker: Optional[str] = None
    speaker_voices: Optional[list[dict[str, Any]]] = None
    apiKey: Optional[str] = None
    stream: Optional[bool] = None
    live_chunk_chars: Optional[int] = None
    live_chunk_words: Optional[int] = None
    response_format: Optional[str] = None
    emotion_ref_id: Optional[str] = None
    emotion_strength: Optional[float] = None
    multi_speaker_mode: Optional[str] = None
    multi_speaker_max_concurrency: Optional[int] = None
    multi_speaker_retry_once: Optional[bool] = None
    multi_speaker_line_map: Optional[list[dict[str, Any]]] = None
    post_tts_disable: Optional[bool] = None


class TtsEngineStatusItem(BaseModel):
    engine: str
    state: str
    detail: str
    ready: bool
    healthUrl: str
    runtimeUrl: str


class TtsEngineStatusResponse(BaseModel):
    ok: bool
    engines: dict[str, TtsEngineStatusItem]
    fetchedAt: str


class TtsEngineVoiceItem(BaseModel):
    voice_id: str
    name: str
    voice: Optional[str] = None
    language: Optional[str] = None
    gender: Optional[str] = None
    source: Optional[str] = None
    profile_id: Optional[str] = None
    mapped_name: Optional[str] = None
    country: Optional[str] = None
    age_group: Optional[str] = None
    style_tag: Optional[str] = None


class TtsEngineVoicesResponse(BaseModel):
    ok: bool
    engine: str
    voices: list[TtsEngineVoiceItem]
    fetchedAt: str


class TtsEngineCapabilitiesResponse(BaseModel):
    ok: bool
    engines: dict[str, dict[str, Any]]
    voiceConversion: dict[str, dict[str, Any]]
    fetchedAt: str


class TtsEngineSwitchResponse(BaseModel):
    ok: bool
    engine: str
    state: str
    detail: str
    healthUrl: str
    gpuMode: bool
    commandOutput: Optional[str] = None
    probeDetail: Optional[str] = None


class RuntimeLogTailResponse(BaseModel):
    ok: bool
    service: str
    exists: bool
    file: str
    cursor: int
    nextCursor: int
    size: int
    lines: list[str]
    truncated: bool
    lastModified: Optional[int] = None


class VideoTranscriptionResponse(BaseModel):
    ok: bool
    language: Optional[str] = None
    segments: list[dict[str, Any]]
    script: str
    durationSec: float


class AiGenerateTextRequest(BaseModel):
    systemPrompt: str
    userPrompt: str
    jsonMode: bool = False
    temperature: float = 0.7
    apiKey: Optional[str] = None


def _ai_ops_now_ms() -> int:
    return int(time.time() * 1000)


def _usage_status_class(status_code: int) -> str:
    safe_status = max(0, int(status_code))
    if safe_status < 100:
        return "unknown"
    family = safe_status // 100
    if family in {1, 2, 3, 4, 5}:
        return f"{family}xx"
    return "unknown"


def _usage_integration_for_path(path: str) -> str:
    token = str(path or "/").strip() or "/"
    normalized = token.lower()
    if normalized.startswith("/tts/"):
        return "tts"
    if normalized.startswith("/admin/"):
        return "admin"
    if normalized.startswith("/ai/"):
        return "ai"
    if normalized.startswith("/billing/"):
        return "billing"
    if normalized.startswith("/runtime/"):
        return "runtime"
    if normalized.startswith("/ops/"):
        return "ops"
    if normalized.startswith("/account/"):
        return "account"
    if normalized.startswith("/voice/"):
        return "voice"
    if normalized.startswith("/video/"):
        return "video"
    pieces = [part for part in normalized.split("/") if part]
    return pieces[0] if pieces else "misc"


def _usage_record_key(integration: str, endpoint: str, method: str) -> str:
    return f"{integration}|{method}|{endpoint}"


def _usage_new_metric_acc() -> dict[str, Any]:
    return {
        "requests": 0,
        "success": 0,
        "clientErrors": 0,
        "serverErrors": 0,
        "statusClassCounts": {"1xx": 0, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, "unknown": 0},
        "totalLatencyMs": 0.0,
        "maxLatencyMs": 0.0,
        "latencySamples": [],
        "lastStatusCode": 0,
        "lastSeenMs": 0,
    }


def _usage_percentile(samples: list[float], percentile: float) -> float:
    if not samples:
        return 0.0
    ordered = sorted(float(item) for item in samples if item is not None)
    if not ordered:
        return 0.0
    rank = int(round((max(0.0, min(100.0, float(percentile))) / 100.0) * float(len(ordered) - 1)))
    rank = max(0, min(rank, len(ordered) - 1))
    return float(ordered[rank])


def _usage_metric_add(
    metric: dict[str, Any],
    *,
    status_code: int,
    latency_ms: float,
    event_ts_ms: int,
    sample_cap: int = 4096,
) -> None:
    safe_status = int(status_code)
    safe_latency = max(0.0, float(latency_ms))
    status_class = _usage_status_class(safe_status)

    metric["requests"] = int(metric.get("requests", 0)) + 1
    if 200 <= safe_status < 400:
        metric["success"] = int(metric.get("success", 0)) + 1
    elif 400 <= safe_status < 500:
        metric["clientErrors"] = int(metric.get("clientErrors", 0)) + 1
    else:
        metric["serverErrors"] = int(metric.get("serverErrors", 0)) + 1
    status_counts = metric.get("statusClassCounts")
    if not isinstance(status_counts, dict):
        status_counts = {"1xx": 0, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, "unknown": 0}
    status_counts[status_class] = int(status_counts.get(status_class, 0)) + 1
    metric["statusClassCounts"] = status_counts
    metric["totalLatencyMs"] = float(metric.get("totalLatencyMs", 0.0)) + safe_latency
    metric["maxLatencyMs"] = max(float(metric.get("maxLatencyMs", 0.0)), safe_latency)
    samples = metric.get("latencySamples")
    if not isinstance(samples, list):
        samples = []
    samples.append(safe_latency)
    overflow = len(samples) - max(8, int(sample_cap))
    if overflow > 0:
        del samples[:overflow]
    metric["latencySamples"] = samples
    metric["lastStatusCode"] = safe_status
    metric["lastSeenMs"] = max(int(metric.get("lastSeenMs", 0)), int(event_ts_ms))


def _usage_metric_merge(metric: dict[str, Any], source: dict[str, Any], *, sample_cap: int = 4096) -> None:
    metric["requests"] = int(metric.get("requests", 0)) + int(source.get("requests", 0))
    metric["success"] = int(metric.get("success", 0)) + int(source.get("success", 0))
    metric["clientErrors"] = int(metric.get("clientErrors", 0)) + int(source.get("clientErrors", 0))
    metric["serverErrors"] = int(metric.get("serverErrors", 0)) + int(source.get("serverErrors", 0))
    target_counts = metric.get("statusClassCounts")
    if not isinstance(target_counts, dict):
        target_counts = {"1xx": 0, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, "unknown": 0}
    source_counts = source.get("statusClassCounts") if isinstance(source.get("statusClassCounts"), dict) else {}
    for key in ["1xx", "2xx", "3xx", "4xx", "5xx", "unknown"]:
        target_counts[key] = int(target_counts.get(key, 0)) + int(source_counts.get(key, 0))
    metric["statusClassCounts"] = target_counts
    metric["totalLatencyMs"] = float(metric.get("totalLatencyMs", 0.0)) + float(source.get("totalLatencyMs", 0.0))
    metric["maxLatencyMs"] = max(float(metric.get("maxLatencyMs", 0.0)), float(source.get("maxLatencyMs", 0.0)))
    source_samples = list(source.get("latencySamples") or [])
    if source_samples:
        target_samples = metric.get("latencySamples")
        if not isinstance(target_samples, list):
            target_samples = []
        target_samples.extend(float(item) for item in source_samples)
        overflow = len(target_samples) - max(8, int(sample_cap))
        if overflow > 0:
            del target_samples[:overflow]
        metric["latencySamples"] = target_samples
    metric["lastStatusCode"] = int(source.get("lastStatusCode") or metric.get("lastStatusCode") or 0)
    metric["lastSeenMs"] = max(int(metric.get("lastSeenMs", 0)), int(source.get("lastSeenMs", 0)))


def _usage_metric_finalize(metric: dict[str, Any]) -> dict[str, Any]:
    requests_total = int(metric.get("requests", 0))
    client_errors = int(metric.get("clientErrors", 0))
    server_errors = int(metric.get("serverErrors", 0))
    total_latency = float(metric.get("totalLatencyMs", 0.0))
    samples = list(metric.get("latencySamples") or [])
    return {
        "requests": requests_total,
        "success": int(metric.get("success", 0)),
        "clientErrors": client_errors,
        "serverErrors": server_errors,
        "errorRatePct": round(
            ((float(client_errors + server_errors) / float(requests_total)) * 100.0) if requests_total > 0 else 0.0,
            2,
        ),
        "statusClassCounts": metric.get("statusClassCounts") if isinstance(metric.get("statusClassCounts"), dict) else {
            "1xx": 0,
            "2xx": 0,
            "3xx": 0,
            "4xx": 0,
            "5xx": 0,
            "unknown": 0,
        },
        "avgLatencyMs": round((total_latency / float(requests_total)) if requests_total > 0 else 0.0, 2),
        "p95LatencyMs": round(_usage_percentile(samples, 95), 2),
        "maxLatencyMs": round(float(metric.get("maxLatencyMs", 0.0)), 2),
        "lastStatusCode": int(metric.get("lastStatusCode", 0)),
        "lastSeenMs": int(metric.get("lastSeenMs", 0)),
    }


def _admin_usage_prune_locked(now_ms: int) -> None:
    cutoff_ms = int(now_ms) - USAGE_WINDOW_7D_MS
    while _ADMIN_USAGE_RECENT_EVENTS and int((_ADMIN_USAGE_RECENT_EVENTS[0] or {}).get("ts", 0)) < cutoff_ms:
        _ADMIN_USAGE_RECENT_EVENTS.popleft()
    overflow = len(_ADMIN_USAGE_RECENT_EVENTS) - VF_ADMIN_USAGE_RECENT_EVENT_CAP
    if overflow > 0:
        for _ in range(overflow):
            if not _ADMIN_USAGE_RECENT_EVENTS:
                break
            _ADMIN_USAGE_RECENT_EVENTS.popleft()


def _admin_usage_record_event(
    *,
    integration: str,
    endpoint: str,
    method: str,
    status_code: int,
    latency_ms: float,
) -> None:
    now_ms = _ai_ops_now_ms()
    safe_integration = str(integration or "misc").strip().lower()[:80] or "misc"
    safe_endpoint = str(endpoint or "/").strip()[:200] or "/"
    safe_method = str(method or "GET").strip().upper()[:16] or "GET"
    safe_status = max(0, int(status_code))
    safe_latency = max(0.0, float(latency_ms))
    status_class = _usage_status_class(safe_status)
    event = {
        "ts": now_ms,
        "integration": safe_integration,
        "endpoint": safe_endpoint,
        "method": safe_method,
        "statusCode": safe_status,
        "statusClass": status_class,
        "latencyMs": safe_latency,
    }
    record_key = _usage_record_key(safe_integration, safe_endpoint, safe_method)
    with _ADMIN_USAGE_LOCK:
        _ADMIN_USAGE_RECENT_EVENTS.append(event)
        _admin_usage_prune_locked(now_ms)
        bucket = _ADMIN_USAGE_TOTALS.get(record_key)
        if not isinstance(bucket, dict):
            bucket = {
                "integration": safe_integration,
                "endpoint": safe_endpoint,
                "method": safe_method,
                **_usage_new_metric_acc(),
            }
            _ADMIN_USAGE_TOTALS[record_key] = bucket
        _usage_metric_add(
            bucket,
            status_code=safe_status,
            latency_ms=safe_latency,
            event_ts_ms=now_ms,
            sample_cap=VF_ADMIN_USAGE_TOTAL_SAMPLE_CAP,
        )


def _admin_usage_record_http(path: str, method: str, *, status_code: int, elapsed_ms: int) -> None:
    _admin_usage_record_event(
        integration=_usage_integration_for_path(path),
        endpoint=str(path or "/"),
        method=str(method or "GET"),
        status_code=status_code,
        latency_ms=float(max(0, int(elapsed_ms))),
    )


def _admin_usage_record_runtime_call(
    *,
    engine: str,
    endpoint: str,
    method: str,
    status_code: int,
    elapsed_ms: int,
) -> None:
    engine_key = str(engine or "").strip().upper()
    integration = "gemini-runtime" if engine_key == "GEM" else "kokoro-runtime" if engine_key == "KOKORO" else "tts-runtime"
    _admin_usage_record_event(
        integration=integration,
        endpoint=str(endpoint or "/synthesize"),
        method=str(method or "POST"),
        status_code=int(status_code),
        latency_ms=float(max(0, int(elapsed_ms))),
    )


def _admin_usage_build_window_from_events(cutoff_ms: int) -> dict[str, Any]:
    overall = _usage_new_metric_acc()
    integrations: dict[str, dict[str, Any]] = {}

    with _ADMIN_USAGE_LOCK:
        events = list(_ADMIN_USAGE_RECENT_EVENTS)

    for event in events:
        event_ts = int(event.get("ts", 0))
        if event_ts < cutoff_ms:
            continue
        integration = str(event.get("integration") or "misc")
        endpoint = str(event.get("endpoint") or "/")
        method = str(event.get("method") or "GET")
        status_code = int(event.get("statusCode") or 0)
        latency_ms = float(event.get("latencyMs") or 0.0)

        _usage_metric_add(overall, status_code=status_code, latency_ms=latency_ms, event_ts_ms=event_ts)

        integration_entry = integrations.get(integration)
        if not isinstance(integration_entry, dict):
            integration_entry = {
                "metric": _usage_new_metric_acc(),
                "endpoints": {},
            }
            integrations[integration] = integration_entry
        _usage_metric_add(integration_entry["metric"], status_code=status_code, latency_ms=latency_ms, event_ts_ms=event_ts)

        endpoint_key = _usage_record_key(integration, endpoint, method)
        endpoint_entry = integration_entry["endpoints"].get(endpoint_key)
        if not isinstance(endpoint_entry, dict):
            endpoint_entry = {
                "endpoint": endpoint,
                "method": method,
                "metric": _usage_new_metric_acc(),
            }
            integration_entry["endpoints"][endpoint_key] = endpoint_entry
        _usage_metric_add(endpoint_entry["metric"], status_code=status_code, latency_ms=latency_ms, event_ts_ms=event_ts)

    out_integrations: dict[str, Any] = {}
    for integration, entry in integrations.items():
        endpoints_payload: dict[str, Any] = {}
        for endpoint_key, endpoint_entry in (entry.get("endpoints") or {}).items():
            endpoints_payload[endpoint_key] = {
                "endpoint": str(endpoint_entry.get("endpoint") or "/"),
                "method": str(endpoint_entry.get("method") or "GET"),
                "metric": _usage_metric_finalize(endpoint_entry.get("metric") if isinstance(endpoint_entry.get("metric"), dict) else {}),
            }
        out_integrations[integration] = {
            "metric": _usage_metric_finalize(entry.get("metric") if isinstance(entry.get("metric"), dict) else {}),
            "endpoints": endpoints_payload,
        }

    return {
        "overall": _usage_metric_finalize(overall),
        "integrations": out_integrations,
    }


def _admin_usage_build_window_from_totals() -> dict[str, Any]:
    overall = _usage_new_metric_acc()
    integrations: dict[str, dict[str, Any]] = {}
    with _ADMIN_USAGE_LOCK:
        totals = [dict(item) for item in _ADMIN_USAGE_TOTALS.values() if isinstance(item, dict)]

    for bucket in totals:
        integration = str(bucket.get("integration") or "misc")
        endpoint = str(bucket.get("endpoint") or "/")
        method = str(bucket.get("method") or "GET")
        _usage_metric_merge(overall, bucket, sample_cap=VF_ADMIN_USAGE_TOTAL_SAMPLE_CAP)

        integration_entry = integrations.get(integration)
        if not isinstance(integration_entry, dict):
            integration_entry = {
                "metric": _usage_new_metric_acc(),
                "endpoints": {},
            }
            integrations[integration] = integration_entry
        _usage_metric_merge(integration_entry["metric"], bucket, sample_cap=VF_ADMIN_USAGE_TOTAL_SAMPLE_CAP)

        endpoint_key = _usage_record_key(integration, endpoint, method)
        integration_entry["endpoints"][endpoint_key] = {
            "endpoint": endpoint,
            "method": method,
            "metric": _usage_metric_finalize(bucket),
        }

    out_integrations: dict[str, Any] = {}
    for integration, entry in integrations.items():
        out_integrations[integration] = {
            "metric": _usage_metric_finalize(entry.get("metric") if isinstance(entry.get("metric"), dict) else {}),
            "endpoints": dict(entry.get("endpoints") or {}),
        }
    return {
        "overall": _usage_metric_finalize(overall),
        "integrations": out_integrations,
    }


def _admin_usage_summary_payload() -> dict[str, Any]:
    now_ms = _ai_ops_now_ms()
    windows = {
        "total": _admin_usage_build_window_from_totals(),
        "last24h": _admin_usage_build_window_from_events(now_ms - USAGE_WINDOW_24H_MS),
        "last7d": _admin_usage_build_window_from_events(now_ms - USAGE_WINDOW_7D_MS),
    }
    integration_keys: set[str] = set()
    for window_payload in windows.values():
        integration_keys.update((window_payload.get("integrations") or {}).keys())

    integrations_out: list[dict[str, Any]] = []
    for integration in sorted(integration_keys):
        integration_windows: dict[str, Any] = {}
        endpoint_keys: set[str] = set()
        for window_name, window_payload in windows.items():
            integration_entry = (window_payload.get("integrations") or {}).get(integration) or {}
            integration_windows[window_name] = integration_entry.get("metric") or _usage_metric_finalize({})
            endpoint_keys.update((integration_entry.get("endpoints") or {}).keys())

        endpoints_out: list[dict[str, Any]] = []
        for endpoint_key in sorted(endpoint_keys):
            endpoint_label = "/"
            method_label = "GET"
            endpoint_windows: dict[str, Any] = {}
            for window_name, window_payload in windows.items():
                integration_entry = (window_payload.get("integrations") or {}).get(integration) or {}
                endpoint_entry = (integration_entry.get("endpoints") or {}).get(endpoint_key) or {}
                endpoint_label = str(endpoint_entry.get("endpoint") or endpoint_label)
                method_label = str(endpoint_entry.get("method") or method_label)
                endpoint_windows[window_name] = endpoint_entry.get("metric") or _usage_metric_finalize({})
            endpoints_out.append(
                {
                    "key": endpoint_key,
                    "endpoint": endpoint_label,
                    "method": method_label,
                    "windows": endpoint_windows,
                }
            )
        endpoints_out.sort(
            key=lambda item: int((((item.get("windows") or {}).get("total") or {}).get("requests") or 0)),
            reverse=True,
        )
        integrations_out.append(
            {
                "integration": integration,
                "windows": integration_windows,
                "endpoints": endpoints_out,
            }
        )
    integrations_out.sort(
        key=lambda item: int((((item.get("windows") or {}).get("total") or {}).get("requests") or 0)),
        reverse=True,
    )

    return {
        "ok": True,
        "generatedAtMs": now_ms,
        "windows": {
            "total": windows["total"]["overall"],
            "last24h": windows["last24h"]["overall"],
            "last7d": windows["last7d"]["overall"],
        },
        "integrations": integrations_out,
        "gateway": _TTS_GATEWAY_CONTROLLER.snapshot(),
        "jobQueue": _TTS_JOB_QUEUE.depth_snapshot(),
    }


def _admin_usage_export_csv_rows(summary: dict[str, Any], window_name: str) -> str:
    safe_window = "total" if window_name not in {"total", "last24h", "last7d"} else window_name
    text_buffer = StringIO(newline="")
    writer = csv.writer(text_buffer)
    writer.writerow(
        [
            "integration",
            "endpoint",
            "method",
            "window",
            "requests",
            "success",
            "clientErrors",
            "serverErrors",
            "errorRatePct",
            "avgLatencyMs",
            "p95LatencyMs",
            "maxLatencyMs",
            "status1xx",
            "status2xx",
            "status3xx",
            "status4xx",
            "status5xx",
            "statusUnknown",
            "lastStatusCode",
            "lastSeenMs",
        ]
    )
    for integration_item in list(summary.get("integrations") or []):
        if not isinstance(integration_item, dict):
            continue
        integration_name = str(integration_item.get("integration") or "misc")
        for endpoint_item in list(integration_item.get("endpoints") or []):
            if not isinstance(endpoint_item, dict):
                continue
            metric = ((endpoint_item.get("windows") or {}).get(safe_window) or {})
            status_counts = metric.get("statusClassCounts") if isinstance(metric.get("statusClassCounts"), dict) else {}
            writer.writerow(
                [
                    integration_name,
                    str(endpoint_item.get("endpoint") or "/"),
                    str(endpoint_item.get("method") or "GET"),
                    safe_window,
                    int(metric.get("requests") or 0),
                    int(metric.get("success") or 0),
                    int(metric.get("clientErrors") or 0),
                    int(metric.get("serverErrors") or 0),
                    float(metric.get("errorRatePct") or 0.0),
                    float(metric.get("avgLatencyMs") or 0.0),
                    float(metric.get("p95LatencyMs") or 0.0),
                    float(metric.get("maxLatencyMs") or 0.0),
                    int(status_counts.get("1xx") or 0),
                    int(status_counts.get("2xx") or 0),
                    int(status_counts.get("3xx") or 0),
                    int(status_counts.get("4xx") or 0),
                    int(status_counts.get("5xx") or 0),
                    int(status_counts.get("unknown") or 0),
                    int(metric.get("lastStatusCode") or 0),
                    int(metric.get("lastSeenMs") or 0),
                ]
            )
    return text_buffer.getvalue()


def _ai_ops_is_exempt_path(path: str) -> bool:
    token = str(path or "").strip()
    return (
        token in AI_OPS_CONCURRENCY_EXEMPT_PATHS
        or token.startswith("/ops/guardian/")
        or token.startswith("/docs")
    )


def _ai_ops_default_route_stats() -> dict[str, Any]:
    return {
        "requests": 0,
        "success": 0,
        "clientErrors": 0,
        "serverErrors": 0,
        "rejected": 0,
        "inFlight": 0,
        "totalLatencyMs": 0,
        "avgLatencyMs": 0.0,
        "lastStatusCode": None,
        "lastError": "",
        "updatedAtMs": 0,
        "recentStatuses": [],
    }


def _ai_ops_route_stats_locked(path: str) -> dict[str, Any]:
    route_stats = AI_OPS_STATE.setdefault("routeStats", {})
    entry = route_stats.get(path)
    if not isinstance(entry, dict):
        entry = _ai_ops_default_route_stats()
        route_stats[path] = entry
    return entry


def _ai_ops_trim_list_locked(items: list[Any], max_items: int) -> None:
    overflow = len(items) - max(1, int(max_items))
    if overflow > 0:
        del items[:overflow]


def _ai_ops_action_severity(action: str) -> str:
    normalized = str(action or "").strip().lower()
    if normalized in AI_OPS_MINOR_ACTIONS:
        return "minor"
    if normalized in AI_OPS_MAJOR_ACTIONS:
        return "major"
    return "major"


def _ai_ops_validate_action(action: str) -> str:
    normalized = str(action or "").strip().lower()
    allowed = AI_OPS_MINOR_ACTIONS.union(AI_OPS_MAJOR_ACTIONS)
    if normalized not in allowed:
        raise ValueError(f"Unsupported action. Allowed: {', '.join(sorted(allowed))}")
    return normalized


def _ai_ops_find_pending_approval_locked(action: str, payload: dict[str, Any]) -> Optional[dict[str, Any]]:
    approvals = AI_OPS_STATE.setdefault("pendingApprovals", {})
    for approval in approvals.values():
        if not isinstance(approval, dict):
            continue
        if str(approval.get("status") or "") != "pending":
            continue
        if str(approval.get("action") or "") != action:
            continue
        existing_payload = approval.get("payload") if isinstance(approval.get("payload"), dict) else {}
        if existing_payload == payload:
            return dict(approval)
    return None


def _ai_ops_create_approval(
    *,
    action: str,
    payload: Optional[dict[str, Any]],
    requested_by: str,
    reason: str,
) -> tuple[dict[str, Any], bool]:
    normalized_action = _ai_ops_validate_action(action)
    safe_payload = dict(payload or {})
    with AI_OPS_LOCK:
        existing = _ai_ops_find_pending_approval_locked(normalized_action, safe_payload)
        if existing is not None:
            return existing, False

        approval_id = f"aop_{uuid.uuid4().hex[:12]}"
        now_ms = _ai_ops_now_ms()
        approval = {
            "id": approval_id,
            "action": normalized_action,
            "payload": safe_payload,
            "severity": _ai_ops_action_severity(normalized_action),
            "status": "pending",
            "requestedBy": str(requested_by or "system"),
            "requestedAtMs": now_ms,
            "updatedAtMs": now_ms,
            "reason": str(reason or "admin_approval_required"),
            "note": "",
            "decisionBy": None,
            "decisionAtMs": None,
            "execution": None,
        }
        approvals = AI_OPS_STATE.setdefault("pendingApprovals", {})
        approvals[approval_id] = approval
        order = AI_OPS_STATE.setdefault("approvalOrder", [])
        order.append(approval_id)
        _ai_ops_trim_list_locked(order, VF_AI_OPS_MAX_PENDING_APPROVALS)
        if approval_id not in order:
            approvals.pop(approval_id, None)
        return dict(approval), True


def _ai_ops_record_backend_error_locked(path: str, status_code: int, detail: str) -> None:
    now_ms = _ai_ops_now_ms()
    item = {
        "ts": now_ms,
        "path": str(path or "/"),
        "statusCode": int(status_code),
        "detail": str(detail or "").strip()[:320],
    }
    errors = AI_OPS_STATE.setdefault("recentErrors", [])
    errors.append(item)
    _ai_ops_trim_list_locked(errors, VF_AI_OPS_MAX_RECENT_ERRORS)


def _ai_ops_record_rejected_request(path: str, throttle_payload: dict[str, Any]) -> None:
    safe_path = str(path or "/")
    reason = str((throttle_payload or {}).get("reason") or "throttled")
    with AI_OPS_LOCK:
        route = _ai_ops_route_stats_locked(safe_path)
        route["rejected"] = int(route.get("rejected", 0)) + 1
        recent_statuses = list(route.get("recentStatuses") or [])
        recent_statuses.append(503)
        _ai_ops_trim_list_locked(recent_statuses, 80)
        route["recentStatuses"] = recent_statuses
        route["lastStatusCode"] = 503
        route["lastError"] = reason
        route["updatedAtMs"] = _ai_ops_now_ms()
        _ai_ops_record_backend_error_locked(safe_path, 503, reason)


def _ai_ops_request_started(path: str) -> None:
    safe_path = str(path or "/")
    with AI_OPS_LOCK:
        now_ms = _ai_ops_now_ms()
        AI_OPS_STATE["inFlightTotal"] = max(0, int(AI_OPS_STATE.get("inFlightTotal", 0)) + 1)
        AI_OPS_STATE["inFlightPeak"] = max(
            int(AI_OPS_STATE.get("inFlightPeak", 0)),
            int(AI_OPS_STATE.get("inFlightTotal", 0)),
        )
        route = _ai_ops_route_stats_locked(safe_path)
        route["requests"] = int(route.get("requests", 0)) + 1
        route["inFlight"] = max(0, int(route.get("inFlight", 0)) + 1)
        route["updatedAtMs"] = now_ms


def _ai_ops_request_finished(path: str, *, status_code: int, elapsed_ms: int, error_detail: str = "") -> None:
    safe_path = str(path or "/")
    safe_status_code = int(status_code)
    safe_elapsed_ms = max(0, int(elapsed_ms))
    safe_error_detail = str(error_detail or "").strip()
    with AI_OPS_LOCK:
        now_ms = _ai_ops_now_ms()
        AI_OPS_STATE["inFlightTotal"] = max(0, int(AI_OPS_STATE.get("inFlightTotal", 0)) - 1)
        route = _ai_ops_route_stats_locked(safe_path)
        route["inFlight"] = max(0, int(route.get("inFlight", 0)) - 1)
        route["totalLatencyMs"] = int(route.get("totalLatencyMs", 0)) + safe_elapsed_ms
        requests_total = max(1, int(route.get("requests", 0)))
        route["avgLatencyMs"] = float(route.get("totalLatencyMs", 0)) / float(requests_total)
        if 200 <= safe_status_code < 400:
            route["success"] = int(route.get("success", 0)) + 1
        elif 400 <= safe_status_code < 500:
            route["clientErrors"] = int(route.get("clientErrors", 0)) + 1
        else:
            route["serverErrors"] = int(route.get("serverErrors", 0)) + 1
        recent_statuses = list(route.get("recentStatuses") or [])
        recent_statuses.append(safe_status_code)
        _ai_ops_trim_list_locked(recent_statuses, 80)
        route["recentStatuses"] = recent_statuses
        route["lastStatusCode"] = safe_status_code
        route["updatedAtMs"] = now_ms
        if safe_status_code >= 500 or safe_error_detail:
            detail = safe_error_detail or f"status_{safe_status_code}"
            route["lastError"] = detail[:320]
            _ai_ops_record_backend_error_locked(safe_path, safe_status_code, detail)


def _ai_ops_throttle_payload(path: str) -> Optional[dict[str, Any]]:
    safe_path = str(path or "/")
    if _ai_ops_is_exempt_path(safe_path):
        return None
    with AI_OPS_LOCK:
        mode = str(VF_AI_OPS_MODE)
        maintenance_mode = bool(AI_OPS_STATE.get("maintenanceMode", False))
        in_flight = int(AI_OPS_STATE.get("inFlightTotal", 0))
        soft_limit = int(VF_AI_OPS_CONCURRENCY_SOFT_LIMIT)
        hard_limit = int(VF_AI_OPS_CONCURRENCY_HARD_LIMIT)
        soft_shed_until_ms = int(AI_OPS_STATE.get("temporarySheddingUntilMs", 0))
    now_ms = _ai_ops_now_ms()
    if maintenance_mode:
        return {
            "ok": False,
            "reason": "maintenance_mode",
            "detail": "AI Guardian maintenance mode is active.",
            "retryAfterMs": 15_000,
            "mode": mode,
        }
    if mode != "enforce":
        return None
    if in_flight >= hard_limit:
        return {
            "ok": False,
            "reason": "hard_concurrency_limit",
            "detail": f"AI Guardian is shedding traffic. inFlight={in_flight}, hardLimit={hard_limit}",
            "retryAfterMs": 2_000,
            "mode": mode,
        }
    if soft_shed_until_ms > now_ms and in_flight >= soft_limit:
        return {
            "ok": False,
            "reason": "soft_shedding",
            "detail": f"AI Guardian soft shedding active. inFlight={in_flight}, softLimit={soft_limit}",
            "retryAfterMs": max(500, soft_shed_until_ms - now_ms),
            "mode": mode,
        }
    return None


def _ai_ops_route_stats_snapshot(*, include_recent_statuses: bool = False) -> dict[str, Any]:
    with AI_OPS_LOCK:
        route_stats_raw = AI_OPS_STATE.get("routeStats") if isinstance(AI_OPS_STATE.get("routeStats"), dict) else {}
        out: dict[str, Any] = {}
        for path, stats in route_stats_raw.items():
            if not isinstance(stats, dict):
                continue
            recent_statuses = list(stats.get("recentStatuses") or [])
            recent_window = recent_statuses[-20:]
            recent_server_errors = sum(1 for code in recent_window if int(code) >= 500)
            recent_error_rate = (
                float(recent_server_errors) / float(len(recent_window))
                if len(recent_window) > 0
                else 0.0
            )
            payload = {
                "requests": int(stats.get("requests", 0)),
                "success": int(stats.get("success", 0)),
                "clientErrors": int(stats.get("clientErrors", 0)),
                "serverErrors": int(stats.get("serverErrors", 0)),
                "rejected": int(stats.get("rejected", 0)),
                "inFlight": int(stats.get("inFlight", 0)),
                "avgLatencyMs": round(float(stats.get("avgLatencyMs", 0.0)), 2),
                "lastStatusCode": stats.get("lastStatusCode"),
                "lastError": str(stats.get("lastError") or ""),
                "updatedAtMs": int(stats.get("updatedAtMs", 0)),
                "recentWindowSize": len(recent_window),
                "recentServerErrors": int(recent_server_errors),
                "recentServerErrorRate": round(recent_error_rate, 3),
            }
            if include_recent_statuses:
                payload["recentStatuses"] = recent_statuses
            out[str(path)] = payload
        return out


def _ai_ops_pending_approval_count() -> int:
    with AI_OPS_LOCK:
        approvals = AI_OPS_STATE.get("pendingApprovals") if isinstance(AI_OPS_STATE.get("pendingApprovals"), dict) else {}
        return sum(1 for value in approvals.values() if isinstance(value, dict) and str(value.get("status") or "") == "pending")


def _ai_ops_recent_errors_snapshot() -> list[dict[str, Any]]:
    with AI_OPS_LOCK:
        items = AI_OPS_STATE.get("recentErrors") if isinstance(AI_OPS_STATE.get("recentErrors"), list) else []
        return [dict(item) for item in items if isinstance(item, dict)]


def _ai_ops_recent_frontend_errors_snapshot() -> list[dict[str, Any]]:
    with AI_OPS_LOCK:
        items = AI_OPS_STATE.get("frontendErrors") if isinstance(AI_OPS_STATE.get("frontendErrors"), list) else []
        return [dict(item) for item in items if isinstance(item, dict)]


def _ai_ops_append_action_history(action_item: dict[str, Any]) -> None:
    with AI_OPS_LOCK:
        history = AI_OPS_STATE.setdefault("actionHistory", [])
        history.append(dict(action_item))
        _ai_ops_trim_list_locked(history, VF_AI_OPS_MAX_ACTION_HISTORY)


def _ai_ops_runtime_snapshot() -> dict[str, Any]:
    engines: dict[str, Any] = {}
    offline: list[str] = []
    for engine, health_url in TTS_ENGINE_HEALTH_URLS.items():
        healthy, detail = _probe_runtime_health(health_url, timeout_sec=2.5)
        item = {
            "engine": engine,
            "healthUrl": health_url,
            "healthy": bool(healthy),
            "detail": str(detail or "unknown"),
        }
        engines[engine] = item
        if not healthy:
            offline.append(engine)
    return {
        "engines": engines,
        "offline": offline,
        "healthyCount": max(0, len(engines) - len(offline)),
        "total": len(engines),
    }


def _ai_ops_gemini_pool_snapshot() -> dict[str, Any]:
    routes = {
        "text": list(GEMINI_ALLOCATOR_CONFIG.routes.get("text", [])),
        "ocr": list(GEMINI_ALLOCATOR_CONFIG.routes.get("ocr", [])),
        "tts": list(GEMINI_ALLOCATOR_CONFIG.routes.get("tts", [])),
    }
    key_pool = _resolve_gemini_fallback_key_pool()
    if not key_pool:
        return {
            "configured": False,
            "routes": routes,
            "pool": {"keyCount": 0, "healthyKeys": 0, "unhealthyKeys": 0, "atLimitKeys": 0},
            "keys": [],
            "models": [],
            "advisories": ["No backend Gemini API keys are configured."],
        }

    BACKEND_GEMINI_ALLOCATOR.ensure_keys(key_pool)
    snapshot = BACKEND_GEMINI_ALLOCATOR.snapshot(key_pool)
    pool = snapshot.get("pool") if isinstance(snapshot.get("pool"), dict) else {}
    keys = snapshot.get("keys") if isinstance(snapshot.get("keys"), list) else []
    models = snapshot.get("models") if isinstance(snapshot.get("models"), list) else []
    advisories: list[str] = []
    if int(pool.get("atLimitKeys", 0)) >= max(1, int(pool.get("keyCount", 0))):
        advisories.append("Gemini key pool is at capacity.")
    if int(pool.get("unhealthyKeys", 0)) > 0:
        advisories.append("Some Gemini keys are unhealthy or rate-limited.")
    return {
        "configured": True,
        "routes": routes,
        "pool": pool,
        "keys": keys,
        "models": models,
        "advisories": advisories,
    }


def _ai_ops_detect_route_error_bursts(route_stats: dict[str, Any]) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    for path, stats in route_stats.items():
        if not isinstance(stats, dict):
            continue
        statuses = list(stats.get("recentStatuses") or [])
        if len(statuses) < 8:
            continue
        window = statuses[-20:]
        server_errors = sum(1 for code in window if int(code) >= 500)
        error_rate = float(server_errors) / float(len(window))
        if server_errors >= 4 and error_rate >= 0.40:
            issues.append(
                {
                    "id": f"route_burst_{hash(path) & 0xFFFF:04x}",
                    "type": "backend_route_error_burst",
                    "severity": "minor",
                    "message": f"Route {path} has elevated 5xx errors ({server_errors}/{len(window)}).",
                    "action": "enable_soft_shedding",
                    "payload": {"durationMs": 30_000},
                    "path": path,
                    "errorRate": round(error_rate, 3),
                }
            )
    return issues


def _ai_ops_detect_issues(
    *,
    runtime_snapshot: dict[str, Any],
    gemini_snapshot: dict[str, Any],
    route_stats: dict[str, Any],
    concurrency: dict[str, Any],
) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    offline = [str(item) for item in list(runtime_snapshot.get("offline") or []) if str(item)]
    if len(offline) == 1:
        issues.append(
            {
                "id": "runtime_single_offline",
                "type": "runtime_health",
                "severity": "minor",
                "message": f"Runtime {offline[0]} appears offline.",
                "action": "restart_runtime",
                "payload": {"engine": offline[0]},
            }
        )
    elif len(offline) > 1:
        issues.append(
            {
                "id": "runtime_multi_offline",
                "type": "runtime_health",
                "severity": "major",
                "message": f"Multiple runtimes offline: {', '.join(offline)}",
                "action": "restart_all_runtimes",
                "payload": {},
            }
        )

    in_flight = int(concurrency.get("inFlight", 0))
    soft_limit = int(concurrency.get("softLimit", VF_AI_OPS_CONCURRENCY_SOFT_LIMIT))
    hard_limit = int(concurrency.get("hardLimit", VF_AI_OPS_CONCURRENCY_HARD_LIMIT))
    if in_flight >= hard_limit:
        issues.append(
            {
                "id": "concurrency_hard_limit",
                "type": "concurrency",
                "severity": "major",
                "message": f"In-flight requests reached hard limit ({in_flight}/{hard_limit}).",
                "action": "set_maintenance_mode",
                "payload": {"enabled": True},
            }
        )
    elif in_flight >= soft_limit:
        issues.append(
            {
                "id": "concurrency_soft_limit",
                "type": "concurrency",
                "severity": "minor",
                "message": f"In-flight requests reached soft limit ({in_flight}/{soft_limit}).",
                "action": "enable_soft_shedding",
                "payload": {"durationMs": 30_000},
            }
        )

    if not bool(gemini_snapshot.get("configured")):
        issues.append(
            {
                "id": "gemini_pool_missing",
                "type": "gemini_pool",
                "severity": "minor",
                "message": "Gemini key pool is not configured for backend fallback.",
                "action": None,
                "payload": {},
            }
        )
    else:
        pool = gemini_snapshot.get("pool") if isinstance(gemini_snapshot.get("pool"), dict) else {}
        key_count = int(pool.get("keyCount", 0))
        at_limit_keys = int(pool.get("atLimitKeys", 0))
        unhealthy_keys = int(pool.get("unhealthyKeys", 0))
        if key_count > 0 and at_limit_keys >= key_count:
            issues.append(
                {
                    "id": "gemini_pool_at_capacity",
                    "type": "gemini_pool",
                    "severity": "minor",
                    "message": "Gemini key pool is fully at capacity.",
                    "action": "refresh_gemini_pool",
                    "payload": {},
                }
            )
        if key_count > 0 and unhealthy_keys >= key_count:
            issues.append(
                {
                    "id": "gemini_pool_all_unhealthy",
                    "type": "gemini_pool",
                    "severity": "major",
                    "message": "All Gemini keys are currently unhealthy.",
                    "action": None,
                    "payload": {},
                }
            )

    issues.extend(_ai_ops_detect_route_error_bursts(route_stats))
    return issues


def _ai_ops_autofix_key(action: str, payload: Optional[dict[str, Any]]) -> str:
    safe_action = str(action or "").strip().lower()
    safe_payload = dict(payload or {})
    try:
        payload_hash = hashlib.sha256(
            json.dumps(safe_payload, sort_keys=True, ensure_ascii=True).encode("utf-8")
        ).hexdigest()[:12]
    except Exception:
        payload_hash = hashlib.sha256(str(safe_payload).encode("utf-8")).hexdigest()[:12]
    return f"{safe_action}:{payload_hash}"


def _ai_ops_autofix_allowed(action: str, payload: Optional[dict[str, Any]]) -> bool:
    key = _ai_ops_autofix_key(action, payload)
    now_ms = _ai_ops_now_ms()
    with AI_OPS_LOCK:
        last_run = int((AI_OPS_STATE.get("lastAutoFixAtMs") or {}).get(key, 0))
    return (now_ms - last_run) >= VF_AI_OPS_AUTOFIX_COOLDOWN_MS


def _ai_ops_mark_autofix(action: str, payload: Optional[dict[str, Any]]) -> None:
    key = _ai_ops_autofix_key(action, payload)
    with AI_OPS_LOCK:
        last_runs = AI_OPS_STATE.setdefault("lastAutoFixAtMs", {})
        last_runs[key] = _ai_ops_now_ms()


def _ai_ops_execute_action(
    *,
    action: str,
    payload: Optional[dict[str, Any]] = None,
    gpu: bool = False,
    initiator: str = "system",
    approval_id: Optional[str] = None,
) -> dict[str, Any]:
    normalized_action = _ai_ops_validate_action(action)
    severity = _ai_ops_action_severity(normalized_action)
    safe_payload = dict(payload or {})
    started_ms = _ai_ops_now_ms()
    execution: dict[str, Any] = {
        "ok": False,
        "action": normalized_action,
        "severity": severity,
        "payload": safe_payload,
        "initiator": initiator,
        "approvalId": approval_id,
    }
    try:
        if normalized_action == "restart_runtime":
            engine = _normalize_engine_name(str(safe_payload.get("engine") or ""))
            command_output = _run_tts_switch_with_retry(engine, bool(gpu), retries=2, keep_others=True)
            health_url = TTS_ENGINE_HEALTH_URLS[engine]
            healthy, detail = _probe_runtime_health(health_url, timeout_sec=2.5)
            execution.update(
                {
                    "ok": bool(healthy),
                    "detail": str(detail or "unknown"),
                    "engine": engine,
                    "healthUrl": health_url,
                    "commandOutput": command_output[-500:],
                }
            )
        elif normalized_action == "refresh_gemini_pool":
            key_pool = _resolve_gemini_fallback_key_pool()
            if not key_pool:
                raise RuntimeError("Gemini key pool is empty.")
            BACKEND_GEMINI_ALLOCATOR.ensure_keys(key_pool)
            snapshot = BACKEND_GEMINI_ALLOCATOR.snapshot(key_pool)
            execution.update(
                {
                    "ok": True,
                    "detail": "Gemini key pool refreshed.",
                    "pool": snapshot.get("pool") if isinstance(snapshot, dict) else {},
                }
            )
        elif normalized_action == "enable_soft_shedding":
            duration_ms = max(5_000, min(int(safe_payload.get("durationMs", 30_000)), 300_000))
            until_ms = _ai_ops_now_ms() + duration_ms
            with AI_OPS_LOCK:
                AI_OPS_STATE["temporarySheddingUntilMs"] = max(
                    int(AI_OPS_STATE.get("temporarySheddingUntilMs", 0)),
                    until_ms,
                )
            execution.update(
                {
                    "ok": True,
                    "detail": "Soft traffic shedding enabled.",
                    "durationMs": duration_ms,
                    "untilMs": until_ms,
                }
            )
        elif normalized_action == "restart_all_runtimes":
            items: list[dict[str, Any]] = []
            overall_ok = True
            for engine in ["GEM", "KOKORO"]:
                try:
                    command_output = _run_tts_switch_with_retry(engine, bool(gpu), retries=2, keep_others=True)
                    healthy, detail = _probe_runtime_health(TTS_ENGINE_HEALTH_URLS[engine], timeout_sec=2.5)
                    item_ok = bool(healthy)
                    overall_ok = overall_ok and item_ok
                    items.append(
                        {
                            "engine": engine,
                            "ok": item_ok,
                            "detail": str(detail or "unknown"),
                            "commandOutput": command_output[-500:],
                        }
                    )
                except Exception as exc:  # noqa: BLE001
                    overall_ok = False
                    items.append(
                        {
                            "engine": engine,
                            "ok": False,
                            "detail": str(exc),
                            "commandOutput": "",
                        }
                    )
            execution.update(
                {
                    "ok": overall_ok,
                    "detail": "All runtimes restart attempted.",
                    "services": items,
                }
            )
        elif normalized_action == "set_maintenance_mode":
            enabled = bool(safe_payload.get("enabled", True))
            with AI_OPS_LOCK:
                AI_OPS_STATE["maintenanceMode"] = bool(enabled)
            execution.update(
                {
                    "ok": True,
                    "detail": "Maintenance mode updated.",
                    "maintenanceMode": bool(enabled),
                }
            )
    except Exception as exc:  # noqa: BLE001
        execution["ok"] = False
        execution["detail"] = str(exc)
    finally:
        finished_ms = _ai_ops_now_ms()
        execution["durationMs"] = max(0, finished_ms - started_ms)
        execution["timestampMs"] = finished_ms
        _ai_ops_append_action_history(execution)
    return execution


def _ai_ops_admin_authorized(request: Request, admin_token: Optional[str]) -> tuple[bool, str, str]:
    uid = _require_request_uid(request)
    provided_token = str(admin_token or "").strip()
    if not VF_ADMIN_APPROVER_UIDS:
        return False, uid, "admin_uid_allowlist_not_configured"
    if uid not in VF_ADMIN_APPROVER_UIDS:
        return False, uid, "uid_not_allowlisted"
    if not VF_ADMIN_APPROVAL_TOKEN:
        return False, uid, "admin_token_not_configured"
    if provided_token != VF_ADMIN_APPROVAL_TOKEN:
        return False, uid, "invalid_admin_token"
    return True, uid, "authorized"


def _ai_ops_list_approvals(status: str = "pending") -> list[dict[str, Any]]:
    filter_token = str(status or "pending").strip().lower()
    with AI_OPS_LOCK:
        approvals = AI_OPS_STATE.get("pendingApprovals") if isinstance(AI_OPS_STATE.get("pendingApprovals"), dict) else {}
        order = list(AI_OPS_STATE.get("approvalOrder") or [])
        result: list[dict[str, Any]] = []
        for approval_id in reversed(order):
            item = approvals.get(approval_id)
            if not isinstance(item, dict):
                continue
            item_status = str(item.get("status") or "").lower()
            if filter_token != "all" and item_status != filter_token:
                continue
            result.append(dict(item))
        return result


def _ai_ops_get_approval(approval_id: str) -> Optional[dict[str, Any]]:
    with AI_OPS_LOCK:
        approvals = AI_OPS_STATE.get("pendingApprovals") if isinstance(AI_OPS_STATE.get("pendingApprovals"), dict) else {}
        item = approvals.get(approval_id)
        if not isinstance(item, dict):
            return None
        return dict(item)


def _ai_ops_record_frontend_error(uid: str, payload: FrontendErrorReportRequest) -> dict[str, Any]:
    message = str(payload.message or "").strip()
    if not message:
        raise ValueError("message is required.")
    severity = str(payload.severity or "error").strip().lower()
    if severity not in {"info", "warning", "error", "critical"}:
        severity = "error"
    item = {
        "id": f"ferr_{uuid.uuid4().hex[:12]}",
        "ts": _ai_ops_now_ms(),
        "uid": str(uid or ""),
        "message": message[:400],
        "route": str(payload.route or "").strip()[:120],
        "component": str(payload.component or "").strip()[:120],
        "severity": severity,
        "stack": str(payload.stack or "").strip()[:1200],
        "metadata": payload.metadata if isinstance(payload.metadata, dict) else {},
    }
    with AI_OPS_LOCK:
        items = AI_OPS_STATE.setdefault("frontendErrors", [])
        items.append(item)
        _ai_ops_trim_list_locked(items, VF_AI_OPS_MAX_FRONTEND_ERRORS)
    return item


def _ai_ops_build_status(*, include_route_stats: bool = False) -> dict[str, Any]:
    with AI_OPS_LOCK:
        in_flight = int(AI_OPS_STATE.get("inFlightTotal", 0))
        in_flight_peak = int(AI_OPS_STATE.get("inFlightPeak", 0))
        maintenance_mode = bool(AI_OPS_STATE.get("maintenanceMode", False))
        temporary_shedding_until_ms = int(AI_OPS_STATE.get("temporarySheddingUntilMs", 0))
    route_stats_with_recent = _ai_ops_route_stats_snapshot(include_recent_statuses=True)
    runtimes = _ai_ops_runtime_snapshot()
    gemini_pool = _ai_ops_gemini_pool_snapshot()
    concurrency = {
        "mode": VF_AI_OPS_MODE,
        "inFlight": in_flight,
        "peakInFlight": in_flight_peak,
        "softLimit": VF_AI_OPS_CONCURRENCY_SOFT_LIMIT,
        "hardLimit": VF_AI_OPS_CONCURRENCY_HARD_LIMIT,
        "maintenanceMode": maintenance_mode,
        "temporarySheddingUntilMs": temporary_shedding_until_ms,
    }
    issues = _ai_ops_detect_issues(
        runtime_snapshot=runtimes,
        gemini_snapshot=gemini_pool,
        route_stats=route_stats_with_recent,
        concurrency=concurrency,
    )
    major_issue = any(str(item.get("severity") or "") == "major" for item in issues)
    response: dict[str, Any] = {
        "ok": not maintenance_mode and not major_issue,
        "timestampMs": _ai_ops_now_ms(),
        "mode": VF_AI_OPS_MODE,
        "concurrency": concurrency,
        "runtimes": runtimes,
        "geminiPool": gemini_pool,
        "issues": issues,
        "pendingApprovalCount": _ai_ops_pending_approval_count(),
        "recentErrors": _ai_ops_recent_errors_snapshot(),
        "recentFrontendErrors": _ai_ops_recent_frontend_errors_snapshot(),
    }
    if include_route_stats:
        route_stats_for_api: dict[str, Any] = {}
        for path, item in route_stats_with_recent.items():
            copied = dict(item)
            copied.pop("recentStatuses", None)
            route_stats_for_api[path] = copied
        response["routeStats"] = route_stats_for_api
    return response


def _normalize_engine_name(raw_engine: str) -> str:
    normalized = "".join(ch if ch.isalnum() else "_" for ch in (raw_engine or "").strip().upper())
    while "__" in normalized:
        normalized = normalized.replace("__", "_")
    normalized = normalized.strip("_")
    engine = TTS_ENGINE_ALIASES.get(normalized)
    if not engine:
        raise ValueError("Invalid engine. Use GEM or KOKORO.")
    return engine


def _runtime_url_for_engine(engine: str) -> str:
    normalized = _normalize_engine_name(engine)
    if normalized == "GEM":
        return GEMINI_RUNTIME_URL
    return KOKORO_RUNTIME_URL


def _runtime_synthesize_path_for_engine(engine: str) -> str:
    _normalize_engine_name(engine)
    return "/synthesize"


def _stripe_price_id_for_plan(plan: str) -> str:
    token = str(plan or "").strip().lower()
    if token == "pro":
        return STRIPE_PRICE_PRO_INR
    if token == "plus":
        return STRIPE_PRICE_PLUS_INR
    return ""


def _entitlement_from_price_id(price_id: str) -> dict[str, Any]:
    token = str(price_id or "").strip()
    if token and token == STRIPE_PRICE_PRO_INR:
        return {
            "plan": PLAN_LIMITS["pro"]["plan"],
            "monthlyVfLimit": PLAN_LIMITS["pro"]["monthlyVfLimit"],
            "dailyGenerationLimit": PLAN_LIMITS["pro"]["dailyGenerationLimit"],
        }
    if token and token == STRIPE_PRICE_PLUS_INR:
        return {
            "plan": PLAN_LIMITS["plus"]["plan"],
            "monthlyVfLimit": PLAN_LIMITS["plus"]["monthlyVfLimit"],
            "dailyGenerationLimit": PLAN_LIMITS["plus"]["dailyGenerationLimit"],
        }
    return {
        "plan": PLAN_LIMITS["free"]["plan"],
        "monthlyVfLimit": PLAN_LIMITS["free"]["monthlyVfLimit"],
        "dailyGenerationLimit": PLAN_LIMITS["free"]["dailyGenerationLimit"],
    }


def _resolve_checkout_url_override(candidate: Optional[str], fallback: str) -> str:
    value = str(candidate or "").strip()
    if not value:
        return fallback
    return value


def _token_pack_amount_inr_for_plan(plan_name: str) -> int:
    plan_key = _plan_key_from_name(plan_name)
    discount = 0.0
    if plan_key == "pro":
        discount = 0.10
    elif plan_key == "plus":
        discount = 0.20
    return _round_inr(VF_TOKEN_PACK_BASE_INR * (1.0 - discount))


def _parse_optional_datetime(raw: Optional[str]) -> Optional[datetime]:
    token = str(raw or "").strip()
    if not token:
        return None
    try:
        normalized = token.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def _normalize_coupon_code(raw_code: str) -> str:
    token = str(raw_code or "").strip().upper()
    token = re.sub(r"[^A-Z0-9_-]", "", token)
    return token[:64]


def _credit_paid_vf(
    *,
    uid: str,
    amount: int,
    reason: str,
    transaction_id: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> tuple[bool, dict[str, Any]]:
    safe_uid = str(uid or "").strip()
    credit_amount = _as_positive_int(amount)
    if not safe_uid or credit_amount <= 0:
        return False, _load_entitlement(safe_uid or "")
    now = _utc_now()
    tx_id = str(transaction_id or "").strip()
    tx_payload = {
        "uid": safe_uid,
        "kind": "credit",
        "bucket": "paidVF",
        "amount": credit_amount,
        "reason": str(reason or "credit"),
        "metadata": metadata or {},
        "createdAt": now.isoformat(),
    }

    transactions = _firestore_collection("wallet_transactions")
    entitlements = _firestore_collection("entitlements")
    if transactions is None or entitlements is None or _FIRESTORE_DB is None or firebase_firestore is None:
        with _INMEMORY_LOCK:
            if tx_id and tx_id in _INMEMORY_WALLET_TRANSACTIONS:
                return False, _normalize_entitlement_wallet(_INMEMORY_ENTITLEMENTS.get(safe_uid) or _default_entitlement(safe_uid))
            entitlement = _normalize_entitlement_wallet(_INMEMORY_ENTITLEMENTS.get(safe_uid) or _default_entitlement(safe_uid), now)
            entitlement["paidVfBalance"] = _as_positive_int(entitlement.get("paidVfBalance")) + credit_amount
            entitlement["updatedAt"] = now.isoformat()
            _INMEMORY_ENTITLEMENTS[safe_uid] = entitlement
            if tx_id:
                _INMEMORY_WALLET_TRANSACTIONS[tx_id] = {**tx_payload, "id": tx_id}
            return True, entitlement

    ent_ref = _FIRESTORE_DB.collection("entitlements").document(safe_uid)
    tx_ref = _FIRESTORE_DB.collection("wallet_transactions").document(tx_id or f"wallet_{uuid.uuid4().hex}")
    transaction = _FIRESTORE_DB.transaction()

    @firebase_firestore.transactional
    def _apply(transaction_obj: Any) -> tuple[bool, dict[str, Any]]:
        if tx_id:
            existing_tx = tx_ref.get(transaction=transaction_obj)
            if existing_tx.exists:
                current_doc = ent_ref.get(transaction=transaction_obj)
                current_ent = _normalize_entitlement_wallet(
                    current_doc.to_dict() if current_doc.exists else _default_entitlement(safe_uid),
                    now,
                )
                return False, current_ent

        ent_doc = ent_ref.get(transaction=transaction_obj)
        entitlement = _normalize_entitlement_wallet(ent_doc.to_dict() if ent_doc.exists else _default_entitlement(safe_uid), now)
        entitlement["paidVfBalance"] = _as_positive_int(entitlement.get("paidVfBalance")) + credit_amount
        entitlement["updatedAt"] = now.isoformat()
        transaction_obj.set(ent_ref, entitlement, merge=True)
        transaction_obj.set(tx_ref, {**tx_payload, "id": tx_ref.id}, merge=True)
        return True, entitlement

    return _apply(transaction)


def _normalize_conversion_policy(raw_policy: str, default: str = "AUTO_RELIABLE") -> str:
    token = str(raw_policy or "").strip().upper().replace("-", "_")
    if token in {"AUTO_ROUTE", "LHQ_PILOT"}:
        token = "AUTO_RELIABLE"
    if token not in VOICE_CONVERSION_POLICIES:
        return default
    return token


def _resolve_runtime_log_service(raw_service: str) -> str:
    key = str(raw_service or "").strip().lower().replace("_", "-")
    service = RUNTIME_LOG_ALIASES.get(key)
    if not service:
        allowed = ", ".join(sorted(RUNTIME_LOG_FILES.keys()))
        raise ValueError(f"Invalid service. Allowed: {allowed}")
    return service


def _best_effort_git_sha() -> Optional[str]:
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(PROJECT_ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=2,
        )
        if proc.returncode != 0:
            return None
        value = (proc.stdout or "").strip()
        return value or None
    except Exception:
        return None


def _normalize_target_language(raw_language: str) -> str:
    token = str(raw_language or "").strip().lower()
    if not token:
        return "auto"
    token = token.replace("_", "-")
    if token in LANGUAGE_CODE_ALIASES:
        return LANGUAGE_CODE_ALIASES[token]
    if token in SUPPORTED_TRANSCRIBE_LANGUAGE_CODES:
        return token
    prefix = token.split("-", 1)[0]
    if prefix in LANGUAGE_CODE_ALIASES:
        return LANGUAGE_CODE_ALIASES[prefix]
    if prefix in SUPPORTED_TRANSCRIBE_LANGUAGE_CODES:
        return prefix
    return prefix if prefix else "auto"


def _run_tts_switch(engine: str, gpu_mode: bool, keep_others: bool = False) -> str:
    if not BOOTSTRAP_SCRIPT.exists():
        raise RuntimeError(f"Missing bootstrap script at {BOOTSTRAP_SCRIPT}")

    cmd = [NODE_BIN, str(BOOTSTRAP_SCRIPT), "switch", engine]
    if gpu_mode:
        cmd.append("--gpu")
    if keep_others:
        cmd.append("--keep-others")

    proc = subprocess.run(
        cmd,
        cwd=str(PROJECT_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=120,
    )
    if proc.returncode != 0:
        detail = proc.stderr.strip() or proc.stdout.strip() or "switch command failed"
        raise RuntimeError(detail)
    return proc.stdout.strip()


def _run_tts_switch_with_retry(
    engine: str,
    gpu_mode: bool,
    retries: int = 2,
    keep_others: bool = False,
) -> str:
    safe_retries = max(1, int(retries))
    failures: list[str] = []
    for attempt in range(1, safe_retries + 1):
        try:
            return _run_tts_switch(engine, gpu_mode, keep_others=keep_others)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"attempt {attempt}: {exc}")
            if attempt >= safe_retries:
                break
    raise RuntimeError(" | ".join(failures))


def _probe_runtime_health(url: str, timeout_sec: float = 2.5) -> tuple[bool, str]:
    req = urllib_request.Request(url, method="GET", headers={"Accept": "application/json"})
    try:
        with urllib_request.urlopen(req, timeout=timeout_sec) as response:
            payload_bytes = response.read()
            payload: Any = None
            if payload_bytes:
                try:
                    payload = json.loads(payload_bytes.decode("utf-8"))
                except Exception:
                    payload = payload_bytes.decode("utf-8", errors="replace")
            if isinstance(payload, dict):
                if payload.get("status") == "healthy":
                    return True, "Runtime online"
                if payload.get("ok") is True:
                    return True, "Runtime online"
            return True, "Runtime responding"
    except urllib_error.URLError as exc:
        reason = getattr(exc, "reason", None)
        return False, str(reason or exc)
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


def _wait_for_runtime_online(
    url: str,
    timeout_ms: int,
    poll_interval_ms: int = DUBBING_PREPARE_POLL_INTERVAL_MS,
) -> tuple[bool, str, int]:
    safe_timeout_ms = max(0, int(timeout_ms))
    safe_poll_ms = max(250, int(poll_interval_ms))
    started_at = int(time.time() * 1000)
    waited_ms = 0
    last_detail = "Runtime is still starting."
    while waited_ms <= safe_timeout_ms:
        online, detail = _probe_runtime_health(url, timeout_sec=2.5)
        last_detail = detail
        if online:
            return True, detail, waited_ms
        if waited_ms >= safe_timeout_ms:
            break
        time.sleep(min(safe_poll_ms, max(0, safe_timeout_ms - waited_ms)) / 1000.0)
        waited_ms = max(0, int(time.time() * 1000) - started_at)
    return False, last_detail, waited_ms


def _fetch_runtime_json(url: str, timeout_sec: float = 3.0) -> tuple[bool, Any, str]:
    req = urllib_request.Request(url, method="GET", headers={"Accept": "application/json"})
    try:
        with urllib_request.urlopen(req, timeout=timeout_sec) as response:
            body = response.read()
            if not body:
                return False, None, "empty response"
            payload = json.loads(body.decode("utf-8"))
            return True, payload, "ok"
    except urllib_error.HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8", errors="replace")
        except Exception:
            detail = str(exc)
        return False, None, f"http {exc.code}: {detail}"
    except Exception as exc:  # noqa: BLE001
        return False, None, str(exc)


def _capability_fallback(engine: str, health_payload: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    ready = bool((health_payload or {}).get("ok", False))
    runtime = str((health_payload or {}).get("engine", "")).strip() or f"{engine.lower()}-runtime"
    model = (health_payload or {}).get("model")
    default_chunking: dict[str, Any]
    if engine == "KOKORO":
        default_chunking = {
            "hi": {"hard_char_cap": 160, "target_char_cap": 130, "max_words_per_chunk": 30},
            "default": {"hard_char_cap": 220, "target_char_cap": 180, "max_words_per_chunk": 45},
        }
    else:
        default_chunking = {
            "hi": {"hard_char_cap": 620, "target_char_cap": 420, "max_words_per_chunk": 80},
            "default": {"hard_char_cap": 620, "target_char_cap": 420, "max_words_per_chunk": 80},
        }
    return {
        "engine": engine,
        "runtime": runtime,
        "ready": ready,
        "languages": ["en", "hi"] if engine == "KOKORO" else ["multilingual"],
        "speed": {"min": 0.7, "max": 1.35, "default": 1.0},
        "supportsEmotion": engine == "KOKORO",
        "supportsStyle": False,
        "supportsSpeakerWav": False,
        "model": model,
        "voiceCount": (health_payload or {}).get("voiceCount"),
        "emotionCount": (health_payload or {}).get("emotionCount"),
        "metadata": {
            "source": "fallback",
            "maxWordsPerRequest": 5000,
            "segmentationProfile": "quality-first",
            "chunking": default_chunking,
        },
    }


def _probe_runtime_capabilities(engine: str, timeout_sec: float = 3.0) -> dict[str, Any]:
    capabilities_url = TTS_ENGINE_CAPABILITIES_URLS[engine]
    health_url = TTS_ENGINE_HEALTH_URLS[engine]
    cap_ok, cap_payload, cap_detail = _fetch_runtime_json(capabilities_url, timeout_sec=timeout_sec)
    if cap_ok and isinstance(cap_payload, dict):
        payload = dict(cap_payload)
        payload["engine"] = str(payload.get("engine") or engine)
        payload.setdefault("runtime", f"{engine.lower()}-runtime")
        payload.setdefault("ready", True)
        payload.setdefault("metadata", {})
        metadata = payload["metadata"] if isinstance(payload["metadata"], dict) else {}
        metadata["source"] = "runtime"
        payload["metadata"] = metadata
        return payload

    health_ok, health_payload, health_detail = _fetch_runtime_json(health_url, timeout_sec=timeout_sec)
    if health_ok and isinstance(health_payload, dict):
        fallback = _capability_fallback(engine, health_payload=health_payload)
        fallback_metadata = fallback.get("metadata", {})
        if isinstance(fallback_metadata, dict):
            fallback_metadata["capabilityProbeError"] = cap_detail
            fallback["metadata"] = fallback_metadata
        return fallback

    fallback = _capability_fallback(engine, health_payload=None)
    fallback["ready"] = False
    fallback_metadata = fallback.get("metadata", {})
    if isinstance(fallback_metadata, dict):
        fallback_metadata["capabilityProbeError"] = cap_detail
        fallback_metadata["healthProbeError"] = health_detail
        fallback["metadata"] = fallback_metadata
    return fallback


def _build_source_separation_cache_key(source_path: Path, model_name: str) -> str:
    source_hash = _hash_file(source_path)
    seed = f"{source_hash}:{model_name}:{SEPARATION_SAMPLE_RATE}:{SEPARATION_DEVICE}".encode("utf-8")
    return hashlib.sha256(seed).hexdigest()[:40]


def _ensure_source_separation(source_path: Path, model_name: str) -> tuple[Path, Path, str]:
    if not source_separation_runtime.ensure_available():
        raise RuntimeError(source_separation_runtime.import_error or "Demucs runtime unavailable.")

    normalized_model = (model_name or "").strip() or SEPARATION_MODEL
    cache_key = _build_source_separation_cache_key(source_path, normalized_model)
    cache_dir = SEPARATION_CACHE_DIR / cache_key
    speech_path = cache_dir / "speech.wav"
    background_path = cache_dir / "background.wav"
    meta_path = cache_dir / "meta.json"

    if speech_path.exists() and background_path.exists():
        return speech_path, background_path, cache_key

    with source_separation_lock:
        if speech_path.exists() and background_path.exists():
            return speech_path, background_path, cache_key

        temp_dir = tempfile.mkdtemp(prefix="vf_separate_")
        prepared_wav_path = Path(temp_dir) / "input.wav"
        speech_raw_path = Path(temp_dir) / "speech_raw.wav"
        background_raw_path = Path(temp_dir) / "background_raw.wav"
        try:
            _convert_media_to_wav(
                str(source_path),
                str(prepared_wav_path),
                sample_rate=SEPARATION_SAMPLE_RATE,
                channels=2,
            )
            import soundfile as sf  # type: ignore
            import torch as th  # type: ignore
            from demucs.apply import apply_model  # type: ignore
            from demucs.separate import load_track  # type: ignore

            model = source_separation_runtime.get_model(normalized_model)
            model.cpu()
            model.eval()

            device = SEPARATION_DEVICE.lower()
            if not device or device == "auto":
                device = "cuda" if th.cuda.is_available() else "cpu"
            if device.startswith("cuda") and not th.cuda.is_available():
                device = "cpu"

            wav = load_track(prepared_wav_path, model.audio_channels, model.samplerate)
            ref = wav.mean(0)
            ref_mean = ref.mean()
            ref_std = ref.std()
            safe_std = ref_std if float(ref_std) > 1e-6 else th.tensor(1.0, dtype=wav.dtype, device=wav.device)
            wav = (wav - ref_mean) / safe_std
            sources = apply_model(
                model,
                wav[None],
                device=device,
                shifts=1,
                split=True,
                overlap=0.25,
                progress=False,
                num_workers=0,
                segment=None,
            )[0]
            sources = sources * safe_std + ref_mean

            source_names = [str(name) for name in getattr(model, "sources", [])]
            if "vocals" not in source_names:
                raise RuntimeError(f"Demucs model '{normalized_model}' does not expose a vocals source.")
            vocals_index = source_names.index("vocals")
            vocals_tensor = sources[vocals_index]
            background_tensor = th.zeros_like(vocals_tensor)
            for idx, source_name in enumerate(source_names):
                if idx == vocals_index:
                    continue
                if source_name == "vocals":
                    continue
                background_tensor += sources[idx]

            vocals_np = vocals_tensor.detach().cpu().transpose(0, 1).numpy()
            background_np = background_tensor.detach().cpu().transpose(0, 1).numpy()
            sf.write(str(speech_raw_path), vocals_np, model.samplerate, subtype="PCM_16")
            sf.write(str(background_raw_path), background_np, model.samplerate, subtype="PCM_16")

            cache_dir.mkdir(parents=True, exist_ok=True)
            _convert_media_to_wav(str(speech_raw_path), str(speech_path), sample_rate=48000, channels=1)
            _convert_media_to_wav(str(background_raw_path), str(background_path), sample_rate=48000, channels=2)
            meta_payload = {
                "model": normalized_model,
                "device": device,
                "sampleRate": 48000,
                "cacheKey": cache_key,
                "updatedAt": datetime.now(timezone.utc).isoformat(),
            }
            meta_path.write_text(json.dumps(meta_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            _cleanup_paths(str(cache_dir))
            raise
        finally:
            _cleanup_paths(temp_dir)

    return speech_path, background_path, cache_key


def _normalize_novel_source(raw_source: str) -> str:
    source = (raw_source or "").strip().lower()
    if source not in NOVEL_IDEA_ALLOWED_HOSTS:
        raise ValueError("Invalid source. Use 'webnovel' or 'pocketnovel'.")
    return source


def _host_matches_allowed(hostname: str, allowed_roots: tuple[str, ...]) -> bool:
    host = (hostname or "").lower().strip(".")
    if not host:
        return False
    for root in allowed_roots:
        base = root.lower()
        if host == base or host.endswith(f".{base}"):
            return True
    return False


def _clean_meta_text(value: str, max_len: int = 1200) -> str:
    if not value:
        return ""
    text = " ".join(str(value).split())
    return text[:max_len].strip()


def _extract_meta_content(soup: BeautifulSoup, selectors: list[dict[str, str]]) -> str:
    for attrs in selectors:
        tag = soup.find("meta", attrs=attrs)
        if tag:
            content = _clean_meta_text(tag.get("content", ""))
            if content:
                return content
    return ""


def _resolve_novel_import_hint(format_hint: str, content_type: str, filename: str) -> str:
    hint = (format_hint or "").strip().lower()
    if hint in {"txt", "pdf", "image"}:
        return hint

    mime = (content_type or "").strip().lower()
    guessed, _ = mimetypes.guess_type(filename or "")
    effective_mime = mime or (guessed or "")
    if effective_mime == "application/pdf":
        return "pdf"
    if effective_mime.startswith("text/"):
        return "txt"
    if effective_mime.startswith("image/"):
        return "image"
    lower_name = (filename or "").strip().lower()
    if lower_name.endswith(".txt"):
        return "txt"
    if lower_name.endswith(".pdf"):
        return "pdf"
    if lower_name.endswith((".png", ".jpg", ".jpeg", ".webp")):
        return "image"
    return "unknown"


def _get_local_ocr_engine() -> Any:
    global _LOCAL_OCR_ENGINE
    if _LOCAL_OCR_ENGINE is not None:
        return _LOCAL_OCR_ENGINE
    if not ENABLE_LOCAL_OCR:
        raise RuntimeError("Local OCR is disabled.")
    if RapidOCR is None:
        raise RuntimeError("rapidocr-onnxruntime is not installed.")
    _LOCAL_OCR_ENGINE = RapidOCR()
    return _LOCAL_OCR_ENGINE


def _extract_text_with_local_ocr(media_bytes: bytes) -> str:
    if Image is None:
        raise RuntimeError("Pillow is not installed.")
    try:
        import numpy as np  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"numpy import failed: {exc}") from exc

    image = Image.open(BytesIO(media_bytes)).convert("RGB")
    image_array = np.array(image)
    ocr_engine = _get_local_ocr_engine()
    result = ocr_engine(image_array)
    lines = result[0] if isinstance(result, tuple) else result
    if not isinstance(lines, list):
        raise RuntimeError("Local OCR returned invalid result.")

    extracted_lines: list[str] = []
    for line in lines:
        if isinstance(line, (list, tuple)) and len(line) >= 2:
            text = str(line[1] or "").strip()
            if text:
                extracted_lines.append(text)
    merged = "\n".join(extracted_lines).strip()
    if not merged:
        raise RuntimeError("Local OCR returned empty text.")
    return merged


def _resolve_gemini_keys_file_path(path_hint: str) -> Path:
    raw_hint = str(path_hint or "").strip()
    candidates: list[Path] = []
    if raw_hint:
        hint_path = Path(raw_hint).expanduser()
        if hint_path.is_absolute():
            candidates.append(hint_path)
        else:
            candidates.append(APP_ROOT / hint_path)
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


def _read_gemini_keys_from_file(path_hint: str) -> list[str]:
    target = _resolve_gemini_keys_file_path(path_hint)
    try:
        if not target.exists() or not target.is_file():
            return []
        raw = target.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return []
    return parse_api_keys_shared(raw)


def _gemini_pool_source_diagnostics() -> dict[str, Any]:
    configured_file_path = str(os.getenv("GEMINI_API_KEYS_FILE") or GEMINI_API_KEYS_FILE).strip()
    resolved_file_path = _resolve_gemini_keys_file_path(configured_file_path)
    pools_file_path = _resolve_gemini_api_pools_file_path()
    file_item_count = 0
    file_exists = False
    if str(resolved_file_path):
        file_exists = resolved_file_path.exists() and resolved_file_path.is_file()
        if file_exists:
            file_item_count = len(_read_gemini_keys_from_file(str(resolved_file_path)))
    env_pool_count = len(parse_api_keys_shared(str(os.getenv("GEMINI_API_KEYS") or "").strip()))
    single_key_present = bool(str(os.getenv("GEMINI_API_KEY") or "").strip() or str(os.getenv("API_KEY") or "").strip())
    return {
        "configuredFilePath": configured_file_path,
        "filePath": str(resolved_file_path),
        "fileExists": file_exists,
        "fileKeyCount": file_item_count,
        "envPoolKeyCount": env_pool_count,
        "singleKeyPresent": single_key_present,
        "poolsFilePath": str(pools_file_path),
        "poolsFileExists": bool(pools_file_path.exists() and pools_file_path.is_file()),
    }


def _legacy_gemini_key_pool() -> list[str]:
    raw_pool = str(os.getenv("GEMINI_API_KEYS") or "").strip()
    file_pool = _read_gemini_keys_from_file(str(os.getenv("GEMINI_API_KEYS_FILE") or GEMINI_API_KEYS_FILE).strip())
    candidates: list[str] = []
    seen: set[str] = set()
    for token in [
        *parse_api_keys_shared(raw_pool),
        *file_pool,
        os.getenv("VF_GEMINI_API_KEY") or "",
        os.getenv("GEMINI_API_KEY") or "",
        os.getenv("API_KEY") or "",
    ]:
        key = str(token or "").strip()
        if not key or key in seen:
            continue
        if not parse_api_keys_shared(key):
            continue
        seen.add(key)
        candidates.append(key)
    return candidates


def _resolve_gemini_api_pools_file_path() -> Path:
    raw_hint = str(os.getenv("GEMINI_API_POOLS_FILE") or GEMINI_API_POOLS_FILE).strip()
    if not raw_hint:
        return (APP_ROOT / "config" / "gemini_api_pools.json").resolve()
    hint_path = Path(raw_hint).expanduser()
    if hint_path.is_absolute():
        return hint_path.resolve()
    candidate = (APP_ROOT / hint_path).resolve()
    if candidate.exists():
        return candidate
    return (WORKSPACE_ROOT / hint_path).resolve()


def _sync_authoritative_gemini_free_pool(
    config: dict[str, Any],
) -> tuple[dict[str, Any], bool, list[str]]:
    configured_file_path = str(os.getenv("GEMINI_API_KEYS_FILE") or GEMINI_API_KEYS_FILE).strip()
    if configured_file_path:
        candidate = Path(configured_file_path).expanduser()
        if candidate.is_absolute():
            resolved_file_path = candidate.resolve()
        else:
            app_candidate = (APP_ROOT / candidate).resolve()
            resolved_file_path = app_candidate if app_candidate.exists() else (WORKSPACE_ROOT / candidate).resolve()
    else:
        resolved_file_path = DEFAULT_GEMINI_API_KEYS_FILE.resolve()
    file_exists = False
    file_keys: list[str] = []
    try:
        file_exists = bool(resolved_file_path.exists() and resolved_file_path.is_file())
        if file_exists:
            file_keys = parse_api_keys_shared(
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


def _load_gemini_api_pools(force: bool = False) -> tuple[dict[str, Any], dict[str, Any]]:
    global _GEMINI_POOLS_CACHE, _GEMINI_POOLS_META
    with _GEMINI_POOLS_LOCK:
        if not force and isinstance(_GEMINI_POOLS_CACHE, dict):
            return dict(_GEMINI_POOLS_CACHE), dict(_GEMINI_POOLS_META)

        file_path = _resolve_gemini_api_pools_file_path()
        bootstrap_keys = _legacy_gemini_key_pool()
        firestore_db = _FIRESTORE_DB if GEMINI_API_POOLS_PREFER_FIRESTORE else None
        config, meta = load_pool_config_shared(
            file_path=file_path,
            firestore_db=firestore_db,
            prefer_firestore=GEMINI_API_POOLS_PREFER_FIRESTORE,
            bootstrap_free_keys=bootstrap_keys,
        )
        if not flatten_pool_keys(config) and bootstrap_keys:
            config = normalize_gemini_pool_config(config)
            config["pools"]["free"]["keys"] = list(bootstrap_keys)
        sync_warnings: list[str] = []
        config, synced_changed, sync_warnings = _sync_authoritative_gemini_free_pool(config)
        if synced_changed:
            try:
                config = save_pool_config_shared(
                    file_path=file_path,
                    config=config,
                    firestore_db=firestore_db,
                )
            except Exception:
                sync_warnings.append(
                    "Authoritative free-pool sync could not be persisted; using in-memory pool config."
                )
        meta = dict(meta if isinstance(meta, dict) else {})
        meta["warnings"] = list(sync_warnings)
        meta["sourcePolicy"] = dict(config.get("sourcePolicy") or {})
        _GEMINI_POOLS_CACHE = dict(config)
        _GEMINI_POOLS_META = dict(meta)
        return dict(_GEMINI_POOLS_CACHE), dict(_GEMINI_POOLS_META)


def _save_gemini_api_pools(config: dict[str, Any]) -> dict[str, Any]:
    file_path = _resolve_gemini_api_pools_file_path()
    firestore_db = _FIRESTORE_DB if GEMINI_API_POOLS_PREFER_FIRESTORE else None
    saved = save_pool_config_shared(
        file_path=file_path,
        config=config,
        firestore_db=firestore_db,
    )
    with _GEMINI_POOLS_LOCK:
        global _GEMINI_POOLS_CACHE, _GEMINI_POOLS_META
        _GEMINI_POOLS_CACHE = dict(saved)
        source_policy = dict(saved.get("sourcePolicy") or {})
        warnings: list[str] = []
        status_token = str(source_policy.get("lastSyncStatus") or "").strip().lower()
        if status_token.startswith("warning_"):
            warnings.append(
                "Authoritative free-pool file has issues; service kept the last good free pool."
            )
        _GEMINI_POOLS_META = {
            "source": "save",
            "filePath": str(file_path),
            "fileExists": bool(file_path.exists() and file_path.is_file()),
            "firestoreError": "",
            "warnings": warnings,
            "sourcePolicy": source_policy,
        }
    return saved


def _resolve_gemini_fallback_key_pool() -> list[str]:
    config, meta = _load_gemini_api_pools()
    source = str((meta or {}).get("source") or "").strip().lower()
    if source in {"default", "bootstrap"}:
        legacy = _legacy_gemini_key_pool()
        if legacy:
            return legacy
    keys = resolve_effective_pool_keys(config, "pro_plus")
    if keys:
        return keys
    return _legacy_gemini_key_pool()


def _resolve_gemini_plan_key_pool(plan_key: str) -> list[str]:
    config, _meta = _load_gemini_api_pools()
    pool_hint = plan_key_to_pool_hint(plan_key)
    keys = resolve_effective_pool_keys(config, pool_hint)
    if keys:
        return keys
    return _resolve_gemini_fallback_key_pool()


def _gemini_pools_validation(config: dict[str, Any]) -> dict[str, Any]:
    duplicates = duplicate_key_memberships(config)
    unique_required = bool((config.get("constraints") or {}).get("uniqueKeyMembership", True))
    return {
        "uniqueKeyMembership": unique_required,
        "duplicateKeys": duplicates,
        "isValid": not (unique_required and bool(duplicates)),
    }


def _backend_gemini_pool_snapshot() -> dict[str, Any]:
    config, config_meta = _load_gemini_api_pools()
    key_pool = resolve_effective_pool_keys(config, "pro_plus")
    if not key_pool:
        return {
            "ok": True,
            "pool": {"keyCount": 0, "healthyKeys": 0, "unhealthyKeys": 0, "atLimitKeys": 0},
            "keys": [],
            "models": [],
            "source": _gemini_pool_source_diagnostics(),
            "config": config,
            "configMeta": config_meta,
            "validation": _gemini_pools_validation(config),
        }
    BACKEND_GEMINI_ALLOCATOR.ensure_keys(key_pool)
    snapshot = BACKEND_GEMINI_ALLOCATOR.snapshot(key_pool)
    payload = dict(snapshot if isinstance(snapshot, dict) else {})
    payload["ok"] = True
    payload["source"] = _gemini_pool_source_diagnostics()
    payload["config"] = config
    payload["configMeta"] = config_meta
    payload["validation"] = _gemini_pools_validation(config)
    pools = config.get("pools") if isinstance(config.get("pools"), dict) else {}
    payload["poolSummaries"] = {
        pool_name: {
            "pool": pool_name,
            "directKeyCount": len(list((pools.get(pool_name) or {}).get("keys") or [])),
            "effectiveKeyCount": len(resolve_effective_pool_keys(config, pool_name)),
            "chain": list((config.get("fallbackChains") or {}).get(pool_name) or []),
        }
        for pool_name in POOL_NAMES
    }
    return payload


def _backend_gemini_pool_usage_snapshot() -> dict[str, Any]:
    config, config_meta = _load_gemini_api_pools()
    pools = config.get("pools") if isinstance(config.get("pools"), dict) else {}
    usage_payload: dict[str, Any] = {}
    for pool_name in POOL_NAMES:
        direct_keys = list((pools.get(pool_name) or {}).get("keys") or [])
        effective_keys = resolve_effective_pool_keys(config, pool_name)
        if direct_keys:
            BACKEND_GEMINI_ALLOCATOR.ensure_keys(direct_keys)
        if effective_keys:
            BACKEND_GEMINI_ALLOCATOR.ensure_keys(effective_keys)
        usage_payload[pool_name] = {
            "pool": pool_name,
            "directKeyCount": len(direct_keys),
            "effectiveKeyCount": len(effective_keys),
            "effectiveChain": list((config.get("fallbackChains") or {}).get(pool_name) or []),
            "direct": BACKEND_GEMINI_ALLOCATOR.snapshot(direct_keys) if direct_keys else {"pool": {"keyCount": 0}},
            "effective": BACKEND_GEMINI_ALLOCATOR.snapshot(effective_keys) if effective_keys else {"pool": {"keyCount": 0}},
        }
    return {
        "ok": True,
        "config": config,
        "configMeta": config_meta,
        "validation": _gemini_pools_validation(config),
        "usage": usage_payload,
    }


def _runtime_gemini_pool_snapshot(timeout_sec: float = 5.0) -> dict[str, Any]:
    endpoints = [
        f"{GEMINI_RUNTIME_URL}/v1/admin/api-pools",
        f"{GEMINI_RUNTIME_URL}/v1/admin/api-pool",
    ]
    for endpoint in endpoints:
        try:
            response = requests.get(endpoint, timeout=timeout_sec)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"runtime_unreachable:{exc}", "endpoint": endpoint}
        try:
            payload = response.json()
        except Exception:
            payload = {"detail": response.text[:220]}
        if not response.ok:
            continue
        if not isinstance(payload, dict):
            payload = {"payload": payload}
        payload["ok"] = True
        payload["endpoint"] = endpoint
        return payload
    return {"ok": False, "error": "runtime_pool_snapshot_unavailable"}


def _runtime_gemini_pool_reload(timeout_sec: float = 8.0) -> dict[str, Any]:
    endpoints = [
        f"{GEMINI_RUNTIME_URL}/v1/admin/api-pools/reload",
        f"{GEMINI_RUNTIME_URL}/v1/admin/api-pool/reload",
    ]
    for endpoint in endpoints:
        try:
            response = requests.post(endpoint, timeout=timeout_sec)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"runtime_unreachable:{exc}", "endpoint": endpoint}
        try:
            payload = response.json()
        except Exception:
            payload = {"detail": response.text[:220]}
        if not response.ok:
            continue
        if not isinstance(payload, dict):
            payload = {"payload": payload}
        payload["ok"] = True
        payload["endpoint"] = endpoint
        return payload
    return {"ok": False, "error": "runtime_pool_reload_unavailable"}


def _runtime_gemini_pool_usage(timeout_sec: float = 8.0) -> dict[str, Any]:
    endpoint = f"{GEMINI_RUNTIME_URL}/v1/admin/api-pools/usage"
    try:
        response = requests.get(endpoint, timeout=timeout_sec)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"runtime_unreachable:{exc}", "endpoint": endpoint}
    try:
        payload = response.json()
    except Exception:
        payload = {"detail": response.text[:220]}
    if not response.ok:
        return {
            "ok": False,
            "statusCode": response.status_code,
            "error": payload.get("detail") if isinstance(payload, dict) else str(payload),
            "endpoint": endpoint,
        }
    if not isinstance(payload, dict):
        payload = {"payload": payload}
    payload["ok"] = True
    payload["endpoint"] = endpoint
    return payload


def _extract_text_with_gemini_fallback(media_bytes: bytes, mime_type: str, language_hint: str, task_label: str) -> str:
    key_pool = _resolve_gemini_fallback_key_pool()
    if not key_pool:
        raise RuntimeError(
            "Gemini key pool is empty for AI fallback. Configure GEMINI_API_KEYS_FILE (preferred), GEMINI_API_KEYS, or GEMINI_API_KEY."
        )
    BACKEND_GEMINI_ALLOCATOR.ensure_keys(key_pool)

    prompt = (
        f"You are an OCR and document extraction engine. Extract all readable text from this {task_label}. "
        f"Language hint: {language_hint or 'auto'}. "
        "Return plain text only. Preserve chapter headings and paragraph breaks where possible. "
        "Do not add commentary."
    )
    encoded = base64.b64encode(media_bytes).decode("ascii")
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {"inlineData": {"mimeType": mime_type, "data": encoded}},
                ]
            }
        ],
        "generationConfig": {"temperature": 0.0},
    }
    blocked_keys: set[str] = set()
    blocked_models: set[str] = set()
    model_attempts: list[dict[str, Any]] = []
    last_error = "unknown_error"
    retry_after_hint_ms = 0
    started_at_ms = int(time.time() * 1000)
    token_estimate = max(1, estimate_text_tokens(prompt) + estimate_text_tokens(encoded[:4096]))

    while True:
        remaining_ms = max(0, BACKEND_GEMINI_ALLOCATOR_WAIT_TIMEOUT_MS - (int(time.time() * 1000) - started_at_ms))
        if remaining_ms <= 0:
            break
        acquire = BACKEND_GEMINI_ALLOCATOR.acquire_for_task(
            task="ocr",
            key_pool=key_pool,
            requested_tokens=token_estimate,
            blocked_keys=blocked_keys,
            blocked_models=blocked_models,
            wait_timeout_ms=remaining_ms,
        )
        lease = acquire.lease
        if lease is None:
            retry_after_hint_ms = max(retry_after_hint_ms, int(acquire.retry_after_ms or 0))
            last_error = f"allocator_exhausted retry_after_ms={acquire.retry_after_ms}"
            break

        endpoint = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{lease.model_id}:generateContent?key={lease.key}"
        )
        try:
            response = requests.post(endpoint, json=payload, timeout=(8, 120))
            if response.ok:
                BACKEND_GEMINI_ALLOCATOR.release(
                    lease,
                    success=True,
                    used_tokens=token_estimate,
                )
                body = response.json()
                candidates = body.get("candidates") if isinstance(body, dict) else []
                if not isinstance(candidates, list) or not candidates:
                    blocked_models.add(lease.model_id)
                    last_error = f"{lease.model_id}:empty_candidates"
                    continue
                parts = ((candidates[0] or {}).get("content") or {}).get("parts") or []
                out: list[str] = []
                for part in parts:
                    text = str((part or {}).get("text") or "").strip()
                    if text:
                        out.append(text)
                merged = "\n\n".join(out).strip()
                if merged:
                    return merged
                blocked_models.add(lease.model_id)
                last_error = f"{lease.model_id}:empty_text"
                continue

            detail = f"{response.status_code} {response.text[:220]}"
            last_error = detail
            error_kind = "other"
            if response.status_code in {401, 403}:
                error_kind = "auth"
                blocked_keys.add(lease.key)
            elif response.status_code == 429:
                error_kind = "rate_limit"
            else:
                blocked_models.add(lease.model_id)
            BACKEND_GEMINI_ALLOCATOR.release(
                lease,
                success=False,
                used_tokens=token_estimate,
                error_kind=error_kind,
            )
            model_attempts.append(
                {
                    "model": lease.model_id,
                    "keyIndex": lease.key_index,
                    "statusCode": response.status_code,
                    "error": detail,
                }
            )
        except Exception as exc:  # noqa: BLE001
            detail = str(exc)
            last_error = detail
            error_kind = "timeout" if "timed out" in detail.lower() else "other"
            blocked_models.add(lease.model_id)
            BACKEND_GEMINI_ALLOCATOR.release(
                lease,
                success=False,
                used_tokens=token_estimate,
                error_kind=error_kind,
            )
            model_attempts.append(
                {
                    "model": lease.model_id,
                    "keyIndex": lease.key_index,
                    "error": detail[:220],
                }
            )

    snapshot = BACKEND_GEMINI_ALLOCATOR.snapshot(key_pool)
    retry_after_ms = 0
    try:
        retry_candidates: list[int] = []
        if retry_after_hint_ms > 0:
            retry_candidates.append(int(retry_after_hint_ms))
        retry_candidates.extend(
            int(item.get("readyInMs", 0))
            for item in list(snapshot.get("keys") or [])
            if int(item.get("readyInMs", 0)) > 0
        )
        retry_candidates.extend(
            int(((item.get("pool") or {}).get("nextResetInMs", 0)))
            for item in list(snapshot.get("models") or [])
            if int(((item.get("pool") or {}).get("nextResetInMs", 0))) > 0
        )
        retry_after_ms = min(retry_candidates) if retry_candidates else 0
    except Exception:
        retry_after_ms = 0
    raise RuntimeError(
        f"Gemini fallback failed across allocator routes: {last_error} (retryAfterMs={retry_after_ms})"
    )


def _extract_pdf_text_layer(pdf_bytes: bytes) -> tuple[str, list[dict[str, int]], bool]:
    from pypdf import PdfReader  # type: ignore

    reader = PdfReader(BytesIO(pdf_bytes))
    page_stats: list[dict[str, int]] = []
    page_texts: list[str] = []
    low_density_pages = 0

    for idx, page in enumerate(reader.pages):
        extracted = str(page.extract_text() or "").strip()
        char_count = len(extracted)
        if char_count < 80:
            low_density_pages += 1
        page_stats.append({"page": idx + 1, "chars": char_count})
        if extracted:
            page_texts.append(extracted)

    merged = "\n\n".join(page_texts).strip()
    total_chars = len(merged)
    page_count = max(1, len(page_stats))
    low_density_ratio = low_density_pages / page_count
    likely_scanned = total_chars < 450 or low_density_ratio >= 0.6
    return merged, page_stats, likely_scanned


def _normalize_import_text(raw: str) -> str:
    text = str(raw or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _split_text_by_headings(raw_text: str) -> list[dict[str, Any]]:
    pattern = re.compile(
        r"(?im)^(?:chapter|part)\s+([0-9ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)?(?:\s*[-:.\u2014]\s*[^\n]{0,100}|[^\n]{0,100})$"
    )
    matches = list(pattern.finditer(raw_text))
    if len(matches) < 2:
        return []

    chapters: list[dict[str, Any]] = []
    for idx, match in enumerate(matches):
        start = match.start()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(raw_text)
        section = raw_text[start:end].strip()
        if not section:
            continue
        heading_line = section.splitlines()[0].strip()[:120]
        chapters.append(
            {
                "title": heading_line or f"Chapter {idx + 1}",
                "text": section,
                "startOffset": start,
                "endOffset": end,
            }
        )
    return chapters


def _split_text_by_length(raw_text: str) -> list[dict[str, Any]]:
    paragraph_matches = list(re.finditer(r"\S[\s\S]*?(?=\n{2,}|\Z)", raw_text))
    if not paragraph_matches:
        return []

    chunks: list[dict[str, Any]] = []
    current_parts: list[str] = []
    current_start: Optional[int] = None
    current_end: Optional[int] = None
    current_words = 0
    target_words = 1300
    min_words = 700

    for paragraph_match in paragraph_matches:
        paragraph = paragraph_match.group(0).strip()
        if not paragraph:
            continue
        para_words = len(paragraph.split())
        if current_start is None:
            current_start = paragraph_match.start()
        should_flush = current_words >= min_words and (current_words + para_words) > target_words
        if should_flush and current_parts and current_start is not None and current_end is not None:
            chunks.append(
                {
                    "title": f"Chapter {len(chunks) + 1:03d}",
                    "text": "\n\n".join(current_parts).strip(),
                    "startOffset": current_start,
                    "endOffset": current_end,
                }
            )
            current_parts = []
            current_words = 0
            current_start = paragraph_match.start()

        current_parts.append(paragraph)
        current_words += para_words
        current_end = paragraph_match.end()

    if current_parts and current_start is not None and current_end is not None:
        chunks.append(
            {
                "title": f"Chapter {len(chunks) + 1:03d}",
                "text": "\n\n".join(current_parts).strip(),
                "startOffset": current_start,
                "endOffset": current_end,
            }
        )
    return chunks


@app.post("/novel/import/extract")
async def extract_novel_import_text(
    file: UploadFile = File(...),
    format_hint: str = Form("auto"),
    language_hint: str = Form("auto"),
) -> JSONResponse:
    filename = _safe_upload_name(file.filename, "novel_input")
    content_type = str(file.content_type or "").strip().lower()
    hint = _resolve_novel_import_hint(format_hint, content_type, filename)
    if hint not in {"txt", "pdf", "image"}:
        raise HTTPException(status_code=400, detail="Unsupported file type. Use TXT, PDF, or image.")

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(payload) > 24 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File is too large. Maximum 24MB.")

    warnings: list[str] = []
    page_stats: list[dict[str, int]] = []
    used_ai_fallback = False
    mode = "txt"
    raw_text = ""

    if hint == "txt":
        try:
            raw_text = payload.decode("utf-8")
        except UnicodeDecodeError:
            raw_text = payload.decode("utf-8", errors="replace")
            warnings.append("txt_decode_replaced_invalid_bytes")
        mode = "txt"
    elif hint == "pdf":
        mode = "pdf_text"
        try:
            extracted, page_stats, likely_scanned = _extract_pdf_text_layer(payload)
            raw_text = extracted
            if likely_scanned:
                warnings.append("pdf_text_layer_low_density")
                try:
                    raw_text = _extract_text_with_gemini_fallback(
                        payload,
                        "application/pdf",
                        language_hint,
                        "PDF document",
                    )
                    used_ai_fallback = True
                    mode = "pdf_ai_fallback"
                except Exception as fallback_exc:
                    warnings.append(f"pdf_ai_fallback_failed:{fallback_exc}")
        except Exception as exc:
            warnings.append(f"pdf_parser_failed:{exc}")
            try:
                raw_text = _extract_text_with_gemini_fallback(
                    payload,
                    "application/pdf",
                    language_hint,
                    "PDF document",
                )
                used_ai_fallback = True
                mode = "pdf_ai_fallback"
            except Exception as fallback_exc:
                raise HTTPException(
                    status_code=422,
                    detail=f"PDF extraction failed and AI fallback failed: {fallback_exc}",
                ) from fallback_exc
    else:
        mime_type = content_type or mimetypes.guess_type(filename)[0] or "image/png"
        try:
            raw_text = _extract_text_with_local_ocr(payload)
            warnings.append("image_local_ocr_used")
            mode = "image_ai"
        except Exception as local_exc:
            warnings.append(f"image_local_ocr_failed:{local_exc}")
            try:
                raw_text = _extract_text_with_gemini_fallback(payload, mime_type, language_hint, "image")
                used_ai_fallback = True
                mode = "image_ai"
            except Exception as exc:
                raise HTTPException(status_code=422, detail=f"Image extraction failed: {exc}") from exc

    normalized_text = _normalize_import_text(raw_text)
    if not normalized_text:
        raise HTTPException(status_code=422, detail="Could not extract readable text from file.")

    return JSONResponse(
        {
            "ok": True,
            "rawText": normalized_text,
            "diagnostics": {
                "mode": mode,
                "warnings": warnings,
                "usedAiFallback": used_ai_fallback,
            },
            "pageStats": page_stats,
        }
    )


@app.post("/novel/import/split")
def split_imported_novel_text(payload: NovelImportSplitRequest) -> JSONResponse:
    raw_text = _normalize_import_text(payload.rawText)
    if not raw_text:
        raise HTTPException(status_code=400, detail="rawText is required.")

    strategy = (payload.strategy or "auto").strip().lower()
    if strategy not in {"auto", "heading_first", "length_fallback"}:
        raise HTTPException(status_code=400, detail="Invalid strategy. Use auto, heading_first, or length_fallback.")

    warnings: list[str] = []
    chapters: list[dict[str, Any]] = []

    if strategy in {"auto", "heading_first"}:
        chapters = _split_text_by_headings(raw_text)
        if not chapters:
            warnings.append("heading_split_not_detected")
            if strategy == "heading_first":
                warnings.append("fallback_used:length")

    if not chapters:
        chapters = _split_text_by_length(raw_text)
        if len(chapters) <= 1:
            warnings.append("single_chunk_only")

    if not chapters:
        chapters = [
            {
                "title": "Chapter 001",
                "text": raw_text,
                "startOffset": 0,
                "endOffset": len(raw_text),
            }
        ]
        warnings.append("default_single_chapter")

    return JSONResponse(
        {
            "ok": True,
            "chapters": chapters,
            "warnings": warnings,
        }
    )


@app.post("/novel/ideas/extract")
def extract_novel_idea(payload: NovelIdeaExtractRequest) -> JSONResponse:
    try:
        source = _normalize_novel_source(payload.source)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    target_url = (payload.url or "").strip()
    if not target_url:
        raise HTTPException(status_code=400, detail="URL is required.")

    parsed = urlparse(target_url)
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="URL must start with http:// or https://")

    allowed_hosts = NOVEL_IDEA_ALLOWED_HOSTS[source]
    if not _host_matches_allowed(parsed.hostname or "", allowed_hosts):
        allowed_hint = ", ".join(allowed_hosts)
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported domain for {source}. Allowed: {allowed_hint}",
        )

    try:
        response = requests.get(
            target_url,
            headers={
                "User-Agent": NOVEL_IDEA_USER_AGENT,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
            },
            timeout=(6, 15),
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch source page: {exc}") from exc

    soup = BeautifulSoup(response.text[:2_500_000], "html.parser")

    title = _extract_meta_content(
        soup,
        [
            {"property": "og:title"},
            {"name": "twitter:title"},
            {"name": "title"},
        ],
    )
    if not title:
        title_tag = soup.find("title")
        title = _clean_meta_text(title_tag.get_text(" ", strip=True) if title_tag else "")

    synopsis = _extract_meta_content(
        soup,
        [
            {"property": "og:description"},
            {"name": "description"},
            {"name": "twitter:description"},
        ],
    )

    tags: list[str] = []
    keywords = _extract_meta_content(soup, [{"name": "keywords"}])
    if keywords:
        for token in keywords.split(","):
            cleaned = _clean_meta_text(token, max_len=60)
            if cleaned and cleaned.lower() not in {item.lower() for item in tags}:
                tags.append(cleaned)

    tag_nodes = soup.find_all("meta", attrs={"property": "article:tag"})
    for node in tag_nodes:
        cleaned = _clean_meta_text(node.get("content", ""), max_len=60)
        if cleaned and cleaned.lower() not in {item.lower() for item in tags}:
            tags.append(cleaned)
        if len(tags) >= 12:
            break

    warnings: list[str] = []
    if not title:
        warnings.append("title_not_found")
    if not synopsis:
        warnings.append("synopsis_not_found")
    if not tags:
        warnings.append("tags_not_found")

    return JSONResponse(
        {
            "ok": True,
            "source": source,
            "url": target_url,
            "title": title,
            "synopsis": synopsis,
            "tags": tags,
            "warnings": warnings,
        }
    )


@app.get("/health")
def health() -> JSONResponse:
    ffmpeg_ok = False
    ffmpeg_path = None
    ffmpeg_error = None

    try:
        ffmpeg_path = _get_ffmpeg_path()
        ffmpeg_ok = True
    except Exception as exc:
        ffmpeg_error = str(exc)

    rvc_available = False
    rvc_error = rvc_runtime.import_error
    current_model = rvc_runtime.current_model()
    rvc_models_dir = str(MODELS_DIR)
    try:
        rvc_runtime.ensure_engine()
        rvc_payload = rvc_runtime.health_payload()
        nested = rvc_payload.get("rvc") if isinstance(rvc_payload.get("rvc"), dict) else {}
        rvc_available = bool(nested.get("available"))
        current_model = str(nested.get("currentModel") or current_model or "").strip() or current_model
        rvc_models_dir = str(nested.get("modelsDir") or rvc_models_dir)
        rvc_error = str(nested.get("error") or "").strip() or None
    except Exception as exc:
        rvc_available = False
        rvc_error = str(exc)

    source_separation_available = source_separation_runtime.ensure_available()
    source_separation_error = source_separation_runtime.import_error
    lhq_healthy, lhq_detail = lhq_svc_adapter.health()

    fallback_available = bool(ENABLE_RVC_FALLBACK and ffmpeg_ok)
    response = {
        "ok": ffmpeg_ok and (source_separation_available or not ENABLE_SOURCE_SEPARATION),
        "ffmpeg": {
            "available": ffmpeg_ok,
            "path": ffmpeg_path,
            "error": ffmpeg_error,
        },
        "rvc": {
            "available": rvc_available or fallback_available,
            "currentModel": current_model or (RVC_FALLBACK_MODEL_ID if fallback_available else None),
            "modelsDir": rvc_models_dir,
            "error": rvc_error,
            "fallbackAvailable": fallback_available,
            "fallbackModel": RVC_FALLBACK_MODEL_ID if fallback_available else None,
            "conversionPolicies": sorted(VOICE_CONVERSION_POLICIES),
            "lhqPilot": {"healthy": lhq_healthy, "detail": lhq_detail, "model": LHQ_SVC_PILOT_MODEL_ID},
            "runtimeUrl": RVC_RUNTIME_URL,
        },
        "whisper": {
            "loaded": whisper_runtime.model is not None,
            "model": WHISPER_MODEL_SIZE,
            "device": WHISPER_DEVICE,
            "compute": WHISPER_COMPUTE,
            "error": whisper_runtime.import_error,
            "supportedLanguages": sorted(SUPPORTED_TRANSCRIBE_LANGUAGE_CODES),
        },
        "sourceSeparation": {
            "enabled": ENABLE_SOURCE_SEPARATION,
            "available": source_separation_available,
            "model": SEPARATION_MODEL,
            "device": SEPARATION_DEVICE,
            "cacheDir": str(SEPARATION_CACHE_DIR),
            "error": source_separation_error,
        },
    }

    return JSONResponse(response)


@app.get("/system/version")
def system_version() -> JSONResponse:
    return JSONResponse(
        {
            "ok": True,
            "apiVersion": API_VERSION,
            "buildTime": APP_BUILD_TIME,
            "gitSha": _best_effort_git_sha(),
            "features": {
                "dubbingPrepare": True,
                "ttsSwitch": True,
                "runtimeLogs": True,
                "voiceConversionPolicy": True,
                "lhqSvcPilot": False,
                "firebaseAuth": True,
                "stripeBilling": True,
                "usageQuota": True,
                "ttsSynthesizeProxy": True,
                "aiOpsGuardian": True,
            },
        }
    )


@app.get("/ops/guardian/status")
def ops_guardian_status(include_route_stats: bool = False) -> JSONResponse:
    payload = _ai_ops_build_status(include_route_stats=bool(include_route_stats))
    return JSONResponse(payload)


@app.post("/ops/guardian/scan")
def ops_guardian_scan(payload: AiOpsScanRequest, request: Request) -> JSONResponse:
    uid = _require_request_uid(request)
    status_payload = _ai_ops_build_status(include_route_stats=True)
    detected_issues = list(status_payload.get("issues") or [])
    auto_fix_actions: list[dict[str, Any]] = []
    created_approvals: list[dict[str, Any]] = []

    auto_fix_allowed = (
        bool(payload.autoFixMinor)
        and bool(VF_AI_OPS_ENABLE_AUTOFIX_MINOR)
        and str(VF_AI_OPS_MODE) != "manual"
    )

    for issue in detected_issues:
        if not isinstance(issue, dict):
            continue
        severity = str(issue.get("severity") or "minor")
        action = str(issue.get("action") or "").strip().lower()
        action_payload = issue.get("payload") if isinstance(issue.get("payload"), dict) else {}
        if not action:
            continue
        if severity == "major":
            approval, created = _ai_ops_create_approval(
                action=action,
                payload=action_payload,
                requested_by=uid,
                reason="major_issue_detected",
            )
            created_approvals.append({**approval, "created": created})
            continue
        if not auto_fix_allowed:
            continue
        if not _ai_ops_autofix_allowed(action, action_payload):
            auto_fix_actions.append(
                {
                    "ok": False,
                    "action": action,
                    "severity": "minor",
                    "detail": "cooldown_active",
                }
            )
            continue
        execution = _ai_ops_execute_action(
            action=action,
            payload=action_payload,
            gpu=bool(payload.gpu),
            initiator=f"scan:{uid}",
        )
        _ai_ops_mark_autofix(action, action_payload)
        auto_fix_actions.append(execution)

    final_status = _ai_ops_build_status(include_route_stats=bool(payload.includeRouteStats))
    response_payload = {
        **final_status,
        "detectedIssues": detected_issues,
        "autoFixActions": auto_fix_actions,
        "createdApprovals": created_approvals,
        "autoFixEnabled": bool(VF_AI_OPS_ENABLE_AUTOFIX_MINOR),
    }
    return JSONResponse(response_payload)


@app.post("/ops/guardian/actions")
def ops_guardian_actions(payload: AiOpsActionRequest, request: Request) -> JSONResponse:
    uid = _require_request_uid(request)
    try:
        action = _ai_ops_validate_action(payload.action)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    severity = _ai_ops_action_severity(action)
    if severity == "major":
        authorized, auth_uid, auth_reason = _ai_ops_admin_authorized(request, payload.adminToken)
        if not authorized:
            approval, created = _ai_ops_create_approval(
                action=action,
                payload=payload.payload if isinstance(payload.payload, dict) else {},
                requested_by=uid,
                reason=auth_reason,
            )
            return JSONResponse(
                status_code=202,
                content={
                    "ok": True,
                    "action": action,
                    "severity": severity,
                    "approval": {**approval, "created": created},
                },
            )
        execution = _ai_ops_execute_action(
            action=action,
            payload=payload.payload if isinstance(payload.payload, dict) else {},
            gpu=bool(payload.gpu),
            initiator=f"admin:{auth_uid}",
        )
        return JSONResponse(
            {
                "ok": bool(execution.get("ok")),
                "action": action,
                "severity": severity,
                "execution": execution,
            }
        )

    execution = _ai_ops_execute_action(
        action=action,
        payload=payload.payload if isinstance(payload.payload, dict) else {},
        gpu=bool(payload.gpu),
        initiator=f"user:{uid}",
    )
    return JSONResponse(
        {
            "ok": bool(execution.get("ok")),
            "action": action,
            "severity": severity,
            "execution": execution,
        }
    )


@app.get("/ops/guardian/approvals")
def ops_guardian_approvals(status: str = "pending") -> JSONResponse:
    filter_token = str(status or "pending").strip().lower()
    if filter_token not in {"pending", "approved", "rejected", "executed", "failed", "all"}:
        raise HTTPException(status_code=400, detail="Invalid status filter.")
    items = _ai_ops_list_approvals(filter_token)
    return JSONResponse(
        {
            "ok": True,
            "status": filter_token,
            "count": len(items),
            "approvals": items,
        }
    )


@app.post("/ops/guardian/approvals/{approval_id}/decision")
def ops_guardian_approval_decision(
    approval_id: str,
    payload: AiOpsApprovalDecisionRequest,
    request: Request,
) -> JSONResponse:
    authorized, uid, reason = _ai_ops_admin_authorized(request, payload.adminToken)
    if not authorized:
        raise HTTPException(status_code=403, detail=f"Admin authorization failed: {reason}")
    with AI_OPS_LOCK:
        approvals = AI_OPS_STATE.get("pendingApprovals") if isinstance(AI_OPS_STATE.get("pendingApprovals"), dict) else {}
        approval = approvals.get(approval_id)
        if not isinstance(approval, dict):
            raise HTTPException(status_code=404, detail="Approval not found.")
        if str(approval.get("status") or "") != "pending":
            raise HTTPException(status_code=409, detail="Approval is no longer pending.")
        approval["decisionBy"] = uid
        approval["decisionAtMs"] = _ai_ops_now_ms()
        approval["updatedAtMs"] = approval["decisionAtMs"]
        approval["note"] = str(payload.note or "").strip()[:300]

    if not payload.approved:
        with AI_OPS_LOCK:
            approvals = AI_OPS_STATE.get("pendingApprovals") if isinstance(AI_OPS_STATE.get("pendingApprovals"), dict) else {}
            item = approvals.get(approval_id)
            if isinstance(item, dict):
                item["status"] = "rejected"
                item["updatedAtMs"] = _ai_ops_now_ms()
                approval = dict(item)
        return JSONResponse({"ok": True, "approval": approval})

    approval_data = _ai_ops_get_approval(approval_id)
    if approval_data is None:
        raise HTTPException(status_code=404, detail="Approval not found.")
    execution = _ai_ops_execute_action(
        action=str(approval_data.get("action") or ""),
        payload=approval_data.get("payload") if isinstance(approval_data.get("payload"), dict) else {},
        initiator=f"admin:{uid}",
        approval_id=approval_id,
    )
    with AI_OPS_LOCK:
        approvals = AI_OPS_STATE.get("pendingApprovals") if isinstance(AI_OPS_STATE.get("pendingApprovals"), dict) else {}
        item = approvals.get(approval_id)
        if isinstance(item, dict):
            item["status"] = "executed" if bool(execution.get("ok")) else "failed"
            item["updatedAtMs"] = _ai_ops_now_ms()
            item["execution"] = execution
            approval_data = dict(item)
    return JSONResponse({"ok": True, "approval": approval_data, "execution": execution})


@app.post("/ops/guardian/frontend-errors")
def ops_guardian_frontend_errors(payload: FrontendErrorReportRequest, request: Request) -> JSONResponse:
    uid = _require_request_uid(request)
    try:
        item = _ai_ops_record_frontend_error(uid, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return JSONResponse(
        {
            "ok": True,
            "accepted": True,
            "errorId": item["id"],
            "timestampMs": item["ts"],
        }
    )


def _require_stripe_ready() -> None:
    if not _stripe_available():
        raise HTTPException(status_code=503, detail="Stripe is not configured.")


def _sync_entitlement_from_subscription(
    *,
    uid: str,
    customer_id: str,
    subscription_id: Optional[str],
    subscription_status: str,
    price_id: str,
    billing_country: Optional[str] = None,
) -> dict[str, Any]:
    safe_uid = str(uid or "").strip()
    if not safe_uid:
        raise HTTPException(status_code=400, detail="Missing uid for entitlement sync.")
    plan_payload = _entitlement_from_price_id(price_id)
    status = _billing_status_from_subscription(subscription_status)
    payload = {
        "plan": plan_payload["plan"],
        "status": status,
        "monthlyVfLimit": plan_payload["monthlyVfLimit"],
        "dailyGenerationLimit": plan_payload["dailyGenerationLimit"],
        "stripeCustomerId": str(customer_id or "") or None,
        "subscriptionId": str(subscription_id or "") or None,
        "currencyMode": "INR_BASE_AUTO_FX",
        "billingCountry": str(billing_country or "").upper() or None,
    }
    _write_entitlement(safe_uid, payload)
    if customer_id:
        _link_customer_uid(customer_id, safe_uid)
    return payload


def _admin_list_users(limit: int, search: str = "") -> list[dict[str, Any]]:
    safe_limit = max(1, min(200, int(limit)))
    needle = str(search or "").strip().lower()
    users: list[dict[str, Any]] = []

    if _firebase_ready() and firebase_auth is not None:
        page = firebase_auth.list_users()  # type: ignore[attr-defined]
        for record in page.iterate_all():
            uid = str(getattr(record, "uid", "") or "")
            email = str(getattr(record, "email", "") or "")
            display_name = str(getattr(record, "display_name", "") or "")
            disabled = bool(getattr(record, "disabled", False))
            if needle:
                haystack = f"{uid} {email} {display_name}".lower()
                if needle not in haystack:
                    continue
            entitlement = _load_entitlement(uid)
            monthly, daily = _load_usage_windows(uid)
            custom_claims = getattr(record, "custom_claims", None) or {}
            users.append(
                {
                    "uid": uid,
                    "email": email,
                    "displayName": display_name,
                    "disabled": disabled,
                    "admin": _as_bool(custom_claims.get("admin")) or _firestore_user_is_admin(uid),
                    "plan": _normalize_plan_name(str(entitlement.get("plan") or "Free")),
                    "status": str(entitlement.get("status") or "free_active"),
                    "wallet": {
                        "paidVfBalance": _as_positive_int(entitlement.get("paidVfBalance")),
                        "vffBalance": _as_positive_int(entitlement.get("vffBalance")),
                    },
                    "usage": {
                        "monthlyVfUsed": _as_positive_int(monthly.get("vfUsed")),
                        "dailyGenerationUsed": _as_positive_int(daily.get("generationCount")),
                    },
                }
            )
            if len(users) >= safe_limit:
                break
        return users

    collection = _firestore_collection("entitlements")
    if collection is None:
        with _INMEMORY_LOCK:
            for uid, payload in _INMEMORY_ENTITLEMENTS.items():
                if needle and needle not in uid.lower():
                    continue
                entitlement = _normalize_entitlement_wallet(payload)
                users.append(
                    {
                        "uid": uid,
                        "email": "",
                        "displayName": uid,
                        "disabled": False,
                        "admin": uid in VF_ADMIN_APPROVER_UIDS or uid.startswith("local_admin"),
                        "plan": _normalize_plan_name(str(entitlement.get("plan") or "Free")),
                        "status": str(entitlement.get("status") or "free_active"),
                        "wallet": {
                            "paidVfBalance": _as_positive_int(entitlement.get("paidVfBalance")),
                            "vffBalance": _as_positive_int(entitlement.get("vffBalance")),
                        },
                        "usage": {"monthlyVfUsed": 0, "dailyGenerationUsed": 0},
                    }
                )
                if len(users) >= safe_limit:
                    break
            return users

    docs = collection.limit(safe_limit * 2).stream()
    for doc in docs:
        uid = str(doc.id or "")
        if needle and needle not in uid.lower():
            continue
        entitlement = _normalize_entitlement_wallet(doc.to_dict() or {})
        users.append(
            {
                "uid": uid,
                "email": "",
                "displayName": uid,
                "disabled": False,
                "admin": _firestore_user_is_admin(uid),
                "plan": _normalize_plan_name(str(entitlement.get("plan") or "Free")),
                "status": str(entitlement.get("status") or "free_active"),
                "wallet": {
                    "paidVfBalance": _as_positive_int(entitlement.get("paidVfBalance")),
                    "vffBalance": _as_positive_int(entitlement.get("vffBalance")),
                },
                "usage": {"monthlyVfUsed": 0, "dailyGenerationUsed": 0},
            }
        )
        if len(users) >= safe_limit:
            break
    return users


def _admin_set_user_disabled(uid: str, disabled: bool) -> None:
    if not _firebase_ready() or firebase_auth is None:
        raise HTTPException(status_code=503, detail="Firebase admin auth is not configured.")
    try:
        firebase_auth.update_user(uid, disabled=bool(disabled))  # type: ignore[attr-defined]
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to update user status: {exc}") from exc


def _admin_set_user_password(uid: str, new_password: str) -> None:
    if not _firebase_ready() or firebase_auth is None:
        raise HTTPException(status_code=503, detail="Firebase admin auth is not configured.")
    password = str(new_password or "")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
    try:
        firebase_auth.update_user(uid, password=password)  # type: ignore[attr-defined]
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to reset password: {exc}") from exc


def _admin_revoke_user_sessions(uid: str) -> None:
    if not _firebase_ready() or firebase_auth is None:
        raise HTTPException(status_code=503, detail="Firebase admin auth is not configured.")
    try:
        firebase_auth.revoke_refresh_tokens(uid)  # type: ignore[attr-defined]
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to revoke sessions: {exc}") from exc


@app.get("/account/entitlements")
def account_entitlements(request: Request) -> JSONResponse:
    uid = _require_request_uid(request)
    payload = _entitlement_usage_payload(uid)
    return JSONResponse({"ok": True, "entitlements": payload})


@app.get("/account/generation-history")
def account_generation_history(request: Request, limit: int = 30) -> JSONResponse:
    uid = _require_request_uid(request)
    safe_limit = max(1, min(200, int(limit)))
    items = _history_get_items(uid, limit=safe_limit)
    return JSONResponse(
        {
            "ok": True,
            "limit": safe_limit,
            "count": len(items),
            "codec": VF_GENERATION_HISTORY_CODEC,
            "items": items,
        }
    )


@app.delete("/account/generation-history")
def account_generation_history_clear(request: Request) -> JSONResponse:
    uid = _require_request_uid(request)
    _history_clear(uid)
    return JSONResponse({"ok": True})


@app.post("/wallet/ad-reward/claim")
def wallet_ad_reward_claim(request: Request) -> JSONResponse:
    uid = _require_request_uid(request)
    admin_limit_bypass = _request_is_admin(request, uid)
    now = _utc_now()
    day_doc_id = _wallet_daily_doc_id(uid, now)
    month_key = _wallet_month_key(now)
    wallet_daily = _firestore_collection("wallet_daily")
    entitlements = _firestore_collection("entitlements")

    if wallet_daily is None or entitlements is None or _FIRESTORE_DB is None or firebase_firestore is None:
        with _INMEMORY_LOCK:
            row = _INMEMORY_WALLET_DAILY.get(day_doc_id) or {
                "uid": uid,
                "periodKey": _usage_day_period_label(now),
                "adClaimCount": 0,
            }
            claim_count = _as_positive_int(row.get("adClaimCount"))
            if not admin_limit_bypass and claim_count >= VF_AD_REWARD_CLAIM_LIMIT_PER_DAY:
                raise HTTPException(status_code=429, detail="Daily ad reward limit reached.")
            row["adClaimCount"] = claim_count + 1
            row["updatedAt"] = now.isoformat()
            _INMEMORY_WALLET_DAILY[day_doc_id] = row
            entitlement = _normalize_entitlement_wallet(_INMEMORY_ENTITLEMENTS.get(uid) or _default_entitlement(uid), now)
            if str(entitlement.get("vffMonthKey") or "") != month_key:
                entitlement["vffBalance"] = 0
                entitlement["vffMonthKey"] = month_key
            entitlement["vffBalance"] = _as_positive_int(entitlement.get("vffBalance")) + VF_AD_REWARD_VFF_AMOUNT
            entitlement["updatedAt"] = now.isoformat()
            _INMEMORY_ENTITLEMENTS[uid] = entitlement
        return JSONResponse({"ok": True, "entitlements": _entitlement_usage_payload(uid)})

    daily_ref = _FIRESTORE_DB.collection("wallet_daily").document(day_doc_id)
    ent_ref = _FIRESTORE_DB.collection("entitlements").document(uid)
    transaction = _FIRESTORE_DB.transaction()

    @firebase_firestore.transactional
    def _apply(transaction_obj: Any) -> None:
        daily_doc = daily_ref.get(transaction=transaction_obj)
        row = (
            {**(daily_doc.to_dict() or {})}
            if daily_doc.exists
            else {"uid": uid, "periodKey": _usage_day_period_label(now), "adClaimCount": 0}
        )
        claim_count = _as_positive_int(row.get("adClaimCount"))
        if not admin_limit_bypass and claim_count >= VF_AD_REWARD_CLAIM_LIMIT_PER_DAY:
            raise RuntimeError("Daily ad reward limit reached.")
        row["adClaimCount"] = claim_count + 1
        row["updatedAt"] = now.isoformat()

        ent_doc = ent_ref.get(transaction=transaction_obj)
        entitlement = _normalize_entitlement_wallet(ent_doc.to_dict() if ent_doc.exists else _default_entitlement(uid), now)
        if str(entitlement.get("vffMonthKey") or "") != month_key:
            entitlement["vffBalance"] = 0
            entitlement["vffMonthKey"] = month_key
        entitlement["vffBalance"] = _as_positive_int(entitlement.get("vffBalance")) + VF_AD_REWARD_VFF_AMOUNT
        entitlement["updatedAt"] = now.isoformat()

        transaction_obj.set(daily_ref, row, merge=True)
        transaction_obj.set(ent_ref, entitlement, merge=True)

    try:
        _apply(transaction)
    except RuntimeError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc

    return JSONResponse({"ok": True, "entitlements": _entitlement_usage_payload(uid)})


@app.post("/wallet/coupons/redeem")
def wallet_coupon_redeem(payload: CouponRedeemRequest, request: Request) -> JSONResponse:
    uid = _require_request_uid(request)
    admin_limit_bypass = _request_is_admin(request, uid)
    code = _normalize_coupon_code(payload.code)
    if not code:
        raise HTTPException(status_code=400, detail="Coupon code is required.")
    now = _utc_now()

    coupons = _firestore_collection("coupons")
    redemptions = _firestore_collection("coupon_redemptions")
    entitlements = _firestore_collection("entitlements")
    transactions = _firestore_collection("wallet_transactions")

    if coupons is None or redemptions is None or entitlements is None or transactions is None or _FIRESTORE_DB is None or firebase_firestore is None:
        with _INMEMORY_LOCK:
            coupon_id = ""
            coupon: dict[str, Any] = {}
            for item_id, row in _INMEMORY_COUPONS.items():
                if str(row.get("code") or "").upper() == code:
                    coupon_id = item_id
                    coupon = dict(row)
                    break
            if not coupon_id:
                raise HTTPException(status_code=404, detail="Coupon not found.")
            if not _as_bool(coupon.get("active")):
                raise HTTPException(status_code=400, detail="Coupon is inactive.")
            expires = _parse_optional_datetime(str(coupon.get("expiresAt") or ""))
            if expires and expires <= now:
                raise HTTPException(status_code=400, detail="Coupon has expired.")
            redemption_key = (
                f"{coupon_id}_{uid}_{uuid.uuid4().hex}"
                if admin_limit_bypass
                else f"{coupon_id}_{uid}"
            )
            if not admin_limit_bypass and redemption_key in _INMEMORY_COUPON_REDEMPTIONS:
                raise HTTPException(status_code=409, detail="Coupon already redeemed by this user.")
            redeemed_count = _as_positive_int(coupon.get("redeemedCount"))
            max_redemptions = _as_positive_int(coupon.get("maxRedemptions"))
            if not admin_limit_bypass and max_redemptions > 0 and redeemed_count >= max_redemptions:
                raise HTTPException(status_code=400, detail="Coupon redemption limit reached.")
            credit_vf = _as_positive_int(coupon.get("creditVf"))
            if credit_vf <= 0:
                raise HTTPException(status_code=400, detail="Coupon has no redeemable value.")

            coupon["redeemedCount"] = redeemed_count + 1
            coupon["updatedAt"] = now.isoformat()
            _INMEMORY_COUPONS[coupon_id] = coupon
            _INMEMORY_COUPON_REDEMPTIONS[redemption_key] = {
                "couponId": coupon_id,
                "uid": uid,
                "code": code,
                "creditedVf": credit_vf,
                "createdAt": now.isoformat(),
            }
        coupon_tx_id = (
            f"coupon_{coupon_id}_{uid}_{uuid.uuid4().hex}"
            if admin_limit_bypass
            else f"coupon_{coupon_id}_{uid}"
        )
        _credit_paid_vf(
            uid=uid,
            amount=credit_vf,
            reason="coupon_redeem",
            transaction_id=coupon_tx_id,
            metadata={
                "couponId": coupon_id,
                "code": code,
                "adminLimitBypass": bool(admin_limit_bypass),
            },
        )
        return JSONResponse({"ok": True, "creditedVf": credit_vf, "entitlements": _entitlement_usage_payload(uid)})

    coupon_docs = list(_FIRESTORE_DB.collection("coupons").where("code", "==", code).limit(1).stream())
    if not coupon_docs:
        raise HTTPException(status_code=404, detail="Coupon not found.")
    coupon_doc = coupon_docs[0]
    coupon_id = str(coupon_doc.id)
    redemption_doc_id = (
        f"{coupon_id}_{uid}_{uuid.uuid4().hex}"
        if admin_limit_bypass
        else f"{coupon_id}_{uid}"
    )
    tx_doc_id = (
        f"coupon_{coupon_id}_{uid}_{uuid.uuid4().hex}"
        if admin_limit_bypass
        else f"coupon_{coupon_id}_{uid}"
    )
    coupon_ref = _FIRESTORE_DB.collection("coupons").document(coupon_id)
    redemption_ref = _FIRESTORE_DB.collection("coupon_redemptions").document(redemption_doc_id)
    entitlement_ref = _FIRESTORE_DB.collection("entitlements").document(uid)
    tx_ref = _FIRESTORE_DB.collection("wallet_transactions").document(tx_doc_id)
    transaction = _FIRESTORE_DB.transaction()

    @firebase_firestore.transactional
    def _apply(transaction_obj: Any) -> int:
        fresh_coupon_doc = coupon_ref.get(transaction=transaction_obj)
        if not fresh_coupon_doc.exists:
            raise RuntimeError("Coupon not found.")
        coupon = fresh_coupon_doc.to_dict() or {}
        if not _as_bool(coupon.get("active")):
            raise RuntimeError("Coupon is inactive.")
        expires = _parse_optional_datetime(str(coupon.get("expiresAt") or ""))
        if expires and expires <= now:
            raise RuntimeError("Coupon has expired.")
        if not admin_limit_bypass:
            redemption_doc = redemption_ref.get(transaction=transaction_obj)
            if redemption_doc.exists:
                raise RuntimeError("Coupon already redeemed by this user.")
        redeemed_count = _as_positive_int(coupon.get("redeemedCount"))
        max_redemptions = _as_positive_int(coupon.get("maxRedemptions"))
        if not admin_limit_bypass and max_redemptions > 0 and redeemed_count >= max_redemptions:
            raise RuntimeError("Coupon redemption limit reached.")
        credit_vf = _as_positive_int(coupon.get("creditVf"))
        if credit_vf <= 0:
            raise RuntimeError("Coupon has no redeemable value.")

        ent_doc = entitlement_ref.get(transaction=transaction_obj)
        entitlement = _normalize_entitlement_wallet(ent_doc.to_dict() if ent_doc.exists else _default_entitlement(uid), now)
        entitlement["paidVfBalance"] = _as_positive_int(entitlement.get("paidVfBalance")) + credit_vf
        entitlement["updatedAt"] = now.isoformat()
        coupon["redeemedCount"] = redeemed_count + 1
        coupon["updatedAt"] = now.isoformat()

        transaction_obj.set(coupon_ref, coupon, merge=True)
        transaction_obj.set(
            redemption_ref,
            {
                "couponId": coupon_id,
                "uid": uid,
                "code": code,
                "creditedVf": credit_vf,
                "createdAt": now.isoformat(),
            },
            merge=True,
        )
        transaction_obj.set(entitlement_ref, entitlement, merge=True)
        transaction_obj.set(
            tx_ref,
            {
                "id": tx_ref.id,
                "uid": uid,
                "kind": "credit",
                "bucket": "paidVF",
                "amount": credit_vf,
                "reason": "coupon_redeem",
                "metadata": {
                    "couponId": coupon_id,
                    "code": code,
                    "adminLimitBypass": bool(admin_limit_bypass),
                },
                "createdAt": now.isoformat(),
            },
            merge=True,
        )
        return credit_vf

    try:
        credited_vf = _apply(transaction)
    except RuntimeError as exc:
        detail = str(exc)
        status = 409 if "already redeemed" in detail.lower() else 400
        if "not found" in detail.lower():
            status = 404
        raise HTTPException(status_code=status, detail=detail) from exc

    return JSONResponse({"ok": True, "creditedVf": credited_vf, "entitlements": _entitlement_usage_payload(uid)})


def _load_daily_usage_reset_status() -> dict[str, Any]:
    collection = _firestore_collection("admin_ops")
    if collection is None:
        with _INMEMORY_LOCK:
            return dict(_INMEMORY_DAILY_USAGE_RESET_STATUS or {})
    try:
        doc = collection.document("daily_usage_reset_status").get()
    except Exception:
        return {}
    if not doc.exists:
        return {}
    payload = doc.to_dict() or {}
    payload["id"] = "daily_usage_reset_status"
    return payload


def _write_daily_usage_reset_status(payload: dict[str, Any]) -> None:
    row = dict(payload or {})
    collection = _firestore_collection("admin_ops")
    if collection is None:
        with _INMEMORY_LOCK:
            _INMEMORY_DAILY_USAGE_RESET_STATUS.clear()
            _INMEMORY_DAILY_USAGE_RESET_STATUS.update(row)
        return
    try:
        collection.document("daily_usage_reset_status").set(row, merge=False)
    except Exception:
        with _INMEMORY_LOCK:
            _INMEMORY_DAILY_USAGE_RESET_STATUS.clear()
            _INMEMORY_DAILY_USAGE_RESET_STATUS.update(row)


def _reset_daily_usage_all(*, dry_run: bool, requested_by: str) -> dict[str, Any]:
    now = _utc_now()
    period_key = _usage_day_period_label(now)
    day_key = _usage_day_key(now)
    mode = "in_memory"
    docs_cleared = 0
    users: set[str] = set()
    reserved_events_today: Optional[int] = None

    usage_daily = _firestore_collection("usage_daily")
    if usage_daily is None:
        with _INMEMORY_LOCK:
            matching_keys: list[str] = []
            for doc_id, row in _INMEMORY_USAGE_DAILY.items():
                if str((row or {}).get("periodKey") or "").strip() != period_key:
                    continue
                matching_keys.append(doc_id)
                uid = str((row or {}).get("uid") or "").strip()
                if uid:
                    users.add(uid)
            docs_cleared = len(matching_keys)
            if not dry_run:
                for doc_id in matching_keys:
                    _INMEMORY_USAGE_DAILY.pop(doc_id, None)
            reserved_events_today = sum(
                1
                for event in _INMEMORY_USAGE_EVENTS.values()
                if str((event or {}).get("status") or "").strip().lower() == "reserved"
                and str((event or {}).get("dayDocId") or "").strip().endswith(f"_{day_key}")
            )
    else:
        mode = "firestore"
        try:
            docs = list(usage_daily.where("periodKey", "==", period_key).stream())
        except Exception:
            docs = []
        for doc in docs:
            row = doc.to_dict() or {}
            uid = str(row.get("uid") or "").strip()
            if uid:
                users.add(uid)
        docs_cleared = len(docs)
        if not dry_run:
            for doc in docs:
                try:
                    doc.reference.delete()
                except Exception:
                    continue

    summary = {
        "ok": True,
        "dryRun": bool(dry_run),
        "mode": mode,
        "dayKey": day_key,
        "periodKey": period_key,
        "usersAffected": len(users),
        "docsCleared": docs_cleared,
        "requestedBy": str(requested_by or "").strip(),
        "ranAt": now.isoformat(),
        "reservedEventsToday": reserved_events_today,
    }
    if not dry_run:
        _write_daily_usage_reset_status(summary)
    return summary


@app.get("/admin/usage/reset-daily-all/status")
def admin_daily_usage_reset_status(request: Request) -> JSONResponse:
    _ = _require_admin_uid(request)
    payload = _load_daily_usage_reset_status()
    if not payload:
        return JSONResponse({"ok": True, "status": "never_run"})
    return JSONResponse({"ok": True, "status": "available", "lastRun": payload})


@app.post("/admin/usage/reset-daily-all")
def admin_reset_daily_usage_all(request: Request, dryRun: bool = False) -> JSONResponse:
    admin_uid = _require_admin_uid(request)
    summary = _reset_daily_usage_all(dry_run=bool(dryRun), requested_by=admin_uid)
    return JSONResponse(summary)


@app.get("/admin/tts/gateway/status")
def admin_tts_gateway_status(request: Request) -> JSONResponse:
    _ = _require_admin_uid(request)
    return JSONResponse(
        {
            "ok": True,
            "gateway": _TTS_GATEWAY_CONTROLLER.snapshot(),
            "jobQueue": _TTS_JOB_QUEUE.depth_snapshot(),
        }
    )


@app.get("/admin/tts/queue/metrics")
def admin_tts_queue_metrics(request: Request) -> JSONResponse:
    _ = _require_admin_uid(request)
    return JSONResponse(_tts_queue_metrics_snapshot())


@app.get("/admin/integrations/usage")
def admin_integrations_usage(request: Request) -> JSONResponse:
    _ = _require_admin_uid(request)
    return JSONResponse(_admin_usage_summary_payload())


@app.get("/admin/integrations/usage/export")
def admin_integrations_usage_export(
    request: Request,
    format: str = "json",
    window: str = "total",
) -> Response:
    _ = _require_admin_uid(request)
    safe_format = str(format or "json").strip().lower()
    safe_window = str(window or "total").strip().lower()
    if safe_window in {"24h", "last_24h", "day"}:
        safe_window = "last24h"
    elif safe_window in {"7d", "last_7d", "week"}:
        safe_window = "last7d"
    elif safe_window != "total":
        raise HTTPException(status_code=400, detail="window must be one of: total, 24h, 7d")

    summary = _admin_usage_summary_payload()
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    if safe_format in {"json", "application/json"}:
        payload = {
            **summary,
            "exportWindow": safe_window,
        }
        return JSONResponse(
            payload,
            headers={
                "content-disposition": f'attachment; filename="integration_usage_{safe_window}_{timestamp}.json"',
            },
        )
    if safe_format in {"csv", "text/csv"}:
        csv_text = _admin_usage_export_csv_rows(summary, safe_window)
        return Response(
            content=csv_text.encode("utf-8"),
            media_type="text/csv",
            headers={
                "content-disposition": f'attachment; filename="integration_usage_{safe_window}_{timestamp}.csv"',
            },
        )
    raise HTTPException(status_code=400, detail="format must be json or csv")


@app.get("/admin/users")
def admin_list_users(request: Request, q: str = "", limit: int = 50) -> JSONResponse:
    _ = _require_admin_uid(request)
    rows = _admin_list_users(limit=limit, search=q)
    return JSONResponse({"ok": True, "users": rows, "count": len(rows)})


@app.patch("/admin/users/{target_uid}")
def admin_patch_user(target_uid: str, payload: AdminUserPatchRequest, request: Request) -> JSONResponse:
    _ = _require_admin_uid(request)
    uid = str(target_uid or "").strip()
    if not uid:
        raise HTTPException(status_code=400, detail="Missing user uid.")
    entitlement = _normalize_entitlement_wallet(_load_entitlement(uid))

    patch: dict[str, Any] = {}
    if payload.plan is not None:
        normalized_plan = _normalize_plan_name(payload.plan)
        plan_cfg = _plan_config(normalized_plan)
        patch["plan"] = normalized_plan
        patch["monthlyVfLimit"] = plan_cfg["monthlyVfLimit"]
        patch["dailyGenerationLimit"] = plan_cfg["dailyGenerationLimit"]

    if payload.paidVfDelta is not None:
        delta = int(payload.paidVfDelta)
        patch["paidVfBalance"] = max(0, _as_positive_int(entitlement.get("paidVfBalance")) + delta)
    if payload.vffDelta is not None:
        delta = int(payload.vffDelta)
        patch["vffBalance"] = max(0, _as_positive_int(entitlement.get("vffBalance")) + delta)
        patch["vffMonthKey"] = _wallet_month_key()

    if patch:
        _write_entitlement(uid, patch)

    if payload.disabled is not None:
        _admin_set_user_disabled(uid, bool(payload.disabled))

    return JSONResponse({"ok": True, "uid": uid, "entitlements": _entitlement_usage_payload(uid)})


@app.post("/admin/users/{target_uid}/reset-password")
def admin_reset_user_password(target_uid: str, payload: AdminResetPasswordRequest, request: Request) -> JSONResponse:
    _ = _require_admin_uid(request)
    uid = str(target_uid or "").strip()
    if not uid:
        raise HTTPException(status_code=400, detail="Missing user uid.")
    _admin_set_user_password(uid, payload.newPassword)
    return JSONResponse({"ok": True, "uid": uid})


@app.post("/admin/users/{target_uid}/revoke-sessions")
def admin_revoke_user_sessions(target_uid: str, request: Request) -> JSONResponse:
    _ = _require_admin_uid(request)
    uid = str(target_uid or "").strip()
    if not uid:
        raise HTTPException(status_code=400, detail="Missing user uid.")
    _admin_revoke_user_sessions(uid)
    return JSONResponse({"ok": True, "uid": uid})


@app.delete("/admin/users/{target_uid}")
def admin_delete_user(target_uid: str, request: Request) -> JSONResponse:
    _ = _require_admin_uid(request)
    uid = str(target_uid or "").strip()
    if not uid:
        raise HTTPException(status_code=400, detail="Missing user uid.")

    if _firebase_ready() and firebase_auth is not None:
        try:
            firebase_auth.delete_user(uid)  # type: ignore[attr-defined]
        except Exception:
            # Best effort; Firestore cleanup still runs.
            pass

    collection_names = [
        "entitlements",
        "users",
        "generation_history",
        "usage_monthly",
        "usage_daily",
        "usage_events",
        "wallet_daily",
        "coupon_redemptions",
    ]
    if _FIRESTORE_DB is not None:
        for name in collection_names:
            try:
                coll = _FIRESTORE_DB.collection(name)
                if name in {"entitlements", "users", "generation_history"}:
                    coll.document(uid).delete()
                    continue
                docs = coll.where("uid", "==", uid).stream()
                for doc in docs:
                    doc.reference.delete()
            except Exception:
                continue
    else:
        with _INMEMORY_LOCK:
            _INMEMORY_ENTITLEMENTS.pop(uid, None)
            for key in [k for k in _INMEMORY_USAGE_MONTHLY.keys() if k.startswith(f"{uid}_")]:
                _INMEMORY_USAGE_MONTHLY.pop(key, None)
            for key in [k for k in _INMEMORY_USAGE_DAILY.keys() if k.startswith(f"{uid}_")]:
                _INMEMORY_USAGE_DAILY.pop(key, None)
            for key in [k for k in _INMEMORY_USAGE_EVENTS.keys() if k.startswith(f"{uid}_")]:
                _INMEMORY_USAGE_EVENTS.pop(key, None)
            for key in [k for k in _INMEMORY_WALLET_DAILY.keys() if k.startswith(f"{uid}_")]:
                _INMEMORY_WALLET_DAILY.pop(key, None)
            for key in [k for k, row in _INMEMORY_COUPON_REDEMPTIONS.items() if str(row.get("uid") or "") == uid]:
                _INMEMORY_COUPON_REDEMPTIONS.pop(key, None)
            _INMEMORY_GENERATION_HISTORY.pop(uid, None)
    _TTS_SUCCESS_LIMITER.clear_uid(uid)

    return JSONResponse({"ok": True, "uid": uid})


@app.post("/admin/coupons")
def admin_create_coupon(payload: CouponCreateRequest, request: Request) -> JSONResponse:
    admin_uid = _require_admin_uid(request)
    code = _normalize_coupon_code(payload.code)
    if not code:
        raise HTTPException(status_code=400, detail="Invalid coupon code.")
    credit_vf = _as_positive_int(payload.creditVf)
    if credit_vf <= 0:
        raise HTTPException(status_code=400, detail="creditVf must be positive.")
    max_redemptions = _as_positive_int(payload.maxRedemptions)
    expires_dt = _parse_optional_datetime(payload.expiresAt)
    coupon_id = f"coupon_{uuid.uuid4().hex[:12]}"
    now = _utc_now().isoformat()
    row = {
        "id": coupon_id,
        "code": code,
        "creditVf": credit_vf,
        "active": bool(payload.active),
        "maxRedemptions": max_redemptions,
        "redeemedCount": 0,
        "expiresAt": expires_dt.isoformat() if expires_dt else None,
        "note": str(payload.note or "")[:240],
        "createdBy": admin_uid,
        "createdAt": now,
        "updatedAt": now,
    }

    collection = _firestore_collection("coupons")
    if collection is None:
        with _INMEMORY_LOCK:
            for existing in _INMEMORY_COUPONS.values():
                if str(existing.get("code") or "").upper() == code:
                    raise HTTPException(status_code=409, detail="Coupon code already exists.")
            _INMEMORY_COUPONS[coupon_id] = row
    else:
        existing = list(collection.where("code", "==", code).limit(1).stream())
        if existing:
            raise HTTPException(status_code=409, detail="Coupon code already exists.")
        collection.document(coupon_id).set(row, merge=True)

    return JSONResponse({"ok": True, "coupon": row})


@app.get("/admin/coupons")
def admin_list_coupons(request: Request, limit: int = 100) -> JSONResponse:
    _ = _require_admin_uid(request)
    safe_limit = max(1, min(300, int(limit)))
    coupons: list[dict[str, Any]] = []
    collection = _firestore_collection("coupons")
    if collection is None:
        with _INMEMORY_LOCK:
            coupons = list(_INMEMORY_COUPONS.values())[:safe_limit]
    else:
        docs = collection.limit(safe_limit).stream()
        coupons = [{**(doc.to_dict() or {}), "id": doc.id} for doc in docs]
    coupons.sort(key=lambda row: str(row.get("createdAt") or ""), reverse=True)
    return JSONResponse({"ok": True, "coupons": coupons})


@app.patch("/admin/coupons/{coupon_id}")
def admin_patch_coupon(coupon_id: str, payload: CouponPatchRequest, request: Request) -> JSONResponse:
    _ = _require_admin_uid(request)
    safe_coupon_id = str(coupon_id or "").strip()
    if not safe_coupon_id:
        raise HTTPException(status_code=400, detail="Missing coupon id.")
    patch: dict[str, Any] = {"updatedAt": _utc_now().isoformat()}
    if payload.active is not None:
        patch["active"] = bool(payload.active)
    if payload.maxRedemptions is not None:
        patch["maxRedemptions"] = _as_positive_int(payload.maxRedemptions)
    if payload.expiresAt is not None:
        expires = _parse_optional_datetime(payload.expiresAt)
        patch["expiresAt"] = expires.isoformat() if expires else None
    if payload.note is not None:
        patch["note"] = str(payload.note)[:240]

    collection = _firestore_collection("coupons")
    if collection is None:
        with _INMEMORY_LOCK:
            current = _INMEMORY_COUPONS.get(safe_coupon_id)
            if not current:
                raise HTTPException(status_code=404, detail="Coupon not found.")
            current.update(patch)
            _INMEMORY_COUPONS[safe_coupon_id] = current
            return JSONResponse({"ok": True, "coupon": current})

    ref = collection.document(safe_coupon_id)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Coupon not found.")
    ref.set(patch, merge=True)
    fresh = ref.get().to_dict() or {}
    return JSONResponse({"ok": True, "coupon": {**fresh, "id": safe_coupon_id}})


@app.get("/admin/gemini/pools")
def admin_gemini_pools(request: Request) -> JSONResponse:
    _ = _require_admin_uid(request)
    config, meta = _load_gemini_api_pools(force=True)
    backend_snapshot = _backend_gemini_pool_snapshot()
    runtime_snapshot = _runtime_gemini_pool_snapshot()
    validation = _gemini_pools_validation(config)
    warnings = list((meta or {}).get("warnings") or [])
    return JSONResponse(
        {
            "ok": bool(validation.get("isValid")) and bool(runtime_snapshot.get("ok", True)),
            "config": config,
            "meta": meta,
            "validation": validation,
            "warnings": warnings,
            "sourcePolicy": dict(config.get("sourcePolicy") or {}),
            "backend": backend_snapshot,
            "runtime": runtime_snapshot,
        }
    )


@app.put("/admin/gemini/pools")
def admin_gemini_pools_put(payload: GeminiApiPoolsUpdateRequest, request: Request) -> JSONResponse:
    _ = _require_admin_uid(request)
    current_config, _current_meta = _load_gemini_api_pools(force=True)
    current_source_policy = dict(current_config.get("sourcePolicy") or {})
    free_pool_locked = bool(current_source_policy.get("freePoolLocked"))
    applied_overrides: list[str] = []

    raw_payload = payload.model_dump(exclude_none=True) if hasattr(payload, "model_dump") else payload.dict(exclude_none=True)
    normalized = normalize_gemini_pool_config(raw_payload)
    if free_pool_locked:
        current_pools = current_config.get("pools") if isinstance(current_config.get("pools"), dict) else {}
        locked_free_keys = list((current_pools.get("free") or {}).get("keys") or [])
        normalized["pools"]["free"]["keys"] = locked_free_keys
        applied_overrides.append("free_pool_locked_by_api_file")
    if current_source_policy:
        normalized["sourcePolicy"] = dict(current_source_policy)
    normalized, _sync_changed, sync_warnings = _sync_authoritative_gemini_free_pool(normalized)
    validation = _gemini_pools_validation(normalized)
    if not bool(validation.get("isValid")):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "duplicate_key_membership",
                "validation": validation,
            },
        )
    saved = _save_gemini_api_pools(normalized)
    key_pool = flatten_pool_keys(saved)
    if key_pool:
        BACKEND_GEMINI_ALLOCATOR.ensure_keys(key_pool)
    runtime_reload = _runtime_gemini_pool_reload()
    runtime_snapshot = _runtime_gemini_pool_snapshot()
    return JSONResponse(
        {
            "ok": bool(runtime_reload.get("ok")),
            "detail": "Gemini API pools updated.",
            "config": saved,
            "validation": _gemini_pools_validation(saved),
            "warnings": list(sync_warnings),
            "sourcePolicy": dict(saved.get("sourcePolicy") or {}),
            "appliedOverrides": applied_overrides,
            "backend": _backend_gemini_pool_snapshot(),
            "runtimeReload": runtime_reload,
            "runtime": runtime_snapshot,
        }
    )


@app.post("/admin/gemini/pools/reload")
def admin_gemini_pools_reload(request: Request) -> JSONResponse:
    _ = _require_admin_uid(request)
    _config, meta = _load_gemini_api_pools(force=True)
    key_pool = _resolve_gemini_fallback_key_pool()
    if not key_pool:
        raise HTTPException(status_code=400, detail="Gemini key pool is empty.")
    BACKEND_GEMINI_ALLOCATOR.ensure_keys(key_pool)
    backend_snapshot = _backend_gemini_pool_snapshot()
    runtime_reload = _runtime_gemini_pool_reload()
    runtime_snapshot = _runtime_gemini_pool_snapshot()
    return JSONResponse(
        {
            "ok": bool(backend_snapshot.get("ok")) and bool(runtime_reload.get("ok")),
            "detail": "Gemini API pools reloaded.",
            "warnings": list((meta or {}).get("warnings") or []),
            "backend": backend_snapshot,
            "runtimeReload": runtime_reload,
            "runtime": runtime_snapshot,
        }
    )


@app.get("/admin/gemini/pools/usage")
def admin_gemini_pools_usage(request: Request) -> JSONResponse:
    _ = _require_admin_uid(request)
    backend_usage = _backend_gemini_pool_usage_snapshot()
    runtime_usage = _runtime_gemini_pool_usage()
    return JSONResponse(
        {
            "ok": bool(backend_usage.get("ok")) and bool(runtime_usage.get("ok", True)),
            "backend": backend_usage,
            "runtime": runtime_usage,
        }
    )


@app.get("/admin/gemini/pool/status")
def admin_gemini_pool_status(request: Request) -> JSONResponse:
    # Legacy compatibility endpoint.
    return admin_gemini_pools(request)


@app.post("/admin/gemini/pool/reload")
def admin_gemini_pool_reload(request: Request) -> JSONResponse:
    # Legacy compatibility endpoint.
    return admin_gemini_pools_reload(request)


@app.post("/billing/checkout-session")
def billing_checkout_session(payload: BillingCheckoutSessionRequest, request: Request) -> JSONResponse:
    _require_stripe_ready()
    uid = _require_request_uid(request)
    plan_token = str(payload.plan or "").strip().lower()
    price_id = _stripe_price_id_for_plan(plan_token)
    if not price_id:
        raise HTTPException(status_code=400, detail="Unsupported plan. Use pro or plus.")
    if not STRIPE_PRICE_PRO_INR or not STRIPE_PRICE_PLUS_INR:
        raise HTTPException(status_code=503, detail="Stripe prices are not configured.")

    entitlement = _load_entitlement(uid)
    customer_id = str(entitlement.get("stripeCustomerId") or "").strip()
    if not customer_id:
        try:
            customer = stripe.Customer.create(  # type: ignore[attr-defined]
                metadata={"uid": uid},
                description=f"VoiceFlow user {uid}",
            )
            customer_id = str(customer.get("id") or "")
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"Failed to create Stripe customer: {exc}") from exc
        _write_entitlement(uid, {"stripeCustomerId": customer_id})
        _link_customer_uid(customer_id, uid)

    success_url = _resolve_checkout_url_override(payload.successUrl, STRIPE_CHECKOUT_SUCCESS_URL)
    cancel_url = _resolve_checkout_url_override(payload.cancelUrl, STRIPE_CHECKOUT_CANCEL_URL)
    try:
        session = stripe.checkout.Session.create(  # type: ignore[attr-defined]
            mode="subscription",
            customer=customer_id,
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=success_url,
            cancel_url=cancel_url,
            allow_promotion_codes=True,
            metadata={"uid": uid, "plan": plan_token},
            subscription_data={"metadata": {"uid": uid, "plan": plan_token}},
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Failed to create checkout session: {exc}") from exc

    return JSONResponse({"ok": True, "url": session.get("url"), "sessionId": session.get("id")})


@app.post("/billing/token-pack/checkout-session")
def billing_token_pack_checkout_session(payload: BillingTokenPackCheckoutSessionRequest, request: Request) -> JSONResponse:
    _require_stripe_ready()
    uid = _require_request_uid(request)
    entitlement = _load_entitlement(uid)
    plan_name = _normalize_plan_name(str(entitlement.get("plan") or "Free"))
    final_amount_inr = _token_pack_amount_inr_for_plan(plan_name)
    customer_id = str(entitlement.get("stripeCustomerId") or "").strip()
    if not customer_id:
        try:
            customer = stripe.Customer.create(  # type: ignore[attr-defined]
                metadata={"uid": uid},
                description=f"VoiceFlow user {uid}",
            )
            customer_id = str(customer.get("id") or "")
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"Failed to create Stripe customer: {exc}") from exc
        _write_entitlement(uid, {"stripeCustomerId": customer_id})
        _link_customer_uid(customer_id, uid)

    success_url = _resolve_checkout_url_override(payload.successUrl, STRIPE_CHECKOUT_SUCCESS_URL)
    cancel_url = _resolve_checkout_url_override(payload.cancelUrl, STRIPE_CHECKOUT_CANCEL_URL)
    try:
        session = stripe.checkout.Session.create(  # type: ignore[attr-defined]
            mode="payment",
            customer=customer_id,
            line_items=[
                {
                    "price_data": {
                        "currency": "inr",
                        "product_data": {"name": f"VoiceFlow {VF_TOKEN_PACK_VF_AMOUNT:,} paid VF pack"},
                        "unit_amount": final_amount_inr * 100,
                    },
                    "quantity": 1,
                }
            ],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "kind": "token_pack",
                "uid": uid,
                "packVf": str(VF_TOKEN_PACK_VF_AMOUNT),
                "finalAmountInr": str(final_amount_inr),
            },
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Failed to create token-pack checkout session: {exc}") from exc

    return JSONResponse(
        {
            "ok": True,
            "url": session.get("url"),
            "sessionId": session.get("id"),
            "packVf": VF_TOKEN_PACK_VF_AMOUNT,
            "finalAmountInr": final_amount_inr,
        }
    )


@app.post("/billing/portal-session")
def billing_portal_session(payload: BillingPortalSessionRequest, request: Request) -> JSONResponse:
    _require_stripe_ready()
    uid = _require_request_uid(request)
    entitlement = _load_entitlement(uid)
    customer_id = str(entitlement.get("stripeCustomerId") or "").strip()
    if not customer_id:
        raise HTTPException(status_code=400, detail="No Stripe customer is linked to this user.")
    return_url = _resolve_checkout_url_override(payload.returnUrl, STRIPE_PORTAL_RETURN_URL)
    try:
        session = stripe.billing_portal.Session.create(  # type: ignore[attr-defined]
            customer=customer_id,
            return_url=return_url,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Failed to create portal session: {exc}") from exc
    return JSONResponse({"ok": True, "url": session.get("url")})


@app.post("/billing/webhook")
async def billing_webhook(request: Request) -> JSONResponse:
    _require_stripe_ready()
    payload_raw = await request.body()
    signature = request.headers.get("stripe-signature")
    try:
        if STRIPE_WEBHOOK_SECRET:
            event = stripe.Webhook.construct_event(  # type: ignore[attr-defined]
                payload=payload_raw,
                sig_header=signature,
                secret=STRIPE_WEBHOOK_SECRET,
            )
        else:
            event = json.loads(payload_raw.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid webhook payload: {exc}") from exc

    event_type = str(event.get("type") or "")
    data_obj = (event.get("data") or {}).get("object") or {}

    try:
        if event_type == "checkout.session.completed":
            metadata = data_obj.get("metadata") if isinstance(data_obj.get("metadata"), dict) else {}
            checkout_kind = str(metadata.get("kind") or "").strip().lower()
            if checkout_kind == "token_pack":
                uid = str(metadata.get("uid") or "")
                if not uid:
                    uid = _resolve_uid_from_customer(str(data_obj.get("customer") or ""))
                if uid:
                    session_id = str(data_obj.get("id") or "")
                    pack_vf = _as_positive_int(metadata.get("packVf") or VF_TOKEN_PACK_VF_AMOUNT)
                    tx_id = f"stripe_checkout_token_pack_{session_id}" if session_id else ""
                    _credit_paid_vf(
                        uid=uid,
                        amount=pack_vf,
                        reason="stripe_token_pack",
                        transaction_id=tx_id or None,
                        metadata={
                            "eventType": event_type,
                            "sessionId": session_id,
                            "amountTotal": _as_positive_int(data_obj.get("amount_total")),
                            "currency": str(data_obj.get("currency") or "inr"),
                        },
                    )
            else:
                uid = str(metadata.get("uid") or "")
                customer_id = str(data_obj.get("customer") or "")
                subscription_id = str(data_obj.get("subscription") or "")
                billing_country = ((data_obj.get("customer_details") or {}).get("address") or {}).get("country")
                if subscription_id and stripe is not None:
                    sub = stripe.Subscription.retrieve(subscription_id)  # type: ignore[attr-defined]
                    sub_status = str(sub.get("status") or "active")
                    items = ((sub.get("items") or {}).get("data") or [])
                    first_item = items[0] if items else {}
                    price_id = str(((first_item.get("price") or {}).get("id")) or "")
                else:
                    sub_status = "active"
                    price_id = _stripe_price_id_for_plan(str(metadata.get("plan") or "free"))
                if not uid:
                    uid = _resolve_uid_from_customer(customer_id)
                if uid:
                    _sync_entitlement_from_subscription(
                        uid=uid,
                        customer_id=customer_id,
                        subscription_id=subscription_id,
                        subscription_status=sub_status,
                        price_id=price_id,
                        billing_country=billing_country,
                    )
        elif event_type in {"customer.subscription.updated", "customer.subscription.deleted"}:
            customer_id = str(data_obj.get("customer") or "")
            uid = str((data_obj.get("metadata") or {}).get("uid") or "") or _resolve_uid_from_customer(customer_id)
            items = ((data_obj.get("items") or {}).get("data") or [])
            first_item = items[0] if items else {}
            price_id = str(((first_item.get("price") or {}).get("id")) or "")
            subscription_status = str(data_obj.get("status") or "")
            if event_type == "customer.subscription.deleted":
                subscription_status = "canceled"
                price_id = ""
            if uid:
                _sync_entitlement_from_subscription(
                    uid=uid,
                    customer_id=customer_id,
                    subscription_id=str(data_obj.get("id") or ""),
                    subscription_status=subscription_status,
                    price_id=price_id,
                )
        elif event_type in {"invoice.payment_failed", "invoice.paid"}:
            customer_id = str(data_obj.get("customer") or "")
            uid = _resolve_uid_from_customer(customer_id)
            if uid:
                if event_type == "invoice.payment_failed":
                    _write_entitlement(uid, {"status": "past_due"})
                elif event_type == "invoice.paid":
                    entitlement = _load_entitlement(uid)
                    if str(entitlement.get("plan") or "Free") != "Free":
                        _write_entitlement(uid, {"status": "active"})
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Webhook processing failed: {exc}") from exc

    return JSONResponse({"ok": True})


@app.post("/ai/generate-text")
def ai_generate_text(payload: AiGenerateTextRequest, request: Request) -> JSONResponse:
    _ = _require_request_uid(request)
    upstream = f"{GEMINI_RUNTIME_URL}/v1/generate-text"
    req_payload = {
        "systemPrompt": payload.systemPrompt,
        "userPrompt": payload.userPrompt,
        "jsonMode": bool(payload.jsonMode),
        "temperature": float(payload.temperature),
    }
    if payload.apiKey:
        req_payload["apiKey"] = payload.apiKey
    try:
        response = requests.post(upstream, json=req_payload, timeout=120)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Gemini runtime request failed: {exc}") from exc

    body: Any
    try:
        body = response.json()
    except Exception:
        body = {"detail": response.text}

    if not response.ok:
        raise HTTPException(status_code=response.status_code, detail=body.get("detail") if isinstance(body, dict) else str(body))
    return JSONResponse(body)


def _decode_runtime_error_detail(response: requests.Response) -> Any:
    content_type = str(response.headers.get("content-type") or "").lower()
    if "application/json" in content_type:
        try:
            payload = response.json()
            if isinstance(payload, dict) and "detail" in payload:
                detail = payload.get("detail")
                if isinstance(detail, str):
                    text = detail.strip()
                    if text.startswith("{") or text.startswith("["):
                        try:
                            return json.loads(text)
                        except Exception:
                            return detail
                return detail
            return payload
        except Exception:
            pass

    text_detail = str(response.text or "").strip()
    if text_detail:
        if text_detail.startswith("{") or text_detail.startswith("["):
            try:
                return json.loads(text_detail)
            except Exception:
                return text_detail[:1200]
        return text_detail[:1200]
    return "TTS runtime failed."


_GEMINI_CAPACITY_PRESSURE_ERROR_CODES = {
    "GEMINI_KEY_POOL_OVERLOADED",
    "GEMINI_KEY_POOL_TIMEOUT",
    "GEMINI_ALLOCATOR_ACQUIRE_TIMEOUT",
    "GEMINI_ALL_KEYS_RATE_LIMITED",
}
_GEMINI_UPSTREAM_TIMEOUT_ERROR_CODES = {
    "GEMINI_UPSTREAM_REQUEST_TIMEOUT",
}


def _is_gemini_capacity_pressure_error(detail: Any) -> bool:
    code = extract_error_code(detail)
    if not code:
        return False
    return code in _GEMINI_CAPACITY_PRESSURE_ERROR_CODES


def _is_gemini_upstream_timeout_error(detail: Any) -> bool:
    code = extract_error_code(detail)
    if not code:
        return False
    return code in _GEMINI_UPSTREAM_TIMEOUT_ERROR_CODES


def _map_runtime_failure_status(engine: str, status_code: int, detail: Any) -> int:
    safe_status = int(status_code)
    if engine == "GEM" and safe_status >= 500:
        if _is_gemini_upstream_timeout_error(detail):
            return 504
        if _is_gemini_capacity_pressure_error(detail):
            return 503
    return safe_status


def _is_retryable_runtime_failure(engine: str, status_code: int, detail: Any) -> bool:
    safe_status = int(status_code)
    if safe_status in {429, 500, 502, 503, 504}:
        return True
    if engine == "GEM":
        if _is_gemini_capacity_pressure_error(detail):
            return True
        if _is_gemini_upstream_timeout_error(detail):
            return True
    return False


def _build_tts_upstream_payload(
    payload: TtsSynthesizeRequest,
    *,
    engine: str,
    text: str,
    request_id: str,
    trace_id: str,
    plan_key: str,
) -> tuple[dict[str, Any], str]:
    if hasattr(payload, "model_dump"):
        upstream_payload = payload.model_dump(exclude_none=True)  # type: ignore[attr-defined]
    else:
        upstream_payload = payload.dict(exclude_none=True)
    upstream_payload.pop("stream", None)
    upstream_payload.pop("live_chunk_chars", None)
    upstream_payload.pop("live_chunk_words", None)
    upstream_payload.pop("post_tts_disable", None)
    upstream_payload["engine"] = engine
    upstream_payload["text"] = text
    upstream_payload.setdefault("trace_id", trace_id)
    upstream_payload.setdefault("request_id", request_id)

    voice_id = str(payload.voice_id or payload.voiceId or "").strip()
    if voice_id:
        upstream_payload["voice_id"] = voice_id
        upstream_payload["voiceId"] = voice_id

    if engine == "GEM":
        if not upstream_payload.get("voiceName"):
            upstream_payload["voiceName"] = voice_id or str(payload.voiceName or "Fenrir")
        upstream_payload["poolHint"] = plan_key_to_pool_hint(plan_key)
    elif engine == "KOKORO" and voice_id:
        upstream_payload["voiceId"] = voice_id

    multi_speaker_mode = str(payload.multi_speaker_mode or "").strip().lower()
    if multi_speaker_mode:
        if multi_speaker_mode not in {"studio_pair_groups", "legacy_windows", "off"}:
            raise HTTPException(
                status_code=400,
                detail="multi_speaker_mode must be one of: studio_pair_groups, legacy_windows, off",
            )
        upstream_payload["multi_speaker_mode"] = multi_speaker_mode

    if payload.multi_speaker_max_concurrency is not None:
        try:
            bounded_concurrency = max(1, min(10, int(payload.multi_speaker_max_concurrency)))
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail="multi_speaker_max_concurrency must be an integer.") from exc
        upstream_payload["multi_speaker_max_concurrency"] = bounded_concurrency

    if payload.multi_speaker_retry_once is not None:
        upstream_payload["multi_speaker_retry_once"] = bool(payload.multi_speaker_retry_once)
    if payload.multi_speaker_line_map is not None:
        upstream_payload["multi_speaker_line_map"] = payload.multi_speaker_line_map

    return upstream_payload, voice_id


def _build_tts_history_item(
    *,
    uid: str,
    request_id: str,
    trace_id: str,
    engine: str,
    voice_name: str,
    voice_id: str,
    text: str,
) -> None:
    _ = uid
    preview = text[:VF_GENERATION_HISTORY_PREVIEW_CHARS]
    if len(text) > VF_GENERATION_HISTORY_PREVIEW_CHARS:
        preview = f"{preview}..."
    history_item = {
        "id": request_id,
        "timestamp": int(time.time() * 1000),
        "status": "completed",
        "engine": engine,
        "voiceName": str(voice_name or "").strip(),
        "voiceId": str(voice_id or "").strip(),
        "chars": len(text),
        "textPreview": preview,
        "requestId": request_id,
        "traceId": str(trace_id or "").strip(),
    }
    _history_append_item(uid, history_item)


def _tts_job_lane_for_plan(plan_key: str) -> str:
    return normalize_lane(plan_key_to_pool_hint(plan_key))


def _tts_job_retry_backoff_ms(attempt: int) -> int:
    bounded_attempt = max(1, int(attempt))
    return min(10_000, int(VF_TTS_QUEUE_BACKOFF_BASE_MS * (2 ** max(0, bounded_attempt - 1))))


def _safe_tts_engine_name(engine: str) -> str:
    normalized = _normalize_engine_name(str(engine or "GEM"))
    return "KOKORO" if normalized == "KOKORO" else "GEM"


def _sample_stats(values: list[int]) -> dict[str, int]:
    if not values:
        return {
            "count": 0,
            "avgMs": 0,
            "p50Ms": 0,
            "p95Ms": 0,
            "p99Ms": 0,
            "maxMs": 0,
        }
    ordered = sorted(max(0, int(item)) for item in values)
    count = len(ordered)

    def _pick(percentile: float) -> int:
        if count <= 1:
            return int(ordered[0])
        index = int(round((count - 1) * percentile))
        index = max(0, min(index, count - 1))
        return int(ordered[index])

    return {
        "count": int(count),
        "avgMs": int(sum(ordered) / max(1, count)),
        "p50Ms": _pick(0.50),
        "p95Ms": _pick(0.95),
        "p99Ms": _pick(0.99),
        "maxMs": int(ordered[-1]),
    }


def _default_engine_runtime_ms(engine: str) -> int:
    safe_engine = _safe_tts_engine_name(engine)
    if safe_engine == "KOKORO":
        return 2_000
    return 3_200


def _record_tts_job_enqueued(*, job_id: str, engine: str, created_at_ms: int) -> None:
    safe_engine = _safe_tts_engine_name(engine)
    safe_job_id = str(job_id or "").strip()
    if not safe_job_id:
        return
    with _TTS_ENGINE_METRICS_LOCK:
        queue_counts = _TTS_ENGINE_QUEUE_COUNTS.setdefault(safe_engine, {"queued": 0, "running": 0})
        queued_ids = _TTS_ENGINE_QUEUED_JOB_IDS.setdefault(safe_engine, set())
        running_ids = _TTS_ENGINE_RUNNING_JOB_IDS.setdefault(safe_engine, set())
        if safe_job_id in queued_ids or safe_job_id in running_ids:
            return
        queued_ids.add(safe_job_id)
        queue_counts["queued"] = max(0, int(queue_counts.get("queued") or 0) + 1)
        _TTS_ENGINE_ENQUEUED_AT_MS[safe_job_id] = max(0, int(created_at_ms))


def _record_tts_job_started(*, job: dict[str, Any]) -> None:
    safe_job_id = str(job.get("jobId") or "").strip()
    if not safe_job_id:
        return
    safe_engine = _safe_tts_engine_name(str(job.get("engine") or "GEM"))
    created_at_ms = int(job.get("createdAtMs") or 0)
    started_at_ms = int(job.get("startedAtMs") or 0)
    enqueue_delay_ms = max(0, started_at_ms - created_at_ms) if created_at_ms > 0 and started_at_ms > 0 else 0

    with _TTS_ENGINE_METRICS_LOCK:
        queue_counts = _TTS_ENGINE_QUEUE_COUNTS.setdefault(safe_engine, {"queued": 0, "running": 0})
        queued_ids = _TTS_ENGINE_QUEUED_JOB_IDS.setdefault(safe_engine, set())
        running_ids = _TTS_ENGINE_RUNNING_JOB_IDS.setdefault(safe_engine, set())
        if safe_job_id in queued_ids:
            queued_ids.discard(safe_job_id)
            queue_counts["queued"] = max(0, int(queue_counts.get("queued") or 0) - 1)
        if safe_job_id not in running_ids:
            running_ids.add(safe_job_id)
            queue_counts["running"] = max(0, int(queue_counts.get("running") or 0) + 1)
        _TTS_ENGINE_ENQUEUED_AT_MS.setdefault(safe_job_id, created_at_ms)
        _TTS_QUEUE_TELEMETRY["enqueueToStartMs"].append(enqueue_delay_ms)


def _record_tts_job_requeued(*, job_id: str, engine: str) -> None:
    safe_engine = _safe_tts_engine_name(engine)
    safe_job_id = str(job_id or "").strip()
    if not safe_job_id:
        return
    with _TTS_ENGINE_METRICS_LOCK:
        queue_counts = _TTS_ENGINE_QUEUE_COUNTS.setdefault(safe_engine, {"queued": 0, "running": 0})
        queued_ids = _TTS_ENGINE_QUEUED_JOB_IDS.setdefault(safe_engine, set())
        running_ids = _TTS_ENGINE_RUNNING_JOB_IDS.setdefault(safe_engine, set())
        if safe_job_id in running_ids:
            running_ids.discard(safe_job_id)
            queue_counts["running"] = max(0, int(queue_counts.get("running") or 0) - 1)
        if safe_job_id not in queued_ids:
            queued_ids.add(safe_job_id)
            queue_counts["queued"] = max(0, int(queue_counts.get("queued") or 0) + 1)


def _record_tts_terminal_event(*, job_id: str, engine: str, status: str, reason: str, status_code: int) -> None:
    safe_engine = _safe_tts_engine_name(engine)
    safe_job_id = str(job_id or "").strip()
    safe_status = str(status or "").strip().lower() or "failed"
    safe_reason = str(reason or "").strip().lower() or "unknown"
    now_ms = int(time.time() * 1000)
    with _TTS_ENGINE_METRICS_LOCK:
        queue_counts = _TTS_ENGINE_QUEUE_COUNTS.setdefault(safe_engine, {"queued": 0, "running": 0})
        queued_ids = _TTS_ENGINE_QUEUED_JOB_IDS.setdefault(safe_engine, set())
        running_ids = _TTS_ENGINE_RUNNING_JOB_IDS.setdefault(safe_engine, set())
        if safe_job_id in queued_ids:
            queued_ids.discard(safe_job_id)
            queue_counts["queued"] = max(0, int(queue_counts.get("queued") or 0) - 1)
        if safe_job_id in running_ids:
            running_ids.discard(safe_job_id)
            queue_counts["running"] = max(0, int(queue_counts.get("running") or 0) - 1)
        _TTS_ENGINE_ENQUEUED_AT_MS.pop(safe_job_id, None)
        _TTS_QUEUE_TELEMETRY["terminalEvents"].append(
            {
                "status": safe_status,
                "reason": safe_reason,
                "engine": safe_engine,
                "statusCode": int(status_code),
                "timestampMs": now_ms,
            }
        )


def _record_tts_runtime_latency(*, engine: str, elapsed_ms: int) -> None:
    safe_engine = _safe_tts_engine_name(engine)
    safe_elapsed = max(0, int(elapsed_ms))
    with _TTS_ENGINE_METRICS_LOCK:
        _TTS_QUEUE_TELEMETRY["runtimeLatencyMs"].append(safe_elapsed)
        runtime_by_engine = _TTS_QUEUE_TELEMETRY.get("runtimeLatencyByEngine")
        if isinstance(runtime_by_engine, dict):
            runtime_by_engine.setdefault(safe_engine, deque(maxlen=VF_TTS_QUEUE_METRICS_WINDOW)).append(safe_elapsed)


def _record_tts_engine_semaphore_wait(*, engine: str, wait_ms: int) -> None:
    safe_engine = _safe_tts_engine_name(engine)
    safe_wait = max(0, int(wait_ms))
    with _TTS_ENGINE_METRICS_LOCK:
        _TTS_QUEUE_TELEMETRY["engineSemaphoreWaitMs"].append(safe_wait)
        waits_by_engine = _TTS_QUEUE_TELEMETRY.get("semaphoreWaitByEngine")
        if isinstance(waits_by_engine, dict):
            waits_by_engine.setdefault(safe_engine, deque(maxlen=VF_TTS_QUEUE_METRICS_WINDOW)).append(safe_wait)


def _record_tts_live_first_chunk_latency(*, elapsed_ms: int) -> None:
    safe_elapsed = max(0, int(elapsed_ms))
    with _TTS_ENGINE_METRICS_LOCK:
        source = _TTS_QUEUE_TELEMETRY.get("liveFirstChunkLatencyMs")
        if isinstance(source, deque):
            source.append(safe_elapsed)


def _record_tts_live_chunk_count(*, chunk_count: int) -> None:
    safe_count = max(0, int(chunk_count))
    with _TTS_ENGINE_METRICS_LOCK:
        source = _TTS_QUEUE_TELEMETRY.get("liveChunkCount")
        if isinstance(source, deque):
            source.append(safe_count)


def _record_tts_live_chunk_rvc_latency(*, elapsed_ms: int) -> None:
    safe_elapsed = max(0, int(elapsed_ms))
    with _TTS_ENGINE_METRICS_LOCK:
        source = _TTS_QUEUE_TELEMETRY.get("liveChunkRvcLatencyMs")
        if isinstance(source, deque):
            source.append(safe_elapsed)


def _record_tts_engine_active(*, engine: str, delta: int) -> None:
    safe_engine = _safe_tts_engine_name(engine)
    with _TTS_ENGINE_METRICS_LOCK:
        current = int(_TTS_ENGINE_ACTIVE_COUNTS.get(safe_engine) or 0)
        _TTS_ENGINE_ACTIVE_COUNTS[safe_engine] = max(0, current + int(delta))


def _oldest_tts_queue_age_ms() -> int:
    now_ms = int(time.time() * 1000)
    with _TTS_ENGINE_METRICS_LOCK:
        queued_job_ids: set[str] = set()
        for ids in _TTS_ENGINE_QUEUED_JOB_IDS.values():
            queued_job_ids.update(ids)
        if not queued_job_ids:
            return 0
        created_values = [int(_TTS_ENGINE_ENQUEUED_AT_MS.get(job_id) or 0) for job_id in queued_job_ids]
        created_values = [value for value in created_values if value > 0]
        if not created_values:
            return 0
        oldest_created = min(created_values)
    return max(0, now_ms - oldest_created)


def _estimate_tts_completion_delay(engine: str) -> dict[str, int]:
    safe_engine = _safe_tts_engine_name(engine)
    with _TTS_ENGINE_METRICS_LOCK:
        counts = _TTS_ENGINE_QUEUE_COUNTS.get(safe_engine) or {"queued": 0, "running": 0}
        queued = max(0, int(counts.get("queued") or 0))
        running = max(0, int(counts.get("running") or 0))
        runtime_by_engine = _TTS_QUEUE_TELEMETRY.get("runtimeLatencyByEngine")
        runtime_samples: list[int] = []
        if isinstance(runtime_by_engine, dict):
            sample_source = runtime_by_engine.get(safe_engine)
            if isinstance(sample_source, deque):
                runtime_samples = [max(0, int(value)) for value in list(sample_source)]
    avg_runtime_ms = int(sum(runtime_samples) / len(runtime_samples)) if runtime_samples else _default_engine_runtime_ms(safe_engine)
    engine_limit = max(1, int(_TTS_ENGINE_CONCURRENCY_LIMITS.get(safe_engine) or 1))
    effective_parallelism = max(1, min(engine_limit, int(VF_TTS_QUEUE_WORKER_COUNT)))
    jobs_ahead = max(0, queued + running)
    predicted_batches = int(jobs_ahead // effective_parallelism) + 1
    estimated_completion_ms = max(avg_runtime_ms, int(predicted_batches * avg_runtime_ms))
    return {
        "engine": safe_engine,
        "queued": queued,
        "running": running,
        "jobsAhead": jobs_ahead,
        "concurrency": effective_parallelism,
        "avgRuntimeMs": avg_runtime_ms,
        "estimatedCompletionMs": estimated_completion_ms,
    }


def _tts_queue_metrics_snapshot() -> dict[str, Any]:
    queue_depth = _TTS_JOB_QUEUE.depth_snapshot()
    now_iso = datetime.now(timezone.utc).isoformat()
    oldest_age_ms = _oldest_tts_queue_age_ms()
    with _TTS_ENGINE_METRICS_LOCK:
        enqueue_samples = [max(0, int(value)) for value in list(_TTS_QUEUE_TELEMETRY["enqueueToStartMs"])]
        runtime_samples = [max(0, int(value)) for value in list(_TTS_QUEUE_TELEMETRY["runtimeLatencyMs"])]
        semaphore_samples = [max(0, int(value)) for value in list(_TTS_QUEUE_TELEMETRY["engineSemaphoreWaitMs"])]
        live_first_chunk_samples = [max(0, int(value)) for value in list(_TTS_QUEUE_TELEMETRY.get("liveFirstChunkLatencyMs") or [])]
        live_chunk_count_samples = [max(0, int(value)) for value in list(_TTS_QUEUE_TELEMETRY.get("liveChunkCount") or [])]
        live_chunk_rvc_samples = [max(0, int(value)) for value in list(_TTS_QUEUE_TELEMETRY.get("liveChunkRvcLatencyMs") or [])]
        terminal_events = list(_TTS_QUEUE_TELEMETRY["terminalEvents"])
        runtime_by_engine = _TTS_QUEUE_TELEMETRY.get("runtimeLatencyByEngine")
        waits_by_engine = _TTS_QUEUE_TELEMETRY.get("semaphoreWaitByEngine")
        engine_counts = json.loads(json.dumps(_TTS_ENGINE_QUEUE_COUNTS))
        engine_active = dict(_TTS_ENGINE_ACTIVE_COUNTS)

    terminal_by_status: dict[str, int] = defaultdict(int)
    terminal_by_reason: dict[str, int] = defaultdict(int)
    for event in terminal_events:
        status = str((event or {}).get("status") or "unknown").strip().lower() or "unknown"
        reason = str((event or {}).get("reason") or "unknown").strip().lower() or "unknown"
        terminal_by_status[status] += 1
        terminal_by_reason[reason] += 1

    engines_payload: dict[str, Any] = {}
    for engine in sorted(_TTS_ENGINE_CONCURRENCY_LIMITS):
        runtime_samples_engine: list[int] = []
        semaphore_samples_engine: list[int] = []
        if isinstance(runtime_by_engine, dict):
            source = runtime_by_engine.get(engine)
            if isinstance(source, deque):
                runtime_samples_engine = [max(0, int(value)) for value in list(source)]
        if isinstance(waits_by_engine, dict):
            source = waits_by_engine.get(engine)
            if isinstance(source, deque):
                semaphore_samples_engine = [max(0, int(value)) for value in list(source)]
        engine_snapshot = engine_counts.get(engine) if isinstance(engine_counts, dict) else None
        engines_payload[engine] = {
            "concurrencyLimit": int(_TTS_ENGINE_CONCURRENCY_LIMITS.get(engine) or 1),
            "active": max(0, int(engine_active.get(engine) or 0)),
            "queued": max(0, int((engine_snapshot or {}).get("queued") or 0)),
            "running": max(0, int((engine_snapshot or {}).get("running") or 0)),
            "runtimeLatencyMs": _sample_stats(runtime_samples_engine),
            "semaphoreWaitMs": _sample_stats(semaphore_samples_engine),
            "estimatedNextJobCompletionMs": int(_estimate_tts_completion_delay(engine).get("estimatedCompletionMs") or 0),
        }

    worker_threads = list(_TTS_JOB_WORKER_THREADS)
    worker_payload = {
        "configured": int(VF_TTS_QUEUE_WORKER_COUNT),
        "spawned": len(worker_threads),
        "alive": sum(1 for thread in worker_threads if thread.is_alive()),
        "workers": [
            {
                "name": str(thread.name or ""),
                "alive": bool(thread.is_alive()),
                "daemon": bool(thread.daemon),
            }
            for thread in worker_threads
        ],
    }

    return {
        "ok": True,
        "generatedAt": now_iso,
        "gateway": _TTS_GATEWAY_CONTROLLER.snapshot(),
        "queue": queue_depth,
        "workers": worker_payload,
        "engines": engines_payload,
        "telemetry": {
            "enqueueToStartMs": _sample_stats(enqueue_samples),
            "runtimeLatencyMs": _sample_stats(runtime_samples),
            "engineSemaphoreWaitMs": _sample_stats(semaphore_samples),
            "liveFirstChunkLatencyMs": _sample_stats(live_first_chunk_samples),
            "liveChunkCount": _sample_stats(live_chunk_count_samples),
            "liveChunkRvcLatencyMs": _sample_stats(live_chunk_rvc_samples),
            "terminalStatusesByReason": {
                "byStatus": dict(terminal_by_status),
                "byReason": dict(terminal_by_reason),
                "sampleCount": len(terminal_events),
            },
            "oldestQueuedAgeMs": int(oldest_age_ms),
        },
    }


def _mark_job_failed_and_revert_usage(
    *,
    job_id: str,
    uid: str,
    request_id: str,
    status_code: int,
    detail: Any,
    error_tag: str,
) -> None:
    _finalize_usage(uid, request_id, success=False, error_detail=error_tag)
    failed_job = _TTS_JOB_QUEUE.mark_failed(job_id, status_code=status_code, error=detail)
    failed_engine = _safe_tts_engine_name(str((failed_job or {}).get("engine") or "GEM"))
    reason = error_tag
    if isinstance(detail, dict):
        reason = str(detail.get("reason") or reason or "failed")
    _record_tts_terminal_event(
        job_id=job_id,
        engine=failed_engine,
        status="failed",
        reason=str(reason or "failed"),
        status_code=int(status_code),
    )


def _normalize_rvc_preset(value: str) -> str:
    token = str(value or "").strip().lower()
    if token in {"cover_hq", "cover", "hq"}:
        return "cover_hq"
    return "tts_realtime"


def _safe_bounded_int(value: Any, *, default: int, min_value: int, max_value: int) -> int:
    try:
        parsed = int(value)
    except Exception:
        parsed = int(default)
    return max(int(min_value), min(int(max_value), parsed))


def _live_chunk_word_count(text: str) -> int:
    return len(re.findall(r"\S+", str(text or "")))


def _split_segment_by_words(segment: str, *, max_chars: int, max_words: int) -> list[str]:
    words = [token for token in str(segment or "").split() if token]
    if not words:
        return []
    chunks: list[str] = []
    current_words: list[str] = []
    current_len = 0
    for word in words:
        word_len = len(word)
        projected_len = word_len if not current_words else current_len + 1 + word_len
        projected_words = len(current_words) + 1
        if current_words and (projected_len > max_chars or projected_words > max_words):
            chunks.append(" ".join(current_words).strip())
            current_words = [word]
            current_len = word_len
        else:
            current_words.append(word)
            current_len = projected_len
    if current_words:
        chunks.append(" ".join(current_words).strip())
    return [chunk for chunk in chunks if chunk]


def _split_plain_text_live_chunks(text: str, *, max_chars: int, max_words: int) -> list[dict[str, Any]]:
    normalized_text = str(text or "").replace("\r\n", "\n").strip()
    if not normalized_text:
        return []
    raw_segments = [
        re.sub(r"\s+", " ", part).strip()
        for part in re.split(r"(?:\n+|(?<=[.!?।])\s+)", normalized_text)
        if str(part or "").strip()
    ]
    segments: list[str] = []
    for segment in raw_segments:
        if len(segment) > max_chars or _live_chunk_word_count(segment) > max_words:
            segments.extend(_split_segment_by_words(segment, max_chars=max_chars, max_words=max_words))
        else:
            segments.append(segment)
    if not segments:
        segments = _split_segment_by_words(normalized_text, max_chars=max_chars, max_words=max_words)
    if not segments:
        return []

    out: list[dict[str, Any]] = []
    current: list[str] = []
    current_chars = 0
    current_words = 0
    for segment in segments:
        seg_chars = len(segment)
        seg_words = max(1, _live_chunk_word_count(segment))
        projected_chars = seg_chars if not current else current_chars + 1 + seg_chars
        projected_words = current_words + seg_words
        if current and (projected_chars > max_chars or projected_words > max_words):
            text_chunk = " ".join(current).strip()
            if text_chunk:
                out.append(
                    {
                        "text": text_chunk,
                        "textChars": len(text_chunk),
                        "wordCount": max(1, _live_chunk_word_count(text_chunk)),
                    }
                )
            current = [segment]
            current_chars = seg_chars
            current_words = seg_words
        else:
            current.append(segment)
            current_chars = projected_chars
            current_words = projected_words

    if current:
        text_chunk = " ".join(current).strip()
        if text_chunk:
            out.append(
                {
                    "text": text_chunk,
                    "textChars": len(text_chunk),
                    "wordCount": max(1, _live_chunk_word_count(text_chunk)),
                }
            )
    return out


def _select_chunk_speaker_voices(
    speaker_voices: list[dict[str, Any]],
    chunk_speakers: set[str],
) -> list[dict[str, Any]]:
    if not chunk_speakers:
        return list(speaker_voices)
    normalized_keys = {str(value).strip().lower() for value in chunk_speakers if str(value or "").strip()}
    out: list[dict[str, Any]] = []
    for item in speaker_voices:
        if not isinstance(item, dict):
            continue
        speaker = str(item.get("speaker") or "").strip().lower()
        if speaker and speaker in normalized_keys:
            out.append(dict(item))
    if out:
        return out
    return list(speaker_voices)


def _build_line_map_live_chunks(
    *,
    line_map: list[dict[str, Any]],
    speaker_voices: list[dict[str, Any]],
    max_chars: int,
    max_words: int,
) -> list[dict[str, Any]]:
    if not line_map:
        return []
    windows: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_chars = 0
    current_words = 0
    for line in line_map:
        speaker = str(line.get("speaker") or "").strip()
        text = str(line.get("text") or "").strip()
        if not speaker or not text:
            continue
        render = f"{speaker}: {text}"
        line_chars = len(render)
        line_words = max(1, _live_chunk_word_count(text))
        projected_chars = line_chars if not current else current_chars + 1 + line_chars
        projected_words = current_words + line_words
        if current and (projected_chars > max_chars or projected_words > max_words):
            windows.append(current)
            current = []
            current_chars = 0
            current_words = 0
            projected_chars = line_chars
            projected_words = line_words
        current.append(
            {
                "lineIndex": int(line.get("lineIndex") or 0),
                "speaker": speaker,
                "text": text,
            }
        )
        current_chars = projected_chars
        current_words = projected_words
    if current:
        windows.append(current)

    out: list[dict[str, Any]] = []
    for window in windows:
        chunk_text = "\n".join(f"{str(item.get('speaker') or '').strip()}: {str(item.get('text') or '').strip()}" for item in window).strip()
        if not chunk_text:
            continue
        speakers = {
            str(item.get("speaker") or "").strip()
            for item in window
            if str(item.get("speaker") or "").strip()
        }
        out.append(
            {
                "text": chunk_text,
                "textChars": len(chunk_text),
                "wordCount": max(1, _live_chunk_word_count(chunk_text)),
                "multiSpeakerLineMap": window,
                "speakerVoices": _select_chunk_speaker_voices(speaker_voices, speakers),
            }
        )
    return out


def _split_text_live_chunks(
    *,
    engine: str,
    text: str,
    language: str,
    chunk_chars: int,
    chunk_words: int,
    multi_speaker_payload: Optional[dict[str, Any]] = None,
) -> list[dict[str, Any]]:
    _ = language
    safe_chars = _safe_bounded_int(
        chunk_chars,
        default=VF_TTS_LIVE_CHUNK_CHARS_DEFAULT,
        min_value=120,
        max_value=VF_TTS_LIVE_CHUNK_CHARS_MAX,
    )
    safe_words = _safe_bounded_int(
        chunk_words,
        default=VF_TTS_LIVE_CHUNK_WORDS_DEFAULT,
        min_value=24,
        max_value=VF_TTS_LIVE_CHUNK_WORDS_MAX,
    )
    safe_engine = _safe_tts_engine_name(engine)
    source_payload = multi_speaker_payload or {}
    if safe_engine == "GEM":
        mode = str(source_payload.get("multi_speaker_mode") or "").strip().lower()
        raw_line_map = source_payload.get("multi_speaker_line_map")
        line_map = normalize_multi_speaker_line_map_shared(raw_line_map)
        raw_speaker_voices = source_payload.get("speaker_voices")
        speaker_voices = [dict(item) for item in list(raw_speaker_voices or []) if isinstance(item, dict)]
        if mode == "studio_pair_groups" and line_map:
            line_chunks = _build_line_map_live_chunks(
                line_map=line_map,
                speaker_voices=speaker_voices,
                max_chars=safe_chars,
                max_words=safe_words,
            )
            if line_chunks:
                return line_chunks
    return _split_plain_text_live_chunks(text, max_chars=safe_chars, max_words=safe_words)


def _build_gem_chunk_payload(base_payload: dict[str, Any], chunk: dict[str, Any]) -> dict[str, Any]:
    payload = dict(base_payload)
    payload["text"] = str(chunk.get("text") or "").strip()
    line_map = chunk.get("multiSpeakerLineMap")
    speaker_voices = chunk.get("speakerVoices")
    if isinstance(line_map, list) and line_map:
        payload["multi_speaker_mode"] = "studio_pair_groups"
        payload["multi_speaker_line_map"] = line_map
        if isinstance(speaker_voices, list) and speaker_voices:
            payload["speaker_voices"] = speaker_voices
    else:
        payload.pop("multi_speaker_line_map", None)
    return payload


def _build_live_chunk_upstream_payload(*, engine: str, base_payload: dict[str, Any], chunk: dict[str, Any]) -> dict[str, Any]:
    safe_engine = _safe_tts_engine_name(engine)
    if safe_engine == "GEM":
        return _build_gem_chunk_payload(base_payload, chunk)
    payload = dict(base_payload)
    payload["text"] = str(chunk.get("text") or "").strip()
    payload.pop("multi_speaker_line_map", None)
    return payload


def _read_wav_info(wav_bytes: bytes) -> dict[str, int]:
    with wave.open(BytesIO(bytes(wav_bytes or b"")), "rb") as handle:
        frame_rate = int(handle.getframerate() or 0)
        frames = int(handle.getnframes() or 0)
        channels = int(handle.getnchannels() or 0)
        sample_width = int(handle.getsampwidth() or 0)
        duration_ms = int(round((float(frames) / float(frame_rate)) * 1000.0)) if frame_rate > 0 and frames > 0 else 0
    return {
        "sampleRate": frame_rate,
        "frames": frames,
        "channels": channels,
        "sampleWidth": sample_width,
        "durationMs": duration_ms,
    }


def _concat_wav_chunks(chunks: list[bytes]) -> bytes:
    if not chunks:
        return b""
    params: Optional[tuple[int, int, int]] = None
    raw_frames: list[bytes] = []
    for chunk in chunks:
        with wave.open(BytesIO(bytes(chunk or b"")), "rb") as handle:
            current = (
                int(handle.getnchannels() or 0),
                int(handle.getsampwidth() or 0),
                int(handle.getframerate() or 0),
            )
            if params is None:
                params = current
            elif current != params:
                raise RuntimeError("Live TTS chunk WAV format mismatch.")
            raw_frames.append(handle.readframes(int(handle.getnframes() or 0)))
    if params is None:
        return b""
    output = BytesIO()
    with wave.open(output, "wb") as writer:
        writer.setnchannels(params[0])
        writer.setsampwidth(params[1])
        writer.setframerate(params[2])
        for frame_chunk in raw_frames:
            writer.writeframes(frame_chunk)
    return output.getvalue()


def _tts_live_job_dir(job_id: str) -> Path:
    safe_job_id = re.sub(r"[^a-zA-Z0-9_.-]+", "_", str(job_id or "").strip()) or "unknown_job"
    return TTS_LIVE_ARTIFACTS_DIR / safe_job_id


def _persist_live_chunk(job_id: str, index: int, wav_bytes: bytes, meta: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    safe_index = max(0, int(index))
    job_dir = _tts_live_job_dir(job_id)
    job_dir.mkdir(parents=True, exist_ok=True)
    path = job_dir / f"chunk_{safe_index:04d}.wav"
    content = bytes(wav_bytes or b"")
    path.write_bytes(content)
    wav_info = _read_wav_info(content)
    payload: dict[str, Any] = {
        "index": safe_index,
        "contentType": "audio/wav",
        "durationMs": int(wav_info.get("durationMs") or 0),
        "sampleRate": int(wav_info.get("sampleRate") or 0),
        "textChars": int(meta.get("textChars") or 0) if isinstance(meta, dict) else 0,
        "engine": str((meta or {}).get("engine") or ""),
        "traceId": str((meta or {}).get("traceId") or ""),
        "path": str(path),
        "sizeBytes": len(content),
    }
    return payload


def _cleanup_live_artifacts(job_id: str) -> None:
    safe_job_id = str(job_id or "").strip()
    if not safe_job_id:
        return
    job_dir = _tts_live_job_dir(safe_job_id)
    if not job_dir.exists():
        return
    _cleanup_paths(str(job_dir))


def _cleanup_expired_live_artifacts() -> None:
    now_ms = int(time.time() * 1000)
    ttl_ms = max(60_000, int(VF_TTS_LIVE_ARTIFACT_TTL_MS))
    if not TTS_LIVE_ARTIFACTS_DIR.exists():
        return
    for child in list(TTS_LIVE_ARTIFACTS_DIR.iterdir()):
        if not child.is_dir():
            continue
        try:
            mtime_ms = int(child.stat().st_mtime * 1000)
        except Exception:
            continue
        if mtime_ms <= 0:
            continue
        if (now_ms - mtime_ms) < ttl_ms:
            continue
        _cleanup_paths(str(child))


def _load_live_chunks_from_artifacts(job_id: str, *, engine: str, trace_id: str) -> list[dict[str, Any]]:
    safe_job_id = str(job_id or "").strip()
    if not safe_job_id:
        return []
    job_dir = _tts_live_job_dir(safe_job_id)
    if not job_dir.exists() or not job_dir.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for child in sorted(job_dir.glob("chunk_*.wav")):
        if not child.is_file():
            continue
        match = re.match(r"^chunk_(\d+)\.wav$", child.name, flags=re.IGNORECASE)
        if not match:
            continue
        try:
            index = int(match.group(1))
        except Exception:
            continue
        try:
            data = child.read_bytes()
            wav_info = _read_wav_info(data)
        except Exception:
            wav_info = {"durationMs": 0, "sampleRate": 0}
        out.append(
            {
                "index": int(index),
                "contentType": "audio/wav",
                "durationMs": int(wav_info.get("durationMs") or 0),
                "sampleRate": int(wav_info.get("sampleRate") or 0),
                "textChars": 0,
                "engine": str(engine or ""),
                "traceId": str(trace_id or ""),
                "path": str(child.resolve()),
            }
        )
    out.sort(key=lambda item: int(item.get("index") or 0))
    return out


def _load_live_chunk_audio_base64(chunk: dict[str, Any]) -> str:
    path = Path(str(chunk.get("path") or "")).resolve()
    if not path.exists() or not path.is_file():
        return ""
    try:
        data = path.read_bytes()
    except Exception:
        return ""
    if not data:
        return ""
    return base64.b64encode(data).decode("ascii")


def _convert_tts_audio_with_rvc_runtime(
    *,
    audio_bytes: bytes,
    engine: str,
    voice_id: str,
    voice_name: str,
) -> tuple[bytes, dict[str, str]]:
    model_name, profile_id = _resolve_mapped_model_name(engine, voice_id, voice_name=voice_name)
    if not model_name:
        raise RuntimeError(f"No mapped RVC model for {engine}:{voice_id or voice_name}.")

    temp_dir = tempfile.mkdtemp(prefix="vf_tts_post_rvc_")
    input_path = Path(temp_dir) / "tts_input.wav"
    output_headers: dict[str, str] = {
        "x-vf-post-tts-profile": str(profile_id or ""),
        "x-vf-post-tts-model": str(model_name),
    }
    try:
        input_path.write_bytes(audio_bytes)
        with input_path.open("rb") as handle:
            response = requests.post(
                f"{RVC_RUNTIME_URL}/v1/convert",
                files={"file": ("tts_input.wav", handle, "audio/wav")},
                data={
                    "model_name": str(model_name),
                    "preset": _normalize_rvc_preset(VF_TTS_POST_RVC_PRESET),
                },
                timeout=VF_TTS_POST_RVC_TIMEOUT_SEC,
            )
        if not response.ok:
            detail = response.text[:260] if response.text else f"HTTP {response.status_code}"
            raise RuntimeError(f"RVC runtime conversion failed: {detail}")
        output_headers["x-vf-post-tts-conversion"] = "rvc"
        return bytes(response.content or b""), output_headers
    finally:
        _cleanup_paths(temp_dir)


def _process_tts_job(job: dict[str, Any], worker_id: str) -> None:
    job_id = str(job.get("jobId") or "").strip()
    if not job_id:
        return
    current = _TTS_JOB_QUEUE.mark_running(job_id, worker_id=worker_id) or dict(job)
    status = str(current.get("status") or "").strip().lower()
    if status in {"completed", "failed", "cancelled"}:
        if status == "cancelled":
            _record_tts_terminal_event(
                job_id=job_id,
                engine=str(current.get("engine") or "GEM"),
                status="cancelled",
                reason="cancelled",
                status_code=409,
            )
        return
    _record_tts_job_started(job=current)

    uid = str(current.get("uid") or "").strip()
    request_id = str(current.get("requestId") or job_id).strip() or job_id
    trace_id = str(current.get("traceId") or request_id).strip() or request_id
    engine = _normalize_engine_name(str(current.get("engine") or "GEM"))
    text = str(current.get("text") or "")
    voice_id = str(current.get("voiceId") or "").strip()
    voice_name = str(current.get("voiceName") or "").strip()
    plan_name = str(current.get("planName") or "Free").strip() or "Free"
    plan_key = str(current.get("planKey") or "free").strip().lower() or "free"
    admin_limit_bypass = bool(current.get("adminLimitBypass"))
    idempotency_key = str(current.get("idempotencyKey") or "").strip()
    deadline_ms = int(current.get("deadlineAtMs") or 0)
    max_attempts = max(1, int(current.get("maxAttempts") or VF_TTS_QUEUE_MAX_ATTEMPTS))
    attempts_used = max(1, int(current.get("attempts") or 1))
    lane = _tts_job_lane_for_plan(plan_key)

    if deadline_ms > 0 and int(time.time() * 1000) >= deadline_ms:
        detail = {
            "error": "Queued TTS job expired before completion.",
            "errorCode": QUEUE_TIMEOUT,
            "reason": "job_deadline_exceeded",
            "trace_id": trace_id,
            "jobId": job_id,
            "retryAfterMs": 1000,
        }
        _mark_job_failed_and_revert_usage(
            job_id=job_id,
            uid=uid,
            request_id=request_id,
            status_code=504,
            detail=detail,
            error_tag="job_deadline_exceeded",
        )
        return

    runtime_base = str(current.get("runtimeBase") or _runtime_url_for_engine(engine)).strip().rstrip("/")
    runtime_path = str(current.get("runtimePath") or _runtime_synthesize_path_for_engine(engine)).strip()
    upstream_url = f"{runtime_base}{runtime_path}"
    upstream_payload = dict(current.get("upstreamPayload") or {})
    safe_engine = _safe_tts_engine_name(engine)
    semaphore = _TTS_ENGINE_SEMAPHORES.get(safe_engine)
    acquired_slot = False
    runtime_response: Optional[requests.Response] = None
    runtime_started = 0
    semaphore_wait_started = int(time.time() * 1000)

    try:
        if semaphore is not None:
            if deadline_ms > 0:
                remaining_ms = max(0, deadline_ms - int(time.time() * 1000))
                acquire_timeout = max(0.05, remaining_ms / 1000.0)
                acquired_slot = semaphore.acquire(timeout=acquire_timeout)
            else:
                semaphore.acquire()
                acquired_slot = True
            semaphore_wait_ms = max(0, int(time.time() * 1000) - semaphore_wait_started)
            _record_tts_engine_semaphore_wait(engine=safe_engine, wait_ms=semaphore_wait_ms)
            if not acquired_slot:
                detail = {
                    "error": "TTS job expired while waiting for engine concurrency slot.",
                    "errorCode": QUEUE_TIMEOUT,
                    "reason": "engine_concurrency_wait_timeout",
                    "trace_id": trace_id,
                    "jobId": job_id,
                    "retryAfterMs": 1000,
                }
                _mark_job_failed_and_revert_usage(
                    job_id=job_id,
                    uid=uid,
                    request_id=request_id,
                    status_code=504,
                    detail=detail,
                    error_tag="engine_concurrency_wait_timeout",
                )
                return
            _record_tts_engine_active(engine=safe_engine, delta=1)

        live_stream_requested = VF_TTS_LIVE_STREAM_ENABLED and bool(current.get("liveStream"))
        if live_stream_requested:
            chunk_chars = _safe_bounded_int(
                current.get("liveChunkChars"),
                default=VF_TTS_LIVE_CHUNK_CHARS_DEFAULT,
                min_value=120,
                max_value=VF_TTS_LIVE_CHUNK_CHARS_MAX,
            )
            chunk_words = _safe_bounded_int(
                current.get("liveChunkWords"),
                default=VF_TTS_LIVE_CHUNK_WORDS_DEFAULT,
                min_value=24,
                max_value=VF_TTS_LIVE_CHUNK_WORDS_MAX,
            )
            live_chunks = _split_text_live_chunks(
                engine=engine,
                text=text,
                language=str(upstream_payload.get("language") or ""),
                chunk_chars=chunk_chars,
                chunk_words=chunk_words,
                multi_speaker_payload=upstream_payload,
            )
            if not live_chunks:
                live_chunks = [
                    {
                        "text": str(text or "").strip(),
                        "textChars": len(str(text or "").strip()),
                        "wordCount": max(1, _live_chunk_word_count(text)),
                    }
                ]
            live_state: dict[str, Any] = {
                "enabled": True,
                "playableChunks": 0,
                "playableDurationMs": 0,
                "chunkCursorNext": 0,
                "chunks": [],
            }
            _TTS_JOB_QUEUE.update(
                job_id,
                {
                    "liveState": live_state,
                    "liveChunkChars": int(chunk_chars),
                    "liveChunkWords": int(chunk_words),
                },
            )

            chunk_audio_bytes: list[bytes] = []
            post_tts_disable = bool(current.get("postTtsDisable"))
            post_conversion_headers: dict[str, str] = {}
            if post_tts_disable:
                post_conversion_headers["x-vf-post-tts-conversion"] = "disabled_by_request"
            elif not VF_TTS_POST_RVC_ENABLED:
                post_conversion_headers["x-vf-post-tts-conversion"] = "disabled"

            live_started_ms = int(time.time() * 1000)
            first_chunk_recorded = False
            response_trace_id = ""
            diagnostics_header = ""
            media_type = "audio/wav"

            for chunk_index, chunk in enumerate(live_chunks):
                latest = _TTS_JOB_QUEUE.get(job_id)
                if isinstance(latest, dict):
                    latest_status = str(latest.get("status") or "").strip().lower()
                    if latest_status == "cancelled":
                        _record_tts_terminal_event(
                            job_id=job_id,
                            engine=safe_engine,
                            status="cancelled",
                            reason="cancelled_by_user",
                            status_code=409,
                        )
                        return

                chunk_payload = _build_live_chunk_upstream_payload(
                    engine=engine,
                    base_payload=upstream_payload,
                    chunk=chunk,
                )
                chunk_started_ms = int(time.time() * 1000)
                try:
                    runtime_response = requests.post(upstream_url, json=chunk_payload, timeout=240)
                except Exception as exc:  # noqa: BLE001
                    chunk_elapsed = max(0, int(time.time() * 1000) - chunk_started_ms)
                    _record_tts_runtime_latency(engine=safe_engine, elapsed_ms=chunk_elapsed)
                    _admin_usage_record_runtime_call(
                        engine=engine,
                        endpoint=runtime_path,
                        method="POST",
                        status_code=502,
                        elapsed_ms=chunk_elapsed,
                    )
                    detail = {
                        "error": f"TTS runtime is unreachable during live chunk synthesis: {exc}",
                        "errorCode": ENGINE_OVERLOADED,
                        "reason": "runtime_unreachable",
                        "trace_id": trace_id,
                        "jobId": job_id,
                        "chunkIndex": int(chunk_index),
                    }
                    _mark_job_failed_and_revert_usage(
                        job_id=job_id,
                        uid=uid,
                        request_id=request_id,
                        status_code=502,
                        detail=detail,
                        error_tag=f"runtime_unreachable:{exc}",
                    )
                    return

                chunk_elapsed = max(0, int(time.time() * 1000) - chunk_started_ms)
                _record_tts_runtime_latency(engine=safe_engine, elapsed_ms=chunk_elapsed)
                _admin_usage_record_runtime_call(
                    engine=engine,
                    endpoint=runtime_path,
                    method="POST",
                    status_code=int(runtime_response.status_code),
                    elapsed_ms=chunk_elapsed,
                )
                if not runtime_response.ok:
                    detail = _decode_runtime_error_detail(runtime_response)
                    mapped_status = _map_runtime_failure_status(engine, int(runtime_response.status_code), detail)
                    response_trace_id = str(runtime_response.headers.get("x-voiceflow-trace-id") or "").strip()
                    if isinstance(detail, dict) and response_trace_id and not detail.get("trace_id"):
                        detail = {**detail, "trace_id": response_trace_id}
                    _mark_job_failed_and_revert_usage(
                        job_id=job_id,
                        uid=uid,
                        request_id=request_id,
                        status_code=mapped_status,
                        detail=detail or "TTS runtime failed.",
                        error_tag=f"runtime_error:{mapped_status}",
                    )
                    return

                media_type = str(runtime_response.headers.get("content-type") or media_type or "audio/wav")
                response_trace_id = str(runtime_response.headers.get("x-voiceflow-trace-id") or response_trace_id or "").strip()
                diagnostics_header = str(runtime_response.headers.get("x-voiceflow-diagnostics") or diagnostics_header or "").strip()

                chunk_audio = bytes(runtime_response.content or b"")
                if len(chunk_audio) < 100:
                    _mark_job_failed_and_revert_usage(
                        job_id=job_id,
                        uid=uid,
                        request_id=request_id,
                        status_code=502,
                        detail={
                            "error": "Live chunk synthesis returned empty audio.",
                            "errorCode": ENGINE_OVERLOADED,
                            "reason": "runtime_empty_audio",
                            "trace_id": trace_id,
                            "jobId": job_id,
                            "chunkIndex": int(chunk_index),
                        },
                        error_tag="runtime_empty_audio",
                    )
                    return

                if VF_TTS_POST_RVC_ENABLED and not post_tts_disable:
                    conversion_started_ms = int(time.time() * 1000)
                    try:
                        converted_audio_bytes, conversion_headers = _convert_tts_audio_with_rvc_runtime(
                            audio_bytes=chunk_audio,
                            engine=engine,
                            voice_id=voice_id,
                            voice_name=voice_name or str(chunk_payload.get("voiceName") or ""),
                        )
                        conversion_elapsed_ms = max(0, int(time.time() * 1000) - conversion_started_ms)
                        _record_tts_live_chunk_rvc_latency(elapsed_ms=conversion_elapsed_ms)
                        if len(converted_audio_bytes) < 100:
                            raise RuntimeError("Converted live chunk is empty.")
                        chunk_audio = converted_audio_bytes
                        post_conversion_headers.update(conversion_headers)
                    except Exception as exc:
                        conversion_elapsed_ms = max(0, int(time.time() * 1000) - conversion_started_ms)
                        _record_tts_live_chunk_rvc_latency(elapsed_ms=conversion_elapsed_ms)
                        if VF_TTS_POST_RVC_REQUIRED:
                            detail = {
                                "error": f"Post-TTS conversion failed: {exc}",
                                "errorCode": ENGINE_OVERLOADED,
                                "reason": "post_tts_conversion_failed",
                                "trace_id": trace_id,
                                "jobId": job_id,
                                "chunkIndex": int(chunk_index),
                            }
                            _mark_job_failed_and_revert_usage(
                                job_id=job_id,
                                uid=uid,
                                request_id=request_id,
                                status_code=503,
                                detail=detail,
                                error_tag="post_tts_conversion_failed",
                            )
                            return
                        post_conversion_headers["x-vf-post-tts-conversion"] = "bypassed_error"
                        post_conversion_headers["x-vf-post-tts-error"] = str(exc).replace("\n", " ").replace("\r", " ")[:180]

                try:
                    chunk_meta = _persist_live_chunk(
                        job_id,
                        chunk_index,
                        chunk_audio,
                        meta={
                            "textChars": int(chunk.get("textChars") or len(str(chunk.get("text") or ""))),
                            "engine": safe_engine,
                            "traceId": response_trace_id or trace_id,
                        },
                    )
                except Exception as exc:
                    print(
                        f"[tts-live:{job_id}] chunk persist failed idx={int(chunk_index)} "
                        f"engine={safe_engine} err={exc}",
                        flush=True,
                    )
                    _mark_job_failed_and_revert_usage(
                        job_id=job_id,
                        uid=uid,
                        request_id=request_id,
                        status_code=500,
                        detail={
                            "error": f"Failed to persist live chunk: {exc}",
                            "errorCode": ENGINE_OVERLOADED,
                            "reason": "live_chunk_persist_failed",
                            "trace_id": trace_id,
                            "jobId": job_id,
                            "chunkIndex": int(chunk_index),
                        },
                        error_tag="live_chunk_persist_failed",
                    )
                    return
                live_chunks_state = list(live_state.get("chunks") or [])
                live_chunks_state.append(chunk_meta)
                playable_duration_ms = sum(int(item.get("durationMs") or 0) for item in live_chunks_state)
                live_state = {
                    "enabled": True,
                    "playableChunks": len(live_chunks_state),
                    "playableDurationMs": int(playable_duration_ms),
                    "chunkCursorNext": int(chunk_index + 1),
                    "chunks": live_chunks_state,
                }
                _TTS_JOB_QUEUE.update(job_id, {"liveState": live_state})
                chunk_audio_bytes.append(chunk_audio)

                if not first_chunk_recorded:
                    first_chunk_recorded = True
                    first_chunk_latency_ms = max(0, int(time.time() * 1000) - live_started_ms)
                    _record_tts_live_first_chunk_latency(elapsed_ms=first_chunk_latency_ms)
                    print(
                        f"[tts-live:{job_id}] first_chunk_ready_ms={first_chunk_latency_ms} "
                        f"engine={safe_engine} trace={response_trace_id or trace_id}",
                        flush=True,
                    )

            _record_tts_live_chunk_count(chunk_count=len(chunk_audio_bytes))
            try:
                synthesized_audio_bytes = _concat_wav_chunks(chunk_audio_bytes)
            except Exception as exc:
                _mark_job_failed_and_revert_usage(
                    job_id=job_id,
                    uid=uid,
                    request_id=request_id,
                    status_code=500,
                    detail={
                        "error": f"Failed to merge live chunks: {exc}",
                        "errorCode": ENGINE_OVERLOADED,
                        "reason": "live_chunk_concat_failed",
                        "trace_id": trace_id,
                        "jobId": job_id,
                    },
                    error_tag="live_chunk_concat_failed",
                )
                return
            if len(synthesized_audio_bytes) < 100:
                _mark_job_failed_and_revert_usage(
                    job_id=job_id,
                    uid=uid,
                    request_id=request_id,
                    status_code=500,
                    detail={
                        "error": "Merged live audio is empty.",
                        "errorCode": ENGINE_OVERLOADED,
                        "reason": "live_chunk_concat_empty",
                        "trace_id": trace_id,
                        "jobId": job_id,
                    },
                    error_tag="live_chunk_concat_empty",
                )
                return

            quota_headers: dict[str, str] = {}
            if not admin_limit_bypass:
                fingerprint = idempotency_key or request_id
                try:
                    quota_decision = _commit_tts_success_quota(
                        uid,
                        plan_name,
                        plan_key,
                        trace_id,
                        request_fingerprint=fingerprint,
                    )
                except HTTPException as quota_exc:
                    _mark_job_failed_and_revert_usage(
                        job_id=job_id,
                        uid=uid,
                        request_id=request_id,
                        status_code=quota_exc.status_code,
                        detail=quota_exc.detail,
                        error_tag="success_quota_exceeded",
                    )
                    return
                quota_headers = _success_rate_limit_headers(quota_decision.snapshot)

            _finalize_usage(uid, request_id, success=True)
            _build_tts_history_item(
                uid=uid,
                request_id=request_id,
                trace_id=response_trace_id or trace_id,
                engine=engine,
                voice_name=voice_name,
                voice_id=voice_id,
                text=text,
            )

            completed_headers: dict[str, str] = {"x-vf-request-id": request_id}
            completed_headers.update(quota_headers)
            if response_trace_id:
                completed_headers["x-voiceflow-trace-id"] = response_trace_id
            if diagnostics_header:
                completed_headers["x-voiceflow-diagnostics"] = diagnostics_header
            completed_headers.update(post_conversion_headers)
            completed_headers["x-vf-live-stream"] = "1"
            completed_headers["x-vf-live-chunks"] = str(len(chunk_audio_bytes))

            _TTS_JOB_QUEUE.mark_completed(
                job_id,
                audio_bytes=synthesized_audio_bytes,
                media_type=str(media_type or "audio/wav"),
                headers=completed_headers,
            )
            _record_tts_terminal_event(
                job_id=job_id,
                engine=safe_engine,
                status="completed",
                reason="completed",
                status_code=200,
            )
            return

        runtime_started = int(time.time() * 1000)
        try:
            runtime_response = requests.post(upstream_url, json=upstream_payload, timeout=240)
        except Exception as exc:  # noqa: BLE001
            runtime_elapsed = max(0, int(time.time() * 1000) - runtime_started)
            _record_tts_runtime_latency(engine=safe_engine, elapsed_ms=runtime_elapsed)
            _admin_usage_record_runtime_call(
                engine=engine,
                endpoint=runtime_path,
                method="POST",
                status_code=502,
                elapsed_ms=runtime_elapsed,
            )
            detail = {
                "error": f"TTS runtime is unreachable: {exc}",
                "errorCode": ENGINE_OVERLOADED,
                "reason": "runtime_unreachable",
                "trace_id": trace_id,
                "jobId": job_id,
            }
            can_retry = attempts_used < max_attempts and (deadline_ms <= 0 or int(time.time() * 1000) < deadline_ms)
            if can_retry:
                backoff_ms = _tts_job_retry_backoff_ms(attempts_used)
                _TTS_JOB_QUEUE.update(
                    job_id,
                    {
                        "status": "queued",
                        "lastError": detail,
                        "lastStatusCode": 502,
                        "attempts": attempts_used,
                    },
                )
                _record_tts_job_requeued(job_id=job_id, engine=safe_engine)
                time.sleep(backoff_ms / 1000.0)
                next_payload = dict(current)
                next_payload["attempts"] = attempts_used
                _TTS_JOB_QUEUE.enqueue(lane=lane, payload=next_payload)
                return
            _mark_job_failed_and_revert_usage(
                job_id=job_id,
                uid=uid,
                request_id=request_id,
                status_code=502,
                detail=detail,
                error_tag=f"runtime_unreachable:{exc}",
            )
            return

        runtime_elapsed = max(0, int(time.time() * 1000) - runtime_started)
        _record_tts_runtime_latency(engine=safe_engine, elapsed_ms=runtime_elapsed)
        _admin_usage_record_runtime_call(
            engine=engine,
            endpoint=runtime_path,
            method="POST",
            status_code=int(runtime_response.status_code),
            elapsed_ms=runtime_elapsed,
        )

        if not runtime_response.ok:
            detail = _decode_runtime_error_detail(runtime_response)
            response_trace_id = str(runtime_response.headers.get("x-voiceflow-trace-id") or "").strip()
            mapped_status = _map_runtime_failure_status(engine, int(runtime_response.status_code), detail)
            if isinstance(detail, dict) and response_trace_id and not detail.get("trace_id"):
                detail = {**detail, "trace_id": response_trace_id}
            retryable = _is_retryable_runtime_failure(engine, mapped_status, detail)
            can_retry = retryable and attempts_used < max_attempts and (deadline_ms <= 0 or int(time.time() * 1000) < deadline_ms)
            if can_retry:
                backoff_ms = _tts_job_retry_backoff_ms(attempts_used)
                _TTS_JOB_QUEUE.update(
                    job_id,
                    {
                        "status": "queued",
                        "lastError": detail,
                        "lastStatusCode": mapped_status,
                        "attempts": attempts_used,
                    },
                )
                _record_tts_job_requeued(job_id=job_id, engine=safe_engine)
                time.sleep(backoff_ms / 1000.0)
                next_payload = dict(current)
                next_payload["attempts"] = attempts_used
                _TTS_JOB_QUEUE.enqueue(lane=lane, payload=next_payload)
                return

            _mark_job_failed_and_revert_usage(
                job_id=job_id,
                uid=uid,
                request_id=request_id,
                status_code=mapped_status,
                detail=detail or "TTS runtime failed.",
                error_tag=f"runtime_error:{mapped_status}",
            )
            return

        post_tts_disable = bool(current.get("postTtsDisable"))
        synthesized_audio_bytes = bytes(runtime_response.content or b"")
        post_conversion_headers: dict[str, str] = {}
        if VF_TTS_POST_RVC_ENABLED and not post_tts_disable:
            try:
                converted_audio_bytes, conversion_headers = _convert_tts_audio_with_rvc_runtime(
                    audio_bytes=synthesized_audio_bytes,
                    engine=engine,
                    voice_id=voice_id,
                    voice_name=voice_name or str(upstream_payload.get("voiceName") or ""),
                )
                if len(converted_audio_bytes) < 100:
                    raise RuntimeError("Converted audio payload is empty.")
                synthesized_audio_bytes = converted_audio_bytes
                post_conversion_headers.update(conversion_headers)
            except Exception as exc:
                if VF_TTS_POST_RVC_REQUIRED:
                    detail = {
                        "error": f"Post-TTS conversion failed: {exc}",
                        "errorCode": ENGINE_OVERLOADED,
                        "reason": "post_tts_conversion_failed",
                        "trace_id": trace_id,
                        "jobId": job_id,
                    }
                    _mark_job_failed_and_revert_usage(
                        job_id=job_id,
                        uid=uid,
                        request_id=request_id,
                        status_code=503,
                        detail=detail,
                        error_tag="post_tts_conversion_failed",
                    )
                    return
                post_conversion_headers["x-vf-post-tts-conversion"] = "bypassed_error"
                post_conversion_headers["x-vf-post-tts-error"] = str(exc).replace("\n", " ").replace("\r", " ")[:180]
        elif post_tts_disable:
            post_conversion_headers["x-vf-post-tts-conversion"] = "disabled_by_request"
        else:
            post_conversion_headers["x-vf-post-tts-conversion"] = "disabled"

        quota_headers: dict[str, str] = {}
        if not admin_limit_bypass:
            fingerprint = idempotency_key or request_id
            try:
                quota_decision = _commit_tts_success_quota(
                    uid,
                    plan_name,
                    plan_key,
                    trace_id,
                    request_fingerprint=fingerprint,
                )
            except HTTPException as quota_exc:
                _mark_job_failed_and_revert_usage(
                    job_id=job_id,
                    uid=uid,
                    request_id=request_id,
                    status_code=quota_exc.status_code,
                    detail=quota_exc.detail,
                    error_tag="success_quota_exceeded",
                )
                return
            quota_headers = _success_rate_limit_headers(quota_decision.snapshot)

        _finalize_usage(uid, request_id, success=True)

        response_trace_id = str(runtime_response.headers.get("x-voiceflow-trace-id") or "").strip()
        _build_tts_history_item(
            uid=uid,
            request_id=request_id,
            trace_id=response_trace_id or trace_id,
            engine=engine,
            voice_name=voice_name,
            voice_id=voice_id,
            text=text,
        )

        completed_headers: dict[str, str] = {"x-vf-request-id": request_id}
        completed_headers.update(quota_headers)
        if response_trace_id:
            completed_headers["x-voiceflow-trace-id"] = response_trace_id
        diagnostics = runtime_response.headers.get("x-voiceflow-diagnostics")
        if diagnostics:
            completed_headers["x-voiceflow-diagnostics"] = diagnostics
        completed_headers.update(post_conversion_headers)

        _TTS_JOB_QUEUE.mark_completed(
            job_id,
            audio_bytes=synthesized_audio_bytes,
            media_type=str(runtime_response.headers.get("content-type") or "audio/wav"),
            headers=completed_headers,
        )
        _record_tts_terminal_event(
            job_id=job_id,
            engine=safe_engine,
            status="completed",
            reason="completed",
            status_code=200,
        )
    finally:
        if acquired_slot and semaphore is not None:
            _record_tts_engine_active(engine=safe_engine, delta=-1)
            semaphore.release()


def _tts_worker_loop(worker_id: str) -> None:
    while True:
        try:
            job = _TTS_JOB_QUEUE.dequeue_next()
            if not isinstance(job, dict):
                time.sleep(0.06)
                continue
            status = str(job.get("status") or "").strip().lower()
            if status in {"completed", "failed", "cancelled"}:
                if status == "cancelled":
                    _record_tts_terminal_event(
                        job_id=str(job.get("jobId") or ""),
                        engine=str(job.get("engine") or "GEM"),
                        status="cancelled",
                        reason="cancelled",
                        status_code=409,
                    )
                continue
            _process_tts_job(job, worker_id)
        except Exception as exc:  # noqa: BLE001
            print(f"[tts-worker:{worker_id}] error: {exc}", flush=True)
            time.sleep(0.2)


def _ensure_tts_workers_started() -> None:
    if not VF_TTS_QUEUE_ENABLED:
        return
    with _TTS_JOB_WORKER_LOCK:
        if len(_TTS_JOB_WORKER_THREADS) >= VF_TTS_QUEUE_WORKER_COUNT:
            return
        for index in range(len(_TTS_JOB_WORKER_THREADS), VF_TTS_QUEUE_WORKER_COUNT):
            worker_id = f"tts-worker-{index + 1}"
            thread = threading.Thread(
                target=_tts_worker_loop,
                args=(worker_id,),
                daemon=True,
                name=worker_id,
            )
            thread.start()
            _TTS_JOB_WORKER_THREADS.append(thread)


def _tts_job_can_access(job: dict[str, Any], *, uid: str, is_admin: bool) -> bool:
    if is_admin:
        return True
    owner_uid = str(job.get("uid") or "").strip()
    return bool(owner_uid) and owner_uid == uid


def _tts_job_status_payload(
    job: dict[str, Any],
    *,
    include_result: bool = False,
    include_chunks: bool = False,
    chunk_cursor: int = 0,
    chunk_limit: int = VF_TTS_LIVE_CHUNK_LIMIT_DEFAULT,
    include_chunk_audio: bool = True,
) -> dict[str, Any]:
    status = str(job.get("status") or "queued").strip().lower() or "queued"
    now_ms = int(time.time() * 1000)
    created_at_ms = int(job.get("createdAtMs") or 0)
    queue_age_ms = max(0, now_ms - created_at_ms) if created_at_ms > 0 else 0
    queue_depth_snapshot = _TTS_JOB_QUEUE.depth_snapshot()
    safe_engine = _safe_tts_engine_name(str(job.get("engine") or "GEM"))
    payload: dict[str, Any] = {
        "ok": True,
        "jobId": str(job.get("jobId") or ""),
        "requestId": str(job.get("requestId") or ""),
        "traceId": str(job.get("traceId") or ""),
        "status": status,
        "engine": str(job.get("engine") or ""),
        "lane": str(job.get("lane") or ""),
        "attempts": int(job.get("attempts") or 0),
        "maxAttempts": int(job.get("maxAttempts") or VF_TTS_QUEUE_MAX_ATTEMPTS),
        "createdAtMs": int(job.get("createdAtMs") or 0),
        "updatedAtMs": int(job.get("updatedAtMs") or 0),
        "startedAtMs": int(job.get("startedAtMs") or 0),
        "finishedAtMs": int(job.get("finishedAtMs") or 0),
        "deadlineAtMs": int(job.get("deadlineAtMs") or 0),
        "queueAgeMs": int(queue_age_ms),
        "queueDepthAtRead": int(queue_depth_snapshot.get("total") or 0),
        "engineConcurrencyAtRead": int(_TTS_ENGINE_CONCURRENCY_LIMITS.get(safe_engine) or 1),
    }
    if status == "failed":
        payload["statusCode"] = int(job.get("statusCode") or 500)
        payload["error"] = job.get("error")
    if include_result and status == "completed":
        payload["result"] = job.get("result")

    live_state = job.get("liveState") if isinstance(job.get("liveState"), dict) else {}
    live_stream_requested = bool(job.get("liveStream"))
    if isinstance(live_state, dict) and bool(live_state):
        payload["live"] = {
            "enabled": bool(live_state.get("enabled")),
            "playableChunks": int(live_state.get("playableChunks") or 0),
            "playableDurationMs": int(live_state.get("playableDurationMs") or 0),
        }
        payload["chunkCursorNext"] = int(live_state.get("chunkCursorNext") or 0)
    elif live_stream_requested:
        payload["live"] = {
            "enabled": True,
            "playableChunks": 0,
            "playableDurationMs": 0,
        }
        payload["chunkCursorNext"] = 0

    if include_chunks and (isinstance(live_state, dict) or live_stream_requested):
        def _chunk_index_value(chunk_item: dict[str, Any]) -> int:
            raw_value = chunk_item.get("index")
            try:
                return int(raw_value)
            except Exception:
                return -1

        safe_cursor = max(0, int(chunk_cursor or 0))
        safe_limit = _safe_bounded_int(
            chunk_limit,
            default=VF_TTS_LIVE_CHUNK_LIMIT_DEFAULT,
            min_value=1,
            max_value=VF_TTS_LIVE_CHUNK_LIMIT_MAX,
        )
        source_chunks = [
            item
            for item in list((live_state or {}).get("chunks") or [])
            if isinstance(item, dict)
        ]
        source_chunks = [
            item
            for item in source_chunks
            if _chunk_index_value(item) >= 0
        ]
        if not source_chunks:
            source_chunks = _load_live_chunks_from_artifacts(
                str(job.get("jobId") or ""),
                engine=safe_engine,
                trace_id=str(job.get("traceId") or ""),
            )
        if source_chunks and isinstance(payload.get("live"), dict):
            playable_chunks = max(int(payload["live"].get("playableChunks") or 0), len(source_chunks))
            playable_duration_ms = int(
                max(
                    int(payload["live"].get("playableDurationMs") or 0),
                    sum(int(item.get("durationMs") or 0) for item in source_chunks),
                )
            )
            payload["live"] = {
                **payload["live"],
                "playableChunks": playable_chunks,
                "playableDurationMs": playable_duration_ms,
            }
        source_chunks.sort(key=_chunk_index_value)
        visible = [
            item
            for item in source_chunks
            if _chunk_index_value(item) >= safe_cursor
        ][:safe_limit]
        chunk_payloads: list[dict[str, Any]] = []
        for item in visible:
            chunk_item = {
                "index": int(item.get("index") or 0),
                "contentType": str(item.get("contentType") or "audio/wav"),
                "durationMs": int(item.get("durationMs") or 0),
                "textChars": int(item.get("textChars") or 0),
                "engine": str(item.get("engine") or ""),
                "traceId": str(item.get("traceId") or ""),
            }
            if include_chunk_audio:
                chunk_item["audioBase64"] = _load_live_chunk_audio_base64(item)
            chunk_payloads.append(chunk_item)
        payload["chunkCursor"] = int(safe_cursor)
        payload["chunkCursorNext"] = int(safe_cursor + len(chunk_payloads))
        payload["chunks"] = chunk_payloads
    return payload


def _response_from_completed_tts_job(job: dict[str, Any], gateway_lease: Optional[_TtsGatewayLease]) -> Response:
    result = job.get("result") if isinstance(job.get("result"), dict) else {}
    audio_base64 = str(result.get("audioBase64") or "").strip()
    if not audio_base64:
        raise HTTPException(status_code=500, detail="Completed TTS job is missing audio payload.")
    try:
        content = base64.b64decode(audio_base64.encode("ascii"), validate=False)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to decode TTS job audio payload: {exc}") from exc

    media_type = str(result.get("mediaType") or "audio/wav")
    out_headers: dict[str, str] = {}
    result_headers = result.get("headers") if isinstance(result.get("headers"), dict) else {}
    for key, value in result_headers.items():
        safe_key = str(key or "").strip()
        if not safe_key:
            continue
        out_headers[safe_key] = str(value or "")
    if gateway_lease is not None:
        out_headers["x-vf-gateway-wait-ms"] = str(int(gateway_lease.wait_ms))
        out_headers["x-vf-gateway-queued"] = "1" if gateway_lease.queued else "0"
    return Response(content=content, media_type=media_type, headers=out_headers)


def _raise_failed_tts_job(job: dict[str, Any], *, default_headers: Optional[dict[str, str]] = None) -> None:
    status_code = int(job.get("statusCode") or 500)
    detail = job.get("error")
    if detail is None:
        detail = {"error": "TTS job failed."}
    raise HTTPException(status_code=status_code, detail=detail, headers=dict(default_headers or {}))


def _submit_tts_job(payload: TtsSynthesizeRequest, request: Request, *, sync_wait_ms: int) -> Response:
    safe_sync_wait_ms = max(0, min(60_000, int(sync_wait_ms)))
    uid = _require_request_uid(request)
    admin_limit_bypass = _request_is_admin(request, uid)
    text = str(payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required.")
    engine = _normalize_engine_name(payload.engine)
    idempotency_key = str(request.headers.get("Idempotency-Key") or "").strip()
    request_id = str(payload.request_id or idempotency_key or uuid.uuid4().hex).strip()
    trace_id = str(payload.trace_id or request_id or uuid.uuid4().hex).strip() or uuid.uuid4().hex

    plan_name, plan_key, _guardrails = _enforce_tts_plan_guardrails(uid, len(text), trace_id)
    quota_headers: dict[str, str] = {}
    if not admin_limit_bypass:
        quota_headers = _precheck_tts_success_quota(uid, plan_name, plan_key, trace_id)

    gateway_lease, reject_detail = _TTS_GATEWAY_CONTROLLER.acquire()
    if gateway_lease is None:
        safe_detail = dict(reject_detail or {})
        reason = str(safe_detail.get("reason") or "queue_rejected").strip().lower()
        safe_detail.setdefault("reason", reason)
        if reason == "queue_timeout":
            safe_detail.setdefault("errorCode", QUEUE_TIMEOUT)
        else:
            safe_detail.setdefault("errorCode", ENGINE_OVERLOADED)
        safe_detail.setdefault("queueDepth", 0)
        safe_detail.setdefault("retryAfterMs", 1000)
        safe_detail.setdefault("trace_id", trace_id)
        retry_after_ms = max(250, int(safe_detail.get("retryAfterMs") or 1000))
        error_headers = dict(quota_headers)
        error_headers["Retry-After"] = str(max(1, int((retry_after_ms + 999) // 1000)))
        raise HTTPException(status_code=503, detail=safe_detail, headers=error_headers)

    try:
        reserve = _reserve_usage(
            uid,
            request_id,
            engine,
            len(text),
            bypass_limits=admin_limit_bypass,
            bypass_reason="admin_request" if admin_limit_bypass else "",
        )
        _ = reserve
        _ensure_tts_workers_started()
        _cleanup_expired_live_artifacts()

        runtime_base = _runtime_url_for_engine(engine)
        runtime_path = _runtime_synthesize_path_for_engine(engine)
        live_stream_requested = VF_TTS_LIVE_STREAM_ENABLED and bool(payload.stream)
        live_chunk_chars = None
        live_chunk_words = None
        if live_stream_requested:
            live_chunk_chars = _safe_bounded_int(
                payload.live_chunk_chars,
                default=VF_TTS_LIVE_CHUNK_CHARS_DEFAULT,
                min_value=120,
                max_value=VF_TTS_LIVE_CHUNK_CHARS_MAX,
            )
            live_chunk_words = _safe_bounded_int(
                payload.live_chunk_words,
                default=VF_TTS_LIVE_CHUNK_WORDS_DEFAULT,
                min_value=24,
                max_value=VF_TTS_LIVE_CHUNK_WORDS_MAX,
            )
        upstream_payload, voice_id = _build_tts_upstream_payload(
            payload,
            engine=engine,
            text=text,
            request_id=request_id,
            trace_id=trace_id,
            plan_key=plan_key,
        )

        existing_job = _TTS_JOB_QUEUE.get(request_id)
        if existing_job is None:
            depth_snapshot = _TTS_JOB_QUEUE.depth_snapshot()
            if int(depth_snapshot.get("total") or 0) >= VF_TTS_QUEUE_MAX_DEPTH:
                _finalize_usage(uid, request_id, success=False, error_detail="queue_depth_limit")
                detail = {
                    "error": "TTS queue depth limit reached.",
                    "errorCode": ENGINE_OVERLOADED,
                    "reason": "queue_full",
                    "queueDepth": int(depth_snapshot.get("total") or 0),
                    "queueMax": int(VF_TTS_QUEUE_MAX_DEPTH),
                    "retryAfterMs": 1000,
                    "trace_id": trace_id,
                }
                raise HTTPException(status_code=503, detail=detail, headers=quota_headers)

            projection = _estimate_tts_completion_delay(engine)
            observed_queue_depth = int(depth_snapshot.get("total") or 0)
            projection_jobs_ahead = int(projection.get("jobsAhead") or 0)
            projection_concurrency = max(1, int(projection.get("concurrency") or 1))
            projection_avg_runtime = max(1, int(projection.get("avgRuntimeMs") or _default_engine_runtime_ms(engine)))
            estimated_jobs_ahead = max(projection_jobs_ahead, observed_queue_depth)
            estimated_completion_ms = max(
                int(projection.get("estimatedCompletionMs") or 0),
                int(((estimated_jobs_ahead // projection_concurrency) + 1) * projection_avg_runtime),
            )
            if estimated_completion_ms > int(VF_TTS_QUEUE_JOB_TTL_MS):
                _finalize_usage(uid, request_id, success=False, error_detail="estimated_queue_timeout")
                retry_after_ms = max(
                    500,
                    int(estimated_completion_ms - int(VF_TTS_QUEUE_JOB_TTL_MS) + projection_avg_runtime),
                )
                detail = {
                    "error": "TTS engine is overloaded and queue TTL would likely expire before completion.",
                    "errorCode": ENGINE_OVERLOADED,
                    "reason": "estimated_queue_timeout",
                    "trace_id": trace_id,
                    "engine": str(projection.get("engine") or _safe_tts_engine_name(engine)),
                    "queueDepth": observed_queue_depth,
                    "engineQueueDepth": int(estimated_jobs_ahead),
                    "engineQueued": int(projection.get("queued") or 0),
                    "engineRunning": int(projection.get("running") or 0),
                    "engineConcurrency": int(projection.get("concurrency") or 1),
                    "estimatedCompletionMs": estimated_completion_ms,
                    "deadlineBudgetMs": int(VF_TTS_QUEUE_JOB_TTL_MS),
                    "retryAfterMs": retry_after_ms,
                }
                error_headers = dict(quota_headers)
                error_headers["Retry-After"] = str(max(1, int((retry_after_ms + 999) // 1000)))
                raise HTTPException(status_code=503, detail=detail, headers=error_headers)

            deadline_at_ms = int(time.time() * 1000) + VF_TTS_QUEUE_JOB_TTL_MS
            lane = _tts_job_lane_for_plan(plan_key)
            job_payload = {
                "jobId": request_id,
                "uid": uid,
                "requestId": request_id,
                "traceId": trace_id,
                "engine": engine,
                "text": text,
                "voiceId": voice_id,
                "voiceName": str(payload.voiceName or "").strip(),
                "planName": plan_name,
                "planKey": plan_key,
                "adminLimitBypass": bool(admin_limit_bypass),
                "idempotencyKey": idempotency_key,
                "runtimeBase": runtime_base,
                "runtimePath": runtime_path,
                "upstreamPayload": upstream_payload,
                "deadlineAtMs": deadline_at_ms,
                "maxAttempts": VF_TTS_QUEUE_MAX_ATTEMPTS if safe_sync_wait_ms <= 0 else 1,
                "postTtsDisable": bool(payload.post_tts_disable),
                "liveStream": bool(live_stream_requested),
                "liveChunkChars": int(live_chunk_chars or VF_TTS_LIVE_CHUNK_CHARS_DEFAULT),
                "liveChunkWords": int(live_chunk_words or VF_TTS_LIVE_CHUNK_WORDS_DEFAULT),
            }
            current_job = _TTS_JOB_QUEUE.enqueue(lane=lane, payload=job_payload)
            _record_tts_job_enqueued(
                job_id=request_id,
                engine=engine,
                created_at_ms=int((current_job or {}).get("createdAtMs") or int(time.time() * 1000)),
            )
        else:
            current_job = existing_job

        if safe_sync_wait_ms > 0:
            terminal_job = _TTS_JOB_QUEUE.wait_for_terminal(
                request_id,
                timeout_ms=safe_sync_wait_ms,
                poll_ms=120,
            )
            if isinstance(terminal_job, dict):
                terminal_status = str(terminal_job.get("status") or "").strip().lower()
                if terminal_status == "completed":
                    return _response_from_completed_tts_job(terminal_job, gateway_lease)
                if terminal_status == "failed":
                    _raise_failed_tts_job(terminal_job, default_headers=quota_headers)
                if terminal_status == "cancelled":
                    raise HTTPException(status_code=409, detail={"error": "TTS job was cancelled.", "jobId": request_id})
                current_job = terminal_job

        status_payload = _tts_job_status_payload(current_job if isinstance(current_job, dict) else {"jobId": request_id})
        status_payload["accepted"] = True
        status_payload["queue"] = _TTS_JOB_QUEUE.depth_snapshot()
        headers = dict(quota_headers)
        headers["x-vf-request-id"] = request_id
        headers["x-vf-job-id"] = request_id
        headers["x-vf-gateway-wait-ms"] = str(int(gateway_lease.wait_ms))
        headers["x-vf-gateway-queued"] = "1" if gateway_lease.queued else "0"
        return JSONResponse(status_payload, status_code=202, headers=headers)
    finally:
        gateway_lease.release()


@app.post("/tts/synthesize")
def tts_synthesize(
    payload: TtsSynthesizeRequest,
    request: Request,
    wait_ms: Optional[int] = Query(default=None, ge=0, le=60_000),
) -> Response:
    effective_wait_ms = VF_TTS_QUEUE_SYNC_WAIT_MS if wait_ms is None else int(wait_ms)
    return _submit_tts_job(payload, request, sync_wait_ms=effective_wait_ms)


@app.post("/tts/jobs")
def tts_job_create(payload: TtsSynthesizeRequest, request: Request) -> JSONResponse:
    response = _submit_tts_job(payload, request, sync_wait_ms=0)
    if isinstance(response, JSONResponse):
        return response
    if isinstance(response, Response):
        encoded = base64.b64encode(bytes(response.body or b"")).decode("ascii")
        headers = {str(k): str(v) for k, v in dict(response.headers or {}).items()}
        return JSONResponse(
            {
                "ok": True,
                "accepted": True,
                "status": "completed",
                "result": {
                    "audioBase64": encoded,
                    "mediaType": str(response.media_type or "audio/wav"),
                    "headers": headers,
                },
            }
        )
    return JSONResponse({"ok": True, "accepted": True}, status_code=202)


@app.get("/tts/jobs/{job_id}")
def tts_job_status(
    job_id: str,
    request: Request,
    includeResult: bool = False,
    includeChunks: bool = False,
    chunkCursor: int = 0,
    chunkLimit: int = Query(default=VF_TTS_LIVE_CHUNK_LIMIT_DEFAULT, ge=1, le=VF_TTS_LIVE_CHUNK_LIMIT_MAX),
    includeChunkAudio: bool = True,
) -> JSONResponse:
    uid = _require_request_uid(request)
    is_admin = _request_is_admin(request, uid)
    safe_job_id = str(job_id or "").strip()
    if not safe_job_id:
        raise HTTPException(status_code=400, detail="Missing job id.")
    job = _TTS_JOB_QUEUE.get(safe_job_id)
    if not isinstance(job, dict):
        raise HTTPException(status_code=404, detail="Job not found.")
    if not _tts_job_can_access(job, uid=uid, is_admin=is_admin):
        raise HTTPException(status_code=403, detail="Not authorized to access this job.")
    return JSONResponse(
        _tts_job_status_payload(
            job,
            include_result=bool(includeResult),
            include_chunks=bool(includeChunks),
            chunk_cursor=max(0, int(chunkCursor or 0)),
            chunk_limit=int(chunkLimit),
            include_chunk_audio=bool(includeChunkAudio),
        )
    )


@app.delete("/tts/jobs/{job_id}")
def tts_job_cancel(job_id: str, request: Request) -> JSONResponse:
    uid = _require_request_uid(request)
    is_admin = _request_is_admin(request, uid)
    safe_job_id = str(job_id or "").strip()
    if not safe_job_id:
        raise HTTPException(status_code=400, detail="Missing job id.")
    job = _TTS_JOB_QUEUE.get(safe_job_id)
    if not isinstance(job, dict):
        raise HTTPException(status_code=404, detail="Job not found.")
    if not _tts_job_can_access(job, uid=uid, is_admin=is_admin):
        raise HTTPException(status_code=403, detail="Not authorized to cancel this job.")
    cancelled = _TTS_JOB_QUEUE.cancel(safe_job_id)
    if not isinstance(cancelled, dict):
        raise HTTPException(status_code=404, detail="Job not found.")
    _cleanup_live_artifacts(safe_job_id)
    _record_tts_terminal_event(
        job_id=safe_job_id,
        engine=str(cancelled.get("engine") or "GEM"),
        status="cancelled",
        reason="cancelled_by_user",
        status_code=409,
    )
    return JSONResponse({"ok": True, "job": _tts_job_status_payload(cancelled, include_result=False)})


@app.get("/runtime/logs/tail", response_model=RuntimeLogTailResponse)
def tail_runtime_logs(
    service: str,
    cursor: Optional[int] = None,
    max_bytes: int = 24_576,
    line_limit: int = 80,
) -> JSONResponse:
    try:
        normalized_service = _resolve_runtime_log_service(service)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    log_path = RUNTIME_LOG_FILES[normalized_service]
    if not log_path.exists() or not log_path.is_file():
        return JSONResponse(
            {
                "ok": True,
                "service": normalized_service,
                "exists": False,
                "file": str(log_path),
                "cursor": 0,
                "nextCursor": 0,
                "size": 0,
                "lines": [],
                "truncated": False,
            }
        )

    try:
        stat = log_path.stat()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to read log metadata: {exc}") from exc

    file_size = int(stat.st_size)
    safe_max_bytes = max(1024, min(int(max_bytes), RUNTIME_LOG_MAX_BYTES))
    safe_line_limit = max(1, min(int(line_limit), RUNTIME_LOG_MAX_LINES))

    if cursor is None or int(cursor) < 0 or int(cursor) > file_size:
        start_offset = max(0, file_size - safe_max_bytes)
    else:
        start_offset = int(cursor)

    max_chunk = min(safe_max_bytes, max(0, file_size - start_offset))

    try:
        with log_path.open("rb") as log_file:
            log_file.seek(start_offset)
            raw = log_file.read(max_chunk)
            next_cursor = int(log_file.tell())
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to read log file: {exc}") from exc

    text = raw.decode("utf-8", errors="replace")
    lines = text.splitlines()
    if start_offset > 0 and lines:
        # First line can be truncated because we started mid-file.
        lines = lines[1:]
    if len(lines) > safe_line_limit:
        lines = lines[-safe_line_limit:]

    return JSONResponse(
        {
            "ok": True,
            "service": normalized_service,
            "exists": True,
            "file": str(log_path),
            "cursor": start_offset,
            "nextCursor": next_cursor,
            "size": file_size,
            "lines": lines,
            "truncated": start_offset > 0,
            "lastModified": int(stat.st_mtime * 1000),
        }
    )


@app.post("/tts/engines/switch", response_model=TtsEngineSwitchResponse)
def switch_tts_engine(payload: SwitchTtsEngineRequest) -> JSONResponse:
    try:
        engine = _normalize_engine_name(payload.engine)
        health_url = TTS_ENGINE_HEALTH_URLS[engine]
        already_online, online_detail = _probe_runtime_health(health_url)
        if already_online:
            return JSONResponse(
                {
                    "ok": True,
                    "engine": engine,
                    "state": "online",
                    "detail": "Runtime already online",
                    "healthUrl": health_url,
                    "gpuMode": payload.gpu,
                    "commandOutput": "",
                    "probeDetail": online_detail,
                }
            )

        command_output = _run_tts_switch_with_retry(engine, payload.gpu, retries=2, keep_others=True)
        is_online, detail = _probe_runtime_health(health_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"TTS engine switch failed: {exc}") from exc

    return JSONResponse(
        {
            "ok": True,
            "engine": engine,
            "state": "online" if is_online else "starting",
            "detail": detail if is_online else "Runtime starting in background",
            "healthUrl": health_url,
            "gpuMode": payload.gpu,
            "commandOutput": command_output[-500:],
        }
    )


@app.post("/audio/extract-from-video")
async def extract_audio_from_video(
    file: UploadFile = File(...),
) -> FileResponse:
    """
    Extract audio stream from a video file and return as WAV format.
    Handles all video formats that FFmpeg supports (MP4, WebM, MKV, etc.).
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required.")
    
    content_type = str(file.content_type or "").strip().lower()
    if not any(x in content_type for x in ["video/", "application/octet-stream"]):
        raise HTTPException(
            status_code=400,
            detail=f"Expected video file, got {content_type or 'unknown type'}. Supported: MP4, WebM, MKV, AVI, MOV, FLV, WMV, etc."
        )

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(payload) > 500 * 1024 * 1024:  # 500MB limit for video files
        raise HTTPException(
            status_code=413,
            detail="Video file is too large. Maximum 500MB."
        )

    # Save uploaded video to temporary file
    temp_dir = tempfile.mkdtemp(prefix="audio_extract_")
    input_path = Path(temp_dir) / _safe_upload_name(file.filename, "video_input.mp4")
    
    try:
        # Write uploaded video data to temp file
        input_path.write_bytes(payload)
        
        # Verify file is readable by FFmpeg
        if not input_path.exists() or input_path.stat().st_size == 0:
            raise RuntimeError("Failed to write temporary video file.")
        
        # Extract audio to WAV format using FFmpeg
        output_path = input_path.with_suffix(".wav")
        _convert_media_to_wav(
            str(input_path),
            str(output_path),
            sample_rate=44100,
            channels=1,
        )
        
        if not output_path.exists():
            raise RuntimeError("FFmpeg failed to extract audio from video.")
        
        # Stream WAV file back to client
        return FileResponse(
            path=output_path,
            media_type="audio/wav",
            filename="extracted_audio.wav",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )
    except Exception as exc:
        _cleanup_paths(str(input_path), str(output_path) if 'output_path' in locals() else "")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to extract audio from video: {str(exc)}"
        ) from exc
    finally:
        # Cleanup temporary directory (files will be cleaned up when response is sent)
        try:
            import atexit
            atexit.register(lambda: shutil.rmtree(temp_dir, ignore_errors=True))
        except Exception:
            pass


@app.post("/services/dubbing/prepare")
def prepare_dubbing_services(payload: PrepareDubbingServicesRequest) -> JSONResponse:
    engines = ["GEM", "KOKORO"]
    results: list[dict[str, Any]] = []
    overall_ok = True
    any_starting = False
    trace_id = uuid.uuid4().hex[:10]
    print(f"[dubbing.prepare:{trace_id}] start gpu={payload.gpu}")

    for engine in engines:
        health_url = TTS_ENGINE_HEALTH_URLS[engine]
        attempted_switch = False
        command_output = ""
        waited_ms = 0
        try:
            online, detail = _probe_runtime_health(health_url, timeout_sec=2.5)
            state = "online" if online else "starting"
            if not online:
                attempted_switch = True
                command_output = _run_tts_switch_with_retry(
                    engine,
                    payload.gpu,
                    retries=2,
                    keep_others=True,
                )
                wait_budget = DUBBING_PREPARE_ENGINE_WAIT_MS.get(engine, 20_000)
                online, detail, waited_ms = _wait_for_runtime_online(
                    health_url,
                    timeout_ms=wait_budget,
                )
                state = "online" if online else "starting"
                if not online:
                    any_starting = True
                    if not detail:
                        detail = "Runtime is still starting."

            item_ok = state != "failed"
            results.append(
                {
                    "engine": engine,
                    "ok": bool(item_ok),
                    "state": state,
                    "detail": detail if detail else "Runtime online",
                    "healthUrl": health_url,
                    "commandOutput": command_output[-500:],
                    "attemptedSwitch": attempted_switch,
                    "waitedMs": waited_ms,
                }
            )
            print(
                f"[dubbing.prepare:{trace_id}] {engine} state={state} attempted_switch={attempted_switch} waited_ms={waited_ms} detail={detail}"
            )
        except Exception as exc:
            overall_ok = False
            results.append(
                {
                    "engine": engine,
                    "ok": False,
                    "state": "failed",
                    "detail": str(exc),
                    "healthUrl": health_url,
                    "commandOutput": command_output[-500:],
                    "attemptedSwitch": attempted_switch,
                    "waitedMs": waited_ms,
                }
            )
            print(f"[dubbing.prepare:{trace_id}] {engine} state=failed detail={exc}")

    if any(item.get("state") == "failed" for item in results):
        overall_ok = False

    print(f"[dubbing.prepare:{trace_id}] done ok={overall_ok}")
    if overall_ok and any_starting:
        message = "Dubbing services are starting. Please wait a moment."
    elif overall_ok:
        message = "Dubbing services are ready."
    else:
        message = "Some dubbing services failed to start."
    return JSONResponse(
        {
            "ok": overall_ok,
            "services": results,
            "message": message,
            "traceId": trace_id,
        }
    )


@app.get("/tts/engines/capabilities", response_model=TtsEngineCapabilitiesResponse)
def tts_engines_capabilities() -> JSONResponse:
    payload: dict[str, Any] = {}
    for engine in ["GEM", "KOKORO"]:
        engine_payload = _probe_runtime_capabilities(engine, timeout_sec=3.2)
        engine_payload["displayName"] = _engine_display_name(engine)
        payload[engine] = engine_payload

    conversion_adapters = {
        "RVC": rvc_adapter,
    }
    conversion_payload: dict[str, Any] = {}
    for key, adapter in conversion_adapters.items():
        healthy, detail = adapter.health()
        conversion_payload[key] = {
            "healthy": bool(healthy),
            "detail": detail,
            "supportsOneShotClone": bool(adapter.supports_one_shot_clone),
            "supportsRealtime": bool(adapter.supports_realtime),
            "recommendedUseCases": list(adapter.recommended_use_cases),
        }

    return JSONResponse(
        {
            "ok": True,
            "engines": payload,
            "voiceConversion": conversion_payload,
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
        }
    )


@app.get("/tts/engines/status", response_model=TtsEngineStatusResponse)
def tts_engines_status(engine: Optional[str] = Query(None)) -> JSONResponse:
    if engine is not None and str(engine).strip():
        selected_engines = [_normalize_engine_name(str(engine))]
    else:
        selected_engines = ["GEM", "KOKORO"]

    items: dict[str, dict[str, Any]] = {}
    for normalized_engine in selected_engines:
        health_url = TTS_ENGINE_HEALTH_URLS[normalized_engine]
        runtime_url = _runtime_url_for_engine(normalized_engine)
        online, detail = _probe_runtime_health(health_url)
        capability_payload = _probe_runtime_capabilities(normalized_engine, timeout_sec=2.2)
        ready = bool(capability_payload.get("ready")) if isinstance(capability_payload, dict) else bool(online)

        if online and ready:
            state = "online"
        elif online:
            state = "starting"
        else:
            state = "offline"

        runtime_detail = str(detail or "").strip() or ("Runtime online" if state == "online" else "Runtime offline")
        if normalized_engine == "GEM" and isinstance(capability_payload, dict):
            metadata = capability_payload.get("metadata")
            if isinstance(metadata, dict):
                probe_error = str(metadata.get("capabilityProbeError") or "").strip()
                if state != "online" and probe_error:
                    runtime_detail = probe_error

        items[normalized_engine] = {
            "engine": normalized_engine,
            "state": state,
            "detail": runtime_detail,
            "ready": ready,
            "healthUrl": health_url,
            "runtimeUrl": runtime_url,
        }

    return JSONResponse(
        {
            "ok": all(str(item.get("state") or "") != "offline" for item in items.values()),
            "engines": items,
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
        }
    )


@app.get("/tts/engines/voices", response_model=TtsEngineVoicesResponse)
def tts_engines_voices(engine: str = Query("KOKORO")) -> JSONResponse:
    normalized_engine = _normalize_engine_name(engine)
    voices = _fetch_runtime_voices(normalized_engine)
    return JSONResponse(
        {
            "ok": True,
            "engine": normalized_engine,
            "voices": voices,
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
        }
    )


@app.get("/tts/voice-profiles/{profile_id}/reference")
def tts_voice_profile_reference(profile_id: str) -> FileResponse:
    safe_profile_id = str(profile_id or "").strip()
    if not safe_profile_id:
        raise HTTPException(status_code=404, detail="Profile not found")

    profile = _profile_index().get(safe_profile_id)
    if not isinstance(profile, dict):
        raise HTTPException(status_code=404, detail="Profile not found")

    resolved_path, _, exists = _resolve_profile_reference_path(profile)
    if not resolved_path or not exists:
        raise HTTPException(status_code=404, detail="Reference audio not found")

    media_type, _ = mimetypes.guess_type(str(resolved_path))
    suffix = resolved_path.suffix or ".wav"
    return FileResponse(
        str(resolved_path),
        media_type=media_type or "audio/wav",
        filename=f"{safe_profile_id}{suffix}",
    )


@app.get("/tts/voice-mapping/catalog")
def tts_voice_mapping_catalog() -> JSONResponse:
    return JSONResponse(_voice_mapping_catalog_payload())


def _update_dubbing_job(job_id: str, **updates: Any) -> None:
    with DUBBING_JOB_LOCK:
        job = DUBBING_JOBS.get(job_id)
        if not job:
            return
        job.update(updates)
        job["updatedAt"] = int(time.time() * 1000)


def _append_dubbing_log(job_id: str, message: str) -> None:
    with DUBBING_JOB_LOCK:
        job = DUBBING_JOBS.get(job_id)
        if not job:
            return
        logs = job.setdefault("logs", [])
        logs.append({"ts": int(time.time() * 1000), "message": message})
        if len(logs) > 400:
            del logs[:-400]


def _is_job_cancelled(job_id: str) -> bool:
    with DUBBING_JOB_LOCK:
        job = DUBBING_JOBS.get(job_id)
        if not job:
            return True
        return bool(job.get("cancelRequested"))


def _resolve_voice_id(engine: str, voice_map: dict[str, str], speaker: str) -> str:
    if speaker in voice_map:
        return voice_map[speaker]
    if "default" in voice_map:
        return voice_map["default"]
    if engine == "KOKORO":
        return "hf_alpha"
    return "alloy"


def _fetch_runtime_voice_ids(engine: str) -> list[str]:
    if engine == "KOKORO":
        base_url = KOKORO_RUNTIME_URL
    else:
        return []
    try:
        response = requests.get(f"{base_url}/v1/voices", timeout=15)
        if not response.ok:
            return []
        payload = response.json()
        voices = payload.get("voices") if isinstance(payload, dict) else payload
        if not isinstance(voices, list):
            return []
        ids: list[str] = []
        for voice in voices:
            if not isinstance(voice, dict):
                continue
            voice_id = str(voice.get("voice_id") or voice.get("id") or "").strip()
            if voice_id:
                ids.append(voice_id)
        return ids
    except Exception:
        return []


def _fetch_runtime_voices(engine: str) -> list[dict[str, Any]]:
    normalized_engine = _normalize_engine_name(engine)
    if normalized_engine == "GEM":
        mapping = _load_voice_id_map()
        engines = mapping.get("engines") if isinstance(mapping.get("engines"), dict) else {}
        engine_payload = engines.get("GEM") if isinstance(engines.get("GEM"), dict) else {}
        runtime_voices = engine_payload.get("runtimeVoices") if isinstance(engine_payload.get("runtimeVoices"), list) else []
        normalized: list[dict[str, Any]] = []
        for item in runtime_voices:
            if not isinstance(item, dict):
                continue
            voice_id = str(item.get("voice_id") or item.get("id") or "").strip()
            if not voice_id:
                continue
            entry = {
                "voice_id": voice_id,
                "voice": str(item.get("voice") or item.get("runtimeVoice") or voice_id).strip() or voice_id,
                "name": str(item.get("name") or voice_id).strip() or voice_id,
                "language": str(item.get("language") or "multilingual"),
                "gender": str(item.get("gender") or "unknown"),
                "source": str(item.get("source") or "voice-map"),
            }
            normalized.append(_apply_mapped_voice_fields("GEM", voice_id, entry))
        if normalized:
            return normalized

        # Fallback for boot without mapping files.
        fallback = {
            "voice_id": "v1",
            "voice": "Fenrir",
            "name": "Voice 1",
            "language": "multilingual",
            "gender": "unknown",
            "source": "gateway-fallback",
        }
        return [_apply_mapped_voice_fields("GEM", "v1", fallback)]

    base_url = KOKORO_RUNTIME_URL
    try:
        response = requests.get(f"{base_url}/v1/voices", timeout=15)
        if not response.ok:
            return []
        payload = response.json()
        voices = payload.get("voices") if isinstance(payload, dict) else payload
        if not isinstance(voices, list):
            return []
        normalized: list[dict[str, Any]] = []
        for idx, voice in enumerate(voices):
            if not isinstance(voice, dict):
                continue
            voice_id = str(voice.get("voice_id") or voice.get("id") or "").strip()
            if not voice_id:
                voice_id = f"voice_{idx}"
            name = str(voice.get("name") or voice.get("voice") or voice_id).strip() or voice_id
            normalized.append(
                _apply_mapped_voice_fields(normalized_engine, voice_id, {
                    "voice_id": voice_id,
                    "name": name,
                    "language": str(voice.get("language") or "unknown"),
                    "gender": str(voice.get("gender") or "unknown"),
                    "source": str(voice.get("source") or "runtime"),
                })
            )
        return normalized
    except Exception:
        return []


def _resolve_runtime_voice_id(engine: str, preferred_id: str) -> str:
    voice_ids = _fetch_runtime_voice_ids(engine)
    if not voice_ids:
        return preferred_id
    if preferred_id in voice_ids:
        return preferred_id
    return voice_ids[0]


def _synthesize_runtime_tts(
    engine: str,
    text: str,
    voice_id: str,
    language: str,
    emotion: Optional[str],
    style: Optional[str],
    emotion_strength: Optional[float],
    trace_id: str,
) -> tuple[Any, int]:
    if engine == "KOKORO":
        payload = {
            "text": text,
            "voiceId": voice_id,
            "voice_id": voice_id,
            "language": language or "auto",
            "emotion": emotion,
            "style": style,
            "speed": 1.0,
            "trace_id": trace_id,
        }
        response = requests.post(f"{KOKORO_RUNTIME_URL}/synthesize", json=payload, timeout=120)
    else:
        payload = {
            "text": text,
            "voiceName": voice_id,
            "voice_id": voice_id,
            "language": language or "auto",
            "emotion": emotion,
            "style": style,
            "speed": 1.0,
            "trace_id": trace_id,
        }
        response = requests.post(f"{GEMINI_RUNTIME_URL}/synthesize", json=payload, timeout=120)

    if not response.ok:
        raise RuntimeError(f"{engine} runtime failed: {response.status_code} {response.text[:160]}")

    import soundfile as sf  # type: ignore

    audio, sr = sf.read(BytesIO(response.content))
    if hasattr(audio, "ndim") and audio.ndim > 1:
        audio = audio.mean(axis=1)
    return audio, sr


def _build_alignment_score(target_sec: float, actual_sec: float) -> float:
    if target_sec <= 0:
        return 0.0
    diff = abs(target_sec - actual_sec)
    return max(0.0, 1.0 - (diff / target_sec))


def _now_ms() -> int:
    return int(time.time() * 1000)


def _safe_sha256(path: Path) -> Optional[str]:
    if not path.exists() or not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1_048_576), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _runtime_online(url: str) -> bool:
    try:
        response = requests.get(f"{url.rstrip('/')}/health", timeout=4)
        return bool(response.ok)
    except Exception:
        return False


def _select_voice_for_engine(engine: str, requested: str = "") -> Optional[str]:
    if engine == "KOKORO":
        voices = _fetch_runtime_voice_ids("KOKORO")
        if requested and requested in voices:
            return requested
        if voices:
            return voices[0]
        return "hf_alpha"
    if engine == "GEM":
        return requested or "alloy"
    return None


def _looks_hindi_speaker_hint(speaker: str) -> bool:
    token = str(speaker or "").strip().lower()
    if not token:
        return False
    return bool(re.search(r"(hi|hindi|india|bharat)", token))


def _auto_route_dubbing_voices(
    *,
    preferred_map: dict[str, str],
    speakers: list[str],
    tts_route: str = "auto",
) -> tuple[dict[str, str], list[dict[str, Any]]]:
    route = str(tts_route or "").strip().lower()
    if route not in {"auto", "gem_only", "kokoro_only"}:
        route = "auto"
    routes: list[dict[str, Any]] = []
    chosen_map: dict[str, str] = {}
    unique_speakers = speakers or ["SPEAKER_00"]

    for speaker in unique_speakers:
        preferred = preferred_map.get(speaker) or preferred_map.get("default") or ""
        if route == "gem_only":
            runtime_order = [("GEM", GEMINI_RUNTIME_URL)]
        elif route == "kokoro_only":
            runtime_order = [("KOKORO", KOKORO_RUNTIME_URL)]
        else:
            if _looks_hindi_speaker_hint(speaker):
                runtime_order = [("KOKORO", KOKORO_RUNTIME_URL), ("GEM", GEMINI_RUNTIME_URL)]
            else:
                runtime_order = [("GEM", GEMINI_RUNTIME_URL), ("KOKORO", KOKORO_RUNTIME_URL)]
        selected_engine = None
        selected_voice = None
        for engine, url in runtime_order:
            if not _runtime_online(url):
                routes.append(
                    {
                        "speaker": speaker,
                        "engine": engine,
                        "status": "offline",
                        "voiceId": None,
                    }
                )
                continue
            voice_id = _select_voice_for_engine(engine, preferred)
            if voice_id:
                selected_engine = engine
                selected_voice = voice_id
                routes.append(
                    {
                        "speaker": speaker,
                        "engine": engine,
                        "status": "selected",
                        "voiceId": voice_id,
                    }
                )
                break
            routes.append(
                {
                    "speaker": speaker,
                    "engine": engine,
                    "status": "no_voice",
                    "voiceId": None,
                }
            )

        if selected_voice:
            chosen_map[speaker] = selected_voice
        if selected_engine is None:
            default_voice = "alloy" if route == "gem_only" else "hf_alpha"
            chosen_map[speaker] = preferred or default_voice

    if "default" not in chosen_map:
        fallback_default = "alloy" if route == "gem_only" else "hf_alpha"
        chosen_map["default"] = preferred_map.get("default") or next(iter(chosen_map.values()), fallback_default)
    return chosen_map, routes


def _default_engine_for_tts_route(tts_route: str) -> str:
    route = str(tts_route or "").strip().lower()
    if route == "kokoro_only":
        return "KOKORO"
    return "GEM"


def _resolve_engine_executed_from_requests(tts_requests: list[dict[str, Any]]) -> str:
    counts: dict[str, int] = {"GEM": 0, "KOKORO": 0}
    first_seen = ""
    for request_item in tts_requests:
        engine = str(request_item.get("engine") or "").strip().upper()
        if engine not in counts:
            continue
        counts[engine] += 1
        if not first_seen:
            first_seen = engine

    total = counts["GEM"] + counts["KOKORO"]
    if total <= 0:
        return "GEM"
    if counts["GEM"] == counts["KOKORO"] and first_seen:
        return first_seen
    return "GEM" if counts["GEM"] > counts["KOKORO"] else "KOKORO"


def _build_dubbing_output_files(result: dict[str, Any]) -> dict[str, Any]:
    final_video = Path(str(result.get("dubbed_video_final") or ""))
    final_audio = Path(str(result.get("dubbed_audio") or ""))
    payload: dict[str, Any] = {}
    if final_audio.exists():
        payload["audio"] = {
            "path": str(final_audio),
            "size": final_audio.stat().st_size,
            "sha256": _safe_sha256(final_audio),
        }
    if final_video.exists():
        payload["video"] = {
            "path": str(final_video),
            "size": final_video.stat().st_size,
            "sha256": _safe_sha256(final_video),
        }
    return payload


def _cleanup_speaker_profiles(profiles: list[dict[str, Any]]) -> None:
    for profile in profiles:
        path_raw = str(profile.get("referencePath") or "").strip()
        if not path_raw:
            continue
        try:
            path = Path(path_raw)
            if path.exists() and path.is_file():
                path.unlink(missing_ok=True)
            parent = path.parent
            if parent.exists() and parent.is_dir() and not any(parent.iterdir()):
                parent.rmdir()
        except Exception:
            continue


def _run_dubbing_job_v2(job_id: str, job_payload: dict[str, Any]) -> None:
    job_dir = Path(job_payload["jobDir"])
    job_dir.mkdir(parents=True, exist_ok=True)
    stage_timeline: list[dict[str, Any]] = []
    active_stage: dict[str, Any] | None = None
    report_path = job_dir / "report.json"
    speaker_profiles: list[dict[str, Any]] = []
    speaker_synthesis_stats: dict[str, dict[str, int]] = {}
    synthesis_failures: list[dict[str, Any]] = []
    tts_requests: list[dict[str, Any]] = []
    selected_routes: list[dict[str, Any]] = []
    quality_gate: dict[str, Any] = {"passed": False, "reasons": []}
    preflight: dict[str, Any] = {"ok": False, "checks": [], "failureCount": 0}
    clone_scope = "job_only"
    engine_selected = "AUTO_RELIABLE"
    engine_executed = "GEM"
    fallback_used = False
    fallback_reason: Optional[str] = None
    supports_one_shot_clone_at_decision = True

    def set_stage(stage_name: str, progress: int) -> None:
        nonlocal active_stage
        now = _now_ms()
        if active_stage and active_stage.get("status") == "running":
            active_stage["status"] = "completed"
            active_stage["endMs"] = now
            active_stage["durationMs"] = max(0, now - int(active_stage.get("startMs") or now))
        active_stage = {
            "stage": stage_name,
            "status": "running",
            "startMs": now,
            "endMs": None,
            "durationMs": None,
        }
        stage_timeline.append(active_stage)
        _update_dubbing_job(job_id, stage=stage_name, progress=progress, stageTimeline=stage_timeline)

    def close_stage(status: str) -> None:
        nonlocal active_stage
        if not active_stage or active_stage.get("status") != "running":
            return
        now = _now_ms()
        active_stage["status"] = status
        active_stage["endMs"] = now
        active_stage["durationMs"] = max(0, now - int(active_stage.get("startMs") or now))
        active_stage = None

    try:
        _update_dubbing_job(
            job_id,
            status="running",
            stage="preflight",
            progress=1,
            pipelineVersion="v2",
            errorCode=None,
            stageTimeline=stage_timeline,
        )
        _append_dubbing_log(job_id, "Starting dubbing pipeline v2")

        from video_dubbing.config import build_config, run_strict_preflight
        from video_dubbing.main import run_pipeline

        source_path = Path(job_payload["sourcePath"])
        cfg = build_config(job_dir)
        preflight = run_strict_preflight(cfg, source_path)
        _update_dubbing_job(job_id, preflight=preflight)
        if not preflight.get("ok"):
            _update_dubbing_job(
                job_id,
                status="failed",
                stage="preflight",
                progress=0,
                errorCode="PRECHECK_FAILED",
                error="Strict preflight failed. Download report for check remediation steps.",
            )
            report_path.write_text(
                json.dumps(
                    {
                        "pipelineVersion": "v2",
                        "jobId": job_id,
                        "preflight": preflight,
                        "stageTimeline": stage_timeline,
                        "selectedVoices": [],
                        "segmentStats": {},
                        "alignment": [],
                        "outputFiles": {},
                        "speakerDetection": {"speakers": [], "segmentCount": 0},
                        "cloneStore": {"scope": "job_only", "profiles": []},
                        "ttsRequests": [],
                        "synthesisFailures": [],
                        "qualityGate": {"passed": False, "reasons": ["preflight_failed"]},
                        "speakerSynthesisStats": {},
                        "engineSelected": engine_selected,
                        "engineExecuted": engine_executed,
                        "engineSelectedDisplay": _conversion_policy_display_name(engine_selected),
                        "engineExecutedDisplay": _executed_engine_display_name(engine_executed),
                        "fallbackUsed": fallback_used,
                        "fallbackReason": fallback_reason,
                        "supportsOneShotCloneAtDecision": supports_one_shot_clone_at_decision,
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            _update_dubbing_job(
                job_id,
                reportPath=str(report_path),
                speakerProfiles=[],
                speakerSynthesisStats={},
                qualityGate={"passed": False, "reasons": ["preflight_failed"]},
                engineSelected=engine_selected,
                engineExecuted=engine_executed,
                engineSelectedDisplay=_conversion_policy_display_name(engine_selected),
                engineExecutedDisplay=_executed_engine_display_name(engine_executed),
                fallbackUsed=fallback_used,
                fallbackReason=fallback_reason,
                supportsOneShotCloneAtDecision=supports_one_shot_clone_at_decision,
            )
            return

        target_language = _normalize_target_language(str(job_payload.get("target_language") or "auto"))
        advanced = job_payload.get("advanced") if isinstance(job_payload.get("advanced"), dict) else {}
        input_voice_map = advanced.get("voice_map") if isinstance(advanced.get("voice_map"), dict) else {}
        engine_selected = _normalize_conversion_policy(str(advanced.get("engine_policy") or "AUTO_RELIABLE"))
        tts_route = str(advanced.get("tts_route") or "auto").strip().lower()
        if tts_route not in {"auto", "gem_only", "kokoro_only"}:
            tts_route = "auto"
        engine_executed = _default_engine_for_tts_route(tts_route)
        multispeaker_policy = str(advanced.get("multispeaker_policy") or "auto_diarize").strip().lower()
        segment_failure_policy = str(advanced.get("segment_failure_policy") or "hard_fail").strip().lower()
        clone_scope = str(advanced.get("clone_scope") or "job_only").strip().lower()
        transcript_override = str(advanced.get("transcript_override") or "").strip()
        _ = transcript_override  # Reserved for future stage override injection.
        _ = multispeaker_policy
        _ = clone_scope
        clone_required = clone_scope == "job_only" or bool(input_voice_map)
        lhq_healthy, _ = lhq_svc_adapter.health()
        supports_one_shot_clone_at_decision = engine_selected != "LHQ_PILOT"
        if engine_selected == "LHQ_PILOT":
            fallback_used = True
            if clone_required:
                fallback_reason = "lhq_missing_clone_parity"
            elif not lhq_healthy:
                fallback_reason = "lhq_unhealthy"
            else:
                fallback_reason = "lhq_quality_gate_failed"

        stage_map = {
            "stage1_preprocess": ("preprocess", 12),
            "stage2_diarize": ("diarize", 22),
            "stage3_emotion": ("emotion_detect", 34),
            "stage4_segment_detect": ("segment_detect", 44),
            "stage5_translate": ("translate", 54),
            "stage6_tts": ("tts", 70),
            "stage7_world": ("prosody_transfer", 82),
            "stage8_reconstruct": ("reconstruct", 92),
            "stage9_lipsync": ("lip_sync", 97),
        }

        def _pipeline_logger(message: str) -> None:
            stripped = (message or "").strip()
            if stripped.startswith("[stage:start] "):
                stage_name = stripped.split("[stage:start] ", 1)[1].strip()
                stage, progress = stage_map.get(stage_name, (stage_name, 5))
                set_stage(stage, progress)
            elif stripped.startswith("[stage:end] "):
                close_stage("completed")
            _append_dubbing_log(job_id, stripped)
            if _is_job_cancelled(job_id):
                raise RuntimeError("cancelled")

        def _resolve_voice_map(segments: list[dict], initial: dict[str, str]) -> dict[str, str]:
            speakers = sorted({str(seg.get("speaker") or "SPEAKER_00") for seg in segments})
            if len(speakers) == 0 and len(segments) > 0:
                raise RuntimeError("speaker_detection_empty")
            resolved_map, routed = _auto_route_dubbing_voices(
                preferred_map=input_voice_map if input_voice_map else initial,
                speakers=speakers,
                tts_route=tts_route,
            )
            selected_engine_by_speaker = {
                str(item.get("speaker") or ""): str(item.get("engine") or "GEM")
                for item in routed
                if str(item.get("status") or "") == "selected"
            }
            default_engine = _default_engine_for_tts_route(tts_route)
            for seg in segments:
                speaker = str(seg.get("speaker") or "SPEAKER_00")
                seg["tts_engine"] = selected_engine_by_speaker.get(speaker, default_engine)
            selected_routes[:] = routed
            return resolved_map

        result = run_pipeline(
            source_path=source_path,
            output_dir=job_dir,
            target_language=target_language,
            tts_route=tts_route,
            voice_map=input_voice_map,
            strict=True,
            voice_map_resolver=_resolve_voice_map,
            logger=_pipeline_logger,
        )
        close_stage("completed")

        final_video = Path(str(result.get("dubbed_video_final") or ""))
        final_audio = Path(str(result.get("dubbed_audio") or ""))
        chosen = final_video if final_video.exists() else final_audio
        if not chosen.exists():
            raise RuntimeError("Pipeline completed but no final output file was generated")

        segments = result.get("segments") or []
        alignment: list[dict[str, Any]] = []
        speakers = sorted({str(seg.get("speaker") or "SPEAKER_00") for seg in segments})
        if len(speakers) == 0 and len(segments) > 0:
            raise RuntimeError("speaker_detection_empty")
        if not selected_routes:
            _, selected_routes = _auto_route_dubbing_voices(
                preferred_map=input_voice_map,
                speakers=speakers,
                tts_route=tts_route,
            )
        alignment = list(result.get("alignment") or [])
        if not alignment:
            for idx, seg in enumerate(segments):
                start = float(seg.get("start") or 0.0)
                end = float(seg.get("end") or start)
                duration = max(0.0, end - start)
                alignment.append(
                    {
                        "index": idx,
                        "score": _build_alignment_score(duration, duration),
                        "target": duration,
                        "actual": duration,
                    }
                )

        speaker_profiles = list(result.get("speaker_profiles") or [])
        tts_requests = list(result.get("tts_requests") or [])
        engine_executed = _resolve_engine_executed_from_requests(tts_requests)
        synthesis_failures = list(result.get("synthesis_failures") or [])
        for speaker in speakers:
            speaker_synthesis_stats[speaker] = {"segments": 0, "ok": 0, "failed": 0}
        for req in tts_requests:
            speaker = str(req.get("speaker") or "SPEAKER_00")
            stats = speaker_synthesis_stats.setdefault(speaker, {"segments": 0, "ok": 0, "failed": 0})
            stats["segments"] += 1
            if req.get("ok"):
                stats["ok"] += 1
            else:
                stats["failed"] += 1

        if synthesis_failures and segment_failure_policy == "hard_fail":
            raise RuntimeError(f"tts_segment_failures:{len(synthesis_failures)}")

        output_files = _build_dubbing_output_files(result)
        segment_stats = {
            "count": len(segments),
            "speakers": speakers,
            "language": result.get("language") or target_language,
        }
        quality_gate = {"passed": len(synthesis_failures) == 0, "reasons": []}
        if synthesis_failures:
            quality_gate["reasons"].append("segment_synthesis_failed")
        report_payload = {
            "pipelineVersion": "v2",
            "jobId": job_id,
            "preflight": preflight,
            "stageTimeline": stage_timeline,
            "selectedVoices": selected_routes,
            "segmentStats": segment_stats,
            "alignment": alignment,
            "outputFiles": output_files,
            "speakerDetection": {"speakers": speakers, "segmentCount": len(segments)},
            "cloneStore": {"scope": clone_scope, "profiles": speaker_profiles},
            "ttsRequests": tts_requests,
            "synthesisFailures": synthesis_failures,
            "qualityGate": quality_gate,
            "speakerSynthesisStats": speaker_synthesis_stats,
            "engineSelected": engine_selected,
            "engineExecuted": engine_executed,
            "engineSelectedDisplay": _conversion_policy_display_name(engine_selected),
            "engineExecutedDisplay": _executed_engine_display_name(engine_executed),
            "fallbackUsed": fallback_used,
            "fallbackReason": fallback_reason,
            "supportsOneShotCloneAtDecision": supports_one_shot_clone_at_decision,
        }
        report_path.write_text(json.dumps(report_payload, indent=2), encoding="utf-8")

        _update_dubbing_job(
            job_id,
            status="completed",
            stage="completed",
            progress=100,
            resultPath=str(chosen),
            alignment=alignment,
            script=_build_script_from_segments(segments),
            pipelineVersion="v2",
            errorCode=None,
            preflight=preflight,
            stageTimeline=stage_timeline,
            reportPath=str(report_path),
            outputFiles=output_files,
            speakerProfiles=speaker_profiles,
            speakerSynthesisStats=speaker_synthesis_stats,
            qualityGate=quality_gate,
            engineSelected=engine_selected,
            engineExecuted=engine_executed,
            engineSelectedDisplay=_conversion_policy_display_name(engine_selected),
            engineExecutedDisplay=_executed_engine_display_name(engine_executed),
            fallbackUsed=fallback_used,
            fallbackReason=fallback_reason,
            supportsOneShotCloneAtDecision=supports_one_shot_clone_at_decision,
        )
        _append_dubbing_log(job_id, "Dubbing completed.")
    except Exception as exc:  # noqa: BLE001
        close_stage("failed")
        if str(exc) == "cancelled":
            _update_dubbing_job(
                job_id,
                status="cancelled",
                stage="cancelled",
                progress=0,
                errorCode="CANCELLED",
                stageTimeline=stage_timeline,
                speakerProfiles=speaker_profiles,
                speakerSynthesisStats=speaker_synthesis_stats,
                qualityGate=quality_gate,
                engineSelected=engine_selected,
                engineExecuted=engine_executed,
                engineSelectedDisplay=_conversion_policy_display_name(engine_selected),
                engineExecutedDisplay=_executed_engine_display_name(engine_executed),
                fallbackUsed=fallback_used,
                fallbackReason=fallback_reason,
                supportsOneShotCloneAtDecision=supports_one_shot_clone_at_decision,
            )
            _append_dubbing_log(job_id, "Dubbing cancelled.")
        else:
            error_code = "PRECHECK_FAILED" if "strict_preflight_failed" in str(exc) else "STAGE_FAILED"
            quality_gate["passed"] = False
            if str(exc):
                quality_gate["reasons"] = [str(exc)]
            _update_dubbing_job(
                job_id,
                status="failed",
                stage="failed",
                error=str(exc),
                errorCode=error_code,
                stageTimeline=stage_timeline,
                speakerProfiles=speaker_profiles,
                speakerSynthesisStats=speaker_synthesis_stats,
                qualityGate=quality_gate,
                engineSelected=engine_selected,
                engineExecuted=engine_executed,
                engineSelectedDisplay=_conversion_policy_display_name(engine_selected),
                engineExecutedDisplay=_executed_engine_display_name(engine_executed),
                fallbackUsed=fallback_used,
                fallbackReason=fallback_reason,
                supportsOneShotCloneAtDecision=supports_one_shot_clone_at_decision,
            )
            _append_dubbing_log(job_id, f"Error: {exc}")
        try:
            if not report_path.exists():
                report_path.write_text(
                    json.dumps(
                        {
                            "pipelineVersion": "v2",
                            "jobId": job_id,
                            "preflight": preflight,
                            "stageTimeline": stage_timeline,
                            "selectedVoices": selected_routes,
                            "segmentStats": {},
                            "alignment": [],
                            "outputFiles": {},
                            "speakerDetection": {"speakers": [], "segmentCount": 0},
                            "cloneStore": {"scope": "job_only", "profiles": speaker_profiles},
                            "ttsRequests": tts_requests,
                            "synthesisFailures": synthesis_failures,
                            "qualityGate": quality_gate,
                            "speakerSynthesisStats": speaker_synthesis_stats,
                            "engineSelected": engine_selected,
                            "engineExecuted": engine_executed,
                            "engineSelectedDisplay": _conversion_policy_display_name(engine_selected),
                            "engineExecutedDisplay": _executed_engine_display_name(engine_executed),
                            "fallbackUsed": fallback_used,
                            "fallbackReason": fallback_reason,
                            "supportsOneShotCloneAtDecision": supports_one_shot_clone_at_decision,
                            "error": str(exc),
                        },
                        indent=2,
                    ),
                    encoding="utf-8",
                )
            _update_dubbing_job(
                job_id,
                reportPath=str(report_path),
                speakerProfiles=speaker_profiles,
                speakerSynthesisStats=speaker_synthesis_stats,
                qualityGate=quality_gate,
                engineSelected=engine_selected,
                engineExecuted=engine_executed,
                engineSelectedDisplay=_conversion_policy_display_name(engine_selected),
                engineExecutedDisplay=_executed_engine_display_name(engine_executed),
                fallbackUsed=fallback_used,
                fallbackReason=fallback_reason,
                supportsOneShotCloneAtDecision=supports_one_shot_clone_at_decision,
            )
        except Exception:
            pass
    finally:
        if clone_scope == "job_only":
            _cleanup_speaker_profiles(speaker_profiles)


def _run_dubbing_job(job_id: str, job_payload: dict[str, Any]) -> None:
    job_dir = Path(job_payload["jobDir"])
    job_dir.mkdir(parents=True, exist_ok=True)
    try:
        _update_dubbing_job(job_id, status="running", stage="ingest", progress=2)
        _append_dubbing_log(job_id, "Starting automated video dubbing pipeline")

        try:
            from video_dubbing.main import run_pipeline
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"video_dubbing module import failed: {exc}") from exc

        source_path = Path(job_payload["sourcePath"])
        target_language = _normalize_target_language(str(job_payload.get("target_language") or "auto"))
        voice_map = job_payload.get("voice_map") or {}
        if not isinstance(voice_map, dict):
            voice_map = {}

        stage_map = {
            "audio extracted": ("preprocess", 12),
            "demucs": ("source_separation", 22),
            "whisper": ("asr_alignment", 35),
            "speaker": ("diarize", 45),
            "emotion": ("emotion_detect", 55),
            "segment": ("segment_detect", 62),
            "tts": ("tts", 74),
            "pyworld": ("prosody_transfer", 84),
            "reconstruction": ("reconstruct", 92),
            "latentsync": ("lip_sync", 97),
        }

        def _pipeline_logger(message: str) -> None:
            lower = message.lower()
            for token, (stage, progress) in stage_map.items():
                if token in lower:
                    _update_dubbing_job(job_id, stage=stage, progress=progress)
                    break
            _append_dubbing_log(job_id, message)
            if _is_job_cancelled(job_id):
                raise RuntimeError("cancelled")

        result = run_pipeline(
            source_path=source_path,
            output_dir=job_dir,
            target_language=target_language,
            voice_map=voice_map,
            logger=_pipeline_logger,
        )

        final_video = Path(str(result.get("dubbed_video_final") or ""))
        final_audio = Path(str(result.get("dubbed_audio") or ""))
        chosen = final_video if final_video.exists() else final_audio
        if not chosen.exists():
            raise RuntimeError("Pipeline completed but no final output file was generated")

        segments = result.get("segments") or []
        alignment: list[dict[str, Any]] = []
        for idx, seg in enumerate(segments):
            start = float(seg.get("start") or 0.0)
            end = float(seg.get("end") or start)
            duration = max(0.0, end - start)
            alignment.append({"index": idx, "score": 1.0, "target": duration, "actual": duration})

        _update_dubbing_job(
            job_id,
            status="completed",
            stage="completed",
            progress=100,
            resultPath=str(chosen),
            alignment=alignment,
            script=_build_script_from_segments(segments),
        )
        _append_dubbing_log(job_id, "Dubbing completed.")
    except Exception as exc:  # noqa: BLE001
        if str(exc) == "cancelled":
            _update_dubbing_job(job_id, status="cancelled", stage="cancelled", progress=0)
            _append_dubbing_log(job_id, "Dubbing cancelled.")
        else:
            _update_dubbing_job(job_id, status="failed", stage="failed", error=str(exc))
            _append_dubbing_log(job_id, f"Error: {exc}")


@app.post("/video/transcribe", response_model=VideoTranscriptionResponse)
async def video_transcribe(
    file: UploadFile = File(...),
    language: str = Form("auto"),
    task: str = Form("transcribe"),
    include_emotion: bool = Form(True),
    return_words: bool = Form(True),
    capture_emotions: Optional[bool] = Form(None),
    speaker_label: Optional[str] = Form(None),
) -> JSONResponse:
    temp_dir = tempfile.mkdtemp(prefix="vf_transcribe_")
    source_path = Path(temp_dir) / _safe_upload_name(file.filename, "source")
    try:
        with source_path.open("wb") as handle:
            handle.write(await file.read())

        _ = speaker_label  # Accepted for backward compatibility.
        effective_include_emotion = bool(include_emotion)
        if capture_emotions is not None:
            effective_include_emotion = bool(capture_emotions)

        asr_path = Path(temp_dir) / "asr.wav"
        _convert_media_to_wav(str(source_path), str(asr_path), sample_rate=16000, channels=1)
        whisper_payload = _transcribe_with_whisper(
            asr_path,
            language=_normalize_transcribe_language(language),
            task=task,
            return_words=bool(return_words),
        )
        segments = whisper_payload.get("segments", [])
        detected_language = whisper_payload.get("language")

        if effective_include_emotion and ENABLE_TRANSCRIBE_EMOTION_CAPTURE:
            for idx, seg in enumerate(segments[:TRANSCRIBE_EMOTION_MAX_SEGMENTS]):
                start = float(seg.get("start") or 0.0)
                end = float(seg.get("end") or start + 0.5)
                if end - start < TRANSCRIBE_EMOTION_MIN_SECONDS:
                    continue
                temp_seg = Path(temp_dir) / f"seg_{idx:04d}.wav"
                _slice_audio_segment_to_wav(str(asr_path), str(temp_seg), start=start, end=end, sample_rate=16000)
                emotion, source, confidence = _detect_emotion_from_segment_audio(
                    str(temp_seg),
                    language_hint=detected_language,
                    fallback_text=seg.get("text") or "",
                )
                seg["emotion"] = emotion
                seg["emotionSource"] = source
                if confidence is not None:
                    seg["emotionConfidence"] = confidence

        script = _build_script_from_segments(segments)
        return JSONResponse(
            {
                "ok": True,
                "language": detected_language,
                "segments": segments,
                "script": script,
                "durationSec": _wav_duration_seconds(str(asr_path)),
            }
        )
    finally:
        _cleanup_paths(temp_dir)


@app.post("/video/separate-stem")
async def video_separate_stem(
    file: UploadFile = File(...),
    stem: str = Form("speech"),
    model_name: str = Form(SEPARATION_MODEL),
) -> FileResponse:
    if not ENABLE_SOURCE_SEPARATION:
        raise HTTPException(status_code=503, detail="Source separation is disabled.")

    stem_token = str(stem or "speech").strip().lower()
    if stem_token not in {"speech", "background"}:
        raise HTTPException(status_code=400, detail="stem must be 'speech' or 'background'.")

    temp_dir = tempfile.mkdtemp(prefix="vf_separate_upload_")
    source_path = Path(temp_dir) / _safe_upload_name(file.filename, "source")
    try:
        with source_path.open("wb") as handle:
            handle.write(await file.read())
        speech_path, background_path, _cache_key = _ensure_source_separation(source_path, model_name)
        selected = speech_path if stem_token == "speech" else background_path
        return FileResponse(
            str(selected),
            media_type="audio/wav",
            filename=f"{stem_token}_stem.wav",
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to separate stems: {exc}") from exc
    finally:
        _cleanup_paths(temp_dir)


@app.post("/video/mux-dub")
async def video_mux_dub(
    video: UploadFile = File(...),
    dub_audio: UploadFile = File(...),
    background_audio: Optional[UploadFile] = File(None),
    speech_gain: float = Form(1.0),
    background_gain: float = Form(0.3),
    normalize: bool = Form(True),
    mix_with_video_audio: Optional[bool] = Form(None),
) -> FileResponse:
    temp_dir = tempfile.mkdtemp(prefix="vf_mux_")
    try:
        _ = normalize
        _ = mix_with_video_audio  # Accepted for compatibility with legacy frontend payloads.
        video_path = Path(temp_dir) / _safe_upload_name(video.filename, "video")
        dub_path = Path(temp_dir) / _safe_upload_name(dub_audio.filename, "dub.wav")
        with video_path.open("wb") as handle:
            handle.write(await video.read())
        with dub_path.open("wb") as handle:
            handle.write(await dub_audio.read())

        mixed_path = Path(temp_dir) / "mixed.wav"
        ffmpeg = _get_ffmpeg_path()
        if background_audio is not None:
            bg_path = Path(temp_dir) / _safe_upload_name(background_audio.filename, "bg.wav")
            with bg_path.open("wb") as handle:
                handle.write(await background_audio.read())
            _run(
                [
                    ffmpeg,
                    "-y",
                    "-i",
                    str(dub_path),
                    "-i",
                    str(bg_path),
                    "-filter_complex",
                    f"[0:a]volume={speech_gain}[a0];[1:a]volume={background_gain}[a1];[a0][a1]amix=inputs=2:duration=longest[aout]",
                    "-map",
                    "[aout]",
                    str(mixed_path),
                ]
            )
        else:
            _run(
                [
                    ffmpeg,
                    "-y",
                    "-i",
                    str(dub_path),
                    "-filter:a",
                    f"volume={speech_gain}",
                    str(mixed_path),
                ]
            )

        output_path = Path(temp_dir) / "dubbed.mp4"
        _run(
            [
                ffmpeg,
                "-y",
                "-i",
                str(video_path),
                "-i",
                str(mixed_path),
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-c:v",
                "copy",
                "-shortest",
                str(output_path),
            ]
        )
        return FileResponse(
            str(output_path),
            media_type="video/mp4",
            filename="dubbed.mp4",
        )
    finally:
        _cleanup_paths(temp_dir)


@app.post("/dubbing/jobs")
async def create_dubbing_job(
    source_file: UploadFile = File(...),
    target_language: str = Form("auto"),
    engine: str = Form("GEM"),
    voice_map: str = Form("{}"),
    transcript: str = Form(""),
    emotion_matching: bool = Form(True),
    prosody_transfer: bool = Form(True),
    lip_sync: bool = Form(True),
    output: str = Form("audio+video"),
) -> JSONResponse:
    job_id = uuid.uuid4().hex
    job_dir = ARTIFACTS_DIR / "dubbing" / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    source_path = job_dir / _safe_upload_name(source_file.filename, "source")
    with source_path.open("wb") as handle:
        handle.write(await source_file.read())
    try:
        voice_map_payload = json.loads(voice_map or "{}")
    except Exception:
        voice_map_payload = {}
    normalized_target_language = _normalize_target_language(target_language)
    job_payload = {
        "jobId": job_id,
        "jobDir": str(job_dir),
        "sourcePath": str(source_path),
        "target_language": normalized_target_language,
        "engine": engine,
        "voice_map": voice_map_payload if isinstance(voice_map_payload, dict) else {},
        "transcript": transcript,
        "emotion_matching": bool(emotion_matching),
        "prosody_transfer": bool(prosody_transfer),
        "lip_sync": bool(lip_sync),
        "output": output,
        "language": normalized_target_language,
    }

    with DUBBING_JOB_LOCK:
        DUBBING_JOBS[job_id] = {
            "id": job_id,
            "status": "queued",
            "stage": "queued",
            "progress": 0,
            "createdAt": int(time.time() * 1000),
            "updatedAt": int(time.time() * 1000),
            "cancelRequested": False,
            "logs": [],
            "resultPath": None,
        }

    thread = threading.Thread(target=_run_dubbing_job, args=(job_id, job_payload), daemon=True)
    thread.start()
    return JSONResponse({"ok": True, "job_id": job_id})


@app.post("/dubbing/jobs/v2")
async def create_dubbing_job_v2(
    source_file: UploadFile = File(...),
    target_language: str = Form("auto"),
    mode: str = Form("strict_full"),
    output: str = Form("audio+video"),
    advanced: str = Form("{}"),
) -> JSONResponse:
    if mode != "strict_full":
        raise HTTPException(status_code=400, detail="Unsupported mode. Use strict_full.")

    job_id = uuid.uuid4().hex
    job_dir = ARTIFACTS_DIR / "dubbing" / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    source_path = job_dir / _safe_upload_name(source_file.filename, "source")
    with source_path.open("wb") as handle:
        handle.write(await source_file.read())

    try:
        advanced_payload = json.loads(advanced or "{}")
    except Exception:
        advanced_payload = {}
    if not isinstance(advanced_payload, dict):
        advanced_payload = {}
    if "engine_policy" not in advanced_payload:
        advanced_payload["engine_policy"] = "auto_reliable"
    advanced_payload["engine_policy"] = _normalize_conversion_policy(
        str(advanced_payload.get("engine_policy") or "auto_reliable"),
        default="AUTO_RELIABLE",
    ).lower()
    selected_policy = _normalize_conversion_policy(str(advanced_payload.get("engine_policy") or "AUTO_RELIABLE"))
    if "xtts_mode" in advanced_payload:
        raise HTTPException(
            status_code=400,
            detail="advanced.xtts_mode is no longer supported. Use advanced.tts_route (auto|gem_only|kokoro_only).",
        )
    if "tts_runtime" in advanced_payload:
        raise HTTPException(
            status_code=400,
            detail="advanced.tts_runtime is no longer supported. Use advanced.tts_route (auto|gem_only|kokoro_only).",
        )
    if "tts_route" not in advanced_payload:
        advanced_payload["tts_route"] = "auto"
    tts_route = str(advanced_payload.get("tts_route") or "auto").strip().lower()
    if tts_route not in {"auto", "gem_only", "kokoro_only"}:
        raise HTTPException(status_code=400, detail="advanced.tts_route must be auto, gem_only, or kokoro_only")
    advanced_payload["tts_route"] = tts_route
    advanced_payload["multispeaker_policy"] = "auto_diarize"
    if "segment_failure_policy" not in advanced_payload:
        advanced_payload["segment_failure_policy"] = "hard_fail"
    if str(advanced_payload.get("segment_failure_policy")).strip().lower() not in {"hard_fail"}:
        raise HTTPException(status_code=400, detail="advanced.segment_failure_policy only supports hard_fail")
    if "clone_scope" not in advanced_payload:
        advanced_payload["clone_scope"] = "job_only"
    if str(advanced_payload.get("clone_scope")).strip().lower() not in {"job_only"}:
        raise HTTPException(status_code=400, detail="advanced.clone_scope only supports job_only")
    if "voice_map" in advanced_payload and not isinstance(advanced_payload["voice_map"], dict):
        advanced_payload["voice_map"] = {}

    normalized_target_language = _normalize_target_language(target_language)
    job_payload = {
        "jobId": job_id,
        "jobDir": str(job_dir),
        "sourcePath": str(source_path),
        "target_language": normalized_target_language,
        "mode": mode,
        "output": output,
        "advanced": advanced_payload,
    }

    with DUBBING_JOB_LOCK:
        default_engine_executed = _default_engine_for_tts_route(tts_route)
        DUBBING_JOBS[job_id] = {
            "id": job_id,
            "status": "queued",
            "stage": "queued",
            "progress": 0,
            "createdAt": int(time.time() * 1000),
            "updatedAt": int(time.time() * 1000),
            "cancelRequested": False,
            "logs": [],
            "resultPath": None,
            "pipelineVersion": "v2",
            "preflight": None,
            "stageTimeline": [],
            "reportPath": None,
            "outputFiles": {},
            "errorCode": None,
            "speakerProfiles": [],
            "speakerSynthesisStats": {},
            "qualityGate": {"passed": False, "reasons": []},
            "engineSelected": selected_policy,
            "engineExecuted": default_engine_executed,
            "engineSelectedDisplay": _conversion_policy_display_name(selected_policy),
            "engineExecutedDisplay": _executed_engine_display_name(default_engine_executed),
            "fallbackUsed": selected_policy == "LHQ_PILOT",
            "fallbackReason": "lhq_missing_clone_parity" if selected_policy == "LHQ_PILOT" else None,
            "supportsOneShotCloneAtDecision": selected_policy != "LHQ_PILOT",
        }

    thread = threading.Thread(target=_run_dubbing_job_v2, args=(job_id, job_payload), daemon=True)
    thread.start()
    return JSONResponse({"ok": True, "job_id": job_id})


@app.get("/dubbing/jobs/{job_id}")
def get_dubbing_job(job_id: str) -> JSONResponse:
    with DUBBING_JOB_LOCK:
        job = DUBBING_JOBS.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return JSONResponse({"ok": True, "job": job})


@app.post("/dubbing/jobs/{job_id}/cancel")
def cancel_dubbing_job(job_id: str) -> JSONResponse:
    with DUBBING_JOB_LOCK:
        job = DUBBING_JOBS.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        job["cancelRequested"] = True
        job["status"] = "cancelling"
        job["stage"] = "cancelling"
    return JSONResponse({"ok": True, "job_id": job_id})


@app.get("/dubbing/jobs/{job_id}/result")
def download_dubbing_result(job_id: str) -> FileResponse:
    with DUBBING_JOB_LOCK:
        job = DUBBING_JOBS.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        result_path = job.get("resultPath")
        if not result_path:
            raise HTTPException(status_code=404, detail="Result not ready")
    path = Path(result_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Result file missing")
    media_type = "audio/wav"
    if path.suffix.lower() == ".mp4":
        media_type = "video/mp4"
    return FileResponse(str(path), media_type=media_type, filename=path.name)


@app.get("/dubbing/jobs/{job_id}/report")
def download_dubbing_report(job_id: str) -> FileResponse:
    with DUBBING_JOB_LOCK:
        job = DUBBING_JOBS.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        report_path = str(job.get("reportPath") or "")
    path = Path(report_path)
    if not report_path or not path.exists():
        raise HTTPException(status_code=404, detail="Report not ready")
    return FileResponse(str(path), media_type="application/json", filename=f"{job_id}_report.json")


@app.get("/rvc/models")
def list_rvc_models() -> JSONResponse:
    lhq_healthy, lhq_detail = lhq_svc_adapter.health()
    try:
        models = rvc_runtime.list_models()
        if ENABLE_RVC_FALLBACK and RVC_FALLBACK_MODEL_ID not in models:
            models = [RVC_FALLBACK_MODEL_ID, *models]
        if lhq_healthy and LHQ_SVC_PILOT_MODEL_ID not in models:
            models = [LHQ_SVC_PILOT_MODEL_ID, *models]
        current_model = rvc_runtime.current_model()
        if not current_model and ENABLE_RVC_FALLBACK:
            current_model = RVC_FALLBACK_MODEL_ID
        return JSONResponse(
            {
                "models": models,
                "currentModel": current_model,
                "lhqPilot": {"healthy": lhq_healthy, "detail": lhq_detail},
            }
        )
    except Exception as exc:
        fallback_models = [RVC_FALLBACK_MODEL_ID] if ENABLE_RVC_FALLBACK else []
        if lhq_healthy:
            fallback_models = [LHQ_SVC_PILOT_MODEL_ID, *fallback_models]
        if ENABLE_RVC_FALLBACK:
            return JSONResponse(
                {
                    "models": fallback_models,
                    "currentModel": RVC_FALLBACK_MODEL_ID,
                    "fallback": True,
                    "detail": f"RVC unavailable; using low-CPU fallback ({exc})",
                    "lhqPilot": {"healthy": lhq_healthy, "detail": lhq_detail},
                }
            )
        raise HTTPException(status_code=503, detail=f"RVC unavailable: {exc}") from exc


@app.post("/rvc/load-model")
def load_rvc_model(payload: LoadRvcModelRequest) -> JSONResponse:
    if payload.modelName == LHQ_SVC_PILOT_MODEL_ID:
        healthy, detail = lhq_svc_adapter.health()
        if not healthy:
            raise HTTPException(status_code=400, detail=f"LHQ-SVC pilot unavailable: {detail}")
        return JSONResponse(
            {
                "ok": True,
                "currentModel": LHQ_SVC_PILOT_MODEL_ID,
                "fallback": False,
                "detail": "LHQ-SVC pilot model selected.",
            }
        )
    if payload.modelName == RVC_FALLBACK_MODEL_ID and ENABLE_RVC_FALLBACK:
        return JSONResponse(
            {
                "ok": True,
                "currentModel": RVC_FALLBACK_MODEL_ID,
                "fallback": True,
                "detail": "Low-CPU timbre fallback selected.",
            }
        )
    try:
        rvc_runtime.load_model(payload.modelName, payload.version)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to load model: {exc}") from exc

    return JSONResponse({"ok": True, "currentModel": rvc_runtime.current_model()})


@app.post("/rvc/convert")
async def convert_rvc(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    model_name: str = Form(...),
    engine_policy: str = Form("AUTO_RELIABLE"),
    clone_required: bool = Form(False),
    preset: str = Form("tts_realtime"),
    pitch_shift: int = Form(0),
    index_rate: float = Form(0.5),
    filter_radius: int = Form(3),
    rms_mix_rate: float = Form(1.0),
    protect: float = Form(0.33),
    f0_method: str = Form("rmvpe"),
) -> FileResponse:
    policy = _normalize_conversion_policy(engine_policy, default="AUTO_RELIABLE")
    safe_preset = _normalize_rvc_preset(preset)
    selected_engine = "RVC"
    executed_engine = "RVC"
    fallback_used = False
    fallback_reason: Optional[str] = None

    temp_dir = tempfile.mkdtemp(prefix="vf_rvc_")
    source_path = Path(temp_dir) / _safe_upload_name(file.filename, "source_audio")
    normalized_wav = Path(temp_dir) / "input.wav"
    output_path = Path(temp_dir) / "output.wav"

    try:
        with source_path.open("wb") as f:
            f.write(await file.read())

        _convert_media_to_wav(str(source_path), str(normalized_wav), sample_rate=40000)

        if policy == "LHQ_PILOT":
            selected_engine = "LHQ_SVC"
            lhq_ok, lhq_detail = lhq_svc_adapter.health()
            if clone_required:
                fallback_used = True
                fallback_reason = "lhq_missing_clone_parity"
            elif not lhq_ok:
                fallback_used = True
                fallback_reason = "lhq_unhealthy"
            else:
                try:
                    lhq_svc_adapter.convert(
                        str(normalized_wav),
                        str(output_path),
                        pitch_shift=pitch_shift,
                        sample_rate=40000,
                    )
                    executed_engine = "LHQ_SVC"
                except Exception:
                    fallback_used = True
                    fallback_reason = "lhq_quality_gate_failed"

        if not output_path.exists():
            if model_name == RVC_FALLBACK_MODEL_ID:
                fallback_used = True
                fallback_reason = fallback_reason or "selected_model"
                _convert_with_low_cpu_timbre(
                    str(normalized_wav),
                    str(output_path),
                    pitch_shift=pitch_shift,
                    sample_rate=40000,
                )
                executed_engine = "RVC_FALLBACK"
            else:
                rvc_ok, rvc_detail = rvc_adapter.health()
                if rvc_ok:
                    rvc_adapter.convert(
                        str(normalized_wav),
                        str(output_path),
                        model_name=model_name,
                        preset=safe_preset,
                        f0_method=f0_method,
                        pitch_shift=pitch_shift,
                        index_rate=index_rate,
                        filter_radius=filter_radius,
                        rms_mix_rate=rms_mix_rate,
                        protect=protect,
                    )
                    executed_engine = "RVC"
                elif ENABLE_RVC_FALLBACK:
                    fallback_used = True
                    if not fallback_reason:
                        fallback_reason = "lhq_timeout" if policy == "LHQ_PILOT" else "selected_model"
                    _convert_with_low_cpu_timbre(
                        str(normalized_wav),
                        str(output_path),
                        pitch_shift=pitch_shift,
                        sample_rate=40000,
                    )
                    executed_engine = "RVC_FALLBACK"
                else:
                    raise RuntimeError(f"RVC unavailable: {rvc_detail}")

    except Exception as exc:
        _cleanup_paths(temp_dir)
        raise HTTPException(status_code=500, detail=f"RVC conversion failed: {exc}") from exc

    background_tasks.add_task(_cleanup_paths, temp_dir)
    safe_model = _safe_upload_name(model_name, "model")
    return FileResponse(
        str(output_path),
        media_type="audio/wav",
        filename=f"rvc_{safe_model}.wav",
        headers={
            "x-vf-engine-selected": selected_engine,
            "x-vf-engine-executed": executed_engine,
            "x-vf-rvc-preset": safe_preset,
            "x-vf-rvc-fallback": "1" if fallback_used else "0",
            "x-vf-rvc-fallback-reason": (fallback_reason or "")
            .replace("\r", " ")
            .replace("\n", " ")[:180],
            "x-vf-supports-one-shot-clone-at-decision": "1" if selected_engine != "LHQ_SVC" else "0",
        },
    )


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("VF_BACKEND_HOST", "127.0.0.1")
    port = int(os.getenv("VF_BACKEND_PORT", "7800"))
    uvicorn.run(app, host=host, port=port, reload=False)



