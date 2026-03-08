import io
import base64
import concurrent.futures
import importlib.util
import json
import os
import re
import sys
import threading
import time
import unicodedata
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

_SEGMENTATION_SPEC = importlib.util.spec_from_file_location(
    "kokoro_runtime_segmentation",
    Path(__file__).with_name("segmentation.py"),
)
assert _SEGMENTATION_SPEC is not None and _SEGMENTATION_SPEC.loader is not None
_SEGMENTATION_MODULE = importlib.util.module_from_spec(_SEGMENTATION_SPEC)
_SEGMENTATION_SPEC.loader.exec_module(_SEGMENTATION_MODULE)
SEGMENTATION_CHUNKING_PROFILES = _SEGMENTATION_MODULE.CHUNKING_PROFILES
MAX_WORDS_PER_REQUEST = _SEGMENTATION_MODULE.MAX_WORDS_PER_REQUEST
SEGMENTATION_PROFILE = _SEGMENTATION_MODULE.SEGMENTATION_PROFILE
chunk_text_for_tts = _SEGMENTATION_MODULE.chunk_text_for_tts
count_words = _SEGMENTATION_MODULE.count_words
resolve_chunk_profile = _SEGMENTATION_MODULE.resolve_chunk_profile

RUNTIME_ROOT = Path(__file__).resolve().parents[2]
if str(RUNTIME_ROOT) not in sys.path:
    sys.path.insert(0, str(RUNTIME_ROOT))

from shared.env_loader import load_backend_env_files

load_backend_env_files(Path(__file__).resolve())

APP_NAME = "kokoro-runtime"
KOKORO_SAMPLE_RATE = int(os.getenv("KOKORO_SAMPLE_RATE", "24000"))
# Kokoro is hard-pinned to CPU in this workspace. Keep the env read only so
# misconfigured shells remain observable during debugging, but never honor it.
_IGNORED_KOKORO_DEVICE = str(os.getenv("KOKORO_DEVICE", "cpu")).strip().lower() or "cpu"
KOKORO_DEVICE = "cpu"
os.environ["CUDA_VISIBLE_DEVICES"] = ""
os.environ["KOKORO_DEVICE"] = KOKORO_DEVICE
KOKORO_IMPL = "kokoro-onnx-python"
MODEL_ID = str(os.getenv("VF_KOKORO_MODEL_REPO_ID", "onnx-community/Kokoro-82M-v1.0-ONNX")).strip() or "onnx-community/Kokoro-82M-v1.0-ONNX"
MODEL_REVISION = str(os.getenv("VF_KOKORO_MODEL_REVISION", "main")).strip() or "main"
KOKORO_DTYPE = str(os.getenv("KOKORO_MODEL_DTYPE", "q8")).strip().lower() or "q8"
KOKORO_MODEL_FILES = {
    "fp32": "onnx/model.onnx",
    "fp16": "onnx/model_fp16.onnx",
    "q8": "onnx/model_quantized.onnx",
    "q8f16": "onnx/model_q8f16.onnx",
    "q4": "onnx/model_q4.onnx",
    "q4f16": "onnx/model_q4f16.onnx",
    "uint8": "onnx/model_uint8.onnx",
    "uint8f16": "onnx/model_uint8f16.onnx",
}
KOKORO_MODEL_FILE = KOKORO_MODEL_FILES.get(KOKORO_DTYPE, KOKORO_MODEL_FILES["q8"])
LOCAL_MODEL_MIRROR_ROOT = Path(
    str(os.getenv("VF_LOCAL_MODEL_MIRROR_DIR", str(RUNTIME_ROOT / "models"))).strip() or str(RUNTIME_ROOT / "models")
)
KOKORO_MODEL_DIR = (LOCAL_MODEL_MIRROR_ROOT / MODEL_ID).resolve()
KOKORO_MODEL_PATH = (KOKORO_MODEL_DIR / KOKORO_MODEL_FILE).resolve()
KOKORO_BATCH_MAX_ITEMS = max(1, int(os.getenv("KOKORO_BATCH_MAX_ITEMS", "64")))
KOKORO_BATCH_DEFAULT_PARALLEL = max(
    1,
    int(
        (
            os.getenv("KOKORO_BATCH_DEFAULT_PARALLEL")
            or os.getenv("KOKORO_BATCH_MAX_PARALLEL")
            or "2"
        )
    ),
)
KOKORO_BATCH_MAX_PARALLEL = max(
    KOKORO_BATCH_DEFAULT_PARALLEL,
    int(
        (
            os.getenv("KOKORO_BATCH_PARALLEL_LIMIT")
            or os.getenv("KOKORO_BATCH_MAX_PARALLEL")
            or "6"
        )
    ),
)
KOKORO_SYNTH_MAX_MS = max(10_000, int(os.getenv("KOKORO_SYNTH_MAX_MS", "180000")))
KOKORO_MAX_ACTIVE_SYNTH = max(
    1,
    int(os.getenv("KOKORO_MAX_ACTIVE_SYNTH", str(KOKORO_BATCH_DEFAULT_PARALLEL))),
)
KOKORO_IDLE_UNLOAD_MS = max(0, int(os.getenv("KOKORO_IDLE_UNLOAD_MS", "120000")))
KOKORO_ORT_INTRA_OP_THREADS = max(0, int(os.getenv("KOKORO_ORT_INTRA_OP_THREADS", "0")))
KOKORO_ORT_INTER_OP_THREADS = max(0, int(os.getenv("KOKORO_ORT_INTER_OP_THREADS", "0")))
DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
LOCALHOST_CORS_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$"


def _parse_cors_origins(env_var: str) -> List[str]:
    raw = (os.getenv(env_var) or "").strip()
    if not raw:
        return DEFAULT_CORS_ORIGINS
    values = [item.strip() for item in raw.split(",") if item.strip()]
    return values or DEFAULT_CORS_ORIGINS


def _new_trace_id() -> str:
    return f"kokoro_{int(time.time() * 1000):x}_{os.urandom(3).hex()}"


def _normalize_trace_id(value: Optional[str]) -> str:
    token = re.sub(r"[^a-zA-Z0-9._:-]", "", str(value or "").strip())
    if token:
        return token[:96]
    return _new_trace_id()


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

VOICE_IDS: List[str] = [
    "af_heart",
    "af_bella",
    "af_nova",
    "af_sarah",
    "am_fenrir",
    "am_michael",
    "am_onyx",
    "am_echo",
    "bf_emma",
    "bf_isabella",
    "bm_george",
    "bm_fable",
    "hf_alpha",
    "hf_beta",
    "hm_omega",
    "hm_psi",
]

VOICE_META: Dict[str, Dict[str, str]] = {
    "af_heart": {"name": "Lyra US", "accent": "American English", "gender": "Female", "lang": "a"},
    "af_bella": {"name": "Kaia US", "accent": "American English", "gender": "Female", "lang": "a"},
    "af_nova": {"name": "Mira US", "accent": "American English", "gender": "Female", "lang": "a"},
    "af_sarah": {"name": "Zoya US", "accent": "American English", "gender": "Female", "lang": "a"},
    "am_fenrir": {"name": "Rian US", "accent": "American English", "gender": "Male", "lang": "a"},
    "am_michael": {"name": "Lucan US", "accent": "American English", "gender": "Male", "lang": "a"},
    "am_onyx": {"name": "Soren US", "accent": "American English", "gender": "Male", "lang": "a"},
    "am_echo": {"name": "Darian US", "accent": "American English", "gender": "Male", "lang": "a"},
    "bf_emma": {"name": "Elara UK", "accent": "British English", "gender": "Female", "lang": "b"},
    "bf_isabella": {"name": "Cora UK", "accent": "British English", "gender": "Female", "lang": "b"},
    "bm_george": {"name": "Alden UK", "accent": "British English", "gender": "Male", "lang": "b"},
    "bm_fable": {"name": "Osric UK", "accent": "British English", "gender": "Male", "lang": "b"},
    "hf_alpha": {"name": "Kavya IN", "accent": "Hindi", "gender": "Female", "lang": "h"},
    "hf_beta": {"name": "Isha IN", "accent": "Hindi", "gender": "Female", "lang": "h"},
    "hm_omega": {"name": "Aarav IN", "accent": "Hindi", "gender": "Male", "lang": "h"},
    "hm_psi": {"name": "Veer IN", "accent": "Hindi", "gender": "Male", "lang": "h"},
}

HINDI_LANGUAGE_HINTS = {
    "hi",
    "hin",
    "hindi",
    "hinglish",
    "hi-latn",
    "bn",
    "ta",
    "te",
    "mr",
    "gu",
    "kn",
    "ml",
    "pa",
    "or",
    "ur",
    "ne",
    "si",
}

VOICE_ALIAS_TO_ID: Dict[str, str] = {}
for _voice_id, _meta in VOICE_META.items():
    for _raw_alias in {_voice_id, str(_meta.get("name") or "")}:
        _normalized_alias = re.sub(r"[^a-z0-9]+", "", str(_raw_alias or "").strip().lower())
        if _normalized_alias:
            VOICE_ALIAS_TO_ID.setdefault(_normalized_alias, _voice_id)

HINDI_DIGIT_WORDS = {
    "0": "\u0936\u0942\u0928\u094d\u092f",
    "1": "\u090f\u0915",
    "2": "\u0926\u094b",
    "3": "\u0924\u0940\u0928",
    "4": "\u091a\u093e\u0930",
    "5": "\u092a\u093e\u0901\u091a",
    "6": "\u091b\u0939",
    "7": "\u0938\u093e\u0924",
    "8": "\u0906\u0920",
    "9": "\u0928\u094c",
}

VIRAMA = "\u094d"
ANUSVARA = "\u0902"
CHANDRABINDU = "\u0901"
VISARGA = "\u0903"

DEVANAGARI_TO_ROMAN: Dict[str, str] = {
    "\u0905": "a",
    "\u0906": "aa",
    "\u0907": "i",
    "\u0908": "ii",
    "\u0909": "u",
    "\u090a": "uu",
    "\u090f": "e",
    "\u0910": "ai",
    "\u0913": "o",
    "\u0914": "au",
    "\u090b": "ri",
    "\u0915": "k",
    "\u0916": "kh",
    "\u0917": "g",
    "\u0918": "gh",
    "\u0919": "ng",
    "\u091a": "ch",
    "\u091b": "chh",
    "\u091c": "j",
    "\u091d": "jh",
    "\u091e": "ny",
    "\u091f": "t",
    "\u0920": "th",
    "\u0921": "d",
    "\u0922": "dh",
    "\u0923": "n",
    "\u0924": "t",
    "\u0925": "th",
    "\u0926": "d",
    "\u0927": "dh",
    "\u0928": "n",
    "\u092a": "p",
    "\u092b": "ph",
    "\u092c": "b",
    "\u092d": "bh",
    "\u092e": "m",
    "\u092f": "y",
    "\u0930": "r",
    "\u0932": "l",
    "\u0935": "v",
    "\u0936": "sh",
    "\u0937": "sh",
    "\u0938": "s",
    "\u0939": "h",
    "\u0958": "q",
    "\u0959": "kh",
    "\u095a": "gh",
    "\u095b": "z",
    "\u095c": "r",
    "\u095d": "rh",
    "\u095e": "f",
    "\u095f": "y",
}

DEVANAGARI_MATRAS: Dict[str, str] = {
    "\u093e": "aa",
    "\u093f": "i",
    "\u0940": "ii",
    "\u0941": "u",
    "\u0942": "uu",
    "\u0943": "ri",
    "\u0947": "e",
    "\u0948": "ai",
    "\u094b": "o",
    "\u094c": "au",
    "\u0946": "e",
    "\u094a": "o",
}

DEVANAGARI_INDEPENDENT_VOWELS = {
    "\u0905",
    "\u0906",
    "\u0907",
    "\u0908",
    "\u0909",
    "\u090a",
    "\u090f",
    "\u0910",
    "\u0913",
    "\u0914",
    "\u090b",
}


def _contains_devanagari(text: str) -> bool:
    return bool(re.search(r"[\u0900-\u097F]", str(text or "")))


def _expand_digits_for_hindi_romanization(text: str) -> str:
    def replace_digit(match: re.Match[str]) -> str:
        ch = match.group(0)
        if "0" <= ch <= "9":
            return HINDI_DIGIT_WORDS.get(ch, ch)
        code = ord(ch)
        if 0x0966 <= code <= 0x096F:
            return HINDI_DIGIT_WORDS.get(str(code - 0x0966), ch)
        return ch

    return re.sub(r"[0-9\u0966-\u096f]", replace_digit, str(text or ""))


def _transliterate_hindi_to_roman(text: str) -> str:
    source = _expand_digits_for_hindi_romanization(text)
    output: List[str] = []
    index = 0

    while index < len(source):
        ch = source[index]
        if ch in {ANUSVARA, CHANDRABINDU}:
            output.append("n")
            index += 1
            continue
        if ch == VISARGA:
            output.append("h")
            index += 1
            continue

        base = DEVANAGARI_TO_ROMAN.get(ch)
        if not base:
            output.append(ch)
            index += 1
            continue

        if ch in DEVANAGARI_INDEPENDENT_VOWELS:
            output.append(base)
            index += 1
            continue

        next_char = source[index + 1] if index + 1 < len(source) else ""
        if next_char == VIRAMA:
            output.append(base)
            index += 2
            continue

        matra = DEVANAGARI_MATRAS.get(next_char) if next_char else None
        if matra:
            output.append(base)
            output.append(matra)
            index += 2
            continue

        output.append(base)
        output.append("a")
        index += 1

    romanized = "".join(output)
    romanized = re.sub(r"\s+", " ", romanized)
    romanized = re.sub(r"\s+([,.!?;:])", r"\1", romanized)
    return romanized.strip()

REQUIRED_MODEL_FILES = [
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    KOKORO_MODEL_FILE,
    *[f"voices/{voice_id}.bin" for voice_id in VOICE_IDS],
]


class SynthesizeRequest(BaseModel):
    text: str = Field(min_length=1)
    voiceId: Optional[str] = None
    voice_id: Optional[str] = None
    speed: float = 1.0
    language: Optional[str] = None
    emotion: Optional[str] = None
    style: Optional[str] = None
    trace_id: Optional[str] = None


class BatchSynthesizeItem(SynthesizeRequest):
    id: Optional[str] = None


class BatchSynthesizeRequest(BaseModel):
    items: List[BatchSynthesizeItem] = Field(min_length=1)
    parallelism: Optional[int] = None


class InputValidationError(RuntimeError):
    def __init__(self, detail: Dict[str, object] | str):
        self.detail = detail
        super().__init__(detail if isinstance(detail, str) else json.dumps(detail, ensure_ascii=True))


class SynthesisTimeoutError(RuntimeError):
    def __init__(self, detail: Dict[str, object]):
        self.detail = detail
        super().__init__(json.dumps(detail, ensure_ascii=True))


class KokoroFullRuntime:
    def __init__(self) -> None:
        self.ready = False
        self.error: Optional[str] = None
        self.loading = False
        self._standby = False
        self._pipelines: Dict[str, object] = {}
        self._pipeline_lock = threading.Lock()
        self._dependency_lock = threading.Lock()
        self._pause_cache: Dict[int, object] = {}
        self._pause_cache_lock = threading.Lock()
        self._synth_semaphore = threading.BoundedSemaphore(KOKORO_MAX_ACTIVE_SYNTH)
        self._pipeline_cls = None
        self._np = None
        self._sf = None
        self._pipeline_device = "cpu"
        self._activity_lock = threading.Lock()
        self._active_synth = 0
        self._last_used_at_ms = 0
        self._idle_unload_deadline_ms = 0
        self._idle_unload_timer: Optional[threading.Timer] = None

    def _cancel_idle_unload(self) -> None:
        timer: Optional[threading.Timer] = None
        with self._activity_lock:
            timer = self._idle_unload_timer
            self._idle_unload_timer = None
            self._idle_unload_deadline_ms = 0
        if timer is not None:
            timer.cancel()

    def _touch(self) -> int:
        now_ms = int(time.time() * 1000)
        with self._activity_lock:
            self._last_used_at_ms = now_ms
        return now_ms

    def _begin_active_use(self) -> None:
        self._cancel_idle_unload()
        with self._activity_lock:
            self._active_synth += 1

    def _end_active_use(self) -> None:
        with self._activity_lock:
            self._active_synth = max(0, self._active_synth - 1)

    def _release_runtime(self, reason: str = "idle") -> bool:
        self._cancel_idle_unload()
        with self._dependency_lock:
            with self._activity_lock:
                if self.loading or self._active_synth > 0:
                    return False
            self._pipelines.clear()
            with self._pause_cache_lock:
                self._pause_cache.clear()
            self._pipeline_cls = None
            self._np = None
            self._sf = None
            self.ready = False
            self.error = None
            self._standby = reason == "idle"
        return True

    def _idle_unload_callback(self) -> None:
        try:
            released = self._release_runtime("idle")
            if released:
                _emit_stage_event(
                    "kokoro_idle_unload",
                    "idle_unload",
                    "done",
                    {"idleUnloadMs": KOKORO_IDLE_UNLOAD_MS},
                )
        except Exception:
            return

    def _schedule_idle_unload(self) -> None:
        if KOKORO_IDLE_UNLOAD_MS <= 0:
            return
        self._cancel_idle_unload()
        with self._activity_lock:
            if not self.ready or self.loading or self._active_synth > 0:
                return
            deadline_ms = int(time.time() * 1000) + KOKORO_IDLE_UNLOAD_MS
            timer = threading.Timer(float(KOKORO_IDLE_UNLOAD_MS) / 1000.0, self._idle_unload_callback)
            timer.daemon = True
            self._idle_unload_timer = timer
            self._idle_unload_deadline_ms = deadline_ms
        timer.start()

    def runtime_state(self) -> Dict[str, object]:
        with self._activity_lock:
            idle_deadline_ms = int(self._idle_unload_deadline_ms or 0)
            last_used_at_ms = int(self._last_used_at_ms or 0)
            active_synth = int(self._active_synth)
            idle_unload_scheduled = self._idle_unload_timer is not None and idle_deadline_ms > 0
        return {
            "device": "cpu",
            "deviceMode": KOKORO_DEVICE,
            "provider": "cpu",
            "providerPreference": ["cpu"],
            "gpuEnabled": False,
            "openvinoEnabled": False,
            "idleUnloadMs": KOKORO_IDLE_UNLOAD_MS,
            "idleUnloadScheduled": idle_unload_scheduled,
            "idleUnloadDeadlineMs": idle_deadline_ms or None,
            "lastUsedAtMs": last_used_at_ms or None,
            "activeSynth": active_synth,
            "standby": bool(self._standby),
        }

    def _load_dependencies(self) -> None:
        if self.ready and self._pipeline_cls is not None and self._np is not None and self._sf is not None:
            self._touch()
            self._schedule_idle_unload()
            return
        self._cancel_idle_unload()
        with self._dependency_lock:
            if self.ready and self._pipeline_cls is not None and self._np is not None and self._sf is not None:
                self._touch()
                self._schedule_idle_unload()
                return
            self.loading = True
            self.error = None
            self._standby = False
            try:
                from kokoro import KPipeline  # type: ignore
                import numpy as np  # type: ignore
                import soundfile as sf  # type: ignore

                self._pipeline_cls = KPipeline
                self._np = np
                self._sf = sf
                self.ready = True
                self._touch()
            except Exception as exc:  # noqa: BLE001
                self.ready = False
                self.error = f"kokoro import failed: {exc}"
                raise
            finally:
                self.loading = False
        self._schedule_idle_unload()

    def warm_in_background(self) -> None:
        if self.ready or self.loading:
            return
        self.loading = True

        def preload() -> None:
            try:
                self._load_dependencies()
            except Exception:
                return

        threading.Thread(target=preload, name="kokoro-runtime-preload", daemon=True).start()

    def _lang_for_voice(self, voice_id: str) -> str:
        canonical_voice_id = self._canonical_voice_id(voice_id)
        meta = VOICE_META.get(canonical_voice_id)
        if meta:
            return meta["lang"]
        if canonical_voice_id.startswith("bf_") or canonical_voice_id.startswith("bm_"):
            return "b"
        if canonical_voice_id.startswith("hf_") or canonical_voice_id.startswith("hm_"):
            return "h"
        return "a"

    def _canonical_voice_id(self, voice_id: str) -> str:
        raw = str(voice_id or "").strip()
        if not raw:
            return ""
        if raw in VOICE_META:
            return raw
        normalized = re.sub(r"[^a-z0-9]+", "", raw.lower())
        return VOICE_ALIAS_TO_ID.get(normalized, raw)

    def _gender_for_voice(self, voice_id: str) -> str:
        canonical_voice_id = self._canonical_voice_id(voice_id)
        meta = VOICE_META.get(canonical_voice_id)
        gender = str(meta.get("gender") or "").strip().lower() if meta else ""
        if gender in {"female", "male"}:
            return gender
        if canonical_voice_id.startswith(("af_", "bf_", "hf_")):
            return "female"
        if canonical_voice_id.startswith(("am_", "bm_", "hm_")):
            return "male"
        return "unknown"

    def _lang_from_hint(self, voice_id: str, language_hint: Optional[str]) -> str:
        hint = str(language_hint or "").strip().lower()
        if not hint:
            return ""
        base = hint.split("-", 1)[0].split("_", 1)[0]
        if hint in HINDI_LANGUAGE_HINTS or base in HINDI_LANGUAGE_HINTS:
            return "h"
        if hint.startswith("en") or base == "en" or hint == "english":
            voice_lang = self._lang_for_voice(voice_id)
            return voice_lang if voice_lang in {"a", "b"} else "a"
        return ""

    def _resolve_compatible_voice(self, voice_id: str, lang_code: str) -> str:
        canonical_voice_id = self._canonical_voice_id(voice_id)
        safe_lang_code = str(lang_code or "").strip().lower() or "a"
        gender = self._gender_for_voice(canonical_voice_id)

        if safe_lang_code == "h":
            if canonical_voice_id.startswith(("hf_", "hm_")):
                return canonical_voice_id or ("hm_omega" if gender == "male" else "hf_alpha")
            if canonical_voice_id in {"af_bella", "af_sarah", "bf_isabella"}:
                return "hf_beta"
            if canonical_voice_id in {"am_michael", "am_echo", "bm_fable"}:
                return "hm_psi"
            if gender == "male":
                return "hm_omega"
            return "hf_alpha"

        if safe_lang_code == "b":
            if canonical_voice_id.startswith(("bf_", "bm_")):
                return canonical_voice_id or ("bm_george" if gender == "male" else "bf_emma")
            if canonical_voice_id in {"hf_beta"}:
                return "bf_isabella"
            if canonical_voice_id in {"hm_psi"}:
                return "bm_fable"
            if gender == "male":
                return "bm_george"
            return "bf_emma"

        if canonical_voice_id.startswith(("af_", "am_")):
            return canonical_voice_id
        if canonical_voice_id in {"hf_beta", "bf_isabella"}:
            return "af_bella"
        if canonical_voice_id in {"hm_psi", "bm_fable"}:
            return "am_michael"
        if gender == "male":
            return "am_fenrir"
        return "af_heart"

    def resolve_lang(self, text: str, voice_id: str, language_hint: Optional[str]) -> str:
        canonical_voice_id = self._canonical_voice_id(voice_id)
        hinted_lang = self._lang_from_hint(canonical_voice_id, language_hint)
        if hinted_lang:
            return hinted_lang
        if re.search(r"[\u0900-\u097F]", text):
            return "h"
        return self._lang_for_voice(canonical_voice_id)

    def resolve_voice(self, voice_id: str, lang_code: str) -> str:
        return self._resolve_compatible_voice(voice_id, lang_code)

    def normalize_text(self, text: str, lang_code: str) -> str:
        cleaned = (
            unicodedata.normalize("NFC", text)
            .replace("\u200c", "")
            .replace("\u200d", "")
            .replace("\u0964", ". ")
            .replace("\u0965", ". ")
            .replace("\u201c", '"')
            .replace("\u201d", '"')
            .replace("\u2018", "'")
            .replace("\u2019", "'")
        )
        cleaned = re.sub(r"\s+", " ", cleaned).strip()

        if lang_code == "h":
            cleaned = _transliterate_hindi_to_roman(cleaned) if _contains_devanagari(cleaned) else _expand_digits_for_hindi_romanization(cleaned)
        return cleaned

    def chunk_text(self, text: str, lang_code: str) -> List[str]:
        return chunk_text_for_tts(text=text, lang_code=lang_code)

    def _split_segment_for_line_safety(self, text: str) -> List[str]:
        pieces = [chunk.strip() for chunk in re.findall(r"[^.!?,;:\n]+[.!?,;:]?", str(text or "")) if chunk.strip()]
        return pieces or [str(text or "").strip()]

    def clamp_speed(self, speed: float) -> float:
        return max(0.75, min(1.35, float(speed or 1.0)))

    def _pause_ms_for_text(self, text: str, lang_code: str) -> int:
        token = str(text or "").strip()
        if not token:
            return 0
        if re.search(r"[.!?\u0964\u0965]\s*$", token):
            return 130 if lang_code == "h" else 110
        if re.search(r"[,;:]\s*$", token):
            return 65 if lang_code == "h" else 50
        return 34 if lang_code == "h" else 25

    def _pause_array(self, pause_ms: int):
        if self._np is None:
            return None
        safe_ms = max(0, int(pause_ms))
        if safe_ms <= 0:
            return None
        cached = self._pause_cache.get(safe_ms)
        if cached is not None:
            return cached
        sample_count = max(1, int((float(KOKORO_SAMPLE_RATE) * float(safe_ms)) / 1000.0))
        pause = self._np.zeros(sample_count, dtype=self._np.float32)
        with self._pause_cache_lock:
            existing = self._pause_cache.get(safe_ms)
            if existing is not None:
                return existing
            self._pause_cache[safe_ms] = pause
        return pause

    def _merge_with_crossfade(self, chunks: List[Tuple[object, bool]], crossfade_ms: int):
        if self._np is None:
            raise RuntimeError("numpy unavailable")
        if not chunks:
            return self._np.zeros(1, dtype=self._np.float32)
        safe_crossfade_ms = max(0, int(crossfade_ms))
        crossfade_samples = max(0, int((float(KOKORO_SAMPLE_RATE) * float(safe_crossfade_ms)) / 1000.0))
        if len(chunks) == 1:
            return self._np.asarray(chunks[0][0], dtype=self._np.float32).reshape(-1), "concatenate"
        if crossfade_samples <= 0:
            arrays = []
            for raw_chunk, _ in chunks:
                arr = self._np.asarray(raw_chunk, dtype=self._np.float32).reshape(-1)
                if arr.size > 0:
                    arrays.append(arr)
            if not arrays:
                return self._np.zeros(1, dtype=self._np.float32), "concatenate"
            return self._np.concatenate(arrays), "concatenate"
        merged = self._np.asarray(chunks[0][0], dtype=self._np.float32).reshape(-1)
        merged_is_pause = bool(chunks[0][1])
        finalized_chunks: List[object] = []
        merge_strategy = "concatenate"

        for raw_chunk, is_pause in chunks[1:]:
            next_chunk = self._np.asarray(raw_chunk, dtype=self._np.float32).reshape(-1)
            if next_chunk.size <= 0:
                continue
            if merged.size <= 0:
                merged = next_chunk
                merged_is_pause = bool(is_pause)
                continue
            if merged_is_pause or is_pause:
                finalized_chunks.append(merged)
                merged = next_chunk
                merged_is_pause = bool(is_pause)
                continue

            overlap = min(crossfade_samples, int(merged.size), int(next_chunk.size))
            if overlap <= 0:
                finalized_chunks.append(merged)
                merged = next_chunk
                merged_is_pause = bool(is_pause)
                continue

            fade_out = self._np.linspace(1.0, 0.0, overlap, endpoint=False, dtype=self._np.float32)
            fade_in = 1.0 - fade_out
            mixed = (merged[-overlap:] * fade_out) + (next_chunk[:overlap] * fade_in)
            merged = self._np.concatenate([merged[:-overlap], mixed, next_chunk[overlap:]])
            merged_is_pause = False
            merge_strategy = "overlap_add_crossfade"
        finalized_chunks.append(merged)
        if len(finalized_chunks) == 1:
            return finalized_chunks[0], merge_strategy
        return self._np.concatenate(finalized_chunks), merge_strategy

    def _pipeline_for(self, lang_code: str):
        if not self.ready or self._pipeline_cls is None:
            self._load_dependencies()
        if not self.ready or self._pipeline_cls is None:
            raise RuntimeError(self.error or "kokoro runtime unavailable")
        pipeline = self._pipelines.get(lang_code)
        if pipeline is not None:
            return pipeline
        with self._pipeline_lock:
            pipeline = self._pipelines.get(lang_code)
            if pipeline is None:
                pipeline = self._pipeline_cls(lang_code=lang_code, device=self._pipeline_device)
                self._pipelines[lang_code] = pipeline
            return pipeline

    def synthesize(
        self,
        text: str,
        voice_id: str,
        speed: float,
        language_hint: Optional[str],
        trace_id: Optional[str] = None,
    ) -> Tuple[bytes, Dict[str, object]]:
        self._begin_active_use()
        acquired_slot = False
        try:
            if not self.ready or self._np is None or self._sf is None:
                self._load_dependencies()
            if not self.ready or self._np is None or self._sf is None:
                raise RuntimeError(self.error or "kokoro runtime unavailable")

            safe_trace_id = _normalize_trace_id(trace_id)
            synth_started_ms = int(time.monotonic() * 1000)
            slot_wait_started = time.monotonic()
            acquired_slot = self._synth_semaphore.acquire(timeout=max(1.0, float(KOKORO_SYNTH_MAX_MS) / 1000.0))
            if not acquired_slot:
                raise RuntimeError("Kokoro synthesis concurrency slot timed out.")
            semaphore_wait_ms = max(0, int((time.monotonic() - slot_wait_started) * 1000))

            def ensure_runtime_budget(
                *,
                stage: str,
                chunk_index: Optional[int] = None,
                chunk_total: Optional[int] = None,
                part_index: Optional[int] = None,
                part_total: Optional[int] = None,
            ) -> None:
                elapsed_ms = max(0, int(time.monotonic() * 1000) - synth_started_ms)
                if elapsed_ms <= KOKORO_SYNTH_MAX_MS:
                    return
                detail: Dict[str, object] = {
                    "error": "Kokoro synthesis timed out.",
                    "errorCode": "KOKORO_SYNTH_TIMEOUT",
                    "classification": "timeout",
                    "trace_id": safe_trace_id,
                    "maxMs": int(KOKORO_SYNTH_MAX_MS),
                    "elapsedMs": int(elapsed_ms),
                    "stage": str(stage or "synthesis"),
                }
                if chunk_index is not None:
                    detail["chunkIndex"] = int(chunk_index)
                if chunk_total is not None:
                    detail["chunkTotal"] = int(chunk_total)
                if part_index is not None:
                    detail["partIndex"] = int(part_index)
                if part_total is not None:
                    detail["partTotal"] = int(part_total)
                raise SynthesisTimeoutError(detail)

            lang_code = self.resolve_lang(text, voice_id, language_hint)
            selected_voice = self.resolve_voice(voice_id, lang_code)
            normalized_text = self.normalize_text(text, lang_code)
            word_count = count_words(normalized_text)
            if word_count > MAX_WORDS_PER_REQUEST:
                raise InputValidationError(
                    {
                        "error": "word_limit_exceeded",
                        "maxWords": MAX_WORDS_PER_REQUEST,
                        "actualWords": word_count,
                    }
                )
            segments = self.chunk_text(normalized_text, lang_code)
            chunk_profile = resolve_chunk_profile(lang_code=lang_code, text=normalized_text)
            chunk_max_chars = max((len(segment) for segment in segments), default=0)
            _emit_stage_event(
                safe_trace_id,
                "preprocess",
                "done",
                {
                    "lang": lang_code,
                    "wordCount": word_count,
                    "chunkCount": len(segments),
                    "chunkMaxChars": chunk_max_chars,
                    "voiceId": selected_voice,
                    "semaphoreWaitMs": semaphore_wait_ms,
                },
            )
            pipeline = self._pipeline_for(lang_code)

            audio_chunks: List[Tuple[object, bool]] = []
            phoneme_chars = 0
            pause_insertions = 0
            join_crossfade_ms = int(chunk_profile.get("join_crossfade_ms", 0))
            clamped_speed = self.clamp_speed(speed)

            def synthesize_piece(
                piece_text: str,
                *,
                stage_label: str,
                split_pattern: str = r"\n+",
                chunk_index: Optional[int] = None,
                chunk_total: Optional[int] = None,
                part_index: Optional[int] = None,
                part_total: Optional[int] = None,
            ) -> Tuple[List[object], int]:
                ensure_runtime_budget(
                    stage=stage_label,
                    chunk_index=chunk_index,
                    chunk_total=chunk_total,
                    part_index=part_index,
                    part_total=part_total,
                )
                local_audio_chunks: List[object] = []
                local_phoneme_chars = 0
                generator = pipeline(
                    piece_text,
                    voice=selected_voice,
                    speed=clamped_speed,
                    split_pattern=split_pattern,
                )
                for _, phonemes, audio in generator:
                    ensure_runtime_budget(
                        stage=stage_label,
                        chunk_index=chunk_index,
                        chunk_total=chunk_total,
                        part_index=part_index,
                        part_total=part_total,
                    )
                    if phonemes is not None:
                        local_phoneme_chars += len(str(phonemes))
                    arr = self._np.asarray(audio, dtype=self._np.float32).reshape(-1)
                    if arr.size > 0:
                        local_audio_chunks.append(arr)
                if not local_audio_chunks:
                    raise RuntimeError("Kokoro returned empty audio for segment piece.")
                return local_audio_chunks, local_phoneme_chars

            for chunk_index, segment in enumerate(segments, start=1):
                ensure_runtime_budget(
                    stage="chunk_synthesis",
                    chunk_index=chunk_index,
                    chunk_total=len(segments),
                )
                _emit_stage_event(
                    safe_trace_id,
                    "chunk_synthesis",
                    "start",
                    {
                        "chunkIndex": chunk_index,
                        "chunkTotal": len(segments),
                        "chunkChars": len(segment),
                        "attempt": 1,
                    },
                )
                used_fallback = False
                try:
                    chunk_audio, chunk_phoneme_chars = synthesize_piece(
                        segment,
                        stage_label="chunk_synthesis",
                        split_pattern=r"\n+",
                        chunk_index=chunk_index,
                        chunk_total=len(segments),
                    )
                    audio_chunks.extend((item, False) for item in chunk_audio)
                    phoneme_chars += chunk_phoneme_chars
                except Exception as exc:  # noqa: BLE001
                    message = str(exc or "").strip()
                    if "number of lines in input and output must be equal" not in message.lower():
                        raise
                    used_fallback = True
                    fallback_parts = self._split_segment_for_line_safety(segment)
                    _emit_stage_event(
                        safe_trace_id,
                        "chunk_synthesis",
                        "retry",
                        {
                            "chunkIndex": chunk_index,
                            "chunkTotal": len(segments),
                            "chunkChars": len(segment),
                            "attempt": 2,
                            "reason": "line_mismatch",
                            "parts": len(fallback_parts),
                        },
                    )
                    for part_index, part in enumerate(fallback_parts, start=1):
                        ensure_runtime_budget(
                            stage="chunk_fallback",
                            chunk_index=chunk_index,
                            chunk_total=len(segments),
                            part_index=part_index,
                            part_total=len(fallback_parts),
                        )
                        if not part:
                            continue
                        chunk_audio, chunk_phoneme_chars = synthesize_piece(
                            part,
                            stage_label="chunk_fallback",
                            split_pattern=r"[.!?,;:]+",
                            chunk_index=chunk_index,
                            chunk_total=len(segments),
                            part_index=part_index,
                            part_total=len(fallback_parts),
                        )
                        audio_chunks.extend((item, False) for item in chunk_audio)
                        phoneme_chars += chunk_phoneme_chars
                        pause_ms = self._pause_ms_for_text(part, lang_code)
                        if part_index < len(fallback_parts) and pause_ms > 0:
                            pause = self._pause_array(pause_ms)
                            if pause is not None:
                                audio_chunks.append((pause, True))
                                pause_insertions += 1
                pause_ms = self._pause_ms_for_text(segment, lang_code)
                if chunk_index < len(segments) and pause_ms > 0:
                    pause = self._pause_array(pause_ms)
                    if pause is not None:
                        audio_chunks.append((pause, True))
                        pause_insertions += 1
                _emit_stage_event(
                    safe_trace_id,
                    "chunk_synthesis",
                    "done",
                    {
                        "chunkIndex": chunk_index,
                        "chunkTotal": len(segments),
                        "chunkChars": len(segment),
                        "attempt": 1,
                        "fallback": used_fallback,
                    },
                )

            if not audio_chunks:
                raise RuntimeError("Kokoro full runtime returned empty audio.")

            ensure_runtime_budget(stage="merge")
            merged, merge_strategy = self._merge_with_crossfade(audio_chunks, join_crossfade_ms)
            ensure_runtime_budget(stage="serialize")
            buffer = io.BytesIO()
            self._sf.write(buffer, merged, KOKORO_SAMPLE_RATE, format="WAV", subtype="PCM_16")

            meta = {
                "impl": "kokoro-full",
                "lang_code": lang_code,
                "voice": selected_voice,
                "segments": len(segments),
                "chunk_profile": chunk_profile,
                "chunk_max_chars": chunk_max_chars,
                "phoneme_chars": phoneme_chars,
                "word_count": word_count,
                "sample_rate": KOKORO_SAMPLE_RATE,
                "chunkCount": len(segments),
                "chunkMaxChars": chunk_max_chars,
                "joinCrossfadeMs": join_crossfade_ms,
                "pauseInsertions": pause_insertions,
                "mergeStrategy": merge_strategy,
                "semaphoreWaitMs": semaphore_wait_ms,
                "provider": "cpu",
                "providerPreference": ["cpu"],
            }
            self._touch()
            return buffer.getvalue(), meta
        finally:
            if acquired_slot:
                self._synth_semaphore.release()
            self._end_active_use()
            self._schedule_idle_unload()


kokoro_full = KokoroFullRuntime()


@asynccontextmanager
async def app_lifespan(_: FastAPI):
    kokoro_full.warm_in_background()
    yield


app = FastAPI(title=APP_NAME, lifespan=app_lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins("VF_CORS_ORIGINS"),
    allow_origin_regex=LOCALHOST_CORS_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> JSONResponse:
    runtime_state = kokoro_full.runtime_state()
    if kokoro_full.ready:
        return JSONResponse(
            {
                "ok": True,
                "ready": True,
                "status": "ready",
                "engine": APP_NAME,
                "device": runtime_state["device"],
                "device_mode": runtime_state["deviceMode"],
                "provider": runtime_state["provider"],
                "provider_preference": runtime_state["providerPreference"],
                "gpu_enabled": runtime_state["gpuEnabled"],
                "openvino_enabled": runtime_state["openvinoEnabled"],
                "idle_unload_ms": runtime_state["idleUnloadMs"],
                "idle_unload_scheduled": runtime_state["idleUnloadScheduled"],
                "idle_unload_deadline_ms": runtime_state["idleUnloadDeadlineMs"],
                "last_used_at_ms": runtime_state["lastUsedAtMs"],
                "active_synth": runtime_state["activeSynth"],
                "impl": "kokoro-full",
                "hindi": True,
                "voices": len(VOICE_IDS),
                "max_active_synth": KOKORO_MAX_ACTIVE_SYNTH,
            }
        )

    if runtime_state["standby"] and not kokoro_full.error:
        return JSONResponse(
            {
                "ok": True,
                "ready": False,
                "status": "standby",
                "engine": APP_NAME,
                "device": runtime_state["device"],
                "device_mode": runtime_state["deviceMode"],
                "provider": runtime_state["provider"],
                "provider_preference": runtime_state["providerPreference"],
                "gpu_enabled": runtime_state["gpuEnabled"],
                "openvino_enabled": runtime_state["openvinoEnabled"],
                "idle_unload_ms": runtime_state["idleUnloadMs"],
                "idle_unload_scheduled": runtime_state["idleUnloadScheduled"],
                "idle_unload_deadline_ms": runtime_state["idleUnloadDeadlineMs"],
                "last_used_at_ms": runtime_state["lastUsedAtMs"],
                "active_synth": runtime_state["activeSynth"],
                "impl": "kokoro-full",
                "hindi": True,
                "voices": len(VOICE_IDS),
                "max_active_synth": KOKORO_MAX_ACTIVE_SYNTH,
            }
        )

    if kokoro_full.loading and not kokoro_full.error:
        return JSONResponse(
            {
                "ok": True,
                "ready": False,
                "status": "warming",
                "engine": APP_NAME,
                "device": runtime_state["device"],
                "device_mode": runtime_state["deviceMode"],
                "provider": runtime_state["provider"],
                "provider_preference": runtime_state["providerPreference"],
                "gpu_enabled": runtime_state["gpuEnabled"],
                "openvino_enabled": runtime_state["openvinoEnabled"],
                "idle_unload_ms": runtime_state["idleUnloadMs"],
                "idle_unload_scheduled": runtime_state["idleUnloadScheduled"],
                "idle_unload_deadline_ms": runtime_state["idleUnloadDeadlineMs"],
                "last_used_at_ms": runtime_state["lastUsedAtMs"],
                "active_synth": runtime_state["activeSynth"],
                "impl": "kokoro-full",
                "hindi": True,
                "voices": len(VOICE_IDS),
                "max_active_synth": KOKORO_MAX_ACTIVE_SYNTH,
            }
        )

    return JSONResponse(
        {
            "ok": False,
            "ready": False,
            "status": "unhealthy",
            "engine": APP_NAME,
            "device": runtime_state["device"],
            "device_mode": runtime_state["deviceMode"],
            "provider": runtime_state["provider"],
            "provider_preference": runtime_state["providerPreference"],
            "gpu_enabled": runtime_state["gpuEnabled"],
            "openvino_enabled": runtime_state["openvinoEnabled"],
            "idle_unload_ms": runtime_state["idleUnloadMs"],
            "idle_unload_scheduled": runtime_state["idleUnloadScheduled"],
            "idle_unload_deadline_ms": runtime_state["idleUnloadDeadlineMs"],
            "last_used_at_ms": runtime_state["lastUsedAtMs"],
            "active_synth": runtime_state["activeSynth"],
            "impl": "kokoro-full",
            "hindi": True,
            "voices": len(VOICE_IDS),
            "error": kokoro_full.error or "Kokoro runtime init failed.",
        }
    )


@app.get("/v1/voices")
def voices() -> JSONResponse:
    items = []
    for voice_id in VOICE_IDS:
        meta = VOICE_META.get(voice_id, {})
        items.append(
            {
                "voice_id": voice_id,
                "voice": voice_id,
                "name": meta.get("name", voice_id),
                "language": "hi" if meta.get("lang") == "h" else "en",
                "accent": meta.get("accent", "Unknown"),
                "gender": meta.get("gender", "Unknown"),
            }
        )
    return JSONResponse({"voices": items})


@app.get("/v1/capabilities")
def capabilities() -> JSONResponse:
    runtime_state = kokoro_full.runtime_state()
    return JSONResponse(
        {
            "engine": "KOKORO",
            "runtime": APP_NAME,
            "ready": bool(kokoro_full.ready),
            "languages": ["en", "hi"],
            "speed": {"min": 0.75, "max": 1.35, "default": 1.0},
            "supportsEmotion": False,
            "supportsStyle": False,
            "supportsSpeakerWav": False,
            "supportsBatchSynthesis": True,
            "batchEndpoint": "/synthesize/batch",
            "batchMaxItems": KOKORO_BATCH_MAX_ITEMS,
            "batchDefaultParallelism": KOKORO_BATCH_DEFAULT_PARALLEL,
            "batchMaxParallelism": KOKORO_BATCH_MAX_PARALLEL,
            "maxActiveSynth": KOKORO_MAX_ACTIVE_SYNTH,
            "model": "kokoro-full",
            "voiceCount": len(VOICE_IDS),
            "emotionCount": 0,
            "metadata": {
                "deviceMode": runtime_state["deviceMode"],
                "device": runtime_state["device"],
                "provider": runtime_state["provider"],
                "providerPreference": runtime_state["providerPreference"],
                "gpuEnabled": runtime_state["gpuEnabled"],
                "openvinoEnabled": runtime_state["openvinoEnabled"],
                "idleUnloadMs": runtime_state["idleUnloadMs"],
                "idleUnloadScheduled": runtime_state["idleUnloadScheduled"],
                "idleUnloadDeadlineMs": runtime_state["idleUnloadDeadlineMs"],
                "lastUsedAtMs": runtime_state["lastUsedAtMs"],
                "activeSynth": runtime_state["activeSynth"],
                "standby": runtime_state["standby"],
                "sampleRate": KOKORO_SAMPLE_RATE,
                "maxActiveSynth": KOKORO_MAX_ACTIVE_SYNTH,
                "maxWordsPerRequest": MAX_WORDS_PER_REQUEST,
                "segmentationProfile": SEGMENTATION_PROFILE,
                "supportsBatchSynthesis": True,
                "batchEndpoint": "/synthesize/batch",
                "batchMaxItems": KOKORO_BATCH_MAX_ITEMS,
                "batchDefaultParallelism": KOKORO_BATCH_DEFAULT_PARALLEL,
                "batchMaxParallelism": KOKORO_BATCH_MAX_PARALLEL,
                "chunking": {
                    "hi": SEGMENTATION_CHUNKING_PROFILES.get("hi", {}),
                    "default": SEGMENTATION_CHUNKING_PROFILES.get("default", {}),
                },
            },
        }
    )


def _synthesize_item(payload: SynthesizeRequest) -> Tuple[bytes, Dict[str, object], str]:
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is empty")
    trace_id = _normalize_trace_id(payload.trace_id)
    target_voice_id = str(payload.voiceId or payload.voice_id or "hf_alpha").strip() or "hf_alpha"

    if not kokoro_full.ready and kokoro_full.error and not kokoro_full.loading:
        raise HTTPException(
            status_code=503,
            detail=f"Kokoro runtime unavailable: {kokoro_full.error or 'initialization failed'}",
        )

    try:
        _emit_stage_event(trace_id, "preprocess", "start", {"voiceId": target_voice_id, "textChars": len(text)})
        wav_bytes, meta = kokoro_full.synthesize(
            text,
            target_voice_id,
            payload.speed,
            payload.language,
            trace_id=trace_id,
        )
        _emit_stage_event(
            trace_id,
            "completed",
            "ok",
            {
                "lang": meta.get("lang_code"),
                "segments": meta.get("segments"),
                "wordCount": meta.get("word_count"),
                "chunkMaxChars": meta.get("chunk_max_chars"),
                "sampleRate": meta.get("sample_rate"),
            },
        )
        return wav_bytes, meta, trace_id
    except RuntimeError as exc:
        detail = str(exc).strip() or "Kokoro runtime unavailable"
        if "unavailable" in detail.lower() or "import failed" in detail.lower():
            _emit_stage_event(trace_id, "failed", "error", {"error": detail})
            raise HTTPException(status_code=503, detail=f"Kokoro runtime unavailable: {detail}") from exc
        raise
    except InputValidationError as exc:
        detail_payload = exc.detail
        _emit_stage_event(trace_id, "failed", "error", {"error": detail_payload})
        raise HTTPException(status_code=400, detail=detail_payload) from exc
    except SynthesisTimeoutError as exc:
        detail_payload = exc.detail
        _emit_stage_event(trace_id, "failed", "error", {"error": detail_payload})
        raise HTTPException(status_code=504, detail=detail_payload) from exc
    except Exception as exc:  # noqa: BLE001
        detail = f"Kokoro synthesis failed: {exc}"
        _emit_stage_event(trace_id, "failed", "error", {"error": detail})
        raise HTTPException(status_code=500, detail=detail) from exc


@app.post("/synthesize")
def synthesize(payload: SynthesizeRequest) -> Response:
    wav_bytes, meta, trace_id = _synthesize_item(payload)
    diagnostics = {
        "chunkCount": int(meta.get("chunkCount") or 0),
        "chunkMaxChars": int(meta.get("chunkMaxChars") or 0),
        "joinCrossfadeMs": int(meta.get("joinCrossfadeMs") or 0),
        "pauseInsertions": int(meta.get("pauseInsertions") or 0),
        "mergeStrategy": str(meta.get("mergeStrategy") or "concatenate"),
        "semaphoreWaitMs": int(meta.get("semaphoreWaitMs") or 0),
    }
    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "X-VoiceFlow-Trace-Id": trace_id,
            "X-VoiceFlow-Diagnostics": quote(json.dumps(diagnostics, ensure_ascii=True, separators=(",", ":")), safe=""),
        },
    )


@app.post("/synthesize/batch")
def synthesize_batch(payload: BatchSynthesizeRequest) -> JSONResponse:
    items = list(payload.items or [])
    if not items:
        raise HTTPException(status_code=400, detail="items must contain at least one request.")
    if len(items) > KOKORO_BATCH_MAX_ITEMS:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "batch_limit_exceeded",
                "maxItems": KOKORO_BATCH_MAX_ITEMS,
                "actualItems": len(items),
            },
        )

    requested_parallelism = payload.parallelism if payload.parallelism is not None else KOKORO_BATCH_DEFAULT_PARALLEL
    if requested_parallelism < 1:
        raise HTTPException(status_code=400, detail="parallelism must be >= 1.")
    if requested_parallelism > KOKORO_BATCH_MAX_PARALLEL:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "parallelism_limit_exceeded",
                "maxParallelism": KOKORO_BATCH_MAX_PARALLEL,
                "requestedParallelism": requested_parallelism,
            },
        )

    effective_parallelism = max(1, min(int(requested_parallelism), len(items)))

    def run_item(index: int, item: BatchSynthesizeItem) -> Dict[str, Any]:
        item_trace_id = _normalize_trace_id(item.trace_id)
        _emit_stage_event(
            item_trace_id,
            "batch_item",
            "start",
            {"index": index, "parallelism": effective_parallelism},
        )
        try:
            wav_bytes, meta, trace_id = _synthesize_item(item)
            _emit_stage_event(
                trace_id,
                "batch_item",
                "done",
                {"index": index, "bytes": len(wav_bytes), "segments": meta.get("segments")},
            )
            return {
                "index": index,
                "id": item.id,
                "ok": True,
                "audioBase64": base64.b64encode(wav_bytes).decode("ascii"),
                "contentType": "audio/wav",
                "trace_id": trace_id,
                "meta": meta,
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
            detail = str(exc).strip() or "Kokoro batch synthesis failed."
            _emit_stage_event(
                item_trace_id,
                "batch_item",
                "error",
                {"index": index, "statusCode": 500, "error": detail},
            )
            return {
                "index": index,
                "id": item.id,
                "ok": False,
                "trace_id": item_trace_id,
                "error": {
                    "statusCode": 500,
                    "error": detail,
                },
            }

    results: List[Dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=effective_parallelism) as executor:
        futures = [executor.submit(run_item, index, item) for index, item in enumerate(items)]
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())

    ordered_items = sorted(results, key=lambda entry: int(entry.get("index", 0)))
    succeeded = sum(1 for entry in ordered_items if bool(entry.get("ok")))
    failed = len(ordered_items) - succeeded
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
