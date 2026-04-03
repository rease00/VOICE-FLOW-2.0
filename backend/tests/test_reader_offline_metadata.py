from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = BACKEND_ROOT.parent
for candidate in (str(BACKEND_ROOT), str(WORKSPACE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

import app as backend_app


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class _FakeDocSnapshot:
    def __init__(self, payload: dict | None) -> None:
        self._payload = dict(payload or {})
        self.exists = payload is not None

    def to_dict(self) -> dict:
        return dict(self._payload)


class _FakeDocRef:
    def __init__(self, store: dict[str, dict], doc_id: str) -> None:
        self._store = store
        self._doc_id = doc_id

    def get(self) -> _FakeDocSnapshot:
        return _FakeDocSnapshot(self._store.get(self._doc_id))

    def set(self, payload: dict, merge: bool = False) -> None:
        if merge and self._doc_id in self._store:
            merged = dict(self._store.get(self._doc_id) or {})
            merged.update(dict(payload or {}))
            self._store[self._doc_id] = merged
            return
        self._store[self._doc_id] = dict(payload or {})

    def delete(self) -> None:
        self._store.pop(self._doc_id, None)


class _FakeQuery:
    def __init__(self, store: dict[str, dict], field: str, value: str) -> None:
        self._store = store
        self._field = field
        self._value = value

    def stream(self) -> list[_FakeDocSnapshot]:
        rows = [
            _FakeDocSnapshot(payload)
            for payload in self._store.values()
            if str((payload or {}).get(self._field) or "") == self._value
        ]
        return rows


class _FakeCollection:
    def __init__(self, store: dict[str, dict]) -> None:
        self._store = store

    def document(self, doc_id: str) -> _FakeDocRef:
        return _FakeDocRef(self._store, str(doc_id))

    def where(self, field: str, _op: str, value: str) -> _FakeQuery:
        return _FakeQuery(self._store, str(field), str(value))


def _clear_reader_offline_metadata_state() -> None:
    backend_app._INMEMORY_READER_OFFLINE_METADATA.clear()


@pytest.fixture(autouse=True)
def _isolate_reader_offline_metadata_state() -> None:
    _clear_reader_offline_metadata_state()
    yield
    _clear_reader_offline_metadata_state()


def test_reader_offline_metadata_requires_auth_when_enforced(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)

    client = TestClient(backend_app.app)
    response = client.get("/reader/offline/metadata")

    assert response.status_code == 401


def test_reader_offline_metadata_inmemory_round_trip_and_merge(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "VF_REQUIRE_EMAIL_VERIFIED", False)
    monkeypatch.setattr(backend_app, "VF_USER_ID_REQUIRED", False)
    monkeypatch.setattr(backend_app, "_verify_firebase_id_token", lambda _token: {"uid": "reader_memory_user"})
    monkeypatch.setattr(backend_app, "_firestore_collection", lambda _name: None)

    client = TestClient(backend_app.app)
    headers = _auth_headers("reader-memory-token")

    created = client.put(
        "/reader/offline/metadata/entry-1",
        headers=headers,
        json={
            "contentId": "book-1",
            "chapterId": "chapter-1",
            "chapterIndex": 2,
            "chapterTitle": "Chapter One",
            "speakerMode": "multi_speaker",
            "watermarkId": "WM-1",
            "watermarkVersion": "Seed_V1",
            "sizeBytes": 512,
            "hash": "ABC123",
            "durationMs": 91_000,
            "deviceId": "device-1",
            "deviceType": "phone",
            "deviceLabel": "Pixel 8",
            "deviceMarker": "android-primary",
        },
    )
    assert created.status_code == 200
    metadata = created.json()["metadata"]
    assert metadata["uid"] == "reader_memory_user"
    assert metadata["entryId"] == "entry-1"
    assert metadata["bookId"] == "book-1"
    assert metadata["contentId"] == "book-1"
    assert metadata["speakerMode"] == "multi"
    assert metadata["hash"] == "abc123"
    assert metadata["deviceLabel"] == "Pixel 8"

    listed = client.get("/reader/offline/metadata", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["count"] == 1
    assert listed.json()["metadata"][0]["entryId"] == "entry-1"

    merged = client.put(
        "/reader/offline/metadata/entry-1",
        headers=headers,
        json={
            "chapterTitle": "Updated chapter title",
            "deviceMarker": "tablet-secondary",
        },
    )
    assert merged.status_code == 200
    merged_metadata = merged.json()["metadata"]
    assert merged_metadata["contentId"] == "book-1"
    assert merged_metadata["chapterIndex"] == 2
    assert merged_metadata["chapterTitle"] == "Updated chapter title"
    assert merged_metadata["deviceMarker"] == "tablet-secondary"

    deleted = client.delete("/reader/offline/metadata/entry-1", headers=headers)
    assert deleted.status_code == 200
    assert deleted.json()["deleted"] is True

    empty = client.get("/reader/offline/metadata", headers=headers)
    assert empty.status_code == 200
    assert empty.json()["metadata"] == []


def test_reader_offline_metadata_firestore_docs_are_user_scoped(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "VF_REQUIRE_EMAIL_VERIFIED", False)
    monkeypatch.setattr(backend_app, "VF_USER_ID_REQUIRED", False)
    monkeypatch.setattr(backend_app, "VF_READER_FIRESTORE_LISTS_ENABLED", True)

    store: dict[str, dict] = {}
    collection = _FakeCollection(store)
    monkeypatch.setattr(
        backend_app,
        "_firestore_collection",
        lambda name: collection if str(name) == backend_app.READER_OFFLINE_METADATA_COLLECTION else None,
    )
    monkeypatch.setattr(
        backend_app,
        "_verify_firebase_id_token",
        lambda token: {"uid": "reader_firestore_user_a" if "user-a" in str(token) else "reader_firestore_user_b"},
    )

    client = TestClient(backend_app.app)

    user_a_headers = _auth_headers("user-a-token")
    user_b_headers = _auth_headers("user-b-token")

    created_a = client.put(
        "/reader/offline/metadata/shared-entry",
        headers=user_a_headers,
        json={
            "contentId": "book-a",
            "chapterTitle": "User A chapter",
            "speakerMode": "single",
            "sizeBytes": 111,
        },
    )
    assert created_a.status_code == 200
    assert created_a.json()["metadata"]["uid"] == "reader_firestore_user_a"

    created_b = client.put(
        "/reader/offline/metadata/shared-entry",
        headers=user_b_headers,
        json={
            "contentId": "book-b",
            "chapterTitle": "User B chapter",
            "speakerMode": "multi",
            "sizeBytes": 222,
        },
    )
    assert created_b.status_code == 200
    assert created_b.json()["metadata"]["uid"] == "reader_firestore_user_b"

    listed_a = client.get("/reader/offline/metadata", headers=user_a_headers)
    listed_b = client.get("/reader/offline/metadata", headers=user_b_headers)
    assert listed_a.status_code == 200
    assert listed_b.status_code == 200
    assert listed_a.json()["metadata"][0]["contentId"] == "book-a"
    assert listed_b.json()["metadata"][0]["contentId"] == "book-b"

    deleted_b = client.delete("/reader/offline/metadata/shared-entry", headers=user_b_headers)
    assert deleted_b.status_code == 200

    after_a = client.get("/reader/offline/metadata", headers=user_a_headers)
    after_b = client.get("/reader/offline/metadata", headers=user_b_headers)
    assert after_a.json()["metadata"][0]["contentId"] == "book-a"
    assert after_b.json()["metadata"] == []
