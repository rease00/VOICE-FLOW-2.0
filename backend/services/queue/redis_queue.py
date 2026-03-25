from __future__ import annotations

import base64
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any, Optional


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
    """
    Compatibility shim only.
    The weighted queue scheduler has been removed and no dequeue scheduling runs here.
    """

    def __init__(self, lane_weights: Optional[dict[str, int]] = None) -> None:
        self._lane_weights = {
            normalize_lane(key): max(1, int(value))
            for key, value in (lane_weights or DEFAULT_LANE_WEIGHTS).items()
        }
        self._depth_by_lane: dict[str, int] = {lane: 0 for lane in self._lane_weights}
        self._lock = threading.Lock()

    def push(self, lane: str, payload: dict[str, Any]) -> None:
        normalized = normalize_lane(lane)
        with self._lock:
            self._depth_by_lane[normalized] = int(self._depth_by_lane.get(normalized, 0)) + 1

    def pop(self) -> Optional[QueueItem]:
        # Queue execution is intentionally disabled for cutover.
        return None

    def depth(self) -> int:
        with self._lock:
            return int(sum(self._depth_by_lane.values()))

    def depth_by_lane(self) -> dict[str, int]:
        with self._lock:
            return {lane: int(count) for lane, count in self._depth_by_lane.items()}


class TtsJobQueue:
    """
    Compatibility API for legacy queue call sites.
    This no longer performs live queueing or worker dispatch.
    """

    def __init__(
        self,
        *,
        redis_url: str = "",
        key_prefix: str = "vf:tts:jobs",
        lane_weights: Optional[dict[str, int]] = None,
        result_ttl_ms: int = 900_000,
        inline_result_max_bytes: int = 1_048_576,
    ) -> None:
        _ = redis_url
        self.key_prefix = str(key_prefix or "vf:tts:jobs").strip() or "vf:tts:jobs"
        self._result_ttl_ms = max(5_000, int(result_ttl_ms))
        self._inline_result_max_bytes = max(64_000, int(inline_result_max_bytes))
        self._weights = {
            normalize_lane(key): max(1, int(value))
            for key, value in (lane_weights or DEFAULT_LANE_WEIGHTS).items()
        }
        self._lock = threading.Lock()
        self._jobs: dict[str, dict[str, Any]] = {}
        self._job_lanes: dict[str, str] = {}
        self._compat_queue = WeightedInMemoryQueue(self._weights)

    def is_redis_enabled(self) -> bool:
        return False

    def _now_ms(self) -> int:
        return int(time.time() * 1000)

    def _expires_at_ms(self, now_ms: Optional[int] = None) -> int:
        anchor = int(now_ms if now_ms is not None else self._now_ms())
        return anchor + self._result_ttl_ms

    def _is_expired(self, payload: dict[str, Any], now_ms: Optional[int] = None) -> bool:
        expires_at = int(payload.get("expiresAtMs") or 0)
        if expires_at <= 0:
            return False
        safe_now = int(now_ms if now_ms is not None else self._now_ms())
        return safe_now >= expires_at

    def _cleanup_expired_locked(self) -> None:
        now_ms = self._now_ms()
        expired_job_ids = [
            job_id
            for job_id, payload in list(self._jobs.items())
            if isinstance(payload, dict) and self._is_expired(payload, now_ms=now_ms)
        ]
        for job_id in expired_job_ids:
            self._jobs.pop(job_id, None)
            self._job_lanes.pop(job_id, None)

    def enqueue(self, *, lane: str, payload: dict[str, Any]) -> dict[str, Any]:
        normalized_lane = normalize_lane(lane)
        base = dict(payload or {})
        job_id = str(base.get("jobId") or uuid.uuid4().hex).strip() or uuid.uuid4().hex
        now_ms = self._now_ms()
        job = {
            **base,
            "jobId": job_id,
            "lane": normalized_lane,
            "status": str(base.get("status") or "queued"),
            "createdAtMs": int(base.get("createdAtMs") or now_ms),
            "updatedAtMs": now_ms,
            "attempts": int(base.get("attempts") or 0),
            "cancelRequested": bool(base.get("cancelRequested") or False),
            "expiresAtMs": int(base.get("expiresAtMs") or self._expires_at_ms(now_ms)),
        }
        with self._lock:
            self._cleanup_expired_locked()
            self._jobs[job_id] = dict(job)
            self._job_lanes[job_id] = normalized_lane
            self._compat_queue.push(normalized_lane, {"jobId": job_id})
        return dict(job)

    def dequeue_next(self) -> Optional[dict[str, Any]]:
        # Live dequeue/worker execution is disabled in compatibility mode.
        return None

    def get(self, job_id: str) -> Optional[dict[str, Any]]:
        safe_job_id = str(job_id or "").strip()
        if not safe_job_id:
            return None
        with self._lock:
            self._cleanup_expired_locked()
            payload = self._jobs.get(safe_job_id)
            return dict(payload) if isinstance(payload, dict) else None

    def update(self, job_id: str, patch: dict[str, Any]) -> Optional[dict[str, Any]]:
        safe_job_id = str(job_id or "").strip()
        if not safe_job_id:
            return None
        now_ms = self._now_ms()
        with self._lock:
            self._cleanup_expired_locked()
            current = self._jobs.get(safe_job_id)
            if not isinstance(current, dict):
                return None
            next_value = {**current, **dict(patch or {}), "updatedAtMs": now_ms}
            next_value["expiresAtMs"] = self._expires_at_ms(now_ms)
            self._jobs[safe_job_id] = next_value
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
        result_ref: Optional[dict[str, Any]] = None,
    ) -> Optional[dict[str, Any]]:
        raw_audio = bytes(audio_bytes or b"")
        safe_result_ref = dict(result_ref or {}) if isinstance(result_ref, dict) else {}
        should_inline = len(raw_audio) <= self._inline_result_max_bytes or not safe_result_ref
        encoded_audio = base64.b64encode(raw_audio).decode("ascii") if should_inline else ""
        result_payload: dict[str, Any] = {
            "mediaType": str(media_type or "audio/wav"),
            "headers": {str(k): str(v) for k, v in dict(headers or {}).items()},
            "sizeBytes": len(raw_audio),
        }
        if encoded_audio:
            result_payload["audioBase64"] = encoded_audio
        if safe_result_ref:
            result_payload["audioRef"] = {
                "kind": str(safe_result_ref.get("kind") or "file"),
                "path": str(safe_result_ref.get("path") or ""),
                "sizeBytes": int(safe_result_ref.get("sizeBytes") or len(raw_audio)),
            }
        return self.update(
            job_id,
            {
                "status": "completed",
                "finishedAtMs": self._now_ms(),
                "result": result_payload,
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
        return self.update(
            job_id,
            {
                "cancelRequested": True,
                "status": "cancelled",
                "finishedAtMs": self._now_ms(),
            },
        )

    def wait_for_terminal(self, job_id: str, *, timeout_ms: int, poll_ms: int = 150) -> Optional[dict[str, Any]]:
        safe_timeout_ms = max(0, int(timeout_ms))
        if safe_timeout_ms <= 0:
            return self.get(job_id)
        started = self._now_ms()
        sleep_ms = max(20, int(poll_ms))
        while True:
            current = self.get(job_id)
            if current:
                status = str(current.get("status") or "").lower()
                if status in {"completed", "failed", "cancelled"}:
                    return current
            if (self._now_ms() - started) >= safe_timeout_ms:
                return current
            remaining_ms = max(1, safe_timeout_ms - (self._now_ms() - started))
            wait_ms = min(remaining_ms, max(20, sleep_ms))
            time.sleep(wait_ms / 1000.0)

    def depth_snapshot(self) -> dict[str, Any]:
        # Report no active execution queue for cutover compatibility.
        lanes = sorted(set(self._weights.keys()) | {"free", "pro", "pro_plus"})
        return {
            "total": 0,
            "byLane": {lane: 0 for lane in lanes},
            "storage": "disabled",
        }
