from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable

from video_dubbing.config import DubbingConfig


def run(ctx: dict[str, Any], cfg: DubbingConfig, log: Callable[[str], None]) -> dict[str, Any]:
    raw_video = Path(ctx.get("dubbed_video_raw") or "")
    final_video = cfg.output_root / "dubbed_video_final.mp4"

    if not raw_video.exists():
        ctx["dubbed_video_final"] = str(final_video)
        return ctx

    if cfg.latent_sync_cmd:
        try:
            cmd = cfg.latent_sync_cmd.format(input=str(raw_video), output=str(final_video))
            subprocess.run(cmd, check=True, shell=True, capture_output=True)
            log("latentsync completed")
        except Exception as exc:
            log(f"latentsync failed, using raw muxed video: {exc}")
            shutil.copyfile(raw_video, final_video)
    else:
        shutil.copyfile(raw_video, final_video)

    ctx["dubbed_video_final"] = str(final_video)
    return ctx
