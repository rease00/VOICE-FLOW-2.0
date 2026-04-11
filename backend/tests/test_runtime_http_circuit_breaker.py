from __future__ import annotations

import requests

import app as backend_app
from services.http.runtime_circuit_breaker import RuntimeCircuitBreaker, RuntimeCircuitBreakerOpenError


def _make_response(status_code: int) -> requests.Response:
    response = requests.Response()
    response.status_code = int(status_code)
    response._content = b"{}"
    response.url = "http://tts.local/synthesize"
    return response


def test_runtime_http_request_opens_breaker_after_consecutive_transport_failures(monkeypatch) -> None:
    class _FakeSession:
        def __init__(self) -> None:
            self.calls = 0

        def request(self, *, method: str, url: str, **kwargs):
            _ = method, url, kwargs
            self.calls += 1
            raise requests.exceptions.ConnectionError("runtime offline")

    fake_session = _FakeSession()
    breaker = RuntimeCircuitBreaker(failure_threshold=2, recovery_timeout_sec=60)
    monkeypatch.setattr(backend_app, "VF_TTS_RUNTIME_BREAKER_ENABLED", True)
    monkeypatch.setattr(backend_app, "_runtime_http_session", lambda: fake_session)
    monkeypatch.setattr(backend_app, "_TTS_RUNTIME_CIRCUIT_BREAKER", breaker)

    for _ in range(2):
        try:
            backend_app._runtime_http_request("POST", "http://tts.local/synthesize", json={"text": "hello"})
        except requests.exceptions.ConnectionError:
            pass
        else:
            raise AssertionError("expected runtime transport failure")

    try:
        backend_app._runtime_http_request("POST", "http://tts.local/synthesize", json={"text": "hello"})
    except RuntimeCircuitBreakerOpenError:
        pass
    else:
        raise AssertionError("expected circuit breaker to short-circuit the request")

    assert fake_session.calls == 2
    snapshot = breaker.snapshot(key="http://tts.local")
    assert snapshot["http://tts.local"]["state"] == "open"
    assert snapshot["http://tts.local"]["consecutiveFailures"] == 2


def test_runtime_http_request_recovers_after_half_open_success(monkeypatch) -> None:
    current_time = [100.0]

    class _FakeSession:
        def __init__(self) -> None:
            self.calls = 0

        def request(self, *, method: str, url: str, **kwargs):
            _ = method, url, kwargs
            self.calls += 1
            if self.calls == 1:
                return _make_response(503)
            return _make_response(200)

    fake_session = _FakeSession()
    breaker = RuntimeCircuitBreaker(
        failure_threshold=1,
        recovery_timeout_sec=10,
        time_fn=lambda: current_time[0],
    )
    monkeypatch.setattr(backend_app, "VF_TTS_RUNTIME_BREAKER_ENABLED", True)
    monkeypatch.setattr(backend_app, "_runtime_http_session", lambda: fake_session)
    monkeypatch.setattr(backend_app, "_TTS_RUNTIME_CIRCUIT_BREAKER", breaker)

    first = backend_app._runtime_http_request("POST", "http://tts.local/synthesize", json={"text": "hello"})
    assert first.status_code == 503

    try:
        backend_app._runtime_http_request("POST", "http://tts.local/synthesize", json={"text": "hello"})
    except RuntimeCircuitBreakerOpenError:
        pass
    else:
        raise AssertionError("expected open breaker before recovery window elapsed")

    current_time[0] += 11.0
    recovered = backend_app._runtime_http_request("POST", "http://tts.local/synthesize", json={"text": "hello"})
    assert recovered.status_code == 200
    assert fake_session.calls == 2
    snapshot = breaker.snapshot(key="http://tts.local")
    assert snapshot["http://tts.local"]["state"] == "closed"
    assert snapshot["http://tts.local"]["consecutiveFailures"] == 0


def test_tts_queue_metrics_snapshot_exposes_runtime_breaker_state(monkeypatch) -> None:
    breaker = RuntimeCircuitBreaker(failure_threshold=2, recovery_timeout_sec=45)
    breaker.record_failure(key="http://tts.local", status_code=503, reason="status:503")

    monkeypatch.setattr(backend_app, "VF_TTS_RUNTIME_BREAKER_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_TTS_RUNTIME_BREAKER_FAILURE_THRESHOLD", 2)
    monkeypatch.setattr(backend_app, "VF_TTS_RUNTIME_BREAKER_RECOVERY_SEC", 45)
    monkeypatch.setattr(backend_app, "_TTS_RUNTIME_CIRCUIT_BREAKER", breaker)

    payload = backend_app._tts_queue_metrics_snapshot()

    runtime_breaker = payload["runtimeBreaker"]
    assert runtime_breaker["enabled"] is True
    assert runtime_breaker["failureThreshold"] == 2
    assert runtime_breaker["recoveryTimeoutSec"] == 45
    assert runtime_breaker["states"]["closed"] == 1
    assert runtime_breaker["endpoints"]["http://tts.local"]["lastFailureStatus"] == 503