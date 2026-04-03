from __future__ import annotations

import json
import logging
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

import app as backend_app
from services.queue import cloud_tasks_wake as drain_wake
from services.queue.redis_queue import TtsJobQueue
from workers.tts_worker import WorkerHealthState, _process_http_drain, _start_claim_heartbeat, _start_worker_http_server


class _FakePipeline:
    def __init__(self, client: "_FakeRedis") -> None:
        self._client = client
        self._ops: list[tuple[str, tuple, dict]] = []

    def set(self, *args, **kwargs):
        self._ops.append(("set", args, kwargs))
        return self

    def delete(self, *args, **kwargs):
        self._ops.append(("delete", args, kwargs))
        return self

    def rpush(self, *args, **kwargs):
        self._ops.append(("rpush", args, kwargs))
        return self

    def expire(self, *args, **kwargs):
        self._ops.append(("expire", args, kwargs))
        return self

    def execute(self):
        results = []
        for name, args, kwargs in self._ops:
            results.append(getattr(self._client, name)(*args, **kwargs))
        self._ops.clear()
        return results


class _FakeRedis:
    def __init__(self) -> None:
        self.strings: dict[str, str] = {}
        self.lists: dict[str, list[str]] = {}
        self.expiries: dict[str, int] = {}

    def ping(self):
        return True

    def pipeline(self, transaction: bool = True):  # noqa: ARG002
        return _FakePipeline(self)

    def set(self, key, value, ex=None, nx=False, xx=False):  # noqa: ANN001
        safe_key = str(key)
        if xx and safe_key not in self.strings:
            return False
        if nx and safe_key in self.strings:
            return False
        self.strings[safe_key] = str(value)
        if ex is not None:
            self.expiries[safe_key] = int(ex)
        return True

    def get(self, key):  # noqa: ANN001
        return self.strings.get(str(key))

    def delete(self, *keys):  # noqa: ANN001
        removed = 0
        for key in keys:
            removed += int(self.strings.pop(str(key), None) is not None)
            removed += int(self.lists.pop(str(key), None) is not None)
        return removed

    def rpush(self, key, value):  # noqa: ANN001
        self.lists.setdefault(str(key), []).append(str(value))
        return len(self.lists[str(key)])

    def lpop(self, key):  # noqa: ANN001
        values = self.lists.get(str(key)) or []
        if not values:
            return None
        return values.pop(0)

    def lrem(self, key, count, value):  # noqa: ANN001
        values = self.lists.get(str(key)) or []
        removed = 0
        new_values = []
        for item in values:
            if item == str(value) and (count == 0 or removed < abs(int(count))):
                removed += 1
                continue
            new_values.append(item)
        self.lists[str(key)] = new_values
        return removed

    def llen(self, key):  # noqa: ANN001
        return len(self.lists.get(str(key)) or [])

    def expire(self, key, seconds):  # noqa: ANN001
        self.expiries[str(key)] = int(seconds)
        return True

    def scan_iter(self, match=None, count=None):  # noqa: ANN001
        _ = count
        pattern = str(match or "")
        if pattern.endswith("*"):
            prefix = pattern[:-1]
            for key in list(self.strings.keys()):
                if str(key).startswith(prefix):
                    yield key
            return
        for key in list(self.strings.keys()):
            if key == pattern:
                yield key


class _DrainQueue:
    def __init__(self, redis_client: _FakeRedis) -> None:
        self.key_prefix = "vf:test:tts"
        self._redis = redis_client
        self._calls = 0
        self._recovered = 0
        self.records: dict[str, dict[str, object]] = {}
        self.pending: list[dict[str, object]] = []

    def is_redis_enabled(self) -> bool:
        return True

    def seed(self, *jobs: dict[str, object]) -> None:
        for job in jobs:
            record = dict(job)
            self.pending.append(record)
            self.records[str(record.get("jobId") or "")] = dict(record)
            self._redis.rpush(f"{self.key_prefix}:ready:{str(record.get('lane') or 'free')}", str(record.get("jobId") or ""))

    def reserve_next(self, *, worker_id: str) -> dict[str, object] | None:
        self._calls += 1
        if not self.pending:
            return None
        record = dict(self.pending.pop(0))
        record["status"] = "running"
        record["workerId"] = worker_id
        self.records[str(record.get("jobId") or "")] = dict(record)
        return record

    def recover_stalled_claims(self, *, limit: int = 25) -> int:
        _ = limit
        return self._recovered

    def depth_snapshot(self) -> dict[str, object]:
        return {"total": len(self.pending)}

    def _queue_depth_total(self) -> int:
        return len(self.pending)

    def _unique_lanes(self) -> list[str]:
        lanes = [str(record.get("lane") or "free") for record in self.pending]
        return lanes or ["free"]

    def get(self, job_id: str) -> dict[str, object] | None:
        record = self.records.get(str(job_id or "").strip())
        return dict(record) if isinstance(record, dict) else None

    def renew_claim(self, job_id: str, *, worker_id: str) -> bool:
        _ = job_id, worker_id
        return True

    def mark_failed(self, job_id: str, *, status_code: int, error: object) -> dict[str, object]:
        record = dict(self.records.get(str(job_id or "").strip()) or {})
        record["jobId"] = str(job_id or "").strip()
        record["status"] = "failed"
        record["statusCode"] = int(status_code)
        record["error"] = error
        self.records[str(job_id or "").strip()] = dict(record)
        return dict(record)


def test_queue_submit_requests_initial_drain_once(monkeypatch) -> None:
    fake_redis = _FakeRedis()
    queue = TtsJobQueue(redis_url="redis://example", key_prefix="vf:test:tts")
    queue._redis = fake_redis  # type: ignore[attr-defined]

    monkeypatch.setenv("VF_TTS_DRAIN_ENABLED", "1")
    monkeypatch.setenv("VF_TTS_DRAIN_PROJECT_ID", "voiceflow-test")
    monkeypatch.setenv("VF_TTS_DRAIN_QUEUE_NAME", "tts-drain")
    monkeypatch.setenv("VF_TTS_DRAIN_QUEUE_LOCATION", "us-central1")
    monkeypatch.setenv("VF_TTS_DRAIN_WORKER_URL", "https://worker.example.run.app")
    monkeypatch.setenv("VF_TTS_DRAIN_SERVICE_ACCOUNT_EMAIL", "tts-drain@voiceflow-test.iam.gserviceaccount.com")
    monkeypatch.setenv("VF_TTS_DRAIN_ADMIN_TOKEN", "drain-secret")

    task_calls: list[dict[str, object]] = []

    def _fake_create_task(config, *, payload):  # noqa: ANN001
        task_calls.append({"config": config, "payload": dict(payload)})
        return {"name": "tasks/test"}

    monkeypatch.setattr(drain_wake, "_create_task", _fake_create_task)

    queue.submit(
        lane="free",
        payload={
            "jobId": "job-drain-1",
            "requestId": "req-drain-1",
            "uid": "user-drain",
            "text": "hello",
        },
    )
    queue.submit(
        lane="free",
        payload={
            "jobId": "job-drain-1",
            "requestId": "req-drain-1",
            "uid": "user-drain",
            "text": "hello",
        },
    )

    assert len(task_calls) == 1
    assert task_calls[0]["payload"]["kind"] == "initial"
    assert task_calls[0]["payload"]["jobId"] == "job-drain-1"
    assert fake_redis.get("vf:test:tts:drain:wake") is not None


def test_followup_drain_failure_clears_wake_state(monkeypatch) -> None:
    fake_redis = _FakeRedis()
    monkeypatch.setenv("VF_TTS_DRAIN_ENABLED", "1")
    monkeypatch.setenv("VF_TTS_DRAIN_PROJECT_ID", "voiceflow-test")
    monkeypatch.setenv("VF_TTS_DRAIN_QUEUE_NAME", "tts-drain")
    monkeypatch.setenv("VF_TTS_DRAIN_QUEUE_LOCATION", "us-central1")
    monkeypatch.setenv("VF_TTS_DRAIN_WORKER_URL", "https://worker.example.run.app")
    monkeypatch.setenv("VF_TTS_DRAIN_SERVICE_ACCOUNT_EMAIL", "tts-drain@voiceflow-test.iam.gserviceaccount.com")
    monkeypatch.setenv("VF_TTS_DRAIN_ADMIN_TOKEN", "drain-secret")

    def _boom(_config, *, payload):  # noqa: ANN001
        raise RuntimeError(f"boom: {payload.get('jobId')}")

    monkeypatch.setattr(drain_wake, "_create_task", _boom)

    with pytest.raises(RuntimeError):
        drain_wake.request_followup_drain(
            fake_redis,
            "vf:test:tts",
            lane="free",
            job_id="job-followup-fail",
            reason="backlog",
            worker_id="worker-1",
        )

    assert fake_redis.get("vf:test:tts:drain:followup") is None
    assert fake_redis.get("vf:test:tts:drain:wake") is None


def test_drain_task_headers_use_oidc_only() -> None:
    config = drain_wake.TtsDrainConfig(
        enabled=True,
        project_id="voiceflow-test",
        location="us-central1",
        queue_name="tts-drain",
        worker_url="https://worker.example.run.app",
        service_account_email="tts-drain@voiceflow-test.iam.gserviceaccount.com",
        request_timeout_sec=10.0,
        dispatch_deadline_sec=900,
        wake_ttl_sec=900,
        lock_ttl_sec=900,
        batch_size=1,
    )

    headers = drain_wake._auth_headers_for_worker_target(config)
    assert headers == {"Content-Type": "application/json"}


def test_worker_http_drain_processes_one_job_and_requests_followup(monkeypatch) -> None:
    monkeypatch.setenv("VF_TTS_WORKER_HEALTH_PORT", "0")
    monkeypatch.setenv("VF_TTS_DRAIN_ADMIN_TOKEN", "drain-secret")

    fake_redis = _FakeRedis()
    queue = _DrainQueue(fake_redis)
    queue.seed(
        {
            "jobId": "job-http-1",
            "requestId": "req-http-1",
            "uid": "user-http",
            "lane": "free",
            "engine": "VECTOR",
            "status": "queued",
        },
        {
            "jobId": "job-http-2",
            "requestId": "req-http-2",
            "uid": "user-http",
            "lane": "free",
            "engine": "VECTOR",
            "status": "queued",
        },
    )

    processed_jobs: list[str] = []
    followup_calls: list[dict[str, object]] = []

    monkeypatch.setattr("workers.tts_worker.process_tts_job", lambda job: processed_jobs.append(str(job.request_id)))
    monkeypatch.setattr(
        "workers.tts_worker.request_followup_drain",
        lambda redis_client, key_prefix, *, lane, job_id, reason, worker_id: followup_calls.append(
            {
                "redisClient": redis_client,
                "keyPrefix": key_prefix,
                "lane": lane,
                "jobId": job_id,
                "reason": reason,
                "workerId": worker_id,
            }
        )
        or True,
    )

    state = WorkerHealthState(worker_id="worker-http-test", require_heartbeat=False)
    state.mark_queue_ready()
    state.touch_loop()
    server = _start_worker_http_server(state, queue, logging.getLogger("test"))
    assert server is not None

    try:
        request = Request(
            f"http://127.0.0.1:{server.bound_port}/internal/tts/drain",
            data=json.dumps({"lane": "free", "jobId": "job-http-1"}).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "x-admin-token": "drain-secret",
            },
        )
        with urlopen(request, timeout=10) as response:
            body = json.loads(response.read().decode("utf-8"))
            assert response.status == 200
            assert body["ok"] is True
            assert body["processed"] == 1
            assert body["followupRequested"] is True
            assert body["queueDepth"] == 1
    finally:
        server.close()

    assert processed_jobs == ["req-http-1"]
    assert len(followup_calls) == 1
    assert followup_calls[0]["jobId"] == "job-http-1"


def test_worker_http_drain_accepts_oidc_bearer_in_production(monkeypatch) -> None:
    monkeypatch.setenv("VF_ENV", "production")
    monkeypatch.setenv("VF_TTS_WORKER_HEALTH_PORT", "0")
    monkeypatch.setenv("VF_TTS_DRAIN_WORKER_URL", "https://worker.example.run.app")
    monkeypatch.setenv("VF_TTS_DRAIN_SERVICE_ACCOUNT_EMAIL", "tts-drain@voiceflow-test.iam.gserviceaccount.com")

    fake_redis = _FakeRedis()
    queue = _DrainQueue(fake_redis)
    queue.seed(
        {
            "jobId": "job-http-1",
            "requestId": "req-http-1",
            "uid": "user-http",
            "lane": "free",
            "engine": "VECTOR",
            "status": "queued",
        }
    )

    monkeypatch.setattr("workers.tts_worker._verify_drain_oidc_token", lambda token: token == "oidc-token")
    monkeypatch.setattr("workers.tts_worker.process_tts_job", lambda job: None)
    monkeypatch.setattr(
        "workers.tts_worker.request_followup_drain",
        lambda redis_client, key_prefix, *, lane, job_id, reason, worker_id: False,
    )

    state = WorkerHealthState(worker_id="worker-http-test", require_heartbeat=False)
    state.mark_queue_ready()
    state.touch_loop()
    server = _start_worker_http_server(state, queue, logging.getLogger("test"))
    assert server is not None

    try:
        request = Request(
            f"http://127.0.0.1:{server.bound_port}/internal/tts/drain",
            data=json.dumps({"lane": "free", "jobId": "job-http-1"}).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer oidc-token",
            },
        )
        with urlopen(request, timeout=10) as response:
            body = json.loads(response.read().decode("utf-8"))
            assert response.status == 200
            assert body["ok"] is True
    finally:
        server.close()


def test_worker_http_drain_survives_followup_scheduler_failure(monkeypatch) -> None:
    monkeypatch.setenv("VF_TTS_DRAIN_ADMIN_TOKEN", "drain-secret")
    fake_redis = _FakeRedis()
    queue = _DrainQueue(fake_redis)
    queue.seed(
        {
            "jobId": "job-http-1",
            "requestId": "req-http-1",
            "uid": "user-http",
            "lane": "free",
            "engine": "VECTOR",
            "status": "queued",
        },
        {
            "jobId": "job-http-2",
            "requestId": "req-http-2",
            "uid": "user-http",
            "lane": "free",
            "engine": "VECTOR",
            "status": "queued",
        },
    )

    processed_jobs: list[str] = []

    monkeypatch.setattr("workers.tts_worker.process_tts_job", lambda job: processed_jobs.append(str(job.request_id)))

    def _boom(*args, **kwargs):  # noqa: ANN001
        raise RuntimeError("followup scheduling failed")

    monkeypatch.setattr("workers.tts_worker.request_followup_drain", _boom)

    result = _process_http_drain(
        queue,
        worker_id="worker-http-test",
        logger=logging.getLogger("test"),
        payload={"lane": "free", "jobId": "job-http-1"},
    )

    assert result["ok"] is True
    assert result["processed"] == 1
    assert result["followupRequested"] is False
    assert processed_jobs == ["req-http-1"]


def test_worker_http_drain_skips_when_lock_is_held(monkeypatch) -> None:
    monkeypatch.setenv("VF_TTS_DRAIN_ADMIN_TOKEN", "drain-secret")
    fake_redis = _FakeRedis()
    fake_redis.strings["vf:test:tts:drain:lock"] = json.dumps({"workerId": "other-worker", "acquiredAtMs": 1})

    queue = _DrainQueue(fake_redis)
    queue.seed(
        {
            "jobId": "job-lock-1",
            "requestId": "req-lock-1",
            "uid": "user-lock",
            "lane": "free",
            "engine": "VECTOR",
            "status": "queued",
        }
    )

    result = _process_http_drain(
        queue,
        worker_id="worker-lock-test",
        logger=logging.getLogger("test"),
        payload={"lane": "free", "jobId": "job-lock-1"},
    )
    assert result["skipped"] is True
    assert result["reason"] == "drain_locked"
    assert queue._calls == 0


def test_runtime_auth_headers_include_gemini_id_token_and_admin_token(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "GEMINI_RUNTIME_URL", "https://gemini-runtime.example.run.app")
    monkeypatch.setattr(backend_app, "GEMINI_RUNTIME_ADMIN_TOKEN", "admin-secret")
    monkeypatch.setattr(backend_app, "_cloud_run_id_token_for_url", lambda _url: "id-token-123")

    headers = backend_app._runtime_auth_headers_for_url(
        "https://gemini-runtime.example.run.app/v1/generate-text",
        include_accept=True,
    )
    assert headers["Accept"] == "application/json"
    assert headers["Authorization"] == "Bearer id-token-123"
    assert headers["x-admin-token"] == "admin-secret"


def test_claim_heartbeat_stops_after_failure_threshold_without_touch_loop(monkeypatch) -> None:
    monkeypatch.setattr("workers.tts_worker._claim_heartbeat_interval_seconds", lambda _queue: 0.01)
    monkeypatch.setattr("workers.tts_worker._claim_heartbeat_grace_seconds", lambda _queue: 0.0)
    monkeypatch.setattr("workers.tts_worker._claim_heartbeat_max_failures", lambda: 1)

    calls: list[int] = []

    class _FailingQueue:
        def renew_claim(self, _job_id: str, *, worker_id: str) -> bool:  # noqa: ARG002
            calls.append(len(calls) + 1)
            return False

    stop_event = _start_claim_heartbeat(
        _FailingQueue(),
        job_id="job-heartbeat-stop",
        worker_id="worker-stop",
        logger=logging.getLogger("tests.tts_worker"),
        touch_loop=None,
    )
    try:
        time.sleep(0.12)
        first_window_calls = len(calls)
        time.sleep(0.12)
        second_window_calls = len(calls)
    finally:
        stop_event.set()

    assert first_window_calls >= 1
    assert second_window_calls == first_window_calls
