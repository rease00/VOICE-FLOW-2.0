from __future__ import annotations

import base64
import io
import sys
import time
import wave
from pathlib import Path

from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = BACKEND_ROOT.parent
for candidate in (str(BACKEND_ROOT), str(WORKSPACE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

import backend.app as backend_app


def _make_test_wav(duration_ms: int = 450, sample_rate: int = 24000) -> bytes:
    frame_count = max(1, int(sample_rate * (duration_ms / 1000.0)))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(b"\x00\x00" * frame_count)
    return buffer.getvalue()


def _make_png_bytes() -> bytes:
    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+Xx1bAAAAAElFTkSuQmCC"
    )


def _stub_reader_vector_tts(monkeypatch) -> None:
    monkeypatch.setattr(
        backend_app,
        "_reader_create_tts_job_with_audio_engine_fallback",
        lambda request, *, session, text, request_id, voice_id, language, multi_speaker_mode=None, line_map=None, speaker_voices=None: (
            {**dict(session), "audioEngine": "tts_hd", "audioEngineStatus": "active"},
            f"reader_job_{request_id}",
            "tts_hd",
        ),
    )
    monkeypatch.setattr(
        backend_app,
        "_reader_job_status_summary",
        lambda uid, job_id: {
            "jobId": str(job_id or ""),
            "status": "completed",
            "playableChunks": 1,
            "playableDurationMs": 450,
            "downloadUrl": f"/tts/v2/jobs/{job_id}/result",
            "engine": "VECTOR",
        },
    )
    monkeypatch.setattr(
        backend_app,
        "_reader_tts_job_result_audio_bytes",
        lambda uid, job_id, *, is_admin=False: _make_test_wav(),
    )


def test_reader_uses_vector_flash_unified_tts_and_can_export(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_reader_require_legal_ack", lambda _uid: None)
    _stub_reader_vector_tts(monkeypatch)

    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_vector_user"}

    upload_response = client.post(
        "/reader/uploads",
        headers=headers,
        data={
            "title": "Reader Vector Flash",
            "contentType": "book",
            "ownershipBasis": "user_responsible",
            "regionId": "english",
        },
        files=[("files", ("story.txt", b"Hello from the Reader. This should route through Vector flash.", "text/plain"))],
    )
    assert upload_response.status_code == 200
    upload_id = str(upload_response.json()["upload"]["id"])

    created = client.post(
        "/reader/sessions",
        headers=headers,
        json={
            "uploadId": upload_id,
            "audioEngine": "tts_hd",
            "multiSpeakerEnabled": False,
            "voiceMode": "single",
        },
    )
    assert created.status_code == 200
    session_payload = created.json()["session"]
    session_id = str(session_payload["id"])

    for _ in range(80):
        session_payload = client.get(f"/reader/sessions/{session_id}", headers=headers).json()["session"]
        windows = list(session_payload.get("windows") or [])
        if windows and str(((windows[0].get("job") or {}).get("status") or "")).lower() == "completed":
            break
        time.sleep(0.05)

    windows = list(session_payload.get("windows") or [])
    assert windows
    first_window = windows[0]
    assert session_payload["audioEngine"] == "tts_hd"
    assert str(session_payload["billing"]["modelRouting"]["primary"] or "").startswith("gemini-2.5-flash")
    assert str((first_window.get("job") or {}).get("engine") or "") == "VECTOR"
    download_url = str((first_window.get("job") or {}).get("downloadUrl") or "")
    assert download_url.startswith("/tts/v2/jobs/")
    assert not download_url.startswith("/tts/sessions/")

    export_response = client.get(f"/reader/sessions/{session_id}/export", headers=headers)
    assert export_response.status_code == 200
    assert export_response.headers["content-type"].startswith("audio/wav")
    assert len(export_response.content) > 40


def test_reader_comic_upload_uses_first_page_asset_for_cover(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_reader_require_legal_ack", lambda _uid: None)

    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_comic_upload_user"}

    upload_response = client.post(
        "/reader/uploads",
        headers=headers,
        data={
            "title": "Reader Comic Upload",
            "contentType": "comic",
            "ownershipBasis": "user_responsible",
            "regionId": "english",
        },
        files=[("files", ("page-1.png", _make_png_bytes(), "image/png"))],
    )
    assert upload_response.status_code == 200
    upload_payload = upload_response.json()["upload"]
    assert str(upload_payload.get("coverUrl") or "").startswith(f"/reader/uploads/{upload_payload['id']}/assets/")


def test_reader_coerces_native_audio_request_to_vector_flash(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_reader_require_legal_ack", lambda _uid: None)
    _stub_reader_vector_tts(monkeypatch)

    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_vector_only_user"}

    upload_response = client.post(
        "/reader/uploads",
        headers=headers,
        data={
            "title": "Reader Engine Lock",
            "contentType": "book",
            "ownershipBasis": "user_responsible",
            "regionId": "english",
        },
        files=[("files", ("story.txt", b"Reader should stay on vector flash only.", "text/plain"))],
    )
    assert upload_response.status_code == 200
    upload_payload = upload_response.json()["upload"]
    assert str(upload_payload.get("coverUrl") or "").startswith("data:image/svg+xml")
    upload_id = str(upload_payload["id"])

    created = client.post(
        "/reader/sessions",
        headers=headers,
        json={
            "uploadId": upload_id,
            "audioEngine": "native_audio_dialog",
            "multiSpeakerEnabled": False,
            "voiceMode": "single",
        },
    )
    assert created.status_code == 200
    session_payload = created.json()["session"]

    assert session_payload["audioEngine"] == "tts_hd"
    assert session_payload["audioEngineStatus"] == "active"
    assert session_payload["billing"]["engineRouting"]["selected"] == "tts_hd"
