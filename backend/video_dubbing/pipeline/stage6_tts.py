from __future__ import annotations

import base64
import json
import time
from io import BytesIO
from typing import Any, Callable, Optional
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


LiveChunkCallback = Callable[[dict[str, Any]], None]


def _has_devanagari(text: str) -> bool:
    return any("\u0900" <= char <= "\u097F" for char in text)


def _decode_response_wav(content: bytes) -> tuple[np.ndarray, int]:
    audio, sr = sf.read(BytesIO(content), always_2d=False)
    if getattr(audio, "ndim", 1) > 1:
        audio = audio.mean(axis=1)
    return np.asarray(audio, dtype=np.float32), int(sr)


def _encode_wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    out = BytesIO()
    sf.write(out, np.asarray(audio, dtype=np.float32), int(sample_rate), format="WAV")
    return out.getvalue()


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


def _is_transient_runtime_error(exc: Exception) -> bool:
    token = str(exc or "").strip().lower()
    if not token:
        return False
    hints = [
        "timeout",
        "timed out",
        "connection reset",
        "connection aborted",
        "connection refused",
        "temporarily unavailable",
        "503",
        "502",
        "429",
        "gateway",
        "upstream",
        "network",
    ]
    return any(hint in token for hint in hints)


def _clamp_timeout(value: float, minimum: float, maximum: float) -> int:
    safe = max(float(minimum), min(float(maximum), float(value)))
    return max(int(minimum), int(round(safe)))


def _compute_chunk_timeout_sec(text: str, timeout_policy: str) -> int:
    if str(timeout_policy or "").strip().lower() != "adaptive":
        return 180
    chars = max(0, len(str(text or "")))
    return _clamp_timeout(8.0 + (0.03 * float(chars)), 8.0, 30.0)


def _compute_group_timeout_sec(script_text: str, timeout_policy: str, cfg: DubbingConfig) -> int:
    if str(timeout_policy or "").strip().lower() != "adaptive":
        return int(cfg.gemini_pair_group_timeout_sec)
    chars = max(0, len(str(script_text or "")))
    return _clamp_timeout(15.0 + (0.02 * float(chars)), 15.0, 45.0)


def _select_engine(
    segment: dict[str, Any],
    *,
    target_language: str,
    tts_route: str,
) -> str:
    forced = str(segment.get("tts_engine") or "").strip().upper()
    if forced in {"GEM", "KOKORO"}:
        return forced

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
    endpoint = "/synthesize"
    if engine == "GEM":
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


def _voice_candidates_for_engine(engine: str, preferred_voice: str) -> list[str]:
    preferred = str(preferred_voice or "").strip() or _default_voice_id(engine)
    default_voice = _default_voice_id(engine)
    out: list[str] = []
    for candidate in [preferred, default_voice]:
        token = str(candidate or "").strip()
        if not token:
            continue
        if token in out:
            continue
        out.append(token)
    return out


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
    timeout_policy: str,
    log: Callable[[str], None],
    tts_requests: list[dict[str, Any]],
    live_chunk_callback: Optional[LiveChunkCallback] = None,
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
        group_timeout_sec = _compute_group_timeout_sec(str(plan["script_text"]), timeout_policy, cfg)
        request_started_ms = int(time.time() * 1000)
        response = requests.post(endpoint, json=payload, timeout=group_timeout_sec)
        response.raise_for_status()
        request_elapsed_ms = max(0, int(time.time() * 1000) - request_started_ms)
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

        expected_indexes = [int(item.get("lineIndex", -1)) for item in list(plan["line_map"]) if int(item.get("lineIndex", -1)) >= 0]
        actual_indexes = sorted(chunk_by_index.keys())
        expected_set = set(expected_indexes)
        missing_indexes = [index for index in expected_indexes if index not in chunk_by_index]
        unexpected_indexes = [index for index in actual_indexes if index not in expected_set]
        if missing_indexes or unexpected_indexes:
            mismatch_detail = {
                "expectedCount": len(expected_indexes),
                "actualCount": len(actual_indexes),
                "missingLineIndexes": missing_indexes[:20],
                "unexpectedLineIndexes": unexpected_indexes[:20],
            }
            raise RuntimeError(f"grouped_line_map_mismatch:{json.dumps(mismatch_detail, ensure_ascii=True)}")

        generated: list[dict[str, Any]] = []
        local_requests: list[dict[str, Any]] = []
        diagnostics = body.get("diagnostics") if isinstance(body.get("diagnostics"), dict) else _decode_runtime_diagnostics(response)
        if not isinstance(diagnostics, dict):
            diagnostics = {}
        diagnostics = {
            **diagnostics,
            "requestMs": request_elapsed_ms,
            "expectedLineCount": len(expected_indexes),
            "chunkCount": len(actual_indexes),
            "groupCount": len(list(plan["groups"])),
            "mode": "studio_pair_groups",
        }
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
            selected_voice = str(speaker_voice_map.get(speaker.lower(), _default_voice_id("GEM")))
            local_requests.append(
                {
                    "index": segment_index,
                    "speaker": speaker,
                    "engine": "GEM",
                    "voice_id": selected_voice,
                    "speaker_wav": None,
                    "ok": True,
                    "error": None,
                    "strategy": "studio_pair_groups",
                    "runtime_diagnostics": diagnostics,
                }
            )
            if callable(live_chunk_callback):
                try:
                    live_chunk_callback(
                        {
                            "index": int(segment_index),
                            "speaker": speaker,
                            "engine": "GEM",
                            "voice_id": selected_voice,
                            "audio_bytes": bytes(audio_bytes),
                            "content_type": "audio/wav",
                            "text_chars": len(str(segment.get("translated_text") or segment.get("text") or "")),
                        }
                    )
                except Exception as exc:
                    log(f"stage6 live chunk callback failed index={segment_index}: {exc}")
        generated.sort(key=lambda item: int(item.get("index", 0)))
        local_requests.sort(key=lambda item: int(item.get("index", 0)))
        tts_requests.extend(local_requests)
        log(
            "stage6 grouped Gemini synthesis completed "
            f"(lines={len(plan['line_map'])}, groups={len(plan['groups'])}, concurrency={cfg.gemini_pair_group_max_concurrency}, requestMs={request_elapsed_ms})"
        )
        return generated
    except Exception as exc:
        log(f"stage6 grouped Gemini synthesis failed; fallback to segmented mode: {exc}")
        return None


def run(ctx: dict[str, Any], cfg: DubbingConfig, log: Callable[[str], None]) -> dict[str, Any]:
    segments: list[dict[str, Any]] = list(ctx.get("segments") or [])
    if not segments:
        raise RuntimeError("phase_failed:base_tts:no_segments")

    target_lang = normalize_language_code(str(ctx.get("target_language") or "hi"), default="hi")
    tts_route = str(ctx.get("tts_route") or "auto").strip().lower()
    timeout_policy = str(ctx.get("timeout_policy") or "adaptive").strip().lower()
    voice_binding_policy = str(ctx.get("voice_binding_policy") or "stable_fallback").strip().lower()
    max_speaker_count = max(1, int(ctx.get("max_speaker_count") or 8))
    live_chunk_callback = ctx.get("live_chunk_callback")
    if not callable(live_chunk_callback):
        live_chunk_callback = None

    source_voice_map = ctx.get("voice_map_resolved") if isinstance(ctx.get("voice_map_resolved"), dict) else {}
    if not source_voice_map:
        source_voice_map = ctx.get("voice_map") if isinstance(ctx.get("voice_map"), dict) else {}

    ordered_speakers: list[str] = []
    for segment in segments:
        speaker = str(segment.get("speaker") or "SPEAKER_00").strip() or "SPEAKER_00"
        if speaker not in ordered_speakers:
            ordered_speakers.append(speaker)
    if len(ordered_speakers) > max_speaker_count:
        overflow_target = ordered_speakers[max_speaker_count - 1]
        keep = set(ordered_speakers[:max_speaker_count])
        for segment in segments:
            speaker = str(segment.get("speaker") or "SPEAKER_00").strip() or "SPEAKER_00"
            if speaker not in keep:
                segment["speaker"] = overflow_target

    speaker_registry: dict[str, dict[str, str]] = {}
    for segment in segments:
        speaker = str(segment.get("speaker") or "SPEAKER_00").strip() or "SPEAKER_00"
        if speaker in speaker_registry:
            continue
        engine = _select_engine(segment, target_language=target_lang, tts_route=tts_route)
        voice_id = str(
            segment.get("voice_id")
            or source_voice_map.get(speaker)
            or source_voice_map.get("default")
            or _default_voice_id(engine)
        ).strip() or _default_voice_id(engine)
        speaker_registry[speaker] = {"engine": engine, "voice_id": voice_id}

    if voice_binding_policy == "stable_fallback":
        for segment in segments:
            speaker = str(segment.get("speaker") or "SPEAKER_00").strip() or "SPEAKER_00"
            registry_item = speaker_registry.get(speaker) or {}
            if str(registry_item.get("voice_id") or "").strip():
                segment["voice_id"] = str(registry_item.get("voice_id") or "").strip()
            if str(registry_item.get("engine") or "").strip():
                segment["tts_engine"] = str(registry_item.get("engine") or "").strip()

    generated: list[dict[str, Any]] = []
    tts_requests: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    fallback_bindings: list[dict[str, Any]] = []

    can_try_grouped = tts_route != "kokoro_only"
    if can_try_grouped:
        all_gem = True
        for segment in segments:
            token = str(segment.get("tts_engine") or "").strip().upper()
            if token and token != "GEM":
                all_gem = False
                break
        if all_gem:
            grouped_result = _try_grouped_gemini(
                segments=segments,
                target_lang=target_lang,
                cfg=cfg,
                timeout_policy=timeout_policy,
                log=log,
                tts_requests=tts_requests,
                live_chunk_callback=live_chunk_callback,
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
            preferred_voice = str(
                segment.get("voice_id")
                or speaker_registry.get(speaker, {}).get("voice_id")
                or _default_voice_id(primary_engine)
            ).strip() or _default_voice_id(primary_engine)
            trace_id = f"dub_{speaker}_{index}".replace(" ", "_")
            timeout_sec = _compute_chunk_timeout_sec(text, timeout_policy)

            audio = np.zeros(1, dtype=np.float32)
            sample_rate = 24000
            selected_engine = primary_engine
            selected_voice = preferred_voice
            ok = False
            error_reason = ""
            speaker_wav = None
            runtime_diagnostics: dict[str, Any] | None = None
            strategy = "segmented"

            for engine in engines:
                runtime_url = _runtime_url(cfg, engine)
                voice_candidates = _voice_candidates_for_engine(engine, preferred_voice)
                for voice_id in voice_candidates:
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
                    for attempt in range(2):
                        try:
                            response = requests.post(endpoint, json=payload, timeout=timeout_sec)
                            response.raise_for_status()
                            audio, sample_rate = _decode_response_wav(response.content)
                            if audio.size <= 0:
                                raise RuntimeError("empty_audio")
                            selected_engine = engine
                            selected_voice = voice_id
                            ok = True
                            error_reason = ""
                            runtime_diagnostics = _decode_runtime_diagnostics(response)
                            break
                        except Exception as exc:
                            error_reason = str(exc)
                            retry_allowed = attempt == 0 and _is_transient_runtime_error(exc)
                            if not retry_allowed:
                                break
                            log(f"tts transient retry [{engine}] segment={index}: {exc}")
                    if ok:
                        break
                if ok:
                    break
                log(f"tts failed [{engine}] segment={index}: {error_reason}")

            if ok and (selected_engine != primary_engine or selected_voice != preferred_voice):
                fallback_bindings.append(
                    {
                        "index": index,
                        "speaker": speaker,
                        "from_engine": primary_engine,
                        "from_voice_id": preferred_voice,
                        "to_engine": selected_engine,
                        "to_voice_id": selected_voice,
                        "reason": error_reason or "fallback_applied",
                    }
                )

            generated_item = _save_segment_audio(
                cfg=cfg,
                segment=segment,
                index=index,
                engine=selected_engine,
                audio=audio,
                sample_rate=sample_rate,
            )
            generated.append(generated_item)
            tts_requests.append(
                {
                    "index": index,
                    "speaker": speaker,
                    "engine": selected_engine,
                    "voice_id": selected_voice,
                    "speaker_wav": speaker_wav,
                    "ok": ok,
                    "error": error_reason or None,
                    "runtime_diagnostics": runtime_diagnostics,
                    "strategy": strategy,
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
            elif callable(live_chunk_callback):
                try:
                    chunk_bytes = _encode_wav_bytes(audio, sample_rate)
                    live_chunk_callback(
                        {
                            "index": int(index),
                            "speaker": speaker,
                            "engine": selected_engine,
                            "voice_id": selected_voice,
                            "audio_bytes": chunk_bytes,
                            "content_type": "audio/wav",
                            "text_chars": len(text),
                        }
                    )
                except Exception as exc:
                    log(f"stage6 live chunk callback failed index={index}: {exc}")

    ctx["base_tts_segments"] = generated
    ctx["tts_segments"] = generated
    ctx["tts_requests"] = tts_requests
    ctx["synthesis_failures"] = failures
    ctx["speaker_registry"] = speaker_registry
    ctx["speaker_fallback_bindings"] = fallback_bindings
    if failures:
        raise RuntimeError(f"tts_segment_failures:{len(failures)}")
    return ctx
