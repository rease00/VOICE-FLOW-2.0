from __future__ import annotations

import json
import logging
import os
import signal
import socket
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Event
from typing import Any
from urllib.parse import urlparse

import app as backend_app
from services.queue.cloud_tasks_wake import (
    acquire_drain_lock,
    clear_followup_key,
    clear_wake_key,
    log_scheduler_failure,
    load_tts_drain_config,
    queue_has_backlog,
    release_drain_lock,
    renew_drain_lock,
    request_followup_drain,
    request_initial_drain,
    touch_wake_key,
)
from services.queue.redis_queue import (
    DEFAULT_WORKER_CATEGORY,
    QUEUE_TERMINAL_STATUSES,
    WORKER_CATEGORY_APP_LOCAL,
    WORKER_CATEGORY_GLOBAL_API,
    normalize_worker_category,
)

try:  # pragma: no cover - import availability depends on the runtime image
    from google.auth.transport.requests import Request as GoogleAuthRequest
    from google.oauth2 import id_token as google_id_token
except Exception:  # pragma: no cover
    GoogleAuthRequest = None  # type: ignore
    google_id_token = None  # type: ignore


@dataclass
class TtsWorkerJob:
    uid: str
    request_id: str
    engine: str
    payload: dict[str, Any]

    def to_queue_payload(self) -> dict[str, Any]:
        payload = dict(self.payload or {})
        payload.setdefault("uid", self.uid)
        payload.setdefault("requestId", self.request_id)
        payload.setdefault("engine", self.engine)
        return payload


def normalize_tts_worker_job(payload: dict[str, Any]) -> TtsWorkerJob:
    data = dict(payload or {})
    return TtsWorkerJob(
        uid=str(data.get("uid") or "").strip(),
        request_id=str(data.get("requestId") or data.get("request_id") or "").strip(),
        engine=str(data.get("engine") or "").strip(),
        payload=data,
    )


def process_tts_job(job: TtsWorkerJob) -> None:
    return backend_app._process_tts_job(job.to_queue_payload(), worker_id=_worker_id())


def _worker_id() -> str:
    host = socket.gethostname().strip() or "worker"
    pid = os.getpid()
    return f"{host}:{pid}"


def _worker_category() -> str:
    explicit = str(os.getenv("VF_TTS_WORKER_CATEGORY") or "").strip()
    if explicit:
        return normalize_worker_category(explicit)
    role = str(os.getenv("VF_SERVICE_ROLE") or "").strip().lower()
    if role == "api":
        return WORKER_CATEGORY_APP_LOCAL
    if role == "worker":
        return WORKER_CATEGORY_GLOBAL_API
    return DEFAULT_WORKER_CATEGORY


def _idle_sleep_seconds() -> float:
    raw = str(os.getenv("VF_TTS_WORKER_IDLE_SLEEP_MS") or "250").strip()
    try:
        return max(0.05, float(int(raw)) / 1000.0)
    except Exception:
        return 0.25


def _error_sleep_seconds() -> float:
    raw = str(os.getenv("VF_TTS_WORKER_ERROR_SLEEP_MS") or "1000").strip()
    try:
        return max(0.1, float(int(raw)) / 1000.0)
    except Exception:
        return 1.0


def _claim_heartbeat_interval_seconds(queue: Any) -> float:
    ttl_sec = max(30, int(getattr(queue, "_claim_ttl_sec", 0) or 0))
    return max(5.0, min(30.0, float(ttl_sec) / 3.0))


def _claim_heartbeat_max_failures() -> int:
    raw = str(os.getenv("VF_TTS_WORKER_CLAIM_HEARTBEAT_MAX_FAILURES") or "3").strip()
    try:
        return max(1, int(raw))
    except Exception:
        return 3


def _claim_heartbeat_grace_seconds(queue: Any) -> float:
    missing_claim_grace_sec = 0.0
    try:
        missing_claim_grace_sec = max(
            0.0,
            float(int(getattr(queue, "_missing_claim_grace_ms", 0) or 0)) / 1000.0,
        )
    except Exception:
        missing_claim_grace_sec = 0.0

    raw = str(os.getenv("VF_TTS_WORKER_CLAIM_HEARTBEAT_GRACE_SEC") or "").strip()
    if raw:
        try:
            configured = max(5.0, float(raw))
            return min(configured, missing_claim_grace_sec) if missing_claim_grace_sec > 0 else configured
        except Exception:
            pass
    ttl_sec = max(30, int(getattr(queue, "_claim_ttl_sec", 0) or 0))
    default_grace = max(15.0, float(ttl_sec) * 1.5)
    if missing_claim_grace_sec > 0:
        return max(5.0, min(default_grace, missing_claim_grace_sec))
    return default_grace


def _recovery_interval_seconds(queue: Any) -> float:
    raw = str(os.getenv("VF_TTS_WORKER_RECOVERY_INTERVAL_MS") or "").strip()
    if raw:
        try:
            return max(1.0, float(int(raw)) / 1000.0)
        except Exception:
            pass
    ttl_sec = max(30, int(getattr(queue, "_claim_ttl_sec", 0) or 0))
    return max(5.0, min(60.0, float(ttl_sec) / 2.0))


def _recovery_limit() -> int:
    raw = str(os.getenv("VF_TTS_WORKER_RECOVERY_LIMIT") or "10").strip()
    try:
        return max(1, int(raw))
    except Exception:
        return 10


def _health_host() -> str:
    return str(os.getenv("VF_TTS_WORKER_HEALTH_HOST") or "0.0.0.0").strip() or "0.0.0.0"


def _health_port() -> int:
    raw = str(os.getenv("VF_TTS_WORKER_HEALTH_PORT") or os.getenv("PORT") or "8080").strip()
    try:
        return int(raw)
    except Exception:
        return 8080


def _health_max_stale_ms() -> int:
    raw = str(os.getenv("VF_TTS_WORKER_HEALTH_MAX_STALE_MS") or "60000").strip()
    try:
        return max(1000, int(raw))
    except Exception:
        return 60000


def _drain_batch_size() -> int:
    raw = str(os.getenv("VF_TTS_DRAIN_BATCH_SIZE") or "1").strip()
    try:
        return max(1, int(raw))
    except Exception:
        return 1


def _drain_admin_token() -> str:
    return str(os.getenv("VF_TTS_DRAIN_ADMIN_TOKEN") or "").strip()


def _is_production_like() -> bool:
    return str(os.getenv("VF_ENV") or os.getenv("ENV") or "").strip().lower() in {"prod", "production"}


def _drain_oidc_audience() -> str:
    return str(os.getenv("VF_TTS_DRAIN_WORKER_URL") or "").strip().rstrip("/")


def _verify_drain_oidc_token(token: str) -> bool:
    safe_token = str(token or "").strip()
    if not safe_token:
        return False
    audience = _drain_oidc_audience()
    if not audience or google_id_token is None or GoogleAuthRequest is None:
        return False
    try:
        claims = google_id_token.verify_oauth2_token(safe_token, GoogleAuthRequest(), audience)
    except Exception:
        return False
    expected_service_account = str(os.getenv("VF_TTS_DRAIN_SERVICE_ACCOUNT_EMAIL") or "").strip().lower()
    if expected_service_account:
        email = str((claims or {}).get("email") or "").strip().lower()
        if email and email != expected_service_account:
            return False
    return True


def _worker_mode() -> str:
    return str(os.getenv("VF_TTS_WORKER_MODE") or "poll").strip().lower() or "poll"


@dataclass
class WorkerHealthState:
    worker_id: str
    require_heartbeat: bool = True
    started_at_ms: int = field(default_factory=lambda: int(time.time() * 1000))
    last_loop_at_ms: int = 0
    queue_ready: bool = False
    queue_init_failed: bool = False
    queue_init_error: str = ""
    lock: threading.Lock = field(default_factory=threading.Lock)

    def touch_loop(self) -> None:
        with self.lock:
            self.last_loop_at_ms = int(time.time() * 1000)

    def mark_queue_ready(self) -> None:
        with self.lock:
            self.queue_ready = True
            self.queue_init_failed = False
            self.queue_init_error = ""

    def mark_queue_init_failed(self, error: str = "") -> None:
        with self.lock:
            self.queue_ready = False
            self.queue_init_failed = True
            self.queue_init_error = str(error or "")[:240]

    def snapshot(self) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        max_stale_ms = _health_max_stale_ms()
        with self.lock:
            last_loop_at_ms = int(self.last_loop_at_ms or self.started_at_ms or now_ms)
            queue_ready = bool(self.queue_ready)
            queue_init_failed = bool(self.queue_init_failed)
            queue_init_error = str(self.queue_init_error or "")
            started_at_ms = int(self.started_at_ms or now_ms)
        last_loop_age_ms = max(0, now_ms - last_loop_at_ms)
        stale = bool(self.require_heartbeat) and last_loop_age_ms > max_stale_ms
        ready = queue_ready and not queue_init_failed and not stale
        payload = {
            "ready": ready,
            "workerId": self.worker_id,
            "requireHeartbeat": bool(self.require_heartbeat),
            "queueReady": queue_ready,
            "queueInitFailed": queue_init_failed,
            "queueInitError": queue_init_error,
            "startedAtMs": started_at_ms,
            "lastLoopAtMs": last_loop_at_ms,
            "lastLoopAgeMs": last_loop_age_ms,
            "maxStaleMs": max_stale_ms,
            "stale": stale,
        }
        return payload


@dataclass
class WorkerHealthServer:
    state: WorkerHealthState
    host: str
    port: int
    server: ThreadingHTTPServer
    thread: threading.Thread

    @property
    def bound_port(self) -> int:
        return int(getattr(self.server, "server_address", ("", self.port))[1] or self.port)

    def close(self) -> None:
        try:
            self.server.shutdown()
        except Exception:
            pass
        try:
            self.server.server_close()
        except Exception:
            pass
        try:
            self.thread.join(timeout=2.0)
        except Exception:
            pass


def _start_worker_health_server(state: WorkerHealthState) -> WorkerHealthServer | None:
    port = _health_port()
    if port < 0:
        return None
    host = _health_host()

    class _Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            if path not in {"/healthz", "/readyz"}:
                self.send_error(404)
                return
            snapshot = state.snapshot()
            body = json.dumps(snapshot, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
            status = 200 if bool(snapshot.get("ready")) else 503
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
            _ = format, args

    class _HealthHTTPServer(ThreadingHTTPServer):
        allow_reuse_address = True

    server = _HealthHTTPServer((host, port), _Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True, name=f"tts-health-{state.worker_id[:8]}")
    thread.start()
    return WorkerHealthServer(state=state, host=host, port=port, server=server, thread=thread)


def _start_claim_heartbeat(queue: Any, *, job_id: str, worker_id: str, logger: logging.Logger, touch_loop: Any = None) -> Event:
    stop_event = Event()

    def _loop() -> None:
        interval = _claim_heartbeat_interval_seconds(queue)
        max_failures = _claim_heartbeat_max_failures()
        grace_ms = int(_claim_heartbeat_grace_seconds(queue) * 1000.0)
        consecutive_failures = 0
        last_success_ms = int(time.time() * 1000)
        while not stop_event.wait(interval):
            try:
                renewed = bool(getattr(queue, "renew_claim", lambda *args, **kwargs: False)(job_id, worker_id=worker_id))
            except Exception as exc:  # noqa: BLE001
                renewed = False
                logger.warning(
                    "Claim heartbeat failed",
                    extra={"workerId": worker_id, "jobId": job_id, "error": str(exc)},
                )
            if callable(touch_loop):
                try:
                    touch_loop()
                except Exception:
                    pass
            if renewed:
                consecutive_failures = 0
                last_success_ms = int(time.time() * 1000)
                continue
            consecutive_failures += 1
            now_ms = int(time.time() * 1000)
            failure_age_ms = max(0, now_ms - last_success_ms)
            if failure_age_ms < grace_ms or consecutive_failures < max_failures:
                logger.warning(
                    "Claim heartbeat retrying after transient renewal miss",
                    extra={
                        "workerId": worker_id,
                        "jobId": job_id,
                        "consecutiveFailures": consecutive_failures,
                        "failureAgeMs": failure_age_ms,
                        "graceMs": grace_ms,
                    },
                )
                continue
            logger.warning(
                "Claim heartbeat exhausted retries; stopping renewal loop",
                extra={
                    "workerId": worker_id,
                    "jobId": job_id,
                    "consecutiveFailures": consecutive_failures,
                    "failureAgeMs": failure_age_ms,
                },
            )
            if callable(touch_loop):
                try:
                    touch_loop()
                except Exception:
                    pass
            break

    thread = threading.Thread(target=_loop, daemon=True, name=f"tts-heartbeat-{job_id[:8]}")
    thread.start()
    return stop_event


def _process_claimed_job(queue: Any, *, claimed: dict[str, Any], worker_id: str, logger: logging.Logger, touch_loop: Any = None) -> None:
    job_id = str(claimed.get("jobId") or claimed.get("job_id") or "").strip()
    heartbeat_stop = _start_claim_heartbeat(queue, job_id=job_id, worker_id=worker_id, logger=logger, touch_loop=touch_loop)
    try:
        process_tts_job(normalize_tts_worker_job(claimed))
    except Exception as exc:  # noqa: BLE001
        logger.exception("TTS job processing crashed", extra={"workerId": worker_id, "jobId": job_id})
        try:
            current = queue.get(job_id)
        except Exception:
            current = None
        current_status = str((current or {}).get("status") or "").strip().lower()
        if current_status in QUEUE_TERMINAL_STATUSES:
            logger.info(
                "Skipping crash fallback because job already reached a terminal state",
                extra={"workerId": worker_id, "jobId": job_id, "status": current_status},
            )
        else:
            try:
                queue.mark_failed(
                    job_id,
                    status_code=500,
                    error={"detail": f"TTS worker crashed: {exc}"},
                )
            except Exception:
                logger.exception("Failed to mark crashed job as failed", extra={"workerId": worker_id, "jobId": job_id})
    finally:
        heartbeat_stop.set()
        if callable(touch_loop):
            try:
                touch_loop()
            except Exception:
                pass


def _restore_dequeued_job(queue: Any, *, job_payload: dict[str, Any], worker_id: str, logger: logging.Logger) -> bool:
    job_id = str(job_payload.get("jobId") or job_payload.get("job_id") or "").strip()
    if not job_id:
        return False
    try:
        current = queue.get(job_id)
    except Exception:
        current = None
    current_status = str((current or {}).get("status") or "").strip().lower()
    if current is not None and current_status not in {"", "queued"}:
        return False
    try:
        queue.requeue(
            job_id,
            worker_id=worker_id,
            payload=current or job_payload,
            bypass_depth_check=True,
            recovery=True,
        )
        logger.warning("Requeued dequeued job after claim failure", extra={"workerId": worker_id, "jobId": job_id})
        return True
    except Exception:
        logger.exception("Failed to requeue dropped job", extra={"workerId": worker_id, "jobId": job_id})
        return False


def _worker_drain_auth_ok(headers: Any) -> bool:
    header_lookup = getattr(headers, "get", None)
    if not callable(header_lookup):
        return False
    provided = str(header_lookup("authorization") or "").strip()
    if provided.lower().startswith("bearer "):
        token = provided.split(" ", 1)[1].strip()
        if _verify_drain_oidc_token(token):
            return True
        if not _is_production_like():
            expected = _drain_admin_token()
            if expected and token == expected:
                return True
        return False

    if _is_production_like():
        return False

    expected = _drain_admin_token()
    if not expected:
        return True
    provided_header = str(header_lookup("x-admin-token") or "").strip()
    return bool(provided_header and provided_header == expected)


def _queue_depth_total(queue: Any) -> int:
    depth_snapshot = getattr(queue, "depth_snapshot", None)
    if callable(depth_snapshot):
        try:
            snapshot = depth_snapshot()
            return max(0, int((snapshot or {}).get("total") or 0))
        except Exception:
            pass
    depth_total = getattr(queue, "_queue_depth_total", None)
    if callable(depth_total):
        try:
            return max(0, int(depth_total() or 0))
        except Exception:
            pass
    return 0


def _unique_lanes_for_queue(queue: Any) -> list[str]:
    unique_lanes = getattr(queue, "_unique_lanes", None)
    if callable(unique_lanes):
        try:
            lanes = [str(lane or "").strip() or "free" for lane in list(unique_lanes())]
            return lanes or ["free"]
        except Exception:
            pass
    return ["free"]


def _process_http_drain(queue: Any, *, worker_id: str, logger: logging.Logger, payload: dict[str, Any], touch_loop: Any = None) -> dict[str, Any]:
    key_prefix = str(getattr(queue, "key_prefix", "") or "").strip()
    redis_client = getattr(queue, "_redis", None)
    drain_locked = acquire_drain_lock(redis_client, key_prefix, worker_id=worker_id)
    if not drain_locked:
        return {
            "ok": True,
            "skipped": True,
            "reason": "drain_locked",
            "workerId": worker_id,
        }

    processed = 0
    recovered = 0
    followup_requested = False
    last_lane = str(payload.get("lane") or "free").strip() or "free"
    last_job_id = str(payload.get("jobId") or payload.get("job_id") or "").strip()

    try:
        if callable(touch_loop):
            touch_loop()
        if redis_client is not None:
            touch_wake_key(redis_client, key_prefix, reason="drain-start", lane=last_lane, job_id=last_job_id)
            clear_followup_key(redis_client, key_prefix)

        recovery_limit = _recovery_limit()
        try:
            recovered = int(queue.recover_stalled_claims(limit=max(1, recovery_limit)) or 0)
            if recovered > 0:
                logger.warning(
                    "Recovered stalled claims during HTTP drain",
                    extra={"workerId": worker_id, "recovered": recovered},
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Stalled-claim recovery pass failed during HTTP drain",
                extra={"workerId": worker_id, "error": str(exc)},
            )

        batch_size = _drain_batch_size()
        for _ in range(batch_size):
            if callable(touch_loop):
                touch_loop()
            claimed = queue.reserve_next(worker_id=worker_id)
            if not claimed:
                break
            job_id = str(claimed.get("jobId") or claimed.get("job_id") or "").strip()
            if not job_id:
                logger.warning("Skipping reserved job without jobId", extra={"workerId": worker_id})
                continue
            last_job_id = job_id
            last_lane = str(claimed.get("lane") or last_lane or "free").strip() or "free"
            _process_claimed_job(queue, claimed=claimed, worker_id=worker_id, logger=logger, touch_loop=touch_loop)
            processed += 1
            if redis_client is not None:
                renew_drain_lock(redis_client, key_prefix, worker_id=worker_id)
                touch_wake_key(redis_client, key_prefix, reason="drain-progress", lane=last_lane, job_id=last_job_id)

        backlog = _queue_depth_total(queue) > 0
        if backlog and redis_client is not None:
            touch_wake_key(redis_client, key_prefix, reason="drain-backlog", lane=last_lane, job_id=last_job_id)
            try:
                followup_requested = request_followup_drain(
                    redis_client,
                    key_prefix,
                    lane=last_lane,
                    job_id=last_job_id,
                    reason="backlog",
                    worker_id=worker_id,
                )
            except Exception as exc:  # noqa: BLE001
                log_scheduler_failure(
                    logger,
                    action="request_followup_drain",
                    key_prefix=key_prefix,
                    error=exc,
                    extra={"workerId": worker_id, "lane": last_lane, "jobId": last_job_id, "reason": "backlog"},
                )
        elif redis_client is not None:
            clear_followup_key(redis_client, key_prefix)
            clear_wake_key(redis_client, key_prefix)
            if queue_has_backlog(redis_client, key_prefix, _unique_lanes_for_queue(queue)):
                touch_wake_key(redis_client, key_prefix, reason="drain-race", lane=last_lane, job_id=last_job_id)
                try:
                    request_initial_drain(
                        redis_client,
                        key_prefix,
                        lane=last_lane,
                        job_id=last_job_id,
                        reason="drain-race",
                    )
                except Exception as exc:  # noqa: BLE001
                    log_scheduler_failure(
                        logger,
                        action="request_initial_drain",
                        key_prefix=key_prefix,
                        error=exc,
                        extra={"workerId": worker_id, "lane": last_lane, "jobId": last_job_id, "reason": "drain-race"},
                    )

        return {
            "ok": True,
            "workerId": worker_id,
            "processed": processed,
            "recovered": recovered,
            "backlog": backlog,
            "followupRequested": followup_requested,
            "queueDepth": _queue_depth_total(queue),
            "batchSize": batch_size,
        }
    finally:
        release_drain_lock(redis_client, key_prefix, worker_id=worker_id)


def _start_worker_http_server(state: WorkerHealthState, queue: Any, logger: logging.Logger) -> WorkerHealthServer | None:
    port = _health_port()
    if port < 0:
        return None
    host = _health_host()
    server_worker_id = str(state.worker_id or _worker_id()).strip() or _worker_id()

    class _Handler(BaseHTTPRequestHandler):
        def _send_json(self, status: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _parse_body(self) -> dict[str, Any]:
            raw_length = str(self.headers.get("Content-Length") or "0").strip()
            try:
                length = max(0, int(raw_length))
            except Exception:
                length = 0
            raw_body = self.rfile.read(length) if length > 0 else b"{}"
            if not raw_body:
                return {}
            try:
                payload = json.loads(raw_body.decode("utf-8"))
            except Exception:
                return {}
            return dict(payload) if isinstance(payload, dict) else {}

        def do_GET(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            if path not in {"/healthz", "/readyz"}:
                self.send_error(404)
                return
            snapshot = state.snapshot()
            status = 200 if bool(snapshot.get("ready")) else 503
            self._send_json(status, snapshot)

        def do_POST(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            if path != "/internal/tts/drain":
                self.send_error(404)
                return
            if not _worker_drain_auth_ok(self.headers):
                self.send_error(403, "Drain authorization failed")
                return
            payload = self._parse_body()
            try:
                state.touch_loop()
                result = _process_http_drain(
                    queue,
                    worker_id=server_worker_id,
                    logger=logger,
                    payload=payload,
                    touch_loop=state.touch_loop,
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "HTTP drain request failed",
                    extra={"workerId": server_worker_id, "error": str(exc), "path": path},
                )
                self._send_json(
                    500,
                    {
                        "ok": False,
                        "workerId": server_worker_id,
                        "error": str(exc)[:240],
                    },
                )
                return
            status = 200 if bool(result.get("ok", False)) else 500
            if bool(result.get("skipped")):
                status = 200
            self._send_json(status, result)

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
            _ = format, args

    class _HTTPServer(ThreadingHTTPServer):
        allow_reuse_address = True

    server = _HTTPServer((host, port), _Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True, name=f"tts-http-{server_worker_id[:8]}")
    thread.start()
    return WorkerHealthServer(state=state, host=host, port=port, server=server, thread=thread)


def _load_queue() -> Any:
    queue = getattr(backend_app, "_TTS_JOB_QUEUE", None)
    if queue is None:
        raise RuntimeError("TTS job queue is not initialized.")
    if not bool(getattr(queue, "is_redis_enabled", lambda: False)()):
        raise RuntimeError("Redis-backed TTS queue is required for the worker deployment.")
    return queue


def run_worker(*, stop_event: Event | None = None) -> int:
    logger = logging.getLogger("voiceflow.tts_worker")
    if not logger.handlers:
        logging.basicConfig(
            level=os.getenv("LOG_LEVEL", "INFO").upper(),
            format="%(asctime)s %(levelname)s %(name)s %(message)s",
        )
    active_stop_event = stop_event or Event()
    worker_id = _worker_id()
    worker_category = _worker_category()
    os.environ.setdefault("VF_TTS_WORKER_CATEGORY", worker_category)
    health_state = WorkerHealthState(worker_id=worker_id)
    health_server: WorkerHealthServer | None = None
    idle_sleep_seconds = _idle_sleep_seconds()
    error_sleep_seconds = _error_sleep_seconds()
    queue = None
    try:
        queue = _load_queue()
        health_state.mark_queue_ready()
        health_state.touch_loop()
        recovery_interval_seconds = _recovery_interval_seconds(queue)
        recovery_limit = _recovery_limit()
        next_recovery_at = time.monotonic()
        reserve_next = getattr(queue, "reserve_next", None)
        if not callable(reserve_next):
            raise RuntimeError("Queue reserve_next API is required for worker execution.")
        health_server = _start_worker_health_server(health_state)

        logger.info(
            "TTS worker starting",
            extra={
                "workerId": worker_id,
                "workerCategory": worker_category,
                "idleSleepSeconds": idle_sleep_seconds,
                "recoveryIntervalSeconds": recovery_interval_seconds,
                "queueStorage": "redis",
                "healthPort": int(health_server.bound_port) if health_server is not None else 0,
            },
        )

        while not active_stop_event.is_set():
            try:
                now = time.monotonic()
                health_state.touch_loop()
                if now >= next_recovery_at:
                    try:
                        recovered = int(queue.recover_stalled_claims(limit=recovery_limit) or 0)
                        if recovered > 0:
                            logger.warning(
                                "Recovered stalled claims",
                                extra={"workerId": worker_id, "recovered": recovered},
                            )
                    except Exception as exc:  # noqa: BLE001
                        logger.warning(
                            "Stalled-claim recovery pass failed",
                            extra={"workerId": worker_id, "error": str(exc)},
                        )
                    finally:
                        next_recovery_at = now + recovery_interval_seconds
                    health_state.touch_loop()

                claimed = reserve_next(worker_id=worker_id)
                if not claimed:
                    active_stop_event.wait(idle_sleep_seconds)
                    health_state.touch_loop()
                    continue

                job_id = str(claimed.get("jobId") or claimed.get("job_id") or "").strip()
                if not job_id:
                    logger.warning("Skipping reserved job without jobId", extra={"workerId": worker_id})
                    active_stop_event.wait(idle_sleep_seconds)
                    health_state.touch_loop()
                    continue

                _process_claimed_job(queue, claimed=claimed, worker_id=worker_id, logger=logger, touch_loop=health_state.touch_loop)
                health_state.touch_loop()
            except KeyboardInterrupt:
                active_stop_event.set()
            except Exception as exc:  # noqa: BLE001
                logger.exception("TTS worker loop error: %s", exc)
                if active_stop_event.wait(error_sleep_seconds):
                    break
                health_state.touch_loop()
    except Exception as exc:  # noqa: BLE001
        health_state.mark_queue_init_failed(str(exc))
        logger.exception("TTS worker failed to initialize: %s", exc)
        raise
    finally:
        if health_server is not None:
            health_server.close()

    logger.info("TTS worker stopped", extra={"workerId": worker_id})
    return 0


def run_worker_http(*, stop_event: Event | None = None) -> int:
    logger = logging.getLogger("voiceflow.tts_worker")
    if not logger.handlers:
        logging.basicConfig(
            level=os.getenv("LOG_LEVEL", "INFO").upper(),
            format="%(asctime)s %(levelname)s %(name)s %(message)s",
        )
    active_stop_event = stop_event or Event()
    worker_id = _worker_id()
    worker_category = _worker_category()
    os.environ.setdefault("VF_TTS_WORKER_CATEGORY", worker_category)
    health_state = WorkerHealthState(worker_id=worker_id, require_heartbeat=False)
    health_server: WorkerHealthServer | None = None
    try:
        queue = _load_queue()
        health_state.mark_queue_ready()
        health_state.touch_loop()
        health_server = _start_worker_http_server(health_state, queue, logger)
        if health_server is None:
            raise RuntimeError("TTS worker HTTP server could not start.")
        logger.info(
            "TTS worker HTTP server starting",
            extra={
                "workerId": worker_id,
                "workerCategory": worker_category,
                "healthPort": int(health_server.bound_port),
                "queueStorage": "redis",
                "workerMode": "http",
            },
        )
        while not active_stop_event.wait(1.0):
            health_state.touch_loop()
    except Exception as exc:  # noqa: BLE001
        health_state.mark_queue_init_failed(str(exc))
        logger.exception("TTS worker HTTP server failed to initialize: %s", exc)
        raise
    finally:
        if health_server is not None:
            health_server.close()

    logger.info("TTS worker HTTP server stopped", extra={"workerId": worker_id})
    return 0


def main() -> int:
    stop_event = Event()

    def _request_stop(_signum: int, _frame: Any) -> None:
        stop_event.set()

    signal.signal(signal.SIGTERM, _request_stop)
    signal.signal(signal.SIGINT, _request_stop)
    if _worker_mode() == "http":
        return run_worker_http(stop_event=stop_event)
    return run_worker(stop_event=stop_event)


if __name__ == "__main__":
    raise SystemExit(main())
