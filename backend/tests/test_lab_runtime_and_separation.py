from __future__ import annotations

from io import BytesIO
from pathlib import Path
import threading
import time
import wave

from fastapi.testclient import TestClient

import app as backend_app


def _wav_bytes() -> bytes:
    buffer = BytesIO()
    with wave.open(buffer, "wb") as wav_file:
      wav_file.setnchannels(1)
      wav_file.setsampwidth(2)
      wav_file.setframerate(16000)
      wav_file.writeframes(b"\x00\x00" * 1600)
    return buffer.getvalue()


def _wait_for(predicate, *, timeout: float = 3.0, interval: float = 0.05) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return
        time.sleep(interval)
    raise AssertionError("Timed out waiting for lab condition.")


def _reset_lab_state() -> None:
    backend_app._INMEMORY_LAB_RUNTIME_DEFAULTS.clear()
    backend_app._INMEMORY_LAB_CATALOG_IMPORTS.clear()
    backend_app._INMEMORY_LAB_SEPARATION_JOBS.clear()
    backend_app._INMEMORY_LAB_EXPORT_JOBS.clear()
    backend_app._LAB_EXPORT_ACTIVE_PROCESSES.clear()


def test_lab_runtime_defaults_public_and_admin_roundtrip(monkeypatch) -> None:
    _reset_lab_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)

    public_response = client.get("/lab/runtime-defaults")
    assert public_response.status_code == 200
    defaults = public_response.json()["defaults"]
    assert defaults["browserAccelerationDefault"] == "webgpu_preferred"
    assert defaults["labPerformanceMode"] == "conservative"
    assert defaults["exportStrategyDefault"] == "browser_first"

    update_response = client.put(
        "/admin/lab/runtime-defaults",
        headers={"x-dev-uid": "local_admin"},
        json={
            "browserAccelerationDefault": "cpu_only",
            "backendHardwareDefault": "cpu_only",
            "separatorBackendDefault": "gpu_preferred",
            "labPerformanceMode": "balanced",
            "exportStrategyDefault": "browser_first",
            "allowUserOverride": False,
        },
    )
    assert update_response.status_code == 200
    updated = update_response.json()["defaults"]
    assert updated["browserAccelerationDefault"] == "cpu_only"
    assert updated["backendHardwareDefault"] == "cpu_only"
    assert updated["labPerformanceMode"] == "balanced"
    assert updated["exportStrategyDefault"] == "browser_first"

    admin_readback = client.get("/admin/lab/runtime-defaults", headers={"x-dev-uid": "local_admin"})
    assert admin_readback.status_code == 200
    assert admin_readback.json()["defaults"]["browserAccelerationDefault"] == "cpu_only"


def test_lab_separation_queue_fast_fails_and_serves_artifacts(monkeypatch, tmp_path: Path) -> None:
    _reset_lab_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "LAB_SEPARATION_ROOT_DIR", tmp_path / "lab-separation")
    monkeypatch.setattr(backend_app, "LAB_SEPARATION_MAX_ACTIVE_AND_QUEUED", 2)

    release_gate = threading.Event()
    speech_path = tmp_path / "speech.wav"
    instrumental_path = tmp_path / "instrumental.wav"
    speech_path.write_bytes(_wav_bytes())
    instrumental_path.write_bytes(_wav_bytes())

    def fake_ensure_source_separation(source_path, model_name, *, device_preference=None):  # type: ignore[no-untyped-def]
        release_gate.wait(timeout=2.0)
        assert Path(source_path).exists()
        assert str(model_name or "").strip()
        return speech_path, instrumental_path, "cache_test"

    monkeypatch.setattr(backend_app, "_ensure_source_separation", fake_ensure_source_separation)

    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "lab_user"}
    first = client.post(
        "/lab/separation/jobs",
        headers=headers,
        data={"modelName": "htdemucs_ft"},
        files={"file": ("clip-1.wav", _wav_bytes(), "audio/wav")},
    )
    second = client.post(
        "/lab/separation/jobs",
        headers=headers,
        data={"modelName": "htdemucs_ft"},
        files={"file": ("clip-2.wav", _wav_bytes(), "audio/wav")},
    )
    third = client.post(
        "/lab/separation/jobs",
        headers=headers,
        data={"modelName": "htdemucs_ft"},
        files={"file": ("clip-3.wav", _wav_bytes(), "audio/wav")},
    )

    assert first.status_code == 202
    assert second.status_code == 202
    assert third.status_code == 503
    assert "queue is full" in str(third.json().get("detail") or "").lower()

    first_job_id = first.json()["job"]["id"]
    release_gate.set()
    _wait_for(
        lambda: client.get(f"/lab/separation/jobs/{first_job_id}", headers=headers).json()["job"]["status"] == "completed"
    )

    artifact = client.get(f"/lab/separation/jobs/{first_job_id}/artifacts/vocals", headers=headers)
    assert artifact.status_code == 200
    assert artifact.headers["content-type"].startswith("audio/wav")


def test_lab_export_queue_serializes_and_serves_artifacts(monkeypatch, tmp_path: Path) -> None:
    _reset_lab_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "LAB_EXPORT_ROOT_DIR", tmp_path / "lab-export")
    monkeypatch.setattr(backend_app, "LAB_EXPORT_MAX_ACTIVE_AND_QUEUED", 2)

    release_gate = threading.Event()

    def fake_run_ffmpeg(job_id: str, args: list[str]) -> None:
        release_gate.wait(timeout=2.0)
        artifact = backend_app._lab_export_artifact_path(job_id, "mp4")
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_bytes(b"mp4-data")

    monkeypatch.setattr(backend_app, "_run_ffmpeg_for_lab_export", fake_run_ffmpeg)

    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "lab_user"}
    upload_bytes = b"webm-data"

    first = client.post(
        "/lab/export/jobs",
        headers=headers,
        data={"format": "mp4", "sourceMediaType": "video/webm", "browserMode": "webgpu_active"},
        files={"file": ("capture-1.webm", upload_bytes, "video/webm")},
    )
    second = client.post(
        "/lab/export/jobs",
        headers=headers,
        data={"format": "mp4", "sourceMediaType": "video/webm", "browserMode": "webgpu_active"},
        files={"file": ("capture-2.webm", upload_bytes, "video/webm")},
    )
    third = client.post(
        "/lab/export/jobs",
        headers=headers,
        data={"format": "mp4", "sourceMediaType": "video/webm", "browserMode": "webgpu_active"},
        files={"file": ("capture-3.webm", upload_bytes, "video/webm")},
    )

    assert first.status_code == 202
    assert second.status_code == 202
    assert third.status_code == 503
    assert "queue is full" in str(third.json().get("detail") or "").lower()

    first_job_id = first.json()["job"]["id"]
    second_job_id = second.json()["job"]["id"]
    cancelled = client.delete(f"/lab/export/jobs/{second_job_id}", headers=headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["job"]["status"] == "cancelled"

    release_gate.set()
    _wait_for(lambda: client.get(f"/lab/export/jobs/{first_job_id}", headers=headers).json()["job"]["status"] == "completed")

    artifact = client.get(f"/lab/export/jobs/{first_job_id}/artifact", headers=headers)
    assert artifact.status_code == 200
    assert artifact.headers["content-type"].startswith("video/mp4")


def test_lab_catalog_search_normalizes_openverse_and_freesound(monkeypatch) -> None:
    _reset_lab_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_COMMERCIAL_MODE", False)
    monkeypatch.setattr(backend_app, "FREESOUND_API_KEY", "test-token")

    class DummyResponse:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self) -> None:
            return None

        def json(self):
            return self._payload

    def fake_requests_get(url, *args, **kwargs):  # type: ignore[no-untyped-def]
        if "api.openverse.org" in url:
            return DummyResponse(
                {
                    "results": [
                        {
                            "id": "ov_1",
                            "title": "Openverse Breeze",
                            "url": "https://cdn.example.com/openverse.mp3",
                            "thumbnail": "https://cdn.example.com/openverse.jpg",
                            "creator": "Openverse Artist",
                            "license_url": "https://creativecommons.org/licenses/by/4.0/",
                            "foreign_landing_url": "https://example.com/openverse",
                            "duration": 120000,
                            "tags": [{"name": "ambient"}],
                        }
                    ]
                }
            )
        if "freesound.org/apiv2/search/text/" in url:
            return DummyResponse(
                {
                    "results": [
                        {
                            "id": 42,
                            "name": "Wind Texture",
                            "previews": {"preview-hq-mp3": "https://cdn.example.com/freesound.mp3"},
                            "username": "Freesound User",
                            "license": "https://creativecommons.org/publicdomain/zero/1.0/",
                            "duration": 5.2,
                            "images": {"waveform_m": "https://cdn.example.com/freesound-wave.png"},
                            "tags": ["wind", "texture"],
                            "url": "https://freesound.org/s/42/",
                        }
                    ]
                }
            )
        raise AssertionError(f"Unexpected URL {url}")

    monkeypatch.setattr(backend_app.requests, "get", fake_requests_get)

    client = TestClient(backend_app.app)
    response = client.get("/lab/catalog/search", params={"kind": "audio", "q": "wind"})
    assert response.status_code == 200
    items = response.json()["result"]["items"]
    assert {item["provider"] for item in items} == {"openverse", "freesound"}
    assert items[0]["downloadUrl"].startswith("https://")


def test_lab_catalog_import_downloads_and_serves_file(monkeypatch, tmp_path: Path) -> None:
    _reset_lab_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_COMMERCIAL_MODE", False)
    monkeypatch.setattr(backend_app, "LAB_REMOTE_ASSETS_DIR", tmp_path / "lab-remote-assets")

    class DummyJsonResponse:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self) -> None:
            return None

        def json(self):
            return self._payload

    class DummyStreamResponse:
        headers = {"content-type": "audio/mpeg"}

        def raise_for_status(self) -> None:
            return None

        def iter_content(self, chunk_size=65536):
            yield b"fake-mp3-data"

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    def fake_requests_get(url, *args, **kwargs):  # type: ignore[no-untyped-def]
        if "api.openverse.org" in url:
            return DummyJsonResponse(
                {
                    "id": "ov_import_1",
                    "title": "Imported Breeze",
                    "url": "https://cdn.example.com/imported.mp3",
                    "thumbnail": "https://cdn.example.com/imported.jpg",
                    "creator": "Openverse Artist",
                    "license_url": "https://creativecommons.org/licenses/by/4.0/",
                    "foreign_landing_url": "https://example.com/imported",
                    "duration": 90000,
                    "tags": [{"name": "breeze"}],
                }
            )
        if "cdn.example.com/imported.mp3" in url:
            return DummyStreamResponse()
        raise AssertionError(f"Unexpected URL {url}")

    monkeypatch.setattr(backend_app.requests, "get", fake_requests_get)

    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "lab_user"}
    create = client.post(
        "/lab/catalog/import",
        headers=headers,
        json={
            "item": {
                "id": "ov_import_1",
                "provider": "openverse",
                "kind": "audio",
                "title": "Imported Breeze",
                "downloadUrl": "https://cdn.example.com/imported.mp3",
                "tags": ["breeze"],
            }
        },
    )
    assert create.status_code == 200
    imported = create.json()["imported"]
    assert imported["filename"].endswith(".mp3")

    content = client.get(imported["contentUrl"], headers=headers)
    assert content.status_code == 200
    assert content.content == b"fake-mp3-data"


def test_lab_catalog_strict_commercial_policy_blocks_provider_and_emits_metadata(monkeypatch) -> None:
    _reset_lab_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_COMMERCIAL_MODE", True)
    monkeypatch.setattr(backend_app, "FREESOUND_API_KEY", "test-token")
    monkeypatch.setattr(backend_app, "PIXABAY_API_KEY", "pixabay-token")

    class DummyResponse:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self) -> None:
            return None

        def json(self):
            return self._payload

    def fake_requests_get(url, *args, **kwargs):  # type: ignore[no-untyped-def]
        if "api.openverse.org" in url:
            return DummyResponse(
                {
                    "results": [
                        {
                            "id": "ov_2",
                            "title": "Commercial-safe track",
                            "url": "https://cdn.example.com/openverse-safe.mp3",
                            "thumbnail": "https://cdn.example.com/openverse-safe.jpg",
                            "creator": "Openverse Artist",
                            "license_url": "https://creativecommons.org/licenses/by/4.0/",
                            "foreign_landing_url": "https://example.com/openverse-safe",
                            "duration": 64000,
                            "tags": [{"name": "ambient"}],
                        }
                    ]
                }
            )
        raise AssertionError(f"Unexpected URL {url}")

    monkeypatch.setattr(backend_app.requests, "get", fake_requests_get)

    client = TestClient(backend_app.app)
    audio_search = client.get("/lab/catalog/search", params={"kind": "audio", "q": "ambient"})
    assert audio_search.status_code == 200
    result = audio_search.json()["result"]
    assert result["commercialPolicyVersion"]
    assert "freesound" in result["blockedProviders"]
    assert result["items"] and result["items"][0]["provider"] == "openverse"
    assert result["items"][0]["commercialUseStatus"] == "allowed"

    blocked_search = client.get("/lab/catalog/search", params={"kind": "audio", "provider": "freesound", "q": "wind"})
    assert blocked_search.status_code == 200
    blocked_result = blocked_search.json()["result"]
    assert blocked_result["items"] == []
    assert any("blocked" in warning.lower() for warning in blocked_result["warnings"])
