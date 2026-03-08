from __future__ import annotations

from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf

from video_dubbing.config import build_config
from video_dubbing.main import _apply_config_overrides
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


class _JsonModeRuntimeResponse:
    def __init__(
        self,
        text: str,
        *,
        status_code: int = 200,
        usage_metadata: dict[str, int] | None = None,
        payload: dict[str, object] | None = None,
    ) -> None:
        self.status_code = int(status_code)
        self.content = b'{"ok":true}'
        self._text = str(text or "")
        self._usage_metadata = usage_metadata or {"promptTokens": 12, "outputTokens": 7, "totalTokens": 19}
        self._payload = payload or {}

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"runtime_failed:{self.status_code}")

    def json(self) -> dict[str, str]:
        return {"text": self._text, "usageMetadata": self._usage_metadata, **self._payload}


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


def test_phase2_director_repairable_json_payload_succeeds(monkeypatch, tmp_path: Path) -> None:
    cfg = build_config(tmp_path)
    vocals = cfg.output_root / "vocals_dry.wav"
    _write_wav(vocals, duration_sec=0.8, sample_rate=cfg.sample_rate)

    def _fake_transcribe(_path: Path, _cfg, _log):
        return "en", [{"start": 0.0, "end": 0.5, "speaker": "SPEAKER_00", "text": "hello there"}]

    def _stub_post(_url: str, json: dict[str, object], timeout: int):
        _ = json
        _ = timeout
        return _JsonModeRuntimeResponse(
            '{ "sceneComplexity":"low", "segments":[{""index"":0,"affective_tags":["tender"]}], }'
        )

    monkeypatch.setattr(phase2_director_multimodal, "_transcribe_segments", _fake_transcribe)
    monkeypatch.setattr(phase2_director_multimodal.requests, "post", _stub_post)

    ctx: dict[str, object] = {"vocals_dry": str(vocals), "target_language": "hi", "strict_gemini_only": True}
    out = phase2_director_multimodal.run(ctx, cfg, lambda _msg: None)
    diagnostics = list(out.get("json_diagnostics") or [])

    assert diagnostics
    assert diagnostics[0].get("stage") == "phase2_director_refine"
    assert bool(diagnostics[0].get("repaired")) is True
    assert str(out.get("segments")[0].get("emotion") or "") == "tender"


def test_phase2_director_retries_parse_failure_then_succeeds(monkeypatch, tmp_path: Path) -> None:
    cfg = build_config(tmp_path)
    vocals = cfg.output_root / "vocals_dry.wav"
    _write_wav(vocals, duration_sec=0.8, sample_rate=cfg.sample_rate)

    attempts = {"count": 0}

    def _fake_transcribe(_path: Path, _cfg, _log):
        return "en", [{"start": 0.0, "end": 0.5, "speaker": "SPEAKER_00", "text": "hello there"}]

    def _stub_post(_url: str, json: dict[str, object], timeout: int):
        _ = json
        _ = timeout
        attempts["count"] += 1
        if attempts["count"] == 1:
            return _JsonModeRuntimeResponse('{"sceneComplexity":"low","segments":[{"index":0 "affective_tags":["neutral"]}]}')
        return _JsonModeRuntimeResponse('{"sceneComplexity":"low","segments":[{"index":0,"affective_tags":["grit"]}]}')

    monkeypatch.setattr(phase2_director_multimodal, "_transcribe_segments", _fake_transcribe)
    monkeypatch.setattr(phase2_director_multimodal.requests, "post", _stub_post)

    ctx: dict[str, object] = {"vocals_dry": str(vocals), "target_language": "hi", "strict_gemini_only": True}
    out = phase2_director_multimodal.run(ctx, cfg, lambda _msg: None)
    diagnostics = list(out.get("json_diagnostics") or [])

    assert attempts["count"] == 2
    assert len(diagnostics) >= 2
    assert str(diagnostics[0].get("errorKind") or "") == "invalid"
    assert str(out.get("segments")[0].get("emotion") or "") == "grit"


def test_phase2_director_strict_parse_retry_exhaustion_fails(monkeypatch, tmp_path: Path) -> None:
    cfg = build_config(tmp_path)
    vocals = cfg.output_root / "vocals_dry.wav"
    _write_wav(vocals, duration_sec=0.8, sample_rate=cfg.sample_rate)

    def _fake_transcribe(_path: Path, _cfg, _log):
        return "en", [{"start": 0.0, "end": 0.5, "speaker": "SPEAKER_00", "text": "hello there"}]

    def _stub_post(_url: str, json: dict[str, object], timeout: int):
        _ = json
        _ = timeout
        return _JsonModeRuntimeResponse('{"sceneComplexity":"low","segments":[{"index":0 "affective_tags":["neutral"]}]}')

    monkeypatch.setattr(phase2_director_multimodal, "_transcribe_segments", _fake_transcribe)
    monkeypatch.setattr(phase2_director_multimodal.requests, "post", _stub_post)

    ctx: dict[str, object] = {"vocals_dry": str(vocals), "target_language": "hi", "strict_gemini_only": True}
    with pytest.raises(RuntimeError, match=r"phase_failed:speaker_segmentation:gemini_refine_failed:json_parse_failed:invalid"):
        phase2_director_multimodal.run(ctx, cfg, lambda _msg: None)


def test_phase3_isochrony_translation_within_tolerance(monkeypatch, tmp_path: Path) -> None:
    cfg = build_config(tmp_path)

    def _stub_post(_url: str, json: dict[str, object], timeout: int):
        _ = timeout
        if _url.endswith("/v1/count-tokens"):
            return _JsonModeRuntimeResponse("", payload={"totalTokens": 21, "model": cfg.director_model})
        trace = str(json.get("trace_id") or "")
        if trace == "v2_phase3_translate_segment_0":
            return _JsonModeRuntimeResponse('{"index":0,"text":"hello world extra extra extra"}')
        if trace == "v2_phase3_translate_segment_1":
            return _JsonModeRuntimeResponse('{"index":1,"text":"nice to meet you extra extra extra"}')
        return _JsonModeRuntimeResponse('{"classifications":[{"index":0,"lang":"en"}]}')

    monkeypatch.setattr(phase3_isochrony_translation.requests, "post", _stub_post)

    ctx: dict[str, object] = {
        "target_language": "hi",
        "source_language_mode": "manual",
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


def test_phase3_classification_and_translation_accept_repairable_json(monkeypatch, tmp_path: Path) -> None:
    cfg = build_config(tmp_path)

    def _stub_post(_url: str, json: dict[str, object], timeout: int):
        _ = timeout
        if _url.endswith("/v1/count-tokens"):
            return _JsonModeRuntimeResponse("", payload={"totalTokens": 18, "model": cfg.director_model})
        trace = str(json.get("trace_id") or "")
        if trace == "v2_phase3_lang_classify":
            return _JsonModeRuntimeResponse('{"classifications":[{""index"":0,"lang":"en"},],}')
        if trace == "v2_phase3_translate_segment_0":
            return _JsonModeRuntimeResponse('{""index"":0,"text":"namaste dosto",}')
        return _JsonModeRuntimeResponse("{}")

    monkeypatch.setattr(phase3_isochrony_translation.requests, "post", _stub_post)

    ctx: dict[str, object] = {
        "target_language": "hi",
        "strict_gemini_only": True,
        "strict_no_fallback": True,
        "segments": [
            {"start": 0.0, "end": 1.0, "speaker": "SPEAKER_00", "text": "hello friends"},
        ],
    }

    out = phase3_isochrony_translation.run(ctx, cfg, lambda _msg: None)
    diagnostics = list(out.get("json_diagnostics") or [])
    translated = str(out.get("segments")[0].get("translated_text") or "")

    assert translated != "hello friends"
    assert translated.startswith("namaste")
    assert len(diagnostics) >= 2
    assert any(str(item.get("stage") or "") == "phase3_language_classification" for item in diagnostics)
    assert any(str(item.get("stage") or "") == "phase3_translation_segment" for item in diagnostics)
    assert any(bool(item.get("repaired")) for item in diagnostics)


def test_phase3_translation_strict_parse_retry_exhaustion_fails(monkeypatch, tmp_path: Path) -> None:
    cfg = build_config(tmp_path)

    def _stub_post(_url: str, json: dict[str, object], timeout: int):
        _ = timeout
        if _url.endswith("/v1/count-tokens"):
            return _JsonModeRuntimeResponse("", payload={"totalTokens": 18, "model": cfg.director_model})
        trace = str(json.get("trace_id") or "")
        if trace == "v2_phase3_translate_segment_0":
            return _JsonModeRuntimeResponse('{"index":0 "text":"broken"}')
        return _JsonModeRuntimeResponse("{}")

    monkeypatch.setattr(phase3_isochrony_translation.requests, "post", _stub_post)

    ctx: dict[str, object] = {
        "target_language": "en",
        "strict_gemini_only": True,
        "strict_no_fallback": True,
        "segments": [
            {"start": 0.0, "end": 1.0, "speaker": "SPEAKER_00", "text": "नमस्ते"},
        ],
    }

    with pytest.raises(
        RuntimeError,
        match=r"phase_failed:translation:segment_failed:json_parse_failed:invalid",
    ):
        phase3_isochrony_translation.run(ctx, cfg, lambda _msg: None)


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
    cfg.isochrony_tolerance_pct = 100.0

    class _VoiceTransferResponse:
        def __init__(self, audio_bytes: bytes) -> None:
            self.content = audio_bytes
            self.headers = {
                "x-vf-voice-transfer-model-resolved": "f_8312_32k-325",
                "x-vf-voice-transfer-backend-mode": "w_okada_rvc_onnx",
            }

        def raise_for_status(self) -> None:
            return None

    def _fake_post(_url: str, files=None, data=None, timeout: int = 0):
        _ = files
        _ = data
        _ = timeout
        return _VoiceTransferResponse(_wav_bytes(duration_sec=0.45, sample_rate=cfg.sample_rate))

    ctx: dict[str, object] = {
        "base_tts_segments": [
            {"index": 0, "path": str(segment_a), "speaker": "A"},
            {"index": 1, "path": str(segment_b), "speaker": "B"},
        ],
        "segments": [
            {"index": 0, "start": 0.0, "end": 0.4, "speaker": "A", "translated_text": "hello"},
            {"index": 1, "start": 0.4, "end": 1.0, "speaker": "B", "translated_text": "world"},
        ],
        "voice_model": "p17_india_boy",
    }

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(phase5_llvc_timbre_transfer.requests, "post", _fake_post)
    phase5_llvc_timbre_transfer.run(ctx, cfg, lambda _msg: None)
    monkeypatch.undo()

    llvc_segments = list(ctx["voice_transfer_segments"])
    metrics = dict(ctx["voice_transfer_metrics"])
    assert len(llvc_segments) == 2
    assert all(float(item.get("rtf") or 0.0) >= 0.0 for item in llvc_segments)
    assert metrics.get("preset") == cfg.llvc_preset
    assert int(metrics.get("segmentCount") or 0) == 2


def test_phase6_lipsync_warns_when_lpips_missing(monkeypatch, tmp_path: Path) -> None:
    cfg = build_config(tmp_path)
    cfg.lpips_asset_path = tmp_path / "missing_lpips.onnx"
    cfg.latent_sync_cmd = "copy /Y \"{input}\" \"{output}\""

    audio_raw = cfg.output_root / "audio_raw.wav"
    music_effects = cfg.output_root / "music_effects.wav"
    source = cfg.output_root / "source.mp4"
    llvc_seg = cfg.output_root / "voice_transfer" / "voice_transfer_0000.wav"
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
    monkeypatch.setattr(
        phase6_lipsync_onnx.subprocess,
        "run",
        lambda *args, **kwargs: (cfg.output_root / "dubbed_video_final.mp4").write_bytes(b"00"),
    )

    ctx: dict[str, object] = {
        "segments": [{"start": 0.0, "end": 0.5, "speaker": "SPEAKER_00"}],
        "voice_transfer_segments": [{"index": 0, "path": str(llvc_seg), "sr": cfg.sample_rate}],
        "audio_raw": str(audio_raw),
        "music_effects": str(music_effects),
        "source_path": str(source),
    }

    phase6_lipsync_onnx.run(ctx, cfg, lambda _msg: None)

    metrics = dict(ctx["video_sync_metrics"])
    lpips = dict(metrics.get("lpips") or {})
    assert metrics.get("engine") == "video_lipsync"
    assert lpips.get("warning") == "lpips_asset_missing_optional"
    assert Path(str(ctx["dubbed_video_final"])).exists()


def test_pipeline_config_override_maps_llvc_preset_alias(tmp_path: Path) -> None:
    cfg = build_config(tmp_path)
    _apply_config_overrides(cfg, {"llvc_preset": "tts_realtime"})
    assert cfg.voice_transfer_preset == "tts_realtime"
