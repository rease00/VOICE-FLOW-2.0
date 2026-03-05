from __future__ import annotations

from typing import Any

PHASE_ORDER = [
    "acoustic_isolation",
    "director",
    "isochrony_translation",
    "base_tts",
    "llvc_timbre_transfer",
    "visual_lipsync",
]

PHASE_INPUT_KEYS: dict[str, set[str]] = {
    "acoustic_isolation": {"source_path", "target_language"},
    "director": {"vocals_dry", "target_language"},
    "isochrony_translation": {"segments", "target_language"},
    "base_tts": {"segments", "director_json", "target_language"},
    "llvc_timbre_transfer": {"base_tts_segments"},
    "visual_lipsync": {"segments", "llvc_segments", "audio_raw", "music_effects", "source_path"},
}

PHASE_OUTPUT_KEYS: dict[str, set[str]] = {
    "acoustic_isolation": {"audio_raw", "vocals_dry", "music_effects", "phase1", "assets"},
    "director": {"segments", "director_json", "thinking_policy"},
    "isochrony_translation": {"segments", "isochrony_stats"},
    "base_tts": {"base_tts_segments", "tts_requests", "synthesis_failures"},
    "llvc_timbre_transfer": {"llvc_segments", "llvc_metrics"},
    "visual_lipsync": {"dubbed_audio", "dubbed_video_final", "alignment", "lipsync_metrics"},
}


def validate_stage_contract(stage_name: str, ctx: dict[str, Any], *, when: str) -> None:
    if when not in {"before", "after"}:
        raise ValueError("when must be 'before' or 'after'")
    key_map = PHASE_INPUT_KEYS if when == "before" else PHASE_OUTPUT_KEYS
    required = key_map.get(stage_name, set())
    missing = sorted(key for key in required if key not in ctx or ctx.get(key) is None)
    if missing:
        raise RuntimeError(
            f"stage_contract_violation:{stage_name}:{when}:missing={','.join(missing)}"
        )
