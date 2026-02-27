from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from video_dubbing.config import DubbingConfig


EMOTION_MAP = {
    "ang": "angry",
    "hap": "happy",
    "sad": "sad",
    "neu": "neutral",
    "fear": "fearful",
    "sur": "surprised",
}


def _heuristic_emotion(text: str) -> str:
    lower = text.lower()
    if any(k in lower for k in ["!", "great", "wow", "awesome"]):
        return "happy"
    if any(k in lower for k in ["sorry", "miss", "pain", "sad"]):
        return "sad"
    if any(k in lower for k in ["angry", "hate", "damn"]):
        return "angry"
    return "neutral"


def run(ctx: dict[str, Any], cfg: DubbingConfig, log: Callable[[str], None]) -> dict[str, Any]:
    segments: list[dict[str, Any]] = list(ctx.get("segments") or [])
    vocals = Path(ctx["vocals"])

    classifier = None
    try:
        from speechbrain.inference.classifiers import EncoderClassifier  # type: ignore

        classifier = EncoderClassifier.from_hparams(
            source="speechbrain/emotion-recognition-wav2vec2-IEMOCAP",
            savedir=str(cfg.models_root / "speechbrain_ser"),
        )
    except Exception as exc:
        log(f"speechbrain emotion model unavailable: {exc}")

    for seg in segments:
        seg["emotion"] = _heuristic_emotion(seg.get("text", ""))
        seg["emotion_confidence"] = 0.5

    if classifier is not None:
        try:
            import numpy as np
            import soundfile as sf

            audio, sr = sf.read(str(vocals))
            if getattr(audio, "ndim", 1) > 1:
                audio = np.mean(audio, axis=1)
            for seg in segments:
                s = int(float(seg.get("start", 0.0)) * sr)
                e = int(float(seg.get("end", 0.0)) * sr)
                if e <= s + int(sr * 0.25):
                    continue
                tensor = classifier.load_audio(str(vocals), savedir=None)[s:e]
                out = classifier.classify_batch(tensor.unsqueeze(0))
                label = str(out[3][0])
                key = label.lower()[:4]
                seg["emotion"] = EMOTION_MAP.get(key, seg["emotion"])
                seg["emotion_confidence"] = float(out[1].max().item())
        except Exception as exc:
            log(f"speechbrain emotion inference skipped: {exc}")

    ctx["segments"] = segments
    return ctx
