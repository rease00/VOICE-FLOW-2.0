from __future__ import annotations

import base64
import json
import logging
import os
import time
import uuid
import threading
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import urlparse

import requests

try:  # pragma: no cover - import availability depends on the runtime image
    from google.auth import default as google_auth_default
    from google.auth.transport.requests import Request as GoogleAuthRequest
    from google.oauth2 import id_token as google_id_token
except Exception:  # pragma: no cover
    google_auth_default = None  # type: ignore
    GoogleAuthRequest = None  # type: ignore
    google_id_token = None  # type: ignore


_TOKEN_CACHE_LOCK = threading.Lock()
_TOKEN_CACHE: dict[str, dict[str, Any]] = {}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _env_bool(name: str, default: bool = False) -> bool:
    raw = str(os.getenv(name) or "").strip().lower()
    if not raw:
        return bool(default)
    return raw in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    try:
        return int(str(os.getenv(name) or default).strip() or default)
    except Exception:
        return int(default)


def _env_float(name: str, default: float) -> float:
    try:
        return float(str(os.getenv(name) or default).strip() or default)
    except Exception:
        return float(default)


def _metadata_service_account_email() -> str:
    metadata_url = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email"
    try:
        response = requests.get(
            metadata_url,
            headers={"Metadata-Flavor": "Google"},
            timeout=1.5,
        )
    except Exception:
        return ""
    if not response.ok:
        return ""
    return str(response.text or "").strip()


def _resolve_default_service_account_email() -> str:
    explicit = str(os.getenv("VF_TTS_DRAIN_SERVICE_ACCOUNT_EMAIL") or "").strip()
    if explicit:
        return explicit
    return _metadata_service_account_email()


def _service_url_audience(url: str) -> str:
    safe_url = str(url or "").strip().rstrip("/")
    if not safe_url:
        return ""
    parsed = urlparse(safe_url)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return safe_url


def _redis_set(client: Any, key: str, value: str, *, ex: Optional[int] = None, nx: bool = False, xx: bool = False) -> bool:
    if client is None:
        return False
    setter = getattr(client, "set", None)
    if not callable(setter):
        return False
    try:
        return bool(setter(key, value, ex=ex, nx=nx, xx=xx))
    except Exception:
        return False


def _redis_delete(client: Any, *keys: str) -> None:
    if client is None:
        return
    deleter = getattr(client, "delete", None)
    if not callable(deleter):
        return
    try:
        deleter(*keys)
    except Exception:
        pass


def _redis_expire(client: Any, key: str, ttl_sec: int) -> None:
    if client is None:
        return
    expirer = getattr(client, "expire", None)
    if not callable(expirer):
        return
    try:
        expirer(key, max(1, int(ttl_sec)))
    except Exception:
        pass


def _redis_get(client: Any, key: str) -> str:
    if client is None:
        return ""
    getter = getattr(client, "get", None)
    if not callable(getter):
        return ""
    try:
        return str(getter(key) or "")
    except Exception:
        return ""


def _redis_llen(client: Any, key: str) -> int:
    if client is None:
        return 0
    getter = getattr(client, "llen", None)
    if not callable(getter):
        return 0
    try:
        return max(0, int(getter(key) or 0))
    except Exception:
        return 0


def _token_cache_get(cache_key: str, *, ttl_sec: int = 2700) -> str:
    with _TOKEN_CACHE_LOCK:
        cached = _TOKEN_CACHE.get(cache_key)
    if cached:
        age_sec = max(0.0, (time.time() * 1000 - float(cached.get("fetchedAtMs") or 0.0)) / 1000.0)
        if age_sec < float(ttl_sec):
            return str(cached.get("token") or "")
    return ""


def _token_cache_set(cache_key: str, token: str) -> None:
    with _TOKEN_CACHE_LOCK:
        _TOKEN_CACHE[cache_key] = {"token": str(token or ""), "fetchedAtMs": _now_ms()}


def _google_access_token(*, scope: str) -> str:
    cache_key = f"scope:{scope}"
    cached = _token_cache_get(cache_key)
    if cached:
        return cached
    if google_auth_default is None or GoogleAuthRequest is None:
        return ""
    try:
        credentials, _project_id = google_auth_default(scopes=[scope])
        credentials.refresh(GoogleAuthRequest())
        token = str(getattr(credentials, "token", "") or "").strip()
    except Exception:
        return ""
    if token:
        _token_cache_set(cache_key, token)
    return token


def _id_token_for_audience(audience: str) -> str:
    safe_audience = _service_url_audience(audience)
    if not safe_audience:
        return ""
    cache_key = f"audience:{safe_audience}"
    cached = _token_cache_get(cache_key)
    if cached:
        return cached
    if google_id_token is None or GoogleAuthRequest is None:
        return ""
    try:
        token = str(google_id_token.fetch_id_token(GoogleAuthRequest(), safe_audience) or "").strip()
    except Exception:
        return ""
    if token:
        _token_cache_set(cache_key, token)
    return token


def _auth_headers_for_worker_target(config: "TtsDrainConfig") -> dict[str, str]:
    _ = config
    return {"Content-Type": "application/json"}


@dataclass(frozen=True)
class TtsDrainConfig:
    enabled: bool
    project_id: str
    location: str
    queue_name: str
    worker_url: str
    service_account_email: str
    request_timeout_sec: float
    dispatch_deadline_sec: int
    wake_ttl_sec: int
    lock_ttl_sec: int
    batch_size: int

    @property
    def queue_path(self) -> str:
        return f"projects/{self.project_id}/locations/{self.location}/queues/{self.queue_name}"

    @property
    def worker_target_url(self) -> str:
        return f"{self.worker_url.rstrip('/')}/internal/tts/drain"

    @property
    def worker_audience(self) -> str:
        return _service_url_audience(self.worker_url)


def load_tts_drain_config() -> TtsDrainConfig:
    enabled = _env_bool("VF_TTS_DRAIN_ENABLED", True)
    project_id = (
        str(os.getenv("VF_TTS_DRAIN_PROJECT_ID") or "").strip()
        or str(os.getenv("GOOGLE_CLOUD_PROJECT") or "").strip()
        or str(os.getenv("GCP_PROJECT") or "").strip()
        or str(os.getenv("GCLOUD_PROJECT") or "").strip()
    )
    location = (
        str(os.getenv("VF_TTS_DRAIN_QUEUE_LOCATION") or "").strip()
        or str(os.getenv("GOOGLE_CLOUD_REGION") or "").strip()
        or str(os.getenv("CLOUD_RUN_REGION") or "").strip()
        or str(os.getenv("REGION") or "").strip()
    )
    queue_name = str(os.getenv("VF_TTS_DRAIN_QUEUE_NAME") or "").strip()
    worker_url = str(os.getenv("VF_TTS_DRAIN_WORKER_URL") or "").strip().rstrip("/")
    wake_ttl_sec = max(30, _env_int("VF_TTS_DRAIN_WAKE_TTL_MS", 900_000) // 1000)
    lock_ttl_sec = max(30, _env_int("VF_TTS_DRAIN_LOCK_TTL_MS", 900_000) // 1000)
    batch_size = max(1, _env_int("VF_TTS_DRAIN_BATCH_SIZE", 1))
    dispatch_deadline_sec = max(
        15,
        min(
            1800,
            _env_int("VF_TTS_DRAIN_DISPATCH_DEADLINE_SEC", max(900, lock_ttl_sec)),
        ),
    )
    request_timeout_sec = max(1.0, _env_float("VF_TTS_DRAIN_REQUEST_TIMEOUT_MS", 10_000.0) / 1000.0)
    if not (enabled and project_id and location and queue_name and worker_url):
        enabled = False
    if enabled and not project_id and google_auth_default is not None:
        try:
            _credentials, project_id = google_auth_default()
        except Exception:
            project_id = ""
    if enabled:
        service_account_email = str(os.getenv("VF_TTS_DRAIN_SERVICE_ACCOUNT_EMAIL") or "").strip() or _resolve_default_service_account_email()
    else:
        service_account_email = str(os.getenv("VF_TTS_DRAIN_SERVICE_ACCOUNT_EMAIL") or "").strip()
    return TtsDrainConfig(
        enabled=enabled,
        project_id=project_id,
        location=location,
        queue_name=queue_name,
        worker_url=worker_url,
        service_account_email=service_account_email,
        request_timeout_sec=request_timeout_sec,
        dispatch_deadline_sec=dispatch_deadline_sec,
        wake_ttl_sec=wake_ttl_sec,
        lock_ttl_sec=lock_ttl_sec,
        batch_size=batch_size,
    )


def _wake_key(prefix: str) -> str:
    return f"{str(prefix or '').strip()}:drain:wake"


def _followup_key(prefix: str) -> str:
    return f"{str(prefix or '').strip()}:drain:followup"


def _lock_key(prefix: str) -> str:
    return f"{str(prefix or '').strip()}:drain:lock"


def _build_task_payload(*, lane: str, reason: str, job_id: str, worker_id: str = "", kind: str = "initial") -> dict[str, Any]:
    return {
        "lane": str(lane or "").strip() or "free",
        "reason": str(reason or "").strip() or "queued",
        "jobId": str(job_id or "").strip(),
        "workerId": str(worker_id or "").strip(),
        "kind": str(kind or "initial").strip() or "initial",
        "createdAtMs": _now_ms(),
    }


def _create_task(config: TtsDrainConfig, *, payload: dict[str, Any]) -> dict[str, Any]:
    if not config.enabled:
        raise RuntimeError("TTS drain scheduler is disabled.")
    if not config.worker_audience:
        raise RuntimeError("TTS drain worker audience is not configured.")
    if not config.service_account_email:
        raise RuntimeError("TTS drain service account email is not configured.")
    access_token = _google_access_token(scope="https://www.googleapis.com/auth/cloud-platform")
    if not access_token:
        raise RuntimeError("Unable to mint an access token for Cloud Tasks.")

    task_body = json.dumps(payload or {}, separators=(",", ":"), sort_keys=True).encode("utf-8")
    task: dict[str, Any] = {
        "httpRequest": {
            "httpMethod": "POST",
            "url": config.worker_target_url,
            "headers": _auth_headers_for_worker_target(config),
            "oidcToken": {
                "serviceAccountEmail": config.service_account_email,
                "audience": config.worker_audience,
            },
            "body": base64.b64encode(task_body).decode("ascii"),
        },
        "dispatchDeadline": f"{int(config.dispatch_deadline_sec)}s",
    }
    endpoint = f"https://cloudtasks.googleapis.com/v2/{config.queue_path}/tasks"
    response = requests.post(
        endpoint,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        json={"task": task},
        timeout=config.request_timeout_sec,
    )
    if not response.ok:
        raise RuntimeError(
            f"Cloud Tasks task creation failed ({response.status_code}): {str(response.text or '').strip()[:240]}"
        )
    try:
        return dict(response.json())
    except Exception:
        return {"ok": True}


def touch_wake_key(redis_client: Any, key_prefix: str, *, reason: str = "", lane: str = "", job_id: str = "") -> bool:
    config = load_tts_drain_config()
    key = _wake_key(key_prefix)
    value = json.dumps(
        {
            "reason": str(reason or "").strip() or "queued",
            "lane": str(lane or "").strip() or "free",
            "jobId": str(job_id or "").strip(),
            "updatedAtMs": _now_ms(),
            "wakeId": str(uuid.uuid4()),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    _redis_set(redis_client, key, value, ex=config.wake_ttl_sec)
    return True


def clear_drain_state(redis_client: Any, key_prefix: str) -> None:
    _redis_delete(redis_client, _wake_key(key_prefix), _followup_key(key_prefix), _lock_key(key_prefix))


def clear_wake_key(redis_client: Any, key_prefix: str) -> None:
    _redis_delete(redis_client, _wake_key(key_prefix))


def clear_followup_key(redis_client: Any, key_prefix: str) -> None:
    _redis_delete(redis_client, _followup_key(key_prefix))


def acquire_drain_lock(redis_client: Any, key_prefix: str, *, worker_id: str) -> bool:
    config = load_tts_drain_config()
    if redis_client is None:
        return True
    key = _lock_key(key_prefix)
    value = json.dumps(
        {
            "workerId": str(worker_id or "").strip() or "worker",
            "acquiredAtMs": _now_ms(),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return _redis_set(redis_client, key, value, ex=config.lock_ttl_sec, nx=True)


def renew_drain_lock(redis_client: Any, key_prefix: str, *, worker_id: str) -> bool:
    config = load_tts_drain_config()
    if redis_client is None:
        return True
    key = _lock_key(key_prefix)
    current = _redis_get(redis_client, key)
    if not current:
        return False
    try:
        payload = json.loads(current)
    except Exception:
        payload = {}
    if str(payload.get("workerId") or "").strip() not in {"", str(worker_id or "").strip() or "worker"}:
        return False
    _redis_expire(redis_client, key, config.lock_ttl_sec)
    return True


def release_drain_lock(redis_client: Any, key_prefix: str, *, worker_id: str) -> None:
    if redis_client is None:
        return
    key = _lock_key(key_prefix)
    current = _redis_get(redis_client, key)
    if not current:
        return
    try:
        payload = json.loads(current)
    except Exception:
        payload = {}
    if str(payload.get("workerId") or "").strip() not in {"", str(worker_id or "").strip() or "worker"}:
        return
    _redis_delete(redis_client, key)


def request_initial_drain(
    redis_client: Any,
    key_prefix: str,
    *,
    lane: str,
    job_id: str,
    reason: str,
) -> bool:
    config = load_tts_drain_config()
    if not config.enabled:
        return False
    wake_key = _wake_key(key_prefix)
    followup_key = _followup_key(key_prefix)
    wake_value = json.dumps(
        {
            "kind": "initial",
            "lane": str(lane or "").strip() or "free",
            "jobId": str(job_id or "").strip(),
            "reason": str(reason or "").strip() or "queued",
            "createdAtMs": _now_ms(),
            "wakeId": str(uuid.uuid4()),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    if not _redis_set(redis_client, wake_key, wake_value, ex=config.wake_ttl_sec, nx=True):
        return False
    _redis_delete(redis_client, followup_key)
    try:
        _create_task(
            config,
            payload=_build_task_payload(
                lane=lane,
                reason=reason,
                job_id=job_id,
                kind="initial",
            ),
        )
    except Exception:
        _redis_delete(redis_client, wake_key)
        raise
    return True


def request_followup_drain(
    redis_client: Any,
    key_prefix: str,
    *,
    lane: str,
    job_id: str,
    reason: str,
    worker_id: str,
) -> bool:
    config = load_tts_drain_config()
    if not config.enabled:
        return False
    followup_key = _followup_key(key_prefix)
    if not _redis_set(
        redis_client,
        followup_key,
        json.dumps(
            {
                "kind": "followup",
                "lane": str(lane or "").strip() or "free",
                "jobId": str(job_id or "").strip(),
                "reason": str(reason or "").strip() or "backlog",
                "workerId": str(worker_id or "").strip() or "worker",
                "createdAtMs": _now_ms(),
                "followupId": str(uuid.uuid4()),
            },
            sort_keys=True,
            separators=(",", ":"),
        ),
        ex=config.lock_ttl_sec,
        nx=True,
    ):
        return False
    touch_wake_key(redis_client, key_prefix, reason=reason, lane=lane, job_id=job_id)
    try:
        _create_task(
            config,
            payload=_build_task_payload(
                lane=lane,
                reason=reason,
                job_id=job_id,
                worker_id=worker_id,
                kind="followup",
            ),
        )
    except Exception:
        _redis_delete(redis_client, followup_key, _wake_key(key_prefix))
        raise
    return True


def queue_depth_snapshot(redis_client: Any, key_prefix: str, lanes: list[str]) -> int:
    total = 0
    for lane in lanes:
        safe_lane = str(lane or "").strip() or "free"
        total += _redis_llen(redis_client, f"{str(key_prefix or '').strip()}:ready:{safe_lane}")
    return int(total)


def queue_has_backlog(redis_client: Any, key_prefix: str, lanes: list[str]) -> bool:
    return queue_depth_snapshot(redis_client, key_prefix, lanes) > 0


def log_scheduler_failure(logger: logging.Logger, *, action: str, key_prefix: str, error: Exception, extra: Optional[dict[str, Any]] = None) -> None:
    payload = {"keyPrefix": str(key_prefix or "").strip(), "error": str(error or "").strip()}
    if extra:
        payload.update({str(key): value for key, value in extra.items()})
    logger.warning("TTS drain scheduler failed", extra={"action": action, **payload})
