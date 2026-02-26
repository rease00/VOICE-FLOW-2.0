from __future__ import annotations

import json
import math
import os
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, Optional


GEMINI_API_KEY_PATTERN = re.compile(r"^AIza[A-Za-z0-9_-]{30,}$")
VALID_TASKS = {"tts", "text", "ocr", "reserved"}


@dataclass(frozen=True)
class ModelLimit:
    model_id: str
    rpm: int
    tpm: int
    enabled_for: frozenset[str]


@dataclass(frozen=True)
class AllocatorConfig:
    version: str
    window_seconds: int
    default_wait_timeout_ms: int
    models: dict[str, ModelLimit]
    routes: dict[str, list[str]]


@dataclass(frozen=True)
class LaneLease:
    key: str
    model_id: str
    key_index: int
    model_index: int
    reserved_tokens: int
    reserved_at_ms: int


@dataclass(frozen=True)
class AcquireResult:
    lease: Optional[LaneLease]
    waited_ms: int
    retry_after_ms: int
    timed_out: bool


@dataclass
class _LaneState:
    window_started_ms: int = 0
    requests: int = 0
    tokens: int = 0
    in_flight_requests: int = 0
    in_flight_tokens: int = 0
    temp_block_until_ms: int = 0
    success_total: int = 0
    failure_total: int = 0
    rate_limited_total: int = 0


@dataclass
class _KeyState:
    auth_disabled_until_ms: int = 0
    in_flight_total: int = 0
    requests_total: int = 0
    success_total: int = 0
    failure_total: int = 0
    auth_failures_total: int = 0
    rate_limited_total: int = 0


def _project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _default_config_path() -> Path:
    env_path = str(os.getenv("VF_GEMINI_ALLOCATOR_CONFIG") or "").strip()
    if env_path:
        return Path(env_path)
    return _project_root() / "config" / "gemini_allocator_limits.json"


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _to_positive_int(raw: Any, field_name: str) -> int:
    if not isinstance(raw, int):
        raise ValueError(f"{field_name} must be an integer.")
    if raw <= 0:
        raise ValueError(f"{field_name} must be > 0.")
    return int(raw)


def _normalize_model_id(raw: Any) -> str:
    token = str(raw or "").strip()
    if token.lower().startswith("models/"):
        token = token[7:]
    return token.strip()


def load_allocator_config(config_path: Optional[str] = None) -> AllocatorConfig:
    target = Path(config_path).expanduser().resolve() if config_path else _default_config_path().resolve()
    if not target.exists():
        raise ValueError(f"Allocator config file not found: {target}")
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Failed to parse allocator config JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("Allocator config root must be an object.")

    version = str(payload.get("version") or "").strip()
    _require(bool(version), "Allocator config must include a non-empty version.")

    window_seconds = _to_positive_int(payload.get("windowSeconds"), "windowSeconds")
    default_wait_timeout_ms = _to_positive_int(payload.get("defaultWaitTimeoutMs"), "defaultWaitTimeoutMs")

    models_payload = payload.get("models")
    _require(isinstance(models_payload, list) and len(models_payload) > 0, "Allocator config models must be a non-empty list.")
    models: dict[str, ModelLimit] = {}
    for index, item in enumerate(models_payload):
        _require(isinstance(item, dict), f"models[{index}] must be an object.")
        model_id = _normalize_model_id(item.get("id"))
        _require(bool(model_id), f"models[{index}].id is required.")
        _require(model_id not in models, f"Duplicate model id in allocator config: {model_id}")

        rpm = _to_positive_int(item.get("rpm"), f"models[{index}].rpm")
        tpm = _to_positive_int(item.get("tpm"), f"models[{index}].tpm")
        enabled_for_payload = item.get("enabledFor")
        _require(
            isinstance(enabled_for_payload, list) and len(enabled_for_payload) > 0,
            f"models[{index}].enabledFor must be a non-empty list.",
        )
        enabled_for: set[str] = set()
        for task_raw in enabled_for_payload:
            task = str(task_raw or "").strip().lower()
            _require(task in VALID_TASKS, f"models[{index}].enabledFor has invalid task: {task}")
            enabled_for.add(task)
        models[model_id] = ModelLimit(
            model_id=model_id,
            rpm=rpm,
            tpm=tpm,
            enabled_for=frozenset(enabled_for),
        )

    routes_payload = payload.get("routes")
    _require(isinstance(routes_payload, dict), "Allocator config routes must be an object.")
    routes: dict[str, list[str]] = {}
    for task in ("tts", "text", "ocr"):
        raw_list = routes_payload.get(task)
        _require(isinstance(raw_list, list) and len(raw_list) > 0, f"routes.{task} must be a non-empty list.")
        route_models: list[str] = []
        seen_models: set[str] = set()
        for model_raw in raw_list:
            model_id = _normalize_model_id(model_raw)
            _require(bool(model_id), f"routes.{task} has an empty model id.")
            _require(model_id in models, f"routes.{task} references unknown model: {model_id}")
            _require(task in models[model_id].enabled_for, f"routes.{task} model is not enabled for this task: {model_id}")
            if model_id in seen_models:
                continue
            seen_models.add(model_id)
            route_models.append(model_id)
        _require(len(route_models) > 0, f"routes.{task} must contain at least one valid model.")
        routes[task] = route_models

    return AllocatorConfig(
        version=version,
        window_seconds=window_seconds,
        default_wait_timeout_ms=default_wait_timeout_ms,
        models=models,
        routes=routes,
    )


def normalize_model_name(model_name: str) -> str:
    return _normalize_model_id(model_name)


def is_valid_api_key(token: str) -> bool:
    return bool(GEMINI_API_KEY_PATTERN.match(str(token or "").strip()))


def parse_api_keys(raw: str) -> list[str]:
    if not str(raw or "").strip():
        return []
    values = re.split(r"[\r\n,]+", str(raw))
    out: list[str] = []
    seen: set[str] = set()
    for item in values:
        token = str(item or "").strip()
        if not token or token in seen:
            continue
        if not is_valid_api_key(token):
            continue
        seen.add(token)
        out.append(token)
    return out


def api_key_fingerprint(api_key: str) -> str:
    token = str(api_key or "").strip()
    if not token:
        return "none"
    if len(token) <= 12:
        return token
    return f"{token[:8]}...{token[-4:]}"


def estimate_text_tokens(text: str) -> int:
    normalized = str(text or "").strip()
    if not normalized:
        return 1
    # Rough approximation: 1 token ~= 4 chars.
    return max(1, int(math.ceil(len(normalized) / 4.0)))


class GeminiRateAllocator:
    def __init__(
        self,
        config: AllocatorConfig,
        *,
        auth_disable_ms: int = 600_000,
        wait_slice_ms: int = 500,
    ) -> None:
        self.config = config
        self._window_ms = int(config.window_seconds) * 1000
        self._auth_disable_ms = max(1_000, int(auth_disable_ms))
        self._wait_slice_ms = max(100, int(wait_slice_ms))

        self._lock = threading.Lock()
        self._lane_states: dict[tuple[str, str], _LaneState] = {}
        self._key_states: dict[str, _KeyState] = {}
        self._next_key_index = 0

        routed_models: set[str] = set()
        for route in self.config.routes.values():
            routed_models.update(route)
        self._routed_models = tuple(sorted(routed_models))

    @property
    def window_ms(self) -> int:
        return self._window_ms

    def route_models(self, task: str) -> list[str]:
        return list(self.config.routes.get(str(task or "").strip().lower(), []))

    def _lane_state(self, key: str, model_id: str) -> _LaneState:
        lane_key = (key, model_id)
        state = self._lane_states.get(lane_key)
        if state is None:
            state = _LaneState(window_started_ms=int(time.time() * 1000))
            self._lane_states[lane_key] = state
        return state

    def _key_state(self, key: str) -> _KeyState:
        state = self._key_states.get(key)
        if state is None:
            state = _KeyState()
            self._key_states[key] = state
        return state

    def ensure_keys(self, key_pool: Iterable[str]) -> None:
        with self._lock:
            for key in key_pool:
                self._key_state(str(key))

    def _reset_lane_if_window_rolled(self, lane: _LaneState, now_ms: int) -> None:
        started = int(lane.window_started_ms or 0)
        if started <= 0:
            lane.window_started_ms = now_ms
            return
        if now_ms - started < self._window_ms:
            return
        lane.window_started_ms = now_ms
        lane.requests = 0
        lane.tokens = 0
        lane.in_flight_requests = 0
        lane.in_flight_tokens = 0
        lane.temp_block_until_ms = 0

    def _ordered_key_indexes(self, key_pool: list[str], preferred_key: str, blocked_keys: set[str]) -> list[int]:
        size = len(key_pool)
        if size == 0:
            return []
        seen: set[int] = set()
        ordered: list[int] = []
        preferred = str(preferred_key or "").strip()
        if preferred and preferred in key_pool and preferred not in blocked_keys:
            index = key_pool.index(preferred)
            seen.add(index)
            ordered.append(index)
        start = self._next_key_index % size
        for offset in range(size):
            index = (start + offset) % size
            if index in seen:
                continue
            seen.add(index)
            ordered.append(index)
        return ordered

    def _lane_ready_wait_ms(
        self,
        *,
        key: str,
        model_id: str,
        key_state: _KeyState,
        lane: _LaneState,
        requested_tokens: int,
        now_ms: int,
    ) -> int:
        if key_state.auth_disabled_until_ms > now_ms:
            return max(1, key_state.auth_disabled_until_ms - now_ms)

        if lane.temp_block_until_ms > now_ms:
            return max(1, lane.temp_block_until_ms - now_ms)

        limit = self.config.models[model_id]
        window_reset_ms = max(1, (int(lane.window_started_ms) + self._window_ms) - now_ms)

        projected_rpm = int(lane.requests) + int(lane.in_flight_requests) + 1
        if projected_rpm > int(limit.rpm):
            return window_reset_ms

        projected_tpm = int(lane.tokens) + int(lane.in_flight_tokens) + int(requested_tokens)
        if projected_tpm > int(limit.tpm):
            return window_reset_ms

        return 0

    def acquire_for_task(
        self,
        *,
        task: str,
        key_pool: list[str],
        requested_tokens: int,
        blocked_keys: Optional[set[str]] = None,
        blocked_models: Optional[set[str]] = None,
        wait_timeout_ms: Optional[int] = None,
        preferred_key: Optional[str] = None,
    ) -> AcquireResult:
        normalized_task = str(task or "").strip().lower()
        route = self.route_models(normalized_task)
        blocked_model_set = {str(item or "").strip() for item in (blocked_models or set()) if str(item or "").strip()}
        candidates = [model for model in route if model not in blocked_model_set]
        if not candidates:
            return AcquireResult(lease=None, waited_ms=0, retry_after_ms=0, timed_out=True)
        return self.acquire_for_models(
            model_candidates=candidates,
            key_pool=key_pool,
            requested_tokens=requested_tokens,
            blocked_keys=blocked_keys,
            wait_timeout_ms=wait_timeout_ms,
            preferred_key=preferred_key,
        )

    def acquire_for_models(
        self,
        *,
        model_candidates: list[str],
        key_pool: list[str],
        requested_tokens: int,
        blocked_keys: Optional[set[str]] = None,
        wait_timeout_ms: Optional[int] = None,
        preferred_key: Optional[str] = None,
    ) -> AcquireResult:
        safe_requested_tokens = max(1, int(requested_tokens or 1))
        blocked_key_set = {str(item or "").strip() for item in (blocked_keys or set()) if str(item or "").strip()}
        safe_timeout_ms = (
            max(1_000, int(wait_timeout_ms))
            if wait_timeout_ms is not None
            else int(self.config.default_wait_timeout_ms)
        )
        safe_timeout_ms = max(1_000, safe_timeout_ms)

        started_at_ms = int(time.time() * 1000)
        waited_ms = 0

        while True:
            nearest_wait_ms: Optional[int] = None
            with self._lock:
                now_ms = int(time.time() * 1000)
                valid_candidates = [model for model in model_candidates if model in self.config.models]
                ordered_key_indexes = self._ordered_key_indexes(
                    key_pool,
                    str(preferred_key or "").strip(),
                    blocked_key_set,
                )
                for model_index, model_id in enumerate(valid_candidates):
                    for key_index in ordered_key_indexes:
                        key = str(key_pool[key_index] or "").strip()
                        if not key or key in blocked_key_set:
                            continue
                        key_state = self._key_state(key)
                        lane = self._lane_state(key, model_id)
                        self._reset_lane_if_window_rolled(lane, now_ms)
                        ready_wait_ms = self._lane_ready_wait_ms(
                            key=key,
                            model_id=model_id,
                            key_state=key_state,
                            lane=lane,
                            requested_tokens=safe_requested_tokens,
                            now_ms=now_ms,
                        )
                        if ready_wait_ms > 0:
                            nearest_wait_ms = (
                                ready_wait_ms
                                if nearest_wait_ms is None
                                else min(nearest_wait_ms, ready_wait_ms)
                            )
                            continue

                        lane.in_flight_requests = int(lane.in_flight_requests) + 1
                        lane.in_flight_tokens = int(lane.in_flight_tokens) + safe_requested_tokens
                        key_state.in_flight_total = int(key_state.in_flight_total) + 1
                        if len(key_pool) > 0:
                            self._next_key_index = (key_index + 1) % len(key_pool)
                        lease = LaneLease(
                            key=key,
                            model_id=model_id,
                            key_index=key_index,
                            model_index=model_index,
                            reserved_tokens=safe_requested_tokens,
                            reserved_at_ms=now_ms,
                        )
                        return AcquireResult(
                            lease=lease,
                            waited_ms=waited_ms,
                            retry_after_ms=0,
                            timed_out=False,
                        )

            now_after_ms = int(time.time() * 1000)
            elapsed_ms = max(0, now_after_ms - started_at_ms)
            if elapsed_ms >= safe_timeout_ms:
                return AcquireResult(
                    lease=None,
                    waited_ms=elapsed_ms,
                    retry_after_ms=max(0, int(nearest_wait_ms or 0)),
                    timed_out=True,
                )

            remaining_ms = max(0, safe_timeout_ms - elapsed_ms)
            sleep_ms = max(100, int(nearest_wait_ms or self._wait_slice_ms))
            sleep_ms = min(sleep_ms, self._wait_slice_ms, remaining_ms)
            if sleep_ms <= 0:
                return AcquireResult(
                    lease=None,
                    waited_ms=elapsed_ms,
                    retry_after_ms=max(0, int(nearest_wait_ms or 0)),
                    timed_out=True,
                )
            time.sleep(sleep_ms / 1000.0)
            waited_ms = max(0, int(time.time() * 1000) - started_at_ms)

    def release(
        self,
        lease: LaneLease,
        *,
        success: bool,
        used_tokens: Optional[int] = None,
        error_kind: Optional[str] = None,
    ) -> None:
        if lease is None:
            return
        now_ms = int(time.time() * 1000)
        safe_used_tokens = max(int(lease.reserved_tokens), int(used_tokens or lease.reserved_tokens))
        with self._lock:
            key_state = self._key_state(lease.key)
            lane = self._lane_state(lease.key, lease.model_id)
            self._reset_lane_if_window_rolled(lane, now_ms)

            lane.in_flight_requests = max(0, int(lane.in_flight_requests) - 1)
            lane.in_flight_tokens = max(0, int(lane.in_flight_tokens) - int(lease.reserved_tokens))
            key_state.in_flight_total = max(0, int(key_state.in_flight_total) - 1)

            lane.requests = int(lane.requests) + 1
            lane.tokens = int(lane.tokens) + safe_used_tokens
            key_state.requests_total = int(key_state.requests_total) + 1

            if success:
                lane.success_total = int(lane.success_total) + 1
                key_state.success_total = int(key_state.success_total) + 1
            else:
                lane.failure_total = int(lane.failure_total) + 1
                key_state.failure_total = int(key_state.failure_total) + 1

            normalized_error = str(error_kind or "").strip().lower()
            if normalized_error == "auth":
                key_state.auth_failures_total = int(key_state.auth_failures_total) + 1
                key_state.auth_disabled_until_ms = max(
                    int(key_state.auth_disabled_until_ms),
                    now_ms + self._auth_disable_ms,
                )
            elif normalized_error == "rate_limit":
                lane.rate_limited_total = int(lane.rate_limited_total) + 1
                key_state.rate_limited_total = int(key_state.rate_limited_total) + 1
                lane.temp_block_until_ms = max(
                    int(lane.temp_block_until_ms),
                    int(lane.window_started_ms) + self._window_ms,
                )

    def mark_rate_limited(self, key: str, model_id: str) -> None:
        now_ms = int(time.time() * 1000)
        with self._lock:
            lane = self._lane_state(key, model_id)
            self._reset_lane_if_window_rolled(lane, now_ms)
            lane.rate_limited_total = int(lane.rate_limited_total) + 1
            lane.temp_block_until_ms = max(int(lane.temp_block_until_ms), int(lane.window_started_ms) + self._window_ms)
            key_state = self._key_state(key)
            key_state.rate_limited_total = int(key_state.rate_limited_total) + 1

    def mark_auth_failed(self, key: str) -> None:
        now_ms = int(time.time() * 1000)
        with self._lock:
            key_state = self._key_state(key)
            key_state.auth_failures_total = int(key_state.auth_failures_total) + 1
            key_state.auth_disabled_until_ms = max(
                int(key_state.auth_disabled_until_ms),
                now_ms + self._auth_disable_ms,
            )

    def _lane_status(self, key_state: _KeyState, lane: _LaneState, now_ms: int) -> tuple[str, int]:
        if int(key_state.auth_disabled_until_ms) > now_ms:
            return "auth_issue", max(1, int(key_state.auth_disabled_until_ms) - now_ms)
        if int(lane.temp_block_until_ms) > now_ms:
            return "rate_limited", max(1, int(lane.temp_block_until_ms) - now_ms)
        if int(lane.in_flight_requests) > 0:
            return "in_flight", 0
        return "healthy", 0

    def snapshot(self, key_pool: list[str]) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        safe_pool = [str(key or "").strip() for key in key_pool if str(key or "").strip()]
        with self._lock:
            for key in safe_pool:
                self._key_state(key)

            key_entries: list[dict[str, Any]] = []
            model_entries: list[dict[str, Any]] = []
            healthy_keys = 0
            at_limit_keys = 0
            in_flight_total = 0

            for key_index, key in enumerate(safe_pool):
                key_state = self._key_state(key)
                model_breakdown: list[dict[str, Any]] = []
                key_status = "healthy"
                key_ready_in_ms = 0
                key_rate_strikes = 0
                key_at_limit = False

                for model_id in self._routed_models:
                    lane = self._lane_state(key, model_id)
                    self._reset_lane_if_window_rolled(lane, now_ms)
                    limit = self.config.models[model_id]
                    lane_status, lane_ready_in_ms = self._lane_status(key_state, lane, now_ms)
                    key_rate_strikes += int(lane.rate_limited_total)

                    rpm_remaining = max(0, int(limit.rpm) - (int(lane.requests) + int(lane.in_flight_requests)))
                    tpm_remaining = max(0, int(limit.tpm) - (int(lane.tokens) + int(lane.in_flight_tokens)))
                    lane_at_limit = rpm_remaining <= 0 or tpm_remaining <= 0
                    key_at_limit = key_at_limit or lane_at_limit

                    if lane_status == "auth_issue":
                        key_status = "auth_issue"
                        key_ready_in_ms = max(key_ready_in_ms, lane_ready_in_ms)
                    elif lane_status == "rate_limited" and key_status not in {"auth_issue"}:
                        key_status = "rate_limited"
                        key_ready_in_ms = max(key_ready_in_ms, lane_ready_in_ms)
                    elif lane_status == "in_flight" and key_status == "healthy":
                        key_status = "in_flight"

                    model_breakdown.append(
                        {
                            "model": model_id,
                            "status": lane_status,
                            "readyInMs": lane_ready_in_ms,
                            "rpm": int(limit.rpm),
                            "tpm": int(limit.tpm),
                            "usage": {
                                "requests": int(lane.requests),
                                "tokens": int(lane.tokens),
                                "inFlightRequests": int(lane.in_flight_requests),
                                "inFlightTokens": int(lane.in_flight_tokens),
                                "successes": int(lane.success_total),
                                "failures": int(lane.failure_total),
                                "rateLimited": int(lane.rate_limited_total),
                            },
                            "remaining": {
                                "rpm": rpm_remaining,
                                "tpm": tpm_remaining,
                                "atLimit": lane_at_limit,
                            },
                            "window": {
                                "startedAtMs": int(lane.window_started_ms),
                                "resetsInMs": max(0, (int(lane.window_started_ms) + self._window_ms) - now_ms),
                            },
                        }
                    )

                if key_status in {"healthy", "in_flight"}:
                    healthy_keys += 1
                if key_at_limit:
                    at_limit_keys += 1
                in_flight_total += int(key_state.in_flight_total)

                key_entries.append(
                    {
                        "index": key_index,
                        "fingerprint": api_key_fingerprint(key),
                        "status": key_status,
                        "inFlight": int(key_state.in_flight_total),
                        "readyInMs": key_ready_in_ms,
                        "rateLimitStrikes": key_rate_strikes,
                        "usage": {
                            "requests": int(key_state.requests_total),
                            "successes": int(key_state.success_total),
                            "failures": int(key_state.failure_total),
                            "rateLimited": int(key_state.rate_limited_total),
                            "authFailures": int(key_state.auth_failures_total),
                        },
                        "limit": {
                            "dailyLimit": None,
                            "remaining": None,
                            "atLimit": key_at_limit,
                        },
                        "health": {
                            "healthy": key_status in {"healthy", "in_flight"},
                            "reason": "ok" if key_status in {"healthy", "in_flight"} else key_status,
                        },
                        "models": model_breakdown,
                    }
                )

            for model_id, limit in self.config.models.items():
                aggregate_requests = 0
                aggregate_tokens = 0
                aggregate_rate_limited = 0
                at_capacity_keys = 0
                next_reset_ms: Optional[int] = None
                for key in safe_pool:
                    lane = self._lane_state(key, model_id)
                    self._reset_lane_if_window_rolled(lane, now_ms)
                    aggregate_requests += int(lane.requests)
                    aggregate_tokens += int(lane.tokens)
                    aggregate_rate_limited += int(lane.rate_limited_total)
                    rpm_remaining = max(0, int(limit.rpm) - (int(lane.requests) + int(lane.in_flight_requests)))
                    tpm_remaining = max(0, int(limit.tpm) - (int(lane.tokens) + int(lane.in_flight_tokens)))
                    if rpm_remaining <= 0 or tpm_remaining <= 0:
                        at_capacity_keys += 1
                    reset_in = max(0, (int(lane.window_started_ms) + self._window_ms) - now_ms)
                    if next_reset_ms is None or reset_in < next_reset_ms:
                        next_reset_ms = reset_in

                model_entries.append(
                    {
                        "model": model_id,
                        "rpm": int(limit.rpm),
                        "tpm": int(limit.tpm),
                        "enabledFor": sorted(limit.enabled_for),
                        "routed": model_id in self._routed_models,
                        "usage": {
                            "requests": aggregate_requests,
                            "tokens": aggregate_tokens,
                            "rateLimited": aggregate_rate_limited,
                        },
                        "pool": {
                            "keyCount": len(safe_pool),
                            "atCapacityKeys": at_capacity_keys,
                            "availableKeys": max(0, len(safe_pool) - at_capacity_keys),
                            "nextResetInMs": int(next_reset_ms or 0),
                        },
                    }
                )

            model_entries.sort(key=lambda item: str(item.get("model") or ""))

            return {
                "ok": True,
                "window": {
                    "type": "rolling_seconds",
                    "seconds": int(self.config.window_seconds),
                    "timestampMs": now_ms,
                },
                "allocator": {
                    "version": self.config.version,
                    "defaultWaitTimeoutMs": int(self.config.default_wait_timeout_ms),
                    "windowSeconds": int(self.config.window_seconds),
                },
                "pool": {
                    "keyCount": len(safe_pool),
                    "healthyKeys": healthy_keys,
                    "unhealthyKeys": max(0, len(safe_pool) - healthy_keys),
                    "atLimitKeys": at_limit_keys,
                    "inFlightTotal": in_flight_total,
                    "keyDailyLimit": None,
                    "overallDailyLimit": None,
                    "overallUsed": None,
                    "overallRemaining": None,
                    "overallAtLimit": False,
                    "rotationMode": "round_robin_forward",
                    "nextIndex": int(self._next_key_index if len(safe_pool) > 0 else 0),
                },
                "keys": key_entries,
                "models": model_entries,
            }

