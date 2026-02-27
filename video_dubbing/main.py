from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Callable, Optional

from video_dubbing.config import DubbingConfig, build_config, run_strict_preflight
from video_dubbing.pipeline import (
    stage1_preprocess,
    stage2_diarize,
    stage3_emotion,
    stage4_segment_detect,
    stage5_translate,
    stage6_tts,
    stage7_world,
    stage8_reconstruct,
    stage9_lipsync,
)
from video_dubbing.pipeline.pipeline_contracts import STAGE_ORDER, validate_stage_contract


def run_pipeline(
    source_path: str | Path,
    output_dir: str | Path,
    *,
    target_language: str = "hi",
    tts_route: str = "auto",
    voice_map: dict[str, str] | None = None,
    strict: bool = False,
    voice_map_resolver: Optional[Callable[[list[dict], dict[str, str]], dict[str, str]]] = None,
    logger: Callable[[str], None] | None = None,
) -> dict:
    source = Path(source_path).resolve()
    output_root = Path(output_dir).resolve()
    cfg: DubbingConfig = build_config(output_root)

    if not source.exists():
        raise FileNotFoundError(f"Source media not found: {source}")

    copied_source = cfg.output_root / source.name
    if source != copied_source:
        shutil.copyfile(source, copied_source)

    logs: list[str] = []

    def log(message: str) -> None:
        logs.append(message)
        if logger:
            logger(message)

    if strict:
        preflight = run_strict_preflight(cfg, source)
        log(f"[preflight] checks={len(preflight['checks'])} ok={preflight['ok']}")
        if not preflight["ok"]:
            raise RuntimeError("strict_preflight_failed")

    ctx: dict = {
        "source_path": str(copied_source),
        "output_dir": str(cfg.output_root),
        "target_language": target_language,
        "tts_route": str(tts_route or "auto").strip().lower(),
        "voice_map": voice_map or {},
    }

    stages = {
        "stage1_preprocess": stage1_preprocess.run,
        "stage2_diarize": stage2_diarize.run,
        "stage3_emotion": stage3_emotion.run,
        "stage4_segment_detect": stage4_segment_detect.run,
        "stage5_translate": stage5_translate.run,
        "stage6_tts": stage6_tts.run,
        "stage7_world": stage7_world.run,
        "stage8_reconstruct": stage8_reconstruct.run,
        "stage9_lipsync": stage9_lipsync.run,
    }

    for stage_name in STAGE_ORDER[:5]:
        validate_stage_contract(stage_name, ctx, when="before")
        log(f"[stage:start] {stage_name}")
        stages[stage_name](ctx, cfg, log)
        validate_stage_contract(stage_name, ctx, when="after")
        log(f"[stage:end] {stage_name}")

    resolved_voice_map = dict(voice_map or {})
    if voice_map_resolver:
        try:
            maybe = voice_map_resolver(list(ctx.get("segments") or []), resolved_voice_map)
            if isinstance(maybe, dict):
                resolved_voice_map = maybe
        except Exception as exc:
            log(f"[voice-map-resolver] failed: {exc}")
    for seg in ctx.get("segments") or []:
        speaker = str(seg.get("speaker") or "SPEAKER_00")
        if speaker in resolved_voice_map:
            seg["voice_id"] = resolved_voice_map[speaker]
        elif resolved_voice_map.get("default"):
            seg["voice_id"] = resolved_voice_map["default"]
    ctx["voice_map_resolved"] = resolved_voice_map

    for stage_name in STAGE_ORDER[5:]:
        validate_stage_contract(stage_name, ctx, when="before")
        log(f"[stage:start] {stage_name}")
        stages[stage_name](ctx, cfg, log)
        validate_stage_contract(stage_name, ctx, when="after")
        log(f"[stage:end] {stage_name}")

    result = {
        "ok": True,
        "output_dir": str(cfg.output_root),
        "dubbed_audio": ctx.get("dubbed_audio"),
        "dubbed_video_raw": ctx.get("dubbed_video_raw"),
        "dubbed_video_final": ctx.get("dubbed_video_final"),
        "segments": ctx.get("segments") or [],
        "speaker_profiles": ctx.get("speaker_profiles") or [],
        "tts_requests": ctx.get("tts_requests") or [],
        "synthesis_failures": ctx.get("synthesis_failures") or [],
        "alignment": ctx.get("alignment") or [],
        "voice_map_resolved": ctx.get("voice_map_resolved") or {},
        "logs": logs,
    }

    (cfg.output_root / "job.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def _parse_voice_map(raw: str) -> dict[str, str]:
    if not raw.strip():
        return {}
    try:
        payload = json.loads(raw)
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def main() -> None:
    parser = argparse.ArgumentParser(description="Real video dubbing pipeline")
    parser.add_argument("input", help="input media path (video/audio)")
    parser.add_argument("--output-dir", default=str(Path(__file__).resolve().parent / "output"))
    parser.add_argument("--target-language", default="hi")
    parser.add_argument("--tts-route", default="auto", choices=["auto", "gem_only", "kokoro_only"])
    parser.add_argument("--voice-map", default="{}", help='JSON, e.g. {"SPEAKER_00":"alloy"}')
    args = parser.parse_args()

    voice_map = _parse_voice_map(args.voice_map)
    result = run_pipeline(
        args.input,
        args.output_dir,
        target_language=args.target_language,
        tts_route=args.tts_route,
        voice_map=voice_map,
        strict=False,
        logger=lambda msg: print(f"[video_dubbing] {msg}"),
    )
    print(json.dumps({k: v for k, v in result.items() if k != "segments"}, indent=2))


if __name__ == "__main__":
    main()
