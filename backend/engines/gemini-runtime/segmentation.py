import re
from typing import Any, Dict, List, Sequence, Tuple

MAX_WORDS_PER_REQUEST = 5000
SEGMENTATION_PROFILE = "sentence-aware-three-lane"

THREE_LANE_IDS: Tuple[str, str, str] = ("L1", "L2", "L3")
MULTI_SPEAKER_FIRST_DIALOG_TRIGGER_CHARS = 500
MULTI_SPEAKER_FIRST_DIALOG_STAGE_TARGETS: Tuple[int, int, int] = (500, 500, 3000)
MULTI_SPEAKER_FIRST_DIALOG_STAGE_HARD_CAPS: Tuple[int, int, int] = (900, 900, 4000)
MULTI_SPEAKER_CONTINUATION_TARGET_CHARS = 4000
MULTI_SPEAKER_CONTINUATION_HARD_CAP = 4000
SINGLE_SPEAKER_STAGE_PLAN: Tuple[Dict[str, Any], ...] = (
    {"laneId": "L1", "targetChars": 500, "hardCharCap": 900},
    {"laneId": "L1", "targetChars": 500, "hardCharCap": 900},
    {"laneId": "L2", "targetChars": 2000, "hardCharCap": 2400},
    {"laneId": "L2", "targetChars": 4000, "hardCharCap": 4000},
    {"laneId": "L3", "targetChars": 4000, "hardCharCap": 4000},
    {"laneId": "L3", "targetChars": 4000, "hardCharCap": 4000},
)

CHUNKING_PROFILES: Dict[str, Dict[str, Any]] = {
    "hi": {
        "hard_char_cap": 4000,
        "target_char_cap": 4000,
        "max_words_per_chunk": 800,
        "join_crossfade_ms": 0,
        "single_lane_plan": [dict(item) for item in SINGLE_SPEAKER_STAGE_PLAN],
        "multi_first_dialog_targets": list(MULTI_SPEAKER_FIRST_DIALOG_STAGE_TARGETS),
        "multi_first_dialog_hard_caps": list(MULTI_SPEAKER_FIRST_DIALOG_STAGE_HARD_CAPS),
        "multi_dialog_target_chars": MULTI_SPEAKER_CONTINUATION_TARGET_CHARS,
        "multi_dialog_hard_cap": MULTI_SPEAKER_CONTINUATION_HARD_CAP,
    },
    "default": {
        "hard_char_cap": 4000,
        "target_char_cap": 4000,
        "max_words_per_chunk": 800,
        "join_crossfade_ms": 0,
        "single_lane_plan": [dict(item) for item in SINGLE_SPEAKER_STAGE_PLAN],
        "multi_first_dialog_targets": list(MULTI_SPEAKER_FIRST_DIALOG_STAGE_TARGETS),
        "multi_first_dialog_hard_caps": list(MULTI_SPEAKER_FIRST_DIALOG_STAGE_HARD_CAPS),
        "multi_dialog_target_chars": MULTI_SPEAKER_CONTINUATION_TARGET_CHARS,
        "multi_dialog_hard_cap": MULTI_SPEAKER_CONTINUATION_HARD_CAP,
    },
}

SENTENCE_PATTERN = re.compile(r"(?<=[.!?\u0964\u0965])\s+|\n+")
CLAUSE_PATTERN = re.compile(r"(?<=[,;:])\s+")


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def count_words(text: str) -> int:
    cleaned = normalize_text(text)
    if not cleaned:
        return 0
    return len([token for token in cleaned.split(" ") if token])


def is_hindi_language(language_code: str, text: str) -> bool:
    hint = str(language_code or "").strip().lower()
    if hint.startswith("hi"):
        return True
    return bool(re.search(r"[\u0900-\u097F]", str(text or "")))


def _copy_profile(profile: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key, value in profile.items():
        if isinstance(value, dict):
            out[key] = dict(value)
        elif isinstance(value, list):
            out[key] = [dict(item) if isinstance(item, dict) else item for item in value]
        else:
            out[key] = value
    return out


def resolve_chunk_profile(language_code: str, text: str) -> Dict[str, Any]:
    key = "hi" if is_hindi_language(language_code, text) else "default"
    return _copy_profile(CHUNKING_PROFILES[key])


def _split_with_pattern(text: str, pattern: re.Pattern[str]) -> List[str]:
    cleaned = normalize_text(text)
    if not cleaned:
        return []
    parts = [chunk.strip() for chunk in pattern.split(cleaned) if chunk.strip()]
    return parts if parts else [cleaned]


def _split_oversized_by_words(unit: str, hard_limit: int, max_words_per_chunk: int) -> List[str]:
    words = [token for token in str(unit or "").split(" ") if token]
    if not words:
        return []

    result: List[str] = []
    current = ""
    current_words = 0
    for word in words:
        candidate = f"{current} {word}".strip() if current else word
        candidate_words = current_words + 1
        if len(candidate) <= hard_limit and candidate_words <= max_words_per_chunk:
            current = candidate
            current_words = candidate_words
            continue
        if current:
            result.append(current)
        current = word
        current_words = 1
    if current:
        result.append(current)
    return result


def _sentence_aware_units(text: str, *, hard_char_cap: int, max_words_per_chunk: int) -> List[str]:
    cleaned = normalize_text(text)
    if not cleaned:
        return []

    units: List[str] = []
    for sentence in _split_with_pattern(cleaned, SENTENCE_PATTERN):
        if len(sentence) <= hard_char_cap and count_words(sentence) <= max_words_per_chunk:
            units.append(sentence)
            continue
        for clause in _split_with_pattern(sentence, CLAUSE_PATTERN):
            if len(clause) <= hard_char_cap and count_words(clause) <= max_words_per_chunk:
                units.append(clause)
            else:
                units.extend(
                    _split_oversized_by_words(
                        clause,
                        hard_limit=hard_char_cap,
                        max_words_per_chunk=max_words_per_chunk,
                    )
                )
    return [unit for unit in units if unit]


def consume_sentence_aware_chunk(
    text: str,
    *,
    target_chars: int,
    hard_char_cap: int,
    max_words_per_chunk: int | None = None,
) -> Tuple[str, str]:
    cleaned = normalize_text(text)
    if not cleaned:
        return "", ""

    safe_hard_cap = max(1, int(hard_char_cap))
    safe_target = max(1, min(int(target_chars), safe_hard_cap))
    safe_word_cap = max(1, int(max_words_per_chunk or MAX_WORDS_PER_REQUEST))

    if len(cleaned) <= safe_hard_cap and count_words(cleaned) <= safe_word_cap:
        return cleaned, ""

    units = _sentence_aware_units(
        cleaned,
        hard_char_cap=safe_hard_cap,
        max_words_per_chunk=safe_word_cap,
    )
    if not units:
        head = cleaned[:safe_hard_cap].strip()
        tail = cleaned[safe_hard_cap:].strip()
        return head, tail

    fill_floor = min(safe_target, max(1, int(round(float(safe_target) * 0.55))))
    current_units: List[str] = []
    current_length = 0
    consumed_units = 0

    for index, unit in enumerate(units):
        unit = unit.strip()
        if not unit:
            continue
        candidate_length = len(unit) if not current_units else current_length + 1 + len(unit)
        if not current_units:
            current_units.append(unit)
            current_length = len(unit)
            consumed_units = index + 1
            if current_length >= safe_target:
                break
            continue
        if candidate_length <= safe_hard_cap and (candidate_length <= safe_target or current_length < fill_floor):
            current_units.append(unit)
            current_length = candidate_length
            consumed_units = index + 1
            continue
        break

    if not current_units:
        head = cleaned[:safe_hard_cap].strip()
        tail = cleaned[safe_hard_cap:].strip()
        return head, tail

    chunk = " ".join(current_units).strip()
    remainder = " ".join(units[consumed_units:]).strip()
    if not chunk:
        head = cleaned[:safe_hard_cap].strip()
        tail = cleaned[safe_hard_cap:].strip()
        return head, tail
    if remainder == cleaned:
        head = cleaned[:safe_hard_cap].strip()
        tail = cleaned[safe_hard_cap:].strip()
        return head, tail
    return chunk, remainder


def build_progressive_sentence_aware_chunks(
    text: str,
    *,
    stages: Sequence[Tuple[int, int]],
    continuation: Tuple[int, int] | None = None,
    max_words_per_chunk: int | None = None,
) -> List[str]:
    cleaned = normalize_text(text)
    if not cleaned:
        return []

    safe_stages = [(max(1, int(target)), max(1, int(hard_cap))) for target, hard_cap in stages]
    if not safe_stages:
        fallback_cap = max(1, int(continuation[1] if continuation is not None else 4000))
        return [cleaned[:fallback_cap].strip()]

    safe_continuation = continuation or safe_stages[-1]
    safe_word_cap = max(1, int(max_words_per_chunk or MAX_WORDS_PER_REQUEST))
    chunks: List[str] = []
    remainder = cleaned

    for stage_target, stage_hard_cap in safe_stages:
        if not remainder:
            break
        chunk, next_remainder = consume_sentence_aware_chunk(
            remainder,
            target_chars=stage_target,
            hard_char_cap=stage_hard_cap,
            max_words_per_chunk=safe_word_cap,
        )
        if not chunk:
            break
        chunks.append(chunk)
        if next_remainder == remainder:
            break
        remainder = next_remainder

    while remainder:
        chunk, next_remainder = consume_sentence_aware_chunk(
            remainder,
            target_chars=max(1, int(safe_continuation[0])),
            hard_char_cap=max(1, int(safe_continuation[1])),
            max_words_per_chunk=safe_word_cap,
        )
        if not chunk:
            break
        chunks.append(chunk)
        if next_remainder == remainder:
            break
        remainder = next_remainder

    return [chunk for chunk in chunks if chunk] or [cleaned]


def chunk_text_for_tts(text: str, language_code: str) -> List[str]:
    cleaned = normalize_text(text)
    if not cleaned:
        return []

    profile = resolve_chunk_profile(language_code=language_code, text=cleaned)
    target = max(1, int(profile.get("target_char_cap") or 4000))
    hard_cap = max(target, int(profile.get("hard_char_cap") or target))
    max_words_per_chunk = max(1, int(profile.get("max_words_per_chunk") or MAX_WORDS_PER_REQUEST))
    return build_progressive_sentence_aware_chunks(
        cleaned,
        stages=[(target, hard_cap)],
        continuation=(target, hard_cap),
        max_words_per_chunk=max_words_per_chunk,
    )
