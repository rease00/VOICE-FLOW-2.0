from __future__ import annotations

from typing import Any, Callable

from video_dubbing.config import DubbingConfig
from video_dubbing.utils.language_utils import normalize_language_code, to_nllb_tag
from video_dubbing.utils.segment_utils import syllable_count


def _syllable_match(source: str, translated: str) -> str:
    src_count = syllable_count(source)
    dst_count = syllable_count(translated)
    if dst_count == src_count:
        return translated
    if dst_count < src_count:
        return (translated + " na" * (src_count - dst_count)).strip()
    words = translated.split()
    while words and syllable_count(" ".join(words)) > src_count:
        words.pop()
    return " ".join(words) if words else translated


def run(ctx: dict[str, Any], cfg: DubbingConfig, log: Callable[[str], None]) -> dict[str, Any]:
    segments: list[dict[str, Any]] = list(ctx.get("segments") or [])
    target_lang = normalize_language_code(str(ctx.get("target_language") or "hi"), default="hi")
    source_lang = normalize_language_code(str(ctx.get("language") or "en"), default="en")

    translator = None
    if cfg.nllb_ct2_path and cfg.nllb_ct2_path.exists():
        try:
            import ctranslate2  # type: ignore
            from transformers import AutoTokenizer  # type: ignore

            translator = ctranslate2.Translator(str(cfg.nllb_ct2_path), device="cpu")
            tokenizer = AutoTokenizer.from_pretrained("facebook/nllb-200-distilled-600M")
        except Exception as exc:
            translator = None
            log(f"nllb translator unavailable: {exc}")
    else:
        tokenizer = None

    for seg in segments:
        text = str(seg.get("text") or "").strip()
        translated = text
        if translator and tokenizer and text:
            try:
                src_tag = to_nllb_tag(source_lang, fallback="eng_Latn")
                tgt_tag = to_nllb_tag(target_lang, fallback="hin_Deva")
                encoded = tokenizer.convert_ids_to_tokens(tokenizer(text, return_tensors="pt").input_ids[0])
                result = translator.translate_batch([encoded], target_prefix=[[tgt_tag]])[0]
                translated = tokenizer.decode(tokenizer.convert_tokens_to_ids(result.hypotheses[0]), skip_special_tokens=True)
            except Exception:
                translated = text
        if seg.get("segment_type") == "song":
            translated = _syllable_match(text, translated)
        seg["translated_text"] = translated

    ctx["segments"] = segments
    return ctx
