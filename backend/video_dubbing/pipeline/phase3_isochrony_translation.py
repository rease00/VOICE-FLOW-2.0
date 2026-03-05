from __future__ import annotations

from typing import Any, Callable

from video_dubbing.config import DubbingConfig
from video_dubbing.utils.segment_utils import syllable_count



def _ratio(source: str, target: str) -> float:
    src = max(1, syllable_count(source))
    dst = max(1, syllable_count(target))
    return float(dst) / float(src)



def _adjust_text(source_text: str, current_text: str, min_ratio: float, max_ratio: float) -> str:
    tokenized = [token for token in str(current_text or "").split() if token]
    if not tokenized:
        return current_text

    ratio = _ratio(source_text, " ".join(tokenized))
    if ratio > max_ratio:
        trimmed = list(tokenized)
        while trimmed and _ratio(source_text, " ".join(trimmed)) > max_ratio:
            trimmed.pop()
        return " ".join(trimmed) if trimmed else tokenized[0]

    padded = list(tokenized)
    while _ratio(source_text, " ".join(padded)) < min_ratio:
        padded.append(tokenized[-1])
        if len(padded) > len(tokenized) + 12:
            break
    return " ".join(padded)



def _translate_stub(text: str, target_language: str) -> str:
    normalized = str(target_language or "").strip().lower()
    if normalized.startswith("hi"):
        return text
    return text



def run(ctx: dict[str, Any], cfg: DubbingConfig, log: Callable[[str], None]) -> dict[str, Any]:
    segments: list[dict[str, Any]] = list(ctx.get("segments") or [])
    if not segments:
        raise RuntimeError("phase_failed:isochrony_translation:no_segments")

    target_language = str(ctx.get("target_language") or "hi").strip().lower() or "hi"
    tol = max(0.01, float(cfg.isochrony_tolerance_pct) / 100.0)
    min_ratio = 1.0 - tol
    max_ratio = 1.0 + tol

    rewritten = 0
    within_tolerance = 0
    ratios: list[float] = []

    for seg in segments:
        source_text = str(seg.get("text") or "").strip()
        translated = _translate_stub(source_text, target_language)
        attempts = 0
        ratio = _ratio(source_text, translated)

        while attempts < 8 and (ratio < min_ratio or ratio > max_ratio):
            attempts += 1
            translated = _adjust_text(source_text, translated, min_ratio, max_ratio)
            ratio = _ratio(source_text, translated)

        if attempts > 0:
            rewritten += 1
        if min_ratio <= ratio <= max_ratio:
            within_tolerance += 1

        ratios.append(ratio)
        seg["translated_text"] = translated
        seg["isochrony_ratio"] = ratio
        seg["isochrony_rewrites"] = attempts

    mean_delta = 0.0
    max_delta = 0.0
    if ratios:
        deltas = [abs(value - 1.0) for value in ratios]
        mean_delta = float(sum(deltas) / len(deltas))
        max_delta = float(max(deltas))

    stats = {
        "segmentCount": len(segments),
        "withinToleranceCount": within_tolerance,
        "withinToleranceRatio": float(within_tolerance / max(1, len(segments))),
        "rewrittenCount": rewritten,
        "meanRatioDelta": mean_delta,
        "maxRatioDelta": max_delta,
        "tolerancePct": float(cfg.isochrony_tolerance_pct),
    }
    log(
        "phase3 isochrony stats "
        f"segments={stats['segmentCount']} within={stats['withinToleranceCount']} rewritten={stats['rewrittenCount']}"
    )

    ctx["segments"] = segments
    ctx["isochrony_stats"] = stats
    return ctx
