from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Optional
from urllib.parse import urlparse

import requests

from .runtime_client import RETRYABLE_STATUS_CODES


@dataclass
class _RuntimeCircuitState:
    state: str = "closed"
    consecutive_failures: int = 0
    opened_until_monotonic: float = 0.0
    trial_in_flight: bool = False
    last_failure_status: int = 0
    last_failure_reason: str = ""


class RuntimeCircuitBreakerOpenError(requests.exceptions.ConnectionError):
    def __init__(self, *, method: str, url: str, retry_after_sec: float) -> None:
        self.method = str(method or "GET").strip().upper() or "GET"
        self.url = str(url or "").strip()
        self.retry_after_sec = max(0.0, float(retry_after_sec))
        message = (
            f"{self.method} {self.url} blocked by runtime circuit breaker "
            f"for another {self.retry_after_sec:.1f}s"
        )
        super().__init__(message)


class RuntimeCircuitBreaker:
    def __init__(
        self,
        *,
        failure_threshold: int = 5,
        recovery_timeout_sec: int = 30,
        trip_status_codes: Optional[set[int] | frozenset[int]] = None,
        time_fn: Optional[Callable[[], float]] = None,
    ) -> None:
        self._failure_threshold = max(1, int(failure_threshold))
        self._recovery_timeout_sec = max(1, int(recovery_timeout_sec))
        self._trip_status_codes = frozenset(trip_status_codes or RETRYABLE_STATUS_CODES)
        self._time_fn = time_fn or time.monotonic
        self._lock = threading.Lock()
        self._states: dict[str, _RuntimeCircuitState] = {}

    def _key_for_url(self, url: str) -> str:
        parsed = urlparse(str(url or "").strip())
        scheme = str(parsed.scheme or "http").strip().lower() or "http"
        netloc = str(parsed.netloc or "").strip().lower()
        path = str(parsed.path or "").strip()
        if netloc:
            return f"{scheme}://{netloc}"
        return path or str(url or "").strip() or "runtime"

    def before_request(self, *, method: str, url: str, key: Optional[str] = None) -> str:
        state_key = str(key or self._key_for_url(url))
        safe_method = str(method or "GET").strip().upper() or "GET"
        with self._lock:
            state = self._states.setdefault(state_key, _RuntimeCircuitState())
            now = self._time_fn()
            if state.state == "open":
                if now < state.opened_until_monotonic:
                    raise RuntimeCircuitBreakerOpenError(
                        method=safe_method,
                        url=url,
                        retry_after_sec=state.opened_until_monotonic - now,
                    )
                state.state = "half-open"
                state.trial_in_flight = True
                return state_key
            if state.state == "half-open" and state.trial_in_flight:
                retry_after = max(0.0, state.opened_until_monotonic - now)
                raise RuntimeCircuitBreakerOpenError(
                    method=safe_method,
                    url=url,
                    retry_after_sec=retry_after,
                )
            if state.state == "half-open":
                state.trial_in_flight = True
            return state_key

    def record_success(self, *, key: str) -> None:
        state_key = str(key or "runtime")
        with self._lock:
            state = self._states.setdefault(state_key, _RuntimeCircuitState())
            state.state = "closed"
            state.consecutive_failures = 0
            state.opened_until_monotonic = 0.0
            state.trial_in_flight = False
            state.last_failure_status = 0
            state.last_failure_reason = ""

    def record_failure(self, *, key: str, reason: str = "", status_code: int = 0) -> None:
        state_key = str(key or "runtime")
        with self._lock:
            state = self._states.setdefault(state_key, _RuntimeCircuitState())
            state.last_failure_status = max(0, int(status_code))
            state.last_failure_reason = str(reason or "").strip()
            if state.state == "half-open":
                self._open_locked(state)
                return
            state.trial_in_flight = False
            state.consecutive_failures += 1
            if state.consecutive_failures >= self._failure_threshold:
                self._open_locked(state)

    def record_response(self, *, key: str, status_code: int) -> None:
        safe_status = max(0, int(status_code))
        if safe_status in self._trip_status_codes:
            self.record_failure(key=key, status_code=safe_status, reason=f"status:{safe_status}")
            return
        self.record_success(key=key)

    def snapshot(self, *, key: Optional[str] = None) -> dict[str, dict[str, Any]]:
        with self._lock:
            now = self._time_fn()
            if key is not None:
                items = [(str(key), self._states.get(str(key), _RuntimeCircuitState()))]
            else:
                items = list(self._states.items())
            return {
                state_key: {
                    "state": state.state,
                    "consecutiveFailures": int(state.consecutive_failures),
                    "retryAfterSec": max(0.0, float(state.opened_until_monotonic - now)),
                    "trialInFlight": bool(state.trial_in_flight),
                    "lastFailureStatus": int(state.last_failure_status),
                    "lastFailureReason": str(state.last_failure_reason or ""),
                }
                for state_key, state in items
            }

    def reset(self, *, key: Optional[str] = None) -> None:
        with self._lock:
            if key is None:
                self._states.clear()
                return
            self._states.pop(str(key), None)

    def _open_locked(self, state: _RuntimeCircuitState) -> None:
        state.state = "open"
        state.consecutive_failures = max(state.consecutive_failures, self._failure_threshold)
        state.opened_until_monotonic = self._time_fn() + float(self._recovery_timeout_sec)
        state.trial_in_flight = False