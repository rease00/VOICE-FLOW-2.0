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


def _make_window(index: int, *, queued: bool = False) -> dict[str, object]:
    text = f"Window {index} text."
    return {
        "index": index,
        "startChar": index * 80,
        "endChar": index * 80 + len(text),
        "charCount": len(text),
        "text": text,
        "jobId": f"existing-window-{index}" if queued else "",
        "status": "queued" if queued else "idle",
        "purged": False,
        "audioEngine": "tts_hd",
    }


def _make_panel(index: int, *, queued: bool = False) -> dict[str, object]:
    text = f"Panel {index} text."
    return {
        "index": index,
        "pageId": f"page_{index:04d}",
        "panelId": f"panel_{index:04d}",
        "direction": "vertical-scroll",
        "text": text,
        "speaker": "Narrator",
        "emotion": "Neutral",
        "sfx": [],
        "audioJobId": f"existing-panel-{index}" if queued else "",
        "audioStatus": "queued" if queued else "idle",
        "purged": False,
        "audioEngine": "tts_hd",
    }


def _seed_session(session: dict[str, object]) -> None:
    backend_app._INMEMORY_READER_SESSIONS[str(session["id"])] = dict(session)


def _base_session(
    *,
    session_id: str,
    uid: str,
    content_kind: str,
    units_key: str,
    units: list[dict[str, object]],
) -> dict[str, object]:
    return {
        "id": session_id,
        "uid": uid,
        "workKey": f"{content_kind}:{session_id}",
        "sourceKind": "catalog",
        "itemId": f"{session_id}-item",
        "uploadId": "",
        "title": "Reader Prime Session",
        "contentKind": content_kind,
        "surface": "books" if content_kind == "book" else "comics",
        "regionId": "english",
        "direction": "vertical-scroll",
        "readingMode": "vertical_strip",
        "sourceLanguage": "en",
        "targetLanguage": "en",
        "pageViewMode": "original",
        "ttsLanguageMode": "source",
        "audioEngine": "tts_hd",
        "audioEngineStatus": "active",
        "multiSpeakerEnabled": False,
        "voiceMode": "single",
        "effectiveMultiSpeakerMode": "single",
        "translationState": "idle",
        "translationLeadRatio": 0.0,
        "voiceFallbacks": {},
        "createdAtMs": 1,
        "updatedAtMs": 1,
        "consumedChars": 0,
        "currentPanelIndex": 0,
        "totalChars": sum(int(item.get("charCount") or 0) for item in units) if units_key == "windows" else 0,
        "totalPanels": len(units) if units_key == "panels" else 0,
        "provider": "catalog",
        "license": "Public domain",
        "commercialUseStatus": "allowed",
        "commercialUseReason": None,
        "coverUrl": "",
        "summary": "Prime test session.",
        "sourceUrl": "",
        "collectionLabel": "Reader Catalog",
        "stats": {},
        "windows": units if units_key == "windows" else [],
        "panels": units if units_key == "panels" else [],
        "cachedChars": 0,
        "deleteAtMs": 0,
        "exportedWindowIndexes": [],
        "exportedPanelIndexes": [],
        "castMemory": {"Narrator": "v22"},
        "defaultVoiceId": "v22",
        "musicTrackId": "m_none",
        "autoAdvanceProfile": "off",
        "prep": {
            "state": "ready",
            "stage": "audio",
            "completedItems": 0,
            "totalItems": len(units),
            "failedItems": 0,
        },
        "restoreState": {
            "activeItemIndex": 0,
            "activeUnitId": "",
            "viewportAnchor": "",
        },
    }


def _queued_job_summary(job_id: str) -> dict[str, object]:
    return {
        "jobId": job_id,
        "status": "queued",
        "engine": "VECTOR",
        "chunkCursorNext": 0,
        "playableChunks": 0,
        "playableDurationMs": 0,
        "downloadUrl": f"/tts/v2/jobs/{job_id}/result/audio",
    }


def _patch_queue_prime_dependencies(monkeypatch) -> list[str]:
    create_calls: list[str] = []

    def _fake_create_tts_job_with_audio_engine_fallback(request, *, session, text, request_id, voice_id, language, multi_speaker_mode=None, line_map=None, speaker_voices=None):  # type: ignore[no-untyped-def]
        create_calls.append(request_id)
        return dict(session), f"job-{len(create_calls)}", "tts_hd"

    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "_reader_create_tts_job_with_audio_engine_fallback", _fake_create_tts_job_with_audio_engine_fallback)
    monkeypatch.setattr(backend_app, "_reader_job_status_summary", lambda _uid, job_id: _queued_job_summary(job_id))
    monkeypatch.setattr(backend_app, "_reader_session_set", lambda payload: dict(payload))
    monkeypatch.setattr(backend_app, "_reader_progress_set", lambda *args, **kwargs: {})
    return create_calls


def test_reader_queue_prime_queues_multiple_book_windows(monkeypatch) -> None:
    create_calls = _patch_queue_prime_dependencies(monkeypatch)
    client = TestClient(backend_app.app)

    session_id = "reader_queue_prime_book"
    uid = "reader_queue_prime_user"
    windows = [_make_window(0, queued=True), *[_make_window(index) for index in range(1, 8)]]
    _seed_session(_base_session(session_id=session_id, uid=uid, content_kind="book", units_key="windows", units=windows))

    response = client.post(
        f"/reader/sessions/{session_id}/queue/prime",
        headers={"x-dev-uid": uid},
        json={"mode": "book_paragraph", "lookaheadUnits": 4, "fromActiveIndex": 0},
    )

    assert response.status_code == 200
    payload = response.json()["session"]
    queued_indexes = [int(item.get("index") or 0) for item in payload["windows"] if str(item.get("jobId") or "").strip()]
    assert queued_indexes == [0, 1, 2, 3, 4]
    assert create_calls == [
        f"{session_id}_window_1",
        f"{session_id}_window_2",
        f"{session_id}_window_3",
        f"{session_id}_window_4",
    ]


def test_reader_queue_prime_invalid_mode_and_lookahead_clamp_on_comics(monkeypatch) -> None:
    create_calls = _patch_queue_prime_dependencies(monkeypatch)
    client = TestClient(backend_app.app)

    session_id = "reader_queue_prime_comic"
    uid = "reader_queue_prime_user"
    panels = [_make_panel(0, queued=True), *[_make_panel(index) for index in range(1, 30)]]
    _seed_session(_base_session(session_id=session_id, uid=uid, content_kind="comic", units_key="panels", units=panels))

    response = client.post(
        f"/reader/sessions/{session_id}/queue/prime",
        headers={"x-dev-uid": uid},
        json={"mode": "not-a-real-mode", "lookaheadUnits": 99, "fromActiveIndex": 0},
    )

    assert response.status_code == 200
    payload = response.json()["session"]
    queued_indexes = [int(item.get("index") or 0) for item in payload["panels"] if str(item.get("audioJobId") or "").strip()]
    assert queued_indexes == list(range(25))
    assert len(create_calls) == 24
    assert create_calls[0] == f"{session_id}_panel_1"
    assert create_calls[-1] == f"{session_id}_panel_24"


def test_reader_comic_session_progress_can_reach_one_hundred_percent(monkeypatch) -> None:
    _patch_queue_prime_dependencies(monkeypatch)
    client = TestClient(backend_app.app)

    session_id = "reader_comic_progress"
    uid = "reader_queue_prime_user"
    panels = [_make_panel(index) for index in range(25)]
    session = _base_session(session_id=session_id, uid=uid, content_kind="comic", units_key="panels", units=panels)
    session["currentPanelIndex"] = len(panels) - 1
    _seed_session(session)

    response = client.get(f"/reader/sessions/{session_id}", headers={"x-dev-uid": uid})

    assert response.status_code == 200
    payload = response.json()["session"]
    assert payload["progressPct"] == 100.0
