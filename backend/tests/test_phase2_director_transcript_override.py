from __future__ import annotations

from pathlib import Path

import pytest

_video_dubbing_config = pytest.importorskip(
    "video_dubbing.config",
    reason="video_dubbing source modules are optional in this workspace snapshot.",
)
phase2 = pytest.importorskip(
    "video_dubbing.pipeline.phase2_director_multimodal",
    reason="video_dubbing source modules are optional in this workspace snapshot.",
)
build_config = _video_dubbing_config.build_config


def test_phase2_uses_transcript_override_without_whisper(monkeypatch, tmp_path: Path) -> None:
    vocals = tmp_path / "vocals.wav"
    vocals.write_bytes(b"00")

    def _fail_if_called(*args, **kwargs):
        _ = args
        _ = kwargs
        raise AssertionError("whisper transcription should not be called when transcript_override is provided")

    monkeypatch.setattr(phase2, "_transcribe_segments", _fail_if_called)

    ctx = {
        "vocals_dry": str(vocals),
        "target_language": "hi",
        "transcript_override": "[00:00-00:02] Speaker A: hello there",
    }
    cfg = build_config(tmp_path / "out")
    out = phase2.run(ctx, cfg, lambda _msg: None)

    segments = list(out.get("segments") or [])
    assert len(segments) == 1
    assert str(segments[0].get("speaker") or "") == "SPEAKER_00"
    assert str(segments[0].get("speaker_raw") or "") == "Speaker A"
    assert str(segments[0].get("text") or "") == "hello there"
    assert str(out.get("language") or "") == "hi"
    director = out.get("director_json") or {}
    assert isinstance(director, dict)
    assert len(list(director.get("segments") or [])) == 1


def test_phase2_falls_back_to_transcribe_when_override_empty(monkeypatch, tmp_path: Path) -> None:
    vocals = tmp_path / "vocals.wav"
    vocals.write_bytes(b"00")

    def _fake_transcribe(_vocals_path, _cfg, _log):
        return "en", [{"start": 0.0, "end": 1.0, "speaker": "SPEAKER_00", "text": "fallback line"}]

    monkeypatch.setattr(phase2, "_transcribe_segments", _fake_transcribe)

    ctx = {
        "vocals_dry": str(vocals),
        "target_language": "auto",
        "transcript_override": "",
    }
    cfg = build_config(tmp_path / "out")
    out = phase2.run(ctx, cfg, lambda _msg: None)

    segments = list(out.get("segments") or [])
    assert len(segments) == 1
    assert str(segments[0].get("text") or "") == "fallback line"
    assert str(out.get("language") or "") == "en"
