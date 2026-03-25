from __future__ import annotations

import base64
import io
import sys
import types
import wave
from pathlib import Path

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


def test_openvoice_benchmark_uses_modal_kokoro_and_openvoice_vc(monkeypatch, tmp_path):
    tts_audio = _build_wav_bytes(duration_sec=0.25)
    vc_audio = _build_wav_bytes(duration_sec=0.25)

    class FakeKokoroClient:
        def __init__(self) -> None:
            self.calls: list[dict[str, object]] = []

        def health(self) -> dict[str, object]:
            return {"ok": True, "state": "online", "detail": "kokoro ready", "device": "cpu", "warm": True}

        def capabilities(self) -> dict[str, object]:
            return {"ok": True, "engine": "KOKORO"}

        def synthesize(self, **kwargs):
            self.calls.append(dict(kwargs))
            return tts_audio, {"provider": "kokoro-modal"}

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
    monkeypatch.setattr(backend_app, "save_openvoice_artifact", _save_artifact)
    monkeypatch.setattr(backend_app, "build_openvoice_artifact_url", lambda artifact_id, **_: f"/artifacts/{artifact_id}")
    monkeypatch.setattr(backend_app, "KOKORO_MODAL_CLIENT", FakeKokoroClient())
    monkeypatch.setattr(backend_app, "OPENVOICE_MODAL_CLIENT", FakeOpenVoiceClient())

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
    assert backend_app.KOKORO_MODAL_CLIENT.calls[0]["text"] == "Hello modal world."
    assert backend_app.OPENVOICE_MODAL_CLIENT.calls[0]["sourceAudioBase64"] == base64.b64encode(tts_audio).decode("ascii")


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
