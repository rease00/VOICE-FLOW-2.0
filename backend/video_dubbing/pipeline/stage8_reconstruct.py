from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

import numpy as np

from video_dubbing.config import DubbingConfig
from video_dubbing.utils.audio_utils import load_audio, normalize_peak, save_audio


def _alignment_score(target_sec: float, actual_sec: float) -> float:
    if target_sec <= 0:
        return 0.0
    diff = abs(target_sec - actual_sec)
    return max(0.0, 1.0 - (diff / target_sec))


def _time_stretch_clip(clip: np.ndarray, target_samples: int, cfg: DubbingConfig) -> tuple[np.ndarray, float]:
    if clip.size == 0 or target_samples <= 0:
        return clip.astype(np.float32), 1.0
    current_samples = max(1, int(clip.size))
    requested_rate = float(current_samples) / float(target_samples)
    bounded_rate = min(cfg.mix_stretch_max_rate, max(cfg.mix_stretch_min_rate, requested_rate))
    if abs(bounded_rate - 1.0) < 0.015:
        return clip.astype(np.float32), 1.0
    try:
        import librosa  # type: ignore

        stretched = librosa.effects.time_stretch(clip.astype(np.float32), rate=float(bounded_rate))
        return np.asarray(stretched, dtype=np.float32), float(bounded_rate)
    except Exception:
        return clip.astype(np.float32), 1.0


def _apply_clip_fades(clip: np.ndarray, sample_rate: int, fade_ms: float) -> np.ndarray:
    if clip.size == 0 or fade_ms <= 0:
        return clip
    fade_samples = int(round(float(sample_rate) * max(0.0, float(fade_ms)) / 1000.0))
    edge = min(fade_samples, clip.size // 2)
    if edge <= 1:
        return clip
    out = clip.copy()
    in_curve = np.linspace(0.0, 1.0, edge, dtype=np.float32)
    out[:edge] *= in_curve
    out[-edge:] *= in_curve[::-1]
    return out


def _fit_clip_to_window(clip: np.ndarray, target_samples: int, sample_rate: int, cfg: DubbingConfig) -> tuple[np.ndarray, dict[str, Any]]:
    if target_samples <= 0:
        return np.zeros(0, dtype=np.float32), {"stretchRate": 1.0, "trimmed": False, "padded": False}
    stretched, stretch_rate = _time_stretch_clip(clip, target_samples, cfg)
    fitted = stretched
    trimmed = False
    padded = False
    if fitted.size > target_samples:
        fitted = fitted[:target_samples]
        trimmed = True
    elif fitted.size < target_samples:
        padded = True
        fitted = np.pad(fitted, (0, target_samples - fitted.size), mode="constant")
    fitted = _apply_clip_fades(np.asarray(fitted, dtype=np.float32), sample_rate, cfg.mix_clip_fade_ms)
    return fitted, {"stretchRate": stretch_rate, "trimmed": trimmed, "padded": padded}


def run(ctx: dict[str, Any], cfg: DubbingConfig, log: Callable[[str], None]) -> dict[str, Any]:
    segments: list[dict[str, Any]] = list(ctx.get("segments") or [])
    world_segments = {int(item["index"]): item for item in list(ctx.get("world_segments") or [])}

    source_audio, _ = load_audio(Path(ctx["audio_raw"]), sample_rate=cfg.sample_rate)
    no_vocals, _ = load_audio(Path(ctx["no_vocals"]), sample_rate=cfg.sample_rate)
    duration_samples = max(source_audio.size, no_vocals.size, 1)
    dubbed = np.zeros(duration_samples, dtype=np.float32)
    alignment: list[dict[str, Any]] = []

    for idx, seg in enumerate(segments):
        item = world_segments.get(idx)
        start_sec = float(seg.get("start", 0.0))
        end_sec = float(seg.get("end", start_sec))
        target_sec = max(0.0, end_sec - start_sec)
        start = max(0, int(round(start_sec * cfg.sample_rate)))
        target_samples = max(0, int(round(target_sec * cfg.sample_rate)))
        place_samples = 0
        fit_meta: dict[str, Any] = {"stretchRate": 1.0, "trimmed": False, "padded": False}
        if start < duration_samples and target_samples > 0 and item:
            safe_target = min(target_samples, duration_samples - start)
            clip, _ = load_audio(Path(item["path"]), sample_rate=cfg.sample_rate)
            fitted_clip, fit_meta = _fit_clip_to_window(clip, safe_target, cfg.sample_rate, cfg)
            place_samples = fitted_clip.size
            if place_samples > 0:
                dubbed[start : start + place_samples] += fitted_clip
        actual_sec = float(place_samples) / float(cfg.sample_rate) if cfg.sample_rate > 0 else 0.0
        alignment.append(
            {
                "index": idx,
                "score": _alignment_score(target_sec, actual_sec),
                "target": target_sec,
                "actual": actual_sec,
                "stretchRate": float(fit_meta.get("stretchRate", 1.0)),
                "trimmed": bool(fit_meta.get("trimmed", False)),
                "padded": bool(fit_meta.get("padded", False)),
            }
        )

    mix = dubbed
    if no_vocals.size > 0:
        if no_vocals.size < duration_samples:
            pad = np.zeros(duration_samples - no_vocals.size, dtype=np.float32)
            no_vocals = np.concatenate([no_vocals, pad])
        mix = (dubbed * 0.92) + (no_vocals[:duration_samples] * 0.28)

    mix = normalize_peak(mix, target_peak=0.95)
    dubbed_audio = cfg.output_root / "dubbed_audio.wav"
    save_audio(dubbed_audio, mix, cfg.sample_rate)

    source_path = Path(ctx["source_path"])
    dubbed_video_raw = cfg.output_root / "dubbed_video_raw.mp4"
    if source_path.suffix.lower() in {".mp4", ".mov", ".mkv", ".webm"}:
        import subprocess

        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            str(source_path),
            "-i",
            str(dubbed_audio),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-shortest",
            str(dubbed_video_raw),
        ]
        subprocess.run(cmd, check=True, capture_output=True)

    ctx["dubbed_audio"] = str(dubbed_audio)
    ctx["dubbed_video_raw"] = str(dubbed_video_raw)
    ctx["alignment"] = alignment
    log("audio reconstruction complete")
    return ctx
