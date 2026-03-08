from __future__ import annotations

import time
from io import BytesIO
from pathlib import Path
from typing import Any, Callable

import numpy as np
import requests
import soundfile as sf

from video_dubbing.config import DubbingConfig
from video_dubbing.utils.audio_utils import save_audio



def _decode_response_wav(content: bytes) -> tuple[np.ndarray, int]:
    audio, sr = sf.read(BytesIO(content), always_2d=False)
    if getattr(audio, "ndim", 1) > 1:
        audio = audio.mean(axis=1)
    return np.asarray(audio, dtype=np.float32), int(sr)



def _compute_speaking_rate(text: str, start: float, end: float) -> float:
    duration = max(0.08, float(end) - float(start))
    words = max(1, len([token for token in str(text or "").split() if token]))
    words_per_sec = float(words) / duration
    # Neutral center around 2.6 w/s.
    rate = words_per_sec / 2.6
    return float(max(0.65, min(1.35, rate)))



def _save_silence(path: Path, duration_sec: float, sample_rate: int = 24000) -> tuple[np.ndarray, int]:
    samples = max(1, int(round(max(0.12, duration_sec) * sample_rate)))
    silence = np.zeros(samples, dtype=np.float32)
    save_audio(path, silence, sample_rate)
    return silence, sample_rate



def run(ctx: dict[str, Any], cfg: DubbingConfig, log: Callable[[str], None]) -> dict[str, Any]:
    segments: list[dict[str, Any]] = list(ctx.get("segments") or [])
    if not segments:
        raise RuntimeError("phase_failed:base_tts:no_segments")

    director_json = dict(ctx.get("director_json") or {})
    director_segments = list(director_json.get("segments") or [])

    generated: list[dict[str, Any]] = []
    requests_meta: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for index, segment in enumerate(segments):
        text = str(segment.get("translated_text") or segment.get("text") or "").strip()
        speaker = str(segment.get("speaker") or "SPEAKER_00")
        start = float(segment.get("start") or 0.0)
        end = float(segment.get("end") or start + 0.4)
        speaking_rate = _compute_speaking_rate(text, start, end)

        tags: list[str] = []
        if index < len(director_segments):
            tags = list(director_segments[index].get("affective_tags") or [])
        if not tags:
            tags = list(segment.get("affective_tags") or [])

        out_path = cfg.tts_dir / f"base_tts_{index:04d}.wav"
        ok = False
        err = ""
        runtime = "gemini"
        started = time.perf_counter()

        for runtime_name, base_url in (("gemini", cfg.gemini_runtime_url), ("kokoro", cfg.kokoro_runtime_url)):
            payload = {
                "text": text,
                "voiceName": str(segment.get("voice_id") or "achernar"),
                "voice_id": str(segment.get("voice_id") or "achernar"),
                "language": str(ctx.get("target_language") or "hi"),
                "emotion": tags[0] if tags else "neutral",
                "speaker": speaker,
                "model": cfg.tts_model,
                "director_tags": tags,
                "speaking_rate": speaking_rate,
            }
            try:
                response = requests.post(f"{base_url}/synthesize", json=payload, timeout=120)
                response.raise_for_status()
                audio, sr = _decode_response_wav(response.content)
                save_audio(out_path, audio, sr)
                ok = True
                runtime = runtime_name
                err = ""
                break
            except Exception as exc:
                err = str(exc)
                runtime = runtime_name
                if runtime_name == "kokoro" or not cfg.allow_model_fallback:
                    break

        if not ok:
            # Maintain deterministic behavior but mark as failed. Silence file is still emitted for diagnostics.
            _save_silence(out_path, max(0.12, end - start))
            failures.append(
                {
                    "index": index,
                    "speaker": speaker,
                    "reason": err or "runtime_error",
                }
            )

        elapsed = max(0.0, time.perf_counter() - started)
        generated.append(
            {
                "index": index,
                "path": str(out_path),
                "sr": 24000,
                "speaker": speaker,
                "engine": runtime.upper(),
                "ok": ok,
            }
        )
        requests_meta.append(
            {
                "index": index,
                "speaker": speaker,
                "engine": runtime.upper(),
                "voice_id": str(segment.get("voice_id") or "achernar"),
                "ok": ok,
                "error": err or None,
                "model": cfg.tts_model,
                "directorTags": tags,
                "speakingRate": speaking_rate,
                "durationSec": max(0.0, end - start),
                "requestSec": elapsed,
            }
        )

    ctx["base_tts_segments"] = generated
    ctx["tts_segments"] = generated
    ctx["tts_requests"] = requests_meta
    ctx["synthesis_failures"] = failures

    if failures:
        raise RuntimeError(f"phase_failed:base_tts:segment_failures={len(failures)}")
    return ctx
