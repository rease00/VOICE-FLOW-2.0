from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app as backend_app


client = TestClient(backend_app.app)


@pytest.fixture(autouse=True)
def _disable_auth_enforcement(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)


def test_tts_engines_status_contract(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "_probe_runtime_health", lambda _url, timeout_sec=3.0: (True, "online"))
    monkeypatch.setattr(backend_app, "_probe_runtime_capabilities", lambda _engine, timeout_sec=3.0: {"ready": True})

    response = client.get("/tts/engines/status", params={"engine": "GEM"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["engines"]["GEM"]["state"] == "online"
    assert "runtimeUrl" in payload["engines"]["GEM"]


def test_tts_engines_voices_contract_gem_fallback() -> None:
    response = client.get("/tts/engines/voices", params={"engine": "GEM"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["engine"] == "GEM"
    assert isinstance(payload["voices"], list)
    assert payload["voices"]
    assert "voice_id" in payload["voices"][0]


def test_tts_voice_mapping_catalog_contract() -> None:
    response = client.get("/tts/voice-mapping/catalog")
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert isinstance(payload.get("profiles"), list)
    assert isinstance(payload.get("engines"), dict)
    assert "fetchedAt" in payload


def test_video_separate_stem_contract(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "ENABLE_SOURCE_SEPARATION", True)

    def fake_ensure_source_separation(_source_path: Path, _model_name: str):
        speech = tmp_path / "speech.wav"
        background = tmp_path / "background.wav"
        speech.write_bytes(b"RIFF\x00\x00\x00\x00WAVE")
        background.write_bytes(b"RIFF\x00\x00\x00\x00WAVE")
        return speech, background, "cache-key"

    monkeypatch.setattr(backend_app, "_ensure_source_separation", fake_ensure_source_separation)

    response = client.post(
        "/video/separate-stem",
        files={"file": ("sample.wav", b"abc", "audio/wav")},
        data={"stem": "speech"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("audio/wav")


def test_video_transcribe_compat_capture_emotions_alias(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "ENABLE_TRANSCRIBE_EMOTION_CAPTURE", True)
    monkeypatch.setattr(backend_app, "TRANSCRIBE_EMOTION_MAX_SEGMENTS", 10)
    monkeypatch.setattr(backend_app, "TRANSCRIBE_EMOTION_MIN_SECONDS", 0.0)

    def fake_convert_media_to_wav(_src: str, dst: str, sample_rate: int = 16000, channels: int = 1):
        Path(dst).write_bytes(b"RIFF\x00\x00\x00\x00WAVE")

    def fake_transcribe_with_whisper(_asr_path: Path, language: str, task: str, return_words: bool):
        return {
            "language": "en",
            "segments": [
                {
                    "id": 0,
                    "start": 0.0,
                    "end": 1.0,
                    "text": "Hello",
                    "speaker": "Speaker 1",
                }
            ],
        }

    def fake_slice_audio_segment_to_wav(_src: str, dst: str, start: float, end: float, sample_rate: int = 16000):
        Path(dst).write_bytes(b"RIFF\x00\x00\x00\x00WAVE")

    monkeypatch.setattr(backend_app, "_convert_media_to_wav", fake_convert_media_to_wav)
    monkeypatch.setattr(backend_app, "_transcribe_with_whisper", fake_transcribe_with_whisper)
    monkeypatch.setattr(backend_app, "_slice_audio_segment_to_wav", fake_slice_audio_segment_to_wav)
    monkeypatch.setattr(
        backend_app,
        "_detect_emotion_from_segment_audio",
        lambda *_args, **_kwargs: ("Happy", "mock", 0.99),
    )
    monkeypatch.setattr(backend_app, "_wav_duration_seconds", lambda _path: 1.0)

    response = client.post(
        "/video/transcribe",
        files={"file": ("clip.wav", b"abc", "audio/wav")},
        data={
            "language": "auto",
            "task": "transcribe",
            "include_emotion": "false",
            "capture_emotions": "true",
            "return_words": "true",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["segments"][0]["emotion"] == "Happy"


def test_video_mux_dub_accepts_legacy_mix_alias(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "_get_ffmpeg_path", lambda: "ffmpeg")
    monkeypatch.setattr(backend_app, "_cleanup_paths", lambda *_args, **_kwargs: None)

    def fake_run(args):
        # last argument in ffmpeg command is output path
        Path(args[-1]).write_bytes(b"00")

    monkeypatch.setattr(backend_app, "_run", fake_run)

    response = client.post(
        "/video/mux-dub",
        files={
            "video": ("video.mp4", b"video", "video/mp4"),
            "dub_audio": ("dub.wav", b"audio", "audio/wav"),
        },
        data={
            "speech_gain": "1.0",
            "background_gain": "0.3",
            "normalize": "true",
            "mix_with_video_audio": "false",
        },
    )

    assert response.status_code == 200
