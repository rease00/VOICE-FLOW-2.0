from __future__ import annotations

import base64
import importlib.util
import re
import sys
import threading
import time
import wave
from array import array
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


def _load_gemini_runtime_module():
    root = Path(__file__).resolve().parents[1]
    runtime_dir = root / "engines" / "gemini-runtime"
    module_path = runtime_dir / "app.py"
    if str(runtime_dir) not in sys.path:
        sys.path.insert(0, str(runtime_dir))
    spec = importlib.util.spec_from_file_location("gemini_runtime_app", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _make_key(seed: int) -> str:
    return f"AIza{seed:030d}"


def _pcm_for_line_ids(line_ids: list[int]) -> bytes:
    samples = array("h")
    for line_id in line_ids:
        amplitude = 1000 + (line_id * 100)
        samples.extend([amplitude] * 320)
        samples.extend([0] * 220)
    if sys.byteorder != "little":
        samples.byteswap()
    return samples.tobytes()


def _line_map_for_speakers(speakers: list[str]) -> list[dict[str, object]]:
    out: list[dict[str, object]] = []
    for index, speaker in enumerate(speakers):
        out.append(
            {
                "lineIndex": index,
                "speaker": speaker,
                "text": f"line_{index}",
            }
        )
    return out


def _speaker_voices(speakers: list[str]) -> list[dict[str, str]]:
    return [
        {
            "speaker": speaker,
            "voiceName": f"Voice{index}",
        }
        for index, speaker in enumerate(speakers)
    ]


def _parse_line_ids(text_input: str) -> list[int]:
    out: list[int] = []
    for line in str(text_input or "").splitlines():
        matched = re.search(r"line_(\d+)", line)
        if matched:
            out.append(int(matched.group(1)))
    return out


def _decode_wav_samples(wav_bytes: bytes) -> list[int]:
    with wave.open(BytesIO(wav_bytes), "rb") as handle:
        frames = handle.readframes(handle.getnframes())
    samples = array("h")
    samples.frombytes(frames)
    if sys.byteorder != "little":
        samples.byteswap()
    return list(samples)


def _extract_non_silent_run_levels(samples: list[int]) -> list[int]:
    out: list[int] = []
    index = 0
    threshold = 200
    while index < len(samples):
        if abs(samples[index]) < threshold:
            index += 1
            continue
        start = index
        while index < len(samples) and abs(samples[index]) >= threshold:
            index += 1
        run = samples[start:index]
        if not run:
            continue
        avg_level = int(round(sum(abs(value) for value in run) / len(run)))
        normalized = int(round(avg_level / 100.0) * 100)
        out.append(normalized)
    return out


def _configure_runtime_for_local_tests(runtime, key_pool: list[str]) -> None:
    runtime.VF_TTS_UPSTREAM_PROVIDER = runtime.TTS_UPSTREAM_PROVIDER_RUNTIME
    runtime.VF_TTS_TEXTTOSPEECH_ONLY = False
    runtime._SERVER_API_KEY_POOL = tuple(key_pool)
    runtime._SERVER_API_KEY_SET = frozenset(key_pool)
    if runtime.genai is None:
        runtime.genai = object()
    if runtime.types is None:
        runtime.types = object()


def _runtime_auth_context(runtime) -> tuple[str, dict[str, object]]:
    source_policy = dict(runtime._runtime_source_policy())
    auth_mode = str(runtime._normalize_runtime_auth_mode(None, source_policy=source_policy))
    return auth_mode, source_policy


def test_build_studio_pair_groups_pairs_speakers_in_sequence() -> None:
    runtime = _load_gemini_runtime_module()
    line_map = _line_map_for_speakers(["A", "B", "C", "D", "E"])
    speaker_voices = _speaker_voices(["A", "B", "C", "D", "E"])

    groups = runtime._build_studio_pair_groups(line_map, speaker_voices, "Fenrir")
    assert len(groups) == 3
    assert groups[0]["speakers"] == ["A", "B"]
    assert groups[1]["speakers"] == ["C", "D"]
    assert groups[2]["speakers"] == ["E"]


def test_canonicalize_multi_speaker_identities_preserves_consistent_names() -> None:
    runtime = _load_gemini_runtime_module()
    speaker_voices = [
        {"speaker": "Host", "voiceName": "Fenrir"},
        {"speaker": "Guest", "voiceName": "Kore"},
    ]
    line_map = [
        {"lineIndex": 0, "speaker": "host", "text": "line_0"},
        {"lineIndex": 1, "speaker": "HOST", "text": "line_1"},
        {"lineIndex": 2, "speaker": "guest", "text": "line_2"},
        {"lineIndex": 3, "speaker": "GUEST", "text": "line_3"},
    ]
    canonical_voices, canonical_line_map = runtime._canonicalize_multi_speaker_identities(
        speaker_voices,
        line_map,
    )
    assert [entry["speaker"] for entry in canonical_voices] == ["Host", "Guest"]
    assert [row["speaker"] for row in canonical_line_map] == ["Host", "Host", "Guest", "Guest"]


def test_grouped_synthesis_caps_concurrency_by_pool_size() -> None:
    runtime = _load_gemini_runtime_module()
    auth_mode, source_policy = _runtime_auth_context(runtime)
    speakers = ["A", "B", "C", "D", "E"]
    line_map = _line_map_for_speakers(speakers)
    speaker_voices = _speaker_voices(speakers)
    key_pool = [_make_key(1), _make_key(2)]

    original = runtime._synthesize_pcm_with_key_pool
    lock = threading.Lock()
    active = 0
    max_active = 0

    def _stub_synthesize_pcm_with_key_pool(**kwargs):
        nonlocal active, max_active
        with lock:
            active += 1
            if active > max_active:
                max_active = active
        try:
            time.sleep(0.05)
            line_ids = _parse_line_ids(str(kwargs.get("text_input") or ""))
            if not line_ids:
                line_ids = [0]
            return _pcm_for_line_ids(line_ids), "gemini-2.5-flash-preview-tts", "multi-speaker", 0
        finally:
            with lock:
                active -= 1

    try:
        runtime._synthesize_pcm_with_key_pool = _stub_synthesize_pcm_with_key_pool
        result = runtime._synthesize_studio_pair_groups(
            trace_id="trace_concurrency",
            engine="PRIME",
            auth_mode=auth_mode,
            source_policy=source_policy,
            target_voice="Fenrir",
            language_code="en",
            speaker_hint="",
            normalized_speaker_voices=speaker_voices,
            normalized_line_map=line_map,
            primary_key_pool=key_pool,
            fallback_request_key=None,
            effective_key_pool=key_pool,
            requested_concurrency=7,
            retry_once=True,
        )
        diagnostics = result.get("diagnostics") or {}
        assert diagnostics.get("concurrencyUsed") == 2
        assert max_active <= 2
    finally:
        runtime._synthesize_pcm_with_key_pool = original


def test_grouped_synthesis_reassembles_audio_in_line_index_order() -> None:
    runtime = _load_gemini_runtime_module()
    auth_mode, source_policy = _runtime_auth_context(runtime)
    speakers = ["A", "B", "C", "D"]
    line_map = _line_map_for_speakers(speakers)
    speaker_voices = _speaker_voices(speakers)
    key_pool = [_make_key(11), _make_key(12), _make_key(13)]

    original = runtime._synthesize_pcm_with_key_pool

    def _stub_synthesize_pcm_with_key_pool(**kwargs):
        line_ids = _parse_line_ids(str(kwargs.get("text_input") or ""))
        return _pcm_for_line_ids(line_ids), "gemini-2.5-flash-preview-tts", "multi-speaker", 0

    try:
        runtime._synthesize_pcm_with_key_pool = _stub_synthesize_pcm_with_key_pool
        result = runtime._synthesize_studio_pair_groups(
            trace_id="trace_ordering",
            engine="PRIME",
            auth_mode=auth_mode,
            source_policy=source_policy,
            target_voice="Fenrir",
            language_code="en",
            speaker_hint="",
            normalized_speaker_voices=speaker_voices,
            normalized_line_map=line_map,
            primary_key_pool=key_pool,
            fallback_request_key=None,
            effective_key_pool=key_pool,
            requested_concurrency=7,
            retry_once=True,
        )
        samples = _decode_wav_samples(bytes(result["wavBytes"]))
        levels = _extract_non_silent_run_levels(samples)
        assert levels[:4] == [1000, 1100, 1200, 1300]
    finally:
        runtime._synthesize_pcm_with_key_pool = original


def test_grouped_synthesis_reports_key_selection_history() -> None:
    runtime = _load_gemini_runtime_module()
    auth_mode, source_policy = _runtime_auth_context(runtime)
    speakers = ["A", "B", "C", "D", "E"]
    line_map = _line_map_for_speakers(speakers)
    speaker_voices = _speaker_voices(speakers)
    key_pool = [_make_key(14), _make_key(15), _make_key(16)]

    original = runtime._synthesize_pcm_with_key_pool

    def _stub_synthesize_pcm_with_key_pool(**kwargs):
        line_ids = _parse_line_ids(str(kwargs.get("text_input") or ""))
        first_line_id = line_ids[0] if line_ids else 0
        key_index = 0 if first_line_id == 0 else (2 if first_line_id == 2 else 1)
        return _pcm_for_line_ids(line_ids), "gemini-2.5-flash-preview-tts", "multi-speaker", key_index

    try:
        runtime._synthesize_pcm_with_key_pool = _stub_synthesize_pcm_with_key_pool
        result = runtime._synthesize_studio_pair_groups(
            trace_id="trace_key_history",
            engine="PRIME",
            auth_mode=auth_mode,
            source_policy=source_policy,
            target_voice="Fenrir",
            language_code="en",
            speaker_hint="",
            normalized_speaker_voices=speaker_voices,
            normalized_line_map=line_map,
            primary_key_pool=key_pool,
            fallback_request_key=None,
            effective_key_pool=key_pool,
            requested_concurrency=7,
            retry_once=True,
        )
        diagnostics = dict(result.get("diagnostics") or {})
        assert int(result.get("keySelectionIndex", -1)) == 1
        assert int(result.get("firstKeySelectionIndex", -1)) == 0
        assert int(result.get("finalKeySelectionIndex", -1)) == 1
        assert list(result.get("keySelectionIndexes") or []) == [0, 2, 1]
        assert int(diagnostics.get("keySelectionIndex", -1)) == 1
        assert int(diagnostics.get("firstKeySelectionIndex", -1)) == 0
        assert int(diagnostics.get("finalKeySelectionIndex", -1)) == 1
        assert list(diagnostics.get("keySelectionIndexes") or []) == [0, 2, 1]
    finally:
        runtime._synthesize_pcm_with_key_pool = original


def test_grouped_synthesis_retries_failed_group_once() -> None:
    runtime = _load_gemini_runtime_module()
    auth_mode, source_policy = _runtime_auth_context(runtime)
    speakers = ["A", "B", "C"]
    line_map = _line_map_for_speakers(speakers)
    speaker_voices = _speaker_voices(speakers)
    key_pool = [_make_key(21), _make_key(22)]

    original = runtime._synthesize_pcm_with_key_pool
    attempts: dict[int, int] = {}

    def _stub_synthesize_pcm_with_key_pool(**kwargs):
        group_index = int(kwargs.get("window_index") or 0)
        attempts[group_index] = attempts.get(group_index, 0) + 1
        if group_index == 1 and attempts[group_index] == 1:
            raise RuntimeError("temporary_group_failure")
        line_ids = _parse_line_ids(str(kwargs.get("text_input") or ""))
        return _pcm_for_line_ids(line_ids), "gemini-2.5-flash-preview-tts", "multi-speaker", 0

    try:
        runtime._synthesize_pcm_with_key_pool = _stub_synthesize_pcm_with_key_pool
        result = runtime._synthesize_studio_pair_groups(
            trace_id="trace_retry",
            engine="PRIME",
            auth_mode=auth_mode,
            source_policy=source_policy,
            target_voice="Fenrir",
            language_code="en",
            speaker_hint="",
            normalized_speaker_voices=speaker_voices,
            normalized_line_map=line_map,
            primary_key_pool=key_pool,
            fallback_request_key=None,
            effective_key_pool=key_pool,
            requested_concurrency=7,
            retry_once=True,
        )
        assert result["speechModeUsed"] == "studio_pair_groups"
        assert attempts.get(1) == 2
    finally:
        runtime._synthesize_pcm_with_key_pool = original


def test_synthesize_structured_returns_serial_line_chunks() -> None:
    runtime = _load_gemini_runtime_module()
    key_pool = [_make_key(31), _make_key(32), _make_key(33)]
    _configure_runtime_for_local_tests(runtime, key_pool)
    speakers = ["A", "B", "C", "D"]
    line_map = _line_map_for_speakers(speakers)
    speaker_voices = _speaker_voices(speakers)
    original = runtime._synthesize_pcm_with_key_pool

    def _stub_synthesize_pcm_with_key_pool(**kwargs):
        line_ids = _parse_line_ids(str(kwargs.get("text_input") or ""))
        return _pcm_for_line_ids(line_ids), "gemini-2.5-flash-preview-tts", "multi-speaker", 0

    try:
        runtime._synthesize_pcm_with_key_pool = _stub_synthesize_pcm_with_key_pool
        client = TestClient(runtime.app)
        response = client.post(
            "/synthesize/structured",
            json={
                "text": "\n".join(f"{line['speaker']}: {line['text']}" for line in line_map),
                "voiceName": "Fenrir",
                "speaker_voices": speaker_voices,
                "multi_speaker_mode": "studio_pair_groups",
                "multi_speaker_max_concurrency": 7,
                "multi_speaker_retry_once": True,
                "multi_speaker_line_map": line_map,
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body.get("ok") is True
        assert body.get("speechModeUsed") == "studio_pair_groups"
        chunks = body.get("lineChunks")
        assert isinstance(chunks, list)
        assert [int(item.get("lineIndex", -1)) for item in chunks] == [0, 1, 2, 3]
        full_wav = base64.b64decode(str(body.get("wavBase64") or ""))
        levels = _extract_non_silent_run_levels(_decode_wav_samples(full_wav))
        assert levels[:4] == [1000, 1100, 1200, 1300]
    finally:
        runtime._synthesize_pcm_with_key_pool = original


@pytest.mark.parametrize("legacy_engine", ["GEMINI", "NEURAL2", "DUNO_RUNTIME"])
def test_synthesize_rejects_legacy_engine_aliases(legacy_engine: str) -> None:
    runtime = _load_gemini_runtime_module()
    client = TestClient(runtime.app)
    runtime._synthesize_pcm_with_key_pool = lambda *args, **kwargs: (_ for _ in ()).throw(
        AssertionError("legacy engine aliases should not reach synthesis")
    )

    response = client.post(
        "/synthesize",
        json={
            "engine": legacy_engine,
            "text": "hello world",
        },
    )

    assert response.status_code == 400
    assert "Invalid engine. Use DUNO, VECTOR, or PRIME." in str(response.json().get("detail") or response.text)


def test_grouped_long_text_is_windowed_and_reassembled() -> None:
    runtime = _load_gemini_runtime_module()
    key_pool = [_make_key(41), _make_key(42), _make_key(43)]
    _configure_runtime_for_local_tests(runtime, key_pool)
    original = runtime._synthesize_pcm_with_key_pool
    window_indexes_seen: list[int] = []
    lane_tokens_seen: list[str] = []
    lock = threading.Lock()
    active = 0
    max_active = 0

    def _stub_pcm_with_pool(**kwargs):
        nonlocal active, max_active
        with lock:
            active += 1
            if active > max_active:
                max_active = active
        try:
            time.sleep(0.03)
            text_input = str(kwargs.get("text_input") or "")
            matched = re.search(r"line_(\d+)", text_input)
            line_index = int(matched.group(1)) if matched else 0
            window_indexes_seen.append(int(kwargs.get("window_index") or 0))
            lane_tokens_seen.append(str((list(kwargs.get("affinity_speakers") or [""])[0] or "")))
            return _pcm_for_line_ids([line_index]), "gemini-2.5-flash-preview-tts", "single-speaker", 0
        finally:
            with lock:
                active -= 1

    try:
        runtime._synthesize_pcm_with_key_pool = _stub_pcm_with_pool
        speaker_voices = _speaker_voices(["A", "B", "C", "D"])
        line_map = []
        text_lines = []
        for index in range(6):
            speaker = ["A", "B", "C", "D"][index % 4]
            text = (f"line_{index} " + ("word " * 900)).strip()
            line_map.append({"lineIndex": index, "speaker": speaker, "text": text})
            text_lines.append(f"{speaker}: {text}")
        request = runtime.SynthesizeRequest(
            text="\n".join(text_lines),
            voiceName="Fenrir",
            speaker_voices=speaker_voices,
            multi_speaker_mode="studio_pair_groups",
            multi_speaker_line_map=line_map,
            return_line_chunks=True,
        )
        result = runtime._synthesize_text_to_wav(request)
        assert len(window_indexes_seen) > len(line_map)
        assert len(set(window_indexes_seen)) == len(window_indexes_seen)
        assert max_active <= 3
        assert max_active >= 2
        assert set(lane_tokens_seen) == {"lane:l1", "lane:l2", "lane:l3"}
        assert lane_tokens_seen.count("lane:l1") >= 3
        chunks = list(result.get("lineChunks") or [])
        assert [int(item.get("lineIndex", -1)) for item in chunks] == [0, 1, 2, 3, 4, 5]
        diagnostics = dict(result.get("diagnostics") or {})
        assert diagnostics.get("strategies") == ["dialogue_three_lane_scheduler", "sentence_aware_chunking"]
        assert int(diagnostics.get("laneCount") or 0) == 3
        levels = _extract_non_silent_run_levels(_decode_wav_samples(bytes(result["wavBytes"])))
        assert levels.count(1000) >= 3
        assert len(levels) >= len(window_indexes_seen)
    finally:
        runtime._synthesize_pcm_with_key_pool = original


def test_grouped_scripts_use_dialogue_scheduler_without_pair_group_recovery() -> None:
    runtime = _load_gemini_runtime_module()
    key_pool = [_make_key(51), _make_key(52)]
    _configure_runtime_for_local_tests(runtime, key_pool)

    original_pcm_with_pool = runtime._synthesize_pcm_with_key_pool

    def _stub_pcm_with_pool(**kwargs):
        line_ids = _parse_line_ids(str(kwargs.get("text_input") or ""))
        if not line_ids:
            line_ids = [0]
        return _pcm_for_line_ids(line_ids), "gemini-2.5-flash-preview-tts", "single-speaker", 0

    try:
        runtime._synthesize_pcm_with_key_pool = _stub_pcm_with_pool

        line_map = _line_map_for_speakers(["A", "B", "A", "B"])
        request = runtime.SynthesizeRequest(
            text="\n".join(f"{line['speaker']}: {line['text']}" for line in line_map),
            engine="VECTOR",
            voiceName="Fenrir",
            speaker_voices=_speaker_voices(["A", "B"]),
            multi_speaker_mode="studio_pair_groups",
            multi_speaker_line_map=line_map,
        )

        result = runtime._synthesize_text_to_wav(request)
        diagnostics = dict(result.get("diagnostics") or {})
        strategies = list(diagnostics.get("strategies") or [])

        assert len(bytes(result["wavBytes"])) > 0
        assert bool(diagnostics.get("recoveryUsed")) is False
        assert strategies == ["dialogue_three_lane_scheduler", "sentence_aware_chunking"]
        assert result.get("speechModeRequested") == "studio_pair_groups"
        assert result.get("speechModeUsed") == "studio_pair_groups"
    finally:
        runtime._synthesize_pcm_with_key_pool = original_pcm_with_pool
