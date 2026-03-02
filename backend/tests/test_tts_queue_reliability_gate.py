from __future__ import annotations

import threading
import time
import wave
from io import BytesIO

from fastapi.testclient import TestClient

import app as backend_app


class _DummyRuntimeResponse:
    def __init__(self, status_code: int = 200) -> None:
        self.status_code = status_code
        self.content = b"RIFF" + b"\x00" * 512
        self.headers = {
            "content-type": "audio/wav",
            "x-voiceflow-trace-id": "trace_test_tts_queue",
        }
        self.text = ""

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self) -> dict:
        return {}


def _reset_tts_metrics_state(monkeypatch, *, gem_limit: int = 12, kokoro_limit: int = 8) -> None:
    engine_limits = {
        "GEM": int(gem_limit),
        "KOKORO": int(kokoro_limit),
    }
    monkeypatch.setattr(backend_app, "_TTS_ENGINE_CONCURRENCY_LIMITS", engine_limits)
    monkeypatch.setattr(
        backend_app,
        "_TTS_ENGINE_SEMAPHORES",
        {engine: threading.Semaphore(max(1, limit)) for engine, limit in engine_limits.items()},
    )
    monkeypatch.setattr(backend_app, "_TTS_ENGINE_ACTIVE_COUNTS", {engine: 0 for engine in engine_limits})
    monkeypatch.setattr(
        backend_app,
        "_TTS_ENGINE_QUEUE_COUNTS",
        {engine: {"queued": 0, "running": 0} for engine in engine_limits},
    )
    monkeypatch.setattr(
        backend_app,
        "_TTS_ENGINE_RUNNING_JOB_IDS",
        {engine: set() for engine in engine_limits},
    )
    monkeypatch.setattr(
        backend_app,
        "_TTS_ENGINE_QUEUED_JOB_IDS",
        {engine: set() for engine in engine_limits},
    )
    monkeypatch.setattr(backend_app, "_TTS_ENGINE_ENQUEUED_AT_MS", {})
    monkeypatch.setattr(
        backend_app,
        "_TTS_QUEUE_TELEMETRY",
        {
            "enqueueToStartMs": backend_app.deque(maxlen=backend_app.VF_TTS_QUEUE_METRICS_WINDOW),
            "runtimeLatencyMs": backend_app.deque(maxlen=backend_app.VF_TTS_QUEUE_METRICS_WINDOW),
            "engineSemaphoreWaitMs": backend_app.deque(maxlen=backend_app.VF_TTS_QUEUE_METRICS_WINDOW),
            "liveFirstChunkLatencyMs": backend_app.deque(maxlen=backend_app.VF_TTS_QUEUE_METRICS_WINDOW),
            "liveChunkCount": backend_app.deque(maxlen=backend_app.VF_TTS_QUEUE_METRICS_WINDOW),
            "liveChunkRvcLatencyMs": backend_app.deque(maxlen=backend_app.VF_TTS_QUEUE_METRICS_WINDOW),
            "terminalEvents": backend_app.deque(maxlen=backend_app.VF_TTS_QUEUE_METRICS_WINDOW),
            "runtimeLatencyByEngine": {
                "GEM": backend_app.deque(maxlen=backend_app.VF_TTS_QUEUE_METRICS_WINDOW),
                "KOKORO": backend_app.deque(maxlen=backend_app.VF_TTS_QUEUE_METRICS_WINDOW),
            },
            "semaphoreWaitByEngine": {
                "GEM": backend_app.deque(maxlen=backend_app.VF_TTS_QUEUE_METRICS_WINDOW),
                "KOKORO": backend_app.deque(maxlen=backend_app.VF_TTS_QUEUE_METRICS_WINDOW),
            },
        },
    )


def test_process_tts_job_respects_engine_semaphore_limit(monkeypatch) -> None:
    _reset_tts_metrics_state(monkeypatch, gem_limit=2, kokoro_limit=1)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_TTS_QUEUE_ENABLED", True)
    monkeypatch.setattr(
        backend_app,
        "_TTS_JOB_QUEUE",
        backend_app.TtsJobQueue(redis_url="", key_prefix=f"test:tts:queue:{time.time_ns()}", lane_weights=backend_app.VF_TTS_LANE_WEIGHTS),
    )

    tracker = {"active": 0, "max": 0}
    tracker_lock = threading.Lock()

    def _fake_post(*_args, **_kwargs):
        with tracker_lock:
            tracker["active"] += 1
            tracker["max"] = max(tracker["max"], tracker["active"])
        time.sleep(0.05)
        with tracker_lock:
            tracker["active"] -= 1
        return _DummyRuntimeResponse()

    monkeypatch.setattr(backend_app.requests, "post", _fake_post)

    jobs: list[dict[str, object]] = []
    for idx in range(6):
        request_id = f"sem_job_{idx}"
        payload = {
            "jobId": request_id,
            "uid": "sem_user",
            "requestId": request_id,
            "traceId": request_id,
            "engine": "GEM",
            "text": "hello",
            "voiceId": "Fenrir",
            "voiceName": "Fenrir",
            "planName": "Free",
            "planKey": "free",
            "adminLimitBypass": True,
            "runtimeBase": "http://127.0.0.1:7810",
            "runtimePath": "/synthesize",
            "upstreamPayload": {"text": "hello"},
            "deadlineAtMs": int(time.time() * 1000) + 60_000,
            "maxAttempts": 1,
            "attempts": 0,
        }
        backend_app._TTS_JOB_QUEUE.enqueue(lane="free", payload=payload)
        backend_app._record_tts_job_enqueued(job_id=request_id, engine="GEM", created_at_ms=int(time.time() * 1000))
        jobs.append(payload)

    threads: list[threading.Thread] = []
    for index, job in enumerate(jobs):
        worker_id = f"worker-{index}"
        thread = threading.Thread(target=backend_app._process_tts_job, args=(job, worker_id))
        thread.start()
        threads.append(thread)
    for thread in threads:
        thread.join(timeout=5)
        assert not thread.is_alive()

    assert tracker["max"] <= 2


def test_submit_tts_job_rejects_when_projection_exceeds_ttl(monkeypatch) -> None:
    _reset_tts_metrics_state(monkeypatch)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(
        backend_app,
        "_TTS_JOB_QUEUE",
        backend_app.TtsJobQueue(redis_url="", key_prefix=f"test:tts:projection:{time.time_ns()}", lane_weights=backend_app.VF_TTS_LANE_WEIGHTS),
    )

    class _Lease:
        queued = False
        wait_ms = 0
        queue_depth = 0

        def release(self) -> None:
            return None

    monkeypatch.setattr(backend_app._TTS_GATEWAY_CONTROLLER, "acquire", lambda: (_Lease(), None))
    monkeypatch.setattr(backend_app, "_enforce_tts_plan_guardrails", lambda *_args, **_kwargs: ("Free", "free", {}))
    monkeypatch.setattr(backend_app, "_precheck_tts_success_quota", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(backend_app, "_reserve_usage", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(
        backend_app,
        "_estimate_tts_completion_delay",
        lambda _engine: {
            "engine": "GEM",
            "queued": 50,
            "running": 12,
            "jobsAhead": 62,
            "concurrency": 4,
            "avgRuntimeMs": 5_000,
            "estimatedCompletionMs": backend_app.VF_TTS_QUEUE_JOB_TTL_MS + 15_000,
        },
    )

    client = TestClient(backend_app.app)
    response = client.post(
        "/tts/synthesize",
        headers={"x-dev-uid": "projection_user"},
        json={"engine": "GEM", "text": "projection overload check"},
    )
    assert response.status_code == 503
    payload = response.json()
    detail = payload.get("detail") or {}
    assert detail.get("errorCode") == backend_app.ENGINE_OVERLOADED
    assert detail.get("reason") == "estimated_queue_timeout"
    assert int(detail.get("retryAfterMs") or 0) > 0


def test_tts_job_status_includes_queue_debug_fields(monkeypatch) -> None:
    _reset_tts_metrics_state(monkeypatch, gem_limit=3, kokoro_limit=2)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(
        backend_app,
        "_TTS_JOB_QUEUE",
        backend_app.TtsJobQueue(redis_url="", key_prefix=f"test:tts:status:{time.time_ns()}", lane_weights=backend_app.VF_TTS_LANE_WEIGHTS),
    )

    request_id = "status_job_1"
    created = int(time.time() * 1000)
    backend_app._TTS_JOB_QUEUE.enqueue(
        lane="free",
        payload={
            "jobId": request_id,
            "uid": "status_user",
            "requestId": request_id,
            "traceId": request_id,
            "engine": "GEM",
            "text": "status check",
            "deadlineAtMs": created + 120_000,
            "maxAttempts": 1,
            "attempts": 0,
        },
    )
    backend_app._record_tts_job_enqueued(job_id=request_id, engine="GEM", created_at_ms=created)

    client = TestClient(backend_app.app)
    response = client.get(f"/tts/jobs/{request_id}", headers={"x-dev-uid": "status_user"})
    assert response.status_code == 200
    payload = response.json()
    assert "deadlineAtMs" in payload
    assert "queueAgeMs" in payload
    assert "queueDepthAtRead" in payload
    assert "engineConcurrencyAtRead" in payload
    assert int(payload["engineConcurrencyAtRead"]) == 3
    assert int(payload["queueDepthAtRead"]) >= 0


def test_admin_tts_queue_metrics_auth_and_payload(monkeypatch) -> None:
    _reset_tts_metrics_state(monkeypatch)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)

    denied = client.get("/admin/tts/queue/metrics", headers={"x-dev-uid": "plain_user"})
    assert denied.status_code == 403

    allowed = client.get("/admin/tts/queue/metrics", headers={"x-dev-uid": "local_admin"})
    assert allowed.status_code == 200
    payload = allowed.json()
    assert payload["ok"] is True
    assert "queue" in payload
    assert "workers" in payload
    assert "engines" in payload
    assert "telemetry" in payload


def test_tts_synthesize_wait_ms_query_override(monkeypatch) -> None:
    _reset_tts_metrics_state(monkeypatch)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)

    captured: dict[str, int] = {}

    def _fake_submit(payload, request, *, sync_wait_ms: int):
        _ = payload
        _ = request
        captured["sync_wait_ms"] = int(sync_wait_ms)
        return backend_app.JSONResponse({"ok": True, "accepted": True}, status_code=202)

    monkeypatch.setattr(backend_app, "_submit_tts_job", _fake_submit)

    client = TestClient(backend_app.app)
    response = client.post(
        "/tts/synthesize?wait_ms=1250",
        headers={"x-dev-uid": "wait_override_user"},
        json={"engine": "GEM", "text": "wait override"},
    )
    assert response.status_code == 202
    assert captured["sync_wait_ms"] == 1250


def _tiny_wav_bytes(duration_frames: int = 240) -> bytes:
    payload = BytesIO()
    with wave.open(payload, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(24000)
        handle.writeframes(b"\x00\x00" * max(1, int(duration_frames)))
    return payload.getvalue()


def test_tts_job_status_payload_live_chunks_cursor_and_audio(tmp_path) -> None:
    chunk0 = tmp_path / "chunk_0000.wav"
    chunk1 = tmp_path / "chunk_0001.wav"
    chunk0.write_bytes(_tiny_wav_bytes(240))
    chunk1.write_bytes(_tiny_wav_bytes(480))

    job = {
        "jobId": "live_status_job",
        "requestId": "live_status_job",
        "traceId": "trace_live_status_job",
        "status": "running",
        "engine": "GEM",
        "createdAtMs": int(time.time() * 1000) - 1000,
        "liveState": {
            "enabled": True,
            "playableChunks": 2,
            "playableDurationMs": 30,
            "chunkCursorNext": 2,
            "chunks": [
                {
                    "index": 0,
                    "contentType": "audio/wav",
                    "durationMs": 10,
                    "textChars": 12,
                    "engine": "GEM",
                    "traceId": "trace0",
                    "path": str(chunk0),
                },
                {
                    "index": 1,
                    "contentType": "audio/wav",
                    "durationMs": 20,
                    "textChars": 18,
                    "engine": "GEM",
                    "traceId": "trace1",
                    "path": str(chunk1),
                },
            ],
        },
    }

    payload = backend_app._tts_job_status_payload(
        job,
        include_result=False,
        include_chunks=True,
        chunk_cursor=1,
        chunk_limit=2,
        include_chunk_audio=False,
    )
    assert payload["live"]["enabled"] is True
    assert payload["chunkCursor"] == 1
    assert payload["chunkCursorNext"] == 2
    assert len(payload["chunks"]) == 1
    assert payload["chunks"][0]["index"] == 1
    assert "audioBase64" not in payload["chunks"][0]

    payload_with_audio = backend_app._tts_job_status_payload(
        job,
        include_result=False,
        include_chunks=True,
        chunk_cursor=0,
        chunk_limit=1,
        include_chunk_audio=True,
    )
    assert payload_with_audio["chunkCursor"] == 0
    assert payload_with_audio["chunkCursorNext"] == 1
    assert len(payload_with_audio["chunks"]) == 1
    assert isinstance(payload_with_audio["chunks"][0].get("audioBase64"), str)
    assert payload_with_audio["chunks"][0]["audioBase64"] != ""


def test_tts_job_cancel_cleans_live_artifacts(monkeypatch, tmp_path) -> None:
    _reset_tts_metrics_state(monkeypatch)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(
        backend_app,
        "_TTS_JOB_QUEUE",
        backend_app.TtsJobQueue(redis_url="", key_prefix=f"test:tts:cancel-live:{time.time_ns()}", lane_weights=backend_app.VF_TTS_LANE_WEIGHTS),
    )
    monkeypatch.setattr(backend_app, "TTS_LIVE_ARTIFACTS_DIR", tmp_path / "tts-live")
    backend_app.TTS_LIVE_ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

    request_id = "cancel_live_job_1"
    backend_app._TTS_JOB_QUEUE.enqueue(
        lane="free",
        payload={
            "jobId": request_id,
            "uid": "cancel_user",
            "requestId": request_id,
            "traceId": request_id,
            "engine": "GEM",
            "text": "cancel test",
            "deadlineAtMs": int(time.time() * 1000) + 60_000,
            "maxAttempts": 1,
            "attempts": 0,
        },
    )

    live_dir = backend_app._tts_live_job_dir(request_id)
    live_dir.mkdir(parents=True, exist_ok=True)
    (live_dir / "chunk_0000.wav").write_bytes(_tiny_wav_bytes(240))
    assert live_dir.exists()

    client = TestClient(backend_app.app)
    response = client.delete(f"/tts/jobs/{request_id}", headers={"x-dev-uid": "cancel_user"})
    assert response.status_code == 200
    assert not live_dir.exists()
