from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any, Callable, Optional

from video_dubbing.config import DubbingConfig, build_config, run_strict_preflight
from video_dubbing.pipeline import (
    phase1_acoustic_isolation,
    phase2_director_multimodal,
    phase3_isochrony_translation,
    stage6_tts,
    phase5_llvc_timbre_transfer,
    phase6_lipsync_onnx,
)
from video_dubbing.pipeline.pipeline_contracts import PHASE_ORDER, validate_stage_contract


def _apply_config_overrides(cfg: DubbingConfig, overrides: dict[str, Any] | None) -> None:
    if not isinstance(overrides, dict):
        return
    aliases = {
        "llvc_preset": "voice_transfer_preset",
    }
    for key, value in overrides.items():
        resolved_key = aliases.get(key, key)
        if resolved_key == "voice_transfer_preset":
            try:
                value = str(value or "").strip() or cfg.voice_transfer_preset
            except Exception:
                value = cfg.voice_transfer_preset
        key = resolved_key
        if not hasattr(cfg, key):
            continue
        try:
            setattr(cfg, key, value)
        except Exception:
            continue


def run_pipeline(
    source_path: str | Path,
    output_dir: str | Path,
    *,
    target_language: str = "hi",
    tts_route: str = "auto",
    voice_map: dict[str, str] | None = None,
    strict: bool = False,
    transcript_override: str = "",
    config_overrides: dict[str, Any] | None = None,
    voice_map_resolver: Optional[Callable[[list[dict], dict[str, str]], dict[str, str]]] = None,
    runtime_options: dict[str, Any] | None = None,
    logger: Callable[[str], None] | None = None,
) -> dict:
    source = Path(source_path).resolve()
    output_root = Path(output_dir).resolve()
    cfg: DubbingConfig = build_config(output_root)
    _apply_config_overrides(cfg, config_overrides)

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
        "transcript_override": str(transcript_override or "").strip(),
        "pipeline_version": cfg.pipeline_version,
    }
    runtime_options_payload = runtime_options if isinstance(runtime_options, dict) else {}
    ctx["multispeaker_policy"] = str(runtime_options_payload.get("multispeaker_policy") or "hybrid_auto").strip().lower()
    ctx["voice_binding_policy"] = str(runtime_options_payload.get("voice_binding_policy") or "stable_fallback").strip().lower()
    ctx["qos_policy"] = str(runtime_options_payload.get("qos_policy") or "adaptive_hq_first").strip().lower()
    ctx["hardware_policy"] = str(runtime_options_payload.get("hardware_policy") or "gpu_preferred").strip().lower()
    ctx["timeout_policy"] = str(runtime_options_payload.get("timeout_policy") or "adaptive").strip().lower()
    ctx["live_play_mode"] = str(runtime_options_payload.get("live_play_mode") or "off").strip().lower()
    ctx["live_chunk_target_ms"] = int(runtime_options_payload.get("live_chunk_target_ms") or 3000)
    ctx["max_speaker_count"] = int(runtime_options_payload.get("max_speaker_count") or 8)
    ctx["source_language_mode"] = str(runtime_options_payload.get("source_language_mode") or cfg.source_language_mode).strip().lower()
    ctx["language_coverage_profile"] = str(runtime_options_payload.get("language_coverage_profile") or cfg.language_coverage_profile).strip().lower()
    ctx["strict_gemini_only"] = bool(runtime_options_payload.get("strict_gemini_only"))
    ctx["strict_no_fallback"] = bool(runtime_options_payload.get("strict_no_fallback"))
    ctx["director_model"] = str(runtime_options_payload.get("director_model") or cfg.director_model).strip() or cfg.director_model
    ctx["tts_model"] = str(runtime_options_payload.get("tts_model") or cfg.tts_model).strip() or cfg.tts_model
    ctx["voice_model"] = str(runtime_options_payload.get("voice_model") or "").strip()
    ctx["policy_enforcement"] = (
        dict(runtime_options_payload.get("policy_enforcement"))
        if isinstance(runtime_options_payload.get("policy_enforcement"), dict)
        else {}
    )
    live_chunk_callback = runtime_options_payload.get("live_chunk_callback")
    if callable(live_chunk_callback):
        ctx["live_chunk_callback"] = live_chunk_callback

    phases = {
        "acoustic_isolation": phase1_acoustic_isolation.run,
        "speaker_segmentation": phase2_director_multimodal.run,
        "translation": phase3_isochrony_translation.run,
        "tts": stage6_tts.run,
        "voice_transfer": phase5_llvc_timbre_transfer.run,
        "video_lipsync": phase6_lipsync_onnx.run,
    }

    resolved_voice_map = dict(voice_map or {})
    resolved_map_applied = False

    def _apply_voice_bindings_before_tts() -> None:
        nonlocal resolved_voice_map
        nonlocal resolved_map_applied
        if resolved_map_applied:
            return
        segments = list(ctx.get("segments") or [])
        if voice_map_resolver:
            try:
                maybe = voice_map_resolver(segments, resolved_voice_map)
                if isinstance(maybe, dict):
                    resolved_voice_map = maybe
            except Exception as exc:
                log(f"[voice-map-resolver] failed: {exc}")

        safe_default = str(resolved_voice_map.get("default") or "").strip()
        if not safe_default:
            safe_default = "achernar"

        for segment in segments:
            speaker = str(segment.get("speaker") or "SPEAKER_00").strip() or "SPEAKER_00"
            chosen_voice = str(resolved_voice_map.get(speaker) or safe_default).strip() or safe_default
            if chosen_voice:
                segment["voice_id"] = chosen_voice
        ctx["segments"] = segments
        ctx["voice_map_resolved"] = dict(resolved_voice_map)
        resolved_map_applied = True

    for phase_name in PHASE_ORDER:
        validate_stage_contract(phase_name, ctx, when="before")
        if phase_name == "tts":
            _apply_voice_bindings_before_tts()
        log(f"[stage:start] {phase_name}")
        phases[phase_name](ctx, cfg, log)
        validate_stage_contract(phase_name, ctx, when="after")
        log(f"[stage:end] {phase_name}")
    if not resolved_map_applied:
        _apply_voice_bindings_before_tts()

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
        "director_json": ctx.get("director_json") or {},
        "isochrony_stats": ctx.get("isochrony_stats") or {},
        "voice_transfer_metrics": ctx.get("voice_transfer_metrics") or {},
        "video_sync_metrics": ctx.get("video_sync_metrics") or {},
        "token_usage": ctx.get("token_usage") or {},
        "assets": ctx.get("assets") or {},
        "thinking_policy": ctx.get("thinking_policy") or {},
        "json_diagnostics": ctx.get("json_diagnostics") or [],
        "speaker_fallback_bindings": ctx.get("speaker_fallback_bindings") or [],
        "language_stats": ctx.get("language_stats") or {},
        "policy_enforcement": ctx.get("policy_enforcement") or {},
        "pipeline_version": ctx.get("pipeline_version") or cfg.pipeline_version,
        "language": ctx.get("language") or "auto",
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
    parser = argparse.ArgumentParser(description="2026 video dubbing pipeline")
    parser.add_argument("input", help="input media path (video/audio)")
    parser.add_argument("--output-dir", default=str(Path(__file__).resolve().parent / "output"))
    parser.add_argument("--target-language", default="hi")
    parser.add_argument("--tts-route", default="auto", choices=["auto", "gem_only", "kokoro_only"])
    parser.add_argument("--voice-map", default="{}", help='JSON, e.g. {"SPEAKER_00":"achernar"}')
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
    print(json.dumps({k: v for k, v in result.items() if k not in {"segments", "logs"}}, indent=2))


if __name__ == "__main__":
    main()
