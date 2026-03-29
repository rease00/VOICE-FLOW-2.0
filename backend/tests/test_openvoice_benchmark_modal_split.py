from __future__ import annotations

import base64
import io
import json
import sys
import types
import wave
from pathlib import Path

import pytest
from fastapi import HTTPException

BACKEND_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = BACKEND_ROOT.parent
for candidate in (str(BACKEND_ROOT), str(WORKSPACE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

import backend.app as backend_app
from services.openvoice_modal import OpenVoiceBenchmarkRequest


def _build_wav_bytes(*, duration_sec: float = 0.25, sample_rate: int = 24_000) -> bytes:
    frame_count = max(1, int(duration_sec * sample_rate))
    pcm = b"\x00\x00" * frame_count
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm)
    return buffer.getvalue()


def test_openvoice_benchmark_uses_modal_duno_and_openvoice_vc(monkeypatch, tmp_path):
    tts_audio = _build_wav_bytes(duration_sec=0.25)
    vc_audio = _build_wav_bytes(duration_sec=0.25)

    class FakeDunoClient:
        def __init__(self) -> None:
            self.calls: list[dict[str, object]] = []

        def health(self) -> dict[str, object]:
            return {"ok": True, "state": "online", "detail": "duno ready", "device": "cpu", "warm": True}

        def capabilities(self) -> dict[str, object]:
            return {"ok": True, "engine": "DUNO"}

        def synthesize(self, **kwargs):
            self.calls.append(dict(kwargs))
            return tts_audio, {"provider": "duno-modal"}

    class FakeOpenVoiceClient:
        def __init__(self) -> None:
            self.calls: list[dict[str, object]] = []

        def health(self) -> dict[str, object]:
            return {"ok": True, "state": "online", "detail": "openvoice ready", "device": "cuda:0", "warm": True}

        def capabilities(self) -> dict[str, object]:
            return {"ok": True, "engine": "SEED_VC", "supportsVC": True}

        def vc(self, payload, *, timeout_sec=None):
            self.calls.append(dict(payload))
            audio_b64 = base64.b64encode(vc_audio).decode("ascii")
            return {
                "ok": True,
                "status": "completed",
                "requestId": str(payload.get("requestId") or "req"),
                "traceId": str(payload.get("traceId") or "trace"),
                "mode": "vc",
                "runKind": payload.get("runKind") or "warm",
                "language": payload.get("language") or "EN",
                "textChars": len(str(payload.get("text") or "")),
                "targetDurationSec": int(payload.get("durationSec") or 1),
                "timings": {
                    "loadMs": 12,
                    "ttsMs": 0,
                    "vcMs": 24,
                    "queueWaitMs": 0,
                    "firstAudioMs": 24,
                    "totalMs": 24,
                    "gpuSeconds": 0.024,
                },
                "cost": {
                    "gpuRatePerSecondUsd": 0.000222,
                    "costMultiplier": 1.0,
                    "gpuCostUsd": 0.000005,
                    "cpuCostUsd": 0.0,
                    "estimatedCostUsd": 0.000005,
                    "estimatedOneHourUsd": 0.0003,
                    "estimatedOneDayUsd": 0.0072,
                },
                "runtime": {
                    "device": "cuda:0",
                    "warmStartObserved": True,
                    "referenceCacheEntries": 2,
                    "sourceCacheEntries": 1,
                    "loadedLanguages": [],
                    "vcProvider": "seed-vc-gpu",
                },
                "artifact": {
                    "artifactId": "ov123",
                    "fileName": "ov123.wav",
                    "contentType": "audio/wav",
                    "downloadUrl": "/voice-lab/openvoice/artifacts/ov123?sig=test",
                    "sizeBytes": len(vc_audio),
                    "durationSec": 0.25,
                },
                "audioBase64": audio_b64,
                "notes": ["mock-vc"],
            }

    def _save_artifact(audio_bytes: bytes, artifact_id: str):
        return types.SimpleNamespace(
            artifact_id=artifact_id,
            file_name=f"{artifact_id}.wav",
            content_type="audio/wav",
            size_bytes=len(audio_bytes),
        )

    monkeypatch.setattr(backend_app, "_require_request_uid", lambda request: "test-uid")
    monkeypatch.setattr(backend_app, "_request_is_admin", lambda request, uid: True)
    monkeypatch.setattr(backend_app, "save_openvoice_artifact", _save_artifact)
    monkeypatch.setattr(backend_app, "build_openvoice_artifact_url", lambda artifact_id, **_: f"/artifacts/{artifact_id}")
    fake_openvoice_client = FakeOpenVoiceClient()
    monkeypatch.setattr(backend_app, "DUNO_MODAL_CLIENT", FakeDunoClient())
    monkeypatch.setattr(backend_app, "_resolve_openvoice_client", lambda provider=None: ("cloud_run", fake_openvoice_client))

    request = OpenVoiceBenchmarkRequest(
        mode="tts_then_vc",
        runKind="warm",
        durationSec=60,
        language="EN",
        text="Hello modal world.",
        referenceAudioBase64=base64.b64encode(tts_audio).decode("ascii"),
        referenceAudioName="reference.wav",
        sourceAudioBase64="",
        sourceAudioName="",
        speed=1.0,
        requestId="req-1",
        traceId="trace-1",
        costMultiplier=1.0,
    )

    result = backend_app._openvoice_benchmark_payload(request, request=types.SimpleNamespace())

    assert result["mode"] == "tts_then_vc"
    assert result["timings"]["ttsMs"] > 0
    assert result["timings"]["vcMs"] > 0
    assert result["timings"]["cpuSeconds"] > 0
    assert result["timings"]["gpuSeconds"] > 0
    assert result["cost"]["cpuRatePerSecondUsd"] > 0
    assert result["cost"]["gpuRatePerSecondUsd"] > 0
    assert result["cost"]["cpuCostUsd"] >= 0
    assert result["cost"]["gpuCostUsd"] > 0
    assert result["cost"]["estimatedCostUsd"] >= result["cost"]["gpuCostUsd"]
    assert result["cost"]["estimatedOneHourUsd"] > result["cost"]["estimatedCostUsd"]
    assert str(result["artifact"]["downloadUrl"]).startswith("/artifacts/")
    assert str(result["artifact"]["downloadUrl"]).endswith("_req-1")
    assert backend_app.DUNO_MODAL_CLIENT.calls[0]["text"] == "Hello modal world."
    assert fake_openvoice_client.calls[0]["sourceAudioBase64"] == base64.b64encode(tts_audio).decode("ascii")


def test_openvoice_benchmark_extracts_source_vocals_with_demucs_fast_cpu(monkeypatch, tmp_path):
    reference_audio = _build_wav_bytes(duration_sec=0.2)
    source_mix_audio = _build_wav_bytes(duration_sec=0.5)
    extracted_vocals_audio = _build_wav_bytes(duration_sec=0.4)
    vc_audio = _build_wav_bytes(duration_sec=0.3)

    speech_path = tmp_path / "speech.wav"
    speech_path.write_bytes(extracted_vocals_audio)
    background_path = tmp_path / "background.wav"
    background_path.write_bytes(_build_wav_bytes(duration_sec=0.4))
    separation_calls: list[dict[str, object]] = []

    class FakeOpenVoiceClient:
        def __init__(self) -> None:
            self.calls: list[dict[str, object]] = []

        def vc(self, payload, *, timeout_sec=None):
            self.calls.append(dict(payload))
            return {
                "ok": True,
                "status": "completed",
                "requestId": str(payload.get("requestId") or "req"),
                "traceId": str(payload.get("traceId") or "trace"),
                "mode": "vc",
                "runKind": payload.get("runKind") or "warm",
                "language": payload.get("language") or "EN",
                "timings": {"vcMs": 12, "gpuSeconds": 0.012},
                "runtime": {"device": "cuda:0", "vcProvider": "seed-vc-gpu"},
                "cost": {"gpuRatePerSecondUsd": 0.000222},
                "audioBase64": base64.b64encode(vc_audio).decode("ascii"),
                "notes": ["mock-vc"],
            }

    def _fake_ensure_source_separation(source_path, model_name, *, device_preference=None, trim_window_key=""):
        separation_calls.append(
            {
                "sourcePath": str(source_path),
                "model": str(model_name),
                "devicePreference": str(device_preference or ""),
                "trimWindowKey": str(trim_window_key or ""),
                "sourceExists": Path(source_path).exists(),
            }
        )
        return speech_path, background_path, "cache-fast-cpu"

    def _save_artifact(audio_bytes: bytes, artifact_id: str):
        return types.SimpleNamespace(
            artifact_id=artifact_id,
            file_name=f"{artifact_id}.wav",
            content_type="audio/wav",
            size_bytes=len(audio_bytes),
        )

    monkeypatch.setattr(backend_app, "_require_request_uid", lambda request: "test-uid")
    monkeypatch.setattr(backend_app, "_request_is_admin", lambda request, uid: True)
    monkeypatch.setattr(backend_app, "_ensure_source_separation", _fake_ensure_source_separation)
    monkeypatch.setattr(backend_app, "save_openvoice_artifact", _save_artifact)
    monkeypatch.setattr(backend_app, "build_openvoice_artifact_url", lambda artifact_id, **_: f"/artifacts/{artifact_id}")
    fake_openvoice_client = FakeOpenVoiceClient()
    monkeypatch.setattr(backend_app, "_resolve_openvoice_client", lambda provider=None: ("cloud_run", fake_openvoice_client))

    request = OpenVoiceBenchmarkRequest(
        mode="vc",
        runKind="warm",
        durationSec=20,
        language="EN",
        text="",
        referenceAudioBase64=base64.b64encode(reference_audio).decode("ascii"),
        referenceAudioName="reference.wav",
        sourceAudioBase64=base64.b64encode(source_mix_audio).decode("ascii"),
        sourceAudioName="target_mix.wav",
        extractSourceVocals=True,
        sourceSeparationModel="mdx_extra_q",
        sourceSeparationDevice="cpu_only",
        speed=1.0,
        requestId="req-separate-1",
        traceId="trace-separate-1",
        costMultiplier=1.0,
    )

    result = backend_app._openvoice_benchmark_payload(request, request=types.SimpleNamespace())

    assert separation_calls
    assert separation_calls[0]["sourceExists"] is True
    assert separation_calls[0]["model"] == "mdx_extra_q"
    assert separation_calls[0]["devicePreference"] == "cpu_only"
    assert separation_calls[0]["trimWindowKey"] == ""
    assert fake_openvoice_client.calls
    assert fake_openvoice_client.calls[0]["sourceAudioBase64"] == base64.b64encode(extracted_vocals_audio).decode("ascii")
    assert fake_openvoice_client.calls[0]["sourceAudioName"] == "target_mix_vocals.wav"
    assert "source_audio_vocals_extracted_demucs_cpu_fast" in (result.get("notes") or [])
    assert int((result.get("timings") or {}).get("sourceSeparationMs") or 0) > 0
    runtime_source_separation = (result.get("runtime") or {}).get("sourceSeparation") or {}
    assert runtime_source_separation.get("enabled") is True
    assert runtime_source_separation.get("model") == "mdx_extra_q"
    assert runtime_source_separation.get("device") == "cpu_only"
    assert runtime_source_separation.get("pipeline") == "demucs"


def test_voice_clone_alias_forces_vc_and_warm(monkeypatch):
    captured: dict[str, object] = {}

    def _fake_openvoice_payload(payload, request):
        captured["mode"] = payload.mode
        captured["runKind"] = payload.runKind
        captured["request"] = request
        return {"ok": True, "mode": payload.mode, "runKind": payload.runKind, "source": "seed-vc-vc"}

    monkeypatch.setattr(backend_app, "_openvoice_benchmark_payload", _fake_openvoice_payload)

    payload = OpenVoiceBenchmarkRequest(
        mode="tts_then_vc",
        runKind="cold",
        durationSec=15,
        language="EN",
        text="Alias route should delegate as VC.",
        referenceAudioBase64="ref-audio",
        referenceAudioName="reference.wav",
        sourceAudioBase64="source-audio",
        sourceAudioName="source.wav",
        speed=1.0,
        requestId="req-alias",
        traceId="trace-alias",
        costMultiplier=1.0,
    )

    response = backend_app.voice_clone_openvoice(payload, request=types.SimpleNamespace())
    body = response.body.decode("utf-8")

    assert '"mode":"vc"' in body
    assert '"runKind":"warm"' in body
    assert captured["mode"] == "vc"
    assert captured["runKind"] == "warm"


def test_voice_clone_openvoice_separate_returns_demucs_artifacts(monkeypatch, tmp_path):
    source_mix_audio = _build_wav_bytes(duration_sec=0.5)
    extracted_vocals_audio = _build_wav_bytes(duration_sec=0.4)
    extracted_background_audio = _build_wav_bytes(duration_sec=0.4)

    speech_path = tmp_path / "speech.wav"
    speech_path.write_bytes(extracted_vocals_audio)
    background_path = tmp_path / "background.wav"
    background_path.write_bytes(extracted_background_audio)
    separation_calls: list[dict[str, object]] = []

    def _fake_ensure_source_separation(source_path, model_name, *, device_preference=None, trim_window_key=""):
        separation_calls.append(
            {
                "sourcePath": str(source_path),
                "model": str(model_name),
                "devicePreference": str(device_preference or ""),
                "trimWindowKey": str(trim_window_key or ""),
                "sourceExists": Path(source_path).exists(),
            }
        )
        return speech_path, background_path, "cache-stems-1"

    def _save_artifact(audio_bytes: bytes, artifact_id: str):
        return types.SimpleNamespace(
            artifact_id=artifact_id,
            file_name=f"{artifact_id}.wav",
            content_type="audio/wav",
            size_bytes=len(audio_bytes),
        )

    monkeypatch.setattr(backend_app, "_require_request_uid", lambda request: "test-uid")
    monkeypatch.setattr(backend_app, "_ensure_source_separation", _fake_ensure_source_separation)
    monkeypatch.setattr(backend_app, "save_openvoice_artifact", _save_artifact)
    monkeypatch.setattr(backend_app, "build_openvoice_artifact_url", lambda artifact_id, **_: f"/artifacts/{artifact_id}")

    payload = backend_app.OpenVoiceStemSeparationRequest(
        sourceAudioBase64=base64.b64encode(source_mix_audio).decode("ascii"),
        sourceAudioName="mix.mp3",
        sourceSeparationModel="htdemucs_ft",
        sourceSeparationDevice="cpu_only",
        requestId="sep-1",
        traceId="trace-sep-1",
    )

    response = backend_app.voice_clone_openvoice_separate(payload, request=types.SimpleNamespace())
    assert response.status_code == 200
    result = json.loads(response.body.decode("utf-8"))

    assert result.get("ok") is True
    assert separation_calls
    assert separation_calls[0]["sourceExists"] is True
    assert separation_calls[0]["model"] == "htdemucs_ft"
    assert separation_calls[0]["devicePreference"] == "cpu_only"
    assert separation_calls[0]["trimWindowKey"] == ""
    assert str((result.get("vocalsArtifact") or {}).get("downloadUrl") or "").endswith("_sep-1_vocals")
    assert str((result.get("backgroundArtifact") or {}).get("downloadUrl") or "").endswith("_sep-1_background")
    runtime_source_separation = (result.get("runtime") or {}).get("sourceSeparation") or {}
    assert runtime_source_separation.get("enabled") is True
    assert runtime_source_separation.get("pipeline") == "demucs"


def test_voice_clone_openvoice_separate_rejects_oversized_source_payload(monkeypatch):
    monkeypatch.setattr(backend_app, "_require_request_uid", lambda request: "test-uid")
    monkeypatch.setattr("services.openvoice_modal.OPENVOICE_MAX_AUDIO_BYTES", 8)
    monkeypatch.setattr("services.openvoice_modal.OPENVOICE_MAX_AUDIO_BASE64_CHARS", 64)

    payload = backend_app.OpenVoiceStemSeparationRequest(
        sourceAudioBase64=base64.b64encode(b"0123456789").decode("ascii"),
        sourceAudioName="mix.wav",
        requestId="sep-too-large",
        traceId="trace-sep-too-large",
    )

    with pytest.raises(HTTPException) as excinfo:
        backend_app.voice_clone_openvoice_separate(payload, request=types.SimpleNamespace())

    assert excinfo.value.status_code == 413
    assert "Source audio payload exceeds the maximum allowed size." in str(excinfo.value.detail)


def test_voice_clone_openvoice_separate_applies_trim_server_side(monkeypatch, tmp_path):
    source_mix_audio = _build_wav_bytes(duration_sec=0.5)
    trimmed_source_audio = _build_wav_bytes(duration_sec=0.2)
    extracted_vocals_audio = _build_wav_bytes(duration_sec=0.3)
    extracted_background_audio = _build_wav_bytes(duration_sec=0.3)
    trim_calls: list[dict[str, object]] = []
    separation_calls: list[dict[str, object]] = []

    speech_path = tmp_path / "speech.wav"
    speech_path.write_bytes(extracted_vocals_audio)
    background_path = tmp_path / "background.wav"
    background_path.write_bytes(extracted_background_audio)

    def _fake_trim_media_to_clip_window(source_path, output_path, *, start_ms, end_ms):
        trim_calls.append(
            {
                "sourcePath": str(source_path),
                "outputPath": str(output_path),
                "startMs": int(start_ms),
                "endMs": int(end_ms),
            }
        )
        Path(output_path).write_bytes(trimmed_source_audio)
        return output_path

    def _fake_ensure_source_separation(source_path, model_name, *, device_preference=None, trim_window_key=""):
        separation_calls.append(
            {
                "sourcePath": str(source_path),
                "model": str(model_name),
                "devicePreference": str(device_preference or ""),
                "trimWindowKey": str(trim_window_key or ""),
                "sourceExists": Path(source_path).exists(),
            }
        )
        return speech_path, background_path, "cache-trimmed-1"

    def _save_artifact(audio_bytes: bytes, artifact_id: str):
        return types.SimpleNamespace(
            artifact_id=artifact_id,
            file_name=f"{artifact_id}.wav",
            content_type="audio/wav",
            size_bytes=len(audio_bytes),
        )

    monkeypatch.setattr(backend_app, "_require_request_uid", lambda request: "test-uid")
    monkeypatch.setattr(backend_app, "_trim_media_to_clip_window", _fake_trim_media_to_clip_window)
    monkeypatch.setattr(backend_app, "_ensure_source_separation", _fake_ensure_source_separation)
    monkeypatch.setattr(backend_app, "save_openvoice_artifact", _save_artifact)
    monkeypatch.setattr(backend_app, "build_openvoice_artifact_url", lambda artifact_id, **_: f"/artifacts/{artifact_id}")

    payload = backend_app.OpenVoiceStemSeparationRequest(
        sourceAudioBase64=base64.b64encode(source_mix_audio).decode("ascii"),
        sourceAudioName="mix.mp3",
        sourceSeparationModel="htdemucs_ft",
        sourceSeparationDevice="cpu_only",
        sourceTrimStartSec=1.5,
        sourceTrimEndSec=3.0,
        requestId="sep-trimmed",
        traceId="trace-trimmed",
    )

    response = backend_app.voice_clone_openvoice_separate(payload, request=types.SimpleNamespace())
    assert response.status_code == 200
    result = json.loads(response.body.decode("utf-8"))

    assert trim_calls
    assert trim_calls[0]["startMs"] == 1500
    assert trim_calls[0]["endMs"] == 3000
    assert separation_calls
    assert separation_calls[0]["sourcePath"].endswith("source_trimmed.mp3")
    assert separation_calls[0]["sourceExists"] is True
    assert separation_calls[0]["trimWindowKey"] == "1500:3000"
    runtime_source_separation = (result.get("runtime") or {}).get("sourceSeparation") or {}
    assert runtime_source_separation.get("trimApplied") is True
    assert runtime_source_separation.get("trimStartSec") == 1.5
    assert runtime_source_separation.get("trimEndSec") == 3.0
    assert runtime_source_separation.get("trimWindowKey") == "1500:3000"


def test_voice_clone_openvoice_separate_rejects_invalid_trim_window(monkeypatch):
    monkeypatch.setattr(backend_app, "_require_request_uid", lambda request: "test-uid")
    monkeypatch.setattr(backend_app, "build_openvoice_artifact_url", lambda artifact_id, **_: f"/artifacts/{artifact_id}")

    payload = backend_app.OpenVoiceStemSeparationRequest(
        sourceAudioBase64=base64.b64encode(b"RIFFsample").decode("ascii"),
        sourceAudioName="mix.wav",
        sourceTrimStartSec=2.0,
        sourceTrimEndSec=2.0,
        requestId="sep-invalid-trim",
        traceId="trace-invalid-trim",
    )

    with pytest.raises(HTTPException) as excinfo:
        backend_app.voice_clone_openvoice_separate(payload, request=types.SimpleNamespace())

    assert excinfo.value.status_code == 400
    assert "trim end must be greater" in str(excinfo.value.detail).lower()


def test_source_separation_cache_key_includes_trim_window(tmp_path):
    source_path = tmp_path / "source.mp3"
    source_path.write_bytes(b"source-bytes")

    base_key = backend_app._build_source_separation_cache_key(source_path, "htdemucs_ft", "cpu_only", "")
    trim_key_a = backend_app._build_source_separation_cache_key(source_path, "htdemucs_ft", "cpu_only", "1500:3000")
    trim_key_b = backend_app._build_source_separation_cache_key(source_path, "htdemucs_ft", "cpu_only", "3000:4500")

    assert trim_key_a != trim_key_b
    assert trim_key_a != base_key
    assert trim_key_b != base_key
