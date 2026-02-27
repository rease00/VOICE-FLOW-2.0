import re
from typing import Dict, List

MAX_WORDS_PER_REQUEST = 5000
SEGMENTATION_PROFILE = "quality-first"

CHUNKING_PROFILES: Dict[str, Dict[str, int]] = {
    "hi": {
        "hard_char_cap": 160,
        "target_char_cap": 130,
        "max_words_per_chunk": 30,
        "join_crossfade_ms": 15,
    },
    "default": {
        "hard_char_cap": 220,
        "target_char_cap": 180,
        "max_words_per_chunk": 45,
        "join_crossfade_ms": 15,
    },
}

SENTENCE_PATTERN = r"[^.!?\n\u0964\u0965]+[.!?\u0964\u0965]?"
PHRASE_PATTERN = r"[^,;:\n]+[,;:]?"


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def count_words(text: str) -> int:
    cleaned = normalize_text(text)
    if not cleaned:
        return 0
    return len([token for token in cleaned.split(" ") if token])


def is_hindi_language(lang_code: str, text: str) -> bool:
    normalized_lang = str(lang_code or "").strip().lower()
    if normalized_lang in {"h", "hi", "hin"}:
        return True
    return bool(re.search(r"[\u0900-\u097F]", str(text or "")))


def _split_with_pattern(text: str, pattern: str) -> List[str]:
    units = [chunk.strip() for chunk in re.findall(pattern, text) if chunk.strip()]
    if units:
        return units
    return [text] if text else []


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
            current = ""
            current_words = 0
        if len(word) <= hard_limit:
            current = word
            current_words = 1
            continue
        for index in range(0, len(word), hard_limit):
            result.append(word[index : index + hard_limit])

    if current:
        result.append(current)
    return result


def resolve_chunk_profile(lang_code: str, text: str) -> Dict[str, int]:
    key = "hi" if is_hindi_language(lang_code, text) else "default"
    return dict(CHUNKING_PROFILES[key])


def chunk_text_for_tts(text: str, lang_code: str) -> List[str]:
    cleaned = normalize_text(text)
    if not cleaned:
        return []

    profile = resolve_chunk_profile(lang_code, cleaned)
    hard_limit = profile["hard_char_cap"]
    target_limit = profile["target_char_cap"]
    max_words_per_chunk = profile["max_words_per_chunk"]
    sentence_units = _split_with_pattern(cleaned, SENTENCE_PATTERN)

    granular_units: List[str] = []
    for sentence in sentence_units:
        sentence_words = count_words(sentence)
        if len(sentence) <= hard_limit and sentence_words <= max_words_per_chunk:
            granular_units.append(sentence)
            continue
        phrase_units = _split_with_pattern(sentence, PHRASE_PATTERN)
        for phrase in phrase_units:
            phrase_words = count_words(phrase)
            if len(phrase) <= hard_limit and phrase_words <= max_words_per_chunk:
                granular_units.append(phrase)
            else:
                granular_units.extend(
                    _split_oversized_by_words(phrase, hard_limit=hard_limit, max_words_per_chunk=max_words_per_chunk)
                )

    chunks: List[str] = []
    current = ""
    current_words = 0
    for unit in granular_units:
        unit = unit.strip()
        if not unit:
            continue
        unit_words = count_words(unit)
        if len(unit) > hard_limit or unit_words > max_words_per_chunk:
            if current:
                chunks.append(current)
                current = ""
                current_words = 0
            chunks.extend(
                _split_oversized_by_words(unit, hard_limit=hard_limit, max_words_per_chunk=max_words_per_chunk)
            )
            continue

        candidate = f"{current} {unit}".strip() if current else unit
        candidate_words = current_words + unit_words
        if len(candidate) <= target_limit and candidate_words <= max_words_per_chunk:
            current = candidate
            current_words = candidate_words
        else:
            if current:
                chunks.append(current)
            current = unit
            current_words = unit_words

    if current:
        chunks.append(current)

    return chunks or [cleaned[:hard_limit]]

