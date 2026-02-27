from __future__ import annotations

import re


VOWELS = set("aeiouAEIOU")


def syllable_count(text: str) -> int:
    cleaned = re.sub(r"[^A-Za-z]", "", text)
    if not cleaned:
        return 1
    count = 0
    prev = False
    for ch in cleaned:
        is_vowel = ch in VOWELS
        if is_vowel and not prev:
            count += 1
        prev = is_vowel
    return max(1, count)


def split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!??])\s+", text.strip())
    return [p.strip() for p in parts if p.strip()]


def detect_segment_type(text: str, pitch_var: float, tempo: float) -> str:
    lyrical_tokens = ["la", "na", "ooh", "yeah", "baby"]
    lower = text.lower()
    lyrical_hint = any(tok in lower for tok in lyrical_tokens)
    if lyrical_hint and pitch_var > 40 and tempo > 90:
        return "song"
    return "speech"
