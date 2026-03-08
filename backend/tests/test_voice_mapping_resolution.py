from __future__ import annotations

import threading
import wave
from io import BytesIO

import app as backend_app


def _tiny_wav_bytes(
    duration_frames: int = 400,
    sample_rate: int = 32000,
    sample_value: int = 0,
) -> bytes:
    payload = BytesIO()
    with wave.open(payload, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        frame = int(sample_value).to_bytes(2, "little", signed=True)
        handle.writeframes(frame * max(1, int(duration_frames)))
    return payload.getvalue()


def test_resolve_gem_runtime_voice_name_supports_alias_tokens() -> None:
    assert backend_app._resolve_gem_runtime_voice_name("fenrir") == "Fenrir"
    assert backend_app._resolve_gem_runtime_voice_name("\"Fenrir\"") == "Fenrir"
    assert backend_app._resolve_gem_runtime_voice_name(" Arjun India Male ") == "Fenrir"
    assert backend_app._resolve_gem_runtime_voice_name("v1") == "Fenrir"


def test_resolve_mapped_profile_supports_normalized_tokens() -> None:
    profile_a = backend_app._resolve_mapped_profile("GEM", "\"v1\"", voice_name="\"Fenrir\"")
    profile_b = backend_app._resolve_mapped_profile("GOOD", "v1", voice_name="fenrir")
    assert isinstance(profile_a, dict)
    assert isinstance(profile_b, dict)
    assert str(profile_a.get("profileId") or "") == "p01_india_m_adult"
    assert str(profile_b.get("profileId") or "") == "p01_india_m_adult"


def test_convert_tts_audio_uses_round_robin_llvc_runtime_urls(monkeypatch) -> None:
    class _FakeResponse:
        def __init__(self, content: bytes) -> None:
            self.ok = True
            self.content = content
            self.status_code = 200
            self.text = ""
            self.headers = {
                "x-vf-voice-transfer-backend-mode": "w_okada_rvc_onnx",
                "x-vf-voice-transfer-preset": "voice_transfer_hq_cpu",
            }

    calls: list[str] = []
    posted_forms: list[dict[str, object]] = []

    def _fake_post(url, *args, **kwargs):
        calls.append(str(url))
        posted_forms.append(dict(kwargs.get("data") or {}))
        return _FakeResponse(_tiny_wav_bytes(duration_frames=640, sample_value=1400))

    monkeypatch.setattr(backend_app, "VF_LLVC_RUNTIME_URLS", ("http://127.0.0.1:7830", "http://127.0.0.1:7831"))
    monkeypatch.setattr(backend_app, "_LLVC_RUNTIME_POOL_CURSOR", 0)
    monkeypatch.setattr(backend_app, "_TTS_LIVE_LLVC_SEMAPHORE", threading.Semaphore(8))
    monkeypatch.setattr(backend_app, "VF_TTS_POST_LLVC_PRESET", "voice_transfer_hq_cpu")
    monkeypatch.setattr(backend_app, "VF_TTS_POST_LLVC_BACKEND_MODE", "onnx")
    monkeypatch.setattr(backend_app, "_resolve_mapped_model_name", lambda *args, **kwargs: ("p01_india_m_adult", "p01_india_m_adult"))
    monkeypatch.setattr(
        backend_app,
        "_resolve_mapped_profile",
        lambda *args, **kwargs: {"profileId": "p01_india_m_adult", "ageGroup": "adult", "gender": "male"},
    )
    monkeypatch.setattr(backend_app, "_post_tts_llvc_pitch_shift_for_profile", lambda *_args, **_kwargs: 0)
    monkeypatch.setattr(backend_app.requests, "post", _fake_post)

    first_audio, first_headers = backend_app._convert_tts_audio_with_llvc_runtime(
        audio_bytes=_tiny_wav_bytes(duration_frames=640),
        engine="GEM",
        voice_id="v1",
        voice_name="Fenrir",
    )
    second_audio, second_headers = backend_app._convert_tts_audio_with_llvc_runtime(
        audio_bytes=_tiny_wav_bytes(duration_frames=640),
        engine="GEM",
        voice_id="v1",
        voice_name="Fenrir",
    )

    assert len(first_audio) > 100
    assert len(second_audio) > 100
    assert first_headers.get("x-vf-post-tts-voice-transfer-endpoint") == "http://127.0.0.1:7830"
    assert second_headers.get("x-vf-post-tts-voice-transfer-endpoint") == "http://127.0.0.1:7831"
    assert first_headers.get("x-vf-post-tts-preset") == "voice_transfer_hq_cpu"
    assert first_headers.get("x-vf-post-tts-requested-backend-mode") == "onnx"
    assert first_headers.get("x-vf-post-tts-backend-mode") == "w_okada_rvc_onnx"
    assert calls[0].startswith("http://127.0.0.1:7830/")
    assert calls[1].startswith("http://127.0.0.1:7831/")
    assert posted_forms[0]["preset"] == "voice_transfer_hq_cpu"
    assert posted_forms[0]["backend_mode"] == "onnx"


def test_convert_tts_audio_retries_with_realtime_preset_when_hq_output_is_silent(monkeypatch) -> None:
    class _FakeResponse:
        def __init__(self, content: bytes, preset: str) -> None:
            self.ok = True
            self.content = content
            self.status_code = 200
            self.text = ""
            self.headers = {
                "x-vf-voice-transfer-backend-mode": "w_okada_rvc_onnx",
                "x-vf-voice-transfer-preset": preset,
            }

    posted_presets: list[str] = []

    def _fake_post(_url, *args, **kwargs):
        _ = args
        request_form = dict(kwargs.get("data") or {})
        preset = str(request_form.get("preset") or "")
        posted_presets.append(preset)
        if len(posted_presets) == 1:
            return _FakeResponse(_tiny_wav_bytes(duration_frames=640, sample_value=0), "voice_transfer_hq_cpu")
        return _FakeResponse(_tiny_wav_bytes(duration_frames=640, sample_value=1800), "tts_realtime")

    monkeypatch.setattr(backend_app, "_TTS_LIVE_LLVC_SEMAPHORE", threading.Semaphore(8))
    monkeypatch.setattr(backend_app, "VF_TTS_POST_LLVC_PRESET", "auto_cpu")
    monkeypatch.setattr(backend_app, "VF_TTS_POST_LLVC_AUTO_HQ_MAX_MS", 8000)
    monkeypatch.setattr(backend_app, "VF_TTS_POST_LLVC_BACKEND_MODE", "onnx")
    monkeypatch.setattr(backend_app, "_resolve_mapped_model_name", lambda *args, **kwargs: ("p01_india_m_adult", "p01_india_m_adult"))
    monkeypatch.setattr(
        backend_app,
        "_resolve_mapped_profile",
        lambda *args, **kwargs: {"profileId": "p01_india_m_adult", "ageGroup": "adult", "gender": "male"},
    )
    monkeypatch.setattr(backend_app, "_post_tts_llvc_pitch_shift_for_profile", lambda *_args, **_kwargs: 0)
    monkeypatch.setattr(backend_app.requests, "post", _fake_post)

    audio, headers = backend_app._convert_tts_audio_with_llvc_runtime(
        audio_bytes=_tiny_wav_bytes(duration_frames=32000),
        engine="GEM",
        voice_id="v1",
        voice_name="Fenrir",
    )

    assert len(audio) > 100
    assert posted_presets == ["voice_transfer_hq_cpu", "tts_realtime"]
    assert headers.get("x-vf-post-tts-preset") == "tts_realtime"
    assert headers.get("x-vf-post-tts-preset-fallback-from") == "voice_transfer_hq_cpu"


def test_resolve_llvc_model_name_for_runtime_aliases_legacy_profile_ids(monkeypatch) -> None:
    monkeypatch.setattr(
        backend_app,
        "_llvc_runtime_model_snapshot",
        lambda force_refresh=False: ({"voice_transfer_hq_cpu"}, False),
    )

    assert backend_app._resolve_llvc_model_name_for_runtime("p17_india_boy") == "voice_transfer_hq_cpu"


def test_normalize_llvc_preset_preserves_cpu_hq_mode(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_LLVC_PRESET_DEFAULT", "voice_transfer_hq_cpu")

    assert backend_app._normalize_llvc_preset("voice_transfer_hq_cpu") == "voice_transfer_hq_cpu"
    assert backend_app._normalize_llvc_preset("cover_hq") == "voice_transfer_hq_cpu"
    assert backend_app._normalize_llvc_preset("live") == "tts_realtime"
    assert backend_app._normalize_llvc_preset("auto_cpu") == "auto_cpu"
    assert backend_app._normalize_llvc_preset("") == "voice_transfer_hq_cpu"


def test_resolve_post_tts_llvc_preset_prefers_hq_for_short_single_speaker(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_TTS_POST_LLVC_AUTO_HQ_MAX_MS", 8000)

    requested, selected, duration_ms = backend_app._resolve_post_tts_llvc_preset(
        "auto_cpu",
        audio_bytes=_tiny_wav_bytes(duration_frames=32000 * 2),
    )

    assert requested == "auto_cpu"
    assert selected == "voice_transfer_hq_cpu"
    assert duration_ms >= 2000


def test_resolve_post_tts_llvc_preset_prefers_realtime_for_live_or_long_audio(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_TTS_POST_LLVC_AUTO_HQ_MAX_MS", 8000)

    requested_live, selected_live, _ = backend_app._resolve_post_tts_llvc_preset(
        "auto_cpu",
        audio_bytes=_tiny_wav_bytes(duration_frames=32000),
        live_stream=True,
    )
    requested_long, selected_long, duration_ms = backend_app._resolve_post_tts_llvc_preset(
        "auto_cpu",
        audio_bytes=_tiny_wav_bytes(duration_frames=32000 * 10),
    )

    assert requested_live == "auto_cpu"
    assert selected_live == "tts_realtime"
    assert requested_long == "auto_cpu"
    assert selected_long == "tts_realtime"
    assert duration_ms >= 10_000


def test_convert_tts_audio_auto_preset_uses_realtime_for_live_stream(monkeypatch) -> None:
    class _FakeResponse:
        def __init__(self) -> None:
            self.ok = True
            self.content = _tiny_wav_bytes(duration_frames=640, sample_value=1500)
            self.status_code = 200
            self.text = ""
            self.headers = {
                "x-vf-voice-transfer-backend-mode": "w_okada_rvc_onnx",
                "x-vf-voice-transfer-preset": "tts_realtime",
            }

    posted_forms: list[dict[str, object]] = []

    def _fake_post(_url, *args, **kwargs):
        _ = args
        posted_forms.append(dict(kwargs.get("data") or {}))
        return _FakeResponse()

    monkeypatch.setattr(backend_app, "_TTS_LIVE_LLVC_SEMAPHORE", threading.Semaphore(8))
    monkeypatch.setattr(backend_app, "VF_TTS_POST_LLVC_PRESET", "auto_cpu")
    monkeypatch.setattr(backend_app, "VF_TTS_POST_LLVC_AUTO_HQ_MAX_MS", 8000)
    monkeypatch.setattr(backend_app, "VF_TTS_POST_LLVC_BACKEND_MODE", "onnx")
    monkeypatch.setattr(backend_app, "_resolve_mapped_model_name", lambda *args, **kwargs: ("p01_india_m_adult", "p01_india_m_adult"))
    monkeypatch.setattr(
        backend_app,
        "_resolve_mapped_profile",
        lambda *args, **kwargs: {"profileId": "p01_india_m_adult", "ageGroup": "adult", "gender": "male"},
    )
    monkeypatch.setattr(backend_app, "_post_tts_llvc_pitch_shift_for_profile", lambda *_args, **_kwargs: 0)
    monkeypatch.setattr(backend_app.requests, "post", _fake_post)

    audio, headers = backend_app._convert_tts_audio_with_llvc_runtime(
        audio_bytes=_tiny_wav_bytes(duration_frames=32000),
        engine="GEM",
        voice_id="v1",
        voice_name="Fenrir",
        live_stream=True,
    )

    assert len(audio) > 100
    assert posted_forms[0]["preset"] == "tts_realtime"
    assert headers.get("x-vf-post-tts-preset-requested") == "auto_cpu"
    assert headers.get("x-vf-post-tts-preset") == "tts_realtime"


def test_speaker_display_label_preserves_human_labels() -> None:
    assert backend_app._speaker_display_label("Speaker 1") == "Speaker 1"
    assert backend_app._speaker_display_label("speaker 2") == "Speaker 2"
    assert backend_app._speaker_display_label("SPEAKER_00") == "Speaker 1"
    assert backend_app._speaker_display_label("speaker-01") == "Speaker 2"


def test_build_preferred_voice_map_for_segments_matches_display_labels() -> None:
    resolved = backend_app._build_preferred_voice_map_for_segments(
        {
            " [Speaker 1] ": "voice_a",
            "**Speaker 2**": "voice_b",
            "default": "voice_default",
        },
        [
            {"speaker": "SPEAKER_00", "speaker_raw": "Speaker 1"},
            {"speaker": "SPEAKER_01", "speaker_raw": "Speaker 2"},
        ],
    )

    assert resolved == {
        "SPEAKER_00": "voice_a",
        "SPEAKER_01": "voice_b",
        "default": "voice_default",
    }
