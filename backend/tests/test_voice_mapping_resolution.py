from __future__ import annotations

import threading

import app as backend_app


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

    calls: list[str] = []

    def _fake_post(url, *args, **kwargs):
        calls.append(str(url))
        return _FakeResponse(b"RIFF" + b"\x00" * 640)

    monkeypatch.setattr(backend_app, "VF_LLVC_RUNTIME_URLS", ("http://127.0.0.1:7830", "http://127.0.0.1:7831"))
    monkeypatch.setattr(backend_app, "_LLVC_RUNTIME_POOL_CURSOR", 0)
    monkeypatch.setattr(backend_app, "_TTS_LIVE_LLVC_SEMAPHORE", threading.Semaphore(8))
    monkeypatch.setattr(backend_app, "_resolve_mapped_model_name", lambda *args, **kwargs: ("p01_india_m_adult", "p01_india_m_adult"))
    monkeypatch.setattr(
        backend_app,
        "_resolve_mapped_profile",
        lambda *args, **kwargs: {"profileId": "p01_india_m_adult", "ageGroup": "adult", "gender": "male"},
    )
    monkeypatch.setattr(backend_app, "_post_tts_llvc_pitch_shift_for_profile", lambda *_args, **_kwargs: 0)
    monkeypatch.setattr(backend_app.requests, "post", _fake_post)

    first_audio, first_headers = backend_app._convert_tts_audio_with_llvc_runtime(
        audio_bytes=b"RIFF" + b"\x00" * 640,
        engine="GEM",
        voice_id="v1",
        voice_name="Fenrir",
    )
    second_audio, second_headers = backend_app._convert_tts_audio_with_llvc_runtime(
        audio_bytes=b"RIFF" + b"\x00" * 640,
        engine="GEM",
        voice_id="v1",
        voice_name="Fenrir",
    )

    assert len(first_audio) > 100
    assert len(second_audio) > 100
    assert first_headers.get("x-vf-post-tts-llvc-endpoint") == "http://127.0.0.1:7830"
    assert second_headers.get("x-vf-post-tts-llvc-endpoint") == "http://127.0.0.1:7831"
    assert calls[0].startswith("http://127.0.0.1:7830/")
    assert calls[1].startswith("http://127.0.0.1:7831/")
