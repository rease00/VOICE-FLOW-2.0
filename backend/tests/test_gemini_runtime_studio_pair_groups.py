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
    runtime._SERVER_API_KEY_POOL = tuple(key_pool)
    runtime._SERVER_API_KEY_SET = frozenset(key_pool)
    if runtime.genai is None:
        runtime.genai = object()
    if runtime.types is None:
        runtime.types = object()


def test_build_studio_pair_groups_pairs_speakers_in_sequence() -> None:
    runtime = _load_gemini_runtime_module()
    line_map = _line_map_for_speakers(["A", "B", "C", "D", "E"])
    speaker_voices = _speaker_voices(["A", "B", "C", "D", "E"])

    groups = runtime._build_studio_pair_groups(line_map, speaker_voices, "Fenrir")
    assert len(groups) == 3
    assert groups[0]["speakers"] == ["A", "B"]
    assert groups[1]["speakers"] == ["C", "D"]
    assert groups[2]["speakers"] == ["E"]


def test_grouped_synthesis_caps_concurrency_by_pool_size() -> None:
    runtime = _load_gemini_runtime_module()
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


def test_grouped_synthesis_retries_failed_group_once() -> None:
    runtime = _load_gemini_runtime_module()
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


def test_grouped_long_text_is_windowed_and_reassembled() -> None:
    runtime = _load_gemini_runtime_module()
    key_pool = [_make_key(41), _make_key(42), _make_key(43)]
    _configure_runtime_for_local_tests(runtime, key_pool)
    original = runtime._synthesize_studio_pair_groups
    windows_seen: list[list[int]] = []

    def _stub_grouped(**kwargs):
        window_line_map = list(kwargs.get("normalized_line_map") or [])
        line_indexes = [int(line.get("lineIndex", -1)) for line in window_line_map]
        windows_seen.append(line_indexes)
        line_chunks = []
        pcm_fragments = []
        for line_index in line_indexes:
            pcm = _pcm_for_line_ids([line_index])
            pcm_fragments.append(pcm)
            line_chunks.append(
                {
                    "lineIndex": line_index,
                    "pcmBytes": pcm,
                    "splitMode": "duration",
                    "silenceFallback": False,
                }
            )
        wav_bytes = runtime.pcm16_to_wav(b"".join(pcm_fragments), sample_rate=24000)
        return {
            "wavBytes": wav_bytes,
            "sampleRate": 24000,
            "lineChunks": line_chunks,
            "traceId": kwargs.get("trace_id"),
            "model": "gemini-2.5-flash-preview-tts",
            "speechModeUsed": "studio_pair_groups",
            "speechModes": ["studio_pair_groups"],
            "speechModeRequested": "studio_pair_groups",
            "keySelectionIndex": 0,
            "keyPoolSize": len(key_pool),
            "speakerHint": "",
            "windowCount": 1,
            "diagnostics": {
                "groupCount": 1,
                "pauseSplitGroups": 0,
                "durationSplitGroups": 1,
                "concurrencyUsed": 1,
            },
        }

    try:
        runtime._synthesize_studio_pair_groups = _stub_grouped
        speaker_voices = _speaker_voices(["A", "B", "C", "D"])
        line_map = []
        text_lines = []
        for index in range(6):
            speaker = ["A", "B", "C", "D"][index % 4]
            text = ("word " * 900).strip()
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
        assert len(windows_seen) > 1
        chunks = list(result.get("lineChunks") or [])
        assert [int(item.get("lineIndex", -1)) for item in chunks] == [0, 1, 2, 3, 4, 5]
        levels = _extract_non_silent_run_levels(_decode_wav_samples(bytes(result["wavBytes"])))
        assert levels[:6] == [1000, 1100, 1200, 1300, 1400, 1500]
    finally:
        runtime._synthesize_studio_pair_groups = original
