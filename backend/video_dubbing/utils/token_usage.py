from __future__ import annotations

import json
import math
from typing import Any

import requests


TTS_OUTPUT_TOKENS_PER_SECOND = 32.0


def ensure_token_usage(ctx: dict[str, Any]) -> dict[str, Any]:
    current = ctx.get("token_usage")
    if isinstance(current, dict):
        current.setdefault("billingMode", "gemini_tokens")
        current.setdefault("reserved", 0)
        current.setdefault("exact", 0)
        current.setdefault("debitedVf", 0)
        current.setdefault("byStage", {})
        current.setdefault("bySegment", [])
        return current
    usage = {
        "billingMode": "gemini_tokens",
        "reserved": 0,
        "exact": 0,
        "debitedVf": 0,
        "byStage": {},
        "bySegment": [],
    }
    ctx["token_usage"] = usage
    return usage


def estimate_tts_output_tokens(duration_sec: float) -> int:
    safe_duration = max(0.0, float(duration_sec or 0.0))
    return max(0, int(math.ceil(safe_duration * TTS_OUTPUT_TOKENS_PER_SECOND)))


def estimate_gemini_prompt_tokens(contents: str, *, task: str = "text") -> int:
    compact = " ".join(str(contents or "").split())
    if not compact:
        return 1
    word_estimate = max(1, len(compact.split()))
    char_estimate = max(1, int(math.ceil(len(compact) / 4.0)))
    if str(task or "text").strip().lower() == "tts":
        return max(word_estimate, char_estimate)
    return char_estimate


def count_gemini_prompt_tokens(
    runtime_url: str,
    *,
    contents: str,
    model_candidates: list[str] | None = None,
    task: str = "text",
    timeout_sec: int = 20,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"contents": str(contents or ""), "task": str(task or "text").strip().lower() or "text"}
    safe_candidates = [str(item or "").strip() for item in list(model_candidates or []) if str(item or "").strip()]
    if safe_candidates:
        payload["modelCandidates"] = safe_candidates
    response = requests.post(
        f"{runtime_url.rstrip('/')}/v1/count-tokens",
        json=payload,
        timeout=max(1, int(timeout_sec)),
    )
    response.raise_for_status()
    try:
        body = response.json() if response.content else {}
    except Exception:
        body = None
    if not isinstance(body, dict):
        body = {}
    total_tokens = int(body.get("totalTokens") or 0)
    if total_tokens <= 0:
        total_tokens = estimate_gemini_prompt_tokens(contents, task=payload["task"])
    return {
        "model": str(body.get("model") or "").strip() or (safe_candidates[0] if safe_candidates else None),
        "totalTokens": total_tokens,
    }


def usage_metadata_from_payload(payload: Any) -> dict[str, int] | None:
    if not isinstance(payload, dict):
        return None
    prompt_tokens = int(payload.get("promptTokens") or 0)
    output_tokens = int(payload.get("outputTokens") or 0)
    total_tokens = int(payload.get("totalTokens") or 0)
    if total_tokens <= 0:
        total_tokens = max(0, prompt_tokens + output_tokens)
    if total_tokens <= 0 and prompt_tokens <= 0 and output_tokens <= 0:
        return None
    return {
        "promptTokens": max(0, prompt_tokens),
        "outputTokens": max(0, output_tokens),
        "totalTokens": max(0, total_tokens),
    }


def record_reserved_tokens(
    ctx: dict[str, Any],
    *,
    stage: str,
    segment_index: int | None,
    speaker: str,
    prompt_tokens: int,
    output_tokens: int = 0,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    usage = ensure_token_usage(ctx)
    stage_key = str(stage or "unknown").strip() or "unknown"
    segment = _segment_entry(usage, segment_index=segment_index, speaker=speaker)
    stage_entry = _stage_entry(usage, stage_key)
    reserved_total = max(0, int(prompt_tokens or 0)) + max(0, int(output_tokens or 0))
    stage_entry["reserved"] = int(stage_entry.get("reserved") or 0) + reserved_total
    usage["reserved"] = int(usage.get("reserved") or 0) + reserved_total
    segment["reserved"] = int(segment.get("reserved") or 0) + reserved_total
    segment_stage = _segment_stage_entry(segment, stage_key)
    segment_stage["reserved"] = int(segment_stage.get("reserved") or 0) + reserved_total
    segment_stage["promptTokensReserved"] = max(0, int(prompt_tokens or 0))
    segment_stage["outputTokensReserved"] = max(0, int(output_tokens or 0))
    if extra:
        segment_stage.update(dict(extra))
    usage["debitedVf"] = int(usage.get("exact") or 0)
    return segment_stage


def record_exact_tokens(
    ctx: dict[str, Any],
    *,
    stage: str,
    segment_index: int | None,
    speaker: str,
    usage_metadata: dict[str, int],
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    usage = ensure_token_usage(ctx)
    stage_key = str(stage or "unknown").strip() or "unknown"
    segment = _segment_entry(usage, segment_index=segment_index, speaker=speaker)
    stage_entry = _stage_entry(usage, stage_key)
    exact_total = max(0, int(usage_metadata.get("totalTokens") or 0))
    stage_entry["exact"] = int(stage_entry.get("exact") or 0) + exact_total
    usage["exact"] = int(usage.get("exact") or 0) + exact_total
    usage["debitedVf"] = int(usage.get("exact") or 0)
    segment["exact"] = int(segment.get("exact") or 0) + exact_total
    segment_stage = _segment_stage_entry(segment, stage_key)
    segment_stage["exact"] = int(segment_stage.get("exact") or 0) + exact_total
    segment_stage["promptTokensExact"] = max(0, int(usage_metadata.get("promptTokens") or 0))
    segment_stage["outputTokensExact"] = max(0, int(usage_metadata.get("outputTokens") or 0))
    segment_stage["totalTokensExact"] = exact_total
    if extra:
        segment_stage.update(dict(extra))
    return segment_stage


def _stage_entry(usage: dict[str, Any], stage: str) -> dict[str, Any]:
    by_stage = usage.get("byStage")
    if not isinstance(by_stage, dict):
        by_stage = {}
        usage["byStage"] = by_stage
    current = by_stage.get(stage)
    if isinstance(current, dict):
        current.setdefault("reserved", 0)
        current.setdefault("exact", 0)
        return current
    created = {"reserved": 0, "exact": 0}
    by_stage[stage] = created
    return created


def _segment_entry(usage: dict[str, Any], *, segment_index: int | None, speaker: str) -> dict[str, Any]:
    by_segment = usage.get("bySegment")
    if not isinstance(by_segment, list):
        by_segment = []
        usage["bySegment"] = by_segment
    safe_index = None if segment_index is None else int(segment_index)
    for item in by_segment:
        if not isinstance(item, dict):
            continue
        existing_index = item.get("index")
        if existing_index is None and safe_index is None:
            item.setdefault("speaker", speaker)
            item.setdefault("reserved", 0)
            item.setdefault("exact", 0)
            item.setdefault("byStage", {})
            return item
        if existing_index is not None and safe_index is not None and int(existing_index) == safe_index:
            item.setdefault("speaker", speaker)
            item.setdefault("reserved", 0)
            item.setdefault("exact", 0)
            item.setdefault("byStage", {})
            return item
    created = {
        "index": safe_index,
        "speaker": str(speaker or "SPEAKER_00").strip() or "SPEAKER_00",
        "reserved": 0,
        "exact": 0,
        "byStage": {},
    }
    by_segment.append(created)
    by_segment.sort(key=lambda item: -1 if item.get("index") is None else int(item.get("index") or 0))
    return created


def _segment_stage_entry(segment: dict[str, Any], stage: str) -> dict[str, Any]:
    by_stage = segment.get("byStage")
    if not isinstance(by_stage, dict):
        by_stage = {}
        segment["byStage"] = by_stage
    current = by_stage.get(stage)
    if isinstance(current, dict):
        current.setdefault("reserved", 0)
        current.setdefault("exact", 0)
        return current
    created = {"reserved": 0, "exact": 0}
    by_stage[stage] = created
    return created


def summarize_usage_for_report(ctx: dict[str, Any]) -> dict[str, Any]:
    usage = ensure_token_usage(ctx)
    payload = json.loads(json.dumps(usage))
    payload["debitedVf"] = int(payload.get("exact") or 0)
    return payload
