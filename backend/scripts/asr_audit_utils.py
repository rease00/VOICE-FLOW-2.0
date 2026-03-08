from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any


_SMART_PUNCT_TRANSLATION = str.maketrans(
    {
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2013": "-",
        "\u2014": "-",
        "\u00a0": " ",
    }
)


def normalize_text_for_match(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", str(text or ""))
    normalized = normalized.translate(_SMART_PUNCT_TRANSLATION)
    normalized = normalized.casefold().replace("_", " ")
    normalized = re.sub(r"[^\w\s\u0900-\u097F]", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def token_list_for_match(text: str) -> list[str]:
    normalized = normalize_text_for_match(text)
    return [token for token in normalized.split(" ") if token]


def build_match_report(expected_text: str, transcript: str) -> dict[str, Any]:
    normalized_expected = normalize_text_for_match(expected_text)
    normalized_transcript = normalize_text_for_match(transcript)
    expected_tokens = [token for token in normalized_expected.split(" ") if token]
    transcript_tokens = [token for token in normalized_transcript.split(" ") if token]
    matcher = SequenceMatcher(a=expected_tokens, b=transcript_tokens)
    matched_tokens = sum(block.size for block in matcher.get_matching_blocks())
    expected_count = len(expected_tokens)
    transcript_count = len(transcript_tokens)
    coverage_ratio = float(matched_tokens) / float(expected_count) if expected_count > 0 else 1.0
    similarity_ratio = matcher.ratio() if expected_tokens or transcript_tokens else 1.0
    return {
        "expectedText": str(expected_text or ""),
        "normalizedExpectedText": normalized_expected,
        "normalizedTranscript": normalized_transcript,
        "expectedTokenCount": expected_count,
        "transcriptTokenCount": transcript_count,
        "matchedTokenCount": matched_tokens,
        "coverageRatio": coverage_ratio,
        "similarityRatio": similarity_ratio,
        "exactMatch": bool(normalized_expected) and normalized_expected == normalized_transcript,
    }


def transcribe_audio(model: Any, audio_path: Path, language_hint: str) -> tuple[str, str]:
    segments, info = model.transcribe(
        str(audio_path),
        language=str(language_hint or "").strip() or None,
        task="transcribe",
        beam_size=5,
        word_timestamps=False,
    )
    transcript = " ".join(str(seg.text or "").strip() for seg in segments if str(seg.text or "").strip()).strip()
    detected_language = str(getattr(info, "language", "") or "").strip()
    return transcript, detected_language
