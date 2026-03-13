from __future__ import annotations

import base64
import threading
import time
import wave
from io import BytesIO

import pytest
from fastapi.testclient import TestClient

import app as backend_app


class _DummyRuntimeResponse:
    def __init__(
        self,
        status_code: int = 200,
        *,
        body: dict | None = None,
        content_type: str = "audio/wav",
    ) -> None:
        self.status_code = status_code
        self.content = b"RIFF" + b"\x00" * 512
        self.headers = {
            "content-type": content_type,
            "x-voiceflow-trace-id": "trace_test_tts_queue",
        }
        self._body = body or {}
        self.text = str(self._body) if self._body else ""

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self) -> dict:
        return self._body


def _reset_tts_metrics_state(monkeypatch, *, gem_limit: int = 16, kokoro_limit: int = 12) -> None:
    engine_limits = {
        "GEM": int(gem_limit),
        "KOKORO": int(kokoro_limit),
    }
    monkeypatch.setattr(backend_app, "VF_GEMINI_AUTO_ROTATE_ON_POOL_EXHAUSTED", True)
    monkeypatch.setattr(backend_app, "VF_GEMINI_AUTO_ROTATE_COOLDOWN_MS", 0)
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
            "liveNativeTurnLatencyMs": backend_app.deque(maxlen=backend_app.VF_TTS_QUEUE_METRICS_WINDOW),
            "liveNativeResumeCount": backend_app.deque(maxlen=backend_app.VF_TTS_QUEUE_METRICS_WINDOW),
            "liveNativeFallbackCount": backend_app.deque(maxlen=backend_app.VF_TTS_QUEUE_METRICS_WINDOW),
            "liveNativeChunkGapCount": backend_app.deque(maxlen=backend_app.VF_TTS_QUEUE_METRICS_WINDOW),
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
    backend_app._GEMINI_AUTO_ROTATE_STATE.update(
        {
            "lastRotatedAtMs": 0,
            "lastErrorCode": "",
            "lastTraceId": "",
            "lastJobId": "",
            "lastBeforeFingerprint": "",
            "lastAfterFingerprint": "",
            "lastRotationDetail": "",
        }
    )


def test_live_native_request_shape_accepts_valid_speaker_counts() -> None:
    for speaker_count in (2, 3, 4):
        cast = backend_app._default_live_native_cast(speaker_count)
        payload = {
            "topic": "AI-native live podcasting",
            "speakerCount": speaker_count,
            "cast": cast,
            "limits": {
                "sessionMaxSec": 840,
                "connectionMaxSec": 570,
                "perTurnTimeoutSec": 20,
            },
        }
        backend_app._validate_live_native_request_shape(payload)


def test_live_native_request_shape_rejects_invalid_speaker_count() -> None:
    with pytest.raises(backend_app.HTTPException) as exc_info:
        backend_app._validate_live_native_request_shape(
            {
                "topic": "invalid count",
                "speakerCount": 5,
                "cast": backend_app._default_live_native_cast(4),
            }
        )
    assert exc_info.value.status_code == 400
    assert "speakerCount" in str(exc_info.value.detail)


def test_live_native_request_shape_rejects_missing_cast_fields() -> None:
    with pytest.raises(backend_app.HTTPException) as exc_info:
        backend_app._validate_live_native_request_shape(
            {
                "topic": "missing cast fields",
                "speakerCount": 2,
                "cast": [
                    {"id": "host", "name": "HOST", "role": "anchor", "voice": "Puck"},
                    {"id": "guest", "name": "GUEST", "role": "skeptic"},
                ],
            }
        )
    assert exc_info.value.status_code == 400
    assert "missing required fields" in str(exc_info.value.detail)


def test_live_native_request_shape_rejects_invalid_limits() -> None:
    with pytest.raises(backend_app.HTTPException) as exc_info:
        backend_app._validate_live_native_request_shape(
            {
                "topic": "invalid limits",
                "speakerCount": 4,
                "cast": backend_app._default_live_native_cast(4),
                "limits": {
                    "sessionMaxSec": 300,
                    "connectionMaxSec": 450,
                    "perTurnTimeoutSec": 20,
                },
            }
        )
    assert exc_info.value.status_code == 400
    assert "connectionMaxSec" in str(exc_info.value.detail)


def test_live_jobs_use_priority_lane_bump() -> None:
    assert backend_app._tts_job_lane_for_plan("free", live_stream=False, mode="") == "free"
    assert backend_app._tts_job_lane_for_plan("free", live_stream=True, mode="") == "pro"
    assert backend_app._tts_job_lane_for_plan("pro", live_stream=True, mode="") == "pro_plus"
    assert backend_app._tts_job_lane_for_plan("scale", live_stream=True, mode="live_native") == "pro_plus"


def test_raise_failed_tts_job_sets_error_headers_for_string_detail() -> None:
    with pytest.raises(backend_app.HTTPException) as exc_info:
        backend_app._raise_failed_tts_job(
            {"statusCode": 502, "error": "Runtime gateway timed out."},
            default_headers={"x-test-header": "ok"},
        )
    headers = exc_info.value.headers or {}
    assert str(headers.get("x-test-header") or "") == "ok"
    assert str(headers.get("x-vf-error-code") or "") == backend_app.ENGINE_OVERLOADED
    assert str(headers.get("x-vf-error-reason") or "") == "runtime_gateway_timed_out"


def test_process_tts_job_live_native_turn_order_and_artifacts(monkeypatch, tmp_path) -> None:
    _reset_tts_metrics_state(monkeypatch)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_TTS_LIVE_NATIVE_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_TTS_LIVE_NATIVE_MAX_TURNS", 4)
    monkeypatch.setattr(backend_app, "_finalize_usage", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(backend_app, "_build_tts_history_item", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        backend_app,
        "_TTS_JOB_QUEUE",
        backend_app.TtsJobQueue(redis_url="", key_prefix=f"test:tts:live-native-turn-order:{time.time_ns()}", lane_weights=backend_app.VF_TTS_LANE_WEIGHTS),
    )
    monkeypatch.setattr(backend_app, "TTS_LIVE_ARTIFACTS_DIR", tmp_path / "tts-live")
    monkeypatch.setattr(backend_app, "TTS_RESULT_ARTIFACTS_DIR", tmp_path / "tts-results")
    backend_app.TTS_LIVE_ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    backend_app.TTS_RESULT_ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

    def _fake_turn_text(*, speaker, next_speaker, **_kwargs) -> str:
        current = str((speaker or {}).get("name") or "SPEAKER")
        nxt = str((next_speaker or {}).get("name") or "NEXT")
        return f"{current} shares a point and passes to {nxt}."

    class _RuntimeResponse:
        def __init__(self) -> None:
            self.status_code = 200
            self.content = _tiny_wav_bytes(240)
            self.headers = {
                "content-type": "audio/wav",
                "x-voiceflow-trace-id": "trace_live_native_runtime",
            }
            self.text = ""

        @property
        def ok(self) -> bool:
            return True

        def json(self) -> dict:
            return {}

    monkeypatch.setattr(backend_app, "_runtime_generate_live_native_turn_text", _fake_turn_text)
    monkeypatch.setattr(backend_app, "_runtime_tts_request_with_gemini_failover", lambda *_args, **_kwargs: _RuntimeResponse())

    job_id = "live_native_turn_order_job"
    payload = {
        "jobId": job_id,
        "uid": "live_turn_user",
        "requestId": job_id,
        "traceId": f"trace_{job_id}",
        "engine": "GEM",
        "text": "Live native deterministic handoff test",
        "voiceId": "Puck",
        "voiceName": "Puck",
        "planName": "Free",
        "planKey": "free",
        "adminLimitBypass": True,
        "idempotencyKey": f"idem_{job_id}",
        "runtimeBase": "http://127.0.0.1:7810",
        "runtimePath": "/synthesize",
        "upstreamPayload": {"text": "seed", "language": "en"},
        "deadlineAtMs": int(time.time() * 1000) + 60_000,
        "maxAttempts": 1,
        "attempts": 0,
        "mode": "live_native",
        "liveNative": {
            "topic": "AI-native podcasting",
            "durationSec": 30,
            "speakerCount": 2,
            "cast": backend_app._default_live_native_cast(2),
            "limits": {
                "sessionMaxSec": 840,
                "connectionMaxSec": 570,
                "perTurnTimeoutSec": 20,
            },
            "recovery": {
                "strategy": "resume_then_fallback",
                "maxResumeAttempts": 1,
                "fallbackMode": "runtime_nonlive_same_cast",
            },
            "output": {
                "autoSave": True,
                "audioFormat": "wav",
                "includeTranscript": True,
            },
        },
    }
    backend_app._TTS_JOB_QUEUE.enqueue(lane="free", payload=payload)
    backend_app._record_tts_job_enqueued(job_id=job_id, engine="GEM", created_at_ms=int(time.time() * 1000))
    backend_app._process_tts_job(payload, "worker-live-native-turn-order")

    completed = backend_app._TTS_JOB_QUEUE.get(job_id) or {}
    assert str(completed.get("status") or "") == "completed"
    assert str(completed.get("mode") or "") == "live_native"
    live_state = completed.get("liveState") if isinstance(completed.get("liveState"), dict) else {}
    chunks = list(live_state.get("chunks") or [])
    assert len(chunks) >= 2
    assert str(chunks[0].get("speakerId") or "") == "host"
    assert str(chunks[1].get("speakerId") or "") == "cohost"

    summary = completed.get("liveNativeSummary") if isinstance(completed.get("liveNativeSummary"), dict) else {}
    assert int(summary.get("fallbackCount") or 0) == 0
    artifacts = completed.get("liveNativeArtifacts") if isinstance(completed.get("liveNativeArtifacts"), dict) else {}
    assert bool((artifacts.get("transcriptJson") or {}).get("downloadUrl"))
    assert bool((artifacts.get("summaryJson") or {}).get("downloadUrl"))


def test_process_tts_job_live_native_runtime_failure_fallbacks_and_completes(monkeypatch, tmp_path) -> None:
    _reset_tts_metrics_state(monkeypatch)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_TTS_LIVE_NATIVE_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_TTS_LIVE_NATIVE_MAX_TURNS", 2)
    monkeypatch.setattr(backend_app, "_finalize_usage", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(backend_app, "_build_tts_history_item", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        backend_app,
        "_TTS_JOB_QUEUE",
        backend_app.TtsJobQueue(redis_url="", key_prefix=f"test:tts:live-native-fallback:{time.time_ns()}", lane_weights=backend_app.VF_TTS_LANE_WEIGHTS),
    )
    monkeypatch.setattr(backend_app, "TTS_LIVE_ARTIFACTS_DIR", tmp_path / "tts-live")
    monkeypatch.setattr(backend_app, "TTS_RESULT_ARTIFACTS_DIR", tmp_path / "tts-results")
    backend_app.TTS_LIVE_ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    backend_app.TTS_RESULT_ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

    runtime_calls = {"count": 0}

    def _fake_turn_text(*_args, **_kwargs) -> str:
        return "Quick response with a handoff."

    class _RuntimeResponse:
        def __init__(self) -> None:
            self.status_code = 200
            self.content = _tiny_wav_bytes(220)
            self.headers = {
                "content-type": "audio/wav",
                "x-voiceflow-trace-id": "trace_live_native_fallback_runtime",
            }
            self.text = ""

        @property
        def ok(self) -> bool:
            return True

        def json(self) -> dict:
            return {}

    def _fake_runtime(*_args, **kwargs):
        runtime_calls["count"] += 1
        body = kwargs.get("json") if isinstance(kwargs.get("json"), dict) else {}
        if runtime_calls["count"] == 1 and str(body.get("model") or "").strip():
            raise RuntimeError("simulated live transport disconnect")
        return _RuntimeResponse()

    monkeypatch.setattr(backend_app, "_runtime_generate_live_native_turn_text", _fake_turn_text)
    monkeypatch.setattr(backend_app, "_runtime_tts_request_with_gemini_failover", _fake_runtime)

    job_id = "live_native_fallback_job"
    payload = {
        "jobId": job_id,
        "uid": "live_fallback_user",
        "requestId": job_id,
        "traceId": f"trace_{job_id}",
        "engine": "GEM",
        "text": "Live native fallback test",
        "voiceId": "Puck",
        "voiceName": "Puck",
        "planName": "Free",
        "planKey": "free",
        "adminLimitBypass": True,
        "idempotencyKey": f"idem_{job_id}",
        "runtimeBase": "http://127.0.0.1:7810",
        "runtimePath": "/synthesize",
        "upstreamPayload": {"text": "seed", "language": "en"},
        "deadlineAtMs": int(time.time() * 1000) + 60_000,
        "maxAttempts": 1,
        "attempts": 0,
        "mode": "live_native",
        "liveNative": {
            "topic": "Live recovery and fallback",
            "durationSec": 30,
            "speakerCount": 2,
            "cast": backend_app._default_live_native_cast(2),
            "limits": {
                "sessionMaxSec": 840,
                "connectionMaxSec": 570,
                "perTurnTimeoutSec": 20,
            },
            "recovery": {
                "strategy": "resume_then_fallback",
                "maxResumeAttempts": 0,
                "fallbackMode": "runtime_nonlive_same_cast",
            },
            "output": {
                "autoSave": True,
                "audioFormat": "wav",
                "includeTranscript": True,
            },
        },
    }
    backend_app._TTS_JOB_QUEUE.enqueue(lane="free", payload=payload)
    backend_app._record_tts_job_enqueued(job_id=job_id, engine="GEM", created_at_ms=int(time.time() * 1000))
    backend_app._process_tts_job(payload, "worker-live-native-fallback")

    completed = backend_app._TTS_JOB_QUEUE.get(job_id) or {}
    assert str(completed.get("status") or "") == "completed"
    summary = completed.get("liveNativeSummary") if isinstance(completed.get("liveNativeSummary"), dict) else {}
    assert int(summary.get("fallbackCount") or 0) >= 1
    orchestration = completed.get("liveOrchestration") if isinstance(completed.get("liveOrchestration"), dict) else {}
    assert str(orchestration.get("status") or "") == "completed"


def test_process_tts_job_respects_engine_semaphore_limit(monkeypatch) -> None:
    _reset_tts_metrics_state(monkeypatch, gem_limit=2, kokoro_limit=1)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_TTS_QUEUE_ENABLED", True)
    monkeypatch.setattr(backend_app, "_finalize_usage", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        backend_app,
        "_TTS_JOB_QUEUE",
        backend_app.TtsJobQueue(redis_url="", key_prefix=f"test:tts:queue:{time.time_ns()}", lane_weights=backend_app.VF_TTS_LANE_WEIGHTS),
    )

    tracker = {"active": 0, "max": 0}
    tracker_lock = threading.Lock()

    def _fake_runtime_request(*_args, **_kwargs):
        with tracker_lock:
            tracker["active"] += 1
            tracker["max"] = max(tracker["max"], tracker["active"])
        time.sleep(0.05)
        with tracker_lock:
            tracker["active"] -= 1
        return _DummyRuntimeResponse()

    monkeypatch.setattr(backend_app, "_runtime_http_request", _fake_runtime_request)

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
            "postTtsDisable": True,
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


def test_tts_job_gemini_capacity_pressure_fails_without_requeue(monkeypatch) -> None:
    _reset_tts_metrics_state(monkeypatch)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_TTS_QUEUE_ENABLED", True)
    monkeypatch.setattr(
        backend_app,
        "_TTS_JOB_QUEUE",
        backend_app.TtsJobQueue(
            redis_url="",
            key_prefix=f"test:tts:gemini-capacity-fast-fail:{time.time_ns()}",
            lane_weights=backend_app.VF_TTS_LANE_WEIGHTS,
        ),
    )

    requeues = {"count": 0}

    def _fake_runtime_request(*_args, **_kwargs):
        return _DummyRuntimeResponse(
            status_code=503,
            body={
                "detail": {
                    "error": "Gemini key pool is temporarily overloaded.",
                    "summary": "Gemini TTS capacity is saturated (availableLanes=0, keyPoolSize=64).",
                    "errorCode": "GEMINI_KEY_POOL_OVERLOADED",
                    "reason": "capacity_pressure",
                    "retryAfterMs": 45000,
                    "availableLanes": 0,
                }
            },
            content_type="application/json",
        )

    monkeypatch.setattr(backend_app, "_runtime_http_request", _fake_runtime_request)
    monkeypatch.setattr(
        backend_app,
        "_record_tts_job_requeued",
        lambda **_kwargs: requeues.__setitem__("count", requeues["count"] + 1),
    )

    job_payload = {
        "jobId": "gemini_capacity_pressure_job_1",
        "uid": "gemini_capacity_pressure_user",
        "requestId": "gemini_capacity_pressure_req_1",
        "traceId": "gemini_capacity_pressure_trace_1",
        "engine": "GEM",
        "text": "capacity pressure should fail fast",
        "voiceId": "Fenrir",
        "voiceName": "Fenrir",
        "planName": "Free",
        "planKey": "free",
        "adminLimitBypass": True,
        "runtimeBase": "http://127.0.0.1:7810",
        "runtimePath": "/synthesize",
        "upstreamPayload": {"text": "capacity pressure should fail fast", "voiceName": "Fenrir"},
        "postTtsDisable": True,
        "deadlineAtMs": int(time.time() * 1000) + 60_000,
        "maxAttempts": 3,
        "attempts": 0,
    }
    backend_app._TTS_JOB_QUEUE.enqueue(lane="free", payload=job_payload)
    backend_app._record_tts_job_enqueued(job_id=job_payload["jobId"], engine="GEM", created_at_ms=int(time.time() * 1000))

    backend_app._process_tts_job(job_payload, "worker-gemini-capacity-fast-fail")

    failed = backend_app._TTS_JOB_QUEUE.get(job_payload["jobId"]) or {}
    assert str(failed.get("status") or "") == "failed"
    assert int(failed.get("statusCode") or 0) == 503
    error = failed.get("error") if isinstance(failed.get("error"), dict) else {}
    assert str(error.get("errorCode") or "") == "GEMINI_KEY_POOL_OVERLOADED"
    assert str(error.get("reason") or "") == "capacity_pressure"
    assert int(error.get("retryAfterMs") or 0) == 45000
    assert requeues["count"] == 0


def test_tts_job_gemini_pool_exhaustion_auto_rotates_and_retries_once(monkeypatch) -> None:
    _reset_tts_metrics_state(monkeypatch)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_TTS_QUEUE_ENABLED", True)
    monkeypatch.setattr(
        backend_app,
        "_TTS_JOB_QUEUE",
        backend_app.TtsJobQueue(
            redis_url="",
            key_prefix=f"test:tts:gemini-auto-rotate:{time.time_ns()}",
            lane_weights=backend_app.VF_TTS_LANE_WEIGHTS,
        ),
    )
    monkeypatch.setattr(backend_app._TTS_JOB_QUEUE, "dequeue_next", lambda: None)

    runtime_calls = {"count": 0}
    rotations = {"count": 0}

    def _fake_runtime_request(*_args, **_kwargs):
        runtime_calls["count"] += 1
        if runtime_calls["count"] == 1:
            return _DummyRuntimeResponse(
                status_code=502,
                body={
                    "detail": {
                        "error": "Gemini model attempts failed.",
                        "summary": "Gemini TTS capacity is saturated.",
                        "errorCode": "GEMINI_UPSTREAM_MODEL_FAILED",
                        "classification": "upstream_failure",
                        "poolExhausted": True,
                        "attemptsUsed": 1,
                        "retryAfterMs": 0,
                    }
                },
                content_type="application/json",
            )
        return _DummyRuntimeResponse()

    def _fake_rotate(*, steps: int = 1):
        rotations["count"] += 1
        assert steps == 1
        return {
            "ok": True,
            "detail": "Gemini free pool rotated and reloaded.",
            "rotation": {
                "beforeHead": {"fingerprint": "before123"},
                "afterHead": {"fingerprint": "after456"},
            },
            "warnings": [],
        }

    monkeypatch.setattr(backend_app, "_runtime_http_request", _fake_runtime_request)
    monkeypatch.setattr(backend_app, "_rotate_gemini_free_pool_once", _fake_rotate)

    job_payload = {
        "jobId": "gemini_auto_rotate_job_1",
        "uid": "gemini_auto_rotate_user",
        "requestId": "gemini_auto_rotate_req_1",
        "traceId": "gemini_auto_rotate_trace_1",
        "engine": "GEM",
        "text": "auto rotate should recover the request",
        "voiceId": "Fenrir",
        "voiceName": "Fenrir",
        "planName": "Free",
        "planKey": "free",
        "adminLimitBypass": True,
        "runtimeBase": "http://127.0.0.1:7810",
        "runtimePath": "/synthesize",
        "upstreamPayload": {"text": "auto rotate should recover the request", "voiceName": "Fenrir"},
        "postTtsDisable": True,
        "deadlineAtMs": int(time.time() * 1000) + 60_000,
        "maxAttempts": 1,
        "attempts": 0,
    }
    backend_app._TTS_JOB_QUEUE.enqueue(lane="free", payload=job_payload)
    backend_app._record_tts_job_enqueued(job_id=job_payload["jobId"], engine="GEM", created_at_ms=int(time.time() * 1000))

    backend_app._process_tts_job(job_payload, "worker-gemini-auto-rotate")

    completed = backend_app._TTS_JOB_QUEUE.get(job_payload["jobId"]) or {}
    assert str(completed.get("status") or "") == "completed"
    assert runtime_calls["count"] == 2
    assert rotations["count"] == 1
    assert str(backend_app._GEMINI_AUTO_ROTATE_STATE.get("lastErrorCode") or "") == "GEMINI_UPSTREAM_MODEL_FAILED"
    assert str(backend_app._GEMINI_AUTO_ROTATE_STATE.get("lastJobId") or "") == job_payload["jobId"]
    assert str(backend_app._GEMINI_AUTO_ROTATE_STATE.get("lastTraceId") or "") == job_payload["traceId"]
    assert str(backend_app._GEMINI_AUTO_ROTATE_STATE.get("lastAfterFingerprint") or "") == "after456"


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


def test_tts_job_strict_post_tts_flags_do_not_fail_job_after_vc_removal(monkeypatch) -> None:
    _reset_tts_metrics_state(monkeypatch)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_TTS_QUEUE_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_TTS_POST_LLVC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_TTS_POST_LLVC_REQUIRED", True)
    monkeypatch.setattr(
        backend_app,
        "_TTS_JOB_QUEUE",
        backend_app.TtsJobQueue(redis_url="", key_prefix=f"test:tts:post-tts-strict:{time.time_ns()}", lane_weights=backend_app.VF_TTS_LANE_WEIGHTS),
    )
    monkeypatch.setattr(backend_app, "_runtime_http_request", lambda *args, **kwargs: _DummyRuntimeResponse())

    def _raise_conversion_failure(*_args, **_kwargs):
        raise RuntimeError("llvc runtime unavailable")

    monkeypatch.setattr(backend_app, "_convert_tts_audio_with_llvc_runtime", _raise_conversion_failure)

    job_payload = {
        "jobId": "strict_post_tts_job_1",
        "uid": "strict_post_tts_user",
        "requestId": "strict_post_tts_req_1",
        "traceId": "strict_post_tts_trace_1",
        "engine": "GEM",
        "text": "strict post tts test",
        "voiceId": "Fenrir",
        "voiceName": "Fenrir",
        "planName": "Free",
        "planKey": "free",
        "adminLimitBypass": True,
        "runtimeBase": "http://127.0.0.1:7810",
        "runtimePath": "/synthesize",
        "upstreamPayload": {"text": "strict post tts test"},
        "deadlineAtMs": int(time.time() * 1000) + 60_000,
        "maxAttempts": 1,
        "attempts": 0,
    }
    backend_app._TTS_JOB_QUEUE.enqueue(lane="free", payload=job_payload)
    backend_app._record_tts_job_enqueued(job_id=job_payload["jobId"], engine="GEM", created_at_ms=int(time.time() * 1000))

    backend_app._process_tts_job(job_payload, "worker-strict-post-tts")

    completed = backend_app._TTS_JOB_QUEUE.get(job_payload["jobId"]) or {}
    assert str(completed.get("status") or "") == "completed"
    result = completed.get("result") if isinstance(completed.get("result"), dict) else {}
    headers = result.get("headers") if isinstance(result.get("headers"), dict) else {}
    assert str(headers.get("x-vf-post-tts-conversion") or "") == "disabled"


def test_tts_job_silent_post_tts_output_bypasses_to_original_audio_when_not_required(monkeypatch) -> None:
    _reset_tts_metrics_state(monkeypatch)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_TTS_QUEUE_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_TTS_POST_LLVC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_TTS_POST_LLVC_REQUIRED", False)
    monkeypatch.setattr(
        backend_app,
        "_TTS_JOB_QUEUE",
        backend_app.TtsJobQueue(
            redis_url="",
            key_prefix=f"test:tts:post-tts-silent-bypass:{time.time_ns()}",
            lane_weights=backend_app.VF_TTS_LANE_WEIGHTS,
        ),
    )

    class _AudibleRuntimeResponse:
        def __init__(self) -> None:
            self.status_code = 200
            self.content = _tiny_wav_bytes(720, sample_value=1600)
            self.headers = {
                "content-type": "audio/wav",
                "x-voiceflow-trace-id": "trace_post_tts_silent_bypass",
            }
            self.text = ""

        @property
        def ok(self) -> bool:
            return True

    monkeypatch.setattr(backend_app, "_runtime_http_request", lambda *_args, **_kwargs: _AudibleRuntimeResponse())
    monkeypatch.setattr(
        backend_app,
        "_convert_tts_audio_with_llvc_runtime",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("Voice-transfer runtime returned silent audio.")),
    )

    job_payload = {
        "jobId": "post_tts_silent_bypass_job_1",
        "uid": "post_tts_silent_bypass_user",
        "requestId": "post_tts_silent_bypass_req_1",
        "traceId": "post_tts_silent_bypass_trace_1",
        "engine": "GEM",
        "text": "post tts silent bypass test",
        "voiceId": "Fenrir",
        "voiceName": "Fenrir",
        "planName": "Free",
        "planKey": "free",
        "adminLimitBypass": True,
        "runtimeBase": "http://127.0.0.1:7810",
        "runtimePath": "/synthesize",
        "upstreamPayload": {"text": "post tts silent bypass test"},
        "deadlineAtMs": int(time.time() * 1000) + 60_000,
        "maxAttempts": 1,
        "attempts": 0,
    }
    backend_app._TTS_JOB_QUEUE.enqueue(lane="free", payload=job_payload)
    backend_app._record_tts_job_enqueued(job_id=job_payload["jobId"], engine="GEM", created_at_ms=int(time.time() * 1000))

    backend_app._process_tts_job(job_payload, "worker-post-tts-silent-bypass")

    completed = backend_app._TTS_JOB_QUEUE.get(job_payload["jobId"]) or {}
    assert str(completed.get("status") or "") == "completed"
    result = completed.get("result") if isinstance(completed.get("result"), dict) else {}
    headers = result.get("headers") if isinstance(result.get("headers"), dict) else {}
    assert str(headers.get("x-vf-post-tts-conversion") or "") == "disabled"
    audio_base64 = str(result.get("audioBase64") or "")
    assert audio_base64
    audio_bytes = base64.b64decode(audio_base64)
    assert backend_app._wav_has_nonzero_signal(audio_bytes) is True


def test_tts_job_post_tts_disable_flag_is_ignored_and_response_stays_disabled(monkeypatch) -> None:
    _reset_tts_metrics_state(monkeypatch)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_TTS_QUEUE_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_TTS_POST_LLVC_ENABLED", True)
    monkeypatch.setattr(
        backend_app,
        "_TTS_JOB_QUEUE",
        backend_app.TtsJobQueue(
            redis_url="",
            key_prefix=f"test:tts:post-tts-disabled:{time.time_ns()}",
            lane_weights=backend_app.VF_TTS_LANE_WEIGHTS,
        ),
    )

    llvc_calls = {"count": 0}

    def _fake_runtime_request(*_args, **_kwargs):
        return _DummyRuntimeResponse()

    def _fake_convert(*_args, **_kwargs):
        llvc_calls["count"] += 1
        return _tiny_wav_bytes(), {"x-vf-post-tts-conversion": "voice-transfer"}

    monkeypatch.setattr(backend_app, "_runtime_http_request", _fake_runtime_request)
    monkeypatch.setattr(backend_app, "_convert_tts_audio_with_llvc_runtime", _fake_convert)

    job_payload = {
        "jobId": "post_tts_disabled_job_1",
        "uid": "post_tts_disabled_user",
        "requestId": "post_tts_disabled_req_1",
        "traceId": "post_tts_disabled_trace_1",
        "engine": "GEM",
        "text": "post tts disabled test",
        "voiceId": "Fenrir",
        "voiceName": "Fenrir",
        "planName": "Free",
        "planKey": "free",
        "adminLimitBypass": True,
        "runtimeBase": "http://127.0.0.1:7810",
        "runtimePath": "/synthesize",
        "upstreamPayload": {"text": "post tts disabled test"},
        "postTtsDisable": True,
        "deadlineAtMs": int(time.time() * 1000) + 60_000,
        "maxAttempts": 1,
        "attempts": 0,
    }
    backend_app._TTS_JOB_QUEUE.enqueue(lane="free", payload=job_payload)
    backend_app._record_tts_job_enqueued(job_id=job_payload["jobId"], engine="GEM", created_at_ms=int(time.time() * 1000))

    backend_app._process_tts_job(job_payload, "worker-post-tts-disabled")

    completed = backend_app._TTS_JOB_QUEUE.get(job_payload["jobId"]) or {}
    assert str(completed.get("status") or "") == "completed"
    result = completed.get("result") if isinstance(completed.get("result"), dict) else {}
    headers = result.get("headers") if isinstance(result.get("headers"), dict) else {}
    assert str(headers.get("x-vf-post-tts-conversion") or "") == "disabled"
    assert llvc_calls["count"] == 0


def test_tts_job_kokoro_bypasses_post_tts_without_request_flag(monkeypatch) -> None:
    _reset_tts_metrics_state(monkeypatch)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_TTS_QUEUE_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_TTS_POST_LLVC_ENABLED", True)
    monkeypatch.setattr(
        backend_app,
        "_TTS_JOB_QUEUE",
        backend_app.TtsJobQueue(
            redis_url="",
            key_prefix=f"test:tts:kokoro-post-tts-disabled:{time.time_ns()}",
            lane_weights=backend_app.VF_TTS_LANE_WEIGHTS,
        ),
    )

    llvc_calls = {"count": 0}

    def _fake_runtime_request(*_args, **_kwargs):
        return _DummyRuntimeResponse()

    def _fake_convert(*_args, **_kwargs):
        llvc_calls["count"] += 1
        return _tiny_wav_bytes(), {"x-vf-post-tts-conversion": "voice-transfer"}

    monkeypatch.setattr(backend_app, "_runtime_http_request", _fake_runtime_request)
    monkeypatch.setattr(backend_app, "_convert_tts_audio_with_llvc_runtime", _fake_convert)

    job_payload = {
        "jobId": "kokoro_post_tts_disabled_job_1",
        "uid": "kokoro_post_tts_disabled_user",
        "requestId": "kokoro_post_tts_disabled_req_1",
        "traceId": "kokoro_post_tts_disabled_trace_1",
        "engine": "KOKORO",
        "text": "kokoro bypass post tts test",
        "voiceId": "am_fenrir",
        "voiceName": "am_fenrir",
        "planName": "Free",
        "planKey": "free",
        "adminLimitBypass": True,
        "runtimeBase": "http://127.0.0.1:7820",
        "runtimePath": "/synthesize",
        "upstreamPayload": {"text": "kokoro bypass post tts test", "voiceName": "am_fenrir"},
        "postTtsDisable": False,
        "deadlineAtMs": int(time.time() * 1000) + 60_000,
        "maxAttempts": 1,
        "attempts": 0,
    }
    backend_app._TTS_JOB_QUEUE.enqueue(lane="free", payload=job_payload)
    backend_app._record_tts_job_enqueued(job_id=job_payload["jobId"], engine="KOKORO", created_at_ms=int(time.time() * 1000))

    backend_app._process_tts_job(job_payload, "worker-kokoro-post-tts-disabled")

    completed = backend_app._TTS_JOB_QUEUE.get(job_payload["jobId"]) or {}
    assert str(completed.get("status") or "") == "completed"
    result = completed.get("result") if isinstance(completed.get("result"), dict) else {}
    headers = result.get("headers") if isinstance(result.get("headers"), dict) else {}
    assert str(headers.get("x-vf-post-tts-conversion") or "") == "disabled_for_kokoro"
    assert llvc_calls["count"] == 0


def test_tts_job_live_pipeline_llvc_concurrency_respects_limit(monkeypatch) -> None:
    _reset_tts_metrics_state(monkeypatch)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_TTS_QUEUE_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_TTS_LIVE_STREAM_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_TTS_LIVE_PIPELINE_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_TTS_LIVE_SYNTH_CONCURRENCY", 2)
    monkeypatch.setattr(backend_app, "VF_TTS_LIVE_LLVC_CONCURRENCY", 2)
    monkeypatch.setattr(backend_app, "VF_TTS_POST_LLVC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_TTS_POST_LLVC_REQUIRED", True)
    monkeypatch.setattr(
        backend_app,
        "_TTS_JOB_QUEUE",
        backend_app.TtsJobQueue(redis_url="", key_prefix=f"test:tts:live-pipeline:{time.time_ns()}", lane_weights=backend_app.VF_TTS_LANE_WEIGHTS),
    )
    monkeypatch.setattr(
        backend_app,
        "_split_text_live_chunks",
        lambda **_kwargs: [
            {"text": "chunk one", "textChars": 9, "wordCount": 2},
            {"text": "chunk two", "textChars": 9, "wordCount": 2},
            {"text": "chunk three", "textChars": 11, "wordCount": 2},
            {"text": "chunk four", "textChars": 10, "wordCount": 2},
        ],
    )

    class _OkResponse:
        def __init__(self) -> None:
            self.status_code = 200
            self.ok = True
            self.content = _tiny_wav_bytes(720)
            self.headers = {"content-type": "audio/wav", "x-voiceflow-trace-id": "trace_live_pipeline"}

    monkeypatch.setattr(backend_app, "_runtime_http_request", lambda *_args, **_kwargs: _OkResponse())

    tracker = {"active": 0, "max": 0}
    tracker_lock = threading.Lock()

    def _fake_convert(*_args, **_kwargs):
        with tracker_lock:
            tracker["active"] += 1
            tracker["max"] = max(tracker["max"], tracker["active"])
        time.sleep(0.04)
        with tracker_lock:
            tracker["active"] -= 1
        return _tiny_wav_bytes(720), {"x-vf-post-tts-conversion": "voice-transfer"}

    monkeypatch.setattr(backend_app, "_convert_tts_audio_with_llvc_runtime", _fake_convert)

    job_payload = {
        "jobId": "live_pipeline_job_1",
        "uid": "live_pipeline_user",
        "requestId": "live_pipeline_req_1",
        "traceId": "live_pipeline_trace_1",
        "engine": "GEM",
        "text": "live pipeline strict llvc",
        "voiceId": "Fenrir",
        "voiceName": "Fenrir",
        "planName": "Free",
        "planKey": "free",
        "adminLimitBypass": True,
        "runtimeBase": "http://127.0.0.1:7810",
        "runtimePath": "/synthesize",
        "upstreamPayload": {
            "text": "live pipeline strict llvc",
            "multi_speaker_line_map": [{"lineIndex": 0, "speaker": "Narrator", "text": "line"}],
        },
        "deadlineAtMs": int(time.time() * 1000) + 60_000,
        "maxAttempts": 1,
        "attempts": 0,
        "liveStream": True,
    }
    backend_app._process_tts_job(job_payload, "worker-live-pipeline")

    assert tracker["max"] == 0
    chunk_samples = list(backend_app._TTS_QUEUE_TELEMETRY.get("liveChunkCount") or [])
    assert chunk_samples
    assert int(chunk_samples[-1]) == 4


def test_tts_job_live_stream_kokoro_skips_post_tts_conversion(monkeypatch) -> None:
    _reset_tts_metrics_state(monkeypatch)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_TTS_QUEUE_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_TTS_LIVE_STREAM_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_TTS_POST_LLVC_ENABLED", True)
    monkeypatch.setattr(
        backend_app,
        "_TTS_JOB_QUEUE",
        backend_app.TtsJobQueue(
            redis_url="",
            key_prefix=f"test:tts:kokoro-live-post-tts-disabled:{time.time_ns()}",
            lane_weights=backend_app.VF_TTS_LANE_WEIGHTS,
        ),
    )
    monkeypatch.setattr(
        backend_app,
        "_split_text_live_chunks",
        lambda **_kwargs: [
            {"text": "chunk one", "textChars": 9, "wordCount": 2},
            {"text": "chunk two", "textChars": 9, "wordCount": 2},
        ],
    )

    class _OkResponse:
        def __init__(self) -> None:
            self.status_code = 200
            self.ok = True
            self.content = _tiny_wav_bytes(720)
            self.headers = {"content-type": "audio/wav", "x-voiceflow-trace-id": "trace_live_kokoro"}

    llvc_calls = {"count": 0}

    def _fake_convert(*_args, **_kwargs):
        llvc_calls["count"] += 1
        return _tiny_wav_bytes(720), {"x-vf-post-tts-conversion": "voice-transfer"}

    monkeypatch.setattr(backend_app, "_runtime_http_request", lambda *_args, **_kwargs: _OkResponse())
    monkeypatch.setattr(backend_app, "_convert_tts_audio_with_llvc_runtime", _fake_convert)

    job_payload = {
        "jobId": "kokoro_live_post_tts_disabled_job_1",
        "uid": "kokoro_live_post_tts_disabled_user",
        "requestId": "kokoro_live_post_tts_disabled_req_1",
        "traceId": "kokoro_live_post_tts_disabled_trace_1",
        "engine": "KOKORO",
        "text": "kokoro live stream bypass post tts",
        "voiceId": "am_fenrir",
        "voiceName": "am_fenrir",
        "planName": "Free",
        "planKey": "free",
        "adminLimitBypass": True,
        "runtimeBase": "http://127.0.0.1:7820",
        "runtimePath": "/synthesize",
        "upstreamPayload": {"text": "kokoro live stream bypass post tts", "voiceName": "am_fenrir"},
        "postTtsDisable": False,
        "liveStream": True,
        "liveChunkChars": 220,
        "liveChunkWords": 45,
        "deadlineAtMs": int(time.time() * 1000) + 60_000,
        "maxAttempts": 1,
        "attempts": 0,
    }

    backend_app._TTS_JOB_QUEUE.enqueue(lane="free", payload=job_payload)
    backend_app._record_tts_job_enqueued(job_id=job_payload["jobId"], engine="KOKORO", created_at_ms=int(time.time() * 1000))
    backend_app._process_tts_job(job_payload, "worker-kokoro-live-post-tts-disabled")

    completed = backend_app._TTS_JOB_QUEUE.get(job_payload["jobId"]) or {}
    assert str(completed.get("status") or "") == "completed"
    result = completed.get("result") if isinstance(completed.get("result"), dict) else {}
    headers = result.get("headers") if isinstance(result.get("headers"), dict) else {}
    assert str(headers.get("x-vf-post-tts-conversion") or "") == "disabled_for_kokoro"
    assert llvc_calls["count"] == 0


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


def test_tts_synthesize_uses_fast_ack_default_wait_ms(monkeypatch) -> None:
    _reset_tts_metrics_state(monkeypatch)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_TTS_QUEUE_SYNC_WAIT_MS", 1200)

    captured: dict[str, int] = {}

    def _fake_submit(payload, request, *, sync_wait_ms: int):
        _ = payload
        _ = request
        captured["sync_wait_ms"] = int(sync_wait_ms)
        return backend_app.JSONResponse({"ok": True, "accepted": True}, status_code=202)

    monkeypatch.setattr(backend_app, "_submit_tts_job", _fake_submit)

    client = TestClient(backend_app.app)
    response = client.post(
        "/tts/synthesize",
        headers={"x-dev-uid": "fast_ack_user"},
        json={"engine": "GEM", "text": "fast ack default wait"},
    )
    assert response.status_code == 202
    assert captured["sync_wait_ms"] == 1200


@pytest.mark.parametrize(
    ("exc", "expected_status", "expected_code", "expected_reason"),
    [
        (
            backend_app.RuntimeHttpError(
                method="POST",
                url="http://127.0.0.1:7810/synthesize",
                category="timeout",
                message="upstream timed out",
                attempt=1,
                retryable=True,
            ),
            504,
            backend_app.RUNTIME_TIMEOUT,
            "runtime_timeout",
        ),
        (
            backend_app.RuntimeHttpError(
                method="POST",
                url="http://127.0.0.1:7810/synthesize",
                category="connection",
                message="connection refused",
                attempt=1,
                retryable=True,
            ),
            502,
            backend_app.RUNTIME_UNAVAILABLE,
            "runtime_unavailable",
        ),
        (
            RuntimeError("malformed runtime payload"),
            502,
            backend_app.RUNTIME_BAD_RESPONSE,
            "runtime_bad_response",
        ),
    ],
)
def test_tts_job_runtime_failure_maps_to_stable_error_codes(
    monkeypatch,
    exc: Exception,
    expected_status: int,
    expected_code: str,
    expected_reason: str,
) -> None:
    _reset_tts_metrics_state(monkeypatch)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_TTS_QUEUE_ENABLED", True)
    monkeypatch.setattr(
        backend_app,
        "_TTS_JOB_QUEUE",
        backend_app.TtsJobQueue(
            redis_url="",
            key_prefix=f"test:tts:runtime-stable-codes:{time.time_ns()}",
            lane_weights=backend_app.VF_TTS_LANE_WEIGHTS,
        ),
    )

    def _raise_runtime(*_args, **_kwargs):
        raise exc

    monkeypatch.setattr(backend_app, "_runtime_tts_request_with_gemini_failover", _raise_runtime)

    job_payload = {
        "jobId": "runtime_stable_code_job_1",
        "uid": "runtime_stable_code_user",
        "requestId": "runtime_stable_code_req_1",
        "traceId": "runtime_stable_code_trace_1",
        "engine": "GEM",
        "text": "runtime stable code mapping",
        "voiceId": "Fenrir",
        "voiceName": "Fenrir",
        "planName": "Free",
        "planKey": "free",
        "adminLimitBypass": True,
        "runtimeBase": "http://127.0.0.1:7810",
        "runtimePath": "/synthesize",
        "upstreamPayload": {"text": "runtime stable code mapping", "voiceName": "Fenrir"},
        "deadlineAtMs": int(time.time() * 1000) + 60_000,
        "maxAttempts": 1,
        "attempts": 0,
    }
    backend_app._TTS_JOB_QUEUE.enqueue(lane="free", payload=job_payload)
    backend_app._record_tts_job_enqueued(job_id=job_payload["jobId"], engine="GEM", created_at_ms=int(time.time() * 1000))

    backend_app._process_tts_job(job_payload, "worker-runtime-stable-codes")

    failed = backend_app._TTS_JOB_QUEUE.get(job_payload["jobId"]) or {}
    assert str(failed.get("status") or "") == "failed"
    assert int(failed.get("statusCode") or 0) == int(expected_status)
    detail = failed.get("error") if isinstance(failed.get("error"), dict) else {}
    assert str(detail.get("errorCode") or "") == expected_code
    assert str(detail.get("reason") or "") == expected_reason


def test_live_native_first_chunk_sla_deadline_triggers_fallback(monkeypatch, tmp_path) -> None:
    _reset_tts_metrics_state(monkeypatch)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_TTS_QUEUE_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_TTS_LIVE_NATIVE_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_TTS_LIVE_FIRST_CHUNK_TARGET_MS", 10)
    monkeypatch.setattr(backend_app, "VF_TTS_LIVE_NATIVE_MAX_TURNS", 2)
    monkeypatch.setattr(backend_app, "_finalize_usage", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(backend_app, "_build_tts_history_item", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        backend_app,
        "_TTS_JOB_QUEUE",
        backend_app.TtsJobQueue(
            redis_url="",
            key_prefix=f"test:tts:live-native-first-chunk-sla:{time.time_ns()}",
            lane_weights=backend_app.VF_TTS_LANE_WEIGHTS,
        ),
    )
    monkeypatch.setattr(backend_app, "TTS_LIVE_ARTIFACTS_DIR", tmp_path / "tts-live")
    monkeypatch.setattr(backend_app, "TTS_RESULT_ARTIFACTS_DIR", tmp_path / "tts-results")
    backend_app.TTS_LIVE_ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    backend_app.TTS_RESULT_ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(
        backend_app,
        "_runtime_generate_live_native_turn_text",
        lambda **_kwargs: "Host opens quickly and hands over.",
    )

    class _OkRuntimeResponse:
        def __init__(self) -> None:
            self.status_code = 200
            self.content = _tiny_wav_bytes(240)
            self.headers = {
                "content-type": "audio/wav",
                "x-voiceflow-trace-id": "trace_live_native_sla",
            }
            self.text = ""

        @property
        def ok(self) -> bool:
            return True

        def json(self) -> dict:
            return {}

    runtime_calls = {"count": 0}

    def _runtime_with_sla_fallback(*_args, **kwargs):
        runtime_calls["count"] += 1
        payload = kwargs.get("json") if isinstance(kwargs.get("json"), dict) else {}
        if str(payload.get("model") or "").strip():
            time.sleep(0.03)
            raise backend_app.RuntimeHttpError(
                method="POST",
                url="http://127.0.0.1:7810/synthesize",
                category="timeout",
                message="first chunk timed out",
                attempt=1,
                retryable=True,
            )
        return _OkRuntimeResponse()

    monkeypatch.setattr(backend_app, "_runtime_tts_request_with_gemini_failover", _runtime_with_sla_fallback)

    job_id = "live_native_first_chunk_sla_job"
    payload = {
        "jobId": job_id,
        "uid": "live_sla_user",
        "requestId": job_id,
        "traceId": f"trace_{job_id}",
        "engine": "GEM",
        "text": "live native first chunk sla test",
        "voiceId": "Puck",
        "voiceName": "Puck",
        "planName": "Free",
        "planKey": "free",
        "adminLimitBypass": True,
        "idempotencyKey": f"idem_{job_id}",
        "runtimeBase": "http://127.0.0.1:7810",
        "runtimePath": "/synthesize",
        "upstreamPayload": {"text": "seed", "language": "en"},
        "deadlineAtMs": int(time.time() * 1000) + 60_000,
        "maxAttempts": 1,
        "attempts": 0,
        "mode": "live_native",
        "liveStream": True,
        "liveFirstChunkTargetMs": 10,
        "liveNative": {
            "topic": "Fast live first chunk",
            "durationSec": 30,
            "speakerCount": 2,
            "cast": backend_app._default_live_native_cast(2),
            "recovery": {
                "strategy": "resume_then_fallback",
                "maxResumeAttempts": 2,
                "fallbackMode": "runtime_nonlive_same_cast",
            },
        },
    }
    backend_app._TTS_JOB_QUEUE.enqueue(lane="free", payload=payload)
    backend_app._record_tts_job_enqueued(job_id=job_id, engine="GEM", created_at_ms=int(time.time() * 1000))
    backend_app._process_tts_job(payload, "worker-live-native-first-chunk-sla")

    completed = backend_app._TTS_JOB_QUEUE.get(job_id) or {}
    assert str(completed.get("status") or "") == "completed"
    result = completed.get("result") if isinstance(completed.get("result"), dict) else {}
    headers = result.get("headers") if isinstance(result.get("headers"), dict) else {}
    assert int(headers.get("x-vf-live-fallback-count") or 0) >= 1
    assert int(headers.get("x-vf-live-first-chunk-target-ms") or 0) == 10
    summary = completed.get("liveNativeSummary") if isinstance(completed.get("liveNativeSummary"), dict) else {}
    recovery = summary.get("recovery") if isinstance(summary.get("recovery"), dict) else {}
    assert recovery.get("firstChunkSlaFallbackUsed") is True
    assert runtime_calls["count"] >= 2


def _tiny_wav_bytes(duration_frames: int = 240, sample_value: int = 0) -> bytes:
    payload = BytesIO()
    with wave.open(payload, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(24000)
        frame = int(sample_value).to_bytes(2, "little", signed=True)
        handle.writeframes(frame * max(1, int(duration_frames)))
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
    assert str(payload["chunks"][0]["downloadUrl"]).endswith("/tts/jobs/live_status_job/chunks/1")
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
    assert str(payload_with_audio["chunks"][0]["downloadUrl"]).endswith("/tts/jobs/live_status_job/chunks/0")
    assert isinstance(payload_with_audio["chunks"][0].get("audioBase64"), str)
    assert payload_with_audio["chunks"][0]["audioBase64"] != ""


def test_tts_job_status_payload_completed_result_toggle(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(backend_app, "TTS_RESULT_ARTIFACTS_DIR", tmp_path / "tts-results")
    backend_app.TTS_RESULT_ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

    job_id = "status_result_toggle_job"
    synthesized_audio = _tiny_wav_bytes(360, sample_value=1200)
    audio_ref = backend_app._persist_tts_result_audio(job_id, synthesized_audio, "audio/wav")
    job = {
        "jobId": job_id,
        "requestId": job_id,
        "traceId": f"trace_{job_id}",
        "status": "completed",
        "engine": "GEM",
        "createdAtMs": int(time.time() * 1000) - 1200,
        "updatedAtMs": int(time.time() * 1000) - 800,
        "finishedAtMs": int(time.time() * 1000) - 400,
        "result": {
            "mediaType": "audio/wav",
            "headers": {
                "x-test-header": "ok",
            },
            "audioRef": audio_ref,
        },
    }

    payload_without_result = backend_app._tts_job_status_payload(job, include_result=False)
    assert "result" not in payload_without_result

    payload_with_result = backend_app._tts_job_status_payload(job, include_result=True)
    assert "result" in payload_with_result
    result = payload_with_result.get("result") if isinstance(payload_with_result.get("result"), dict) else {}
    assert str(result.get("mediaType") or "") == "audio/wav"
    assert str((result.get("headers") or {}).get("x-test-header") or "") == "ok"
    assert str(result.get("audioBase64") or "") == base64.b64encode(synthesized_audio).decode("ascii")


def test_tts_job_status_payload_live_native_orchestration_and_artifacts(tmp_path) -> None:
    chunk0 = tmp_path / "chunk_0000.wav"
    chunk0.write_bytes(_tiny_wav_bytes(300))
    transcript_path = tmp_path / "transcript.json"
    transcript_path.write_text('{"turns":[]}', encoding="utf-8")
    summary_path = tmp_path / "summary.json"
    summary_path.write_text('{"ok":true}', encoding="utf-8")

    job = {
        "jobId": "live_native_status_job",
        "requestId": "live_native_status_job",
        "traceId": "trace_live_native_status_job",
        "status": "running",
        "engine": "GEM",
        "mode": "live_native",
        "createdAtMs": int(time.time() * 1000) - 1000,
        "liveOrchestration": {
            "mode": "live_native",
            "status": "running",
            "activeSpeakerName": "HOST",
            "turnIndex": 2,
            "sessionEpoch": 1,
            "resumeCount": 1,
            "fallbackCount": 0,
        },
        "liveNativeArtifacts": {
            "audio": {"downloadUrl": "/tts/jobs/live_native_status_job/audio"},
            "transcriptJson": {
                "path": str(transcript_path),
                "downloadUrl": "/tts/jobs/live_native_status_job/artifacts/transcript_json",
                "contentType": "application/json",
            },
            "summaryJson": {
                "path": str(summary_path),
                "downloadUrl": "/tts/jobs/live_native_status_job/artifacts/summary_json",
                "contentType": "application/json",
            },
        },
        "liveState": {
            "enabled": True,
            "mode": "live_native",
            "playableChunks": 1,
            "playableDurationMs": 20,
            "chunkCursorNext": 1,
            "chunks": [
                {
                    "index": 0,
                    "contentType": "audio/wav",
                    "durationMs": 20,
                    "textChars": 16,
                    "engine": "GEM",
                    "traceId": "trace0",
                    "speakerId": "host",
                    "turnIndex": 0,
                    "sessionEpoch": 1,
                    "resumeAttempt": 1,
                    "fallbackUsed": False,
                    "path": str(chunk0),
                }
            ],
        },
    }

    payload = backend_app._tts_job_status_payload(
        job,
        include_result=False,
        include_chunks=True,
        chunk_cursor=0,
        chunk_limit=2,
        include_chunk_audio=False,
    )
    assert payload["mode"] == "live_native"
    assert payload["liveOrchestration"]["activeSpeakerName"] == "HOST"
    assert payload["artifacts"]["transcriptJson"]["downloadUrl"].endswith("/artifacts/transcript_json")
    assert payload["chunks"][0]["speakerId"] == "host"
    assert payload["chunks"][0]["turnIndex"] == 0
    assert payload["chunks"][0]["sessionEpoch"] == 1
    assert payload["chunks"][0]["resumeAttempt"] == 1
    assert payload["chunks"][0]["fallbackUsed"] is False


def test_tts_job_artifact_download_endpoint_live_native(monkeypatch, tmp_path) -> None:
    _reset_tts_metrics_state(monkeypatch)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(
        backend_app,
        "_TTS_JOB_QUEUE",
        backend_app.TtsJobQueue(redis_url="", key_prefix=f"test:tts:artifact-download:{time.time_ns()}", lane_weights=backend_app.VF_TTS_LANE_WEIGHTS),
    )

    job_id = "live_native_artifact_job"
    transcript_path = tmp_path / "transcript.json"
    transcript_path.write_text('{"turns":[{"speaker":"HOST","text":"Hello"}]}', encoding="utf-8")
    backend_app._TTS_JOB_QUEUE.enqueue(
        lane="free",
        payload={
            "jobId": job_id,
            "uid": "artifact_user",
            "requestId": job_id,
            "traceId": job_id,
            "engine": "GEM",
            "text": "artifact test",
            "mode": "live_native",
            "liveNativeArtifacts": {
                "transcriptJson": {
                    "path": str(transcript_path),
                    "downloadUrl": f"/tts/jobs/{job_id}/artifacts/transcript_json",
                    "contentType": "application/json",
                }
            },
        },
    )

    client = TestClient(backend_app.app)
    response = client.get(f"/tts/jobs/{job_id}/artifacts/transcript_json", headers={"x-dev-uid": "artifact_user"})
    assert response.status_code == 200
    assert response.headers.get("content-type", "").startswith("application/json")
    assert "turns" in response.text


def test_tts_job_chunk_download_endpoint(monkeypatch, tmp_path) -> None:
    _reset_tts_metrics_state(monkeypatch)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(
        backend_app,
        "_TTS_JOB_QUEUE",
        backend_app.TtsJobQueue(redis_url="", key_prefix=f"test:tts:chunk-download:{time.time_ns()}", lane_weights=backend_app.VF_TTS_LANE_WEIGHTS),
    )

    job_id = "chunk_download_job_1"
    chunk_path = tmp_path / "chunk_0000.wav"
    chunk_path.write_bytes(_tiny_wav_bytes(360))
    backend_app._TTS_JOB_QUEUE.enqueue(
        lane="free",
        payload={
            "jobId": job_id,
            "uid": "chunk_user",
            "requestId": job_id,
            "traceId": job_id,
            "engine": "GEM",
            "text": "chunk test",
            "liveState": {
                "enabled": True,
                "playableChunks": 1,
                "playableDurationMs": 20,
                "chunkCursorNext": 1,
                "chunks": [
                    {
                        "index": 0,
                        "contentType": "audio/wav",
                        "durationMs": 20,
                        "textChars": 16,
                        "engine": "GEM",
                        "traceId": job_id,
                        "path": str(chunk_path),
                    }
                ],
            },
        },
    )

    client = TestClient(backend_app.app)
    response = client.get(f"/tts/jobs/{job_id}/chunks/0", headers={"x-dev-uid": "chunk_user"})
    assert response.status_code == 200
    assert response.headers.get("content-type", "").startswith("audio/wav")
    assert len(response.content) > 64


def test_tts_job_audio_download_endpoint(monkeypatch) -> None:
    _reset_tts_metrics_state(monkeypatch)
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(
        backend_app,
        "_TTS_JOB_QUEUE",
        backend_app.TtsJobQueue(redis_url="", key_prefix=f"test:tts:audio-download:{time.time_ns()}", lane_weights=backend_app.VF_TTS_LANE_WEIGHTS),
    )

    job_id = "audio_download_job_1"
    backend_app._TTS_JOB_QUEUE.enqueue(
        lane="free",
        payload={
            "jobId": job_id,
            "uid": "audio_user",
            "requestId": job_id,
            "traceId": job_id,
            "engine": "GEM",
            "text": "audio test",
        },
    )
    backend_app._TTS_JOB_QUEUE.mark_completed(
        job_id,
        audio_bytes=_tiny_wav_bytes(480),
        media_type="audio/wav",
    )

    client = TestClient(backend_app.app)
    response = client.get(f"/tts/jobs/{job_id}/audio", headers={"x-dev-uid": "audio_user"})
    assert response.status_code == 200
    assert response.headers.get("content-type", "").startswith("audio/wav")
    assert len(response.content) > 64


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
