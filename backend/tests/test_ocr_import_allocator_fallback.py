from __future__ import annotations

import re

from shared.gemini_allocator import GeminiRateAllocator

import backend.app as backend_app


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None, text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self) -> dict:
        return self._payload


def _make_key(seed: int) -> str:
    return f"AIza{seed:030d}"


def test_ocr_fallback_uses_multimodal_model_order(monkeypatch) -> None:
    key = _make_key(11)
    route = list(backend_app.GEMINI_ALLOCATOR_CONFIG.routes["ocr"])
    assert route == ["gemini-2.5-flash", "gemini-3-flash", "gemini-2.5-flash-lite"]

    calls: list[str] = []

    def _fake_post(url: str, json: dict, timeout: tuple[int, int]):  # noqa: A002
        del json, timeout
        match = re.search(r"/models/([^:]+):generateContent", url)
        model = match.group(1) if match else ""
        calls.append(model)
        if model in route[:2]:
            return _FakeResponse(500, text=f"{model} failed")
        return _FakeResponse(
            200,
            payload={
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {"text": "Chapter 1"},
                                {"text": "Recovered text"},
                            ]
                        }
                    }
                ]
            },
        )

    monkeypatch.setattr(
        backend_app,
        "BACKEND_GEMINI_ALLOCATOR",
        GeminiRateAllocator(backend_app.GEMINI_ALLOCATOR_CONFIG, wait_slice_ms=100),
    )
    monkeypatch.setattr(backend_app, "_resolve_gemini_fallback_key_pool", lambda: [key])
    monkeypatch.setattr(backend_app.requests, "post", _fake_post)

    extracted = backend_app._extract_text_with_gemini_fallback(
        media_bytes=b"binary-image",
        mime_type="image/png",
        language_hint="auto",
        task_label="novel page",
    )
    assert "Chapter 1" in extracted
    assert calls[:3] == route


def test_ocr_fallback_exhaustion_returns_retry_metadata(monkeypatch) -> None:
    key = _make_key(12)
    allocator = GeminiRateAllocator(backend_app.GEMINI_ALLOCATOR_CONFIG, wait_slice_ms=100)
    route = list(backend_app.GEMINI_ALLOCATOR_CONFIG.routes["ocr"])

    # Saturate each OCR lane to its per-model RPM budget for this key.
    for model_id in route:
        limit = backend_app.GEMINI_ALLOCATOR_CONFIG.models[model_id]
        for _ in range(limit.rpm):
            acquire = allocator.acquire_for_models(
                model_candidates=[model_id],
                key_pool=[key],
                requested_tokens=1,
                wait_timeout_ms=1000,
            )
            assert acquire.lease is not None
            allocator.release(acquire.lease, success=True, used_tokens=1)

    def _never_called(*args, **kwargs):
        raise AssertionError("requests.post should not be called when allocator is fully exhausted")

    monkeypatch.setattr(backend_app, "BACKEND_GEMINI_ALLOCATOR", allocator)
    monkeypatch.setattr(backend_app, "BACKEND_GEMINI_ALLOCATOR_WAIT_TIMEOUT_MS", 1000)
    monkeypatch.setattr(backend_app, "_resolve_gemini_fallback_key_pool", lambda: [key])
    monkeypatch.setattr(backend_app.requests, "post", _never_called)

    try:
        backend_app._extract_text_with_gemini_fallback(
            media_bytes=b"binary-image",
            mime_type="image/png",
            language_hint="auto",
            task_label="novel page",
        )
        raise AssertionError("Expected allocator exhaustion to raise RuntimeError")
    except RuntimeError as exc:
        message = str(exc)
        assert "retryAfterMs=" in message
        match = re.search(r"retryAfterMs=(\d+)", message)
        assert match is not None
        assert int(match.group(1)) > 0
