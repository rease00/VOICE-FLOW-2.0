from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any, Optional

try:
    import redis  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    redis = None  # type: ignore


DEFAULT_PLAN_LIMITS = {
    "free": 2,
    "pro": 5,
    "plus": 10,
}


def normalize_plan_key(plan_key: str) -> str:
    token = str(plan_key or "").strip().lower()
    if token in {"plus", "pro-plus", "pro_plus", "proplus"}:
        return "plus"
    if token in {"pro", "free"}:
        return token
    return "free"


@dataclass(frozen=True)
class SuccessQuotaSnapshot:
    limit: int
    used: int
    remaining: int
    reset_at_ms: int
    window_seconds: int


@dataclass(frozen=True)
class SuccessQuotaDecision:
    allowed: bool
    counted: bool
    idempotent_reuse: bool
    snapshot: SuccessQuotaSnapshot


class SuccessQuotaLimiter:
    _COMMIT_LUA = """
local events_key = KEYS[1]
local idem_key = KEYS[2]
local now_ms = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local idem_ttl_sec = tonumber(ARGV[5])
local use_idem = tonumber(ARGV[6])

local min_allowed = now_ms - window_ms
redis.call('ZREMRANGEBYSCORE', events_key, '-inf', min_allowed)

if use_idem == 1 then
  local existing = redis.call('GET', idem_key)
  if existing then
    local used = tonumber(redis.call('ZCARD', events_key)) or 0
    local oldest = redis.call('ZRANGE', events_key, 0, 0, 'WITHSCORES')
    local reset_at = now_ms + window_ms
    if oldest and oldest[2] then
      reset_at = tonumber(oldest[2]) + window_ms
    end
    return {1, 0, used, reset_at, 1}
  end
end

local used = tonumber(redis.call('ZCARD', events_key)) or 0
if used >= limit then
  local oldest = redis.call('ZRANGE', events_key, 0, 0, 'WITHSCORES')
  local reset_at = now_ms + window_ms
  if oldest and oldest[2] then
    reset_at = tonumber(oldest[2]) + window_ms
  end
  return {0, 0, used, reset_at, 0}
end

redis.call('ZADD', events_key, now_ms, member)
local ttl = math.max(2, math.ceil(window_ms / 1000) + 5)
redis.call('EXPIRE', events_key, ttl)
if use_idem == 1 then
  redis.call('SET', idem_key, member, 'EX', idem_ttl_sec, 'NX')
end

used = used + 1
local oldest = redis.call('ZRANGE', events_key, 0, 0, 'WITHSCORES')
local reset_at = now_ms + window_ms
if oldest and oldest[2] then
  reset_at = tonumber(oldest[2]) + window_ms
end
return {1, 1, used, reset_at, 0}
"""

    _PEEK_LUA = """
local events_key = KEYS[1]
local now_ms = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])

local min_allowed = now_ms - window_ms
redis.call('ZREMRANGEBYSCORE', events_key, '-inf', min_allowed)
local used = tonumber(redis.call('ZCARD', events_key)) or 0
local oldest = redis.call('ZRANGE', events_key, 0, 0, 'WITHSCORES')
local reset_at = now_ms + window_ms
if oldest and oldest[2] then
  reset_at = tonumber(oldest[2]) + window_ms
end
return {used, reset_at}
"""

    def __init__(
        self,
        *,
        redis_url: str = "",
        key_prefix: str = "vf:tts:success",
        plan_limits: Optional[dict[str, int]] = None,
        window_seconds: int = 60,
        idempotency_ttl_seconds: int = 86_400,
    ) -> None:
        self.window_seconds = max(1, int(window_seconds))
        self.window_ms = self.window_seconds * 1000
        self.idempotency_ttl_seconds = max(60, int(idempotency_ttl_seconds))
        self.key_prefix = str(key_prefix or "vf:tts:success").strip() or "vf:tts:success"
        merged = dict(DEFAULT_PLAN_LIMITS)
        for key, value in (plan_limits or {}).items():
            merged[normalize_plan_key(key)] = max(1, int(value))
        self.plan_limits = merged

        self._lock = threading.Lock()
        self._memory_events: dict[str, list[int]] = {}
        self._memory_idempotency: dict[str, int] = {}

        self._redis_client: Any = None
        if redis is not None and str(redis_url or "").strip():
            try:
                self._redis_client = redis.Redis.from_url(str(redis_url).strip(), decode_responses=True)
                self._redis_client.ping()
            except Exception:
                self._redis_client = None

    def is_redis_enabled(self) -> bool:
        return self._redis_client is not None

    def quota_for_plan(self, plan_key: str) -> int:
        normalized = normalize_plan_key(plan_key)
        return max(1, int(self.plan_limits.get(normalized) or self.plan_limits["free"]))

    def _events_key(self, uid: str, plan_key: str) -> str:
        return f"{self.key_prefix}:events:{uid}:{normalize_plan_key(plan_key)}"

    def _idem_key(self, uid: str, plan_key: str, fingerprint: str) -> str:
        return f"{self.key_prefix}:idem:{uid}:{normalize_plan_key(plan_key)}:{fingerprint}"

    def _snapshot(self, *, limit: int, used: int, reset_at_ms: int) -> SuccessQuotaSnapshot:
        normalized_used = max(0, int(used))
        return SuccessQuotaSnapshot(
            limit=limit,
            used=normalized_used,
            remaining=max(0, int(limit) - normalized_used),
            reset_at_ms=max(0, int(reset_at_ms)),
            window_seconds=int(self.window_seconds),
        )

    def peek(self, uid: str, plan_key: str) -> SuccessQuotaSnapshot:
        now_ms = int(time.time() * 1000)
        limit = self.quota_for_plan(plan_key)
        if self._redis_client is not None:
            try:
                used_raw, reset_raw = self._redis_client.eval(
                    self._PEEK_LUA,
                    1,
                    self._events_key(uid, plan_key),
                    now_ms,
                    self.window_ms,
                )
                return self._snapshot(limit=limit, used=int(used_raw), reset_at_ms=int(reset_raw))
            except Exception:
                pass
        return self._peek_memory(uid, plan_key, limit, now_ms)

    def _peek_memory(self, uid: str, plan_key: str, limit: int, now_ms: int) -> SuccessQuotaSnapshot:
        key = self._events_key(uid, plan_key)
        with self._lock:
            fresh = self._prune_events_locked(key, now_ms)
            reset_at_ms = (int(min(fresh)) + self.window_ms) if fresh else (now_ms + self.window_ms)
            return self._snapshot(limit=limit, used=len(fresh), reset_at_ms=reset_at_ms)

    def commit_success(self, uid: str, plan_key: str, request_fingerprint: str = "") -> SuccessQuotaDecision:
        normalized_uid = str(uid or "").strip()
        normalized_plan = normalize_plan_key(plan_key)
        fingerprint = str(request_fingerprint or "").strip()
        now_ms = int(time.time() * 1000)
        limit = self.quota_for_plan(normalized_plan)

        if self._redis_client is not None:
            try:
                member = f"{now_ms}:{uuid.uuid4().hex}"
                use_idem = 1 if fingerprint else 0
                result = self._redis_client.eval(
                    self._COMMIT_LUA,
                    2,
                    self._events_key(normalized_uid, normalized_plan),
                    self._idem_key(normalized_uid, normalized_plan, fingerprint) if fingerprint else "_",
                    now_ms,
                    self.window_ms,
                    limit,
                    member,
                    self.idempotency_ttl_seconds,
                    use_idem,
                )
                allowed, counted, used, reset_at, idem_reuse = [int(x) for x in result]
                return SuccessQuotaDecision(
                    allowed=bool(allowed),
                    counted=bool(counted),
                    idempotent_reuse=bool(idem_reuse),
                    snapshot=self._snapshot(limit=limit, used=used, reset_at_ms=reset_at),
                )
            except Exception:
                pass

        return self._commit_memory(normalized_uid, normalized_plan, fingerprint, limit, now_ms)

    def _prune_events_locked(self, events_key: str, now_ms: int) -> list[int]:
        window_floor = now_ms - self.window_ms
        items = [int(ts) for ts in (self._memory_events.get(events_key) or []) if int(ts) > window_floor]
        self._memory_events[events_key] = items
        return items

    def _prune_idempotency_locked(self, now_ms: int) -> None:
        ttl_ms = self.idempotency_ttl_seconds * 1000
        expired = [key for key, ts in self._memory_idempotency.items() if (now_ms - int(ts)) >= ttl_ms]
        for key in expired:
            self._memory_idempotency.pop(key, None)

    def _commit_memory(
        self,
        uid: str,
        plan_key: str,
        fingerprint: str,
        limit: int,
        now_ms: int,
    ) -> SuccessQuotaDecision:
        events_key = self._events_key(uid, plan_key)
        idem_key = self._idem_key(uid, plan_key, fingerprint) if fingerprint else ""
        with self._lock:
            self._prune_idempotency_locked(now_ms)
            fresh = self._prune_events_locked(events_key, now_ms)
            if idem_key and idem_key in self._memory_idempotency:
                reset_at_ms = (int(min(fresh)) + self.window_ms) if fresh else (now_ms + self.window_ms)
                return SuccessQuotaDecision(
                    allowed=True,
                    counted=False,
                    idempotent_reuse=True,
                    snapshot=self._snapshot(limit=limit, used=len(fresh), reset_at_ms=reset_at_ms),
                )

            used = len(fresh)
            if used >= limit:
                reset_at_ms = int(min(fresh)) + self.window_ms if fresh else (now_ms + self.window_ms)
                return SuccessQuotaDecision(
                    allowed=False,
                    counted=False,
                    idempotent_reuse=False,
                    snapshot=self._snapshot(limit=limit, used=used, reset_at_ms=reset_at_ms),
                )

            fresh.append(now_ms)
            self._memory_events[events_key] = fresh
            if idem_key:
                self._memory_idempotency[idem_key] = now_ms

            reset_at_ms = int(min(fresh)) + self.window_ms if fresh else (now_ms + self.window_ms)
            return SuccessQuotaDecision(
                allowed=True,
                counted=True,
                idempotent_reuse=False,
                snapshot=self._snapshot(limit=limit, used=len(fresh), reset_at_ms=reset_at_ms),
            )

    def clear_uid(self, uid: str) -> None:
        normalized_uid = str(uid or "").strip()
        if not normalized_uid:
            return
        if self._redis_client is None:
            with self._lock:
                event_prefix = f"{self.key_prefix}:events:{normalized_uid}:"
                idem_prefix = f"{self.key_prefix}:idem:{normalized_uid}:"
                for key in [k for k in self._memory_events.keys() if k.startswith(event_prefix)]:
                    self._memory_events.pop(key, None)
                for key in [k for k in self._memory_idempotency.keys() if k.startswith(idem_prefix)]:
                    self._memory_idempotency.pop(key, None)

    def clear_all_local_state(self) -> None:
        if self._redis_client is not None:
            return
        with self._lock:
            self._memory_events.clear()
            self._memory_idempotency.clear()
