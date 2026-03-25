from __future__ import annotations

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


def test_reader_uses_vector_flash_unified_tts_and_can_export(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_reader_require_legal_ack", lambda _uid: None)
    monkeypatch.setattr(
        backend_app,
        "_tts_v2_synthesize_chunk",
        lambda payload, text, lane_id: backend_app.TtsV2SynthChunk(audio=_make_test_wav(), media_type="audio/wav", headers={"lane": str(lane_id)}),
    )

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
    assert str((first_window.get("job") or {}).get("engine") or "") == "NEURAL2"
    download_url = str((first_window.get("job") or {}).get("downloadUrl") or "")
    assert download_url.startswith("/tts/v2/jobs/")
    assert not download_url.startswith("/tts/sessions/")

    export_response = client.get(f"/reader/sessions/{session_id}/export", headers=headers)
    assert export_response.status_code == 200
    assert export_response.headers["content-type"].startswith("audio/wav")
    assert len(export_response.content) > 40
