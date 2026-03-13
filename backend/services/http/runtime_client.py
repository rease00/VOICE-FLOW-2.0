from __future__ import annotations

import time
import threading
from dataclasses import dataclass
from typing import Any, Optional

import requests


RETRYABLE_STATUS_CODES = frozenset({429, 500, 502, 503, 504})
_IDEMPOTENT_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "DELETE"})


@dataclass(frozen=True)
class RuntimeHttpError(Exception):
    method: str
    url: str
    category: str
    message: str
    attempt: int
    status_code: int = 0
    retryable: bool = False

    def __str__(self) -> str:
        return (
            f"{self.method} {self.url} failed (category={self.category}, "
            f"attempt={self.attempt}, status={self.status_code or 'n/a'}): {self.message}"
        )


def _classify_request_exception(exc: Exception) -> tuple[str, bool]:
    if isinstance(exc, requests.exceptions.Timeout):
        return "timeout", True
    if isinstance(exc, requests.exceptions.ConnectionError):
        return "connection", True
    if isinstance(exc, requests.exceptions.RequestException):
        return "request", False
    return "unexpected", False


class RuntimeHttpClient:
    def __init__(self, *, pool_connections: int = 64, pool_maxsize: int = 64) -> None:
        self._local = threading.local()
        self._pool_connections = max(1, int(pool_connections))
        self._pool_maxsize = max(1, int(pool_maxsize))

    def _build_session(self) -> requests.Session:
        session = requests.Session()
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=self._pool_connections,
            pool_maxsize=self._pool_maxsize,
            max_retries=0,
        )
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        return session

    def session(self) -> requests.Session:
        current = getattr(self._local, "session", None)
        if isinstance(current, requests.Session):
            return current
        current = self._build_session()
        self._local.session = current
        return current

    def request(
        self,
        method: str,
        url: str,
        *,
        max_attempts: int = 1,
        retry_backoff_ms: int = 120,
        retry_status_codes: Optional[set[int] | frozenset[int]] = None,
        allow_retry_non_idempotent: bool = False,
        **kwargs: Any,
    ) -> requests.Response:
        safe_method = str(method or "GET").strip().upper() or "GET"
        attempts = max(1, int(max_attempts))
        backoff_ms = max(0, int(retry_backoff_ms))
        retryable_status = set(retry_status_codes or RETRYABLE_STATUS_CODES)
        method_retry_allowed = allow_retry_non_idempotent or safe_method in _IDEMPOTENT_METHODS
        session = self.session()

        for attempt in range(1, attempts + 1):
            try:
                response = session.request(method=safe_method, url=url, **kwargs)
            except Exception as exc:  # noqa: BLE001
                category, retryable = _classify_request_exception(exc)
                can_retry = retryable and method_retry_allowed and attempt < attempts
                if can_retry and backoff_ms > 0:
                    time.sleep((backoff_ms * attempt) / 1000.0)
                    continue
                raise RuntimeHttpError(
                    method=safe_method,
                    url=url,
                    category=category,
                    message=str(exc),
                    attempt=attempt,
                    retryable=retryable,
                ) from exc

            should_retry_status = (
                method_retry_allowed
                and attempt < attempts
                and int(response.status_code) in retryable_status
            )
            if should_retry_status:
                if backoff_ms > 0:
                    time.sleep((backoff_ms * attempt) / 1000.0)
                continue
            return response

        raise RuntimeHttpError(
            method=safe_method,
            url=url,
            category="retry_exhausted",
            message="runtime request retries exhausted",
            attempt=attempts,
            retryable=True,
        )
