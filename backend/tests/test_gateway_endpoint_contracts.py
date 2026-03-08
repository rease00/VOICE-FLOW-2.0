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


def test_frontend_gateway_routes_are_registered() -> None:
    expected = {
        ("GET", "/health"),
        ("GET", "/system/version"),
        ("GET", "/tts/engines/status"),
        ("GET", "/tts/engines/capabilities"),
        ("POST", "/tts/engines/switch"),
        ("GET", "/tts/engines/voices"),
        ("GET", "/tts/voice-mapping/catalog"),
        ("GET", "/runtime/logs/tail"),
        ("POST", "/audio/extract-from-video"),
        ("POST", "/video/transcribe"),
        ("POST", "/video/separate-stem"),
        ("POST", "/video/mux-dub"),
        ("POST", "/tts/jobs"),
        ("GET", "/tts/jobs/{job_id}"),
        ("GET", "/tts/jobs/{job_id}/chunks/{chunk_index}"),
        ("DELETE", "/tts/jobs/{job_id}"),
        ("POST", "/dubbing/jobs/v2"),
        ("GET", "/dubbing/jobs/{job_id}"),
        ("GET", "/dubbing/jobs/{job_id}/chunks/{chunk_index}"),
        ("POST", "/dubbing/jobs/{job_id}/cancel"),
        ("GET", "/dubbing/jobs/{job_id}/report"),
        ("GET", "/dubbing/jobs/{job_id}/result"),
        ("GET", "/voice-transfer/models"),
        ("POST", "/voice-transfer/load-model"),
        ("POST", "/voice-transfer/convert"),
    }

    registered: set[tuple[str, str]] = set()
    for route in backend_app.app.routes:
        methods = set(getattr(route, "methods", set()) or set())
        path = str(getattr(route, "path", "") or "")
        if not path:
            continue
        for method in methods:
            token = str(method or "").upper()
            if token in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
                registered.add((token, path))

    missing = sorted(expected - registered)
    assert not missing, f"Missing frontend gateway route bindings: {missing}"


def test_tts_engines_status_reports_not_configured_when_gemini_keys_missing(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "_probe_runtime_health", lambda _url, timeout_sec=3.0: (True, "online"))
    monkeypatch.setattr(
        backend_app,
        "_probe_runtime_capabilities",
        lambda _engine, timeout_sec=3.0: {
            "ready": True,
            "metadata": {
                "authMode": "gemini_api",
                "apiKeyConfigured": False,
            },
        },
    )

    response = client.get("/tts/engines/status", params={"engine": "GEM"})
    assert response.status_code == 200
    payload = response.json()
    engine = payload["engines"]["GEM"]
    assert engine["state"] == "not_configured"
    assert engine["ready"] is False
    assert "key pool" in str(engine["detail"]).lower()


def test_probe_runtime_health_treats_explicit_unhealthy_payload_as_offline(monkeypatch) -> None:
    class _FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return b'{"ok": false, "error": "runtime_not_ready"}'

    monkeypatch.setattr(backend_app.urllib_request, "urlopen", lambda *_args, **_kwargs: _FakeResponse())
    online, detail = backend_app._probe_runtime_health("http://127.0.0.1:9999/health")
    assert online is False
    assert "runtime_not_ready" in str(detail)


def test_tts_engines_voices_contract_gem_fallback() -> None:
    response = client.get("/tts/engines/voices", params={"engine": "GEM"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["engine"] == "GEM"
    assert isinstance(payload["voices"], list)
    assert payload["voices"]
    assert "voice_id" in payload["voices"][0]
    assert payload["voices"][0].get("access_tier") in {"free", "pro"}
    assert isinstance(payload["voices"][0].get("is_plan_restricted"), bool)


def test_tts_engines_voices_contract_kokoro_access_tiers(monkeypatch) -> None:
    class _FakeResponse:
        def __init__(self) -> None:
            self.ok = True

        def json(self):
            return {
                "voices": [
                    {"voice_id": "af_heart", "name": "Free Voice", "language": "en", "gender": "female"},
                    {"voice_id": "hf_beta", "name": "Hindi Voice", "language": "hi", "gender": "female"},
                ]
            }

    monkeypatch.setattr(backend_app, "_runtime_http_request", lambda *args, **kwargs: _FakeResponse())
    response = client.get("/tts/engines/voices", params={"engine": "KOKORO"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["engine"] == "KOKORO"
    assert isinstance(payload["voices"], list)
    assert payload["voices"]
    by_id = {str(item.get("voice_id") or ""): item for item in payload["voices"]}
    assert by_id["af_heart"]["access_tier"] == "free"
    assert by_id["af_heart"]["is_plan_restricted"] is False
    assert by_id["hf_beta"]["access_tier"] == "free"
    assert by_id["hf_beta"]["is_plan_restricted"] is False


def test_tts_engines_voices_contract_kokoro_preserves_runtime_identity(monkeypatch) -> None:
    class _FakeResponse:
        def __init__(self) -> None:
            self.ok = True

        def json(self):
            return {
                "voices": [
                    {
                        "voice_id": "af_heart",
                        "voice": "af_heart",
                        "name": "Lyra US",
                        "language": "en",
                        "accent": "American English",
                        "gender": "female",
                    }
                ]
            }

    monkeypatch.setattr(backend_app, "_runtime_http_request", lambda *args, **kwargs: _FakeResponse())
    response = client.get("/tts/engines/voices", params={"engine": "KOKORO"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    voice = payload["voices"][0]
    assert voice["voice_id"] == "af_heart"
    assert voice["name"] == "Lyra US"
    assert voice["voice"] == "af_heart"
    assert voice["accent"] == "American English"
    assert "mapped_name" not in voice
    assert "country" not in voice
    assert "age_group" not in voice


def test_tts_voice_mapping_catalog_contract() -> None:
    response = client.get("/tts/voice-mapping/catalog")
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert isinstance(payload.get("profiles"), list)
    assert isinstance(payload.get("engines"), dict)
    assert "fetchedAt" in payload


def test_build_tts_upstream_payload_preserves_explicit_model_fields(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "_load_gemini_api_pools", lambda: ({"planPools": {"free": "free"}}, None))
    payload = backend_app.TtsSynthesizeRequest(
        engine="GEM",
        text="A: hello\nB: hi",
        model="gemini-2.5-flash-preview-tts",
        modelCandidates=["gemini-2.5-flash-preview-tts", "gemini-2.5-flash-lite-preview-tts"],
        voiceName="Fenrir",
        speaker_voices=[
            {"speaker": "A", "voiceName": "Fenrir"},
            {"speaker": "B", "voiceName": "Kore"},
        ],
        multi_speaker_mode="studio_pair_groups",
        multi_speaker_line_map=[
            {"lineIndex": 0, "speaker": "A", "text": "hello"},
            {"lineIndex": 1, "speaker": "B", "text": "hi"},
        ],
    )

    upstream_payload, voice_id = backend_app._build_tts_upstream_payload(
        payload,
        engine="GEM",
        text=payload.text,
        request_id="req_test",
        trace_id="trace_test",
        plan_key="free",
    )

    assert voice_id == "Fenrir"
    assert upstream_payload["model"] == "gemini-2.5-flash-preview-tts"
    assert upstream_payload["modelCandidates"] == [
        "gemini-2.5-flash-preview-tts",
        "gemini-2.5-flash-lite-preview-tts",
    ]
    assert upstream_payload["multi_speaker_mode"] == "studio_pair_groups"
    assert upstream_payload["poolHint"] == "free"


def test_video_separate_stem_contract(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "ENABLE_SOURCE_SEPARATION", True)
    from video_dubbing.pipeline import phase1_acoustic_isolation

    def fake_phase1_run(ctx: dict, _cfg, _log):
        speech = tmp_path / "speech.wav"
        background = tmp_path / "background.wav"
        speech.write_bytes(b"RIFF\x00\x00\x00\x00WAVE")
        background.write_bytes(b"RIFF\x00\x00\x00\x00WAVE")
        ctx["vocals_dry"] = str(speech)
        ctx["music_effects"] = str(background)
        return ctx

    monkeypatch.setattr(phase1_acoustic_isolation, "run", fake_phase1_run)

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
    assert payload["speakerCount"] == 1
    assert payload["speakers"][0]["label"] == "Speaker 1"
    assert isinstance(payload.get("director"), dict)
    assert payload["director"].get("modelPreferred") == backend_app.VF_DUB_DIRECTOR_MODEL


def test_video_transcribe_returns_speaker_summary_from_phase2_merge(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "ENABLE_TRANSCRIBE_EMOTION_CAPTURE", False)

    def fake_convert_media_to_wav(_src: str, dst: str, sample_rate: int = 16000, channels: int = 1):
        Path(dst).write_bytes(b"RIFF\x00\x00\x00\x00WAVE")

    def fake_transcribe_with_whisper(_asr_path: Path, language: str, task: str, return_words: bool):
        return {
            "language": "en",
            "segments": [
                {"id": 0, "start": 0.0, "end": 1.0, "text": "Hello there", "speaker": "Speaker"},
                {"id": 1, "start": 1.1, "end": 2.0, "text": "General Kenobi", "speaker": "Speaker"},
            ],
        }

    monkeypatch.setattr(backend_app, "_convert_media_to_wav", fake_convert_media_to_wav)
    monkeypatch.setattr(backend_app, "_transcribe_with_whisper", fake_transcribe_with_whisper)
    monkeypatch.setattr(backend_app, "_wav_duration_seconds", lambda _path: 2.0)

    from video_dubbing import config as dubbing_config
    from video_dubbing.pipeline import phase2_director_multimodal as phase2

    class _FakeConfig:
        director_model = "gemini-2.5-flash"

    monkeypatch.setattr(dubbing_config, "build_config", lambda *_args, **_kwargs: _FakeConfig())
    monkeypatch.setattr(phase2, "_run_diarization", lambda *_args, **_kwargs: [(0.0, 1.0, "speaker_00"), (1.0, 2.0, "speaker_01")])

    def fake_apply_diarization_labels(segments, _turns):
        segments[0]["speaker_diarized"] = "speaker_00"
        segments[0]["speaker_diarization_confidence"] = 0.98
        segments[1]["speaker_diarized"] = "speaker_01"
        segments[1]["speaker_diarization_confidence"] = 0.98

    def fake_merge_speaker_labels(segments, _policy, _max_speaker_count):
        segments[0]["speaker"] = "SPEAKER_00"
        segments[0]["speaker_raw"] = "speaker_00"
        segments[0]["speaker_source"] = "diarization"
        segments[0]["speaker_confidence"] = 0.98
        segments[1]["speaker"] = "SPEAKER_01"
        segments[1]["speaker_raw"] = "speaker_01"
        segments[1]["speaker_source"] = "diarization"
        segments[1]["speaker_confidence"] = 0.98

    monkeypatch.setattr(phase2, "_apply_diarization_labels", fake_apply_diarization_labels)
    monkeypatch.setattr(phase2, "_merge_speaker_labels", fake_merge_speaker_labels)
    monkeypatch.setattr(phase2, "_infer_affective_tags", lambda _text: ["neutral"])
    monkeypatch.setattr(phase2, "_refine_director_with_gemini", lambda **_kwargs: None)
    monkeypatch.setattr(phase2, "_scene_complexity", lambda _segments, speaker_count: "medium" if speaker_count > 1 else "low")

    response = client.post(
        "/video/transcribe",
        files={"file": ("clip.wav", b"abc", "audio/wav")},
        data={"language": "auto", "task": "transcribe", "return_words": "true"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["speakerCount"] == 2
    assert [item["label"] for item in payload["speakers"]] == ["Speaker 1", "Speaker 2"]
    assert payload["director"]["speakerCount"] == 2
    assert payload["director"]["sceneComplexity"] == "medium"


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
