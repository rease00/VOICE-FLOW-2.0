import io
import base64
import concurrent.futures
import json
import os
import re
import threading
import time
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from segmentation import (
    CHUNKING_PROFILES as SEGMENTATION_CHUNKING_PROFILES,
    MAX_WORDS_PER_REQUEST,
    SEGMENTATION_PROFILE,
    chunk_text_for_tts,
    count_words,
    resolve_chunk_profile,
)

APP_NAME = "kokoro-runtime"
KOKORO_SAMPLE_RATE = int(os.getenv("KOKORO_SAMPLE_RATE", "24000"))
KOKORO_DEVICE = os.getenv("KOKORO_DEVICE", "cpu").strip().lower()
KOKORO_BATCH_MAX_ITEMS = max(1, int(os.getenv("KOKORO_BATCH_MAX_ITEMS", "64")))
KOKORO_BATCH_MAX_PARALLEL = max(1, int(os.getenv("KOKORO_BATCH_MAX_PARALLEL", "2")))
DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


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

# CPU-first by default. Set KOKORO_DEVICE=auto or KOKORO_DEVICE=cuda to allow GPU.
if KOKORO_DEVICE == "cpu":
    os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")

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
    "af_heart": {"name": "Heart", "accent": "American English", "gender": "Female", "lang": "a"},
    "af_bella": {"name": "Bella", "accent": "American English", "gender": "Female", "lang": "a"},
    "af_nova": {"name": "Nova", "accent": "American English", "gender": "Female", "lang": "a"},
    "af_sarah": {"name": "Sarah", "accent": "American English", "gender": "Female", "lang": "a"},
    "am_fenrir": {"name": "Fenrir", "accent": "American English", "gender": "Male", "lang": "a"},
    "am_michael": {"name": "Michael", "accent": "American English", "gender": "Male", "lang": "a"},
    "am_onyx": {"name": "Onyx", "accent": "American English", "gender": "Male", "lang": "a"},
    "am_echo": {"name": "Echo", "accent": "American English", "gender": "Male", "lang": "a"},
    "bf_emma": {"name": "Emma", "accent": "British English", "gender": "Female", "lang": "b"},
    "bf_isabella": {"name": "Isabella", "accent": "British English", "gender": "Female", "lang": "b"},
    "bm_george": {"name": "George", "accent": "British English", "gender": "Male", "lang": "b"},
    "bm_fable": {"name": "Fable", "accent": "British English", "gender": "Male", "lang": "b"},
    "hf_alpha": {"name": "Hindi Alpha", "accent": "Hindi", "gender": "Female", "lang": "h"},
    "hf_beta": {"name": "Hindi Beta", "accent": "Hindi", "gender": "Female", "lang": "h"},
    "hm_omega": {"name": "Hindi Omega", "accent": "Hindi", "gender": "Male", "lang": "h"},
    "hm_psi": {"name": "Hindi Psi", "accent": "Hindi", "gender": "Male", "lang": "h"},
}

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


class KokoroFullRuntime:
    def __init__(self) -> None:
        self.ready = False
        self.error: Optional[str] = None
        self._pipelines: Dict[str, object] = {}
        self._pipeline_lock = threading.Lock()
        self._pipeline_cls = None
        self._np = None
        self._sf = None

        try:
            from kokoro import KPipeline  # type: ignore
            import numpy as np  # type: ignore
            import soundfile as sf  # type: ignore

            self._pipeline_cls = KPipeline
            self._np = np
            self._sf = sf
            self.ready = True
        except Exception as exc:  # noqa: BLE001
            self.error = f"kokoro import failed: {exc}"

    def _lang_for_voice(self, voice_id: str) -> str:
        meta = VOICE_META.get(voice_id)
        if meta:
            return meta["lang"]
        if voice_id.startswith("bf_") or voice_id.startswith("bm_"):
            return "b"
        if voice_id.startswith("hf_") or voice_id.startswith("hm_"):
            return "h"
        return "a"

    def resolve_lang(self, text: str, voice_id: str, language_hint: Optional[str]) -> str:
        hint = (language_hint or "").strip().lower()
        if hint.startswith("hi"):
            return "h"
        if re.search(r"[\u0900-\u097F]", text):
            return "h"
        return self._lang_for_voice(voice_id)

    def resolve_voice(self, voice_id: str, lang_code: str) -> str:
        voice = voice_id if voice_id in VOICE_META else ("hf_alpha" if lang_code == "h" else "af_heart")
        if lang_code == "h" and not (voice.startswith("hf_") or voice.startswith("hm_")):
            return "hf_alpha"
        if lang_code in {"a", "b"} and (voice.startswith("hf_") or voice.startswith("hm_")):
            return "af_heart" if lang_code == "a" else "bf_emma"
        return voice

    def normalize_text(self, text: str, lang_code: str) -> str:
        cleaned = (
            unicodedata.normalize("NFC", text)
            .replace("\u200c", "")
            .replace("\u200d", "")
            .replace("\u0964", ". ")
            .replace("\u0965", ". ")
        )
        cleaned = re.sub(r"\s+", " ", cleaned).strip()

        if lang_code == "h":
            def replace_digit(match: re.Match[str]) -> str:
                ch = match.group(0)
                if "0" <= ch <= "9":
                    return HINDI_DIGIT_WORDS.get(ch, ch)
                code = ord(ch)
                if 0x0966 <= code <= 0x096F:
                    return HINDI_DIGIT_WORDS.get(str(code - 0x0966), ch)
                return ch

            cleaned = re.sub(r"[0-9\u0966-\u096f]", replace_digit, cleaned)
        return cleaned

    def chunk_text(self, text: str, lang_code: str) -> List[str]:
        return chunk_text_for_tts(text=text, lang_code=lang_code)

    def _split_segment_for_line_safety(self, text: str) -> List[str]:
        pieces = [chunk.strip() for chunk in re.findall(r"[^.!?,;:\n]+[.!?,;:]?", str(text or "")) if chunk.strip()]
        return pieces or [str(text or "").strip()]

    def clamp_speed(self, speed: float) -> float:
        return max(0.75, min(1.35, float(speed or 1.0)))

    def _pipeline_for(self, lang_code: str):
        if not self.ready or self._pipeline_cls is None:
            raise RuntimeError(self.error or "kokoro runtime unavailable")
        pipeline = self._pipelines.get(lang_code)
        if pipeline is not None:
            return pipeline
        with self._pipeline_lock:
            pipeline = self._pipelines.get(lang_code)
            if pipeline is None:
                pipeline = self._pipeline_cls(lang_code=lang_code)
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
        if not self.ready or self._np is None or self._sf is None:
            raise RuntimeError(self.error or "kokoro runtime unavailable")

        safe_trace_id = _normalize_trace_id(trace_id)
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
            },
        )
        pipeline = self._pipeline_for(lang_code)

        audio_chunks: List[object] = []
        phoneme_chars = 0

        def synthesize_piece(piece_text: str, split_pattern: str = r"\n+") -> Tuple[List[object], int]:
            local_audio_chunks: List[object] = []
            local_phoneme_chars = 0
            generator = pipeline(
                piece_text,
                voice=selected_voice,
                speed=self.clamp_speed(speed),
                split_pattern=split_pattern,
            )
            for _, phonemes, audio in generator:
                if phonemes is not None:
                    local_phoneme_chars += len(str(phonemes))
                arr = self._np.asarray(audio, dtype=self._np.float32).reshape(-1)
                if arr.size > 0:
                    local_audio_chunks.append(arr)
            if not local_audio_chunks:
                raise RuntimeError("Kokoro returned empty audio for segment piece.")
            return local_audio_chunks, local_phoneme_chars

        for chunk_index, segment in enumerate(segments, start=1):
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
                chunk_audio, chunk_phoneme_chars = synthesize_piece(segment, split_pattern=r"\n+")
                audio_chunks.extend(chunk_audio)
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
                    if not part:
                        continue
                    chunk_audio, chunk_phoneme_chars = synthesize_piece(part, split_pattern=r"[.!?,;:]+")
                    audio_chunks.extend(chunk_audio)
                    phoneme_chars += chunk_phoneme_chars
                    if part_index < len(fallback_parts):
                        pause = self._np.zeros(int(KOKORO_SAMPLE_RATE * 0.025), dtype=self._np.float32)
                        audio_chunks.append(pause)
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

        merged = self._np.concatenate(audio_chunks)
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
        }
        return buffer.getvalue(), meta


kokoro_full = KokoroFullRuntime()
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
    if kokoro_full.ready:
        return JSONResponse(
            {
                "ok": True,
                "engine": APP_NAME,
                "device": "cpu",
                "device_mode": KOKORO_DEVICE,
                "impl": "kokoro-full",
                "hindi": True,
                "voices": len(VOICE_IDS),
            }
        )

    return JSONResponse(
        {
            "ok": False,
            "status": "unhealthy",
            "engine": APP_NAME,
            "device": "cpu",
            "device_mode": KOKORO_DEVICE,
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
            "batchDefaultParallelism": KOKORO_BATCH_MAX_PARALLEL,
            "batchMaxParallelism": KOKORO_BATCH_MAX_PARALLEL,
            "model": "kokoro-full",
            "voiceCount": len(VOICE_IDS),
            "emotionCount": 0,
            "metadata": {
                "deviceMode": KOKORO_DEVICE,
                "sampleRate": KOKORO_SAMPLE_RATE,
                "maxWordsPerRequest": MAX_WORDS_PER_REQUEST,
                "segmentationProfile": SEGMENTATION_PROFILE,
                "supportsBatchSynthesis": True,
                "batchEndpoint": "/synthesize/batch",
                "batchMaxItems": KOKORO_BATCH_MAX_ITEMS,
                "batchDefaultParallelism": KOKORO_BATCH_MAX_PARALLEL,
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

    if not kokoro_full.ready:
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
    except InputValidationError as exc:
        detail_payload = exc.detail
        _emit_stage_event(trace_id, "failed", "error", {"error": detail_payload})
        raise HTTPException(status_code=400, detail=detail_payload) from exc
    except Exception as exc:  # noqa: BLE001
        detail = f"Kokoro synthesis failed: {exc}"
        _emit_stage_event(trace_id, "failed", "error", {"error": detail})
        raise HTTPException(status_code=500, detail=detail) from exc


@app.post("/synthesize")
def synthesize(payload: SynthesizeRequest) -> Response:
    wav_bytes, _, trace_id = _synthesize_item(payload)
    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={"X-VoiceFlow-Trace-Id": trace_id},
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

    requested_parallelism = payload.parallelism if payload.parallelism is not None else KOKORO_BATCH_MAX_PARALLEL
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
