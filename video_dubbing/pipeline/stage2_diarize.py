from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from video_dubbing.config import DubbingConfig


def run(ctx: dict[str, Any], cfg: DubbingConfig, log: Callable[[str], None]) -> dict[str, Any]:
    segments: list[dict[str, Any]] = list(ctx.get("segments") or [])
    vocals = Path(ctx["vocals"])

    diarized = False
    if cfg.pyannote_token:
        try:
            from pyannote.audio import Pipeline  # type: ignore

            pipe = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=cfg.pyannote_token)
            diarization = pipe(str(vocals))
            turns = []
            for turn, _, speaker in diarization.itertracks(yield_label=True):
                turns.append((float(turn.start), float(turn.end), str(speaker)))
            for seg in segments:
                s = float(seg.get("start", 0.0))
                e = float(seg.get("end", s))
                best = "SPEAKER_00"
                best_overlap = 0.0
                for ts, te, spk in turns:
                    overlap = max(0.0, min(e, te) - max(s, ts))
                    if overlap > best_overlap:
                        best_overlap = overlap
                        best = spk
                seg["speaker"] = best
            diarized = True
        except Exception as exc:
            log(f"pyannote diarization skipped: {exc}")

    if not diarized:
        for seg in segments:
            seg["speaker"] = seg.get("speaker") or "SPEAKER_00"

    ctx["segments"] = segments
    log(f"speaker labels assigned: {len({seg['speaker'] for seg in segments})}")
    return ctx
