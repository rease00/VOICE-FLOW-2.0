from __future__ import annotations

import re
import sys
from array import array
from typing import Any, Dict, Optional


def _normalize_line_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_multi_speaker_line_map(raw_line_map: object) -> list[Dict[str, Any]]:
    if not isinstance(raw_line_map, list):
        return []
    out: list[Dict[str, Any]] = []
    seen_indexes: set[int] = set()
    for item in raw_line_map:
        if not isinstance(item, dict):
            continue
        try:
            line_index = int(item.get("lineIndex"))
        except Exception:
            continue
        if line_index < 0 or line_index in seen_indexes:
            continue
        speaker = re.sub(r"\s+", " ", str(item.get("speaker") or "")).strip()
        if not speaker:
            continue
        text = _normalize_line_text(item.get("text"))
        if not text:
            continue
        seen_indexes.add(line_index)
        out.append(
            {
                "lineIndex": line_index,
                "speaker": speaker,
                "text": text,
            }
        )
    out.sort(key=lambda row: int(row.get("lineIndex", 0)))
    return out


def build_studio_pair_groups(
    line_map: list[Dict[str, Any]],
    speaker_voices: list[Dict[str, str]],
    target_voice: str,
) -> list[Dict[str, Any]]:
    voice_by_speaker: Dict[str, str] = {}
    for entry in speaker_voices:
        speaker = re.sub(r"\s+", " ", str(entry.get("speaker") or "")).strip()
        if not speaker:
            continue
        voice_name = str(entry.get("voiceName") or target_voice).strip() or target_voice
        voice_by_speaker[speaker.lower()] = voice_name

    speaker_order: list[str] = []
    seen: set[str] = set()
    for line in line_map:
        speaker = re.sub(r"\s+", " ", str(line.get("speaker") or "")).strip()
        if not speaker:
            continue
        speaker_key = speaker.lower()
        if speaker_key in seen:
            continue
        seen.add(speaker_key)
        speaker_order.append(speaker)

    groups: list[Dict[str, Any]] = []
    for group_index in range(0, len(speaker_order), 2):
        group_speakers = speaker_order[group_index : group_index + 2]
        if not group_speakers:
            continue
        group_keys = {speaker.lower() for speaker in group_speakers}
        group_lines = [
            line
            for line in line_map
            if str(line.get("speaker") or "").strip().lower() in group_keys
        ]
        if not group_lines:
            continue
        group_speaker_voices = [
            {
                "speaker": speaker,
                "voiceName": voice_by_speaker.get(speaker.lower(), target_voice),
            }
            for speaker in group_speakers
        ]
        group_text = "\n".join(
            f"{str(line.get('speaker') or '').strip()}: {str(line.get('text') or '').strip()}"
            for line in group_lines
            if str(line.get("speaker") or "").strip() and str(line.get("text") or "").strip()
        ).strip()
        if not group_text:
            continue
        groups.append(
            {
                "groupIndex": len(groups),
                "speakers": group_speakers,
                "speakerVoices": group_speaker_voices,
                "lines": group_lines,
                "text": group_text,
            }
        )
    return groups


def _build_duration_boundaries(total_samples: int, weights: list[float], boundary_count: int) -> list[int]:
    if total_samples <= 0 or boundary_count <= 0:
        return []
    safe_weights = [max(1.0, float(value)) for value in weights]
    required_count = boundary_count + 1
    if len(safe_weights) < required_count:
        safe_weights.extend([1.0] * (required_count - len(safe_weights)))
    safe_weights = safe_weights[:required_count]
    total_weight = sum(safe_weights) or float(required_count)

    boundaries: list[int] = []
    cumulative = 0.0
    prev = 0
    for idx in range(boundary_count):
        cumulative += safe_weights[idx]
        remaining_boundaries = boundary_count - idx
        target = int(round((cumulative / total_weight) * float(total_samples)))
        min_allowed = prev + 1
        max_allowed = total_samples - remaining_boundaries
        if max_allowed < min_allowed:
            max_allowed = min_allowed
        bounded = max(min_allowed, min(target, max_allowed))
        boundaries.append(bounded)
        prev = bounded
    return boundaries


def _detect_pause_boundaries(samples: array, targets: list[int]) -> list[int]:
    if not targets:
        return []
    sample_count = len(samples)
    if sample_count <= 0:
        return []

    probe_stride = max(1, sample_count // 4000)
    probe_values = [abs(samples[index]) for index in range(0, sample_count, probe_stride)]
    if not probe_values:
        return []
    probe_values.sort()
    quiet_index = int((len(probe_values) - 1) * 0.2)
    quiet_floor = probe_values[quiet_index]
    avg_amp = int(sum(probe_values) / max(1, len(probe_values)))
    threshold = max(120, min(max(quiet_floor * 2, int(avg_amp * 0.25)), 3000))

    min_run = max(240, min(2400, sample_count // 200))
    centers: list[int] = []
    cursor = 0
    while cursor < sample_count:
        if abs(samples[cursor]) > threshold:
            cursor += 1
            continue
        start = cursor
        while cursor < sample_count and abs(samples[cursor]) <= threshold:
            cursor += 1
        if cursor - start >= min_run:
            centers.append((start + cursor) // 2)

    if not centers:
        return []

    selected: list[int] = []
    used_indexes: set[int] = set()
    prev_boundary = 0
    tolerance = max(200, sample_count // max(4, len(targets) * 2))

    for target in targets:
        best_idx = -1
        best_delta: Optional[int] = None
        for idx, center in enumerate(centers):
            if idx in used_indexes:
                continue
            if center <= prev_boundary + 1:
                continue
            delta = abs(center - target)
            if best_delta is None or delta < best_delta:
                best_idx = idx
                best_delta = delta
        if best_idx < 0:
            return []
        chosen = centers[best_idx]
        if best_delta is not None and best_delta > tolerance:
            return []
        selected.append(chosen)
        used_indexes.add(best_idx)
        prev_boundary = chosen

    return selected


def split_int16_pcm_for_lines(pcm_bytes: bytes, line_weights: list[float]) -> tuple[list[bytes], bool]:
    if len(pcm_bytes) % 2 != 0:
        raise ValueError("Gemini audio payload has invalid PCM length.")
    line_count = max(1, len(line_weights))
    if line_count == 1:
        return [pcm_bytes], False

    samples = array("h")
    samples.frombytes(pcm_bytes)
    if sys.byteorder != "little":
        samples.byteswap()

    sample_count = len(samples)
    if sample_count <= 0:
        return [pcm_bytes], False
    if sample_count <= line_count:
        chunks: list[bytes] = []
        start = 0
        for idx in range(line_count):
            end = start + 1 if idx < line_count - 1 else sample_count
            if end < start:
                end = start
            chunk_samples = array("h", samples[start:end])
            if sys.byteorder != "little":
                chunk_samples.byteswap()
            chunks.append(chunk_samples.tobytes())
            start = end
        return chunks, False

    duration_boundaries = _build_duration_boundaries(sample_count, line_weights, line_count - 1)
    pause_boundaries = _detect_pause_boundaries(samples, duration_boundaries)
    use_pause_boundaries = len(pause_boundaries) == (line_count - 1)
    boundaries = pause_boundaries if use_pause_boundaries else duration_boundaries

    normalized_boundaries: list[int] = []
    prev = 0
    for idx, boundary in enumerate(boundaries):
        remaining_boundaries = (line_count - 1) - idx
        min_allowed = prev + 1
        max_allowed = sample_count - remaining_boundaries
        if max_allowed < min_allowed:
            max_allowed = min_allowed
        bounded = max(min_allowed, min(int(boundary), max_allowed))
        normalized_boundaries.append(bounded)
        prev = bounded

    chunks_out: list[bytes] = []
    start = 0
    for end in [*normalized_boundaries, sample_count]:
        if end < start:
            end = start
        chunk_samples = array("h", samples[start:end])
        if sys.byteorder != "little":
            chunk_samples.byteswap()
        chunks_out.append(chunk_samples.tobytes())
        start = end
    if len(chunks_out) < line_count:
        chunks_out.extend([b""] * (line_count - len(chunks_out)))
    return chunks_out[:line_count], use_pause_boundaries
