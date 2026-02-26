from __future__ import annotations

import base64
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
from collections import defaultdict
from io import BytesIO
from pathlib import Path
from typing import Any, Optional, Dict, List
from urllib import error as urllib_error
from urllib.parse import urlparse
from urllib import request as urllib_request

import requests
from bs4 import BeautifulSoup
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, UploadFile
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
PROJECT_ROOT = APP_ROOT.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from shared.gemini_allocator import (
    GeminiRateAllocator,
    estimate_text_tokens,
    load_allocator_config,
    parse_api_keys as parse_api_keys_shared,
)
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
    "GEM": 3,
    "KOKORO": 1,
}
PLAN_LIMITS: dict[str, dict[str, Any]] = {
    "free": {"plan": "Free", "monthlyVfLimit": 8000, "dailyGenerationLimit": VF_DAILY_GENERATION_LIMIT},
    "pro": {"plan": "Pro", "monthlyVfLimit": 200000, "dailyGenerationLimit": VF_DAILY_GENERATION_LIMIT},
    "plus": {"plan": "Plus", "monthlyVfLimit": 500000, "dailyGenerationLimit": VF_DAILY_GENERATION_LIMIT},
}
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
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
MODELS_DIR.mkdir(parents=True, exist_ok=True)
SEPARATION_CACHE_DIR.mkdir(parents=True, exist_ok=True)


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
    "GEM": "Plus",
    "KOKORO": "Basic",
}
CONVERSION_POLICY_DISPLAY_NAMES = {
    "AUTO_RELIABLE": "AUTO_RELIABLE",
    "LHQ_PILOT": "LHQ_PILOT",
}
EXECUTED_ENGINE_DISPLAY_NAMES = {
    "LHQ_SVC": "LHQ-SVC (Pilot)",
    "GEM": "Plus",
    "KOKORO": "Basic",
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
VF_ADMIN_APPROVAL_TOKEN = (os.getenv("VF_ADMIN_APPROVAL_TOKEN") or "").strip()
VF_ADMIN_APPROVER_UIDS = frozenset(
    {
        token
        for token in [item.strip() for item in (os.getenv("VF_ADMIN_APPROVER_UIDS") or "").split(",")]
        if token
    }
)


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
                XTTS_EMOTION_HELPER_URL,
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
        self.engine: Any = None
        self.import_error: Optional[str] = None

    def ensure_engine(self) -> Any:
        if self.engine is not None:
            return self.engine

        try:
            from rvc_python.infer import RVCInference  # type: ignore
        except Exception as exc:
            self.import_error = f"rvc-python import failed: {exc}"
            raise RuntimeError(self.import_error) from exc

        try:
            self.engine = RVCInference(models_dir=str(MODELS_DIR), device=RVC_DEVICE)
        except Exception as exc:
            self.import_error = f"RVC engine init failed: {exc}"
            raise RuntimeError(self.import_error) from exc

        return self.engine

    def list_models(self) -> list[str]:
        engine = self.ensure_engine()
        return engine.list_models()

    def load_model(self, model_name: str, version: str = "v2") -> None:
        engine = self.ensure_engine()
        engine.load_model(model_name, version=version)

    def current_model(self) -> Optional[str]:
        if self.engine is None:
            return None
        return getattr(self.engine, "current_model", None)


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
        model_name = str(kwargs.get("model_name") or "").strip()
        if not model_name:
            raise RuntimeError("rvc_model_required")
        engine = rvc_runtime.ensure_engine()
        if engine.current_model != model_name:
            engine.load_model(model_name)
        engine.set_params(
            f0method=str(kwargs.get("f0_method") or "rmvpe"),
            f0up_key=int(kwargs.get("pitch_shift") or 0),
            index_rate=float(kwargs.get("index_rate") or 0.5),
            filter_radius=int(kwargs.get("filter_radius") or 3),
            rms_mix_rate=float(kwargs.get("rms_mix_rate") or 1.0),
            protect=float(kwargs.get("protect") or 0.33),
        )
        engine.infer_file(input_wav, output_wav)


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
_INMEMORY_LOCK = threading.Lock()


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
        "updatedAt": _utc_now().isoformat(),
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
    throttle_payload = _ai_ops_throttle_payload(path)
    if throttle_payload is not None:
        _ai_ops_record_rejected_request(path, throttle_payload)
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


def _require_request_uid(request: Request) -> str:
    uid = str(getattr(request.state, "uid", "") or "").strip()
    if uid:
        return uid
    if not VF_AUTH_ENFORCE:
        header_uid = str(request.headers.get("x-dev-uid") or "").strip()
        return header_uid or VF_DEV_BYPASS_UID
    raise HTTPException(status_code=401, detail="Authentication required.")


def _firestore_collection(name: str) -> Any:
    if _FIRESTORE_DB is None:
        return None
    return _FIRESTORE_DB.collection(name)


def _load_entitlement(uid: str) -> dict[str, Any]:
    defaults = _default_entitlement(uid)
    collection = _firestore_collection("entitlements")
    if collection is None:
        with _INMEMORY_LOCK:
            existing = _INMEMORY_ENTITLEMENTS.get(uid)
            if not existing:
                _INMEMORY_ENTITLEMENTS[uid] = {**defaults}
            return {**_INMEMORY_ENTITLEMENTS[uid]}
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
    return merged


def _write_entitlement(uid: str, payload: dict[str, Any]) -> None:
    payload = {**payload, "updatedAt": _utc_now().isoformat()}
    collection = _firestore_collection("entitlements")
    if collection is None:
        with _INMEMORY_LOCK:
            current = _INMEMORY_ENTITLEMENTS.get(uid) or _default_entitlement(uid)
            current.update(payload)
            _INMEMORY_ENTITLEMENTS[uid] = current
        return
    collection.document(uid).set(payload, merge=True)


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


def _reserve_usage(uid: str, request_id: str, engine: str, char_count: int) -> dict[str, Any]:
    safe_engine = str(engine or "").strip().upper()
    if safe_engine not in VF_ENGINE_RATES:
        safe_engine = "GEM"
    safe_chars = _as_positive_int(char_count)
    vf_cost = safe_chars * VF_ENGINE_RATES[safe_engine]
    now = _utc_now()
    monthly_doc_id = _inmemory_usage_month_doc_id(uid, now)
    daily_doc_id = _inmemory_usage_day_doc_id(uid, now)
    event_doc_id = f"{uid}_{request_id}"

    if _firestore_collection("usage_events") is None:
        with _INMEMORY_LOCK:
            entitlement = _INMEMORY_ENTITLEMENTS.get(uid) or _default_entitlement(uid)
            _INMEMORY_ENTITLEMENTS[uid] = entitlement
            monthly = _INMEMORY_USAGE_MONTHLY.get(monthly_doc_id) or _usage_defaults(uid, now)[0]
            daily = _INMEMORY_USAGE_DAILY.get(daily_doc_id) or _usage_defaults(uid, now)[1]
            event = _INMEMORY_USAGE_EVENTS.get(event_doc_id)
            if event and str(event.get("status")) in {"reserved", "committed"}:
                return {"ok": True, "alreadyReserved": True, "event": event, "monthly": monthly, "daily": daily}

            monthly_limit = _as_positive_int(entitlement.get("monthlyVfLimit"))
            daily_limit = _as_positive_int(entitlement.get("dailyGenerationLimit"))
            if _as_positive_int(monthly.get("vfUsed")) + vf_cost > monthly_limit:
                raise HTTPException(status_code=429, detail="Monthly VF limit exceeded.")
            if _as_positive_int(daily.get("generationCount")) + 1 > daily_limit:
                raise HTTPException(status_code=429, detail="Daily generation limit reached.")

            monthly["vfUsed"] = _as_positive_int(monthly.get("vfUsed")) + vf_cost
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
                "monthDocId": monthly_doc_id,
                "dayDocId": daily_doc_id,
                "createdAt": now.isoformat(),
                "updatedAt": now.isoformat(),
            }

            _INMEMORY_USAGE_MONTHLY[monthly_doc_id] = monthly
            _INMEMORY_USAGE_DAILY[daily_doc_id] = daily
            _INMEMORY_USAGE_EVENTS[event_doc_id] = event_payload
            return {"ok": True, "alreadyReserved": False, "event": event_payload, "monthly": monthly, "daily": daily}

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
        plan_cfg = _plan_config(_normalize_plan_name(str(entitlement.get("plan") or "Free")))
        monthly_limit = _as_positive_int(entitlement.get("monthlyVfLimit") or plan_cfg["monthlyVfLimit"])
        daily_limit = _as_positive_int(entitlement.get("dailyGenerationLimit") or plan_cfg["dailyGenerationLimit"])

        monthly_doc = monthly_ref.get(transaction=transaction_obj)
        daily_doc = daily_ref.get(transaction=transaction_obj)
        default_monthly, default_daily = _usage_defaults(uid, now)
        monthly = {**default_monthly, **(monthly_doc.to_dict() or {})} if monthly_doc.exists else {**default_monthly}
        daily = {**default_daily, **(daily_doc.to_dict() or {})} if daily_doc.exists else {**default_daily}

        event_doc = event_ref.get(transaction=transaction_obj)
        if event_doc.exists:
            existing_event = event_doc.to_dict() or {}
            if str(existing_event.get("status")) in {"reserved", "committed"}:
                return {"ok": True, "alreadyReserved": True, "event": existing_event, "monthly": monthly, "daily": daily}

        if _as_positive_int(monthly.get("vfUsed")) + vf_cost > monthly_limit:
            raise RuntimeError("Monthly VF limit exceeded.")
        if _as_positive_int(daily.get("generationCount")) + 1 > daily_limit:
            raise RuntimeError("Daily generation limit reached.")

        monthly["vfUsed"] = _as_positive_int(monthly.get("vfUsed")) + vf_cost
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
            "monthDocId": monthly_doc_id,
            "dayDocId": daily_doc_id,
            "createdAt": now.isoformat(),
            "updatedAt": now.isoformat(),
        }

        transaction_obj.set(entitlements_ref, entitlement, merge=True)
        transaction_obj.set(monthly_ref, monthly, merge=True)
        transaction_obj.set(daily_ref, daily, merge=True)
        transaction_obj.set(event_ref, event_payload, merge=True)
        return {"ok": True, "alreadyReserved": False, "event": event_payload, "monthly": monthly, "daily": daily}

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
                engine = str(event.get("engine") or "GEM").upper()
                vf_cost = _as_positive_int(event.get("vfCost"))
                chars = _as_positive_int(event.get("chars"))
                if monthly is not None:
                    monthly["vfUsed"] = max(0, _as_positive_int(monthly.get("vfUsed")) - vf_cost)
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
        monthly_ref = _FIRESTORE_DB.collection("usage_monthly").document(str(event.get("monthDocId") or ""))
        daily_ref = _FIRESTORE_DB.collection("usage_daily").document(str(event.get("dayDocId") or ""))
        monthly_doc = monthly_ref.get(transaction=transaction_obj)
        daily_doc = daily_ref.get(transaction=transaction_obj)
        engine = str(event.get("engine") or "GEM").upper()
        vf_cost = _as_positive_int(event.get("vfCost"))
        chars = _as_positive_int(event.get("chars"))
        if monthly_doc.exists:
            monthly = monthly_doc.to_dict() or {}
            monthly["vfUsed"] = max(0, _as_positive_int(monthly.get("vfUsed")) - vf_cost)
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
        transaction_obj.set(event_ref, {"status": "reverted", "updatedAt": now, "error": str(error_detail)}, merge=True)

    _apply(transaction)


def _entitlement_usage_payload(uid: str) -> dict[str, Any]:
    entitlement = _load_entitlement(uid)
    monthly, daily = _load_usage_windows(uid)
    monthly_used = _as_positive_int(monthly.get("vfUsed"))
    monthly_limit = _as_positive_int(entitlement.get("monthlyVfLimit"))
    daily_used = _as_positive_int(daily.get("generationCount"))
    daily_limit = _as_positive_int(entitlement.get("dailyGenerationLimit"))
    month_start, month_end = _month_window_bounds()
    day_start, day_end = _day_window_bounds()
    return {
        "uid": uid,
        "plan": _normalize_plan_name(str(entitlement.get("plan") or "Free")),
        "status": str(entitlement.get("status") or "free_active"),
        "monthly": {
            "vfLimit": monthly_limit,
            "vfUsed": monthly_used,
            "vfRemaining": max(0, monthly_limit - monthly_used),
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
        "limits": {
            "vfRates": VF_ENGINE_RATES,
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
    response_format: Optional[str] = None
    emotion_ref_id: Optional[str] = None
    emotion_strength: Optional[float] = None


class AiGenerateTextRequest(BaseModel):
    systemPrompt: str
    userPrompt: str
    jsonMode: bool = False
    temperature: float = 0.7
    apiKey: Optional[str] = None


def _ai_ops_now_ms() -> int:
    return int(time.time() * 1000)


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
    if normalized == "KOKORO":
        return KOKORO_RUNTIME_URL
    return XTTS_RUNTIME_URL


def _runtime_synthesize_path_for_engine(engine: str) -> str:
    normalized = _normalize_engine_name(engine)
    if normalized in {"GEM", "KOKORO"}:
        return "/synthesize"
    return "/v1/text-to-speech"


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


def _resolve_gemini_fallback_key_pool() -> list[str]:
    raw_pool = str(os.getenv("GEMINI_API_KEYS") or "").strip()
    candidates: list[str] = []
    seen: set[str] = set()
    for token in [
        *parse_api_keys_shared(raw_pool),
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


def _extract_text_with_gemini_fallback(media_bytes: bytes, mime_type: str, language_hint: str, task_label: str) -> str:
    key_pool = _resolve_gemini_fallback_key_pool()
    if not key_pool:
        raise RuntimeError("Gemini API key is missing for AI fallback.")
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
    try:
        rvc_runtime.ensure_engine()
        rvc_available = True
        current_model = rvc_runtime.current_model()
        rvc_error = None
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
            "modelsDir": str(MODELS_DIR),
            "error": rvc_error,
            "fallbackAvailable": fallback_available,
            "fallbackModel": RVC_FALLBACK_MODEL_ID if fallback_available else None,
            "conversionPolicies": sorted(VOICE_CONVERSION_POLICIES),
            "lhqPilot": {"healthy": lhq_healthy, "detail": lhq_detail, "model": LHQ_SVC_PILOT_MODEL_ID},
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


@app.get("/account/entitlements")
def account_entitlements(request: Request) -> JSONResponse:
    uid = _require_request_uid(request)
    payload = _entitlement_usage_payload(uid)
    return JSONResponse({"ok": True, "entitlements": payload})


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
            uid = str((data_obj.get("metadata") or {}).get("uid") or "")
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
                price_id = _stripe_price_id_for_plan(str((data_obj.get("metadata") or {}).get("plan") or "free"))
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


@app.post("/tts/synthesize")
def tts_synthesize(payload: TtsSynthesizeRequest, request: Request) -> Response:
    uid = _require_request_uid(request)
    text = str(payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required.")
    engine = _normalize_engine_name(payload.engine)
    request_id = str(payload.request_id or uuid.uuid4().hex).strip()

    reserve = _reserve_usage(uid, request_id, engine, len(text))
    _ = reserve

    runtime_base = _runtime_url_for_engine(engine)
    runtime_path = _runtime_synthesize_path_for_engine(engine)
    upstream_url = f"{runtime_base}{runtime_path}"
    if hasattr(payload, "model_dump"):
        upstream_payload = payload.model_dump(exclude_none=True)  # type: ignore[attr-defined]
    else:
        upstream_payload = payload.dict(exclude_none=True)
    upstream_payload["engine"] = engine
    upstream_payload["text"] = text
    voice_id = str(payload.voice_id or payload.voiceId or "").strip()
    if voice_id:
        upstream_payload["voice_id"] = voice_id
        upstream_payload["voiceId"] = voice_id
    if engine == "GEM":
        if not upstream_payload.get("voiceName"):
            upstream_payload["voiceName"] = voice_id or str(payload.voiceName or "Fenrir")
    elif engine == "KOKORO":
        if voice_id:
            upstream_payload["voiceId"] = voice_id
    elif engine == "XTTS":
        if voice_id:
            upstream_payload["voice"] = voice_id
    upstream_payload.setdefault("request_id", request_id)

    try:
        runtime_response = requests.post(upstream_url, json=upstream_payload, timeout=240)
    except Exception as exc:  # noqa: BLE001
        _finalize_usage(uid, request_id, success=False, error_detail=f"runtime_unreachable:{exc}")
        raise HTTPException(status_code=502, detail=f"TTS runtime is unreachable: {exc}") from exc

    if not runtime_response.ok:
        _finalize_usage(uid, request_id, success=False, error_detail=f"runtime_error:{runtime_response.status_code}")
        detail = runtime_response.text[:400]
        raise HTTPException(status_code=runtime_response.status_code, detail=detail or "TTS runtime failed.")

    _finalize_usage(uid, request_id, success=True)

    out_headers: dict[str, str] = {
        "x-vf-request-id": request_id,
    }
    trace_id = runtime_response.headers.get("x-voiceflow-trace-id")
    if trace_id:
        out_headers["x-voiceflow-trace-id"] = trace_id
    diagnostics = runtime_response.headers.get("x-voiceflow-diagnostics")
    if diagnostics:
        out_headers["x-voiceflow-diagnostics"] = diagnostics

    media_type = runtime_response.headers.get("content-type") or "audio/wav"
    return Response(content=runtime_response.content, media_type=media_type, headers=out_headers)


@app.get("/runtime/logs/tail")
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


@app.post("/tts/engines/switch")
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


@app.get("/tts/engines/capabilities")
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
    route = str(tts_route or "auto").strip().lower()
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
    engine_executed = "XTTS"
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
        xtts_mode = str(advanced.get("xtts_mode") or "preferred").strip().lower()
        tts_runtime = str(advanced.get("tts_runtime") or "xtts").strip().lower()
        if tts_runtime not in {"xtts", "gem"}:
            tts_runtime = "xtts"
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
                xtts_mode=xtts_mode,
                tts_runtime=tts_runtime,
            )
            selected_engine_by_speaker = {
                str(item.get("speaker") or ""): str(item.get("engine") or "XTTS")
                for item in routed
                if str(item.get("status") or "") == "selected"
            }
            default_engine = "GEM" if tts_runtime == "gem" else "XTTS"
            for seg in segments:
                speaker = str(seg.get("speaker") or "SPEAKER_00")
                seg["tts_engine"] = selected_engine_by_speaker.get(speaker, default_engine)
            selected_routes[:] = routed
            return resolved_map

        result = run_pipeline(
            source_path=source_path,
            output_dir=job_dir,
            target_language=target_language,
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
                xtts_mode=xtts_mode,
                tts_runtime=tts_runtime,
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
            "xtts": ("tts", 74),
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


@app.post("/video/transcribe")
async def video_transcribe(
    file: UploadFile = File(...),
    language: str = Form("auto"),
    task: str = Form("transcribe"),
    include_emotion: bool = Form(True),
    return_words: bool = Form(True),
) -> JSONResponse:
    temp_dir = tempfile.mkdtemp(prefix="vf_transcribe_")
    source_path = Path(temp_dir) / _safe_upload_name(file.filename, "source")
    try:
        with source_path.open("wb") as handle:
            handle.write(await file.read())

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

        if include_emotion and ENABLE_TRANSCRIBE_EMOTION_CAPTURE:
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


@app.post("/video/mux-dub")
async def video_mux_dub(
    video: UploadFile = File(...),
    dub_audio: UploadFile = File(...),
    background_audio: Optional[UploadFile] = File(None),
    speech_gain: float = Form(1.0),
    background_gain: float = Form(0.3),
    normalize: bool = Form(True),
) -> FileResponse:
    temp_dir = tempfile.mkdtemp(prefix="vf_mux_")
    try:
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
    engine: str = Form("XTTS"),
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
    if "xtts_mode" not in advanced_payload:
        advanced_payload["xtts_mode"] = "preferred"
    if str(advanced_payload.get("xtts_mode")).strip().lower() not in {"preferred", "strict"}:
        raise HTTPException(status_code=400, detail="advanced.xtts_mode must be preferred or strict")
    if "tts_runtime" not in advanced_payload:
        advanced_payload["tts_runtime"] = "xtts"
    if str(advanced_payload.get("tts_runtime")).strip().lower() not in {"xtts", "gem"}:
        raise HTTPException(status_code=400, detail="advanced.tts_runtime must be xtts or gem")
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
            "engineExecuted": "XTTS",
            "engineSelectedDisplay": _conversion_policy_display_name(selected_policy),
            "engineExecutedDisplay": _executed_engine_display_name("XTTS"),
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
    pitch_shift: int = Form(0),
    index_rate: float = Form(0.5),
    filter_radius: int = Form(3),
    rms_mix_rate: float = Form(1.0),
    protect: float = Form(0.33),
    f0_method: str = Form("rmvpe"),
) -> FileResponse:
    policy = _normalize_conversion_policy(engine_policy, default="AUTO_RELIABLE")
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
                if policy == "LHQ_PILOT":
                    selected_engine = "XTTS"
                if rvc_ok:
                    rvc_adapter.convert(
                        str(normalized_wav),
                        str(output_path),
                        model_name=model_name,
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



