from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from video_dubbing.config import DubbingConfig
from video_dubbing.utils.segment_utils import detect_segment_type


def run(ctx: dict[str, Any], cfg: DubbingConfig, log: Callable[[str], None]) -> dict[str, Any]:
    segments: list[dict[str, Any]] = list(ctx.get("segments") or [])
    vocals = Path(ctx["vocals"])
    try:
        import librosa  # type: ignore

        audio, sr = librosa.load(str(vocals), sr=None, mono=True)
        for seg in segments:
            s = int(float(seg.get("start", 0.0)) * sr)
            e = int(float(seg.get("end", 0.0)) * sr)
            clip = audio[s:e] if e > s else audio[s : s + int(sr * 0.4)]
            if clip.size < max(1, int(sr * 0.2)):
                seg["segment_type"] = "speech"
                continue
            f0, _, _ = librosa.pyin(clip, fmin=65, fmax=600)
            pitch_var = float((f0[~(f0 != f0)]).std()) if f0 is not None else 0.0  # NaN-safe
            tempo, _ = librosa.beat.beat_track(y=clip, sr=sr)
            seg["segment_type"] = detect_segment_type(str(seg.get("text", "")), pitch_var, float(tempo))
    except Exception as exc:
        log(f"segment detection fallback: {exc}")
        for seg in segments:
            seg["segment_type"] = "speech"

    ctx["segments"] = segments
    return ctx
