from __future__ import annotations

import re
from typing import Any, Dict, List, Sequence


DEFAULT_LANE_IDS: tuple[str, str, str] = ("L1", "L2", "L3")
SENTENCE_PATTERN = re.compile(r"[^.!?\n\u0964\u0965]+[.!?\u0964\u0965]?")
PHRASE_PATTERN = re.compile(r"[^,;:\n]+[,;:]?")


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def count_words(text: str) -> int:
    cleaned = normalize_text(text)
    if not cleaned:
        return 0
    return len([token for token in cleaned.split(" ") if token])


def _split_with_pattern(text: str, pattern: re.Pattern[str]) -> List[str]:
    values = [chunk.strip() for chunk in pattern.findall(text) if chunk.strip()]
    return values if values else ([text] if text else [])


def _split_oversized_by_words(unit: str, limit: int) -> List[str]:
    words = [token for token in str(unit or "").split(" ") if token]
    if not words:
        return []
    safe_limit = max(1, int(limit))
    chunks: List[str] = []
    current: List[str] = []
    current_len = 0
    for word in words:
        projected = len(word) if not current else current_len + 1 + len(word)
        if current and projected > safe_limit:
            chunks.append(" ".join(current).strip())
            current = [word]
            current_len = len(word)
            continue
        current.append(word)
        current_len = projected
    if current:
        chunks.append(" ".join(current).strip())
    return [chunk for chunk in chunks if chunk]


def _overflow_limit(target: int) -> int:
    safe_target = max(1, int(target))
    return max(safe_target, int(round(safe_target * 1.24)), safe_target + 160)


def _granularize(text: str, *, target: int) -> List[str]:
    cleaned = normalize_text(text)
    if not cleaned:
        return []
    overflow_limit = _overflow_limit(target)
    granular_units: List[str] = []
    for sentence in _split_with_pattern(cleaned, SENTENCE_PATTERN):
        if len(sentence) <= overflow_limit:
            granular_units.append(sentence)
            continue
        for phrase in _split_with_pattern(sentence, PHRASE_PATTERN):
            if len(phrase) <= overflow_limit:
                granular_units.append(phrase)
                continue
            granular_units.extend(_split_oversized_by_words(phrase, overflow_limit))
    return [unit for unit in granular_units if unit]


def _take_first_chunk(text: str, *, target: int) -> tuple[str, str]:
    units = _granularize(text, target=target)
    if not units:
        return "", ""
    overflow_limit = _overflow_limit(target)
    min_fill = max(1, int(round(float(max(1, int(target))) * 0.58)))
    chosen: List[str] = []
    chosen_len = 0
    index = 0
    while index < len(units):
        unit = units[index]
        projected = len(unit) if not chosen else chosen_len + 1 + len(unit)
        if chosen and projected > target:
            if chosen_len < min_fill and projected <= overflow_limit:
                chosen.append(unit)
                chosen_len = projected
                index += 1
            break
        chosen.append(unit)
        chosen_len = projected
        index += 1
        if chosen_len >= target and chosen_len >= min_fill:
            break
    if not chosen:
        chosen = [units[0]]
        index = 1
    return " ".join(chosen).strip(), " ".join(units[index:]).strip()


def plan_text_chunks(
    text: str,
    *,
    seed_targets: Sequence[int],
    tail_target: int,
) -> List[str]:
    remaining = normalize_text(text)
    if not remaining:
        return []
    chunks: List[str] = []
    targets = [max(1, int(value)) for value in list(seed_targets or []) if int(value) > 0]
    tail = max(1, int(tail_target or 1))
    while remaining:
        target = targets.pop(0) if targets else tail
        chunk, rest = _take_first_chunk(remaining, target=target)
        if not chunk:
            break
        chunks.append(chunk)
        remaining = normalize_text(rest)
    return chunks


def build_single_speaker_chunk_plan(
    text: str,
    *,
    lane_ids: Sequence[str] = DEFAULT_LANE_IDS,
) -> List[Dict[str, Any]]:
    safe_lanes = [str(lane or "").strip().upper() for lane in list(lane_ids or DEFAULT_LANE_IDS) if str(lane or "").strip()]
    if not safe_lanes:
        safe_lanes = list(DEFAULT_LANE_IDS)
    lane_1 = safe_lanes[0]
    lane_2 = safe_lanes[1] if len(safe_lanes) > 1 else safe_lanes[-1]
    lane_3 = safe_lanes[2] if len(safe_lanes) > 2 else safe_lanes[-1]
    chunk_targets = [500, 500, 2000, 4000, 4000, 4000]
    chunk_lanes = [lane_1, lane_1, lane_2, lane_2, lane_3, lane_3]
    chunks = plan_text_chunks(text, seed_targets=chunk_targets, tail_target=4000)
    out: List[Dict[str, Any]] = []
    for index, chunk in enumerate(chunks):
        lane_id = chunk_lanes[index] if index < len(chunk_lanes) else safe_lanes[(index - len(chunk_lanes)) % len(safe_lanes)]
        out.append(
            {
                "text": chunk,
                "textChars": len(chunk),
                "wordCount": count_words(chunk),
                "laneId": lane_id,
                "chunkIndex": index,
                "turnIndex": index,
                "speakerId": "SPEAKER_00",
                "speakerName": "Narrator",
            }
        )
    return out


def build_multi_speaker_chunk_plan(
    line_map: list[dict[str, Any]],
    speaker_voices: list[dict[str, Any]],
    *,
    lane_ids: Sequence[str] = DEFAULT_LANE_IDS,
) -> List[Dict[str, Any]]:
    safe_lanes = [str(lane or "").strip().upper() for lane in list(lane_ids or DEFAULT_LANE_IDS) if str(lane or "").strip()]
    if not safe_lanes:
        safe_lanes = list(DEFAULT_LANE_IDS)
    out: List[Dict[str, Any]] = []
    for dialogue_index, line in enumerate(list(line_map or [])):
        speaker = normalize_text(str((line or {}).get("speaker") or ""))
        text = normalize_text(str((line or {}).get("text") or ""))
        if not speaker or not text:
            continue
        line_index = int((line or {}).get("lineIndex") or dialogue_index)
        lane_id = safe_lanes[dialogue_index % len(safe_lanes)]
        matching_voices = [
            dict(item)
            for item in list(speaker_voices or [])
            if normalize_text(str((item or {}).get("speaker") or "")).lower() == speaker.lower()
        ]
        seed_targets = [500, 500, 3000] if dialogue_index == 0 else []
        chunks = plan_text_chunks(text, seed_targets=seed_targets, tail_target=4000)
        for chunk_index, chunk in enumerate(chunks):
            out.append(
                {
                    "text": chunk,
                    "textChars": len(chunk),
                    "wordCount": count_words(chunk),
                    "laneId": lane_id,
                    "dialogueIndex": dialogue_index,
                    "chunkIndex": chunk_index,
                    "dialogueChunkCount": len(chunks),
                    "turnIndex": line_index,
                    "speaker": speaker,
                    "speakerId": speaker,
                    "speakerName": speaker,
                    "speakerVoices": list(matching_voices),
                    "multiSpeakerLineMap": [
                        {
                            "lineIndex": line_index,
                            "speaker": speaker,
                            "text": chunk,
                        }
                    ],
                }
            )
    return out
