from __future__ import annotations

import base64
import csv
import gzip
import json
import hashlib
import hmac
import math
import mimetypes
import os
import calendar
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
import wave
from collections import defaultdict, deque
from io import BytesIO, StringIO
from pathlib import Path
from typing import Any, Optional, Dict, List
from urllib import error as urllib_error
from urllib.parse import urlparse
from urllib import request as urllib_request
from zoneinfo import ZoneInfo

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
    duplicate_key_memberships,
    flatten_pool_keys,
    list_pool_names as list_gemini_pool_names,
    load_pool_config as load_pool_config_shared,
    normalize_pool_config as normalize_gemini_pool_config,
    SOURCE_POLICY_PROVIDER_GEMINI_API,
    SOURCE_POLICY_PROVIDER_VERTEX,
    resolve_default_pool_hint as resolve_default_gemini_pool_hint,
    resolve_effective_keys as resolve_effective_pool_keys,
    resolve_plan_pool_hint as resolve_gemini_plan_pool_hint,
    save_pool_config as save_pool_config_shared,
    sync_authoritative_free_pool as sync_authoritative_free_pool_shared,
)
from shared.gemini_multi_speaker import normalize_multi_speaker_line_map as normalize_multi_speaker_line_map_shared
from services.admission.redis_limits import SuccessQuotaDecision, SuccessQuotaLimiter
from services.errors.codes import ENGINE_OVERLOADED, QUEUE_TIMEOUT, RATE_LIMIT_USER, extract_error_code
from services.queue.redis_queue import TtsJobQueue, normalize_lane

load_backend_env_files(Path(__file__).resolve())
ARTIFACTS_DIR = APP_ROOT / "artifacts"
OUTPUT_ROOT_DIR = Path(
    (os.getenv("VF_OUTPUT_DIR") or str(WORKSPACE_ROOT / "output")).strip()
    or str(WORKSPACE_ROOT / "output")
).resolve()
RUNTIME_LOG_DIR = PROJECT_ROOT / ".runtime" / "logs"
MODELS_DIR = Path(os.getenv("VF_LLVC_MODELS_DIR", str(APP_ROOT / "models" / "llvc"))).resolve()
LOCAL_MODEL_MIRROR_ROOT = Path(
    (os.getenv("VF_LOCAL_MODEL_MIRROR_DIR") or str(APP_ROOT / "models")).strip()
    or str(APP_ROOT / "models")
).resolve()
KOKORO_MODEL_REPO_ID = (os.getenv("VF_KOKORO_MODEL_REPO_ID") or "onnx-community/Kokoro-82M-v1.0-ONNX").strip() or "onnx-community/Kokoro-82M-v1.0-ONNX"
KOKORO_MODEL_REVISION = (os.getenv("VF_KOKORO_MODEL_REVISION") or "main").strip() or "main"
KOKORO_MODEL_MIRROR_DIR = (LOCAL_MODEL_MIRROR_ROOT / KOKORO_MODEL_REPO_ID).resolve()
KOKORO_MODEL_REQUIRED_FILES: tuple[str, ...] = (
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "onnx/model.onnx",
)
BOOTSTRAP_SCRIPT = PROJECT_ROOT / "scripts" / "bootstrap-services.mjs"
WHISPER_MODEL_SIZE = os.getenv("VF_WHISPER_MODEL", "small")
WHISPER_DEVICE = os.getenv("VF_WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE = os.getenv("VF_WHISPER_COMPUTE", "int8")
WHISPER_BEAM_SIZE = max(1, int((os.getenv("VF_WHISPER_BEAM_SIZE") or "5").strip() or "5"))
LLVC_DEVICE = os.getenv("VF_LLVC_DEVICE", "cpu:0")
ENABLE_LLVC_FALLBACK = (
    (os.getenv("VF_ENABLE_LLVC_FALLBACK") or "0").strip().lower()
    in {"1", "true", "yes", "on"}
)
LLVC_FALLBACK_MODEL_ID = "vf_low_cpu_timbre"
VOICE_CONVERSION_POLICIES = {"AUTO_RELIABLE", "LLVC_ONLY"}
SEPARATION_MODEL = (os.getenv("VF_SOURCE_SEPARATION_MODEL") or "htdemucs_ft").strip() or "htdemucs_ft"
SEPARATION_DEVICE = (os.getenv("VF_SOURCE_SEPARATION_DEVICE") or "cpu").strip() or "cpu"
SEPARATION_TIMEOUT_SEC = max(60, int((os.getenv("VF_SOURCE_SEPARATION_TIMEOUT_SEC") or "1200").strip() or "1200"))
SEPARATION_SAMPLE_RATE = max(16000, int((os.getenv("VF_SOURCE_SEPARATION_SAMPLE_RATE") or "44100").strip() or "44100"))
SEPARATION_CACHE_DIR = ARTIFACTS_DIR / "source-separation-cache"
VF_DUB_PIPELINE_VERSION = str(os.getenv("VF_DUB_PIPELINE_VERSION") or "2026.1").strip() or "2026.1"
VF_DUB_PHASE1_MODEL = str(os.getenv("VF_DUB_PHASE1_MODEL") or "BS-Roformer-Viperx-1297").strip() or "BS-Roformer-Viperx-1297"
VF_DUB_DEREVERB_MODEL = str(os.getenv("VF_DUB_DEREVERB_MODEL") or "uvr_deecho_dereverb").strip() or "uvr_deecho_dereverb"
VF_DUB_DIRECTOR_MODEL = str(os.getenv("VF_DUB_DIRECTOR_MODEL") or "gemini-3-flash").strip() or "gemini-3-flash"
VF_DUB_TTS_MODEL = str(os.getenv("VF_DUB_TTS_MODEL") or "gemini-2.5-flash-preview-tts").strip() or "gemini-2.5-flash-preview-tts"
VF_DUB_ALLOW_MODEL_FALLBACK = (
    (os.getenv("VF_DUB_ALLOW_MODEL_FALLBACK") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_DUB_ISOCHRONY_TOLERANCE_PCT = max(
    1.0,
    float((os.getenv("VF_DUB_ISOCHRONY_TOLERANCE_PCT") or "10").strip() or "10"),
)
VF_DUB_THINKING_LOW_SCENE_MAX_SPEAKERS = max(
    1,
    int((os.getenv("VF_DUB_THINKING_LOW_SCENE_MAX_SPEAKERS") or "1").strip() or "1"),
)
VF_DUB_LLVC_PRESET = str(os.getenv("VF_DUB_LLVC_PRESET") or "llvc_hq_cpu").strip() or "llvc_hq_cpu"
VF_DUB_WAV2LIP_ONNX_PATH = Path(
    str(
        os.getenv(
            "VF_DUB_WAV2LIP_ONNX_PATH",
            str(APP_ROOT / "models" / "video-pipeline" / "wav2lip" / "wav2lip.onnx"),
        )
    ).strip()
    or str(APP_ROOT / "models" / "video-pipeline" / "wav2lip" / "wav2lip.onnx")
).resolve()
VF_DUB_LPIPS_ASSET_PATH = Path(
    str(
        os.getenv(
            "VF_DUB_LPIPS_ASSET_PATH",
            str(APP_ROOT / "models" / "video-pipeline" / "lpips" / "lpips.onnx"),
        )
    ).strip()
    or str(APP_ROOT / "models" / "video-pipeline" / "lpips" / "lpips.onnx")
).resolve()
VF_DUB_STRICT_CORE_PHASES = (
    (os.getenv("VF_DUB_STRICT_CORE_PHASES") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VIDEO_PIPELINE_ASSET_SOURCE_MANIFEST = Path(
    str(
        os.getenv(
            "VF_VIDEO_PIPELINE_ASSET_SOURCE_MANIFEST",
            str(APP_ROOT / "config" / "video_pipeline_asset_sources.json"),
        )
    ).strip()
    or str(APP_ROOT / "config" / "video_pipeline_asset_sources.json")
).resolve()
VIDEO_PIPELINE_ASSET_DOWNLOAD_MANIFEST = Path(
    str(
        os.getenv(
            "VF_VIDEO_PIPELINE_ASSET_DOWNLOAD_MANIFEST",
            str(APP_ROOT / "data" / "video-pipeline-asset-download-manifest.json"),
        )
    ).strip()
    or str(APP_ROOT / "data" / "video-pipeline-asset-download-manifest.json")
).resolve()
TTS_LIVE_ARTIFACTS_DIR = OUTPUT_ROOT_DIR / "tts-live"
TTS_RESULT_ARTIFACTS_DIR = OUTPUT_ROOT_DIR / "tts-results"
DUBBING_OUTPUT_DIR = OUTPUT_ROOT_DIR / "dubbing"
DUBBING_LIVE_ARTIFACTS_DIR = OUTPUT_ROOT_DIR / "dubbing-live"
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
LLVC_RUNTIME_URL = (os.getenv("VF_LLVC_RUNTIME_URL") or "http://127.0.0.1:7830").strip().rstrip("/")
_raw_llvc_runtime_urls = [
    str(item or "").strip().rstrip("/")
    for item in str(os.getenv("VF_LLVC_RUNTIME_URLS") or "").split(",")
]
_raw_llvc_runtime_urls = [item for item in _raw_llvc_runtime_urls if item]
if not _raw_llvc_runtime_urls:
    _raw_llvc_runtime_urls = [LLVC_RUNTIME_URL]
VF_LLVC_RUNTIME_URLS: tuple[str, ...] = tuple(dict.fromkeys(_raw_llvc_runtime_urls))
GEMINI_RUNTIME_ADMIN_TOKEN = (os.getenv("GEMINI_RUNTIME_ADMIN_TOKEN") or "").strip()
VF_TTS_POST_LLVC_ENABLED = (
    (os.getenv("VF_TTS_POST_LLVC_ENABLED") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_TTS_POST_LLVC_REQUIRED = (
    (os.getenv("VF_TTS_POST_LLVC_REQUIRED") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_TTS_POST_LLVC_TIMEOUT_SEC = max(
    15,
    int((os.getenv("VF_TTS_POST_LLVC_TIMEOUT_SEC") or "180").strip() or "180"),
)
VF_TTS_POST_LLVC_PRESET = str(os.getenv("VF_TTS_POST_LLVC_PRESET") or "tts_realtime").strip() or "tts_realtime"
VF_LLVC_PRESET_DEFAULT = str(os.getenv("VF_LLVC_PRESET_DEFAULT") or "llvc_hq_cpu").strip() or "llvc_hq_cpu"
VF_LLVC_STREAM_DEFAULT = (
    (os.getenv("VF_LLVC_STREAM_DEFAULT") or "0").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_LLVC_CHUNK_FACTOR = max(1, int((os.getenv("VF_LLVC_CHUNK_FACTOR") or "2").strip() or "2"))
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
VF_TTS_LIVE_PIPELINE_ENABLED = (
    (os.getenv("VF_TTS_LIVE_PIPELINE_ENABLED") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_TTS_LIVE_SYNTH_CONCURRENCY = max(
    1,
    int((os.getenv("VF_TTS_LIVE_SYNTH_CONCURRENCY") or "2").strip() or "2"),
)
VF_TTS_LIVE_LLVC_CONCURRENCY = max(
    1,
    int((os.getenv("VF_TTS_LIVE_LLVC_CONCURRENCY") or "2").strip() or "2"),
)
VF_TTS_LIVE_LLVC_GLOBAL_CONCURRENCY = max(
    1,
    int((os.getenv("VF_TTS_LIVE_LLVC_GLOBAL_CONCURRENCY") or "2").strip() or "2"),
)
VF_TTS_LIVE_FIRST_CHUNK_CHARS = max(
    120,
    int((os.getenv("VF_TTS_LIVE_FIRST_CHUNK_CHARS") or "140").strip() or "140"),
)
VF_TTS_LIVE_FIRST_CHUNK_WORDS = max(
    24,
    int((os.getenv("VF_TTS_LIVE_FIRST_CHUNK_WORDS") or "28").strip() or "28"),
)
VF_DUB_LIVE_PLAY_ENABLED = (
    (os.getenv("VF_DUB_LIVE_PLAY_ENABLED") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_DUB_LIVE_CHUNK_LIMIT_DEFAULT = max(
    1,
    int((os.getenv("VF_DUB_LIVE_CHUNK_LIMIT_DEFAULT") or "2").strip() or "2"),
)
VF_DUB_LIVE_CHUNK_LIMIT_MAX = max(
    VF_DUB_LIVE_CHUNK_LIMIT_DEFAULT,
    int((os.getenv("VF_DUB_LIVE_CHUNK_LIMIT_MAX") or "8").strip() or "8"),
)
VF_DUB_LIVE_ARTIFACT_TTL_MS = max(
    60_000,
    int((os.getenv("VF_DUB_LIVE_ARTIFACT_TTL_MS") or "1800000").strip() or "1800000"),
)
VF_LLVC_MODEL_CACHE_TTL_MS = max(
    500,
    int((os.getenv("VF_LLVC_MODEL_CACHE_TTL_MS") or "5000").strip() or "5000"),
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
    (os.getenv("VF_AUTH_ENFORCE") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_ENV = str(os.getenv("VF_ENV") or os.getenv("ENV") or "").strip().lower()
VF_IS_PRODUCTION = VF_ENV in {"prod", "production"}
VF_DOCS_ENABLE = (
    (os.getenv("VF_DOCS_ENABLE") or ("0" if VF_IS_PRODUCTION else "1")).strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_DEV_BYPASS_UID = (os.getenv("VF_DEV_BYPASS_UID") or "dev_local_user").strip() or "dev_local_user"
FIREBASE_SERVICE_ACCOUNT_JSON = (os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON") or "").strip()
VF_FIRESTORE_ENABLE = (
    (os.getenv("VF_FIRESTORE_ENABLE") or ("0" if "pytest" in sys.modules else "1")).strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_USER_PROFILE_FALLBACK_FILE = Path(
    (os.getenv("VF_USER_PROFILE_FALLBACK_FILE") or str(ARTIFACTS_DIR / "user_profile_fallback.json")).strip()
    or str(ARTIFACTS_DIR / "user_profile_fallback.json")
).resolve()
VF_USER_PROFILE_FALLBACK_PERSIST = (
    (os.getenv("VF_USER_PROFILE_FALLBACK_PERSIST") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
STRIPE_SECRET_KEY = (os.getenv("STRIPE_SECRET_KEY") or "").strip()
STRIPE_WEBHOOK_SECRET = (os.getenv("STRIPE_WEBHOOK_SECRET") or "").strip()
STRIPE_PRICE_STARTER_MAX_INR = (os.getenv("STRIPE_PRICE_STARTER_MAX_INR") or "").strip()
STRIPE_PRICE_STARTER_RECURRING_INR = (os.getenv("STRIPE_PRICE_STARTER_RECURRING_INR") or "").strip()
STRIPE_PRICE_CREATOR_MAX_INR = (os.getenv("STRIPE_PRICE_CREATOR_MAX_INR") or "").strip()
STRIPE_PRICE_CREATOR_RECURRING_INR = (os.getenv("STRIPE_PRICE_CREATOR_RECURRING_INR") or "").strip()
STRIPE_PRICE_PRO_MAX_INR = (os.getenv("STRIPE_PRICE_PRO_MAX_INR") or "").strip()
STRIPE_PRICE_PRO_RECURRING_INR = (os.getenv("STRIPE_PRICE_PRO_RECURRING_INR") or "").strip()
STRIPE_PRICE_SCALE_MAX_INR = (os.getenv("STRIPE_PRICE_SCALE_MAX_INR") or "").strip()
STRIPE_PRICE_SCALE_RECURRING_INR = (os.getenv("STRIPE_PRICE_SCALE_RECURRING_INR") or "").strip()
STRIPE_PORTAL_RETURN_URL = (os.getenv("STRIPE_PORTAL_RETURN_URL") or "http://127.0.0.1:3000").strip()
STRIPE_CHECKOUT_SUCCESS_URL = (
    (os.getenv("STRIPE_CHECKOUT_SUCCESS_URL") or "http://127.0.0.1:3000?billing=success").strip()
)
STRIPE_CHECKOUT_CANCEL_URL = (
    (os.getenv("STRIPE_CHECKOUT_CANCEL_URL") or "http://127.0.0.1:3000?billing=cancel").strip()
)
_billing_redirect_allowlist_raw = str(os.getenv("VF_BILLING_REDIRECT_ALLOWLIST") or "").strip()
if _billing_redirect_allowlist_raw:
    _billing_redirect_allowlist_seed = [
        item.strip()
        for item in _billing_redirect_allowlist_raw.split(",")
        if item.strip()
    ]
else:
    _billing_redirect_allowlist_seed = [
        STRIPE_CHECKOUT_SUCCESS_URL,
        STRIPE_CHECKOUT_CANCEL_URL,
        STRIPE_PORTAL_RETURN_URL,
    ]
VF_BILLING_REDIRECT_ALLOWLIST: frozenset[str] = frozenset(
    {
        f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"
        for parsed in [urlparse(item) for item in _billing_redirect_allowlist_seed]
        if parsed.scheme and parsed.netloc
    }
)
VF_STRIPE_WEBHOOK_ALLOW_UNSIGNED = (
    (os.getenv("VF_STRIPE_WEBHOOK_ALLOW_UNSIGNED") or ("0" if VF_IS_PRODUCTION else "1")).strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_DAILY_GENERATION_LIMIT = max(1, int((os.getenv("VF_DAILY_GENERATION_LIMIT") or "30").strip() or "30"))
ENGINE_TIER_REGISTRY: dict[str, dict[str, Any]] = {
    "KOKORO": {"label": "BASIC", "rate": 0.7},
    "GOOD": {"label": "GOOD", "rate": 1.0},
    "NEURAL2": {"label": "HD", "rate": 1.2},
    "GEM": {"label": "PRIME", "rate": 1.5},
}
VF_ENGINE_RATES = {
    engine: max(0.0, float(meta.get("rate") or 0.0)) or 1.0
    for engine, meta in ENGINE_TIER_REGISTRY.items()
}
TTS_ENGINE_KEYS: tuple[str, ...] = tuple(VF_ENGINE_RATES.keys())
GEM_RUNTIME_ENGINE_KEYS = frozenset({"GEM", "GOOD", "NEURAL2"})
FREE_TIER_ALLOWED_VOICE_IDS: dict[str, tuple[str, ...]] = {
    "GEM": ("v2", "v4", "v6", "v8", "v10", "v1", "v3", "v5", "v7", "v9"),
    "GOOD": ("v2", "v4", "v6", "v8", "v10", "v1", "v3", "v5", "v7", "v9"),
    "NEURAL2": ("v2", "v4", "v6", "v8", "v10", "v1", "v3", "v5", "v7", "v9"),
    "KOKORO": (
        "af_heart",
        "af_bella",
        "af_nova",
        "af_sarah",
        "bf_emma",
        "bf_isabella",
        "am_fenrir",
        "am_michael",
        "am_onyx",
        "bm_george",
    ),
}
PLAN_LIMITS: dict[str, dict[str, Any]] = {
    "free": {"plan": "Free", "monthlyVfLimit": 10000, "dailyGenerationLimit": VF_DAILY_GENERATION_LIMIT},
    "starter": {"plan": "Starter", "monthlyVfLimit": 50000, "dailyGenerationLimit": VF_DAILY_GENERATION_LIMIT},
    "creator": {"plan": "Creator", "monthlyVfLimit": 150000, "dailyGenerationLimit": VF_DAILY_GENERATION_LIMIT},
    "pro": {"plan": "Pro", "monthlyVfLimit": 300000, "dailyGenerationLimit": VF_DAILY_GENERATION_LIMIT},
    "scale": {"plan": "Scale", "monthlyVfLimit": 600000, "dailyGenerationLimit": VF_DAILY_GENERATION_LIMIT},
}
PAID_PLAN_KEYS: tuple[str, ...] = ("starter", "creator", "pro", "scale")
PLAN_PRICE_POLICY: dict[str, dict[str, int]] = {
    "starter": {"firstCycleInr": 450, "recurringInr": 405},
    "creator": {"firstCycleInr": 1200, "recurringInr": 1080},
    "pro": {"firstCycleInr": 2400, "recurringInr": 2160},
    "scale": {"firstCycleInr": 4300, "recurringInr": 3440},
}
PLAN_FEATURE_FLAGS: dict[str, dict[str, Any]] = {
    "free": {"allowedEngines": ("KOKORO", "GOOD", "NEURAL2"), "earlyAccess": False},
    "starter": {"allowedEngines": tuple(TTS_ENGINE_KEYS), "earlyAccess": False},
    "creator": {"allowedEngines": tuple(TTS_ENGINE_KEYS), "earlyAccess": False},
    "pro": {"allowedEngines": tuple(TTS_ENGINE_KEYS), "earlyAccess": False},
    "scale": {"allowedEngines": tuple(TTS_ENGINE_KEYS), "earlyAccess": True},
}
PLAN_KEY_ALIASES: dict[str, str] = {
    "free": "free",
    "starter": "starter",
    "creator": "creator",
    "pro": "pro",
    "scale": "scale",
    "plus": "scale",
    "pro_plus": "scale",
    "pro-plus": "scale",
    "proplus": "scale",
}
TTS_PLAN_GUARDRAILS: dict[str, dict[str, int]] = {
    "free": {"rpm": 2, "maxChars": 8000},
    "starter": {"rpm": 5, "maxChars": 10000},
    "creator": {"rpm": 5, "maxChars": 10000},
    "pro": {"rpm": 10, "maxChars": 10000},
    "scale": {"rpm": 10, "maxChars": 15000},
}
TTS_PLAN_BURST_WINDOW_SECONDS = 60
VF_TTS_SUCCESS_LIMIT_FREE = max(
    1,
    int((os.getenv("VF_TTS_SUCCESS_LIMIT_FREE") or str(TTS_PLAN_GUARDRAILS["free"]["rpm"])).strip() or "2"),
)
VF_TTS_SUCCESS_LIMIT_STARTER = max(
    1,
    int((os.getenv("VF_TTS_SUCCESS_LIMIT_STARTER") or str(TTS_PLAN_GUARDRAILS["starter"]["rpm"])).strip() or "5"),
)
VF_TTS_SUCCESS_LIMIT_CREATOR = max(
    1,
    int((os.getenv("VF_TTS_SUCCESS_LIMIT_CREATOR") or str(TTS_PLAN_GUARDRAILS["creator"]["rpm"])).strip() or "5"),
)
VF_TTS_SUCCESS_LIMIT_PRO = max(
    1,
    int((os.getenv("VF_TTS_SUCCESS_LIMIT_PRO") or str(TTS_PLAN_GUARDRAILS["pro"]["rpm"])).strip() or "5"),
)
VF_TTS_SUCCESS_LIMIT_SCALE = max(
    1,
    int((os.getenv("VF_TTS_SUCCESS_LIMIT_SCALE") or str(TTS_PLAN_GUARDRAILS["scale"]["rpm"])).strip() or "10"),
)
TTS_SUCCESS_PLAN_LIMITS: dict[str, int] = {
    "free": VF_TTS_SUCCESS_LIMIT_FREE,
    "starter": VF_TTS_SUCCESS_LIMIT_STARTER,
    "creator": VF_TTS_SUCCESS_LIMIT_CREATOR,
    "pro": VF_TTS_SUCCESS_LIMIT_PRO,
    "scale": VF_TTS_SUCCESS_LIMIT_SCALE,
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
TOKEN_PACK_CATALOG: dict[str, dict[str, int]] = {
    "micro": {"vf": 50000, "priceInr": 550},
    "standard": {"vf": 150000, "priceInr": 1450},
    "mega": {"vf": 300000, "priceInr": 2900},
    "ultra": {"vf": 600000, "priceInr": 5200},
}
TOKEN_PACK_SCALE_DISCOUNT_PCT = 20
# Deprecated env compatibility values (legacy one-pack flow).
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
GEMINI_VERTEX_SECRET_DIR = (PROJECT_ROOT / ".runtime" / "secrets" / "gemini").resolve()
GEMINI_VERTEX_SERVICE_ACCOUNT_FILE = str(
    os.getenv("VF_GEMINI_VERTEX_SERVICE_ACCOUNT_FILE")
    or (GEMINI_VERTEX_SECRET_DIR / "vertex-service-account.json")
).strip()
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
OUTPUT_ROOT_DIR.mkdir(parents=True, exist_ok=True)
MODELS_DIR.mkdir(parents=True, exist_ok=True)
SEPARATION_CACHE_DIR.mkdir(parents=True, exist_ok=True)
TTS_LIVE_ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
TTS_RESULT_ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
DUBBING_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
DUBBING_LIVE_ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)


TTS_ENGINE_HEALTH_URLS = {
    "GEM": "http://127.0.0.1:7810/health",
    "GOOD": "http://127.0.0.1:7810/health",
    "NEURAL2": "http://127.0.0.1:7810/health",
    "KOKORO": "http://127.0.0.1:7820/health",
}
TTS_ENGINE_CAPABILITIES_URLS = {
    engine: health_url.rsplit("/health", 1)[0] + "/v1/capabilities"
    for engine, health_url in TTS_ENGINE_HEALTH_URLS.items()
}
DUBBING_PREPARE_ENGINE_WAIT_MS = {
    "GEM": max(5_000, int((os.getenv("VF_DUBBING_PREPARE_WAIT_GEM_MS") or "20000").strip() or "20000")),
    "GOOD": max(5_000, int((os.getenv("VF_DUBBING_PREPARE_WAIT_GEM_MS") or "20000").strip() or "20000")),
    "NEURAL2": max(5_000, int((os.getenv("VF_DUBBING_PREPARE_WAIT_GEM_MS") or "20000").strip() or "20000")),
    "KOKORO": max(5_000, int((os.getenv("VF_DUBBING_PREPARE_WAIT_KOKORO_MS") or "90000").strip() or "90000")),
}
DUBBING_PREPARE_POLL_INTERVAL_MS = max(
    250,
    int((os.getenv("VF_DUBBING_PREPARE_POLL_INTERVAL_MS") or "1200").strip() or "1200"),
)
TTS_ENGINE_ALIASES = {
    "GEM": "GEM",
    "GEMINI": "GEM",
    "GOOD": "GOOD",
    "GOOD_RUNTIME": "GOOD",
    "GEMINI_2_5_LITE_TTS": "GOOD",
    "NEURAL2": "NEURAL2",
    "NEURAL_2": "NEURAL2",
    "NURAL2": "NEURAL2",
    "NURAL_2": "NEURAL2",
    "KOKORO": "KOKORO",
}
ENGINE_DISPLAY_NAMES = {
    engine: str(meta.get("label") or engine).strip().upper() or engine
    for engine, meta in ENGINE_TIER_REGISTRY.items()
}
CONVERSION_POLICY_DISPLAY_NAMES = {
    "AUTO_RELIABLE": "AUTO_RELIABLE",
    "LLVC_ONLY": "LLVC_ONLY",
}
EXECUTED_ENGINE_DISPLAY_NAMES = {
    **ENGINE_DISPLAY_NAMES,
    "LLVC_FALLBACK": "LLVC Fallback",
    "LLVC": "LLVC",
}

RUNTIME_LOG_FILES = {
    "media-backend": RUNTIME_LOG_DIR / "media-backend.log",
    "gemini-runtime": RUNTIME_LOG_DIR / "gemini-runtime.log",
    "kokoro-runtime": RUNTIME_LOG_DIR / "kokoro-runtime.log",
    "llvc-runtime": RUNTIME_LOG_DIR / "llvc-runtime.log",
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
    "llvc": "llvc-runtime",
    "llvc-runtime": "llvc-runtime",
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
VF_SERVICE_ROLE = str(os.getenv("VF_SERVICE_ROLE") or "all").strip().lower()
if VF_SERVICE_ROLE not in {"api", "worker", "all"}:
    VF_SERVICE_ROLE = "all"
VF_SERVICE_IS_API = VF_SERVICE_ROLE in {"api", "all"}
VF_SERVICE_IS_WORKER = VF_SERVICE_ROLE in {"worker", "all"}
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
VF_TTS_QUEUE_RESULT_TTL_MS = max(
    5_000,
    int((os.getenv("VF_TTS_QUEUE_RESULT_TTL_MS") or "900000").strip() or "900000"),
)
VF_TTS_JOB_INLINE_RESULT_MAX_BYTES = max(
    64_000,
    int((os.getenv("VF_TTS_JOB_INLINE_RESULT_MAX_BYTES") or "1048576").strip() or "1048576"),
)
VF_TTS_QUEUE_MAX_ATTEMPTS = max(
    1,
    int((os.getenv("VF_TTS_QUEUE_MAX_ATTEMPTS") or "4").strip() or "4"),
)
VF_TTS_QUEUE_BACKOFF_BASE_MS = max(
    100,
    int((os.getenv("VF_TTS_QUEUE_BACKOFF_BASE_MS") or "450").strip() or "450"),
)
_vf_tts_worker_count_raw = str(os.getenv("VF_TTS_QUEUE_WORKER_COUNT") or "").strip()
if _vf_tts_worker_count_raw:
    _vf_tts_worker_count = int(_vf_tts_worker_count_raw or "0")
else:
    _vf_tts_worker_count = 4 if VF_SERVICE_IS_WORKER else 0
VF_TTS_QUEUE_WORKER_COUNT = max(0, int(_vf_tts_worker_count))
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
VF_TTS_RUNTIME_TIMEOUT_SEC = max(
    10,
    int((os.getenv("VF_TTS_RUNTIME_TIMEOUT_SEC") or "240").strip() or "240"),
)
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
VF_ADMIN_UNLOCK_TTL_SECONDS = max(
    60,
    int((os.getenv("VF_ADMIN_UNLOCK_TTL_SECONDS") or "900").strip() or "900"),
)
VF_ADMIN_UNLOCK_KEY_TTL_SECONDS = max(
    60,
    int((os.getenv("VF_ADMIN_UNLOCK_KEY_TTL_SECONDS") or str(VF_ADMIN_UNLOCK_TTL_SECONDS)).strip() or str(VF_ADMIN_UNLOCK_TTL_SECONDS)),
)
VF_ADMIN_UNLOCK_MAX_ATTEMPTS = max(
    1,
    int((os.getenv("VF_ADMIN_UNLOCK_MAX_ATTEMPTS") or "5").strip() or "5"),
)
VF_ADMIN_UNLOCK_LOCKOUT_SECONDS = max(
    30,
    int((os.getenv("VF_ADMIN_UNLOCK_LOCKOUT_SECONDS") or "300").strip() or "300"),
)
VF_ADMIN_UNLOCK_SIGNING_SECRET = (
    str(os.getenv("VF_ADMIN_UNLOCK_SIGNING_SECRET") or "").strip()
    or str(VF_ADMIN_APPROVAL_TOKEN or "").strip()
    or secrets.token_hex(32)
)
VF_GEMINI_SINGLE_POOL_ENFORCE = (
    (os.getenv("VF_GEMINI_SINGLE_POOL_ENFORCE") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_ADMIN_COUPON_LIMIT_BYPASS = (
    (os.getenv("VF_ADMIN_COUPON_LIMIT_BYPASS") or "0").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_RBAC_ENABLED = (
    (os.getenv("VF_RBAC_ENABLED") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_RBAC_ENFORCE = (
    (os.getenv("VF_RBAC_ENFORCE") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_AUDIT_LEDGER_ENABLED = (
    (os.getenv("VF_AUDIT_LEDGER_ENABLED") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_ALERT_ENGINE_ENABLED = (
    (os.getenv("VF_ALERT_ENGINE_ENABLED") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_SCHEDULER_ENABLED = (
    (os.getenv("VF_SCHEDULER_ENABLED") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_ANALYTICS_V2_ENABLED = (
    (os.getenv("VF_ANALYTICS_V2_ENABLED") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_USER_ID_REQUIRED = (
    (os.getenv("VF_USER_ID_REQUIRED") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_TEAMS_ENABLED = (
    (os.getenv("VF_TEAMS_ENABLED") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_SUPPORT_INBOX_ENABLED = (
    (os.getenv("VF_SUPPORT_INBOX_ENABLED") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_SUPPORT_AI_ENABLED = (
    (os.getenv("VF_SUPPORT_AI_ENABLED") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_SUPPORT_AI_AUTOREPLY_ENABLED = (
    (os.getenv("VF_SUPPORT_AI_AUTOREPLY_ENABLED") or "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
VF_SUPPORT_AI_CONFIDENCE_THRESHOLD = max(
    0.0,
    min(1.0, float((os.getenv("VF_SUPPORT_AI_CONFIDENCE_THRESHOLD") or "0.78").strip() or "0.78")),
)
VF_SCHEDULER_LOCK_TTL_SECONDS = max(
    10,
    int((os.getenv("VF_SCHEDULER_LOCK_TTL_SECONDS") or "45").strip() or "45"),
)
VF_SCHEDULER_TICK_SECONDS = max(
    3,
    int((os.getenv("VF_SCHEDULER_TICK_SECONDS") or "10").strip() or "10"),
)
VF_ALERT_EVAL_INTERVAL_SECONDS = max(
    20,
    int((os.getenv("VF_ALERT_EVAL_INTERVAL_SECONDS") or "60").strip() or "60"),
)
BILLING_PROVIDER_STRIPE = "stripe"
ACTIVE_BILLING_PROVIDER = BILLING_PROVIDER_STRIPE
RBAC_ROLE_SUPER_ADMIN = "super_admin"
RBAC_ROLE_BILLING_OPS = "billing_ops"
RBAC_ROLE_SUPPORT_OPS = "support_ops"
RBAC_ROLE_READ_ONLY_OPS = "read_only_ops"
RBAC_ROLES = {
    RBAC_ROLE_SUPER_ADMIN,
    RBAC_ROLE_BILLING_OPS,
    RBAC_ROLE_SUPPORT_OPS,
    RBAC_ROLE_READ_ONLY_OPS,
}
PERM_USERS_READ = "users.read"
PERM_USERS_WRITE = "users.write"
PERM_COUPONS_READ = "coupons.read"
PERM_COUPONS_WRITE = "coupons.write"
PERM_BILLING_READ = "billing.read"
PERM_BILLING_WRITE = "billing.write"
PERM_OPS_READ = "ops.read"
PERM_OPS_MUTATE = "ops.mutate"
PERM_GUARDIAN_READ = "guardian.read"
PERM_GUARDIAN_MUTATE = "guardian.mutate"
PERM_ANALYTICS_READ = "analytics.read"
PERM_AUDIT_READ = "audit.read"
PERM_ALERTS_READ = "alerts.read"
PERM_ALERTS_WRITE = "alerts.write"
PERM_SCHEDULER_READ = "scheduler.read"
PERM_SCHEDULER_WRITE = "scheduler.write"
PERM_RBAC_READ = "rbac.read"
PERM_RBAC_WRITE = "rbac.write"
PERM_TEAMS_READ = "teams.read"
PERM_TEAMS_WRITE = "teams.write"
PERM_SUPPORT_READ = "support.read"
PERM_SUPPORT_REPLY = "support.reply"
PERM_SUPPORT_AI_REVIEW = "support.ai.review"
PERM_SUPPORT_AI_CONFIG = "support.ai.config"
RBAC_PERMISSIONS = {
    PERM_USERS_READ,
    PERM_USERS_WRITE,
    PERM_COUPONS_READ,
    PERM_COUPONS_WRITE,
    PERM_BILLING_READ,
    PERM_BILLING_WRITE,
    PERM_OPS_READ,
    PERM_OPS_MUTATE,
    PERM_GUARDIAN_READ,
    PERM_GUARDIAN_MUTATE,
    PERM_ANALYTICS_READ,
    PERM_AUDIT_READ,
    PERM_ALERTS_READ,
    PERM_ALERTS_WRITE,
    PERM_SCHEDULER_READ,
    PERM_SCHEDULER_WRITE,
    PERM_RBAC_READ,
    PERM_RBAC_WRITE,
    PERM_TEAMS_READ,
    PERM_TEAMS_WRITE,
    PERM_SUPPORT_READ,
    PERM_SUPPORT_REPLY,
    PERM_SUPPORT_AI_REVIEW,
    PERM_SUPPORT_AI_CONFIG,
}
RBAC_ROLE_PERMISSION_MAP: dict[str, set[str]] = {
    RBAC_ROLE_SUPER_ADMIN: set(RBAC_PERMISSIONS),
    RBAC_ROLE_BILLING_OPS: {
        PERM_COUPONS_READ,
        PERM_COUPONS_WRITE,
        PERM_BILLING_READ,
        PERM_BILLING_WRITE,
        PERM_ANALYTICS_READ,
        PERM_AUDIT_READ,
        PERM_ALERTS_READ,
        PERM_TEAMS_READ,
        PERM_SUPPORT_READ,
    },
    RBAC_ROLE_SUPPORT_OPS: {
        PERM_USERS_READ,
        PERM_USERS_WRITE,
        PERM_COUPONS_READ,
        PERM_BILLING_READ,
        PERM_OPS_READ,
        PERM_GUARDIAN_READ,
        PERM_ANALYTICS_READ,
        PERM_AUDIT_READ,
        PERM_ALERTS_READ,
        PERM_TEAMS_READ,
        PERM_TEAMS_WRITE,
        PERM_SUPPORT_READ,
        PERM_SUPPORT_REPLY,
        PERM_SUPPORT_AI_REVIEW,
    },
    RBAC_ROLE_READ_ONLY_OPS: {perm for perm in RBAC_PERMISSIONS if perm.endswith(".read")},
}
ADMIN_ROLES_COLLECTION = "admin_roles"
AUDIT_LEDGER_COLLECTION = "admin_audit_ledger"
AUDIT_LEDGER_STATE_COLLECTION = "admin_audit_state"
ALERT_POLICIES_COLLECTION = "ops_alert_policies"
ALERT_DESTINATIONS_COLLECTION = "ops_alert_destinations"
ALERT_EVENTS_COLLECTION = "ops_alert_events"
SCHEDULER_TASKS_COLLECTION = "ops_scheduled_tasks"
SCHEDULER_RUNS_COLLECTION = "ops_task_runs"
SCHEDULER_LOCK_COLLECTION = "ops_scheduler_lock"
COUPON_ANALYTICS_DAILY_COLLECTION = "coupon_analytics_daily"
COUPON_SUBSCRIPTION_ATTRIBUTIONS_COLLECTION = "coupon_subscription_attributions"
USER_PROFILES_COLLECTION = "user_profiles"
USER_ID_INDEX_COLLECTION = "user_id_index"
TEAMS_COLLECTION = "teams"
TEAM_MEMBERS_COLLECTION = "team_members"
TEAM_INVITES_COLLECTION = "team_invites"
SUPPORT_CONVERSATIONS_COLLECTION = "support_conversations"
SUPPORT_MESSAGES_COLLECTION = "support_messages"
SUPPORT_AI_RUNS_COLLECTION = "support_ai_runs"
SUPPORT_AI_POLICY_COLLECTION = "support_ai_policy"
ADMIN_SESSION_UNLOCK_COLLECTION = "admin_session_unlock"
AUDIT_HASH_ALGO = "sha256"
AUDIT_GENESIS_HASH = "GENESIS"
ALERT_OPERATORS = {"gt", "gte", "lt", "lte", "eq", "neq"}
ALERT_STATUSES = {"open", "ack", "resolved"}
SCHEDULER_TASK_TYPES = {
    "usage_reset_daily",
    "guardian_scan",
    "usage_export_daily",
    "coupon_abuse_scan",
}
SCHEDULER_CONCURRENCY_POLICIES = {"forbid", "replace", "allow"}
TEAM_MEMBER_ROLES = {"owner", "admin", "member", "viewer"}
SUPPORT_CONVERSATION_STATUSES = {"open", "ai_answered", "needs_human", "resolved"}
SUPPORT_PRIORITIES = {"green", "yellow", "red"}
USER_ID_HANDLE_PATTERN = re.compile(r"^[a-z0-9_]{4,24}$")
USER_ID_RESERVED_WORDS = frozenset(
    {
        "admin",
        "root",
        "support",
        "system",
        "help",
        "api",
        "billing",
        "owner",
        "team",
        "teams",
        "ops",
        "voiceflow",
        "null",
        "undefined",
        "me",
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


def _is_gem_runtime_engine(engine: str) -> bool:
    return str(engine or "").strip().upper() in GEM_RUNTIME_ENGINE_KEYS


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


CORS_ALLOWED_METHODS = "DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT"


def _resolved_cors_origins() -> list[str]:
    return _parse_cors_origins("VF_CORS_ORIGINS", DEFAULT_CORS_ORIGINS)


def _is_cors_origin_allowed(origin: str) -> bool:
    safe_origin = str(origin or "").strip()
    if not safe_origin:
        return False
    allowed_origins = _resolved_cors_origins()
    if "*" in allowed_origins:
        return True
    return safe_origin in allowed_origins


def _is_cors_preflight_request(request: Request) -> bool:
    if str(request.method or "").strip().upper() != "OPTIONS":
        return False
    origin = str(request.headers.get("Origin") or "").strip()
    requested_method = str(request.headers.get("Access-Control-Request-Method") or "").strip()
    return bool(origin and requested_method)


def _cors_headers_for_request(request: Request, include_preflight: bool = False) -> dict[str, str]:
    origin = str(request.headers.get("Origin") or "").strip()
    if not _is_cors_origin_allowed(origin):
        return {}
    headers = {
        "Access-Control-Allow-Origin": origin,
        "Vary": "Origin",
    }
    if include_preflight:
        requested_headers = str(request.headers.get("Access-Control-Request-Headers") or "").strip()
        headers["Access-Control-Allow-Methods"] = CORS_ALLOWED_METHODS
        headers["Access-Control-Allow-Headers"] = requested_headers or "*"
        headers["Access-Control-Max-Age"] = "600"
    return headers


def _apply_cors_headers(response: Response, request: Request, include_preflight: bool = False) -> Response:
    for key, value in _cors_headers_for_request(request, include_preflight).items():
        response.headers[key] = value
    return response


def _cors_json_response(request: Request, *, status_code: int, content: dict[str, Any]) -> JSONResponse:
    response = JSONResponse(status_code=status_code, content=content)
    return _apply_cors_headers(response, request)


def _cors_preflight_response(request: Request) -> Response:
    response = Response(status_code=200)
    return _apply_cors_headers(response, request, include_preflight=True)


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


async def _write_upload_file_chunked(
    upload: UploadFile,
    destination: Path,
    *,
    max_bytes: Optional[int] = None,
    chunk_size: int = 1_048_576,
) -> int:
    destination.parent.mkdir(parents=True, exist_ok=True)
    total_bytes = 0
    safe_limit = int(max_bytes) if max_bytes is not None else None
    safe_chunk_size = max(64 * 1024, int(chunk_size))
    with destination.open("wb") as handle:
        while True:
            chunk = await upload.read(safe_chunk_size)
            if not chunk:
                break
            total_bytes += len(chunk)
            if safe_limit is not None and total_bytes > safe_limit:
                raise HTTPException(
                    status_code=413,
                    detail=f"Uploaded file is too large. Maximum {safe_limit} bytes.",
                )
            handle.write(chunk)
    try:
        await upload.close()
    except Exception:
        pass
    return total_bytes


_VOICE_PROFILE_BANK_CACHE: dict[str, Any] = {"mtime": 0.0, "payload": {}}
_VOICE_ID_MAP_CACHE: dict[str, Any] = {"mtime": 0.0, "payload": {}}
_LLVC_MODEL_CACHE_LOCK = threading.Lock()
_LLVC_MODEL_CACHE: dict[str, Any] = {
    "updatedAtMs": 0,
    "models": [],
    "fallbackAvailable": bool(ENABLE_LLVC_FALLBACK),
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
                "llvcModelName": str(row.get("llvcModelName") or "").strip(),
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


def _normalize_voice_lookup_token(value: str) -> str:
    token = str(value or "").strip().strip("\"'`").lower()
    if not token:
        return ""
    token = re.sub(r"[\s\-_]+", "", token)
    token = re.sub(r"[^a-z0-9]+", "", token)
    return token


def _voice_lookup_candidates(value: str) -> list[str]:
    raw = str(value or "").strip()
    if not raw:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for candidate in (raw, raw.lower(), raw.strip("\"'`"), raw.strip("\"'`").lower()):
        safe = str(candidate or "").strip()
        if safe and safe not in seen:
            out.append(safe)
            seen.add(safe)
    normalized = _normalize_voice_lookup_token(raw)
    if normalized and normalized not in seen:
        out.append(normalized)
    return out


def _next_llvc_runtime_url() -> str:
    if not VF_LLVC_RUNTIME_URLS:
        return LLVC_RUNTIME_URL
    if len(VF_LLVC_RUNTIME_URLS) == 1:
        return VF_LLVC_RUNTIME_URLS[0]
    global _LLVC_RUNTIME_POOL_CURSOR
    with _LLVC_RUNTIME_POOL_LOCK:
        index = int(_LLVC_RUNTIME_POOL_CURSOR % len(VF_LLVC_RUNTIME_URLS))
        _LLVC_RUNTIME_POOL_CURSOR += 1
    return VF_LLVC_RUNTIME_URLS[index]


def _resolve_gem_runtime_voice_name(value: str, fallback: str = "Fenrir") -> str:
    token = str(value or "").strip()
    if not token:
        return str(fallback or "Fenrir").strip() or "Fenrir"
    mapping = _load_voice_id_map()
    engines = mapping.get("engines") if isinstance(mapping.get("engines"), dict) else {}
    gem_payload = engines.get("GEM") if isinstance(engines.get("GEM"), dict) else {}
    runtime_voices = gem_payload.get("runtimeVoices") if isinstance(gem_payload.get("runtimeVoices"), list) else []
    normalized_targets = set(_voice_lookup_candidates(token))
    normalized_targets.add(token.lower())
    for item in runtime_voices:
        if not isinstance(item, dict):
            continue
        voice_id = str(item.get("voice_id") or item.get("id") or "").strip()
        voice_name = str(item.get("voice") or item.get("runtimeVoice") or "").strip()
        display_name = str(item.get("name") or "").strip()
        candidates: set[str] = set()
        for part in (voice_id, voice_name, display_name):
            candidates.update(_voice_lookup_candidates(part))
            if part:
                candidates.add(part.lower())
        if normalized_targets.intersection(candidates):
            return voice_name or token
    return token


def _plan_allowed_voice_tokens(engine: str, plan_key: str) -> tuple[set[str], str]:
    normalized_plan = str(plan_key or "").strip().lower()
    if normalized_plan != "free":
        return set(), ""
    normalized_engine = _normalize_engine_name(engine)
    allowlist = list(FREE_TIER_ALLOWED_VOICE_IDS.get(normalized_engine) or [])
    if not allowlist:
        return set(), ""
    default_token = str(allowlist[0] or "").strip()
    tokens: set[str] = set()
    for token in allowlist:
        raw_token = str(token or "").strip()
        if not raw_token:
            continue
        for candidate in _voice_lookup_candidates(raw_token):
            tokens.add(candidate.lower())
        if _is_gem_runtime_engine(normalized_engine):
            resolved = _resolve_gem_runtime_voice_name(raw_token, fallback=raw_token)
            if resolved:
                for candidate in _voice_lookup_candidates(str(resolved).strip()):
                    tokens.add(candidate.lower())
    return tokens, default_token


def _sanitize_tts_voice_selection_for_plan(
    *,
    engine: str,
    plan_key: str,
    voice_id: str,
    voice_name: str,
) -> tuple[str, str, bool]:
    normalized_engine = _normalize_engine_name(engine)
    raw_voice_id = str(voice_id or "").strip()
    raw_voice_name = str(voice_name or "").strip()
    requested_token = raw_voice_name or raw_voice_id
    allow_tokens, fallback_token = _plan_allowed_voice_tokens(normalized_engine, plan_key)
    gated = False

    if allow_tokens and requested_token:
        requested_candidates = {item.lower() for item in _voice_lookup_candidates(requested_token)}
        if not requested_candidates.intersection(allow_tokens):
            gated = True
            requested_token = fallback_token
    elif allow_tokens and not requested_token:
        gated = True
        requested_token = fallback_token

    if _is_gem_runtime_engine(normalized_engine):
        resolved = _resolve_gem_runtime_voice_name(requested_token, fallback="Fenrir")
        return resolved, resolved, gated

    if normalized_engine == "KOKORO":
        resolved = requested_token or fallback_token or "hf_alpha"
        return resolved, raw_voice_name or resolved, gated

    resolved = requested_token or raw_voice_id or raw_voice_name
    return resolved, raw_voice_name or resolved, gated


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


def _resolve_voice_access_tier(engine: str, voice_id: str) -> str:
    normalized_engine = _normalize_engine_name(engine)
    allow_tokens, _ = _plan_allowed_voice_tokens(normalized_engine, "free")
    if not allow_tokens:
        return "pro"
    voice_candidates = {item.lower() for item in _voice_lookup_candidates(voice_id)}
    if voice_candidates.intersection(allow_tokens):
        return "free"
    return "pro"


def _annotate_voice_access_fields(engine: str, entry: dict[str, Any]) -> dict[str, Any]:
    out = dict(entry)
    voice_id = str(out.get("voice_id") or out.get("voiceId") or out.get("id") or "").strip()
    access_tier = _resolve_voice_access_tier(engine, voice_id)
    out["access_tier"] = access_tier
    out["is_plan_restricted"] = access_tier != "free"
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
    mapping_engine = "GEM" if _is_gem_runtime_engine(safe_engine) else safe_engine
    engine_payload = engines.get(mapping_engine) if isinstance(engines.get(mapping_engine), dict) else {}
    voice_to_profile = engine_payload.get("voiceToProfile") if isinstance(engine_payload.get("voiceToProfile"), dict) else {}
    raw_voice_id = str(voice_id or "").strip()
    raw_voice_name = str(voice_name or "").strip()
    canonical_gem_voice = ""
    if _is_gem_runtime_engine(safe_engine):
        canonical_gem_voice = _resolve_gem_runtime_voice_name(raw_voice_name or raw_voice_id, fallback="")
    candidates: list[str] = []
    seen_candidates: set[str] = set()
    for token in (raw_voice_id, raw_voice_name, canonical_gem_voice):
        for candidate in _voice_lookup_candidates(token):
            if not candidate or candidate in seen_candidates:
                continue
            seen_candidates.add(candidate)
            candidates.append(candidate)
    profile_id = ""
    normalized_index: dict[str, str] = {}
    for raw_key, raw_value in voice_to_profile.items():
        candidate_key = str(raw_key or "").strip()
        if not candidate_key:
            continue
        normalized_key = _normalize_voice_lookup_token(candidate_key)
        safe_profile_id = str(raw_value or "").strip()
        if normalized_key and safe_profile_id and normalized_key not in normalized_index:
            normalized_index[normalized_key] = safe_profile_id
    for candidate in candidates:
        mapped = str(voice_to_profile.get(candidate) or "").strip()
        if not mapped:
            mapped = str(voice_to_profile.get(candidate.lower()) or "").strip()
        if not mapped:
            mapped = str(normalized_index.get(_normalize_voice_lookup_token(candidate)) or "").strip()
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
    mapped_model_name = str(profile.get("llvcModelName") or "").strip() or profile_id or ""
    resolved_model_name = _resolve_llvc_model_name_for_runtime(mapped_model_name)
    if not resolved_model_name:
        return None, profile_id
    return resolved_model_name, profile_id


def _post_tts_llvc_pitch_shift_for_profile(profile: Optional[dict[str, Any]]) -> int:
    if not isinstance(profile, dict):
        return 0
    age_group = str(profile.get("ageGroup") or "").strip().lower()
    gender = str(profile.get("gender") or "").strip().lower()

    if "child" in age_group or "boy" in age_group or "girl" in age_group:
        return 4 if gender == "female" else 3
    if "elder" in age_group or "old" in age_group or "senior" in age_group:
        return -2 if gender == "female" else -3
    return 0


def _llvc_runtime_model_snapshot(*, force_refresh: bool = False) -> tuple[set[str], bool]:
    now_ms = int(time.time() * 1000)
    with _LLVC_MODEL_CACHE_LOCK:
        updated_at_ms = int(_LLVC_MODEL_CACHE.get("updatedAtMs") or 0)
        if (
            not force_refresh
            and updated_at_ms > 0
            and (now_ms - updated_at_ms) < VF_LLVC_MODEL_CACHE_TTL_MS
        ):
            cached_models = _LLVC_MODEL_CACHE.get("models")
            cached_fallback = bool(_LLVC_MODEL_CACHE.get("fallbackAvailable"))
            model_set = {str(item).strip() for item in list(cached_models or []) if str(item).strip()}
            return model_set, cached_fallback

    fallback_available = bool(ENABLE_LLVC_FALLBACK)
    models: list[str] = []
    try:
        payload = llvc_runtime.health_payload()
        nested = payload.get("llvc") if isinstance(payload.get("llvc"), dict) else {}
        if isinstance(nested, dict):
            fallback_available = bool(nested.get("fallbackAvailable")) or fallback_available
    except Exception:
        fallback_available = bool(ENABLE_LLVC_FALLBACK)

    try:
        models = [str(item).strip() for item in llvc_runtime.list_models() if str(item).strip()]
    except Exception:
        models = []

    if fallback_available and LLVC_FALLBACK_MODEL_ID not in models:
        models = [LLVC_FALLBACK_MODEL_ID, *models]

    with _LLVC_MODEL_CACHE_LOCK:
        _LLVC_MODEL_CACHE["updatedAtMs"] = now_ms
        _LLVC_MODEL_CACHE["models"] = list(models)
        _LLVC_MODEL_CACHE["fallbackAvailable"] = bool(fallback_available)

    return set(models), bool(fallback_available)


def _resolve_llvc_model_name_for_runtime(mapped_model_name: str) -> str:
    desired = str(mapped_model_name or "").strip()
    available_models, fallback_available = _llvc_runtime_model_snapshot()
    if desired and desired in available_models:
        return desired
    if desired:
        # Do not silently remap profile-specific post-TTS conversion to another profile model.
        # If the exact mapped model is missing, caller should bypass LLVC rather than change timbre.
        return ""
    if available_models:
        preferred = str(VF_LLVC_PRESET_DEFAULT or "").strip()
        if preferred and preferred in available_models:
            return preferred
        return sorted(available_models)[0]
    if fallback_available:
        return LLVC_FALLBACK_MODEL_ID
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
    if re.search(r"\b(cry|sob|tears|रो|रोना|crying)\b", value):
        return "Crying"
    if re.search(r"\b(laugh|haha|lol|हँस|हंस|laughing)\b", value):
        return "Laughing"
    if re.search(r"\b(angry|furious|mad|gussa|गुस्सा)\b", value):
        return "Angry"
    if re.search(r"\b(sad|hurt|broken|दुख|उदास)\b", value):
        return "Sad"
    if re.search(r"\b(worried|afraid|scared|डर|भय)\b", value):
        return "Anxious"
    if re.search(r"\b(whisper|slowly|धीरे|फुसफुस)\b", value):
        return "Whispering"
    if re.search(r"\b(excited|awesome|great|वाह|कमाल)\b", value):
        return "Excited"
    if re.search(r"\b(please|kindly|thanks|thank you|धन्यवाद)\b", value):
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


class LlvcRuntime:
    def __init__(self) -> None:
        self.base_url = LLVC_RUNTIME_URL
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
            self.import_error = f"llvc-runtime unreachable: {exc}"
            raise RuntimeError(self.import_error) from exc
        if not response.ok:
            detail = response.text[:220] if response.text else f"HTTP {response.status_code}"
            raise RuntimeError(f"llvc-runtime {path} failed: {detail}")
        try:
            parsed = response.json()
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"llvc-runtime {path} returned invalid JSON: {exc}") from exc
        return parsed if isinstance(parsed, dict) else {}

    def ensure_engine(self) -> Any:
        payload = self._request_json("GET", "/v1/health")
        self._health_payload = payload
        llvc_payload = payload.get("llvc") if isinstance(payload.get("llvc"), dict) else {}
        available = bool(llvc_payload.get("available"))
        self._current_model = str(llvc_payload.get("currentModel") or "").strip() or self._current_model
        if not available and not bool(llvc_payload.get("fallbackAvailable")):
            detail = str(llvc_payload.get("error") or payload.get("detail") or "llvc_runtime_unavailable")
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

    def convert_file(self, input_wav: str, output_wav: str, **kwargs: Any) -> dict[str, str]:
        model_name = str(kwargs.get("model_name") or "").strip()
        if not model_name:
            raise RuntimeError("llvc_model_required")
        preset = _normalize_llvc_preset(str(kwargs.get("preset") or VF_TTS_POST_LLVC_PRESET))
        with Path(input_wav).open("rb") as handle:
            response = requests.post(
                f"{self.base_url}/v1/convert",
                files={"file": ("source.wav", handle, "audio/wav")},
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
                timeout=VF_TTS_POST_LLVC_TIMEOUT_SEC,
            )
        if not response.ok:
            detail = (response.text or "").strip()
            if detail:
                detail = detail[:4000]
            else:
                detail = f"HTTP {response.status_code}"
            raise RuntimeError(f"llvc-runtime /v1/convert failed: {detail}")
        Path(output_wav).write_bytes(bytes(response.content or b""))
        headers: dict[str, str] = {}
        for key in (
            "x-vf-llvc-model-resolved",
            "x-vf-llvc-backend-mode",
            "x-vf-llvc-index-used",
            "x-vf-llvc-f0-method",
            "x-vf-llvc-preset",
            "x-vf-llvc-model",
        ):
            raw_value = str(response.headers.get(key) or "").strip()
            if raw_value:
                headers[key.lower()] = raw_value
        return headers


class VoiceConversionAdapter:
    name = "base"
    supports_one_shot_clone = False
    supports_realtime = False
    recommended_use_cases: list[str] = []

    def health(self) -> tuple[bool, str]:
        return False, "adapter_not_implemented"

    def prepare_voice(self, profile: dict[str, Any]) -> dict[str, Any]:
        return profile

    def convert(self, input_wav: str, output_wav: str, **kwargs: Any) -> dict[str, str]:
        raise RuntimeError("convert_not_implemented")


class KokoroCloneAdapter(VoiceConversionAdapter):
    name = "KOKORO"
    supports_one_shot_clone = True
    supports_realtime = False
    recommended_use_cases = ["dubbing", "one_shot_clone"]

    def health(self) -> tuple[bool, str]:
        return _probe_runtime_health(TTS_ENGINE_HEALTH_URLS["KOKORO"], timeout_sec=2.5)


class LlvcAdapter(VoiceConversionAdapter):
    name = "LLVC"
    supports_one_shot_clone = False
    supports_realtime = True
    recommended_use_cases = ["covers", "voice_conversion"]

    def health(self) -> tuple[bool, str]:
        try:
            llvc_runtime.ensure_engine()
            return True, "llvc_ready"
        except Exception as exc:  # noqa: BLE001
            return False, str(exc)

    def convert(self, input_wav: str, output_wav: str, **kwargs: Any) -> dict[str, str]:
        return llvc_runtime.convert_file(input_wav, output_wav, **kwargs)


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


def _iter_kokoro_model_files() -> list[Path]:
    if not KOKORO_MODEL_MIRROR_DIR.exists():
        return []
    files: list[Path] = []
    for entry in KOKORO_MODEL_MIRROR_DIR.rglob("*"):
        if entry.is_file():
            files.append(entry)
    files.sort(key=lambda item: str(item.relative_to(KOKORO_MODEL_MIRROR_DIR)).lower())
    return files


def _kokoro_model_status_payload() -> dict[str, Any]:
    required = list(KOKORO_MODEL_REQUIRED_FILES)
    missing: list[str] = []
    for rel in required:
        candidate = (KOKORO_MODEL_MIRROR_DIR / rel).resolve()
        if not candidate.exists() or not candidate.is_file():
            missing.append(rel)

    files = _iter_kokoro_model_files()
    total_bytes = 0
    hash_feed = hashlib.sha256()
    file_entries: list[dict[str, Any]] = []
    for file_path in files:
        rel_path = str(file_path.relative_to(KOKORO_MODEL_MIRROR_DIR)).replace("\\", "/")
        try:
            stat = file_path.stat()
            file_size = int(stat.st_size)
        except Exception:
            file_size = 0
        total_bytes += max(0, file_size)
        hash_feed.update(rel_path.encode("utf-8", errors="ignore"))
        hash_feed.update(b":")
        hash_feed.update(str(file_size).encode("utf-8", errors="ignore"))
        hash_feed.update(b";")
        file_entries.append({
            "path": rel_path,
            "size": file_size,
        })

    available = KOKORO_MODEL_MIRROR_DIR.exists()
    ready = available and len(missing) == 0
    detail = ""
    if not available:
        detail = f"Mirror directory is missing: {KOKORO_MODEL_MIRROR_DIR}"
    elif missing:
        detail = f"Mirror missing required files: {', '.join(missing)}"
    else:
        detail = "Kokoro local mirror ready."

    return {
        "ok": True,
        "available": available,
        "repoId": KOKORO_MODEL_REPO_ID,
        "revision": KOKORO_MODEL_REVISION,
        "modelPath": str(KOKORO_MODEL_MIRROR_DIR),
        "fileCount": len(files),
        "totalBytes": total_bytes,
        "required": required,
        "missing": missing,
        "ready": ready,
        "hash": hash_feed.hexdigest(),
        "files": file_entries,
        "detail": detail,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
    }


def _log_kokoro_model_mirror_status() -> None:
    try:
        payload = _kokoro_model_status_payload()
    except Exception as exc:  # noqa: BLE001
        print(f"[models.kokoro] status probe failed: {exc}")
        return

    print(
        "[models.kokoro] "
        f"ready={payload.get('ready')} "
        f"path={payload.get('modelPath')} "
        f"files={payload.get('fileCount')} "
        f"bytes={payload.get('totalBytes')} "
        f"missing={len(payload.get('missing') or [])}"
    )
    if not payload.get("ready"):
        detail = str(payload.get("detail") or "Mirror unavailable.")
        print(f"[models.kokoro] detail={detail}")


llvc_runtime = LlvcRuntime()
whisper_runtime = WhisperRuntime()
source_separation_runtime = SourceSeparationRuntime()
source_separation_lock = threading.Lock()
kokoro_clone_adapter = KokoroCloneAdapter()
llvc_adapter = LlvcAdapter()
app = FastAPI(
    title="VoiceFlow Media Backend",
    version="1.0.0",
    openapi_url="/openapi.json" if VF_DOCS_ENABLE else None,
    docs_url="/docs" if VF_DOCS_ENABLE else None,
    redoc_url="/redoc" if VF_DOCS_ENABLE else None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins("VF_CORS_ORIGINS", DEFAULT_CORS_ORIGINS),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
try:
    LOCAL_MODEL_MIRROR_ROOT.mkdir(parents=True, exist_ok=True)
except Exception:
    # Keep backend boot resilient even if mirror root cannot be created yet.
    pass

_FIREBASE_APP = None
_FIRESTORE_DB = None
_FIREBASE_INIT_ERROR: Optional[str] = None
_FIRESTORE_INIT_ERROR: Optional[str] = None
_INMEMORY_ENTITLEMENTS: dict[str, dict[str, Any]] = {}
_INMEMORY_USAGE_MONTHLY: dict[str, dict[str, Any]] = {}
_INMEMORY_USAGE_DAILY: dict[str, dict[str, Any]] = {}
_INMEMORY_USAGE_EVENTS: dict[str, dict[str, Any]] = {}
_INMEMORY_STRIPE_CUSTOMERS: dict[str, str] = {}
_INMEMORY_WALLET_DAILY: dict[str, dict[str, Any]] = {}
_INMEMORY_WALLET_TRANSACTIONS: dict[str, dict[str, Any]] = {}
_INMEMORY_COUPONS: dict[str, dict[str, Any]] = {}
_INMEMORY_COUPON_CODE_INDEX: dict[str, str] = {}
_INMEMORY_COUPON_REDEMPTIONS: dict[str, dict[str, Any]] = {}
_INMEMORY_GENERATION_HISTORY: dict[str, dict[str, Any]] = {}
_INMEMORY_DAILY_USAGE_RESET_STATUS: dict[str, Any] = {}
_INMEMORY_ADMIN_ROLES: dict[str, dict[str, Any]] = {}
_INMEMORY_AUDIT_LEDGER_EVENTS: dict[str, dict[str, Any]] = {}
_INMEMORY_AUDIT_LEDGER_ORDER: list[str] = []
_INMEMORY_AUDIT_LEDGER_STATE: dict[str, Any] = {}
_INMEMORY_ALERT_POLICIES: dict[str, dict[str, Any]] = {}
_INMEMORY_ALERT_DESTINATIONS: dict[str, dict[str, Any]] = {}
_INMEMORY_ALERT_EVENTS: dict[str, dict[str, Any]] = {}
_INMEMORY_SCHEDULER_TASKS: dict[str, dict[str, Any]] = {}
_INMEMORY_SCHEDULER_RUNS: dict[str, dict[str, Any]] = {}
_INMEMORY_SCHEDULER_LOCK: dict[str, Any] = {}
_INMEMORY_COUPON_ANALYTICS_DAILY: dict[str, dict[str, Any]] = {}
_INMEMORY_COUPON_SUB_ATTRIBUTIONS: dict[str, dict[str, Any]] = {}
_INMEMORY_USER_PROFILES: dict[str, dict[str, Any]] = {}
_INMEMORY_USER_ID_INDEX: dict[str, dict[str, Any]] = {}
_INMEMORY_TEAMS: dict[str, dict[str, Any]] = {}
_INMEMORY_TEAM_MEMBERS: dict[str, dict[str, Any]] = {}
_INMEMORY_TEAM_INVITES: dict[str, dict[str, Any]] = {}
_INMEMORY_SUPPORT_CONVERSATIONS: dict[str, dict[str, Any]] = {}
_INMEMORY_SUPPORT_MESSAGES: dict[str, dict[str, Any]] = {}
_INMEMORY_SUPPORT_AI_RUNS: dict[str, dict[str, Any]] = {}
_INMEMORY_SUPPORT_AI_POLICY: dict[str, Any] = {}
_INMEMORY_ADMIN_SESSION_UNLOCK: dict[str, dict[str, Any]] = {}
_INMEMORY_LOCK = threading.RLock()
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
    result_ttl_ms=VF_TTS_QUEUE_RESULT_TTL_MS,
    inline_result_max_bytes=VF_TTS_JOB_INLINE_RESULT_MAX_BYTES,
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
_TTS_LIVE_LLVC_SEMAPHORE = threading.Semaphore(max(1, int(VF_TTS_LIVE_LLVC_GLOBAL_CONCURRENCY)))
_LLVC_RUNTIME_POOL_LOCK = threading.Lock()
_LLVC_RUNTIME_POOL_CURSOR = 0
_TTS_QUEUE_TELEMETRY: dict[str, Any] = {
    "enqueueToStartMs": deque(maxlen=VF_TTS_QUEUE_METRICS_WINDOW),
    "runtimeLatencyMs": deque(maxlen=VF_TTS_QUEUE_METRICS_WINDOW),
    "engineSemaphoreWaitMs": deque(maxlen=VF_TTS_QUEUE_METRICS_WINDOW),
    "liveFirstChunkLatencyMs": deque(maxlen=VF_TTS_QUEUE_METRICS_WINDOW),
    "liveChunkCount": deque(maxlen=VF_TTS_QUEUE_METRICS_WINDOW),
    "liveChunkLlvcLatencyMs": deque(maxlen=VF_TTS_QUEUE_METRICS_WINDOW),
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
_RUNTIME_HTTP_LOCAL = threading.local()
_REQUESTS_GET_BASE = requests.get
_REQUESTS_POST_BASE = requests.post
_REQUESTS_PUT_BASE = requests.put
_REQUESTS_PATCH_BASE = requests.patch
_REQUESTS_DELETE_BASE = requests.delete


def _runtime_http_session() -> requests.Session:
    session = getattr(_RUNTIME_HTTP_LOCAL, "session", None)
    if isinstance(session, requests.Session):
        return session
    session = requests.Session()
    adapter = requests.adapters.HTTPAdapter(pool_connections=64, pool_maxsize=64, max_retries=0)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    _RUNTIME_HTTP_LOCAL.session = session
    return session


def _runtime_http_request(method: str, url: str, **kwargs: Any) -> requests.Response:
    method_upper = str(method or "GET").strip().upper() or "GET"
    direct_overrides = {
        "GET": (_REQUESTS_GET_BASE, requests.get),
        "POST": (_REQUESTS_POST_BASE, requests.post),
        "PUT": (_REQUESTS_PUT_BASE, requests.put),
        "PATCH": (_REQUESTS_PATCH_BASE, requests.patch),
        "DELETE": (_REQUESTS_DELETE_BASE, requests.delete),
    }
    current_pair = direct_overrides.get(method_upper)
    if current_pair is not None:
        original_fn, current_fn = current_pair
        if current_fn is not original_fn:
            return current_fn(url, **kwargs)
    session = _runtime_http_session()
    return session.request(method=method_upper, url=url, **kwargs)

_GEMINI_POOLS_LOCK = threading.Lock()
_GEMINI_POOLS_CACHE: Optional[dict[str, Any]] = None
_GEMINI_POOLS_META: dict[str, Any] = {}
_ADMIN_USAGE_LOCK = threading.Lock()
_ADMIN_USAGE_RECENT_EVENTS: deque[dict[str, Any]] = deque()
_ADMIN_USAGE_TOTALS: dict[str, dict[str, Any]] = {}
_RBAC_CACHE_LOCK = threading.Lock()
_RBAC_ACTOR_CACHE: dict[str, dict[str, Any]] = {}
_SCHEDULER_THREAD_LOCK = threading.Lock()
_SCHEDULER_THREAD: Optional[threading.Thread] = None
_SCHEDULER_STOP_EVENT = threading.Event()


def _init_firebase_clients() -> None:
    global _FIREBASE_APP, _FIRESTORE_DB, _FIREBASE_INIT_ERROR, _FIRESTORE_INIT_ERROR
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
        _FIRESTORE_DB = None
        _FIRESTORE_INIT_ERROR = None
        if VF_FIRESTORE_ENABLE and firebase_firestore is not None:
            candidate = firebase_firestore.client()
            try:
                # Probe Firestore once at startup; disabled APIs must gracefully fall back to in-memory mode.
                next(candidate.collections(), None)
                _FIRESTORE_DB = candidate
            except Exception as firestore_exc:  # noqa: BLE001
                _FIRESTORE_DB = None
                _FIRESTORE_INIT_ERROR = str(firestore_exc)
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


def _persist_inmemory_user_profile_store_locked() -> None:
    if not VF_USER_PROFILE_FALLBACK_PERSIST:
        return
    try:
        target = VF_USER_PROFILE_FALLBACK_FILE
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": 1,
            "updatedAt": _safe_now_iso(),
            "profiles": dict(_INMEMORY_USER_PROFILES),
            "userIdIndex": dict(_INMEMORY_USER_ID_INDEX),
        }
        tmp_path = target.with_suffix(f"{target.suffix}.tmp")
        tmp_path.write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")
        os.replace(str(tmp_path), str(target))
    except Exception as exc:
        print(
            f"[user-profile-store] persist_failed path={VF_USER_PROFILE_FALLBACK_FILE} "
            f"reason_class={type(exc).__name__} reason={str(exc)[:180]}",
            flush=True,
        )


def _load_inmemory_user_profile_store() -> None:
    if not VF_USER_PROFILE_FALLBACK_PERSIST:
        return
    target = VF_USER_PROFILE_FALLBACK_FILE
    if not target.exists():
        return
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except Exception as exc:
        print(
            f"[user-profile-store] load_failed path={target} reason_class={type(exc).__name__} "
            f"reason={str(exc)[:180]}",
            flush=True,
        )
        return
    profiles_raw = payload.get("profiles") if isinstance(payload, dict) else {}
    index_raw = payload.get("userIdIndex") if isinstance(payload, dict) else {}
    if not isinstance(profiles_raw, dict):
        profiles_raw = {}
    if not isinstance(index_raw, dict):
        index_raw = {}

    hydrated_profiles: dict[str, dict[str, Any]] = {}
    hydrated_index: dict[str, dict[str, Any]] = {}

    for uid_key, row in profiles_raw.items():
        safe_uid = str(uid_key or "").strip()
        if not safe_uid or not isinstance(row, dict):
            continue
        row_uid = str(row.get("uid") or safe_uid).strip()
        user_id = str(row.get("userId") or "").strip().lower()
        if not row_uid or not user_id:
            continue
        normalized_row = dict(row)
        normalized_row["uid"] = row_uid
        normalized_row["userId"] = user_id
        hydrated_profiles[row_uid] = normalized_row

    for user_id_key, row in index_raw.items():
        safe_user_id = str(user_id_key or "").strip().lower()
        if not safe_user_id or not isinstance(row, dict):
            continue
        owner_uid = str(row.get("uid") or "").strip()
        if not owner_uid:
            continue
        hydrated_index[safe_user_id] = {
            "userId": safe_user_id,
            "uid": owner_uid,
            "createdAt": str(row.get("createdAt") or ""),
            "updatedAt": str(row.get("updatedAt") or ""),
        }

    for uid_value, row in hydrated_profiles.items():
        user_id = str(row.get("userId") or "").strip().lower()
        if not user_id:
            continue
        index_row = hydrated_index.get(user_id) or {}
        hydrated_index[user_id] = {
            "userId": user_id,
            "uid": uid_value,
            "createdAt": str(index_row.get("createdAt") or row.get("createdAt") or ""),
            "updatedAt": str(index_row.get("updatedAt") or row.get("updatedAt") or ""),
        }

    if not hydrated_profiles and not hydrated_index:
        return
    with _INMEMORY_LOCK:
        _INMEMORY_USER_PROFILES.update(hydrated_profiles)
        _INMEMORY_USER_ID_INDEX.update(hydrated_index)


_load_inmemory_user_profile_store()


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
        "paidVfBalance": 0.0,
        "vffBalance": 0.0,
        "vffMonthKey": _wallet_month_key(),
        "updatedAt": _safe_now_iso(),
    }


def _normalize_plan_name(value: str) -> str:
    return PLAN_LIMITS[_plan_key_from_name(value)]["plan"]


def _plan_key_from_name(plan_name: str) -> str:
    token = str(plan_name or "").strip().lower()
    if token in PLAN_KEY_ALIASES:
        return PLAN_KEY_ALIASES[token]
    if token in PLAN_LIMITS:
        return token
    display_to_key = {str(cfg.get("plan") or "").strip().lower(): key for key, cfg in PLAN_LIMITS.items()}
    if token in display_to_key:
        return str(display_to_key[token] or "free")
    return "free"


def _is_known_plan_token(value: str) -> bool:
    token = str(value or "").strip().lower()
    if not token:
        return False
    if token in PLAN_KEY_ALIASES or token in PLAN_LIMITS:
        return True
    display_to_key = {str(cfg.get("plan") or "").strip().lower(): key for key, cfg in PLAN_LIMITS.items()}
    return token in display_to_key


def _normalize_coupon_plan_token(value: str) -> str:
    token = re.sub(r"[^a-z0-9_-]", "", str(value or "").strip().lower())
    if not token:
        return ""
    if not _is_known_plan_token(token):
        return token
    normalized = _plan_key_from_name(token)
    if normalized == "free":
        return ""
    return normalized


def _plan_config(plan_name: str) -> dict[str, Any]:
    return PLAN_LIMITS[_plan_key_from_name(plan_name)]


def _plan_allowed_engines(plan_key: str) -> tuple[str, ...]:
    normalized = _plan_key_from_name(plan_key)
    row = PLAN_FEATURE_FLAGS.get(normalized) or {}
    values = row.get("allowedEngines")
    if isinstance(values, (tuple, list)):
        out = tuple(
            engine
            for engine in [str(item or "").strip().upper() for item in values]
            if engine in set(TTS_ENGINE_KEYS)
        )
        if out:
            return out
    return tuple(TTS_ENGINE_KEYS)


def _plan_has_early_access(plan_key: str) -> bool:
    normalized = _plan_key_from_name(plan_key)
    row = PLAN_FEATURE_FLAGS.get(normalized) or {}
    return bool(row.get("earlyAccess"))


def _tts_success_bucket_for_plan(plan_key: str) -> str:
    normalized = _plan_key_from_name(plan_key)
    if normalized == "scale":
        return "scale"
    if normalized in {"pro"}:
        return "pro"
    if normalized in {"starter", "creator"}:
        return "starter"
    return "free"


def _tts_pool_hint_plan_key(plan_key: str) -> str:
    normalized = _plan_key_from_name(plan_key)
    if normalized == "scale":
        return "plus"
    if normalized in {"pro", "starter", "creator"}:
        return "pro"
    return "free"


def _tts_guardrail_for_plan(plan_name: str) -> tuple[str, dict[str, int]]:
    plan_key = _plan_key_from_name(plan_name)
    guardrails = TTS_PLAN_GUARDRAILS.get(plan_key) or TTS_PLAN_GUARDRAILS["free"]
    success_bucket = _tts_success_bucket_for_plan(plan_key)
    return plan_key, {
        "rpm": _TTS_SUCCESS_LIMITER.quota_for_plan(success_bucket),
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


def _enforce_tts_plan_guardrails(
    uid: str,
    text_chars: int,
    trace_id: str,
    *,
    engine: str,
    bypass: bool = False,
) -> tuple[str, str, dict[str, int]]:
    entitlement = _load_entitlement(uid)
    plan_name = _normalize_plan_name(str(entitlement.get("plan") or "Free"))
    plan_key, guardrails = _tts_guardrail_for_plan(plan_name)
    if bypass:
        return plan_name, plan_key, guardrails
    safe_engine = _normalize_engine_name(engine)
    if safe_engine not in set(_plan_allowed_engines(plan_key)):
        raise HTTPException(
            status_code=403,
            detail={
                "errorCode": "VF_TTS_ENGINE_PLAN_FORBIDDEN",
                "reason": "plan_engine_forbidden",
                "plan": plan_name,
                "engine": safe_engine,
                "allowedEngines": list(_plan_allowed_engines(plan_key)),
                "trace_id": trace_id,
            },
        )
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
    quota_bucket = _tts_success_bucket_for_plan(plan_key)
    snapshot = _TTS_SUCCESS_LIMITER.peek(uid, quota_bucket)
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
    quota_bucket = _tts_success_bucket_for_plan(plan_key)
    decision = _TTS_SUCCESS_LIMITER.commit_success(uid, quota_bucket, request_fingerprint=request_fingerprint)
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


def _engine_rate(engine: str) -> float:
    engine_key = str(engine or "").strip().upper()
    return _as_positive_number(VF_ENGINE_RATES.get(engine_key)) or 1.0


def _engine_rate_for_plan(plan_name: str, engine: str) -> float:
    # Kept as a compatibility wrapper while all pricing is engine-tier based.
    _ = plan_name
    return _engine_rate(engine)


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


VF_DECIMAL_PRECISION = 4
VF_EPSILON = 1e-6


def _as_positive_number(value: Any) -> float:
    try:
        number = float(value)
    except Exception:
        number = 0.0
    if not math.isfinite(number):
        number = 0.0
    return round(max(0.0, number), VF_DECIMAL_PRECISION)


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except Exception:
        number = float(default)
    if not math.isfinite(number):
        return float(default)
    return number


def _auth_exempt_path(path: str) -> bool:
    normalized = str(path or "").strip()
    public_paths = {
        "/health",
        "/system/version",
        "/billing/webhook",
        "/tts/engines/status",
        "/tts/engines/capabilities",
        "/tts/engines/voices",
        "/tts/voice-mapping/catalog",
    }
    if VF_DOCS_ENABLE:
        public_paths.update(
            {
                "/openapi.json",
                "/docs",
                "/docs/oauth2-redirect",
                "/redoc",
            }
        )
    if normalized in public_paths:
        return True
    return bool(VF_DOCS_ENABLE and normalized.startswith("/docs"))


def _user_id_requirement_exempt_path(path: str) -> bool:
    normalized = str(path or "").strip()
    if not normalized:
        return True
    exempt_paths = {
        "/health",
        "/system/version",
        "/account/profile",
        "/account/profile/bootstrap",
    }
    if VF_DOCS_ENABLE:
        exempt_paths.update(
            {
                "/openapi.json",
                "/docs",
                "/docs/oauth2-redirect",
                "/redoc",
            }
        )
    if normalized in exempt_paths:
        return True
    if normalized.startswith("/admin"):
        return True
    if normalized.startswith("/ops/guardian"):
        return True
    return False


@app.middleware("http")
async def _firebase_auth_middleware(request: Request, call_next: Any) -> Response:
    if _is_cors_preflight_request(request):
        return _cors_preflight_response(request)

    if not VF_AUTH_ENFORCE:
        return await call_next(request)

    if _auth_exempt_path(request.url.path):
        return await call_next(request)

    auth_header = str(request.headers.get("Authorization") or "").strip()
    if not auth_header.lower().startswith("bearer "):
        return _cors_json_response(request, status_code=401, content={"detail": "Missing bearer token."})

    id_token = auth_header.split(" ", 1)[1].strip()
    if not id_token:
        return _cors_json_response(request, status_code=401, content={"detail": "Missing bearer token."})

    try:
        claims = _verify_firebase_id_token(id_token)
    except Exception as exc:  # noqa: BLE001
        return _cors_json_response(request, status_code=401, content={"detail": f"Invalid auth token: {exc}"})

    uid = str(claims.get("uid") or "")
    if not uid:
        return _cors_json_response(request, status_code=401, content={"detail": "Auth token did not include uid."})

    request.state.uid = uid
    request.state.auth_claims = claims
    return await call_next(request)


@app.middleware("http")
async def _user_id_requirement_middleware(request: Request, call_next: Any) -> Response:
    if not VF_USER_ID_REQUIRED or not VF_AUTH_ENFORCE:
        return await call_next(request)
    path = str(request.url.path or "/")
    if _auth_exempt_path(path) or _user_id_requirement_exempt_path(path):
        return await call_next(request)
    uid = str(getattr(request.state, "uid", "") or "").strip()
    if not uid:
        return await call_next(request)
    if _request_is_admin(request, uid):
        return await call_next(request)
    profile = _user_profile_read(uid)
    if isinstance(profile, dict):
        user_id = str(profile.get("userId") or "").strip().lower()
        if user_id:
            request.state.user_id = user_id
            return await call_next(request)
    return _cors_json_response(
        request,
        status_code=428,
        content={"detail": "Complete your userId before using this feature."},
    )


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


def _request_claim_email(request: Optional[Request]) -> str:
    if request is None:
        return ""
    claims = getattr(request.state, "auth_claims", None)
    if not isinstance(claims, dict):
        return ""
    return str(claims.get("email") or "").strip().lower()


def _normalize_user_id_handle(raw_user_id: str) -> str:
    token = str(raw_user_id or "").strip().lower()
    token = re.sub(r"[^a-z0-9_]", "", token)
    if token.startswith("_"):
        token = token.lstrip("_")
    if not token:
        raise HTTPException(status_code=400, detail="userId is required.")
    if token in USER_ID_RESERVED_WORDS:
        raise HTTPException(status_code=400, detail="This userId is reserved.")
    if not USER_ID_HANDLE_PATTERN.fullmatch(token):
        raise HTTPException(
            status_code=400,
            detail="userId must match [a-z0-9_]{4,24} and cannot start with underscore.",
        )
    return token


def _user_profile_backfill_candidate(uid: str, email: str = "", display_name: str = "") -> str:
    safe_uid = str(uid or "").strip().lower()
    raw_email = str(email or "").strip().lower()
    raw_display = str(display_name or "").strip().lower()
    base = ""
    if raw_email and "@" in raw_email:
        base = raw_email.split("@", 1)[0]
    elif raw_display:
        base = raw_display.replace(" ", "_")
    if not base:
        base = f"user_{safe_uid[:12] or 'acct'}"
    base = re.sub(r"[^a-z0-9_]", "", base)
    base = base.lstrip("_")
    if len(base) < 4:
        base = f"user_{safe_uid[:12] or 'acct'}"
    if len(base) > 24:
        base = base[:24]
    if base in USER_ID_RESERVED_WORDS:
        base = f"{base}_id"
    base = re.sub(r"[^a-z0-9_]", "", base).lstrip("_")
    if len(base) < 4:
        base = f"user{safe_uid[:6]}".ljust(4, "0")
    if len(base) > 24:
        base = base[:24]
    return base


def _user_profile_read(uid: str) -> Optional[dict[str, Any]]:
    safe_uid = str(uid or "").strip()
    if not safe_uid:
        return None
    collection = _firestore_collection(USER_PROFILES_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            row = _INMEMORY_USER_PROFILES.get(safe_uid)
            return dict(row) if isinstance(row, dict) else None
    try:
        doc = collection.document(safe_uid).get()
    except Exception:
        with _INMEMORY_LOCK:
            row = _INMEMORY_USER_PROFILES.get(safe_uid)
            return dict(row) if isinstance(row, dict) else None
    if not doc.exists:
        with _INMEMORY_LOCK:
            row = _INMEMORY_USER_PROFILES.get(safe_uid)
            if isinstance(row, dict):
                return dict(row)
        return None
    payload = doc.to_dict() or {}
    payload["uid"] = safe_uid
    return payload


def _user_profile_find_by_user_id(user_id: str) -> Optional[dict[str, Any]]:
    safe_user_id = str(user_id or "").strip().lower()
    if not safe_user_id:
        return None
    index_collection = _firestore_collection(USER_ID_INDEX_COLLECTION)
    if index_collection is None:
        with _INMEMORY_LOCK:
            row = _INMEMORY_USER_ID_INDEX.get(safe_user_id)
            if not isinstance(row, dict):
                return None
            uid = str(row.get("uid") or "").strip()
        if not uid:
            return None
        return _user_profile_read(uid)
    try:
        index_doc = index_collection.document(safe_user_id).get()
    except Exception:
        with _INMEMORY_LOCK:
            row = _INMEMORY_USER_ID_INDEX.get(safe_user_id)
            if not isinstance(row, dict):
                return None
            uid = str(row.get("uid") or "").strip()
        if not uid:
            return None
        return _user_profile_read(uid)
    if not index_doc.exists:
        with _INMEMORY_LOCK:
            row = _INMEMORY_USER_ID_INDEX.get(safe_user_id)
            if not isinstance(row, dict):
                return None
            uid = str(row.get("uid") or "").strip()
        if not uid:
            return None
        return _user_profile_read(uid)
    idx = index_doc.to_dict() or {}
    uid = str(idx.get("uid") or "").strip()
    if not uid:
        return None
    return _user_profile_read(uid)


def _user_id_for_uid(uid: str) -> str:
    profile = _user_profile_read(uid)
    if isinstance(profile, dict):
        return str(profile.get("userId") or "").strip().lower()
    return ""


def _is_firestore_transaction_wrapper_error(exc: Exception) -> bool:
    detail = str(exc or "").strip().lower()
    if not detail:
        return False
    if "transaction has no transaction id" in detail:
        return True
    if "transaction id" in detail and "cannot be rolled back" in detail:
        return True
    if "rollback" in detail and "transaction id" in detail:
        return True
    return False


def _classify_user_profile_write_error(exc: Exception) -> tuple[int, str]:
    detail = str(exc or "").strip()
    lowered = detail.lower()
    if "userid is immutable once set" in lowered or ("immutable" in lowered and "userid" in lowered):
        return 409, "userId is immutable once set."
    if "userid already exists" in lowered or ("already exists" in lowered and "userid" in lowered):
        return 409, "userId already exists."
    if (
        "service_disabled" in lowered
        or "firestore.googleapis.com" in lowered
        or "cloud firestore api has not been used" in lowered
        or "permission_denied" in lowered
        or "insufficient permissions" in lowered
        or "googleapis.com" in lowered
    ):
        return 503, "Profile service is temporarily unavailable. Please try again in a few minutes."
    if "deadline exceeded" in lowered or "timed out" in lowered or "timeout" in lowered:
        return 503, "Profile service timed out. Please try again."
    return 503, "Failed to save user profile. Please try again."


def _log_user_profile_write_error(stage: str, uid: str, user_id: str, exc: Exception) -> None:
    print(
        f"[user-profile-upsert] {stage} uid={str(uid or '').strip()} userId={str(user_id or '').strip()} "
        f"reason_class={type(exc).__name__} reason={str(exc)[:220]}",
        flush=True,
    )


def _is_user_profile_store_unavailable_error(exc: Exception) -> bool:
    lowered = str(exc or "").strip().lower()
    if not lowered:
        return False
    return (
        "service_disabled" in lowered
        or "cloud firestore api has not been used" in lowered
        or "firestore.googleapis.com" in lowered
        or "googleapis.com" in lowered
        or "permission_denied" in lowered
        or "insufficient permissions" in lowered
    )


def _user_profile_upsert(
    uid: str,
    *,
    user_id: Optional[str] = None,
    display_name: Optional[str] = None,
    email: Optional[str] = None,
    created_by: str = "",
    updated_by: str = "",
    force_change: bool = False,
    allow_existing_immutable: bool = False,
) -> dict[str, Any]:
    safe_uid = str(uid or "").strip()
    if not safe_uid:
        raise HTTPException(status_code=400, detail="Missing user uid.")
    current = _user_profile_read(safe_uid) or {}
    now_iso = _utc_now().isoformat()
    current_user_id = str(current.get("userId") or "").strip().lower()
    next_user_id = _normalize_user_id_handle(
        str(user_id or current_user_id or _user_profile_backfill_candidate(safe_uid, str(email or ""), str(display_name or "")))
    )
    if current_user_id and next_user_id != current_user_id and not force_change and not allow_existing_immutable:
        raise HTTPException(status_code=409, detail="userId is immutable once set.")

    next_display_name = str(
        display_name
        if display_name is not None
        else current.get("displayName") or current.get("name") or ""
    ).strip()[:120]
    next_email = str(email if email is not None else current.get("email") or "").strip().lower()[:240]
    created_at = str(current.get("createdAt") or now_iso)
    row = {
        "uid": safe_uid,
        "userId": next_user_id,
        "displayName": next_display_name,
        "email": next_email,
        "status": str(current.get("status") or "active"),
        "createdAt": created_at,
        "updatedAt": now_iso,
        "createdBy": str(current.get("createdBy") or created_by or safe_uid)[:160],
        "updatedBy": str(updated_by or created_by or safe_uid)[:160],
    }

    profiles_collection = _firestore_collection(USER_PROFILES_COLLECTION)
    index_collection = _firestore_collection(USER_ID_INDEX_COLLECTION)
    def _apply_inmemory_upsert(*, reason: Optional[Exception] = None) -> dict[str, Any]:
        if reason is not None:
            _log_user_profile_write_error("inmemory_fallback", safe_uid, next_user_id, reason)
        with _INMEMORY_LOCK:
            existing = dict(_INMEMORY_USER_PROFILES.get(safe_uid) or {})
            existing_user_id = str(existing.get("userId") or "").strip().lower()
            if existing_user_id and existing_user_id != next_user_id and not force_change and not allow_existing_immutable:
                raise HTTPException(status_code=409, detail="userId is immutable once set.")
            owner = _INMEMORY_USER_ID_INDEX.get(next_user_id) or {}
            owner_uid = str(owner.get("uid") or "").strip()
            if owner_uid and owner_uid != safe_uid:
                raise HTTPException(status_code=409, detail="userId already exists.")
            if existing_user_id and existing_user_id != next_user_id:
                _INMEMORY_USER_ID_INDEX.pop(existing_user_id, None)
            _INMEMORY_USER_ID_INDEX[next_user_id] = {
                "userId": next_user_id,
                "uid": safe_uid,
                "createdAt": str(owner.get("createdAt") or now_iso),
                "updatedAt": now_iso,
            }
            _INMEMORY_USER_PROFILES[safe_uid] = dict(row)
            _persist_inmemory_user_profile_store_locked()
            return dict(row)

    if (
        profiles_collection is None
        or index_collection is None
        or _FIRESTORE_DB is None
        or firebase_firestore is None
    ):
        return _apply_inmemory_upsert()

    profile_ref = _FIRESTORE_DB.collection(USER_PROFILES_COLLECTION).document(safe_uid)
    new_index_ref = _FIRESTORE_DB.collection(USER_ID_INDEX_COLLECTION).document(next_user_id)
    transaction = _FIRESTORE_DB.transaction()

    def _build_firestore_payload(existing_profile: dict[str, Any], *, index_created_at: str) -> dict[str, Any]:
        _ = index_created_at
        return {
            "uid": safe_uid,
            "userId": next_user_id,
            "displayName": next_display_name,
            "email": next_email,
            "status": str((existing_profile or {}).get("status") or "active"),
            "createdAt": str((existing_profile or {}).get("createdAt") or now_iso),
            "updatedAt": now_iso,
            "createdBy": str((existing_profile or {}).get("createdBy") or created_by or safe_uid)[:160],
            "updatedBy": str(updated_by or created_by or safe_uid)[:160],
        }

    def _raise_user_id_conflict_if_any(existing_user_id: str, owner_uid: str) -> None:
        if existing_user_id and existing_user_id != next_user_id and not force_change and not allow_existing_immutable:
            raise HTTPException(status_code=409, detail="userId is immutable once set.")
        if owner_uid and owner_uid != safe_uid:
            raise HTTPException(status_code=409, detail="userId already exists.")

    def _apply_non_transactional_fallback(transaction_error: Exception) -> dict[str, Any]:
        print(
            f"[user-profile-upsert] fallback_non_transactional uid={safe_uid} userId={next_user_id} "
            f"reason_class={type(transaction_error).__name__} reason={str(transaction_error)[:180]}",
            flush=True,
        )
        try:
            profile_doc = profile_ref.get()
            existing = profile_doc.to_dict() if profile_doc.exists else {}
            existing_user_id = str((existing or {}).get("userId") or "").strip().lower()
            index_doc = new_index_ref.get()
            index_payload = index_doc.to_dict() if index_doc.exists else {}
            owner_uid = str((index_payload or {}).get("uid") or "").strip()
            _raise_user_id_conflict_if_any(existing_user_id, owner_uid)

            old_index_ref = None
            if existing_user_id and existing_user_id != next_user_id:
                old_index_ref = _FIRESTORE_DB.collection(USER_ID_INDEX_COLLECTION).document(existing_user_id)
            payload = _build_firestore_payload(
                existing,
                index_created_at=str((index_payload or {}).get("createdAt") or now_iso),
            )
            profile_ref.set(payload, merge=True)
            new_index_ref.set(
                {
                    "userId": next_user_id,
                    "uid": safe_uid,
                    "createdAt": str((index_payload or {}).get("createdAt") or now_iso),
                    "updatedAt": now_iso,
                },
                merge=True,
            )
            if old_index_ref is not None:
                old_index_ref.delete()
            return dict(payload)
        except HTTPException:
            raise
        except Exception as fallback_exc:
            if _is_user_profile_store_unavailable_error(fallback_exc):
                return _apply_inmemory_upsert(reason=fallback_exc)
            _log_user_profile_write_error("fallback_failed", safe_uid, next_user_id, fallback_exc)
            status_code, detail = _classify_user_profile_write_error(fallback_exc)
            raise HTTPException(status_code=status_code, detail=detail) from fallback_exc

    @firebase_firestore.transactional
    def _apply(transaction_obj: Any) -> dict[str, Any]:
        profile_doc = profile_ref.get(transaction=transaction_obj)
        existing = profile_doc.to_dict() if profile_doc.exists else {}
        existing_user_id = str((existing or {}).get("userId") or "").strip().lower()
        index_doc = new_index_ref.get(transaction=transaction_obj)
        owner_uid = str((index_doc.to_dict() or {}).get("uid") or "").strip() if index_doc.exists else ""
        _raise_user_id_conflict_if_any(existing_user_id, owner_uid)
        old_index_ref = None
        if existing_user_id and existing_user_id != next_user_id:
            old_index_ref = _FIRESTORE_DB.collection(USER_ID_INDEX_COLLECTION).document(existing_user_id)
        index_payload = index_doc.to_dict() if index_doc.exists else {}
        payload = _build_firestore_payload(
            existing,
            index_created_at=str((index_payload or {}).get("createdAt") or now_iso),
        )
        index_created_at = str((index_payload or {}).get("createdAt") or now_iso)
        transaction_obj.set(profile_ref, payload, merge=True)
        transaction_obj.set(
            new_index_ref,
            {
                "userId": next_user_id,
                "uid": safe_uid,
                "createdAt": index_created_at,
                "updatedAt": now_iso,
            },
            merge=True,
        )
        if old_index_ref is not None:
            transaction_obj.delete(old_index_ref)
        return payload

    try:
        return _apply(transaction)
    except HTTPException:
        raise
    except RuntimeError as exc:
        if _is_firestore_transaction_wrapper_error(exc):
            return _apply_non_transactional_fallback(exc)
        if _is_user_profile_store_unavailable_error(exc):
            return _apply_inmemory_upsert(reason=exc)
        _log_user_profile_write_error("transaction_runtime_error", safe_uid, next_user_id, exc)
        status_code, detail = _classify_user_profile_write_error(exc)
        raise HTTPException(status_code=status_code, detail=detail) from exc
    except Exception as exc:
        if _is_firestore_transaction_wrapper_error(exc):
            return _apply_non_transactional_fallback(exc)
        if _is_user_profile_store_unavailable_error(exc):
            return _apply_inmemory_upsert(reason=exc)
        _log_user_profile_write_error("transaction_error", safe_uid, next_user_id, exc)
        status_code, detail = _classify_user_profile_write_error(exc)
        raise HTTPException(status_code=status_code, detail=detail) from exc


def _ensure_user_profile(
    uid: str,
    *,
    request: Optional[Request] = None,
    allow_auto_backfill: bool = True,
) -> Optional[dict[str, Any]]:
    safe_uid = str(uid or "").strip()
    if not safe_uid:
        return None
    existing = _user_profile_read(safe_uid)
    if isinstance(existing, dict):
        return existing
    if not allow_auto_backfill:
        return None
    email = _request_claim_email(request)
    display_name = ""
    if _firebase_ready() and firebase_auth is not None:
        try:
            record = firebase_auth.get_user(safe_uid)  # type: ignore[attr-defined]
            display_name = str(getattr(record, "display_name", "") or "").strip()
            if not email:
                email = str(getattr(record, "email", "") or "").strip().lower()
        except Exception:
            pass
    return _user_profile_upsert(
        safe_uid,
        user_id=_user_profile_backfill_candidate(safe_uid, email, display_name),
        display_name=display_name or None,
        email=email or None,
        created_by="system_backfill",
        updated_by="system_backfill",
        force_change=False,
        allow_existing_immutable=True,
    )


def _resolve_request_user_id(request: Optional[Request], uid: str) -> str:
    safe_uid = str(uid or "").strip()
    if not safe_uid:
        return ""
    allow_auto_backfill = (not VF_USER_ID_REQUIRED or not VF_AUTH_ENFORCE)
    if request is not None and _request_is_admin(request, safe_uid):
        allow_auto_backfill = False
    profile = _ensure_user_profile(
        safe_uid,
        request=request,
        allow_auto_backfill=allow_auto_backfill,
    )
    if isinstance(profile, dict):
        return str(profile.get("userId") or "").strip().lower()
    return ""


def _resolve_request_user_id_read_only(uid: str) -> str:
    safe_uid = str(uid or "").strip()
    if not safe_uid:
        return ""
    return _user_id_for_uid(safe_uid)


def _require_user_id_ready(request: Request, uid: str) -> Optional[dict[str, Any]]:
    safe_uid = str(uid or "").strip()
    if not safe_uid:
        raise HTTPException(status_code=401, detail="Authentication required.")
    if _request_is_admin(request, safe_uid):
        existing = _user_profile_read(safe_uid)
        if isinstance(existing, dict):
            return existing
        return {"uid": safe_uid, "userId": "", "status": "admin"}
    profile = _user_profile_read(safe_uid)
    if isinstance(profile, dict) and str(profile.get("userId") or "").strip():
        return profile
    if not VF_USER_ID_REQUIRED:
        return _ensure_user_profile(safe_uid, request=request, allow_auto_backfill=True)
    if not VF_AUTH_ENFORCE:
        return _ensure_user_profile(safe_uid, request=request, allow_auto_backfill=True)
    raise HTTPException(
        status_code=428,
        detail="Complete your userId before using this feature.",
    )


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


def _constant_time_equal(left: str, right: str) -> bool:
    return hmac.compare_digest(str(left or "").encode("utf-8"), str(right or "").encode("utf-8"))


def _admin_unlock_now_ms() -> int:
    return int(time.time() * 1000)


def _admin_unlock_session_iat(request: Request) -> int:
    claims = getattr(request.state, "auth_claims", None)
    if isinstance(claims, dict):
        for key in ("iat", "auth_time", "issued_at"):
            value = claims.get(key)
            try:
                parsed = int(value)
            except Exception:
                parsed = 0
            if parsed > 0:
                if parsed > 10_000_000_000:
                    return parsed
                return parsed * 1000
    # Dev fallback keeps unlock records session-scoped enough for local testing.
    return 0


def _admin_unlock_record_id(uid: str, session_iat_ms: int) -> str:
    safe_uid = str(uid or "").strip().lower()
    seed = f"{safe_uid}:{int(session_iat_ms)}"
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return f"unlock_{digest[:40]}"


def _admin_unlock_collection():
    return _firestore_collection(ADMIN_SESSION_UNLOCK_COLLECTION)


def _admin_unlock_get_record(record_id: str) -> Optional[dict[str, Any]]:
    safe_id = str(record_id or "").strip()
    if not safe_id:
        return None
    collection = _admin_unlock_collection()
    if collection is None:
        with _INMEMORY_LOCK:
            row = _INMEMORY_ADMIN_SESSION_UNLOCK.get(safe_id)
            return dict(row) if isinstance(row, dict) else None
    try:
        doc = collection.document(safe_id).get()
    except Exception:
        return None
    if not bool(getattr(doc, "exists", False)):
        return None
    return {**(doc.to_dict() or {}), "recordId": safe_id}


def _admin_unlock_set_record(record_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    safe_id = str(record_id or "").strip()
    if not safe_id:
        raise HTTPException(status_code=400, detail="Invalid unlock session id.")
    row = dict(payload or {})
    row["recordId"] = safe_id
    collection = _admin_unlock_collection()
    if collection is None:
        with _INMEMORY_LOCK:
            _INMEMORY_ADMIN_SESSION_UNLOCK[safe_id] = dict(row)
        return row
    collection.document(safe_id).set(row, merge=True)
    return row


def _admin_unlock_hash_value(*, salt: str, unlock_key: str) -> str:
    payload = f"{str(salt or '').strip()}:{str(unlock_key or '').strip()}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _admin_unlock_build_token(uid: str, session_iat_ms: int, expires_at_ms: int) -> str:
    body = {
        "uid": str(uid or "").strip(),
        "sessionIatMs": int(session_iat_ms),
        "expMs": int(expires_at_ms),
        "iatMs": _admin_unlock_now_ms(),
        "nonce": secrets.token_hex(8),
    }
    body_raw = json.dumps(body, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode("utf-8")
    body_b64 = base64.urlsafe_b64encode(body_raw).decode("ascii").rstrip("=")
    signature_raw = hmac.new(
        VF_ADMIN_UNLOCK_SIGNING_SECRET.encode("utf-8"),
        body_b64.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    signature_b64 = base64.urlsafe_b64encode(signature_raw).decode("ascii").rstrip("=")
    return f"{body_b64}.{signature_b64}"


def _admin_unlock_parse_token(token: str) -> dict[str, Any]:
    safe_token = str(token or "").strip()
    if "." not in safe_token:
        raise HTTPException(status_code=403, detail="Invalid admin unlock token.")
    body_b64, signature_b64 = safe_token.split(".", 1)
    expected_raw = hmac.new(
        VF_ADMIN_UNLOCK_SIGNING_SECRET.encode("utf-8"),
        body_b64.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    expected_b64 = base64.urlsafe_b64encode(expected_raw).decode("ascii").rstrip("=")
    if not _constant_time_equal(signature_b64, expected_b64):
        raise HTTPException(status_code=403, detail="Invalid admin unlock signature.")
    padded = body_b64 + ("=" * ((4 - len(body_b64) % 4) % 4))
    try:
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=403, detail="Malformed admin unlock token.") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=403, detail="Malformed admin unlock token.")
    return payload


def _admin_unlock_extract_bearer(request: Request) -> str:
    header_value = str(request.headers.get("x-admin-unlock") or "").strip()
    if not header_value:
        raise HTTPException(status_code=403, detail="Missing X-Admin-Unlock header.")
    if not header_value.lower().startswith("bearer "):
        raise HTTPException(status_code=403, detail="X-Admin-Unlock must be a bearer token.")
    token = header_value.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=403, detail="Missing admin unlock bearer token.")
    return token


def _admin_unlock_issue_for_request(request: Request, uid: str) -> dict[str, Any]:
    safe_uid = str(uid or "").strip()
    session_iat_ms = _admin_unlock_session_iat(request)
    now_ms = _admin_unlock_now_ms()
    key_expires_at_ms = now_ms + (VF_ADMIN_UNLOCK_KEY_TTL_SECONDS * 1000)
    unlock_key = "".join(
        secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        for _ in range(10)
    )
    key_salt = secrets.token_hex(16)
    record_id = _admin_unlock_record_id(safe_uid, session_iat_ms)
    payload = {
        "uid": safe_uid,
        "sessionIatMs": int(session_iat_ms),
        "keySalt": key_salt,
        "keyHash": _admin_unlock_hash_value(salt=key_salt, unlock_key=unlock_key),
        "keyIssuedAtMs": now_ms,
        "keyExpiresAtMs": key_expires_at_ms,
        "unlockExpiresAtMs": 0,
        "failedAttempts": 0,
        "lockedUntilMs": 0,
        "lastVerifiedAtMs": 0,
        "updatedAtMs": now_ms,
    }
    _admin_unlock_set_record(record_id, payload)
    return {
        "recordId": record_id,
        "unlockKey": unlock_key,
        "keyExpiresAtMs": key_expires_at_ms,
        "keyExpiresAt": datetime.fromtimestamp(key_expires_at_ms / 1000, tz=timezone.utc).isoformat(),
    }


def _admin_unlock_status_for_request(request: Request, uid: str) -> dict[str, Any]:
    safe_uid = str(uid or "").strip()
    session_iat_ms = _admin_unlock_session_iat(request)
    now_ms = _admin_unlock_now_ms()
    record_id = _admin_unlock_record_id(safe_uid, session_iat_ms)
    row = _admin_unlock_get_record(record_id) or {}
    locked_until_ms = int(row.get("lockedUntilMs") or 0)
    unlock_expires_at_ms = int(row.get("unlockExpiresAtMs") or 0)
    key_expires_at_ms = int(row.get("keyExpiresAtMs") or 0)
    failed_attempts = max(0, int(row.get("failedAttempts") or 0))
    return {
        "recordId": record_id,
        "hasIssuedKey": bool(key_expires_at_ms > 0),
        "isLocked": locked_until_ms > now_ms,
        "lockedUntilMs": locked_until_ms,
        "lockedUntil": datetime.fromtimestamp(locked_until_ms / 1000, tz=timezone.utc).isoformat() if locked_until_ms > 0 else "",
        "isUnlocked": unlock_expires_at_ms > now_ms,
        "unlockExpiresAtMs": unlock_expires_at_ms,
        "unlockExpiresAt": datetime.fromtimestamp(unlock_expires_at_ms / 1000, tz=timezone.utc).isoformat() if unlock_expires_at_ms > 0 else "",
        "keyExpiresAtMs": key_expires_at_ms,
        "keyExpiresAt": datetime.fromtimestamp(key_expires_at_ms / 1000, tz=timezone.utc).isoformat() if key_expires_at_ms > 0 else "",
        "failedAttempts": failed_attempts,
        "attemptsRemaining": max(0, VF_ADMIN_UNLOCK_MAX_ATTEMPTS - failed_attempts),
    }


def _admin_unlock_verify_for_request(
    request: Request,
    *,
    uid: str,
    unlock_key: str,
) -> dict[str, Any]:
    safe_uid = str(uid or "").strip()
    safe_unlock_key = str(unlock_key or "").strip().upper()
    if not safe_unlock_key:
        raise HTTPException(status_code=400, detail="unlockKey is required.")
    session_iat_ms = _admin_unlock_session_iat(request)
    now_ms = _admin_unlock_now_ms()
    record_id = _admin_unlock_record_id(safe_uid, session_iat_ms)
    row = _admin_unlock_get_record(record_id)
    if not isinstance(row, dict):
        raise HTTPException(status_code=404, detail="No unlock key issued for this session.")
    if str(row.get("uid") or "").strip() != safe_uid:
        raise HTTPException(status_code=403, detail="Unlock session UID mismatch.")
    if int(row.get("sessionIatMs") or 0) != int(session_iat_ms):
        raise HTTPException(status_code=403, detail="Unlock session mismatch.")
    locked_until_ms = int(row.get("lockedUntilMs") or 0)
    if locked_until_ms > now_ms:
        raise HTTPException(status_code=429, detail="Unlock session is temporarily locked.")
    key_expires_at_ms = int(row.get("keyExpiresAtMs") or 0)
    if key_expires_at_ms <= now_ms:
        raise HTTPException(status_code=400, detail="Unlock key has expired. Issue a new key.")

    key_salt = str(row.get("keySalt") or "").strip()
    expected_hash = str(row.get("keyHash") or "").strip()
    provided_hash = _admin_unlock_hash_value(salt=key_salt, unlock_key=safe_unlock_key)
    is_valid = bool(expected_hash) and _constant_time_equal(provided_hash, expected_hash)
    failed_attempts = max(0, int(row.get("failedAttempts") or 0))
    if not is_valid:
        failed_attempts += 1
        next_locked_until = 0
        if failed_attempts >= VF_ADMIN_UNLOCK_MAX_ATTEMPTS:
            next_locked_until = now_ms + (VF_ADMIN_UNLOCK_LOCKOUT_SECONDS * 1000)
            failed_attempts = 0
        row["failedAttempts"] = failed_attempts
        row["lockedUntilMs"] = next_locked_until
        row["updatedAtMs"] = now_ms
        _admin_unlock_set_record(record_id, row)
        raise HTTPException(status_code=403, detail="Invalid unlock key.")

    unlock_expires_at_ms = now_ms + (VF_ADMIN_UNLOCK_TTL_SECONDS * 1000)
    row["failedAttempts"] = 0
    row["lockedUntilMs"] = 0
    row["lastVerifiedAtMs"] = now_ms
    row["unlockExpiresAtMs"] = unlock_expires_at_ms
    row["updatedAtMs"] = now_ms
    _admin_unlock_set_record(record_id, row)
    unlock_token = _admin_unlock_build_token(
        uid=safe_uid,
        session_iat_ms=session_iat_ms,
        expires_at_ms=unlock_expires_at_ms,
    )
    return {
        "unlockToken": unlock_token,
        "expiresAtMs": unlock_expires_at_ms,
        "expiresAt": datetime.fromtimestamp(unlock_expires_at_ms / 1000, tz=timezone.utc).isoformat(),
    }


def _require_admin_mutation_unlock(request: Request, *, expected_uid: Optional[str] = None) -> str:
    safe_uid = str(expected_uid or "").strip() or _require_request_uid(request)
    if not VF_AUTH_ENFORCE and not VF_IS_PRODUCTION:
        return safe_uid
    token = _admin_unlock_extract_bearer(request)
    payload = _admin_unlock_parse_token(token)
    token_uid = str(payload.get("uid") or "").strip()
    token_session_iat_ms = int(payload.get("sessionIatMs") or 0)
    token_exp_ms = int(payload.get("expMs") or 0)
    now_ms = _admin_unlock_now_ms()
    if token_exp_ms <= now_ms:
        raise HTTPException(status_code=403, detail="Admin unlock token expired.")
    if token_uid != safe_uid:
        raise HTTPException(status_code=403, detail="Admin unlock token UID mismatch.")
    session_iat_ms = _admin_unlock_session_iat(request)
    if int(token_session_iat_ms) != int(session_iat_ms):
        raise HTTPException(status_code=403, detail="Admin unlock token session mismatch.")
    record_id = _admin_unlock_record_id(safe_uid, session_iat_ms)
    row = _admin_unlock_get_record(record_id)
    if not isinstance(row, dict):
        raise HTTPException(status_code=403, detail="Admin unlock session not found.")
    unlock_expires_at_ms = int(row.get("unlockExpiresAtMs") or 0)
    if unlock_expires_at_ms <= now_ms:
        raise HTTPException(status_code=403, detail="Admin unlock session expired.")
    return safe_uid


def _rbac_default_permissions_for_role(role: str) -> set[str]:
    safe_role = str(role or "").strip().lower()
    return set(RBAC_ROLE_PERMISSION_MAP.get(safe_role) or set())


def _rbac_normalize_role(role: str) -> str:
    safe_role = str(role or "").strip().lower()
    if safe_role in RBAC_ROLES:
        return safe_role
    return RBAC_ROLE_READ_ONLY_OPS


def _rbac_normalize_status(status: str) -> str:
    safe = str(status or "").strip().lower()
    if safe in {"active", "disabled"}:
        return safe
    return "active"


def _rbac_normalize_overrides(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    normalized: list[str] = []
    for token in values:
        item = str(token or "").strip().lower()
        if item in RBAC_PERMISSIONS and item not in normalized:
            normalized.append(item)
    return normalized


def _rbac_cache_get(uid: str) -> Optional[dict[str, Any]]:
    safe_uid = str(uid or "").strip()
    if not safe_uid:
        return None
    now = _ai_ops_now_ms()
    with _RBAC_CACHE_LOCK:
        item = _RBAC_ACTOR_CACHE.get(safe_uid)
        if not isinstance(item, dict):
            return None
        expires_at = int(item.get("expiresAtMs") or 0)
        if expires_at <= now:
            _RBAC_ACTOR_CACHE.pop(safe_uid, None)
            return None
        return dict(item)


def _rbac_cache_put(uid: str, actor: dict[str, Any]) -> None:
    safe_uid = str(uid or "").strip()
    if not safe_uid:
        return
    payload = dict(actor or {})
    payload["expiresAtMs"] = _ai_ops_now_ms() + 60_000
    with _RBAC_CACHE_LOCK:
        _RBAC_ACTOR_CACHE[safe_uid] = payload


def _rbac_invalidate_cache(uid: str) -> None:
    safe_uid = str(uid or "").strip()
    if not safe_uid:
        return
    with _RBAC_CACHE_LOCK:
        _RBAC_ACTOR_CACHE.pop(safe_uid, None)


def _rbac_load_assignment(uid: str) -> Optional[dict[str, Any]]:
    safe_uid = str(uid or "").strip()
    if not safe_uid:
        return None
    collection = _firestore_collection(ADMIN_ROLES_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            row = _INMEMORY_ADMIN_ROLES.get(safe_uid)
            return dict(row) if isinstance(row, dict) else None
    try:
        doc = collection.document(safe_uid).get()
    except Exception:
        return None
    if not doc.exists:
        return None
    payload = doc.to_dict() or {}
    payload["uid"] = safe_uid
    return payload


def _rbac_write_assignment(uid: str, payload: dict[str, Any]) -> dict[str, Any]:
    safe_uid = str(uid or "").strip()
    if not safe_uid:
        raise HTTPException(status_code=400, detail="Missing target uid.")
    current = _rbac_load_assignment(safe_uid) or {}
    now_iso = _utc_now().isoformat()
    version = int(current.get("version") or 0) + 1
    row = {
        "uid": safe_uid,
        "role": _rbac_normalize_role(str(payload.get("role") or current.get("role") or RBAC_ROLE_READ_ONLY_OPS)),
        "allowOverrides": _rbac_normalize_overrides(
            payload.get("allowOverrides") if payload.get("allowOverrides") is not None else current.get("allowOverrides")
        ),
        "denyOverrides": _rbac_normalize_overrides(
            payload.get("denyOverrides") if payload.get("denyOverrides") is not None else current.get("denyOverrides")
        ),
        "status": _rbac_normalize_status(str(payload.get("status") or current.get("status") or "active")),
        "version": version,
        "updatedAt": now_iso,
        "updatedBy": str(payload.get("updatedBy") or current.get("updatedBy") or "").strip(),
    }
    collection = _firestore_collection(ADMIN_ROLES_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            _INMEMORY_ADMIN_ROLES[safe_uid] = dict(row)
    else:
        try:
            collection.document(safe_uid).set(row, merge=True)
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"Failed to write RBAC assignment: {exc}") from exc
    _rbac_invalidate_cache(safe_uid)
    return row


def _rbac_bootstrap_actor(uid: str, request: Request) -> Optional[dict[str, Any]]:
    safe_uid = str(uid or "").strip()
    if not safe_uid:
        return None
    if _request_claim_is_admin(request) or safe_uid in VF_ADMIN_APPROVER_UIDS or _firestore_user_is_admin(safe_uid):
        role = RBAC_ROLE_SUPER_ADMIN
    elif not VF_AUTH_ENFORCE and safe_uid.startswith("local_admin"):
        role = RBAC_ROLE_SUPER_ADMIN
    else:
        return None
    return {
        "uid": safe_uid,
        "role": role,
        "permissions": sorted(_rbac_default_permissions_for_role(role)),
        "status": "active",
        "version": 0,
        "source": "legacy_bootstrap",
    }


def _resolve_actor(uid: str, request: Request) -> dict[str, Any]:
    safe_uid = str(uid or "").strip()
    if not safe_uid:
        raise HTTPException(status_code=401, detail="Authentication required.")
    def _with_identity(actor_payload: dict[str, Any]) -> dict[str, Any]:
        payload = dict(actor_payload or {})
        # Permission checks must stay read-only; profile auto-backfill belongs to explicit profile flows.
        payload["userId"] = _resolve_request_user_id_read_only(safe_uid)
        return payload
    if not VF_RBAC_ENABLED:
        if _request_is_admin(request, safe_uid):
            return _with_identity({
                "uid": safe_uid,
                "role": RBAC_ROLE_SUPER_ADMIN,
                "permissions": sorted(RBAC_PERMISSIONS),
                "status": "active",
                "version": 0,
                "source": "rbac_disabled_admin",
            })
        return _with_identity({
            "uid": safe_uid,
            "role": RBAC_ROLE_READ_ONLY_OPS,
            "permissions": [],
            "status": "disabled",
            "version": 0,
            "source": "rbac_disabled_non_admin",
        })
    cached = _rbac_cache_get(safe_uid)
    if isinstance(cached, dict):
        return _with_identity({key: value for key, value in cached.items() if key != "expiresAtMs"})
    assignment = _rbac_load_assignment(safe_uid)
    if isinstance(assignment, dict):
        role = _rbac_normalize_role(str(assignment.get("role") or ""))
        deny = _rbac_normalize_overrides(assignment.get("denyOverrides"))
        allow = _rbac_normalize_overrides(assignment.get("allowOverrides"))
        permissions = _rbac_default_permissions_for_role(role)
        permissions.update(allow)
        permissions.difference_update(set(deny))
        actor = {
            "uid": safe_uid,
            "role": role,
            "permissions": sorted(permissions),
            "status": _rbac_normalize_status(str(assignment.get("status") or "active")),
            "version": int(assignment.get("version") or 0),
            "source": "admin_roles",
            "allowOverrides": allow,
            "denyOverrides": deny,
        }
        _rbac_cache_put(safe_uid, actor)
        return _with_identity(actor)
    bootstrap = _rbac_bootstrap_actor(safe_uid, request)
    if bootstrap is not None:
        _rbac_cache_put(safe_uid, bootstrap)
        return _with_identity(bootstrap)
    actor = {
        "uid": safe_uid,
        "role": RBAC_ROLE_READ_ONLY_OPS,
        "permissions": [],
        "status": "disabled",
        "version": 0,
        "source": "unassigned",
    }
    _rbac_cache_put(safe_uid, actor)
    return _with_identity(actor)


def _has_permission(actor: dict[str, Any], permission: str) -> bool:
    safe_permission = str(permission or "").strip().lower()
    if safe_permission not in RBAC_PERMISSIONS:
        return False
    if str(actor.get("status") or "active").strip().lower() == "disabled":
        return False
    role = _rbac_normalize_role(str(actor.get("role") or ""))
    if role == RBAC_ROLE_SUPER_ADMIN:
        return True
    deny = set(_rbac_normalize_overrides(actor.get("denyOverrides")))
    if safe_permission in deny:
        return False
    allow = set(_rbac_normalize_overrides(actor.get("allowOverrides")))
    permissions = set(actor.get("permissions") or [])
    if safe_permission in allow:
        return True
    return safe_permission in permissions


def _require_permission(request: Request, permission: str) -> tuple[str, dict[str, Any]]:
    uid = _require_request_uid(request)
    actor = _resolve_actor(uid, request)
    if _has_permission(actor, permission):
        request.state.actor = actor
        return uid, actor
    if not VF_RBAC_ENFORCE and _request_is_admin(request, uid):
        fallback_actor = {
            "uid": uid,
            "role": RBAC_ROLE_SUPER_ADMIN,
            "permissions": sorted(RBAC_PERMISSIONS),
            "status": "active",
            "version": int(actor.get("version") or 0),
            "source": "legacy_admin_fallback",
        }
        request.state.actor = fallback_actor
        return uid, fallback_actor
    raise HTTPException(status_code=403, detail=f"Missing permission: {permission}")


def _rbac_roles_payload() -> dict[str, Any]:
    return {
        "ok": True,
        "roles": sorted(RBAC_ROLES),
        "permissions": sorted(RBAC_PERMISSIONS),
        "matrix": {
            role: sorted(_rbac_default_permissions_for_role(role))
            for role in sorted(RBAC_ROLES)
        },
    }


def _rbac_list_assignments(limit: int = 100, cursor: str = "", q: str = "") -> tuple[list[dict[str, Any]], Optional[str]]:
    safe_limit = max(1, min(200, int(limit)))
    safe_cursor = str(cursor or "").strip()
    needle = str(q or "").strip().lower()
    rows: list[dict[str, Any]] = []
    next_cursor: Optional[str] = None
    collection = _firestore_collection(ADMIN_ROLES_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            keys = sorted(_INMEMORY_ADMIN_ROLES.keys())
            if safe_cursor:
                keys = [key for key in keys if key > safe_cursor]
            for uid in keys:
                row = _INMEMORY_ADMIN_ROLES.get(uid)
                if not isinstance(row, dict):
                    continue
                user_id = _user_id_for_uid(uid).lower()
                if needle and needle not in uid.lower() and needle not in str(row.get("role") or "").lower() and needle not in user_id:
                    continue
                item = dict(row)
                item["userId"] = user_id
                rows.append(item)
                if len(rows) >= safe_limit:
                    break
            if len(rows) == safe_limit:
                next_cursor = str(rows[-1].get("uid") or "")
        return rows, next_cursor
    try:
        docs = list(collection.limit(max(20, safe_limit * 3)).stream())
    except Exception:
        docs = []
    docs.sort(key=lambda doc: str(doc.id or ""))
    for doc in docs:
        uid = str(doc.id or "").strip()
        if not uid:
            continue
        if safe_cursor and uid <= safe_cursor:
            continue
        row = doc.to_dict() or {}
        row["uid"] = uid
        role_token = str(row.get("role") or "").lower()
        user_id = _user_id_for_uid(uid).lower()
        if needle and needle not in uid.lower() and needle not in role_token and needle not in user_id:
            continue
        row["userId"] = user_id
        rows.append(row)
        if len(rows) >= safe_limit:
            break
    if len(rows) == safe_limit:
        next_cursor = str(rows[-1].get("uid") or "")
    return rows, next_cursor


def _firestore_collection(name: str) -> Any:
    if _FIRESTORE_DB is None:
        return None
    return _FIRESTORE_DB.collection(name)


def _normalize_entitlement_wallet(entitlement: dict[str, Any], now: Optional[datetime] = None) -> dict[str, Any]:
    current = now or _utc_now()
    month_key = _wallet_month_key(current)
    normalized = dict(entitlement or {})
    normalized["paidVfBalance"] = _as_positive_number(normalized.get("paidVfBalance"))
    saved_month = str(normalized.get("vffMonthKey") or "").strip()
    if saved_month != month_key:
        normalized["vffBalance"] = 0.0
        normalized["vffMonthKey"] = month_key
    else:
        normalized["vffBalance"] = _as_positive_number(normalized.get("vffBalance"))
        normalized["vffMonthKey"] = saved_month or month_key
    return normalized


def _monthly_free_remaining(entitlement: dict[str, Any], monthly: dict[str, Any]) -> float:
    monthly_limit = _as_positive_number(entitlement.get("monthlyVfLimit"))
    monthly_free_used = _as_positive_number(monthly.get("monthlyFreeVfUsed"))
    return _as_positive_number(monthly_limit - monthly_free_used)


def _wallet_spendable_now(entitlement: dict[str, Any], monthly: dict[str, Any], engine: str) -> float:
    safe_engine = str(engine or "").strip().upper()
    monthly_remaining = _monthly_free_remaining(entitlement, monthly)
    paid_balance = _as_positive_number(entitlement.get("paidVfBalance"))
    vff_balance = _as_positive_number(entitlement.get("vffBalance"))
    if safe_engine not in TTS_ENGINE_KEYS:
        return _as_positive_number(monthly_remaining + paid_balance)
    return _as_positive_number(monthly_remaining + vff_balance + paid_balance)


def _wallet_charge_breakdown(
    entitlement: dict[str, Any],
    monthly: dict[str, Any],
    engine: str,
    vf_cost: float,
) -> dict[str, float]:
    remaining = _as_positive_number(vf_cost)
    breakdown: dict[str, float] = {"vff": 0.0, "monthlyVf": 0.0, "paidVf": 0.0}
    if remaining <= 0:
        return breakdown
    monthly_remaining = _monthly_free_remaining(entitlement, monthly)
    paid_balance = _as_positive_number(entitlement.get("paidVfBalance"))
    vff_balance = _as_positive_number(entitlement.get("vffBalance"))

    def spend(bucket: str, available: float) -> None:
        nonlocal remaining
        if remaining <= 0:
            return
        use = min(_as_positive_number(available), remaining)
        if use <= 0:
            return
        breakdown[bucket] = _as_positive_number(use)
        remaining = _as_positive_number(remaining - use)

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
        patch["paidVfBalance"] = _as_positive_number(patch.get("paidVfBalance"))
    if "vffBalance" in patch:
        patch["vffBalance"] = _as_positive_number(patch.get("vffBalance"))
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
    def _empty_by_engine() -> dict[str, dict[str, Any]]:
        return {
            engine: {"chars": 0, "vf": 0.0}
            for engine in TTS_ENGINE_KEYS
        }
    monthly = {
        "uid": uid,
        "periodKey": _usage_month_period_label(current),
        "vfUsed": 0.0,
        "monthlyFreeVfUsed": 0.0,
        "generationCount": 0,
        "byEngine": _empty_by_engine(),
        "updatedAt": current.isoformat(),
    }
    daily = {
        "uid": uid,
        "periodKey": _usage_day_period_label(current),
        "vfUsed": 0.0,
        "generationCount": 0,
        "byEngine": _empty_by_engine(),
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

            monthly.setdefault("monthlyFreeVfUsed", _as_positive_number(monthly.get("monthlyFreeVfUsed")))

            plan_cfg = _plan_config(_normalize_plan_name(str(entitlement.get("plan") or "Free")))
            daily_limit = _as_positive_int(entitlement.get("dailyGenerationLimit") or plan_cfg["dailyGenerationLimit"])
            rate = _engine_rate(safe_engine)
            vf_cost = _as_positive_number(float(safe_chars) * float(rate))

            if not bypass_limits and _as_positive_int(daily.get("generationCount")) + 1 > daily_limit:
                raise HTTPException(status_code=429, detail="Daily generation limit reached.")

            charge_breakdown = _wallet_charge_breakdown(entitlement, monthly, safe_engine, vf_cost)
            covered = (
                _as_positive_number(charge_breakdown.get("vff"))
                + _as_positive_number(charge_breakdown.get("monthlyVf"))
                + _as_positive_number(charge_breakdown.get("paidVf"))
            )
            if not bypass_limits and covered + VF_EPSILON < vf_cost:
                raise HTTPException(status_code=429, detail="Insufficient VF balance for this generation.")

            entitlement["vffBalance"] = _as_positive_number(
                _as_positive_number(entitlement.get("vffBalance")) - _as_positive_number(charge_breakdown.get("vff"))
            )
            entitlement["paidVfBalance"] = _as_positive_number(
                _as_positive_number(entitlement.get("paidVfBalance")) - _as_positive_number(charge_breakdown.get("paidVf"))
            )
            entitlement["updatedAt"] = now.isoformat()

            monthly["vfUsed"] = _as_positive_number(_as_positive_number(monthly.get("vfUsed")) + vf_cost)
            monthly["monthlyFreeVfUsed"] = _as_positive_number(
                _as_positive_number(monthly.get("monthlyFreeVfUsed")) + _as_positive_number(charge_breakdown.get("monthlyVf"))
            )
            monthly["generationCount"] = _as_positive_int(monthly.get("generationCount")) + 1
            monthly_engine = dict((monthly.get("byEngine") or {}).get(safe_engine) or {})
            monthly_engine["chars"] = _as_positive_int(monthly_engine.get("chars")) + safe_chars
            monthly_engine["vf"] = _as_positive_number(_as_positive_number(monthly_engine.get("vf")) + vf_cost)
            monthly.setdefault("byEngine", {})[safe_engine] = monthly_engine
            monthly["updatedAt"] = now.isoformat()

            daily["vfUsed"] = _as_positive_number(_as_positive_number(daily.get("vfUsed")) + vf_cost)
            daily["generationCount"] = _as_positive_int(daily.get("generationCount")) + 1
            daily_engine = dict((daily.get("byEngine") or {}).get(safe_engine) or {})
            daily_engine["chars"] = _as_positive_int(daily_engine.get("chars")) + safe_chars
            daily_engine["vf"] = _as_positive_number(_as_positive_number(daily_engine.get("vf")) + vf_cost)
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
                    "vff": _as_positive_number(charge_breakdown.get("vff")),
                    "monthlyVf": _as_positive_number(charge_breakdown.get("monthlyVf")),
                    "paidVf": _as_positive_number(charge_breakdown.get("paidVf")),
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
        rate = _engine_rate(safe_engine)
        vf_cost = _as_positive_number(float(safe_chars) * float(rate))

        monthly_doc = monthly_ref.get(transaction=transaction_obj)
        daily_doc = daily_ref.get(transaction=transaction_obj)
        default_monthly, default_daily = _usage_defaults(uid, now)
        monthly = {**default_monthly, **(monthly_doc.to_dict() or {})} if monthly_doc.exists else {**default_monthly}
        daily = {**default_daily, **(daily_doc.to_dict() or {})} if daily_doc.exists else {**default_daily}
        monthly.setdefault("monthlyFreeVfUsed", _as_positive_number(monthly.get("monthlyFreeVfUsed")))

        event_doc = event_ref.get(transaction=transaction_obj)
        if event_doc.exists:
            existing_event = event_doc.to_dict() or {}
            if str(existing_event.get("status")) in {"reserved", "committed"}:
                return {"ok": True, "alreadyReserved": True, "event": existing_event, "monthly": monthly, "daily": daily, "entitlement": entitlement}
        if not bypass_limits and _as_positive_int(daily.get("generationCount")) + 1 > daily_limit:
            raise RuntimeError("Daily generation limit reached.")

        charge_breakdown = _wallet_charge_breakdown(entitlement, monthly, safe_engine, vf_cost)
        covered = (
            _as_positive_number(charge_breakdown.get("vff"))
            + _as_positive_number(charge_breakdown.get("monthlyVf"))
            + _as_positive_number(charge_breakdown.get("paidVf"))
        )
        if not bypass_limits and covered + VF_EPSILON < vf_cost:
            raise RuntimeError("Insufficient VF balance for this generation.")

        entitlement["vffBalance"] = _as_positive_number(
            _as_positive_number(entitlement.get("vffBalance")) - _as_positive_number(charge_breakdown.get("vff"))
        )
        entitlement["paidVfBalance"] = _as_positive_number(
            _as_positive_number(entitlement.get("paidVfBalance")) - _as_positive_number(charge_breakdown.get("paidVf"))
        )
        entitlement["updatedAt"] = now.isoformat()

        monthly["vfUsed"] = _as_positive_number(_as_positive_number(monthly.get("vfUsed")) + vf_cost)
        monthly["monthlyFreeVfUsed"] = _as_positive_number(
            _as_positive_number(monthly.get("monthlyFreeVfUsed")) + _as_positive_number(charge_breakdown.get("monthlyVf"))
        )
        monthly["generationCount"] = _as_positive_int(monthly.get("generationCount")) + 1
        monthly_engine = dict((monthly.get("byEngine") or {}).get(safe_engine) or {})
        monthly_engine["chars"] = _as_positive_int(monthly_engine.get("chars")) + safe_chars
        monthly_engine["vf"] = _as_positive_number(_as_positive_number(monthly_engine.get("vf")) + vf_cost)
        monthly.setdefault("byEngine", {})[safe_engine] = monthly_engine
        monthly["updatedAt"] = now.isoformat()

        daily["vfUsed"] = _as_positive_number(_as_positive_number(daily.get("vfUsed")) + vf_cost)
        daily["generationCount"] = _as_positive_int(daily.get("generationCount")) + 1
        daily_engine = dict((daily.get("byEngine") or {}).get(safe_engine) or {})
        daily_engine["chars"] = _as_positive_int(daily_engine.get("chars")) + safe_chars
        daily_engine["vf"] = _as_positive_number(_as_positive_number(daily_engine.get("vf")) + vf_cost)
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
                "vff": _as_positive_number(charge_breakdown.get("vff")),
                "monthlyVf": _as_positive_number(charge_breakdown.get("monthlyVf")),
                "paidVf": _as_positive_number(charge_breakdown.get("paidVf")),
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
                vf_cost = _as_positive_number(event.get("vfCost"))
                chars = _as_positive_int(event.get("chars"))
                charge_breakdown = event.get("chargeBreakdown") if isinstance(event.get("chargeBreakdown"), dict) else {}
                refund_vff = _as_positive_number(charge_breakdown.get("vff"))
                refund_paid = _as_positive_number(charge_breakdown.get("paidVf"))
                refund_monthly = _as_positive_number(charge_breakdown.get("monthlyVf"))
                if monthly is not None:
                    monthly["vfUsed"] = _as_positive_number(_as_positive_number(monthly.get("vfUsed")) - vf_cost)
                    monthly["monthlyFreeVfUsed"] = _as_positive_number(
                        _as_positive_number(monthly.get("monthlyFreeVfUsed")) - refund_monthly
                    )
                    monthly["generationCount"] = max(0, _as_positive_int(monthly.get("generationCount")) - 1)
                    monthly_engine = dict((monthly.get("byEngine") or {}).get(engine) or {})
                    monthly_engine["vf"] = _as_positive_number(_as_positive_number(monthly_engine.get("vf")) - vf_cost)
                    monthly_engine["chars"] = max(0, _as_positive_int(monthly_engine.get("chars")) - chars)
                    monthly.setdefault("byEngine", {})[engine] = monthly_engine
                    monthly["updatedAt"] = now
                if daily is not None:
                    daily["vfUsed"] = _as_positive_number(_as_positive_number(daily.get("vfUsed")) - vf_cost)
                    daily["generationCount"] = max(0, _as_positive_int(daily.get("generationCount")) - 1)
                    daily_engine = dict((daily.get("byEngine") or {}).get(engine) or {})
                    daily_engine["vf"] = _as_positive_number(_as_positive_number(daily_engine.get("vf")) - vf_cost)
                    daily_engine["chars"] = max(0, _as_positive_int(daily_engine.get("chars")) - chars)
                    daily.setdefault("byEngine", {})[engine] = daily_engine
                    daily["updatedAt"] = now
                if refund_vff > 0 or refund_paid > 0:
                    entitlement["vffBalance"] = _as_positive_number(_as_positive_number(entitlement.get("vffBalance")) + refund_vff)
                    entitlement["paidVfBalance"] = _as_positive_number(
                        _as_positive_number(entitlement.get("paidVfBalance")) + refund_paid
                    )
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
        vf_cost = _as_positive_number(event.get("vfCost"))
        chars = _as_positive_int(event.get("chars"))
        charge_breakdown = event.get("chargeBreakdown") if isinstance(event.get("chargeBreakdown"), dict) else {}
        refund_vff = _as_positive_number(charge_breakdown.get("vff"))
        refund_paid = _as_positive_number(charge_breakdown.get("paidVf"))
        refund_monthly = _as_positive_number(charge_breakdown.get("monthlyVf"))
        if monthly_doc.exists:
            monthly = monthly_doc.to_dict() or {}
            monthly["vfUsed"] = _as_positive_number(_as_positive_number(monthly.get("vfUsed")) - vf_cost)
            monthly["monthlyFreeVfUsed"] = _as_positive_number(
                _as_positive_number(monthly.get("monthlyFreeVfUsed")) - refund_monthly
            )
            monthly["generationCount"] = max(0, _as_positive_int(monthly.get("generationCount")) - 1)
            monthly_engine = dict((monthly.get("byEngine") or {}).get(engine) or {})
            monthly_engine["vf"] = _as_positive_number(_as_positive_number(monthly_engine.get("vf")) - vf_cost)
            monthly_engine["chars"] = max(0, _as_positive_int(monthly_engine.get("chars")) - chars)
            monthly.setdefault("byEngine", {})[engine] = monthly_engine
            monthly["updatedAt"] = now
            transaction_obj.set(monthly_ref, monthly, merge=True)
        if daily_doc.exists:
            daily = daily_doc.to_dict() or {}
            daily["vfUsed"] = _as_positive_number(_as_positive_number(daily.get("vfUsed")) - vf_cost)
            daily["generationCount"] = max(0, _as_positive_int(daily.get("generationCount")) - 1)
            daily_engine = dict((daily.get("byEngine") or {}).get(engine) or {})
            daily_engine["vf"] = _as_positive_number(_as_positive_number(daily_engine.get("vf")) - vf_cost)
            daily_engine["chars"] = max(0, _as_positive_int(daily_engine.get("chars")) - chars)
            daily.setdefault("byEngine", {})[engine] = daily_engine
            daily["updatedAt"] = now
            transaction_obj.set(daily_ref, daily, merge=True)
        if refund_vff > 0 or refund_paid > 0:
            entitlement["vffBalance"] = _as_positive_number(_as_positive_number(entitlement.get("vffBalance")) + refund_vff)
            entitlement["paidVfBalance"] = _as_positive_number(
                _as_positive_number(entitlement.get("paidVfBalance")) + refund_paid
            )
            entitlement["updatedAt"] = now
            transaction_obj.set(entitlements_ref, entitlement, merge=True)
        transaction_obj.set(event_ref, {"status": "reverted", "updatedAt": now, "error": str(error_detail)}, merge=True)

    _apply(transaction)


def _entitlement_usage_payload(uid: str) -> dict[str, Any]:
    entitlement = _normalize_entitlement_wallet(_load_entitlement(uid))
    monthly, daily = _load_usage_windows(uid)
    monthly_used = _as_positive_number(monthly.get("vfUsed"))
    monthly_limit = _as_positive_int(entitlement.get("monthlyVfLimit"))
    monthly_free_used = _as_positive_number(monthly.get("monthlyFreeVfUsed"))
    daily_used = _as_positive_int(daily.get("generationCount"))
    daily_limit = _as_positive_int(entitlement.get("dailyGenerationLimit"))
    plan_name = _normalize_plan_name(str(entitlement.get("plan") or "Free"))
    month_key = _wallet_month_key()
    if str(entitlement.get("vffMonthKey") or "") != month_key:
        entitlement["vffBalance"] = 0.0
        entitlement["vffMonthKey"] = month_key
    vff_balance = _as_positive_number(entitlement.get("vffBalance"))
    paid_balance = _as_positive_number(entitlement.get("paidVfBalance"))
    monthly_free_remaining = _as_positive_number(float(monthly_limit) - monthly_free_used)
    ad_claims_today = _ad_claims_today(uid)
    month_start, month_end = _month_window_bounds()
    day_start, day_end = _day_window_bounds()
    plan_key = _plan_key_from_name(plan_name)
    guardrails = TTS_PLAN_GUARDRAILS.get(plan_key) or TTS_PLAN_GUARDRAILS["free"]
    allowed_engines = list(_plan_allowed_engines(plan_key))
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
            "vfUsed": _as_positive_number(daily.get("vfUsed")),
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
                engine: _wallet_spendable_now(entitlement, monthly, engine)
                for engine in TTS_ENGINE_KEYS
            },
            "adClaimsToday": ad_claims_today,
            "adClaimsDailyLimit": VF_AD_REWARD_CLAIM_LIMIT_PER_DAY,
            "vffMonthKey": str(entitlement.get("vffMonthKey") or month_key),
        },
        "limits": {
            "vfRates": {
                engine: _engine_rate(engine)
                for engine in TTS_ENGINE_KEYS
            },
            "monthlyPlanCaps": {
                str(cfg.get("plan") or key): _as_positive_int(cfg.get("monthlyVfLimit"))
                for key, cfg in PLAN_LIMITS.items()
            },
            "maxCharsPerGeneration": max(1, int(guardrails.get("maxChars") or 1)),
            "allowedEngines": allowed_engines,
        },
        "features": {
            "earlyAccess": _plan_has_early_access(plan_key),
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
    gpu: bool = False
    requireApproval: bool = True


class AiOpsApprovalDecisionRequest(BaseModel):
    approved: bool = True
    note: Optional[str] = None


class FrontendErrorReportRequest(BaseModel):
    message: str
    route: Optional[str] = None
    component: Optional[str] = None
    severity: str = "error"
    stack: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class LoadLlvcModelRequest(BaseModel):
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
    couponCode: Optional[str] = None


class BillingPortalSessionRequest(BaseModel):
    returnUrl: Optional[str] = None


class BillingTokenPackCheckoutSessionRequest(BaseModel):
    pack: Optional[str] = "standard"
    successUrl: Optional[str] = None
    cancelUrl: Optional[str] = None


class CouponCreateRequest(BaseModel):
    code: Optional[str] = None
    couponType: Optional[str] = None
    creditVf: Optional[int] = None
    expiresAt: Optional[str] = None
    usagePolicy: Optional[str] = None
    usageLimit: Optional[int] = None
    maxRedemptions: Optional[int] = None  # legacy alias
    discountType: Optional[str] = None
    percentOff: Optional[float] = None
    amountOffInr: Optional[int] = None
    appliesToPlans: Optional[list[str]] = None
    planDiscounts: Optional[list[dict[str, Any]]] = None
    active: bool = True
    note: Optional[str] = None


class CouponPatchRequest(BaseModel):
    code: Optional[str] = None
    couponType: Optional[str] = None
    creditVf: Optional[int] = None
    active: Optional[bool] = None
    expiresAt: Optional[str] = None
    usagePolicy: Optional[str] = None
    usageLimit: Optional[int] = None
    maxRedemptions: Optional[int] = None
    discountType: Optional[str] = None
    percentOff: Optional[float] = None
    amountOffInr: Optional[int] = None
    appliesToPlans: Optional[list[str]] = None
    planDiscounts: Optional[list[dict[str, Any]]] = None
    note: Optional[str] = None


class CouponRedeemRequest(BaseModel):
    code: str


class AdminUserPatchRequest(BaseModel):
    plan: Optional[str] = None
    paidVfDelta: Optional[float] = None
    vffDelta: Optional[float] = None
    disabled: Optional[bool] = None


class AdminResetPasswordRequest(BaseModel):
    newPassword: str


class AdminRoleAssignmentRequest(BaseModel):
    role: str
    allowOverrides: Optional[list[str]] = None
    denyOverrides: Optional[list[str]] = None
    status: Optional[str] = None


class AdminRoleStatusRequest(BaseModel):
    note: Optional[str] = None


class UserProfileUpsertRequest(BaseModel):
    userId: str
    displayName: Optional[str] = None


class AdminForceUserIdChangeRequest(BaseModel):
    userId: str
    reason: Optional[str] = None


class TeamCreateRequest(BaseModel):
    name: str
    slug: str
    ownerUid: str
    seatLimit: int = 5
    status: str = "active"


class TeamPatchRequest(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    ownerUid: Optional[str] = None
    seatLimit: Optional[int] = None
    status: Optional[str] = None


class TeamMemberCreateRequest(BaseModel):
    uid: str
    role: str = "member"
    status: str = "active"


class TeamMemberPatchRequest(BaseModel):
    role: Optional[str] = None
    status: Optional[str] = None


class SupportMessageCreateRequest(BaseModel):
    text: str
    conversationId: Optional[str] = None
    attachmentsMeta: Optional[list[dict[str, Any]]] = None


class SupportReplyRequest(BaseModel):
    text: str


class SupportAiPolicyPatchRequest(BaseModel):
    enabled: Optional[bool] = None
    confidenceThreshold: Optional[float] = None
    maxAutoRepliesPerConversation: Optional[int] = None
    allowedActions: Optional[list[str]] = None
    blockedTopics: Optional[list[str]] = None
    requireHumanForTags: Optional[list[str]] = None


class AdminSessionUnlockVerifyRequest(BaseModel):
    unlockKey: str


class AlertPolicyCreateRequest(BaseModel):
    name: str
    metricKey: str
    operator: str = "gt"
    threshold: float
    windowSec: int = 300
    cooldownSec: int = 300
    severity: str = "warning"
    enabled: bool = True
    channels: Optional[list[str]] = None


class AlertPolicyPatchRequest(BaseModel):
    name: Optional[str] = None
    metricKey: Optional[str] = None
    operator: Optional[str] = None
    threshold: Optional[float] = None
    windowSec: Optional[int] = None
    cooldownSec: Optional[int] = None
    severity: Optional[str] = None
    enabled: Optional[bool] = None
    channels: Optional[list[str]] = None


class AlertDestinationCreateRequest(BaseModel):
    type: str = "webhook"
    name: str
    url: str
    secretRef: Optional[str] = None
    enabled: bool = True


class AlertDestinationPatchRequest(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    secretRef: Optional[str] = None
    enabled: Optional[bool] = None


class AlertEventDecisionRequest(BaseModel):
    note: Optional[str] = None


class ScheduledTaskCreateRequest(BaseModel):
    taskType: str
    cronExpr: str
    timezone: str = "UTC"
    enabled: bool = True
    dryRun: bool = False
    payload: Optional[dict[str, Any]] = None
    concurrencyPolicy: str = "forbid"


class ScheduledTaskPatchRequest(BaseModel):
    cronExpr: Optional[str] = None
    timezone: Optional[str] = None
    enabled: Optional[bool] = None
    dryRun: Optional[bool] = None
    payload: Optional[dict[str, Any]] = None
    concurrencyPolicy: Optional[str] = None


class ScheduledTaskRunRequest(BaseModel):
    dryRun: Optional[bool] = None


class GeminiApiPoolsUpdateRequest(BaseModel):
    version: Optional[int] = None
    pools: dict[str, Any]
    fallbackChains: Optional[dict[str, Any]] = None
    planPools: Optional[dict[str, Any]] = None
    defaultFallbackChain: Optional[list[Any]] = None
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
    access_tier: Optional[str] = None
    is_plan_restricted: Optional[bool] = None


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
    integration = "gemini-runtime" if _is_gem_runtime_engine(engine_key) else "kokoro-runtime" if engine_key == "KOKORO" else "tts-runtime"
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


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, default=str)


def _hash_sha256_hex(value: str) -> str:
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()


def _request_ip_hash(request: Optional[Request]) -> str:
    if request is None:
        return ""
    forwarded = str(request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    raw_ip = forwarded or str(request.client.host if request.client else "")
    if not raw_ip:
        return ""
    return _hash_sha256_hex(raw_ip)


def _request_ua_hash(request: Optional[Request]) -> str:
    if request is None:
        return ""
    ua = str(request.headers.get("user-agent") or "").strip()
    if not ua:
        return ""
    return _hash_sha256_hex(ua)


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return float(default)


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return int(default)


def _truncate_text(value: Any, max_len: int = 320) -> str:
    return str(value or "").strip()[:max(0, int(max_len))]


def _normalize_iso_datetime(value: str, *, fallback: Optional[datetime] = None) -> datetime:
    parsed = _parse_optional_datetime(value)
    if parsed is not None:
        return parsed
    return fallback or _utc_now()


def _audit_state_read() -> dict[str, Any]:
    if not VF_AUDIT_LEDGER_ENABLED:
        return {"sequence": 0, "lastHash": AUDIT_GENESIS_HASH, "updatedAt": _utc_now().isoformat()}
    collection = _firestore_collection(AUDIT_LEDGER_STATE_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            state = dict(_INMEMORY_AUDIT_LEDGER_STATE or {})
        if not state:
            state = {"sequence": 0, "lastHash": AUDIT_GENESIS_HASH, "updatedAt": _utc_now().isoformat()}
        return state
    try:
        doc = collection.document("current").get()
    except Exception:
        return {"sequence": 0, "lastHash": AUDIT_GENESIS_HASH, "updatedAt": _utc_now().isoformat()}
    if not doc.exists:
        return {"sequence": 0, "lastHash": AUDIT_GENESIS_HASH, "updatedAt": _utc_now().isoformat()}
    payload = doc.to_dict() or {}
    return {
        "sequence": _safe_int(payload.get("sequence"), 0),
        "lastHash": str(payload.get("lastHash") or AUDIT_GENESIS_HASH),
        "updatedAt": str(payload.get("updatedAt") or _utc_now().isoformat()),
    }


def _audit_hash(payload_without_event_hash: dict[str, Any]) -> str:
    canonical = _canonical_json(payload_without_event_hash)
    return _hash_sha256_hex(canonical)


def _audit_append_event(
    *,
    action: str,
    resource_type: str,
    resource_id: str,
    before: Optional[dict[str, Any]] = None,
    after: Optional[dict[str, Any]] = None,
    meta: Optional[dict[str, Any]] = None,
    request: Optional[Request] = None,
    actor_uid: Optional[str] = None,
    actor_role: Optional[str] = None,
    actor_user_id: Optional[str] = None,
    subject_uid: str = "",
    subject_user_id: str = "",
    request_id: str = "",
) -> dict[str, Any]:
    if not VF_AUDIT_LEDGER_ENABLED:
        return {"ok": True, "disabled": True}
    safe_action = _truncate_text(action, 120)
    safe_resource_type = _truncate_text(resource_type, 80)
    safe_resource_id = _truncate_text(resource_id, 160)
    safe_actor_uid = _truncate_text(actor_uid or (_require_request_uid(request) if request is not None else ""), 160)
    safe_actor_role = _truncate_text(actor_role or "", 80)
    safe_actor_user_id = _truncate_text(actor_user_id or "", 64).lower()
    if not safe_actor_role and request is not None:
        actor = getattr(request.state, "actor", None)
        if isinstance(actor, dict):
            safe_actor_role = _truncate_text(actor.get("role"), 80)
    if not safe_actor_user_id:
        if request is not None:
            claim_uid = str(getattr(request.state, "uid", "") or "").strip()
            if claim_uid:
                safe_actor_user_id = _truncate_text(_resolve_request_user_id(request, claim_uid), 64).lower()
        if not safe_actor_user_id and safe_actor_uid:
            safe_actor_user_id = _truncate_text(_user_id_for_uid(safe_actor_uid), 64).lower()
    safe_subject_uid = _truncate_text(subject_uid, 160)
    safe_subject_user_id = _truncate_text(subject_user_id, 64).lower()
    if safe_subject_uid and not safe_subject_user_id:
        safe_subject_user_id = _truncate_text(_user_id_for_uid(safe_subject_uid), 64).lower()
    event_id = f"audit_{uuid.uuid4().hex}"
    now_iso = _utc_now().isoformat()
    safe_request_id = _truncate_text(request_id, 160) or _truncate_text(
        str(request.headers.get("x-request-id") or "") if request is not None else "", 160
    )

    collection = _firestore_collection(AUDIT_LEDGER_COLLECTION)
    state_collection = _firestore_collection(AUDIT_LEDGER_STATE_COLLECTION)
    if collection is None or state_collection is None or _FIRESTORE_DB is None or firebase_firestore is None:
        with _INMEMORY_LOCK:
            state = dict(_INMEMORY_AUDIT_LEDGER_STATE or {})
            sequence = _safe_int(state.get("sequence"), 0) + 1
            prev_hash = str(state.get("lastHash") or AUDIT_GENESIS_HASH)
            payload = {
                "eventId": event_id,
                "ts": now_iso,
                "actorUid": safe_actor_uid,
                "actorUserId": safe_actor_user_id,
                "actorRole": safe_actor_role,
                "subjectUid": safe_subject_uid,
                "subjectUserId": safe_subject_user_id,
                "action": safe_action,
                "resourceType": safe_resource_type,
                "resourceId": safe_resource_id,
                "requestId": safe_request_id,
                "ipHash": _request_ip_hash(request),
                "uaHash": _request_ua_hash(request),
                "before": before if isinstance(before, dict) else {},
                "after": after if isinstance(after, dict) else {},
                "meta": meta if isinstance(meta, dict) else {},
                "prevHash": prev_hash,
                "hashAlgo": AUDIT_HASH_ALGO,
                "sequence": sequence,
            }
            payload["eventHash"] = _audit_hash(payload)
            _INMEMORY_AUDIT_LEDGER_EVENTS[event_id] = dict(payload)
            _INMEMORY_AUDIT_LEDGER_ORDER.append(event_id)
            _INMEMORY_AUDIT_LEDGER_STATE.clear()
            _INMEMORY_AUDIT_LEDGER_STATE.update(
                {
                    "sequence": sequence,
                    "lastHash": payload["eventHash"],
                    "updatedAt": now_iso,
                }
            )
            return {"ok": True, "event": payload}

    state_ref = state_collection.document("current")
    event_ref = collection.document(event_id)
    transaction = _FIRESTORE_DB.transaction()

    @firebase_firestore.transactional
    def _apply(transaction_obj: Any) -> dict[str, Any]:
        state_doc = state_ref.get(transaction=transaction_obj)
        state_payload = state_doc.to_dict() if state_doc.exists else {}
        sequence = _safe_int(state_payload.get("sequence"), 0) + 1
        prev_hash = str(state_payload.get("lastHash") or AUDIT_GENESIS_HASH)
        payload = {
            "eventId": event_id,
            "ts": now_iso,
            "actorUid": safe_actor_uid,
            "actorUserId": safe_actor_user_id,
            "actorRole": safe_actor_role,
            "subjectUid": safe_subject_uid,
            "subjectUserId": safe_subject_user_id,
            "action": safe_action,
            "resourceType": safe_resource_type,
            "resourceId": safe_resource_id,
            "requestId": safe_request_id,
            "ipHash": _request_ip_hash(request),
            "uaHash": _request_ua_hash(request),
            "before": before if isinstance(before, dict) else {},
            "after": after if isinstance(after, dict) else {},
            "meta": meta if isinstance(meta, dict) else {},
            "prevHash": prev_hash,
            "hashAlgo": AUDIT_HASH_ALGO,
            "sequence": sequence,
        }
        payload["eventHash"] = _audit_hash(payload)
        transaction_obj.set(event_ref, payload, merge=False)
        transaction_obj.set(
            state_ref,
            {
                "sequence": sequence,
                "lastHash": payload["eventHash"],
                "updatedAt": now_iso,
            },
            merge=False,
        )
        return payload

    try:
        written = _apply(transaction)
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "event": written}


def _audit_list_events(
    *,
    actor_uid: str = "",
    actor_user_id: str = "",
    subject_uid: str = "",
    subject_user_id: str = "",
    action: str = "",
    resource_type: str = "",
    from_iso: str = "",
    to_iso: str = "",
    cursor: str = "",
    limit: int = 100,
) -> tuple[list[dict[str, Any]], Optional[str]]:
    safe_limit = max(1, min(500, int(limit)))
    safe_actor_uid = str(actor_uid or "").strip()
    safe_actor_user_id = str(actor_user_id or "").strip().lower()
    safe_subject_uid = str(subject_uid or "").strip()
    safe_subject_user_id = str(subject_user_id or "").strip().lower()
    safe_action = str(action or "").strip().lower()
    safe_resource_type = str(resource_type or "").strip().lower()
    from_dt = _parse_optional_datetime(from_iso) if from_iso else None
    to_dt = _parse_optional_datetime(to_iso) if to_iso else None
    safe_cursor = str(cursor or "").strip()
    rows: list[dict[str, Any]] = []
    next_cursor: Optional[str] = None

    collection = _firestore_collection(AUDIT_LEDGER_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            ordered = [
                _INMEMORY_AUDIT_LEDGER_EVENTS.get(event_id)
                for event_id in _INMEMORY_AUDIT_LEDGER_ORDER
            ]
        for item in ordered:
            if not isinstance(item, dict):
                continue
            event_id = str(item.get("eventId") or "")
            if safe_cursor and event_id <= safe_cursor:
                continue
            if safe_actor_uid and str(item.get("actorUid") or "").strip() != safe_actor_uid:
                continue
            if safe_actor_user_id and str(item.get("actorUserId") or "").strip().lower() != safe_actor_user_id:
                continue
            if safe_subject_uid and str(item.get("subjectUid") or "").strip() != safe_subject_uid:
                continue
            if safe_subject_user_id and str(item.get("subjectUserId") or "").strip().lower() != safe_subject_user_id:
                continue
            if safe_action and str(item.get("action") or "").strip().lower() != safe_action:
                continue
            if safe_resource_type and str(item.get("resourceType") or "").strip().lower() != safe_resource_type:
                continue
            ts = _parse_optional_datetime(str(item.get("ts") or ""))
            if from_dt and ts and ts < from_dt:
                continue
            if to_dt and ts and ts > to_dt:
                continue
            rows.append(dict(item))
            if len(rows) >= safe_limit:
                break
        if len(rows) == safe_limit:
            next_cursor = str(rows[-1].get("eventId") or "")
        return rows, next_cursor

    try:
        docs = list(collection.limit(max(1000, safe_limit * 4)).stream())
    except Exception:
        docs = []
    mapped = [{**(doc.to_dict() or {}), "eventId": str(doc.id or "")} for doc in docs]
    mapped.sort(key=lambda item: _safe_int(item.get("sequence"), 0))
    for item in mapped:
        event_id = str(item.get("eventId") or "")
        if not event_id:
            continue
        if safe_cursor and event_id <= safe_cursor:
            continue
        if safe_actor_uid and str(item.get("actorUid") or "").strip() != safe_actor_uid:
            continue
        if safe_actor_user_id and str(item.get("actorUserId") or "").strip().lower() != safe_actor_user_id:
            continue
        if safe_subject_uid and str(item.get("subjectUid") or "").strip() != safe_subject_uid:
            continue
        if safe_subject_user_id and str(item.get("subjectUserId") or "").strip().lower() != safe_subject_user_id:
            continue
        if safe_action and str(item.get("action") or "").strip().lower() != safe_action:
            continue
        if safe_resource_type and str(item.get("resourceType") or "").strip().lower() != safe_resource_type:
            continue
        ts = _parse_optional_datetime(str(item.get("ts") or ""))
        if from_dt and ts and ts < from_dt:
            continue
        if to_dt and ts and ts > to_dt:
            continue
        rows.append(item)
        if len(rows) >= safe_limit:
            break
    if len(rows) == safe_limit:
        next_cursor = str(rows[-1].get("eventId") or "")
    return rows, next_cursor


def _audit_verify_chain(*, from_seq: int = 0, to_seq: int = 0, limit: int = 1000) -> dict[str, Any]:
    safe_limit = max(1, min(5000, int(limit)))
    safe_from = max(0, int(from_seq))
    safe_to = max(0, int(to_seq))
    collection = _firestore_collection(AUDIT_LEDGER_COLLECTION)
    rows: list[dict[str, Any]] = []
    if collection is None:
        with _INMEMORY_LOCK:
            rows = [
                dict(_INMEMORY_AUDIT_LEDGER_EVENTS.get(event_id) or {})
                for event_id in _INMEMORY_AUDIT_LEDGER_ORDER
            ]
    else:
        try:
            docs = list(collection.limit(safe_limit * 2).stream())
        except Exception:
            docs = []
        rows = [{**(doc.to_dict() or {}), "eventId": str(doc.id or "")} for doc in docs]
    rows = [row for row in rows if isinstance(row, dict)]
    rows.sort(key=lambda item: _safe_int(item.get("sequence"), 0))
    if safe_from > 0:
        rows = [row for row in rows if _safe_int(row.get("sequence"), 0) >= safe_from]
    if safe_to > 0:
        rows = [row for row in rows if _safe_int(row.get("sequence"), 0) <= safe_to]
    rows = rows[:safe_limit]

    checked = 0
    mismatch_seq = None
    mismatch_event_id = None
    prev_hash = AUDIT_GENESIS_HASH
    for row in rows:
        checked += 1
        payload = dict(row)
        event_hash = str(payload.pop("eventHash", "") or "")
        expected_hash = _audit_hash(payload)
        if str(row.get("prevHash") or "") != prev_hash or event_hash != expected_hash:
            mismatch_seq = _safe_int(row.get("sequence"), 0)
            mismatch_event_id = str(row.get("eventId") or "")
            break
        prev_hash = event_hash

    return {
        "ok": mismatch_seq is None,
        "checked": checked,
        "mismatchAtSequence": mismatch_seq,
        "mismatchEventId": mismatch_event_id,
    }


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
    _ = admin_token
    uid = _require_request_uid(request)
    if not _request_is_admin(request, uid):
        return False, uid, "admin_access_required"
    if VF_ADMIN_APPROVER_UIDS and uid not in VF_ADMIN_APPROVER_UIDS:
        return False, uid, f"uid_not_allowlisted(uid={uid},env=VF_ADMIN_APPROVER_UIDS)"
    return True, uid, "authorized"


def _require_admin_approval_token(admin_token: Optional[str]) -> None:
    if not VF_ADMIN_APPROVAL_TOKEN:
        return
    provided = str(admin_token or "").strip()
    if not _constant_time_equal(provided, VF_ADMIN_APPROVAL_TOKEN):
        raise HTTPException(status_code=403, detail="Invalid or missing admin approval token.")


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


def _alert_normalize_channels(values: Any) -> list[str]:
    if not isinstance(values, list):
        return ["in_app"]
    channels: list[str] = []
    for token in values:
        safe = str(token or "").strip().lower()
        if safe in {"in_app", "webhook"} and safe not in channels:
            channels.append(safe)
    return channels or ["in_app"]


def _alert_normalize_operator(value: str) -> str:
    token = str(value or "").strip().lower()
    if token in ALERT_OPERATORS:
        return token
    return "gt"


def _alert_compare(operator: str, current: float, threshold: float) -> bool:
    op = _alert_normalize_operator(operator)
    if op == "gt":
        return current > threshold
    if op == "gte":
        return current >= threshold
    if op == "lt":
        return current < threshold
    if op == "lte":
        return current <= threshold
    if op == "eq":
        return abs(current - threshold) < 1e-9
    if op == "neq":
        return abs(current - threshold) >= 1e-9
    return False


def _alert_collection(name: str) -> Any:
    return _firestore_collection(name)


def _alert_metric_sample(metric_key: str) -> float:
    token = str(metric_key or "").strip().lower()
    if token in {"queue_depth", "tts_queue_depth"}:
        depth = _TTS_JOB_QUEUE.depth_snapshot()
        return float(_safe_int((depth or {}).get("total"), 0))
    if token in {"error_rate_last24h", "http_error_rate_last24h"}:
        usage = _admin_usage_summary_payload()
        metric = ((usage.get("windows") or {}).get("last24h") or {})
        return float(_safe_float(metric.get("errorRatePct"), 0.0))
    if token in {"guardian_pending_approvals", "pending_approvals"}:
        status = _ai_ops_build_status(include_route_stats=False)
        return float(_safe_int(status.get("pendingApprovalCount"), 0))
    if token in {"guardian_major_issues", "major_issues"}:
        status = _ai_ops_build_status(include_route_stats=False)
        issues = list(status.get("issues") or [])
        count = sum(1 for issue in issues if str((issue or {}).get("severity") or "") == "major")
        return float(count)
    if token in {"coupon_release_ratio_last24h", "coupon_abuse_ratio"}:
        now = _utc_now()
        cutoff = now - timedelta(hours=24)
        total = 0
        released = 0
        collection = _firestore_collection("coupon_redemptions")
        if collection is None:
            with _INMEMORY_LOCK:
                items = list(_INMEMORY_COUPON_REDEMPTIONS.values())
        else:
            try:
                items = [doc.to_dict() or {} for doc in collection.limit(3000).stream()]
            except Exception:
                items = []
        for item in items:
            if not isinstance(item, dict):
                continue
            created = _parse_optional_datetime(str(item.get("createdAt") or ""))
            if created and created < cutoff:
                continue
            total += 1
            if str(item.get("status") or "").strip().lower() == "released":
                released += 1
        if total <= 0:
            return 0.0
        return round((float(released) / float(total)) * 100.0, 4)
    return 0.0


def _alert_list_policies(limit: int = 200) -> list[dict[str, Any]]:
    safe_limit = max(1, min(500, int(limit)))
    collection = _alert_collection(ALERT_POLICIES_COLLECTION)
    rows: list[dict[str, Any]] = []
    if collection is None:
        with _INMEMORY_LOCK:
            rows = [dict(item) for item in _INMEMORY_ALERT_POLICIES.values()]
    else:
        try:
            rows = [{**(doc.to_dict() or {}), "id": str(doc.id or "")} for doc in collection.limit(safe_limit).stream()]
        except Exception:
            rows = []
    rows = [row for row in rows if isinstance(row, dict)]
    rows.sort(key=lambda item: str(item.get("updatedAt") or item.get("createdAt") or ""), reverse=True)
    return rows[:safe_limit]


def _alert_list_destinations(limit: int = 200) -> list[dict[str, Any]]:
    safe_limit = max(1, min(500, int(limit)))
    collection = _alert_collection(ALERT_DESTINATIONS_COLLECTION)
    rows: list[dict[str, Any]] = []
    if collection is None:
        with _INMEMORY_LOCK:
            rows = [dict(item) for item in _INMEMORY_ALERT_DESTINATIONS.values()]
    else:
        try:
            rows = [{**(doc.to_dict() or {}), "id": str(doc.id or "")} for doc in collection.limit(safe_limit).stream()]
        except Exception:
            rows = []
    rows = [row for row in rows if isinstance(row, dict)]
    rows.sort(key=lambda item: str(item.get("updatedAt") or item.get("createdAt") or ""), reverse=True)
    return rows[:safe_limit]


def _alert_list_events(limit: int = 200) -> list[dict[str, Any]]:
    safe_limit = max(1, min(500, int(limit)))
    collection = _alert_collection(ALERT_EVENTS_COLLECTION)
    rows: list[dict[str, Any]] = []
    if collection is None:
        with _INMEMORY_LOCK:
            rows = [dict(item) for item in _INMEMORY_ALERT_EVENTS.values()]
    else:
        try:
            rows = [{**(doc.to_dict() or {}), "id": str(doc.id or "")} for doc in collection.limit(safe_limit).stream()]
        except Exception:
            rows = []
    rows = [row for row in rows if isinstance(row, dict)]
    rows.sort(key=lambda item: str(item.get("lastTriggeredAt") or item.get("openedAt") or ""), reverse=True)
    return rows[:safe_limit]


def _alert_upsert_policy(policy_id: str, row: dict[str, Any]) -> dict[str, Any]:
    safe_id = str(policy_id or "").strip()
    if not safe_id:
        safe_id = f"apol_{uuid.uuid4().hex[:12]}"
    payload = dict(row or {})
    payload["id"] = safe_id
    collection = _alert_collection(ALERT_POLICIES_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            _INMEMORY_ALERT_POLICIES[safe_id] = dict(payload)
        return payload
    collection.document(safe_id).set(payload, merge=True)
    return payload


def _alert_upsert_destination(destination_id: str, row: dict[str, Any]) -> dict[str, Any]:
    safe_id = str(destination_id or "").strip()
    if not safe_id:
        safe_id = f"adst_{uuid.uuid4().hex[:12]}"
    payload = dict(row or {})
    payload["id"] = safe_id
    collection = _alert_collection(ALERT_DESTINATIONS_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            _INMEMORY_ALERT_DESTINATIONS[safe_id] = dict(payload)
        return payload
    collection.document(safe_id).set(payload, merge=True)
    return payload


def _alert_upsert_event(event_id: str, row: dict[str, Any]) -> dict[str, Any]:
    safe_id = str(event_id or "").strip()
    if not safe_id:
        safe_id = f"aevt_{uuid.uuid4().hex[:12]}"
    payload = dict(row or {})
    payload["id"] = safe_id
    collection = _alert_collection(ALERT_EVENTS_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            _INMEMORY_ALERT_EVENTS[safe_id] = dict(payload)
        return payload
    collection.document(safe_id).set(payload, merge=True)
    return payload


def _alert_get_policy(policy_id: str) -> Optional[dict[str, Any]]:
    safe_id = str(policy_id or "").strip()
    if not safe_id:
        return None
    collection = _alert_collection(ALERT_POLICIES_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            row = _INMEMORY_ALERT_POLICIES.get(safe_id)
            return dict(row) if isinstance(row, dict) else None
    try:
        doc = collection.document(safe_id).get()
    except Exception:
        return None
    if not doc.exists:
        return None
    return {**(doc.to_dict() or {}), "id": safe_id}


def _alert_get_destination(destination_id: str) -> Optional[dict[str, Any]]:
    safe_id = str(destination_id or "").strip()
    if not safe_id:
        return None
    collection = _alert_collection(ALERT_DESTINATIONS_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            row = _INMEMORY_ALERT_DESTINATIONS.get(safe_id)
            return dict(row) if isinstance(row, dict) else None
    try:
        doc = collection.document(safe_id).get()
    except Exception:
        return None
    if not doc.exists:
        return None
    return {**(doc.to_dict() or {}), "id": safe_id}


def _alert_get_event(event_id: str) -> Optional[dict[str, Any]]:
    safe_id = str(event_id or "").strip()
    if not safe_id:
        return None
    collection = _alert_collection(ALERT_EVENTS_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            row = _INMEMORY_ALERT_EVENTS.get(safe_id)
            return dict(row) if isinstance(row, dict) else None
    try:
        doc = collection.document(safe_id).get()
    except Exception:
        return None
    if not doc.exists:
        return None
    return {**(doc.to_dict() or {}), "id": safe_id}


def _alert_find_open_event(policy_id: str) -> Optional[dict[str, Any]]:
    safe_policy_id = str(policy_id or "").strip()
    if not safe_policy_id:
        return None
    events = _alert_list_events(limit=500)
    for item in events:
        if str(item.get("policyId") or "").strip() != safe_policy_id:
            continue
        if str(item.get("status") or "").strip().lower() == "open":
            return item
    return None


def _alert_dispatch_webhooks(event: dict[str, Any]) -> dict[str, Any]:
    destinations = [item for item in _alert_list_destinations(limit=200) if _as_bool(item.get("enabled"))]
    deliveries = list(event.get("delivery") or [])
    delivery_by_dest = {
        str(item.get("destinationId") or ""): dict(item)
        for item in deliveries
        if isinstance(item, dict)
    }
    now_ms = _ai_ops_now_ms()
    backoff_steps = [30_000, 120_000, 600_000]
    event_payload = {
        "eventId": str(event.get("id") or event.get("eventId") or ""),
        "policyId": str(event.get("policyId") or ""),
        "status": str(event.get("status") or ""),
        "severity": str(event.get("severity") or ""),
        "openedAt": str(event.get("openedAt") or ""),
        "lastTriggeredAt": str(event.get("lastTriggeredAt") or ""),
        "samples": list(event.get("samples") or []),
    }
    for destination in destinations:
        if str(destination.get("type") or "webhook").strip().lower() != "webhook":
            continue
        if "webhook" not in _alert_normalize_channels(event.get("channels")):
            continue
        destination_id = str(destination.get("id") or "").strip()
        if not destination_id:
            continue
        state = dict(delivery_by_dest.get(destination_id) or {})
        attempts = _safe_int(state.get("attempts"), 0)
        next_attempt_at_ms = _safe_int(state.get("nextAttemptAtMs"), 0)
        status = str(state.get("status") or "").strip().lower()
        if status == "delivered":
            continue
        if attempts >= len(backoff_steps):
            continue
        if attempts > 0 and now_ms < next_attempt_at_ms:
            continue
        url = str(destination.get("url") or "").strip()
        if not url:
            continue
        secret = str(destination.get("secretRef") or "").strip()
        body_text = _canonical_json(event_payload)
        signature = hmac.new(secret.encode("utf-8"), body_text.encode("utf-8"), hashlib.sha256).hexdigest() if secret else ""
        idempotency_key = f"{event_payload['eventId']}:{destination_id}:{int(now_ms // 30_000)}"
        try:
            response = requests.post(
                url,
                data=body_text.encode("utf-8"),
                headers={
                    "content-type": "application/json",
                    "x-vf-signature-sha256": signature,
                    "x-vf-idempotency-key": idempotency_key,
                },
                timeout=8,
            )
            if response.ok:
                state.update(
                    {
                        "destinationId": destination_id,
                        "attempts": attempts + 1,
                        "status": "delivered",
                        "lastAttemptAtMs": now_ms,
                        "nextAttemptAtMs": 0,
                        "code": int(response.status_code),
                    }
                )
            else:
                retry_after = backoff_steps[min(attempts, len(backoff_steps) - 1)]
                state.update(
                    {
                        "destinationId": destination_id,
                        "attempts": attempts + 1,
                        "status": "retry",
                        "lastAttemptAtMs": now_ms,
                        "nextAttemptAtMs": now_ms + retry_after,
                        "code": int(response.status_code),
                        "error": _truncate_text(response.text, 280),
                    }
                )
        except Exception as exc:
            retry_after = backoff_steps[min(attempts, len(backoff_steps) - 1)]
            state.update(
                {
                    "destinationId": destination_id,
                    "attempts": attempts + 1,
                    "status": "retry",
                    "lastAttemptAtMs": now_ms,
                    "nextAttemptAtMs": now_ms + retry_after,
                    "error": _truncate_text(str(exc), 280),
                }
            )
        delivery_by_dest[destination_id] = state
    event["delivery"] = list(delivery_by_dest.values())
    return event


def _alert_evaluate_once() -> dict[str, Any]:
    if not VF_ALERT_ENGINE_ENABLED:
        return {"ok": True, "disabled": True, "evaluated": 0}
    policies = [item for item in _alert_list_policies(limit=500) if _as_bool(item.get("enabled"))]
    evaluated = 0
    opened = 0
    resolved = 0
    now_iso = _utc_now().isoformat()
    now_ms = _ai_ops_now_ms()
    for policy in policies:
        policy_id = str(policy.get("id") or "").strip()
        if not policy_id:
            continue
        evaluated += 1
        metric_key = str(policy.get("metricKey") or "").strip()
        current_value = _alert_metric_sample(metric_key)
        threshold = _safe_float(policy.get("threshold"), 0.0)
        operator = _alert_normalize_operator(str(policy.get("operator") or "gt"))
        cooldown_sec = max(0, _safe_int(policy.get("cooldownSec"), 0))
        trigger = _alert_compare(operator, current_value, threshold)
        existing = _alert_find_open_event(policy_id)
        if trigger:
            if existing is not None:
                last_triggered = _parse_optional_datetime(str(existing.get("lastTriggeredAt") or ""))
                if last_triggered and (_utc_now() - last_triggered).total_seconds() < cooldown_sec:
                    continue
                samples = list(existing.get("samples") or [])
                samples.append({"ts": now_iso, "value": current_value})
                samples = samples[-40:]
                existing["lastTriggeredAt"] = now_iso
                existing["samples"] = samples
                existing["channels"] = _alert_normalize_channels(policy.get("channels"))
                existing["severity"] = str(policy.get("severity") or "warning")
                existing = _alert_dispatch_webhooks(existing)
                _alert_upsert_event(str(existing.get("id") or ""), existing)
            else:
                opened += 1
                event = {
                    "policyId": policy_id,
                    "status": "open",
                    "severity": str(policy.get("severity") or "warning"),
                    "openedAt": now_iso,
                    "lastTriggeredAt": now_iso,
                    "resolvedAt": None,
                    "samples": [{"ts": now_iso, "value": current_value}],
                    "channels": _alert_normalize_channels(policy.get("channels")),
                    "delivery": [],
                }
                event = _alert_dispatch_webhooks(event)
                _alert_upsert_event("", event)
        else:
            if existing is not None:
                resolved += 1
                existing["status"] = "resolved"
                existing["resolvedAt"] = now_iso
                existing["updatedAt"] = now_iso
                _alert_upsert_event(str(existing.get("id") or ""), existing)
    return {
        "ok": True,
        "evaluated": evaluated,
        "opened": opened,
        "resolved": resolved,
        "timestampMs": now_ms,
    }


def _scheduler_parse_field(field: str, value: int, *, min_value: int, max_value: int) -> bool:
    token = str(field or "").strip()
    if token == "*":
        return True
    parts = [item.strip() for item in token.split(",") if item.strip()]
    if not parts:
        return False
    for part in parts:
        if part == "*":
            return True
        if part.startswith("*/"):
            step = _safe_int(part[2:], 0)
            if step > 0 and value % step == 0:
                return True
            continue
        if "-" in part:
            try:
                start_token, end_token = part.split("-", 1)
                start = _safe_int(start_token, min_value)
                end = _safe_int(end_token, max_value)
            except Exception:
                continue
            if start <= value <= end:
                return True
            continue
        if _safe_int(part, min_value - 1) == value:
            return True
    return False


def _scheduler_cron_matches(dt_local: datetime, cron_expr: str) -> bool:
    parts = [item for item in str(cron_expr or "").strip().split(" ") if item]
    if len(parts) != 5:
        return False
    minute, hour, day, month, weekday = parts
    weekday_value = (dt_local.weekday() + 1) % 7
    return (
        _scheduler_parse_field(minute, dt_local.minute, min_value=0, max_value=59)
        and _scheduler_parse_field(hour, dt_local.hour, min_value=0, max_value=23)
        and _scheduler_parse_field(day, dt_local.day, min_value=1, max_value=31)
        and _scheduler_parse_field(month, dt_local.month, min_value=1, max_value=12)
        and _scheduler_parse_field(weekday, weekday_value, min_value=0, max_value=6)
    )


def _scheduler_next_run_at(cron_expr: str, timezone_name: str, *, after: Optional[datetime] = None) -> datetime:
    safe_after = after or _utc_now()
    try:
        tz = ZoneInfo(str(timezone_name or "UTC").strip() or "UTC")
    except Exception:
        try:
            tz = ZoneInfo("Etc/UTC")
        except Exception:
            tz = timezone.utc
    local = safe_after.astimezone(tz).replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(0, 60 * 24 * 370):
        if _scheduler_cron_matches(local, cron_expr):
            return local.astimezone(timezone.utc)
        local += timedelta(minutes=1)
    return (safe_after + timedelta(minutes=5)).astimezone(timezone.utc)


def _scheduler_acquire_lock(owner: str) -> bool:
    safe_owner = str(owner or "").strip() or "scheduler"
    now = _utc_now()
    expires_at = now + timedelta(seconds=VF_SCHEDULER_LOCK_TTL_SECONDS)
    collection = _firestore_collection(SCHEDULER_LOCK_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            current_owner = str(_INMEMORY_SCHEDULER_LOCK.get("owner") or "")
            current_expires = _parse_optional_datetime(str(_INMEMORY_SCHEDULER_LOCK.get("expiresAt") or ""))
            if current_owner and current_owner != safe_owner and current_expires and current_expires > now:
                return False
            _INMEMORY_SCHEDULER_LOCK.clear()
            _INMEMORY_SCHEDULER_LOCK.update(
                {
                    "owner": safe_owner,
                    "expiresAt": expires_at.isoformat(),
                    "updatedAt": now.isoformat(),
                }
            )
            return True
    if _FIRESTORE_DB is None or firebase_firestore is None:
        return False
    lock_ref = _FIRESTORE_DB.collection(SCHEDULER_LOCK_COLLECTION).document("current")
    transaction = _FIRESTORE_DB.transaction()

    @firebase_firestore.transactional
    def _apply(transaction_obj: Any) -> bool:
        current_doc = lock_ref.get(transaction=transaction_obj)
        payload = current_doc.to_dict() if current_doc.exists else {}
        current_owner = str(payload.get("owner") or "")
        current_expires = _parse_optional_datetime(str(payload.get("expiresAt") or ""))
        if current_owner and current_owner != safe_owner and current_expires and current_expires > now:
            return False
        transaction_obj.set(
            lock_ref,
            {
                "owner": safe_owner,
                "expiresAt": expires_at.isoformat(),
                "updatedAt": now.isoformat(),
            },
            merge=False,
        )
        return True

    try:
        return bool(_apply(transaction))
    except Exception:
        return False


def _scheduler_release_lock(owner: str) -> None:
    safe_owner = str(owner or "").strip() or "scheduler"
    now_iso = _utc_now().isoformat()
    collection = _firestore_collection(SCHEDULER_LOCK_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            if str(_INMEMORY_SCHEDULER_LOCK.get("owner") or "") == safe_owner:
                _INMEMORY_SCHEDULER_LOCK.clear()
        return
    if _FIRESTORE_DB is None:
        return
    try:
        ref = _FIRESTORE_DB.collection(SCHEDULER_LOCK_COLLECTION).document("current")
        doc = ref.get()
        if doc.exists and str((doc.to_dict() or {}).get("owner") or "") == safe_owner:
            ref.set({"owner": "", "expiresAt": now_iso, "updatedAt": now_iso}, merge=False)
    except Exception:
        return


def _scheduler_list_tasks(limit: int = 200) -> list[dict[str, Any]]:
    safe_limit = max(1, min(500, int(limit)))
    collection = _firestore_collection(SCHEDULER_TASKS_COLLECTION)
    rows: list[dict[str, Any]] = []
    if collection is None:
        with _INMEMORY_LOCK:
            rows = [dict(item) for item in _INMEMORY_SCHEDULER_TASKS.values()]
    else:
        try:
            rows = [{**(doc.to_dict() or {}), "id": str(doc.id or "")} for doc in collection.limit(safe_limit).stream()]
        except Exception:
            rows = []
    rows = [row for row in rows if isinstance(row, dict)]
    rows.sort(key=lambda item: str(item.get("nextRunAt") or ""), reverse=False)
    return rows[:safe_limit]


def _scheduler_get_task(task_id: str) -> Optional[dict[str, Any]]:
    safe_task_id = str(task_id or "").strip()
    if not safe_task_id:
        return None
    collection = _firestore_collection(SCHEDULER_TASKS_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            row = _INMEMORY_SCHEDULER_TASKS.get(safe_task_id)
            return dict(row) if isinstance(row, dict) else None
    try:
        doc = collection.document(safe_task_id).get()
    except Exception:
        return None
    if not doc.exists:
        return None
    return {**(doc.to_dict() or {}), "id": safe_task_id}


def _scheduler_upsert_task(task_id: str, row: dict[str, Any]) -> dict[str, Any]:
    safe_task_id = str(task_id or "").strip()
    if not safe_task_id:
        safe_task_id = f"task_{uuid.uuid4().hex[:12]}"
    payload = dict(row or {})
    payload["id"] = safe_task_id
    collection = _firestore_collection(SCHEDULER_TASKS_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            _INMEMORY_SCHEDULER_TASKS[safe_task_id] = dict(payload)
        return payload
    collection.document(safe_task_id).set(payload, merge=True)
    return payload


def _scheduler_list_runs(limit: int = 300, task_id: str = "") -> list[dict[str, Any]]:
    safe_limit = max(1, min(1000, int(limit)))
    safe_task_id = str(task_id or "").strip()
    collection = _firestore_collection(SCHEDULER_RUNS_COLLECTION)
    rows: list[dict[str, Any]] = []
    if collection is None:
        with _INMEMORY_LOCK:
            rows = [dict(item) for item in _INMEMORY_SCHEDULER_RUNS.values()]
    else:
        try:
            rows = [{**(doc.to_dict() or {}), "id": str(doc.id or "")} for doc in collection.limit(safe_limit * 2).stream()]
        except Exception:
            rows = []
    if safe_task_id:
        rows = [row for row in rows if str(row.get("taskId") or "").strip() == safe_task_id]
    rows.sort(key=lambda item: str(item.get("startedAt") or item.get("scheduledAt") or ""), reverse=True)
    return rows[:safe_limit]


def _scheduler_upsert_run(run_id: str, row: dict[str, Any]) -> dict[str, Any]:
    safe_run_id = str(run_id or "").strip()
    if not safe_run_id:
        safe_run_id = f"run_{uuid.uuid4().hex[:12]}"
    payload = dict(row or {})
    payload["id"] = safe_run_id
    collection = _firestore_collection(SCHEDULER_RUNS_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            _INMEMORY_SCHEDULER_RUNS[safe_run_id] = dict(payload)
        return payload
    collection.document(safe_run_id).set(payload, merge=True)
    return payload


def _scheduler_task_payload_validate(
    *,
    task_type: str,
    cron_expr: str,
    timezone_name: str,
    concurrency_policy: str,
) -> tuple[str, str, str, str]:
    safe_task_type = str(task_type or "").strip().lower()
    if safe_task_type not in SCHEDULER_TASK_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported taskType.")
    safe_cron = str(cron_expr or "").strip()
    parts = [item for item in safe_cron.split(" ") if item]
    if len(parts) != 5:
        raise HTTPException(status_code=400, detail="cronExpr must have 5 fields.")
    safe_timezone = str(timezone_name or "UTC").strip() or "UTC"
    try:
        ZoneInfo(safe_timezone)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid timezone.") from None
    safe_policy = str(concurrency_policy or "forbid").strip().lower()
    if safe_policy not in SCHEDULER_CONCURRENCY_POLICIES:
        raise HTTPException(status_code=400, detail="Invalid concurrencyPolicy.")
    return safe_task_type, safe_cron, safe_timezone, safe_policy


def _coupon_abuse_scan_snapshot() -> dict[str, Any]:
    now = _utc_now()
    cutoff = now - timedelta(hours=24)
    total = 0
    released = 0
    reserved = 0
    redeemed = 0
    collection = _firestore_collection("coupon_redemptions")
    if collection is None:
        with _INMEMORY_LOCK:
            items = list(_INMEMORY_COUPON_REDEMPTIONS.values())
    else:
        try:
            items = [doc.to_dict() or {} for doc in collection.limit(3000).stream()]
        except Exception:
            items = []
    for item in items:
        if not isinstance(item, dict):
            continue
        created = _parse_optional_datetime(str(item.get("createdAt") or ""))
        if created and created < cutoff:
            continue
        total += 1
        status = str(item.get("status") or "").strip().lower()
        if status == "released":
            released += 1
        elif status == "reserved":
            reserved += 1
        elif status == "redeemed":
            redeemed += 1
    ratio = round((float(released) / float(total) * 100.0) if total > 0 else 0.0, 3)
    return {
        "windowHours": 24,
        "totalEvents": total,
        "released": released,
        "reserved": reserved,
        "redeemed": redeemed,
        "releaseRatioPct": ratio,
    }


def _scheduler_execute_task(task: dict[str, Any], *, requested_by: str, dry_run: bool) -> dict[str, Any]:
    task_type = str(task.get("taskType") or "").strip().lower()
    if task_type == "usage_reset_daily":
        return _reset_daily_usage_all(dry_run=bool(dry_run), requested_by=requested_by)
    if task_type == "guardian_scan":
        status_payload = _ai_ops_build_status(include_route_stats=True)
        return {
            "ok": True,
            "dryRun": bool(dry_run),
            "issuesDetected": len(list(status_payload.get("issues") or [])),
            "pendingApprovals": _safe_int(status_payload.get("pendingApprovalCount"), 0),
        }
    if task_type == "usage_export_daily":
        summary = _admin_usage_summary_payload()
        return {
            "ok": True,
            "dryRun": bool(dry_run),
            "generatedAtMs": _safe_int(summary.get("generatedAtMs"), _ai_ops_now_ms()),
            "requestsTotal": _safe_int((((summary.get("windows") or {}).get("total") or {}).get("requests")), 0),
        }
    if task_type == "coupon_abuse_scan":
        snapshot = _coupon_abuse_scan_snapshot()
        return {"ok": True, "dryRun": bool(dry_run), **snapshot}
    raise RuntimeError("Unsupported task type.")


def _scheduler_run_task(task_id: str, *, requested_by: str, dry_run_override: Optional[bool] = None) -> dict[str, Any]:
    task = _scheduler_get_task(task_id)
    if not isinstance(task, dict):
        raise HTTPException(status_code=404, detail="Task not found.")
    now = _utc_now()
    policy = str(task.get("concurrencyPolicy") or "forbid").strip().lower()
    active_runs = [
        row for row in _scheduler_list_runs(limit=200, task_id=str(task.get("id") or ""))
        if str(row.get("status") or "").strip().lower() == "running"
    ]
    if policy == "forbid" and active_runs:
        raise HTTPException(status_code=409, detail="Task already running.")

    run_id = f"run_{uuid.uuid4().hex[:12]}"
    dry_run = bool(task.get("dryRun")) if dry_run_override is None else bool(dry_run_override)
    run = {
        "id": run_id,
        "taskId": str(task.get("id") or ""),
        "taskType": str(task.get("taskType") or ""),
        "scheduledAt": now.isoformat(),
        "startedAt": now.isoformat(),
        "finishedAt": None,
        "status": "running",
        "result": {},
        "error": "",
        "dryRun": dry_run,
        "idempotencyKey": f"{str(task.get('id') or '')}:{now.strftime('%Y%m%dT%H%M')}",
        "requestedBy": str(requested_by or "").strip(),
    }
    _scheduler_upsert_run(run_id, run)
    try:
        result = _scheduler_execute_task(task, requested_by=requested_by, dry_run=dry_run)
        run["status"] = "completed"
        run["result"] = result
        run["error"] = ""
    except Exception as exc:
        run["status"] = "failed"
        run["result"] = {}
        run["error"] = _truncate_text(str(exc), 500)
    run["finishedAt"] = _utc_now().isoformat()
    _scheduler_upsert_run(run_id, run)

    next_run = _scheduler_next_run_at(
        str(task.get("cronExpr") or "* * * * *"),
        str(task.get("timezone") or "UTC"),
        after=_utc_now(),
    )
    task["lastRunAt"] = run["finishedAt"]
    task["lastResult"] = {"status": run["status"], "runId": run_id}
    task["nextRunAt"] = next_run.isoformat()
    task["updatedAt"] = _utc_now().isoformat()
    _scheduler_upsert_task(str(task.get("id") or ""), task)
    return run


def _scheduler_tick(owner: str) -> dict[str, Any]:
    if not VF_SCHEDULER_ENABLED:
        return {"ok": True, "disabled": True}
    if not _scheduler_acquire_lock(owner):
        return {"ok": True, "locked": False}
    processed = 0
    now = _utc_now()
    try:
        tasks = _scheduler_list_tasks(limit=500)
        for task in tasks:
            if not _as_bool(task.get("enabled")):
                continue
            next_run = _parse_optional_datetime(str(task.get("nextRunAt") or ""))
            if next_run and next_run > now:
                continue
            try:
                _scheduler_run_task(str(task.get("id") or ""), requested_by=owner, dry_run_override=None)
                processed += 1
            except Exception:
                continue
        _alert_evaluate_once()
        return {"ok": True, "locked": True, "processed": processed}
    finally:
        _scheduler_release_lock(owner)


def _scheduler_loop(owner: str) -> None:
    while not _SCHEDULER_STOP_EVENT.is_set():
        try:
            _scheduler_tick(owner)
        except Exception:
            pass
        _SCHEDULER_STOP_EVENT.wait(timeout=max(3, VF_SCHEDULER_TICK_SECONDS))


def _ensure_scheduler_started() -> None:
    global _SCHEDULER_THREAD
    if not VF_SCHEDULER_ENABLED:
        return
    with _SCHEDULER_THREAD_LOCK:
        if _SCHEDULER_THREAD is not None and _SCHEDULER_THREAD.is_alive():
            return
        _SCHEDULER_STOP_EVENT.clear()
        owner = f"scheduler-{uuid.uuid4().hex[:6]}"
        thread = threading.Thread(target=_scheduler_loop, args=(owner,), daemon=True, name="phase2-scheduler")
        thread.start()
        _SCHEDULER_THREAD = thread


def _scheduler_stop() -> None:
    _SCHEDULER_STOP_EVENT.set()


def _coupon_analytics_daily_key(date_token: str, coupon_code: str, plan_token: str) -> str:
    safe_date = str(date_token or "").strip() or _utc_now().strftime("%Y-%m-%d")
    safe_coupon = _normalize_coupon_code(coupon_code) or "UNKNOWN"
    safe_plan = str(plan_token or "").strip().lower() or "unknown"
    return f"{safe_date}_{safe_coupon}_{safe_plan}"


def _coupon_analytics_write_daily(key: str, patch: dict[str, Any]) -> dict[str, Any]:
    safe_key = str(key or "").strip()
    if not safe_key:
        raise RuntimeError("Invalid analytics key.")
    collection = _firestore_collection(COUPON_ANALYTICS_DAILY_COLLECTION)
    now_iso = _utc_now().isoformat()
    if collection is None:
        with _INMEMORY_LOCK:
            row = dict(_INMEMORY_COUPON_ANALYTICS_DAILY.get(safe_key) or {})
            row.update(patch or {})
            row["id"] = safe_key
            row["updatedAt"] = now_iso
            _INMEMORY_COUPON_ANALYTICS_DAILY[safe_key] = row
            return dict(row)
    ref = collection.document(safe_key)
    doc = ref.get()
    existing = doc.to_dict() if doc.exists else {}
    row = dict(existing or {})
    row.update(patch or {})
    row["id"] = safe_key
    row["updatedAt"] = now_iso
    ref.set(row, merge=True)
    return row


def _analytics_record_coupon_event(
    event_type: str,
    provider: str,
    coupon_code: str,
    coupon_kind: str,
    plan: str,
    amounts: Optional[dict[str, Any]] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    if not VF_ANALYTICS_V2_ENABLED:
        return {"ok": True, "disabled": True}
    safe_event_type = str(event_type or "").strip().lower()
    safe_provider = str(provider or ACTIVE_BILLING_PROVIDER).strip().lower() or ACTIVE_BILLING_PROVIDER
    safe_coupon_code = _normalize_coupon_code(coupon_code)
    safe_kind = _normalize_coupon_type(coupon_kind)
    safe_plan = _normalize_coupon_plan_token(plan)
    if safe_plan not in set(PAID_PLAN_KEYS):
        safe_plan = "unknown"
    date_token = _utc_now().strftime("%Y-%m-%d")
    key = _coupon_analytics_daily_key(date_token, safe_coupon_code or "UNKNOWN", safe_plan)
    gross = _safe_float((amounts or {}).get("grossAmount"), 0.0)
    discount = _safe_float((amounts or {}).get("discountAmount"), 0.0)
    net = _safe_float((amounts or {}).get("netAmount"), max(0.0, gross - discount))
    patch = {
        "date": date_token,
        "couponCode": safe_coupon_code or "UNKNOWN",
        "couponKind": safe_kind,
        "plan": safe_plan,
        "provider": safe_provider,
        "checkoutsStarted": 0,
        "checkoutsCompleted": 0,
        "subscriptionsActivated": 0,
        "cancellationsWithin30d": 0,
        "grossAmount": 0.0,
        "discountAmount": 0.0,
        "netAmount": 0.0,
        "lastMeta": metadata if isinstance(metadata, dict) else {},
    }
    current = _coupon_analytics_write_daily(key, patch)
    current["checkoutsStarted"] = _safe_int(current.get("checkoutsStarted"), 0)
    current["checkoutsCompleted"] = _safe_int(current.get("checkoutsCompleted"), 0)
    current["subscriptionsActivated"] = _safe_int(current.get("subscriptionsActivated"), 0)
    current["cancellationsWithin30d"] = _safe_int(current.get("cancellationsWithin30d"), 0)
    current["grossAmount"] = _safe_float(current.get("grossAmount"), 0.0)
    current["discountAmount"] = _safe_float(current.get("discountAmount"), 0.0)
    current["netAmount"] = _safe_float(current.get("netAmount"), 0.0)
    if safe_event_type == "checkout_started":
        current["checkoutsStarted"] += 1
    elif safe_event_type == "checkout_completed":
        current["checkoutsCompleted"] += 1
        current["grossAmount"] += gross
        current["discountAmount"] += discount
        current["netAmount"] += net
    elif safe_event_type == "subscription_activated":
        current["subscriptionsActivated"] += 1
    elif safe_event_type == "cancellation_within_30d":
        current["cancellationsWithin30d"] += 1
    current["lastEventType"] = safe_event_type
    current["lastMeta"] = metadata if isinstance(metadata, dict) else {}
    saved = _coupon_analytics_write_daily(key, current)
    return {"ok": True, "row": saved}


def _analytics_write_subscription_attribution(subscription_id: str, payload: dict[str, Any]) -> None:
    safe_subscription_id = str(subscription_id or "").strip()
    if not safe_subscription_id:
        return
    collection = _firestore_collection(COUPON_SUBSCRIPTION_ATTRIBUTIONS_COLLECTION)
    row = dict(payload or {})
    row["id"] = safe_subscription_id
    row["updatedAt"] = _utc_now().isoformat()
    if collection is None:
        with _INMEMORY_LOCK:
            _INMEMORY_COUPON_SUB_ATTRIBUTIONS[safe_subscription_id] = row
        return
    collection.document(safe_subscription_id).set(row, merge=True)


def _analytics_read_subscription_attribution(subscription_id: str) -> Optional[dict[str, Any]]:
    safe_subscription_id = str(subscription_id or "").strip()
    if not safe_subscription_id:
        return None
    collection = _firestore_collection(COUPON_SUBSCRIPTION_ATTRIBUTIONS_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            row = _INMEMORY_COUPON_SUB_ATTRIBUTIONS.get(safe_subscription_id)
            return dict(row) if isinstance(row, dict) else None
    try:
        doc = collection.document(safe_subscription_id).get()
    except Exception:
        return None
    if not doc.exists:
        return None
    return {**(doc.to_dict() or {}), "id": safe_subscription_id}


def _analytics_list_coupon_daily(
    *,
    from_dt: datetime,
    to_dt: datetime,
    plan: str = "",
    coupon_kind: str = "",
    coupon_code: str = "",
) -> list[dict[str, Any]]:
    safe_plan = _normalize_coupon_plan_token(plan)
    safe_kind = str(coupon_kind or "").strip().lower()
    safe_code = _normalize_coupon_code(coupon_code)
    collection = _firestore_collection(COUPON_ANALYTICS_DAILY_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            rows = [dict(item) for item in _INMEMORY_COUPON_ANALYTICS_DAILY.values()]
    else:
        try:
            rows = [{**(doc.to_dict() or {}), "id": str(doc.id or "")} for doc in collection.limit(4000).stream()]
        except Exception:
            rows = []
    result: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        day = _parse_optional_datetime(f"{str(row.get('date') or '')}T00:00:00+00:00")
        if day is None:
            continue
        row_plan = _normalize_coupon_plan_token(str(row.get("plan") or ""))
        if not row_plan:
            row_plan = "unknown"
        if day < from_dt or day > to_dt:
            continue
        if safe_plan and row_plan != safe_plan:
            continue
        if safe_kind and str(row.get("couponKind") or "").strip().lower() != safe_kind:
            continue
        if safe_code and _normalize_coupon_code(str(row.get("couponCode") or "")) != safe_code:
            continue
        normalized_row = dict(row)
        normalized_row["plan"] = row_plan
        result.append(normalized_row)
    return result


def _analytics_compute_rates(row: dict[str, Any]) -> dict[str, Any]:
    started = max(0, _safe_int(row.get("checkoutsStarted"), 0))
    completed = max(0, _safe_int(row.get("checkoutsCompleted"), 0))
    activated = max(0, _safe_int(row.get("subscriptionsActivated"), 0))
    cancelled = max(0, _safe_int(row.get("cancellationsWithin30d"), 0))
    gross = max(0.0, _safe_float(row.get("grossAmount"), 0.0))
    discount = max(0.0, _safe_float(row.get("discountAmount"), 0.0))
    net = max(0.0, _safe_float(row.get("netAmount"), 0.0))
    row["conversionRate"] = round((float(activated) / float(started)) if started > 0 else 0.0, 6)
    row["checkoutCompletionRate"] = round((float(completed) / float(started)) if started > 0 else 0.0, 6)
    row["d30ChurnRate"] = round((float(cancelled) / float(activated)) if activated > 0 else 0.0, 6)
    row["discountEfficiency"] = round((float(net) / float(discount)) if discount > 0 else 0.0, 6)
    row["grossAmount"] = gross
    row["discountAmount"] = discount
    row["netAmount"] = net
    return row


def _normalize_engine_name(raw_engine: str) -> str:
    normalized = "".join(ch if ch.isalnum() else "_" for ch in (raw_engine or "").strip().upper())
    while "__" in normalized:
        normalized = normalized.replace("__", "_")
    normalized = normalized.strip("_")
    engine = TTS_ENGINE_ALIASES.get(normalized)
    if not engine:
        raise ValueError("Invalid engine. Use KOKORO, GOOD, NEURAL2, or GEM.")
    return engine


def _runtime_url_for_engine(engine: str) -> str:
    normalized = _normalize_engine_name(engine)
    if _is_gem_runtime_engine(normalized):
        return GEMINI_RUNTIME_URL
    return KOKORO_RUNTIME_URL


def _runtime_synthesize_path_for_engine(engine: str) -> str:
    _normalize_engine_name(engine)
    return "/synthesize"


def _stripe_plan_price_catalog() -> dict[str, dict[str, str]]:
    return {
        "starter": {
            "first": str(STRIPE_PRICE_STARTER_MAX_INR or "").strip(),
            "recurring": str(STRIPE_PRICE_STARTER_RECURRING_INR or "").strip(),
        },
        "creator": {
            "first": str(STRIPE_PRICE_CREATOR_MAX_INR or "").strip(),
            "recurring": str(STRIPE_PRICE_CREATOR_RECURRING_INR or "").strip(),
        },
        "pro": {
            "first": str(STRIPE_PRICE_PRO_MAX_INR or "").strip(),
            "recurring": str(STRIPE_PRICE_PRO_RECURRING_INR or "").strip(),
        },
        "scale": {
            "first": str(STRIPE_PRICE_SCALE_MAX_INR or "").strip(),
            "recurring": str(STRIPE_PRICE_SCALE_RECURRING_INR or "").strip(),
        },
    }


def _stripe_price_id_for_plan(plan: str, *, phase: str = "first") -> str:
    plan_key = _plan_key_from_name(plan)
    if plan_key not in set(PAID_PLAN_KEYS):
        return ""
    safe_phase = "recurring" if str(phase or "").strip().lower() == "recurring" else "first"
    catalog = _stripe_plan_price_catalog()
    return str(((catalog.get(plan_key) or {}).get(safe_phase)) or "").strip()


def _stripe_plan_prices_configured() -> bool:
    catalog = _stripe_plan_price_catalog()
    for plan_key in PAID_PLAN_KEYS:
        row = catalog.get(plan_key) or {}
        if not str(row.get("first") or "").strip():
            return False
        if not str(row.get("recurring") or "").strip():
            return False
    return True


def _entitlement_from_price_id(price_id: str) -> dict[str, Any]:
    token = str(price_id or "").strip()
    for plan_key in PAID_PLAN_KEYS:
        first = _stripe_price_id_for_plan(plan_key, phase="first")
        recurring = _stripe_price_id_for_plan(plan_key, phase="recurring")
        if token and token in {first, recurring}:
            return {
                "plan": PLAN_LIMITS[plan_key]["plan"],
                "monthlyVfLimit": PLAN_LIMITS[plan_key]["monthlyVfLimit"],
                "dailyGenerationLimit": PLAN_LIMITS[plan_key]["dailyGenerationLimit"],
            }
    return {
        "plan": PLAN_LIMITS["free"]["plan"],
        "monthlyVfLimit": PLAN_LIMITS["free"]["monthlyVfLimit"],
        "dailyGenerationLimit": PLAN_LIMITS["free"]["dailyGenerationLimit"],
    }


def _resolve_checkout_url_override(candidate: Optional[str], fallback: str) -> str:
    def _normalize(url_value: str) -> str:
        parsed = urlparse(str(url_value or "").strip())
        if not parsed.scheme or not parsed.netloc:
            raise HTTPException(status_code=400, detail="Billing redirect URL must be absolute.")
        origin = f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"
        if VF_BILLING_REDIRECT_ALLOWLIST and origin not in VF_BILLING_REDIRECT_ALLOWLIST:
            raise HTTPException(
                status_code=400,
                detail=f"Billing redirect URL origin is not allowlisted: {origin}",
            )
        return parsed.geturl()

    fallback_url = _normalize(str(fallback or "").strip())
    value = str(candidate or "").strip()
    if not value:
        return fallback_url
    return _normalize(value)


def _normalize_token_pack_key(pack_key: str, *, strict: bool = False) -> str:
    key = str(pack_key or "").strip().lower()
    if key in TOKEN_PACK_CATALOG:
        return key
    if strict:
        raise ValueError("Invalid pack. Use micro, standard, mega, or ultra.")
    return "standard"


def _token_pack_config(pack_key: str) -> dict[str, int]:
    key = _normalize_token_pack_key(pack_key)
    return TOKEN_PACK_CATALOG[key]


def _token_pack_amount_inr_for_plan(plan_name: str, pack_key: str) -> int:
    plan_key = _plan_key_from_name(plan_name)
    pack = _token_pack_config(pack_key)
    amount = max(1, int(pack.get("priceInr") or 1))
    if plan_key == "scale":
        discount_factor = max(0.0, 1.0 - (float(TOKEN_PACK_SCALE_DISCOUNT_PCT) / 100.0))
        return _round_inr(amount * discount_factor)
    return amount


def _token_pack_vf_for_pack(pack_key: str) -> int:
    pack = _token_pack_config(pack_key)
    return max(1, int(pack.get("vf") or 1))


COUPON_TYPE_WALLET_CREDIT = "wallet_credit"
COUPON_TYPE_SUBSCRIPTION_DISCOUNT = "subscription_discount"
COUPON_TYPES = {COUPON_TYPE_WALLET_CREDIT, COUPON_TYPE_SUBSCRIPTION_DISCOUNT}
COUPON_USAGE_SINGLE_GLOBAL = "single_global"
COUPON_USAGE_SINGLE_PER_USER = "single_per_user"
COUPON_USAGE_MAX_REDEMPTIONS = "max_redemptions"
COUPON_USAGE_POLICIES = {
    COUPON_USAGE_SINGLE_GLOBAL,
    COUPON_USAGE_SINGLE_PER_USER,
    COUPON_USAGE_MAX_REDEMPTIONS,
}
COUPON_DISCOUNT_PERCENT = "percent"
COUPON_DISCOUNT_FIXED_INR = "fixed_inr"
COUPON_DISCOUNT_TYPES = {COUPON_DISCOUNT_PERCENT, COUPON_DISCOUNT_FIXED_INR}
COUPON_PLAN_SCOPE_VALUES = {
    str(plan_key or "").strip().lower()
    for plan_key in PLAN_LIMITS.keys()
    if str(plan_key or "").strip() and str(plan_key or "").strip().lower() != "free"
} or set(PAID_PLAN_KEYS)
COUPON_DEFAULT_VALIDITY_MONTHS = max(
    1,
    int((os.getenv("VF_COUPON_DEFAULT_VALIDITY_MONTHS") or "6").strip() or "6"),
)
COUPON_RESERVATION_TTL_MINUTES = max(
    5,
    int((os.getenv("VF_COUPON_RESERVATION_TTL_MINUTES") or "45").strip() or "45"),
)
COUPON_CODE_INDEX_COLLECTION = "coupon_code_index"


def _add_months_utc(base: datetime, months: int) -> datetime:
    safe_months = max(0, int(months))
    if safe_months <= 0:
        return base
    month_index = (base.month - 1) + safe_months
    year = base.year + (month_index // 12)
    month = (month_index % 12) + 1
    last_day = calendar.monthrange(year, month)[1]
    day = min(base.day, last_day)
    return base.replace(year=year, month=month, day=day)


def _coupon_default_expires_at(now: Optional[datetime] = None) -> datetime:
    base = now or _utc_now()
    return _add_months_utc(base, COUPON_DEFAULT_VALIDITY_MONTHS)


def _normalize_coupon_type(raw_type: Optional[str]) -> str:
    token = str(raw_type or "").strip().lower()
    if token in {"wallet", "wallet_credit"}:
        return COUPON_TYPE_WALLET_CREDIT
    if token in {"subscription", "subscription_discount"}:
        return COUPON_TYPE_SUBSCRIPTION_DISCOUNT
    return COUPON_TYPE_WALLET_CREDIT


def _normalize_coupon_usage_policy(raw_policy: Optional[str]) -> str:
    token = str(raw_policy or "").strip().lower()
    if token in COUPON_USAGE_POLICIES:
        return token
    if token in {"one_time", "single"}:
        return COUPON_USAGE_SINGLE_GLOBAL
    if token in {"per_user", "single_user"}:
        return COUPON_USAGE_SINGLE_PER_USER
    return COUPON_USAGE_SINGLE_PER_USER


def _normalize_coupon_discount_type(raw_type: Optional[str]) -> str:
    token = str(raw_type or "").strip().lower()
    if token in COUPON_DISCOUNT_TYPES:
        return token
    return COUPON_DISCOUNT_PERCENT


def _normalize_coupon_plan_scope(raw_scope: Any) -> list[str]:
    values: list[str] = []
    if isinstance(raw_scope, str):
        values = [item.strip().lower() for item in raw_scope.split(",") if item.strip()]
    elif isinstance(raw_scope, list):
        values = [str(item or "").strip().lower() for item in raw_scope if str(item or "").strip()]
    elif raw_scope is not None:
        values = [str(raw_scope).strip().lower()]
    normalized: list[str] = []
    for value in values:
        token = _normalize_coupon_plan_token(value)
        if not token:
            continue
        normalized.append(token)
    unique = sorted(set(normalized))
    if unique:
        return unique
    return sorted(COUPON_PLAN_SCOPE_VALUES) or list(PAID_PLAN_KEYS)


def _coupon_plan_discount_entry(
    *,
    plan: str,
    discount_type: str,
    percent_off: float,
    amount_off_inr: int,
    stripe_coupon_id: str = "",
    stripe_promotion_code_id: str = "",
) -> dict[str, Any]:
    safe_plan = _normalize_coupon_plan_token(plan)
    safe_discount_type = _normalize_coupon_discount_type(discount_type)
    safe_percent = round(float(percent_off or 0.0), 4)
    safe_amount = _as_positive_int(amount_off_inr)
    if safe_discount_type == COUPON_DISCOUNT_PERCENT:
        safe_amount = 0
    else:
        safe_percent = 0.0
    return {
        "plan": safe_plan,
        "discountType": safe_discount_type,
        "percentOff": safe_percent,
        "amountOffInr": safe_amount,
        "stripeCouponId": str(stripe_coupon_id or "").strip(),
        "stripePromotionCodeId": str(stripe_promotion_code_id or "").strip(),
    }


def _normalize_coupon_plan_discounts(
    raw_plan_discounts: Any,
    *,
    fallback_discount_type: str = "",
    fallback_percent_off: float = 0.0,
    fallback_amount_off_inr: int = 0,
    fallback_plans: Optional[list[str]] = None,
    stripe_coupons_by_plan: Optional[dict[str, Any]] = None,
) -> dict[str, dict[str, Any]]:
    mapping: dict[str, dict[str, Any]] = {}

    def _upsert_from_values(
        plan_token: str,
        discount_type_token: str,
        percent_value: float,
        amount_value: int,
        stripe_coupon_id: str = "",
        stripe_promotion_code_id: str = "",
    ) -> None:
        safe_plan = _normalize_coupon_plan_token(plan_token)
        if not safe_plan:
            return
        entry = _coupon_plan_discount_entry(
            plan=safe_plan,
            discount_type=discount_type_token,
            percent_off=percent_value,
            amount_off_inr=amount_value,
            stripe_coupon_id=stripe_coupon_id,
            stripe_promotion_code_id=stripe_promotion_code_id,
        )
        if entry["discountType"] == COUPON_DISCOUNT_PERCENT:
            if float(entry.get("percentOff") or 0.0) <= 0.0:
                return
        else:
            if _as_positive_int(entry.get("amountOffInr")) <= 0:
                return
        mapping[safe_plan] = entry

    if isinstance(raw_plan_discounts, dict):
        for plan_key, payload in raw_plan_discounts.items():
            safe_plan = re.sub(r"[^a-z0-9_-]", "", str(plan_key or "").strip().lower())
            if not safe_plan:
                continue
            row = payload if isinstance(payload, dict) else {}
            _upsert_from_values(
                safe_plan,
                str(row.get("discountType") or fallback_discount_type or COUPON_DISCOUNT_PERCENT),
                _as_float(row.get("percentOff"), fallback_percent_off),
                _as_positive_int(row.get("amountOffInr") if row.get("amountOffInr") is not None else fallback_amount_off_inr),
                stripe_coupon_id=str(row.get("stripeCouponId") or ""),
                stripe_promotion_code_id=str(row.get("stripePromotionCodeId") or ""),
            )
    elif isinstance(raw_plan_discounts, list):
        for item in raw_plan_discounts:
            if not isinstance(item, dict):
                continue
            safe_plan = re.sub(r"[^a-z0-9_-]", "", str(item.get("plan") or "").strip().lower())
            if not safe_plan:
                continue
            _upsert_from_values(
                safe_plan,
                str(item.get("discountType") or fallback_discount_type or COUPON_DISCOUNT_PERCENT),
                _as_float(item.get("percentOff"), fallback_percent_off),
                _as_positive_int(item.get("amountOffInr") if item.get("amountOffInr") is not None else fallback_amount_off_inr),
                stripe_coupon_id=str(item.get("stripeCouponId") or ""),
                stripe_promotion_code_id=str(item.get("stripePromotionCodeId") or ""),
            )

    if not mapping:
        safe_plans = _normalize_coupon_plan_scope(fallback_plans or [])
        for safe_plan in safe_plans:
            _upsert_from_values(
                safe_plan,
                fallback_discount_type or COUPON_DISCOUNT_PERCENT,
                float(fallback_percent_off or 0.0),
                _as_positive_int(fallback_amount_off_inr),
            )

    if stripe_coupons_by_plan and isinstance(stripe_coupons_by_plan, dict):
        for plan_key, stripe_coupon_id in stripe_coupons_by_plan.items():
            safe_plan = str(plan_key or "").strip().lower()
            if not safe_plan:
                continue
            existing = mapping.get(safe_plan) or _coupon_plan_discount_entry(
                plan=safe_plan,
                discount_type=fallback_discount_type or COUPON_DISCOUNT_PERCENT,
                percent_off=fallback_percent_off,
                amount_off_inr=fallback_amount_off_inr,
            )
            existing["stripeCouponId"] = str(stripe_coupon_id or "").strip()
            mapping[safe_plan] = existing

    return {plan: mapping[plan] for plan in sorted(mapping.keys())}


def _coupon_primary_plan_discount(plan_discounts: dict[str, dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not isinstance(plan_discounts, dict) or not plan_discounts:
        return None
    for preferred_plan in ("starter", "creator", "pro", "scale"):
        if preferred_plan in plan_discounts:
            return dict(plan_discounts.get(preferred_plan) or {})
    first_key = sorted(plan_discounts.keys())[0]
    return dict(plan_discounts.get(first_key) or {})


def _coupon_resolved_stripe_coupon_id_for_plan(coupon: dict[str, Any], plan_token: str) -> str:
    safe_plan = _normalize_coupon_plan_token(plan_token)
    if not safe_plan:
        return ""
    by_plan = coupon.get("stripeCouponsByPlan")
    if isinstance(by_plan, dict):
        direct = str(by_plan.get(safe_plan) or "").strip()
        if direct:
            return direct
    plan_discounts = _normalize_coupon_plan_discounts(
        coupon.get("planDiscounts"),
        fallback_discount_type=str(coupon.get("discountType") or COUPON_DISCOUNT_PERCENT),
        fallback_percent_off=_as_float(coupon.get("percentOff"), 0.0),
        fallback_amount_off_inr=_as_positive_int(coupon.get("amountOffInr")),
        fallback_plans=_normalize_coupon_plan_scope(coupon.get("appliesToPlans")),
        stripe_coupons_by_plan=by_plan if isinstance(by_plan, dict) else None,
    )
    row = plan_discounts.get(safe_plan) or {}
    plan_coupon_id = str(row.get("stripeCouponId") or "").strip()
    if plan_coupon_id:
        return plan_coupon_id
    return str(coupon.get("stripeCouponId") or "").strip()


def _stripe_cleanup_subscription_coupon_artifacts(
    *,
    stripe_promotion_ids: list[str],
    stripe_coupon_ids: list[str],
) -> None:
    if not _stripe_available():
        return
    for promotion_id in stripe_promotion_ids:
        safe_promotion_id = str(promotion_id or "").strip()
        if not safe_promotion_id:
            continue
        try:
            stripe.PromotionCode.modify(safe_promotion_id, active=False)  # type: ignore[attr-defined]
        except Exception:
            pass
    for coupon_id in stripe_coupon_ids:
        safe_coupon_id = str(coupon_id or "").strip()
        if not safe_coupon_id:
            continue
        try:
            stripe.Coupon.delete(safe_coupon_id)  # type: ignore[attr-defined]
        except Exception:
            pass


def _stripe_sync_subscription_coupon_artifacts(
    *,
    code: str,
    coupon_id: str,
    active: bool,
    plan_discounts: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    if stripe is None:
        raise HTTPException(status_code=503, detail="Stripe SDK is not available.")
    normalized = _normalize_coupon_plan_discounts(plan_discounts)
    if not normalized:
        raise HTTPException(status_code=400, detail="Missing plan discounts.")

    stripe_coupons_by_plan: dict[str, str] = {}
    created_coupon_ids: list[str] = []
    created_promotion_ids: list[str] = []
    updated_plan_discounts: dict[str, dict[str, Any]] = {}

    for plan_token, entry in sorted(normalized.items(), key=lambda item: item[0]):
        discount_type = _normalize_coupon_discount_type(str(entry.get("discountType") or COUPON_DISCOUNT_PERCENT))
        stripe_coupon_payload: dict[str, Any] = {
            "duration": "once",
            "metadata": {
                "couponCode": code,
                "couponType": COUPON_TYPE_SUBSCRIPTION_DISCOUNT,
                "plan": plan_token,
                "couponId": coupon_id,
            },
        }
        if discount_type == COUPON_DISCOUNT_PERCENT:
            percent_off = _as_float(entry.get("percentOff"), 0.0)
            if percent_off <= 0.0 or percent_off > 100.0:
                raise HTTPException(status_code=400, detail=f"Invalid percentOff for plan {plan_token}.")
            stripe_coupon_payload["percent_off"] = percent_off
        else:
            amount_off_inr = _as_positive_int(entry.get("amountOffInr"))
            if amount_off_inr <= 0:
                raise HTTPException(status_code=400, detail=f"Invalid amountOffInr for plan {plan_token}.")
            stripe_coupon_payload["amount_off"] = amount_off_inr * 100
            stripe_coupon_payload["currency"] = "inr"

        stripe_coupon = stripe.Coupon.create(**stripe_coupon_payload)  # type: ignore[attr-defined]
        stripe_coupon_id = str(stripe_coupon.get("id") or "").strip()
        if not stripe_coupon_id:
            raise HTTPException(status_code=502, detail=f"Stripe coupon create failed for plan {plan_token}.")
        created_coupon_ids.append(stripe_coupon_id)
        stripe_coupons_by_plan[plan_token] = stripe_coupon_id
        updated_plan_discounts[plan_token] = _coupon_plan_discount_entry(
            plan=plan_token,
            discount_type=discount_type,
            percent_off=_as_float(entry.get("percentOff"), 0.0),
            amount_off_inr=_as_positive_int(entry.get("amountOffInr")),
            stripe_coupon_id=stripe_coupon_id,
        )

    primary_plan = "pro" if "pro" in stripe_coupons_by_plan else sorted(stripe_coupons_by_plan.keys())[0]
    primary_coupon_id = str(stripe_coupons_by_plan.get(primary_plan) or "")
    primary_promotion_id = ""

    # Keep promotion code mapping only for single-plan discounts.
    if len(stripe_coupons_by_plan) == 1 and primary_coupon_id:
        promotion_payload = {
            "coupon": primary_coupon_id,
            "code": code,
            "active": bool(active),
            "metadata": {
                "couponCode": code,
                "couponType": COUPON_TYPE_SUBSCRIPTION_DISCOUNT,
                "couponId": coupon_id,
                "plan": primary_plan,
            },
        }
        promotion = stripe.PromotionCode.create(**promotion_payload)  # type: ignore[attr-defined]
        primary_promotion_id = str(promotion.get("id") or "").strip()
        if primary_promotion_id:
            created_promotion_ids.append(primary_promotion_id)
            updated_entry = dict(updated_plan_discounts.get(primary_plan) or {})
            updated_entry["stripePromotionCodeId"] = primary_promotion_id
            updated_plan_discounts[primary_plan] = updated_entry

    return {
        "planDiscounts": updated_plan_discounts,
        "stripeCouponsByPlan": stripe_coupons_by_plan,
        "stripeCouponId": primary_coupon_id,
        "stripePromotionCodeId": primary_promotion_id,
        "createdCouponIds": created_coupon_ids,
        "createdPromotionIds": created_promotion_ids,
    }


def _coupon_effective_usage_limit(policy: str, requested_limit: int) -> int:
    safe_policy = _normalize_coupon_usage_policy(policy)
    safe_limit = max(0, int(requested_limit))
    if safe_policy == COUPON_USAGE_SINGLE_GLOBAL:
        return 1
    if safe_policy == COUPON_USAGE_MAX_REDEMPTIONS:
        return max(1, safe_limit)
    return max(0, safe_limit)


def _is_coupon_discount_record(coupon: dict[str, Any]) -> bool:
    return _normalize_coupon_type(str(coupon.get("couponType") or coupon.get("kind") or "")) == COUPON_TYPE_SUBSCRIPTION_DISCOUNT


def _coupon_backfill_fields(coupon: dict[str, Any], now: Optional[datetime] = None) -> dict[str, Any]:
    current = dict(coupon or {})
    created_at = _parse_optional_datetime(str(current.get("createdAt") or "")) or (now or _utc_now())
    updated_at = _parse_optional_datetime(str(current.get("updatedAt") or "")) or created_at
    coupon_type = _normalize_coupon_type(str(current.get("couponType") or current.get("kind") or ""))
    usage_policy = _normalize_coupon_usage_policy(str(current.get("usagePolicy") or ""))
    legacy_limit = _as_positive_int(current.get("maxRedemptions"))
    requested_limit = _as_positive_int(current.get("usageLimit") or legacy_limit)
    usage_limit = _coupon_effective_usage_limit(usage_policy, requested_limit)

    expires = _parse_optional_datetime(str(current.get("expiresAt") or ""))
    if expires is None:
        expires = _coupon_default_expires_at(created_at)

    normalized: dict[str, Any] = {
        **current,
        "id": str(current.get("id") or ""),
        "code": _normalize_coupon_code(str(current.get("code") or "")),
        "couponType": coupon_type,
        "active": _as_bool(current.get("active") if "active" in current else True),
        "usagePolicy": usage_policy,
        "usageLimit": usage_limit,
        "maxRedemptions": usage_limit,
        "redeemedCount": _as_positive_int(current.get("redeemedCount")),
        "reservedCount": _as_positive_int(current.get("reservedCount")),
        "expiresAt": expires.isoformat() if expires else None,
        "note": str(current.get("note") or "")[:240],
        "createdBy": str(current.get("createdBy") or ""),
        "createdAt": created_at.isoformat(),
        "updatedAt": updated_at.isoformat(),
    }
    if coupon_type == COUPON_TYPE_WALLET_CREDIT:
        normalized["creditVf"] = _as_positive_int(current.get("creditVf"))
    else:
        plan_scope = _normalize_coupon_plan_scope(current.get("appliesToPlans"))
        plan_discounts = _normalize_coupon_plan_discounts(
            current.get("planDiscounts"),
            fallback_discount_type=str(current.get("discountType") or COUPON_DISCOUNT_PERCENT),
            fallback_percent_off=_as_float(current.get("percentOff"), 0.0),
            fallback_amount_off_inr=_as_positive_int(current.get("amountOffInr")),
            fallback_plans=plan_scope,
            stripe_coupons_by_plan=(current.get("stripeCouponsByPlan") if isinstance(current.get("stripeCouponsByPlan"), dict) else None),
        )
        primary_discount = _coupon_primary_plan_discount(plan_discounts) or {}
        discount_type = _normalize_coupon_discount_type(str(primary_discount.get("discountType") or current.get("discountType") or ""))
        normalized["discountType"] = discount_type
        normalized["percentOff"] = _as_float(primary_discount.get("percentOff"), _as_float(current.get("percentOff"), 0.0))
        normalized["amountOffInr"] = _as_positive_int(primary_discount.get("amountOffInr") if primary_discount.get("amountOffInr") is not None else current.get("amountOffInr"))
        normalized["appliesToPlans"] = sorted(plan_discounts.keys()) or plan_scope
        normalized["planDiscounts"] = plan_discounts
        normalized["stripeCouponsByPlan"] = {
            plan: str((entry or {}).get("stripeCouponId") or "").strip()
            for plan, entry in sorted(plan_discounts.items(), key=lambda item: item[0])
            if str((entry or {}).get("stripeCouponId") or "").strip()
        }
        normalized["subscriptionDuration"] = "first_invoice_only"
        normalized["stripeCouponId"] = str(
            current.get("stripeCouponId")
            or primary_discount.get("stripeCouponId")
            or next(iter((normalized.get("stripeCouponsByPlan") or {}).values()), "")
            or ""
        )
        normalized["stripePromotionCodeId"] = str(current.get("stripePromotionCodeId") or "")
    return normalized


def _coupon_user_key(coupon_id: str, uid: str) -> str:
    return f"{str(coupon_id or '').strip()}::{str(uid or '').strip()}"


def _coupon_usage_limit_reached(coupon: dict[str, Any]) -> bool:
    redeemed = _as_positive_int(coupon.get("redeemedCount"))
    reserved = _as_positive_int(coupon.get("reservedCount"))
    policy = _normalize_coupon_usage_policy(str(coupon.get("usagePolicy") or ""))
    usage_limit = _coupon_effective_usage_limit(policy, _as_positive_int(coupon.get("usageLimit")))
    if policy == COUPON_USAGE_SINGLE_GLOBAL:
        return (redeemed + reserved) >= 1
    if usage_limit <= 0:
        return False
    return (redeemed + reserved) >= usage_limit


def _coupon_is_expired(coupon: dict[str, Any], at_time: Optional[datetime] = None) -> bool:
    current_time = at_time or _utc_now()
    expires = _parse_optional_datetime(str(coupon.get("expiresAt") or ""))
    if not expires:
        return False
    return expires <= current_time


def _generate_coupon_code(length: int = 12, *, prefix: str = "") -> str:
    safe_length = max(6, min(32, int(length)))
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    body = "".join(alphabet[secrets.randbelow(len(alphabet))] for _ in range(safe_length))
    candidate = f"{str(prefix or '').strip().upper()}{body}"
    return _normalize_coupon_code(candidate)


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


def _coupon_sort_key(item: dict[str, Any]) -> str:
    return str(item.get("createdAt") or "")


def _coupon_store_ref(code: str) -> str:
    return str(code or "").strip().upper()


def _inmemory_rebuild_coupon_index_locked() -> None:
    _INMEMORY_COUPON_CODE_INDEX.clear()
    for coupon_id, row in _INMEMORY_COUPONS.items():
        safe_code = _coupon_store_ref(_normalize_coupon_code(str((row or {}).get("code") or "")))
        if safe_code:
            _INMEMORY_COUPON_CODE_INDEX[safe_code] = str(coupon_id or "")


def _coupon_get_inmemory_by_id(coupon_id: str) -> Optional[dict[str, Any]]:
    with _INMEMORY_LOCK:
        row = _INMEMORY_COUPONS.get(str(coupon_id or "").strip())
        if not isinstance(row, dict):
            return None
        normalized = _coupon_backfill_fields(row)
        _INMEMORY_COUPONS[str(coupon_id or "").strip()] = dict(normalized)
        safe_code = _coupon_store_ref(str(normalized.get("code") or ""))
        if safe_code:
            _INMEMORY_COUPON_CODE_INDEX[safe_code] = str(coupon_id or "").strip()
        return dict(normalized)


def _coupon_get_inmemory_by_code(code: str) -> tuple[str, Optional[dict[str, Any]]]:
    safe_code = _coupon_store_ref(_normalize_coupon_code(code))
    if not safe_code:
        return "", None
    with _INMEMORY_LOCK:
        coupon_id = str(_INMEMORY_COUPON_CODE_INDEX.get(safe_code) or "").strip()
        if not coupon_id:
            _inmemory_rebuild_coupon_index_locked()
            coupon_id = str(_INMEMORY_COUPON_CODE_INDEX.get(safe_code) or "").strip()
        if not coupon_id:
            return "", None
        row = _INMEMORY_COUPONS.get(coupon_id)
        if not isinstance(row, dict):
            return "", None
        normalized = _coupon_backfill_fields(row)
        _INMEMORY_COUPONS[coupon_id] = dict(normalized)
        _INMEMORY_COUPON_CODE_INDEX[safe_code] = coupon_id
        return coupon_id, dict(normalized)


def _coupon_index_collection() -> Any:
    return _firestore_collection(COUPON_CODE_INDEX_COLLECTION)


def _coupon_get_firestore_by_code(code: str) -> tuple[str, Optional[dict[str, Any]]]:
    if _FIRESTORE_DB is None:
        return "", None
    safe_code = _coupon_store_ref(_normalize_coupon_code(code))
    if not safe_code:
        return "", None
    index_collection = _coupon_index_collection()
    coupon_collection = _firestore_collection("coupons")
    if index_collection is None or coupon_collection is None:
        return "", None
    coupon_id = ""
    try:
        index_doc = index_collection.document(safe_code).get()
        if index_doc.exists:
            index_payload = index_doc.to_dict() or {}
            coupon_id = str(index_payload.get("couponId") or "").strip()
    except Exception:
        coupon_id = ""

    if coupon_id:
        try:
            coupon_doc = coupon_collection.document(coupon_id).get()
            if coupon_doc.exists:
                row = _coupon_backfill_fields({**(coupon_doc.to_dict() or {}), "id": coupon_id})
                return coupon_id, row
        except Exception:
            return "", None

    # Legacy fallback path and self-heal index.
    try:
        docs = list(coupon_collection.where("code", "==", safe_code).limit(1).stream())
    except Exception:
        docs = []
    if not docs:
        return "", None
    doc = docs[0]
    coupon_id = str(doc.id or "").strip()
    row = _coupon_backfill_fields({**(doc.to_dict() or {}), "id": coupon_id})
    try:
        index_collection.document(safe_code).set(
            {
                "code": safe_code,
                "couponId": coupon_id,
                "updatedAt": _utc_now().isoformat(),
            },
            merge=True,
        )
    except Exception:
        pass
    return coupon_id, row


def _coupon_generate_unique_code(prefix: str = "", length: int = 12, attempts: int = 10) -> str:
    safe_attempts = max(1, int(attempts))
    total_attempts = max(safe_attempts, safe_attempts + 24)
    last_candidate = ""
    for _ in range(total_attempts):
        candidate = _generate_coupon_code(length=length, prefix=prefix)
        if not candidate:
            continue
        last_candidate = candidate
        if _firestore_collection("coupons") is None or _FIRESTORE_DB is None:
            with _INMEMORY_LOCK:
                if candidate not in _INMEMORY_COUPON_CODE_INDEX:
                    return candidate
        else:
            index_collection = _coupon_index_collection()
            if index_collection is None:
                return candidate
            try:
                exists = index_collection.document(candidate).get().exists
            except Exception:
                exists = False
            if not exists:
                return candidate
    if last_candidate:
        return last_candidate
    return _generate_coupon_code(length=length, prefix=prefix)


def _coupon_policy_blocks_user(coupon: dict[str, Any], uid: str, redemptions_by_user: set[str]) -> bool:
    policy = _normalize_coupon_usage_policy(str(coupon.get("usagePolicy") or ""))
    if policy == COUPON_USAGE_SINGLE_GLOBAL:
        return False
    if policy == COUPON_USAGE_SINGLE_PER_USER:
        return _coupon_user_key(str(coupon.get("id") or ""), uid) in redemptions_by_user
    return False


def _credit_paid_vf(
    *,
    uid: str,
    amount: float,
    reason: str,
    transaction_id: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> tuple[bool, dict[str, Any]]:
    safe_uid = str(uid or "").strip()
    credit_amount = _as_positive_number(amount)
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
            entitlement["paidVfBalance"] = _as_positive_number(entitlement.get("paidVfBalance")) + credit_amount
            entitlement["paidVfBalance"] = _as_positive_number(entitlement.get("paidVfBalance"))
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
        entitlement["paidVfBalance"] = _as_positive_number(entitlement.get("paidVfBalance")) + credit_amount
        entitlement["paidVfBalance"] = _as_positive_number(entitlement.get("paidVfBalance"))
        entitlement["updatedAt"] = now.isoformat()
        transaction_obj.set(ent_ref, entitlement, merge=True)
        transaction_obj.set(tx_ref, {**tx_payload, "id": tx_ref.id}, merge=True)
        return True, entitlement

    return _apply(transaction)


def _normalize_conversion_policy(raw_policy: str, default: str = "AUTO_RELIABLE") -> str:
    token = str(raw_policy or "").strip().upper().replace("-", "_")
    if token == "AUTO_ROUTE":
        token = "AUTO_RELIABLE"
    if token not in VOICE_CONVERSION_POLICIES:
        return default
    return token


def _normalize_dubbing_processing_profile(raw_profile: str, default: str = "cpu_quality") -> str:
    token = str(raw_profile or "").strip().lower().replace("-", "_")
    if token not in {"cpu_quality", "cpu_balanced", "cpu_fast"}:
        return default
    return token


def _normalize_multispeaker_policy(raw_policy: str, default: str = "hybrid_auto") -> str:
    token = str(raw_policy or "").strip().lower().replace("-", "_")
    if token in {"auto_diarize", "auto"}:
        token = "hybrid_auto"
    if token not in {"hybrid_auto", "transcript_only", "diarize_only"}:
        return default
    return token


def _normalize_voice_binding_policy(raw_policy: str, default: str = "stable_fallback") -> str:
    token = str(raw_policy or "").strip().lower().replace("-", "_")
    if token not in {"stable_fallback"}:
        return default
    return token


def _normalize_qos_policy(raw_policy: str, default: str = "adaptive_hq_first") -> str:
    token = str(raw_policy or "").strip().lower().replace("-", "_")
    if token not in {"adaptive_hq_first"}:
        return default
    return token


def _normalize_hardware_policy(raw_policy: str, default: str = "gpu_preferred") -> str:
    token = str(raw_policy or "").strip().lower().replace("-", "_")
    if token not in {"gpu_preferred", "cpu_only"}:
        return default
    return token


def _normalize_timeout_policy(raw_policy: str, default: str = "adaptive") -> str:
    token = str(raw_policy or "").strip().lower().replace("-", "_")
    if token not in {"adaptive", "fixed"}:
        return default
    return token


def _normalize_live_play_mode(raw_mode: str, default: str = "progressive_audio") -> str:
    token = str(raw_mode or "").strip().lower().replace("-", "_")
    if token in {"off", "disabled", "none"}:
        return "off"
    if token not in {"progressive_audio"}:
        return default
    return token


def _detect_cuda_available() -> bool:
    try:
        import torch as th  # type: ignore

        return bool(th.cuda.is_available())
    except Exception:
        return False


def _normalize_dubbing_clip_window(raw_window: Any) -> dict[str, int] | None:
    if raw_window is None:
        return None
    if not isinstance(raw_window, dict):
        raise ValueError("advanced.clip_window must be an object with start_ms and end_ms")

    start_raw = raw_window.get("start_ms")
    end_raw = raw_window.get("end_ms")
    if start_raw is None or end_raw is None:
        raise ValueError("advanced.clip_window requires start_ms and end_ms")

    try:
        start_ms = int(float(start_raw))
        end_ms = int(float(end_raw))
    except Exception as exc:
        raise ValueError("advanced.clip_window start_ms/end_ms must be numeric") from exc

    if start_ms < 0 or end_ms < 0:
        raise ValueError("advanced.clip_window start_ms/end_ms must be non-negative")
    if end_ms <= start_ms:
        raise ValueError("advanced.clip_window end_ms must be greater than start_ms")
    return {"start_ms": start_ms, "end_ms": end_ms}


def _dubbing_processing_profile_overrides(profile: str) -> dict[str, Any]:
    normalized = _normalize_dubbing_processing_profile(profile)
    if normalized == "cpu_fast":
        return {
            "gemini_pair_group_max_concurrency": 5,
            "isochrony_tolerance_pct": 14.0,
            "mix_stretch_min_rate": 0.80,
            "mix_stretch_max_rate": 1.40,
            "llvc_preset": "tts_realtime",
        }
    if normalized == "cpu_balanced":
        return {
            "gemini_pair_group_max_concurrency": 4,
            "isochrony_tolerance_pct": 10.0,
            "mix_stretch_min_rate": 0.85,
            "mix_stretch_max_rate": 1.30,
            "llvc_preset": "llvc_hq_cpu",
        }
    return {
        "gemini_pair_group_max_concurrency": 3,
        "isochrony_tolerance_pct": 8.0,
        "mix_stretch_min_rate": 0.90,
        "mix_stretch_max_rate": 1.20,
        "llvc_preset": "llvc_hq_cpu",
    }


def _select_dubbing_qos_state(
    *,
    requested_profile: str,
    qos_policy: str,
    hardware_policy: str,
    transcript_override: str,
) -> tuple[str, dict[str, Any], dict[str, Any]]:
    selected_profile = _normalize_dubbing_processing_profile(requested_profile, default="cpu_quality")
    normalized_qos_policy = _normalize_qos_policy(qos_policy)
    normalized_hardware_policy = _normalize_hardware_policy(hardware_policy)
    gpu_used = bool(normalized_hardware_policy == "gpu_preferred" and _detect_cuda_available())
    downgraded = False
    reason = ""

    if normalized_qos_policy == "adaptive_hq_first":
        selected_profile = "cpu_quality"
        transcript_chars = len(str(transcript_override or ""))
        if transcript_chars > 6000:
            selected_profile = "cpu_balanced"
            downgraded = True
            reason = "long_script_timeout_risk"
        elif normalized_hardware_policy == "gpu_preferred" and not gpu_used:
            reason = "gpu_unavailable"

    overrides = _dubbing_processing_profile_overrides(selected_profile)
    safe_concurrency = int(overrides.get("gemini_pair_group_max_concurrency") or 3)
    if gpu_used:
        safe_concurrency = max(safe_concurrency, 7)
    overrides["gemini_pair_group_max_concurrency"] = max(1, min(7, safe_concurrency))

    qos_state = {
        "selectedProfile": selected_profile,
        "downgraded": bool(downgraded),
        "reason": reason,
        "gpuUsed": bool(gpu_used),
    }
    return selected_profile, qos_state, overrides


def _trim_media_to_clip_window(
    source_path: Path,
    output_path: Path,
    *,
    start_ms: int,
    end_ms: int,
) -> Path:
    ffmpeg = _get_ffmpeg_path()
    start_sec = max(0.0, float(start_ms) / 1000.0)
    duration_sec = max(0.05, (float(end_ms) - float(start_ms)) / 1000.0)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    _run(
        [
            ffmpeg,
            "-y",
            "-ss",
            f"{start_sec:.3f}",
            "-i",
            str(source_path),
            "-t",
            f"{duration_sec:.3f}",
            "-map",
            "0",
            "-c",
            "copy",
            str(output_path),
        ]
    )
    if not output_path.exists() or output_path.stat().st_size <= 0:
        raise RuntimeError("clip_window_trim_failed")
    return output_path


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
    capabilities_query_url = f"{capabilities_url}?engine={engine}"
    cap_ok, cap_payload, cap_detail = _fetch_runtime_json(capabilities_query_url, timeout_sec=timeout_sec)
    if cap_ok and isinstance(cap_payload, dict):
        payload = dict(cap_payload)
        payload["engine"] = engine
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


def _resolve_vertex_service_account_store_path(path_hint: str) -> Path:
    raw_hint = str(path_hint or GEMINI_VERTEX_SERVICE_ACCOUNT_FILE).strip()
    path = Path(raw_hint).expanduser()
    if path.is_absolute():
        return path.resolve()
    return (PROJECT_ROOT / path).resolve()


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


def _sanitize_gemini_source_policy_for_response(source_policy: dict[str, Any]) -> dict[str, Any]:
    policy = dict(source_policy or {})
    policy.pop("vertexServiceAccountJson", None)
    policy.pop("serviceAccountJson", None)
    policy.pop("vertexServiceAccount", None)
    service_account_ref = str(policy.get("vertexServiceAccountRef") or "").strip()
    policy["vertexServiceAccountConfigured"] = bool(service_account_ref)
    return policy


GEMINI_MASKED_KEY_TOKEN_PREFIX = "__vf_masked_key__:"
GEMINI_MASKED_KEY_TOKEN_RE = re.compile(r"^__vf_masked_key__:(?P<fp>[0-9a-f]{12})(?::(?P<hint>[a-z0-9]{0,8}))?$")


def _gemini_key_fingerprint(value: str) -> str:
    token = str(value or "").strip()
    if not token:
        return ""
    return hashlib.sha256(token.encode("utf-8", errors="ignore")).hexdigest()[:12]


def _mask_gemini_key_for_response(value: str) -> tuple[str, dict[str, Any]]:
    token = str(value or "").strip()
    if not token:
        return "", {"fingerprint": "", "masked": ""}
    fingerprint = _gemini_key_fingerprint(token)
    suffix = re.sub(r"[^a-z0-9]", "", token[-4:].lower())[:8]
    placeholder = f"{GEMINI_MASKED_KEY_TOKEN_PREFIX}{fingerprint}"
    if suffix:
        placeholder = f"{placeholder}:{suffix}"
    masked = f"{token[:4]}...{token[-4:]}" if len(token) >= 8 else ("*" * len(token))
    return placeholder, {"fingerprint": fingerprint, "masked": masked}


def _build_gemini_fingerprint_lookup(config: dict[str, Any]) -> dict[str, str]:
    lookup: dict[str, str] = {}
    pools = config.get("pools") if isinstance(config.get("pools"), dict) else {}
    for pool_name in list_gemini_pool_names(config):
        keys = list((pools.get(pool_name) or {}).get("keys") or [])
        for key in keys:
            safe_key = str(key or "").strip()
            if not safe_key:
                continue
            fingerprint = _gemini_key_fingerprint(safe_key)
            if fingerprint and fingerprint not in lookup:
                lookup[fingerprint] = safe_key
    return lookup


def _restore_masked_gemini_keys_from_payload(
    raw_payload: dict[str, Any],
    *,
    current_config: dict[str, Any],
) -> dict[str, Any]:
    if not isinstance(raw_payload, dict):
        return {}
    pools = raw_payload.get("pools")
    if not isinstance(pools, dict):
        return dict(raw_payload)

    fingerprint_lookup = _build_gemini_fingerprint_lookup(current_config)
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
                match = GEMINI_MASKED_KEY_TOKEN_RE.match(token)
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


def _sanitize_gemini_pool_config_for_response(config: dict[str, Any]) -> dict[str, Any]:
    public_config = dict(config or {})
    source_policy = public_config.get("sourcePolicy") if isinstance(public_config.get("sourcePolicy"), dict) else {}
    public_config["sourcePolicy"] = _sanitize_gemini_source_policy_for_response(dict(source_policy or {}))

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
                placeholder, metadata = _mask_gemini_key_for_response(str(key or "").strip())
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


def _sanitize_runtime_gemini_admin_payload(payload: dict[str, Any]) -> dict[str, Any]:
    safe_payload = dict(payload if isinstance(payload, dict) else {})
    for config_field in ("config", "poolConfig"):
        config_value = safe_payload.get(config_field)
        if isinstance(config_value, dict):
            safe_payload[config_field] = _sanitize_gemini_pool_config_for_response(config_value)
    source_policy = safe_payload.get("sourcePolicy")
    if isinstance(source_policy, dict):
        safe_payload["sourcePolicy"] = _sanitize_gemini_source_policy_for_response(dict(source_policy))
    meta = safe_payload.get("meta")
    if isinstance(meta, dict):
        next_meta = dict(meta)
        meta_policy = next_meta.get("sourcePolicy")
        if isinstance(meta_policy, dict):
            next_meta["sourcePolicy"] = _sanitize_gemini_source_policy_for_response(dict(meta_policy))
        safe_payload["meta"] = next_meta
    return safe_payload


def _rewrite_free_plan_pool_for_vertex(config: dict[str, Any]) -> tuple[dict[str, Any], bool, str]:
    normalized = normalize_gemini_pool_config(config)
    source_policy = dict(normalized.get("sourcePolicy") or {})
    provider = str(source_policy.get("provider") or SOURCE_POLICY_PROVIDER_GEMINI_API).strip().lower()
    if provider != SOURCE_POLICY_PROVIDER_VERTEX:
        return normalized, False, ""

    pools = normalized.get("pools") if isinstance(normalized.get("pools"), dict) else {}
    if "free" not in pools:
        pools["free"] = {"keys": []}
        normalized["pools"] = pools

    pool_names = list_gemini_pool_names(normalized)
    if not pool_names:
        pools = normalized.get("pools") if isinstance(normalized.get("pools"), dict) else {}
        pools["free"] = {"keys": []}
        normalized["pools"] = pools
        pool_names = ["free"]

    plan_pools = normalized.get("planPools") if isinstance(normalized.get("planPools"), dict) else {}
    preferred = [
        str(plan_pools.get("free") or "").strip(),
        str(plan_pools.get("pro") or "").strip(),
        str(plan_pools.get("plus") or "").strip(),
        "free",
        *pool_names,
    ]
    target_pool = ""
    for candidate in preferred:
        if candidate and candidate in pool_names:
            target_pool = candidate
            break
    if not target_pool:
        target_pool = pool_names[0]

    current_free_pool = str(plan_pools.get("free") or "").strip()
    if current_free_pool == target_pool:
        return normalized, False, target_pool
    next_plan_pools = dict(plan_pools)
    next_plan_pools["free"] = target_pool
    normalized["planPools"] = next_plan_pools
    return normalized, True, target_pool


def _sync_authoritative_gemini_free_pool(
    config: dict[str, Any],
) -> tuple[dict[str, Any], bool, list[str]]:
    normalized = normalize_gemini_pool_config(config)
    pools = normalized.get("pools") if isinstance(normalized.get("pools"), dict) else {}
    has_free_pool = "free" in pools
    source_policy = dict(normalized.get("sourcePolicy") or {})
    authoritative_mode = str(source_policy.get("freePoolMode") or "").strip().lower() == "api_file_authoritative"
    free_pool_locked = bool(source_policy.get("freePoolLocked"))
    # Allow legacy/default configs to auto-sync free pool from API file.
    # Explicitly skip only when free pool has been hard-deleted and lock mode was disabled.
    if not has_free_pool and not authoritative_mode and not free_pool_locked:
        return normalized, False, []

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
        normalized,
        file_keys,
        str(resolved_file_path),
        file_exists=file_exists,
        failure_mode="keep_last_good",
    )


def _enforce_single_free_gemini_pool(
    config: dict[str, Any],
) -> tuple[dict[str, Any], bool, list[str]]:
    normalized = normalize_gemini_pool_config(config)
    if not VF_GEMINI_SINGLE_POOL_ENFORCE:
        return normalized, False, []

    warnings: list[str] = []
    all_keys = flatten_pool_keys(normalized)
    pools = normalized.get("pools") if isinstance(normalized.get("pools"), dict) else {}
    direct_free_keys = list((pools.get("free") or {}).get("keys") or [])
    source_policy = normalized.get("sourcePolicy") if isinstance(normalized.get("sourcePolicy"), dict) else {}
    provider_token = str(source_policy.get("provider") or SOURCE_POLICY_PROVIDER_GEMINI_API).strip().lower()
    free_pool_locked = provider_token != SOURCE_POLICY_PROVIDER_VERTEX and bool(source_policy.get("freePoolLocked"))
    if len(pools.keys()) > 1:
        warnings.append("Single-pool mode forced all Gemini pools to canonical pool 'free'.")
    effective_keys = list(all_keys)
    if free_pool_locked:
        effective_keys = list(direct_free_keys)
        if len(all_keys) != len(direct_free_keys):
            warnings.append(
                "Single-pool mode ignored non-free keys because authoritative free-pool lock is enabled."
            )
    elif len(all_keys) != len(direct_free_keys):
        warnings.append("Single-pool mode collapsed multi-pool key membership into canonical pool 'free'.")

    unique_keys: list[str] = []
    seen: set[str] = set()
    for key in effective_keys:
        token = str(key or "").strip()
        if not token or token in seen:
            continue
        seen.add(token)
        unique_keys.append(token)

    next_config = dict(normalized)
    next_config["pools"] = {"free": {"keys": unique_keys}}
    next_config["fallbackChains"] = {"free": ["free"]}
    next_config["defaultFallbackChain"] = ["free"]
    next_config["planPools"] = {"free": "free", "pro": "free", "plus": "free"}
    constraints = dict(next_config.get("constraints") or {})
    constraints["uniqueKeyMembership"] = True
    next_config["constraints"] = constraints
    next_config["singlePool"] = {
        "enabled": True,
        "canonicalPoolId": "free",
        "effectivePlanPools": {"free": "free", "pro": "free", "plus": "free"},
    }
    changed = json.dumps(normalized, sort_keys=True) != json.dumps(next_config, sort_keys=True)
    return next_config, changed, warnings


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
        source_token = str((meta or {}).get("source") or "").strip().lower()
        if not flatten_pool_keys(config) and bootstrap_keys and source_token in {"default", "bootstrap"}:
            config = normalize_gemini_pool_config(config)
            pools = config.get("pools") if isinstance(config.get("pools"), dict) else {}
            pools.setdefault("free", {"keys": []})
            pools["free"]["keys"] = list(bootstrap_keys)
            config["pools"] = pools
        sync_warnings: list[str] = []
        config, synced_changed, sync_warnings = _sync_authoritative_gemini_free_pool(config)
        single_pool_warnings: list[str] = []
        config, single_pool_changed, single_pool_warnings = _enforce_single_free_gemini_pool(config)
        if synced_changed or single_pool_changed:
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
        meta["warnings"] = [*list(sync_warnings), *list(single_pool_warnings)]
        meta["sourcePolicy"] = dict(config.get("sourcePolicy") or {})
        _GEMINI_POOLS_CACHE = dict(config)
        _GEMINI_POOLS_META = dict(meta)
        return dict(_GEMINI_POOLS_CACHE), dict(_GEMINI_POOLS_META)


def _save_gemini_api_pools(config: dict[str, Any]) -> dict[str, Any]:
    file_path = _resolve_gemini_api_pools_file_path()
    firestore_db = _FIRESTORE_DB if GEMINI_API_POOLS_PREFER_FIRESTORE else None
    normalized, _single_pool_changed, single_pool_warnings = _enforce_single_free_gemini_pool(config)
    saved = save_pool_config_shared(
        file_path=file_path,
        config=normalized,
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
        warnings.extend(single_pool_warnings)
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
    keys = resolve_effective_pool_keys(config, resolve_default_gemini_pool_hint(config))
    if keys:
        return keys
    return _legacy_gemini_key_pool()


def _resolve_gemini_plan_key_pool(plan_key: str) -> list[str]:
    config, _meta = _load_gemini_api_pools()
    pool_hint = resolve_gemini_plan_pool_hint(config, plan_key)
    keys = resolve_effective_pool_keys(config, pool_hint)
    if keys:
        return keys
    return _resolve_gemini_fallback_key_pool()


def _gemini_pools_validation(config: dict[str, Any]) -> dict[str, Any]:
    duplicates = duplicate_key_memberships(config)
    pool_names = set(list_gemini_pool_names(config))
    plan_pools = config.get("planPools") if isinstance(config.get("planPools"), dict) else {}
    missing_plan_pools: dict[str, str] = {}
    for plan_key in ("free", "pro", "plus"):
        mapped = str(plan_pools.get(plan_key) or "").strip()
        if mapped and mapped not in pool_names:
            missing_plan_pools[plan_key] = mapped
    default_fallback_chain = list(config.get("defaultFallbackChain") or [])
    missing_default_chain = [pool for pool in default_fallback_chain if str(pool or "").strip() and str(pool or "").strip() not in pool_names]
    unique_required = bool((config.get("constraints") or {}).get("uniqueKeyMembership", True))
    return {
        "uniqueKeyMembership": unique_required,
        "duplicateKeys": duplicates,
        "missingPlanPools": missing_plan_pools,
        "missingDefaultFallbackPools": missing_default_chain,
        "isValid": not (unique_required and bool(duplicates)),
    }


def _backend_gemini_pool_snapshot() -> dict[str, Any]:
    config, config_meta = _load_gemini_api_pools()
    config_public = _sanitize_gemini_pool_config_for_response(config)
    default_pool_hint = resolve_default_gemini_pool_hint(config)
    key_pool = resolve_effective_pool_keys(config, default_pool_hint)
    if not key_pool:
        return {
            "ok": True,
            "pool": {"keyCount": 0, "healthyKeys": 0, "unhealthyKeys": 0, "atLimitKeys": 0},
            "keys": [],
            "models": [],
            "defaultPoolHint": default_pool_hint,
            "source": _gemini_pool_source_diagnostics(),
            "config": config_public,
            "configMeta": config_meta,
            "validation": _gemini_pools_validation(config),
        }
    BACKEND_GEMINI_ALLOCATOR.ensure_keys(key_pool)
    snapshot = BACKEND_GEMINI_ALLOCATOR.snapshot(key_pool)
    payload = dict(snapshot if isinstance(snapshot, dict) else {})
    payload["ok"] = True
    payload["source"] = _gemini_pool_source_diagnostics()
    payload["config"] = config_public
    payload["configMeta"] = config_meta
    payload["validation"] = _gemini_pools_validation(config)
    payload["defaultPoolHint"] = default_pool_hint
    pools = config.get("pools") if isinstance(config.get("pools"), dict) else {}
    fallback_chains = config.get("fallbackChains") if isinstance(config.get("fallbackChains"), dict) else {}
    global_fallback = list(config.get("defaultFallbackChain") or [])
    payload["poolSummaries"] = {
        pool_name: {
            "pool": pool_name,
            "directKeyCount": len(list((pools.get(pool_name) or {}).get("keys") or [])),
            "effectiveKeyCount": len(resolve_effective_pool_keys(config, pool_name)),
            "chain": list(fallback_chains.get(pool_name) or [pool_name, *[item for item in global_fallback if item != pool_name]]),
        }
        for pool_name in list_gemini_pool_names(config)
    }
    return payload


def _backend_gemini_pool_usage_snapshot() -> dict[str, Any]:
    config, config_meta = _load_gemini_api_pools()
    config_public = _sanitize_gemini_pool_config_for_response(config)
    pools = config.get("pools") if isinstance(config.get("pools"), dict) else {}
    fallback_chains = config.get("fallbackChains") if isinstance(config.get("fallbackChains"), dict) else {}
    global_fallback = list(config.get("defaultFallbackChain") or [])
    usage_payload: dict[str, Any] = {}
    for pool_name in list_gemini_pool_names(config):
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
            "effectiveChain": list(fallback_chains.get(pool_name) or [pool_name, *[item for item in global_fallback if item != pool_name]]),
            "direct": BACKEND_GEMINI_ALLOCATOR.snapshot(direct_keys) if direct_keys else {"pool": {"keyCount": 0}},
            "effective": BACKEND_GEMINI_ALLOCATOR.snapshot(effective_keys) if effective_keys else {"pool": {"keyCount": 0}},
        }
    return {
        "ok": True,
        "config": config_public,
        "configMeta": config_meta,
        "validation": _gemini_pools_validation(config),
        "usage": usage_payload,
    }


def _gemini_runtime_admin_headers() -> dict[str, str]:
    token = str(GEMINI_RUNTIME_ADMIN_TOKEN or "").strip()
    if not token:
        return {}
    return {"x-admin-token": token}


def _runtime_gemini_pool_snapshot(timeout_sec: float = 5.0) -> dict[str, Any]:
    runtime_headers = _gemini_runtime_admin_headers()
    endpoints = [
        f"{GEMINI_RUNTIME_URL}/v1/admin/api-pools",
        f"{GEMINI_RUNTIME_URL}/v1/admin/api-pool",
    ]
    for endpoint in endpoints:
        try:
            response = requests.get(endpoint, timeout=timeout_sec, headers=runtime_headers or None)
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
        return _sanitize_runtime_gemini_admin_payload(payload)
    return {"ok": False, "error": "runtime_pool_snapshot_unavailable"}


def _runtime_gemini_pool_reload(timeout_sec: float = 8.0) -> dict[str, Any]:
    runtime_headers = _gemini_runtime_admin_headers()
    endpoints = [
        f"{GEMINI_RUNTIME_URL}/v1/admin/api-pools/reload",
        f"{GEMINI_RUNTIME_URL}/v1/admin/api-pool/reload",
    ]
    for endpoint in endpoints:
        try:
            response = requests.post(endpoint, timeout=timeout_sec, headers=runtime_headers or None)
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
        return _sanitize_runtime_gemini_admin_payload(payload)
    return {"ok": False, "error": "runtime_pool_reload_unavailable"}


def _runtime_gemini_pool_usage(timeout_sec: float = 8.0) -> dict[str, Any]:
    endpoint = f"{GEMINI_RUNTIME_URL}/v1/admin/api-pools/usage"
    runtime_headers = _gemini_runtime_admin_headers()
    try:
        response = requests.get(endpoint, timeout=timeout_sec, headers=runtime_headers or None)
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
    return _sanitize_runtime_gemini_admin_payload(payload)


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

    llvc_available = False
    llvc_error = llvc_runtime.import_error
    current_model = llvc_runtime.current_model()
    llvc_models_dir = str(MODELS_DIR)
    llvc_backend_mode: Optional[str] = None
    llvc_resolved_model_id: Optional[str] = None
    try:
        llvc_runtime.ensure_engine()
        llvc_payload = llvc_runtime.health_payload()
        nested = llvc_payload.get("llvc") if isinstance(llvc_payload.get("llvc"), dict) else {}
        llvc_available = bool(nested.get("available"))
        current_model = str(nested.get("currentModel") or current_model or "").strip() or current_model
        llvc_models_dir = str(nested.get("modelsDir") or llvc_models_dir)
        llvc_error = str(nested.get("error") or "").strip() or None
        llvc_backend_mode = str(nested.get("backendMode") or "").strip() or None
        llvc_resolved_model_id = str(nested.get("resolvedModelId") or "").strip() or None
    except Exception as exc:
        llvc_available = False
        llvc_error = str(exc)

    source_separation_available = source_separation_runtime.ensure_available()
    source_separation_error = source_separation_runtime.import_error
    video_assets = _video_pipeline_assets_status()
    dereverb_ready = bool(VF_DUB_DEREVERB_MODEL) and any(
        str(item.get("id") or "").strip().lower().startswith("dereverb")
        and bool(item.get("exists"))
        for item in list(video_assets.get("assets") or [])
    )
    lipsync_ready = bool(VF_DUB_WAV2LIP_ONNX_PATH.exists())

    fallback_available = bool(ENABLE_LLVC_FALLBACK and ffmpeg_ok)
    response = {
        "ok": ffmpeg_ok and (source_separation_available or not ENABLE_SOURCE_SEPARATION) and bool(video_assets.get("ready")),
        "ffmpeg": {
            "available": ffmpeg_ok,
            "path": ffmpeg_path,
            "error": ffmpeg_error,
        },
        "llvc": {
            "available": llvc_available or fallback_available,
            "currentModel": current_model or (LLVC_FALLBACK_MODEL_ID if fallback_available else None),
            "resolvedModelId": llvc_resolved_model_id,
            "backendMode": llvc_backend_mode,
            "modelsDir": llvc_models_dir,
            "error": llvc_error,
            "fallbackAvailable": fallback_available,
            "fallbackModel": LLVC_FALLBACK_MODEL_ID if fallback_available else None,
            "conversionPolicies": sorted(VOICE_CONVERSION_POLICIES),
            "runtimeUrl": LLVC_RUNTIME_URL,
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
            "model": VF_DUB_PHASE1_MODEL,
            "device": SEPARATION_DEVICE,
            "cacheDir": str(SEPARATION_CACHE_DIR),
            "dereverbModel": VF_DUB_DEREVERB_MODEL,
            "dereverbReady": dereverb_ready,
            "error": source_separation_error,
        },
        "lipsync": {
            "runtime": "wav2lip-onnx",
            "assetPath": str(VF_DUB_WAV2LIP_ONNX_PATH),
            "assetReady": bool(VF_DUB_WAV2LIP_ONNX_PATH.exists()),
            "lpipsAssetPath": str(VF_DUB_LPIPS_ASSET_PATH),
            "lpipsReady": bool(VF_DUB_LPIPS_ASSET_PATH.exists()),
            "ready": lipsync_ready,
        },
        "videoPipelineAssets": video_assets,
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
                "llvcRuntime": True,
                "firebaseAuth": True,
                "stripeBilling": True,
                "usageQuota": True,
                "ttsSynthesizeProxy": True,
                "aiOpsGuardian": True,
            },
        }
    )


@app.get("/ops/guardian/status")
def ops_guardian_status(request: Request, include_route_stats: bool = False) -> JSONResponse:
    _require_permission(request, PERM_GUARDIAN_READ)
    payload = _ai_ops_build_status(include_route_stats=bool(include_route_stats))
    return JSONResponse(payload)


@app.post("/ops/guardian/scan")
def ops_guardian_scan(payload: AiOpsScanRequest, request: Request) -> JSONResponse:
    uid, actor = _require_permission(request, PERM_GUARDIAN_MUTATE)
    _require_admin_mutation_unlock(request, expected_uid=uid)
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
    _audit_append_event(
        action="guardian_scan",
        resource_type="guardian",
        resource_id="scan",
        after={"issues": len(detected_issues), "createdApprovals": len(created_approvals)},
        meta={"autoFixMinor": bool(payload.autoFixMinor), "includeRouteStats": bool(payload.includeRouteStats)},
        request=request,
        actor_uid=uid,
        actor_role=str(actor.get("role") or ""),
    )
    return JSONResponse(response_payload)


@app.post("/ops/guardian/actions")
def ops_guardian_actions(payload: AiOpsActionRequest, request: Request) -> JSONResponse:
    uid, actor = _require_permission(request, PERM_GUARDIAN_MUTATE)
    _require_admin_mutation_unlock(request, expected_uid=uid)
    try:
        action = _ai_ops_validate_action(payload.action)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    severity = _ai_ops_action_severity(action)
    authorized, auth_uid, auth_reason = _ai_ops_admin_authorized(request, None)
    if severity == "major":
        if not authorized:
            approval, created = _ai_ops_create_approval(
                action=action,
                payload=payload.payload if isinstance(payload.payload, dict) else {},
                requested_by=uid,
                reason=auth_reason,
            )
            _audit_append_event(
                action="guardian_action_approval_created",
                resource_type="guardian_action",
                resource_id=action,
                after={"approvalId": str(approval.get("id") or ""), "created": bool(created)},
                meta={"reason": auth_reason},
                request=request,
                actor_uid=uid,
                actor_role=str(actor.get("role") or ""),
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
        _audit_append_event(
            action="guardian_action_execute",
            resource_type="guardian_action",
            resource_id=action,
            after={"ok": bool(execution.get("ok")), "severity": severity},
            meta={"approvalRequired": True},
            request=request,
            actor_uid=uid,
            actor_role=str(actor.get("role") or ""),
        )
        return JSONResponse(
            {
                "ok": bool(execution.get("ok")),
                "action": action,
                "severity": severity,
                "execution": execution,
            }
        )

    if not authorized:
        raise HTTPException(status_code=403, detail=f"Admin authorization failed: {auth_reason}")

    execution = _ai_ops_execute_action(
        action=action,
        payload=payload.payload if isinstance(payload.payload, dict) else {},
        gpu=bool(payload.gpu),
        initiator=f"admin:{auth_uid}",
    )
    _audit_append_event(
        action="guardian_action_execute",
        resource_type="guardian_action",
        resource_id=action,
        after={"ok": bool(execution.get("ok")), "severity": severity},
        meta={"approvalRequired": False},
        request=request,
        actor_uid=uid,
        actor_role=str(actor.get("role") or ""),
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
def ops_guardian_approvals(request: Request, status: str = "pending") -> JSONResponse:
    _require_permission(request, PERM_GUARDIAN_READ)
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
    uid_actor, actor = _require_permission(request, PERM_GUARDIAN_MUTATE)
    _require_admin_mutation_unlock(request, expected_uid=uid_actor)
    authorized, uid, reason = _ai_ops_admin_authorized(request, None)
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
        _audit_append_event(
            action="guardian_approval_rejected",
            resource_type="guardian_approval",
            resource_id=str(approval_id),
            after={"status": "rejected"},
            meta={"note": str(payload.note or "")},
            request=request,
            actor_uid=uid_actor,
            actor_role=str(actor.get("role") or ""),
        )
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
    _audit_append_event(
        action="guardian_approval_decided",
        resource_type="guardian_approval",
        resource_id=str(approval_id),
        after={"status": str((approval_data or {}).get("status") or "")},
        meta={"executionOk": bool(execution.get("ok"))},
        request=request,
        actor_uid=uid_actor,
        actor_role=str(actor.get("role") or ""),
    )
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


def _ensure_subscription_schedule_for_loyalty(
    *,
    subscription_id: str,
    plan_key: str,
    uid: str,
) -> dict[str, Any]:
    safe_subscription_id = str(subscription_id or "").strip()
    safe_plan_key = _plan_key_from_name(plan_key)
    if not safe_subscription_id:
        return {"ok": False, "reason": "missing_subscription_id"}
    if safe_plan_key not in set(PAID_PLAN_KEYS):
        return {"ok": False, "reason": "plan_not_paid"}
    if stripe is None:
        return {"ok": False, "reason": "stripe_unavailable"}
    recurring_price_id = _stripe_price_id_for_plan(safe_plan_key, phase="recurring")
    if not recurring_price_id:
        return {"ok": False, "reason": "missing_recurring_price"}

    try:
        sub = stripe.Subscription.retrieve(safe_subscription_id)  # type: ignore[attr-defined]
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "reason": f"subscription_retrieve_failed:{exc}"}

    existing_schedule_id = str(sub.get("schedule") or "").strip() if isinstance(sub, dict) else ""
    if existing_schedule_id:
        return {"ok": True, "alreadyConfigured": True, "scheduleId": existing_schedule_id}

    def _lookup_existing_schedule() -> str:
        try:
            latest = stripe.Subscription.retrieve(safe_subscription_id)  # type: ignore[attr-defined]
        except Exception:
            return ""
        return str((latest or {}).get("schedule") or "").strip() if isinstance(latest, dict) else ""

    try:
        created = stripe.SubscriptionSchedule.create(  # type: ignore[attr-defined]
            from_subscription=safe_subscription_id,
            end_behavior="release",
            metadata={
                "uid": str(uid or "").strip(),
                "plan": safe_plan_key,
                "voiceflowLoyaltySchedule": "1",
                "voiceflowRecurringPriceId": recurring_price_id,
            },
        )
        schedule_id = str((created or {}).get("id") or "").strip()
        if schedule_id:
            try:
                stripe.SubscriptionSchedule.modify(  # type: ignore[attr-defined]
                    schedule_id,
                    phases=[
                        {
                            "items": [{"price": recurring_price_id, "quantity": 1}],
                        }
                    ],
                    proration_behavior="none",
                )
            except Exception:
                # Some stripe SDK versions reject phase mutation for from_subscription schedules.
                # Metadata still records desired recurring price for manual inspection if needed.
                pass
        return {"ok": True, "scheduleId": schedule_id}
    except Exception as exc:  # noqa: BLE001
        existing_schedule_id = _lookup_existing_schedule()
        if existing_schedule_id:
            return {"ok": True, "alreadyConfigured": True, "scheduleId": existing_schedule_id}
        return {"ok": False, "reason": f"schedule_create_failed:{exc}"}


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


def _team_slug_normalize(value: str) -> str:
    token = str(value or "").strip().lower()
    token = re.sub(r"[^a-z0-9_-]", "-", token)
    token = re.sub(r"-{2,}", "-", token).strip("-")
    if len(token) < 3 or len(token) > 48:
        raise HTTPException(status_code=400, detail="team slug must be 3-48 characters.")
    return token


def _team_status_normalize(value: str) -> str:
    token = str(value or "").strip().lower()
    if token in {"active", "disabled", "archived"}:
        return token
    return "active"


def _team_member_role_normalize(value: str) -> str:
    token = str(value or "").strip().lower()
    if token in TEAM_MEMBER_ROLES:
        return token
    return "member"


def _team_member_doc_id(team_id: str, uid: str) -> str:
    return f"{str(team_id or '').strip()}::{str(uid or '').strip()}"


def _team_get(team_id: str) -> Optional[dict[str, Any]]:
    safe_team_id = str(team_id or "").strip()
    if not safe_team_id:
        return None
    collection = _firestore_collection(TEAMS_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            row = _INMEMORY_TEAMS.get(safe_team_id)
            return dict(row) if isinstance(row, dict) else None
    try:
        doc = collection.document(safe_team_id).get()
    except Exception:
        return None
    if not doc.exists:
        return None
    return {**(doc.to_dict() or {}), "teamId": safe_team_id}


def _team_upsert(team_id: str, row: dict[str, Any]) -> dict[str, Any]:
    safe_team_id = str(team_id or "").strip() or f"team_{uuid.uuid4().hex[:12]}"
    payload = dict(row or {})
    payload["teamId"] = safe_team_id
    collection = _firestore_collection(TEAMS_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            _INMEMORY_TEAMS[safe_team_id] = dict(payload)
        return payload
    collection.document(safe_team_id).set(payload, merge=True)
    return payload


def _team_list(limit: int = 200, q: str = "") -> list[dict[str, Any]]:
    safe_limit = max(1, min(500, int(limit)))
    needle = str(q or "").strip().lower()
    collection = _firestore_collection(TEAMS_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            rows = [dict(item) for item in _INMEMORY_TEAMS.values()]
    else:
        try:
            rows = [{**(doc.to_dict() or {}), "teamId": str(doc.id or "")} for doc in collection.limit(safe_limit * 2).stream()]
        except Exception:
            rows = []
    filtered: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if needle:
            slug = str(row.get("slug") or "").lower()
            name = str(row.get("name") or "").lower()
            owner = str(row.get("ownerUserId") or "").lower()
            if needle not in slug and needle not in name and needle not in owner:
                continue
        filtered.append(row)
    filtered.sort(key=lambda item: str(item.get("updatedAt") or item.get("createdAt") or ""), reverse=True)
    return filtered[:safe_limit]


def _team_member_get(team_id: str, uid: str) -> Optional[dict[str, Any]]:
    safe_doc_id = _team_member_doc_id(team_id, uid)
    collection = _firestore_collection(TEAM_MEMBERS_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            row = _INMEMORY_TEAM_MEMBERS.get(safe_doc_id)
            return dict(row) if isinstance(row, dict) else None
    try:
        doc = collection.document(safe_doc_id).get()
    except Exception:
        return None
    if not doc.exists:
        return None
    return {**(doc.to_dict() or {}), "id": safe_doc_id}


def _team_member_upsert(team_id: str, uid: str, row: dict[str, Any]) -> dict[str, Any]:
    safe_doc_id = _team_member_doc_id(team_id, uid)
    payload = dict(row or {})
    payload["id"] = safe_doc_id
    payload["teamId"] = str(team_id or "").strip()
    payload["uid"] = str(uid or "").strip()
    collection = _firestore_collection(TEAM_MEMBERS_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            _INMEMORY_TEAM_MEMBERS[safe_doc_id] = dict(payload)
        return payload
    collection.document(safe_doc_id).set(payload, merge=True)
    return payload


def _team_member_delete(team_id: str, uid: str) -> bool:
    safe_doc_id = _team_member_doc_id(team_id, uid)
    collection = _firestore_collection(TEAM_MEMBERS_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            existed = safe_doc_id in _INMEMORY_TEAM_MEMBERS
            _INMEMORY_TEAM_MEMBERS.pop(safe_doc_id, None)
            return existed
    try:
        collection.document(safe_doc_id).delete()
    except Exception:
        return False
    return True


def _team_list_members(team_id: str, limit: int = 500) -> list[dict[str, Any]]:
    safe_team_id = str(team_id or "").strip()
    safe_limit = max(1, min(2000, int(limit)))
    collection = _firestore_collection(TEAM_MEMBERS_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            rows = [
                dict(item)
                for item in _INMEMORY_TEAM_MEMBERS.values()
                if str((item or {}).get("teamId") or "").strip() == safe_team_id
            ]
    else:
        try:
            rows = [
                {**(doc.to_dict() or {}), "id": str(doc.id or "")}
                for doc in collection.where("teamId", "==", safe_team_id).limit(safe_limit).stream()
            ]
        except Exception:
            rows = []
    rows = [row for row in rows if isinstance(row, dict)]
    rows.sort(key=lambda item: str(item.get("joinedAt") or item.get("updatedAt") or ""), reverse=False)
    return rows[:safe_limit]


def _support_ai_default_policy() -> dict[str, Any]:
    return {
        "enabled": bool(VF_SUPPORT_AI_ENABLED),
        "confidenceThreshold": float(VF_SUPPORT_AI_CONFIDENCE_THRESHOLD),
        "maxAutoRepliesPerConversation": 2,
        "allowedActions": ["classify_message", "retrieve_kb_snippets", "emit_support_reply"],
        "blockedTopics": ["legal_notice", "fraud", "chargeback"],
        "requireHumanForTags": ["billing_dispute", "account_lock", "security"],
        "updatedAt": _utc_now().isoformat(),
        "updatedBy": "system",
    }


def _support_ai_policy_get() -> dict[str, Any]:
    collection = _firestore_collection(SUPPORT_AI_POLICY_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            if not _INMEMORY_SUPPORT_AI_POLICY:
                _INMEMORY_SUPPORT_AI_POLICY.update(_support_ai_default_policy())
            return dict(_INMEMORY_SUPPORT_AI_POLICY)
    try:
        doc = collection.document("current").get()
    except Exception:
        return _support_ai_default_policy()
    if not doc.exists:
        payload = _support_ai_default_policy()
        try:
            collection.document("current").set(payload, merge=True)
        except Exception:
            pass
        return payload
    payload = doc.to_dict() or {}
    merged = _support_ai_default_policy()
    merged.update(payload)
    return merged


def _support_ai_policy_patch(patch: dict[str, Any], *, updated_by: str) -> dict[str, Any]:
    current = _support_ai_policy_get()
    next_policy = dict(current)
    if "enabled" in patch:
        next_policy["enabled"] = bool(patch.get("enabled"))
    if patch.get("confidenceThreshold") is not None:
        next_policy["confidenceThreshold"] = max(0.0, min(1.0, float(patch.get("confidenceThreshold") or 0.0)))
    if patch.get("maxAutoRepliesPerConversation") is not None:
        next_policy["maxAutoRepliesPerConversation"] = max(0, int(patch.get("maxAutoRepliesPerConversation") or 0))
    if isinstance(patch.get("allowedActions"), list):
        next_policy["allowedActions"] = [str(item or "").strip() for item in patch.get("allowedActions") if str(item or "").strip()]
    if isinstance(patch.get("blockedTopics"), list):
        next_policy["blockedTopics"] = [str(item or "").strip().lower() for item in patch.get("blockedTopics") if str(item or "").strip()]
    if isinstance(patch.get("requireHumanForTags"), list):
        next_policy["requireHumanForTags"] = [str(item or "").strip().lower() for item in patch.get("requireHumanForTags") if str(item or "").strip()]
    next_policy["updatedAt"] = _utc_now().isoformat()
    next_policy["updatedBy"] = str(updated_by or "")[:160]
    collection = _firestore_collection(SUPPORT_AI_POLICY_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            _INMEMORY_SUPPORT_AI_POLICY.clear()
            _INMEMORY_SUPPORT_AI_POLICY.update(next_policy)
        return next_policy
    collection.document("current").set(next_policy, merge=True)
    return next_policy


def _support_conversation_get(conversation_id: str) -> Optional[dict[str, Any]]:
    safe_id = str(conversation_id or "").strip()
    if not safe_id:
        return None
    collection = _firestore_collection(SUPPORT_CONVERSATIONS_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            row = _INMEMORY_SUPPORT_CONVERSATIONS.get(safe_id)
            return dict(row) if isinstance(row, dict) else None
    try:
        doc = collection.document(safe_id).get()
    except Exception:
        return None
    if not doc.exists:
        return None
    return {**(doc.to_dict() or {}), "conversationId": safe_id}


def _support_conversation_upsert(conversation_id: str, row: dict[str, Any]) -> dict[str, Any]:
    safe_id = str(conversation_id or "").strip() or f"supc_{uuid.uuid4().hex[:12]}"
    payload = dict(row or {})
    payload["conversationId"] = safe_id
    collection = _firestore_collection(SUPPORT_CONVERSATIONS_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            _INMEMORY_SUPPORT_CONVERSATIONS[safe_id] = dict(payload)
        return payload
    collection.document(safe_id).set(payload, merge=True)
    return payload


def _support_message_upsert(message_id: str, row: dict[str, Any]) -> dict[str, Any]:
    safe_id = str(message_id or "").strip() or f"supm_{uuid.uuid4().hex[:12]}"
    payload = dict(row or {})
    payload["messageId"] = safe_id
    collection = _firestore_collection(SUPPORT_MESSAGES_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            _INMEMORY_SUPPORT_MESSAGES[safe_id] = dict(payload)
        return payload
    collection.document(safe_id).set(payload, merge=True)
    return payload


def _support_ai_run_upsert(run_id: str, row: dict[str, Any]) -> dict[str, Any]:
    safe_id = str(run_id or "").strip() or f"supai_{uuid.uuid4().hex[:12]}"
    payload = dict(row or {})
    payload["runId"] = safe_id
    collection = _firestore_collection(SUPPORT_AI_RUNS_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            _INMEMORY_SUPPORT_AI_RUNS[safe_id] = dict(payload)
        return payload
    collection.document(safe_id).set(payload, merge=True)
    return payload


def _support_list_messages(conversation_id: str, limit: int = 500) -> list[dict[str, Any]]:
    safe_id = str(conversation_id or "").strip()
    safe_limit = max(1, min(2000, int(limit)))
    collection = _firestore_collection(SUPPORT_MESSAGES_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            rows = [
                dict(item)
                for item in _INMEMORY_SUPPORT_MESSAGES.values()
                if str((item or {}).get("conversationId") or "").strip() == safe_id
            ]
    else:
        try:
            rows = [
                {**(doc.to_dict() or {}), "messageId": str(doc.id or "")}
                for doc in collection.where("conversationId", "==", safe_id).limit(safe_limit).stream()
            ]
        except Exception:
            rows = []
    rows = [row for row in rows if isinstance(row, dict)]
    rows.sort(key=lambda item: str(item.get("createdAt") or ""), reverse=False)
    return rows[:safe_limit]


def _support_list_conversations(*, status: str = "", limit: int = 200, q: str = "") -> list[dict[str, Any]]:
    safe_status = str(status or "").strip().lower()
    safe_limit = max(1, min(500, int(limit)))
    needle = str(q or "").strip().lower()
    collection = _firestore_collection(SUPPORT_CONVERSATIONS_COLLECTION)
    if collection is None:
        with _INMEMORY_LOCK:
            rows = [dict(item) for item in _INMEMORY_SUPPORT_CONVERSATIONS.values()]
    else:
        try:
            rows = [{**(doc.to_dict() or {}), "conversationId": str(doc.id or "")} for doc in collection.limit(safe_limit * 2).stream()]
        except Exception:
            rows = []
    filtered: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if safe_status and str(row.get("status") or "").strip().lower() != safe_status:
            continue
        if needle:
            user_id = str(row.get("userId") or "").strip().lower()
            uid = str(row.get("uid") or "").strip().lower()
            if needle not in user_id and needle not in uid:
                continue
        filtered.append(row)
    filtered.sort(key=lambda item: str(item.get("lastMessageAt") or item.get("updatedAt") or ""), reverse=True)
    return filtered[:safe_limit]


def _support_open_or_touch_yellow_alert(conversation_id: str, *, reason: str) -> dict[str, Any]:
    now_iso = _utc_now().isoformat()
    existing = None
    for row in _alert_list_events(limit=500):
        if str(row.get("resourceType") or "").strip().lower() != "support_conversation":
            continue
        if str(row.get("resourceId") or "").strip() != str(conversation_id or "").strip():
            continue
        if str(row.get("status") or "").strip().lower() == "open":
            existing = row
            break
    if existing is None:
        event = {
            "policyId": "support_unresolved",
            "resourceType": "support_conversation",
            "resourceId": str(conversation_id or "").strip(),
            "status": "open",
            "severity": "warning",
            "openedAt": now_iso,
            "lastTriggeredAt": now_iso,
            "resolvedAt": None,
            "samples": [{"ts": now_iso, "reason": reason}],
            "channels": ["in_app"],
            "delivery": [],
        }
        return _alert_upsert_event("", event)
    samples = list(existing.get("samples") or [])
    samples.append({"ts": now_iso, "reason": reason})
    existing["samples"] = samples[-40:]
    existing["lastTriggeredAt"] = now_iso
    existing["severity"] = "warning"
    return _alert_upsert_event(str(existing.get("id") or ""), existing)


def _support_resolve_alert_if_open(conversation_id: str) -> None:
    for row in _alert_list_events(limit=500):
        if str(row.get("resourceType") or "").strip().lower() != "support_conversation":
            continue
        if str(row.get("resourceId") or "").strip() != str(conversation_id or "").strip():
            continue
        if str(row.get("status") or "").strip().lower() != "open":
            continue
        row["status"] = "resolved"
        row["resolvedAt"] = _utc_now().isoformat()
        _alert_upsert_event(str(row.get("id") or ""), row)
        return


def _support_ai_confidence_score(text: str) -> float:
    content = str(text or "").strip().lower()
    if not content:
        return 0.0
    keywords = [
        "coupon",
        "plan",
        "billing",
        "invoice",
        "payment",
        "login",
        "password",
        "voice",
        "audio",
        "error",
        "failed",
        "subscription",
    ]
    hits = sum(1 for token in keywords if token in content)
    base = 0.32 + min(0.52, hits * 0.08)
    if len(content) >= 24:
        base += 0.05
    if "?" in content:
        base += 0.04
    return max(0.0, min(0.98, round(base, 4)))


def _support_ai_reply_text(user_text: str) -> str:
    text = str(user_text or "").strip()
    if not text:
        return "I could not read your message clearly. Please share more details so I can help."
    return (
        "Thanks for reporting this. I checked your query and suggested quick steps: "
        "verify plan/coupon settings, refresh session, and retry once. "
        "If the issue continues, reply \"still unresolved\" and a human agent will take over."
    )


def _support_ai_count_messages(conversation_id: str, from_type: str) -> int:
    safe_conv = str(conversation_id or "").strip()
    safe_from_type = str(from_type or "").strip().lower()
    if not safe_conv or not safe_from_type:
        return 0
    count = 0
    for row in _support_list_messages(safe_conv, limit=1000):
        if str(row.get("fromType") or "").strip().lower() == safe_from_type:
            count += 1
    return count


def _support_ai_action_allowed(policy: dict[str, Any], action: str) -> bool:
    allowed = [str(item or "").strip().lower() for item in list(policy.get("allowedActions") or [])]
    return str(action or "").strip().lower() in set(allowed)


def _support_try_ai_autoreply(
    *,
    conversation: dict[str, Any],
    user_message: dict[str, Any],
    request: Optional[Request],
) -> dict[str, Any]:
    now_iso = _utc_now().isoformat()
    conversation_id = str(conversation.get("conversationId") or "").strip()
    uid = str(conversation.get("uid") or "").strip()
    user_id = str(conversation.get("userId") or "").strip().lower()
    text = str(user_message.get("text") or "").strip()
    policy = _support_ai_policy_get()
    run = {
        "conversationId": conversation_id,
        "messageId": str(user_message.get("messageId") or ""),
        "uid": uid,
        "userId": user_id,
        "status": "evaluating",
        "reason": "",
        "confidence": 0.0,
        "createdAt": now_iso,
        "updatedAt": now_iso,
    }
    blocked_topics = [str(item or "").strip().lower() for item in list(policy.get("blockedTopics") or [])]
    text_lc = text.lower()
    blocked_hit = next((topic for topic in blocked_topics if topic and topic in text_lc), "")
    max_auto = max(0, int(policy.get("maxAutoRepliesPerConversation") or 0))
    sent_ai_count = _support_ai_count_messages(conversation_id, "ai")
    confidence = _support_ai_confidence_score(text)
    threshold = max(0.0, min(1.0, float(policy.get("confidenceThreshold") or VF_SUPPORT_AI_CONFIDENCE_THRESHOLD)))
    run["confidence"] = confidence

    def _escalate(reason: str) -> dict[str, Any]:
        conversation["status"] = "needs_human"
        conversation["priority"] = "yellow"
        conversation["lastMessageAt"] = now_iso
        conversation["updatedAt"] = now_iso
        _support_conversation_upsert(conversation_id, conversation)
        run["status"] = "escalated"
        run["reason"] = reason
        run["updatedAt"] = now_iso
        written_run = _support_ai_run_upsert("", run)
        _support_open_or_touch_yellow_alert(conversation_id, reason=reason)
        _audit_append_event(
            action="support_ai_escalated",
            resource_type="support_conversation",
            resource_id=conversation_id,
            after={"reason": reason, "confidence": confidence},
            request=request,
            actor_uid=uid,
            actor_role="user",
            subject_uid=uid,
            subject_user_id=user_id,
        )
        return {
            "ok": True,
            "mode": "escalated",
            "reason": reason,
            "conversation": conversation,
            "run": written_run,
        }

    if not VF_SUPPORT_AI_ENABLED or not VF_SUPPORT_AI_AUTOREPLY_ENABLED:
        return _escalate("support_ai_disabled")
    if not _as_bool(policy.get("enabled")):
        return _escalate("policy_disabled")
    if not _support_ai_action_allowed(policy, "emit_support_reply"):
        run["status"] = "blocked"
        run["reason"] = "blocked_by_policy"
        run["updatedAt"] = now_iso
        written_run = _support_ai_run_upsert("", run)
        _audit_append_event(
            action="support_ai_blocked_by_policy",
            resource_type="support_conversation",
            resource_id=conversation_id,
            after={"reason": "blocked_by_policy"},
            request=request,
            actor_uid=uid,
            actor_role="user",
            subject_uid=uid,
            subject_user_id=user_id,
        )
        return _escalate("blocked_by_policy")
    if blocked_hit:
        return _escalate(f"blocked_topic:{blocked_hit}")
    if sent_ai_count >= max_auto:
        return _escalate("max_auto_replies_reached")
    if confidence < threshold:
        return _escalate("low_confidence")

    ai_reply = _support_message_upsert(
        "",
        {
            "conversationId": conversation_id,
            "fromType": "ai",
            "uid": uid,
            "userId": user_id,
            "text": _support_ai_reply_text(text),
            "attachmentsMeta": [],
            "resolutionFlag": "ai_answered",
            "createdAt": now_iso,
        },
    )
    conversation["status"] = "ai_answered"
    conversation["priority"] = "green"
    conversation["lastMessageAt"] = now_iso
    conversation["updatedAt"] = now_iso
    _support_conversation_upsert(conversation_id, conversation)
    run["status"] = "reply_sent"
    run["reason"] = "ok"
    run["updatedAt"] = now_iso
    written_run = _support_ai_run_upsert("", run)
    _audit_append_event(
        action="support_ai_reply_sent",
        resource_type="support_conversation",
        resource_id=conversation_id,
        after={"confidence": confidence},
        request=request,
        actor_uid=uid,
        actor_role="user",
        subject_uid=uid,
        subject_user_id=user_id,
    )
    return {"ok": True, "mode": "ai_reply", "conversation": conversation, "aiMessage": ai_reply, "run": written_run}


def _admin_list_users(limit: int, search: str = "") -> list[dict[str, Any]]:
    def _entitlement_view(entitlement_payload: dict[str, Any]) -> tuple[str, dict[str, Any], dict[str, Any]]:
        plan_name = _normalize_plan_name(str(entitlement_payload.get("plan") or "Free"))
        plan_key = _plan_key_from_name(plan_name)
        guardrails = TTS_PLAN_GUARDRAILS.get(plan_key) or TTS_PLAN_GUARDRAILS["free"]
        return (
            plan_name,
            {"earlyAccess": _plan_has_early_access(plan_key)},
            {"maxCharsPerGeneration": max(1, int(guardrails.get("maxChars") or 1))},
        )

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
            entitlement = _load_entitlement(uid)
            monthly, daily = _load_usage_windows(uid)
            custom_claims = getattr(record, "custom_claims", None) or {}
            profile = _ensure_user_profile(
                uid,
                allow_auto_backfill=True,
            ) or {}
            user_id = str(profile.get("userId") or "").strip().lower()
            if needle:
                haystack = f"{uid} {email} {display_name} {user_id}".lower()
                if needle not in haystack:
                    continue
            plan_name, features, limits = _entitlement_view(entitlement)
            users.append(
                {
                    "uid": uid,
                    "userId": user_id,
                    "email": email,
                    "displayName": display_name,
                    "disabled": disabled,
                    "admin": _as_bool(custom_claims.get("admin")) or _firestore_user_is_admin(uid),
                    "plan": plan_name,
                    "status": str(entitlement.get("status") or "free_active"),
                    "features": features,
                    "limits": limits,
                    "wallet": {
                        "paidVfBalance": _as_positive_number(entitlement.get("paidVfBalance")),
                        "vffBalance": _as_positive_number(entitlement.get("vffBalance")),
                    },
                    "usage": {
                        "monthlyVfUsed": _as_positive_number(monthly.get("vfUsed")),
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
                profile = _ensure_user_profile(uid, allow_auto_backfill=True) or {}
                user_id = str(profile.get("userId") or "").strip().lower()
                if needle:
                    haystack = f"{uid} {user_id}".lower()
                    if needle not in haystack:
                        continue
                plan_name, features, limits = _entitlement_view(entitlement)
                users.append(
                    {
                        "uid": uid,
                        "userId": user_id,
                        "email": "",
                        "displayName": uid,
                        "disabled": False,
                        "admin": uid in VF_ADMIN_APPROVER_UIDS or uid.startswith("local_admin"),
                        "plan": plan_name,
                        "status": str(entitlement.get("status") or "free_active"),
                        "features": features,
                        "limits": limits,
                        "wallet": {
                            "paidVfBalance": _as_positive_number(entitlement.get("paidVfBalance")),
                            "vffBalance": _as_positive_number(entitlement.get("vffBalance")),
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
        profile = _ensure_user_profile(uid, allow_auto_backfill=True) or {}
        user_id = str(profile.get("userId") or "").strip().lower()
        if needle:
            haystack = f"{uid} {user_id}".lower()
            if needle not in haystack:
                continue
        plan_name, features, limits = _entitlement_view(entitlement)
        users.append(
            {
                "uid": uid,
                "userId": user_id,
                "email": "",
                "displayName": uid,
                "disabled": False,
                "admin": _firestore_user_is_admin(uid),
                "plan": plan_name,
                "status": str(entitlement.get("status") or "free_active"),
                "features": features,
                "limits": limits,
                "wallet": {
                    "paidVfBalance": _as_positive_number(entitlement.get("paidVfBalance")),
                    "vffBalance": _as_positive_number(entitlement.get("vffBalance")),
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


@app.get("/account/profile")
def account_profile(request: Request) -> JSONResponse:
    uid = _require_request_uid(request)
    is_admin = _request_is_admin(request, uid)
    profile = _user_profile_read(uid)
    if profile is None and not is_admin and (not VF_USER_ID_REQUIRED or not VF_AUTH_ENFORCE):
        profile = _ensure_user_profile(uid, request=request, allow_auto_backfill=True)
    required = bool(
        (not is_admin)
        and VF_USER_ID_REQUIRED
        and VF_AUTH_ENFORCE
        and not str((profile or {}).get("userId") or "").strip()
    )
    suggested = "" if is_admin else _user_profile_backfill_candidate(uid, _request_claim_email(request), "")
    return JSONResponse(
        {
            "ok": True,
            "requiredUserId": required,
            "suggestedUserId": suggested,
            "profile": profile or {"uid": uid, "userId": "", "status": "admin" if is_admin else "pending"},
        }
    )


@app.post("/account/profile")
def account_profile_upsert(payload: UserProfileUpsertRequest, request: Request) -> JSONResponse:
    uid = _require_request_uid(request)
    if _request_is_admin(request, uid):
        raise HTTPException(status_code=403, detail="Admin accounts do not use userId.")
    before = _user_profile_read(uid) or {}
    row = _user_profile_upsert(
        uid,
        user_id=payload.userId,
        display_name=payload.displayName,
        email=_request_claim_email(request) or str(before.get("email") or ""),
        created_by=uid,
        updated_by=uid,
        force_change=False,
        allow_existing_immutable=False,
    )
    _audit_append_event(
        action="user_profile_set",
        resource_type="user_profile",
        resource_id=str(uid),
        before=before,
        after=row,
        request=request,
        actor_uid=uid,
        actor_role="user",
        subject_uid=uid,
    )
    return JSONResponse({"ok": True, "profile": row})


@app.post("/account/profile/bootstrap")
def account_profile_bootstrap(request: Request) -> JSONResponse:
    uid = _require_request_uid(request)
    if _request_is_admin(request, uid):
        profile = _user_profile_read(uid)
        return JSONResponse({"ok": True, "profile": profile or {"uid": uid, "userId": "", "status": "admin"}})
    profile = _ensure_user_profile(uid, request=request, allow_auto_backfill=True)
    return JSONResponse({"ok": True, "profile": profile or {"uid": uid, "userId": ""}})


@app.get("/account/entitlements")
def account_entitlements(request: Request) -> JSONResponse:
    uid = _require_request_uid(request)
    _require_user_id_ready(request, uid)
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
                entitlement["vffBalance"] = 0.0
                entitlement["vffMonthKey"] = month_key
            entitlement["vffBalance"] = _as_positive_number(entitlement.get("vffBalance")) + float(VF_AD_REWARD_VFF_AMOUNT)
            entitlement["vffBalance"] = _as_positive_number(entitlement.get("vffBalance"))
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
            entitlement["vffBalance"] = 0.0
            entitlement["vffMonthKey"] = month_key
        entitlement["vffBalance"] = _as_positive_number(entitlement.get("vffBalance")) + float(VF_AD_REWARD_VFF_AMOUNT)
        entitlement["vffBalance"] = _as_positive_number(entitlement.get("vffBalance"))
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
    admin_limit_bypass = bool(VF_ADMIN_COUPON_LIMIT_BYPASS and _request_is_admin(request, uid))
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
            safe_code = _coupon_store_ref(code)
            coupon_id = str(_INMEMORY_COUPON_CODE_INDEX.get(safe_code) or "").strip()
            if not coupon_id:
                _inmemory_rebuild_coupon_index_locked()
                coupon_id = str(_INMEMORY_COUPON_CODE_INDEX.get(safe_code) or "").strip()
            if not coupon_id:
                raise HTTPException(status_code=404, detail="Coupon not found.")
            coupon_row = _INMEMORY_COUPONS.get(coupon_id) or {}
            coupon = _coupon_backfill_fields(coupon_row or {}, now)
            if not _as_bool(coupon.get("active")):
                raise HTTPException(status_code=400, detail="Coupon is inactive.")
            if _coupon_is_expired(coupon, now):
                raise HTTPException(status_code=400, detail="Coupon has expired.")
            if _normalize_coupon_type(str(coupon.get("couponType") or "")) != COUPON_TYPE_WALLET_CREDIT:
                raise HTTPException(status_code=400, detail="Coupon is not redeemable as wallet credit.")
            policy = _normalize_coupon_usage_policy(str(coupon.get("usagePolicy") or ""))
            user_coupon_key = _coupon_user_key(coupon_id, uid)
            has_user_redeemed = any(
                str((entry or {}).get("couponId") or "").strip() == coupon_id
                and str((entry or {}).get("uid") or "").strip() == uid
                and str((entry or {}).get("channel") or "wallet").strip().lower() == "wallet"
                and str((entry or {}).get("status") or "redeemed").strip().lower() in {"reserved", "redeemed"}
                for entry in _INMEMORY_COUPON_REDEMPTIONS.values()
            )
            if not admin_limit_bypass and policy == COUPON_USAGE_SINGLE_PER_USER and has_user_redeemed:
                raise HTTPException(status_code=409, detail="Coupon already redeemed by this user.")
            if not admin_limit_bypass and _coupon_usage_limit_reached(coupon):
                raise HTTPException(status_code=400, detail="Coupon redemption limit reached.")
            credit_vf = _as_positive_int(coupon.get("creditVf"))
            if credit_vf <= 0:
                raise HTTPException(status_code=400, detail="Coupon has no redeemable value.")

            coupon["redeemedCount"] = _as_positive_int(coupon.get("redeemedCount")) + 1
            coupon["updatedAt"] = now.isoformat()
            _INMEMORY_COUPONS[coupon_id] = dict(coupon)
            redemption_key = (
                f"{coupon_id}_{uid}_{uuid.uuid4().hex}"
                if policy in {COUPON_USAGE_SINGLE_GLOBAL, COUPON_USAGE_MAX_REDEMPTIONS} or admin_limit_bypass
                else user_coupon_key
            )
            _INMEMORY_COUPON_REDEMPTIONS[redemption_key] = {
                "id": redemption_key,
                "couponId": coupon_id,
                "uid": uid,
                "code": code,
                "creditedVf": credit_vf,
                "channel": "wallet",
                "status": "redeemed",
                "usagePolicy": policy,
                "couponType": COUPON_TYPE_WALLET_CREDIT,
                "createdAt": now.isoformat(),
            }
        coupon_tx_id = (
            f"coupon_wallet_{coupon_id}_{uid}_{uuid.uuid4().hex}"
            if policy in {COUPON_USAGE_SINGLE_GLOBAL, COUPON_USAGE_MAX_REDEMPTIONS} or admin_limit_bypass
            else f"coupon_wallet_{coupon_id}_{uid}"
        )
        _credit_paid_vf(
            uid=uid,
            amount=credit_vf,
            reason="coupon_redeem",
            transaction_id=coupon_tx_id,
            metadata={
                "couponId": coupon_id,
                "code": code,
                "channel": "wallet",
                "usagePolicy": policy,
                "adminLimitBypass": bool(admin_limit_bypass),
            },
        )
        _audit_append_event(
            action="wallet_coupon_redeem",
            resource_type="coupon_redemption",
            resource_id=f"{coupon_id}:{uid}",
            after={"couponId": coupon_id, "code": code, "creditedVf": credit_vf, "channel": "wallet"},
            request=request,
            actor_uid=uid,
            actor_role="user",
            subject_uid=uid,
        )
        return JSONResponse({"ok": True, "creditedVf": credit_vf, "entitlements": _entitlement_usage_payload(uid)})

    coupon_id, coupon_lookup = _coupon_get_firestore_by_code(code)
    if not coupon_id or not coupon_lookup:
        raise HTTPException(status_code=404, detail="Coupon not found.")
    coupon_lookup = _coupon_backfill_fields(coupon_lookup, now)
    if _normalize_coupon_type(str(coupon_lookup.get("couponType") or "")) != COUPON_TYPE_WALLET_CREDIT:
        raise HTTPException(status_code=400, detail="Coupon is not redeemable as wallet credit.")
    policy = _normalize_coupon_usage_policy(str(coupon_lookup.get("usagePolicy") or ""))
    redemption_doc_id = (
        f"{coupon_id}_{uid}_{uuid.uuid4().hex}"
        if policy in {COUPON_USAGE_SINGLE_GLOBAL, COUPON_USAGE_MAX_REDEMPTIONS} or admin_limit_bypass
        else f"{coupon_id}::{uid}::wallet"
    )
    tx_doc_id = (
        f"coupon_wallet_{coupon_id}_{uid}_{uuid.uuid4().hex}"
        if policy in {COUPON_USAGE_SINGLE_GLOBAL, COUPON_USAGE_MAX_REDEMPTIONS} or admin_limit_bypass
        else f"coupon_wallet_{coupon_id}_{uid}"
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
        coupon = _coupon_backfill_fields({**(fresh_coupon_doc.to_dict() or {}), "id": coupon_id}, now)
        if not _as_bool(coupon.get("active")):
            raise RuntimeError("Coupon is inactive.")
        if _coupon_is_expired(coupon, now):
            raise RuntimeError("Coupon has expired.")
        if not admin_limit_bypass and policy == COUPON_USAGE_SINGLE_PER_USER:
            redemption_doc = redemption_ref.get(transaction=transaction_obj)
            if redemption_doc.exists:
                raise RuntimeError("Coupon already redeemed by this user.")
        if not admin_limit_bypass and _coupon_usage_limit_reached(coupon):
            raise RuntimeError("Coupon redemption limit reached.")
        credit_vf = _as_positive_int(coupon.get("creditVf"))
        if credit_vf <= 0:
            raise RuntimeError("Coupon has no redeemable value.")

        ent_doc = entitlement_ref.get(transaction=transaction_obj)
        entitlement = _normalize_entitlement_wallet(ent_doc.to_dict() if ent_doc.exists else _default_entitlement(uid), now)
        entitlement["paidVfBalance"] = _as_positive_number(entitlement.get("paidVfBalance")) + _as_positive_number(credit_vf)
        entitlement["paidVfBalance"] = _as_positive_number(entitlement.get("paidVfBalance"))
        entitlement["updatedAt"] = now.isoformat()
        coupon["redeemedCount"] = _as_positive_int(coupon.get("redeemedCount")) + 1
        coupon["updatedAt"] = now.isoformat()

        transaction_obj.set(coupon_ref, coupon, merge=True)
        transaction_obj.set(
            redemption_ref,
            {
                "id": redemption_ref.id,
                "couponId": coupon_id,
                "uid": uid,
                "code": code,
                "creditedVf": credit_vf,
                "channel": "wallet",
                "status": "redeemed",
                "usagePolicy": policy,
                "couponType": COUPON_TYPE_WALLET_CREDIT,
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
                    "channel": "wallet",
                    "usagePolicy": policy,
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

    _audit_append_event(
        action="wallet_coupon_redeem",
        resource_type="coupon_redemption",
        resource_id=f"{coupon_id}:{uid}",
        after={"couponId": coupon_id, "code": code, "creditedVf": credited_vf, "channel": "wallet"},
        request=request,
        actor_uid=uid,
        actor_role="user",
        subject_uid=uid,
    )
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


@app.post("/admin/session-unlock/issue")
def admin_session_unlock_issue(request: Request) -> JSONResponse:
    uid = _require_admin_uid(request)
    issued = _admin_unlock_issue_for_request(request, uid)
    status_payload = _admin_unlock_status_for_request(request, uid)
    return JSONResponse(
        {
            "ok": True,
            "uid": uid,
            "unlockKey": issued.get("unlockKey"),
            "keyExpiresAtMs": issued.get("keyExpiresAtMs"),
            "keyExpiresAt": issued.get("keyExpiresAt"),
            "status": status_payload,
        }
    )


@app.post("/admin/session-unlock/verify")
def admin_session_unlock_verify(
    payload: AdminSessionUnlockVerifyRequest,
    request: Request,
) -> JSONResponse:
    uid = _require_admin_uid(request)
    verified = _admin_unlock_verify_for_request(
        request,
        uid=uid,
        unlock_key=payload.unlockKey,
    )
    status_payload = _admin_unlock_status_for_request(request, uid)
    return JSONResponse(
        {
            "ok": True,
            "uid": uid,
            "unlockToken": verified.get("unlockToken"),
            "expiresAtMs": verified.get("expiresAtMs"),
            "expiresAt": verified.get("expiresAt"),
            "status": status_payload,
        }
    )


@app.get("/admin/session-unlock/status")
def admin_session_unlock_status(request: Request) -> JSONResponse:
    uid = _require_admin_uid(request)
    return JSONResponse({"ok": True, "uid": uid, "status": _admin_unlock_status_for_request(request, uid)})


@app.get("/admin/usage/reset-daily-all/status")
def admin_daily_usage_reset_status(request: Request) -> JSONResponse:
    _require_permission(request, PERM_OPS_READ)
    payload = _load_daily_usage_reset_status()
    if not payload:
        return JSONResponse({"ok": True, "status": "never_run"})
    return JSONResponse({"ok": True, "status": "available", "lastRun": payload})


@app.post("/admin/usage/reset-daily-all")
def admin_reset_daily_usage_all(request: Request, dryRun: bool = False) -> JSONResponse:
    admin_uid, actor = _require_permission(request, PERM_OPS_MUTATE)
    _require_admin_mutation_unlock(request, expected_uid=admin_uid)
    summary = _reset_daily_usage_all(dry_run=bool(dryRun), requested_by=admin_uid)
    _audit_append_event(
        action="daily_usage_reset",
        resource_type="usage",
        resource_id="daily_all",
        after=summary if isinstance(summary, dict) else {},
        meta={"dryRun": bool(dryRun)},
        request=request,
        actor_uid=admin_uid,
        actor_role=str(actor.get("role") or ""),
    )
    return JSONResponse(summary)


@app.get("/admin/tts/gateway/status")
def admin_tts_gateway_status(request: Request) -> JSONResponse:
    _require_permission(request, PERM_OPS_READ)
    return JSONResponse(
        {
            "ok": True,
            "gateway": _TTS_GATEWAY_CONTROLLER.snapshot(),
            "jobQueue": _TTS_JOB_QUEUE.depth_snapshot(),
        }
    )


@app.get("/admin/tts/queue/metrics")
def admin_tts_queue_metrics(request: Request) -> JSONResponse:
    _require_permission(request, PERM_OPS_READ)
    return JSONResponse(_tts_queue_metrics_snapshot())


@app.get("/admin/integrations/usage")
def admin_integrations_usage(request: Request) -> JSONResponse:
    _require_permission(request, PERM_OPS_READ)
    return JSONResponse(_admin_usage_summary_payload())


@app.get("/admin/integrations/usage/export")
def admin_integrations_usage_export(
    request: Request,
    format: str = "json",
    window: str = "total",
) -> Response:
    _require_permission(request, PERM_OPS_READ)
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
    _require_permission(request, PERM_USERS_READ)
    rows = _admin_list_users(limit=limit, search=q)
    return JSONResponse({"ok": True, "users": rows, "count": len(rows)})


@app.patch("/admin/users/{target_uid}")
def admin_patch_user(target_uid: str, payload: AdminUserPatchRequest, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_USERS_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    uid = str(target_uid or "").strip()
    if not uid:
        raise HTTPException(status_code=400, detail="Missing user uid.")
    entitlement = _normalize_entitlement_wallet(_load_entitlement(uid))
    before_entitlement = dict(entitlement)

    patch: dict[str, Any] = {}
    if payload.plan is not None:
        normalized_plan = _normalize_plan_name(payload.plan)
        plan_cfg = _plan_config(normalized_plan)
        patch["plan"] = normalized_plan
        patch["monthlyVfLimit"] = plan_cfg["monthlyVfLimit"]
        patch["dailyGenerationLimit"] = plan_cfg["dailyGenerationLimit"]

    if payload.paidVfDelta is not None:
        delta = _as_float(payload.paidVfDelta, 0.0)
        patch["paidVfBalance"] = _as_positive_number(_as_positive_number(entitlement.get("paidVfBalance")) + delta)
    if payload.vffDelta is not None:
        delta = _as_float(payload.vffDelta, 0.0)
        patch["vffBalance"] = _as_positive_number(_as_positive_number(entitlement.get("vffBalance")) + delta)
        patch["vffMonthKey"] = _wallet_month_key()

    if patch:
        _write_entitlement(uid, patch)

    if payload.disabled is not None:
        _admin_set_user_disabled(uid, bool(payload.disabled))
    response_payload = {"ok": True, "uid": uid, "entitlements": _entitlement_usage_payload(uid)}
    _audit_append_event(
        action="admin_user_patch",
        resource_type="user",
        resource_id=uid,
        before={"entitlements": before_entitlement},
        after={"patch": patch, "disabled": payload.disabled},
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
        subject_uid=uid,
    )
    return JSONResponse(response_payload)


@app.post("/admin/users/{target_uid}/reset-password")
def admin_reset_user_password(target_uid: str, payload: AdminResetPasswordRequest, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_USERS_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    uid = str(target_uid or "").strip()
    if not uid:
        raise HTTPException(status_code=400, detail="Missing user uid.")
    _admin_set_user_password(uid, payload.newPassword)
    _audit_append_event(
        action="admin_user_reset_password",
        resource_type="user",
        resource_id=uid,
        after={"reset": True},
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
        subject_uid=uid,
    )
    return JSONResponse({"ok": True, "uid": uid})


@app.post("/admin/users/{target_uid}/revoke-sessions")
def admin_revoke_user_sessions(target_uid: str, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_USERS_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    uid = str(target_uid or "").strip()
    if not uid:
        raise HTTPException(status_code=400, detail="Missing user uid.")
    _admin_revoke_user_sessions(uid)
    _audit_append_event(
        action="admin_user_revoke_sessions",
        resource_type="user",
        resource_id=uid,
        after={"revoked": True},
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
        subject_uid=uid,
    )
    return JSONResponse({"ok": True, "uid": uid})


@app.post("/admin/users/{target_uid}/force-user-id")
def admin_force_change_user_id(
    target_uid: str,
    payload: AdminForceUserIdChangeRequest,
    request: Request,
) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_USERS_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    uid = str(target_uid or "").strip()
    if not uid:
        raise HTTPException(status_code=400, detail="Missing user uid.")
    before = _user_profile_read(uid) or {}
    row = _user_profile_upsert(
        uid,
        user_id=payload.userId,
        display_name=None,
        email=None,
        created_by=actor_uid,
        updated_by=actor_uid,
        force_change=True,
        allow_existing_immutable=True,
    )
    _audit_append_event(
        action="admin_force_user_id_change",
        resource_type="user_profile",
        resource_id=uid,
        before=before,
        after={**row, "reason": str(payload.reason or "")[:280]},
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
        subject_uid=uid,
    )
    return JSONResponse({"ok": True, "profile": row})


@app.delete("/admin/users/{target_uid}")
def admin_delete_user(target_uid: str, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_USERS_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    uid = str(target_uid or "").strip()
    if not uid:
        raise HTTPException(status_code=400, detail="Missing user uid.")
    profile_before = _user_profile_read(uid) or {}
    user_id_before = str(profile_before.get("userId") or "").strip().lower()

    if _firebase_ready() and firebase_auth is not None:
        try:
            firebase_auth.delete_user(uid)  # type: ignore[attr-defined]
        except Exception:
            # Best effort; Firestore cleanup still runs.
            pass

    collection_names = [
        "entitlements",
        "users",
        USER_PROFILES_COLLECTION,
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
                if name in {"entitlements", "users", USER_PROFILES_COLLECTION, "generation_history"}:
                    coll.document(uid).delete()
                    continue
                docs = coll.where("uid", "==", uid).stream()
                for doc in docs:
                    doc.reference.delete()
            except Exception:
                continue
        if user_id_before:
            try:
                _FIRESTORE_DB.collection(USER_ID_INDEX_COLLECTION).document(user_id_before).delete()
            except Exception:
                pass
    else:
        with _INMEMORY_LOCK:
            _INMEMORY_ENTITLEMENTS.pop(uid, None)
            _INMEMORY_USER_PROFILES.pop(uid, None)
            if user_id_before:
                _INMEMORY_USER_ID_INDEX.pop(user_id_before, None)
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
            _persist_inmemory_user_profile_store_locked()
    _TTS_SUCCESS_LIMITER.clear_uid(uid)
    _audit_append_event(
        action="admin_user_delete",
        resource_type="user",
        resource_id=uid,
        before={"profile": profile_before},
        after={"deleted": True, "profileRemoved": bool(profile_before)},
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
        subject_uid=uid,
    )
    return JSONResponse({"ok": True, "uid": uid})


@app.get("/admin/teams")
def admin_list_teams(
    request: Request,
    q: str = "",
    limit: int = 100,
) -> JSONResponse:
    _require_permission(request, PERM_TEAMS_READ)
    if not VF_TEAMS_ENABLED:
        return JSONResponse({"ok": True, "items": [], "count": 0})
    rows = _team_list(limit=limit, q=q)
    items: list[dict[str, Any]] = []
    for row in rows:
        team_id = str(row.get("teamId") or "").strip()
        members = _team_list_members(team_id, limit=2000)
        active_members = [
            member
            for member in members
            if str((member or {}).get("status") or "active").strip().lower() == "active"
        ]
        item = dict(row)
        item["memberCount"] = len(members)
        item["activeMembers"] = len(active_members)
        items.append(item)
    return JSONResponse({"ok": True, "items": items, "count": len(items)})


@app.post("/admin/teams")
def admin_create_team(payload: TeamCreateRequest, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_TEAMS_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    if not VF_TEAMS_ENABLED:
        raise HTTPException(status_code=404, detail="Teams feature is disabled.")
    owner_uid = str(payload.ownerUid or "").strip()
    if not owner_uid:
        raise HTTPException(status_code=400, detail="ownerUid is required.")
    owner_profile = _ensure_user_profile(owner_uid, allow_auto_backfill=True)
    if not isinstance(owner_profile, dict):
        raise HTTPException(status_code=404, detail="Owner profile not found.")
    safe_slug = _team_slug_normalize(payload.slug or payload.name)
    existing = _team_list(limit=5000, q="")
    if any(str(item.get("slug") or "").strip().lower() == safe_slug for item in existing):
        raise HTTPException(status_code=409, detail="Team slug already exists.")
    now_iso = _utc_now().isoformat()
    team = _team_upsert(
        "",
        {
            "name": str(payload.name or "").strip()[:120] or safe_slug,
            "slug": safe_slug,
            "status": _team_status_normalize(payload.status),
            "ownerUid": owner_uid,
            "ownerUserId": str(owner_profile.get("userId") or "").strip().lower(),
            "seatLimit": max(1, min(10_000, int(payload.seatLimit or 1))),
            "createdAt": now_iso,
            "updatedAt": now_iso,
            "updatedBy": actor_uid,
        },
    )
    _team_member_upsert(
        str(team.get("teamId") or ""),
        owner_uid,
        {
            "teamId": str(team.get("teamId") or ""),
            "uid": owner_uid,
            "userId": str(owner_profile.get("userId") or "").strip().lower(),
            "role": "owner",
            "status": "active",
            "joinedAt": now_iso,
            "invitedBy": actor_uid,
            "updatedAt": now_iso,
        },
    )
    _audit_append_event(
        action="admin_team_create",
        resource_type="team",
        resource_id=str(team.get("teamId") or ""),
        after=team,
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
        subject_uid=owner_uid,
    )
    return JSONResponse({"ok": True, "team": team})


@app.patch("/admin/teams/{team_id}")
def admin_patch_team(team_id: str, payload: TeamPatchRequest, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_TEAMS_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    if not VF_TEAMS_ENABLED:
        raise HTTPException(status_code=404, detail="Teams feature is disabled.")
    safe_team_id = str(team_id or "").strip()
    current = _team_get(safe_team_id)
    if not isinstance(current, dict):
        raise HTTPException(status_code=404, detail="Team not found.")
    before = dict(current)
    if payload.name is not None:
        current["name"] = str(payload.name or "").strip()[:120]
    if payload.slug is not None:
        safe_slug = _team_slug_normalize(payload.slug)
        existing = _team_list(limit=5000, q="")
        if any(
            str(item.get("teamId") or "").strip() != safe_team_id
            and str(item.get("slug") or "").strip().lower() == safe_slug
            for item in existing
        ):
            raise HTTPException(status_code=409, detail="Team slug already exists.")
        current["slug"] = safe_slug
    if payload.status is not None:
        current["status"] = _team_status_normalize(payload.status)
    if payload.seatLimit is not None:
        current["seatLimit"] = max(1, min(10_000, int(payload.seatLimit or 1)))
    if payload.ownerUid is not None:
        next_owner_uid = str(payload.ownerUid or "").strip()
        if not next_owner_uid:
            raise HTTPException(status_code=400, detail="ownerUid cannot be empty.")
        owner_profile = _ensure_user_profile(next_owner_uid, allow_auto_backfill=True)
        if not isinstance(owner_profile, dict):
            raise HTTPException(status_code=404, detail="Owner profile not found.")
        current["ownerUid"] = next_owner_uid
        current["ownerUserId"] = str(owner_profile.get("userId") or "").strip().lower()
        existing_owner_member = _team_member_get(safe_team_id, next_owner_uid) or {}
        owner_joined_at = str(existing_owner_member.get("joinedAt") or _utc_now().isoformat())
        _team_member_upsert(
            safe_team_id,
            next_owner_uid,
            {
                "teamId": safe_team_id,
                "uid": next_owner_uid,
                "userId": str(owner_profile.get("userId") or "").strip().lower(),
                "role": "owner",
                "status": "active",
                "joinedAt": owner_joined_at,
                "invitedBy": actor_uid,
                "updatedAt": _utc_now().isoformat(),
            },
        )
    current["updatedAt"] = _utc_now().isoformat()
    current["updatedBy"] = actor_uid
    saved = _team_upsert(safe_team_id, current)
    _audit_append_event(
        action="admin_team_patch",
        resource_type="team",
        resource_id=safe_team_id,
        before=before,
        after=saved,
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
        subject_uid=str(saved.get("ownerUid") or ""),
    )
    return JSONResponse({"ok": True, "team": saved})


@app.get("/admin/teams/{team_id}/members")
def admin_team_members(team_id: str, request: Request, limit: int = 500) -> JSONResponse:
    _require_permission(request, PERM_TEAMS_READ)
    if not VF_TEAMS_ENABLED:
        raise HTTPException(status_code=404, detail="Teams feature is disabled.")
    safe_team_id = str(team_id or "").strip()
    team = _team_get(safe_team_id)
    if not isinstance(team, dict):
        raise HTTPException(status_code=404, detail="Team not found.")
    items = _team_list_members(safe_team_id, limit=limit)
    return JSONResponse({"ok": True, "team": team, "items": items, "count": len(items)})


@app.post("/admin/teams/{team_id}/members")
def admin_team_add_member(
    team_id: str,
    payload: TeamMemberCreateRequest,
    request: Request,
) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_TEAMS_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    if not VF_TEAMS_ENABLED:
        raise HTTPException(status_code=404, detail="Teams feature is disabled.")
    safe_team_id = str(team_id or "").strip()
    team = _team_get(safe_team_id)
    if not isinstance(team, dict):
        raise HTTPException(status_code=404, detail="Team not found.")
    member_uid = str(payload.uid or "").strip()
    if not member_uid:
        raise HTTPException(status_code=400, detail="uid is required.")
    member_profile = _ensure_user_profile(member_uid, allow_auto_backfill=True)
    if not isinstance(member_profile, dict):
        raise HTTPException(status_code=404, detail="Member profile not found.")
    existing = _team_member_get(safe_team_id, member_uid) or {}
    members = _team_list_members(safe_team_id, limit=3000)
    active_count = len(
        [row for row in members if str((row or {}).get("status") or "active").strip().lower() == "active"]
    )
    is_new_member = not bool(existing)
    if is_new_member and active_count >= max(1, int(team.get("seatLimit") or 1)):
        raise HTTPException(status_code=409, detail="Team seat limit reached.")
    now_iso = _utc_now().isoformat()
    member = _team_member_upsert(
        safe_team_id,
        member_uid,
        {
            "teamId": safe_team_id,
            "uid": member_uid,
            "userId": str(member_profile.get("userId") or "").strip().lower(),
            "role": _team_member_role_normalize(payload.role),
            "status": _team_status_normalize(payload.status),
            "joinedAt": str(existing.get("joinedAt") or now_iso),
            "invitedBy": str(existing.get("invitedBy") or actor_uid),
            "updatedAt": now_iso,
        },
    )
    _audit_append_event(
        action="admin_team_member_add",
        resource_type="team_member",
        resource_id=f"{safe_team_id}:{member_uid}",
        after=member,
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
        subject_uid=member_uid,
    )
    return JSONResponse({"ok": True, "member": member})


@app.patch("/admin/teams/{team_id}/members/{member_uid}")
def admin_team_patch_member(
    team_id: str,
    member_uid: str,
    payload: TeamMemberPatchRequest,
    request: Request,
) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_TEAMS_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    if not VF_TEAMS_ENABLED:
        raise HTTPException(status_code=404, detail="Teams feature is disabled.")
    safe_team_id = str(team_id or "").strip()
    safe_member_uid = str(member_uid or "").strip()
    team = _team_get(safe_team_id)
    if not isinstance(team, dict):
        raise HTTPException(status_code=404, detail="Team not found.")
    before = _team_member_get(safe_team_id, safe_member_uid)
    if not isinstance(before, dict):
        raise HTTPException(status_code=404, detail="Team member not found.")
    role = _team_member_role_normalize(payload.role) if payload.role is not None else str(before.get("role") or "member")
    status = _team_status_normalize(payload.status) if payload.status is not None else str(before.get("status") or "active")
    if str(team.get("ownerUid") or "").strip() == safe_member_uid and role != "owner":
        raise HTTPException(status_code=409, detail="Transfer owner before changing owner role.")
    next_member = dict(before)
    next_member["role"] = role
    next_member["status"] = status
    next_member["updatedAt"] = _utc_now().isoformat()
    saved = _team_member_upsert(safe_team_id, safe_member_uid, next_member)
    if role == "owner":
        team["ownerUid"] = safe_member_uid
        team["ownerUserId"] = str(saved.get("userId") or "").strip().lower()
        team["updatedAt"] = _utc_now().isoformat()
        team["updatedBy"] = actor_uid
        _team_upsert(safe_team_id, team)
    _audit_append_event(
        action="admin_team_member_patch",
        resource_type="team_member",
        resource_id=f"{safe_team_id}:{safe_member_uid}",
        before=before,
        after=saved,
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
        subject_uid=safe_member_uid,
    )
    return JSONResponse({"ok": True, "member": saved})


@app.delete("/admin/teams/{team_id}/members/{member_uid}")
def admin_team_remove_member(team_id: str, member_uid: str, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_TEAMS_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    if not VF_TEAMS_ENABLED:
        raise HTTPException(status_code=404, detail="Teams feature is disabled.")
    safe_team_id = str(team_id or "").strip()
    safe_member_uid = str(member_uid or "").strip()
    team = _team_get(safe_team_id)
    if not isinstance(team, dict):
        raise HTTPException(status_code=404, detail="Team not found.")
    if str(team.get("ownerUid") or "").strip() == safe_member_uid:
        raise HTTPException(status_code=409, detail="Owner cannot be removed from team.")
    before = _team_member_get(safe_team_id, safe_member_uid)
    if not isinstance(before, dict):
        raise HTTPException(status_code=404, detail="Team member not found.")
    _team_member_delete(safe_team_id, safe_member_uid)
    _audit_append_event(
        action="admin_team_member_remove",
        resource_type="team_member",
        resource_id=f"{safe_team_id}:{safe_member_uid}",
        before=before,
        after={"removed": True},
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
        subject_uid=safe_member_uid,
    )
    return JSONResponse({"ok": True, "teamId": safe_team_id, "uid": safe_member_uid})


@app.post("/support/messages")
def support_post_message(payload: SupportMessageCreateRequest, request: Request) -> JSONResponse:
    if not VF_SUPPORT_INBOX_ENABLED:
        raise HTTPException(status_code=404, detail="Support inbox is disabled.")
    uid = _require_request_uid(request)
    profile = _require_user_id_ready(request, uid) or {}
    user_id = str(profile.get("userId") or "").strip().lower()
    text = str(payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message text is required.")
    now_iso = _utc_now().isoformat()
    conversation_id = str(payload.conversationId or "").strip()
    conversation = _support_conversation_get(conversation_id) if conversation_id else None
    if conversation is not None and str(conversation.get("uid") or "").strip() != uid:
        raise HTTPException(status_code=403, detail="Conversation does not belong to current user.")
    if conversation is None:
        conversation = _support_conversation_upsert(
            "",
            {
                "uid": uid,
                "userId": user_id,
                "status": "open",
                "priority": "green",
                "lastMessageAt": now_iso,
                "assignedTo": "",
                "createdAt": now_iso,
                "updatedAt": now_iso,
            },
        )
        conversation_id = str(conversation.get("conversationId") or "")
    user_message = _support_message_upsert(
        "",
        {
            "conversationId": conversation_id,
            "fromType": "user",
            "uid": uid,
            "userId": user_id,
            "text": text[:5000],
            "attachmentsMeta": list(payload.attachmentsMeta or []),
            "resolutionFlag": "",
            "createdAt": now_iso,
        },
    )
    conversation["status"] = "open"
    conversation["priority"] = "green"
    conversation["lastMessageAt"] = now_iso
    conversation["updatedAt"] = now_iso
    conversation = _support_conversation_upsert(conversation_id, conversation)
    _audit_append_event(
        action="support_user_message",
        resource_type="support_conversation",
        resource_id=conversation_id,
        after={"messageId": str(user_message.get("messageId") or "")},
        request=request,
        actor_uid=uid,
        actor_role="user",
        subject_uid=uid,
        subject_user_id=user_id,
    )
    ai_result = _support_try_ai_autoreply(conversation=conversation, user_message=user_message, request=request)
    messages = [user_message]
    ai_message = ai_result.get("aiMessage")
    if isinstance(ai_message, dict):
        messages.append(ai_message)
    return JSONResponse(
        {
            "ok": True,
            "conversation": ai_result.get("conversation") or conversation,
            "messages": messages,
            "aiMode": str(ai_result.get("mode") or ""),
            "aiReason": str(ai_result.get("reason") or ""),
        }
    )


@app.get("/support/conversations/me")
def support_my_conversations(request: Request, limit: int = 100) -> JSONResponse:
    if not VF_SUPPORT_INBOX_ENABLED:
        raise HTTPException(status_code=404, detail="Support inbox is disabled.")
    uid = _require_request_uid(request)
    _require_user_id_ready(request, uid)
    rows = [row for row in _support_list_conversations(limit=max(1, min(300, int(limit))), q="") if str(row.get("uid") or "").strip() == uid]
    return JSONResponse({"ok": True, "items": rows, "count": len(rows)})


@app.post("/support/conversations/{conversation_id}/still-unresolved")
def support_mark_unresolved(conversation_id: str, request: Request) -> JSONResponse:
    if not VF_SUPPORT_INBOX_ENABLED:
        raise HTTPException(status_code=404, detail="Support inbox is disabled.")
    uid = _require_request_uid(request)
    profile = _require_user_id_ready(request, uid) or {}
    user_id = str(profile.get("userId") or "").strip().lower()
    safe_id = str(conversation_id or "").strip()
    conversation = _support_conversation_get(safe_id)
    if not isinstance(conversation, dict):
        raise HTTPException(status_code=404, detail="Conversation not found.")
    if str(conversation.get("uid") or "").strip() != uid:
        raise HTTPException(status_code=403, detail="Conversation does not belong to current user.")
    conversation["status"] = "needs_human"
    conversation["priority"] = "yellow"
    conversation["lastMessageAt"] = _utc_now().isoformat()
    conversation["updatedAt"] = _utc_now().isoformat()
    saved = _support_conversation_upsert(safe_id, conversation)
    _support_open_or_touch_yellow_alert(safe_id, reason="user_marked_unresolved")
    _audit_append_event(
        action="support_user_unresolved",
        resource_type="support_conversation",
        resource_id=safe_id,
        after={"status": "needs_human"},
        request=request,
        actor_uid=uid,
        actor_role="user",
        subject_uid=uid,
        subject_user_id=user_id,
    )
    return JSONResponse({"ok": True, "conversation": saved})


@app.get("/admin/support/conversations")
def admin_support_list_conversations(
    request: Request,
    status: str = "needs_human",
    q: str = "",
    limit: int = 200,
) -> JSONResponse:
    _require_permission(request, PERM_SUPPORT_READ)
    if not VF_SUPPORT_INBOX_ENABLED:
        return JSONResponse({"ok": True, "items": [], "count": 0})
    safe_status = str(status or "").strip().lower()
    rows = _support_list_conversations(
        status=safe_status if safe_status in SUPPORT_CONVERSATION_STATUSES else "",
        limit=limit,
        q=q,
    )
    return JSONResponse({"ok": True, "items": rows, "count": len(rows)})


@app.get("/admin/support/conversations/{conversation_id}")
def admin_support_conversation_detail(conversation_id: str, request: Request) -> JSONResponse:
    _require_permission(request, PERM_SUPPORT_READ)
    if not VF_SUPPORT_INBOX_ENABLED:
        raise HTTPException(status_code=404, detail="Support inbox is disabled.")
    safe_id = str(conversation_id or "").strip()
    conversation = _support_conversation_get(safe_id)
    if not isinstance(conversation, dict):
        raise HTTPException(status_code=404, detail="Conversation not found.")
    messages = _support_list_messages(safe_id, limit=1000)
    return JSONResponse({"ok": True, "conversation": conversation, "messages": messages, "count": len(messages)})


@app.post("/admin/support/conversations/{conversation_id}/reply")
def admin_support_reply(
    conversation_id: str,
    payload: SupportReplyRequest,
    request: Request,
) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_SUPPORT_REPLY)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    if not VF_SUPPORT_INBOX_ENABLED:
        raise HTTPException(status_code=404, detail="Support inbox is disabled.")
    safe_id = str(conversation_id or "").strip()
    text = str(payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Reply text is required.")
    conversation = _support_conversation_get(safe_id)
    if not isinstance(conversation, dict):
        raise HTTPException(status_code=404, detail="Conversation not found.")
    now_iso = _utc_now().isoformat()
    actor_user_id = _resolve_request_user_id(request, actor_uid)
    message = _support_message_upsert(
        "",
        {
            "conversationId": safe_id,
            "fromType": "agent",
            "uid": actor_uid,
            "userId": actor_user_id,
            "text": text[:5000],
            "attachmentsMeta": [],
            "resolutionFlag": "",
            "createdAt": now_iso,
        },
    )
    conversation["status"] = "open"
    conversation["priority"] = "green"
    conversation["lastMessageAt"] = now_iso
    conversation["updatedAt"] = now_iso
    if not str(conversation.get("assignedTo") or "").strip():
        conversation["assignedTo"] = actor_uid
    saved = _support_conversation_upsert(safe_id, conversation)
    _audit_append_event(
        action="admin_support_reply",
        resource_type="support_conversation",
        resource_id=safe_id,
        after={"messageId": str(message.get("messageId") or "")},
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
        subject_uid=str(conversation.get("uid") or ""),
        subject_user_id=str(conversation.get("userId") or ""),
    )
    return JSONResponse({"ok": True, "conversation": saved, "message": message})


@app.post("/admin/support/conversations/{conversation_id}/resolve")
def admin_support_resolve(conversation_id: str, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_SUPPORT_REPLY)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    if not VF_SUPPORT_INBOX_ENABLED:
        raise HTTPException(status_code=404, detail="Support inbox is disabled.")
    safe_id = str(conversation_id or "").strip()
    conversation = _support_conversation_get(safe_id)
    if not isinstance(conversation, dict):
        raise HTTPException(status_code=404, detail="Conversation not found.")
    conversation["status"] = "resolved"
    conversation["priority"] = "green"
    conversation["updatedAt"] = _utc_now().isoformat()
    conversation["resolvedAt"] = _utc_now().isoformat()
    saved = _support_conversation_upsert(safe_id, conversation)
    _support_resolve_alert_if_open(safe_id)
    _audit_append_event(
        action="admin_support_resolve",
        resource_type="support_conversation",
        resource_id=safe_id,
        after={"status": "resolved"},
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
        subject_uid=str(conversation.get("uid") or ""),
        subject_user_id=str(conversation.get("userId") or ""),
    )
    return JSONResponse({"ok": True, "conversation": saved})


@app.get("/admin/support/ai-policy")
def admin_support_ai_policy(request: Request) -> JSONResponse:
    _require_permission(request, PERM_SUPPORT_AI_REVIEW)
    policy = _support_ai_policy_get()
    return JSONResponse({"ok": True, "policy": policy})


@app.patch("/admin/support/ai-policy")
def admin_patch_support_ai_policy(payload: SupportAiPolicyPatchRequest, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_SUPPORT_AI_CONFIG)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    before = _support_ai_policy_get()
    after = _support_ai_policy_patch(
        {
            "enabled": payload.enabled if payload.enabled is not None else before.get("enabled"),
            "confidenceThreshold": payload.confidenceThreshold if payload.confidenceThreshold is not None else before.get("confidenceThreshold"),
            "maxAutoRepliesPerConversation": payload.maxAutoRepliesPerConversation if payload.maxAutoRepliesPerConversation is not None else before.get("maxAutoRepliesPerConversation"),
            "allowedActions": payload.allowedActions if payload.allowedActions is not None else before.get("allowedActions"),
            "blockedTopics": payload.blockedTopics if payload.blockedTopics is not None else before.get("blockedTopics"),
            "requireHumanForTags": payload.requireHumanForTags if payload.requireHumanForTags is not None else before.get("requireHumanForTags"),
        },
        updated_by=actor_uid,
    )
    _audit_append_event(
        action="support_ai_policy_patch",
        resource_type="support_ai_policy",
        resource_id="current",
        before=before,
        after=after,
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
    )
    return JSONResponse({"ok": True, "policy": after})


@app.get("/admin/rbac/roles")
def admin_rbac_roles(request: Request) -> JSONResponse:
    _require_permission(request, PERM_RBAC_READ)
    return JSONResponse(_rbac_roles_payload())


@app.get("/admin/rbac/users")
def admin_rbac_users(
    request: Request,
    limit: int = 100,
    cursor: str = "",
    q: str = "",
) -> JSONResponse:
    _require_permission(request, PERM_RBAC_READ)
    rows, next_cursor = _rbac_list_assignments(limit=limit, cursor=cursor, q=q)
    return JSONResponse(
        {
            "ok": True,
            "items": rows,
            "count": len(rows),
            "nextCursor": next_cursor,
        }
    )


@app.put("/admin/rbac/users/{target_uid}")
def admin_rbac_assign_user(target_uid: str, payload: AdminRoleAssignmentRequest, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_RBAC_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    safe_target_uid = str(target_uid or "").strip()
    if not safe_target_uid:
        raise HTTPException(status_code=400, detail="Missing target uid.")
    safe_role = _rbac_normalize_role(payload.role)
    if safe_role not in RBAC_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role.")
    before = _rbac_load_assignment(safe_target_uid) or {}
    row = _rbac_write_assignment(
        safe_target_uid,
        {
            "role": safe_role,
            "allowOverrides": payload.allowOverrides or [],
            "denyOverrides": payload.denyOverrides or [],
            "status": payload.status or "active",
            "updatedBy": actor_uid,
        },
    )
    _audit_append_event(
        action="rbac_assign_user",
        resource_type="rbac_user",
        resource_id=safe_target_uid,
        before=before,
        after=row,
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
        subject_uid=safe_target_uid,
    )
    return JSONResponse({"ok": True, "assignment": row})


@app.post("/admin/rbac/users/{target_uid}/disable")
def admin_rbac_disable_user(target_uid: str, payload: AdminRoleStatusRequest, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_RBAC_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    safe_target_uid = str(target_uid or "").strip()
    if not safe_target_uid:
        raise HTTPException(status_code=400, detail="Missing target uid.")
    before = _rbac_load_assignment(safe_target_uid) or {}
    current = dict(before)
    if not current:
        current = {
            "uid": safe_target_uid,
            "role": RBAC_ROLE_READ_ONLY_OPS,
            "allowOverrides": [],
            "denyOverrides": [],
            "status": "active",
            "version": 0,
        }
    row = _rbac_write_assignment(
        safe_target_uid,
        {
            **current,
            "status": "disabled",
            "updatedBy": actor_uid,
        },
    )
    _audit_append_event(
        action="rbac_disable_user",
        resource_type="rbac_user",
        resource_id=safe_target_uid,
        before=before,
        after={**row, "note": str(payload.note or "")[:280]},
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
        subject_uid=safe_target_uid,
    )
    return JSONResponse({"ok": True, "assignment": row})


@app.post("/admin/rbac/users/{target_uid}/enable")
def admin_rbac_enable_user(target_uid: str, payload: AdminRoleStatusRequest, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_RBAC_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    safe_target_uid = str(target_uid or "").strip()
    if not safe_target_uid:
        raise HTTPException(status_code=400, detail="Missing target uid.")
    before = _rbac_load_assignment(safe_target_uid) or {}
    current = dict(before)
    if not current:
        current = {
            "uid": safe_target_uid,
            "role": RBAC_ROLE_READ_ONLY_OPS,
            "allowOverrides": [],
            "denyOverrides": [],
            "status": "disabled",
            "version": 0,
        }
    row = _rbac_write_assignment(
        safe_target_uid,
        {
            **current,
            "status": "active",
            "updatedBy": actor_uid,
        },
    )
    _audit_append_event(
        action="rbac_enable_user",
        resource_type="rbac_user",
        resource_id=safe_target_uid,
        before=before,
        after={**row, "note": str(payload.note or "")[:280]},
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
        subject_uid=safe_target_uid,
    )
    return JSONResponse({"ok": True, "assignment": row})


@app.get("/admin/audit/events")
def admin_audit_events(
    request: Request,
    actorUid: str = "",
    actorUserId: str = "",
    subjectUid: str = "",
    subjectUserId: str = "",
    action: str = "",
    resourceType: str = "",
    fromIso: str = Query("", alias="from"),
    toIso: str = Query("", alias="to"),
    cursor: str = "",
    limit: int = 100,
) -> JSONResponse:
    _require_permission(request, PERM_AUDIT_READ)
    items, next_cursor = _audit_list_events(
        actor_uid=actorUid,
        actor_user_id=actorUserId,
        subject_uid=subjectUid,
        subject_user_id=subjectUserId,
        action=action,
        resource_type=resourceType,
        from_iso=fromIso,
        to_iso=toIso,
        cursor=cursor,
        limit=limit,
    )
    return JSONResponse({"ok": True, "items": items, "count": len(items), "nextCursor": next_cursor})


@app.get("/admin/audit/events/{event_id}")
def admin_audit_event_by_id(event_id: str, request: Request) -> JSONResponse:
    _require_permission(request, PERM_AUDIT_READ)
    safe_event_id = str(event_id or "").strip()
    if not safe_event_id:
        raise HTTPException(status_code=400, detail="Missing event id.")
    collection = _firestore_collection(AUDIT_LEDGER_COLLECTION)
    item: Optional[dict[str, Any]] = None
    if collection is None:
        with _INMEMORY_LOCK:
            row = _INMEMORY_AUDIT_LEDGER_EVENTS.get(safe_event_id)
            if isinstance(row, dict):
                item = dict(row)
    else:
        try:
            doc = collection.document(safe_event_id).get()
            if doc.exists:
                item = {**(doc.to_dict() or {}), "eventId": safe_event_id}
        except Exception:
            item = None
    if item is None:
        raise HTTPException(status_code=404, detail="Audit event not found.")
    return JSONResponse({"ok": True, "event": item})


@app.get("/admin/audit/verify-chain")
def admin_audit_verify_chain(
    request: Request,
    fromSeq: int = 0,
    toSeq: int = 0,
    limit: int = 1000,
) -> JSONResponse:
    _require_permission(request, PERM_AUDIT_READ)
    payload = _audit_verify_chain(from_seq=fromSeq, to_seq=toSeq, limit=limit)
    return JSONResponse({"ok": bool(payload.get("ok")), **payload})


@app.post("/admin/coupons")
def admin_create_coupon(payload: CouponCreateRequest, request: Request) -> JSONResponse:
    admin_uid, actor = _require_permission(request, PERM_COUPONS_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=admin_uid)
    now_dt = _utc_now()
    code = _normalize_coupon_code(payload.code)
    if not code:
        code = _coupon_generate_unique_code(prefix="", length=12, attempts=24)
    if not code:
        raise HTTPException(status_code=400, detail="Invalid coupon code.")
    coupon_type = _normalize_coupon_type(payload.couponType)
    usage_policy = _normalize_coupon_usage_policy(payload.usagePolicy)
    usage_limit = _coupon_effective_usage_limit(
        usage_policy,
        _as_positive_int(payload.usageLimit if payload.usageLimit is not None else payload.maxRedemptions),
    )
    expires_dt = _parse_optional_datetime(payload.expiresAt) or _coupon_default_expires_at(now_dt)

    coupon_id = f"coupon_{uuid.uuid4().hex[:12]}"
    now = now_dt.isoformat()
    row = {
        "id": coupon_id,
        "code": code,
        "couponType": coupon_type,
        "active": bool(payload.active),
        "usagePolicy": usage_policy,
        "usageLimit": usage_limit,
        "maxRedemptions": usage_limit,
        "redeemedCount": 0,
        "reservedCount": 0,
        "expiresAt": expires_dt.isoformat(),
        "note": str(payload.note or "")[:240],
        "createdBy": admin_uid,
        "createdAt": now,
        "updatedAt": now,
    }
    if coupon_type == COUPON_TYPE_WALLET_CREDIT:
        credit_vf = _as_positive_int(payload.creditVf)
        if credit_vf <= 0:
            raise HTTPException(status_code=400, detail="creditVf must be positive for wallet_credit coupons.")
        row["creditVf"] = credit_vf
    else:
        _require_stripe_ready()
        discount_type = _normalize_coupon_discount_type(payload.discountType)
        percent_off = float(payload.percentOff or 0.0)
        amount_off_inr = _as_positive_int(payload.amountOffInr)
        has_explicit_plan_discounts = isinstance(payload.planDiscounts, list) and len(payload.planDiscounts) > 0
        if not has_explicit_plan_discounts:
            if discount_type == COUPON_DISCOUNT_PERCENT:
                if percent_off <= 0.0 or percent_off > 100.0:
                    raise HTTPException(status_code=400, detail="percentOff must be in (0, 100] for percent discounts.")
                amount_off_inr = 0
            else:
                if amount_off_inr <= 0:
                    raise HTTPException(status_code=400, detail="amountOffInr must be positive for fixed_inr discounts.")
                percent_off = 0.0
        plan_discounts = _normalize_coupon_plan_discounts(
            payload.planDiscounts,
            fallback_discount_type=discount_type,
            fallback_percent_off=percent_off,
            fallback_amount_off_inr=amount_off_inr,
            fallback_plans=_normalize_coupon_plan_scope(payload.appliesToPlans),
        )
        if not plan_discounts:
            raise HTTPException(status_code=400, detail="At least one valid plan discount is required.")
        primary_discount = _coupon_primary_plan_discount(plan_discounts) or {}
        row["discountType"] = _normalize_coupon_discount_type(str(primary_discount.get("discountType") or discount_type))
        row["percentOff"] = round(_as_float(primary_discount.get("percentOff"), percent_off), 4)
        row["amountOffInr"] = _as_positive_int(primary_discount.get("amountOffInr") if primary_discount.get("amountOffInr") is not None else amount_off_inr)
        row["appliesToPlans"] = sorted(plan_discounts.keys()) or _normalize_coupon_plan_scope(payload.appliesToPlans)
        row["planDiscounts"] = plan_discounts
        row["stripeCouponsByPlan"] = {}
        row["subscriptionDuration"] = "first_invoice_only"

    collection = _firestore_collection("coupons")
    index_collection = _coupon_index_collection()
    stripe_coupon_id = ""
    stripe_promotion_code_id = ""
    created_stripe_coupon_ids: list[str] = []
    created_stripe_promotion_ids: list[str] = []
    if collection is None:
        with _INMEMORY_LOCK:
            if code in _INMEMORY_COUPON_CODE_INDEX:
                raise HTTPException(status_code=409, detail="Coupon code already exists.")
            if coupon_type == COUPON_TYPE_SUBSCRIPTION_DISCOUNT:
                try:
                    stripe_sync = _stripe_sync_subscription_coupon_artifacts(
                        code=code,
                        coupon_id=coupon_id,
                        active=bool(row.get("active")),
                        plan_discounts=(row.get("planDiscounts") if isinstance(row.get("planDiscounts"), dict) else {}),
                    )
                    row["planDiscounts"] = stripe_sync["planDiscounts"]
                    row["stripeCouponsByPlan"] = stripe_sync["stripeCouponsByPlan"]
                    stripe_coupon_id = str(stripe_sync.get("stripeCouponId") or "")
                    stripe_promotion_code_id = str(stripe_sync.get("stripePromotionCodeId") or "")
                    row["stripeCouponId"] = stripe_coupon_id
                    row["stripePromotionCodeId"] = stripe_promotion_code_id
                    created_stripe_coupon_ids = list(stripe_sync.get("createdCouponIds") or [])
                    created_stripe_promotion_ids = list(stripe_sync.get("createdPromotionIds") or [])
                except Exception as exc:  # noqa: BLE001
                    _stripe_cleanup_subscription_coupon_artifacts(
                        stripe_promotion_ids=created_stripe_promotion_ids,
                        stripe_coupon_ids=created_stripe_coupon_ids,
                    )
                    raise HTTPException(status_code=502, detail=f"Failed to sync Stripe coupon: {exc}") from exc
            _INMEMORY_COUPONS[coupon_id] = dict(row)
            _INMEMORY_COUPON_CODE_INDEX[code] = coupon_id
    else:
        if _FIRESTORE_DB is None or firebase_firestore is None or index_collection is None:
            raise HTTPException(status_code=503, detail="Coupon storage is unavailable.")
        try:
            if index_collection.document(code).get().exists:
                raise HTTPException(status_code=409, detail="Coupon code already exists.")
        except HTTPException:
            raise
        except Exception:
            pass
        if coupon_type == COUPON_TYPE_SUBSCRIPTION_DISCOUNT:
            try:
                stripe_sync = _stripe_sync_subscription_coupon_artifacts(
                    code=code,
                    coupon_id=coupon_id,
                    active=bool(row.get("active")),
                    plan_discounts=(row.get("planDiscounts") if isinstance(row.get("planDiscounts"), dict) else {}),
                )
                row["planDiscounts"] = stripe_sync["planDiscounts"]
                row["stripeCouponsByPlan"] = stripe_sync["stripeCouponsByPlan"]
                stripe_coupon_id = str(stripe_sync.get("stripeCouponId") or "")
                stripe_promotion_code_id = str(stripe_sync.get("stripePromotionCodeId") or "")
                row["stripeCouponId"] = stripe_coupon_id
                row["stripePromotionCodeId"] = stripe_promotion_code_id
                created_stripe_coupon_ids = list(stripe_sync.get("createdCouponIds") or [])
                created_stripe_promotion_ids = list(stripe_sync.get("createdPromotionIds") or [])
            except Exception as exc:  # noqa: BLE001
                _stripe_cleanup_subscription_coupon_artifacts(
                    stripe_promotion_ids=created_stripe_promotion_ids,
                    stripe_coupon_ids=created_stripe_coupon_ids,
                )
                raise HTTPException(status_code=502, detail=f"Failed to sync Stripe coupon: {exc}") from exc

        coupon_ref = collection.document(coupon_id)
        code_ref = index_collection.document(code)
        transaction = _FIRESTORE_DB.transaction()

        @firebase_firestore.transactional
        def _apply(transaction_obj: Any) -> None:
            index_doc = code_ref.get(transaction=transaction_obj)
            if index_doc.exists:
                raise RuntimeError("Coupon code already exists.")
            transaction_obj.set(coupon_ref, row, merge=True)
            transaction_obj.set(
                code_ref,
                {
                    "code": code,
                    "couponId": coupon_id,
                    "createdAt": now,
                    "updatedAt": now,
                },
                merge=True,
            )

        try:
            _apply(transaction)
        except RuntimeError as exc:
            _stripe_cleanup_subscription_coupon_artifacts(
                stripe_promotion_ids=created_stripe_promotion_ids,
                stripe_coupon_ids=created_stripe_coupon_ids,
            )
            raise HTTPException(status_code=409, detail="Coupon code already exists.")
    normalized = _coupon_backfill_fields(row, now_dt)
    _audit_append_event(
        action="admin_coupon_create",
        resource_type="coupon",
        resource_id=str(normalized.get("id") or ""),
        after=normalized,
        request=request,
        actor_uid=admin_uid,
        actor_role=str(actor.get("role") or ""),
    )
    return JSONResponse({"ok": True, "coupon": normalized})


@app.post("/admin/coupons/generate-code")
def admin_generate_coupon_code(
    request: Request,
    prefix: str = "",
    length: int = 12,
) -> JSONResponse:
    _require_permission(request, PERM_COUPONS_WRITE)
    code = _coupon_generate_unique_code(prefix=prefix, length=length, attempts=20)
    return JSONResponse({"ok": True, "code": code})


@app.get("/admin/coupons")
def admin_list_coupons(
    request: Request,
    limit: int = 100,
    couponType: str = "",
) -> JSONResponse:
    _require_permission(request, PERM_COUPONS_READ)
    safe_limit = max(1, min(300, int(limit)))
    safe_type = _normalize_coupon_type(couponType) if str(couponType or "").strip() else ""
    coupons: list[dict[str, Any]] = []
    collection = _firestore_collection("coupons")
    if collection is None:
        with _INMEMORY_LOCK:
            _inmemory_rebuild_coupon_index_locked()
            coupons = [dict(_coupon_backfill_fields(row)) for row in list(_INMEMORY_COUPONS.values())]
    else:
        docs = collection.limit(safe_limit).stream()
        coupons = [_coupon_backfill_fields({**(doc.to_dict() or {}), "id": doc.id}) for doc in docs]
    if safe_type:
        coupons = [row for row in coupons if _normalize_coupon_type(str(row.get("couponType") or "")) == safe_type]
    coupons.sort(key=_coupon_sort_key, reverse=True)
    return JSONResponse({"ok": True, "coupons": coupons[:safe_limit]})


@app.patch("/admin/coupons/{coupon_id}")
def admin_patch_coupon(coupon_id: str, payload: CouponPatchRequest, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_COUPONS_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    safe_coupon_id = str(coupon_id or "").strip()
    if not safe_coupon_id:
        raise HTTPException(status_code=400, detail="Missing coupon id.")
    if payload.code is not None:
        raise HTTPException(status_code=400, detail="Coupon code cannot be changed after creation.")

    collection = _firestore_collection("coupons")
    if collection is None:
        with _INMEMORY_LOCK:
            current = _INMEMORY_COUPONS.get(safe_coupon_id)
            if not current:
                raise HTTPException(status_code=404, detail="Coupon not found.")
            row = _coupon_backfill_fields(current)
            patch: dict[str, Any] = {"updatedAt": _utc_now().isoformat()}
            if payload.active is not None:
                patch["active"] = bool(payload.active)
            if payload.expiresAt is not None:
                expires = _parse_optional_datetime(payload.expiresAt) or _coupon_default_expires_at()
                patch["expiresAt"] = expires.isoformat()
            if payload.note is not None:
                patch["note"] = str(payload.note)[:240]
            if payload.usagePolicy is not None or payload.usageLimit is not None or payload.maxRedemptions is not None:
                usage_policy = _normalize_coupon_usage_policy(
                    payload.usagePolicy if payload.usagePolicy is not None else str(row.get("usagePolicy") or "")
                )
                limit_input = payload.usageLimit if payload.usageLimit is not None else payload.maxRedemptions
                if limit_input is None:
                    limit_input = _as_positive_int(row.get("usageLimit"))
                usage_limit = _coupon_effective_usage_limit(usage_policy, _as_positive_int(limit_input))
                patch["usagePolicy"] = usage_policy
                patch["usageLimit"] = usage_limit
                patch["maxRedemptions"] = usage_limit
            coupon_type = _normalize_coupon_type(str(row.get("couponType") or ""))
            if coupon_type == COUPON_TYPE_WALLET_CREDIT and payload.creditVf is not None:
                credit_vf = _as_positive_int(payload.creditVf)
                if credit_vf <= 0:
                    raise HTTPException(status_code=400, detail="creditVf must be positive.")
                patch["creditVf"] = credit_vf
            if coupon_type == COUPON_TYPE_SUBSCRIPTION_DISCOUNT:
                if payload.discountType is not None or payload.percentOff is not None or payload.amountOffInr is not None or payload.planDiscounts is not None:
                    raise HTTPException(status_code=400, detail="Discount amounts cannot be modified after creation.")
                if payload.appliesToPlans is not None:
                    patch["appliesToPlans"] = _normalize_coupon_plan_scope(payload.appliesToPlans)

            row.update(patch)
            normalized = _coupon_backfill_fields(row)
            _INMEMORY_COUPONS[safe_coupon_id] = dict(normalized)
            safe_code = _coupon_store_ref(str(normalized.get("code") or ""))
            if safe_code:
                _INMEMORY_COUPON_CODE_INDEX[safe_code] = safe_coupon_id
            if (
                _normalize_coupon_type(str(normalized.get("couponType") or "")) == COUPON_TYPE_SUBSCRIPTION_DISCOUNT
                and payload.active is not None
                and str(normalized.get("stripePromotionCodeId") or "").strip()
                and _stripe_available()
            ):
                try:
                    stripe.PromotionCode.modify(  # type: ignore[attr-defined]
                        str(normalized.get("stripePromotionCodeId") or "").strip(),
                        active=bool(normalized.get("active")),
                    )
                except Exception:
                    pass
            _audit_append_event(
                action="admin_coupon_patch",
                resource_type="coupon",
                resource_id=safe_coupon_id,
                before=_coupon_backfill_fields(current),
                after=normalized,
                request=request,
                actor_uid=actor_uid,
                actor_role=str(actor.get("role") or ""),
            )
            return JSONResponse({"ok": True, "coupon": normalized})

    ref = collection.document(safe_coupon_id)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Coupon not found.")
    current = _coupon_backfill_fields({**(doc.to_dict() or {}), "id": safe_coupon_id})
    patch = {"updatedAt": _utc_now().isoformat()}
    if payload.active is not None:
        patch["active"] = bool(payload.active)
    if payload.expiresAt is not None:
        expires = _parse_optional_datetime(payload.expiresAt) or _coupon_default_expires_at()
        patch["expiresAt"] = expires.isoformat()
    if payload.note is not None:
        patch["note"] = str(payload.note)[:240]
    if payload.usagePolicy is not None or payload.usageLimit is not None or payload.maxRedemptions is not None:
        usage_policy = _normalize_coupon_usage_policy(
            payload.usagePolicy if payload.usagePolicy is not None else str(current.get("usagePolicy") or "")
        )
        limit_input = payload.usageLimit if payload.usageLimit is not None else payload.maxRedemptions
        if limit_input is None:
            limit_input = _as_positive_int(current.get("usageLimit"))
        usage_limit = _coupon_effective_usage_limit(usage_policy, _as_positive_int(limit_input))
        patch["usagePolicy"] = usage_policy
        patch["usageLimit"] = usage_limit
        patch["maxRedemptions"] = usage_limit

    coupon_type = _normalize_coupon_type(str(current.get("couponType") or ""))
    if coupon_type == COUPON_TYPE_WALLET_CREDIT and payload.creditVf is not None:
        credit_vf = _as_positive_int(payload.creditVf)
        if credit_vf <= 0:
            raise HTTPException(status_code=400, detail="creditVf must be positive.")
        patch["creditVf"] = credit_vf
    if coupon_type == COUPON_TYPE_SUBSCRIPTION_DISCOUNT:
        if payload.discountType is not None or payload.percentOff is not None or payload.amountOffInr is not None or payload.planDiscounts is not None:
            raise HTTPException(status_code=400, detail="Discount amounts cannot be modified after creation.")
        if payload.appliesToPlans is not None:
            patch["appliesToPlans"] = _normalize_coupon_plan_scope(payload.appliesToPlans)

    ref.set(patch, merge=True)
    fresh = _coupon_backfill_fields({**(ref.get().to_dict() or {}), "id": safe_coupon_id})
    if (
        coupon_type == COUPON_TYPE_SUBSCRIPTION_DISCOUNT
        and payload.active is not None
        and str(fresh.get("stripePromotionCodeId") or "").strip()
        and _stripe_available()
    ):
        try:
            stripe.PromotionCode.modify(  # type: ignore[attr-defined]
                str(fresh.get("stripePromotionCodeId") or "").strip(),
                active=bool(fresh.get("active")),
            )
        except Exception:
            pass
    _audit_append_event(
        action="admin_coupon_patch",
        resource_type="coupon",
        resource_id=safe_coupon_id,
        before=current,
        after=fresh,
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
    )
    return JSONResponse({"ok": True, "coupon": fresh})


@app.get("/admin/gemini/pools")
def admin_gemini_pools(request: Request) -> JSONResponse:
    _require_permission(request, PERM_OPS_READ)
    config, meta = _load_gemini_api_pools(force=True)
    config_public = _sanitize_gemini_pool_config_for_response(config)
    single_pool_marker = dict(config_public.get("singlePool") or {})
    if not single_pool_marker:
        single_pool_marker = {
            "enabled": bool(VF_GEMINI_SINGLE_POOL_ENFORCE),
            "canonicalPoolId": "free",
            "effectivePlanPools": {"free": "free", "pro": "free", "plus": "free"},
        }
    backend_snapshot = _backend_gemini_pool_snapshot()
    runtime_snapshot = _runtime_gemini_pool_snapshot()
    validation = _gemini_pools_validation(config)
    warnings = list((meta or {}).get("warnings") or [])
    return JSONResponse(
        {
            "ok": bool(validation.get("isValid")) and bool(runtime_snapshot.get("ok", True)),
            "config": config_public,
            "meta": meta,
            "validation": validation,
            "warnings": warnings,
            "sourcePolicy": _sanitize_gemini_source_policy_for_response(dict(config.get("sourcePolicy") or {})),
            "singlePool": single_pool_marker,
            "backend": backend_snapshot,
            "runtime": runtime_snapshot,
        }
    )


@app.put("/admin/gemini/pools")
def admin_gemini_pools_put(payload: GeminiApiPoolsUpdateRequest, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_OPS_MUTATE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    current_config, _current_meta = _load_gemini_api_pools(force=True)
    current_source_policy = dict(current_config.get("sourcePolicy") or {})
    applied_overrides: list[str] = []
    local_warnings: list[str] = []

    raw_payload = payload.model_dump(exclude_none=True) if hasattr(payload, "model_dump") else payload.dict(exclude_none=True)
    try:
        raw_payload = _restore_masked_gemini_keys_from_payload(raw_payload, current_config=current_config)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    source_policy_requested = isinstance(raw_payload.get("sourcePolicy"), dict)
    raw_source_policy = dict(raw_payload.get("sourcePolicy") or {}) if source_policy_requested else {}
    vertex_service_account_json = str(
        raw_source_policy.get("vertexServiceAccountJson")
        or raw_source_policy.get("serviceAccountJson")
        or ""
    ).strip()
    if source_policy_requested:
        raw_source_policy.pop("vertexServiceAccountJson", None)
        raw_source_policy.pop("serviceAccountJson", None)
        raw_payload["sourcePolicy"] = raw_source_policy

    normalized = normalize_gemini_pool_config(raw_payload)
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
                default_location = str(
                    os.getenv("GOOGLE_CLOUD_LOCATION")
                    or os.getenv("GOOGLE_CLOUD_REGION")
                    or "us-central1"
                ).strip() or "us-central1"
                next_source_policy["vertexLocation"] = default_location
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

    normalized, _sync_changed, sync_warnings = _sync_authoritative_gemini_free_pool(normalized)
    normalized, vertex_free_changed, vertex_free_pool = _rewrite_free_plan_pool_for_vertex(normalized)
    if vertex_free_changed:
        applied_overrides.append(f"vertex_free_plan_pool:{vertex_free_pool}")
    single_pool_warnings: list[str] = []
    normalized, single_pool_changed, single_pool_warnings = _enforce_single_free_gemini_pool(normalized)
    if single_pool_changed:
        applied_overrides.append("single_pool_enforced:free")
    validation = _gemini_pools_validation(normalized)
    if not bool(validation.get("isValid")):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "duplicate_key_membership",
                "validation": validation,
            },
        )

    current_pool_names = set(list_gemini_pool_names(current_config))
    next_pool_names = set(list_gemini_pool_names(normalized))
    created_pools = sorted(next_pool_names - current_pool_names)
    deleted_pools = sorted(current_pool_names - next_pool_names)
    current_plan_pools = current_config.get("planPools") if isinstance(current_config.get("planPools"), dict) else {}
    next_plan_pools = normalized.get("planPools") if isinstance(normalized.get("planPools"), dict) else {}
    plan_pool_changes: dict[str, dict[str, str]] = {}
    for plan_key in ("free", "pro", "plus"):
        before_value = str(current_plan_pools.get(plan_key) or "")
        after_value = str(next_plan_pools.get(plan_key) or "")
        if before_value != after_value:
            plan_pool_changes[plan_key] = {"before": before_value, "after": after_value}
    current_pools = current_config.get("pools") if isinstance(current_config.get("pools"), dict) else {}
    next_pools = normalized.get("pools") if isinstance(normalized.get("pools"), dict) else {}
    key_diff_by_pool: dict[str, dict[str, int]] = {}
    for pool_name in sorted(current_pool_names.union(next_pool_names)):
        before_keys = set(list((current_pools.get(pool_name) or {}).get("keys") or []))
        after_keys = set(list((next_pools.get(pool_name) or {}).get("keys") or []))
        if before_keys == after_keys:
            continue
        key_diff_by_pool[pool_name] = {
            "beforeCount": len(before_keys),
            "afterCount": len(after_keys),
            "addedCount": len(after_keys - before_keys),
            "removedCount": len(before_keys - after_keys),
        }

    saved = _save_gemini_api_pools(normalized)
    key_pool = flatten_pool_keys(saved)
    if key_pool:
        BACKEND_GEMINI_ALLOCATOR.ensure_keys(key_pool)
    runtime_reload = _runtime_gemini_pool_reload()
    runtime_snapshot = _runtime_gemini_pool_snapshot()
    merged_warnings = [*local_warnings, *list(sync_warnings), *list(single_pool_warnings)]
    saved_public = _sanitize_gemini_pool_config_for_response(saved)
    response_payload = {
        "ok": bool(runtime_reload.get("ok")),
        "detail": "Gemini API pools updated.",
        "config": saved_public,
        "validation": _gemini_pools_validation(saved),
        "warnings": merged_warnings,
        "sourcePolicy": _sanitize_gemini_source_policy_for_response(dict(saved.get("sourcePolicy") or {})),
        "appliedOverrides": applied_overrides,
        "createdPools": created_pools,
        "deletedPools": deleted_pools,
        "planPoolChanges": plan_pool_changes,
        "keyDiffByPool": key_diff_by_pool,
        "singlePool": dict(saved_public.get("singlePool") or {}),
        "backend": _backend_gemini_pool_snapshot(),
        "runtimeReload": runtime_reload,
        "runtime": runtime_snapshot,
    }
    _audit_append_event(
        action="gemini_pools_update",
        resource_type="gemini_pool",
        resource_id="global",
        after={
            "appliedOverrides": applied_overrides,
            "warnings": merged_warnings,
            "createdPools": created_pools,
            "deletedPools": deleted_pools,
            "planPoolChanges": plan_pool_changes,
            "keyDiffByPool": key_diff_by_pool,
        },
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
    )
    return JSONResponse(
        {
            **response_payload,
        }
    )


@app.post("/admin/gemini/pools/reload")
def admin_gemini_pools_reload(request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_OPS_MUTATE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    config, meta = _load_gemini_api_pools(force=True)
    source_policy = dict(config.get("sourcePolicy") or {})
    provider = str(source_policy.get("provider") or SOURCE_POLICY_PROVIDER_GEMINI_API).strip().lower()
    key_pool = _resolve_gemini_fallback_key_pool()
    if not key_pool and provider != SOURCE_POLICY_PROVIDER_VERTEX:
        raise HTTPException(status_code=400, detail="Gemini key pool is empty.")
    if key_pool:
        BACKEND_GEMINI_ALLOCATOR.ensure_keys(key_pool)
    backend_snapshot = _backend_gemini_pool_snapshot()
    runtime_reload = _runtime_gemini_pool_reload()
    runtime_snapshot = _runtime_gemini_pool_snapshot()
    payload = {
        "ok": bool(backend_snapshot.get("ok")) and bool(runtime_reload.get("ok")),
        "detail": "Gemini API pools reloaded.",
        "warnings": list((meta or {}).get("warnings") or []),
        "backend": backend_snapshot,
        "runtimeReload": runtime_reload,
        "runtime": runtime_snapshot,
    }
    _audit_append_event(
        action="gemini_pools_reload",
        resource_type="gemini_pool",
        resource_id="global",
        after={"ok": bool(payload.get("ok"))},
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
    )
    return JSONResponse(
        {
            **payload,
        }
    )


@app.get("/admin/gemini/pools/usage")
def admin_gemini_pools_usage(request: Request) -> JSONResponse:
    _require_permission(request, PERM_OPS_READ)
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


@app.get("/admin/alerts/policies")
def admin_alerts_policies(request: Request, limit: int = 100) -> JSONResponse:
    _require_permission(request, PERM_ALERTS_READ)
    _ensure_scheduler_started()
    rows = _alert_list_policies(limit=limit)
    return JSONResponse({"ok": True, "items": rows, "count": len(rows)})


@app.post("/admin/alerts/policies")
def admin_alerts_create_policy(
    payload: AlertPolicyCreateRequest,
    request: Request,
) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_ALERTS_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    now_iso = _utc_now().isoformat()
    row = {
        "name": _truncate_text(payload.name, 120),
        "metricKey": _truncate_text(payload.metricKey, 80).lower(),
        "operator": _alert_normalize_operator(payload.operator),
        "threshold": float(payload.threshold),
        "windowSec": max(30, _safe_int(payload.windowSec, 300)),
        "cooldownSec": max(0, _safe_int(payload.cooldownSec, 300)),
        "severity": _truncate_text(payload.severity, 40).lower() or "warning",
        "enabled": bool(payload.enabled),
        "channels": _alert_normalize_channels(payload.channels),
        "createdBy": actor_uid,
        "updatedBy": actor_uid,
        "createdAt": now_iso,
        "updatedAt": now_iso,
    }
    written = _alert_upsert_policy("", row)
    _audit_append_event(
        action="alert_policy_create",
        resource_type="alert_policy",
        resource_id=str(written.get("id") or ""),
        after=written,
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
    )
    return JSONResponse({"ok": True, "policy": written})


@app.patch("/admin/alerts/policies/{policy_id}")
def admin_alerts_patch_policy(
    policy_id: str,
    payload: AlertPolicyPatchRequest,
    request: Request,
) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_ALERTS_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    current = _alert_get_policy(policy_id)
    if not isinstance(current, dict):
        raise HTTPException(status_code=404, detail="Alert policy not found.")
    before = dict(current)
    patch: dict[str, Any] = {"updatedAt": _utc_now().isoformat(), "updatedBy": actor_uid}
    if payload.name is not None:
        patch["name"] = _truncate_text(payload.name, 120)
    if payload.metricKey is not None:
        patch["metricKey"] = _truncate_text(payload.metricKey, 80).lower()
    if payload.operator is not None:
        patch["operator"] = _alert_normalize_operator(payload.operator)
    if payload.threshold is not None:
        patch["threshold"] = float(payload.threshold)
    if payload.windowSec is not None:
        patch["windowSec"] = max(30, _safe_int(payload.windowSec, 300))
    if payload.cooldownSec is not None:
        patch["cooldownSec"] = max(0, _safe_int(payload.cooldownSec, 300))
    if payload.severity is not None:
        patch["severity"] = _truncate_text(payload.severity, 40).lower() or "warning"
    if payload.enabled is not None:
        patch["enabled"] = bool(payload.enabled)
    if payload.channels is not None:
        patch["channels"] = _alert_normalize_channels(payload.channels)
    current.update(patch)
    written = _alert_upsert_policy(str(current.get("id") or policy_id), current)
    _audit_append_event(
        action="alert_policy_patch",
        resource_type="alert_policy",
        resource_id=str(written.get("id") or ""),
        before=before,
        after=written,
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
    )
    return JSONResponse({"ok": True, "policy": written})


@app.get("/admin/alerts/destinations")
def admin_alerts_destinations(request: Request, limit: int = 100) -> JSONResponse:
    _require_permission(request, PERM_ALERTS_READ)
    rows = _alert_list_destinations(limit=limit)
    return JSONResponse({"ok": True, "items": rows, "count": len(rows)})


@app.post("/admin/alerts/destinations")
def admin_alerts_create_destination(
    payload: AlertDestinationCreateRequest,
    request: Request,
) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_ALERTS_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    now_iso = _utc_now().isoformat()
    safe_type = str(payload.type or "webhook").strip().lower()
    if safe_type != "webhook":
        raise HTTPException(status_code=400, detail="Only webhook destinations are supported.")
    row = {
        "type": safe_type,
        "name": _truncate_text(payload.name, 120),
        "url": _truncate_text(payload.url, 800),
        "secretRef": _truncate_text(payload.secretRef, 200),
        "enabled": bool(payload.enabled),
        "createdBy": actor_uid,
        "updatedBy": actor_uid,
        "createdAt": now_iso,
        "updatedAt": now_iso,
    }
    written = _alert_upsert_destination("", row)
    _audit_append_event(
        action="alert_destination_create",
        resource_type="alert_destination",
        resource_id=str(written.get("id") or ""),
        after={**written, "secretRef": "***" if str(written.get("secretRef") or "") else ""},
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
    )
    return JSONResponse({"ok": True, "destination": written})


@app.patch("/admin/alerts/destinations/{destination_id}")
def admin_alerts_patch_destination(
    destination_id: str,
    payload: AlertDestinationPatchRequest,
    request: Request,
) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_ALERTS_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    current = _alert_get_destination(destination_id)
    if not isinstance(current, dict):
        raise HTTPException(status_code=404, detail="Alert destination not found.")
    before = dict(current)
    patch: dict[str, Any] = {"updatedAt": _utc_now().isoformat(), "updatedBy": actor_uid}
    if payload.name is not None:
        patch["name"] = _truncate_text(payload.name, 120)
    if payload.url is not None:
        patch["url"] = _truncate_text(payload.url, 800)
    if payload.secretRef is not None:
        patch["secretRef"] = _truncate_text(payload.secretRef, 200)
    if payload.enabled is not None:
        patch["enabled"] = bool(payload.enabled)
    current.update(patch)
    written = _alert_upsert_destination(str(current.get("id") or destination_id), current)
    _audit_append_event(
        action="alert_destination_patch",
        resource_type="alert_destination",
        resource_id=str(written.get("id") or ""),
        before={**before, "secretRef": "***" if str(before.get("secretRef") or "") else ""},
        after={**written, "secretRef": "***" if str(written.get("secretRef") or "") else ""},
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
    )
    return JSONResponse({"ok": True, "destination": written})


@app.get("/admin/alerts/events")
def admin_alerts_events(request: Request, status: str = "", limit: int = 200) -> JSONResponse:
    _require_permission(request, PERM_ALERTS_READ)
    rows = _alert_list_events(limit=limit)
    safe_status = str(status or "").strip().lower()
    if safe_status:
        rows = [row for row in rows if str(row.get("status") or "").strip().lower() == safe_status]
    return JSONResponse({"ok": True, "items": rows, "count": len(rows)})


@app.post("/admin/alerts/events/{event_id}/ack")
def admin_alerts_event_ack(event_id: str, payload: AlertEventDecisionRequest, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_ALERTS_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    event = _alert_get_event(event_id)
    if not isinstance(event, dict):
        raise HTTPException(status_code=404, detail="Alert event not found.")
    before = dict(event)
    event["status"] = "ack"
    event["ackBy"] = actor_uid
    event["ackAt"] = _utc_now().isoformat()
    event["note"] = _truncate_text(payload.note, 300)
    written = _alert_upsert_event(str(event.get("id") or event_id), event)
    _audit_append_event(
        action="alert_event_ack",
        resource_type="alert_event",
        resource_id=str(written.get("id") or ""),
        before=before,
        after=written,
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
    )
    return JSONResponse({"ok": True, "event": written})


@app.post("/admin/alerts/events/{event_id}/resolve")
def admin_alerts_event_resolve(event_id: str, payload: AlertEventDecisionRequest, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_ALERTS_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    event = _alert_get_event(event_id)
    if not isinstance(event, dict):
        raise HTTPException(status_code=404, detail="Alert event not found.")
    before = dict(event)
    event["status"] = "resolved"
    event["resolvedAt"] = _utc_now().isoformat()
    event["resolvedBy"] = actor_uid
    event["note"] = _truncate_text(payload.note, 300)
    written = _alert_upsert_event(str(event.get("id") or event_id), event)
    _audit_append_event(
        action="alert_event_resolve",
        resource_type="alert_event",
        resource_id=str(written.get("id") or ""),
        before=before,
        after=written,
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
    )
    return JSONResponse({"ok": True, "event": written})


@app.get("/admin/scheduler/tasks")
def admin_scheduler_tasks(request: Request, limit: int = 200) -> JSONResponse:
    _require_permission(request, PERM_SCHEDULER_READ)
    _ensure_scheduler_started()
    rows = _scheduler_list_tasks(limit=limit)
    return JSONResponse({"ok": True, "items": rows, "count": len(rows)})


@app.post("/admin/scheduler/tasks")
def admin_scheduler_create_task(payload: ScheduledTaskCreateRequest, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_SCHEDULER_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    safe_task_type, safe_cron, safe_timezone, safe_policy = _scheduler_task_payload_validate(
        task_type=payload.taskType,
        cron_expr=payload.cronExpr,
        timezone_name=payload.timezone,
        concurrency_policy=payload.concurrencyPolicy,
    )
    now = _utc_now()
    row = {
        "taskType": safe_task_type,
        "cronExpr": safe_cron,
        "timezone": safe_timezone,
        "enabled": bool(payload.enabled),
        "dryRun": bool(payload.dryRun),
        "payload": payload.payload if isinstance(payload.payload, dict) else {},
        "concurrencyPolicy": safe_policy,
        "nextRunAt": _scheduler_next_run_at(safe_cron, safe_timezone, after=now).isoformat(),
        "lastRunAt": None,
        "lastResult": {},
        "createdAt": now.isoformat(),
        "updatedAt": now.isoformat(),
        "updatedBy": actor_uid,
    }
    written = _scheduler_upsert_task("", row)
    _audit_append_event(
        action="scheduler_task_create",
        resource_type="scheduler_task",
        resource_id=str(written.get("id") or ""),
        after=written,
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
    )
    _ensure_scheduler_started()
    return JSONResponse({"ok": True, "task": written})


@app.patch("/admin/scheduler/tasks/{task_id}")
def admin_scheduler_patch_task(task_id: str, payload: ScheduledTaskPatchRequest, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_SCHEDULER_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    current = _scheduler_get_task(task_id)
    if not isinstance(current, dict):
        raise HTTPException(status_code=404, detail="Task not found.")
    before = dict(current)
    task_type = str(current.get("taskType") or "")
    cron_expr = payload.cronExpr if payload.cronExpr is not None else str(current.get("cronExpr") or "")
    timezone_name = payload.timezone if payload.timezone is not None else str(current.get("timezone") or "UTC")
    concurrency_policy = (
        payload.concurrencyPolicy
        if payload.concurrencyPolicy is not None
        else str(current.get("concurrencyPolicy") or "forbid")
    )
    _safe_task_type, safe_cron, safe_timezone, safe_policy = _scheduler_task_payload_validate(
        task_type=task_type,
        cron_expr=cron_expr,
        timezone_name=timezone_name,
        concurrency_policy=concurrency_policy,
    )
    patch: dict[str, Any] = {
        "cronExpr": safe_cron,
        "timezone": safe_timezone,
        "concurrencyPolicy": safe_policy,
        "updatedAt": _utc_now().isoformat(),
        "updatedBy": actor_uid,
    }
    if payload.enabled is not None:
        patch["enabled"] = bool(payload.enabled)
    if payload.dryRun is not None:
        patch["dryRun"] = bool(payload.dryRun)
    if payload.payload is not None:
        patch["payload"] = payload.payload if isinstance(payload.payload, dict) else {}
    patch["nextRunAt"] = _scheduler_next_run_at(safe_cron, safe_timezone, after=_utc_now()).isoformat()
    current.update(patch)
    written = _scheduler_upsert_task(str(current.get("id") or task_id), current)
    _audit_append_event(
        action="scheduler_task_patch",
        resource_type="scheduler_task",
        resource_id=str(written.get("id") or ""),
        before=before,
        after=written,
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
    )
    return JSONResponse({"ok": True, "task": written})


@app.post("/admin/scheduler/tasks/{task_id}/run")
def admin_scheduler_run_task(task_id: str, payload: ScheduledTaskRunRequest, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_SCHEDULER_WRITE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    run = _scheduler_run_task(
        str(task_id or "").strip(),
        requested_by=actor_uid,
        dry_run_override=payload.dryRun if payload.dryRun is not None else None,
    )
    _audit_append_event(
        action="scheduler_task_run",
        resource_type="scheduler_task",
        resource_id=str(task_id or ""),
        after={"runId": str(run.get("id") or ""), "status": str(run.get("status") or "")},
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
    )
    return JSONResponse({"ok": True, "run": run})


@app.get("/admin/scheduler/runs")
def admin_scheduler_runs(request: Request, taskId: str = "", limit: int = 200) -> JSONResponse:
    _require_permission(request, PERM_SCHEDULER_READ)
    rows = _scheduler_list_runs(limit=limit, task_id=taskId)
    return JSONResponse({"ok": True, "items": rows, "count": len(rows)})


@app.get("/admin/scheduler/runs/{run_id}")
def admin_scheduler_run_by_id(run_id: str, request: Request) -> JSONResponse:
    _require_permission(request, PERM_SCHEDULER_READ)
    safe_run_id = str(run_id or "").strip()
    if not safe_run_id:
        raise HTTPException(status_code=400, detail="Missing run id.")
    collection = _firestore_collection(SCHEDULER_RUNS_COLLECTION)
    row: Optional[dict[str, Any]] = None
    if collection is None:
        with _INMEMORY_LOCK:
            item = _INMEMORY_SCHEDULER_RUNS.get(safe_run_id)
            if isinstance(item, dict):
                row = dict(item)
    else:
        try:
            doc = collection.document(safe_run_id).get()
            if doc.exists:
                row = {**(doc.to_dict() or {}), "id": safe_run_id}
        except Exception:
            row = None
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found.")
    return JSONResponse({"ok": True, "run": row})


@app.get("/admin/analytics/coupons/summary")
def admin_coupon_analytics_summary(
    request: Request,
    fromIso: str = Query("", alias="from"),
    toIso: str = Query("", alias="to"),
    plan: str = "",
    couponKind: str = "",
) -> JSONResponse:
    _require_permission(request, PERM_ANALYTICS_READ)
    end_dt = _normalize_iso_datetime(toIso) if str(toIso or "").strip() else _utc_now()
    start_dt = _normalize_iso_datetime(fromIso, fallback=end_dt - timedelta(days=30)) if str(fromIso or "").strip() else (end_dt - timedelta(days=30))
    rows = _analytics_list_coupon_daily(
        from_dt=start_dt,
        to_dt=end_dt,
        plan=plan,
        coupon_kind=couponKind,
        coupon_code="",
    )
    agg = {
        "checkoutsStarted": 0,
        "checkoutsCompleted": 0,
        "subscriptionsActivated": 0,
        "cancellationsWithin30d": 0,
        "grossAmount": 0.0,
        "discountAmount": 0.0,
        "netAmount": 0.0,
    }
    for row in rows:
        agg["checkoutsStarted"] += _safe_int(row.get("checkoutsStarted"), 0)
        agg["checkoutsCompleted"] += _safe_int(row.get("checkoutsCompleted"), 0)
        agg["subscriptionsActivated"] += _safe_int(row.get("subscriptionsActivated"), 0)
        agg["cancellationsWithin30d"] += _safe_int(row.get("cancellationsWithin30d"), 0)
        agg["grossAmount"] += _safe_float(row.get("grossAmount"), 0.0)
        agg["discountAmount"] += _safe_float(row.get("discountAmount"), 0.0)
        agg["netAmount"] += _safe_float(row.get("netAmount"), 0.0)
    payload = _analytics_compute_rates(agg)
    return JSONResponse({"ok": True, "summary": payload, "count": len(rows)})


@app.get("/admin/analytics/coupons/timeseries")
def admin_coupon_analytics_timeseries(
    request: Request,
    fromIso: str = Query("", alias="from"),
    toIso: str = Query("", alias="to"),
    groupBy: str = "day",
    plan: str = "",
    couponKind: str = "",
) -> JSONResponse:
    _require_permission(request, PERM_ANALYTICS_READ)
    safe_group = str(groupBy or "day").strip().lower()
    if safe_group not in {"day", "week"}:
        raise HTTPException(status_code=400, detail="groupBy must be day or week.")
    end_dt = _normalize_iso_datetime(toIso) if str(toIso or "").strip() else _utc_now()
    start_dt = _normalize_iso_datetime(fromIso, fallback=end_dt - timedelta(days=30)) if str(fromIso or "").strip() else (end_dt - timedelta(days=30))
    rows = _analytics_list_coupon_daily(
        from_dt=start_dt,
        to_dt=end_dt,
        plan=plan,
        coupon_kind=couponKind,
        coupon_code="",
    )
    buckets: dict[str, dict[str, Any]] = {}
    for row in rows:
        date_token = str(row.get("date") or "")
        parsed = _parse_optional_datetime(f"{date_token}T00:00:00+00:00")
        if parsed is None:
            continue
        if safe_group == "week":
            iso_year, iso_week, _iso_weekday = parsed.isocalendar()
            key = f"{iso_year}-W{iso_week:02d}"
        else:
            key = parsed.strftime("%Y-%m-%d")
        bucket = buckets.setdefault(
            key,
            {
                "bucket": key,
                "checkoutsStarted": 0,
                "checkoutsCompleted": 0,
                "subscriptionsActivated": 0,
                "cancellationsWithin30d": 0,
                "grossAmount": 0.0,
                "discountAmount": 0.0,
                "netAmount": 0.0,
            },
        )
        bucket["checkoutsStarted"] += _safe_int(row.get("checkoutsStarted"), 0)
        bucket["checkoutsCompleted"] += _safe_int(row.get("checkoutsCompleted"), 0)
        bucket["subscriptionsActivated"] += _safe_int(row.get("subscriptionsActivated"), 0)
        bucket["cancellationsWithin30d"] += _safe_int(row.get("cancellationsWithin30d"), 0)
        bucket["grossAmount"] += _safe_float(row.get("grossAmount"), 0.0)
        bucket["discountAmount"] += _safe_float(row.get("discountAmount"), 0.0)
        bucket["netAmount"] += _safe_float(row.get("netAmount"), 0.0)
    series = [_analytics_compute_rates(value) for key, value in sorted(buckets.items(), key=lambda item: item[0])]
    return JSONResponse({"ok": True, "groupBy": safe_group, "series": series, "count": len(series)})


@app.get("/admin/analytics/coupons/{coupon_code}/impact")
def admin_coupon_analytics_impact(
    coupon_code: str,
    request: Request,
    fromIso: str = Query("", alias="from"),
    toIso: str = Query("", alias="to"),
) -> JSONResponse:
    _require_permission(request, PERM_ANALYTICS_READ)
    safe_code = _normalize_coupon_code(coupon_code)
    if not safe_code:
        raise HTTPException(status_code=400, detail="Invalid coupon code.")
    end_dt = _normalize_iso_datetime(toIso) if str(toIso or "").strip() else _utc_now()
    start_dt = _normalize_iso_datetime(fromIso, fallback=end_dt - timedelta(days=30)) if str(fromIso or "").strip() else (end_dt - timedelta(days=30))
    rows = _analytics_list_coupon_daily(
        from_dt=start_dt,
        to_dt=end_dt,
        plan="",
        coupon_kind="",
        coupon_code=safe_code,
    )
    per_plan: dict[str, dict[str, Any]] = {}
    overall = {
        "checkoutsStarted": 0,
        "checkoutsCompleted": 0,
        "subscriptionsActivated": 0,
        "cancellationsWithin30d": 0,
        "grossAmount": 0.0,
        "discountAmount": 0.0,
        "netAmount": 0.0,
    }
    for row in rows:
        plan_token = str(row.get("plan") or "unknown").strip().lower()
        bucket = per_plan.setdefault(
            plan_token,
            {
                "plan": plan_token,
                "checkoutsStarted": 0,
                "checkoutsCompleted": 0,
                "subscriptionsActivated": 0,
                "cancellationsWithin30d": 0,
                "grossAmount": 0.0,
                "discountAmount": 0.0,
                "netAmount": 0.0,
            },
        )
        for key in ["checkoutsStarted", "checkoutsCompleted", "subscriptionsActivated", "cancellationsWithin30d"]:
            inc = _safe_int(row.get(key), 0)
            bucket[key] += inc
            overall[key] += inc
        for key in ["grossAmount", "discountAmount", "netAmount"]:
            incf = _safe_float(row.get(key), 0.0)
            bucket[key] += incf
            overall[key] += incf
    overall = _analytics_compute_rates(overall)
    plan_rows = [_analytics_compute_rates(value) for _k, value in sorted(per_plan.items(), key=lambda item: item[0])]
    return JSONResponse({"ok": True, "couponCode": safe_code, "overall": overall, "byPlan": plan_rows})


def _coupon_plan_allowed_for_checkout(coupon: dict[str, Any], plan_token: str) -> bool:
    plan_discounts = _normalize_coupon_plan_discounts(
        coupon.get("planDiscounts"),
        fallback_discount_type=str(coupon.get("discountType") or COUPON_DISCOUNT_PERCENT),
        fallback_percent_off=_as_float(coupon.get("percentOff"), 0.0),
        fallback_amount_off_inr=_as_positive_int(coupon.get("amountOffInr")),
        fallback_plans=_normalize_coupon_plan_scope(coupon.get("appliesToPlans")),
        stripe_coupons_by_plan=(coupon.get("stripeCouponsByPlan") if isinstance(coupon.get("stripeCouponsByPlan"), dict) else None),
    )
    applies_to = sorted(plan_discounts.keys()) or _normalize_coupon_plan_scope(coupon.get("appliesToPlans"))
    safe_plan = _normalize_coupon_plan_token(plan_token)
    return safe_plan in set(applies_to)


def _cleanup_expired_subscription_reservations(
    coupon_id: str,
    *,
    now: Optional[datetime] = None,
    limit: int = 120,
) -> int:
    safe_coupon_id = str(coupon_id or "").strip()
    if not safe_coupon_id:
        return 0
    current = now or _utc_now()
    safe_limit = max(1, min(1000, int(limit)))

    coupons = _firestore_collection("coupons")
    redemptions = _firestore_collection("coupon_redemptions")
    if coupons is None or redemptions is None or _FIRESTORE_DB is None or firebase_firestore is None:
        released_count = 0
        with _INMEMORY_LOCK:
            coupon = _coupon_backfill_fields(_INMEMORY_COUPONS.get(safe_coupon_id) or {}, current)
            for reservation_id, row in list(_INMEMORY_COUPON_REDEMPTIONS.items()):
                if not isinstance(row, dict):
                    continue
                if str(row.get("couponId") or "").strip() != safe_coupon_id:
                    continue
                if str(row.get("channel") or "").strip().lower() != "subscription":
                    continue
                if str(row.get("status") or "").strip().lower() != "reserved":
                    continue
                expires_at = _parse_optional_datetime(str(row.get("expiresAt") or ""))
                if not expires_at or expires_at > current:
                    continue
                row["status"] = "released"
                row["releasedAt"] = current.isoformat()
                row["releaseReason"] = "reservation_ttl_expired"
                _INMEMORY_COUPON_REDEMPTIONS[reservation_id] = row
                released_count += 1
            if released_count > 0:
                coupon["reservedCount"] = max(0, _as_positive_int(coupon.get("reservedCount")) - released_count)
                coupon["updatedAt"] = current.isoformat()
                _INMEMORY_COUPONS[safe_coupon_id] = dict(coupon)
        return released_count

    try:
        docs = list(
            _FIRESTORE_DB.collection("coupon_redemptions")
            .where("couponId", "==", safe_coupon_id)
            .where("channel", "==", "subscription")
            .where("status", "==", "reserved")
            .limit(safe_limit)
            .stream()
        )
    except Exception:
        return 0

    released_count = 0
    for doc in docs:
        row = doc.to_dict() or {}
        expires_at = _parse_optional_datetime(str(row.get("expiresAt") or ""))
        if not expires_at or expires_at > current:
            continue
        _release_subscription_coupon_reservation(str(doc.id or ""), reason="reservation_ttl_expired")
        released_count += 1
    return released_count


def _coupon_reservation_expires_at(now: Optional[datetime] = None) -> datetime:
    base = now or _utc_now()
    return base + timedelta(minutes=COUPON_RESERVATION_TTL_MINUTES)


def _reserve_subscription_coupon_for_checkout(uid: str, code: str, plan_token: str) -> dict[str, Any]:
    safe_uid = str(uid or "").strip()
    safe_code = _normalize_coupon_code(code)
    safe_plan = _normalize_coupon_plan_token(plan_token)
    if not safe_uid:
        raise HTTPException(status_code=400, detail="Missing user uid.")
    if not safe_code:
        raise HTTPException(status_code=400, detail="Coupon code is required.")
    checkout_coupon_plans = _normalize_coupon_plan_scope(
        [plan for plan in PLAN_LIMITS.keys() if str(plan or "").strip().lower() != "free"]
    )
    if safe_plan not in set(checkout_coupon_plans):
        raise HTTPException(status_code=400, detail="Unsupported plan for coupon checkout.")
    now = _utc_now()
    expires_at = _coupon_reservation_expires_at(now)

    coupons = _firestore_collection("coupons")
    redemptions = _firestore_collection("coupon_redemptions")
    if coupons is None or redemptions is None or _FIRESTORE_DB is None or firebase_firestore is None:
        with _INMEMORY_LOCK:
            lookup_code = _coupon_store_ref(safe_code)
            coupon_id = str(_INMEMORY_COUPON_CODE_INDEX.get(lookup_code) or "").strip()
            if not coupon_id:
                _inmemory_rebuild_coupon_index_locked()
                coupon_id = str(_INMEMORY_COUPON_CODE_INDEX.get(lookup_code) or "").strip()
            if not coupon_id:
                raise HTTPException(status_code=404, detail="Coupon not found.")
            coupon = _coupon_backfill_fields(_INMEMORY_COUPONS.get(coupon_id) or {}, now)
            if _normalize_coupon_type(str(coupon.get("couponType") or "")) != COUPON_TYPE_SUBSCRIPTION_DISCOUNT:
                raise HTTPException(status_code=400, detail="Coupon is not valid for subscription checkout.")
            if not _as_bool(coupon.get("active")):
                raise HTTPException(status_code=400, detail="Coupon is inactive.")
            if _coupon_is_expired(coupon, now):
                raise HTTPException(status_code=400, detail="Coupon has expired.")
            if not _coupon_plan_allowed_for_checkout(coupon, safe_plan):
                raise HTTPException(status_code=400, detail="Coupon is not applicable for this plan.")
            _cleanup_expired_subscription_reservations(coupon_id, now=now)
            coupon = _coupon_backfill_fields(_INMEMORY_COUPONS.get(coupon_id) or coupon, now)
            policy = _normalize_coupon_usage_policy(str(coupon.get("usagePolicy") or ""))
            if policy == COUPON_USAGE_SINGLE_PER_USER:
                has_existing = any(
                    str((entry or {}).get("couponId") or "").strip() == coupon_id
                    and str((entry or {}).get("uid") or "").strip() == safe_uid
                    and str((entry or {}).get("channel") or "").strip().lower() == "subscription"
                    and str((entry or {}).get("status") or "").strip().lower() in {"reserved", "redeemed"}
                    for entry in _INMEMORY_COUPON_REDEMPTIONS.values()
                )
                if has_existing:
                    raise HTTPException(status_code=409, detail="Coupon already used by this user.")
            if _coupon_usage_limit_reached(coupon):
                raise HTTPException(status_code=400, detail="Coupon redemption limit reached.")
            reservation_id = (
                f"sub::{coupon_id}::{safe_uid}"
                if policy == COUPON_USAGE_SINGLE_PER_USER
                else f"sub_{coupon_id}_{safe_uid}_{uuid.uuid4().hex}"
            )
            reservation = {
                "id": reservation_id,
                "couponId": coupon_id,
                "uid": safe_uid,
                "code": safe_code,
                "channel": "subscription",
                "status": "reserved",
                "usagePolicy": policy,
                "couponType": COUPON_TYPE_SUBSCRIPTION_DISCOUNT,
                "plan": safe_plan,
                "createdAt": now.isoformat(),
                "expiresAt": expires_at.isoformat(),
            }
            coupon["reservedCount"] = _as_positive_int(coupon.get("reservedCount")) + 1
            coupon["updatedAt"] = now.isoformat()
            _INMEMORY_COUPONS[coupon_id] = dict(coupon)
            _INMEMORY_COUPON_REDEMPTIONS[reservation_id] = reservation
            _analytics_record_coupon_event(
                "reservation",
                ACTIVE_BILLING_PROVIDER,
                safe_code,
                str(coupon.get("couponType") or COUPON_TYPE_SUBSCRIPTION_DISCOUNT),
                safe_plan,
                metadata={"reservationId": reservation_id},
            )
            return {"coupon": coupon, "reservationId": reservation_id}

    coupon_id, coupon_lookup = _coupon_get_firestore_by_code(safe_code)
    if not coupon_id or not coupon_lookup:
        raise HTTPException(status_code=404, detail="Coupon not found.")
    _cleanup_expired_subscription_reservations(coupon_id, now=now)

    coupon_ref = _FIRESTORE_DB.collection("coupons").document(coupon_id)
    reservation_doc_id = (
        f"sub::{coupon_id}::{safe_uid}"
        if _normalize_coupon_usage_policy(str(coupon_lookup.get("usagePolicy") or "")) == COUPON_USAGE_SINGLE_PER_USER
        else f"sub_{coupon_id}_{safe_uid}_{uuid.uuid4().hex}"
    )
    reservation_ref = _FIRESTORE_DB.collection("coupon_redemptions").document(reservation_doc_id)
    transaction = _FIRESTORE_DB.transaction()

    @firebase_firestore.transactional
    def _apply(transaction_obj: Any) -> dict[str, Any]:
        coupon_doc = coupon_ref.get(transaction=transaction_obj)
        if not coupon_doc.exists:
            raise RuntimeError("Coupon not found.")
        coupon = _coupon_backfill_fields({**(coupon_doc.to_dict() or {}), "id": coupon_id}, now)
        if _normalize_coupon_type(str(coupon.get("couponType") or "")) != COUPON_TYPE_SUBSCRIPTION_DISCOUNT:
            raise RuntimeError("Coupon is not valid for subscription checkout.")
        if not _as_bool(coupon.get("active")):
            raise RuntimeError("Coupon is inactive.")
        if _coupon_is_expired(coupon, now):
            raise RuntimeError("Coupon has expired.")
        if not _coupon_plan_allowed_for_checkout(coupon, safe_plan):
            raise RuntimeError("Coupon is not applicable for this plan.")
        policy = _normalize_coupon_usage_policy(str(coupon.get("usagePolicy") or ""))
        if policy == COUPON_USAGE_SINGLE_PER_USER:
            existing = reservation_ref.get(transaction=transaction_obj)
            if existing.exists:
                existing_payload = existing.to_dict() or {}
                if str(existing_payload.get("status") or "").strip().lower() in {"reserved", "redeemed"}:
                    raise RuntimeError("Coupon already used by this user.")
        if _coupon_usage_limit_reached(coupon):
            raise RuntimeError("Coupon redemption limit reached.")
        coupon["reservedCount"] = _as_positive_int(coupon.get("reservedCount")) + 1
        coupon["updatedAt"] = now.isoformat()
        reservation_payload = {
            "id": reservation_ref.id,
            "couponId": coupon_id,
            "uid": safe_uid,
            "code": safe_code,
            "channel": "subscription",
            "status": "reserved",
            "usagePolicy": policy,
            "couponType": COUPON_TYPE_SUBSCRIPTION_DISCOUNT,
            "plan": safe_plan,
            "createdAt": now.isoformat(),
            "expiresAt": expires_at.isoformat(),
        }
        transaction_obj.set(coupon_ref, coupon, merge=True)
        transaction_obj.set(reservation_ref, reservation_payload, merge=True)
        return {"coupon": coupon, "reservationId": reservation_ref.id}

    try:
        result = _apply(transaction)
        _analytics_record_coupon_event(
            "reservation",
            ACTIVE_BILLING_PROVIDER,
            safe_code,
            str((result.get("coupon") or {}).get("couponType") or COUPON_TYPE_SUBSCRIPTION_DISCOUNT),
            safe_plan,
            metadata={"reservationId": str(result.get("reservationId") or "")},
        )
        return result
    except RuntimeError as exc:
        detail = str(exc)
        status = 400
        if "already used" in detail.lower():
            status = 409
        if "not found" in detail.lower():
            status = 404
        raise HTTPException(status_code=status, detail=detail) from exc


def _release_subscription_coupon_reservation(reservation_id: str, reason: str = "checkout_failed") -> None:
    safe_reservation_id = str(reservation_id or "").strip()
    if not safe_reservation_id:
        return
    now = _utc_now()
    coupons = _firestore_collection("coupons")
    redemptions = _firestore_collection("coupon_redemptions")
    if coupons is None or redemptions is None or _FIRESTORE_DB is None or firebase_firestore is None:
        with _INMEMORY_LOCK:
            row = _INMEMORY_COUPON_REDEMPTIONS.get(safe_reservation_id)
            if not isinstance(row, dict):
                return
            if str(row.get("status") or "").strip().lower() != "reserved":
                return
            coupon_id = str(row.get("couponId") or "").strip()
            coupon = _coupon_backfill_fields(_INMEMORY_COUPONS.get(coupon_id) or {}, now)
            coupon["reservedCount"] = max(0, _as_positive_int(coupon.get("reservedCount")) - 1)
            coupon["updatedAt"] = now.isoformat()
            _INMEMORY_COUPONS[coupon_id] = dict(coupon)
            row["status"] = "released"
            row["releasedAt"] = now.isoformat()
            row["releaseReason"] = str(reason or "checkout_failed")[:80]
            _INMEMORY_COUPON_REDEMPTIONS[safe_reservation_id] = row
        return

    reservation_ref = _FIRESTORE_DB.collection("coupon_redemptions").document(safe_reservation_id)
    transaction = _FIRESTORE_DB.transaction()

    @firebase_firestore.transactional
    def _apply(transaction_obj: Any) -> None:
        reservation_doc = reservation_ref.get(transaction=transaction_obj)
        if not reservation_doc.exists:
            return
        reservation = reservation_doc.to_dict() or {}
        if str(reservation.get("status") or "").strip().lower() != "reserved":
            return
        coupon_id = str(reservation.get("couponId") or "").strip()
        if not coupon_id:
            return
        coupon_ref = _FIRESTORE_DB.collection("coupons").document(coupon_id)
        coupon_doc = coupon_ref.get(transaction=transaction_obj)
        if coupon_doc.exists:
            coupon = _coupon_backfill_fields({**(coupon_doc.to_dict() or {}), "id": coupon_id}, now)
            coupon["reservedCount"] = max(0, _as_positive_int(coupon.get("reservedCount")) - 1)
            coupon["updatedAt"] = now.isoformat()
            transaction_obj.set(coupon_ref, coupon, merge=True)
        reservation["status"] = "released"
        reservation["releasedAt"] = now.isoformat()
        reservation["releaseReason"] = str(reason or "checkout_failed")[:80]
        transaction_obj.set(reservation_ref, reservation, merge=True)

    try:
        _apply(transaction)
    except Exception:
        return


def _finalize_subscription_coupon_redemption(
    *,
    session_id: str,
    reservation_id: str,
    uid: str,
) -> dict[str, Any]:
    safe_reservation_id = str(reservation_id or "").strip()
    if not safe_reservation_id:
        return {"ok": False, "reason": "missing_reservation"}
    now = _utc_now()

    coupons = _firestore_collection("coupons")
    redemptions = _firestore_collection("coupon_redemptions")
    if coupons is None or redemptions is None or _FIRESTORE_DB is None or firebase_firestore is None:
        with _INMEMORY_LOCK:
            reservation = _INMEMORY_COUPON_REDEMPTIONS.get(safe_reservation_id)
            if not isinstance(reservation, dict):
                return {"ok": False, "reason": "reservation_not_found"}
            status = str(reservation.get("status") or "").strip().lower()
            if status == "redeemed":
                return {"ok": True, "alreadyFinalized": True}
            if status != "reserved":
                return {"ok": False, "reason": f"invalid_status:{status or 'unknown'}"}
            if str(reservation.get("uid") or "").strip() != str(uid or "").strip():
                return {"ok": False, "reason": "uid_mismatch"}
            coupon_id = str(reservation.get("couponId") or "").strip()
            coupon = _coupon_backfill_fields(_INMEMORY_COUPONS.get(coupon_id) or {}, now)
            coupon["reservedCount"] = max(0, _as_positive_int(coupon.get("reservedCount")) - 1)
            coupon["redeemedCount"] = _as_positive_int(coupon.get("redeemedCount")) + 1
            coupon["updatedAt"] = now.isoformat()
            _INMEMORY_COUPONS[coupon_id] = dict(coupon)
            reservation["status"] = "redeemed"
            reservation["redeemedAt"] = now.isoformat()
            reservation["checkoutSessionId"] = str(session_id or "").strip()
            _INMEMORY_COUPON_REDEMPTIONS[safe_reservation_id] = reservation
            _analytics_record_coupon_event(
                "final_redemption",
                ACTIVE_BILLING_PROVIDER,
                str(reservation.get("code") or ""),
                str(reservation.get("couponType") or COUPON_TYPE_SUBSCRIPTION_DISCOUNT),
                str(reservation.get("plan") or ""),
                metadata={"reservationId": safe_reservation_id, "sessionId": str(session_id or "")},
            )
            return {"ok": True, "couponId": coupon_id}

    reservation_ref = _FIRESTORE_DB.collection("coupon_redemptions").document(safe_reservation_id)
    transaction = _FIRESTORE_DB.transaction()

    @firebase_firestore.transactional
    def _apply(transaction_obj: Any) -> dict[str, Any]:
        reservation_doc = reservation_ref.get(transaction=transaction_obj)
        if not reservation_doc.exists:
            return {"ok": False, "reason": "reservation_not_found"}
        reservation = reservation_doc.to_dict() or {}
        status = str(reservation.get("status") or "").strip().lower()
        if status == "redeemed":
            return {"ok": True, "alreadyFinalized": True}
        if status != "reserved":
            return {"ok": False, "reason": f"invalid_status:{status or 'unknown'}"}
        if str(reservation.get("uid") or "").strip() != str(uid or "").strip():
            return {"ok": False, "reason": "uid_mismatch"}
        coupon_id = str(reservation.get("couponId") or "").strip()
        if not coupon_id:
            return {"ok": False, "reason": "coupon_missing"}
        coupon_ref = _FIRESTORE_DB.collection("coupons").document(coupon_id)
        coupon_doc = coupon_ref.get(transaction=transaction_obj)
        if not coupon_doc.exists:
            return {"ok": False, "reason": "coupon_not_found"}
        coupon = _coupon_backfill_fields({**(coupon_doc.to_dict() or {}), "id": coupon_id}, now)
        coupon["reservedCount"] = max(0, _as_positive_int(coupon.get("reservedCount")) - 1)
        coupon["redeemedCount"] = _as_positive_int(coupon.get("redeemedCount")) + 1
        coupon["updatedAt"] = now.isoformat()
        reservation["status"] = "redeemed"
        reservation["redeemedAt"] = now.isoformat()
        reservation["checkoutSessionId"] = str(session_id or "").strip()
        transaction_obj.set(coupon_ref, coupon, merge=True)
        transaction_obj.set(reservation_ref, reservation, merge=True)
        return {"ok": True, "couponId": coupon_id}

    try:
        result = _apply(transaction)
        if bool(result.get("ok")):
            reservation = _firestore_collection("coupon_redemptions")
            code_value = ""
            plan_value = ""
            coupon_type = COUPON_TYPE_SUBSCRIPTION_DISCOUNT
            if reservation is None:
                with _INMEMORY_LOCK:
                    row = _INMEMORY_COUPON_REDEMPTIONS.get(safe_reservation_id) or {}
                    code_value = str(row.get("code") or "")
                    plan_value = str(row.get("plan") or "")
                    coupon_type = str(row.get("couponType") or coupon_type)
            else:
                try:
                    doc = _FIRESTORE_DB.collection("coupon_redemptions").document(safe_reservation_id).get() if _FIRESTORE_DB is not None else None
                    if doc is not None and doc.exists:
                        row = doc.to_dict() or {}
                        code_value = str(row.get("code") or "")
                        plan_value = str(row.get("plan") or "")
                        coupon_type = str(row.get("couponType") or coupon_type)
                except Exception:
                    pass
            _analytics_record_coupon_event(
                "final_redemption",
                ACTIVE_BILLING_PROVIDER,
                code_value,
                coupon_type,
                plan_value,
                metadata={"reservationId": safe_reservation_id, "sessionId": str(session_id or "")},
            )
        return result
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "reason": str(exc)}


@app.post("/billing/checkout-session")
def billing_checkout_session(payload: BillingCheckoutSessionRequest, request: Request) -> JSONResponse:
    _require_stripe_ready()
    uid = _require_request_uid(request)
    plan_token = _plan_key_from_name(str(payload.plan or "").strip().lower())
    if plan_token not in set(PAID_PLAN_KEYS):
        raise HTTPException(status_code=400, detail="Unsupported plan. Use starter, creator, pro, or scale.")
    price_id = _stripe_price_id_for_plan(plan_token, phase="first")
    if not price_id:
        raise HTTPException(status_code=503, detail="Stripe first-cycle price is not configured for selected plan.")
    if not _stripe_plan_prices_configured():
        raise HTTPException(status_code=503, detail="Stripe plan price catalog is not fully configured.")

    reserved_coupon: dict[str, Any] = {}
    reservation_id = ""
    coupon_code = _normalize_coupon_code(str(payload.couponCode or ""))
    if coupon_code:
        reservation = _reserve_subscription_coupon_for_checkout(uid, coupon_code, plan_token)
        reserved_coupon = dict(reservation.get("coupon") or {})
        reservation_id = str(reservation.get("reservationId") or "").strip()
        if not reservation_id:
            raise HTTPException(status_code=500, detail="Coupon reservation failed.")
        _analytics_record_coupon_event(
            "checkout_started",
            ACTIVE_BILLING_PROVIDER,
            coupon_code,
            str(reserved_coupon.get("couponType") or COUPON_TYPE_SUBSCRIPTION_DISCOUNT),
            plan_token,
            metadata={"uid": uid, "reservationId": reservation_id},
        )

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
    session_metadata: dict[str, Any] = {"uid": uid, "plan": plan_token}
    subscription_metadata: dict[str, Any] = {"uid": uid, "plan": plan_token}
    discounts_payload: list[dict[str, Any]] = []
    if reservation_id:
        coupon_id = _coupon_resolved_stripe_coupon_id_for_plan(reserved_coupon, plan_token)
        promotion_code_id = str(reserved_coupon.get("stripePromotionCodeId") or "").strip()
        if coupon_id:
            discounts_payload = [{"coupon": coupon_id}]
        elif promotion_code_id:
            discounts_payload = [{"promotion_code": promotion_code_id}]
        else:
            _release_subscription_coupon_reservation(reservation_id, reason="stripe_mapping_missing")
            raise HTTPException(status_code=400, detail="Coupon is missing Stripe mapping.")
        session_metadata.update(
            {
                "couponCode": coupon_code,
                "couponId": str(reserved_coupon.get("id") or ""),
                "couponReservationId": reservation_id,
                "couponType": COUPON_TYPE_SUBSCRIPTION_DISCOUNT,
            }
        )
        subscription_metadata.update(
            {
                "couponCode": coupon_code,
                "couponId": str(reserved_coupon.get("id") or ""),
                "couponReservationId": reservation_id,
            }
        )
    try:
        session_payload: dict[str, Any] = {
            "mode": "subscription",
            "customer": customer_id,
            "line_items": [{"price": price_id, "quantity": 1}],
            "success_url": success_url,
            "cancel_url": cancel_url,
            "allow_promotion_codes": True,
            "automatic_tax": {"enabled": False},
            "metadata": session_metadata,
            "subscription_data": {"metadata": subscription_metadata},
        }
        if discounts_payload:
            session_payload["discounts"] = discounts_payload
        session = stripe.checkout.Session.create(**session_payload)  # type: ignore[attr-defined]
    except Exception as exc:  # noqa: BLE001
        if reservation_id:
            _release_subscription_coupon_reservation(reservation_id, reason="checkout_create_failed")
        raise HTTPException(status_code=502, detail=f"Failed to create checkout session: {exc}") from exc

    if reservation_id:
        # Keep reservation status reserved; webhook completion finalizes redemption.
        pass
    return JSONResponse(
        {
            "ok": True,
            "url": session.get("url"),
            "sessionId": session.get("id"),
            "couponApplied": bool(reservation_id),
            "couponCode": coupon_code if reservation_id else None,
            "couponReservationId": reservation_id or None,
        }
    )


@app.post("/billing/token-pack/checkout-session")
def billing_token_pack_checkout_session(payload: BillingTokenPackCheckoutSessionRequest, request: Request) -> JSONResponse:
    _require_stripe_ready()
    uid = _require_request_uid(request)
    entitlement = _load_entitlement(uid)
    plan_name = _normalize_plan_name(str(entitlement.get("plan") or "Free"))
    try:
        pack_key = _normalize_token_pack_key(str(payload.pack or "standard"), strict=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    pack_cfg = _token_pack_config(pack_key)
    pack_vf = _token_pack_vf_for_pack(pack_key)
    standard_amount_inr = max(1, int(pack_cfg.get("priceInr") or 1))
    final_amount_inr = _token_pack_amount_inr_for_plan(plan_name, pack_key)
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
                        "product_data": {"name": f"VoiceFlow {pack_vf:,} paid VF pack ({pack_key})"},
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
                "packKey": pack_key,
                "packVf": str(pack_vf),
                "standardAmountInr": str(standard_amount_inr),
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
            "packKey": pack_key,
            "packVf": pack_vf,
            "standardAmountInr": standard_amount_inr,
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
    if VF_IS_PRODUCTION and not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Stripe webhook secret is required in production.")
    try:
        if STRIPE_WEBHOOK_SECRET:
            event = stripe.Webhook.construct_event(  # type: ignore[attr-defined]
                payload=payload_raw,
                sig_header=signature,
                secret=STRIPE_WEBHOOK_SECRET,
            )
        else:
            if not VF_STRIPE_WEBHOOK_ALLOW_UNSIGNED:
                raise HTTPException(status_code=400, detail="Unsigned Stripe webhook payload is not allowed.")
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
                    raw_pack_key = str(metadata.get("packKey") or "standard")
                    pack_key = _normalize_token_pack_key(raw_pack_key)
                    pack_vf = _as_positive_int(metadata.get("packVf") or _token_pack_vf_for_pack(pack_key) or VF_TOKEN_PACK_VF_AMOUNT)
                    standard_amount_inr = _as_positive_int(
                        metadata.get("standardAmountInr")
                        or (_token_pack_config(pack_key).get("priceInr") if pack_key in TOKEN_PACK_CATALOG else 0)
                    )
                    final_amount_inr = _as_positive_int(metadata.get("finalAmountInr"))
                    tx_id = f"stripe_checkout_token_pack_{session_id}" if session_id else ""
                    _credit_paid_vf(
                        uid=uid,
                        amount=pack_vf,
                        reason="stripe_token_pack",
                        transaction_id=tx_id or None,
                        metadata={
                            "eventType": event_type,
                            "sessionId": session_id,
                            "packKey": pack_key,
                            "packVf": pack_vf,
                            "standardAmountInr": standard_amount_inr,
                            "finalAmountInr": final_amount_inr,
                            "amountTotal": _as_positive_int(data_obj.get("amount_total")),
                            "currency": str(data_obj.get("currency") or "inr"),
                        },
                    )
            else:
                uid = str(metadata.get("uid") or "")
                customer_id = str(data_obj.get("customer") or "")
                subscription_id = str(data_obj.get("subscription") or "")
                billing_country = ((data_obj.get("customer_details") or {}).get("address") or {}).get("country")
                session_id = str(data_obj.get("id") or "")
                plan_token = _plan_key_from_name(str(metadata.get("plan") or "free"))
                coupon_reservation_id = str(metadata.get("couponReservationId") or "").strip()
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
                    if subscription_id:
                        _ = _ensure_subscription_schedule_for_loyalty(
                            subscription_id=subscription_id,
                            plan_key=plan_token,
                            uid=uid,
                        )
                    if coupon_reservation_id:
                        _finalize_subscription_coupon_redemption(
                            session_id=session_id,
                            reservation_id=coupon_reservation_id,
                            uid=uid,
                        )
                    coupon_code = _normalize_coupon_code(str(metadata.get("couponCode") or ""))
                    if coupon_code:
                        gross_amount = max(0.0, _safe_float(data_obj.get("amount_subtotal"), 0.0) / 100.0)
                        net_amount = max(0.0, _safe_float(data_obj.get("amount_total"), 0.0) / 100.0)
                        discount_amount = max(0.0, gross_amount - net_amount)
                        coupon_kind = str(metadata.get("couponType") or COUPON_TYPE_SUBSCRIPTION_DISCOUNT)
                        _analytics_record_coupon_event(
                            "checkout_completed",
                            BILLING_PROVIDER_STRIPE,
                            coupon_code,
                            coupon_kind,
                            plan_token,
                            amounts={
                                "grossAmount": gross_amount,
                                "discountAmount": discount_amount,
                                "netAmount": net_amount,
                            },
                            metadata={"sessionId": session_id, "uid": uid},
                        )
                        _analytics_record_coupon_event(
                            "subscription_activated",
                            BILLING_PROVIDER_STRIPE,
                            coupon_code,
                            coupon_kind,
                            plan_token,
                            metadata={"subscriptionId": subscription_id, "uid": uid},
                        )
                        if subscription_id:
                            _analytics_write_subscription_attribution(
                                subscription_id,
                                {
                                    "subscriptionId": subscription_id,
                                    "couponCode": coupon_code,
                                    "couponKind": coupon_kind,
                                    "plan": plan_token,
                                    "provider": BILLING_PROVIDER_STRIPE,
                                    "activatedAt": _utc_now().isoformat(),
                                    "uid": uid,
                                },
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
            cancelled = event_type == "customer.subscription.deleted" or subscription_status in {"canceled", "cancelled"}
            if cancelled:
                subscription_id = str(data_obj.get("id") or "")
                attribution = _analytics_read_subscription_attribution(subscription_id)
                if isinstance(attribution, dict):
                    activated_at = _parse_optional_datetime(str(attribution.get("activatedAt") or ""))
                    within_30d = bool(activated_at and (_utc_now() - activated_at) <= timedelta(days=30))
                    if within_30d:
                        _analytics_record_coupon_event(
                            "cancellation_within_30d",
                            str(attribution.get("provider") or BILLING_PROVIDER_STRIPE),
                            str(attribution.get("couponCode") or ""),
                            str(attribution.get("couponKind") or COUPON_TYPE_SUBSCRIPTION_DISCOUNT),
                            str(attribution.get("plan") or ""),
                            metadata={"subscriptionId": subscription_id, "uid": uid},
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
        elif event_type in {"checkout.session.expired", "checkout.session.async_payment_failed"}:
            metadata = data_obj.get("metadata") if isinstance(data_obj.get("metadata"), dict) else {}
            reservation_id = str(metadata.get("couponReservationId") or "").strip()
            if reservation_id:
                _release_subscription_coupon_reservation(
                    reservation_id,
                    reason="checkout_session_expired" if event_type == "checkout.session.expired" else "checkout_payment_failed",
                )
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
    if _is_gem_runtime_engine(engine) and safe_status >= 500:
        if _is_gemini_upstream_timeout_error(detail):
            return 504
        if _is_gemini_capacity_pressure_error(detail):
            return 503
    return safe_status


def _is_retryable_runtime_failure(engine: str, status_code: int, detail: Any) -> bool:
    safe_status = int(status_code)
    if safe_status in {429, 500, 502, 503, 504}:
        return True
    if _is_gem_runtime_engine(engine):
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
    # Never forward browser-provided API keys through the gateway payload.
    upstream_payload.pop("apiKey", None)
    upstream_payload.pop("api_key", None)
    upstream_payload["engine"] = engine
    upstream_payload["text"] = text
    upstream_payload.setdefault("trace_id", trace_id)
    upstream_payload.setdefault("request_id", request_id)

    requested_voice_id = str(payload.voice_id or payload.voiceId or "").strip()
    requested_voice_name = str(payload.voiceName or "").strip()
    voice_id, voice_name, allowlist_gated = _sanitize_tts_voice_selection_for_plan(
        engine=engine,
        plan_key=plan_key,
        voice_id=requested_voice_id,
        voice_name=requested_voice_name,
    )
    if voice_id:
        upstream_payload["voice_id"] = voice_id
        upstream_payload["voiceId"] = voice_id
    if voice_name:
        upstream_payload["voiceName"] = voice_name

    if _is_gem_runtime_engine(engine):
        if not upstream_payload.get("voiceName"):
            upstream_payload["voiceName"] = _resolve_gem_runtime_voice_name(voice_id or requested_voice_name or "Fenrir")
        # Keep GEM runtime payload fully normalized to runtime voice names.
        gem_voice_name = _resolve_gem_runtime_voice_name(str(upstream_payload.get("voiceName") or voice_id or "Fenrir"))
        upstream_payload["voiceName"] = gem_voice_name
        upstream_payload["voice_id"] = gem_voice_name
        upstream_payload["voiceId"] = gem_voice_name
        voice_id = gem_voice_name
        if allowlist_gated:
            upstream_payload["voicePolicy"] = "free_allowlist_applied"
        pools_config, _ = _load_gemini_api_pools()
        upstream_payload["poolHint"] = resolve_gemini_plan_pool_hint(
            pools_config,
            _tts_pool_hint_plan_key(plan_key),
        )
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
    token = _plan_key_from_name(plan_key)
    if token == "scale":
        return normalize_lane("pro_plus")
    if token in {"pro", "starter", "creator"}:
        return normalize_lane("pro")
    return normalize_lane("free")


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


def _record_tts_live_chunk_llvc_latency(*, elapsed_ms: int) -> None:
    safe_elapsed = max(0, int(elapsed_ms))
    with _TTS_ENGINE_METRICS_LOCK:
        source = _TTS_QUEUE_TELEMETRY.get("liveChunkLlvcLatencyMs")
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
        live_chunk_llvc_samples = [max(0, int(value)) for value in list(_TTS_QUEUE_TELEMETRY.get("liveChunkLlvcLatencyMs") or [])]
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
            "liveChunkLlvcLatencyMs": _sample_stats(live_chunk_llvc_samples),
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


def _post_tts_conversion_failure_detail(
    *,
    exc: Exception,
    trace_id: str,
    job_id: str,
    chunk_index: Optional[int] = None,
) -> dict[str, Any]:
    safe_job_id = str(job_id or "").strip()
    safe_trace_id = str(trace_id or "").strip() or safe_job_id
    payload: dict[str, Any] = {
        "error": f"Post-TTS conversion failed: {exc}",
        "errorCode": ENGINE_OVERLOADED,
        "reason": "post_tts_conversion_failed",
        "trace_id": safe_trace_id,
        "jobId": safe_job_id,
    }
    if chunk_index is not None:
        payload["chunkIndex"] = int(chunk_index)
    return payload


def _normalize_llvc_preset(value: str) -> str:
    token = str(value or "").strip().lower()
    if token in {"llvc_hq_cpu", "cover_hq", "cover", "hq"}:
        return "llvc_hq_cpu"
    if token in {"tts_realtime", "live"}:
        return "tts_realtime"
    return VF_LLVC_PRESET_DEFAULT


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
        for part in re.split(r"(?:\n+|(?<=[.!??])\s+)", normalized_text)
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


def _tts_result_file_path(job_id: str, media_type: str) -> Path:
    safe_job_id = re.sub(r"[^a-zA-Z0-9_.-]+", "_", str(job_id or "").strip()) or "unknown_job"
    token = str(media_type or "").strip().lower()
    extension = ".wav" if "wav" in token else ".bin"
    return TTS_RESULT_ARTIFACTS_DIR / f"{safe_job_id}{extension}"


def _persist_tts_result_audio(job_id: str, audio_bytes: bytes, media_type: str) -> dict[str, Any]:
    content = bytes(audio_bytes or b"")
    path = _tts_result_file_path(job_id, media_type)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return {
        "kind": "file",
        "path": str(path.resolve()),
        "sizeBytes": len(content),
    }


def _resolve_tts_result_audio_bytes(result: dict[str, Any]) -> bytes:
    audio_base64 = str(result.get("audioBase64") or "").strip()
    if audio_base64:
        try:
            return base64.b64decode(audio_base64.encode("ascii"), validate=False)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"Failed to decode TTS job audio payload: {exc}") from exc

    audio_ref = result.get("audioRef") if isinstance(result.get("audioRef"), dict) else {}
    path = Path(str(audio_ref.get("path") or "")).resolve()
    if path.exists() and path.is_file():
        try:
            return path.read_bytes()
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"Failed to read TTS job audio payload: {exc}") from exc
    return b""


def _cleanup_tts_result_artifact(job_id: str) -> None:
    safe_job_id = re.sub(r"[^a-zA-Z0-9_.-]+", "_", str(job_id or "").strip())
    if not safe_job_id:
        return
    for ext in (".wav", ".bin"):
        _cleanup_paths(str(TTS_RESULT_ARTIFACTS_DIR / f"{safe_job_id}{ext}"))


def _cleanup_expired_tts_result_artifacts() -> None:
    now_ms = int(time.time() * 1000)
    ttl_ms = max(60_000, int(VF_TTS_QUEUE_RESULT_TTL_MS))
    if not TTS_RESULT_ARTIFACTS_DIR.exists():
        return
    for child in list(TTS_RESULT_ARTIFACTS_DIR.iterdir()):
        if not child.is_file():
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


def _dubbing_live_job_dir(job_id: str) -> Path:
    safe_job_id = re.sub(r"[^a-zA-Z0-9_.-]+", "_", str(job_id or "").strip()) or "unknown_job"
    return DUBBING_LIVE_ARTIFACTS_DIR / safe_job_id


def _persist_dubbing_live_chunk(job_id: str, index: int, wav_bytes: bytes, meta: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    safe_index = max(0, int(index))
    job_dir = _dubbing_live_job_dir(job_id)
    job_dir.mkdir(parents=True, exist_ok=True)
    path = job_dir / f"chunk_{safe_index:04d}.wav"
    content = bytes(wav_bytes or b"")
    path.write_bytes(content)
    wav_info = _read_wav_info(content)
    return {
        "index": safe_index,
        "contentType": str((meta or {}).get("contentType") or "audio/wav"),
        "durationMs": int(wav_info.get("durationMs") or 0),
        "sampleRate": int(wav_info.get("sampleRate") or 0),
        "speakerId": str((meta or {}).get("speakerId") or "SPEAKER_00"),
        "engine": str((meta or {}).get("engine") or ""),
        "voiceId": str((meta or {}).get("voiceId") or ""),
        "textChars": int((meta or {}).get("textChars") or 0),
        "path": str(path),
        "sizeBytes": len(content),
    }


def _cleanup_dubbing_live_artifacts(job_id: str) -> None:
    safe_job_id = str(job_id or "").strip()
    if not safe_job_id:
        return
    job_dir = _dubbing_live_job_dir(safe_job_id)
    if not job_dir.exists():
        return
    _cleanup_paths(str(job_dir))


def _cleanup_expired_dubbing_live_artifacts() -> None:
    now_ms = int(time.time() * 1000)
    ttl_ms = max(60_000, int(VF_DUB_LIVE_ARTIFACT_TTL_MS))
    if not DUBBING_LIVE_ARTIFACTS_DIR.exists():
        return
    for child in list(DUBBING_LIVE_ARTIFACTS_DIR.iterdir()):
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


def _load_dubbing_live_chunks_from_artifacts(job_id: str) -> list[dict[str, Any]]:
    safe_job_id = str(job_id or "").strip()
    if not safe_job_id:
        return []
    job_dir = _dubbing_live_job_dir(safe_job_id)
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
            size_bytes = len(data)
        except Exception:
            wav_info = {"durationMs": 0, "sampleRate": 0}
            size_bytes = 0
        out.append(
            {
                "index": int(index),
                "contentType": "audio/wav",
                "durationMs": int(wav_info.get("durationMs") or 0),
                "sampleRate": int(wav_info.get("sampleRate") or 0),
                "speakerId": "SPEAKER_00",
                "engine": "",
                "voiceId": "",
                "textChars": 0,
                "path": str(child.resolve()),
                "sizeBytes": size_bytes,
            }
        )
    out.sort(key=lambda item: int(item.get("index") or 0))
    return out


def _resolve_dubbing_job_chunk(job: dict[str, Any], chunk_index: int) -> Optional[dict[str, Any]]:
    safe_index = max(0, int(chunk_index))
    source_chunks = [
        item
        for item in list(job.get("liveChunks") or [])
        if isinstance(item, dict)
    ]
    if not source_chunks:
        source_chunks = _load_dubbing_live_chunks_from_artifacts(str(job.get("id") or ""))
    for item in source_chunks:
        try:
            raw_index = item.get("index")
            if raw_index is None:
                continue
            if int(raw_index) == safe_index:
                return dict(item)
        except Exception:
            continue
    return None


def _resolve_tts_job_chunk(job: dict[str, Any], chunk_index: int) -> Optional[dict[str, Any]]:
    safe_index = max(0, int(chunk_index))
    live_state = job.get("liveState") if isinstance(job.get("liveState"), dict) else {}
    source_chunks = [
        item
        for item in list((live_state or {}).get("chunks") or [])
        if isinstance(item, dict)
    ]
    if not source_chunks:
        source_chunks = _load_live_chunks_from_artifacts(
            str(job.get("jobId") or ""),
            engine=_safe_tts_engine_name(str(job.get("engine") or "GEM")),
            trace_id=str(job.get("traceId") or ""),
        )
    for item in source_chunks:
        try:
            raw_index = item.get("index")
            if raw_index is None:
                continue
            if int(raw_index) == safe_index:
                return dict(item)
        except Exception:
            continue
    return None


def _convert_tts_audio_with_llvc_runtime(
    *,
    audio_bytes: bytes,
    engine: str,
    voice_id: str,
    voice_name: str,
) -> tuple[bytes, dict[str, str]]:
    safe_engine = _normalize_engine_name(engine)
    requested_token = str(voice_name or voice_id or "").strip()
    resolved_voice_token = requested_token
    if _is_gem_runtime_engine(safe_engine):
        resolved_voice_token = _resolve_gem_runtime_voice_name(requested_token, fallback="Fenrir")
    model_name, profile_id = _resolve_mapped_model_name(
        safe_engine,
        resolved_voice_token or voice_id,
        voice_name=resolved_voice_token or voice_name,
    )
    if not model_name:
        model_name, profile_id = _resolve_mapped_model_name(
            safe_engine,
            voice_id,
            voice_name=voice_name,
        )
    if not model_name:
        raise RuntimeError(f"No mapped LLVC model for {safe_engine}:{resolved_voice_token or voice_id or voice_name}.")
    profile = _resolve_mapped_profile(
        safe_engine,
        resolved_voice_token or voice_id,
        voice_name=resolved_voice_token or voice_name,
    )
    if not isinstance(profile, dict):
        profile = _resolve_mapped_profile(safe_engine, voice_id, voice_name=voice_name)
    profile_pitch_shift = _post_tts_llvc_pitch_shift_for_profile(profile)
    llvc_runtime_url = _next_llvc_runtime_url()

    temp_dir = tempfile.mkdtemp(prefix="vf_tts_post_llvc_")
    input_path = Path(temp_dir) / "tts_input.wav"
    output_headers: dict[str, str] = {
        "x-vf-post-tts-profile": str(profile_id or ""),
        "x-vf-post-tts-model": str(model_name),
        "x-vf-post-tts-pitch-shift": str(int(profile_pitch_shift)),
        "x-vf-post-tts-age-group": str(profile.get("ageGroup") or "") if isinstance(profile, dict) else "",
        "x-vf-post-tts-gender": str(profile.get("gender") or "") if isinstance(profile, dict) else "",
        "x-vf-post-tts-voice-token": str(resolved_voice_token or voice_id or voice_name),
        "x-vf-post-tts-engine": str(safe_engine),
        "x-vf-post-tts-llvc-endpoint": str(llvc_runtime_url),
    }
    try:
        input_path.write_bytes(audio_bytes)
        with input_path.open("rb") as handle:
            acquired = _TTS_LIVE_LLVC_SEMAPHORE.acquire(timeout=max(1.0, float(VF_TTS_POST_LLVC_TIMEOUT_SEC)))
            if not acquired:
                raise RuntimeError("LLVC conversion queue timeout.")
            try:
                response = requests.post(
                    f"{llvc_runtime_url}/v1/convert",
                    files={"file": ("tts_input.wav", handle, "audio/wav")},
                    data={
                        "model_name": str(model_name),
                        "preset": _normalize_llvc_preset(VF_TTS_POST_LLVC_PRESET),
                        "pitch_shift": str(int(profile_pitch_shift)),
                    },
                    timeout=VF_TTS_POST_LLVC_TIMEOUT_SEC,
                )
            finally:
                _TTS_LIVE_LLVC_SEMAPHORE.release()
        if not response.ok:
            detail = response.text[:260] if response.text else f"HTTP {response.status_code}"
            raise RuntimeError(f"LLVC runtime conversion failed: {detail}")
        output_headers["x-vf-post-tts-conversion"] = "llvc"
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
            first_chunk_chars = _safe_bounded_int(
                current.get("liveFirstChunkChars"),
                default=min(chunk_chars, VF_TTS_LIVE_FIRST_CHUNK_CHARS),
                min_value=120,
                max_value=chunk_chars,
            )
            first_chunk_words = _safe_bounded_int(
                current.get("liveFirstChunkWords"),
                default=min(chunk_words, VF_TTS_LIVE_FIRST_CHUNK_WORDS),
                min_value=24,
                max_value=chunk_words,
            )
            has_explicit_line_map = isinstance(upstream_payload.get("multi_speaker_line_map"), list) and bool(
                list(upstream_payload.get("multi_speaker_line_map") or [])
            )
            live_chunks: list[dict[str, Any]] = []
            if (
                not has_explicit_line_map
                and first_chunk_chars < chunk_chars
                and first_chunk_words < chunk_words
                and str(text or "").strip()
            ):
                fast_first = _split_plain_text_live_chunks(
                    text,
                    max_chars=first_chunk_chars,
                    max_words=first_chunk_words,
                )
                if fast_first:
                    first_chunk = dict(fast_first[0])
                    remaining_text = " ".join(
                        str(item.get("text") or "").strip()
                        for item in fast_first[1:]
                        if str(item.get("text") or "").strip()
                    ).strip()
                    remaining_chunks = _split_plain_text_live_chunks(
                        remaining_text,
                        max_chars=chunk_chars,
                        max_words=chunk_words,
                    ) if remaining_text else []
                    live_chunks = [first_chunk, *remaining_chunks]
            if not live_chunks:
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
            elif not VF_TTS_POST_LLVC_ENABLED:
                post_conversion_headers["x-vf-post-tts-conversion"] = "disabled"

            live_started_ms = int(time.time() * 1000)
            first_chunk_recorded = False
            response_trace_id = ""
            diagnostics_header = ""
            media_type = "audio/wav"

            pipeline_enabled = (
                VF_TTS_LIVE_PIPELINE_ENABLED
                and len(live_chunks) > 1
                and (VF_TTS_LIVE_SYNTH_CONCURRENCY > 1 or VF_TTS_LIVE_LLVC_CONCURRENCY > 1)
            )
            synth_concurrency = max(1, min(int(VF_TTS_LIVE_SYNTH_CONCURRENCY), len(live_chunks)))
            llvc_concurrency = max(1, min(int(VF_TTS_LIVE_LLVC_CONCURRENCY), len(live_chunks)))
            live_chunks_state = list(live_state.get("chunks") or [])

            def _live_job_cancelled() -> bool:
                latest = _TTS_JOB_QUEUE.get(job_id)
                if not isinstance(latest, dict):
                    return False
                latest_status = str(latest.get("status") or "").strip().lower()
                return latest_status == "cancelled"

            def _mark_live_cancelled() -> None:
                _record_tts_terminal_event(
                    job_id=job_id,
                    engine=safe_engine,
                    status="cancelled",
                    reason="cancelled_by_user",
                    status_code=409,
                )

            def _mark_live_failed(*, status_code: int, detail: Any, error_tag: str) -> None:
                _mark_job_failed_and_revert_usage(
                    job_id=job_id,
                    uid=uid,
                    request_id=request_id,
                    status_code=int(status_code),
                    detail=detail,
                    error_tag=error_tag,
                )

            def _synthesize_live_chunk(chunk_index: int, chunk: dict[str, Any]) -> dict[str, Any]:
                if _live_job_cancelled():
                    return {"ok": False, "cancelled": True, "index": int(chunk_index)}
                chunk_payload = _build_live_chunk_upstream_payload(
                    engine=engine,
                    base_payload=upstream_payload,
                    chunk=chunk,
                )
                chunk_started_ms = int(time.time() * 1000)
                try:
                    runtime_chunk_response = _runtime_http_request(
                        "POST",
                        upstream_url,
                        json=chunk_payload,
                        timeout=VF_TTS_RUNTIME_TIMEOUT_SEC,
                    )
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
                    return {
                        "ok": False,
                        "index": int(chunk_index),
                        "status_code": 502,
                        "error_tag": f"runtime_unreachable:{exc}",
                        "detail": {
                            "error": f"TTS runtime is unreachable during live chunk synthesis: {exc}",
                            "errorCode": ENGINE_OVERLOADED,
                            "reason": "runtime_unreachable",
                            "trace_id": trace_id,
                            "jobId": job_id,
                            "chunkIndex": int(chunk_index),
                        },
                    }

                chunk_elapsed = max(0, int(time.time() * 1000) - chunk_started_ms)
                _record_tts_runtime_latency(engine=safe_engine, elapsed_ms=chunk_elapsed)
                _admin_usage_record_runtime_call(
                    engine=engine,
                    endpoint=runtime_path,
                    method="POST",
                    status_code=int(runtime_chunk_response.status_code),
                    elapsed_ms=chunk_elapsed,
                )
                if not runtime_chunk_response.ok:
                    detail = _decode_runtime_error_detail(runtime_chunk_response)
                    mapped_status = _map_runtime_failure_status(engine, int(runtime_chunk_response.status_code), detail)
                    response_trace = str(runtime_chunk_response.headers.get("x-voiceflow-trace-id") or "").strip()
                    if isinstance(detail, dict) and response_trace and not detail.get("trace_id"):
                        detail = {**detail, "trace_id": response_trace}
                    return {
                        "ok": False,
                        "index": int(chunk_index),
                        "status_code": int(mapped_status),
                        "error_tag": f"runtime_error:{mapped_status}",
                        "detail": detail or "TTS runtime failed.",
                    }

                chunk_audio = bytes(runtime_chunk_response.content or b"")
                if len(chunk_audio) < 100:
                    return {
                        "ok": False,
                        "index": int(chunk_index),
                        "status_code": 502,
                        "error_tag": "runtime_empty_audio",
                        "detail": {
                            "error": "Live chunk synthesis returned empty audio.",
                            "errorCode": ENGINE_OVERLOADED,
                            "reason": "runtime_empty_audio",
                            "trace_id": trace_id,
                            "jobId": job_id,
                            "chunkIndex": int(chunk_index),
                        },
                    }

                return {
                    "ok": True,
                    "index": int(chunk_index),
                    "chunk": dict(chunk),
                    "chunkPayload": chunk_payload,
                    "audio": chunk_audio,
                    "mediaType": str(runtime_chunk_response.headers.get("content-type") or "audio/wav"),
                    "responseTraceId": str(runtime_chunk_response.headers.get("x-voiceflow-trace-id") or "").strip(),
                    "diagnosticsHeader": str(runtime_chunk_response.headers.get("x-voiceflow-diagnostics") or "").strip(),
                }

            def _convert_live_chunk(result: dict[str, Any]) -> dict[str, Any]:
                if not result.get("ok"):
                    return result
                converted_audio = bytes(result.get("audio") or b"")
                conversion_headers: dict[str, str] = {}
                if VF_TTS_POST_LLVC_ENABLED and not post_tts_disable:
                    conversion_started_ms = int(time.time() * 1000)
                    try:
                        llvc_audio, llvc_headers = _convert_tts_audio_with_llvc_runtime(
                            audio_bytes=converted_audio,
                            engine=engine,
                            voice_id=voice_id,
                            voice_name=voice_name or str((result.get("chunkPayload") or {}).get("voiceName") or ""),
                        )
                        conversion_elapsed_ms = max(0, int(time.time() * 1000) - conversion_started_ms)
                        _record_tts_live_chunk_llvc_latency(elapsed_ms=conversion_elapsed_ms)
                        if len(llvc_audio) < 100:
                            raise RuntimeError("Converted live chunk is empty.")
                        converted_audio = llvc_audio
                        conversion_headers.update(llvc_headers)
                    except Exception as exc:
                        conversion_elapsed_ms = max(0, int(time.time() * 1000) - conversion_started_ms)
                        _record_tts_live_chunk_llvc_latency(elapsed_ms=conversion_elapsed_ms)
                        if VF_TTS_POST_LLVC_REQUIRED:
                            return {
                                "ok": False,
                                "index": int(result.get("index") or 0),
                                "status_code": 503,
                                "error_tag": "post_tts_conversion_failed",
                                "detail": _post_tts_conversion_failure_detail(
                                    exc=exc,
                                    trace_id=trace_id,
                                    job_id=job_id,
                                    chunk_index=int(result.get("index") or 0),
                                ),
                            }
                        conversion_headers["x-vf-post-tts-conversion"] = "bypassed_error"
                        conversion_headers["x-vf-post-tts-error"] = str(exc).replace("\n", " ").replace("\r", " ")[:180]
                return {
                    **result,
                    "ok": True,
                    "audio": converted_audio,
                    "conversionHeaders": conversion_headers,
                }

            def _emit_live_chunk(result: dict[str, Any]) -> bool:
                nonlocal live_chunks_state
                nonlocal live_state
                nonlocal response_trace_id
                nonlocal diagnostics_header
                nonlocal media_type
                nonlocal first_chunk_recorded
                if _live_job_cancelled():
                    _mark_live_cancelled()
                    return False
                chunk_index = int(result.get("index") or 0)
                chunk_audio = bytes(result.get("audio") or b"")
                conversion_headers = dict(result.get("conversionHeaders") or {})
                if conversion_headers:
                    post_conversion_headers.update(conversion_headers)
                media_type = str(result.get("mediaType") or media_type or "audio/wav")
                response_trace_id = str(result.get("responseTraceId") or response_trace_id or "").strip()
                diagnostics_header = str(result.get("diagnosticsHeader") or diagnostics_header or "").strip()

                try:
                    chunk_meta = _persist_live_chunk(
                        job_id,
                        chunk_index,
                        chunk_audio,
                        meta={
                            "textChars": int((result.get("chunk") or {}).get("textChars") or len(str((result.get("chunk") or {}).get("text") or ""))),
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
                    _mark_live_failed(
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
                    return False
                live_chunks_state.append(chunk_meta)
                playable_duration_ms = sum(int(item.get("durationMs") or 0) for item in live_chunks_state)
                live_state = {
                    "enabled": True,
                    "playableChunks": len(live_chunks_state),
                    "playableDurationMs": int(playable_duration_ms),
                    "chunkCursorNext": int(chunk_index + 1),
                    "chunks": list(live_chunks_state),
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
                return True

            def _handle_live_result_failure(result: dict[str, Any]) -> bool:
                if bool(result.get("cancelled")):
                    _mark_live_cancelled()
                    return False
                _mark_live_failed(
                    status_code=int(result.get("status_code") or 500),
                    detail=result.get("detail") or {
                        "error": "Live chunk processing failed.",
                        "errorCode": ENGINE_OVERLOADED,
                        "reason": "live_chunk_failed",
                        "trace_id": trace_id,
                        "jobId": job_id,
                    },
                    error_tag=str(result.get("error_tag") or "live_chunk_failed"),
                )
                return False

            if pipeline_enabled:
                ready_by_index: dict[int, dict[str, Any]] = {}
                next_emit_index = 0
                synth_futures: dict[Future[dict[str, Any]], int] = {}
                llvc_futures: dict[Future[dict[str, Any]], int] = {}
                with ThreadPoolExecutor(max_workers=synth_concurrency) as synth_executor, ThreadPoolExecutor(
                    max_workers=llvc_concurrency
                ) as llvc_executor:
                    for chunk_index, chunk in enumerate(live_chunks):
                        synth_future = synth_executor.submit(_synthesize_live_chunk, int(chunk_index), dict(chunk))
                        synth_futures[synth_future] = int(chunk_index)

                    for synth_future in as_completed(list(synth_futures.keys())):
                        try:
                            synth_result = synth_future.result()
                        except Exception as exc:  # noqa: BLE001
                            synth_result = {
                                "ok": False,
                                "status_code": 500,
                                "error_tag": "live_chunk_synth_internal_error",
                                "detail": {
                                    "error": f"Live chunk synth stage failed: {exc}",
                                    "errorCode": ENGINE_OVERLOADED,
                                    "reason": "live_chunk_synth_internal_error",
                                    "trace_id": trace_id,
                                    "jobId": job_id,
                                },
                            }
                        if not bool(synth_result.get("ok")):
                            for pending in synth_futures.keys():
                                pending.cancel()
                            for pending in llvc_futures.keys():
                                pending.cancel()
                            _handle_live_result_failure(synth_result)
                            return
                        llvc_future = llvc_executor.submit(_convert_live_chunk, synth_result)
                        llvc_futures[llvc_future] = int(synth_result.get("index") or 0)

                    for llvc_future in as_completed(list(llvc_futures.keys())):
                        try:
                            converted_result = llvc_future.result()
                        except Exception as exc:  # noqa: BLE001
                            converted_result = {
                                "ok": False,
                                "status_code": 500,
                                "error_tag": "live_chunk_conversion_internal_error",
                                "detail": {
                                    "error": f"Live chunk conversion stage failed: {exc}",
                                    "errorCode": ENGINE_OVERLOADED,
                                    "reason": "live_chunk_conversion_internal_error",
                                    "trace_id": trace_id,
                                    "jobId": job_id,
                                },
                            }
                        if not bool(converted_result.get("ok")):
                            for pending in llvc_futures.keys():
                                pending.cancel()
                            _handle_live_result_failure(converted_result)
                            return

                        converted_index = int(converted_result.get("index") or 0)
                        ready_by_index[converted_index] = converted_result
                        while next_emit_index in ready_by_index:
                            emit_result = ready_by_index.pop(next_emit_index)
                            if not _emit_live_chunk(emit_result):
                                return
                            next_emit_index += 1
            else:
                for chunk_index, chunk in enumerate(live_chunks):
                    synth_result = _synthesize_live_chunk(int(chunk_index), dict(chunk))
                    if not bool(synth_result.get("ok")):
                        _handle_live_result_failure(synth_result)
                        return
                    converted_result = _convert_live_chunk(synth_result)
                    if not bool(converted_result.get("ok")):
                        _handle_live_result_failure(converted_result)
                        return
                    if not _emit_live_chunk(converted_result):
                        return

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
            result_ref = _persist_tts_result_audio(
                job_id,
                synthesized_audio_bytes,
                str(media_type or "audio/wav"),
            )

            _TTS_JOB_QUEUE.mark_completed(
                job_id,
                audio_bytes=synthesized_audio_bytes,
                media_type=str(media_type or "audio/wav"),
                headers=completed_headers,
                result_ref=result_ref,
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
            runtime_response = _runtime_http_request(
                "POST",
                upstream_url,
                json=upstream_payload,
                timeout=VF_TTS_RUNTIME_TIMEOUT_SEC,
            )
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
        if VF_TTS_POST_LLVC_ENABLED and not post_tts_disable:
            try:
                converted_audio_bytes, conversion_headers = _convert_tts_audio_with_llvc_runtime(
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
                if VF_TTS_POST_LLVC_REQUIRED:
                    detail = _post_tts_conversion_failure_detail(
                        exc=exc,
                        trace_id=trace_id,
                        job_id=job_id,
                    )
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
        media_type = str(runtime_response.headers.get("content-type") or "audio/wav")
        result_ref = _persist_tts_result_audio(
            job_id,
            synthesized_audio_bytes,
            media_type,
        )

        _TTS_JOB_QUEUE.mark_completed(
            job_id,
            audio_bytes=synthesized_audio_bytes,
            media_type=media_type,
            headers=completed_headers,
            result_ref=result_ref,
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
    if not VF_TTS_QUEUE_ENABLED or not VF_SERVICE_IS_WORKER or VF_TTS_QUEUE_WORKER_COUNT <= 0:
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
        result = dict(job.get("result") or {}) if isinstance(job.get("result"), dict) else {}
        if result and not str(result.get("audioBase64") or "").strip():
            resolved = _resolve_tts_result_audio_bytes(result)
            if resolved:
                result["audioBase64"] = base64.b64encode(resolved).decode("ascii")
        payload["result"] = result

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
            safe_index = int(item.get("index") or 0)
            chunk_item = {
                "index": safe_index,
                "contentType": str(item.get("contentType") or "audio/wav"),
                "durationMs": int(item.get("durationMs") or 0),
                "textChars": int(item.get("textChars") or 0),
                "engine": str(item.get("engine") or ""),
                "traceId": str(item.get("traceId") or ""),
                "downloadUrl": f"/tts/jobs/{str(job.get('jobId') or '')}/chunks/{safe_index}",
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
    content = _resolve_tts_result_audio_bytes(result)
    if not content:
        raise HTTPException(status_code=500, detail="Completed TTS job is missing audio payload.")

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
    # Enforce one-time userId completion before protected synthesis routes for non-admin users.
    if not admin_limit_bypass:
        _require_user_id_ready(request, uid)
    text = str(payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required.")
    engine = _normalize_engine_name(payload.engine)
    idempotency_key = str(request.headers.get("Idempotency-Key") or "").strip()
    request_id = str(payload.request_id or idempotency_key or uuid.uuid4().hex).strip()
    trace_id = str(payload.trace_id or request_id or uuid.uuid4().hex).strip() or uuid.uuid4().hex

    plan_name, plan_key, _guardrails = _enforce_tts_plan_guardrails(
        uid,
        len(text),
        trace_id,
        engine=engine,
        bypass=admin_limit_bypass,
    )
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
        _cleanup_expired_tts_result_artifacts()

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


@app.get("/tts/jobs/{job_id}/chunks/{chunk_index}")
def tts_job_chunk_download(job_id: str, chunk_index: int, request: Request) -> Response:
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

    chunk_meta = _resolve_tts_job_chunk(job, chunk_index)
    if not isinstance(chunk_meta, dict):
        raise HTTPException(status_code=404, detail="Chunk not found.")

    chunk_path = Path(str(chunk_meta.get("path") or "")).resolve()
    if not chunk_path.exists() or not chunk_path.is_file():
        raise HTTPException(status_code=404, detail="Chunk file not found.")

    media_type = str(chunk_meta.get("contentType") or "audio/wav")
    return FileResponse(
        str(chunk_path),
        media_type=media_type,
        filename=f"{safe_job_id}_chunk_{max(0, int(chunk_index)):04d}.wav",
        headers={"Cache-Control": "no-store"},
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
    _cleanup_tts_result_artifact(safe_job_id)
    _record_tts_terminal_event(
        job_id=safe_job_id,
        engine=str(cancelled.get("engine") or "GEM"),
        status="cancelled",
        reason="cancelled_by_user",
        status_code=409,
    )
    return JSONResponse({"ok": True, "job": _tts_job_status_payload(cancelled, include_result=False)})


@app.get("/models/kokoro/status")
def kokoro_model_status() -> JSONResponse:
    payload = _kokoro_model_status_payload()
    return JSONResponse(payload, headers={"Cache-Control": "no-store"})


@app.get("/models/{model_path:path}")
def serve_local_model_file(model_path: str) -> Response:
    safe_model_path = str(model_path or "").strip().lstrip("/")
    if not safe_model_path:
        raise HTTPException(status_code=404, detail="Model file not found.")
    candidate = (LOCAL_MODEL_MIRROR_ROOT / safe_model_path).resolve()
    try:
        candidate.relative_to(LOCAL_MODEL_MIRROR_ROOT)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=404, detail="Model file not found.") from exc
    if not candidate.exists() or not candidate.is_file():
        raise HTTPException(status_code=404, detail="Model file not found.")
    guessed_media_type = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
    return FileResponse(
        str(candidate),
        media_type=guessed_media_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@app.get("/runtime/logs/tail", response_model=RuntimeLogTailResponse)
def tail_runtime_logs(
    request: Request,
    service: str,
    cursor: Optional[int] = None,
    max_bytes: int = 24_576,
    line_limit: int = 80,
) -> JSONResponse:
    _require_permission(request, PERM_OPS_READ)
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
def switch_tts_engine(payload: SwitchTtsEngineRequest, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_OPS_MUTATE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
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

    response_payload = {
        "ok": True,
        "engine": engine,
        "state": "online" if is_online else "starting",
        "detail": detail if is_online else "Runtime starting in background",
        "healthUrl": health_url,
        "gpuMode": payload.gpu,
        "commandOutput": command_output[-500:],
    }
    _audit_append_event(
        action="tts_engine_switch",
        resource_type="runtime",
        resource_id=engine,
        after={"state": response_payload["state"], "gpuMode": bool(payload.gpu)},
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
    )
    return JSONResponse(response_payload)


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

    # Save uploaded video to temporary file
    temp_dir = tempfile.mkdtemp(prefix="audio_extract_")
    input_path = Path(temp_dir) / _safe_upload_name(file.filename, "video_input.mp4")
    
    try:
        written_bytes = await _write_upload_file_chunked(
            file,
            input_path,
            max_bytes=500 * 1024 * 1024,
        )
        if written_bytes <= 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")
        
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
def prepare_dubbing_services(payload: PrepareDubbingServicesRequest, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_OPS_MUTATE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
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
    response_payload = {
        "ok": overall_ok,
        "services": results,
        "message": message,
        "traceId": trace_id,
    }
    _audit_append_event(
        action="dubbing_prepare_services",
        resource_type="runtime",
        resource_id="dubbing",
        after={"ok": bool(overall_ok), "serviceCount": len(results)},
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
    )
    return JSONResponse(response_payload)


@app.get("/tts/engines/capabilities", response_model=TtsEngineCapabilitiesResponse)
def tts_engines_capabilities() -> JSONResponse:
    payload: dict[str, Any] = {}
    for engine in TTS_ENGINE_KEYS:
        engine_payload = _probe_runtime_capabilities(engine, timeout_sec=3.2)
        engine_payload["displayName"] = _engine_display_name(engine)
        payload[engine] = engine_payload

    conversion_adapters = {
        "LLVC": llvc_adapter,
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
        selected_engines = list(TTS_ENGINE_KEYS)

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
        if _is_gem_runtime_engine(normalized_engine) and isinstance(capability_payload, dict):
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
    if _is_gem_runtime_engine(normalized_engine):
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
            mapped_entry = _apply_mapped_voice_fields("GEM", voice_id, entry)
            normalized.append(_annotate_voice_access_fields(normalized_engine, mapped_entry))
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
        mapped_fallback = _apply_mapped_voice_fields("GEM", "v1", fallback)
        return [_annotate_voice_access_fields(normalized_engine, mapped_fallback)]

    base_url = KOKORO_RUNTIME_URL
    try:
        response = _runtime_http_request("GET", f"{base_url}/v1/voices", timeout=15)
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
                _annotate_voice_access_fields(
                    normalized_engine,
                    _apply_mapped_voice_fields(
                        normalized_engine,
                        voice_id,
                        {
                            "voice_id": voice_id,
                            "name": name,
                            "language": str(voice.get("language") or "unknown"),
                            "gender": str(voice.get("gender") or "unknown"),
                            "source": str(voice.get("source") or "runtime"),
                        },
                    ),
                )
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
        response = _runtime_http_request(
            "POST",
            f"{KOKORO_RUNTIME_URL}/synthesize",
            json=payload,
            timeout=min(VF_TTS_RUNTIME_TIMEOUT_SEC, 120),
        )
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
        response = _runtime_http_request(
            "POST",
            f"{GEMINI_RUNTIME_URL}/synthesize",
            json=payload,
            timeout=min(VF_TTS_RUNTIME_TIMEOUT_SEC, 120),
        )

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


def _load_video_pipeline_asset_sources() -> list[dict[str, Any]]:
    try:
        if not VIDEO_PIPELINE_ASSET_SOURCE_MANIFEST.exists():
            return []
        payload = json.loads(VIDEO_PIPELINE_ASSET_SOURCE_MANIFEST.read_text(encoding="utf-8-sig"))
        rows = payload.get("assets") if isinstance(payload, dict) else []
        if not isinstance(rows, list):
            return []
        output: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            output.append(dict(row))
        return output
    except Exception:
        return []


def _video_pipeline_assets_status() -> dict[str, Any]:
    entries = _load_video_pipeline_asset_sources()
    rows: list[dict[str, Any]] = []
    required_missing: list[str] = []
    optional_missing: list[str] = []

    for entry in entries:
        asset_id = str(entry.get("id") or "").strip()
        output_rel = str(entry.get("outputPath") or "").strip().replace("\\", "/").lstrip("/")
        if not asset_id or not output_rel:
            continue
        required = bool(entry.get("required", True))
        target = (APP_ROOT / output_rel).resolve()
        exists = target.exists()
        row = {
            "id": asset_id,
            "required": required,
            "path": str(target),
            "exists": exists,
        }
        rows.append(row)
        if exists:
            continue
        if required:
            required_missing.append(asset_id)
        else:
            optional_missing.append(asset_id)

    return {
        "manifestPath": str(VIDEO_PIPELINE_ASSET_SOURCE_MANIFEST),
        "downloadManifestPath": str(VIDEO_PIPELINE_ASSET_DOWNLOAD_MANIFEST),
        "requiredMissing": required_missing,
        "optionalMissing": optional_missing,
        "ready": len(required_missing) == 0,
        "assets": rows,
    }


def _extract_phase_error_code(exc: Exception) -> str:
    raw = str(exc or "").strip()
    if not raw.startswith("phase_failed:"):
        return "STAGE_FAILED"
    try:
        _, phase, _reason = raw.split(":", 2)
    except Exception:
        return "STAGE_FAILED"
    token = re.sub(r"[^A-Za-z0-9]+", "_", str(phase or "").strip()).strip("_").upper()
    if not token:
        return "STAGE_FAILED"
    return f"PHASE_FAILED_{token}"


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
    if _is_gem_runtime_engine(engine):
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
    counts: dict[str, int] = {"GEM": 0, "GOOD": 0, "NEURAL2": 0, "KOKORO": 0}
    first_seen = ""
    for request_item in tts_requests:
        raw_engine = str(request_item.get("engine") or "").strip()
        if not raw_engine:
            continue
        try:
            engine = _normalize_engine_name(raw_engine)
        except Exception:
            continue
        if engine not in counts:
            continue
        counts[engine] += 1
        if not first_seen:
            first_seen = engine

    total = sum(counts.values())
    if total <= 0:
        return "GEM"
    max_count = max(counts.values())
    winners = [engine for engine, count in counts.items() if count == max_count]
    if len(winners) > 1 and first_seen:
        return first_seen
    return winners[0] if winners else "GEM"


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
    speaker_stats: dict[str, Any] = {
        "detectedSpeakers": 0,
        "mappedSpeakers": 0,
        "fallbackBindings": [],
        "driftAlerts": [],
    }
    qos_state: dict[str, Any] = {
        "selectedProfile": "cpu_quality",
        "downgraded": False,
        "reason": "",
        "gpuUsed": False,
    }
    clone_scope = "job_only"
    engine_selected = "AUTO_RELIABLE"
    engine_executed = "GEM"
    processing_profile = "cpu_quality"
    multispeaker_policy = "hybrid_auto"
    voice_binding_policy = "stable_fallback"
    qos_policy = "adaptive_hq_first"
    hardware_policy = "gpu_preferred"
    timeout_policy = "adaptive"
    live_play_mode = "off"
    live_chunk_target_ms = 3000
    live_include_chunk_audio = False
    max_speaker_count = 8
    live_enabled = False
    live_chunks_meta: list[dict[str, Any]] = []
    live_next_cursor = 0
    clip_window: dict[str, int] | None = None
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
            pipelineVersion=VF_DUB_PIPELINE_VERSION,
            errorCode=None,
            stageTimeline=stage_timeline,
        )
        _append_dubbing_log(job_id, f"Starting dubbing pipeline {VF_DUB_PIPELINE_VERSION}")

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
                        "pipelineVersion": VF_DUB_PIPELINE_VERSION,
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
                        "speakerStats": speaker_stats,
                        "engineSelected": engine_selected,
                        "engineExecuted": engine_executed,
                        "engineSelectedDisplay": _conversion_policy_display_name(engine_selected),
                        "engineExecutedDisplay": _executed_engine_display_name(engine_executed),
                        "qosState": qos_state,
                        "fallbackUsed": fallback_used,
                        "fallbackReason": fallback_reason,
                        "supportsOneShotCloneAtDecision": supports_one_shot_clone_at_decision,
                        "directorJson": {},
                        "isochronyStats": {},
                        "llvcMetrics": {},
                        "lipsyncMetrics": {},
                        "assets": _video_pipeline_assets_status(),
                        "thinkingPolicy": {},
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
                speakerStats=speaker_stats,
                engineSelected=engine_selected,
                engineExecuted=engine_executed,
                engineSelectedDisplay=_conversion_policy_display_name(engine_selected),
                engineExecutedDisplay=_executed_engine_display_name(engine_executed),
                qosState=qos_state,
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
        multispeaker_policy = _normalize_multispeaker_policy(
            str(advanced.get("multispeaker_policy") or "hybrid_auto"),
            default="hybrid_auto",
        )
        voice_binding_policy = _normalize_voice_binding_policy(
            str(advanced.get("voice_binding_policy") or "stable_fallback"),
            default="stable_fallback",
        )
        qos_policy = _normalize_qos_policy(
            str(advanced.get("qos_policy") or "adaptive_hq_first"),
            default="adaptive_hq_first",
        )
        hardware_policy = _normalize_hardware_policy(
            str(advanced.get("hardware_policy") or "gpu_preferred"),
            default="gpu_preferred",
        )
        timeout_policy = _normalize_timeout_policy(
            str(advanced.get("timeout_policy") or "adaptive"),
            default="adaptive",
        )
        live_play_mode = _normalize_live_play_mode(
            str(advanced.get("live_play_mode") or "progressive_audio"),
            default="progressive_audio",
        )
        live_chunk_target_ms = _safe_bounded_int(
            advanced.get("live_chunk_target_ms"),
            default=3000,
            min_value=600,
            max_value=12000,
        )
        live_include_chunk_audio = bool(advanced.get("live_include_chunk_audio"))
        max_speaker_count = _safe_bounded_int(
            advanced.get("max_speaker_count"),
            default=8,
            min_value=1,
            max_value=16,
        )
        live_enabled = bool(VF_DUB_LIVE_PLAY_ENABLED and live_play_mode == "progressive_audio")
        segment_failure_policy = str(advanced.get("segment_failure_policy") or "hard_fail").strip().lower()
        clone_scope = str(advanced.get("clone_scope") or "job_only").strip().lower()
        transcript_override = str(advanced.get("transcript_override") or "").strip()
        processing_profile = _normalize_dubbing_processing_profile(
            str(advanced.get("processing_profile") or "cpu_quality"),
            default="cpu_quality",
        )
        processing_profile, qos_state, profile_overrides = _select_dubbing_qos_state(
            requested_profile=processing_profile,
            qos_policy=qos_policy,
            hardware_policy=hardware_policy,
            transcript_override=transcript_override,
        )
        clip_window = _normalize_dubbing_clip_window(advanced.get("clip_window"))
        _ = clone_scope
        clone_required = clone_scope == "job_only" or bool(input_voice_map)
        _ = clone_required
        supports_one_shot_clone_at_decision = False

        _cleanup_expired_dubbing_live_artifacts()
        _cleanup_dubbing_live_artifacts(job_id)
        _update_dubbing_job(
            job_id,
            qosState=qos_state,
            live={
                "enabled": live_enabled,
                "mode": live_play_mode if live_enabled else "off",
                "playableChunks": 0,
                "playableDurationMs": 0,
            },
            chunkCursorNext=0,
            liveChunks=[],
        )

        pipeline_source_path = source_path
        if clip_window is not None:
            clipped_suffix = source_path.suffix if source_path.suffix else ".mp4"
            clipped_path = job_dir / f"source_clip_{int(clip_window['start_ms'])}_{int(clip_window['end_ms'])}{clipped_suffix}"
            pipeline_source_path = _trim_media_to_clip_window(
                source_path,
                clipped_path,
                start_ms=int(clip_window["start_ms"]),
                end_ms=int(clip_window["end_ms"]),
            )
            _append_dubbing_log(
                job_id,
                f"Applied clip window start_ms={clip_window['start_ms']} end_ms={clip_window['end_ms']}",
            )

        stage_map = {
            "acoustic_isolation": ("acoustic_isolation", 12),
            "director": ("director", 28),
            "isochrony_translation": ("isochrony_translation", 44),
            "base_tts": ("base_tts", 62),
            "llvc_timbre_transfer": ("llvc_timbre_transfer", 80),
            "visual_lipsync": ("visual_lipsync", 96),
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
            preferred_seed = input_voice_map if input_voice_map else initial
            resolved_map, routed = _auto_route_dubbing_voices(
                preferred_map=preferred_seed if isinstance(preferred_seed, dict) else {},
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
                chosen_voice = str(resolved_map.get(speaker) or resolved_map.get("default") or "").strip()
                if chosen_voice:
                    seg["voice_id"] = chosen_voice
            selected_routes[:] = routed
            speaker_stats["mappedSpeakers"] = len([speaker for speaker in speakers if speaker in resolved_map])
            return resolved_map

        def _pipeline_live_chunk(chunk: dict[str, Any]) -> None:
            nonlocal live_next_cursor
            if not live_enabled:
                return
            if _is_job_cancelled(job_id):
                return
            if not isinstance(chunk, dict):
                return
            chunk_bytes = bytes(chunk.get("audio_bytes") or b"")
            if not chunk_bytes:
                return
            chunk_index = int(chunk.get("index") or live_next_cursor)
            safe_speaker = str(chunk.get("speaker") or "SPEAKER_00")
            safe_engine = str(chunk.get("engine") or "")
            safe_voice = str(chunk.get("voice_id") or "")
            text_chars = int(chunk.get("text_chars") or 0)
            persisted = _persist_dubbing_live_chunk(
                job_id,
                chunk_index,
                chunk_bytes,
                meta={
                    "speakerId": safe_speaker,
                    "engine": safe_engine,
                    "voiceId": safe_voice,
                    "textChars": text_chars,
                    "contentType": str(chunk.get("content_type") or "audio/wav"),
                },
            )
            existing_indexes = {
                int(item.get("index"))
                for item in live_chunks_meta
                if isinstance(item, dict) and item.get("index") is not None
            }
            persisted_index = int(persisted.get("index")) if persisted.get("index") is not None else -1
            if persisted_index in existing_indexes:
                live_chunks_meta[:] = [
                    item
                    for item in live_chunks_meta
                    if (int(item.get("index")) if item.get("index") is not None else -1) != persisted_index
                ]
            live_chunks_meta.append(persisted)
            live_chunks_meta.sort(key=lambda item: int(item.get("index") or 0))
            live_next_cursor = max(live_next_cursor, int(persisted.get("index") or 0) + 1)
            playable_duration_ms = sum(int(item.get("durationMs") or 0) for item in live_chunks_meta)
            _update_dubbing_job(
                job_id,
                live={
                    "enabled": True,
                    "mode": live_play_mode,
                    "playableChunks": len(live_chunks_meta),
                    "playableDurationMs": int(playable_duration_ms),
                    "chunkCursorNext": int(live_next_cursor),
                },
                chunkCursorNext=int(live_next_cursor),
                liveChunks=list(live_chunks_meta),
            )

        result = run_pipeline(
            source_path=pipeline_source_path,
            output_dir=job_dir,
            target_language=target_language,
            tts_route=tts_route,
            voice_map=input_voice_map,
            strict=VF_DUB_STRICT_CORE_PHASES,
            transcript_override=transcript_override,
            config_overrides=profile_overrides,
            voice_map_resolver=_resolve_voice_map,
            runtime_options={
                "multispeaker_policy": multispeaker_policy,
                "voice_binding_policy": voice_binding_policy,
                "qos_policy": qos_policy,
                "hardware_policy": hardware_policy,
                "timeout_policy": timeout_policy,
                "live_play_mode": live_play_mode if live_enabled else "off",
                "live_chunk_target_ms": live_chunk_target_ms,
                "max_speaker_count": max_speaker_count,
                "live_chunk_callback": _pipeline_live_chunk if live_enabled else None,
            },
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
        fallback_bindings = list(result.get("speaker_fallback_bindings") or [])
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

        speaker_voice_history: dict[str, set[str]] = {}
        for req in tts_requests:
            speaker = str(req.get("speaker") or "SPEAKER_00")
            voice_id = str(req.get("voice_id") or "").strip()
            if not voice_id:
                continue
            values = speaker_voice_history.setdefault(speaker, set())
            values.add(voice_id)
        drift_alerts: list[dict[str, Any]] = []
        for speaker, voices in speaker_voice_history.items():
            if len(voices) <= 1:
                continue
            drift_alerts.append(
                {
                    "speaker": speaker,
                    "voiceIds": sorted(voices),
                    "reason": "multi_voice_detected",
                }
            )
        speaker_stats = {
            "detectedSpeakers": len(speakers),
            "mappedSpeakers": max(
                int(speaker_stats.get("mappedSpeakers") or 0),
                len(
                    [
                        speaker
                        for speaker in speakers
                        if str(
                            (
                                result.get("voice_map_resolved")
                                if isinstance(result.get("voice_map_resolved"), dict)
                                else {}
                            ).get(speaker)
                            or ""
                        ).strip()
                    ]
                ),
            ),
            "fallbackBindings": fallback_bindings,
            "driftAlerts": drift_alerts,
        }
        fallback_used = fallback_used or bool(fallback_bindings)
        if fallback_used and not fallback_reason:
            fallback_reason = "speaker_binding_fallback"

        if synthesis_failures and segment_failure_policy == "hard_fail":
            raise RuntimeError(f"tts_segment_failures:{len(synthesis_failures)}")

        director_json = dict(result.get("director_json") or {})
        isochrony_stats = dict(result.get("isochrony_stats") or {})
        llvc_metrics = dict(result.get("llvc_metrics") or {})
        lipsync_metrics = dict(result.get("lipsync_metrics") or {})
        assets_payload = dict(result.get("assets") or _video_pipeline_assets_status())
        thinking_policy = dict(result.get("thinking_policy") or {})
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
            "pipelineVersion": VF_DUB_PIPELINE_VERSION,
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
            "speakerStats": speaker_stats,
            "engineSelected": engine_selected,
            "engineExecuted": engine_executed,
            "engineSelectedDisplay": _conversion_policy_display_name(engine_selected),
            "engineExecutedDisplay": _executed_engine_display_name(engine_executed),
            "processingProfile": processing_profile,
            "clipWindow": clip_window,
            "qosState": qos_state,
            "live": {
                "enabled": bool(live_enabled),
                "mode": live_play_mode if live_enabled else "off",
                "playableChunks": len(live_chunks_meta),
                "playableDurationMs": int(sum(int(item.get("durationMs") or 0) for item in live_chunks_meta)),
                "chunkCursorNext": int(live_next_cursor),
            },
            "fallbackUsed": fallback_used,
            "fallbackReason": fallback_reason,
            "supportsOneShotCloneAtDecision": supports_one_shot_clone_at_decision,
            "directorJson": director_json,
            "isochronyStats": isochrony_stats,
            "llvcMetrics": llvc_metrics,
            "lipsyncMetrics": lipsync_metrics,
            "assets": assets_payload,
            "thinkingPolicy": thinking_policy,
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
            pipelineVersion=VF_DUB_PIPELINE_VERSION,
            errorCode=None,
            preflight=preflight,
            stageTimeline=stage_timeline,
            reportPath=str(report_path),
            outputFiles=output_files,
            speakerProfiles=speaker_profiles,
            speakerSynthesisStats=speaker_synthesis_stats,
            speakerStats=speaker_stats,
            qualityGate=quality_gate,
            engineSelected=engine_selected,
            engineExecuted=engine_executed,
            engineSelectedDisplay=_conversion_policy_display_name(engine_selected),
            engineExecutedDisplay=_executed_engine_display_name(engine_executed),
            processingProfile=processing_profile,
            clipWindow=clip_window,
            qosState=qos_state,
            live={
                "enabled": bool(live_enabled),
                "mode": live_play_mode if live_enabled else "off",
                "playableChunks": len(live_chunks_meta),
                "playableDurationMs": int(sum(int(item.get("durationMs") or 0) for item in live_chunks_meta)),
                "chunkCursorNext": int(live_next_cursor),
            },
            chunkCursorNext=int(live_next_cursor),
            liveChunks=list(live_chunks_meta),
            fallbackUsed=fallback_used,
            fallbackReason=fallback_reason,
            supportsOneShotCloneAtDecision=supports_one_shot_clone_at_decision,
            directorJson=director_json,
            isochronyStats=isochrony_stats,
            llvcMetrics=llvc_metrics,
            lipsyncMetrics=lipsync_metrics,
            assets=assets_payload,
            thinkingPolicy=thinking_policy,
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
                speakerStats=speaker_stats,
                qualityGate=quality_gate,
                engineSelected=engine_selected,
                engineExecuted=engine_executed,
                engineSelectedDisplay=_conversion_policy_display_name(engine_selected),
                engineExecutedDisplay=_executed_engine_display_name(engine_executed),
                processingProfile=processing_profile,
                clipWindow=clip_window,
                qosState=qos_state,
                live={
                    "enabled": bool(live_enabled),
                    "mode": live_play_mode if live_enabled else "off",
                    "playableChunks": len(live_chunks_meta),
                    "playableDurationMs": int(sum(int(item.get("durationMs") or 0) for item in live_chunks_meta)),
                    "chunkCursorNext": int(live_next_cursor),
                },
                chunkCursorNext=int(live_next_cursor),
                liveChunks=list(live_chunks_meta),
                fallbackUsed=fallback_used,
                fallbackReason=fallback_reason,
                supportsOneShotCloneAtDecision=supports_one_shot_clone_at_decision,
            )
            _append_dubbing_log(job_id, "Dubbing cancelled.")
        else:
            error_code = "PRECHECK_FAILED" if "strict_preflight_failed" in str(exc) else _extract_phase_error_code(exc)
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
                speakerStats=speaker_stats,
                qualityGate=quality_gate,
                engineSelected=engine_selected,
                engineExecuted=engine_executed,
                engineSelectedDisplay=_conversion_policy_display_name(engine_selected),
                engineExecutedDisplay=_executed_engine_display_name(engine_executed),
                processingProfile=processing_profile,
                clipWindow=clip_window,
                qosState=qos_state,
                live={
                    "enabled": bool(live_enabled),
                    "mode": live_play_mode if live_enabled else "off",
                    "playableChunks": len(live_chunks_meta),
                    "playableDurationMs": int(sum(int(item.get("durationMs") or 0) for item in live_chunks_meta)),
                    "chunkCursorNext": int(live_next_cursor),
                },
                chunkCursorNext=int(live_next_cursor),
                liveChunks=list(live_chunks_meta),
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
                            "pipelineVersion": VF_DUB_PIPELINE_VERSION,
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
                            "speakerStats": speaker_stats,
                            "engineSelected": engine_selected,
                            "engineExecuted": engine_executed,
                            "engineSelectedDisplay": _conversion_policy_display_name(engine_selected),
                            "engineExecutedDisplay": _executed_engine_display_name(engine_executed),
                            "processingProfile": processing_profile,
                            "clipWindow": clip_window,
                            "qosState": qos_state,
                            "live": {
                                "enabled": bool(live_enabled),
                                "mode": live_play_mode if live_enabled else "off",
                                "playableChunks": len(live_chunks_meta),
                                "playableDurationMs": int(sum(int(item.get("durationMs") or 0) for item in live_chunks_meta)),
                                "chunkCursorNext": int(live_next_cursor),
                            },
                            "fallbackUsed": fallback_used,
                            "fallbackReason": fallback_reason,
                            "supportsOneShotCloneAtDecision": supports_one_shot_clone_at_decision,
                            "directorJson": {},
                            "isochronyStats": {},
                            "llvcMetrics": {},
                            "lipsyncMetrics": {},
                            "assets": _video_pipeline_assets_status(),
                            "thinkingPolicy": {},
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
                speakerStats=speaker_stats,
                qualityGate=quality_gate,
                engineSelected=engine_selected,
                engineExecuted=engine_executed,
                engineSelectedDisplay=_conversion_policy_display_name(engine_selected),
                engineExecutedDisplay=_executed_engine_display_name(engine_executed),
                processingProfile=processing_profile,
                clipWindow=clip_window,
                qosState=qos_state,
                live={
                    "enabled": bool(live_enabled),
                    "mode": live_play_mode if live_enabled else "off",
                    "playableChunks": len(live_chunks_meta),
                    "playableDurationMs": int(sum(int(item.get("durationMs") or 0) for item in live_chunks_meta)),
                    "chunkCursorNext": int(live_next_cursor),
                },
                chunkCursorNext=int(live_next_cursor),
                liveChunks=list(live_chunks_meta),
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
        written_bytes = await _write_upload_file_chunked(file, source_path)
        if written_bytes <= 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

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
        director_segments: list[dict[str, Any]] = []
        for index, seg in enumerate(segments):
            start_ms = int(round(float(seg.get("start") or 0.0) * 1000.0))
            end_ms = int(round(float(seg.get("end") or seg.get("start") or 0.0) * 1000.0))
            if end_ms <= start_ms:
                end_ms = start_ms + 240
            director_segments.append(
                {
                    "index": index,
                    "speaker": str(seg.get("speaker") or "Speaker 1"),
                    "text": str(seg.get("text") or ""),
                    "start_ms": start_ms,
                    "end_ms": end_ms,
                    "affective_tags": [str(seg.get("emotion") or "neutral").strip().lower() or "neutral"],
                }
            )
        director = {
            "modelPreferred": VF_DUB_DIRECTOR_MODEL,
            "modelResolved": VF_DUB_DIRECTOR_MODEL,
            "segments": director_segments,
            "sceneComplexity": "low" if len(director_segments) <= 12 else "medium",
        }
        return JSONResponse(
            {
                "ok": True,
                "language": detected_language,
                "segments": segments,
                "script": script,
                "durationSec": _wav_duration_seconds(str(asr_path)),
                "director": director,
            }
        )
    finally:
        _cleanup_paths(temp_dir)


@app.post("/video/separate-stem")
async def video_separate_stem(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    stem: str = Form("speech"),
    model_name: str = Form(VF_DUB_PHASE1_MODEL),
) -> FileResponse:
    if not ENABLE_SOURCE_SEPARATION:
        raise HTTPException(status_code=503, detail="Source separation is disabled.")

    stem_token = str(stem or "speech").strip().lower()
    if stem_token not in {"speech", "background"}:
        raise HTTPException(status_code=400, detail="stem must be 'speech' or 'background'.")

    temp_dir = tempfile.mkdtemp(prefix="vf_separate_upload_")
    source_path = Path(temp_dir) / _safe_upload_name(file.filename, "source")
    try:
        written_bytes = await _write_upload_file_chunked(file, source_path)
        if written_bytes <= 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")
        from video_dubbing.config import build_config
        from video_dubbing.pipeline import phase1_acoustic_isolation

        effective_model = str(model_name or "").strip() or VF_DUB_PHASE1_MODEL
        cfg = build_config(Path(temp_dir))
        cfg.phase1_model = effective_model
        cfg.dereverb_model = VF_DUB_DEREVERB_MODEL
        ctx: dict[str, Any] = {
            "source_path": str(source_path),
            "target_language": "auto",
            "output_dir": str(cfg.output_root),
            "assets": {},
        }
        phase1_acoustic_isolation.run(ctx, cfg, lambda _message: None)
        speech_path = Path(str(ctx.get("vocals_dry") or ""))
        background_path = Path(str(ctx.get("music_effects") or ""))
        selected = speech_path if stem_token == "speech" else background_path
        if not selected.exists():
            raise RuntimeError(f"phase1 output missing for stem={stem_token}")
        background_tasks.add_task(_cleanup_paths, temp_dir)
        return FileResponse(
            str(selected),
            media_type="audio/wav",
            filename=f"{stem_token}_stem.wav",
        )
    except HTTPException:
        _cleanup_paths(temp_dir)
        raise
    except Exception as exc:  # noqa: BLE001
        _cleanup_paths(temp_dir)
        raise HTTPException(status_code=500, detail=f"Failed to separate stems: {exc}") from exc


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
        if await _write_upload_file_chunked(video, video_path) <= 0:
            raise HTTPException(status_code=400, detail="Video file is empty.")
        if await _write_upload_file_chunked(dub_audio, dub_path) <= 0:
            raise HTTPException(status_code=400, detail="Dub audio file is empty.")

        mixed_path = Path(temp_dir) / "mixed.wav"
        ffmpeg = _get_ffmpeg_path()
        if background_audio is not None:
            bg_path = Path(temp_dir) / _safe_upload_name(background_audio.filename, "bg.wav")
            if await _write_upload_file_chunked(background_audio, bg_path) <= 0:
                raise HTTPException(status_code=400, detail="Background audio file is empty.")
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
    job_dir = DUBBING_OUTPUT_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    source_path = job_dir / _safe_upload_name(source_file.filename, "source")
    if await _write_upload_file_chunked(source_file, source_path) <= 0:
        raise HTTPException(status_code=400, detail="Uploaded source file is empty.")
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
    job_dir = DUBBING_OUTPUT_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    source_path = job_dir / _safe_upload_name(source_file.filename, "source")
    if await _write_upload_file_chunked(source_file, source_path) <= 0:
        raise HTTPException(status_code=400, detail="Uploaded source file is empty.")

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
    advanced_payload["multispeaker_policy"] = _normalize_multispeaker_policy(
        str(advanced_payload.get("multispeaker_policy") or "hybrid_auto"),
        default="hybrid_auto",
    )
    advanced_payload["voice_binding_policy"] = _normalize_voice_binding_policy(
        str(advanced_payload.get("voice_binding_policy") or "stable_fallback"),
        default="stable_fallback",
    )
    advanced_payload["qos_policy"] = _normalize_qos_policy(
        str(advanced_payload.get("qos_policy") or "adaptive_hq_first"),
        default="adaptive_hq_first",
    )
    advanced_payload["hardware_policy"] = _normalize_hardware_policy(
        str(advanced_payload.get("hardware_policy") or "gpu_preferred"),
        default="gpu_preferred",
    )
    advanced_payload["timeout_policy"] = _normalize_timeout_policy(
        str(advanced_payload.get("timeout_policy") or "adaptive"),
        default="adaptive",
    )
    advanced_payload["live_play_mode"] = _normalize_live_play_mode(
        str(advanced_payload.get("live_play_mode") or "progressive_audio"),
        default="progressive_audio",
    )
    advanced_payload["live_chunk_target_ms"] = _safe_bounded_int(
        advanced_payload.get("live_chunk_target_ms"),
        default=3000,
        min_value=600,
        max_value=12000,
    )
    advanced_payload["live_include_chunk_audio"] = bool(advanced_payload.get("live_include_chunk_audio"))
    advanced_payload["max_speaker_count"] = _safe_bounded_int(
        advanced_payload.get("max_speaker_count"),
        default=8,
        min_value=1,
        max_value=16,
    )
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
    profile = _normalize_dubbing_processing_profile(str(advanced_payload.get("processing_profile") or "cpu_quality"))
    advanced_payload["processing_profile"] = profile
    try:
        normalized_clip_window = _normalize_dubbing_clip_window(advanced_payload.get("clip_window"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if normalized_clip_window is None:
        advanced_payload.pop("clip_window", None)
    else:
        advanced_payload["clip_window"] = normalized_clip_window

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
        initial_live_mode = str(advanced_payload.get("live_play_mode") or "off")
        initial_live_enabled = bool(VF_DUB_LIVE_PLAY_ENABLED and initial_live_mode == "progressive_audio")
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
            "pipelineVersion": VF_DUB_PIPELINE_VERSION,
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
            "fallbackUsed": False,
            "fallbackReason": None,
            "supportsOneShotCloneAtDecision": False,
            "directorJson": None,
            "isochronyStats": None,
            "llvcMetrics": None,
            "lipsyncMetrics": None,
            "assets": None,
            "thinkingPolicy": None,
            "processingProfile": profile,
            "clipWindow": normalized_clip_window,
            "speakerStats": {
                "detectedSpeakers": 0,
                "mappedSpeakers": 0,
                "fallbackBindings": [],
                "driftAlerts": [],
            },
            "qosState": {
                "selectedProfile": profile,
                "downgraded": False,
                "reason": "",
                "gpuUsed": False,
            },
            "live": {
                "enabled": initial_live_enabled,
                "mode": initial_live_mode if initial_live_enabled else "off",
                "playableChunks": 0,
                "playableDurationMs": 0,
            },
            "chunkCursorNext": 0,
            "liveChunks": [],
        }

    thread = threading.Thread(target=_run_dubbing_job_v2, args=(job_id, job_payload), daemon=True)
    thread.start()
    return JSONResponse({"ok": True, "job_id": job_id})


@app.get("/dubbing/jobs/{job_id}")
def get_dubbing_job(
    job_id: str,
    includeChunks: bool = False,
    chunkCursor: int = 0,
    chunkLimit: int = Query(default=VF_DUB_LIVE_CHUNK_LIMIT_DEFAULT, ge=1, le=VF_DUB_LIVE_CHUNK_LIMIT_MAX),
    includeChunkAudio: bool = False,
) -> JSONResponse:
    _cleanup_expired_dubbing_live_artifacts()
    with DUBBING_JOB_LOCK:
        job = DUBBING_JOBS.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        payload = dict(job)

    live_payload = payload.get("live") if isinstance(payload.get("live"), dict) else {}
    source_chunks = [
        item
        for item in list(payload.get("liveChunks") or [])
        if isinstance(item, dict)
    ]
    if not source_chunks:
        source_chunks = _load_dubbing_live_chunks_from_artifacts(job_id)
    if source_chunks:
        source_chunks.sort(key=lambda item: int(item.get("index") or 0))
        playable_chunks = len(source_chunks)
        playable_duration_ms = sum(int(item.get("durationMs") or 0) for item in source_chunks)
        payload["live"] = {
            "enabled": bool(live_payload.get("enabled") if isinstance(live_payload, dict) else False),
            "mode": str(live_payload.get("mode") if isinstance(live_payload, dict) else "off"),
            "playableChunks": max(int(live_payload.get("playableChunks") or 0) if isinstance(live_payload, dict) else 0, playable_chunks),
            "playableDurationMs": max(
                int(live_payload.get("playableDurationMs") or 0) if isinstance(live_payload, dict) else 0,
                int(playable_duration_ms),
            ),
            "chunkCursorNext": max(
                int(live_payload.get("chunkCursorNext") or 0) if isinstance(live_payload, dict) else 0,
                int(source_chunks[-1].get("index") or 0) + 1,
            ),
        }
        payload["chunkCursorNext"] = int(payload["live"]["chunkCursorNext"])
    elif isinstance(live_payload, dict):
        payload["live"] = {
            "enabled": bool(live_payload.get("enabled")),
            "mode": str(live_payload.get("mode") or "off"),
            "playableChunks": int(live_payload.get("playableChunks") or 0),
            "playableDurationMs": int(live_payload.get("playableDurationMs") or 0),
            "chunkCursorNext": int(live_payload.get("chunkCursorNext") or payload.get("chunkCursorNext") or 0),
        }
        payload["chunkCursorNext"] = int(payload["live"]["chunkCursorNext"])

    if includeChunks:
        safe_cursor = max(0, int(chunkCursor or 0))
        safe_limit = _safe_bounded_int(
            chunkLimit,
            default=VF_DUB_LIVE_CHUNK_LIMIT_DEFAULT,
            min_value=1,
            max_value=VF_DUB_LIVE_CHUNK_LIMIT_MAX,
        )
        visible = [
            item
            for item in source_chunks
            if item.get("index") is not None and int(item.get("index")) >= safe_cursor
        ][:safe_limit]
        chunk_payloads: list[dict[str, Any]] = []
        for item in visible:
            safe_index = int(item.get("index") or 0)
            chunk_item = {
                "index": safe_index,
                "contentType": str(item.get("contentType") or "audio/wav"),
                "durationMs": int(item.get("durationMs") or 0),
                "speakerId": str(item.get("speakerId") or "SPEAKER_00"),
                "engine": str(item.get("engine") or ""),
                "voiceId": str(item.get("voiceId") or ""),
                "textChars": int(item.get("textChars") or 0),
                "downloadUrl": f"/dubbing/jobs/{job_id}/chunks/{safe_index}",
            }
            if includeChunkAudio:
                chunk_item["audioBase64"] = _load_live_chunk_audio_base64(item)
            chunk_payloads.append(chunk_item)
        payload["chunks"] = chunk_payloads
        if chunk_payloads:
            payload["chunkCursorNext"] = max(int(payload.get("chunkCursorNext") or 0), int(chunk_payloads[-1]["index"]) + 1)

    return JSONResponse({"ok": True, "job": payload})


@app.get("/dubbing/jobs/{job_id}/chunks/{chunk_index}")
def download_dubbing_chunk(job_id: str, chunk_index: int) -> FileResponse:
    with DUBBING_JOB_LOCK:
        job = DUBBING_JOBS.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
    chunk_meta = _resolve_dubbing_job_chunk(job, chunk_index)
    if not isinstance(chunk_meta, dict):
        raise HTTPException(status_code=404, detail="Chunk not found")
    chunk_path = Path(str(chunk_meta.get("path") or "")).resolve()
    if not chunk_path.exists() or not chunk_path.is_file():
        raise HTTPException(status_code=404, detail="Chunk file not found")
    media_type = str(chunk_meta.get("contentType") or "audio/wav")
    return FileResponse(
        str(chunk_path),
        media_type=media_type,
        filename=f"{job_id}_chunk_{max(0, int(chunk_index)):04d}.wav",
        headers={"Cache-Control": "no-store"},
    )


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


@app.get("/llvc/models")
def list_llvc_models() -> JSONResponse:
    try:
        models = llvc_runtime.list_models()
        current_model = llvc_runtime.current_model()
        if not current_model and models:
            current_model = str(models[0])
        return JSONResponse(
            {
                "models": models,
                "currentModel": current_model,
            }
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"LLVC unavailable: {exc}") from exc


@app.post("/llvc/load-model")
def load_llvc_model(payload: LoadLlvcModelRequest, request: Request) -> JSONResponse:
    actor_uid, actor = _require_permission(request, PERM_OPS_MUTATE)
    _require_admin_mutation_unlock(request, expected_uid=actor_uid)
    try:
        llvc_runtime.load_model(payload.modelName, payload.version)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to load model: {exc}") from exc
    _audit_append_event(
        action="llvc_load_model",
        resource_type="runtime",
        resource_id=str(payload.modelName or ""),
        after={"version": str(payload.version or "v2")},
        request=request,
        actor_uid=actor_uid,
        actor_role=str(actor.get("role") or ""),
    )
    return JSONResponse({"ok": True, "currentModel": llvc_runtime.current_model()})


@app.post("/llvc/convert")
async def convert_llvc(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    model_name: str = Form(...),
    preset: str = Form("tts_realtime"),
    pitch_shift: int = Form(0),
    index_rate: float = Form(0.5),
    filter_radius: int = Form(3),
    rms_mix_rate: float = Form(1.0),
    protect: float = Form(0.33),
    f0_method: str = Form("rmvpe"),
    separate_stem: str = Form("true"),
) -> FileResponse:
    safe_preset = _normalize_llvc_preset(preset)
    selected_engine = "LLVC"
    executed_engine = "LLVC"
    fallback_used = False
    source_separated = False
    separation_model_used = ""
    runtime_headers: dict[str, str] = {}

    temp_dir = tempfile.mkdtemp(prefix="vf_llvc_")
    source_path = Path(temp_dir) / _safe_upload_name(file.filename, "source_audio")
    normalized_wav = Path(temp_dir) / "input.wav"
    output_path = Path(temp_dir) / "output.wav"

    try:
        if await _write_upload_file_chunked(file, source_path) <= 0:
            raise HTTPException(status_code=400, detail="Uploaded source audio is empty.")

        separate_enabled = _as_bool(separate_stem)
        if separate_enabled:
            if not source_separation_runtime.ensure_available():
                raise RuntimeError(source_separation_runtime.import_error or "Demucs runtime unavailable.")
            speech_path, _background_path, _cache_key = _ensure_source_separation(source_path, SEPARATION_MODEL)
            _convert_media_to_wav(str(speech_path), str(normalized_wav), sample_rate=40000, channels=1)
            source_separated = True
            separation_model_used = str(SEPARATION_MODEL)
        else:
            _convert_media_to_wav(str(source_path), str(normalized_wav), sample_rate=40000)

        llvc_ok, llvc_detail = llvc_adapter.health()
        if not llvc_ok:
            raise RuntimeError(f"LLVC unavailable: {llvc_detail}")
        runtime_headers = llvc_adapter.convert(
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

    except Exception as exc:
        _cleanup_paths(temp_dir)
        raise HTTPException(status_code=500, detail=f"LLVC conversion failed: {exc}") from exc

    background_tasks.add_task(_cleanup_paths, temp_dir)
    safe_model = _safe_upload_name(model_name, "model")
    return FileResponse(
        str(output_path),
        media_type="audio/wav",
        filename=f"llvc_{safe_model}.wav",
        headers={
            "x-vf-engine-selected": selected_engine,
            "x-vf-engine-executed": executed_engine,
            "x-vf-llvc-preset": safe_preset,
            "x-vf-llvc-fallback": "1" if fallback_used else "0",
            "x-vf-llvc-fallback-reason": "",
            "x-vf-supports-one-shot-clone-at-decision": "0",
            "x-vf-source-separated": "1" if source_separated else "0",
            "x-vf-separation-model": separation_model_used,
            "x-vf-llvc-model-resolved": str(
                runtime_headers.get("x-vf-llvc-model-resolved")
                or runtime_headers.get("x-vf-llvc-model")
                or model_name
            ),
            "x-vf-llvc-backend-mode": str(runtime_headers.get("x-vf-llvc-backend-mode") or ""),
        },
    )


@app.on_event("startup")
def _phase2_startup() -> None:
    if VF_SERVICE_IS_API:
        _ensure_scheduler_started()
    if VF_SERVICE_IS_WORKER:
        _ensure_tts_workers_started()
    _log_kokoro_model_mirror_status()
    if VF_SERVICE_IS_API and VF_SUPPORT_INBOX_ENABLED:
        try:
            _support_ai_policy_get()
        except Exception:
            pass


@app.on_event("shutdown")
def _phase2_shutdown() -> None:
    _scheduler_stop()


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("VF_BACKEND_HOST", "0.0.0.0")
    port = int((os.getenv("PORT") or os.getenv("VF_BACKEND_PORT") or "7800").strip() or "7800")
    uvicorn.run(app, host=host, port=port, reload=False)



