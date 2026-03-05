from __future__ import annotations

from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import soundfile as sf

from video_dubbing.config import build_config
from video_dubbing.pipeline import (
    phase1_acoustic_isolation,
    phase2_director_multimodal,
    phase3_isochrony_translation,
    phase4_base_tts,
    phase5_llvc_timbre_transfer,
    phase6_lipsync_onnx,
)


def _write_wav(path: Path, duration_sec: float = 0.5, sample_rate: int = 24000) -> None:
    samples = max(1, int(round(duration_sec * sample_rate)))
    signal = np.linspace(-0.2, 0.2, samples, dtype=np.float32)
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), signal, sample_rate)


def _wav_bytes(duration_sec: float = 0.2, sample_rate: int = 24000) -> bytes:
    samples = max(1, int(round(duration_sec * sample_rate)))
    signal = np.zeros(samples, dtype=np.float32)
    buffer = BytesIO()
    sf.write(buffer, signal, sample_rate, format="WAV")
    return buffer.getvalue()


def test_phase1_acoustic_isolation_outputs_and_cache_reuse(monkeypatch, tmp_path: Path) -> None:
    cfg = build_config(tmp_path)
    source = tmp_path / "source.wav"
    _write_wav(source, duration_sec=1.0, sample_rate=cfg.sample_rate)

    demucs_calls = {"count": 0}

    def _fake_extract(_source: Path, dst: Path, sample_rate: int = 48000):
        _write_wav(Path(dst), duration_sec=1.0, sample_rate=sample_rate)

    def _fake_demucs_run(_cmd, check=True, capture_output=True):
        _ = check
        _ = capture_output
        demucs_calls["count"] += 1
        demucs_dir = cfg.output_root / "htdemucs" / "audio_raw"
        _write_wav(demucs_dir / "vocals.wav", duration_sec=0.9, sample_rate=cfg.sample_rate)
        _write_wav(demucs_dir / "no_vocals.wav", duration_sec=0.9, sample_rate=cfg.sample_rate)
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(phase1_acoustic_isolation, "ffmpeg_extract_audio", _fake_extract)
    monkeypatch.setattr(phase1_acoustic_isolation.subprocess, "run", _fake_demucs_run)

    ctx: dict[str, object] = {
        "source_path": str(source),
        "target_language": "hi",
        "assets": {},
    }

    phase1_acoustic_isolation.run(ctx, cfg, lambda _msg: None)

    assert Path(str(ctx["audio_raw"])).exists()
    assert Path(str(ctx["vocals_dry"])).exists()
    assert Path(str(ctx["music_effects"])).exists()
    assert dict(ctx["phase1"]).get("cacheHit") is False

    Path(str(ctx["audio_raw"])).unlink(missing_ok=True)
    Path(str(ctx["vocals_dry"])).unlink(missing_ok=True)
    Path(str(ctx["music_effects"])).unlink(missing_ok=True)

    monkeypatch.setattr(
        phase1_acoustic_isolation,
        "ffmpeg_extract_audio",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("cache should be reused")),
    )

    phase1_acoustic_isolation.run(ctx, cfg, lambda _msg: None)

    assert Path(str(ctx["audio_raw"])).exists()
    assert Path(str(ctx["vocals_dry"])).exists()
    assert Path(str(ctx["music_effects"])).exists()
    assert dict(ctx["phase1"]).get("cacheHit") is True
    assert demucs_calls["count"] == 1


def test_phase2_director_json_schema_and_timing(monkeypatch, tmp_path: Path) -> None:
    cfg = build_config(tmp_path)
    vocals = cfg.output_root / "vocals_dry.wav"
    _write_wav(vocals, duration_sec=1.2, sample_rate=cfg.sample_rate)

    def _fake_transcribe(_path: Path, _cfg, _log):
        return "en", [
            {"start": 0.0, "end": 0.5, "speaker": "SPEAKER_00", "text": "hello?"},
            {"start": 0.5, "end": 1.0, "speaker": "SPEAKER_01", "text": "sure!"},
        ]

    monkeypatch.setattr(phase2_director_multimodal, "_transcribe_segments", _fake_transcribe)

    ctx: dict[str, object] = {"vocals_dry": str(vocals), "target_language": "hi"}
    phase2_director_multimodal.run(ctx, cfg, lambda _msg: None)

    director = dict(ctx["director_json"])
    segments = list(director.get("segments") or [])
    assert director.get("modelPreferred") == cfg.director_model
    assert len(segments) == 2
    assert int(segments[0]["start_ms"]) >= 0
    assert int(segments[0]["end_ms"]) > int(segments[0]["start_ms"])
    assert int(segments[1]["start_ms"]) >= int(segments[0]["end_ms"])


def test_phase3_isochrony_translation_within_tolerance(monkeypatch, tmp_path: Path) -> None:
    cfg = build_config(tmp_path)

    monkeypatch.setattr(
        phase3_isochrony_translation,
        "_translate_stub",
        lambda text, _target: f"{text} extra extra extra extra extra",
    )

    ctx: dict[str, object] = {
        "target_language": "hi",
        "segments": [
            {"start": 0.0, "end": 1.0, "speaker": "A", "text": "hello world"},
            {"start": 1.0, "end": 2.0, "speaker": "B", "text": "nice to meet you"},
        ],
    }

    phase3_isochrony_translation.run(ctx, cfg, lambda _msg: None)

    segments = list(ctx["segments"])
    stats = dict(ctx["isochrony_stats"])
    tolerance = float(cfg.isochrony_tolerance_pct) / 100.0
    min_ratio = 1.0 - tolerance
    max_ratio = 1.0 + tolerance

    assert stats.get("segmentCount") == 2
    assert int(stats.get("rewrittenCount") or 0) >= 1
    for segment in segments:
        ratio = float(segment.get("isochrony_ratio") or 0.0)
        assert min_ratio <= ratio <= max_ratio


def test_phase4_base_tts_dynamic_speaking_rate_and_director_tags(monkeypatch, tmp_path: Path) -> None:
    cfg = build_config(tmp_path)

    payloads: list[dict[str, object]] = []

    class _FakeResponse:
        def __init__(self, content: bytes) -> None:
            self.content = content

        def raise_for_status(self) -> None:
            return None

    def _fake_post(_url: str, json: dict[str, object], timeout: int):
        _ = timeout
        payloads.append(dict(json))
        return _FakeResponse(_wav_bytes())

    monkeypatch.setattr(phase4_base_tts.requests, "post", _fake_post)

    ctx: dict[str, object] = {
        "target_language": "hi",
        "segments": [
            {
                "start": 0.0,
                "end": 0.8,
                "speaker": "SPEAKER_00",
                "translated_text": "fast line",
                "voice_id": "alloy",
            },
            {
                "start": 0.8,
                "end": 3.8,
                "speaker": "SPEAKER_01",
                "translated_text": "longer line for calm pacing",
                "voice_id": "alloy",
            },
        ],
        "director_json": {
            "segments": [
                {"affective_tags": ["grit"]},
                {"affective_tags": ["whisper"]},
            ]
        },
    }

    phase4_base_tts.run(ctx, cfg, lambda _msg: None)

    requests_meta = list(ctx["tts_requests"])
    assert len(requests_meta) == 2
    assert requests_meta[0].get("directorTags") == ["grit"]
    assert requests_meta[1].get("directorTags") == ["whisper"]
    assert float(requests_meta[0].get("speakingRate") or 0.0) != float(requests_meta[1].get("speakingRate") or 0.0)
    assert all(Path(str(item.get("path"))).exists() for item in list(ctx["base_tts_segments"]))


def test_phase5_llvc_metrics_capture_and_cpu_preset(tmp_path: Path) -> None:
    cfg = build_config(tmp_path)
    segment_a = cfg.output_root / "tts" / "seg_a.wav"
    segment_b = cfg.output_root / "tts" / "seg_b.wav"
    _write_wav(segment_a, duration_sec=0.4, sample_rate=24000)
    _write_wav(segment_b, duration_sec=0.6, sample_rate=24000)

    ctx: dict[str, object] = {
        "base_tts_segments": [
            {"index": 0, "path": str(segment_a), "speaker": "A"},
            {"index": 1, "path": str(segment_b), "speaker": "B"},
        ]
    }

    phase5_llvc_timbre_transfer.run(ctx, cfg, lambda _msg: None)

    llvc_segments = list(ctx["llvc_segments"])
    metrics = dict(ctx["llvc_metrics"])
    assert len(llvc_segments) == 2
    assert all(float(item.get("rtf") or 0.0) >= 0.0 for item in llvc_segments)
    assert metrics.get("preset") == cfg.llvc_preset
    assert int(metrics.get("segmentCount") or 0) == 2


def test_phase6_lipsync_warns_when_lpips_missing(monkeypatch, tmp_path: Path) -> None:
    cfg = build_config(tmp_path)
    cfg.lpips_asset_path = tmp_path / "missing_lpips.onnx"

    audio_raw = cfg.output_root / "audio_raw.wav"
    music_effects = cfg.output_root / "music_effects.wav"
    source = cfg.output_root / "source.mp4"
    llvc_seg = cfg.output_root / "llvc" / "llvc_0000.wav"
    _write_wav(audio_raw, duration_sec=1.0, sample_rate=cfg.sample_rate)
    _write_wav(music_effects, duration_sec=1.0, sample_rate=cfg.sample_rate)
    _write_wav(llvc_seg, duration_sec=0.5, sample_rate=cfg.sample_rate)
    source.write_bytes(b"00")

    def _fake_reconstruct(temp_ctx: dict[str, object], cfg_obj, _log):
        dubbed_audio = Path(cfg_obj.output_root) / "dubbed_audio.wav"
        dubbed_video_raw = Path(cfg_obj.output_root) / "dubbed_video_raw.mp4"
        _write_wav(dubbed_audio, duration_sec=1.0, sample_rate=cfg_obj.sample_rate)
        dubbed_video_raw.write_bytes(b"00")
        temp_ctx["dubbed_audio"] = str(dubbed_audio)
        temp_ctx["dubbed_video_raw"] = str(dubbed_video_raw)
        temp_ctx["alignment"] = [{"index": 0, "score": 1.0, "target": 0.5, "actual": 0.5}]
        return temp_ctx

    monkeypatch.setattr(phase6_lipsync_onnx.stage8_reconstruct, "run", _fake_reconstruct)

    ctx: dict[str, object] = {
        "segments": [{"start": 0.0, "end": 0.5, "speaker": "SPEAKER_00"}],
        "llvc_segments": [{"index": 0, "path": str(llvc_seg), "sr": cfg.sample_rate}],
        "audio_raw": str(audio_raw),
        "music_effects": str(music_effects),
        "source_path": str(source),
    }

    phase6_lipsync_onnx.run(ctx, cfg, lambda _msg: None)

    metrics = dict(ctx["lipsync_metrics"])
    lpips = dict(metrics.get("lpips") or {})
    assert metrics.get("engine") == "wav2lip-onnx"
    assert lpips.get("warning") == "lpips_asset_missing_optional"
    assert Path(str(ctx["dubbed_video_final"])).exists()
