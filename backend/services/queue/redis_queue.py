from __future__ import annotations

import base64
import json
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass
from typing import Any, Optional

try:
    import redis  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    redis = None  # type: ignore


DEFAULT_LANE_WEIGHTS = {
    "pro_plus": 10,
    "pro": 5,
    "free": 2,
}


def normalize_lane(lane: str) -> str:
    token = str(lane or "").strip().lower()
    if token in {"plus", "pro-plus", "pro_plus", "proplus"}:
        return "pro_plus"
    if token in {"pro", "free"}:
        return token
    return "free"


@dataclass(frozen=True)
class QueueItem:
    lane: str
    payload: dict[str, Any]


class WeightedInMemoryQueue:
    def __init__(self, lane_weights: Optional[dict[str, int]] = None) -> None:
        self._lock = threading.Lock()
        self._queues: dict[str, deque[QueueItem]] = {}
        self._weights = {normalize_lane(key): max(1, int(value)) for key, value in (lane_weights or DEFAULT_LANE_WEIGHTS).items()}
        self._cycle: list[str] = []
        for lane, weight in self._weights.items():
            self._queues[lane] = deque()
            self._cycle.extend([lane] * max(1, int(weight)))
        if not self._cycle:
            self._cycle = ["free"]
        self._cursor = 0

    def push(self, lane: str, payload: dict[str, Any]) -> None:
        normalized = normalize_lane(lane)
        with self._lock:
            if normalized not in self._queues:
                self._queues[normalized] = deque()
                self._cycle.append(normalized)
            self._queues[normalized].append(QueueItem(lane=normalized, payload=dict(payload or {})))

    def pop(self) -> Optional[QueueItem]:
        with self._lock:
            if not any(self._queues.values()):
                return None
            cycle_len = len(self._cycle)
            for _ in range(cycle_len):
                lane = self._cycle[self._cursor % cycle_len]
                self._cursor = (self._cursor + 1) % cycle_len
                queue = self._queues.get(lane)
                if not queue:
                    continue
                try:
                    return queue.popleft()
                except IndexError:
                    continue
            return None

    def depth(self) -> int:
        with self._lock:
            return int(sum(len(queue) for queue in self._queues.values()))

    def depth_by_lane(self) -> dict[str, int]:
        with self._lock:
            return {lane: len(queue) for lane, queue in self._queues.items()}


class TtsJobQueue:
    def __init__(
        self,
        *,
        redis_url: str = "",
        key_prefix: str = "vf:tts:jobs",
        lane_weights: Optional[dict[str, int]] = None,
    ) -> None:
        self.key_prefix = str(key_prefix or "vf:tts:jobs").strip() or "vf:tts:jobs"
        self._weights = {normalize_lane(key): max(1, int(value)) for key, value in (lane_weights or DEFAULT_LANE_WEIGHTS).items()}
        self._cycle: list[str] = []
        for lane, weight in self._weights.items():
            self._cycle.extend([lane] * max(1, int(weight)))
        if not self._cycle:
            self._cycle = ["free"]
        self._cursor = 0

        self._lock = threading.Lock()
        self._inmemory_queue = WeightedInMemoryQueue(self._weights)
        self._inmemory_jobs: dict[str, dict[str, Any]] = {}
        self._inmemory_job_lanes: dict[str, str] = {}

        self._redis_client: Any = None
        if redis is not None and str(redis_url or "").strip():
            try:
                self._redis_client = redis.Redis.from_url(str(redis_url).strip(), decode_responses=True)
                self._redis_client.ping()
            except Exception:
                self._redis_client = None

    def is_redis_enabled(self) -> bool:
        return self._redis_client is not None

    def _job_key(self, job_id: str) -> str:
        return f"{self.key_prefix}:job:{job_id}"

    def _lane_key(self, lane: str) -> str:
        return f"{self.key_prefix}:lane:{normalize_lane(lane)}"

    def _serialize(self, payload: dict[str, Any]) -> str:
        return json.dumps(payload, ensure_ascii=True, separators=(",", ":"))

    def _deserialize(self, raw: Any) -> dict[str, Any]:
        if isinstance(raw, dict):
            return dict(raw)
        if not raw:
            return {}
        try:
            parsed = json.loads(str(raw))
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {}
        return {}

    def _now_ms(self) -> int:
        return int(time.time() * 1000)

    def enqueue(self, *, lane: str, payload: dict[str, Any]) -> dict[str, Any]:
        normalized_lane = normalize_lane(lane)
        base = dict(payload or {})
        job_id = str(base.get("jobId") or uuid.uuid4().hex).strip() or uuid.uuid4().hex
        now_ms = self._now_ms()
        job = {
            **base,
            "jobId": job_id,
            "lane": normalized_lane,
            "status": "queued",
            "createdAtMs": now_ms,
            "updatedAtMs": now_ms,
            "attempts": int(base.get("attempts") or 0),
            "cancelRequested": False,
        }
        if self._redis_client is not None:
            try:
                self._redis_client.set(self._job_key(job_id), self._serialize(job))
                self._redis_client.rpush(self._lane_key(normalized_lane), job_id)
                return dict(job)
            except Exception:
                pass
        with self._lock:
            self._inmemory_jobs[job_id] = dict(job)
            self._inmemory_job_lanes[job_id] = normalized_lane
            self._inmemory_queue.push(normalized_lane, {"jobId": job_id})
        return dict(job)

    def _dequeue_from_redis(self) -> Optional[dict[str, Any]]:
        if self._redis_client is None:
            return None
        cycle_len = len(self._cycle)
        for _ in range(cycle_len):
            lane = self._cycle[self._cursor % cycle_len]
            self._cursor = (self._cursor + 1) % cycle_len
            try:
                job_id = self._redis_client.lpop(self._lane_key(lane))
            except Exception:
                return None
            if not job_id:
                continue
            record_raw = self._redis_client.get(self._job_key(str(job_id)))
            job = self._deserialize(record_raw)
            if not job:
                continue
            if bool(job.get("cancelRequested")):
                job["status"] = "cancelled"
                job["updatedAtMs"] = self._now_ms()
                self._redis_client.set(self._job_key(str(job_id)), self._serialize(job))
                continue
            return job
        return None

    def dequeue_next(self) -> Optional[dict[str, Any]]:
        job = self._dequeue_from_redis()
        if job is not None:
            return job
        item = self._inmemory_queue.pop()
        if item is None:
            return None
        job_id = str((item.payload or {}).get("jobId") or "").strip()
        if not job_id:
            return None
        with self._lock:
            job = dict(self._inmemory_jobs.get(job_id) or {})
            if not job:
                return None
            if bool(job.get("cancelRequested")):
                job["status"] = "cancelled"
                job["updatedAtMs"] = self._now_ms()
                self._inmemory_jobs[job_id] = job
                return None
            return job

    def get(self, job_id: str) -> Optional[dict[str, Any]]:
        safe_job_id = str(job_id or "").strip()
        if not safe_job_id:
            return None
        if self._redis_client is not None:
            try:
                payload = self._deserialize(self._redis_client.get(self._job_key(safe_job_id)))
                return payload or None
            except Exception:
                pass
        with self._lock:
            payload = self._inmemory_jobs.get(safe_job_id)
            return dict(payload) if isinstance(payload, dict) else None

    def update(self, job_id: str, patch: dict[str, Any]) -> Optional[dict[str, Any]]:
        safe_job_id = str(job_id or "").strip()
        if not safe_job_id:
            return None
        now_ms = self._now_ms()
        if self._redis_client is not None:
            try:
                current = self._deserialize(self._redis_client.get(self._job_key(safe_job_id)))
                if not current:
                    return None
                next_value = {**current, **dict(patch or {}), "updatedAtMs": now_ms}
                self._redis_client.set(self._job_key(safe_job_id), self._serialize(next_value))
                return next_value
            except Exception:
                pass
        with self._lock:
            current = self._inmemory_jobs.get(safe_job_id)
            if not isinstance(current, dict):
                return None
            next_value = {**current, **dict(patch or {}), "updatedAtMs": now_ms}
            self._inmemory_jobs[safe_job_id] = next_value
            return dict(next_value)

    def mark_running(self, job_id: str, *, worker_id: str) -> Optional[dict[str, Any]]:
        current = self.get(job_id)
        if not current:
            return None
        attempts = max(0, int(current.get("attempts") or 0)) + 1
        return self.update(
            job_id,
            {
                "status": "running",
                "startedAtMs": self._now_ms(),
                "attempts": attempts,
                "workerId": str(worker_id or "").strip() or "worker",
            },
        )

    def mark_completed(
        self,
        job_id: str,
        *,
        audio_bytes: bytes,
        media_type: str,
        headers: Optional[dict[str, str]] = None,
    ) -> Optional[dict[str, Any]]:
        return self.update(
            job_id,
            {
                "status": "completed",
                "finishedAtMs": self._now_ms(),
                "result": {
                    "audioBase64": base64.b64encode(bytes(audio_bytes or b"")).decode("ascii"),
                    "mediaType": str(media_type or "audio/wav"),
                    "headers": {str(k): str(v) for k, v in dict(headers or {}).items()},
                },
            },
        )

    def mark_failed(
        self,
        job_id: str,
        *,
        status_code: int,
        error: Any,
    ) -> Optional[dict[str, Any]]:
        safe_error = error if isinstance(error, dict) else {"detail": str(error or "TTS job failed.")}
        return self.update(
            job_id,
            {
                "status": "failed",
                "finishedAtMs": self._now_ms(),
                "statusCode": int(status_code),
                "error": safe_error,
            },
        )

    def cancel(self, job_id: str) -> Optional[dict[str, Any]]:
        current = self.get(job_id)
        if not current:
            return None
        status = str(current.get("status") or "").lower()
        if status in {"completed", "failed", "cancelled"}:
            return current
        return self.update(job_id, {"cancelRequested": True, "status": "cancelled", "finishedAtMs": self._now_ms()})

    def wait_for_terminal(self, job_id: str, *, timeout_ms: int, poll_ms: int = 150) -> Optional[dict[str, Any]]:
        safe_timeout_ms = max(0, int(timeout_ms))
        if safe_timeout_ms <= 0:
            return self.get(job_id)
        started = self._now_ms()
        while True:
            current = self.get(job_id)
            if current:
                status = str(current.get("status") or "").lower()
                if status in {"completed", "failed", "cancelled"}:
                    return current
            if (self._now_ms() - started) >= safe_timeout_ms:
                return current
            time.sleep(max(20, int(poll_ms)) / 1000.0)

    def depth_snapshot(self) -> dict[str, Any]:
        if self._redis_client is not None:
            try:
                lanes = sorted(set(self._cycle))
                by_lane = {lane: int(self._redis_client.llen(self._lane_key(lane))) for lane in lanes}
                return {
                    "total": int(sum(by_lane.values())),
                    "byLane": by_lane,
                    "storage": "redis",
                }
            except Exception:
                pass
        return {
            "total": int(self._inmemory_queue.depth()),
            "byLane": self._inmemory_queue.depth_by_lane(),
            "storage": "memory",
        }

