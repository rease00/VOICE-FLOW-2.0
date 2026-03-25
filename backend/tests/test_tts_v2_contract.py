from __future__ import annotations

import time
import uuid
import wave
from io import BytesIO

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


def test_tts_v2_job_create_requires_request_id(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    response = client.post(
        "/tts/v2/jobs",
        headers={"x-dev-uid": "v2_reqid_missing"},
        json={"mode": "single_speaker", "engine": "NEURAL2", "text": "hello"},
    )
    assert response.status_code == 400


def test_tts_v2_job_create_rejects_forbidden_fields(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    payload = {
        "request_id": f"test_{uuid.uuid4().hex}",
        "mode": "single_speaker",
        "engine": "NEURAL2",
        "text": "hello",
        "apiKey": "should-not-be-accepted",
    }
    response = client.post("/tts/v2/jobs", headers={"x-dev-uid": "v2_forbid_fields"}, json=payload)
    assert response.status_code == 422


def test_tts_v2_job_create_is_idempotent_for_same_request_id(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(
        backend_app,
        "_tts_v2_synthesize_chunk",
        lambda payload, text, lane_id: backend_app.TtsV2SynthChunk(audio=_wav_bytes(), media_type="audio/wav", headers={}),
    )
    request_id = f"test_{uuid.uuid4().hex}"
    payload = {
        "request_id": request_id,
        "mode": "single_speaker",
        "engine": "NEURAL2",
        "text": "One line only.",
    }
    first = client.post("/tts/v2/jobs", headers={"x-dev-uid": "idem_user"}, json=payload)
    second = client.post("/tts/v2/jobs", headers={"x-dev-uid": "idem_user"}, json=payload)
    assert first.status_code == 202
    assert second.status_code == 200
    first_job_id = str(first.json().get("jobId") or "")
    second_job_id = str(second.json().get("jobId") or "")
    assert first_job_id == request_id
    assert second_job_id == request_id


def test_tts_v2_job_cancel_stays_cancelled(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)

    def _slow_synth(payload, text, lane_id):
        _ = payload, text, lane_id
        time.sleep(0.2)
        return backend_app.TtsV2SynthChunk(audio=_wav_bytes(120), media_type="audio/wav", headers={})

    monkeypatch.setattr(backend_app, "_tts_v2_synthesize_chunk", _slow_synth)
    request_id = f"test_{uuid.uuid4().hex}"
    submit = client.post(
        "/tts/v2/jobs",
        headers={"x-dev-uid": "cancel_user"},
        json={
            "request_id": request_id,
            "mode": "single_speaker",
            "engine": "NEURAL2",
            "text": "First.\nSecond.\nThird.",
        },
    )
    assert submit.status_code == 202
    cancel = client.post(f"/tts/v2/jobs/{request_id}/cancel", headers={"x-dev-uid": "cancel_user"})
    assert cancel.status_code == 200
    poll = client.get(f"/tts/v2/jobs/{request_id}", headers={"x-dev-uid": "cancel_user"})
    assert poll.status_code == 200
    assert str(poll.json().get("status") or "").lower() == "cancelled"


def test_tts_v2_cancel_releases_lane_inflight(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)

    def _slow_synth(payload, text, lane_id):
        _ = payload, text, lane_id
        time.sleep(0.25)
        return backend_app.TtsV2SynthChunk(audio=_wav_bytes(120), media_type="audio/wav", headers={})

    monkeypatch.setattr(backend_app, "_tts_v2_synthesize_chunk", _slow_synth)
    request_id = f"test_{uuid.uuid4().hex}"
    lines = "\n".join(
        [
            f"Speaker {index}: This is chunk line {index} with enough words to force chunk scheduling."
            for index in range(1, 10)
        ]
    )
    submit = client.post(
        "/tts/v2/jobs",
        headers={"x-dev-uid": "cancel_release_user"},
        json={
            "request_id": request_id,
            "mode": "single_speaker",
            "engine": "NEURAL2",
            "text": lines,
        },
    )
    assert submit.status_code == 202
    cancel = client.post(f"/tts/v2/jobs/{request_id}/cancel", headers={"x-dev-uid": "cancel_release_user"})
    assert cancel.status_code == 200

    deadline = time.time() + 3.0
    last_payload = {}
    while time.time() < deadline:
        poll = client.get(f"/tts/v2/jobs/{request_id}", headers={"x-dev-uid": "cancel_release_user"})
        assert poll.status_code == 200
        last_payload = poll.json()
        lanes = list(last_payload.get("lanes") or [])
        if str(last_payload.get("status") or "").lower() == "cancelled" and lanes and all(
            int(lane.get("inflight") or 0) == 0 for lane in lanes
        ):
            break
        time.sleep(0.05)

    lanes = list(last_payload.get("lanes") or [])
    assert lanes, "Expected lane snapshot in status payload."
    assert all(int(lane.get("inflight") or 0) == 0 for lane in lanes)


def test_tts_v2_cross_user_access_denied(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(
        backend_app,
        "_tts_v2_synthesize_chunk",
        lambda payload, text, lane_id: backend_app.TtsV2SynthChunk(audio=_wav_bytes(), media_type="audio/wav", headers={}),
    )
    request_id = f"test_{uuid.uuid4().hex}"
    submit = client.post(
        "/tts/v2/jobs",
        headers={"x-dev-uid": "owner_user"},
        json={
            "request_id": request_id,
            "mode": "single_speaker",
            "engine": "NEURAL2",
            "text": "hello world",
        },
    )
    assert submit.status_code == 202
    forbidden = client.get(f"/tts/v2/jobs/{request_id}", headers={"x-dev-uid": "other_user"})
    assert forbidden.status_code == 403


def test_tts_v2_request_id_conflict_rejects_cross_user_create(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(
        backend_app,
        "_tts_v2_synthesize_chunk",
        lambda payload, text, lane_id: backend_app.TtsV2SynthChunk(audio=_wav_bytes(), media_type="audio/wav", headers={}),
    )
    request_id = f"test_{uuid.uuid4().hex}"
    payload = {
        "request_id": request_id,
        "mode": "single_speaker",
        "engine": "NEURAL2",
        "text": "idempotent create",
    }
    first = client.post("/tts/v2/jobs", headers={"x-dev-uid": "owner_user"}, json=payload)
    assert first.status_code == 202

    second = client.post("/tts/v2/jobs", headers={"x-dev-uid": "other_user"}, json=payload)
    assert second.status_code == 409
