from __future__ import annotations

import json
import math
import threading
import time
import uuid
from dataclasses import dataclass, replace
from typing import Any, Optional

try:
    import redis  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    redis = None  # type: ignore


DEFAULT_PLAN_LIMITS = {
    "free": 2,
    "starter": 5,
    "creator": 5,
    "pro": 10,
    "scale": 10,
}


def normalize_plan_key(plan_key: str) -> str:
    token = str(plan_key or "").strip().lower()
    if token in {"plus", "pro-plus", "pro_plus", "proplus", "scale"}:
        return "scale"
    if token in {"launch", "launcher"}:
        return "starter"
    if token in {"starter", "creator", "pro", "free"}:
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
    reservation_id: str = ""
    backend: str = "memory"
    redis_available: bool = False
    redis_required: bool = False
    error: str = ""


@dataclass(frozen=True)
class SuccessQuotaReservation:
    allowed: bool
    reserved: bool
    committed: bool
    released: bool
    counted: bool
    idempotent_reuse: bool
    reservation_id: str
    backend: str
    redis_available: bool
    redis_required: bool
    snapshot: SuccessQuotaSnapshot
    error: str = ""

    def to_decision(self) -> SuccessQuotaDecision:
        return SuccessQuotaDecision(
            allowed=self.allowed,
            counted=self.counted,
            idempotent_reuse=self.idempotent_reuse,
            snapshot=self.snapshot,
            reservation_id=self.reservation_id,
            backend=self.backend,
            redis_available=self.redis_available,
            redis_required=self.redis_required,
            error=self.error,
        )


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
        require_redis: bool = False,
    ) -> None:
        self.window_seconds = max(1, int(window_seconds))
        self.window_ms = self.window_seconds * 1000
        self.idempotency_ttl_seconds = max(60, int(idempotency_ttl_seconds))
        self._redis_required = bool(require_redis)
        self.key_prefix = str(key_prefix or "vf:tts:success").strip() or "vf:tts:success"
        merged = dict(DEFAULT_PLAN_LIMITS)
        for key, value in (plan_limits or {}).items():
            merged[normalize_plan_key(key)] = max(1, int(value))
        self.plan_limits = merged

        self._lock = threading.Lock()
        self._memory_events: dict[str, list[int]] = {}
        self._memory_idempotency: dict[str, int] = {}
        self._memory_reservations: dict[str, dict[str, Any]] = {}
        self._memory_fingerprints: dict[str, dict[str, Any]] = {}

        self._redis_client: Any = None
        if redis is not None and str(redis_url or "").strip():
            try:
                self._redis_client = redis.Redis.from_url(str(redis_url).strip(), decode_responses=True)
                self._redis_client.ping()
            except Exception:
                self._redis_client = None

    def is_redis_enabled(self) -> bool:
        return self._redis_client is not None

    def is_redis_required(self) -> bool:
        return self._redis_required

    def _require_redis(self) -> None:
        if self._redis_required and self._redis_client is None:
            raise RuntimeError("Redis is required for success quota reservations.")

    def quota_for_plan(self, plan_key: str) -> int:
        normalized = normalize_plan_key(plan_key)
        return max(1, int(self.plan_limits.get(normalized) or self.plan_limits["free"]))

    def _events_key(self, uid: str, plan_key: str) -> str:
        return f"{self.key_prefix}:events:{uid}:{normalize_plan_key(plan_key)}"

    def _idem_key(self, uid: str, plan_key: str, fingerprint: str) -> str:
        return f"{self.key_prefix}:idem:{uid}:{normalize_plan_key(plan_key)}:{fingerprint}"

    def _reservation_key(self, reservation_id: str) -> str:
        return f"{self.key_prefix}:reservation:{str(reservation_id or '').strip()}"

    def _snapshot(self, *, limit: int, used: int, reset_at_ms: int) -> SuccessQuotaSnapshot:
        normalized_used = max(0, int(used))
        return SuccessQuotaSnapshot(
            limit=limit,
            used=normalized_used,
            remaining=max(0, int(limit) - normalized_used),
            reset_at_ms=max(0, int(reset_at_ms)),
            window_seconds=int(self.window_seconds),
        )

    def _reservation_result(
        self,
        *,
        allowed: bool,
        reserved: bool,
        committed: bool,
        released: bool,
        counted: bool,
        idempotent_reuse: bool,
        reservation_id: str,
        backend: str,
        redis_available: bool,
        snapshot: SuccessQuotaSnapshot,
        error: str = "",
    ) -> SuccessQuotaReservation:
        return SuccessQuotaReservation(
            allowed=allowed,
            reserved=reserved,
            committed=committed,
            released=released,
            counted=counted,
            idempotent_reuse=idempotent_reuse,
            reservation_id=str(reservation_id or "").strip(),
            backend=backend,
            redis_available=redis_available,
            redis_required=self._redis_required,
            snapshot=snapshot,
            error=error,
        )

    def _reservation_ttl_seconds(self) -> int:
        return max(2, int(math.ceil(float(self.window_ms) / 1000.0)) + int(self.idempotency_ttl_seconds) + 5)

    def _decode_redis_reservation_state(self, raw_value: Any) -> dict[str, Any] | None:
        payload = str(raw_value or "").strip()
        if not payload:
            return None
        try:
            decoded = json.loads(payload)
        except Exception:
            return None
        return decoded if isinstance(decoded, dict) else None

    def _redis_snapshot(self, uid: str, plan_key: str, limit: int, now_ms: int) -> SuccessQuotaSnapshot:
        if self._redis_client is None:
            return self._reservation_snapshot_memory(uid, plan_key, limit, now_ms)
        events_key = self._events_key(uid, plan_key)
        try:
            self._redis_client.zremrangebyscore(events_key, "-inf", now_ms - self.window_ms)
            used = int(self._redis_client.zcard(events_key) or 0)
            oldest = self._redis_client.zrange(events_key, 0, 0, withscores=True)
            reset_at_ms = now_ms + self.window_ms
            if oldest and len(oldest[0]) >= 2:
                reset_at_ms = int(float(oldest[0][1])) + self.window_ms
            return self._snapshot(limit=limit, used=used, reset_at_ms=reset_at_ms)
        except Exception:
            if self._redis_required:
                raise
        return self._reservation_snapshot_memory(uid, plan_key, limit, now_ms)

    def _prune_reservation_state_locked(self, now_ms: int) -> None:
        self._prune_idempotency_locked(now_ms)
        ttl_ms = self.idempotency_ttl_seconds * 1000
        expired_ids: list[str] = []
        for reservation_id, state in list(self._memory_reservations.items()):
            created_at_ms = int(state.get("created_at_ms") or 0)
            status = str(state.get("status") or "")
            fingerprint_key = str(state.get("fingerprint_key") or "")
            if status == "reserved" and (now_ms - created_at_ms) > self.window_ms:
                expired_ids.append(reservation_id)
                if fingerprint_key:
                    self._memory_fingerprints.pop(fingerprint_key, None)
                continue
            if status == "committed" and (now_ms - created_at_ms) >= ttl_ms:
                expired_ids.append(reservation_id)
                if fingerprint_key:
                    self._memory_fingerprints.pop(fingerprint_key, None)

        for reservation_id in expired_ids:
            self._memory_reservations.pop(reservation_id, None)

        for fingerprint_key, state in list(self._memory_fingerprints.items()):
            reservation_id = str(state.get("reservation_id") or "").strip()
            if not reservation_id:
                self._memory_fingerprints.pop(fingerprint_key, None)
                continue
            reservation = self._memory_reservations.get(reservation_id)
            if not reservation:
                self._memory_fingerprints.pop(fingerprint_key, None)
                continue
            status = str(state.get("status") or "")
            created_at_ms = int(state.get("updated_at_ms") or state.get("created_at_ms") or 0)
            if status == "reserved" and (now_ms - created_at_ms) > self.window_ms:
                self._memory_fingerprints.pop(fingerprint_key, None)
            if status == "committed" and (now_ms - created_at_ms) >= ttl_ms:
                self._memory_fingerprints.pop(fingerprint_key, None)

    def _reservation_snapshot_memory(self, uid: str, plan_key: str, limit: int, now_ms: int) -> SuccessQuotaSnapshot:
        events_key = self._events_key(uid, plan_key)
        fresh = self._prune_events_locked(events_key, now_ms)
        reset_at_ms = (int(min(fresh)) + self.window_ms) if fresh else (now_ms + self.window_ms)
        return self._snapshot(limit=limit, used=len(fresh), reset_at_ms=reset_at_ms)

    def _find_memory_fingerprint_state_locked(self, fingerprint_key: str) -> dict[str, Any] | None:
        state = self._memory_fingerprints.get(fingerprint_key)
        if not state:
            return None
        reservation_id = str(state.get("reservation_id") or "").strip()
        reservation = self._memory_reservations.get(reservation_id)
        if not reservation:
            self._memory_fingerprints.pop(fingerprint_key, None)
            return None
        return state

    def _memory_reserve(
        self,
        uid: str,
        plan_key: str,
        fingerprint: str,
        limit: int,
        now_ms: int,
    ) -> SuccessQuotaReservation:
        events_key = self._events_key(uid, plan_key)
        fingerprint_key = self._idem_key(uid, plan_key, fingerprint) if fingerprint else ""
        with self._lock:
            self._prune_reservation_state_locked(now_ms)
            if fingerprint_key:
                state = self._find_memory_fingerprint_state_locked(fingerprint_key)
                if state:
                    reservation_id = str(state.get("reservation_id") or "").strip()
                    status = str(state.get("status") or "")
                    if status == "committed":
                        snapshot = self._reservation_snapshot_memory(uid, plan_key, limit, now_ms)
                        return self._reservation_result(
                            allowed=True,
                            reserved=False,
                            committed=True,
                            released=False,
                            counted=False,
                            idempotent_reuse=True,
                            reservation_id=reservation_id,
                            backend="memory",
                            redis_available=self.is_redis_enabled(),
                            snapshot=snapshot,
                        )
                    if status == "reserved":
                        snapshot = self._reservation_snapshot_memory(uid, plan_key, limit, now_ms)
                        return self._reservation_result(
                            allowed=True,
                            reserved=False,
                            committed=False,
                            released=False,
                            counted=False,
                            idempotent_reuse=True,
                            reservation_id=reservation_id,
                            backend="memory",
                            redis_available=self.is_redis_enabled(),
                            snapshot=snapshot,
                        )
                    self._memory_fingerprints.pop(fingerprint_key, None)

            snapshot = self._reservation_snapshot_memory(uid, plan_key, limit, now_ms)
            if int(snapshot.used) >= int(limit):
                return self._reservation_result(
                    allowed=False,
                    reserved=False,
                    committed=False,
                    released=False,
                    counted=False,
                    idempotent_reuse=False,
                    reservation_id="",
                    backend="memory",
                    redis_available=self.is_redis_enabled(),
                    snapshot=snapshot,
                    error="quota_exhausted",
                )

            reservation_id = f"{now_ms}:{uuid.uuid4().hex}"
            self._memory_events.setdefault(events_key, []).append(now_ms)
            self._memory_reservations[reservation_id] = {
                "uid": uid,
                "plan_key": normalize_plan_key(plan_key),
                "created_at_ms": now_ms,
                "status": "reserved",
                "fingerprint_key": fingerprint_key,
            }
            if fingerprint_key:
                self._memory_fingerprints[fingerprint_key] = {
                    "reservation_id": reservation_id,
                    "status": "reserved",
                    "created_at_ms": now_ms,
                    "updated_at_ms": now_ms,
                }
            snapshot = self._reservation_snapshot_memory(uid, plan_key, limit, now_ms)
            return self._reservation_result(
                allowed=True,
                reserved=True,
                committed=False,
                released=False,
                counted=True,
                idempotent_reuse=False,
                reservation_id=reservation_id,
                backend="memory",
                redis_available=self.is_redis_enabled(),
                snapshot=snapshot,
            )

    def reserve_success(self, uid: str, plan_key: str, request_fingerprint: str = "") -> SuccessQuotaReservation:
        self._require_redis()
        normalized_uid = str(uid or "").strip()
        normalized_plan = normalize_plan_key(plan_key)
        fingerprint = str(request_fingerprint or "").strip()
        now_ms = int(time.time() * 1000)
        limit = self.quota_for_plan(normalized_plan)
        if self._redis_client is not None:
            try:
                events_key = self._events_key(normalized_uid, normalized_plan)
                fingerprint_key = self._idem_key(normalized_uid, normalized_plan, fingerprint) if fingerprint else ""
                self._redis_client.zremrangebyscore(events_key, "-inf", now_ms - self.window_ms)
                if fingerprint_key:
                    existing_reservation_id = str(self._redis_client.get(fingerprint_key) or "").strip()
                    if existing_reservation_id:
                        state = self._decode_redis_reservation_state(
                            self._redis_client.get(self._reservation_key(existing_reservation_id))
                        )
                        if state:
                            snapshot = self._redis_snapshot(normalized_uid, normalized_plan, limit, now_ms)
                            status = str(state.get("status") or "").strip().lower()
                            if status == "committed":
                                return self._reservation_result(
                                    allowed=True,
                                    reserved=False,
                                    committed=True,
                                    released=False,
                                    counted=False,
                                    idempotent_reuse=True,
                                    reservation_id=existing_reservation_id,
                                    backend="redis",
                                    redis_available=True,
                                    snapshot=snapshot,
                                )
                            if status == "reserved":
                                return self._reservation_result(
                                    allowed=True,
                                    reserved=False,
                                    committed=False,
                                    released=False,
                                    counted=False,
                                    idempotent_reuse=True,
                                    reservation_id=existing_reservation_id,
                                    backend="redis",
                                    redis_available=True,
                                    snapshot=snapshot,
                                )
                        self._redis_client.delete(fingerprint_key)
                snapshot = self._redis_snapshot(normalized_uid, normalized_plan, limit, now_ms)
                if int(snapshot.used) >= int(limit):
                    return self._reservation_result(
                        allowed=False,
                        reserved=False,
                        committed=False,
                        released=False,
                        counted=False,
                        idempotent_reuse=False,
                        reservation_id="",
                        backend="redis",
                        redis_available=True,
                        snapshot=snapshot,
                        error="quota_exhausted",
                    )
                reservation_id = f"{now_ms}:{uuid.uuid4().hex}"
                state = {
                    "uid": normalized_uid,
                    "plan_key": normalized_plan,
                    "created_at_ms": now_ms,
                    "updated_at_ms": now_ms,
                    "status": "reserved",
                    "fingerprint_key": fingerprint_key,
                    "member": reservation_id,
                }
                pipe = self._redis_client.pipeline()
                pipe.zadd(events_key, {reservation_id: now_ms})
                pipe.expire(events_key, max(2, int(math.ceil(float(self.window_ms) / 1000.0)) + 5))
                pipe.set(
                    self._reservation_key(reservation_id),
                    json.dumps(state, separators=(",", ":"), sort_keys=True),
                    ex=self._reservation_ttl_seconds(),
                )
                if fingerprint_key:
                    pipe.set(fingerprint_key, reservation_id, ex=self.idempotency_ttl_seconds)
                pipe.execute()
                snapshot = self._redis_snapshot(normalized_uid, normalized_plan, limit, now_ms)
                return self._reservation_result(
                    allowed=True,
                    reserved=True,
                    committed=False,
                    released=False,
                    counted=True,
                    idempotent_reuse=False,
                    reservation_id=reservation_id,
                    backend="redis",
                    redis_available=True,
                    snapshot=snapshot,
                )
            except Exception:
                if self._redis_required:
                    raise
        return self._memory_reserve(normalized_uid, normalized_plan, fingerprint, limit, now_ms)

    def commit_success_reservation(self, reservation: SuccessQuotaReservation) -> SuccessQuotaReservation:
        self._require_redis()
        now_ms = int(time.time() * 1000)
        if self._redis_client is not None:
            try:
                reservation_id = str(reservation.reservation_id or "").strip()
                if not reservation_id:
                    return replace(reservation, allowed=False, committed=False, reserved=False, released=False, error="reservation_missing")
                state = self._decode_redis_reservation_state(self._redis_client.get(self._reservation_key(reservation_id)))
                if not state:
                    return replace(reservation, allowed=False, committed=False, reserved=False, released=False, error="reservation_missing")
                status = str(state.get("status") or "").strip().lower()
                if status == "committed":
                    snapshot = self._redis_snapshot(
                        str(state.get("uid") or ""),
                        str(state.get("plan_key") or ""),
                        int(getattr(reservation.snapshot, "limit", 1) or 1),
                        now_ms,
                    )
                    return replace(
                        reservation,
                        committed=True,
                        reserved=False,
                        released=False,
                        counted=False,
                        idempotent_reuse=True,
                        backend="redis",
                        redis_available=True,
                        snapshot=snapshot,
                    )
                if status == "released":
                    return replace(
                        reservation,
                        allowed=False,
                        committed=False,
                        reserved=False,
                        released=True,
                        counted=False,
                        backend="redis",
                        redis_available=True,
                        error="reservation_released",
                    )
                state["status"] = "committed"
                state["updated_at_ms"] = now_ms
                pipe = self._redis_client.pipeline()
                pipe.set(
                    self._reservation_key(reservation_id),
                    json.dumps(state, separators=(",", ":"), sort_keys=True),
                    ex=self._reservation_ttl_seconds(),
                )
                fingerprint_key = str(state.get("fingerprint_key") or "").strip()
                if fingerprint_key:
                    pipe.set(fingerprint_key, reservation_id, ex=self.idempotency_ttl_seconds)
                pipe.execute()
                snapshot = self._redis_snapshot(
                    str(state.get("uid") or ""),
                    str(state.get("plan_key") or ""),
                    int(getattr(reservation.snapshot, "limit", 1) or 1),
                    now_ms,
                )
                return replace(
                    reservation,
                    committed=True,
                    reserved=False,
                    released=False,
                    backend="redis",
                    redis_available=True,
                    snapshot=snapshot,
                )
            except Exception:
                if self._redis_required:
                    raise
        with self._lock:
            self._prune_reservation_state_locked(now_ms)
            state = self._memory_reservations.get(reservation.reservation_id)
            if not state:
                return replace(reservation, allowed=False, committed=False, reserved=False, released=False, error="reservation_missing")
            if str(state.get("status") or "") == "committed":
                return replace(reservation, committed=True, reserved=False, released=False, counted=False, idempotent_reuse=True)
            if str(state.get("status") or "") == "released":
                return replace(reservation, allowed=False, committed=False, reserved=False, released=True, counted=False, error="reservation_released")
            state["status"] = "committed"
            state["updated_at_ms"] = now_ms
            fingerprint_key = str(state.get("fingerprint_key") or "")
            if fingerprint_key:
                fingerprint_state = self._memory_fingerprints.get(fingerprint_key)
                if fingerprint_state and str(fingerprint_state.get("reservation_id") or "") == reservation.reservation_id:
                    fingerprint_state["status"] = "committed"
                    fingerprint_state["updated_at_ms"] = now_ms
                self._memory_idempotency[fingerprint_key] = now_ms
            return replace(reservation, committed=True, reserved=False, released=False)

    def release_success_reservation(self, reservation: SuccessQuotaReservation) -> SuccessQuotaReservation:
        self._require_redis()
        now_ms = int(time.time() * 1000)
        if self._redis_client is not None:
            try:
                reservation_id = str(reservation.reservation_id or "").strip()
                if not reservation_id:
                    return replace(reservation, reserved=False, committed=False, released=False, counted=False, error="reservation_missing")
                state = self._decode_redis_reservation_state(self._redis_client.get(self._reservation_key(reservation_id)))
                if not state:
                    return replace(reservation, reserved=False, committed=False, released=False, counted=False, error="reservation_missing")
                status = str(state.get("status") or "").strip().lower()
                if status == "committed":
                    snapshot = self._redis_snapshot(
                        str(state.get("uid") or ""),
                        str(state.get("plan_key") or ""),
                        int(getattr(reservation.snapshot, "limit", 1) or 1),
                        now_ms,
                    )
                    return replace(
                        reservation,
                        reserved=False,
                        committed=True,
                        released=False,
                        counted=False,
                        backend="redis",
                        redis_available=True,
                        snapshot=snapshot,
                    )
                events_key = self._events_key(str(state.get("uid") or ""), str(state.get("plan_key") or ""))
                member = str(state.get("member") or reservation_id).strip() or reservation_id
                fingerprint_key = str(state.get("fingerprint_key") or "").strip()
                pipe = self._redis_client.pipeline()
                pipe.zrem(events_key, member)
                if fingerprint_key:
                    pipe.delete(fingerprint_key)
                pipe.delete(self._reservation_key(reservation_id))
                pipe.execute()
                snapshot = self._redis_snapshot(
                    str(state.get("uid") or ""),
                    str(state.get("plan_key") or ""),
                    int(getattr(reservation.snapshot, "limit", 1) or 1),
                    now_ms,
                )
                return replace(
                    reservation,
                    reserved=False,
                    committed=False,
                    released=True,
                    counted=False,
                    backend="redis",
                    redis_available=True,
                    snapshot=snapshot,
                )
            except Exception:
                if self._redis_required:
                    raise
        with self._lock:
            self._prune_reservation_state_locked(now_ms)
            state = self._memory_reservations.get(reservation.reservation_id)
            if not state:
                return replace(reservation, reserved=False, committed=False, released=False, counted=False, error="reservation_missing")
            if str(state.get("status") or "") == "committed":
                return replace(reservation, reserved=False, committed=True, released=False, counted=False)
            uid = str(state.get("uid") or "")
            plan_key = str(state.get("plan_key") or "")
            events_key = self._events_key(uid, plan_key)
            event_list = self._memory_events.get(events_key) or []
            created_at_ms = int(state.get("created_at_ms") or 0)
            if event_list:
                try:
                    event_list.remove(created_at_ms)
                except ValueError:
                    event_list.pop()
            self._memory_reservations.pop(reservation.reservation_id, None)
            fingerprint_key = str(state.get("fingerprint_key") or "")
            if fingerprint_key:
                fingerprint_state = self._memory_fingerprints.get(fingerprint_key)
                if fingerprint_state and str(fingerprint_state.get("reservation_id") or "") == reservation.reservation_id:
                    self._memory_fingerprints.pop(fingerprint_key, None)
            snapshot = self._reservation_snapshot_memory(uid, plan_key, reservation.snapshot.limit, now_ms)
            return replace(reservation, reserved=False, committed=False, released=True, counted=False, snapshot=snapshot)

    def peek(self, uid: str, plan_key: str) -> SuccessQuotaSnapshot:
        now_ms = int(time.time() * 1000)
        limit = self.quota_for_plan(plan_key)
        if self._redis_required and self._redis_client is None:
            self._require_redis()
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
                if self._redis_required:
                    raise
        return self._peek_memory(uid, plan_key, limit, now_ms)

    def _peek_memory(self, uid: str, plan_key: str, limit: int, now_ms: int) -> SuccessQuotaSnapshot:
        key = self._events_key(uid, plan_key)
        with self._lock:
            self._prune_reservation_state_locked(now_ms)
            fresh = self._prune_events_locked(key, now_ms)
            reset_at_ms = (int(min(fresh)) + self.window_ms) if fresh else (now_ms + self.window_ms)
            return self._snapshot(limit=limit, used=len(fresh), reset_at_ms=reset_at_ms)

    def commit_success(self, uid: str, plan_key: str, request_fingerprint: str = "") -> SuccessQuotaDecision:
        normalized_uid = str(uid or "").strip()
        normalized_plan = normalize_plan_key(plan_key)
        fingerprint = str(request_fingerprint or "").strip()
        now_ms = int(time.time() * 1000)
        limit = self.quota_for_plan(normalized_plan)
        if self._redis_required and self._redis_client is None:
            self._require_redis()

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
                    backend="redis",
                    redis_available=True,
                    redis_required=self._redis_required,
                )
            except Exception:
                if self._redis_required:
                    raise

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
                    backend="memory",
                    redis_available=self.is_redis_enabled(),
                    redis_required=self._redis_required,
                )

            used = len(fresh)
            if used >= limit:
                reset_at_ms = int(min(fresh)) + self.window_ms if fresh else (now_ms + self.window_ms)
                return SuccessQuotaDecision(
                    allowed=False,
                    counted=False,
                    idempotent_reuse=False,
                    snapshot=self._snapshot(limit=limit, used=used, reset_at_ms=reset_at_ms),
                    backend="memory",
                    redis_available=self.is_redis_enabled(),
                    redis_required=self._redis_required,
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
                backend="memory",
                redis_available=self.is_redis_enabled(),
                redis_required=self._redis_required,
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
                for key in [k for k, state in self._memory_fingerprints.items() if k.startswith(idem_prefix)]:
                    self._memory_fingerprints.pop(key, None)
                for key in [k for k, state in self._memory_reservations.items() if str(state.get("uid") or "") == normalized_uid]:
                    self._memory_reservations.pop(key, None)

    def clear_all_local_state(self) -> None:
        if self._redis_client is not None:
            return
        with self._lock:
            self._memory_events.clear()
            self._memory_idempotency.clear()
            self._memory_reservations.clear()
            self._memory_fingerprints.clear()
