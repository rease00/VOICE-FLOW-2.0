from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

from video_dubbing.config import build_config
from video_dubbing.pipeline import stage8_reconstruct
from video_dubbing.utils.audio_utils import load_audio


def _write_wav(path: Path, audio: np.ndarray, sample_rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), np.asarray(audio, dtype=np.float32), sample_rate)


def test_stage8_timeline_fit_trims_to_segment_window(tmp_path: Path) -> None:
    cfg = build_config(tmp_path)
    sample_rate = cfg.sample_rate

    source = cfg.output_root / "source.wav"
    no_vocals = cfg.output_root / "no_vocals.wav"
    world_clip = cfg.world_dir / "clip.wav"
    duration_sec = 3.0
    full = np.zeros(int(sample_rate * duration_sec), dtype=np.float32)
    _write_wav(source, full, sample_rate)
    _write_wav(no_vocals, full, sample_rate)
    _write_wav(world_clip, np.ones(int(sample_rate * 1.4), dtype=np.float32) * 0.5, sample_rate)

    ctx: dict[str, object] = {
        "segments": [{"start": 1.0, "end": 1.5, "speaker": "SPEAKER_00"}],
        "world_segments": [{"index": 0, "path": str(world_clip), "sr": sample_rate}],
        "audio_raw": str(source),
        "no_vocals": str(no_vocals),
        "source_path": str(source),
    }
    result = stage8_reconstruct.run(ctx, cfg, lambda _: None)
    mixed, _ = load_audio(Path(str(result["dubbed_audio"])), sample_rate=sample_rate)

    seg_start = int(round(1.0 * sample_rate))
    seg_end = int(round(1.5 * sample_rate))
    after = int(round(1.65 * sample_rate))
    assert np.max(np.abs(mixed[seg_start:seg_end])) > 0.05
    assert np.max(np.abs(mixed[seg_end:after])) < 0.02

    alignment = list(result.get("alignment") or [])
    assert len(alignment) == 1
    assert abs(float(alignment[0]["target"]) - 0.5) < 0.02
    assert abs(float(alignment[0]["actual"]) - 0.5) < 0.02


def test_stage8_timeline_fit_applies_fades(tmp_path: Path) -> None:
    cfg = build_config(tmp_path)
    cfg.mix_clip_fade_ms = 16.0
    sample_rate = cfg.sample_rate

    source = cfg.output_root / "source.wav"
    no_vocals = cfg.output_root / "no_vocals.wav"
    world_clip = cfg.world_dir / "clip.wav"
    full = np.zeros(int(sample_rate * 2.0), dtype=np.float32)
    _write_wav(source, full, sample_rate)
    _write_wav(no_vocals, full, sample_rate)
    _write_wav(world_clip, np.ones(int(sample_rate * 0.6), dtype=np.float32), sample_rate)

    ctx: dict[str, object] = {
        "segments": [{"start": 0.4, "end": 1.0, "speaker": "SPEAKER_00"}],
        "world_segments": [{"index": 0, "path": str(world_clip), "sr": sample_rate}],
        "audio_raw": str(source),
        "no_vocals": str(no_vocals),
        "source_path": str(source),
    }
    result = stage8_reconstruct.run(ctx, cfg, lambda _: None)
    mixed, _ = load_audio(Path(str(result["dubbed_audio"])), sample_rate=sample_rate)

    seg_start = int(round(0.4 * sample_rate))
    seg_end = int(round(1.0 * sample_rate))
    lead = mixed[seg_start : seg_start + 40]
    tail = mixed[seg_end - 40 : seg_end]
    center = mixed[seg_start + 400 : seg_start + 800]

    assert np.max(np.abs(center)) > 0.05
    assert float(np.abs(lead[0])) < float(np.max(np.abs(center)))
    assert float(np.abs(tail[-1])) < float(np.max(np.abs(center)))


def test_stage8_timeline_output_duration_matches_input_timeline(tmp_path: Path) -> None:
    cfg = build_config(tmp_path)
    sample_rate = cfg.sample_rate

    source = cfg.output_root / "source.wav"
    no_vocals = cfg.output_root / "no_vocals.wav"
    clip_a = cfg.world_dir / "clip_a.wav"
    clip_b = cfg.world_dir / "clip_b.wav"
    base = np.zeros(int(sample_rate * 2.5), dtype=np.float32)
    _write_wav(source, base, sample_rate)
    _write_wav(no_vocals, base, sample_rate)
    _write_wav(clip_a, np.ones(int(sample_rate * 0.4), dtype=np.float32) * 0.6, sample_rate)
    _write_wav(clip_b, np.ones(int(sample_rate * 0.3), dtype=np.float32) * 0.6, sample_rate)

    ctx: dict[str, object] = {
        "segments": [
            {"start": 0.2, "end": 0.8, "speaker": "A"},
            {"start": 1.3, "end": 1.7, "speaker": "B"},
        ],
        "world_segments": [
            {"index": 0, "path": str(clip_a), "sr": sample_rate},
            {"index": 1, "path": str(clip_b), "sr": sample_rate},
        ],
        "audio_raw": str(source),
        "no_vocals": str(no_vocals),
        "source_path": str(source),
    }
    result = stage8_reconstruct.run(ctx, cfg, lambda _: None)
    mixed, _ = load_audio(Path(str(result["dubbed_audio"])), sample_rate=sample_rate)

    assert mixed.size == base.size
    alignment = list(result.get("alignment") or [])
    assert len(alignment) == 2
    assert all(float(item.get("actual", 0.0)) >= 0.0 for item in alignment)
