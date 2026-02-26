from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf


def ffmpeg_extract_audio(input_path: Path, output_wav: Path, sample_rate: int = 48000) -> None:
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        str(output_wav),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def load_audio(path: Path, sample_rate: int | None = None) -> tuple[np.ndarray, int]:
    audio, sr = sf.read(str(path), always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sample_rate and sr != sample_rate:
        try:
            import librosa  # type: ignore

            audio = librosa.resample(audio, orig_sr=sr, target_sr=sample_rate)
            sr = sample_rate
        except Exception:
            pass
    return audio.astype(np.float32), int(sr)


def save_audio(path: Path, audio: np.ndarray, sample_rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), np.asarray(audio, dtype=np.float32), sample_rate)


def normalize_peak(audio: np.ndarray, target_peak: float = 0.95) -> np.ndarray:
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak <= 1e-6:
        return audio
    gain = min(4.0, target_peak / peak)
    return (audio * gain).astype(np.float32)
