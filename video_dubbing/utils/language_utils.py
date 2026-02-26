from __future__ import annotations


LANGUAGE_CODE_ALIASES: dict[str, str] = {
    "auto": "auto",
    "original": "auto",
    "hindi": "hi",
    "hi-in": "hi",
    "english": "en",
    "en-us": "en",
    "en-gb": "en",
    "spanish": "es",
    "french": "fr",
    "german": "de",
    "portuguese": "pt",
    "arabic": "ar",
    "korean": "ko",
    "japanese": "ja",
    "chinese": "zh",
}

NLLB_TAGS: dict[str, str] = {
    "en": "eng_Latn",
    "hi": "hin_Deva",
    "bn": "ben_Beng",
    "es": "spa_Latn",
    "fr": "fra_Latn",
    "de": "deu_Latn",
    "pt": "por_Latn",
    "ar": "arb_Arab",
    "ko": "kor_Hang",
    "ja": "jpn_Jpan",
    "zh": "zho_Hans",
}


def normalize_language_code(value: str | None, default: str = "auto") -> str:
    token = str(value or "").strip().lower()
    if not token:
        return default
    token = token.replace("_", "-")
    if token in LANGUAGE_CODE_ALIASES:
        return LANGUAGE_CODE_ALIASES[token]
    prefix = token.split("-", 1)[0]
    if prefix in LANGUAGE_CODE_ALIASES:
        return LANGUAGE_CODE_ALIASES[prefix]
    return prefix or default


def to_nllb_tag(lang_code: str, fallback: str) -> str:
    normalized = normalize_language_code(lang_code, default="auto")
    return NLLB_TAGS.get(normalized, fallback)
