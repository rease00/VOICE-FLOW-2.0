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


@pytest.fixture(autouse=True)
def _voice_clone_admin_bypass(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(backend_app, "_request_is_admin", lambda request, uid=None: True)


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


def test_openvoice_benchmark_uses_cloud_tts_and_openvoice_vc(monkeypatch, tmp_path):
    tts_audio = _build_wav_bytes(duration_sec=0.25)
    vc_audio = _build_wav_bytes(duration_sec=0.25)

    tts_calls: list[dict[str, object]] = []

    def _fake_tts_synthesize(payload, text=None, lane_id=None):  # noqa: ANN001
        tts_calls.append({
            "payload": dict(payload or {}),
            "text": text,
            "laneId": lane_id,
        })
        return {"audioBytes": tts_audio, "mediaType": "audio/wav", "headers": {}}

    class FakeOpenVoiceClient:
        def __init__(self) -> None:
            self.calls: list[dict[str, object]] = []

        def health(self) -> dict[str, object]:
            return {"ok": True, "state": "online", "detail": "voice clone ready", "device": "cuda:0", "warm": True}

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
                    "downloadUrl": "/voice-lab/voice-clone/artifacts/ov123?sig=test",
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
    monkeypatch.setattr(backend_app, "_tts_v2_synthesize_chunk", _fake_tts_synthesize)
    fake_openvoice_client = FakeOpenVoiceClient()
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
    assert tts_calls[0]["payload"]["text"] == "Hello modal world."
    assert tts_calls[0]["payload"]["engine"] == "VECTOR"
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

    def _fake_charge(**kwargs):
        _ = kwargs
        return {
            "enabled": False,
            "reservedUnits": 0.0,
            "consumedUnits": 0.0,
            "chargedInr": 0.0,
            "rateInrPerMin": 1.2,
            "rateVcUnitsPerMin": 1.0,
            "durationSec": 0.0,
            "billableDurationSec": 0.0,
            "rule": "duration_minutes_x_vc_rate",
            "breakdown": {"vcFree": 0.0, "vcPaid": 0.0},
            "remaining": {"vcFreeBalance": 0.0, "vcPaidBalance": 0.0},
            "idempotentReuse": False,
        }

    def _fake_charge(**kwargs):
        _ = kwargs
        return {
            "enabled": False,
            "reservedUnits": 0.0,
            "consumedUnits": 0.0,
            "chargedInr": 0.0,
            "rateInrPerMin": 1.2,
            "rateVcUnitsPerMin": 1.0,
            "durationSec": 0.0,
            "billableDurationSec": 0.0,
            "rule": "duration_minutes_x_vc_rate",
            "breakdown": {"vcFree": 0.0, "vcPaid": 0.0},
            "remaining": {"vcFreeBalance": 0.0, "vcPaidBalance": 0.0},
            "idempotentReuse": False,
        }

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

    def _fake_openvoice_payload(payload, request, uid=None, is_admin=False):
        captured["mode"] = payload.mode
        captured["runKind"] = payload.runKind
        captured["request"] = request
        captured["uid"] = uid
        captured["isAdmin"] = is_admin
        return {"ok": True, "mode": payload.mode, "runKind": payload.runKind, "source": "seed-vc-vc"}

    monkeypatch.setattr(backend_app, "_openvoice_benchmark_payload", _fake_openvoice_payload)
    monkeypatch.setattr(backend_app, "_require_request_uid", lambda request: "test-uid")

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


def test_voice_clone_openvoice_route_reuses_idempotent_response(monkeypatch):
    backend_app._INMEMORY_REQUEST_IDEMPOTENCY.clear()
    calls: list[dict[str, object]] = []

    def _fake_openvoice_payload(payload, request=None, uid="", is_admin=False):
        _ = request
        calls.append({"requestId": payload.requestId, "uid": uid, "isAdmin": is_admin})
        return {"ok": True, "requestId": payload.requestId, "traceId": payload.traceId, "status": "completed"}

    monkeypatch.setattr(backend_app, "_require_request_uid", lambda _request: "test-uid")
    monkeypatch.setattr(backend_app, "_openvoice_benchmark_payload", _fake_openvoice_payload)

    payload = OpenVoiceBenchmarkRequest(
        mode="vc",
        runKind="warm",
        durationSec=15,
        language="EN",
        text="idempotent voice clone",
        referenceAudioBase64="ref-audio",
        sourceAudioBase64="source-audio",
        requestId="req-openvoice-idem-1",
        traceId="trace-openvoice-idem-1",
    )
    request = types.SimpleNamespace(
        headers={"Idempotency-Key": "openvoice-idem-1"},
        url=types.SimpleNamespace(path="/voice-clone/openvoice"),
    )

    first = backend_app.voice_clone_render(payload, request=request)
    second = backend_app.voice_clone_render(payload, request=request)
    first_body = json.loads(first.body.decode("utf-8"))
    second_body = json.loads(second.body.decode("utf-8"))

    assert len(calls) == 1
    assert first_body.get("requestId") == "req-openvoice-idem-1"
    assert second_body == first_body


def test_voice_clone_openvoice_separate_reuses_idempotent_response(monkeypatch, tmp_path):
    backend_app._INMEMORY_REQUEST_IDEMPOTENCY.clear()
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
            }
        )
        return speech_path, background_path, "cache-stems-idem-1"

    def _save_artifact(audio_bytes: bytes, artifact_id: str):
        return types.SimpleNamespace(
            artifact_id=artifact_id,
            file_name=f"{artifact_id}.wav",
            content_type="audio/wav",
            size_bytes=len(audio_bytes),
        )

    def _fake_charge(**kwargs):
        _ = kwargs
        return {
            "enabled": False,
            "reservedUnits": 0.0,
            "consumedUnits": 0.0,
            "chargedInr": 0.0,
            "rateInrPerMin": 1.2,
            "rateVcUnitsPerMin": 1.0,
            "durationSec": 0.0,
            "billableDurationSec": 0.0,
            "rule": "duration_minutes_x_vc_rate",
            "breakdown": {"vcFree": 0.0, "vcPaid": 0.0},
            "remaining": {"vcFreeBalance": 0.0, "vcPaidBalance": 0.0},
            "idempotentReuse": False,
        }

    monkeypatch.setattr(backend_app, "_require_request_uid", lambda _request: "test-uid")
    monkeypatch.setattr(backend_app, "_ensure_source_separation", _fake_ensure_source_separation)
    monkeypatch.setattr(backend_app, "_charge_voice_clone_separation_vc", _fake_charge)
    monkeypatch.setattr(backend_app, "save_openvoice_artifact", _save_artifact)
    monkeypatch.setattr(backend_app, "build_openvoice_artifact_url", lambda artifact_id, **_: f"/artifacts/{artifact_id}")

    source_b64 = base64.b64encode(source_mix_audio).decode("ascii")
    payload = backend_app.OpenVoiceStemSeparationRequest(
        sourceAudioBase64=source_b64,
        sourceAudioName="source.wav",
        requestId="sep-idem-1",
        traceId="sep-idem-1",
    )
    request = types.SimpleNamespace(
        headers={"Idempotency-Key": "openvoice-separate-idem-1"},
        url=types.SimpleNamespace(path="/voice-clone/openvoice/separate"),
    )

    first = backend_app.voice_clone_separate(payload, request=request)
    second = backend_app.voice_clone_separate(payload, request=request)
    first_body = json.loads(first.body.decode("utf-8"))
    second_body = json.loads(second.body.decode("utf-8"))

    assert len(separation_calls) == 1
    assert first_body.get("requestId") == "sep-idem-1"
    assert second_body == first_body


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

    def _fake_charge(**kwargs):
        _ = kwargs
        return {
            "enabled": False,
            "reservedUnits": 0.0,
            "consumedUnits": 0.0,
            "chargedInr": 0.0,
            "rateInrPerMin": 1.2,
            "rateVcUnitsPerMin": 1.0,
            "durationSec": 0.4,
            "billableDurationSec": 0.4,
            "rule": "duration_minutes_x_vc_rate",
            "breakdown": {"vcFree": 0.0, "vcPaid": 0.0},
            "remaining": {"vcFreeBalance": 0.0, "vcPaidBalance": 0.0},
            "idempotentReuse": False,
        }

    def _save_artifact(audio_bytes: bytes, artifact_id: str):
        return types.SimpleNamespace(
            artifact_id=artifact_id,
            file_name=f"{artifact_id}.wav",
            content_type="audio/wav",
            size_bytes=len(audio_bytes),
        )

    def _fake_charge(**kwargs):
        _ = kwargs
        return {
            "enabled": False,
            "reservedUnits": 0.0,
            "consumedUnits": 0.0,
            "chargedInr": 0.0,
            "rateInrPerMin": 1.2,
            "rateVcUnitsPerMin": 1.0,
            "durationSec": 0.0,
            "billableDurationSec": 0.0,
            "rule": "duration_minutes_x_vc_rate",
            "breakdown": {"vcFree": 0.0, "vcPaid": 0.0},
            "remaining": {"vcFreeBalance": 0.0, "vcPaidBalance": 0.0},
            "idempotentReuse": False,
        }

    monkeypatch.setattr(backend_app, "_require_request_uid", lambda request: "test-uid")
    monkeypatch.setattr(backend_app, "_ensure_source_separation", _fake_ensure_source_separation)
    monkeypatch.setattr(backend_app, "_charge_voice_clone_separation_vc", _fake_charge)
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


def test_voice_clone_openvoice_separate_prefers_modal_runtime_and_reports_vc_billing(monkeypatch):
    source_mix_audio = _build_wav_bytes(duration_sec=0.5)
    extracted_vocals_audio = _build_wav_bytes(duration_sec=0.4)
    extracted_background_audio = _build_wav_bytes(duration_sec=0.4)
    modal_calls: list[dict[str, object]] = []

    def _fake_modal_separation(**kwargs):
        modal_calls.append(dict(kwargs))
        return (
            extracted_vocals_audio,
            extracted_background_audio,
            {
                "enabled": True,
                "pipeline": "demucs",
                "model": "htdemucs_ft",
                "device": "cpu_only",
                "cacheKey": "modal-cache-key",
                "timeoutSec": 45,
                "trimApplied": False,
                "durationSec": 0.4,
                "provider": "modal",
                "providerLabel": "modal-runtime",
            },
            123,
            ["source_audio_vocals_extracted_demucs_modal"],
        )

    def _unexpected_local(*args, **kwargs):
        raise AssertionError("Local demucs fallback should not run when modal separation succeeds.")

    def _fake_charge(**kwargs):
        _ = kwargs
        return {
            "enabled": True,
            "reservedUnits": 0.4,
            "consumedUnits": 0.4,
            "chargedInr": 0.48,
            "rateInrPerMin": 1.2,
            "rateVcUnitsPerMin": 1.0,
            "durationSec": 0.4,
            "billableDurationSec": 0.4,
            "rule": "duration_minutes_x_vc_rate",
            "breakdown": {"vcFree": 0.4, "vcPaid": 0.0},
            "remaining": {"vcFreeBalance": 9.6, "vcPaidBalance": 5.0},
            "idempotentReuse": False,
            "transactionId": "tx_modal_sep_1",
        }

    def _save_artifact(audio_bytes: bytes, artifact_id: str):
        return types.SimpleNamespace(
            artifact_id=artifact_id,
            file_name=f"{artifact_id}.wav",
            content_type="audio/wav",
            size_bytes=len(audio_bytes),
        )

    monkeypatch.setattr(backend_app, "_require_request_uid", lambda request: "test-uid")
    monkeypatch.setattr(backend_app, "VF_VOICE_CLONE_SEPARATION_MODAL_ENABLED", True)
    monkeypatch.setattr(backend_app, "_voice_clone_separation_modal_client", lambda: object())
    monkeypatch.setattr(backend_app, "_run_modal_source_separation", _fake_modal_separation)
    monkeypatch.setattr(backend_app, "_ensure_source_separation", _unexpected_local)
    monkeypatch.setattr(backend_app, "_charge_voice_clone_separation_vc", _fake_charge)
    monkeypatch.setattr(backend_app, "save_openvoice_artifact", _save_artifact)
    monkeypatch.setattr(backend_app, "build_openvoice_artifact_url", lambda artifact_id, **_: f"/artifacts/{artifact_id}")

    payload = backend_app.OpenVoiceStemSeparationRequest(
        sourceAudioBase64=base64.b64encode(source_mix_audio).decode("ascii"),
        sourceAudioName="mix.mp3",
        sourceSeparationModel="htdemucs_ft",
        sourceSeparationDevice="cpu_only",
        requestId="sep-modal-1",
        traceId="trace-modal-1",
    )

    response = backend_app.voice_clone_openvoice_separate(payload, request=types.SimpleNamespace())
    assert response.status_code == 200
    result = json.loads(response.body.decode("utf-8"))

    assert modal_calls
    assert result.get("ok") is True
    assert (result.get("runtime") or {}).get("sourceSeparation", {}).get("provider") == "modal"
    assert float(result.get("consumedVcUnits") or 0.0) == pytest.approx(0.4)
    assert float(((result.get("vcBilling") or {}).get("chargedInr") or 0.0)) == pytest.approx(0.48)
    assert "source_audio_vocals_extracted_demucs_modal" in (result.get("notes") or [])


def test_voice_clone_openvoice_separate_falls_back_to_local_when_modal_errors(monkeypatch, tmp_path):
    source_mix_audio = _build_wav_bytes(duration_sec=0.5)
    extracted_vocals_audio = _build_wav_bytes(duration_sec=0.4)
    extracted_background_audio = _build_wav_bytes(duration_sec=0.4)
    local_calls: list[dict[str, object]] = []

    speech_path = tmp_path / "speech.wav"
    speech_path.write_bytes(extracted_vocals_audio)
    background_path = tmp_path / "background.wav"
    background_path.write_bytes(extracted_background_audio)

    def _failing_modal(**kwargs):
        _ = kwargs
        raise RuntimeError("modal separation unavailable")

    def _fake_local(source_path, model_name, *, device_preference=None, trim_window_key=""):
        local_calls.append(
            {
                "sourcePath": str(source_path),
                "model": str(model_name),
                "devicePreference": str(device_preference or ""),
                "trimWindowKey": str(trim_window_key or ""),
                "sourceExists": Path(source_path).exists(),
            }
        )
        return speech_path, background_path, "cache-local-fallback"

    def _fake_charge(**kwargs):
        _ = kwargs
        return {
            "enabled": False,
            "reservedUnits": 0.0,
            "consumedUnits": 0.0,
            "chargedInr": 0.0,
            "rateInrPerMin": 1.2,
            "rateVcUnitsPerMin": 1.0,
            "durationSec": 0.4,
            "billableDurationSec": 0.4,
            "rule": "duration_minutes_x_vc_rate",
            "breakdown": {"vcFree": 0.0, "vcPaid": 0.0},
            "remaining": {"vcFreeBalance": 0.0, "vcPaidBalance": 0.0},
            "idempotentReuse": False,
        }

    def _save_artifact(audio_bytes: bytes, artifact_id: str):
        return types.SimpleNamespace(
            artifact_id=artifact_id,
            file_name=f"{artifact_id}.wav",
            content_type="audio/wav",
            size_bytes=len(audio_bytes),
        )

    monkeypatch.setattr(backend_app, "_require_request_uid", lambda request: "test-uid")
    monkeypatch.setattr(backend_app, "VF_VOICE_CLONE_SEPARATION_MODAL_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_VOICE_CLONE_SEPARATION_MODAL_ALLOW_LOCAL_FALLBACK", True)
    monkeypatch.setattr(backend_app, "_voice_clone_separation_modal_client", lambda: object())
    monkeypatch.setattr(backend_app, "_run_modal_source_separation", _failing_modal)
    monkeypatch.setattr(backend_app, "_ensure_source_separation", _fake_local)
    monkeypatch.setattr(backend_app, "_charge_voice_clone_separation_vc", _fake_charge)
    monkeypatch.setattr(backend_app, "save_openvoice_artifact", _save_artifact)
    monkeypatch.setattr(backend_app, "build_openvoice_artifact_url", lambda artifact_id, **_: f"/artifacts/{artifact_id}")

    payload = backend_app.OpenVoiceStemSeparationRequest(
        sourceAudioBase64=base64.b64encode(source_mix_audio).decode("ascii"),
        sourceAudioName="mix.mp3",
        sourceSeparationModel="htdemucs_ft",
        sourceSeparationDevice="cpu_only",
        requestId="sep-local-fallback",
        traceId="trace-local-fallback",
    )

    response = backend_app.voice_clone_openvoice_separate(payload, request=types.SimpleNamespace())
    assert response.status_code == 200
    result = json.loads(response.body.decode("utf-8"))

    assert local_calls
    assert local_calls[0]["sourceExists"] is True
    assert (result.get("runtime") or {}).get("sourceSeparation", {}).get("provider") == "local"
    assert "source_audio_vocals_extracted_demucs_modal_fallback_local" in (result.get("notes") or [])
    assert float(result.get("consumedVcUnits") or 0.0) == 0.0


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

    def _fake_charge(**kwargs):
        _ = kwargs
        return {
            "enabled": False,
            "reservedUnits": 0.0,
            "consumedUnits": 0.0,
            "chargedInr": 0.0,
            "rateInrPerMin": 1.2,
            "rateVcUnitsPerMin": 1.0,
            "durationSec": 0.3,
            "billableDurationSec": 0.3,
            "rule": "duration_minutes_x_vc_rate",
            "breakdown": {"vcFree": 0.0, "vcPaid": 0.0},
            "remaining": {"vcFreeBalance": 0.0, "vcPaidBalance": 0.0},
            "idempotentReuse": False,
        }

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
    monkeypatch.setattr(backend_app, "_charge_voice_clone_separation_vc", _fake_charge)
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


def test_voice_clone_separation_vc_billing_quote_uses_per_minute_rates(monkeypatch):
    monkeypatch.setattr(backend_app, "VF_VOICE_CLONE_SEPARATION_BILLING_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_VOICE_CLONE_SEPARATION_INR_PER_MIN", 1.2)
    monkeypatch.setattr(backend_app, "VF_VOICE_CLONE_SEPARATION_VC_UNITS_PER_MIN", 1.0)
    monkeypatch.setattr(backend_app, "VF_VOICE_CLONE_SEPARATION_BILLING_MIN_SECONDS", 0.0)

    quote = backend_app._voice_clone_separation_vc_billing_quote(90.0)

    assert quote["enabled"] is True
    assert float(quote["consumedUnits"]) == pytest.approx(1.5)
    assert float(quote["chargedInr"]) == pytest.approx(1.8)
    assert float(quote["billableDurationSec"]) == pytest.approx(90.0)
