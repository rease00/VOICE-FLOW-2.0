from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
import threading
import time
import wave
import zipfile

from fastapi.testclient import TestClient

import app as backend_app
from services.reader_domain import (
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


def _docx_bytes(*paragraphs: str) -> bytes:
    safe_paragraphs = [str(item or "").strip() for item in paragraphs if str(item or "").strip()]
    if not safe_paragraphs:
        safe_paragraphs = ["Reader DOCX sample paragraph."]
    document_rows = "".join(
        [
            f"<w:p><w:r><w:t>{value}</w:t></w:r></w:p>"
            for value in safe_paragraphs
        ]
    )
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{document_rows}</w:body>"
        "</w:document>"
    )
    payload = BytesIO()
    with zipfile.ZipFile(payload, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", document_xml.encode("utf-8"))
    return payload.getvalue()


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
    assert should_schedule_next_text_window(consumed_chars=500, scheduled_window_end_char=1500) is True
    assert should_schedule_next_text_window(consumed_chars=499, scheduled_window_end_char=1500) is False
    assert should_schedule_next_panel_batch(current_panel_index=5, scheduled_panel_count=10) is True
    assert should_schedule_next_panel_batch(current_panel_index=4, scheduled_panel_count=10) is False


def test_reader_library_imports_only_includes_uploads_and_safe_discovery(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_READER_IMPORTS_ONLY", True)
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

    upload_response = client.post(
        "/reader/uploads",
        headers=headers,
        data={
            "title": "Imports Only Story",
            "ownershipBasis": "own_work",
            "regionId": "english",
        },
        files=[("files", ("story.txt", b"Imports-only reader body text.", "text/plain"))],
    )
    assert upload_response.status_code == 200

    library_response = client.get("/reader/library?surface=books&regionId=english&search=moon", headers=headers)
    assert library_response.status_code == 200
    library_payload = library_response.json()["library"]

    assert library_payload["surface"] == "books"
    assert library_payload["items"]
    assert all(item["contentKind"] == "book" for item in library_payload["items"])
    assert any(item["surface"] == "uploads" for item in library_payload["items"])
    assert any(item["surface"] == "books" for item in library_payload["items"])
    assert catalog_calls == [("english", "books", "moon")]


def test_reader_tts_job_prefers_reader_model_route(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_submit(payload, request, *, sync_wait_ms):  # type: ignore[no-untyped-def]
        captured["model"] = payload.model
        captured["modelCandidates"] = list(payload.modelCandidates or [])
        captured["syncWaitMs"] = sync_wait_ms
        return backend_app.JSONResponse({"jobId": "reader_model_route_job"})

    monkeypatch.setattr(backend_app, "_submit_tts_job", fake_submit)

    job_id = backend_app._reader_create_tts_job(
        None,  # type: ignore[arg-type]
        session={"id": "reader_session_model_route"},
        text="Reader model route test",
        request_id="reader_model_route_request",
        voice_id="v22",
        language="en",
    )

    assert job_id == "reader_model_route_job"
    assert captured["model"] == "gemini-2.5-flash-preview-tts"
    assert captured["modelCandidates"] == [
        "gemini-2.5-flash-preview-tts",
        "gemini-2.5-flash-lite-preview-tts",
    ]
    assert captured["syncWaitMs"] == 0


def test_reader_legal_ack_exposes_commercial_payload(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_commercial_ack_user"}

    response = client.get("/reader/legal/ack", headers=headers)
    assert response.status_code == 200
    payload = response.json()

    commercial = payload["commercial"]
    assert commercial["enabled"] is True
    assert commercial["policyVersion"] == backend_app.COMMERCIAL_POLICY_VERSION
    assert any(option["value"] == "own_work" for option in commercial["ownershipBasisOptions"])
    assert "project_gutenberg" in commercial["blockedProviders"]


def test_reader_upload_rejects_invalid_ownership_basis(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_bad_rights_user"}

    assert client.post("/reader/legal/ack", headers=headers, json={"accepted": True}).status_code == 200

    response = client.post(
        "/reader/uploads",
        headers=headers,
        data={
            "title": "Bad rights upload",
            "ownershipBasis": "totally_invalid",
            "regionId": "english",
        },
        files=[("files", ("story.txt", b"Invalid ownership basis test.", "text/plain"))],
    )
    assert response.status_code == 400
    assert "ownershipBasis" in str(response.json().get("detail") or "")


def test_reader_catalog_item_detail_uses_uploads_in_imports_only(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_READER_IMPORTS_ONLY", True)
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_item_detail_user"}

    assert client.post("/reader/legal/ack", headers=headers, json={"accepted": True}).status_code == 200
    upload_response = client.post(
        "/reader/uploads",
        headers=headers,
        data={
            "title": "Detail Upload",
            "ownershipBasis": "own_work",
            "regionId": "english",
        },
        files=[("files", ("detail.txt", b"Catalog detail fallback text.", "text/plain"))],
    )
    assert upload_response.status_code == 200
    upload_id = upload_response.json()["upload"]["id"]

    item_response = client.get(f"/reader/catalog/items/{upload_id}", headers=headers)
    assert item_response.status_code == 200
    payload = item_response.json()
    assert payload["item"]["id"] == upload_id
    assert payload["item"]["surface"] == "uploads"


def test_reader_comic_pacing_metadata_applies_emotion_multiplier() -> None:
    suspense_meta = backend_app._reader_unit_pacing_meta(  # type: ignore[attr-defined]
        {"text": "Whispers in the dark.", "emotion": "Suspense", "estimatedReadMs": 4200},
        content_kind="comic",
    )
    intense_meta = backend_app._reader_unit_pacing_meta(  # type: ignore[attr-defined]
        {"text": "Run now!", "emotion": "urgent", "estimatedReadMs": 4200},
        content_kind="comic",
    )

    assert suspense_meta["emotionAwareReadMs"] > suspense_meta["baseReadMs"]
    assert intense_meta["emotionAwareReadMs"] < intense_meta["baseReadMs"]
    assert suspense_meta["emotion"] == "Suspense"


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
    assert session_payload["billing"]["engineLabel"] == "Gemini Native Audio Dialog"
    assert session_payload["audioEngine"] == "native_audio_dialog"
    assert session_payload["billing"]["modelRouting"]["primary"] == "gemini-2.5-flash-preview-tts"
    assert session_payload["billing"]["modelRouting"]["fallback"] == "gemini-2.5-flash-lite-preview-tts"
    assert session_payload["limits"]["textWindowChars"] == 1500
    assert session_payload["limits"]["prefetchThresholdChars"] == 1000
    assert session_payload["autoAdvanceProfile"] == "medium"
    assert session_payload["multiSpeakerEnabled"] is True
    assert session_payload["voiceMode"] == "multi"
    assert session_payload["narratorVoiceId"] == "v22"
    assert session_payload["readiness"]["state"] in {"ready", "preparing"}
    assert len([item for item in session_payload["windows"] if item.get("jobId")]) == 1

    reused_session_response = client.post("/reader/sessions", headers=headers, json={"uploadId": upload_id})
    assert reused_session_response.status_code == 200
    assert reused_session_response.json()["session"]["id"] == session_payload["id"]

    savepoint_response = client.post(
        f"/reader/sessions/{session_payload['id']}/savepoint",
        headers=headers,
        json={
            "autoAdvanceProfile": "slow",
            "multiSpeakerEnabled": False,
            "voiceMode": "single",
            "narratorVoiceId": "v17",
            "unitOverrides": {"window_0": "Edited session-only text for window zero."},
        },
    )
    assert savepoint_response.status_code == 200
    savepoint_payload = savepoint_response.json()["session"]
    assert savepoint_payload["autoAdvanceProfile"] == "slow"
    assert savepoint_payload["multiSpeakerEnabled"] is False
    assert savepoint_payload["voiceMode"] == "single"
    assert savepoint_payload["narratorVoiceId"] == "v17"
    assert savepoint_payload["unitOverrides"]["window_0"] == "Edited session-only text for window zero."
    assert savepoint_payload["windows"][0]["textOverrideStatus"] == "edited"
    upload_text_path = Path(str(upload_payload.get("textPath") or ""))
    if upload_text_path.exists():
        original_source = upload_text_path.read_text(encoding="utf-8", errors="replace")
        assert "Edited session-only text for window zero." not in original_source

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


def test_reader_upload_supports_markdown_and_docx(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_READER_IMPORTS_ONLY", True)
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_docx_user"}
    wav_path = tmp_path / "reader_docx.wav"
    wav_path.write_bytes(_wav_bytes())
    jobs: dict[str, dict[str, object]] = {}

    def fake_reader_create_tts_job(request, *, session, text, request_id, voice_id, language, multi_speaker_mode=None, line_map=None, speaker_voices=None):  # type: ignore[no-untyped-def]
        job_id = f"reader_docx_job_{len(jobs) + 1}"
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
            "title": "Markdown and DOCX Upload",
            "ownershipBasis": "own_work",
            "regionId": "english",
        },
        files=[
            ("files", ("chapter.md", b"# Chapter One\n\nMarkdown import line.", "text/markdown")),
            ("files", ("chapter.docx", _docx_bytes("DOCX import line one.", "DOCX import line two."), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")),
        ],
    )
    assert upload_response.status_code == 200
    upload_payload = upload_response.json()["upload"]
    assert upload_payload["contentKind"] == "book"
    assert upload_payload["readingModeDefault"] == "document"

    session_response = client.post(
        "/reader/sessions",
        headers=headers,
        json={"uploadId": upload_payload["id"]},
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()["session"]
    source_text = "\n".join(str(item.get("sourceText") or "") for item in session_payload["windows"])
    assert "Markdown import line." in source_text
    assert "DOCX import line one." in source_text


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
    monkeypatch.setattr(backend_app, "_reader_catalog_items", lambda region_id, surface, search_query="": [])

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


def test_reader_upload_rejects_oversized_file(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_READER_UPLOAD_MAX_FILE_BYTES", 128)
    monkeypatch.setattr(backend_app, "VF_READER_UPLOAD_MAX_TOTAL_BYTES", 256)
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_limits_user"}

    ack_response = client.post("/reader/legal/ack", headers=headers, json={"accepted": True})
    assert ack_response.status_code == 200

    upload_response = client.post(
        "/reader/uploads",
        headers=headers,
        data={
            "title": "Oversized Upload",
            "ownershipBasis": "own_work",
            "regionId": "english",
        },
        files=[("files", ("oversized.txt", b"x" * 256, "text/plain"))],
    )
    assert upload_response.status_code == 413
    assert "too large" in str(upload_response.json().get("detail") or "").lower()


def test_reader_upload_rejects_archive_with_too_many_entries(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_READER_UPLOAD_MAX_ARCHIVE_ENTRIES", 2)
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_archive_limit_user"}

    archive_buffer = BytesIO()
    image_bytes = _png_bytes(width=64, height=64)
    with zipfile.ZipFile(archive_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("page_001.png", image_bytes)
        archive.writestr("page_002.png", image_bytes)
        archive.writestr("page_003.png", image_bytes)

    ack_response = client.post("/reader/legal/ack", headers=headers, json={"accepted": True})
    assert ack_response.status_code == 200

    upload_response = client.post(
        "/reader/uploads",
        headers=headers,
        data={
            "title": "Comic Archive",
            "ownershipBasis": "own_work",
            "regionId": "english",
        },
        files=[("files", ("comic.cbz", archive_buffer.getvalue(), "application/zip"))],
    )
    assert upload_response.status_code == 413
    assert "too many image entries" in str(upload_response.json().get("detail") or "").lower()


def test_reader_library_search_and_live_pepper_carrot_session(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_READER_IMPORTS_ONLY", False)
    backend_app._INMEMORY_READER_CATALOG_CACHE.clear()
    sessions_dir, _ = _configure_reader_storage(monkeypatch, tmp_path)
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_pepper_user"}

    sample_item = backend_app.normalize_reader_catalog_item(
        {
            "id": "pepper_demo_title",
            "title": "Episode 39: The Tavern",
            "author": "David Revoy",
            "regionId": "english",
            "contentKind": "comic",
            "provider": "pepper_carrot",
            "license": "CC BY 4.0",
            "sourceUrl": "https://www.peppercarrot.com/en/webcomic/ep39_The-Tavern.html",
            "contentUrl": "https://www.peppercarrot.com/en/webcomic/ep39_The-Tavern.html",
            "summary": "Playable comic search result.",
            "supportsReadHere": True,
            "readingModeDefault": "vertical_strip",
            "direction": "vertical-scroll",
            "collectionLabel": "Pepper&Carrot",
            "stats": {"pageCount": 2, "totalPanels": 2},
            "sourceMeta": {"episodeUrl": "https://www.peppercarrot.com/en/webcomic/ep39_The-Tavern.html"},
            "createdAt": "2026-03-06T00:00:00Z",
            "updatedAt": "2026-03-06T00:00:00Z",
        }
    )
    enqueued_session_ids: list[str] = []

    monkeypatch.setattr(backend_app, "_reader_fetch_standard_ebooks_catalog", lambda region_id, search_query="": [])
    monkeypatch.setattr(backend_app, "_reader_fetch_project_gutenberg_catalog", lambda region_id, search_query="": [])
    monkeypatch.setattr(backend_app, "_reader_fetch_pepper_carrot_catalog", lambda region_id, search_query="": [sample_item] if "tavern" in search_query.lower() else [])
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

    library_response = client.get("/reader/library?surface=all&regionId=english&search=tavern", headers=headers)
    assert library_response.status_code == 200
    library_payload = library_response.json()["library"]
    assert any(item["provider"] == "pepper_carrot" for item in library_payload["items"])
    catalog_item = next(item for item in library_payload["items"] if item["provider"] == "pepper_carrot")
    assert catalog_item["readiness"]["state"] == "ready"

    session_response = client.post(
        "/reader/sessions",
        headers=headers,
        json={"itemId": catalog_item["id"], "autoAdvanceProfile": "audio_sync"},
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()["session"]
    assert session_payload["provider"] == "pepper_carrot"
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
        "workKey": "catalog:pepper_demo_title",
        "sourceKind": "catalog",
        "itemId": "pepper_demo_title",
        "uploadId": "",
        "title": "Episode 39: The Tavern",
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
        "provider": "pepper_carrot",
        "license": "CC BY 4.0",
        "coverUrl": "",
        "summary": "Restartable session",
        "sourceUrl": "https://www.peppercarrot.com/en/webcomic/ep39_The-Tavern.html",
        "collectionLabel": "Pepper&Carrot",
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
        "remoteFallbackTitle": "Episode 39: The Tavern",
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
        "workKey": "catalog:pepper_degraded_title",
        "sourceKind": "catalog",
        "itemId": "pepper_degraded_title",
        "uploadId": "",
        "title": "Episode 1: The Potion of Flight",
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
        "provider": "pepper_carrot",
        "license": "CC BY 4.0",
        "coverUrl": "",
        "summary": "Degraded session",
        "sourceUrl": "https://www.peppercarrot.com/en/webcomic/ep01_Potion-of-Flight.html",
        "collectionLabel": "Pepper&Carrot",
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
        "remoteFallbackTitle": "Episode 1: The Potion of Flight",
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


def test_reader_standard_ebooks_catalog_uses_collapse_whitespace(monkeypatch) -> None:
    feed_payload = """<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <entry>
    <id>https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland</id>
    <title>Alice's Adventures in Wonderland</title>
    <author><name>Lewis Carroll</name></author>
    <published>2026-03-05T00:00:00Z</published>
    <updated>2026-03-06T00:00:00Z</updated>
    <rights>Public domain in the United States. Original content released to the public domain via CC0.</rights>
    <summary type="text"> First line.

Second line. </summary>
    <media:thumbnail url="https://standardebooks.org/covers/alice.jpg" />
    <link href="https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland" rel="alternate" type="application/xhtml+xml" />
    <link href="https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland/text/single-page" rel="enclosure" type="application/xhtml+xml" />
  </entry>
</feed>
"""
    class FakeResponse:
        def __init__(self, payload: str) -> None:
            self._payload = payload

        def raise_for_status(self) -> None:
            return None

        @property
        def text(self) -> str:
            return self._payload

    def fake_get(url: str, *args, **kwargs):  # type: ignore[no-untyped-def]
        assert url == "https://standardebooks.org/feeds/atom/all"
        return FakeResponse(feed_payload)

    monkeypatch.setattr(backend_app.requests, "get", fake_get)

    items = backend_app._reader_fetch_standard_ebooks_catalog("english", search_query="alice")

    assert len(items) == 1
    assert items[0]["summary"] == "First line. Second line."
    assert items[0]["provider"] == "standard_ebooks"
    assert items[0]["contentUrl"].endswith("/text/single-page")


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
            "audioEngine": "tts_hd",
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


def test_reader_native_audio_enqueue_failure_falls_back_to_tts(monkeypatch) -> None:
    calls: list[str] = []

    def fake_reader_create_tts_job(  # type: ignore[no-untyped-def]
        request,
        *,
        session,
        text,
        request_id,
        voice_id,
        language,
        multi_speaker_mode=None,
        line_map=None,
        speaker_voices=None,
        route_audio_engine=None,
    ):
        engine = str(route_audio_engine or session.get("audioEngine") or "tts_hd")
        calls.append(engine)
        if engine == "native_audio_dialog":
            raise RuntimeError("native engine unavailable")
        return "reader_fallback_job_tts"

    monkeypatch.setattr(backend_app, "_reader_create_tts_job", fake_reader_create_tts_job)

    next_session, job_id, routed_engine = backend_app._reader_create_tts_job_with_audio_engine_fallback(
        None,  # type: ignore[arg-type]
        session={"id": "reader_native_session", "audioEngine": "native_audio_dialog"},
        text="Fallback should recover this segment.",
        request_id="reader_native_fallback_request",
        voice_id="v22",
        language="en",
    )

    assert job_id == "reader_fallback_job_tts"
    assert routed_engine == "tts_hd"
    assert next_session["audioEngineStatus"] == "fallback_to_tts"
    assert calls == ["native_audio_dialog", "tts_hd"]


def test_reader_audio_engine_and_restore_state_persist_across_resume(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_READER_IMPORTS_ONLY", True)
    monkeypatch.setattr(backend_app, "VF_READER_NATIVE_AUDIO_ENABLED", True)
    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_audio_engine_user"}

    wav_path = tmp_path / "reader_audio_engine.wav"
    wav_path.write_bytes(_wav_bytes())
    jobs: dict[str, dict[str, object]] = {}

    def fake_reader_create_tts_job(  # type: ignore[no-untyped-def]
        request,
        *,
        session,
        text,
        request_id,
        voice_id,
        language,
        multi_speaker_mode=None,
        line_map=None,
        speaker_voices=None,
    ):
        job_id = f"reader_audio_engine_job_{len(jobs) + 1}"
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
            "title": "Reader Engine Resume Upload",
            "ownershipBasis": "own_work",
            "regionId": "english",
        },
        files=[("files", ("resume.txt", ("Narrator: Resume metadata line. " * 80).encode("utf-8"), "text/plain"))],
    )
    assert upload_response.status_code == 200
    upload_id = upload_response.json()["upload"]["id"]

    session_response = client.post(
        "/reader/sessions",
        headers=headers,
        json={"uploadId": upload_id, "audioEngine": "native_audio_dialog"},
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()["session"]
    assert session_payload["audioEngine"] == "native_audio_dialog"
    assert session_payload["audioEngineStatus"] == "active"

    progress_response = client.post(
        f"/reader/sessions/{session_payload['id']}/progress",
        headers=headers,
        json={
            "consumedChars": 750,
            "audioEngine": "native_audio_dialog",
            "activeItemIndex": 1,
            "activeUnitId": "window_1",
            "viewportAnchor": "window:1",
        },
    )
    assert progress_response.status_code == 200
    progressed = progress_response.json()["session"]
    assert progressed["audioEngine"] == "native_audio_dialog"
    assert progressed["restoreState"]["activeItemIndex"] == 1
    assert progressed["restoreState"]["activeUnitId"] == "window_1"
    assert progressed["restoreState"]["viewportAnchor"] == "window:1"

    savepoint_response = client.post(
        f"/reader/sessions/{session_payload['id']}/savepoint",
        headers=headers,
        json={
            "audioEngine": "tts_hd",
            "restoreState": {
                "activeItemIndex": 2,
                "activeUnitId": "window_2",
                "viewportAnchor": "window:2",
            },
        },
    )
    assert savepoint_response.status_code == 200
    saved_payload = savepoint_response.json()["session"]
    assert saved_payload["audioEngine"] == "tts_hd"
    assert saved_payload["restoreState"]["activeItemIndex"] == 2
    assert saved_payload["restoreState"]["activeUnitId"] == "window_2"
    assert saved_payload["restoreState"]["viewportAnchor"] == "window:2"

    delete_response = client.delete(f"/reader/sessions/{session_payload['id']}", headers=headers)
    assert delete_response.status_code == 200

    resumed_response = client.post(
        "/reader/sessions",
        headers=headers,
        json={"uploadId": upload_id, "forceNew": True},
    )
    assert resumed_response.status_code == 200
    resumed_payload = resumed_response.json()["session"]
    assert resumed_payload["audioEngine"] == "tts_hd"
    assert resumed_payload["restoreState"]["activeItemIndex"] == 2
    assert resumed_payload["restoreState"]["activeUnitId"] == "window_2"
    assert resumed_payload["restoreState"]["viewportAnchor"] == "window:2"


def test_reader_session_persist_retries_when_atomic_replace_is_busy(monkeypatch, tmp_path: Path) -> None:
    _configure_reader_storage(monkeypatch, tmp_path)
    monkeypatch.setattr(backend_app, "VF_READER_SESSION_PERSIST_RETRY_COUNT", 3)
    monkeypatch.setattr(backend_app, "VF_READER_SESSION_PERSIST_BACKOFF_MS", 1)

    session_payload = {
        "id": "reader_retry_session",
        "uid": "reader_retry_user",
        "contentKind": "book",
        "prep": {"state": "running", "stage": "audio", "completedItems": 0, "totalItems": 1, "failedItems": 0},
    }
    attempts = {"count": 0}
    original_replace = Path.replace

    def flaky_replace(self: Path, target: Path):  # type: ignore[override]
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise OSError("file is busy")
        return original_replace(self, target)

    monkeypatch.setattr(Path, "replace", flaky_replace)
    backend_app._reader_session_persist(session_payload)

    persisted_path = backend_app._reader_session_path("reader_retry_user", "reader_retry_session")
    assert attempts["count"] == 3
    assert persisted_path.exists()
    payload = json.loads(persisted_path.read_text(encoding="utf-8"))
    assert payload["id"] == "reader_retry_session"


def test_reader_session_persist_concurrency_keeps_restart_state_fresh(monkeypatch, tmp_path: Path) -> None:
    sessions_dir, _ = _configure_reader_storage(monkeypatch, tmp_path)

    base_session = {
        "id": "reader_concurrent_session",
        "uid": "reader_concurrent_user",
        "workKey": "catalog:test",
        "contentKind": "comic",
        "windows": [],
        "panels": [
            {
                "panelId": "panel_0001",
                "pageId": "page_0001",
                "index": 0,
                "direction": "vertical-scroll",
                "text": "Panel one",
                "sourceText": "Panel one",
                "displayText": "Panel one",
                "translationStatus": "ready",
                "audioStatus": "idle",
                "prepStatus": "ready",
            }
        ],
    }
    running = {
        **base_session,
        "prep": {"state": "running", "stage": "ocr", "completedItems": 0, "totalItems": 1, "failedItems": 0},
    }
    ready = {
        **base_session,
        "prep": {"state": "ready", "stage": "audio", "completedItems": 1, "totalItems": 1, "failedItems": 0},
    }

    def writer(payload: dict[str, object], repeat: int) -> None:
        for _ in range(repeat):
            backend_app._reader_session_set(dict(payload))
            time.sleep(0.002)

    t1 = threading.Thread(target=writer, args=(running, 12), daemon=True)
    t2 = threading.Thread(target=writer, args=(ready, 12), daemon=True)
    t1.start()
    t2.start()
    t1.join(timeout=3)
    t2.join(timeout=3)

    backend_app._reader_session_set(dict(ready))
    backend_app._INMEMORY_READER_SESSIONS.clear()
    backend_app._reader_session_load_from_disk()

    persisted = json.loads((sessions_dir / "reader_concurrent_user" / "reader_concurrent_session.json").read_text(encoding="utf-8"))
    restored = backend_app._reader_session_get("reader_concurrent_user", "reader_concurrent_session")
    assert persisted["prep"]["state"] == "ready"
    assert restored is not None
    assert restored["prep"]["state"] == "ready"


def test_reader_commercial_policy_blocks_non_compliant_catalog_sessions(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_READER_IMPORTS_ONLY", False)
    monkeypatch.setattr(backend_app, "VF_COMMERCIAL_MODE", True)
    _configure_reader_storage(monkeypatch, tmp_path)

    blocked_item = backend_app.normalize_reader_catalog_item(
        {
            "id": "reader_blocked_pg_1",
            "title": "Blocked Gutenberg Sample",
            "author": "Project Gutenberg",
            "regionId": "english",
            "contentKind": "book",
            "provider": "project_gutenberg",
            "license": "Public domain in the United States",
            "sampleText": "Blocked sample text.",
            "supportsReadHere": True,
        }
    )
    allowed_item = backend_app.normalize_reader_catalog_item(
        {
            "id": "reader_allowed_pc_1",
            "title": "Allowed Pepper Episode",
            "author": "David Revoy",
            "regionId": "english",
            "contentKind": "comic",
            "provider": "pepper_carrot",
            "license": "CC BY 4.0",
            "sourceUrl": "https://www.peppercarrot.com/en/webcomic/ep39_The-Tavern.html",
            "contentUrl": "https://www.peppercarrot.com/en/webcomic/ep39_The-Tavern.html",
            "readingModeDefault": "vertical_strip",
            "direction": "vertical-scroll",
            "supportsReadHere": True,
            "sourceMeta": {"episodeUrl": "https://www.peppercarrot.com/en/webcomic/ep39_The-Tavern.html"},
        }
    )

    def fake_catalog(region_id: str, surface: str, search_query: str = "") -> list[dict[str, object]]:
        _ = region_id, search_query
        if surface == "books":
            return [blocked_item]
        if surface == "comics":
            return [allowed_item]
        return []

    monkeypatch.setattr(backend_app, "_reader_catalog_items", fake_catalog)
    monkeypatch.setattr(
        backend_app,
        "_reader_catalog_comic_manifest",
        lambda item: [
            {
                "panelId": "panel_0001",
                "pageId": "page_0001",
                "index": 0,
                "direction": "vertical-scroll",
                "text": "Panel one",
                "sourceText": "Panel one",
                "displayText": "Panel one",
                "translationStatus": "pending",
                "imageUrl": "https://example.com/panel-1.png",
                "audioStatus": "idle",
                "prepStatus": "pending",
            }
        ],
    )

    client = TestClient(backend_app.app)
    headers = {"x-dev-uid": "reader_policy_user"}
    assert client.post("/reader/legal/ack", headers=headers, json={"accepted": True}).status_code == 200

    library_response = client.get("/reader/library?surface=all&regionId=english", headers=headers)
    assert library_response.status_code == 200
    library_payload = library_response.json()["library"]
    items = {item["id"]: item for item in library_payload["items"]}
    assert items["reader_blocked_pg_1"]["commercialUseStatus"] == "blocked"
    assert items["reader_allowed_pc_1"]["commercialUseStatus"] == "allowed"
    assert library_payload["commercialPolicyVersion"]
    assert "project_gutenberg" in library_payload["blockedProviders"]

    blocked_session = client.post(
        "/reader/sessions",
        headers=headers,
        json={"itemId": "reader_blocked_pg_1"},
    )
    assert blocked_session.status_code == 403
    blocked_detail = blocked_session.json().get("detail") or {}
    assert blocked_detail.get("code") == "commercial_policy_blocked"

    allowed_session = client.post(
        "/reader/sessions",
        headers=headers,
        json={"itemId": "reader_allowed_pc_1"},
    )
    assert allowed_session.status_code == 200
