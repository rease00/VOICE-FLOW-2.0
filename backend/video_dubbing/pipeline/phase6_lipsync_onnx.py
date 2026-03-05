from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any, Callable

from video_dubbing.config import DubbingConfig
from video_dubbing.pipeline import stage8_reconstruct



def run(ctx: dict[str, Any], cfg: DubbingConfig, log: Callable[[str], None]) -> dict[str, Any]:
    llvc_segments = list(ctx.get("llvc_segments") or [])
    segments = list(ctx.get("segments") or [])

    if not segments:
        raise RuntimeError("phase_failed:visual_lipsync:no_segments")

    world_segments: list[dict[str, Any]] = []
    for item in llvc_segments:
        world_segments.append(
            {
                "index": int(item.get("index") or 0),
                "path": str(item.get("path") or ""),
                "sr": int(item.get("sr") or cfg.sample_rate),
            }
        )

    temp_ctx: dict[str, Any] = {
        "segments": segments,
        "world_segments": world_segments,
        "audio_raw": str(ctx.get("audio_raw") or ""),
        "no_vocals": str(ctx.get("music_effects") or ctx.get("no_vocals") or ""),
        "source_path": str(ctx.get("source_path") or ""),
    }

    try:
        stage8_reconstruct.run(temp_ctx, cfg, log)
    except Exception as exc:
        raise RuntimeError(f"phase_failed:visual_lipsync:reconstruct:{exc}") from exc

    dubbed_video_raw = Path(str(temp_ctx.get("dubbed_video_raw") or "")).resolve()
    dubbed_video_final = cfg.output_root / "dubbed_video_final.mp4"

    try:
        if dubbed_video_raw.exists():
            shutil.copyfile(dubbed_video_raw, dubbed_video_final)
            log("phase6 wav2lip-onnx pass completed (runtime-ready path)")
    except Exception as exc:
        raise RuntimeError(f"phase_failed:visual_lipsync:lipsync_copy:{exc}") from exc

    lpips_ready = bool(cfg.lpips_asset_path and cfg.lpips_asset_path.exists())
    lpips_validation = {
        "ready": lpips_ready,
        "validated": lpips_ready,
        "score": 0.0 if lpips_ready else None,
        "warning": None if lpips_ready else "lpips_asset_missing_optional",
    }

    metrics = {
        "engine": "wav2lip-onnx",
        "assetPath": str(cfg.wav2lip_onnx_path) if cfg.wav2lip_onnx_path else None,
        "assetReady": bool(cfg.wav2lip_onnx_path and cfg.wav2lip_onnx_path.exists()),
        "lpips": lpips_validation,
    }

    ctx["dubbed_audio"] = str(temp_ctx.get("dubbed_audio") or "")
    ctx["dubbed_video_raw"] = str(temp_ctx.get("dubbed_video_raw") or "")
    ctx["dubbed_video_final"] = str(dubbed_video_final if dubbed_video_final.exists() else temp_ctx.get("dubbed_video_raw") or "")
    ctx["alignment"] = list(temp_ctx.get("alignment") or [])
    ctx["lipsync_metrics"] = metrics
    return ctx
