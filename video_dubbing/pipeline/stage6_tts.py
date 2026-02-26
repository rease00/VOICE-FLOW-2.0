from __future__ import annotations

import base64
import json
from io import BytesIO
from typing import Any, Callable
from urllib.parse import unquote

import numpy as np
import requests
import soundfile as sf

from shared.gemini_multi_speaker import (
    build_studio_pair_groups,
    normalize_multi_speaker_line_map,
)
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


def _decode_runtime_diagnostics(response: Any) -> dict[str, Any] | None:
    raw = str(getattr(response, "headers", {}).get("x-voiceflow-diagnostics") or "").strip()
    if not raw:
        return None
    try:
        decoded = unquote(raw)
        payload = json.loads(decoded)
        if isinstance(payload, dict):
            return payload
    except Exception:
        return None
    return None


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


def _build_grouped_plan(segments: list[dict[str, Any]]) -> dict[str, Any] | None:
    raw_lines: list[dict[str, Any]] = []
    serial_to_segment: dict[int, int] = {}
    speaker_voice_map: dict[str, str] = {}
    serial_index = 0

    for segment_index, segment in enumerate(segments):
        text = str(segment.get("translated_text") or segment.get("text") or "").strip()
        if not text:
            continue
        speaker = str(segment.get("speaker") or "SPEAKER_00").strip() or "SPEAKER_00"
        voice_id = str(segment.get("voice_id") or _default_voice_id("GEM")).strip() or _default_voice_id("GEM")
        speaker_key = speaker.lower()
        if speaker_key not in speaker_voice_map:
            speaker_voice_map[speaker_key] = voice_id
        raw_lines.append(
            {
                "lineIndex": serial_index,
                "speaker": speaker,
                "text": text,
            }
        )
        serial_to_segment[serial_index] = segment_index
        serial_index += 1

    line_map = normalize_multi_speaker_line_map(raw_lines)
    if len(line_map) < 2:
        return None

    speaker_voices: list[dict[str, str]] = []
    seen: set[str] = set()
    for line in line_map:
        speaker = str(line.get("speaker") or "").strip()
        if not speaker:
            continue
        speaker_key = speaker.lower()
        if speaker_key in seen:
            continue
        seen.add(speaker_key)
        speaker_voices.append(
            {
                "speaker": speaker,
                "voiceName": speaker_voice_map.get(speaker_key, _default_voice_id("GEM")),
            }
        )
    if len(speaker_voices) < 2:
        return None

    groups = build_studio_pair_groups(line_map, speaker_voices, _default_voice_id("GEM"))
    if not groups:
        return None

    script_text = "\n".join(
        f"{str(line.get('speaker') or '').strip()}: {str(line.get('text') or '').strip()}"
        for line in line_map
        if str(line.get("speaker") or "").strip() and str(line.get("text") or "").strip()
    ).strip()
    if not script_text:
        return None

    return {
        "script_text": script_text,
        "line_map": line_map,
        "speaker_voices": speaker_voices,
        "groups": groups,
        "serial_to_segment": serial_to_segment,
        "speaker_voice_map": speaker_voice_map,
    }


def _save_segment_audio(
    *,
    cfg: DubbingConfig,
    segment: dict[str, Any],
    index: int,
    engine: str,
    audio: np.ndarray,
    sample_rate: int,
) -> dict[str, Any]:
    speaker = str(segment.get("speaker") or "SPEAKER_00")
    out_path = cfg.tts_dir / f"tts_{engine.lower()}_{speaker}_{float(segment.get('start', 0.0)):.2f}.wav"
    save_audio(out_path, audio, sample_rate)
    return {
        "index": index,
        "path": str(out_path),
        "sr": sample_rate,
        "speaker": speaker,
        "engine": engine,
        "ok": True,
    }


def _try_grouped_gemini(
    *,
    segments: list[dict[str, Any]],
    target_lang: str,
    cfg: DubbingConfig,
    log: Callable[[str], None],
    tts_requests: list[dict[str, Any]],
) -> list[dict[str, Any]] | None:
    plan = _build_grouped_plan(segments)
    if not plan:
        return None

    endpoint = f"{cfg.gemini_runtime_url}/synthesize/structured"
    payload = {
        "text": str(plan["script_text"]),
        "voiceName": _default_voice_id("GEM"),
        "voice_id": _default_voice_id("GEM"),
        "language": target_lang,
        "speaker_voices": list(plan["speaker_voices"]),
        "multi_speaker_mode": "studio_pair_groups",
        "multi_speaker_max_concurrency": int(cfg.gemini_pair_group_max_concurrency),
        "multi_speaker_retry_once": bool(cfg.gemini_pair_group_retry_once),
        "multi_speaker_line_map": list(plan["line_map"]),
    }

    try:
        response = requests.post(endpoint, json=payload, timeout=int(cfg.gemini_pair_group_timeout_sec))
        response.raise_for_status()
        body = response.json()
        if not isinstance(body, dict):
            raise RuntimeError("invalid_grouped_response")
        chunks = body.get("lineChunks")
        if not isinstance(chunks, list) or not chunks:
            raise RuntimeError("grouped_response_missing_chunks")

        chunk_by_index: dict[int, dict[str, Any]] = {}
        for item in chunks:
            if not isinstance(item, dict):
                continue
            try:
                line_index = int(item.get("lineIndex"))
            except Exception:
                continue
            if line_index < 0:
                continue
            chunk_by_index[line_index] = item

        generated: list[dict[str, Any]] = []
        local_requests: list[dict[str, Any]] = []
        diagnostics = body.get("diagnostics") if isinstance(body.get("diagnostics"), dict) else _decode_runtime_diagnostics(response)
        for line in list(plan["line_map"]):
            line_index = int(line.get("lineIndex", -1))
            if line_index < 0:
                continue
            segment_index = int(plan["serial_to_segment"].get(line_index, -1))
            if segment_index < 0 or segment_index >= len(segments):
                raise RuntimeError("grouped_line_index_mapping_failed")
            chunk = chunk_by_index.get(line_index)
            if not chunk:
                raise RuntimeError(f"grouped_line_chunk_missing:{line_index}")
            audio_base64 = str(chunk.get("audioBase64") or "").strip()
            if not audio_base64:
                raise RuntimeError(f"grouped_line_chunk_empty:{line_index}")
            audio_bytes = base64.b64decode(audio_base64)
            audio, sample_rate = _decode_response_wav(audio_bytes)
            if audio.size <= 0:
                raise RuntimeError(f"grouped_line_chunk_invalid:{line_index}")
            segment = segments[segment_index]
            generated.append(
                _save_segment_audio(
                    cfg=cfg,
                    segment=segment,
                    index=segment_index,
                    engine="GEM",
                    audio=audio,
                    sample_rate=sample_rate,
                )
            )
            speaker = str(segment.get("speaker") or "SPEAKER_00")
            speaker_voice_map = plan["speaker_voice_map"] if isinstance(plan.get("speaker_voice_map"), dict) else {}
            local_requests.append(
                {
                    "index": segment_index,
                    "speaker": speaker,
                    "engine": "GEM",
                    "voice_id": str(speaker_voice_map.get(speaker.lower(), _default_voice_id("GEM"))),
                    "speaker_wav": None,
                    "ok": True,
                    "error": None,
                    "strategy": "studio_pair_groups",
                    "runtime_diagnostics": diagnostics,
                }
            )
        generated.sort(key=lambda item: int(item.get("index", 0)))
        local_requests.sort(key=lambda item: int(item.get("index", 0)))
        tts_requests.extend(local_requests)
        log(
            "stage6 grouped Gemini synthesis completed "
            f"(lines={len(plan['line_map'])}, groups={len(plan['groups'])}, concurrency={cfg.gemini_pair_group_max_concurrency})"
        )
        return generated
    except Exception as exc:
        log(f"stage6 grouped Gemini synthesis failed; fallback to segmented mode: {exc}")
        return None


def run(ctx: dict[str, Any], cfg: DubbingConfig, log: Callable[[str], None]) -> dict[str, Any]:
    segments: list[dict[str, Any]] = list(ctx.get("segments") or [])
    target_lang = normalize_language_code(str(ctx.get("target_language") or "hi"), default="hi")
    tts_route = str(ctx.get("tts_route") or "auto").strip().lower()

    generated: list[dict[str, Any]] = []
    tts_requests: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    can_try_grouped = tts_route != "kokoro_only"
    if can_try_grouped:
        grouped_result = _try_grouped_gemini(
            segments=segments,
            target_lang=target_lang,
            cfg=cfg,
            log=log,
            tts_requests=tts_requests,
        )
        if grouped_result is not None:
            generated = grouped_result

    if not generated:
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
            runtime_diagnostics: dict[str, Any] | None = None

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
                    runtime_diagnostics = _decode_runtime_diagnostics(response)
                    break
                except Exception as exc:
                    error_reason = str(exc)
                    log(f"tts failed [{engine}] segment={index}: {exc}")

            generated.append(
                _save_segment_audio(
                    cfg=cfg,
                    segment=segment,
                    index=index,
                    engine=selected_engine,
                    audio=audio,
                    sample_rate=sample_rate,
                )
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
                    "runtime_diagnostics": runtime_diagnostics,
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
