from __future__ import annotations

from typing import Any


STAGE_ORDER = [
    "stage1_preprocess",
    "stage2_diarize",
    "stage3_emotion",
    "stage4_segment_detect",
    "stage5_translate",
    "stage6_tts",
    "stage7_world",
    "stage8_reconstruct",
    "stage9_lipsync",
]

STAGE_INPUT_KEYS: dict[str, set[str]] = {
    "stage1_preprocess": {"source_path", "target_language", "voice_map"},
    "stage2_diarize": {"vocals", "segments"},
    "stage3_emotion": {"vocals", "segments"},
    "stage4_segment_detect": {"vocals", "segments"},
    "stage5_translate": {"segments", "target_language"},
    "stage6_tts": {"segments", "vocals"},
    "stage7_world": {"segments", "tts_segments", "vocals"},
    "stage8_reconstruct": {"segments", "world_segments", "audio_raw", "no_vocals", "source_path"},
    "stage9_lipsync": {"dubbed_video_raw"},
}

STAGE_OUTPUT_KEYS: dict[str, set[str]] = {
    "stage1_preprocess": {"audio_raw", "vocals", "no_vocals", "language", "segments"},
    "stage2_diarize": {"segments"},
    "stage3_emotion": {"segments"},
    "stage4_segment_detect": {"segments"},
    "stage5_translate": {"segments"},
    "stage6_tts": {"tts_segments"},
    "stage7_world": {"world_segments"},
    "stage8_reconstruct": {"dubbed_audio", "dubbed_video_raw"},
    "stage9_lipsync": {"dubbed_video_final"},
}


def validate_stage_contract(stage_name: str, ctx: dict[str, Any], *, when: str) -> None:
    if when not in {"before", "after"}:
        raise ValueError("when must be before or after")
    key_map = STAGE_INPUT_KEYS if when == "before" else STAGE_OUTPUT_KEYS
    required = key_map.get(stage_name, set())
    missing = [key for key in sorted(required) if key not in ctx or ctx.get(key) is None]
    if missing:
        raise RuntimeError(
            f"stage_contract_violation:{stage_name}:{when}:missing={','.join(missing)}"
        )
