from __future__ import annotations

import json
import time
from io import BytesIO
from pathlib import Path
from typing import Any, Callable

import numpy as np
import requests
import soundfile as sf

from video_dubbing.config import DubbingConfig
from video_dubbing.utils.audio_utils import load_audio


def _encode_wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    out = BytesIO()
    sf.write(out, np.asarray(audio, dtype=np.float32), int(sample_rate), format="WAV")
    return out.getvalue()


def _fit_to_window(audio: np.ndarray, target_samples: int) -> np.ndarray:
    if target_samples <= 0:
        return np.zeros(0, dtype=np.float32)
    if audio.size > target_samples:
        return np.asarray(audio[:target_samples], dtype=np.float32)
    if audio.size < target_samples:
        return np.pad(np.asarray(audio, dtype=np.float32), (0, target_samples - audio.size), mode="constant")
    return np.asarray(audio, dtype=np.float32)


def _mix_preview(
    *,
    converted_audio: np.ndarray,
    background_audio: np.ndarray,
    start_sec: float,
    end_sec: float,
    sample_rate: int,
) -> tuple[np.ndarray, str]:
    target_samples = max(0, int(round(max(0.0, end_sec - start_sec) * sample_rate)))
    fitted_voice = _fit_to_window(np.asarray(converted_audio, dtype=np.float32), target_samples)
    if target_samples <= 0 or background_audio.size <= 0:
        return fitted_voice, "speech_only"
    start = max(0, int(round(start_sec * sample_rate)))
    end = min(background_audio.size, start + target_samples)
    background_slice = background_audio[start:end]
    if background_slice.size <= 0:
        return fitted_voice, "speech_only"
    if background_slice.size < target_samples:
        background_slice = np.pad(background_slice, (0, target_samples - background_slice.size), mode="constant")
    mixed = (fitted_voice * 0.92) + (background_slice[:target_samples] * 0.28)
    mixed = np.clip(mixed, -1.0, 1.0)
    return np.asarray(mixed, dtype=np.float32), "speech_plus_bg"


def _runtime_headers_to_meta(headers: Any) -> dict[str, str]:
    out: dict[str, str] = {}
    if not headers:
        return out
    for key in (
        "x-vf-voice-transfer-model-resolved",
        "x-vf-voice-transfer-backend-mode",
        "x-vf-voice-transfer-f0-method",
    ):
        token = str(getattr(headers, "get", lambda _key, _default=None: None)(key) or "").strip()
        if token:
            out[key.lower()] = token
    return out


def run(ctx: dict[str, Any], cfg: DubbingConfig, log: Callable[[str], None]) -> dict[str, Any]:
    tts_segments: list[dict[str, Any]] = list(ctx.get("base_tts_segments") or ctx.get("tts_segments") or [])
    segments_by_index = {
        int(item.get("index") or idx): item
        for idx, item in enumerate(list(ctx.get("segments") or []))
        if isinstance(item, dict)
    }
    if not tts_segments:
        raise RuntimeError("phase_failed:voice_transfer:no_tts_segments")

    selected_model = str(
        ctx.get("voice_model")
        or ctx.get("voice_transfer_model")
        or ""
    ).strip()
    if not selected_model:
        raise RuntimeError("phase_failed:voice_transfer:voice_model_required")

    voice_transfer_dir = cfg.output_root / "voice_transfer"
    voice_transfer_dir.mkdir(parents=True, exist_ok=True)

    live_chunk_callback = ctx.get("live_chunk_callback")
    if not callable(live_chunk_callback):
        live_chunk_callback = None

    background_audio = np.zeros(0, dtype=np.float32)
    background_path = Path(str(ctx.get("music_effects") or ctx.get("no_vocals") or "")).resolve()
    if background_path.exists():
        try:
            background_audio, _ = load_audio(background_path, sample_rate=cfg.sample_rate)
        except Exception:
            background_audio = np.zeros(0, dtype=np.float32)

    converted: list[dict[str, Any]] = []
    rtf_values: list[float] = []
    total_audio_sec = 0.0
    total_proc_sec = 0.0
    max_duration_error_ms = 0.0

    for item in tts_segments:
        index = int(item.get("index") or 0)
        src_path = Path(str(item.get("path") or "")).resolve()
        if not src_path.exists():
            raise RuntimeError(f"phase_failed:voice_transfer:missing_tts_path_{index}")

        segment = segments_by_index.get(index) or {}
        start_sec = float(segment.get("start") or 0.0)
        end_sec = float(segment.get("end") or start_sec)
        target_sec = max(0.0, end_sec - start_sec)
        out_path = voice_transfer_dir / f"voice_transfer_{index:04d}.wav"
        started = time.perf_counter()

        try:
            with src_path.open("rb") as handle:
                response = requests.post(
                    f"{cfg.llvc_runtime_url.rstrip('/')}/v1/convert",
                    files={"file": ("segment.wav", handle, "audio/wav")},
                    data={
                        "model_name": selected_model,
                        "preset": cfg.llvc_preset,
                        "pitch_shift": "0",
                        "index_rate": "0.5",
                        "filter_radius": "3",
                        "rms_mix_rate": "1.0",
                        "protect": "0.33",
                        "f0_method": "rmvpe",
                    },
                    timeout=180,
                )
            response.raise_for_status()
        except Exception as exc:
            raise RuntimeError(f"phase_failed:voice_transfer:runtime_failed:{index}:{exc}") from exc

        out_path.write_bytes(bytes(response.content or b""))
        audio, sr = load_audio(out_path, sample_rate=cfg.sample_rate)
        elapsed = max(0.0, time.perf_counter() - started)

        actual_sec = float(len(audio) / max(1, sr))
        duration_error_ms = abs(target_sec - actual_sec) * 1000.0
        max_duration_error_ms = max(max_duration_error_ms, duration_error_ms)
        allowed_error_ms = max(80.0, target_sec * 1000.0 * (float(cfg.isochrony_tolerance_pct) / 100.0))
        if target_sec > 0 and duration_error_ms > allowed_error_ms:
            raise RuntimeError(
                f"phase_failed:voice_transfer:duration_tolerance_exceeded:{index}:{int(round(duration_error_ms))}"
            )

        total_audio_sec += actual_sec
        total_proc_sec += elapsed
        rtf = (elapsed / actual_sec) if actual_sec > 0 else 0.0
        rtf_values.append(rtf)
        runtime_meta = _runtime_headers_to_meta(response.headers)

        converted_item = {
            "index": index,
            "path": str(out_path),
            "sr": sr,
            "speaker": str(item.get("speaker") or segment.get("speaker") or "SPEAKER_00"),
            "engine": "w_okada_rvc_onnx",
            "ok": True,
            "rtf": rtf,
            "model": selected_model,
            "preset": cfg.llvc_preset,
            "timelineStartMs": int(round(start_sec * 1000.0)),
            "timelineEndMs": int(round(end_sec * 1000.0)),
            "durationErrorMs": round(duration_error_ms, 2),
            "runtime": runtime_meta,
        }
        converted.append(converted_item)

        if callable(live_chunk_callback):
            try:
                preview_audio, preview_kind = _mix_preview(
                    converted_audio=audio,
                    background_audio=background_audio,
                    start_sec=start_sec,
                    end_sec=end_sec,
                    sample_rate=cfg.sample_rate,
                )
                live_chunk_callback(
                    {
                        "index": index,
                        "speaker": converted_item["speaker"],
                        "engine": "VOICE_TRANSFER",
                        "voice_id": selected_model,
                        "audio_bytes": _encode_wav_bytes(preview_audio, cfg.sample_rate),
                        "content_type": "audio/wav",
                        "text_chars": len(str(segment.get("translated_text") or segment.get("text") or "")),
                        "timeline_start_ms": converted_item["timelineStartMs"],
                        "timeline_end_ms": converted_item["timelineEndMs"],
                        "preview_kind": preview_kind,
                    }
                )
            except Exception as exc:
                log(f"phase5 live preview failed index={index}: {exc}")

    metrics = {
        "engine": "w_okada_rvc_onnx",
        "model": selected_model,
        "preset": cfg.llvc_preset,
        "segmentCount": len(converted),
        "avgRtf": float(sum(rtf_values) / len(rtf_values)) if rtf_values else 0.0,
        "maxRtf": float(max(rtf_values)) if rtf_values else 0.0,
        "totalAudioSec": total_audio_sec,
        "totalProcessingSec": total_proc_sec,
        "maxDurationErrorMs": round(max_duration_error_ms, 2),
    }
    log(
        "phase5 voice transfer metrics "
        f"segments={metrics['segmentCount']} avg_rtf={metrics['avgRtf']:.4f} model={selected_model}"
    )

    ctx["voice_transfer_segments"] = converted
    ctx["voice_transfer_metrics"] = metrics
    return ctx
