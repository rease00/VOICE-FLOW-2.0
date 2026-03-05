from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Callable

from video_dubbing.config import DubbingConfig


def _infer_affective_tags(text: str) -> list[str]:
    lower = str(text or "").strip().lower()
    tags: list[str] = []
    if not lower:
        return ["neutral"]
    if "?" in lower:
        tags.append("curious")
    if "!" in lower:
        tags.append("grit")
    if any(token in lower for token in ["whisper", "hush", "quiet"]):
        tags.append("whisper")
    if any(token in lower for token in ["yeah right", "sure", "obviously"]):
        tags.append("sarcasm")
    if any(token in lower for token in ["sorry", "miss", "sad"]):
        tags.append("tender")
    if not tags:
        tags.append("neutral")
    return tags


def _transcribe_segments(vocals_path: Path, cfg: DubbingConfig, log: Callable[[str], None]) -> tuple[str, list[dict[str, Any]]]:
    segments: list[dict[str, Any]] = []
    language = "auto"
    try:
        from faster_whisper import WhisperModel  # type: ignore

        model = WhisperModel(cfg.whisper_model, device=cfg.whisper_device, compute_type=cfg.whisper_compute_type)
        result, info = model.transcribe(str(vocals_path), word_timestamps=False, beam_size=5)
        language = getattr(info, "language", "auto") or "auto"
        for item in result:
            start = float(item.start)
            end = float(item.end)
            text = str(item.text or "").strip()
            if not text:
                continue
            segments.append(
                {
                    "start": start,
                    "end": end,
                    "speaker": "SPEAKER_00",
                    "speaker_confidence": 0.42,
                    "speaker_source": "transcribe_default",
                    "text": text,
                }
            )
    except Exception as exc:
        log(f"phase2 whisper fallback: {exc}")

    if not segments:
        segments.append(
            {
                "start": 0.0,
                "end": 2.0,
                "speaker": "SPEAKER_00",
                "speaker_confidence": 0.42,
                "speaker_source": "transcribe_default",
                "text": "",
            }
        )
    return language, segments


def _parse_timestamp_token(raw_value: str) -> float | None:
    token = str(raw_value or "").strip().strip("[]()")
    if not token:
        return None
    match = re.match(r"^(?P<mm>\d{1,2}):(?P<ss>\d{2})(?:[.:](?P<frac>\d{1,3}))?$", token)
    if not match:
        return None
    minutes = int(match.group("mm"))
    seconds = int(match.group("ss"))
    frac_token = str(match.group("frac") or "")
    frac = 0.0
    if frac_token:
        frac = float(int(frac_token)) / float(10 ** len(frac_token))
    return float(minutes * 60 + seconds) + frac


def _parse_transcript_override_segments(raw_script: str) -> list[dict[str, Any]]:
    lines = [str(line or "").strip() for line in str(raw_script or "").splitlines()]
    lines = [line for line in lines if line]
    if not lines:
        return []

    segments: list[dict[str, Any]] = []
    cursor = 0.0
    for line in lines:
        start_ts: float | None = None
        end_ts: float | None = None
        rest = line
        ts_match = re.match(
            r"^\s*[\[(]?(?P<start>\d{1,2}:\d{2}(?:[.:]\d{1,3})?)[\])]?(\s*[-–]\s*[\[(]?(?P<end>\d{1,2}:\d{2}(?:[.:]\d{1,3})?)[\])]?)*\s*(?P<rest>.*)$",
            line,
        )
        if ts_match:
            start_ts = _parse_timestamp_token(ts_match.group("start") or "")
            end_ts = _parse_timestamp_token(ts_match.group("end") or "")
            rest = str(ts_match.group("rest") or "").strip()

        speaker = "SPEAKER_00"
        text = rest
        line_match = re.match(r"^(?P<speaker>[^:]{1,64}):\s*(?P<text>.*)$", rest)
        if line_match:
            raw_speaker = str(line_match.group("speaker") or "").strip()
            if raw_speaker:
                speaker = raw_speaker
            text = str(line_match.group("text") or "").strip()

        if not text:
            continue

        if start_ts is None:
            start_ts = cursor
        else:
            start_ts = max(0.0, start_ts)
        estimated_duration = max(0.8, min(5.5, len(text.split()) * 0.38))
        if end_ts is None or end_ts <= start_ts:
            end_ts = start_ts + estimated_duration
        end_ts = max(start_ts + 0.24, end_ts)

        explicit_label = bool(line_match and str(line_match.group("speaker") or "").strip())
        segments.append(
            {
                "start": float(start_ts),
                "end": float(end_ts),
                "speaker": speaker,
                "speaker_confidence": 0.93 if explicit_label else 0.45,
                "speaker_source": "transcript_override" if explicit_label else "transcript_default",
                "text": text,
            }
        )
        cursor = float(end_ts)

    return segments


def _normalize_multispeaker_policy(raw_value: str) -> str:
    token = str(raw_value or "").strip().lower().replace("-", "_")
    if token in {"auto_diarize", "auto"}:
        return "hybrid_auto"
    if token not in {"hybrid_auto", "transcript_only", "diarize_only"}:
        return "hybrid_auto"
    return token


def _is_unlabeled_speaker(value: str) -> bool:
    token = str(value or "").strip().lower()
    if not token:
        return True
    if token in {"speaker", "unknown", "none", "n/a"}:
        return True
    if token in {"speaker_00", "speaker 00", "speaker0", "speaker 0"}:
        return True
    return False


def _run_diarization(vocals_path: Path, cfg: DubbingConfig, log: Callable[[str], None]) -> list[tuple[float, float, str]]:
    if not str(cfg.pyannote_token or "").strip():
        return []
    turns: list[tuple[float, float, str]] = []
    try:
        from pyannote.audio import Pipeline  # type: ignore

        pipe = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=cfg.pyannote_token)
        diarization = pipe(str(vocals_path))
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            turns.append((float(turn.start), float(turn.end), str(speaker)))
    except Exception as exc:
        log(f"phase2 diarization skipped: {exc}")
    return turns


def _apply_diarization_labels(segments: list[dict[str, Any]], turns: list[tuple[float, float, str]]) -> None:
    for segment in segments:
        start = float(segment.get("start") or 0.0)
        end = float(segment.get("end") or start)
        duration = max(0.01, end - start)
        best_speaker = ""
        best_overlap = 0.0
        for ts, te, speaker in turns:
            overlap = max(0.0, min(end, te) - max(start, ts))
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = speaker
        confidence = max(0.0, min(1.0, best_overlap / duration))
        if best_speaker:
            segment["speaker_diarized"] = best_speaker
            segment["speaker_diarization_confidence"] = confidence
        else:
            segment["speaker_diarized"] = ""
            segment["speaker_diarization_confidence"] = 0.0


def _nearest_neighbor_speaker(segments: list[dict[str, Any]], index: int) -> str:
    for back in range(index - 1, -1, -1):
        candidate = str(segments[back].get("speaker_merged_raw") or "").strip()
        if candidate and not _is_unlabeled_speaker(candidate):
            return candidate
    for forward in range(index + 1, len(segments)):
        candidate = str(segments[forward].get("speaker_diarized") or "").strip()
        if candidate:
            return candidate
    return "SPEAKER_00"


def _assign_stable_speaker_ids(segments: list[dict[str, Any]], max_speaker_count: int) -> dict[str, str]:
    safe_max = max(1, int(max_speaker_count))
    mapping: dict[str, str] = {}
    fallback_id = f"SPEAKER_{safe_max - 1:02d}"
    for segment in segments:
        raw = str(segment.get("speaker_merged_raw") or segment.get("speaker") or "SPEAKER_00").strip() or "SPEAKER_00"
        key = raw.lower()
        if key not in mapping:
            next_index = len(mapping)
            mapping[key] = f"SPEAKER_{next_index:02d}" if next_index < safe_max else fallback_id
        segment["speaker_raw"] = raw
        segment["speaker"] = mapping[key]
    return mapping


def _merge_speaker_labels(
    segments: list[dict[str, Any]],
    policy: str,
    max_speaker_count: int,
) -> None:
    for index, segment in enumerate(segments):
        transcript_speaker = str(segment.get("speaker") or "SPEAKER_00").strip() or "SPEAKER_00"
        transcript_conf = float(segment.get("speaker_confidence") or (0.93 if not _is_unlabeled_speaker(transcript_speaker) else 0.42))
        diarized_speaker = str(segment.get("speaker_diarized") or "").strip()
        diarized_conf = float(segment.get("speaker_diarization_confidence") or 0.0)
        duration = max(0.01, float(segment.get("end") or 0.0) - float(segment.get("start") or 0.0))
        transcript_unlabeled = _is_unlabeled_speaker(transcript_speaker)

        chosen = transcript_speaker
        chosen_source = "transcript"
        chosen_conf = transcript_conf

        if policy == "diarize_only":
            if diarized_speaker:
                chosen = diarized_speaker
                chosen_source = "diarization"
                chosen_conf = max(0.70, diarized_conf)
            elif transcript_speaker:
                chosen = transcript_speaker
                chosen_source = "transcript_fallback"
                chosen_conf = transcript_conf
        elif policy == "transcript_only":
            if transcript_unlabeled and diarized_speaker:
                chosen = diarized_speaker
                chosen_source = "diarization_fallback"
                chosen_conf = max(0.60, diarized_conf)
        else:
            if (not transcript_unlabeled) and transcript_conf >= 0.70:
                chosen = transcript_speaker
                chosen_source = "transcript"
                chosen_conf = transcript_conf
            elif transcript_unlabeled and diarized_speaker:
                chosen = diarized_speaker
                chosen_source = "diarization"
                chosen_conf = max(0.70, diarized_conf)
            elif diarized_speaker and diarized_conf > transcript_conf:
                chosen = diarized_speaker
                chosen_source = "diarization"
                chosen_conf = diarized_conf

        if duration < 0.70 and (_is_unlabeled_speaker(chosen) or not str(chosen or "").strip()):
            chosen = _nearest_neighbor_speaker(segments, index)
            chosen_source = "neighbor_fallback"
            chosen_conf = max(chosen_conf, 0.62)

        segment["speaker_merged_raw"] = chosen or "SPEAKER_00"
        segment["speaker_source"] = chosen_source
        segment["speaker_confidence"] = round(max(0.0, min(1.0, chosen_conf)), 4)

    _assign_stable_speaker_ids(segments, max_speaker_count)


def _scene_complexity(segments: list[dict[str, Any]], speaker_count: int) -> str:
    if speaker_count > 2:
        return "high"
    if len(segments) > 18 or speaker_count > 1:
        return "medium"
    return "low"


def run(ctx: dict[str, Any], cfg: DubbingConfig, log: Callable[[str], None]) -> dict[str, Any]:
    vocals_path = Path(str(ctx.get("vocals_dry") or ctx.get("vocals") or "")).resolve()
    if not vocals_path.exists():
        raise RuntimeError("phase_failed:director:missing_vocals")

    multispeaker_policy = _normalize_multispeaker_policy(str(ctx.get("multispeaker_policy") or "hybrid_auto"))
    max_speaker_count = max(1, int(ctx.get("max_speaker_count") or 8))

    override_script = str(ctx.get("transcript_override") or "").strip()
    override_segments = _parse_transcript_override_segments(override_script)
    if override_segments:
        language = str(ctx.get("target_language") or "auto").strip() or "auto"
        segments = override_segments
        log(f"phase2 transcript override used segments={len(segments)}")
    else:
        language, segments = _transcribe_segments(vocals_path, cfg, log)

    needs_diarization = multispeaker_policy == "diarize_only"
    if multispeaker_policy == "hybrid_auto":
        unlabeled_count = sum(1 for segment in segments if _is_unlabeled_speaker(str(segment.get("speaker") or "")))
        low_confidence_count = sum(1 for segment in segments if float(segment.get("speaker_confidence") or 0.0) < 0.70)
        needs_diarization = unlabeled_count > 0 or low_confidence_count > 0

    diarization_turns: list[tuple[float, float, str]] = []
    if needs_diarization:
        diarization_turns = _run_diarization(vocals_path, cfg, log)
        if diarization_turns:
            _apply_diarization_labels(segments, diarization_turns)

    _merge_speaker_labels(segments, multispeaker_policy, max_speaker_count)

    for segment in segments:
        text = str(segment.get("text") or "")
        tags = _infer_affective_tags(text)
        segment["affective_tags"] = tags
        segment["emotion"] = tags[0] if tags else "neutral"

    speakers = sorted({str(segment.get("speaker") or "SPEAKER_00") for segment in segments})
    complexity = _scene_complexity(segments, len(speakers))

    director_segments: list[dict[str, Any]] = []
    for idx, segment in enumerate(segments):
        start_ms = int(round(float(segment.get("start") or 0.0) * 1000.0))
        end_ms = int(round(float(segment.get("end") or segment.get("start") or 0.0) * 1000.0))
        if end_ms <= start_ms:
            end_ms = start_ms + 240
        director_segments.append(
            {
                "index": idx,
                "speaker": str(segment.get("speaker") or "SPEAKER_00"),
                "speaker_raw": str(segment.get("speaker_raw") or segment.get("speaker") or "SPEAKER_00"),
                "speaker_confidence": float(segment.get("speaker_confidence") or 0.0),
                "speaker_source": str(segment.get("speaker_source") or "transcript"),
                "text": str(segment.get("text") or ""),
                "start_ms": start_ms,
                "end_ms": end_ms,
                "affective_tags": list(segment.get("affective_tags") or ["neutral"]),
            }
        )

    thinking_level = "high" if (complexity == "high" or len(speakers) > cfg.thinking_low_scene_max_speakers) else "low"

    director_json = {
        "modelPreferred": cfg.director_model,
        "modelResolved": cfg.director_model,
        "fallbackEnabled": bool(cfg.allow_model_fallback),
        "language": language,
        "sceneComplexity": complexity,
        "speakerCount": len(speakers),
        "speakerPolicy": multispeaker_policy,
        "diarizationApplied": bool(diarization_turns),
        "segments": director_segments,
    }

    ctx["language"] = language
    ctx["segments"] = segments
    ctx["director_json"] = director_json
    ctx["thinking_policy"] = {
        "default": "low",
        "complexScene": "high",
        "thinkingLevel": thinking_level,
        "lowSceneMaxSpeakers": cfg.thinking_low_scene_max_speakers,
    }
    return ctx
