from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = BACKEND_ROOT.parent
for candidate in (str(BACKEND_ROOT), str(WORKSPACE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

import backend.app as backend_app


def _make_dashboard_item(
    item_id: str,
    title: str,
    *,
    surface: str,
    content_kind: str,
) -> dict[str, object]:
    return {
        "id": item_id,
        "title": title,
        "author": "Reader Author",
        "regionId": "english",
        "contentKind": content_kind,
        "surface": surface,
        "provider": "standard_ebooks",
        "license": "Public domain",
        "updatedAt": "2026-03-27T00:00:00Z",
        "createdAt": "2026-03-27T00:00:00Z",
        "commercialUseStatus": "allowed",
        "commercialUseReason": None,
        "resume": {
            "hasProgress": surface != "uploads",
            "progressPct": 67.5,
            "updatedAt": "2026-03-27T00:00:00Z",
            "sessionId": "session-1" if surface != "uploads" else "",
        },
    }


def _make_dashboard_library(
    *,
    continue_reading: list[dict[str, object]],
    trending: list[dict[str, object]],
    active_session: dict[str, object] | None,
) -> dict[str, object]:
    return {
        "surface": "all",
        "regionId": "english",
        "regions": [{"id": "english", "label": "English"}],
        "items": [*continue_reading, *trending],
        "activeSession": active_session,
        "activeSessions": [active_session] if active_session else [],
        "counts": {
            "all": len(continue_reading) + len(trending),
            "visible": len(continue_reading) + len(trending),
            "books": len([item for item in [*continue_reading, *trending] if str(item.get("contentKind") or "") == "book"]),
            "comics": len([item for item in [*continue_reading, *trending] if str(item.get("contentKind") or "") == "comic"]),
            "uploads": len([item for item in [*continue_reading, *trending] if str(item.get("surface") or "") == "uploads"]),
            "resumable": len(continue_reading),
        },
        "facets": {
            "providers": ["standard_ebooks"],
            "collections": ["Reader Library"],
            "progressStates": ["all", "in_progress", "ready", "new"],
        },
        "shelves": {
            "continueReading": continue_reading,
            "trending": trending,
            "newArrivals": [*continue_reading, *trending],
            "recentlyImported": [item for item in [*continue_reading, *trending] if str(item.get("surface") or "") == "uploads"],
        },
        "commercialPolicyVersion": backend_app.COMMERCIAL_POLICY_VERSION,
        "blockedProviders": backend_app._commercial_policy_blocked_providers([*continue_reading, *trending]),
    }


def _make_active_session() -> dict[str, object]:
    return {
        "id": "session-1",
        "title": "Continue Session",
        "contentKind": "book",
        "surface": "books",
        "workKey": "catalog:session-1",
        "sourceKind": "catalog",
        "progressPct": 42.5,
        "readiness": {
            "state": "ready",
            "label": "Ready",
            "playableItems": 1,
        },
        "prep": {
            "state": "ready",
            "stage": "audio",
            "completedItems": 4,
            "totalItems": 4,
            "failedItems": 0,
        },
    }


def test_reader_dashboard_auth_and_x_dev_uid_path(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    client = TestClient(backend_app.app)

    denied = client.get("/reader/dashboard")
    assert denied.status_code == 401

    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_reader_preferences_get", lambda _uid: {"regionId": "english"})
    monkeypatch.setattr(
        backend_app,
        "_reader_build_library_payload",
        lambda _uid, **_kwargs: _make_dashboard_library(
            continue_reading=[_make_dashboard_item("continue-1", "Continue One", surface="books", content_kind="book")],
            trending=[_make_dashboard_item("trending-1", "Trending One", surface="comics", content_kind="comic")],
            active_session=_make_active_session(),
        ),
    )

    allowed = client.get("/reader/dashboard", headers={"x-dev-uid": "reader_dashboard_user"})
    assert allowed.status_code == 200
    assert allowed.json()["dashboard"]["mission"]["ctaText"] == "Open your library and press Play"


def test_reader_dashboard_payload_includes_expected_sections(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_reader_preferences_get", lambda _uid: {"regionId": "english"})
    monkeypatch.setattr(
        backend_app,
        "_reader_build_library_payload",
        lambda _uid, **_kwargs: _make_dashboard_library(
            continue_reading=[_make_dashboard_item("continue-1", "Continue One", surface="books", content_kind="book")],
            trending=[_make_dashboard_item("trending-1", "Trending One", surface="comics", content_kind="comic")],
            active_session=_make_active_session(),
        ),
    )

    client = TestClient(backend_app.app)
    response = client.get("/reader/dashboard", headers={"x-dev-uid": "reader_dashboard_user"})
    assert response.status_code == 200

    dashboard = response.json()["dashboard"]
    assert isinstance(dashboard["library"], dict)
    assert isinstance(dashboard["library"]["items"], list)
    assert dashboard["mission"]["title"] == "Play any novel, manga, or comic with AI TTS"
    assert dashboard["mission"]["subtitle"]
    assert dashboard["mission"]["ctaText"] == "Open your library and press Play"
    assert dashboard["highlights"] == {
        "library": 2,
        "resumable": 1,
        "uploads": 0,
        "comics": 1,
        "books": 1,
    }
    assert set(dashboard["shelves"]) == {"continueReading", "trending", "newArrivals", "recentlyImported"}
    assert dashboard["shelves"]["continueReading"][0]["id"] == "continue-1"
    assert dashboard["activeSessionSummary"]["id"] == "session-1"
    assert dashboard["commercialPolicyVersion"] == backend_app.COMMERCIAL_POLICY_VERSION
    assert isinstance(dashboard["blockedProviders"], list)


def test_reader_dashboard_spotlight_falls_back_to_trending(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_reader_preferences_get", lambda _uid: {"regionId": "english"})
    monkeypatch.setattr(
        backend_app,
        "_reader_build_library_payload",
        lambda _uid, **_kwargs: _make_dashboard_library(
            continue_reading=[],
            trending=[_make_dashboard_item("trending-1", "Trending One", surface="comics", content_kind="comic")],
            active_session=None,
        ),
    )

    client = TestClient(backend_app.app)
    response = client.get("/reader/dashboard", headers={"x-dev-uid": "reader_dashboard_user"})
    assert response.status_code == 200

    dashboard = response.json()["dashboard"]
    assert dashboard["spotlight"]["id"] == "trending-1"
    assert dashboard["shelves"]["continueReading"] == []


def test_reader_dashboard_forwards_query_params_to_library_payload(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_reader_preferences_get", lambda _uid: {"regionId": "english"})

    captured: dict[str, object] = {}

    def _capture_library_payload(uid: str, **kwargs):  # type: ignore[no-untyped-def]
        captured["uid"] = uid
        captured.update(kwargs)
        return _make_dashboard_library(
            continue_reading=[],
            trending=[],
            active_session=None,
        )

    monkeypatch.setattr(backend_app, "_reader_build_library_payload", _capture_library_payload)

    client = TestClient(backend_app.app)
    response = client.get(
        "/reader/dashboard?surface=comics&regionId=japanese&search=moon%20light",
        headers={"x-dev-uid": "reader_dashboard_user"},
    )
    assert response.status_code == 200
    assert captured["uid"] == "reader_dashboard_user"
    assert captured["surface"] == "comics"
    assert captured["region_id"] == "japanese"
    assert captured["search_query"] == "moon light"


def test_reader_dashboard_recency_ordering_uses_latest_session_updates(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_reader_preferences_get", lambda _uid: {"regionId": "english"})
    monkeypatch.setattr(backend_app, "_reader_upload_list", lambda _uid: [])
    monkeypatch.setattr(backend_app, "normalize_reader_catalog_item", lambda item: dict(item))
    monkeypatch.setattr(
        backend_app,
        "_reader_catalog_items",
        lambda *args, **kwargs: [
            {
                "id": "item-old",
                "title": "Older Item",
                "author": "Reader Author",
                "contentKind": "book",
                "surface": "books",
                "updatedAt": "2026-03-27T00:00:01Z",
                "createdAt": "2026-03-27T00:00:01Z",
                "sessionId": "session-old",
                "resume": {"hasProgress": True, "progressPct": 20, "updatedAt": "2026-03-27T00:00:01Z"},
            },
            {
                "id": "item-new",
                "title": "Newer Item",
                "author": "Reader Author",
                "contentKind": "book",
                "surface": "books",
                "updatedAt": "2026-03-27T00:00:02Z",
                "createdAt": "2026-03-27T00:00:02Z",
                "sessionId": "session-new",
                "resume": {"hasProgress": True, "progressPct": 80, "updatedAt": "2026-03-27T00:00:02Z"},
            },
        ] if str(kwargs.get("surface") or (args[1] if len(args) > 1 else "")).strip() == "books" else [],
    )
    monkeypatch.setattr(backend_app, "_reader_progress_list", lambda _uid: [])
    monkeypatch.setattr(backend_app, "_reader_is_discovery_item_allowed", lambda _item: True)
    monkeypatch.setattr(
        backend_app,
        "_reader_session_list",
        lambda _uid: [
            {
                "id": "session-old",
                "updatedAtMs": 1_000,
                "updatedAt": "2026-03-27T00:00:01Z",
                "workKey": "catalog:item-old",
                "contentKind": "book",
            },
            {
                "id": "session-new",
                "updatedAtMs": 2_000,
                "updatedAt": "2026-03-27T00:00:02Z",
                "workKey": "catalog:item-new",
                "contentKind": "book",
            },
        ],
    )
    monkeypatch.setattr(backend_app, "_reader_refresh_session", lambda session: dict(session))
    monkeypatch.setattr(backend_app, "_reader_session_is_reusable", lambda _session: True)
    monkeypatch.setattr(backend_app, "_reader_session_set", lambda payload: dict(payload))
    monkeypatch.setattr(backend_app, "_reader_decorate_catalog_item", lambda _uid, item, **_kwargs: dict(item))

    library = backend_app._reader_build_library_payload("reader_dashboard_user", surface="all", region_id="english", search_query="")
    continue_reading = library["shelves"]["continueReading"]
    active_session = library["activeSession"]

    assert [str(item.get("sessionId") or "") for item in continue_reading] == ["session-new", "session-old"]
    assert str(active_session.get("id") or "") == "session-new"
