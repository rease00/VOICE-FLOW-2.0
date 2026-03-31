from __future__ import annotations

import pytest
import threading
import time
import uuid
from fastapi.testclient import TestClient

import app as backend_app


client = TestClient(backend_app.app)


@pytest.fixture(autouse=True)
def _disable_auth_enforcement(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)


@pytest.fixture(autouse=True)
def _reset_runtime_status_cache() -> None:
    backend_app._invalidate_tts_status_cache()
    yield
    backend_app._invalidate_tts_status_cache()

def test_tts_engines_status_contract(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "_probe_runtime_health", lambda _url, timeout_sec=3.0: (True, "online"))
    monkeypatch.setattr(backend_app, "_probe_runtime_capabilities", lambda _engine, timeout_sec=3.0: {"ready": True})

    response = client.get("/tts/engines/status", params={"engine": "PRIME"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["engines"]["PRIME"]["state"] == "online"
    assert "runtimeUrl" in payload["engines"]["PRIME"]


@pytest.mark.parametrize("legacy_engine", ["KOKORO", "BASIC", "NEURAL2", "GEM", "GEM1", "GEM PRO"])
def test_tts_engines_status_rejects_legacy_engine_tokens(legacy_engine: str) -> None:
    response = client.get("/tts/engines/status", params={"engine": legacy_engine})
    assert response.status_code == 400
    assert "DUNO, VECTOR, or PRIME" in str(response.json().get("detail") or response.text)


def test_tts_engines_status_all_uses_canonical_keys(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "_probe_runtime_health", lambda _url, timeout_sec=3.0: (True, "online"))
    monkeypatch.setattr(backend_app, "_probe_runtime_capabilities", lambda _engine, timeout_sec=3.0: {"ready": True})

    response = client.get("/tts/engines/status", params={"engine": "all"})
    assert response.status_code == 200
    payload = response.json()
    assert set(payload["engines"].keys()) == {"DUNO", "VECTOR", "PRIME"}


def test_tts_engines_status_uses_cache_within_ttl(monkeypatch) -> None:
    calls = {"count": 0}

    def _fake_uncached(engine: str) -> dict[str, object]:
        calls["count"] += 1
        return {
            "engine": engine,
            "runtimeUrl": "http://127.0.0.1:7810",
            "healthUrl": "http://127.0.0.1:7810/health",
            "capabilitiesUrl": "http://127.0.0.1:7810/v1/capabilities",
            "ready": True,
            "state": "online",
            "detail": "Runtime online",
            "capabilities": {"ready": True},
        }

    monkeypatch.setattr(backend_app, "_engine_status_entry_uncached", _fake_uncached)
    monkeypatch.setattr(backend_app, "TTS_STATUS_CACHE_READY_TTL_MS", 60_000)
    monkeypatch.setattr(backend_app, "TTS_STATUS_CACHE_DEGRADED_TTL_MS", 5_000)

    first = client.get("/tts/engines/status", params={"engine": "PRIME"})
    second = client.get("/tts/engines/status", params={"engine": "PRIME"})
    assert first.status_code == 200
    assert second.status_code == 200
    assert calls["count"] == 1


def test_tts_engines_status_degraded_cache_refreshes_quickly(monkeypatch) -> None:
    calls = {"count": 0}

    def _fake_uncached(engine: str) -> dict[str, object]:
        calls["count"] += 1
        return {
            "engine": engine,
            "runtimeUrl": "http://127.0.0.1:7810",
            "healthUrl": "http://127.0.0.1:7810/health",
            "capabilitiesUrl": "http://127.0.0.1:7810/v1/capabilities",
            "ready": False,
            "state": "offline",
            "detail": "Runtime offline",
            "capabilities": {"ready": False},
        }

    monkeypatch.setattr(backend_app, "_engine_status_entry_uncached", _fake_uncached)
    monkeypatch.setattr(backend_app, "TTS_STATUS_CACHE_READY_TTL_MS", 60_000)
    monkeypatch.setattr(backend_app, "TTS_STATUS_CACHE_DEGRADED_TTL_MS", 10)

    first = client.get("/tts/engines/status", params={"engine": "PRIME"})
    assert first.status_code == 200
    time.sleep(0.03)
    second = client.get("/tts/engines/status", params={"engine": "PRIME"})
    assert second.status_code == 200
    assert calls["count"] == 2


def test_tts_engines_capabilities_reuses_status_cache(monkeypatch) -> None:
    calls = {"count": 0}

    def _fake_uncached(engine: str) -> dict[str, object]:
        calls["count"] += 1
        return {
            "engine": engine,
            "runtimeUrl": "http://127.0.0.1:7810",
            "healthUrl": "http://127.0.0.1:7810/health",
            "capabilitiesUrl": "http://127.0.0.1:7810/v1/capabilities",
            "ready": True,
            "state": "online",
            "detail": "Runtime online",
            "capabilities": {"ready": True, "metadata": {"source": "runtime"}},
        }

    monkeypatch.setattr(backend_app, "_engine_status_entry_uncached", _fake_uncached)
    monkeypatch.setattr(backend_app, "TTS_STATUS_CACHE_READY_TTL_MS", 60_000)
    monkeypatch.setattr(backend_app, "TTS_STATUS_CACHE_DEGRADED_TTL_MS", 5_000)

    status_response = client.get("/tts/engines/status", params={"engine": "PRIME"})
    caps_response = client.get("/tts/engines/capabilities", params={"engine": "PRIME"})
    assert status_response.status_code == 200
    assert caps_response.status_code == 200
    assert calls["count"] == 1
    assert caps_response.json()["engines"]["PRIME"]["ready"] is True


def test_tts_status_cache_coalesces_concurrent_refresh(monkeypatch) -> None:
    calls = {"count": 0}

    def _fake_uncached(engine: str) -> dict[str, object]:
        calls["count"] += 1
        time.sleep(0.08)
        return {
            "engine": engine,
            "runtimeUrl": "http://127.0.0.1:7810",
            "healthUrl": "http://127.0.0.1:7810/health",
            "capabilitiesUrl": "http://127.0.0.1:7810/v1/capabilities",
            "ready": True,
            "state": "online",
            "detail": "Runtime online",
            "capabilities": {"ready": True},
        }

    monkeypatch.setattr(backend_app, "_engine_status_entry_uncached", _fake_uncached)
    monkeypatch.setattr(backend_app, "TTS_STATUS_CACHE_READY_TTL_MS", 60_000)
    monkeypatch.setattr(backend_app, "TTS_STATUS_CACHE_DEGRADED_TTL_MS", 5_000)

    results: list[str] = []

    def _worker() -> None:
        payload = backend_app._engine_status_entry("PRIME")
        results.append(str(payload.get("state") or ""))

    threads = [threading.Thread(target=_worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=2.0)

    assert len(results) == 4
    assert calls["count"] == 1
    assert all(state == "online" for state in results)


def test_frontend_gateway_routes_are_registered() -> None:
    expected = {
        ("GET", "/health"),
        ("GET", "/routing/regions"),
        ("GET", "/system/version"),
        ("GET", "/tts/engines/status"),
        ("GET", "/tts/engines/capabilities"),
        ("POST", "/tts/engines/switch"),
        ("GET", "/tts/engines/voices"),
        ("GET", "/tts/voice-mapping/catalog"),
        ("GET", "/runtime/logs/tail"),
        ("POST", "/tts/v2/sessions"),
        ("POST", "/tts/v2/jobs"),
        ("GET", "/tts/v2/jobs/{job_id}"),
        ("POST", "/tts/v2/jobs/{job_id}/cancel"),
        ("GET", "/tts/v2/jobs/{job_id}/chunks/{chunk_index}/audio"),
        ("GET", "/tts/v2/jobs/{job_id}/result/audio"),
    }

    registered: set[tuple[str, str]] = set()
    for route in backend_app.app.routes:
        methods = set(getattr(route, "methods", set()) or set())
        path = str(getattr(route, "path", "") or "")
        if not path:
            continue
        for method in methods:
            token = str(method or "").upper()
            if token in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
                registered.add((token, path))

    missing = sorted(expected - registered)
    assert not missing, f"Missing frontend gateway route bindings: {missing}"


def test_routing_regions_snapshot_returns_candidate_list(monkeypatch) -> None:
    monkeypatch.setenv("VF_PUBLIC_API_REGIONS", "asia-southeast1,us-central1,europe-west1")
    monkeypatch.setenv("VF_PUBLIC_API_REGION", "asia-southeast1")
    monkeypatch.setattr(backend_app, "_media_health_snapshot", lambda: {"ok": True, "ready": True, "generatedAtMs": 123})
    monkeypatch.setattr(
        backend_app,
        "_tts_queue_metrics_snapshot",
        lambda: {"queue": {"total": 3, "byLane": {"free": 3}, "storage": "redis"}, "telemetry": {"oldestQueuedAgeMs": 42}},
    )

    response = client.get(
        "/routing/regions",
        headers={
            "host": "voiceflow.example",
            "x-forwarded-host": "voiceflow.example",
            "x-forwarded-proto": "https",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["selectedRegion"] == "asia-southeast1"
    assert payload["selectedBaseUrl"] == "https://voiceflow.example"
    assert payload["queueDepth"] == 3
    assert payload["oldestQueuedAgeMs"] == 42
    assert len(payload["candidates"]) == 3
    assert payload["candidates"][0]["selected"] is True
    assert {candidate["region"] for candidate in payload["candidates"]} == {
        "asia-southeast1",
        "us-central1",
        "europe-west1",
    }


def test_routing_regions_is_public_when_auth_enforcement_is_on(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "_media_health_snapshot", lambda: {"ok": True, "ready": True, "generatedAtMs": 123})
    monkeypatch.setattr(
        backend_app,
        "_tts_queue_metrics_snapshot",
        lambda: {"queue": {"total": 0, "byLane": {}, "storage": "unknown"}, "telemetry": {"oldestQueuedAgeMs": 0}},
    )

    response = client.get(
        "/routing/regions",
        headers={
            "host": "voiceflow.example",
            "x-forwarded-host": "voiceflow.example",
            "x-forwarded-proto": "https",
        },
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_legacy_tts_routes_return_410() -> None:
    routes = [
        ("POST", "/tts/synthesize"),
        ("POST", "/tts/jobs"),
        ("GET", "/tts/jobs/job_legacy"),
        ("GET", "/tts/jobs/job_legacy/audio"),
        ("GET", "/tts/jobs/job_legacy/chunks/0"),
        ("DELETE", "/tts/jobs/job_legacy"),
    ]
    for method, path in routes:
        response = client.request(method, path, headers={"x-dev-uid": "legacy_tts"})
        assert response.status_code == 410


@pytest.mark.parametrize("engine", ["GEMINI", "NEURAL2", "DUNO_RUNTIME", "KOKORO"])
def test_tts_v2_job_create_rejects_non_canonical_engines(monkeypatch, engine: str) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)

    session_response = client.post("/tts/v2/sessions", headers={"x-dev-uid": "gateway_engine_guard"})
    assert session_response.status_code == 201
    session_key = str(session_response.json().get("sessionKey") or "").strip()
    assert session_key

    monkeypatch.setattr(
        backend_app._TTS_V2_ENGINE,
        "create_job",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("create_job should not be called for invalid engines")),
    )

    request_id = f"gateway_{uuid.uuid4().hex}"
    response = client.post(
        "/tts/v2/jobs",
        headers={
            "x-dev-uid": "gateway_engine_guard",
            "x-vf-tts-session-key": session_key,
            "Idempotency-Key": request_id,
        },
        json={
            "request_id": request_id,
            "mode": "single_speaker",
            "engine": engine,
            "text": "hello",
        },
    )
    assert response.status_code == 400
    assert "Invalid engine. Use DUNO, VECTOR, or PRIME." in str(response.json().get("detail") or response.text)


def test_removed_local_duno_model_routes_return_404() -> None:
    routes = [
        "/models/duno/status",
        "/models/onnx-community/Duno-82M-v1.0-ONNX/config.json",
    ]
    for path in routes:
        response = client.get(path, headers={"x-dev-uid": "route_check_user"})
        assert response.status_code == 404


def test_phase2_startup_does_not_start_legacy_tts_workers(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_SERVICE_IS_API", False)
    monkeypatch.setattr(backend_app, "VF_SERVICE_IS_WORKER", True)
    monkeypatch.setattr(backend_app, "_reader_session_load_from_disk", lambda: None)
    monkeypatch.setattr(backend_app, "_reader_resume_remote_comic_hydration_jobs", lambda: None)
    monkeypatch.setattr(backend_app, "_ensure_scheduler_started", lambda: None)
    monkeypatch.setattr(
        backend_app,
        "_ensure_tts_workers_started",
        lambda: (_ for _ in ()).throw(AssertionError("legacy worker bootstrap should be disabled in cutover")),
    )

    started = {"count": 0}

    class _DummyThread:
        def __init__(self, *args, **kwargs):
            _ = args, kwargs

        def start(self):
            started["count"] += 1

    monkeypatch.setattr(backend_app.threading, "Thread", _DummyThread)
    backend_app._phase2_startup()
    assert started["count"] == 1


def test_removed_podcast_and_lab_routes_return_404() -> None:
    removed_routes = [
        "/podcast/live/jobs",
        "/podcast/standard/jobs",
        "/lab/runtime-defaults",
        "/admin/lab/runtime-defaults",
        "/lab/catalog/search",
        "/lab/separation/jobs",
        "/lab/export/jobs",
    ]
    for path in removed_routes:
        response = client.get(path, headers={"x-dev-uid": "route_check_user"})
        assert response.status_code == 404


def test_tts_engines_status_reports_not_configured_when_gemini_keys_missing(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "_probe_runtime_health", lambda _url, timeout_sec=3.0: (True, "online"))
    monkeypatch.setattr(
        backend_app,
        "_probe_runtime_capabilities",
        lambda _engine, timeout_sec=3.0: {
            "ready": True,
            "metadata": {
                "authMode": "gemini_api",
                "apiKeyConfigured": False,
            },
        },
    )

    response = client.get("/tts/engines/status", params={"engine": "PRIME"})
    assert response.status_code == 200
    payload = response.json()
    engine = payload["engines"]["PRIME"]
    assert engine["state"] == "not_configured"
    assert engine["ready"] is False
    assert "slot" in str(engine["detail"]).lower()


def test_probe_runtime_health_treats_explicit_unhealthy_payload_as_offline(monkeypatch) -> None:
    class _FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return b'{"ok": false, "error": "runtime_not_ready"}'

    monkeypatch.setattr(backend_app.urllib_request, "urlopen", lambda *_args, **_kwargs: _FakeResponse())
    online, detail = backend_app._probe_runtime_health("http://127.0.0.1:9999/health")
    assert online is False
    assert "runtime_not_ready" in str(detail)


def test_runtime_health_probe_timeout_prefers_remote_budget() -> None:
    local_timeout = backend_app._runtime_health_probe_timeout_sec("http://127.0.0.1:7820/health")
    remote_timeout = backend_app._runtime_health_probe_timeout_sec("https://duno-modal.example/health")
    assert local_timeout == backend_app.VF_TTS_STATUS_PROBE_TIMEOUT_LOCAL_SEC
    assert remote_timeout == backend_app.VF_TTS_STATUS_PROBE_TIMEOUT_REMOTE_SEC
    assert remote_timeout >= local_timeout


def test_probe_runtime_health_forwards_duno_runtime_token(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class _FakeResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return b'{"ok": true}'

    def _fake_urlopen(request, timeout=0):
        captured["url"] = request.full_url
        captured["authorization"] = request.headers.get("Authorization")
        captured["timeout"] = timeout
        return _FakeResponse()

    monkeypatch.setattr(backend_app, "DUNO_RUNTIME_URL", "https://duno-modal.example")
    monkeypatch.setattr(backend_app, "DUNO_RUNTIME_TOKEN", "secret-token")
    monkeypatch.setattr(backend_app.urllib_request, "urlopen", _fake_urlopen)

    online, detail = backend_app._probe_runtime_health("https://duno-modal.example/health", timeout_sec=4.0)

    assert online is True
    assert detail == "Runtime online"
    assert captured["url"] == "https://duno-modal.example/health"
    assert captured["authorization"] == "Bearer secret-token"
    assert captured["timeout"] == 4.0


def test_fetch_runtime_json_forwards_duno_runtime_token(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class _FakeResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return b'{"ready": true, "engine": "DUNO"}'

    def _fake_urlopen(request, timeout=0):
        captured["url"] = request.full_url
        captured["authorization"] = request.headers.get("Authorization")
        captured["timeout"] = timeout
        return _FakeResponse()

    monkeypatch.setattr(backend_app, "DUNO_RUNTIME_URL", "https://duno-modal.example")
    monkeypatch.setattr(backend_app, "DUNO_RUNTIME_TOKEN", "Bearer already-prefixed")
    monkeypatch.setattr(backend_app.urllib_request, "urlopen", _fake_urlopen)

    ok, payload, detail = backend_app._fetch_runtime_json(
        "https://duno-modal.example/v1/capabilities?engine=DUNO",
        timeout_sec=5.0,
    )

    assert ok is True
    assert detail == "ok"
    assert payload == {"ready": True, "engine": "DUNO"}
    assert captured["authorization"] == "Bearer already-prefixed"
    assert captured["timeout"] == 5.0


def test_duno_runtime_voice_catalog_forwards_modal_token(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class _FakeResponse:
        ok = True

        def json(self):
            return {
                "voices": [
                    {
                        "voice_id": "di_voice_123",
                        "voice": "di_voice_123",
                        "name": "Narrator Clone",
                        "language": "en",
                        "gender": "female",
                    }
                ]
            }

    def _fake_runtime_request(method: str, url: str, **kwargs):
        captured["method"] = method
        captured["url"] = url
        captured["headers"] = kwargs.get("headers")
        return _FakeResponse()

    monkeypatch.setattr(backend_app, "DUNO_RUNTIME_URL", "https://api.deepinfra.com/v1/inference/ResembleAI/chatterbox-turbo")
    monkeypatch.setattr(backend_app, "DUNO_RUNTIME_TOKEN", "voice-token")
    monkeypatch.setattr(backend_app, "_runtime_http_request", _fake_runtime_request)

    voices = backend_app._duno_runtime_voice_catalog()

    assert voices
    by_id = {str(item.get("voice_id") or ""): item for item in voices}
    assert captured["method"] == "GET"
    assert captured["url"] == "https://api.deepinfra.com/v1/voices"
    assert captured["headers"] == {
        "Accept": "application/json",
        "ngrok-skip-browser-warning": "true",
        "Authorization": "Bearer voice-token",
    }
    assert by_id["deepinfra_default"]["access_tier"] == "free"
    assert by_id["deepinfra_default"]["is_plan_restricted"] is False
    assert by_id["di_voice_123"]["access_tier"] == "pro"
    assert by_id["di_voice_123"]["is_plan_restricted"] is True
    assert by_id["di_voice_123"]["name"] == "Narrator Clone"


def test_duno_modal_client_synthesize_forwards_modal_token(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class _FakeResponse:
        ok = True
        content = b"RIFF"
        headers = {"content-type": "audio/wav"}
        text = ""

    def _fake_request(method: str, url: str, **kwargs):
        captured["method"] = method
        captured["url"] = url
        captured["json"] = kwargs.get("json")
        captured["timeout"] = kwargs.get("timeout")
        captured["authorization"] = client._session.headers.get("authorization")
        return _FakeResponse()

    monkeypatch.setattr(backend_app, "DUNO_RUNTIME_URL", "https://api.deepinfra.com/v1/inference/ResembleAI/chatterbox-turbo")
    monkeypatch.setattr(backend_app, "DUNO_RUNTIME_TOKEN", "synth-token")
    client = backend_app.DunoModalClient(timeout_sec=12.0)
    monkeypatch.setattr(client._session, "request", _fake_request)

    audio_bytes, meta = client.synthesize(
        text="Hello modal world.",
        voice_id="di_voice_123",
        language="en",
        trace_id="trace-123",
    )

    assert audio_bytes == b"RIFF"
    assert meta["provider"] == "deepinfra"
    assert captured["method"] == "POST"
    assert captured["url"] == "https://api.deepinfra.com/v1/inference/ResembleAI/chatterbox-turbo"
    assert captured["authorization"] == "Bearer synth-token"
    assert captured["timeout"] == 12.0
    assert captured["json"]["voice_id"] == "di_voice_123"


def test_tts_engines_voices_contract_gem_fallback() -> None:
    response = client.get("/tts/engines/voices", params={"engine": "PRIME"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["engine"] == "PRIME"
    assert isinstance(payload["voices"], list)
    assert payload["voices"]
    assert "voice_id" in payload["voices"][0]
    assert payload["voices"][0].get("access_tier") in {"free", "pro"}
    assert isinstance(payload["voices"][0].get("is_plan_restricted"), bool)

    by_id = {str(item.get("voice_id") or ""): item for item in payload["voices"]}
    fenrir = by_id["v1"]
    assert fenrir["displayName"] == "Arjun India Male"
    assert fenrir["name"] == "Arjun India Male"
    assert fenrir["voice"] == "Fenrir"
    assert fenrir["mapped_name"] == "Arjun India Male"


def test_tts_engines_voices_contract_duno_access_tiers(monkeypatch) -> None:
    class _FakeResponse:
        def __init__(self) -> None:
            self.ok = True

        def json(self):
            return {
                "voices": [
                    {"voice_id": "di_voice_free", "name": "Free Clone", "language": "en", "gender": "female"},
                    {"voice_id": "di_voice_paid", "name": "Paid Clone", "language": "hi", "gender": "female"},
                ]
            }

    monkeypatch.setattr(backend_app, "_runtime_http_request", lambda *args, **kwargs: _FakeResponse())
    response = client.get("/tts/engines/voices", params={"engine": "DUNO"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["engine"] == "DUNO"
    assert isinstance(payload["voices"], list)
    assert payload["voices"]
    by_id = {str(item.get("voice_id") or ""): item for item in payload["voices"]}
    assert by_id["deepinfra_default"]["access_tier"] == "free"
    assert by_id["deepinfra_default"]["is_plan_restricted"] is False
    assert by_id["di_voice_free"]["access_tier"] == "pro"
    assert by_id["di_voice_free"]["is_plan_restricted"] is True
    assert by_id["di_voice_paid"]["access_tier"] == "pro"
    assert by_id["di_voice_paid"]["is_plan_restricted"] is True


def test_tts_engines_voices_contract_duno_preserves_runtime_identity(monkeypatch) -> None:
    class _FakeResponse:
        def __init__(self) -> None:
            self.ok = True

        def json(self):
            return {
                "voices": [
                    {
                        "voice_id": "di_voice_789",
                        "voice": "di_voice_789",
                        "name": "Narrator Clone",
                        "language": "en",
                        "accent": "American English",
                        "gender": "female",
                    }
                ]
            }

    monkeypatch.setattr(backend_app, "_runtime_http_request", lambda *args, **kwargs: _FakeResponse())
    response = client.get("/tts/engines/voices", params={"engine": "DUNO"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    by_id = {str(item.get("voice_id") or ""): item for item in payload["voices"]}
    voice = by_id["di_voice_789"]
    assert voice["voice_id"] == "di_voice_789"
    assert voice["name"] == "Narrator Clone"
    assert voice["displayName"] == "Narrator Clone"
    assert voice["voice"] == "di_voice_789"
    assert voice["accent"] == "American English"
    assert voice["access_tier"] == "pro"
    assert "mapped_name" not in voice
    assert "country" not in voice
    assert "age_group" not in voice


def test_tts_voice_mapping_catalog_contract() -> None:
    response = client.get("/tts/voice-mapping/catalog")
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert isinstance(payload.get("profiles"), list)
    assert isinstance(payload.get("engines"), dict)
    assert "fetchedAt" in payload


def test_build_tts_upstream_payload_preserves_explicit_model_fields(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "_load_gemini_api_pools", lambda: ({"planPools": {"free": "free"}}, None))
    payload = backend_app.TtsSynthesizeRequest(
        engine="PRIME",
        text="A: hello\nB: hi",
        model="gemini-2.5-flash-preview-tts",
        modelCandidates=["gemini-2.5-flash-preview-tts", "gemini-2.5-pro-tts"],
        voiceName="v1",
        speaker_voices=[
            {"speaker": "A", "voiceName": "v1"},
            {"speaker": "B", "voiceName": "Meera India Female"},
        ],
        multi_speaker_mode="studio_pair_groups",
        multi_speaker_line_map=[
            {"lineIndex": 0, "speaker": "A", "text": "hello"},
            {"lineIndex": 1, "speaker": "B", "text": "hi"},
        ],
    )

    upstream_payload, voice_id = backend_app._build_tts_upstream_payload(
        payload,
        engine="PRIME",
        text=payload.text,
        request_id="req_test",
        trace_id="trace_test",
        plan_key="free",
    )

    assert voice_id == "Fenrir"
    assert upstream_payload["model"] == "gemini-2.5-flash-preview-tts"
    assert upstream_payload["modelCandidates"] == [
        "gemini-2.5-flash-preview-tts",
        "gemini-2.5-pro-tts",
    ]
    assert upstream_payload["multi_speaker_mode"] == "studio_pair_groups"
    assert upstream_payload["speaker_voices"] == [
        {"speaker": "A", "voiceName": "Fenrir", "voice_id": "Fenrir", "voiceId": "Fenrir"},
        {"speaker": "B", "voiceName": "Kore", "voice_id": "Kore", "voiceId": "Kore"},
    ]
    assert upstream_payload["poolHint"] == "free"
