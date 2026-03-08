#!/usr/bin/env python3
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
import wave
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import audioop
import requests
from faster_whisper import WhisperModel

from asr_audit_utils import build_match_report, transcribe_audio


DEFAULT_RUNTIME_URL = "http://127.0.0.1:7820"
DEFAULT_OUTPUT_DIR = Path("output") / "audits"
DEFAULT_AUDIO_DIR = Path("output") / "audits" / "kokoro-speaker-audio"
EN_TEST_TEXT = (
    'Clara’s eyes snapped open. A tear tracked through her reflection in the glass. '
    '"That’s it," she whispered. "How much?"'
)
HI_TEST_TEXT = (
    "\u092f\u0939 \u0932\u093e\u0907\u0935 \u0911\u0921\u093f\u092f\u094b \u091f\u0947\u0938\u094d\u091f \u0939\u0948\u0964 "
    "\u092f\u0939 \u0906\u0935\u093e\u091c\u093c \u0938\u093e\u092b\u093c \u0914\u0930 "
    "\u0938\u0941\u0928\u093e\u0908 \u0926\u0947\u0928\u0947 \u092f\u094b\u0917\u094d\u092f \u0939\u094b\u0928\u0940 "
    "\u091a\u093e\u0939\u093f\u090f\u0964"
)


def configure_stdio_utf8() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream is None:
            continue
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            continue


def safe_console_text(value: str, *, limit: int = 72) -> str:
    snippet = str(value or "")[:limit]
    encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
    try:
        return snippet.encode(encoding, errors="replace").decode(encoding, errors="replace")
    except Exception:
        return snippet.encode("utf-8", errors="replace").decode("utf-8", errors="replace")


@dataclass
class VoiceAuditResult:
    voice_id: str
    voice_name: str
    language_hint: str
    ok: bool
    status_code: int
    content_type: str
    audio_bytes: int
    duration_sec: float
    sample_rate: int
    channels: int
    sample_width_bytes: int
    rms: float
    expected_text: str
    normalized_expected_text: str
    transcript: str
    transcript_chars: int
    transcript_language: str
    normalized_transcript: str
    match_mode: str
    exact_match: bool
    coverage_ratio: float
    similarity_ratio: float
    error: str
    file: str
    elapsed_ms: int


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_token(value: str, fallback: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in value.strip())
    cleaned = cleaned.strip("_")
    return cleaned or fallback


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run live TTS + ASR validation for all Kokoro speakers."
    )
    parser.add_argument(
        "--runtime-url",
        default=os.getenv("VF_KOKORO_RUNTIME_URL", DEFAULT_RUNTIME_URL),
        help="Kokoro runtime base URL.",
    )
    parser.add_argument(
        "--timeout-sec",
        type=float,
        default=float(os.getenv("VF_KOKORO_AUDIT_TIMEOUT_SEC", "180")),
        help="HTTP timeout per request.",
    )
    parser.add_argument(
        "--whisper-model",
        default=os.getenv("VF_WHISPER_MODEL", "tiny"),
        help="faster-whisper model size.",
    )
    parser.add_argument(
        "--whisper-device",
        default=os.getenv("VF_WHISPER_DEVICE", "cpu"),
        help="Whisper device.",
    )
    parser.add_argument(
        "--whisper-compute",
        default=os.getenv("VF_WHISPER_COMPUTE", "int8"),
        help="Whisper compute type.",
    )
    parser.add_argument(
        "--min-bytes",
        type=int,
        default=int(os.getenv("VF_KOKORO_AUDIT_MIN_BYTES", "4096")),
        help="Minimum accepted WAV payload bytes.",
    )
    parser.add_argument(
        "--min-rms",
        type=float,
        default=float(os.getenv("VF_KOKORO_AUDIT_MIN_RMS", "0.002")),
        help="Minimum accepted normalized RMS value.",
    )
    parser.add_argument(
        "--min-duration",
        type=float,
        default=float(os.getenv("VF_KOKORO_AUDIT_MIN_DURATION_SEC", "0.6")),
        help="Minimum accepted audio duration in seconds.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory where the report JSON is written.",
    )
    parser.add_argument(
        "--audio-dir",
        default=str(DEFAULT_AUDIO_DIR),
        help="Directory where per-speaker WAV files are written.",
    )
    parser.add_argument(
        "--min-hi-coverage",
        type=float,
        default=float(os.getenv("VF_KOKORO_AUDIT_MIN_HI_COVERAGE", "0.55")),
        help="Minimum normalized token coverage required for Hindi transcript checks.",
    )
    return parser.parse_args()


def fetch_runtime_voices(runtime_url: str, timeout_sec: float) -> list[dict[str, Any]]:
    url = f"{runtime_url.rstrip('/')}/v1/voices"
    response = requests.get(url, timeout=timeout_sec)
    response.raise_for_status()
    payload = response.json()
    voices = payload.get("voices")
    if not isinstance(voices, list):
        raise RuntimeError("Runtime voices response missing 'voices' list.")
    out: list[dict[str, Any]] = []
    for entry in voices:
        if not isinstance(entry, dict):
            continue
        voice_id = str(entry.get("voice_id") or entry.get("id") or "").strip()
        if not voice_id:
            continue
        out.append(entry)
    if not out:
        raise RuntimeError("Runtime returned no speaker voices.")
    return out


def synthesize_voice(
    runtime_url: str,
    timeout_sec: float,
    voice_id: str,
    text: str,
    language_hint: str,
) -> requests.Response:
    payload = {
        "text": text,
        "voice_id": voice_id,
        "voiceId": voice_id,
        "language": language_hint,
        "emotion": "Neutral",
        "speed": 1.0,
    }
    url = f"{runtime_url.rstrip('/')}/synthesize"
    return requests.post(url, json=payload, timeout=timeout_sec)


def read_wav_metrics(wav_bytes: bytes) -> dict[str, float | int]:
    with wave.open(io.BytesIO(wav_bytes), "rb") as wav:
        channels = wav.getnchannels()
        sample_rate = wav.getframerate()
        sample_width = wav.getsampwidth()
        frames = wav.getnframes()
        pcm = wav.readframes(frames)

    duration_sec = float(frames) / float(sample_rate) if sample_rate > 0 else 0.0
    rms_raw = float(audioop.rms(pcm, sample_width)) if pcm else 0.0
    max_pcm = float((1 << (8 * sample_width - 1)) - 1) if sample_width > 0 else 1.0
    rms_norm = (rms_raw / max_pcm) if max_pcm > 0 else 0.0

    return {
        "duration_sec": duration_sec,
        "sample_rate": sample_rate,
        "channels": channels,
        "sample_width_bytes": sample_width,
        "rms": rms_norm,
    }
def voice_language_hint(entry: dict[str, Any]) -> str:
    language = str(entry.get("language") or entry.get("lang") or "").strip().lower()
    if language.startswith("hi"):
        return "hi"
    accent = str(entry.get("accent") or "").strip().lower()
    if "hindi" in accent:
        return "hi"
    return "en"


def voice_name(entry: dict[str, Any]) -> str:
    return str(entry.get("name") or entry.get("voice") or entry.get("voice_id") or "Voice").strip()


def main() -> int:
    configure_stdio_utf8()
    args = parse_args()
    started = time.time()
    runtime_url = str(args.runtime_url).strip().rstrip("/")
    timeout_sec = max(5.0, float(args.timeout_sec))

    output_dir = Path(args.output_dir)
    audio_dir = Path(args.audio_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    audio_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report_path = output_dir / f"kokoro-speakers-live-asr-{timestamp}.json"

    report: dict[str, Any] = {
        "timestamp": now_iso(),
        "runtimeUrl": runtime_url,
        "config": {
            "timeoutSec": timeout_sec,
            "whisperModel": str(args.whisper_model),
            "whisperDevice": str(args.whisper_device),
            "whisperCompute": str(args.whisper_compute),
            "minBytes": int(args.min_bytes),
            "minRms": float(args.min_rms),
            "minDurationSec": float(args.min_duration),
            "minHiCoverage": float(args.min_hi_coverage),
        },
        "results": [],
        "summary": {},
    }

    try:
        voices = fetch_runtime_voices(runtime_url, timeout_sec)
    except Exception as exc:
        report["summary"] = {
            "ok": False,
            "error": f"failed_to_fetch_voices: {exc}",
            "total": 0,
            "passed": 0,
            "failed": 0,
            "elapsedSec": round(time.time() - started, 3),
        }
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"ok": False, "output": str(report_path), "summary": report["summary"]}, indent=2))
        return 1

    whisper_model = WhisperModel(
        str(args.whisper_model),
        device=str(args.whisper_device),
        compute_type=str(args.whisper_compute),
    )

    results: list[VoiceAuditResult] = []
    for entry in voices:
        voice_id = str(entry.get("voice_id") or entry.get("id") or "").strip()
        name = voice_name(entry)
        lang_hint = voice_language_hint(entry)
        text = HI_TEST_TEXT if lang_hint == "hi" else EN_TEST_TEXT
        started_voice = time.time()
        output_file = audio_dir / f"{safe_token(voice_id, 'voice')}.wav"

        status_code = 0
        content_type = ""
        audio_bytes = b""
        error = ""
        transcript = ""
        transcript_lang = ""
        normalized_expected_text = ""
        normalized_transcript = ""
        match_mode = "exact" if lang_hint == "en" else "coverage"
        exact_match = False
        coverage_ratio = 0.0
        similarity_ratio = 0.0
        metrics = {
            "duration_sec": 0.0,
            "sample_rate": 0,
            "channels": 0,
            "sample_width_bytes": 0,
            "rms": 0.0,
        }

        try:
            response = synthesize_voice(runtime_url, timeout_sec, voice_id, text, lang_hint)
            status_code = int(response.status_code)
            content_type = str(response.headers.get("content-type") or "")
            if status_code != 200:
                detail = response.text[:240]
                raise RuntimeError(f"synthesize_http_{status_code}: {detail}")
            audio_bytes = response.content or b""
            if len(audio_bytes) < int(args.min_bytes):
                raise RuntimeError(f"audio_too_small:{len(audio_bytes)}")

            output_file.write_bytes(audio_bytes)
            metrics = read_wav_metrics(audio_bytes)
            if float(metrics["duration_sec"]) < float(args.min_duration):
                raise RuntimeError(f"duration_too_short:{metrics['duration_sec']:.3f}s")
            if float(metrics["rms"]) < float(args.min_rms):
                raise RuntimeError(f"rms_too_low:{metrics['rms']:.6f}")

            transcript, transcript_lang = transcribe_audio(whisper_model, output_file, lang_hint)
            if len(transcript.strip()) < 4:
                raise RuntimeError("asr_empty_transcript")
            match = build_match_report(text, transcript)
            normalized_expected_text = str(match.get("normalizedExpectedText") or "")
            normalized_transcript = str(match.get("normalizedTranscript") or "")
            exact_match = bool(match.get("exactMatch"))
            coverage_ratio = float(match.get("coverageRatio") or 0.0)
            similarity_ratio = float(match.get("similarityRatio") or 0.0)
            if lang_hint == "en":
                if not exact_match:
                    raise RuntimeError(f"asr_exact_match_failed:{normalized_transcript}")
            elif coverage_ratio < float(args.min_hi_coverage):
                raise RuntimeError(f"asr_coverage_too_low:{coverage_ratio:.3f}")
        except Exception as exc:
            error = str(exc)

        elapsed_ms = int((time.time() - started_voice) * 1000)
        ok = not error
        results.append(
            VoiceAuditResult(
                voice_id=voice_id,
                voice_name=name,
                language_hint=lang_hint,
                ok=ok,
                status_code=status_code,
                content_type=content_type,
                audio_bytes=len(audio_bytes),
                duration_sec=round(float(metrics["duration_sec"]), 3),
                sample_rate=int(metrics["sample_rate"]),
                channels=int(metrics["channels"]),
                sample_width_bytes=int(metrics["sample_width_bytes"]),
                rms=round(float(metrics["rms"]), 6),
                expected_text=text,
                normalized_expected_text=normalized_expected_text,
                transcript=transcript,
                transcript_chars=len(transcript),
                transcript_language=transcript_lang,
                normalized_transcript=normalized_transcript,
                match_mode=match_mode,
                exact_match=exact_match,
                coverage_ratio=round(coverage_ratio, 4),
                similarity_ratio=round(similarity_ratio, 4),
                error=error,
                file=str(output_file.as_posix()),
                elapsed_ms=elapsed_ms,
            )
        )

        status_label = "PASS" if ok else "FAIL"
        message = safe_console_text(error or transcript)
        print(f"[kokoro-live-asr] {voice_id:<10} {status_label} {elapsed_ms}ms {message}")

    passed = sum(1 for item in results if item.ok)
    total = len(results)
    failed = total - passed
    summary = {
        "ok": failed == 0,
        "total": total,
        "passed": passed,
        "failed": failed,
        "elapsedSec": round(time.time() - started, 3),
    }

    report["results"] = [asdict(item) for item in results]
    report["summary"] = summary
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({"ok": summary["ok"], "output": str(report_path), "summary": summary}, indent=2))
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())

