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


def _issue_session_key(uid: str) -> str:
    response = client.post("/tts/v2/sessions", headers={"x-dev-uid": uid})
    assert response.status_code == 201
    session_key = str(response.json().get("sessionKey") or "").strip()
    assert session_key
    return session_key


def _dev_headers(uid: str, *, include_session: bool = True) -> dict[str, str]:
    headers = {"x-dev-uid": uid}
    if include_session:
        headers["x-vf-tts-session-key"] = _issue_session_key(uid)
    return headers


def test_tts_v2_job_create_requires_request_id(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    response = client.post(
        "/tts/v2/jobs",
        headers=_dev_headers("v2_reqid_missing"),
        json={"mode": "single_speaker", "engine": "NEURAL2", "text": "hello"},
    )
    assert response.status_code == 400


def test_tts_v2_job_create_requires_session_key(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    response = client.post(
        "/tts/v2/jobs",
        headers=_dev_headers("v2_missing_session", include_session=False),
        json={
            "request_id": f"test_{uuid.uuid4().hex}",
            "mode": "single_speaker",
            "engine": "NEURAL2",
            "text": "hello",
        },
    )
    assert response.status_code == 401
    detail = str(response.json().get("detail") or "").lower()
    assert "x-vf-tts-session-key" in detail


def test_tts_v2_job_create_rejects_invalid_session_key(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    response = client.post(
        "/tts/v2/jobs",
        headers={
            "x-dev-uid": "v2_invalid_session",
            "x-vf-tts-session-key": f"invalid_{uuid.uuid4().hex}",
        },
        json={
            "request_id": f"test_{uuid.uuid4().hex}",
            "mode": "single_speaker",
            "engine": "NEURAL2",
            "text": "hello",
        },
    )
    assert response.status_code == 401
    assert "invalid or expired tts session key" in str(response.json().get("detail") or "").lower()


def test_tts_v2_job_create_rejects_expired_session_key(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    uid = "v2_expired_session"
    session_key = _issue_session_key(uid)
    with backend_app._TTS_V2_SESSION_LOCK:
        row = dict(backend_app._INMEMORY_TTS_V2_SESSIONS.get(session_key) or {})
        row["expiresAtMs"] = int(time.time() * 1000) - 1
        backend_app._INMEMORY_TTS_V2_SESSIONS[session_key] = row
        backend_app._INMEMORY_TTS_V2_ACTIVE_SESSION_BY_UID[uid] = session_key
    response = client.post(
        "/tts/v2/jobs",
        headers={
            "x-dev-uid": uid,
            "x-vf-tts-session-key": session_key,
        },
        json={
            "request_id": f"test_{uuid.uuid4().hex}",
            "mode": "single_speaker",
            "engine": "NEURAL2",
            "text": "hello",
        },
    )
    assert response.status_code == 401
    assert "expired" in str(response.json().get("detail") or "").lower()


def test_tts_v2_job_create_rejects_session_ownership_mismatch(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    owner_uid = "v2_session_owner"
    other_uid = "v2_session_other"
    session_key = _issue_session_key(owner_uid)
    with backend_app._TTS_V2_SESSION_LOCK:
        backend_app._INMEMORY_TTS_V2_ACTIVE_SESSION_BY_UID[other_uid] = session_key
    response = client.post(
        "/tts/v2/jobs",
        headers={
            "x-dev-uid": other_uid,
            "x-vf-tts-session-key": session_key,
        },
        json={
            "request_id": f"test_{uuid.uuid4().hex}",
            "mode": "single_speaker",
            "engine": "NEURAL2",
            "text": "hello",
        },
    )
    assert response.status_code == 403
    assert "ownership mismatch" in str(response.json().get("detail") or "").lower()


def test_tts_v2_session_key_ttl_defaults_to_30_minutes(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    response = client.post("/tts/v2/sessions", headers={"x-dev-uid": "v2_session_ttl"})
    assert response.status_code == 201
    payload = response.json()
    assert int(payload.get("ttlSeconds") or 0) == 1800
    created_at = int(payload.get("createdAtMs") or 0)
    expires_at = int(payload.get("expiresAtMs") or 0)
    delta_ms = expires_at - created_at
    assert 1_790_000 <= delta_ms <= 1_800_000


def test_tts_v2_job_create_rejects_forbidden_fields(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    payload = {
        "request_id": f"test_{uuid.uuid4().hex}",
        "mode": "single_speaker",
        "engine": "NEURAL2",
        "text": "hello",
        "apiKey": "should-not-be-accepted",
    }
    response = client.post("/tts/v2/jobs", headers=_dev_headers("v2_forbid_fields"), json=payload)
    assert response.status_code == 422


def test_tts_v2_job_create_rejects_provider_key_and_credential_fields(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    base_payload = {
        "request_id": f"test_{uuid.uuid4().hex}",
        "mode": "single_speaker",
        "engine": "NEURAL2",
        "text": "hello",
    }
    for key, value in (
        ("providerApiKey", "should-not-be-accepted"),
        ("vertexServiceAccountRef", "slot_2"),
        ("sourcePolicy", {"selectedVertexSlotId": "slot_3"}),
        ("credentialsPath", "C:/secrets/service-account.json"),
    ):
        payload = dict(base_payload)
        payload[key] = value
        response = client.post("/tts/v2/jobs", headers=_dev_headers(f"v2_forbid_{key}"), json=payload)
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
    headers = _dev_headers("idem_user")
    first = client.post("/tts/v2/jobs", headers=headers, json=payload)
    second = client.post("/tts/v2/jobs", headers=headers, json=payload)
    assert first.status_code in {200, 202}
    assert second.status_code in {200, 202}
    first_job_id = str(first.json().get("jobId") or "")
    second_job_id = str(second.json().get("jobId") or "")
    assert first_job_id == request_id
    assert second_job_id == request_id


def test_tts_v2_lane_uses_backend_slot_binding(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    expected_slot_by_lane = {"L1": "slot_1", "L2": "slot_2", "L3": "slot_3"}
    captured: list[tuple[str, str]] = []

    def _capture_slot(payload, text, lane_id):
        _ = text
        source_policy = dict((payload or {}).get("sourcePolicy") or {})
        captured.append((str(lane_id or ""), str(source_policy.get("selectedVertexSlotId") or "")))
        return backend_app.TtsV2SynthChunk(audio=_wav_bytes(80), media_type="audio/wav", headers={})

    monkeypatch.setattr(backend_app, "_tts_v2_synthesize_chunk", _capture_slot)
    request_id = f"test_{uuid.uuid4().hex}"
    dense_text = "\n".join(
        [
            (
                f"Speaker {index}: This is a long scripted line {index} with enough words to force "
                "multiple planned chunks and lane dispatch across startup ordering."
            )
            for index in range(1, 20)
        ]
    )
    submit = client.post(
        "/tts/v2/jobs",
        headers=_dev_headers("lane_binding_user"),
        json={
            "request_id": request_id,
            "mode": "single_speaker",
            "engine": "NEURAL2",
            "text": dense_text,
        },
    )
    assert submit.status_code == 202

    deadline = time.time() + 8.0
    while time.time() < deadline:
        poll = client.get(f"/tts/v2/jobs/{request_id}", headers={"x-dev-uid": "lane_binding_user"})
        assert poll.status_code == 200
        lanes_seen = {lane_id for lane_id, _ in captured if lane_id in expected_slot_by_lane}
        if lanes_seen == {"L1", "L2", "L3"}:
            break
        time.sleep(0.05)

    client.post(f"/tts/v2/jobs/{request_id}/cancel", headers={"x-dev-uid": "lane_binding_user"})
    assert captured
    lanes_seen = set()
    for lane_id, slot_id in captured:
        if lane_id in expected_slot_by_lane:
            lanes_seen.add(lane_id)
            assert slot_id == expected_slot_by_lane[lane_id]
    assert lanes_seen == {"L1", "L2", "L3"}


def test_tts_v2_error_payloads_redact_secret_like_runtime_details(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)

    secret_path = r"C:\runtime\secrets\vertex-service-account.json"
    secret_marker = "GOOGLE_APPLICATION_CREDENTIALS"
    private_key_marker = "private_key"

    def _failing_synth(payload, text, lane_id):
        _ = payload, text, lane_id
        raise backend_app.TtsV2RuntimeSynthesisError(
            f"{secret_marker}={secret_path}; {private_key_marker}=BEGIN",
            status_code=500,
            retryable=False,
            detail={"error": f"upstream failed with {secret_path} and {private_key_marker}"},
        )

    monkeypatch.setattr(backend_app, "_tts_v2_synthesize_chunk", _failing_synth)
    request_id = f"test_{uuid.uuid4().hex}"
    submit = client.post(
        "/tts/v2/jobs",
        headers=_dev_headers("redact_user"),
        json={
            "request_id": request_id,
            "mode": "single_speaker",
            "engine": "NEURAL2",
            "text": "hello secure world",
        },
    )
    assert submit.status_code == 202

    deadline = time.time() + 12.0
    status_payload = {}
    while time.time() < deadline:
        poll = client.get(
            f"/tts/v2/jobs/{request_id}",
            headers={"x-dev-uid": "redact_user"},
            params={"includeChunks": True},
        )
        assert poll.status_code == 200
        status_payload = poll.json()
        if str(status_payload.get("status") or "").lower() in {"failed", "cancelled"}:
            break
        time.sleep(0.05)

    raw_status = str(status_payload)
    assert str(status_payload.get("status") or "").lower() == "failed"
    assert secret_marker not in raw_status
    assert secret_path not in raw_status
    assert private_key_marker not in raw_status

    result = client.get(f"/tts/v2/jobs/{request_id}/result/audio", headers={"x-dev-uid": "redact_user"})
    assert result.status_code >= 400
    raw_result = str(result.json())
    assert secret_marker not in raw_result
    assert secret_path not in raw_result
    assert private_key_marker not in raw_result


def test_reader_tts_job_creation_routes_through_v2_helper(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)

    def _legacy_submit(*args, **kwargs):
        _ = args, kwargs
        raise AssertionError("Reader should not call legacy _submit_tts_job anymore.")

    captured: dict[str, object] = {}

    def _fake_create_tts_v2_job_response(request, payload, *, require_session=True):
        _ = request
        captured["require_session"] = require_session
        captured["payload"] = dict(payload or {})
        return backend_app.JSONResponse(
            {
                "jobId": str(payload.get("request_id") or ""),
                "requestId": str(payload.get("request_id") or ""),
                "status": "queued",
                "engine": "NEURAL2",
            },
            status_code=202,
        )

    monkeypatch.setattr(backend_app, "_submit_tts_job", _legacy_submit)
    monkeypatch.setattr(backend_app, "_create_tts_v2_job_response", _fake_create_tts_v2_job_response)

    request = backend_app._reader_internal_request("reader_v2_user")
    session = {"audioEngine": "tts_hd"}
    request_id = f"reader_{uuid.uuid4().hex}"
    speaker_voices = [{"speaker": f"Speaker {idx}", "voice_id": f"v{idx}"} for idx in range(1, 7)]
    job_id = backend_app._reader_create_tts_job(
        request,
        session=session,
        text="Speaker 1: hello\nSpeaker 2: world",
        request_id=request_id,
        voice_id="v22",
        language="en",
        multi_speaker_mode="studio_pair_groups",
        line_map=[{"lineIndex": 0, "speaker": "Speaker 1", "text": "hello"}],
        speaker_voices=speaker_voices,
    )

    assert job_id == request_id
    assert captured["require_session"] is False
    payload = dict(captured["payload"] or {})
    assert payload["request_id"] == request_id
    assert payload["mode"] == "multi_speaker"
    assert "apiKey" not in payload
    assert "providerApiKey" not in payload


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
        headers=_dev_headers("cancel_user"),
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
        headers=_dev_headers("cancel_release_user"),
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
        headers=_dev_headers("owner_user"),
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
    first = client.post("/tts/v2/jobs", headers=_dev_headers("owner_user"), json=payload)
    assert first.status_code == 202

    second = client.post("/tts/v2/jobs", headers=_dev_headers("other_user"), json=payload)
    assert second.status_code == 409


def test_reader_job_status_summary_prefers_v2_jobs(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)

    def _legacy_get(*args, **kwargs):
        _ = args, kwargs
        raise AssertionError("Reader job status should prefer V2 before legacy queue.")

    monkeypatch.setattr(backend_app._TTS_JOB_QUEUE, "get", _legacy_get)
    monkeypatch.setattr(
        backend_app._TTS_V2_ENGINE,
        "get_job",
        lambda *, uid, is_admin, job_id: object(),
    )
    monkeypatch.setattr(
        backend_app._TTS_V2_ENGINE,
        "status_payload",
        lambda **kwargs: {
            "status": "running",
            "engine": "NEURAL2",
            "chunkCursorNext": 3,
            "live": {"playableChunks": 2, "playableDurationMs": 3800},
        },
    )

    summary = backend_app._reader_job_status_summary("reader_summary_user", "job_v2_summary")
    assert summary["status"] == "running"
    assert summary["engine"] == "NEURAL2"
    assert summary["chunkCursorNext"] == 3
    assert summary["playableChunks"] == 2
    assert summary["playableDurationMs"] == 3800


def test_reader_export_prefers_v2_result_audio(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)

    def _legacy_get(*args, **kwargs):
        _ = args, kwargs
        raise AssertionError("Reader export should prefer V2 result audio before legacy queue.")

    monkeypatch.setattr(backend_app._TTS_JOB_QUEUE, "get", _legacy_get)
    monkeypatch.setattr(
        backend_app._TTS_V2_ENGINE,
        "get_result_audio",
        lambda *, uid, is_admin, job_id: (_wav_bytes(200), "audio/wav"),
    )

    audio = backend_app._reader_tts_job_result_audio_bytes("reader_export_user", "job_v2_export", is_admin=False)
    assert audio == _wav_bytes(200)


def test_reader_delete_prefers_v2_cancel(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    calls = {"v2": 0, "legacy": 0}

    def _v2_cancel(*, uid, is_admin, job_id):
        _ = uid, is_admin, job_id
        calls["v2"] += 1
        return object()

    def _legacy_cancel(*args, **kwargs):
        _ = args, kwargs
        calls["legacy"] += 1
        raise AssertionError("Reader delete should not reach legacy queue cancel when V2 is available.")

    monkeypatch.setattr(backend_app._TTS_V2_ENGINE, "cancel_job", _v2_cancel)
    monkeypatch.setattr(backend_app._TTS_JOB_QUEUE, "cancel", _legacy_cancel)

    cancelled = backend_app._reader_cancel_tts_job("reader_cancel_user", "job_v2_cancel", is_admin=False)
    assert cancelled is True
    assert calls["v2"] == 1
    assert calls["legacy"] == 0
