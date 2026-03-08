from __future__ import annotations

from typing import Any

PHASE_ORDER = [
    "acoustic_isolation",
    "speaker_segmentation",
    "translation",
    "tts",
    "voice_transfer",
    "video_lipsync",
]

PHASE_INPUT_KEYS: dict[str, set[str]] = {
    "acoustic_isolation": {"source_path", "target_language"},
    "speaker_segmentation": {"vocals_dry", "target_language"},
    "translation": {"segments", "target_language"},
    "tts": {"segments", "director_json", "target_language"},
    "voice_transfer": {"base_tts_segments", "voice_model"},
    "video_lipsync": {"segments", "voice_transfer_segments", "audio_raw", "music_effects", "source_path"},
}

PHASE_OUTPUT_KEYS: dict[str, set[str]] = {
    "acoustic_isolation": {"audio_raw", "vocals_dry", "music_effects", "phase1", "assets"},
    "speaker_segmentation": {"segments", "director_json", "thinking_policy"},
    "translation": {"segments", "isochrony_stats"},
    "tts": {"base_tts_segments", "tts_requests", "synthesis_failures"},
    "voice_transfer": {"voice_transfer_segments", "voice_transfer_metrics"},
    "video_lipsync": {"dubbed_audio", "dubbed_video_final", "alignment", "video_sync_metrics"},
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
