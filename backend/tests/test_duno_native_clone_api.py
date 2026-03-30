from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import app as backend_app


client = TestClient(backend_app.app)


@pytest.fixture(autouse=True)
def _duno_clone_isolation(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_USER_ID_REQUIRED", False)
    monkeypatch.setattr(backend_app, "_firebase_ready", lambda: False)
    monkeypatch.setattr(backend_app, "_require_request_uid", lambda request: "test_uid")
    yield


def test_duno_native_clone_route_returns_reusable_voice(monkeypatch: pytest.MonkeyPatch) -> None:
    stored: list[dict[str, str]] = []
    synth_calls: list[dict[str, str]] = []

    monkeypatch.setattr(backend_app, "_duno_lookup_cached_voice_id", lambda **_kwargs: "")
    monkeypatch.setattr(
        backend_app,
        "_duno_store_cached_voice_id",
        lambda **kwargs: stored.append({"voice_id": str(kwargs.get("voice_id") or "")}),
    )
    monkeypatch.setattr(
        backend_app,
        "_duno_create_voice_via_runtime",
        lambda **_kwargs: "di_voice_123",
    )
    monkeypatch.setattr(
        backend_app.DUNO_MODAL_CLIENT,
        "synthesize",
        lambda **kwargs: (
            synth_calls.append({
                "voice_id": str(kwargs.get("voice_id") or ""),
                "text": str(kwargs.get("text") or ""),
                "model": str(kwargs.get("model") or ""),
            })
            or (b"RIFF", {"contentType": "audio/wav"})
        ),
    )

    response = client.post(
        "/voice-clone/duno/native",
        json={
            "referenceAudioBase64": "dGVzdA==",
            "referenceAudioName": "reference.wav",
            "referenceAudioUrl": "data:audio/wav;base64,dGVzdA==",
            "sourceVoiceId": "deepinfra_default",
            "sourceVoiceName": "Default DUNO",
            "sourceVoiceEngine": "DUNO",
            "speaker": "Narrator",
            "requestId": "req_duno_clone_001",
            "traceId": "req_duno_clone_001",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["engine"] == "DUNO"
    assert payload["voiceId"] == "di_voice_123"
    assert payload["cached"] is False
    assert payload["clonedVoice"]["id"] == "di_voice_123"
    assert payload["clonedVoice"]["engine"] == "DUNO"
    assert payload["clonedVoice"]["source"] == "duno_native"
    assert payload["clonedVoice"]["sourceVoiceEngine"] == "DUNO"
    assert payload["clonedVoice"]["previewUrl"].startswith("data:audio/wav;base64,")
    assert synth_calls == [
        {
            "voice_id": "di_voice_123",
            "text": "Hello, this is a preview of Default DUNO.",
            "model": backend_app.DUNO_DEFAULT_MODEL,
        }
    ]
    assert stored == [{"voice_id": "di_voice_123"}]


def test_duno_native_clone_route_accepts_large_reference_audio_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(backend_app, "_duno_lookup_cached_voice_id", lambda **_kwargs: "")
    monkeypatch.setattr(backend_app, "_duno_store_cached_voice_id", lambda **_kwargs: None)
    monkeypatch.setattr(backend_app, "_duno_create_voice_via_runtime", lambda **_kwargs: "di_voice_456")
    monkeypatch.setattr(
        backend_app.DUNO_MODAL_CLIENT,
        "synthesize",
        lambda **kwargs: (b"RIFF", {"contentType": "audio/wav"}),
    )

    large_reference_url = "data:audio/wav;base64," + ("A" * 6000)
    response = client.post(
        "/voice-clone/duno/native",
        json={
            "referenceAudioBase64": "dGVzdA==",
            "referenceAudioName": "reference.wav",
            "referenceAudioUrl": large_reference_url,
            "sourceVoiceId": "deepinfra_default",
            "sourceVoiceName": "Default DUNO",
            "sourceVoiceEngine": "DUNO",
            "speaker": "Narrator",
            "requestId": "req_duno_clone_large_url",
            "traceId": "req_duno_clone_large_url",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["voiceId"] == "di_voice_456"
    assert payload["clonedVoice"]["id"] == "di_voice_456"


def test_duno_native_clone_runtime_upload_uses_deepinfra_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(backend_app, "DUNO_RUNTIME_URL", "https://api.deepinfra.com/v1")
    monkeypatch.setattr(backend_app, "DUNO_RUNTIME_TOKEN", "test-runtime-token")

    captured: dict[str, object] = {}

    class _Response:
        ok = True

        def json(self) -> dict[str, object]:
            return {"voice_id": "di_voice_789"}

    def _fake_runtime_http_request(method: str, url: str, **kwargs):  # noqa: ANN001
        captured["method"] = method
        captured["url"] = url
        captured["headers"] = dict(kwargs.get("headers") or {})
        captured["data"] = dict(kwargs.get("data") or {})
        captured["files"] = dict(kwargs.get("files") or {})
        return _Response()

    monkeypatch.setattr(backend_app, "_runtime_http_request", _fake_runtime_http_request)

    voice_id = backend_app._duno_create_voice_via_runtime(
        model=backend_app.DUNO_DEFAULT_MODEL,
        speaker="Narrator",
        reference_audio_url="",
        reference_audio_name="reference.wav",
        reference_audio_base64="dGVzdA==",
        source_voice_id="deepinfra_default",
        source_voice_name="Default DUNO",
    )

    assert voice_id == "di_voice_789"
    assert str(captured.get("method") or "").upper() == "POST"
    assert str(captured.get("url") or "").startswith("https://api.deepinfra.com/v1/voices/add")
    headers = captured.get("headers") if isinstance(captured.get("headers"), dict) else {}
    assert "Authorization" in headers
    assert str(headers.get("Authorization") or "").startswith("Bearer ")
    assert str(headers.get("Accept") or "").startswith("application/json")


def test_duno_native_clone_route_rejects_non_duno_source_engine() -> None:
    response = client.post(
        "/voice-clone/duno/native",
        json={
            "referenceAudioBase64": "dGVzdA==",
            "referenceAudioName": "reference.wav",
            "referenceAudioUrl": "data:audio/wav;base64,dGVzdA==",
            "sourceVoiceId": "v1",
            "sourceVoiceName": "Fenrir",
            "sourceVoiceEngine": "VECTOR",
            "speaker": "Narrator",
        },
    )

    assert response.status_code == 400
    assert "only supports DUNO voices" in str(response.json().get("detail") or "")


def test_duno_status_marks_rejected_token_as_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(backend_app, "DUNO_RUNTIME_URL", "https://api.deepinfra.com/v1")
    monkeypatch.setattr(backend_app, "DUNO_RUNTIME_TOKEN", "reject-me")
    monkeypatch.setattr(
        backend_app,
        "_probe_runtime_capabilities",
        lambda _engine, timeout_sec=3.0: {"ready": True, "metadata": {"provider": "deepinfra"}},
    )
    monkeypatch.setattr(
        backend_app.DUNO_MODAL_CLIENT,
        "health",
        lambda: (_ for _ in ()).throw(RuntimeError("DUNO runtime 401: User is not authorized to access this resource")),
    )

    response = client.get("/tts/engines/status", params={"engine": "DUNO"})

    assert response.status_code == 200
    payload = response.json()
    engine = payload["engines"]["DUNO"]
    assert engine["state"] == "not_configured"
    assert engine["ready"] is False
    assert "rejected" in str(engine["detail"]).lower()
