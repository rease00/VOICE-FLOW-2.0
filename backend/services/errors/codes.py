from __future__ import annotations

from typing import Any

RATE_LIMIT_USER = "RATE_LIMIT_USER"
RATE_LIMIT_GLOBAL = "RATE_LIMIT_GLOBAL"
QUEUE_TIMEOUT = "QUEUE_TIMEOUT"
ENGINE_OVERLOADED = "ENGINE_OVERLOADED"
UPSTREAM_RATE_LIMIT = "UPSTREAM_RATE_LIMIT"


def extract_error_code(detail: Any) -> str:
    if not isinstance(detail, dict):
        return ""
    return str(detail.get("errorCode") or "").strip().upper()

