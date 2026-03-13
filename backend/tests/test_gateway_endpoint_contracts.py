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


@pytest.fixture(autouse=True)
def _reset_podcast_standard_jobs() -> None:
    with backend_app.PODCAST_STANDARD_JOB_LOCK:
        backend_app.PODCAST_STANDARD_JOBS.clear()
    yield
    with backend_app.PODCAST_STANDARD_JOB_LOCK:
        backend_app.PODCAST_STANDARD_JOBS.clear()


def test_tts_engines_status_contract(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "_probe_runtime_health", lambda _url, timeout_sec=3.0: (True, "online"))
    monkeypatch.setattr(backend_app, "_probe_runtime_capabilities", lambda _engine, timeout_sec=3.0: {"ready": True})

    response = client.get("/tts/engines/status", params={"engine": "GEM"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["engines"]["GEM"]["state"] == "online"
    assert "runtimeUrl" in payload["engines"]["GEM"]


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

    first = client.get("/tts/engines/status", params={"engine": "GEM"})
    second = client.get("/tts/engines/status", params={"engine": "GEM"})
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

    first = client.get("/tts/engines/status", params={"engine": "GEM"})
    assert first.status_code == 200
    time.sleep(0.03)
    second = client.get("/tts/engines/status", params={"engine": "GEM"})
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

    status_response = client.get("/tts/engines/status", params={"engine": "GEM"})
    caps_response = client.get("/tts/engines/capabilities", params={"engine": "GEM"})
    assert status_response.status_code == 200
    assert caps_response.status_code == 200
    assert calls["count"] == 1
    assert caps_response.json()["engines"]["GEM"]["ready"] is True


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
        payload = backend_app._engine_status_entry("GEM")
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
        ("GET", "/system/version"),
        ("GET", "/tts/engines/status"),
        ("GET", "/tts/engines/capabilities"),
        ("POST", "/tts/engines/switch"),
        ("GET", "/tts/engines/voices"),
        ("GET", "/tts/voice-mapping/catalog"),
        ("GET", "/runtime/logs/tail"),
        ("POST", "/tts/jobs"),
        ("GET", "/tts/jobs/{job_id}"),
        ("GET", "/tts/jobs/{job_id}/audio"),
        ("GET", "/tts/jobs/{job_id}/chunks/{chunk_index}"),
        ("POST", "/podcast/live/jobs"),
        ("GET", "/podcast/live/jobs/{job_id}"),
        ("GET", "/podcast/live/jobs/{job_id}/audio"),
        ("GET", "/podcast/live/jobs/{job_id}/chunks/{chunk_index}"),
        ("GET", "/podcast/live/jobs/{job_id}/artifacts/{artifact_kind}"),
        ("DELETE", "/podcast/live/jobs/{job_id}"),
        ("POST", "/podcast/standard/jobs"),
        ("GET", "/podcast/standard/jobs/{job_id}"),
        ("GET", "/podcast/standard/jobs/{job_id}/audio"),
        ("GET", "/podcast/standard/jobs/{job_id}/chunks/{chunk_index}"),
        ("GET", "/podcast/standard/jobs/{job_id}/artifacts/{artifact_kind}"),
        ("DELETE", "/podcast/standard/jobs/{job_id}"),
        ("DELETE", "/tts/jobs/{job_id}"),
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


def test_podcast_live_job_create_alias_builds_live_native_request(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _fake_submit(payload, request, *, sync_wait_ms: int):
        captured["payload"] = payload
        captured["wait_ms"] = sync_wait_ms
        return backend_app.JSONResponse({"ok": True, "accepted": True, "jobId": "podcast_live_job"})

    monkeypatch.setattr(backend_app, "_submit_tts_job", _fake_submit)

    response = client.post(
        "/podcast/live/jobs",
        json={
            "topic": "Should AI podcasts sound live?",
            "durationSec": 180,
            "speakerCount": 2,
            "language": "hi",
            "seedScript": "HOST (Curious): Namaste, aaj ka topic AI podcast pacing hai.",
            "directorModel": "gemini-3.1-flash-lite-preview",
            "cast": [
                {"id": "host", "name": "HOST", "role": "anchor", "voice": "Puck", "persona": "Lead the discussion."},
                {"id": "guest", "name": "GUEST", "role": "skeptic", "voice": "Kore", "persona": "Pressure test claims."},
            ],
            "pacingStyle": "fast-paced debate",
        },
        headers={"x-dev-uid": "podcast_user"},
    )

    assert response.status_code == 200
    payload = captured["payload"]
    assert isinstance(payload, backend_app.TtsSynthesizeRequest)
    assert payload.engine == "GEM"
    assert payload.mode == "live_native"
    assert payload.text == "Should AI podcasts sound live?"
    assert payload.liveNative is not None
    assert payload.liveNative.topic == "Should AI podcasts sound live?"
    assert payload.liveNative.speakerCount == 2
    assert payload.liveNative.durationSec == 180
    assert payload.liveNative.language == "hi"
    assert payload.liveNative.seedScript == "HOST (Curious): Namaste, aaj ka topic AI podcast pacing hai."
    assert payload.liveNative.directorModel == "gemini-3.1-flash-lite-preview"
    assert payload.language == "hi"
    assert payload.liveNative.nativeAudioModel == "gemini-2.5-flash-native-audio-preview-12-2025"
    assert captured["wait_ms"] == 0


def test_podcast_live_job_create_rejects_duration_above_30_minutes() -> None:
    response = client.post(
        "/podcast/live/jobs",
        json={
            "topic": "Too long",
            "durationSec": 1801,
            "speakerCount": 2,
            "cast": [
                {"id": "host", "name": "HOST", "role": "anchor", "voice": "Puck", "persona": "Lead."},
                {"id": "guest", "name": "GUEST", "role": "skeptic", "voice": "Kore", "persona": "Challenge."},
            ],
        },
        headers={"x-dev-uid": "podcast_user"},
    )

    assert response.status_code == 400
    assert "1800" in str(response.json()["detail"])


def test_podcast_standard_job_create_returns_queued_job(monkeypatch) -> None:
    started: dict[str, object] = {}

    class _FakeThread:
        def __init__(self, *, target=None, args=(), kwargs=None, name=None, daemon=None):
            started["target"] = target
            started["args"] = args
            started["kwargs"] = kwargs or {}
            started["name"] = name
            started["daemon"] = daemon

        def start(self):
            started["started"] = True

    monkeypatch.setattr(backend_app, "_require_user_id_ready", lambda request, uid: {"userId": uid})
    monkeypatch.setattr(backend_app.threading, "Thread", _FakeThread)

    response = client.post(
        "/podcast/standard/jobs",
        json={
            "topic": "How should AI podcasts keep continuity?",
            "durationSec": 3600,
            "speakerCount": 4,
            "cast": [
                {"id": "host", "name": "HOST", "role": "anchor", "voice": "Puck", "persona": "Lead the show."},
                {"id": "cohost", "name": "COHOST", "role": "witty", "voice": "Aoede", "persona": "Keep it lively."},
                {"id": "expert", "name": "EXPERT", "role": "authority", "voice": "Charon", "persona": "Explain clearly."},
                {"id": "guest", "name": "GUEST", "role": "skeptic", "voice": "Kore", "persona": "Pressure test ideas."},
            ],
            "pacingStyle": "conversational deep dive",
        },
        headers={"x-dev-uid": "podcast_user"},
    )

    assert response.status_code == 202
    payload = response.json()
    assert payload["ok"] is True
    assert payload["accepted"] is True
    assert payload["mode"] == "podcast_standard"
    assert payload["podcastMode"] == "standard"
    assert payload["engine"] == backend_app._normalize_podcast_standard_engine("")
    assert payload["status"] == "queued"
    assert payload["liveOrchestration"]["speakerCount"] == 4
    assert started["started"] is True
    assert started["target"] == backend_app._process_podcast_standard_job


def test_podcast_standard_job_create_reuses_same_owner_request_id(monkeypatch) -> None:
    started = {"count": 0}

    class _FakeThread:
        def __init__(self, *, target=None, args=(), kwargs=None, name=None, daemon=None):
            self._target = target
            self._args = args
            self._kwargs = kwargs or {}
            self._name = name
            self._daemon = daemon

        def start(self):
            started["count"] += 1

    monkeypatch.setattr(backend_app, "_require_user_id_ready", lambda request, uid: {"userId": uid})
    monkeypatch.setattr(backend_app.threading, "Thread", _FakeThread)
    with backend_app.PODCAST_STANDARD_JOB_LOCK:
        backend_app.PODCAST_STANDARD_JOBS.clear()

    request_id = f"podcast_standard_reuse_req_{uuid.uuid4().hex}"
    first = client.post(
        "/podcast/standard/jobs",
        json={
            "request_id": request_id,
            "topic": "First standard topic",
            "durationSec": 1200,
            "speakerCount": 3,
            "language": "en",
            "cast": [
                {"id": "host", "name": "HOST", "role": "anchor", "voice": "Puck", "persona": "Lead the show."},
                {"id": "expert", "name": "EXPERT", "role": "authority", "voice": "Charon", "persona": "Explain clearly."},
                {"id": "guest", "name": "GUEST", "role": "skeptic", "voice": "Kore", "persona": "Pressure test ideas."},
            ],
            "pacingStyle": "conversational deep dive",
        },
        headers={"x-dev-uid": "podcast_user_owner"},
    )
    second = client.post(
        "/podcast/standard/jobs",
        json={
            "request_id": request_id,
            "topic": "Second topic should not overwrite",
            "durationSec": 600,
            "speakerCount": 2,
            "language": "hi",
            "cast": [
                {"id": "host", "name": "HOST", "role": "anchor", "voice": "Puck", "persona": "Lead."},
                {"id": "guest", "name": "GUEST", "role": "skeptic", "voice": "Kore", "persona": "Challenge."},
            ],
            "pacingStyle": "fast-paced debate",
        },
        headers={"x-dev-uid": "podcast_user_owner"},
    )

    assert first.status_code == 202
    assert second.status_code == 200
    second_payload = second.json()
    assert second_payload["accepted"] is False
    assert second_payload["reused"] is True
    assert second_payload["jobId"] == request_id
    assert started["count"] == 1
    stored = backend_app._podcast_standard_job_get(request_id) or {}
    assert str(stored.get("uid") or "") == "podcast_user_owner"
    assert str(stored.get("text") or "") == "First standard topic"


def test_podcast_standard_job_create_rejects_cross_user_request_id_collision(monkeypatch) -> None:
    started = {"count": 0}

    class _FakeThread:
        def __init__(self, *, target=None, args=(), kwargs=None, name=None, daemon=None):
            self._target = target
            self._args = args
            self._kwargs = kwargs or {}
            self._name = name
            self._daemon = daemon

        def start(self):
            started["count"] += 1

    monkeypatch.setattr(backend_app, "_require_user_id_ready", lambda request, uid: {"userId": uid})
    monkeypatch.setattr(backend_app.threading, "Thread", _FakeThread)
    with backend_app.PODCAST_STANDARD_JOB_LOCK:
        backend_app.PODCAST_STANDARD_JOBS.clear()

    request_id = f"podcast_standard_owner_conflict_req_{uuid.uuid4().hex}"
    first = client.post(
        "/podcast/standard/jobs",
        json={
            "request_id": request_id,
            "topic": "Owner A topic",
            "durationSec": 900,
            "speakerCount": 2,
            "cast": [
                {"id": "host", "name": "HOST", "role": "anchor", "voice": "Puck", "persona": "Lead."},
                {"id": "guest", "name": "GUEST", "role": "skeptic", "voice": "Kore", "persona": "Challenge."},
            ],
            "pacingStyle": "conversational",
        },
        headers={"x-dev-uid": "podcast_user_a"},
    )
    second = client.post(
        "/podcast/standard/jobs",
        json={
            "request_id": request_id,
            "topic": "Owner B takeover attempt",
            "durationSec": 900,
            "speakerCount": 2,
            "cast": [
                {"id": "host", "name": "HOST", "role": "anchor", "voice": "Puck", "persona": "Lead."},
                {"id": "guest", "name": "GUEST", "role": "skeptic", "voice": "Kore", "persona": "Challenge."},
            ],
            "pacingStyle": "conversational",
        },
        headers={"x-dev-uid": "podcast_user_b"},
    )

    assert first.status_code == 202
    assert second.status_code == 409
    detail = second.json().get("detail") or {}
    assert detail.get("errorCode") == backend_app.REQUEST_ID_CONFLICT
    assert detail.get("reason") == "request_id_owner_conflict"
    assert detail.get("jobId") == request_id
    assert started["count"] == 1
    stored = backend_app._podcast_standard_job_get(request_id) or {}
    assert str(stored.get("uid") or "") == "podcast_user_a"


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

    response = client.get("/tts/engines/status", params={"engine": "GEM"})
    assert response.status_code == 200
    payload = response.json()
    engine = payload["engines"]["GEM"]
    assert engine["state"] == "not_configured"
    assert engine["ready"] is False
    assert "key pool" in str(engine["detail"]).lower()


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


def test_tts_engines_voices_contract_gem_fallback() -> None:
    response = client.get("/tts/engines/voices", params={"engine": "GEM"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["engine"] == "GEM"
    assert isinstance(payload["voices"], list)
    assert payload["voices"]
    assert "voice_id" in payload["voices"][0]
    assert payload["voices"][0].get("access_tier") in {"free", "pro"}
    assert isinstance(payload["voices"][0].get("is_plan_restricted"), bool)


def test_tts_engines_voices_contract_kokoro_access_tiers(monkeypatch) -> None:
    class _FakeResponse:
        def __init__(self) -> None:
            self.ok = True

        def json(self):
            return {
                "voices": [
                    {"voice_id": "af_heart", "name": "Free Voice", "language": "en", "gender": "female"},
                    {"voice_id": "hf_beta", "name": "Hindi Voice", "language": "hi", "gender": "female"},
                ]
            }

    monkeypatch.setattr(backend_app, "_runtime_http_request", lambda *args, **kwargs: _FakeResponse())
    response = client.get("/tts/engines/voices", params={"engine": "KOKORO"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["engine"] == "KOKORO"
    assert isinstance(payload["voices"], list)
    assert payload["voices"]
    by_id = {str(item.get("voice_id") or ""): item for item in payload["voices"]}
    assert by_id["af_heart"]["access_tier"] == "free"
    assert by_id["af_heart"]["is_plan_restricted"] is False
    assert by_id["hf_beta"]["access_tier"] == "free"
    assert by_id["hf_beta"]["is_plan_restricted"] is False


def test_tts_engines_voices_contract_kokoro_preserves_runtime_identity(monkeypatch) -> None:
    class _FakeResponse:
        def __init__(self) -> None:
            self.ok = True

        def json(self):
            return {
                "voices": [
                    {
                        "voice_id": "af_heart",
                        "voice": "af_heart",
                        "name": "Lyra US",
                        "language": "en",
                        "accent": "American English",
                        "gender": "female",
                    }
                ]
            }

    monkeypatch.setattr(backend_app, "_runtime_http_request", lambda *args, **kwargs: _FakeResponse())
    response = client.get("/tts/engines/voices", params={"engine": "KOKORO"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    voice = payload["voices"][0]
    assert voice["voice_id"] == "af_heart"
    assert voice["name"] == "Lyra US"
    assert voice["voice"] == "af_heart"
    assert voice["accent"] == "American English"
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
        engine="GEM",
        text="A: hello\nB: hi",
        model="gemini-2.5-flash-preview-tts",
        modelCandidates=["gemini-2.5-flash-preview-tts", "gemini-2.5-flash-lite-preview-tts"],
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
        engine="GEM",
        text=payload.text,
        request_id="req_test",
        trace_id="trace_test",
        plan_key="free",
    )

    assert voice_id == "Fenrir"
    assert upstream_payload["model"] == "gemini-2.5-flash-preview-tts"
    assert upstream_payload["modelCandidates"] == [
        "gemini-2.5-flash-preview-tts",
        "gemini-2.5-flash-lite-preview-tts",
    ]
    assert upstream_payload["multi_speaker_mode"] == "studio_pair_groups"
    assert upstream_payload["speaker_voices"] == [
        {"speaker": "A", "voiceName": "Fenrir", "voice_id": "Fenrir", "voiceId": "Fenrir"},
        {"speaker": "B", "voiceName": "Kore", "voice_id": "Kore", "voiceId": "Kore"},
    ]
    assert upstream_payload["poolHint"] == "free"
