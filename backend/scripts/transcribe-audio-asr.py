#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from faster_whisper import WhisperModel

from asr_audit_utils import build_match_report, transcribe_audio


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Transcribe an audio file and optionally compare it to expected text.")
    parser.add_argument("--audio-path", required=True, help="Path to the WAV/audio file to transcribe.")
    parser.add_argument("--language", default="en", help="Language hint for Whisper.")
    parser.add_argument("--expected-text", default="", help="Expected text for normalized ASR comparison.")
    parser.add_argument("--whisper-model", default="tiny", help="faster-whisper model size.")
    parser.add_argument("--whisper-device", default="cpu", help="Whisper device.")
    parser.add_argument("--whisper-compute", default="int8", help="Whisper compute type.")
    return parser.parse_args()


def configure_stdio() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8")


def main() -> int:
    configure_stdio()
    args = parse_args()
    model = WhisperModel(
        str(args.whisper_model),
        device=str(args.whisper_device),
        compute_type=str(args.whisper_compute),
    )
    audio_path = Path(args.audio_path).resolve()
    transcript, transcript_language = transcribe_audio(model, audio_path, str(args.language))
    report = build_match_report(str(args.expected_text), transcript)
    payload = {
        **report,
        "audioPath": str(audio_path),
        "transcript": transcript,
        "transcriptLanguage": transcript_language,
    }
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
