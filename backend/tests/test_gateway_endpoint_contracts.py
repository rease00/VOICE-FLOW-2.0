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

    response = client.get("/tts/engines/status", params={"engine": "GEM"})
    assert response.status_code == 200
    payload = response.json()
    engine = payload["engines"]["GEM"]
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
