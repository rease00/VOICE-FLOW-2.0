from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
import time
import wave

from fastapi.testclient import TestClient

import app as backend_app
from services.reader_domain import (
    normalize_openlibrary_item,
    should_schedule_next_panel_batch,
    should_schedule_next_text_window,
)


def _wav_bytes() -> bytes:
    buffer = BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        wav_file.writeframes(b"\x00\x00" * 1600)
    return buffer.getvalue()


def _png_bytes(width: int = 640, height: int = 2400) -> bytes:
    if backend_app.Image is None:
        raise RuntimeError("Pillow is required for Reader image tests.")
    image = backend_app.Image.new("RGB", (width, height), color=(240, 235, 220))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _configure_reader_storage(monkeypatch, tmp_path: Path) -> tuple[Path, Path]:
    sessions_dir = tmp_path / "reader-sessions"
    remote_assets_dir = tmp_path / "reader-remote-assets"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    remote_assets_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(backend_app, "READER_SESSIONS_DIR", sessions_dir)
    monkeypatch.setattr(backend_app, "READER_REMOTE_ASSETS_DIR", remote_assets_dir)
    backend_app._INMEMORY_READER_SESSIONS.clear()
    backend_app._READER_HYDRATION_ACTIVE.clear()
    return sessions_dir, remote_assets_dir


def _wait_for(predicate, *, timeout: float = 3.0, interval: float = 0.05) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return
        time.sleep(interval)
    raise AssertionError("Timed out waiting for reader condition.")


def test_reader_domain_filters_and_thresholds() -> None:
    assert normalize_openlibrary_item(
        {
            "title": "Private Scan",
            "language": ["en"],
            "public_scan_b": False,
            "ebook_access": "no_ebook",
        },
        region_id="english",
    ) is None
    assert should_schedule_next_text_window(consumed_chars=500, scheduled_window_end_char=1000) is True
    assert should_schedule_next_text_window(consumed_chars=499, scheduled_window_end_char=1000) is False
    assert should_schedule_next_panel_batch(current_panel_index=5, scheduled_panel_count=10) is True
    assert should_schedule_next_panel_batch(current_panel_index=4, scheduled_panel_count=10) is False


def test_reader_library_scopes_catalog_fetches_by_surface(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    backend_app._INMEMORY_READER_CATALOG_CACHE.clear()
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_scope_user"}
    catalog_calls: list[tuple[str, str, str]] = []

    def fake_catalog_items(region_id: str, surface: str, search_query: str = "") -> list[dict[str, object]]:
        catalog_calls.append((region_id, surface, search_query))
        if surface == "books":
            return backend_app.fallback_catalog_items(region_id, content_kind="book")
        return []

    monkeypatch.setattr(backend_app, "_reader_catalog_items", fake_catalog_items)

    ack_response = client.post("/reader/legal/ack", headers=headers, json={"accepted": True})
    assert ack_response.status_code == 200

    library_response = client.get("/reader/library?surface=books&regionId=english&search=moon", headers=headers)
    assert library_response.status_code == 200
    library_payload = library_response.json()["library"]

    assert library_payload["surface"] == "books"
    assert library_payload["items"]
    assert all(item["surface"] == "books" for item in library_payload["items"])
    assert catalog_calls == [("english", "books", "moon")]


def test_reader_upload_session_progress_and_export(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_test_user"}

    wav_path = tmp_path / "reader_chunk.wav"
    wav_path.write_bytes(_wav_bytes())
    jobs: dict[str, dict[str, object]] = {}
    counter = {"value": 0}

    def fake_reader_create_tts_job(request, *, session, text, request_id, voice_id, language, multi_speaker_mode=None, line_map=None, speaker_voices=None):  # type: ignore[no-untyped-def]
        counter["value"] += 1
        job_id = f"reader_job_{counter['value']}"
        jobs[job_id] = {
            "jobId": job_id,
            "requestId": request_id,
            "uid": headers["x-dev-uid"],
            "status": "completed",
            "engine": "GEM",
            "createdAtMs": 1,
            "updatedAtMs": 1,
            "finishedAtMs": 1,
            "result": {
                "audioRef": {"path": str(wav_path)},
                "mediaType": "audio/wav",
                "headers": {},
            },
            "liveState": {
                "enabled": False,
                "playableChunks": 0,
                "playableDurationMs": 0,
                "chunkCursorNext": 0,
            },
        }
        return job_id

    class FakeQueue:
        def get(self, job_id: str) -> dict[str, object] | None:
            return jobs.get(job_id)

        def cancel(self, job_id: str) -> dict[str, object] | None:
            return jobs.get(job_id)

        def depth_snapshot(self) -> dict[str, int]:
            return {"total": 0}

    monkeypatch.setattr(backend_app, "_reader_create_tts_job", fake_reader_create_tts_job)
    monkeypatch.setattr(backend_app, "_TTS_JOB_QUEUE", FakeQueue())
    monkeypatch.setattr(
        backend_app,
        "_reader_catalog_items",
        lambda region_id, surface, search_query="": backend_app.fallback_catalog_items(region_id, content_kind="book") if surface == "books" else [],
    )

    ack_response = client.post("/reader/legal/ack", headers=headers, json={"accepted": True})
    assert ack_response.status_code == 200

    upload_response = client.post(
        "/reader/uploads",
        headers=headers,
        data={
            "title": "Reader Upload",
            "ownershipBasis": "own_work",
            "regionId": "english",
        },
        files=[("files", ("story.txt", ("Narrator: Reader testing line. " * 80).encode("utf-8"), "text/plain"))],
    )
    assert upload_response.status_code == 200
    upload_payload = upload_response.json()["upload"]
    upload_id = upload_payload["id"]
    assert upload_payload["contentKind"] == "book"
    assert upload_payload["readingModeDefault"] == "document"

    library_response = client.get("/reader/library?surface=all&regionId=english", headers=headers)
    assert library_response.status_code == 200
    library_payload = library_response.json()["library"]
    assert library_payload["counts"]["uploads"] >= 1
    assert any(item["id"] == upload_id for item in library_payload["shelves"]["recentlyImported"])

    session_response = client.post(
        "/reader/sessions",
        headers=headers,
        json={"uploadId": upload_id, "autoAdvanceProfile": "medium"},
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()["session"]
    assert session_payload["billing"]["rule"] == "1 char = 1.5 VF"
    assert session_payload["autoAdvanceProfile"] == "medium"
    assert session_payload["multiSpeakerEnabled"] is True
    assert session_payload["readiness"]["state"] in {"ready", "preparing"}
    assert len([item for item in session_payload["windows"] if item.get("jobId")]) == 1

    reused_session_response = client.post("/reader/sessions", headers=headers, json={"uploadId": upload_id})
    assert reused_session_response.status_code == 200
    assert reused_session_response.json()["session"]["id"] == session_payload["id"]

    savepoint_response = client.post(
        f"/reader/sessions/{session_payload['id']}/savepoint",
        headers=headers,
        json={"autoAdvanceProfile": "slow", "multiSpeakerEnabled": False},
    )
    assert savepoint_response.status_code == 200
    assert savepoint_response.json()["session"]["autoAdvanceProfile"] == "slow"
    assert savepoint_response.json()["session"]["multiSpeakerEnabled"] is False

    progress_response = client.post(
        f"/reader/sessions/{session_payload['id']}/progress",
        headers=headers,
        json={"consumedChars": 500},
    )
    assert progress_response.status_code == 200
    progressed_session = progress_response.json()["session"]
    assert len([item for item in progressed_session["windows"] if item.get("jobId")]) >= 2

    export_response = client.get(f"/reader/sessions/{session_payload['id']}/export", headers=headers)
    assert export_response.status_code == 200
    assert export_response.headers["content-type"].startswith("audio/wav")


def test_reader_upload_auto_detects_comic_and_reading_mode(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_comic_user"}

    jobs: dict[str, dict[str, object]] = {}

    def fake_reader_create_tts_job(request, *, session, text, request_id, voice_id, language, multi_speaker_mode=None, line_map=None, speaker_voices=None):  # type: ignore[no-untyped-def]
        job_id = f"reader_panel_job_{len(jobs) + 1}"
        jobs[job_id] = {
            "jobId": job_id,
            "requestId": request_id,
            "uid": headers["x-dev-uid"],
            "status": "completed",
            "engine": "GEM",
            "createdAtMs": 1,
            "updatedAtMs": 1,
            "finishedAtMs": 1,
            "result": {
                "audioRef": {"path": ""},
                "mediaType": "audio/wav",
                "headers": {},
            },
            "liveState": {
                "enabled": False,
                "playableChunks": 0,
                "playableDurationMs": 0,
                "chunkCursorNext": 0,
            },
        }
        return job_id

    class FakeQueue:
        def get(self, job_id: str) -> dict[str, object] | None:
            return jobs.get(job_id)

        def cancel(self, job_id: str) -> dict[str, object] | None:
            return jobs.get(job_id)

        def depth_snapshot(self) -> dict[str, int]:
            return {"total": 0}

    monkeypatch.setattr(backend_app, "_reader_create_tts_job", fake_reader_create_tts_job)
    monkeypatch.setattr(backend_app, "_TTS_JOB_QUEUE", FakeQueue())
    monkeypatch.setattr(backend_app, "_reader_catalog_items", lambda region_id, surface: [])

    ack_response = client.post("/reader/legal/ack", headers=headers, json={"accepted": True})
    assert ack_response.status_code == 200

    upload_response = client.post(
        "/reader/uploads",
        headers=headers,
        data={
            "title": "Tower Webtoon Episode 1",
            "ownershipBasis": "own_work",
            "regionId": "korean",
        },
        files=[("files", ("episode.png", _png_bytes(), "image/png"))],
    )
    assert upload_response.status_code == 200
    upload_payload = upload_response.json()["upload"]
    assert upload_payload["contentKind"] == "comic"
    assert upload_payload["readingModeDefault"] == "vertical_strip"

    session_response = client.post(
        "/reader/sessions",
        headers=headers,
        json={"uploadId": upload_payload["id"], "autoAdvanceProfile": "audio_sync"},
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()["session"]
    assert session_payload["surface"] == "uploads"
    assert session_payload["readingMode"] == "vertical_strip"
    assert session_payload["autoAdvanceProfile"] == "audio_sync"
    assert session_payload["multiSpeakerEnabled"] is True
    assert session_payload["panels"]

    savepoint_response = client.post(
        f"/reader/sessions/{session_payload['id']}/savepoint",
        headers=headers,
        json={"readingModeOverride": "rtl_paged", "autoAdvanceProfile": "fast"},
    )
    assert savepoint_response.status_code == 200
    savepoint_payload = savepoint_response.json()["session"]
    assert savepoint_payload["readingMode"] == "rtl_paged"
    assert savepoint_payload["autoAdvanceProfile"] == "fast"


def test_reader_library_search_and_live_mangadex_session(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    backend_app._INMEMORY_READER_CATALOG_CACHE.clear()
    sessions_dir, _ = _configure_reader_storage(monkeypatch, tmp_path)
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_mangadex_user"}

    sample_item = backend_app.normalize_reader_catalog_item(
        {
            "id": "mangadex_demo_title",
            "title": "Wind Breaker Demo",
            "author": "Demo Author",
            "regionId": "english",
            "contentKind": "comic",
            "provider": "mangadex",
            "license": "Read via MangaDex source terms",
            "sourceUrl": "https://mangadex.org/title/demo",
            "contentUrl": "https://mangadex.org/chapter/demo",
            "summary": "Playable manga search result.",
            "supportsReadHere": True,
            "readingModeDefault": "vertical_strip",
            "direction": "vertical-scroll",
            "collectionLabel": "MangaDex Live",
            "stats": {"pageCount": 2, "totalPanels": 2},
            "sourceMeta": {"chapterId": "chapter_demo", "chapterLabel": "Ch. 1", "pageCount": 2},
            "createdAt": "2026-03-06T00:00:00Z",
            "updatedAt": "2026-03-06T00:00:00Z",
        }
    )
    enqueued_session_ids: list[str] = []

    monkeypatch.setattr(backend_app, "_reader_fetch_openlibrary_catalog", lambda region_id, search_query="": [])
    monkeypatch.setattr(backend_app, "_reader_fetch_mediawiki_catalog", lambda region_id, search_query="": [])
    monkeypatch.setattr(backend_app, "_reader_fetch_internet_archive_catalog", lambda region_id, content_kind, search_query="": [])
    monkeypatch.setattr(backend_app, "_reader_fetch_mangadex_catalog", lambda region_id, search_query="": [sample_item] if "wind" in search_query.lower() else [])
    monkeypatch.setattr(
        backend_app,
        "_reader_catalog_comic_manifest",
        lambda item: [
            {
                "panelId": "panel_0001",
                "pageId": "page_0001",
                "index": 0,
                "direction": "vertical-scroll",
                "text": "",
                "sourceText": "",
                "displayText": "",
                "imageUrl": "https://example.com/page-1.png",
                "remoteImageUrl": "https://example.com/page-1.png",
                "translationStatus": "pending",
                "audioStatus": "idle",
                "prepStatus": "pending",
            },
            {
                "panelId": "panel_0002",
                "pageId": "page_0002",
                "index": 1,
                "direction": "vertical-scroll",
                "text": "",
                "sourceText": "",
                "displayText": "",
                "imageUrl": "https://example.com/page-2.png",
                "remoteImageUrl": "https://example.com/page-2.png",
                "translationStatus": "pending",
                "audioStatus": "idle",
                "prepStatus": "pending",
            },
        ],
    )
    monkeypatch.setattr(
        backend_app,
        "_reader_enqueue_remote_comic_hydration",
        lambda uid, session_id: enqueued_session_ids.append(str(session_id)),
    )
    monkeypatch.setattr(
        backend_app,
        "_reader_build_remote_image_page_row",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("create should not hydrate remote pages synchronously")),
    )

    ack_response = client.post("/reader/legal/ack", headers=headers, json={"accepted": True})
    assert ack_response.status_code == 200

    library_response = client.get("/reader/library?surface=all&regionId=english&search=wind", headers=headers)
    assert library_response.status_code == 200
    library_payload = library_response.json()["library"]
    assert any(item["provider"] == "mangadex" for item in library_payload["items"])
    catalog_item = next(item for item in library_payload["items"] if item["provider"] == "mangadex")
    assert catalog_item["readiness"]["state"] == "ready"

    session_response = client.post(
        "/reader/sessions",
        headers=headers,
        json={"itemId": catalog_item["id"], "autoAdvanceProfile": "audio_sync"},
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()["session"]
    assert session_payload["provider"] == "mangadex"
    assert session_payload["contentKind"] == "comic"
    assert session_payload["panels"]
    assert session_payload["readingMode"] == "vertical_strip"
    assert session_payload["readiness"]["state"] == "preparing"
    assert session_payload["prep"]["state"] == "queued"
    assert session_payload["prep"]["totalItems"] == 2
    assert session_payload["panels"][0]["text"] == ""
    assert session_payload["panels"][0]["imageUrl"] == "https://example.com/page-1.png"
    assert enqueued_session_ids == [session_payload["id"]]
    assert (sessions_dir / headers["x-dev-uid"] / f"{session_payload['id']}.json").exists()


def test_reader_remote_comic_hydration_survives_restart(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    sessions_dir, remote_assets_dir = _configure_reader_storage(monkeypatch, tmp_path)

    jobs: dict[str, str] = {}

    def fake_reader_create_tts_job(request, *, session, text, request_id, voice_id, language, multi_speaker_mode=None, line_map=None, speaker_voices=None):  # type: ignore[no-untyped-def]
        job_id = f"reader_restart_job_{len(jobs) + 1}"
        jobs[job_id] = str(text)
        return job_id

    existing_asset = remote_assets_dir / "existing-page.png"
    existing_asset.write_bytes(_png_bytes(320, 960))

    def fake_build_remote_image_page_row(image_url: str, *, fallback_text: str, page_index: int, use_fallback_text: bool = True) -> dict[str, object]:
        next_asset = remote_assets_dir / f"hydrated-{page_index + 1}.png"
        next_asset.write_bytes(_png_bytes(320 + page_index, 960))
        return {
            "text": f"Hydrated page {page_index + 1}",
            "imageUrl": backend_app._reader_remote_asset_url(str(next_asset)),
            "imagePath": str(next_asset),
            "imageWidth": 320 + page_index,
            "imageHeight": 960,
            "aspectRatio": 3.0,
            "hydrationState": "ready",
            "message": "",
        }

    monkeypatch.setattr(backend_app, "_reader_create_tts_job", fake_reader_create_tts_job)
    monkeypatch.setattr(backend_app, "_reader_build_remote_image_page_row", fake_build_remote_image_page_row)

    session_id = "reader_session_restart_case"
    uid = "reader_restart_user"
    session = {
        "id": session_id,
        "uid": uid,
        "workKey": "catalog:mangadex_demo_title",
        "sourceKind": "catalog",
        "itemId": "mangadex_demo_title",
        "uploadId": "",
        "title": "Wind Breaker Demo",
        "contentKind": "comic",
        "surface": "comics",
        "regionId": "english",
        "direction": "vertical-scroll",
        "readingMode": "vertical_strip",
        "sourceLanguage": "en",
        "targetLanguage": "en",
        "pageViewMode": "original",
        "ttsLanguageMode": "source",
        "multiSpeakerEnabled": True,
        "effectiveMultiSpeakerMode": "single",
        "translationState": "idle",
        "translationLeadRatio": 0.0,
        "voiceFallbacks": {},
        "createdAtMs": 1,
        "updatedAtMs": 1,
        "consumedChars": 0,
        "currentPanelIndex": 0,
        "totalChars": 0,
        "totalPanels": 2,
        "provider": "mangadex",
        "license": "Read via MangaDex source terms",
        "coverUrl": "",
        "summary": "Restartable session",
        "sourceUrl": "https://mangadex.org/title/demo",
        "collectionLabel": "MangaDex Live",
        "stats": {"pageCount": 2, "totalPanels": 2},
        "windows": [],
        "panels": [
            {
                "panelId": "panel_0001",
                "pageId": "page_0001",
                "index": 0,
                "direction": "vertical-scroll",
                "text": "Already hydrated",
                "sourceText": "Already hydrated",
                "displayText": "Already hydrated",
                "translationStatus": "pending",
                "imagePath": str(existing_asset),
                "imageUrl": backend_app._reader_remote_asset_url(str(existing_asset)),
                "remoteImageUrl": "https://example.com/page-1.png",
                "audioJobId": "",
                "audioStatus": "idle",
                "prepStatus": "ready",
                "purged": False,
            },
            {
                "panelId": "panel_0002",
                "pageId": "page_0002",
                "index": 1,
                "direction": "vertical-scroll",
                "text": "",
                "sourceText": "",
                "displayText": "",
                "translationStatus": "pending",
                "imageUrl": "https://example.com/page-2.png",
                "remoteImageUrl": "https://example.com/page-2.png",
                "audioJobId": "",
                "audioStatus": "idle",
                "prepStatus": "pending",
                "purged": False,
            },
        ],
        "cachedChars": 0,
        "deleteAtMs": 0,
        "exportedWindowIndexes": [],
        "exportedPanelIndexes": [],
        "castMemory": {"Narrator": "v22"},
        "defaultVoiceId": "v22",
        "musicTrackId": "m_none",
        "autoAdvanceProfile": "audio_sync",
        "prep": {"state": "running", "stage": "ocr", "completedItems": 1, "totalItems": 2, "failedItems": 0},
        "remotePageSources": ["https://example.com/page-1.png", "https://example.com/page-2.png"],
        "remoteFallbackTitle": "Wind Breaker Demo Ch. 1",
    }
    backend_app._reader_session_set(session)

    backend_app._INMEMORY_READER_SESSIONS.clear()
    backend_app._reader_session_load_from_disk()
    backend_app._reader_resume_remote_comic_hydration_jobs()

    _wait_for(
        lambda: str((backend_app._reader_session_get(uid, session_id) or {}).get("prep", {}).get("state") or "") == "ready"
    )

    resumed = backend_app._reader_session_get(uid, session_id)
    assert resumed is not None
    assert resumed["prep"]["state"] == "ready"
    assert resumed["prep"]["completedItems"] == 2
    assert resumed["panels"][1]["imageUrl"].startswith("/reader/assets/")
    persisted_payload = json.loads((sessions_dir / uid / f"{session_id}.json").read_text(encoding="utf-8"))
    assert persisted_payload["prep"]["state"] == "ready"
    assert persisted_payload["panels"][1]["prepStatus"] == "ready"


def test_reader_remote_comic_failed_page_marks_degraded_and_cached_asset_serves(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    _, remote_assets_dir = _configure_reader_storage(monkeypatch, tmp_path)
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_remote_asset_user"}

    submitted_jobs: list[str] = []

    def fake_reader_create_tts_job(request, *, session, text, request_id, voice_id, language, multi_speaker_mode=None, line_map=None, speaker_voices=None):  # type: ignore[no-untyped-def]
        job_id = f"reader_asset_job_{len(submitted_jobs) + 1}"
        submitted_jobs.append(job_id)
        return job_id

    success_asset = remote_assets_dir / "hydrated-success.png"
    success_bytes = _png_bytes(280, 840)
    success_asset.write_bytes(success_bytes)

    def fake_build_remote_image_page_row(image_url: str, *, fallback_text: str, page_index: int, use_fallback_text: bool = True) -> dict[str, object]:
        if page_index == 0:
            return {
                "text": "Hydrated first panel",
                "imageUrl": backend_app._reader_remote_asset_url(str(success_asset)),
                "imagePath": str(success_asset),
                "imageWidth": 280,
                "imageHeight": 840,
                "aspectRatio": 3.0,
                "hydrationState": "ready",
                "message": "",
            }
        return {
            "text": "",
            "imageUrl": "https://example.com/page-2.png",
            "imagePath": "",
            "imageWidth": 0,
            "imageHeight": 0,
            "aspectRatio": 0.0,
            "hydrationState": "error",
            "message": "Reader OCR could not extract text from this page.",
        }

    monkeypatch.setattr(backend_app, "_reader_create_tts_job", fake_reader_create_tts_job)
    monkeypatch.setattr(backend_app, "_reader_build_remote_image_page_row", fake_build_remote_image_page_row)

    session_id = "reader_session_degraded_case"
    uid = headers["x-dev-uid"]
    session = {
        "id": session_id,
        "uid": uid,
        "workKey": "catalog:mangadex_degraded_title",
        "sourceKind": "catalog",
        "itemId": "mangadex_degraded_title",
        "uploadId": "",
        "title": "Tower Demo",
        "contentKind": "comic",
        "surface": "comics",
        "regionId": "english",
        "direction": "vertical-scroll",
        "readingMode": "vertical_strip",
        "sourceLanguage": "en",
        "targetLanguage": "en",
        "pageViewMode": "original",
        "ttsLanguageMode": "source",
        "multiSpeakerEnabled": True,
        "effectiveMultiSpeakerMode": "single",
        "translationState": "idle",
        "translationLeadRatio": 0.0,
        "voiceFallbacks": {},
        "createdAtMs": 1,
        "updatedAtMs": 1,
        "consumedChars": 0,
        "currentPanelIndex": 0,
        "totalChars": 0,
        "totalPanels": 2,
        "provider": "mangadex",
        "license": "Read via MangaDex source terms",
        "coverUrl": "",
        "summary": "Degraded session",
        "sourceUrl": "https://mangadex.org/title/demo",
        "collectionLabel": "MangaDex Live",
        "stats": {"pageCount": 2, "totalPanels": 2},
        "windows": [],
        "panels": [
            {
                "panelId": "panel_0001",
                "pageId": "page_0001",
                "index": 0,
                "direction": "vertical-scroll",
                "text": "",
                "sourceText": "",
                "displayText": "",
                "translationStatus": "pending",
                "imageUrl": "https://example.com/page-1.png",
                "remoteImageUrl": "https://example.com/page-1.png",
                "audioJobId": "",
                "audioStatus": "idle",
                "prepStatus": "pending",
                "purged": False,
            },
            {
                "panelId": "panel_0002",
                "pageId": "page_0002",
                "index": 1,
                "direction": "vertical-scroll",
                "text": "",
                "sourceText": "",
                "displayText": "",
                "translationStatus": "pending",
                "imageUrl": "https://example.com/page-2.png",
                "remoteImageUrl": "https://example.com/page-2.png",
                "audioJobId": "",
                "audioStatus": "idle",
                "prepStatus": "pending",
                "purged": False,
            },
        ],
        "cachedChars": 0,
        "deleteAtMs": 0,
        "exportedWindowIndexes": [],
        "exportedPanelIndexes": [],
        "castMemory": {"Narrator": "v22"},
        "defaultVoiceId": "v22",
        "musicTrackId": "m_none",
        "autoAdvanceProfile": "audio_sync",
        "prep": {"state": "queued", "stage": "manifest", "completedItems": 0, "totalItems": 2, "failedItems": 0},
        "remotePageSources": ["https://example.com/page-1.png", "https://example.com/page-2.png"],
        "remoteFallbackTitle": "Tower Demo Ch. 1",
    }
    backend_app._reader_session_set(session)

    backend_app._reader_hydrate_remote_comic_session(uid, session_id)

    hydrated = backend_app._reader_session_get(uid, session_id)
    assert hydrated is not None
    assert hydrated["prep"]["state"] == "degraded"
    assert hydrated["prep"]["failedItems"] == 1
    assert hydrated["panels"][0]["audioJobId"] == "reader_asset_job_1"
    assert hydrated["panels"][1]["prepStatus"] == "error"
    assert hydrated["panels"][0]["imageUrl"].startswith("/reader/assets/")

    asset_response = client.get(hydrated["panels"][0]["imageUrl"], headers=headers)
    assert asset_response.status_code == 200
    assert asset_response.content == success_bytes


def test_reader_mangadex_catalog_uses_collapse_whitespace(monkeypatch) -> None:
    manga_payload = {
        "data": [
            {
                "id": "demo-manga",
                "attributes": {
                    "title": {"en": "Wind Breaker Demo"},
                    "description": {"en": " First line.\n\nSecond line. "},
                    "originalLanguage": "ko",
                    "updatedAt": "2026-03-06T00:00:00Z",
                    "createdAt": "2026-03-05T00:00:00Z",
                },
                "relationships": [
                    {"type": "cover_art", "attributes": {"fileName": "cover.png"}},
                    {"type": "author", "attributes": {"name": "Demo Author"}},
                ],
            }
        ]
    }
    feed_payload = {
        "data": [
            {
                "id": "chapter-1",
                "attributes": {
                    "chapter": "1",
                    "title": "Arrival",
                    "translatedLanguage": "en",
                    "pages": 12,
                    "updatedAt": "2026-03-06T00:00:00Z",
                    "publishAt": "2026-03-06T00:00:00Z",
                },
            }
        ]
    }

    class FakeResponse:
        def __init__(self, payload: dict[str, object]) -> None:
            self._payload = payload

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return self._payload

    def fake_get(url: str, *args, **kwargs):  # type: ignore[no-untyped-def]
        if url.endswith("/manga"):
            return FakeResponse(manga_payload)
        if "/feed" in url:
            return FakeResponse(feed_payload)
        raise AssertionError(f"unexpected url {url}")

    monkeypatch.setattr(backend_app.requests, "get", fake_get)

    items = backend_app._reader_fetch_mangadex_catalog("english", search_query="wind")

    assert len(items) == 1
    assert items[0]["summary"] == "First line. Second line."
    assert items[0]["provider"] == "mangadex"
    assert items[0]["readingModeDefault"] == "vertical_strip"


def test_reader_session_translation_modes_and_voice_fallback(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_translation_user"}

    wav_path = tmp_path / "reader_translation.wav"
    wav_path.write_bytes(_wav_bytes())
    jobs: dict[str, dict[str, object]] = {}
    submitted_text: dict[str, str] = {}

    def fake_reader_create_tts_job(request, *, session, text, request_id, voice_id, language, multi_speaker_mode=None, line_map=None, speaker_voices=None):  # type: ignore[no-untyped-def]
        job_id = f"reader_translation_job_{len(jobs) + 1}"
        submitted_text[job_id] = str(text)
        jobs[job_id] = {
            "jobId": job_id,
            "requestId": request_id,
            "uid": headers["x-dev-uid"],
            "status": "completed",
            "engine": "GEM",
            "createdAtMs": 1,
            "updatedAtMs": 1,
            "finishedAtMs": 1,
            "result": {
                "audioRef": {"path": str(wav_path)},
                "mediaType": "audio/wav",
                "headers": {},
            },
            "liveState": {
                "enabled": False,
                "playableChunks": 0,
                "playableDurationMs": 0,
                "chunkCursorNext": 0,
            },
        }
        return job_id

    class FakeQueue:
        def get(self, job_id: str) -> dict[str, object] | None:
            return jobs.get(job_id)

        def cancel(self, job_id: str) -> dict[str, object] | None:
            return jobs.get(job_id)

        def depth_snapshot(self) -> dict[str, int]:
            return {"total": 0}

    monkeypatch.setattr(backend_app, "_reader_create_tts_job", fake_reader_create_tts_job)
    monkeypatch.setattr(backend_app, "_TTS_JOB_QUEUE", FakeQueue())
    monkeypatch.setattr(
        backend_app,
        "_reader_translate_units",
        lambda *, source_language, target_language, items: {
            str(item["unitId"]): f"[{target_language}] {item['text']}"
            for item in items
        },
    )
    monkeypatch.setattr(
        backend_app,
        "_reader_catalog_items",
        lambda region_id, surface, search_query="": backend_app.fallback_catalog_items(region_id, content_kind="book") if surface == "books" else [],
    )

    ack_response = client.post("/reader/legal/ack", headers=headers, json={"accepted": True})
    assert ack_response.status_code == 200

    upload_response = client.post(
        "/reader/uploads",
        headers=headers,
        data={
            "title": "Reader Translation Upload",
            "ownershipBasis": "own_work",
            "regionId": "english",
        },
        files=[("files", ("story.txt", ("Narrator: Reader testing line. " * 80).encode("utf-8"), "text/plain"))],
    )
    assert upload_response.status_code == 200
    upload_payload = upload_response.json()["upload"]

    session_response = client.post(
        "/reader/sessions",
        headers=headers,
        json={
            "uploadId": upload_payload["id"],
            "targetLanguage": "es",
            "pageViewMode": "translated",
            "ttsLanguageMode": "target",
        },
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()["session"]
    assert session_payload["sourceLanguage"] == "en"
    assert session_payload["targetLanguage"] == "es"
    assert session_payload["pageViewMode"] == "translated"
    assert session_payload["ttsLanguageMode"] == "target"
    assert session_payload["multiSpeakerEnabled"] is True
    assert session_payload["translationState"] == "ready"
    assert session_payload["windows"][0]["translatedText"].startswith("[es]")
    assert session_payload["windows"][0]["displayText"].startswith("[es]")
    first_job_id = session_payload["windows"][0]["jobId"]
    assert submitted_text[first_job_id].startswith("[es]")

    savepoint_response = client.post(
        f"/reader/sessions/{session_payload['id']}/savepoint",
        headers=headers,
        json={
            "castOverrides": {"Narrator": "unknown_voice"},
            "targetLanguage": "ar",
            "pageViewMode": "translated",
            "ttsLanguageMode": "target",
        },
    )
    assert savepoint_response.status_code == 200
    savepoint_payload = savepoint_response.json()["session"]
    assert savepoint_payload["targetLanguage"] == "ar"
    assert savepoint_payload["voiceFallbacks"]["Narrator"]["resolvedVoiceId"] == "v22"


def test_reader_multi_speaker_grouped_mode_serializes(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_grouped_user"}

    wav_path = tmp_path / "reader_grouped.wav"
    wav_path.write_bytes(_wav_bytes())
    jobs: dict[str, dict[str, object]] = {}
    submitted: list[dict[str, object]] = []

    def fake_reader_create_tts_job(request, *, session, text, request_id, voice_id, language, multi_speaker_mode=None, line_map=None, speaker_voices=None):  # type: ignore[no-untyped-def]
        job_id = f"reader_grouped_job_{len(jobs) + 1}"
        submitted.append(
            {
                "mode": multi_speaker_mode,
                "line_map": line_map,
                "speaker_voices": speaker_voices,
                "text": text,
            }
        )
        jobs[job_id] = {
            "jobId": job_id,
            "requestId": request_id,
            "uid": headers["x-dev-uid"],
            "status": "completed",
            "engine": "GEM",
            "createdAtMs": 1,
            "updatedAtMs": 1,
            "finishedAtMs": 1,
            "result": {
                "audioRef": {"path": str(wav_path)},
                "mediaType": "audio/wav",
                "headers": {},
            },
            "liveState": {
                "enabled": False,
                "playableChunks": 0,
                "playableDurationMs": 0,
                "chunkCursorNext": 0,
            },
        }
        return job_id

    class FakeQueue:
        def get(self, job_id: str) -> dict[str, object] | None:
            return jobs.get(job_id)

        def cancel(self, job_id: str) -> dict[str, object] | None:
            return jobs.get(job_id)

        def depth_snapshot(self) -> dict[str, int]:
            return {"total": 0}

    monkeypatch.setattr(backend_app, "_reader_create_tts_job", fake_reader_create_tts_job)
    monkeypatch.setattr(backend_app, "_TTS_JOB_QUEUE", FakeQueue())

    assert client.post("/reader/legal/ack", headers=headers, json={"accepted": True}).status_code == 200

    upload_response = client.post(
        "/reader/uploads",
        headers=headers,
        data={
            "title": "Grouped Reader Upload",
            "ownershipBasis": "own_work",
            "regionId": "english",
        },
        files=[("files", ("grouped.txt", ("Alice: Ready?\nBob: Always.\n" * 40).encode("utf-8"), "text/plain"))],
    )
    assert upload_response.status_code == 200
    upload_id = upload_response.json()["upload"]["id"]

    session_response = client.post(
        "/reader/sessions",
        headers=headers,
        json={"uploadId": upload_id, "multiSpeakerEnabled": True},
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()["session"]
    assert session_payload["multiSpeakerEnabled"] is True
    assert session_payload["effectiveMultiSpeakerMode"] == "studio_pair_groups"
    assert submitted[0]["mode"] == "studio_pair_groups"
    assert len(submitted[0]["line_map"] or []) >= 2
    assert len(submitted[0]["speaker_voices"] or []) >= 2
    assert all("voiceName" in item for item in (submitted[0]["speaker_voices"] or []))


def test_reader_multi_speaker_line_map_fallback_serializes(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_line_map_user"}

    wav_path = tmp_path / "reader_line_map.wav"
    wav_path.write_bytes(_wav_bytes())
    jobs: dict[str, dict[str, object]] = {}
    submitted: list[dict[str, object]] = []

    def fake_reader_create_tts_job(request, *, session, text, request_id, voice_id, language, multi_speaker_mode=None, line_map=None, speaker_voices=None):  # type: ignore[no-untyped-def]
        job_id = f"reader_line_map_job_{len(jobs) + 1}"
        submitted.append(
            {
                "mode": multi_speaker_mode,
                "line_map": line_map,
                "speaker_voices": speaker_voices,
            }
        )
        jobs[job_id] = {
            "jobId": job_id,
            "requestId": request_id,
            "uid": headers["x-dev-uid"],
            "status": "completed",
            "engine": "GEM",
            "createdAtMs": 1,
            "updatedAtMs": 1,
            "finishedAtMs": 1,
            "result": {
                "audioRef": {"path": str(wav_path)},
                "mediaType": "audio/wav",
                "headers": {},
            },
            "liveState": {
                "enabled": False,
                "playableChunks": 0,
                "playableDurationMs": 0,
                "chunkCursorNext": 0,
            },
        }
        return job_id

    class FakeQueue:
        def get(self, job_id: str) -> dict[str, object] | None:
            return jobs.get(job_id)

        def cancel(self, job_id: str) -> dict[str, object] | None:
            return jobs.get(job_id)

        def depth_snapshot(self) -> dict[str, int]:
            return {"total": 0}

    monkeypatch.setattr(backend_app, "_reader_create_tts_job", fake_reader_create_tts_job)
    monkeypatch.setattr(backend_app, "_TTS_JOB_QUEUE", FakeQueue())

    assert client.post("/reader/legal/ack", headers=headers, json={"accepted": True}).status_code == 200

    upload_response = client.post(
        "/reader/uploads",
        headers=headers,
        data={
            "title": "Line Map Reader Upload",
            "ownershipBasis": "own_work",
            "regionId": "english",
        },
        files=[("files", ("line-map.txt", ("Narrator: Line one.\nNarrator: Line two.\n" * 40).encode("utf-8"), "text/plain"))],
    )
    assert upload_response.status_code == 200
    upload_id = upload_response.json()["upload"]["id"]

    session_response = client.post(
        "/reader/sessions",
        headers=headers,
        json={"uploadId": upload_id, "multiSpeakerEnabled": True},
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()["session"]
    assert session_payload["multiSpeakerEnabled"] is True
    assert session_payload["effectiveMultiSpeakerMode"] == "line_map"
    assert submitted[0]["mode"] == "legacy_windows"
    assert len(submitted[0]["line_map"] or []) >= 2
    assert len(submitted[0]["speaker_voices"] or []) == 1


def test_reader_multi_speaker_disabled_uses_single_mode(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_single_mode_user"}

    wav_path = tmp_path / "reader_single.wav"
    wav_path.write_bytes(_wav_bytes())
    jobs: dict[str, dict[str, object]] = {}
    submitted: list[dict[str, object]] = []

    def fake_reader_create_tts_job(request, *, session, text, request_id, voice_id, language, multi_speaker_mode=None, line_map=None, speaker_voices=None):  # type: ignore[no-untyped-def]
        job_id = f"reader_single_job_{len(jobs) + 1}"
        submitted.append(
            {
                "mode": multi_speaker_mode,
                "line_map": line_map,
                "speaker_voices": speaker_voices,
            }
        )
        jobs[job_id] = {
            "jobId": job_id,
            "requestId": request_id,
            "uid": headers["x-dev-uid"],
            "status": "completed",
            "engine": "GEM",
            "createdAtMs": 1,
            "updatedAtMs": 1,
            "finishedAtMs": 1,
            "result": {
                "audioRef": {"path": str(wav_path)},
                "mediaType": "audio/wav",
                "headers": {},
            },
            "liveState": {
                "enabled": False,
                "playableChunks": 0,
                "playableDurationMs": 0,
                "chunkCursorNext": 0,
            },
        }
        return job_id

    class FakeQueue:
        def get(self, job_id: str) -> dict[str, object] | None:
            return jobs.get(job_id)

        def cancel(self, job_id: str) -> dict[str, object] | None:
            return jobs.get(job_id)

        def depth_snapshot(self) -> dict[str, int]:
            return {"total": 0}

    monkeypatch.setattr(backend_app, "_reader_create_tts_job", fake_reader_create_tts_job)
    monkeypatch.setattr(backend_app, "_TTS_JOB_QUEUE", FakeQueue())

    assert client.post("/reader/legal/ack", headers=headers, json={"accepted": True}).status_code == 200

    upload_response = client.post(
        "/reader/uploads",
        headers=headers,
        data={
            "title": "Single Reader Upload",
            "ownershipBasis": "own_work",
            "regionId": "english",
        },
        files=[("files", ("single.txt", ("Alice: Ready?\nBob: Always.\n" * 40).encode("utf-8"), "text/plain"))],
    )
    assert upload_response.status_code == 200
    upload_id = upload_response.json()["upload"]["id"]

    session_response = client.post(
        "/reader/sessions",
        headers=headers,
        json={"uploadId": upload_id, "multiSpeakerEnabled": False},
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()["session"]
    assert session_payload["multiSpeakerEnabled"] is False
    assert session_payload["effectiveMultiSpeakerMode"] == "single"
    assert submitted[0]["mode"] is None
    assert not submitted[0]["line_map"]
    assert not submitted[0]["speaker_voices"]
