from __future__ import annotations

import app as backend_app


def test_media_health_ready_is_ffmpeg_driven_after_vc_removal(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "_get_ffmpeg_path", lambda: "/usr/bin/ffmpeg")

    backend_app._run_media_health_refresh()
    payload = backend_app._media_health_snapshot()

    assert payload["coreReady"] is True
    assert payload["ready"] is True
    assert "voiceTransferRequired" not in payload
    assert "voiceTransfer" not in payload
