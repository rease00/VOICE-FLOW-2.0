from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from fastapi.testclient import TestClient


def _load_gemini_runtime_module():
    workspace_root = Path(__file__).resolve().parents[1]
    runtime_dir = workspace_root / "engines" / "gemini-runtime"
    module_path = runtime_dir / "app.py"
    if str(workspace_root) not in sys.path:
        sys.path.insert(0, str(workspace_root))
    if str(runtime_dir) not in sys.path:
        sys.path.insert(0, str(runtime_dir))
    spec = importlib.util.spec_from_file_location("gemini_runtime_app_single_speaker_segmentation", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _make_key(seed: int) -> str:
    return f"AIza{seed:030d}"


def test_single_speaker_long_text_uses_segmented_windows() -> None:
    runtime = _load_gemini_runtime_module()
    runtime.VF_TTS_UPSTREAM_PROVIDER = runtime.TTS_UPSTREAM_PROVIDER_RUNTIME
    runtime.VF_TTS_TEXTTOSPEECH_ONLY = False
    runtime._SERVER_API_KEY_POOL = (_make_key(1), _make_key(2), _make_key(3))
    runtime._SERVER_API_KEY_SET = frozenset(runtime._SERVER_API_KEY_POOL)
    runtime.genai = object()
    runtime.types = object()

    original = runtime._synthesize_pcm_with_key_pool
    window_char_counts: list[int] = []
    window_indexes: list[int] = []
    lane_tokens: list[str] = []
    window_key_indexes: list[int] = []

    def _stub_synthesize_pcm_with_key_pool(**kwargs):
        text_input = str(kwargs.get("text_input") or "")
        window_char_counts.append(len(text_input))
        window_indexes.append(int(kwargs.get("window_index") or 0))
        lane_tokens.append(str((list(kwargs.get("affinity_speakers") or [""])[0] or "")))
        key_index = min(len(window_char_counts) - 1, 2)
        window_key_indexes.append(key_index)
        return (b"\x01\x00" * 960), "gemini-2.5-flash-preview-tts", "single-speaker", key_index

    try:
        runtime._synthesize_pcm_with_key_pool = _stub_synthesize_pcm_with_key_pool
        payload = runtime.SynthesizeRequest(
            text=("word " * 3200).strip(),
            voiceName="Fenrir",
            voice_id="Fenrir",
            language="en",
            trace_id="segmented_single_speaker_test",
        )
        result = runtime._synthesize_text_to_wav(payload)
    finally:
        runtime._synthesize_pcm_with_key_pool = original

    diagnostics = dict(result.get("diagnostics") or {})
    segmentation = dict(diagnostics.get("segmentation") or {})
    assert len(window_char_counts) >= 5
    assert window_indexes == list(range(1, len(window_indexes) + 1))
    assert len(set(window_indexes)) == len(window_indexes)
    assert window_char_counts[0] <= 900
    assert window_char_counts[1] <= 900
    assert window_char_counts[2] <= 2400
    assert all(count <= 4000 for count in window_char_counts[3:])
    assert lane_tokens[0] == "lane:l1"
    assert lane_tokens[1] == "lane:l1"
    assert lane_tokens[2] == "lane:l2"
    assert result.get("speechModeUsed") == "single-speaker-segmented"
    assert int(result.get("firstKeySelectionIndex", -1)) == window_key_indexes[0]
    assert int(result.get("finalKeySelectionIndex", -1)) == window_key_indexes[-1]
    assert list(result.get("keySelectionIndexes") or []) == window_key_indexes
    assert diagnostics.get("strategies") == ["single_speaker_three_lane_scheduler", "sentence_aware_chunking"]
    assert int(diagnostics.get("keySelectionIndex", -1)) == window_key_indexes[-1]
    assert int(diagnostics.get("firstKeySelectionIndex", -1)) == window_key_indexes[0]
    assert int(diagnostics.get("finalKeySelectionIndex", -1)) == window_key_indexes[-1]
    assert list(diagnostics.get("keySelectionIndexes") or []) == window_key_indexes
    assert segmentation.get("enabled") is True
    assert segmentation.get("profile") == "sentence-aware-three-lane"
    assert int(segmentation.get("chunkCount") or 0) == len(window_char_counts)
    assert int(segmentation.get("laneCount") or 0) == 3
    assert list(segmentation.get("laneAssignments") or [])[:3] == ["L1", "L1", "L2"]


def test_capabilities_publish_segmentation_metadata() -> None:
    runtime = _load_gemini_runtime_module()
    runtime.VF_TTS_UPSTREAM_PROVIDER = runtime.TTS_UPSTREAM_PROVIDER_RUNTIME
    runtime.VF_TTS_TEXTTOSPEECH_ONLY = False
    runtime._SERVER_API_KEY_POOL = (_make_key(2), _make_key(3))
    runtime._SERVER_API_KEY_SET = frozenset(runtime._SERVER_API_KEY_POOL)
    runtime.genai = object()
    runtime.types = object()

    client = TestClient(runtime.app)
    response = client.get("/v1/capabilities")
    assert response.status_code == 200
    payload = response.json()
    metadata = dict(payload.get("metadata") or {})

    assert metadata.get("segmentation") == "enabled"
    assert metadata.get("segmentationProfile") == "sentence-aware-three-lane"
    profiles = dict(metadata.get("segmentationProfiles") or {})
    assert int((profiles.get("default") or {}).get("hard_char_cap") or 0) == 4000
    assert int((profiles.get("default") or {}).get("target_char_cap") or 0) == 4000
    assert int((profiles.get("default") or {}).get("max_words_per_chunk") or 0) == 800
    assert len(list((profiles.get("default") or {}).get("single_lane_plan") or [])) == 6
    assert list((profiles.get("default") or {}).get("multi_first_dialog_targets") or []) == [500, 500, 3000]
    assert int((profiles.get("hi") or {}).get("hard_char_cap") or 0) == 4000
    assert int((profiles.get("hi") or {}).get("target_char_cap") or 0) == 4000
    assert int((profiles.get("hi") or {}).get("max_words_per_chunk") or 0) == 800
