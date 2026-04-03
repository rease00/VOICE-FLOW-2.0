from __future__ import annotations

import io
import sys
import wave
from pathlib import Path

from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = BACKEND_ROOT.parent
for candidate in (str(BACKEND_ROOT), str(WORKSPACE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

import backend.app as backend_app


def _make_test_wav(duration_ms: int = 360, sample_rate: int = 24000) -> bytes:
    frame_count = max(1, int(sample_rate * (duration_ms / 1000.0)))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(b"\x00\x00" * frame_count)
    return buffer.getvalue()


def test_reader_preferences_and_restore_state_round_trip(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_reader_require_legal_ack", lambda _uid: None)
    monkeypatch.setattr(
        backend_app,
        "_tts_v2_synthesize_chunk",
        lambda payload, text, lane_id: backend_app.TtsV2SynthChunk(audio=_make_test_wav(), media_type="audio/wav", headers={"lane": str(lane_id)}),
    )

    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_persistence_user"}

    preference_patch = client.patch(
        "/reader/preferences",
        headers=headers,
        json={"homeTab": "imported"},
    )
    assert preference_patch.status_code == 200
    assert preference_patch.json()["preferences"]["homeTab"] == "imported"

    preference_get = client.get("/reader/preferences", headers=headers)
    assert preference_get.status_code == 200
    assert preference_get.json()["preferences"]["homeTab"] == "imported"

    upload_response = client.post(
        "/reader/uploads",
        headers=headers,
        data={
            "title": "Persistence Story",
            "contentType": "book",
            "ownershipBasis": "user_responsible",
            "regionId": "english",
        },
        files=[("files", ("story.txt", b"Persistence smoke content for the reader.", "text/plain"))],
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

    savepoint_response = client.post(
        f"/reader/sessions/{session_id}/savepoint",
        headers=headers,
        json={
            "restoreState": {
                "activeItemIndex": 0,
                "activeUnitId": "window-1",
                "viewportAnchor": "window-1",
                "activeReaderTab": "text",
            },
        },
    )
    assert savepoint_response.status_code == 200
    saved_session = savepoint_response.json()["session"]
    assert saved_session["restoreState"]["activeItemIndex"] == 0
    assert saved_session["restoreState"]["activeUnitId"] == "window-1"
    assert saved_session["restoreState"]["viewportAnchor"] == "window-1"
    assert saved_session["restoreState"]["activeReaderTab"] == "text"

    progress_response = client.post(
        f"/reader/sessions/{session_id}/progress",
        headers=headers,
        json={
            "activeItemIndex": 0,
            "activeUnitId": "window-1",
            "viewportAnchor": "window-1",
            "consumedChars": 42,
        },
    )
    assert progress_response.status_code == 200
    progress_session = progress_response.json()["session"]

    assert progress_session["restoreState"]["activeItemIndex"] == 0
    assert progress_session["restoreState"]["viewportAnchor"] == "window-1"
    assert progress_session["restoreState"]["activeReaderTab"] == "text"

    reloaded = client.get(f"/reader/sessions/{session_id}", headers=headers)
    assert reloaded.status_code == 200
    assert reloaded.json()["session"]["restoreState"]["activeReaderTab"] == "text"


def test_reader_savepoint_rejects_cast_over_eight_speakers(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_reader_require_legal_ack", lambda _uid: None)
    monkeypatch.setattr(
        backend_app,
        "_tts_v2_synthesize_chunk",
        lambda payload, text, lane_id: backend_app.TtsV2SynthChunk(audio=_make_test_wav(), media_type="audio/wav", headers={"lane": str(lane_id)}),
    )

    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_cast_cap_user"}

    upload_response = client.post(
        "/reader/uploads",
        headers=headers,
        data={
            "title": "Cast Cap Story",
            "contentType": "book",
            "ownershipBasis": "user_responsible",
            "regionId": "english",
        },
        files=[("files", ("story.txt", b"Cast cap validation text.", "text/plain"))],
    )
    assert upload_response.status_code == 200
    upload_id = str(upload_response.json()["upload"]["id"])

    created = client.post(
        "/reader/sessions",
        headers=headers,
        json={
            "uploadId": upload_id,
            "audioEngine": "tts_hd",
            "multiSpeakerEnabled": True,
            "voiceMode": "multi",
        },
    )
    assert created.status_code == 200
    session_id = str(created.json()["session"]["id"])

    cast_overrides = {f"Speaker {index}": f"v{index}" for index in range(1, 10)}
    cast_overrides["Narrator"] = "v22"
    savepoint_response = client.post(
        f"/reader/sessions/{session_id}/savepoint",
        headers=headers,
        json={"castOverrides": cast_overrides},
    )
    assert savepoint_response.status_code == 400
    assert "up to 8 speakers" in str(savepoint_response.json().get("detail") or "").lower()
