from __future__ import annotations

import base64
import logging
import os
import json
import re
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass
from typing import Any, Optional

try:
    import redis  # type: ignore
except Exception:  # pragma: no cover
    redis = None  # type: ignore

try:  # pragma: no cover - scheduler is optional outside Cloud Run
    from services.queue.cloud_tasks_wake import log_scheduler_failure, request_initial_drain
except Exception:  # pragma: no cover
    log_scheduler_failure = None  # type: ignore
    request_initial_drain = None  # type: ignore


LANE_PRIORITY: tuple[str, ...] = ("scale", "pro", "creator", "starter", "launcher", "free")
DEFAULT_LANE_WEIGHTS = {
    "scale": 12,
    "pro": 10,
    "creator": 8,
    "starter": 6,
    "launcher": 4,
    "free": 2,
}

QUEUE_TERMINAL_STATUSES = {"completed", "failed", "cancelled"}
WORKER_CATEGORY_APP_LOCAL = "APP_LOCAL"
WORKER_CATEGORY_GLOBAL_API = "GLOBAL_API"
DEFAULT_WORKER_CATEGORY = WORKER_CATEGORY_GLOBAL_API
WORKER_CATEGORIES = {
    WORKER_CATEGORY_APP_LOCAL,
    WORKER_CATEGORY_GLOBAL_API,
}


def normalize_lane(lane: str) -> str:
    token = str(lane or "").strip().lower()
    if token in {"plus", "pro-plus", "pro_plus", "proplus"}:
        return "scale"
    if token in {"launch", "launcher"}:
        return "launcher"
    if token in {"scale", "pro", "creator", "starter", "launcher", "free"}:
        return token
    return "free"


def normalize_worker_category(value: Any) -> str:
    token = str(value or "").strip().upper()
    if token in WORKER_CATEGORIES:
        return token
    if token in {"APP", "APP_SIDE", "INBUILT", "INBUILT_APP"}:
        return WORKER_CATEGORY_APP_LOCAL
    return DEFAULT_WORKER_CATEGORY


def _execution_worker_category() -> str:
    explicit = str(os.getenv("VF_TTS_WORKER_CATEGORY") or "").strip()
    if explicit:
        return normalize_worker_category(explicit)
    role = str(os.getenv("VF_SERVICE_ROLE") or "").strip().lower()
    if role == "api":
        return WORKER_CATEGORY_APP_LOCAL
    if role == "worker":
        return WORKER_CATEGORY_GLOBAL_API
    return DEFAULT_WORKER_CATEGORY


def _env_int(name: str, default: int) -> int:
    try:
        return int(str(os.getenv(name) or default).strip() or default)
    except Exception:
        return int(default)


def _env_bool(name: str, default: bool = False) -> bool:
    raw = str(os.getenv(name) or "").strip().lower()
    if not raw:
        return bool(default)
    return raw in {"1", "true", "yes", "on"}


def _is_production_like() -> bool:
    return str(os.getenv("VF_ENV") or os.getenv("ENV") or "").strip().lower() in {"prod", "production"}


def _queue_requires_durable_store() -> bool:
    return _is_production_like() and _env_bool("VF_TTS_QUEUE_ENABLED", True)


@dataclass(frozen=True)
class QueueItem:
    lane: str
    payload: dict[str, Any]


class WeightedInMemoryQueue:
    """
    Compatibility shim for local/dev use.
    This now has real weighted dequeue semantics, but it remains process-local.
    """

    def __init__(self, lane_weights: Optional[dict[str, int]] = None) -> None:
        self._lane_weights = {
            normalize_lane(key): max(1, int(value))
            for key, value in (lane_weights or DEFAULT_LANE_WEIGHTS).items()
        }
        self._depth_by_lane: dict[str, int] = {lane: 0 for lane in self._lane_weights}
        self._queues: dict[str, deque[QueueItem]] = {lane: deque() for lane in self._lane_weights}
        self._lane_order = self._build_lane_order()
        self._weighted_lane_order = self._build_weighted_lane_order()
        self._next_index = 0
        self._lock = threading.Lock()

    def _build_lane_order(self) -> list[str]:
        order = [lane for lane in LANE_PRIORITY if lane in self._queues]
        for lane in self._lane_weights:
            if lane not in order:
                order.append(lane)
        return order or ["free"]

    def _build_weighted_lane_order(self) -> list[str]:
        order = self._build_lane_order()
        weighted: list[str] = []
        for lane in order:
            weighted.extend([lane] * max(1, int(self._lane_weights.get(lane, 1))))
        return weighted or ["free"]

    def _refresh_lane_order(self) -> None:
        self._lane_order = self._build_lane_order()
        self._weighted_lane_order = self._build_weighted_lane_order()
        if self._weighted_lane_order:
            self._next_index %= len(self._weighted_lane_order)
        else:
            self._next_index = 0

    def push(self, lane: str, payload: dict[str, Any]) -> None:
        normalized = normalize_lane(lane)
        with self._lock:
            if normalized not in self._lane_weights:
                self._lane_weights[normalized] = 1
            if normalized not in self._queues:
                self._queues[normalized] = deque()
                self._depth_by_lane[normalized] = 0
                self._refresh_lane_order()
            self._depth_by_lane[normalized] = int(self._depth_by_lane.get(normalized, 0)) + 1
            self._queues[normalized].append(QueueItem(lane=normalized, payload=dict(payload or {})))

    def pop(self) -> Optional[QueueItem]:
        with self._lock:
            if not self._queues:
                return None
            lanes = self._weighted_lane_order or self._build_weighted_lane_order()
            if not lanes:
                return None
            lane_count = len(lanes)
            start_index = self._next_index % lane_count
            for offset in range(lane_count):
                lane = lanes[(start_index + offset) % lane_count]
                queue = self._queues.get(lane)
                if not queue:
                    continue
                try:
                    item = queue.popleft()
                except IndexError:
                    continue
                self._depth_by_lane[lane] = max(0, int(self._depth_by_lane.get(lane, 0)) - 1)
                self._next_index = (start_index + offset + 1) % lane_count
                return item
            return None

    def depth(self) -> int:
        with self._lock:
            return int(sum(self._depth_by_lane.values()))

    def depth_by_lane(self) -> dict[str, int]:
        with self._lock:
            return {lane: int(count) for lane, count in self._depth_by_lane.items()}


def _maybe_schedule_drain(queue: "TtsJobQueue", *, lane: str, job_id: str, reason: str) -> None:
    scheduler = request_initial_drain
    if scheduler is None:
        return
    redis_client = getattr(queue, "_redis", None)
    if redis_client is None:
        return
    try:
        scheduler(redis_client, queue.key_prefix, lane=lane, job_id=job_id, reason=reason)
    except Exception as exc:  # noqa: BLE001
        if callable(log_scheduler_failure):
            try:
                log_scheduler_failure(
                    getattr(queue, "_logger", logging.getLogger("voiceflow.tts_queue")),
                    action="request_initial_drain",
                    key_prefix=queue.key_prefix,
                    error=exc,
                    extra={"lane": lane, "jobId": job_id, "reason": reason},
                )
            except Exception:
                pass


class TtsJobQueue:
    """
    Durable queue API for TTS jobs.

    Redis is authoritative when available. The in-memory store only remains as a
    compatibility shim for local/dev code paths and for legacy callers that have
    not yet been rewired.
    """

    _DEFAULT_JOB_TTL_MS = 900_000
    _DEFAULT_CLAIM_TTL_SEC = 600
    _DEFAULT_MAX_QUEUE_DEPTH = 5000
    _DEFAULT_MAX_RECOVERY_ATTEMPTS = 3
    _DEFAULT_DEAD_LETTER_TTL_SEC = 86_400
    _RESERVE_FROM_LANE_LUA = """
local ready_key = KEYS[1]
local job_key_prefix = ARGV[1]
local claim_key_prefix = ARGV[2]
local counter_key_prefix = ARGV[3]
local worker_id = ARGV[4]
local now_ms = tonumber(ARGV[5]) or 0
local claim_ttl_sec = tonumber(ARGV[6]) or 60
local lane = ARGV[7]
local worker_category = string.upper(tostring(ARGV[8] or "GLOBAL_API"))
if worker_category == "" then
  worker_category = "GLOBAL_API"
end

local job_id = redis.call("LPOP", ready_key)
if not job_id then
  return {"empty", ""}
end

local job_key = job_key_prefix .. job_id
local claim_key = claim_key_prefix .. job_id
local raw_job = redis.call("GET", job_key)
if not raw_job then
  return {"missing", tostring(job_id)}
end

local ok_job, job = pcall(cjson.decode, raw_job)
if not ok_job or type(job) ~= "table" then
  return {"invalid", tostring(job_id)}
end

local status = string.lower(tostring(job["status"] or "queued"))
if status == "completed" or status == "failed" or status == "cancelled" then
  redis.call("DEL", claim_key)
  return {"terminal", tostring(job_id)}
end
if status ~= "queued" then
  return {"ineligible", tostring(job_id)}
end

local job_category = string.upper(tostring(job["workerCategory"] or "GLOBAL_API"))
if job_category == "" then
  job_category = "GLOBAL_API"
end
if job_category ~= worker_category then
  redis.call("RPUSH", ready_key, job_id)
  return {"category_mismatch", tostring(job_id)}
end

local existing_claim = redis.call("GET", claim_key)
if existing_claim then
  local ok_claim, claim = pcall(cjson.decode, existing_claim)
  local claimed_at_ms = 0
  if ok_claim and type(claim) == "table" then
    claimed_at_ms = tonumber(claim["claimedAtMs"] or 0) or 0
  end
  local stale = claimed_at_ms <= 0 or ((now_ms - claimed_at_ms) >= (claim_ttl_sec * 1000))
  if not stale then
    redis.call("RPUSH", ready_key, job_id)
    return {"busy", tostring(job_id)}
  end
  redis.call("DEL", claim_key)
end

local claim_token = cjson.encode({workerId = worker_id, claimedAtMs = now_ms})
local claim_ok = redis.call("SET", claim_key, claim_token, "NX", "EX", claim_ttl_sec)
if not claim_ok then
  redis.call("RPUSH", ready_key, job_id)
  return {"busy", tostring(job_id)}
end

local uid = tostring(job["uid"] or "")
if uid ~= "" then
  local counter_key = counter_key_prefix .. uid
  local current_count = tonumber(redis.call("GET", counter_key) or "0") or 0
  local next_count = current_count - 1
  if next_count <= 0 then
    redis.call("DEL", counter_key)
  else
    redis.call("SET", counter_key, tostring(next_count))
  end
end

job["status"] = "running"
job["workerId"] = worker_id
job["attempts"] = (tonumber(job["attempts"] or 0) or 0) + 1
if (tonumber(job["startedAtMs"] or 0) or 0) <= 0 then
  job["startedAtMs"] = now_ms
end
job["updatedAtMs"] = now_ms
job["claimRenewedAtMs"] = now_ms
if not job["lane"] or tostring(job["lane"]) == "" then
  job["lane"] = lane
end

local encoded_job = cjson.encode(job)
local ttl = redis.call("TTL", job_key)
if ttl and ttl > 0 then
  redis.call("SET", job_key, encoded_job, "EX", ttl)
else
  redis.call("SET", job_key, encoded_job)
end
return {"reserved", encoded_job}
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
        self.key_prefix = str(key_prefix or "vf:tts:jobs").strip() or "vf:tts:jobs"
        self._result_ttl_ms = max(5_000, int(result_ttl_ms))
        self._inline_result_max_bytes = max(64_000, int(inline_result_max_bytes))
        self._max_queue_depth = max(1, _env_int("VF_TTS_QUEUE_MAX_DEPTH", self._DEFAULT_MAX_QUEUE_DEPTH))
        self._max_queued_per_lane = max(0, _env_int("VF_TTS_QUEUE_MAX_QUEUED_PER_LANE", 0))
        self._max_queued_per_category = {
            WORKER_CATEGORY_APP_LOCAL: max(0, _env_int("VF_TTS_QUEUE_MAX_QUEUED_APP_LOCAL", 0)),
            WORKER_CATEGORY_GLOBAL_API: max(0, _env_int("VF_TTS_QUEUE_MAX_QUEUED_GLOBAL_API", 0)),
        }
        self._max_recovery_attempts = max(
            1,
            _env_int("VF_TTS_QUEUE_MAX_RECOVERY_ATTEMPTS", self._DEFAULT_MAX_RECOVERY_ATTEMPTS),
        )
        self._max_queued_per_user = max(0, _env_int("VF_TTS_QUEUE_MAX_QUEUED_PER_USER", 0))
        self._mirror_max_jobs = max(0, _env_int("VF_TTS_QUEUE_MIRROR_MAX_JOBS", 2000))
        self._reserve_anomaly_ttl_sec = max(60, _env_int("VF_TTS_QUEUE_RESERVE_ANOMALY_TTL_SEC", 86_400))
        self._weights = {
            normalize_lane(key): max(1, int(value))
            for key, value in (lane_weights or DEFAULT_LANE_WEIGHTS).items()
        }
        self._claim_ttl_sec = max(
            30,
            min(_env_int("VF_TTS_QUEUE_CLAIM_TTL_SEC", 90), self._result_ttl_ms // 1000),
        )
        self._missing_claim_grace_ms = max(5_000, _env_int("VF_TTS_QUEUE_MISSING_CLAIM_GRACE_SEC", 60) * 1000)
        self._dead_letter_enabled = _env_bool("VF_TTS_QUEUE_DEAD_LETTER_ENABLED", False)
        self._dead_letter_ttl_sec = max(
            60,
            _env_int(
                "VF_TTS_QUEUE_DEAD_LETTER_TTL_SEC",
                max(self._DEFAULT_DEAD_LETTER_TTL_SEC, int(self._result_ttl_ms / 1000)),
            ),
        )
        # Keep request identity around for at least the replay-risk window so a retry cannot outlive the job/result.
        dedupe_horizon_sec = max(
            120,
            _env_int("VF_TTS_QUEUE_DEDUPE_HORIZON_SEC", max(300, int(self._result_ttl_ms / 1000))),
        )
        self._dedupe_ttl_sec = max(
            60,
            _env_int("VF_TTS_QUEUE_DEDUPE_TTL_SEC", dedupe_horizon_sec),
            dedupe_horizon_sec,
        )
        self._logger = logging.getLogger("voiceflow.tts_queue")
        self._lock = threading.Lock()
        self._jobs: dict[str, dict[str, Any]] = {}
        self._job_lanes: dict[str, str] = {}
        self._job_cache_order: deque[str] = deque()
        self._compat_queue = WeightedInMemoryQueue(self._weights)
        self._lane_rr = deque(self._weighted_lane_schedule())
        self._redis = None
        self._dedupe_metrics = {
            "dedupe_hit": 0,
            "dedupe_miss": 0,
            "dedupe_expired_replay": 0,
        }
        requires_durable_store = _queue_requires_durable_store()
        if redis is not None and str(redis_url or "").strip():
            try:
                self._redis = redis.Redis.from_url(str(redis_url).strip(), decode_responses=True)
                self._redis.ping()
            except Exception as exc:
                if requires_durable_store:
                    raise RuntimeError("Redis is required for durable TTS queue operations in production.") from exc
                self._redis = None
        elif requires_durable_store:
            raise RuntimeError("Redis is required for durable TTS queue operations in production.")

    def is_redis_enabled(self) -> bool:
        return self._redis is not None

    def _now_ms(self) -> int:
        return int(time.time() * 1000)

    def _expires_at_ms(self, now_ms: Optional[int] = None) -> int:
        anchor = int(now_ms if now_ms is not None else self._now_ms())
        return anchor + self._result_ttl_ms

    def _job_key(self, job_id: str) -> str:
        return f"{self.key_prefix}:job:{job_id}"

    def _ready_key(self, lane: str) -> str:
        return f"{self.key_prefix}:ready:{normalize_lane(lane)}"

    def _user_queued_key(self, uid: str) -> str:
        return f"{self.key_prefix}:queued-user:{str(uid or '').strip()}"

    def _enqueue_ready_once(self, *, lane: str, job_id: str) -> None:
        if self._redis is None:
            raise RuntimeError("Redis is required for durable ready-queue operations.")
        safe_lane = normalize_lane(lane)
        safe_job_id = str(job_id or "").strip()
        if not safe_job_id:
            return
        ready_key = self._ready_key(safe_lane)
        try:
            self._redis.lrem(ready_key, 0, safe_job_id)
            self._redis.rpush(ready_key, safe_job_id)
        except Exception as exc:
            raise RuntimeError(f"Redis ready enqueue failed: {exc}") from exc

    def _wait_for_redis_job_record(self, job_id: str, *, timeout_ms: Optional[int] = None) -> Optional[dict[str, Any]]:
        safe_job_id = str(job_id or "").strip()
        if not safe_job_id:
            return None
        deadline_ms = self._now_ms() + max(0, int(timeout_ms if timeout_ms is not None else _env_int("VF_TTS_QUEUE_DEDUPE_WAIT_MS", 250)))
        while True:
            record = self.get(safe_job_id)
            if record:
                return record
            now_ms = self._now_ms()
            if now_ms >= deadline_ms:
                return None
            sleep_for = min(0.02, max(0.0, (deadline_ms - now_ms) / 1000.0))
            if sleep_for <= 0:
                return None
            time.sleep(sleep_for)

    def _pending_dedupe_record(self, record: dict[str, Any], *, job_id: str, lane: str) -> dict[str, Any]:
        pending = dict(record)
        pending["jobId"] = str(job_id or pending.get("jobId") or "").strip()
        pending["requestId"] = str(pending.get("requestId") or pending.get("request_id") or "")
        pending["lane"] = normalize_lane(lane)
        pending["status"] = "queued"
        pending["workerId"] = str(pending.get("workerId") or "").strip()
        pending["updatedAtMs"] = self._now_ms()
        return pending

    def _claim_key(self, job_id: str) -> str:
        return f"{self.key_prefix}:claim:{job_id}"

    def _dedupe_key(self, request_id: str) -> str:
        safe = re.sub(r"[^A-Za-z0-9._:-]+", "_", str(request_id or "").strip())
        return f"{self.key_prefix}:dedupe:{safe}"

    def _dedupe_metric_bump(self, metric_name: str) -> None:
        safe_name = str(metric_name or "").strip()
        if safe_name not in self._dedupe_metrics:
            return
        with self._lock:
            self._dedupe_metrics[safe_name] = int(self._dedupe_metrics.get(safe_name) or 0) + 1

    def _dedupe_metric_snapshot(self) -> dict[str, int]:
        with self._lock:
            return {
                "dedupe_hit": int(self._dedupe_metrics.get("dedupe_hit") or 0),
                "dedupe_miss": int(self._dedupe_metrics.get("dedupe_miss") or 0),
                "dedupe_expired_replay": int(self._dedupe_metrics.get("dedupe_expired_replay") or 0),
            }

    def _dead_letter_key(self, job_id: str) -> str:
        return f"{self.key_prefix}:deadletter:{job_id}"

    def _reserve_anomaly_key(self, lane: str, job_id: str) -> str:
        safe_lane = normalize_lane(lane)
        safe_job_id = re.sub(r"[^A-Za-z0-9._:-]+", "_", str(job_id or "").strip()) or "unknown"
        return f"{self.key_prefix}:reserve-anomaly:{safe_lane}:{safe_job_id}"

    def _weighted_lane_order(self) -> list[str]:
        order = [lane for lane in LANE_PRIORITY if lane in self._weights]
        for lane in self._weights:
            normalized = normalize_lane(lane)
            if normalized not in order:
                order.append(normalized)
        return order or ["free"]

    def _weighted_lane_schedule(self) -> list[str]:
        schedule: list[str] = []
        for lane in self._weighted_lane_order():
            schedule.extend([lane] * max(1, int(self._weights.get(lane, 1))))
        return schedule or ["free"]

    def _unique_lanes(self) -> list[str]:
        seen: set[str] = set()
        lanes: list[str] = []
        for lane in self._weighted_lane_order():
            normalized = normalize_lane(lane)
            if normalized in seen:
                continue
            seen.add(normalized)
            lanes.append(normalized)
        for lane in LANE_PRIORITY:
            if lane in seen:
                continue
            seen.add(lane)
            lanes.append(lane)
        return lanes or ["free"]

    def _rotate_lanes(self) -> list[str]:
        with self._lock:
            if not self._lane_rr:
                self._lane_rr = deque(self._weighted_lane_schedule())
            if not self._lane_rr:
                return ["free"]
            lanes: list[str] = []
            seen: set[str] = set()
            for lane in self._lane_rr:
                normalized = normalize_lane(lane)
                if normalized in seen:
                    continue
                seen.add(normalized)
                lanes.append(normalized)
            self._lane_rr.rotate(-1)
            return lanes or ["free"]

    def _claim_token(self, *, worker_id: str, claimed_at_ms: int) -> str:
        return json.dumps(
            {"workerId": str(worker_id or "").strip() or "worker", "claimedAtMs": int(claimed_at_ms)},
            separators=(",", ":"),
            sort_keys=True,
        )

    def _default_result(self, raw_audio: bytes, media_type: str, headers: Optional[dict[str, str]] = None) -> dict[str, Any]:
        audio_bytes = bytes(raw_audio or b"")
        result: dict[str, Any] = {
            "mediaType": str(media_type or "audio/wav"),
            "headers": {str(k): str(v) for k, v in dict(headers or {}).items()},
            "sizeBytes": len(audio_bytes),
        }
        if len(audio_bytes) <= self._inline_result_max_bytes and audio_bytes:
            result["audioBase64"] = base64.b64encode(audio_bytes).decode("ascii")
        return result

    def _normalize_record(
        self,
        *,
        payload: Optional[dict[str, Any]] = None,
        lane: Optional[str] = None,
        now_ms: Optional[int] = None,
        existing: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        base = dict(existing or {})
        base.update(dict(payload or {}))
        anchor = int(now_ms if now_ms is not None else self._now_ms())
        raw_job_id = str(base.get("jobId") or base.get("job_id") or "").strip()
        raw_request_id = str(base.get("requestId") or base.get("request_id") or "").strip()
        raw_idempotency_key = str(
            base.get("idempotencyKey") or base.get("idempotency_key") or raw_request_id or raw_job_id
        ).strip()
        normalized_lane = normalize_lane(str(base.get("lane") or lane or "free"))
        result = dict(base.get("result") or {}) if isinstance(base.get("result"), dict) else {}
        error = base.get("error")
        if isinstance(error, dict):
            error_payload = dict(error)
        elif error:
            error_payload = {"detail": str(error)}
        else:
            error_payload = {}
        # Preserve unknown metadata fields so forward-compatible job state
        # (for example lease or billing settlement fields) survives updates.
        record = {
            **base,
            "jobId": raw_job_id or uuid.uuid4().hex,
            "idempotencyKey": raw_idempotency_key,
            "uid": str(base.get("uid") or "").strip(),
            "requestId": raw_request_id or raw_job_id or "",
            "lane": normalized_lane,
            "workerCategory": normalize_worker_category(base.get("workerCategory")),
            "createdAtMs": int(base.get("createdAtMs") or base.get("created_at_ms") or anchor),
            "updatedAtMs": int(base.get("updatedAtMs") or base.get("updated_at_ms") or anchor),
            "status": str(base.get("status") or "queued").strip().lower() or "queued",
            "attempts": max(0, int(base.get("attempts") or 0)),
            "recoveryAttempts": max(0, int(base.get("recoveryAttempts") or base.get("recovery_attempts") or 0)),
            "workerId": str(base.get("workerId") or base.get("worker_id") or "").strip(),
            "cancelRequested": bool(base.get("cancelRequested") or base.get("cancel_requested") or False),
            "statusCode": int(base.get("statusCode") or base.get("status_code") or 0),
            "error": error_payload,
            "startedAtMs": int(base.get("startedAtMs") or base.get("started_at_ms") or 0),
            "finishedAtMs": int(base.get("finishedAtMs") or base.get("finished_at_ms") or 0),
            "expiresAtMs": int(base.get("expiresAtMs") or base.get("expires_at_ms") or self._expires_at_ms(anchor)),
            "result": {
                "mediaType": str(result.get("mediaType") or result.get("media_type") or "audio/wav"),
                "headers": {str(k): str(v) for k, v in dict(result.get("headers") or {}).items()},
                "sizeBytes": int(result.get("sizeBytes") or result.get("size_bytes") or 0),
                "audioBase64": str(result.get("audioBase64") or result.get("audio_base64") or ""),
                "audioRef": dict(result.get("audioRef") or result.get("audio_ref") or {})
                if isinstance(result.get("audioRef") or result.get("audio_ref"), dict)
                else {},
            },
            "payload": dict(base.get("payload") or {}),
        }
        if not record["result"]["audioBase64"]:
            record["result"].pop("audioBase64", None)
        if not record["result"]["audioRef"]:
            record["result"].pop("audioRef", None)
        return record

    def _serialize_record(self, record: dict[str, Any]) -> str:
        return json.dumps(record, sort_keys=True, separators=(",", ":"), ensure_ascii=True)

    def _deserialize_record(self, payload: str) -> Optional[dict[str, Any]]:
        token = str(payload or "").strip()
        if not token:
            return None
        try:
            decoded = json.loads(token)
        except Exception:
            return None
        return dict(decoded) if isinstance(decoded, dict) else None

    def _store_memory_record(self, record: dict[str, Any]) -> dict[str, Any]:
        job_id = str(record.get("jobId") or "").strip()
        if not job_id:
            raise ValueError("jobId is required.")
        if self._redis is not None:
            if self._mirror_max_jobs <= 0:
                return dict(record)
            with self._lock:
                self._jobs[job_id] = dict(record)
                self._job_lanes[job_id] = str(record.get("lane") or "free")
                try:
                    self._job_cache_order.remove(job_id)
                except ValueError:
                    pass
                self._job_cache_order.append(job_id)
                while len(self._job_cache_order) > self._mirror_max_jobs:
                    evict_id = str(self._job_cache_order.popleft() or "").strip()
                    if not evict_id or evict_id == job_id:
                        continue
                    self._jobs.pop(evict_id, None)
                    self._job_lanes.pop(evict_id, None)
            return dict(record)
        with self._lock:
            self._jobs[job_id] = dict(record)
            self._job_lanes[job_id] = str(record.get("lane") or "free")
            self._compat_queue.push(str(record.get("lane") or "free"), dict(record))
        return dict(record)

    def _load_memory_record(self, job_id: str) -> Optional[dict[str, Any]]:
        safe_job_id = str(job_id or "").strip()
        if not safe_job_id:
            return None
        with self._lock:
            payload = self._jobs.get(safe_job_id)
            return dict(payload) if isinstance(payload, dict) else None

    def _persist_redis_record(self, record: dict[str, Any]) -> dict[str, Any]:
        if self._redis is None:
            return self._store_memory_record(record)
        job_id = str(record.get("jobId") or "").strip()
        request_id = str(record.get("requestId") or "").strip()
        idempotency_key = str(record.get("idempotencyKey") or request_id).strip()
        lane = normalize_lane(str(record.get("lane") or "free"))
        previous = self._load_redis_record(job_id)
        ttl_ms = max(self._DEFAULT_JOB_TTL_MS, int(record.get("expiresAtMs") or 0) - int(record.get("createdAtMs") or self._now_ms()))
        ttl_sec = max(60, int(round(ttl_ms / 1000)))
        job_key = self._job_key(job_id)
        ready_key = self._ready_key(lane)
        claim_key = self._claim_key(job_id)
        dedupe_key = self._dedupe_key(idempotency_key or request_id) if (idempotency_key or request_id) else ""
        serialized = self._serialize_record(record)
        adjustments = self._user_queued_counter_adjustments(previous, record)
        counter_updates: list[tuple[str, int]] = []
        for uid, delta in adjustments.items():
            counter_key = self._user_queued_key(uid)
            try:
                current_count = max(0, int(self._redis.get(counter_key) or 0))
            except Exception as exc:
                raise RuntimeError(f"Redis user queue counter read failed: {exc}") from exc
            counter_updates.append((counter_key, max(0, current_count + int(delta))))
        try:
            pipe = self._redis.pipeline(transaction=True)
            pipe.set(job_key, serialized, ex=ttl_sec)
            pipe.delete(claim_key)
            pipe.rpush(ready_key, job_id)
            pipe.expire(ready_key, ttl_sec)
            if dedupe_key:
                pipe.set(dedupe_key, job_id, ex=min(ttl_sec, self._dedupe_ttl_sec), nx=True)
            for counter_key, next_count in counter_updates:
                if next_count <= 0:
                    pipe.delete(counter_key)
                else:
                    pipe.set(counter_key, str(next_count))
            pipe.execute()
        except Exception as exc:
            raise RuntimeError(f"Redis enqueue failed: {exc}") from exc
        return self._store_memory_record(record)

    def _load_redis_record(self, job_id: str) -> Optional[dict[str, Any]]:
        if self._redis is None:
            return None
        safe_job_id = str(job_id or "").strip()
        if not safe_job_id:
            return None
        try:
            payload = self._redis.get(self._job_key(safe_job_id))
        except Exception as exc:
            raise RuntimeError(f"Redis read failed: {exc}") from exc
        if not payload:
            return None
        return self._deserialize_record(payload)

    def _persist_record_update(
        self,
        record: dict[str, Any],
        *,
        ready_mode: str = "",
        clear_claim: bool = False,
    ) -> dict[str, Any]:
        updated = self._normalize_record(existing=record, now_ms=self._now_ms())
        updated_status = str(updated.get("status") or "").strip().lower()

        def _is_terminal_conflict(previous: Optional[dict[str, Any]]) -> bool:
            if not isinstance(previous, dict):
                return False
            previous_status = str(previous.get("status") or "").strip().lower()
            if previous_status not in QUEUE_TERMINAL_STATUSES:
                return False
            if not updated_status:
                return False
            return updated_status != previous_status

        if self._redis is not None:
            job_id = str(updated.get("jobId") or "").strip()
            if not job_id:
                raise ValueError("jobId is required.")
            ttl_ms = max(self._DEFAULT_JOB_TTL_MS, int(updated.get("expiresAtMs") or 0) - int(updated.get("createdAtMs") or self._now_ms()))
            ttl_sec = max(60, int(round(ttl_ms / 1000)))
            previous = self._load_redis_record(job_id)
            normalized_ready_mode = str(ready_mode or "").strip().lower()
            if _is_terminal_conflict(previous):
                if clear_claim or normalized_ready_mode:
                    try:
                        pipe = self._redis.pipeline(transaction=True)
                        if clear_claim:
                            pipe.delete(self._claim_key(job_id))
                        if normalized_ready_mode == "replace":
                            pipe.lrem(self._ready_key(str(updated.get("lane") or "free")), 0, job_id)
                        elif normalized_ready_mode == "enqueue":
                            pipe.rpush(self._ready_key(str(updated.get("lane") or "free")), job_id)
                            pipe.expire(self._ready_key(str(updated.get("lane") or "free")), ttl_sec)
                        elif normalized_ready_mode == "remove":
                            pipe.lrem(self._ready_key(str(updated.get("lane") or "free")), 0, job_id)
                        pipe.execute()
                    except Exception:
                        pass
                return dict(previous or {})
            ready_key = self._ready_key(str(updated.get("lane") or "free"))
            claim_key = self._claim_key(job_id)
            adjustments = self._user_queued_counter_adjustments(previous, updated)
            counter_updates: list[tuple[str, int]] = []
            for uid, delta in adjustments.items():
                counter_key = self._user_queued_key(uid)
                try:
                    current_count = max(0, int(self._redis.get(counter_key) or 0))
                except Exception as exc:
                    raise RuntimeError(f"Redis user queue counter read failed: {exc}") from exc
                counter_updates.append((counter_key, max(0, current_count + int(delta))))
            try:
                pipe = self._redis.pipeline(transaction=True)
                pipe.set(self._job_key(job_id), self._serialize_record(updated), ex=ttl_sec)
                if clear_claim:
                    pipe.delete(claim_key)
                normalized_ready_mode = str(ready_mode or "").strip().lower()
                if normalized_ready_mode == "replace":
                    pipe.lrem(ready_key, 0, job_id)
                    pipe.rpush(ready_key, job_id)
                    pipe.expire(ready_key, ttl_sec)
                elif normalized_ready_mode == "enqueue":
                    pipe.rpush(ready_key, job_id)
                    pipe.expire(ready_key, ttl_sec)
                elif normalized_ready_mode == "remove":
                    pipe.lrem(ready_key, 0, job_id)
                for counter_key, next_count in counter_updates:
                    if next_count <= 0:
                        pipe.delete(counter_key)
                    else:
                        pipe.set(counter_key, str(next_count))
                pipe.execute()
            except Exception as exc:
                raise RuntimeError(f"Redis update failed: {exc}") from exc
        if self._redis is None:
            with self._lock:
                safe_job_id = str(updated.get("jobId") or "").strip()
                previous_memory = self._jobs.get(safe_job_id) if safe_job_id else None
                if _is_terminal_conflict(previous_memory):
                    return dict(previous_memory or {})
                self._jobs[safe_job_id] = dict(updated)
                self._job_lanes[safe_job_id] = str(updated.get("lane") or "free")
        return dict(updated)

    def _claim_metadata(self, job_id: str) -> dict[str, Any]:
        if self._redis is None:
            return {}
        claim_key = self._claim_key(str(job_id or "").strip())
        try:
            payload = self._redis.get(claim_key)
        except Exception as exc:
            raise RuntimeError(f"Redis claim read failed: {exc}") from exc
        if not payload:
            return {}
        try:
            decoded = json.loads(str(payload))
        except Exception:
            return {}
        return dict(decoded) if isinstance(decoded, dict) else {}

    def _claim_is_stale(self, claim_metadata: dict[str, Any], *, now_ms: Optional[int] = None) -> bool:
        claimed_at_ms = max(0, int(claim_metadata.get("claimedAtMs") or 0))
        if not claimed_at_ms:
            return True
        anchor = int(now_ms if now_ms is not None else self._now_ms())
        return anchor - claimed_at_ms >= int(self._claim_ttl_sec * 1000)

    def _is_recent_missing_claim(self, record: dict[str, Any], *, now_ms: Optional[int] = None) -> bool:
        anchor = int(now_ms if now_ms is not None else self._now_ms())
        last_claim_renewed_ms = max(
            0,
            int(record.get("claimRenewedAtMs") or 0),
            int(record.get("updatedAtMs") or 0),
            int(record.get("startedAtMs") or 0),
        )
        if last_claim_renewed_ms <= 0:
            return False
        return (anchor - last_claim_renewed_ms) < int(self._missing_claim_grace_ms)

    def _record_claim_renewed(self, *, job_id: str, worker_id: str, renewed_at_ms: int) -> None:
        safe_job_id = str(job_id or "").strip()
        safe_worker_id = str(worker_id or "").strip() or "worker"
        if not safe_job_id:
            return
        record = self.get(safe_job_id)
        if not isinstance(record, dict):
            return
        if str(record.get("status") or "").strip().lower() != "running":
            return
        if str(record.get("workerId") or "").strip() not in {"", safe_worker_id}:
            return
        updated = dict(record)
        updated["claimRenewedAtMs"] = int(renewed_at_ms)
        updated["updatedAtMs"] = max(int(updated.get("updatedAtMs") or 0), int(renewed_at_ms))
        try:
            self._persist_record_update(updated)
        except Exception:
            # Renewal metadata sync is best-effort and must not block claim extension.
            return

    def _queue_depth_for_lane(self, lane: str) -> int:
        safe_lane = normalize_lane(lane)
        if self._redis is None:
            return int(self._compat_queue.depth_by_lane().get(safe_lane, 0))
        try:
            return int(self._redis.llen(self._ready_key(safe_lane)))
        except Exception as exc:
            raise RuntimeError(f"Redis lane depth snapshot failed: {exc}") from exc

    def _enforce_lane_queue_cap(self, lane: str) -> None:
        if self._max_queued_per_lane <= 0:
            return
        safe_lane = normalize_lane(lane)
        lane_depth = self._queue_depth_for_lane(safe_lane)
        if lane_depth >= self._max_queued_per_lane:
            raise RuntimeError(
                f"Per-lane queued cap exceeded for lane '{safe_lane}' ({lane_depth}/{self._max_queued_per_lane})."
            )

    def _queued_depth_for_category(self, worker_category: str) -> int:
        safe_category = normalize_worker_category(worker_category)
        queued = 0
        for record in self._iter_records():
            if str(record.get("status") or "").strip().lower() != "queued":
                continue
            if normalize_worker_category(record.get("workerCategory")) != safe_category:
                continue
            queued += 1
        return queued

    def _enforce_category_queue_cap(self, worker_category: str) -> None:
        safe_category = normalize_worker_category(worker_category)
        category_cap = int(self._max_queued_per_category.get(safe_category) or 0)
        if category_cap <= 0:
            return
        queued_depth = self._queued_depth_for_category(safe_category)
        if queued_depth >= category_cap:
            raise RuntimeError(
                f"Per-category queued cap exceeded for worker category '{safe_category}' ({queued_depth}/{category_cap})."
            )

    def _category_depth_snapshot(self) -> dict[str, int]:
        counts: dict[str, int] = {
            WORKER_CATEGORY_APP_LOCAL: 0,
            WORKER_CATEGORY_GLOBAL_API: 0,
        }
        for record in self._iter_records():
            if str(record.get("status") or "").strip().lower() != "queued":
                continue
            category = normalize_worker_category(record.get("workerCategory"))
            counts[category] = int(counts.get(category, 0)) + 1
        return counts

    def _record_reserve_anomaly(self, *, lane: str, job_id: str, reason: str, raw_record: Optional[str] = None) -> None:
        if self._redis is None:
            return
        safe_lane = normalize_lane(lane)
        safe_job_id = str(job_id or "").strip() or "unknown"
        payload = {
            "lane": safe_lane,
            "jobId": safe_job_id,
            "reason": str(reason or "unknown").strip() or "unknown",
            "ts": self._now_ms(),
        }
        if raw_record is not None:
            payload["rawRecord"] = str(raw_record)
        try:
            self._redis.set(
                self._reserve_anomaly_key(safe_lane, safe_job_id),
                json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True),
                ex=self._reserve_anomaly_ttl_sec,
            )
        except Exception:
            pass
        self._logger.warning(
            "Queue reserve anomaly detected",
            extra={"lane": safe_lane, "jobId": safe_job_id, "reason": payload["reason"]},
        )

    def _queue_depth_total(self) -> int:
        if self._redis is None:
            return self._compat_queue.depth()
        try:
            lanes = self._unique_lanes()
            return int(sum(int(self._redis.llen(self._ready_key(lane))) for lane in lanes))
        except Exception as exc:
            raise RuntimeError(f"Redis depth snapshot failed: {exc}") from exc

    def _iter_records(self) -> list[dict[str, Any]]:
        if self._redis is None:
            with self._lock:
                return [dict(record) for record in self._jobs.values() if isinstance(record, dict)]
        scan_iter = getattr(self._redis, "scan_iter", None)
        prefix = f"{self.key_prefix}:job:"
        records: list[dict[str, Any]] = []
        try:
            if callable(scan_iter):
                for key in scan_iter(match=f"{prefix}*"):
                    job_id = str(key).split(prefix, 1)[-1].strip()
                    if not job_id:
                        continue
                    record = self.get(job_id)
                    if isinstance(record, dict):
                        records.append(record)
                return records
        except Exception:
            return records
        with self._lock:
            return [dict(record) for record in self._jobs.values() if isinstance(record, dict)]

    def _queued_depth_for_user(self, uid: str) -> int:
        safe_uid = str(uid or "").strip()
        if not safe_uid:
            return 0
        if self._redis is None:
            queued = 0
            for record in self._iter_records():
                if str(record.get("uid") or "").strip() != safe_uid:
                    continue
                if str(record.get("status") or "").strip().lower() != "queued":
                    continue
                queued += 1
            return queued
        try:
            return max(0, int(self._redis.get(self._user_queued_key(safe_uid)) or 0))
        except Exception as exc:
            raise RuntimeError(f"Redis user queue counter read failed: {exc}") from exc

    def _enforce_user_queued_cap(self, uid: str) -> None:
        if self._max_queued_per_user <= 0:
            return
        safe_uid = str(uid or "").strip()
        if not safe_uid:
            return
        if self._queued_depth_for_user(safe_uid) >= self._max_queued_per_user:
            raise RuntimeError(f"Per-user queued cap exceeded for uid '{safe_uid}'.")

    def _is_queued_status(self, status: Any) -> bool:
        return str(status or "").strip().lower() == "queued"

    def _user_queued_counter_adjustments(
        self,
        previous: Optional[dict[str, Any]],
        current: dict[str, Any],
    ) -> dict[str, int]:
        adjustments: dict[str, int] = {}

        def bump(uid: Any, delta: int) -> None:
            safe_uid = str(uid or "").strip()
            if not safe_uid or not int(delta):
                return
            adjustments[safe_uid] = adjustments.get(safe_uid, 0) + int(delta)
            if adjustments[safe_uid] == 0:
                adjustments.pop(safe_uid, None)

        if previous and self._is_queued_status(previous.get("status")):
            bump(previous.get("uid"), -1)
        if self._is_queued_status(current.get("status")):
            bump(current.get("uid"), 1)
        return adjustments

    def _write_dead_letter(
        self,
        *,
        job_id: str,
        worker_id: str,
        reason: str,
        record: Optional[dict[str, Any]] = None,
    ) -> None:
        if not self._dead_letter_enabled or self._redis is None:
            return
        safe_job_id = str(job_id or "").strip()
        if not safe_job_id:
            return
        payload = {
            "jobId": safe_job_id,
            "workerId": str(worker_id or "").strip() or "reaper",
            "reason": str(reason or "unknown").strip() or "unknown",
            "recordedAtMs": self._now_ms(),
            "record": dict(record or {}),
        }
        try:
            self._redis.set(
                self._dead_letter_key(safe_job_id),
                json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True),
                ex=self._dead_letter_ttl_sec,
            )
        except Exception:
            # Dead-letter capture is best effort and must not block recovery.
            return

    def renew_claim(self, job_id: str, *, worker_id: str) -> bool:
        self._require_redis()
        safe_job_id = str(job_id or "").strip()
        safe_worker_id = str(worker_id or "").strip() or "worker"
        if not safe_job_id:
            return False
        claim_key = self._claim_key(safe_job_id)
        claim_metadata = self._claim_metadata(safe_job_id)
        if not claim_metadata:
            record = self.get(safe_job_id)
            if not isinstance(record, dict):
                return False
            if str(record.get("status") or "").strip().lower() != "running":
                return False
            if str(record.get("workerId") or "").strip() not in {"", safe_worker_id}:
                return False
            renewed_at_ms = self._now_ms()
            token = self._claim_token(worker_id=safe_worker_id, claimed_at_ms=renewed_at_ms)
            try:
                renewed = bool(self._redis.set(claim_key, token, ex=self._claim_ttl_sec, nx=True))
            except Exception as exc:
                raise RuntimeError(f"Redis claim renewal failed: {exc}") from exc
            if renewed:
                self._record_claim_renewed(job_id=safe_job_id, worker_id=safe_worker_id, renewed_at_ms=renewed_at_ms)
            return renewed
        if str(claim_metadata.get("workerId") or "").strip() not in {"", safe_worker_id}:
            return False
        renewed_at_ms = self._now_ms()
        token = self._claim_token(worker_id=safe_worker_id, claimed_at_ms=renewed_at_ms)
        try:
            try:
                renewed = self._redis.set(
                    claim_key,
                    token,
                    ex=self._claim_ttl_sec,
                    xx=True,
                )
            except TypeError:
                renewed = self._redis.set(
                    claim_key,
                    token,
                    ex=self._claim_ttl_sec,
                )
            if renewed:
                self._record_claim_renewed(job_id=safe_job_id, worker_id=safe_worker_id, renewed_at_ms=renewed_at_ms)
                return True
            record = self.get(safe_job_id)
            if not isinstance(record, dict):
                return False
            if str(record.get("status") or "").strip().lower() != "running":
                return False
            if str(record.get("workerId") or "").strip() not in {"", safe_worker_id}:
                return False
            renewed = bool(self._redis.set(claim_key, token, ex=self._claim_ttl_sec, nx=True))
            if renewed:
                self._record_claim_renewed(job_id=safe_job_id, worker_id=safe_worker_id, renewed_at_ms=renewed_at_ms)
            return renewed
        except Exception as exc:
            raise RuntimeError(f"Redis claim renewal failed: {exc}") from exc

    def _reserve_from_lane_with_eval(
        self,
        *,
        lane: str,
        worker_id: str,
        now_ms: int,
        worker_category: str,
    ) -> tuple[bool, Optional[dict[str, Any]]]:
        eval_fn = getattr(self._redis, "eval", None)
        if not callable(eval_fn):
            return False, None
        normalized_lane = normalize_lane(lane)
        normalized_category = normalize_worker_category(worker_category)
        try:
            result = eval_fn(
                self._RESERVE_FROM_LANE_LUA,
                1,
                self._ready_key(normalized_lane),
                f"{self.key_prefix}:job:",
                f"{self.key_prefix}:claim:",
                f"{self.key_prefix}:queued-user:",
                str(worker_id or "").strip() or "worker",
                str(int(now_ms)),
                str(int(self._claim_ttl_sec)),
                normalized_lane,
                normalized_category,
            )
        except Exception:
            return False, None
        payload: list[Any]
        if isinstance(result, (list, tuple)):
            payload = list(result)
        elif result is None:
            payload = []
        else:
            payload = [result]
        raw_status = payload[0] if payload else ""
        raw_record = payload[1] if len(payload) > 1 else ""
        if isinstance(raw_status, bytes):
            raw_status = raw_status.decode("utf-8", errors="ignore")
        if isinstance(raw_record, bytes):
            raw_record = raw_record.decode("utf-8", errors="ignore")
        status = str(raw_status or "").strip().lower()
        encoded_record = str(raw_record or "").strip()
        if status != "reserved":
            if status in {"missing", "invalid"}:
                self._record_reserve_anomaly(
                    lane=normalized_lane,
                    job_id=encoded_record or "unknown",
                    reason=status,
                    raw_record=encoded_record or None,
                )
            return True, None
        record = self._deserialize_record(encoded_record)
        if record is None:
            self._record_reserve_anomaly(
                lane=normalized_lane,
                job_id=encoded_record or "unknown",
                reason="invalid",
                raw_record=encoded_record or None,
            )
            return True, None
        return True, dict(record) if isinstance(record, dict) else None

    def _reserve_from_lane_fallback(
        self,
        *,
        lane: str,
        worker_id: str,
        now_ms: int,
        worker_category: str,
    ) -> Optional[dict[str, Any]]:
        normalized_lane = normalize_lane(lane)
        normalized_category = normalize_worker_category(worker_category)
        ready_key = self._ready_key(normalized_lane)
        try:
            job_id = self._redis.lpop(ready_key)
        except Exception as exc:
            raise RuntimeError(f"Redis reserve failed: {exc}") from exc
        safe_job_id = str(job_id or "").strip()
        if not safe_job_id:
            return None
        record = self.get(safe_job_id)
        if not record:
            raw_record = ""
            try:
                raw_record = str(self._redis.get(self._job_key(safe_job_id)) or "")
            except Exception:
                raw_record = ""
            self._record_reserve_anomaly(
                lane=normalized_lane,
                job_id=safe_job_id,
                reason="invalid" if raw_record else "missing",
                raw_record=raw_record or None,
            )
            return None
        status = str(record.get("status") or "").strip().lower()
        claim_key = self._claim_key(safe_job_id)
        if status in QUEUE_TERMINAL_STATUSES:
            try:
                self._redis.delete(claim_key)
            except Exception:
                pass
            return None
        if status != "queued":
            return None
        if normalize_worker_category(record.get("workerCategory")) != normalized_category:
            try:
                self._enqueue_ready_once(lane=normalized_lane, job_id=safe_job_id)
            except Exception:
                pass
            return None
        claim_metadata = self._claim_metadata(safe_job_id)
        if claim_metadata and not self._claim_is_stale(claim_metadata, now_ms=now_ms):
            try:
                self._enqueue_ready_once(lane=normalized_lane, job_id=safe_job_id)
            except Exception:
                pass
            return None
        if claim_metadata:
            try:
                self._redis.delete(claim_key)
            except Exception:
                pass
        token = self._claim_token(worker_id=worker_id, claimed_at_ms=now_ms)
        try:
            claim_created = self._redis.set(
                claim_key,
                token,
                nx=True,
                ex=self._claim_ttl_sec,
            )
        except Exception as exc:
            raise RuntimeError(f"Redis reserve failed: {exc}") from exc
        if not claim_created:
            try:
                self._enqueue_ready_once(lane=normalized_lane, job_id=safe_job_id)
            except Exception:
                pass
            return None
        updated = dict(record)
        updated["status"] = "running"
        updated["workerId"] = str(worker_id or "").strip() or "worker"
        updated["attempts"] = max(0, int(updated.get("attempts") or 0)) + 1
        updated["updatedAtMs"] = int(now_ms)
        updated["claimRenewedAtMs"] = int(now_ms)
        if not int(updated.get("startedAtMs") or 0):
            updated["startedAtMs"] = int(now_ms)
        if not str(updated.get("lane") or "").strip():
            updated["lane"] = normalized_lane
        try:
            return self._persist_record_update(updated)
        except Exception:
            try:
                self._redis.delete(claim_key)
                self._enqueue_ready_once(lane=normalized_lane, job_id=safe_job_id)
            except Exception:
                pass
            raise

    def reserve_next(self, *, worker_id: str) -> Optional[dict[str, Any]]:
        safe_worker_id = str(worker_id or "").strip() or "worker"
        worker_category = _execution_worker_category()
        if self._redis is None:
            staged: list[QueueItem] = []
            max_checks = max(1, int(self._compat_queue.depth()))
            for _ in range(max_checks):
                item = self._compat_queue.pop()
                if not item:
                    break
                record = dict(item.payload or {})
                if normalize_worker_category(record.get("workerCategory")) != worker_category:
                    staged.append(item)
                    continue
                for pending in staged:
                    self._compat_queue.push(pending.lane, pending.payload)
                now_ms = self._now_ms()
                record["status"] = "running"
                record["workerId"] = safe_worker_id
                record["attempts"] = max(0, int(record.get("attempts") or 0)) + 1
                record["updatedAtMs"] = now_ms
                record["claimRenewedAtMs"] = now_ms
                if not int(record.get("startedAtMs") or 0):
                    record["startedAtMs"] = now_ms
                safe_job_id = str(record.get("jobId") or record.get("job_id") or "").strip()
                if safe_job_id:
                    with self._lock:
                        self._jobs[safe_job_id] = dict(record)
                        self._job_lanes[safe_job_id] = str(record.get("lane") or "free")
                return record
            for pending in staged:
                self._compat_queue.push(pending.lane, pending.payload)
            return None
        max_checks = max(1, self._queue_depth_total())
        for _ in range(max_checks):
            for lane in self._rotate_lanes():
                now_ms = self._now_ms()
                used_eval, reserved = self._reserve_from_lane_with_eval(
                    lane=lane,
                    worker_id=safe_worker_id,
                    now_ms=now_ms,
                    worker_category=worker_category,
                )
                if used_eval:
                    if reserved:
                        return reserved
                    continue
                reserved = self._reserve_from_lane_fallback(
                    lane=lane,
                    worker_id=safe_worker_id,
                    now_ms=now_ms,
                    worker_category=worker_category,
                )
                if reserved:
                    return reserved
        return None

    def requeue(
        self,
        job_id: str,
        *,
        worker_id: str = "",
        payload: Optional[dict[str, Any]] = None,
        bypass_depth_check: bool = True,
        recovery: bool = False,
    ) -> Optional[dict[str, Any]]:
        self._require_redis()
        safe_job_id = str(job_id or "").strip()
        safe_worker_id = str(worker_id or "").strip() or "worker"
        if not safe_job_id:
            return None
        current = self.get(safe_job_id)
        if not current and payload:
            current = self._normalize_record(payload=payload)
        if not current:
            return None
        current_status = str(current.get("status") or "").strip().lower()
        if current_status in QUEUE_TERMINAL_STATUSES:
            return dict(current)
        if str(current.get("workerId") or "").strip() not in {"", safe_worker_id} and not recovery:
            return None
        claim_metadata = self._claim_metadata(safe_job_id)
        if current_status == "queued" and not claim_metadata and not recovery:
            return dict(current)
        if not bypass_depth_check and self._queue_depth_total() >= self._max_queue_depth and str(current.get("status") or "").lower() != "queued":
            raise RuntimeError("Redis queue depth limit exceeded.")
        updated = dict(current)
        updated["status"] = "queued"
        updated["workerId"] = ""
        updated["statusCode"] = 0
        updated["error"] = {}
        updated["updatedAtMs"] = self._now_ms()
        updated["finishedAtMs"] = 0
        if recovery:
            updated["recoveryAttempts"] = max(0, int(updated.get("recoveryAttempts") or 0)) + 1
        updated = self._persist_record_update(updated, ready_mode="replace", clear_claim=True)
        _maybe_schedule_drain(
            self,
            lane=str(updated.get("lane") or "free"),
            job_id=safe_job_id,
            reason="requeue",
        )
        return updated

    def recover_stalled_claims(self, *, limit: int = 25) -> int:
        self._require_redis()
        recovered = 0
        now_ms = self._now_ms()
        for record in self._iter_records():
            if recovered >= max(1, int(limit)):
                break
            if str(record.get("status") or "").strip().lower() != "running":
                continue
            job_id = str(record.get("jobId") or "").strip()
            if not job_id:
                continue
            claim_metadata = self._claim_metadata(job_id)
            if claim_metadata:
                if not self._claim_is_stale(claim_metadata, now_ms=now_ms):
                    continue
            elif self._is_recent_missing_claim(record, now_ms=now_ms):
                continue
            recovery_attempts = max(0, int(record.get("recoveryAttempts") or 0))
            worker_id = str(record.get("workerId") or "reaper").strip() or "reaper"
            if recovery_attempts >= self._max_recovery_attempts:
                self._write_dead_letter(
                    job_id=job_id,
                    worker_id=worker_id,
                    reason="stalled claim exceeded recovery attempts",
                    record=record,
                )
                self.release(
                    job_id,
                    worker_id=worker_id,
                    requeue=False,
                    terminal_status="failed",
                    status_code=409,
                    error={"detail": "stalled claim exceeded recovery attempts"},
                )
            else:
                self.requeue(
                    job_id,
                    worker_id=worker_id,
                    payload=record,
                    bypass_depth_check=True,
                    recovery=True,
                )
            recovered += 1
        return recovered

    def _require_redis(self) -> None:
        if self._redis is None:
            raise RuntimeError("Redis is required for durable claim/ack/release paths.")

    def submit(self, *, lane: str, payload: dict[str, Any]) -> dict[str, Any]:
        normalized_lane = normalize_lane(lane)
        base = dict(payload or {})
        anchor = self._now_ms()
        record = self._normalize_record(payload=base, lane=normalized_lane, now_ms=anchor)
        record["lane"] = normalized_lane
        record["workerCategory"] = normalize_worker_category(record.get("workerCategory"))
        record["createdAtMs"] = int(base.get("createdAtMs") or base.get("created_at_ms") or anchor)
        record["updatedAtMs"] = anchor
        if not str(record.get("requestId") or "").strip():
            raise ValueError("requestId is required.")
        dedupe_token = str(record.get("idempotencyKey") or record.get("requestId") or "").strip()
        if self._redis is not None:
            try:
                existing_job_id = self._redis.get(self._dedupe_key(dedupe_token or str(record["requestId"])))
            except Exception as exc:
                raise RuntimeError(f"Redis dedupe read failed: {exc}") from exc
            if existing_job_id:
                existing_job_id = str(existing_job_id or "").strip()
                existing = self.get(existing_job_id)
                if not existing:
                    existing = self._wait_for_redis_job_record(existing_job_id)
                if existing:
                    self._dedupe_metric_bump("dedupe_hit")
                    if str(existing.get("status") or "").strip().lower() == "queued":
                        claim_metadata = self._claim_metadata(str(existing.get("jobId") or existing_job_id))
                        if claim_metadata:
                            requeued = self.requeue(
                                str(existing.get("jobId") or existing_job_id),
                                worker_id=str(claim_metadata.get("workerId") or "") or "worker",
                                payload=record,
                                bypass_depth_check=True,
                            ) or dict(existing)
                            _maybe_schedule_drain(
                                self,
                                lane=str(requeued.get("lane") or normalized_lane),
                                job_id=str(requeued.get("jobId") or existing_job_id),
                                reason="submit-dedupe-requeue",
                            )
                            return requeued
                    if str(existing.get("status") or "").strip().lower() == "queued":
                        _maybe_schedule_drain(
                            self,
                            lane=str(existing.get("lane") or normalized_lane),
                            job_id=str(existing.get("jobId") or existing_job_id),
                            reason="submit-existing-queued",
                        )
                    return existing
                self._dedupe_metric_bump("dedupe_expired_replay")
                return self._pending_dedupe_record(
                    record,
                    job_id=existing_job_id or str(record["jobId"]),
                    lane=normalized_lane,
                )
            try:
                created = self._redis.set(
                    self._dedupe_key(dedupe_token or str(record["requestId"])),
                    str(record["jobId"]),
                    ex=self._dedupe_ttl_sec,
                    nx=True,
                )
            except Exception as exc:
                raise RuntimeError(f"Redis dedupe write failed: {exc}") from exc
            if not created:
                dedupe_job_id = str(self._redis.get(self._dedupe_key(dedupe_token or str(record["requestId"]))) or "").strip()
                existing = self.get(dedupe_job_id) if dedupe_job_id else None
                if not existing and dedupe_job_id:
                    existing = self._wait_for_redis_job_record(dedupe_job_id)
                if existing:
                    self._dedupe_metric_bump("dedupe_hit")
                    if str(existing.get("status") or "").strip().lower() == "queued":
                        claim_metadata = self._claim_metadata(str(existing.get("jobId") or ""))
                        if claim_metadata:
                            requeued = self.requeue(
                                str(existing.get("jobId") or ""),
                                worker_id=str(claim_metadata.get("workerId") or "") or "worker",
                                payload=record,
                                bypass_depth_check=True,
                            ) or dict(existing)
                            _maybe_schedule_drain(
                                self,
                                lane=str(requeued.get("lane") or normalized_lane),
                                job_id=str(requeued.get("jobId") or existing.get("jobId") or ""),
                                reason="submit-dedupe-requeue",
                            )
                            return requeued
                    if str(existing.get("status") or "").strip().lower() == "queued":
                        _maybe_schedule_drain(
                            self,
                            lane=str(existing.get("lane") or normalized_lane),
                            job_id=str(existing.get("jobId") or ""),
                            reason="submit-existing-queued",
                        )
                    return existing
                self._dedupe_metric_bump("dedupe_expired_replay")
                return self._pending_dedupe_record(
                    record,
                    job_id=dedupe_job_id or str(record["jobId"]),
                    lane=normalized_lane,
                )
            self._dedupe_metric_bump("dedupe_miss")
            self._enforce_user_queued_cap(str(record.get("uid") or ""))
            self._enforce_lane_queue_cap(normalized_lane)
            self._enforce_category_queue_cap(str(record.get("workerCategory") or DEFAULT_WORKER_CATEGORY))
            if self._queue_depth_total() >= self._max_queue_depth:
                raise RuntimeError("Redis queue depth limit exceeded.")
            persisted = self._persist_redis_record(record)
            _maybe_schedule_drain(
                self,
                lane=str(persisted.get("lane") or normalized_lane),
                job_id=str(persisted.get("jobId") or ""),
                reason="submit",
            )
            return persisted
        self._enforce_user_queued_cap(str(record.get("uid") or ""))
        self._enforce_lane_queue_cap(normalized_lane)
        self._enforce_category_queue_cap(str(record.get("workerCategory") or DEFAULT_WORKER_CATEGORY))
        return self._store_memory_record(record)

    def enqueue(self, *, lane: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.submit(lane=lane, payload=payload)

    def dequeue_next(self) -> Optional[dict[str, Any]]:
        return self.reserve_next(worker_id="worker")

    def claim(self, job_id: str, *, worker_id: str, lane: Optional[str] = None) -> Optional[dict[str, Any]]:
        self._require_redis()
        safe_job_id = str(job_id or "").strip()
        safe_worker_id = str(worker_id or "").strip() or "worker"
        if not safe_job_id:
            return None
        record = self.get(safe_job_id)
        if not record:
            return None
        status = str(record.get("status") or "").strip().lower()
        if status in QUEUE_TERMINAL_STATUSES:
            return dict(record)
        claim_key = self._claim_key(safe_job_id)
        try:
            token = self._claim_token(worker_id=safe_worker_id, claimed_at_ms=self._now_ms())
            claim_metadata = self._claim_metadata(safe_job_id)
            if claim_metadata:
                if not self._claim_is_stale(claim_metadata):
                    current = self._deserialize_record(self._redis.get(self._job_key(safe_job_id)) or "")
                    if current and str(current.get("workerId") or "").strip() == safe_worker_id:
                        return dict(current)
                    return None
                self._redis.delete(claim_key)
            if not self._redis.set(claim_key, token, nx=True, ex=self._claim_ttl_sec):
                claim_metadata = self._claim_metadata(safe_job_id)
                if claim_metadata and self._claim_is_stale(claim_metadata):
                    self._redis.delete(claim_key)
                    if not self._redis.set(claim_key, token, nx=True, ex=self._claim_ttl_sec):
                        return None
                else:
                    current = self._deserialize_record(self._redis.get(self._job_key(safe_job_id)) or "")
                    if current and str(current.get("workerId") or "").strip() == safe_worker_id:
                        return dict(current)
                    return None
            updated = dict(record)
            updated["status"] = "running"
            updated["workerId"] = safe_worker_id
            updated["attempts"] = max(0, int(updated.get("attempts") or 0)) + 1
            if claim_metadata and self._claim_is_stale(claim_metadata):
                updated["recoveryAttempts"] = max(0, int(updated.get("recoveryAttempts") or 0)) + 1
            updated["updatedAtMs"] = self._now_ms()
            updated["claimRenewedAtMs"] = int(updated["updatedAtMs"])
            if not int(updated.get("startedAtMs") or 0):
                updated["startedAtMs"] = updated["updatedAtMs"]
            if lane:
                updated["lane"] = normalize_lane(lane)
            updated = self._persist_record_update(updated, ready_mode="remove")
        except Exception as exc:
            raise RuntimeError(f"Redis claim failed: {exc}") from exc
        return updated

    def ack(
        self,
        job_id: str,
        *,
        worker_id: str,
        audio_bytes: bytes = b"",
        media_type: str = "audio/wav",
        headers: Optional[dict[str, str]] = None,
        result_ref: Optional[dict[str, Any]] = None,
    ) -> Optional[dict[str, Any]]:
        self._require_redis()
        safe_job_id = str(job_id or "").strip()
        safe_worker_id = str(worker_id or "").strip() or "worker"
        if not safe_job_id:
            return None
        record = self.get(safe_job_id)
        if not record:
            return None
        status = str(record.get("status") or "").strip().lower()
        if status in QUEUE_TERMINAL_STATUSES:
            return dict(record)
        if str(record.get("workerId") or "").strip() not in {"", safe_worker_id}:
            return None
        result_payload = self._default_result(bytes(audio_bytes or b""), media_type, headers=headers)
        if isinstance(result_ref, dict) and result_ref:
            result_payload["audioRef"] = {
                "kind": str(result_ref.get("kind") or "file"),
                "path": str(result_ref.get("path") or ""),
                "sizeBytes": int(result_ref.get("sizeBytes") or result_payload.get("sizeBytes") or 0),
            }
        updated = dict(record)
        updated.update(
            {
                "status": "completed",
                "workerId": safe_worker_id,
                "updatedAtMs": self._now_ms(),
                "finishedAtMs": self._now_ms(),
                "result": result_payload,
                "error": {},
                "statusCode": 200,
            }
        )
        updated = self._persist_record_update(updated, ready_mode="remove", clear_claim=True)
        return updated

    def release(
        self,
        job_id: str,
        *,
        worker_id: str,
        requeue: bool = True,
        terminal_status: str = "failed",
        status_code: int = 500,
        error: Any = None,
    ) -> Optional[dict[str, Any]]:
        self._require_redis()
        safe_job_id = str(job_id or "").strip()
        safe_worker_id = str(worker_id or "").strip() or "worker"
        if not safe_job_id:
            return None
        record = self.get(safe_job_id)
        if not record:
            return None
        if str(record.get("workerId") or "").strip() not in {"", safe_worker_id}:
            return None
        updated = dict(record)
        updated["workerId"] = safe_worker_id
        updated["updatedAtMs"] = self._now_ms()
        if requeue:
            updated["status"] = "queued"
            updated["error"] = {}
            updated["statusCode"] = 0
            updated = self._persist_record_update(updated, ready_mode="replace", clear_claim=True)
        else:
            updated["status"] = str(terminal_status or "failed").strip().lower() or "failed"
            updated["finishedAtMs"] = self._now_ms()
            updated["statusCode"] = int(status_code or 500)
            updated["error"] = error if isinstance(error, dict) else {"detail": str(error or updated["status"])}
            updated = self._persist_record_update(updated, ready_mode="remove", clear_claim=True)
        if requeue:
            _maybe_schedule_drain(
                self,
                lane=str(updated.get("lane") or "free"),
                job_id=safe_job_id,
                reason="release-requeue",
            )
        return updated

    def get(self, job_id: str) -> Optional[dict[str, Any]]:
        safe_job_id = str(job_id or "").strip()
        if not safe_job_id:
            return None
        if self._redis is not None:
            try:
                payload = self._redis.get(self._job_key(safe_job_id))
            except Exception as exc:
                raise RuntimeError(f"Redis read failed: {exc}") from exc
            if payload:
                record = self._deserialize_record(payload)
                if record:
                    return record
        with self._lock:
            payload = self._jobs.get(safe_job_id)
            return dict(payload) if isinstance(payload, dict) else None

    def update(self, job_id: str, patch: dict[str, Any]) -> Optional[dict[str, Any]]:
        safe_job_id = str(job_id or "").strip()
        if not safe_job_id:
            return None
        current = self.get(safe_job_id)
        if not current:
            return None
        next_value = {**current, **dict(patch or {}), "updatedAtMs": self._now_ms()}
        next_value["expiresAtMs"] = self._expires_at_ms()
        return self._persist_record_update(next_value)

    def mark_running(self, job_id: str, *, worker_id: str) -> Optional[dict[str, Any]]:
        if self._redis is not None:
            return self.claim(job_id, worker_id=worker_id)
        current = self.get(job_id)
        if not current:
            return None
        next_value = {
            **current,
            "status": "running",
            "startedAtMs": self._now_ms(),
            "updatedAtMs": self._now_ms(),
            "attempts": max(0, int(current.get("attempts") or 0)) + 1,
            "workerId": str(worker_id or "").strip() or "worker",
        }
        return self._store_memory_record(next_value)

    def mark_completed(
        self,
        job_id: str,
        *,
        audio_bytes: bytes,
        media_type: str,
        headers: Optional[dict[str, str]] = None,
        result_ref: Optional[dict[str, Any]] = None,
    ) -> Optional[dict[str, Any]]:
        if self._redis is not None:
            current = self.get(job_id)
            worker_id = str(current.get("workerId") or "") if current else ""
            return self.ack(
                job_id,
                worker_id=worker_id,
                audio_bytes=audio_bytes,
                media_type=media_type,
                headers=headers,
                result_ref=result_ref,
            )
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
        if self._redis is not None:
            current = self.get(job_id)
            worker_id = str(current.get("workerId") or "") if current else ""
            return self.release(
                job_id,
                worker_id=worker_id,
                requeue=False,
                terminal_status="failed",
                status_code=status_code,
                error=error,
            )
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
        if status in QUEUE_TERMINAL_STATUSES:
            return current
        if self._redis is not None:
            worker_id = str(current.get("workerId") or "")
            try:
                self._redis.delete(self._claim_key(job_id))
                self._redis.lrem(self._ready_key(str(current.get("lane") or "free")), 0, job_id)
            except Exception:
                pass
            return self.update(
                job_id,
                {
                    "cancelRequested": True,
                    "status": "cancelled",
                    "finishedAtMs": self._now_ms(),
                    "statusCode": 409,
                    "workerId": worker_id,
                    "error": {"detail": "cancelled"},
                },
            )
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
                if status in QUEUE_TERMINAL_STATUSES:
                    return current
            if (self._now_ms() - started) >= safe_timeout_ms:
                return current
            remaining_ms = max(1, safe_timeout_ms - (self._now_ms() - started))
            wait_ms = min(remaining_ms, max(20, sleep_ms))
            time.sleep(wait_ms / 1000.0)

    def depth_snapshot(self) -> dict[str, Any]:
        lanes = list(dict.fromkeys([*LANE_PRIORITY, *[normalize_lane(key) for key in self._weights.keys()]]))
        by_category = self._category_depth_snapshot()
        telemetry = {"dedupe": self._dedupe_metric_snapshot()}
        if self._redis is None:
            return {
                "total": self._compat_queue.depth(),
                "byLane": self._compat_queue.depth_by_lane(),
                "byCategory": by_category,
                "storage": "memory",
                "telemetry": telemetry,
            }
        try:
            by_lane = {lane: int(self._redis.llen(self._ready_key(lane))) for lane in lanes}
        except Exception as exc:
            raise RuntimeError(f"Redis depth snapshot failed: {exc}") from exc
        return {
            "total": int(sum(by_lane.values())),
            "byLane": by_lane,
            "byCategory": by_category,
            "storage": "redis",
            "telemetry": telemetry,
        }
