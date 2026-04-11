from __future__ import annotations

import pytest
import uuid
from fastapi.testclient import TestClient

import app as backend_app


client = TestClient(backend_app.app)


@pytest.fixture(autouse=True)
def _disable_auth_enforcement(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)


def test_tts_engines_status_contract(monkeypatch) -> None:
    monkeypatch.setattr(
        backend_app,
        "_probe_engine_runtime_health",
        lambda _engine, **_kwargs: (True, "Runtime online", "http://runtime.test/health"),
    )
    backend_app._TTS_ENGINE_STATUS_CACHE.clear()
    backend_app._TTS_RUNTIME_HEALTH_CACHE.clear()
    response = client.get("/tts/engines/status", params={"engine": "PRIME"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    engine_payload = payload["engines"]["PRIME"]
    assert engine_payload["state"] == "online"
    assert engine_payload["ready"] is True
    assert "runtimeUrl" in engine_payload
    assert "runtime online" in str(engine_payload["detail"]).lower()


@pytest.mark.parametrize("legacy_engine", ["NEURAL2", "GEM", "GEM1", "GEM PRO"])
def test_tts_engines_status_rejects_legacy_engine_tokens(legacy_engine: str) -> None:
    response = client.get("/tts/engines/status", params={"engine": legacy_engine})
    assert response.status_code == 400
    assert "VECTOR or PRIME" in str(response.json().get("detail") or response.text)


def test_tts_engines_status_all_uses_canonical_keys() -> None:
    response = client.get("/tts/engines/status", params={"engine": "all"})
    assert response.status_code == 200
    payload = response.json()
    assert set(payload["engines"].keys()) == {"VECTOR", "PRIME"}


def test_tts_engines_status_all_reuses_shared_health_probe(monkeypatch) -> None:
    call_counter = {"count": 0}

    def _probe(_engine: str, **_kwargs):
        call_counter["count"] += 1
        return True, "Runtime online", "http://runtime.test/health"

    monkeypatch.setattr(backend_app, "_probe_engine_runtime_health", _probe)
    monkeypatch.setattr(backend_app, "VF_TTS_STATUS_CACHE_TTL_MS", 60_000)
    backend_app._TTS_ENGINE_STATUS_CACHE.clear()
    backend_app._TTS_RUNTIME_HEALTH_CACHE.clear()

    response = client.get("/tts/engines/status", params={"engine": "all"})
    assert response.status_code == 200
    expected_probe_calls = len(
        {
            str(backend_app.TTS_ENGINE_HEALTH_URLS.get(engine) or "").strip().lower()
            for engine in {"VECTOR", "PRIME"}
            if str(backend_app.TTS_ENGINE_HEALTH_URLS.get(engine) or "").strip()
        }
    )
    assert call_counter["count"] == expected_probe_calls
    backend_app._TTS_ENGINE_STATUS_CACHE.clear()
    backend_app._TTS_RUNTIME_HEALTH_CACHE.clear()


def test_tts_engines_status_force_refresh_bypasses_cache(monkeypatch) -> None:
    call_counter = {"count": 0}

    def _probe(_engine: str, **_kwargs):
        call_counter["count"] += 1
        return True, f"Runtime online #{call_counter['count']}", "http://runtime.test/health"

    monkeypatch.setattr(backend_app, "_probe_engine_runtime_health", _probe)
    monkeypatch.setattr(
        backend_app,
        "VF_TTS_STATUS_CACHE_TTL_MS",
        60_000,
    )
    backend_app._TTS_ENGINE_STATUS_CACHE.clear()
    backend_app._TTS_RUNTIME_HEALTH_CACHE.clear()

    first = client.get("/tts/engines/status", params={"engine": "PRIME"})
    assert first.status_code == 200
    assert call_counter["count"] == 1
    assert "online #1" in str(first.json()["engines"]["PRIME"]["detail"]).lower()

    second = client.get("/tts/engines/status", params={"engine": "PRIME"})
    assert second.status_code == 200
    assert call_counter["count"] == 1
    assert "online #1" in str(second.json()["engines"]["PRIME"]["detail"]).lower()

    forced = client.get("/tts/engines/status", params={"engine": "PRIME", "force": "1"})
    assert forced.status_code == 200
    assert call_counter["count"] == 2
    assert "online #2" in str(forced.json()["engines"]["PRIME"]["detail"]).lower()

    backend_app._TTS_ENGINE_STATUS_CACHE.clear()
    backend_app._TTS_RUNTIME_HEALTH_CACHE.clear()


def test_tts_engines_capabilities_returns_static_contract() -> None:
    caps_response = client.get("/tts/engines/capabilities", params={"engine": "PRIME", "force": "1"})
    assert caps_response.status_code == 200
    payload = caps_response.json()
    prime_caps = payload["engines"]["PRIME"]
    metadata = prime_caps.get("metadata") if isinstance(prime_caps, dict) else {}
    assert prime_caps["ready"] is False
    assert metadata["source"] == "compatibility_static"
    assert metadata["statusProbeDisabled"] is True


def test_tts_engines_status_cache_returns_live_probe_metadata(monkeypatch) -> None:
    monkeypatch.setattr(
        backend_app,
        "_probe_engine_runtime_health",
        lambda _engine, **_kwargs: (False, "Runtime offline", "http://runtime.test/health"),
    )
    backend_app._TTS_ENGINE_STATUS_CACHE.clear()
    backend_app._TTS_RUNTIME_HEALTH_CACHE.clear()
    response = client.get("/tts/engines/status", params={"engine": "PRIME"})
    assert response.status_code == 200
    engine_payload = response.json()["engines"]["PRIME"]
    assert engine_payload["state"] == "offline"
    assert engine_payload["ready"] is False
    metadata = ((engine_payload.get("capabilities") or {}).get("metadata") or {})
    assert metadata.get("source") == "status_live_probe"
    assert metadata.get("statusProbeDisabled") is False
    backend_app._TTS_ENGINE_STATUS_CACHE.clear()
    backend_app._TTS_RUNTIME_HEALTH_CACHE.clear()


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


@pytest.mark.parametrize("engine", ["GEMINI", "NEURAL2"])
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
    assert "Invalid engine. Use VECTOR or PRIME." in str(response.json().get("detail") or response.text)


def test_phase2_startup_does_not_start_legacy_tts_workers(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_SERVICE_IS_API", False)
    monkeypatch.setattr(backend_app, "VF_SERVICE_IS_WORKER", True)
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
    remote_timeout = backend_app._runtime_health_probe_timeout_sec("https://remote-runtime.example/health")
    assert local_timeout == backend_app.VF_TTS_STATUS_PROBE_TIMEOUT_LOCAL_SEC
    assert remote_timeout == backend_app.VF_TTS_STATUS_PROBE_TIMEOUT_REMOTE_SEC
    assert remote_timeout >= local_timeout


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
