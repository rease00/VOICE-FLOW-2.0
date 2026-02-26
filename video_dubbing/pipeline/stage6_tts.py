from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Any, Callable

import numpy as np
import requests
import soundfile as sf

from video_dubbing.config import DubbingConfig
from video_dubbing.utils.audio_utils import save_audio
from video_dubbing.utils.language_utils import normalize_language_code


def _has_devanagari(text: str) -> bool:
    return any("\u0900" <= char <= "\u097F" for char in text)


def _decode_response_wav(content: bytes) -> tuple[np.ndarray, int]:
    audio, sr = sf.read(BytesIO(content), always_2d=False)
    if getattr(audio, "ndim", 1) > 1:
        audio = audio.mean(axis=1)
    return np.asarray(audio, dtype=np.float32), int(sr)


def _select_engine(
    segment: dict[str, Any],
    *,
    target_language: str,
    tts_route: str,
) -> str:
    route = (tts_route or "auto").strip().lower()
    if route == "gem_only":
        return "GEM"
    if route == "kokoro_only":
        return "KOKORO"

    text = str(segment.get("translated_text") or segment.get("text") or "")
    lang = normalize_language_code(target_language, default="en")
    if lang.startswith("hi") or _has_devanagari(text):
        return "KOKORO"
    return "GEM"


def _engine_order(primary: str, tts_route: str) -> list[str]:
    route = (tts_route or "auto").strip().lower()
    if route in {"gem_only", "kokoro_only"}:
        return [primary]
    return [primary, "KOKORO" if primary == "GEM" else "GEM"]


def _build_payload(
    *,
    engine: str,
    text: str,
    voice_id: str,
    speaker: str,
    emotion: Any,
    language: str,
    trace_id: str,
) -> tuple[str, dict[str, Any]]:
    if engine == "GEM":
        endpoint = "/synthesize"
        payload: dict[str, Any] = {
            "text": text,
            "voiceName": voice_id,
            "voice_id": voice_id,
            "language": language,
            "emotion": emotion,
            "speaker": speaker,
            "trace_id": trace_id,
        }
        return endpoint, payload

    endpoint = "/synthesize"
    payload = {
        "text": text,
        "voiceId": voice_id,
        "voice_id": voice_id,
        "language": language,
        "emotion": emotion,
        "trace_id": trace_id,
    }
    return endpoint, payload


def _runtime_url(cfg: DubbingConfig, engine: str) -> str:
    if engine == "KOKORO":
        return cfg.kokoro_runtime_url
    return cfg.gemini_runtime_url


def _default_voice_id(engine: str) -> str:
    if engine == "KOKORO":
        return "hf_alpha"
    return "alloy"


def run(ctx: dict[str, Any], cfg: DubbingConfig, log: Callable[[str], None]) -> dict[str, Any]:
    segments: list[dict[str, Any]] = list(ctx.get("segments") or [])
    target_lang = normalize_language_code(str(ctx.get("target_language") or "hi"), default="hi")
    tts_route = str(ctx.get("tts_route") or "auto").strip().lower()

    generated: list[dict[str, Any]] = []
    tts_requests: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for index, segment in enumerate(segments):
        text = str(segment.get("translated_text") or segment.get("text") or "").strip()
        if not text:
            continue

        speaker = str(segment.get("speaker") or "SPEAKER_00")
        primary_engine = _select_engine(segment, target_language=target_lang, tts_route=tts_route)
        engines = _engine_order(primary_engine, tts_route)
        voice_id = str(segment.get("voice_id") or _default_voice_id(primary_engine)).strip() or _default_voice_id(primary_engine)
        trace_id = f"dub_{speaker}_{index}".replace(" ", "_")

        audio = np.zeros(1, dtype=np.float32)
        sample_rate = 24000
        selected_engine = primary_engine
        ok = False
        error_reason = ""
        speaker_wav = None

        for engine in engines:
            runtime_url = _runtime_url(cfg, engine)
            endpoint_path, payload = _build_payload(
                engine=engine,
                text=text,
                voice_id=voice_id,
                speaker=speaker,
                emotion=segment.get("emotion"),
                language=target_lang,
                trace_id=trace_id,
            )
            endpoint = f"{runtime_url}{endpoint_path}"
            try:
                response = requests.post(endpoint, json=payload, timeout=180)
                response.raise_for_status()
                audio, sample_rate = _decode_response_wav(response.content)
                if audio.size <= 0:
                    raise RuntimeError("empty_audio")
                selected_engine = engine
                ok = True
                error_reason = ""
                break
            except Exception as exc:
                error_reason = str(exc)
                log(f"tts failed [{engine}] segment={index}: {exc}")

        out_path = cfg.tts_dir / f"tts_{selected_engine.lower()}_{speaker}_{float(segment.get('start', 0.0)):.2f}.wav"
        save_audio(out_path, audio, sample_rate)

        generated.append(
            {
                "index": index,
                "path": str(out_path),
                "sr": sample_rate,
                "speaker": speaker,
                "engine": selected_engine,
                "ok": ok,
            }
        )
        tts_requests.append(
            {
                "index": index,
                "speaker": speaker,
                "engine": selected_engine,
                "voice_id": voice_id,
                "speaker_wav": speaker_wav,
                "ok": ok,
                "error": error_reason or None,
            }
        )
        if not ok:
            failures.append(
                {
                    "index": index,
                    "speaker": speaker,
                    "engine": selected_engine,
                    "reason": error_reason or "empty_audio",
                }
            )

    ctx["tts_segments"] = generated
    ctx["tts_requests"] = tts_requests
    ctx["synthesis_failures"] = failures
    if failures:
        raise RuntimeError(f"tts_segment_failures:{len(failures)}")
    return ctx
