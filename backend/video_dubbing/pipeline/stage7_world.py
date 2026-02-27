from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

import numpy as np

from video_dubbing.config import DubbingConfig
from video_dubbing.utils.audio_utils import load_audio, save_audio


def _resample_curve(curve: np.ndarray, n: int) -> np.ndarray:
    if curve.size == 0:
        return np.zeros(n, dtype=np.float64)
    x = np.linspace(0.0, 1.0, curve.size)
    xi = np.linspace(0.0, 1.0, n)
    return np.interp(xi, x, curve)


def run(ctx: dict[str, Any], cfg: DubbingConfig, log: Callable[[str], None]) -> dict[str, Any]:
    segments: list[dict[str, Any]] = list(ctx.get("segments") or [])
    generated: list[dict[str, Any]] = list(ctx.get("tts_segments") or [])
    vocals, v_sr = load_audio(Path(ctx["vocals"]))

    try:
        import pyworld as pw  # type: ignore

        world_enabled = True
    except Exception as exc:
        world_enabled = False
        log(f"pyworld unavailable, skipping full prosody transfer: {exc}")

    out_items: list[dict[str, Any]] = []
    for item in generated:
        idx = int(item["index"])
        seg = segments[idx]
        synth, sr = load_audio(Path(item["path"]))
        s = int(float(seg.get("start", 0.0)) * v_sr)
        e = int(float(seg.get("end", 0.0)) * v_sr)
        source = vocals[s:e] if e > s else vocals[s : s + int(v_sr * 0.8)]

        result = synth
        if world_enabled and source.size > int(v_sr * 0.15) and synth.size > int(sr * 0.15):
            try:
                source64 = source.astype(np.float64)
                synth64 = synth.astype(np.float64)
                f0_src, t_src = pw.harvest(source64, v_sr)
                f0_syn, t_syn = pw.harvest(synth64, sr)
                sp_syn = pw.cheaptrick(synth64, f0_syn, t_syn, sr)
                ap_syn = pw.d4c(synth64, f0_syn, t_syn, sr)
                f0_repl = _resample_curve(f0_src, len(f0_syn))
                result = pw.synthesize(f0_repl, sp_syn, ap_syn, sr).astype(np.float32)
            except Exception as exc:
                log(f"pyworld failed on segment {idx}: {exc}")

        speaker = str(seg.get("speaker", "SPEAKER_00"))
        timestamp = float(seg.get("start", 0.0))
        out_path = cfg.world_dir / f"pasted_{speaker}_{timestamp:.2f}.wav"
        warped_path = cfg.emotion_dir / f"warped_{speaker}_{timestamp:.2f}.wav"
        save_audio(out_path, result, sr)
        save_audio(warped_path, result, sr)
        out_items.append({"index": idx, "path": str(out_path), "emotion_path": str(warped_path), "sr": sr})

    ctx["world_segments"] = out_items
    return ctx
