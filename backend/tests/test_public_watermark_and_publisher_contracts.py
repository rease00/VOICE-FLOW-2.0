from __future__ import annotations

from io import BytesIO
import wave

from fastapi.testclient import TestClient

import app as backend_app


client = TestClient(backend_app.app)


def _wav_bytes(duration_ms: int = 40, sample_rate: int = 24000) -> bytes:
    frame_count = max(1, int((sample_rate * max(1, duration_ms)) / 1000))
    out = BytesIO()
    with wave.open(out, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"\x00\x00" * frame_count)
    return out.getvalue()


def test_extract_watermark_returns_authenticity_only(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "extract_uid_from_watermark", lambda samples: "AUTHENTICATED_VOICEFLOW_CONTENT")

    response = client.post(
        "/api/v2/extract-watermark",
        files={"file": ("proof.wav", _wav_bytes(), "audio/wav")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["detected"] is True
    assert "Voice-Flow watermark detected" in str(payload["message"])
    assert "uid" not in payload


def test_extract_watermark_rejects_unsupported_formats() -> None:
    response = client.post(
        "/api/v2/extract-watermark",
        files={"file": ("proof.mp3", b"not-a-wav", "audio/mpeg")},
    )

    assert response.status_code == 400
    assert "wav" in str(response.json().get("detail") or "").lower()
