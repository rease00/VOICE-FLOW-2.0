from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any, Callable

import requests

from video_dubbing.config import DubbingConfig
from video_dubbing.utils.json_mode_parser import (
    JsonModeParseError,
    JsonModePipelineError,
    parse_json_mode_payload,
)
from video_dubbing.utils.language_utils import normalize_language_code
from video_dubbing.utils.segment_utils import syllable_count
from video_dubbing.utils.token_usage import (
    count_gemini_prompt_tokens,
    record_exact_tokens,
    record_reserved_tokens,
    usage_metadata_from_payload,
)

CORE12_LANGUAGE_CODES = {"zh", "ja", "ru", "en", "hi", "bn", "es", "fr", "de", "pt", "ar", "ko"}


def _contains_latin(text: str) -> bool:
    return bool(re.search(r"[A-Za-z]", str(text or "")))


def _heuristic_source_language(text: str) -> str | None:
    token = str(text or "")
    if not token.strip():
        return None
    if re.search(r"[\u0980-\u09FF]", token):
        return "bn"
    if re.search(r"[\u0900-\u097F]", token):
        return "hi"
    if re.search(r"[\u0600-\u06FF]", token):
        return "ar"
    if re.search(r"[\uAC00-\uD7AF]", token):
        return "ko"
    if re.search(r"[\u3040-\u30FF]", token):
        return "ja"
    if re.search(r"[\u4E00-\u9FFF]", token):
        return "zh"
    if re.search(r"[\u0400-\u04FF]", token):
        return "ru"
    return None


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


def _resolve_dominant_language(codes: list[str], default: str = "en") -> str:
    counts = Counter([code for code in codes if code])
    if not counts:
        return default
    return str(counts.most_common(1)[0][0] or default)


def _safe_json_index(value: Any) -> int:
    try:
        return int(value)
    except Exception:
        return -1


def _append_json_diagnostic(
    ctx: dict[str, Any],
    *,
    stage: str,
    diagnostics: dict[str, Any],
) -> None:
    payload = {
        "stage": str(stage or "").strip() or "unknown",
        "attempt": int(diagnostics.get("attempt") or 0),
        "repaired": bool(diagnostics.get("repaired")),
        "errorKind": str(diagnostics.get("errorKind") or "").strip(),
        "snippet": str(diagnostics.get("snippet") or "").strip(),
    }
    if "json_diagnostics" not in ctx or not isinstance(ctx.get("json_diagnostics"), list):
        ctx["json_diagnostics"] = []
    casted = ctx.get("json_diagnostics")
    if isinstance(casted, list):
        casted.append(payload)


def _request_gemini_json_payload(
    *,
    ctx: dict[str, Any],
    cfg: DubbingConfig,
    payload: dict[str, Any],
    timeout_sec: int,
    stage: str,
    strict_mode: bool,
    strict_error_prefix: str,
    log: Callable[[str], None],
) -> Any | None:
    parse_fail_diagnostics: list[dict[str, Any]] = []
    ctx["_last_usage_metadata"] = None
    for attempt in (1, 2):
        effective_payload = dict(payload)
        if attempt > 1:
            base_system = str(effective_payload.get("systemPrompt") or "").strip()
            base_user = str(effective_payload.get("userPrompt") or "").strip()
            effective_payload["systemPrompt"] = (
                f"{base_system} "
                "Output must be syntactically valid JSON without markdown fences or commentary."
            ).strip()
            effective_payload["userPrompt"] = (
                f"{base_user}\n"
                "If formatting was invalid earlier, return corrected JSON now."
            ).strip()
        try:
            response = requests.post(
                f"{cfg.gemini_runtime_url}/v1/generate-text",
                json=effective_payload,
                timeout=timeout_sec,
            )
            response.raise_for_status()
            body = response.json() if response.content else {}
            if isinstance(body, dict):
                ctx["_last_usage_metadata"] = usage_metadata_from_payload(body.get("usageMetadata"))
            text = str((body or {}).get("text") or "").strip()
            parsed, diagnostics = parse_json_mode_payload(text, expect="container", attempt=attempt)
            _append_json_diagnostic(ctx, stage=stage, diagnostics=diagnostics)
            return parsed
        except JsonModeParseError as exc:
            diagnostics = dict(exc.diagnostics)
            _append_json_diagnostic(ctx, stage=stage, diagnostics=diagnostics)
            parse_fail_diagnostics.append(
                {
                    "stage": stage,
                    "attempt": int(diagnostics.get("attempt") or attempt),
                    "repaired": bool(diagnostics.get("repaired")),
                    "errorKind": str(diagnostics.get("errorKind") or exc.error_kind).strip(),
                    "snippet": str(diagnostics.get("snippet") or "").strip(),
                }
            )
            if attempt == 1:
                log(
                    f"{stage} json parse failure attempt={attempt} "
                    f"kind={exc.error_kind}; retrying once"
                )
                continue
            if strict_mode:
                raise JsonModePipelineError(
                    f"{strict_error_prefix}:json_parse_failed:{exc.error_kind}",
                    diagnostics=parse_fail_diagnostics,
                ) from exc
            return None
    return None


def _translate_segment_with_gemini(
    *,
    ctx: dict[str, Any],
    cfg: DubbingConfig,
    segment_index: int,
    speaker: str,
    source_text: str,
    source_language: str,
    target_language: str,
    strict_mode: bool,
    log: Callable[[str], None],
) -> str:
    trace_id = f"v2_phase3_translate_segment_{segment_index}"
    payload = {
        "systemPrompt": (
            "You are a dubbing translator. Return strict JSON only with keys index and text. "
            "Preserve intent, spoken cadence, and natural phrasing."
        ),
        "userPrompt": (
            f"Translate the following utterance from '{source_language}' into '{target_language}'.\n"
            f"Item: {json.dumps({'index': segment_index, 'text': source_text}, ensure_ascii=True)}"
        ),
        "jsonMode": True,
        "trace_id": trace_id,
        "modelCandidates": [str(cfg.director_model or "").strip() or "gemini-2.5-flash"],
    }
    reservation = count_gemini_prompt_tokens(
        cfg.gemini_runtime_url,
        contents=f"{payload['systemPrompt']}\n{payload['userPrompt']}",
        model_candidates=list(payload.get("modelCandidates") or []),
    )
    record_reserved_tokens(
        ctx,
        stage="translation",
        segment_index=segment_index,
        speaker=speaker,
        prompt_tokens=int(reservation.get("totalTokens") or 0),
        output_tokens=0,
        extra={"traceId": trace_id, "modelReserved": reservation.get("model")},
    )
    parsed = _request_gemini_json_payload(
        ctx=ctx,
        cfg=cfg,
        payload=payload,
        timeout_sec=50,
        stage="phase3_translation_segment",
        strict_mode=strict_mode,
        strict_error_prefix="phase_failed:translation:segment_failed",
        log=log,
    )
    if parsed is None:
        if strict_mode:
            raise RuntimeError(f"phase_failed:translation:segment_failed:{segment_index}")
        return source_text
    usage_metadata = usage_metadata_from_payload(ctx.get("_last_usage_metadata"))
    if usage_metadata is None:
        raise RuntimeError(f"phase_failed:translation:usage_metadata_missing:segment_{segment_index}")
    record_exact_tokens(
        ctx,
        stage="translation",
        segment_index=segment_index,
        speaker=speaker,
        usage_metadata=usage_metadata,
        extra={"traceId": trace_id},
    )
    rows: list[Any]
    if isinstance(parsed, dict):
        if "text" in parsed:
            text = str(parsed.get("text") or "").strip()
            return text or source_text
        rows = parsed.get("translations") if isinstance(parsed.get("translations"), list) else []
    elif isinstance(parsed, list):
        rows = parsed
    else:
        rows = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        idx = _safe_json_index(item.get("index"))
        translated = str(item.get("text") or "").strip()
        if idx == segment_index and translated:
            return translated
    return source_text


def _classify_ambiguous_language_batch(
    *,
    ctx: dict[str, Any],
    cfg: DubbingConfig,
    entries: list[dict[str, Any]],
    strict_mode: bool,
    log: Callable[[str], None],
) -> dict[int, str]:
    if not entries:
        return {}
    payload = {
        "systemPrompt": (
            "Classify language for each line. Return JSON only with key classifications. "
            "Each item must include index and lang. lang must be one of: "
            "zh,ja,ru,en,hi,bn,es,fr,de,pt,ar,ko."
        ),
        "userPrompt": (
            "Classify source language for each line.\n"
            f"Input: {json.dumps(entries, ensure_ascii=True)}"
        ),
        "jsonMode": True,
        "trace_id": "v2_phase3_lang_classify",
        "modelCandidates": [str(cfg.director_model or "").strip() or "gemini-2.5-flash"],
    }
    try:
        parsed = _request_gemini_json_payload(
            ctx=ctx,
            cfg=cfg,
            payload=payload,
            timeout_sec=40,
            stage="phase3_language_classification",
            strict_mode=strict_mode,
            strict_error_prefix="phase_failed:translation:language_classification_failed",
            log=log,
        )
        if parsed is None:
            return {}
        classified: list[Any]
        if isinstance(parsed, dict):
            classified = parsed.get("classifications") if isinstance(parsed.get("classifications"), list) else []
        elif isinstance(parsed, list):
            classified = parsed
        else:
            classified = []
        out: dict[int, str] = {}
        for item in classified:
            if not isinstance(item, dict):
                continue
            idx = _safe_json_index(item.get("index"))
            lang = normalize_language_code(str(item.get("lang") or ""), default="")
            if idx < 0 or not lang:
                continue
            out[idx] = lang
        return out
    except JsonModePipelineError:
        raise
    except Exception as exc:
        if strict_mode:
            raise RuntimeError(f"phase_failed:translation:language_classification_failed:{exc}") from exc
        return {}


def _translate_batch_with_gemini(
    *,
    ctx: dict[str, Any],
    cfg: DubbingConfig,
    target_language: str,
    entries: list[dict[str, Any]],
    strict_mode: bool,
    log: Callable[[str], None],
) -> dict[int, str]:
    if not entries:
        return {}
    payload = {
        "systemPrompt": (
            "You are a subtitle translator for dubbing. Return strict JSON only with key translations. "
            "Each translation item must include index and text."
        ),
        "userPrompt": (
            f"Translate each item into target language '{target_language}'. Keep meaning and natural speech.\n"
            f"Items: {json.dumps(entries, ensure_ascii=True)}"
        ),
        "jsonMode": True,
        "trace_id": "v2_phase3_translate_batch",
        "modelCandidates": [str(cfg.director_model or "").strip() or "gemini-2.5-flash"],
    }
    try:
        parsed = _request_gemini_json_payload(
            ctx=ctx,
            cfg=cfg,
            payload=payload,
            timeout_sec=50,
            stage="phase3_translation_batch",
            strict_mode=strict_mode,
            strict_error_prefix="phase_failed:translation:translation_failed",
            log=log,
        )
        if parsed is None:
            return {}
        rows: list[Any]
        if isinstance(parsed, dict):
            rows = parsed.get("translations") if isinstance(parsed.get("translations"), list) else []
        elif isinstance(parsed, list):
            rows = parsed
        else:
            rows = []
        out: dict[int, str] = {}
        for item in rows:
            if not isinstance(item, dict):
                continue
            idx = _safe_json_index(item.get("index"))
            translated = str(item.get("text") or "").strip()
            if idx < 0 or not translated:
                continue
            out[idx] = translated
        return out
    except JsonModePipelineError:
        raise
    except Exception as exc:
        if strict_mode:
            raise RuntimeError(f"phase_failed:translation:translation_failed:{exc}") from exc
        return {}


def run(ctx: dict[str, Any], cfg: DubbingConfig, log: Callable[[str], None]) -> dict[str, Any]:
    segments: list[dict[str, Any]] = list(ctx.get("segments") or [])
    if not segments:
        raise RuntimeError("phase_failed:translation:no_segments")

    strict_mode = bool(ctx.get("strict_gemini_only")) or bool(ctx.get("strict_no_fallback"))
    source_language_mode = str(ctx.get("source_language_mode") or cfg.source_language_mode).strip().lower() or "auto_per_segment"
    language_coverage_profile = str(ctx.get("language_coverage_profile") or cfg.language_coverage_profile).strip().lower() or "core12"
    requested_target_language = normalize_language_code(str(ctx.get("target_language") or "auto"), default="auto")

    if language_coverage_profile == "core12":
        if requested_target_language != "auto" and requested_target_language not in CORE12_LANGUAGE_CODES:
            raise RuntimeError(
                f"phase_failed:translation:unsupported_target_language:{requested_target_language}"
            )

    detected_source_codes: list[str] = []
    unsupported_segments: list[dict[str, Any]] = []
    ambiguous_entries: list[dict[str, Any]] = []

    for index, segment in enumerate(segments):
        segment["index"] = index
        text = str(segment.get("text") or "").strip()
        guessed = _heuristic_source_language(text)
        if guessed:
            segment["source_language"] = guessed
            continue
        if source_language_mode == "auto_per_segment" and _contains_latin(text):
            ambiguous_entries.append({"index": index, "text": text})

    if ambiguous_entries:
        classified = _classify_ambiguous_language_batch(
            ctx=ctx,
            cfg=cfg,
            entries=ambiguous_entries,
            strict_mode=strict_mode,
            log=log,
        )
        for index, code in classified.items():
            if 0 <= index < len(segments):
                segments[index]["source_language"] = normalize_language_code(code, default="en")

    for index, segment in enumerate(segments):
        source_code = normalize_language_code(str(segment.get("source_language") or ctx.get("language") or "en"), default="en")
        segment["source_language"] = source_code
        detected_source_codes.append(source_code)
        if language_coverage_profile == "core12" and source_code not in CORE12_LANGUAGE_CODES:
            unsupported_segments.append({"index": index, "sourceLanguage": source_code})

    dominant_candidates = (
        [code for code in detected_source_codes if code in CORE12_LANGUAGE_CODES]
        if language_coverage_profile == "core12"
        else list(detected_source_codes)
    )
    dominant_source_language = _resolve_dominant_language(dominant_candidates, default="en")
    target_language = requested_target_language
    if target_language == "auto":
        target_language = dominant_source_language
    target_language = normalize_language_code(target_language, default="en")

    if language_coverage_profile == "core12" and target_language not in CORE12_LANGUAGE_CODES:
        raise RuntimeError(f"phase_failed:translation:unsupported_target_language:{target_language}")
    effective_fallback_source = (
        dominant_source_language
        if dominant_source_language in CORE12_LANGUAGE_CODES
        else "en"
    )
    for segment in segments:
        source_code = normalize_language_code(str(segment.get("source_language") or "en"), default="en")
        if language_coverage_profile == "core12" and source_code not in CORE12_LANGUAGE_CODES:
            segment["source_language_effective"] = effective_fallback_source
        else:
            segment["source_language_effective"] = source_code

    tol = max(0.01, float(cfg.isochrony_tolerance_pct) / 100.0)
    min_ratio = 1.0 - tol
    max_ratio = 1.0 + tol

    translation_requests: list[dict[str, Any]] = []
    translated_by_index: dict[int, str] = {}
    for index, segment in enumerate(segments):
        source_text = str(segment.get("text") or "").strip()
        if not source_text:
            continue
        speaker = str(segment.get("speaker") or "SPEAKER_00").strip() or "SPEAKER_00"
        source_code = normalize_language_code(
            str(segment.get("source_language_effective") or segment.get("source_language") or "en"),
            default="en",
        )
        if source_code == target_language:
            segment["translated_text"] = source_text
            translated_by_index[index] = source_text
            continue
        translated = _translate_segment_with_gemini(
            ctx=ctx,
            cfg=cfg,
            segment_index=index,
            speaker=speaker,
            source_text=source_text,
            source_language=source_code,
            target_language=target_language,
            strict_mode=strict_mode,
            log=log,
        )
        translated_by_index[index] = translated
        translation_requests.append(
            {
                "index": index,
                "speaker": speaker,
                "sourceLanguage": source_code,
                "targetLanguage": target_language,
                "textChars": len(source_text),
                "translatedChars": len(translated),
            }
        )

    rewritten = 0
    within_tolerance = 0
    ratios: list[float] = []

    for seg in segments:
        index = int(seg.get("index", -1))
        source_text = str(seg.get("text") or "").strip()
        translated = str(seg.get("translated_text") or translated_by_index.get(index, source_text)).strip() or source_text
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
    language_counts = Counter(
        [str(seg.get("source_language") or "") for seg in segments if str(seg.get("source_language") or "").strip()]
    )
    language_stats = {
        "mixedSourceDetected": len(language_counts) > 1,
        "dominantSourceLanguage": dominant_source_language,
        "segmentLanguageCounts": dict(sorted(language_counts.items())),
        "targetLanguageApplied": target_language,
        "unsupportedSegments": unsupported_segments,
    }
    log(
        "phase3 isochrony stats "
        f"segments={stats['segmentCount']} within={stats['withinToleranceCount']} rewritten={stats['rewrittenCount']}"
    )

    ctx["segments"] = segments
    ctx["isochrony_stats"] = stats
    ctx["language_stats"] = language_stats
    ctx["target_language_applied"] = target_language
    ctx["translation_requests"] = translation_requests
    ctx.pop("_last_usage_metadata", None)
    return ctx
