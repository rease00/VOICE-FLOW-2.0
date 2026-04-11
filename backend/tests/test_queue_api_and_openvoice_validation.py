from __future__ import annotations

import base64
import fnmatch
import json
import logging
from pathlib import Path
from threading import Event
from urllib.error import HTTPError
from urllib.request import urlopen

import pytest

import app as backend_app
from services import tts_v2_engine as tts_v2_engine_module
from services.tts_v2_engine import TtsV2Engine, V2ValidationError
from services.openvoice_modal import build_openvoice_artifact_signature, decode_openvoice_audio_base64
from services.queue.redis_queue import TtsJobQueue, WeightedInMemoryQueue

from workers.tts_worker import WorkerHealthState, _process_claimed_job, _restore_dequeued_job, _start_worker_health_server, run_worker


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

    def lrem(self, *args, **kwargs):
        self._ops.append(("lrem", args, kwargs))
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
        for key in list(self.strings.keys()):
            if fnmatch.fnmatch(str(key), pattern or "*"):
                yield key


class _FailingPipeline(_FakePipeline):
    def execute(self):
        raise RuntimeError("boom")


class _DedupeRaceRedis(_FakeRedis):
    def __init__(self, *, dedupe_key: str, existing_job_id: str, job_key: str, race_on_set: bool) -> None:
        super().__init__()
        self.dedupe_key = str(dedupe_key)
        self.existing_job_id = str(existing_job_id)
        self.job_key = str(job_key)
        self.race_on_set = bool(race_on_set)
        self.job_get_calls = 0

    def get(self, key):  # noqa: ANN001
        safe_key = str(key)
        if safe_key == self.job_key:
            self.job_get_calls += 1
            if self.job_get_calls < 2:
                return None
        return super().get(key)

    def set(self, key, value, ex=None, nx=False, xx=False):  # noqa: ANN001
        safe_key = str(key)
        if self.race_on_set and nx and safe_key == self.dedupe_key and safe_key not in self.strings:
            self.strings[safe_key] = self.existing_job_id
            if ex is not None:
                self.expiries[safe_key] = int(ex)
            return False
        return super().set(key, value, ex=ex, nx=nx, xx=xx)


class _FakeDurableQueue:
    def __init__(self) -> None:
        self.records: dict[str, dict[str, object]] = {}
        self.mark_failed_calls: list[dict[str, object]] = []

    def is_redis_enabled(self) -> bool:
        return True

    def submit(self, *, lane: str, payload: dict[str, object]) -> dict[str, object]:
        record = dict(payload or {})
        record["lane"] = lane
        self.records[str(record.get("jobId") or "")] = dict(record)
        return dict(record)

    def get(self, job_id: str) -> dict[str, object] | None:
        record = self.records.get(str(job_id or "").strip())
        return dict(record) if isinstance(record, dict) else None

    def cancel(self, job_id: str) -> dict[str, object] | None:
        record = self.records.get(str(job_id or "").strip())
        if not isinstance(record, dict):
            return None
        updated = dict(record)
        updated["status"] = "cancelled"
        updated["finishedAtMs"] = int(updated.get("updatedAtMs") or updated.get("createdAtMs") or 0) + 1
        updated["statusCode"] = 409
        updated["error"] = {"detail": "cancelled"}
        updated["cancelRequested"] = True
        self.records[str(job_id or "").strip()] = dict(updated)
        return dict(updated)

    def requeue(self, job_id: str, *, worker_id: str = "", payload: dict[str, object] | None = None, bypass_depth_check: bool = True, recovery: bool = False):  # noqa: ANN001
        _ = worker_id, bypass_depth_check, recovery
        job_key = str(job_id or "").strip()
        record = dict(self.records.get(job_key) or {})
        if payload:
            record.update(dict(payload))
        record["status"] = "queued"
        record["workerId"] = ""
        record["updatedAtMs"] = int(record.get("updatedAtMs") or record.get("createdAtMs") or 0) + 1
        self.records[job_key] = dict(record)
        return dict(record)

    def mark_failed(self, job_id: str, *, status_code: int, error: object) -> dict[str, object]:
        record = dict(self.records.get(str(job_id or "").strip()) or {})
        record["jobId"] = str(job_id or "").strip()
        record["status"] = "failed"
        record["statusCode"] = int(status_code)
        record["error"] = error
        self.records[str(job_id or "").strip()] = dict(record)
        self.mark_failed_calls.append(
            {
                "jobId": str(job_id or "").strip(),
                "statusCode": int(status_code),
                "error": error,
            }
        )
        return dict(record)


def test_weighted_in_memory_queue_honors_lane_weights() -> None:
    queue = WeightedInMemoryQueue({"pro": 3, "free": 1})

    queue.push("pro", {"jobId": "pro_1"})
    queue.push("pro", {"jobId": "pro_2"})
    queue.push("pro", {"jobId": "pro_3"})
    queue.push("free", {"jobId": "free_1"})

    popped = [queue.pop(), queue.pop(), queue.pop(), queue.pop()]
    assert [item.lane for item in popped if item is not None] == ["pro", "pro", "pro", "free"]
    assert queue.pop() is None


@pytest.mark.parametrize(
    ("preexisting_dedupe", "race_on_set"),
    [
        (True, False),
        (False, True),
    ],
    ids=["preexisting-key", "nx-race"],
)
def test_queue_submit_waits_for_visible_dedupe_record_and_does_not_duplicate(
    monkeypatch,
    preexisting_dedupe: bool,
    race_on_set: bool,
) -> None:
    queue = TtsJobQueue(redis_url="redis://example", key_prefix="vf:test:dedupe-race")
    fake_redis = _DedupeRaceRedis(
        dedupe_key=queue._dedupe_key("req_existing_123"),  # noqa: SLF001
        existing_job_id="job_existing_123",
        job_key=queue._job_key("job_existing_123"),  # noqa: SLF001
        race_on_set=race_on_set,
    )
    queue._redis = fake_redis  # type: ignore[attr-defined]

    existing_record = {
        "jobId": "job_existing_123",
        "requestId": "req_existing_123",
        "lane": "pro",
        "status": "queued",
        "uid": "user_dedupe",
        "text": "hello from the winning request",
    }
    fake_redis.strings[fake_redis.job_key] = queue._serialize_record(existing_record)  # noqa: SLF001
    if preexisting_dedupe:
        fake_redis.strings[fake_redis.dedupe_key] = "job_existing_123"  # noqa: SLF001

    def _fail_persist(_record: dict[str, object]) -> dict[str, object]:
        raise AssertionError("duplicate submit should not persist a second record")

    monkeypatch.setattr(queue, "_persist_redis_record", _fail_persist)

    submitted = queue.submit(
        lane="pro",
        payload={
            "jobId": "job_new_duplicate",
            "requestId": "req_existing_123",
            "uid": "user_dedupe",
            "text": "hello from the duplicate request",
        },
    )

    assert submitted["jobId"] == "job_existing_123"
    assert submitted["requestId"] == "req_existing_123"
    assert submitted["status"] == "queued"
    assert fake_redis.job_get_calls >= 2
    assert fake_redis.get(queue._job_key("job_new_duplicate")) is None  # noqa: SLF001


def test_queue_submit_keeps_dedupe_ttl_at_or_beyond_result_window(monkeypatch) -> None:
    monkeypatch.setenv("VF_TTS_QUEUE_DEDUPE_TTL_SEC", "1")
    queue = TtsJobQueue(redis_url="redis://example", key_prefix="vf:test:dedupe-ttl", result_ttl_ms=600_000)
    fake_redis = _FakeRedis()
    queue._redis = fake_redis  # type: ignore[attr-defined]

    submitted = queue.submit(
        lane="free",
        payload={
            "jobId": "job_ttl_floor_123",
            "requestId": "req_ttl_floor_123",
            "uid": "user_ttl_floor",
            "text": "ttl floor",
        },
    )

    assert submitted["jobId"] == "job_ttl_floor_123"
    dedupe_key = queue._dedupe_key("req_ttl_floor_123")  # noqa: SLF001
    assert queue._dedupe_ttl_sec >= 600  # noqa: SLF001
    assert fake_redis.expiries[dedupe_key] == queue._dedupe_ttl_sec


def test_queue_submit_tracks_dedupe_hit_miss_and_expired_replay_metrics(monkeypatch) -> None:
    queue = TtsJobQueue(redis_url="redis://example", key_prefix="vf:test:dedupe-metrics", result_ttl_ms=600_000)
    fake_redis = _FakeRedis()
    queue._redis = fake_redis  # type: ignore[attr-defined]

    miss_request_id = "req_dedupe_miss_123"
    first_submit = queue.submit(
        lane="pro",
        payload={
            "jobId": "job_dedupe_miss_123",
            "requestId": miss_request_id,
            "uid": "user_dedupe_metrics",
            "text": "dedupe miss",
        },
    )
    assert first_submit["jobId"] == "job_dedupe_miss_123"
    telemetry = queue.depth_snapshot()["telemetry"]["dedupe"]
    assert telemetry["dedupe_miss"] == 1
    assert telemetry["dedupe_hit"] == 0
    assert telemetry["dedupe_expired_replay"] == 0

    second_submit = queue.submit(
        lane="pro",
        payload={
            "jobId": "job_dedupe_miss_retry_123",
            "requestId": miss_request_id,
            "uid": "user_dedupe_metrics",
            "text": "dedupe miss",
        },
    )
    assert second_submit["jobId"] == "job_dedupe_miss_123"
    telemetry = queue.depth_snapshot()["telemetry"]["dedupe"]
    assert telemetry["dedupe_miss"] == 1
    assert telemetry["dedupe_hit"] == 1
    assert telemetry["dedupe_expired_replay"] == 0

    expired_request_id = "req_dedupe_expired_123"
    expired_dedupe_key = queue._dedupe_key(expired_request_id)  # noqa: SLF001
    fake_redis.strings[expired_dedupe_key] = "job_dedupe_expired_123"
    monkeypatch.setattr(queue, "_wait_for_redis_job_record", lambda *_args, **_kwargs: None)

    expired_submit = queue.submit(
        lane="free",
        payload={
            "jobId": "job_dedupe_expired_retry_123",
            "requestId": expired_request_id,
            "uid": "user_dedupe_metrics",
            "text": "dedupe expired replay",
        },
    )
    assert expired_submit["jobId"] == "job_dedupe_expired_123"
    telemetry = queue.depth_snapshot()["telemetry"]["dedupe"]
    assert telemetry["dedupe_miss"] == 1
    assert telemetry["dedupe_hit"] == 1
    assert telemetry["dedupe_expired_replay"] == 1


@pytest.mark.parametrize(
    ("operation", "call_kwargs"),
    [
        ("requeue", {}),
        ("release_requeue", {"requeue": True}),
        ("release_terminal", {"requeue": False, "terminal_status": "failed"}),
    ],
    ids=["requeue", "release-requeue", "release-terminal"],
)
def test_queue_ready_list_mutation_is_atomic_when_record_update_fails(
    monkeypatch,
    operation: str,
    call_kwargs: dict[str, object],
) -> None:
    queue = TtsJobQueue(redis_url="redis://example", key_prefix="vf:test:atomic")
    fake_redis = _FakeRedis()
    queue._redis = fake_redis  # type: ignore[attr-defined]

    queue.submit(
        lane="free",
        payload={
            "jobId": "job_atomic_123",
            "requestId": "req_atomic_123",
            "uid": "user_atomic",
            "text": "atomic",
        },
    )
    claimed = queue.claim("job_atomic_123", worker_id="worker-atomic")
    assert claimed is not None

    ready_key = queue._ready_key("free")  # noqa: SLF001
    claim_key = queue._claim_key("job_atomic_123")  # noqa: SLF001
    monkeypatch.setattr(fake_redis, "pipeline", lambda transaction=True: _FailingPipeline(fake_redis))

    with pytest.raises(RuntimeError):
        if operation == "requeue":
            queue.requeue("job_atomic_123", worker_id="worker-atomic", payload=claimed)
        elif operation == "release_requeue":
            queue.release("job_atomic_123", worker_id="worker-atomic", **call_kwargs)
        else:
            queue.release("job_atomic_123", worker_id="worker-atomic", **call_kwargs)

    assert fake_redis.llen(ready_key) == 0
    assert fake_redis.get(claim_key) is not None
    assert queue.get("job_atomic_123")["status"] == "running"


def test_queue_submit_reserve_ack_and_release_round_trip() -> None:
    queue = TtsJobQueue(redis_url="redis://example", key_prefix="vf:test:tts")
    fake_redis = _FakeRedis()
    queue._redis = fake_redis  # type: ignore[attr-defined]

    submitted = queue.submit(
        lane="pro",
        payload={
            "jobId": "job_123456",
            "requestId": "req_123456",
            "idempotencyKey": "req_123456",
            "uid": "user_1",
            "text": "hello",
        },
    )
    assert submitted["status"] == "queued"
    assert submitted["lane"] == "pro"
    assert submitted["requestId"] == "req_123456"
    assert queue.depth_snapshot()["total"] == 1

    claimed = queue.reserve_next(worker_id="worker-1")
    assert claimed is not None
    assert claimed["jobId"] == "job_123456"
    assert claimed["status"] == "running"
    assert claimed["attempts"] == 1
    assert claimed["workerId"] == "worker-1"
    claim_key = "vf:test:tts:claim:job_123456"
    claim_meta = fake_redis.get(claim_key)
    assert claim_meta is not None
    assert "\"claimedAtMs\"" in str(claim_meta)

    completed = queue.ack(
        "job_123456",
        worker_id="worker-1",
        audio_bytes=b"RIFFdata",
        media_type="audio/wav",
        headers={"x-test": "1"},
        result_ref={"kind": "file", "path": "/tmp/audio.wav", "sizeBytes": 8},
    )
    assert completed is not None
    assert completed["status"] == "completed"
    assert completed["result"]["sizeBytes"] == 8
    assert completed["result"]["audioRef"]["path"] == "/tmp/audio.wav"

    queue.submit(
        lane="free",
        payload={
            "jobId": "job_234567",
            "requestId": "req_234567",
            "uid": "user_1",
            "text": "world",
        },
    )
    queue.reserve_next(worker_id="worker-2")
    released = queue.release("job_234567", worker_id="worker-2", requeue=False, terminal_status="failed", error="boom")
    assert released is not None
    assert released["status"] == "failed"


def test_tts_v2_audio_audit_id_extraction_promotes_nested_payload_values() -> None:
    assert backend_app._audio_generation_audit_ids_from_job(
        {
            "audioAuditIds": ["audit_top_1", "audit_top_2"],
            "payload": {
                "audioAuditIds": ["audit_nested_1", "audit_nested_2"],
                "audioAuditId": "nested_legacy_should_not_win",
            },
        }
    ) == ["audit_top_1", "audit_top_2", "audit_nested_1", "audit_nested_2", "nested_legacy_should_not_win"]

    assert backend_app._audio_generation_audit_ids_from_job(
        {
            "payload": {
                "audioAuditIds": ["audit_nested_1", "", "audit_nested_2", "audit_nested_1"],
                "audioAuditId": "nested_legacy_should_not_win",
            },
        }
    ) == ["audit_nested_1", "audit_nested_2", "nested_legacy_should_not_win"]


def test_tts_v2_queue_submission_promotes_nested_audio_audit_ids() -> None:
    engine = backend_app._TTS_V2_ENGINE
    submitted = engine.build_queue_submission(
        payload={
            "request_id": "queue_req_audio_123456",
            "mode": "single_speaker",
            "engine": "VECTOR",
            "text": "hello",
            "payload": {"audioAuditIds": ["audit_nested_1", "audit_nested_2"]},
        },
        uid="queue_user",
        plan_key="free",
        lane="free",
    )
    assert submitted["audioAuditIds"] == ["audit_nested_1", "audit_nested_2"]


def test_tts_v2_queue_submission_sla_and_retry_caps(monkeypatch) -> None:
    engine = backend_app._TTS_V2_ENGINE
    monkeypatch.setitem(tts_v2_engine_module.VF_TTS_ENGINE_RETRY_LIMITS, "VECTOR", 2)
    submitted = engine.build_queue_submission(
        payload={
            "request_id": "queue_req_limits_123456",
            "mode": "single_speaker",
            "engine": "VECTOR",
            "text": "hello",
        },
        uid="queue_user",
        plan_key="free",
        lane="free",
    )
    assert submitted["queueSlotSlaMs"] == tts_v2_engine_module.VF_TTS_QUEUE_SLOT_SLA_MS
    assert int(submitted["deadlineAtMs"]) - int(submitted["createdAtMs"]) == tts_v2_engine_module.VF_TTS_QUEUE_DEADLINE_MS
    assert submitted["maxAttempts"] == 2
    assert int(submitted["expiresAtMs"]) >= int(submitted["createdAtMs"]) + int(engine._result_ttl_ms)  # noqa: SLF001

    monkeypatch.setitem(
        tts_v2_engine_module.VF_TTS_ENGINE_RETRY_LIMITS,
        "VECTOR",
        int(tts_v2_engine_module.VF_TTS_QUEUE_MAX_ATTEMPTS) + 5,
    )
    capped = engine.build_queue_submission(
        payload={
            "request_id": "queue_req_limits_cap_123456",
            "mode": "single_speaker",
            "engine": "VECTOR",
            "text": "hello again",
        },
        uid="queue_user",
        plan_key="free",
        lane="free",
    )
    assert capped["maxAttempts"] == tts_v2_engine_module.VF_TTS_QUEUE_MAX_ATTEMPTS


def test_queue_renew_claim_updates_claimed_at_timestamp(monkeypatch) -> None:
    queue = TtsJobQueue(redis_url="redis://example", key_prefix="vf:test:tts")
    fake_redis = _FakeRedis()
    queue._redis = fake_redis  # type: ignore[attr-defined]

    queue.submit(
        lane="free",
        payload={
            "jobId": "job_heartbeat_123",
            "requestId": "req_heartbeat_123",
            "uid": "user_heartbeat",
            "text": "heartbeat",
        },
    )
    claimed = queue.reserve_next(worker_id="worker-heartbeat")
    assert claimed is not None

    claim_key = "vf:test:tts:claim:job_heartbeat_123"
    before = json.loads(str(fake_redis.get(claim_key) or "{}"))
    before_claimed_at = int(before.get("claimedAtMs") or 0)
    assert before_claimed_at > 0

    monkeypatch.setattr(queue, "_now_ms", lambda: before_claimed_at + 5000)
    assert queue.renew_claim("job_heartbeat_123", worker_id="worker-heartbeat") is True

    after = json.loads(str(fake_redis.get(claim_key) or "{}"))
    assert int(after.get("claimedAtMs") or 0) == before_claimed_at + 5000
    assert fake_redis.expiries[claim_key] == queue._claim_ttl_sec  # type: ignore[attr-defined]
    updated = queue.get("job_heartbeat_123") or {}
    assert int(updated.get("claimRenewedAtMs") or 0) == before_claimed_at + 5000
    assert int(updated.get("updatedAtMs") or 0) >= before_claimed_at + 5000


def test_queue_depth_total_counts_unique_lanes_only() -> None:
    queue = TtsJobQueue(
        redis_url="redis://example",
        key_prefix="vf:test:depth",
        lane_weights={"free": 3, "pro": 1},
    )
    fake_redis = _FakeRedis()
    queue._redis = fake_redis  # type: ignore[attr-defined]

    queue.submit(
        lane="free",
        payload={
            "jobId": "job_depth_free",
            "requestId": "req_depth_free",
            "uid": "user_depth",
            "text": "free",
        },
    )
    queue.submit(
        lane="pro",
        payload={
            "jobId": "job_depth_pro",
            "requestId": "req_depth_pro",
            "uid": "user_depth",
            "text": "pro",
        },
    )
    assert queue.depth_snapshot()["total"] == 2
    assert queue._queue_depth_total() == 2  # noqa: SLF001


def test_queue_retry_reenqueue_restores_ready_job() -> None:
    queue = TtsJobQueue(redis_url="redis://example", key_prefix="vf:test:tts")
    fake_redis = _FakeRedis()
    queue._redis = fake_redis  # type: ignore[attr-defined]

    submitted = queue.submit(
        lane="free",
        payload={
            "jobId": "job_retry_123",
            "requestId": "req_retry_123",
            "uid": "user_1",
            "text": "hello",
        },
    )
    assert submitted["status"] == "queued"
    claimed = queue.claim("job_retry_123", worker_id="worker-1")
    assert claimed is not None
    queue.update("job_retry_123", {"status": "queued", "lastError": {"detail": "retry me"}})

    requeued = queue.submit(
        lane="free",
        payload={
            "jobId": "job_retry_123",
            "requestId": "req_retry_123",
            "uid": "user_1",
            "text": "hello",
            "attempts": 1,
        },
    )
    assert requeued["jobId"] == "job_retry_123"
    assert requeued["status"] == "queued"
    assert fake_redis.llen("vf:test:tts:ready:free") == 1


def test_queue_requeue_dedupes_ready_entries() -> None:
    queue = TtsJobQueue(redis_url="redis://example", key_prefix="vf:test:dedupe")
    fake_redis = _FakeRedis()
    queue._redis = fake_redis  # type: ignore[attr-defined]

    queue.submit(
        lane="free",
        payload={
            "jobId": "job_dedupe_123",
            "requestId": "req_dedupe_123",
            "uid": "user_dedupe",
            "text": "hello",
        },
    )
    claimed = queue.claim("job_dedupe_123", worker_id="worker-dedupe")
    assert claimed is not None

    ready_key = "vf:test:dedupe:ready:free"
    fake_redis.lists[ready_key] = ["job_dedupe_123", "job_dedupe_123"]

    requeued = queue.requeue(
        "job_dedupe_123",
        worker_id="worker-dedupe",
        payload=claimed,
    )
    assert requeued is not None
    assert requeued["status"] == "queued"
    assert fake_redis.lists[ready_key] == ["job_dedupe_123"]


def test_queue_requeue_does_not_resurrect_terminal_job() -> None:
    queue = TtsJobQueue(redis_url="redis://example", key_prefix="vf:test:terminal-requeue")
    fake_redis = _FakeRedis()
    queue._redis = fake_redis  # type: ignore[attr-defined]

    queue.submit(
        lane="free",
        payload={
            "jobId": "job_terminal_123",
            "requestId": "req_terminal_123",
            "uid": "user_terminal",
            "text": "hello",
        },
    )
    claimed = queue.claim("job_terminal_123", worker_id="worker-terminal")
    assert claimed is not None
    cancelled = queue.cancel("job_terminal_123")
    assert cancelled is not None
    assert cancelled["status"] == "cancelled"

    requeued = queue.requeue(
        "job_terminal_123",
        worker_id="worker-terminal",
        payload=claimed,
    )
    assert requeued is not None
    assert requeued["status"] == "cancelled"


def test_queue_reserve_fallback_dedupes_ready_entries_when_claim_is_active() -> None:
    queue = TtsJobQueue(redis_url="redis://example", key_prefix="vf:test:fallback")
    fake_redis = _FakeRedis()
    queue._redis = fake_redis  # type: ignore[attr-defined]

    queue.submit(
        lane="free",
        payload={
            "jobId": "job_fallback_123",
            "requestId": "req_fallback_123",
            "uid": "user_fallback",
            "text": "hello",
        },
    )
    ready_key = "vf:test:fallback:ready:free"
    fake_redis.lists[ready_key] = ["job_fallback_123", "job_fallback_123"]
    claim_key = "vf:test:fallback:claim:job_fallback_123"
    fake_redis.strings[claim_key] = json.dumps({"workerId": "worker-fallback", "claimedAtMs": queue._now_ms()})  # type: ignore[attr-defined]

    claimed = queue.reserve_next(worker_id="worker-other")
    assert claimed is None
    assert fake_redis.lists[ready_key] == ["job_fallback_123"]


def test_queue_recover_stalled_claims_requeues_expired_running_job() -> None:
    queue = TtsJobQueue(redis_url="redis://example", key_prefix="vf:test:tts")
    fake_redis = _FakeRedis()
    queue._redis = fake_redis  # type: ignore[attr-defined]

    queue.submit(
        lane="free",
        payload={
            "jobId": "job_stall_123",
            "requestId": "req_stall_123",
            "uid": "user_1",
            "text": "hello",
        },
    )
    queue.claim("job_stall_123", worker_id="worker-1")
    claim_key = "vf:test:tts:claim:job_stall_123"
    fake_redis.strings[claim_key] = "{\"workerId\":\"worker-1\",\"claimedAtMs\":1}"
    queue.update("job_stall_123", {"status": "running", "workerId": "worker-1"})

    recovered = queue.recover_stalled_claims(limit=10)
    assert recovered == 1
    assert queue.get("job_stall_123")["status"] == "queued"
    assert fake_redis.llen("vf:test:tts:ready:free") == 1


def test_queue_recover_stalled_claims_skips_recent_missing_claim(monkeypatch) -> None:
    monkeypatch.setenv("VF_TTS_QUEUE_MISSING_CLAIM_GRACE_SEC", "120")
    queue = TtsJobQueue(redis_url="redis://example", key_prefix="vf:test:missing-claim")
    fake_redis = _FakeRedis()
    queue._redis = fake_redis  # type: ignore[attr-defined]

    queue.submit(
        lane="free",
        payload={
            "jobId": "job_missing_claim_123",
            "requestId": "req_missing_claim_123",
            "uid": "user_missing_claim",
            "text": "hello",
        },
    )
    queue.claim("job_missing_claim_123", worker_id="worker-1")
    claim_key = "vf:test:missing-claim:claim:job_missing_claim_123"
    fake_redis.delete(claim_key)

    now_ms = queue._now_ms()  # noqa: SLF001
    queue.update(
        "job_missing_claim_123",
        {
            "status": "running",
            "workerId": "worker-1",
            "claimRenewedAtMs": now_ms - 30_000,
            "updatedAtMs": now_ms - 30_000,
        },
    )

    recovered = queue.recover_stalled_claims(limit=10)
    assert recovered == 0
    assert queue.get("job_missing_claim_123")["status"] == "running"
    assert fake_redis.llen("vf:test:missing-claim:ready:free") == 0


def test_queue_recovery_exhaustion_writes_dead_letter_when_enabled(monkeypatch) -> None:
    monkeypatch.setenv("VF_TTS_QUEUE_DEAD_LETTER_ENABLED", "1")
    monkeypatch.setenv("VF_TTS_QUEUE_MAX_RECOVERY_ATTEMPTS", "1")

    queue = TtsJobQueue(redis_url="redis://example", key_prefix="vf:test:dead")
    fake_redis = _FakeRedis()
    queue._redis = fake_redis  # type: ignore[attr-defined]

    queue.submit(
        lane="free",
        payload={
            "jobId": "job_dead_123",
            "requestId": "req_dead_123",
            "uid": "user_dead",
            "text": "dead-letter",
        },
    )
    queue.reserve_next(worker_id="worker-dead")
    fake_redis.strings["vf:test:dead:claim:job_dead_123"] = "{\"workerId\":\"worker-dead\",\"claimedAtMs\":1}"
    queue.update(
        "job_dead_123",
        {
            "status": "running",
            "workerId": "worker-dead",
            "recoveryAttempts": 1,
        },
    )

    recovered = queue.recover_stalled_claims(limit=10)
    assert recovered == 1
    record = queue.get("job_dead_123")
    assert record is not None
    assert record["status"] == "failed"
    dead_letter_key = "vf:test:dead:deadletter:job_dead_123"
    dead_letter_payload = json.loads(str(fake_redis.get(dead_letter_key) or "{}"))
    assert dead_letter_payload["jobId"] == "job_dead_123"
    assert "stalled claim exceeded recovery attempts" in str(dead_letter_payload.get("reason") or "")


def test_queue_submit_enforces_per_user_queued_cap(monkeypatch) -> None:
    monkeypatch.setenv("VF_TTS_QUEUE_MAX_QUEUED_PER_USER", "1")
    queue = TtsJobQueue(redis_url="redis://example", key_prefix="vf:test:cap")
    fake_redis = _FakeRedis()
    queue._redis = fake_redis  # type: ignore[attr-defined]
    counter_key = "vf:test:cap:queued-user:user_cap"

    queue.submit(
        lane="free",
        payload={
            "jobId": "job_cap_1",
            "requestId": "req_cap_1",
            "uid": "user_cap",
            "text": "first",
        },
    )
    assert fake_redis.get(counter_key) == "1"

    job_key = "vf:test:cap:job:job_cap_1"
    current = json.loads(str(fake_redis.get(job_key) or "{}"))
    current["status"] = "running"
    fake_redis.strings[job_key] = json.dumps(current, sort_keys=True, separators=(",", ":"), ensure_ascii=True)

    with pytest.raises(RuntimeError, match="Per-user queued cap exceeded"):
        queue.submit(
            lane="free",
            payload={
                "jobId": "job_cap_2",
                "requestId": "req_cap_2",
                "uid": "user_cap",
                "text": "second",
            },
        )


def test_queue_submit_enforces_per_category_cap(monkeypatch) -> None:
    monkeypatch.setenv("VF_TTS_QUEUE_MAX_QUEUED_GLOBAL_API", "1")
    queue = TtsJobQueue(redis_url="redis://example", key_prefix="vf:test:category-cap")
    fake_redis = _FakeRedis()
    queue._redis = fake_redis  # type: ignore[attr-defined]

    queue.submit(
        lane="free",
        payload={
            "jobId": "job_category_1",
            "requestId": "req_category_1",
            "uid": "user_category",
            "text": "first",
            "workerCategory": "GLOBAL_API",
        },
    )

    with pytest.raises(RuntimeError, match="Per-category queued cap exceeded"):
        queue.submit(
            lane="free",
            payload={
                "jobId": "job_category_2",
                "requestId": "req_category_2",
                "uid": "user_category",
                "text": "second",
                "workerCategory": "GLOBAL_API",
            },
        )


def test_queue_reserve_next_isolates_worker_category(monkeypatch) -> None:
    monkeypatch.setenv("VF_TTS_WORKER_CATEGORY", "APP_LOCAL")
    queue = TtsJobQueue(redis_url="redis://example", key_prefix="vf:test:category-isolation")
    fake_redis = _FakeRedis()
    queue._redis = fake_redis  # type: ignore[attr-defined]

    queue.submit(
        lane="free",
        payload={
            "jobId": "job_category_global",
            "requestId": "req_category_global",
            "uid": "user_category",
            "text": "global first",
            "workerCategory": "GLOBAL_API",
        },
    )
    queue.submit(
        lane="free",
        payload={
            "jobId": "job_category_local",
            "requestId": "req_category_local",
            "uid": "user_category",
            "text": "local second",
            "workerCategory": "APP_LOCAL",
        },
    )

    claimed = queue.reserve_next(worker_id="worker-local")
    assert claimed is not None
    assert claimed["jobId"] == "job_category_local"
    assert str(claimed.get("workerCategory") or "").upper() == "APP_LOCAL"
    assert queue.get("job_category_global") is not None
    assert str(queue.get("job_category_global")["status"]) == "queued"
    assert str(queue.get("job_category_local")["status"]) == "running"


def test_queue_user_counter_tracks_transitions_and_terminal_updates(monkeypatch) -> None:
    monkeypatch.setenv("VF_TTS_QUEUE_MAX_QUEUED_PER_USER", "1")
    queue = TtsJobQueue(redis_url="redis://example", key_prefix="vf:test:counter")
    fake_redis = _FakeRedis()
    queue._redis = fake_redis  # type: ignore[attr-defined]
    counter_key = "vf:test:counter:queued-user:user_flow"

    queue.submit(
        lane="free",
        payload={
            "jobId": "job_flow_1",
            "requestId": "req_flow_1",
            "uid": "user_flow",
            "text": "first",
        },
    )
    assert fake_redis.get(counter_key) == "1"

    claimed = queue.reserve_next(worker_id="worker-flow")
    assert claimed is not None
    assert claimed["status"] == "running"
    assert fake_redis.get(counter_key) is None

    requeued = queue.requeue(
        "job_flow_1",
        worker_id="worker-flow",
        payload=claimed,
        bypass_depth_check=True,
    )
    assert requeued is not None
    assert requeued["status"] == "queued"
    assert fake_redis.get(counter_key) == "1"

    cancelled = queue.cancel("job_flow_1")
    assert cancelled is not None
    assert cancelled["status"] == "cancelled"
    assert fake_redis.get(counter_key) is None

    queue.submit(
        lane="free",
        payload={
            "jobId": "job_flow_2",
            "requestId": "req_flow_2",
            "uid": "user_flow",
            "text": "second",
        },
    )
    assert fake_redis.get(counter_key) == "1"

    completed = queue.update("job_flow_2", {"status": "completed", "finishedAtMs": 999})
    assert completed is not None
    assert completed["status"] == "completed"
    assert fake_redis.get(counter_key) is None


def test_worker_restores_dequeued_job_when_claim_fails_and_job_is_still_queued() -> None:
    queue = _FakeDurableQueue()
    queue.records["job_worker_123"] = {
        "jobId": "job_worker_123",
        "requestId": "req_worker_123",
        "uid": "user_1",
        "lane": "free",
        "status": "queued",
        "createdAtMs": 1,
        "updatedAtMs": 1,
    }

    restored = _restore_dequeued_job(
        queue,
        job_payload={
            "jobId": "job_worker_123",
            "requestId": "req_worker_123",
            "uid": "user_1",
            "lane": "free",
            "status": "queued",
        },
        worker_id="worker-1",
        logger=logging.getLogger("test"),
    )
    assert restored is True
    assert queue.records["job_worker_123"]["status"] == "queued"


def test_worker_uses_reserve_next_and_runs_periodic_recovery(monkeypatch) -> None:
    class _FakeWorkerQueue:
        def __init__(self) -> None:
            self._claim_ttl_sec = 30
            self.recovery_calls = 0
            self.reserve_calls = 0
            self._returned = False

        def is_redis_enabled(self) -> bool:
            return True

        def recover_stalled_claims(self, *, limit: int = 25) -> int:
            _ = limit
            self.recovery_calls += 1
            return 0

        def reserve_next(self, *, worker_id: str) -> dict[str, object] | None:
            self.reserve_calls += 1
            if self._returned:
                return None
            self._returned = True
            return {
                "jobId": "job_worker_loop_123",
                "requestId": "req_worker_loop_123",
                "uid": "user_worker_loop",
                "engine": "VECTOR",
                "status": "running",
                "workerId": worker_id,
            }

        def renew_claim(self, job_id: str, *, worker_id: str) -> bool:
            _ = job_id, worker_id
            return True

        def mark_failed(self, job_id: str, *, status_code: int, error: object) -> dict[str, object]:
            return {
                "jobId": job_id,
                "status": "failed",
                "statusCode": status_code,
                "error": error,
            }

    fake_queue = _FakeWorkerQueue()
    stop_event = Event()

    monkeypatch.setattr("workers.tts_worker._load_queue", lambda: fake_queue)
    monkeypatch.setenv("VF_TTS_WORKER_RECOVERY_INTERVAL_MS", "1")
    monkeypatch.setenv("VF_TTS_WORKER_IDLE_SLEEP_MS", "1")
    monkeypatch.setenv("VF_TTS_WORKER_HEALTH_PORT", "0")
    monkeypatch.setattr("workers.tts_worker.process_tts_job", lambda _job: stop_event.set())

    exit_code = run_worker(stop_event=stop_event)
    assert exit_code == 0
    assert fake_queue.recovery_calls >= 1
    assert fake_queue.reserve_calls >= 1


def test_worker_crash_does_not_overwrite_terminal_job(monkeypatch) -> None:
    queue = _FakeDurableQueue()
    queue.records["job_worker_terminal"] = {
        "jobId": "job_worker_terminal",
        "requestId": "req_worker_terminal",
        "uid": "user_terminal",
        "status": "completed",
        "workerId": "worker-terminal",
    }

    def _boom(_job: object) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr("workers.tts_worker.process_tts_job", _boom)
    _process_claimed_job(
        queue,
        claimed={
            "jobId": "job_worker_terminal",
            "requestId": "req_worker_terminal",
            "uid": "user_terminal",
            "engine": "VECTOR",
            "status": "running",
        },
        worker_id="worker-terminal",
        logger=logging.getLogger("test"),
    )

    assert queue.mark_failed_calls == []
    assert queue.records["job_worker_terminal"]["status"] == "completed"


def test_queue_submit_enforces_per_lane_cap_in_memory_mode(monkeypatch) -> None:
    monkeypatch.setenv("VF_TTS_QUEUE_MAX_QUEUED_PER_LANE", "1")
    queue = TtsJobQueue(redis_url="", key_prefix="vf:test:lane:mem")

    queue.submit(
        lane="free",
        payload={
            "jobId": "job_lane_mem_1",
            "requestId": "req_lane_mem_1",
            "uid": "user_lane",
            "text": "first",
        },
    )

    with pytest.raises(RuntimeError, match=r"Per-lane queued cap exceeded for lane 'free' \(1/1\)"):
        queue.submit(
            lane="free",
            payload={
                "jobId": "job_lane_mem_2",
                "requestId": "req_lane_mem_2",
                "uid": "user_lane",
                "text": "second",
            },
        )


def test_queue_submit_enforces_per_lane_cap_in_redis_mode(monkeypatch) -> None:
    monkeypatch.setenv("VF_TTS_QUEUE_MAX_QUEUED_PER_LANE", "1")
    queue = TtsJobQueue(redis_url="redis://example", key_prefix="vf:test:lane:redis")
    fake_redis = _FakeRedis()
    queue._redis = fake_redis  # type: ignore[attr-defined]

    queue.submit(
        lane="pro",
        payload={
            "jobId": "job_lane_redis_1",
            "requestId": "req_lane_redis_1",
            "uid": "user_lane",
            "text": "first",
        },
    )

    with pytest.raises(RuntimeError, match=r"Per-lane queued cap exceeded for lane 'pro' \(1/1\)"):
        queue.submit(
            lane="pro",
            payload={
                "jobId": "job_lane_redis_2",
                "requestId": "req_lane_redis_2",
                "uid": "user_lane",
                "text": "second",
            },
        )


def test_queue_mirror_is_bounded_in_redis_mode(monkeypatch) -> None:
    monkeypatch.setenv("VF_TTS_QUEUE_MIRROR_MAX_JOBS", "1")
    queue = TtsJobQueue(redis_url="redis://example", key_prefix="vf:test:mirror")
    fake_redis = _FakeRedis()
    queue._redis = fake_redis  # type: ignore[attr-defined]

    queue.submit(
        lane="free",
        payload={
            "jobId": "job_mirror_1",
            "requestId": "req_mirror_1",
            "uid": "user_mirror",
            "text": "first",
        },
    )
    queue.submit(
        lane="pro",
        payload={
            "jobId": "job_mirror_2",
            "requestId": "req_mirror_2",
            "uid": "user_mirror",
            "text": "second",
        },
    )

    assert len(queue._jobs) <= 1  # noqa: SLF001
    assert len(queue._job_lanes) <= 1  # noqa: SLF001
    assert queue.get("job_mirror_1") is not None
    assert queue.get("job_mirror_2") is not None


def test_queue_reserve_records_missing_job_anomaly_and_continues(caplog) -> None:
    queue = TtsJobQueue(redis_url="redis://example", key_prefix="vf:test:anomaly")
    fake_redis = _FakeRedis()
    queue._redis = fake_redis  # type: ignore[attr-defined]
    caplog.set_level(logging.WARNING, logger="voiceflow.tts_queue")

    fake_redis.rpush("vf:test:anomaly:ready:scale", "job_missing_1")
    queue.submit(
        lane="free",
        payload={
            "jobId": "job_anomaly_ok",
            "requestId": "req_anomaly_ok",
            "uid": "user_anomaly",
            "text": "ready",
        },
    )

    claimed = queue.reserve_next(worker_id="worker-anomaly")
    assert claimed is not None
    assert claimed["jobId"] == "job_anomaly_ok"

    marker_key = "vf:test:anomaly:reserve-anomaly:scale:job_missing_1"
    marker = json.loads(str(fake_redis.get(marker_key) or "{}"))
    assert marker["jobId"] == "job_missing_1"
    assert marker["reason"] == "missing"
    assert any("Queue reserve anomaly detected" in record.message for record in caplog.records)


def test_worker_health_endpoint_reports_ready_and_stale_states(monkeypatch) -> None:
    monkeypatch.setenv("VF_TTS_WORKER_HEALTH_PORT", "0")
    state = WorkerHealthState(worker_id="worker-health-test")
    state.mark_queue_ready()
    state.touch_loop()
    server = _start_worker_health_server(state)
    assert server is not None

    try:
        with urlopen(f"http://127.0.0.1:{server.bound_port}/healthz", timeout=5) as response:
            body = json.loads(response.read().decode("utf-8"))
            assert response.status == 200
            assert body["ready"] is True
            assert body["workerId"] == "worker-health-test"
            assert body["lastLoopAgeMs"] >= 0

        with state.lock:
            state.last_loop_at_ms = state.started_at_ms - 120_000

        with pytest.raises(HTTPError) as excinfo:
            urlopen(f"http://127.0.0.1:{server.bound_port}/healthz", timeout=5)
        assert excinfo.value.code == 503

        state.mark_queue_init_failed("boot failed")
        with pytest.raises(HTTPError) as excinfo2:
            urlopen(f"http://127.0.0.1:{server.bound_port}/readyz", timeout=5)
        assert excinfo2.value.code == 503
    finally:
        server.close()


def test_queue_claim_fails_closed_without_redis() -> None:
    queue = TtsJobQueue(redis_url="", key_prefix="vf:test:tts")
    queue.submit(
        lane="free",
        payload={
            "jobId": "job_abcdef",
            "requestId": "req_abcdef",
            "uid": "user_2",
            "text": "hello",
        },
    )
    with pytest.raises(RuntimeError, match="Redis is required"):
        queue.claim("job_abcdef", worker_id="worker-2")


def test_queue_requires_redis_in_production(monkeypatch) -> None:
    monkeypatch.setenv("VF_ENV", "production")

    with pytest.raises(RuntimeError, match="Redis is required"):
        TtsJobQueue(redis_url="", key_prefix="vf:test:tts")


def test_decode_openvoice_audio_base64_rejects_invalid_or_oversized_payload(monkeypatch) -> None:
    monkeypatch.setattr("services.openvoice_modal.OPENVOICE_MAX_AUDIO_BYTES", 8)
    monkeypatch.setattr("services.openvoice_modal.OPENVOICE_MAX_AUDIO_BASE64_CHARS", 16)

    with pytest.raises(ValueError, match="valid base64"):
        decode_openvoice_audio_base64("not-base64!!")

    oversized = base64.b64encode(b"0123456789").decode("ascii")
    with pytest.raises(ValueError, match="maximum allowed size"):
        decode_openvoice_audio_base64(oversized)


def test_openvoice_artifact_signature_requires_stable_secret(monkeypatch) -> None:
    monkeypatch.setattr("services.openvoice_modal.OPENVOICE_ARTIFACT_SECRET", "")
    monkeypatch.setattr("services.openvoice_modal.OPENVOICE_DEV_ALLOW_EPHEMERAL_SECRET", False)

    with pytest.raises(RuntimeError, match="VF_VOICE_CLONE_ARTIFACT_SECRET"):
        build_openvoice_artifact_signature("artifact-123")


def test_tts_v2_engine_uses_queue_state_when_redis_is_available(tmp_path: Path) -> None:
    queue = _FakeDurableQueue()
    engine = TtsV2Engine(
        synthesize_fn=lambda *args, **kwargs: None,
        output_root=tmp_path,
        redis_url="",
    )
    engine._queue = queue  # type: ignore[attr-defined]

    request_id = "queue_req_123456"
    payload = {
        "request_id": request_id,
        "mode": "single_speaker",
        "engine": "VECTOR",
        "text": "Queue backed synthesis should stay durable.",
    }
    created = engine.create_job(payload=payload, uid="queue_user", plan_key="free")
    assert created.id == request_id
    assert engine._threads == {}
    assert queue.get(request_id) is not None

    chunk_path = tmp_path / "chunk.wav"
    chunk_path.write_bytes(b"chunk-bytes")
    result_path = tmp_path / "result.wav"
    result_path.write_bytes(b"result-bytes")

    queue.records[request_id] = {
        **queue.records[request_id],
        "status": "running",
        "startedAtMs": int(queue.records[request_id].get("createdAtMs") or 0) + 1,
        "updatedAtMs": int(queue.records[request_id].get("createdAtMs") or 0) + 2,
        "liveState": {
            "enabled": True,
            "playableChunks": 1,
            "playableDurationMs": 125,
            "chunkCursorNext": 1,
            "chunks": [
                {
                    "index": 0,
                    "contentType": "audio/wav",
                    "durationMs": 125,
                    "sampleRate": 24000,
                    "speakerId": "SPEAKER_00",
                    "status": "completed",
                    "path": str(chunk_path),
                }
            ],
        },
    }

    job = engine.get_job(uid="queue_user", is_admin=False, job_id=request_id)
    assert job.status == "running"
    payload = engine.status_payload(job=job, include_chunks=True, include_result=False)
    assert payload["status"] == "running"
    assert payload["chunks"][0]["downloadUrl"] == f"/tts/v2/jobs/{request_id}/chunks/0/audio"

    chunk_audio, chunk_media_type = engine.get_chunk_audio(uid="queue_user", is_admin=False, job_id=request_id, chunk_index=0)
    assert chunk_audio == b"chunk-bytes"
    assert chunk_media_type == "audio/wav"

    cancelled = engine.cancel_job(uid="queue_user", is_admin=False, job_id=request_id)
    assert cancelled.status == "cancelled"
    assert queue.get(request_id)["status"] == "cancelled"

    result_request_id = "queue_req_789012"
    result_created = engine.create_job(
        payload={
            "request_id": result_request_id,
            "mode": "single_speaker",
            "engine": "VECTOR",
            "text": "Completed jobs should read back from queue state.",
        },
        uid="queue_user",
        plan_key="free",
    )
    assert result_created.id == result_request_id
    queue.records[result_request_id] = {
        **queue.records[result_request_id],
        "status": "completed",
        "finishedAtMs": int(queue.records[result_request_id].get("updatedAtMs") or 0) + 3,
        "result": {
            "mediaType": "audio/wav",
            "sizeBytes": len(b"result-bytes"),
            "audioRef": {
                "kind": "file",
                "path": str(result_path),
                "sizeBytes": len(b"result-bytes"),
            },
        },
    }

    completed_audio, completed_media_type = engine.get_result_audio(uid="queue_user", is_admin=False, job_id=result_request_id)
    assert completed_audio == b"result-bytes"
    assert completed_media_type == "audio/wav"


def test_tts_v2_engine_rejects_more_than_eight_speakers(tmp_path: Path) -> None:
    engine = TtsV2Engine(
        synthesize_fn=lambda *args, **kwargs: None,
        output_root=tmp_path,
        redis_url="",
    )
    payload = {
        "request_id": "queue_req_speaker_cap",
        "mode": "multi_speaker",
        "engine": "VECTOR",
        "text": "Queue speaker cap validation.",
        "speaker_voices": [
            {"speaker": f"Speaker {index}", "voice_id": f"v{index}"}
            for index in range(1, 10)
        ],
    }
    with pytest.raises(V2ValidationError, match="up to 8 speakers"):
        engine.create_job(payload=payload, uid="queue_user", plan_key="free")
