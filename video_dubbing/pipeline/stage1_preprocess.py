from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Callable

from video_dubbing.config import DubbingConfig
from video_dubbing.utils.audio_utils import ffmpeg_extract_audio


def run(ctx: dict[str, Any], cfg: DubbingConfig, log: Callable[[str], None]) -> dict[str, Any]:
    source_path = Path(ctx["source_path"])
    audio_raw = cfg.output_root / "audio_raw.wav"
    ffmpeg_extract_audio(source_path, audio_raw, sample_rate=cfg.sample_rate)
    log(f"audio extracted: {audio_raw.name}")

    vocals = cfg.output_root / "htdemucs" / audio_raw.stem / "vocals.wav"
    no_vocals = cfg.output_root / "htdemucs" / audio_raw.stem / "no_vocals.wav"
    try:
        cmd = [
            "demucs",
            "-n",
            cfg.demucs_model,
            "--two-stems",
            "vocals",
            "-o",
            str(cfg.output_root),
            str(audio_raw),
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        log("demucs separation complete")
    except Exception as exc:
        log(f"demucs skipped: {exc}")

    if not vocals.exists():
        vocals = audio_raw
    if not no_vocals.exists():
        no_vocals = audio_raw

    segments: list[dict[str, Any]] = []
    language = "auto"
    try:
        from faster_whisper import WhisperModel  # type: ignore

        model = WhisperModel(cfg.whisper_model, device=cfg.whisper_device, compute_type=cfg.whisper_compute_type)
        result, info = model.transcribe(str(vocals), word_timestamps=True, beam_size=5)
        language = getattr(info, "language", "auto") or "auto"
        for item in result:
            words = []
            for word in item.words or []:
                words.append({"start": float(word.start), "end": float(word.end), "word": word.word})
            segments.append(
                {
                    "start": float(item.start),
                    "end": float(item.end),
                    "text": item.text.strip(),
                    "words": words,
                }
            )
        log(f"whisper segments: {len(segments)}")
    except Exception as exc:
        log(f"whisper failed: {exc}")

    transcript_path = cfg.output_root / "transcript.json"
    transcript_path.write_text(json.dumps({"language": language, "segments": segments}, indent=2), encoding="utf-8")

    ctx.update(
        {
            "audio_raw": str(audio_raw),
            "vocals": str(vocals),
            "no_vocals": str(no_vocals),
            "language": language,
            "segments": segments,
        }
    )
    return ctx
