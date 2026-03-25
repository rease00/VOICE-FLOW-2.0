from __future__ import annotations

import base64
import io
import sys
import wave
from pathlib import Path

from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = BACKEND_ROOT.parent
for candidate in (str(BACKEND_ROOT), str(WORKSPACE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

import backend.app as backend_app


def _make_test_wav(duration_ms: int = 320, sample_rate: int = 24000) -> bytes:
    frame_count = max(1, int(sample_rate * (duration_ms / 1000.0)))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(b"\x00\x00" * frame_count)
    return buffer.getvalue()


def _make_png_bytes() -> bytes:
    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+Xx1bAAAAAElFTkSuQmCC"
    )


def test_admin_published_reader_catalog_items_are_visible_to_reader_users(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(
        backend_app,
        "_require_admin_mutation_unlock",
        lambda request, expected_uid=None: expected_uid or "local_admin_reader",
    )
    monkeypatch.setattr(
        backend_app._UNIFIED_TTS_SERVICE.provider_client,
        "synthesize_chunk",
        lambda session, chunk, *, config: (_make_test_wav(), "audio/wav", {"seq": chunk.seq, "engine": session.engine}),
    )

    client = TestClient(backend_app.app)
    admin_headers = {"x-dev-uid": "local_admin_reader"}
    reader_headers = {"x-dev-uid": "reader_public_user"}

    novel_response = client.post(
        "/admin/reader/catalog/items",
        headers=admin_headers,
        data={
            "title": "Admin Published Novel",
            "author": "Catalog Editor",
            "contentType": "novel",
            "ownershipBasis": "licensed",
            "regionId": "english",
            "license": "CC BY 4.0",
            "summary": "A novel seeded from the Reader admin library.",
            "collectionLabel": "Reader Library",
            "publishState": "published",
        },
        files=[("files", ("novel.txt", b"Admin novel content for Reader users.", "text/plain"))],
    )
    assert novel_response.status_code == 200
    novel_item = novel_response.json()["item"]
    novel_id = str(novel_item["id"])

    manga_response = client.post(
        "/admin/reader/catalog/items",
        headers=admin_headers,
        data={
            "title": "Admin Draft Manga",
            "author": "Catalog Artist",
            "contentType": "manga",
            "ownershipBasis": "licensed",
            "regionId": "japanese",
            "license": "CC BY 4.0",
            "summary": "A manga seeded as a draft first.",
            "collectionLabel": "Reader Library",
            "directionOverride": "manga",
            "publishState": "draft",
        },
        files=[("files", ("page.png", _make_png_bytes(), "image/png"))],
    )
    assert manga_response.status_code == 200
    manga_item = manga_response.json()["item"]
    manga_id = str(manga_item["id"])

    assert str(novel_item["publishState"]).lower() == "published"
    assert str(manga_item["publishState"]).lower() == "draft"

    def fail_external_fetch(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise AssertionError("Reader library bootstrap should not block on external discovery fetches.")

    monkeypatch.setattr(backend_app, "_reader_fetch_standard_ebooks_catalog", fail_external_fetch)
    monkeypatch.setattr(backend_app, "_reader_fetch_project_gutenberg_catalog", fail_external_fetch)
    monkeypatch.setattr(backend_app, "_reader_fetch_pepper_carrot_catalog", fail_external_fetch)

    library_response = client.get("/reader/library?surface=all", headers=reader_headers)
    assert library_response.status_code == 200
    library_payload = library_response.json()["library"]
    titles = [str(item.get("title") or "") for item in library_payload["items"]]
    assert "Admin Published Novel" in titles
    assert "Admin Draft Manga" not in titles

    patched_manga = client.patch(
        f"/admin/reader/catalog/items/{manga_id}",
        headers=admin_headers,
        json={"publishState": "published"},
    )
    assert patched_manga.status_code == 200
    assert str(patched_manga.json()["item"]["publishState"]).lower() == "published"

    relisted = client.get("/reader/library?surface=all", headers=reader_headers)
    assert relisted.status_code == 200
    relisted_titles = [str(item.get("title") or "") for item in relisted.json()["library"]["items"]]
    assert "Admin Published Novel" in relisted_titles
    assert "Admin Draft Manga" in relisted_titles

    session_response = client.post(
        "/reader/sessions",
        headers=reader_headers,
        json={
            "itemId": novel_id,
            "audioEngine": "tts_hd",
            "multiSpeakerEnabled": False,
            "voiceMode": "single",
        },
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()["session"]
    assert str(session_payload["sourceKind"]).lower() == "catalog"
    assert str(session_payload["workKey"]).startswith("catalog:")

    deleted = client.delete(f"/admin/reader/catalog/items/{novel_id}", headers=admin_headers)
    assert deleted.status_code == 200

    final_library = client.get("/reader/library?surface=all", headers=reader_headers)
    assert final_library.status_code == 200
    final_titles = [str(item.get("title") or "") for item in final_library.json()["library"]["items"]]
    assert "Admin Published Novel" not in final_titles
    assert "Admin Draft Manga" in final_titles
