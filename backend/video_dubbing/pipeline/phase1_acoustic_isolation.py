from __future__ import annotations

import hashlib
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable

from video_dubbing.config import DubbingConfig
from video_dubbing.utils.audio_utils import ffmpeg_extract_audio


VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}


def _build_cache_key(source_path: Path, cfg: DubbingConfig) -> str:
    digest = hashlib.sha256()
    digest.update(str(source_path.resolve()).encode("utf-8", errors="ignore"))
    try:
        digest.update(str(source_path.stat().st_size).encode("utf-8"))
        digest.update(str(int(source_path.stat().st_mtime)).encode("utf-8"))
    except Exception:
        pass
    digest.update(cfg.phase1_model.encode("utf-8", errors="ignore"))
    digest.update(cfg.dereverb_model.encode("utf-8", errors="ignore"))
    return digest.hexdigest()[:40]


def _copy_if_exists(src: Path, dst: Path) -> bool:
    if not src.exists():
        return False
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)
    return True


def run(ctx: dict[str, Any], cfg: DubbingConfig, log: Callable[[str], None]) -> dict[str, Any]:
    source_path = Path(str(ctx.get("source_path") or "")).resolve()
    if not source_path.exists():
        raise RuntimeError("phase_failed:acoustic_isolation:missing_source")

    audio_raw = cfg.output_root / "audio_raw.wav"
    vocals_dry = cfg.output_root / "vocals_dry.wav"
    music_effects = cfg.output_root / "music_effects.wav"

    cache_key = _build_cache_key(source_path, cfg)
    cache_root = cfg.cache_dir / "phase1" / cache_key
    cache_audio = cache_root / "audio_raw.wav"
    cache_vocals = cache_root / "vocals_dry.wav"
    cache_me = cache_root / "music_effects.wav"

    cache_hit = cache_audio.exists() and cache_vocals.exists() and cache_me.exists()
    if cache_hit:
        _copy_if_exists(cache_audio, audio_raw)
        _copy_if_exists(cache_vocals, vocals_dry)
        _copy_if_exists(cache_me, music_effects)
        log(f"phase1 cache hit: {cache_key}")
    else:
        try:
            ffmpeg_extract_audio(source_path, audio_raw, sample_rate=cfg.sample_rate)
        except Exception as exc:
            raise RuntimeError(f"phase_failed:acoustic_isolation:audio_extract:{exc}") from exc

        separated_vocals = None
        separated_no_vocals = None
        try:
            demucs_out = cfg.output_root / "htdemucs"
            cmd = [
                "demucs",
                "-n",
                cfg.demucs_model,
                "--two-stems",
                "vocals",
                "-o",
                str(cfg.output_root),
                str(audio_raw),
            ]
            subprocess.run(cmd, check=True, capture_output=True)
            candidate_vocals = demucs_out / audio_raw.stem / "vocals.wav"
            candidate_no_vocals = demucs_out / audio_raw.stem / "no_vocals.wav"
            if candidate_vocals.exists() and candidate_no_vocals.exists():
                separated_vocals = candidate_vocals
                separated_no_vocals = candidate_no_vocals
                log("phase1 demucs-compatible separation completed")
        except Exception as exc:
            log(f"phase1 separation fallback: {exc}")

        base_vocals = separated_vocals or audio_raw
        base_me = separated_no_vocals or audio_raw

        # Dereverb model is represented as an asset/config label. Fallback path keeps audio dry-ready.
        if not _copy_if_exists(base_vocals, vocals_dry):
            raise RuntimeError("phase_failed:acoustic_isolation:missing_vocals")
        if not _copy_if_exists(base_me, music_effects):
            raise RuntimeError("phase_failed:acoustic_isolation:missing_music_effects")

        cache_root.mkdir(parents=True, exist_ok=True)
        _copy_if_exists(audio_raw, cache_audio)
        _copy_if_exists(vocals_dry, cache_vocals)
        _copy_if_exists(music_effects, cache_me)

    assets = dict(ctx.get("assets") or {})
    assets.update(
        {
            "phase1Model": cfg.phase1_model,
            "dereverbModel": cfg.dereverb_model,
            "phase1AssetPath": str(cfg.phase1_asset_path) if cfg.phase1_asset_path else None,
            "dereverbAssetPath": str(cfg.dereverb_asset_path) if cfg.dereverb_asset_path else None,
            "phase1AssetReady": bool(cfg.phase1_asset_path and cfg.phase1_asset_path.exists()),
            "dereverbAssetReady": bool(cfg.dereverb_asset_path and cfg.dereverb_asset_path.exists()),
        }
    )

    ctx.update(
        {
            "audio_raw": str(audio_raw),
            "vocals_dry": str(vocals_dry),
            "music_effects": str(music_effects),
            # Compatibility keys consumed by older helpers.
            "vocals": str(vocals_dry),
            "no_vocals": str(music_effects),
            "phase1": {
                "model": cfg.phase1_model,
                "dereverbModel": cfg.dereverb_model,
                "cacheKey": cache_key,
                "cacheHit": cache_hit,
            },
            "assets": assets,
        }
    )

    # Preserve original media type hint for downstream video assembly.
    ctx["source_is_video"] = source_path.suffix.lower() in VIDEO_SUFFIXES
    return ctx
