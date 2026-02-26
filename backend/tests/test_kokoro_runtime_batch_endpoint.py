from __future__ import annotations

import base64
import importlib.util
import sys
import types as pytypes
from pathlib import Path

from fastapi.testclient import TestClient


def _load_kokoro_runtime_module():
    root = Path(__file__).resolve().parents[2]
    runtime_dir = root / "engines" / "kokoro-runtime"
    module_path = runtime_dir / "app.py"
    if str(runtime_dir) not in sys.path:
        sys.path.insert(0, str(runtime_dir))
    fake_kokoro = pytypes.ModuleType("kokoro")

    class _StubPipeline:
        def __init__(self, lang_code: str) -> None:
            self.lang_code = lang_code

        def __call__(self, *_: object, **__: object):
            return iter([])

    fake_kokoro.KPipeline = _StubPipeline
    sys.modules["kokoro"] = fake_kokoro
    spec = importlib.util.spec_from_file_location("kokoro_runtime_app", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_kokoro_batch_endpoint_present() -> None:
    runtime = _load_kokoro_runtime_module()
    paths = {getattr(route, "path", "") for route in runtime.app.routes}
    assert "/synthesize/batch" in paths


def test_kokoro_batch_returns_ordered_results(monkeypatch) -> None:
    runtime = _load_kokoro_runtime_module()
    monkeypatch.setattr(runtime.kokoro_full, "ready", True, raising=False)
    monkeypatch.setattr(runtime.kokoro_full, "error", None, raising=False)

    def _stub_synthesize(
        text: str,
        voice_id: str,
        speed: float,
        language_hint: str | None,
        trace_id: str | None = None,
    ):
        wav_bytes = f"wav::{text}".encode("utf-8")
        return wav_bytes, {
            "voice": voice_id,
            "segments": 1,
            "word_count": len(text.split()),
            "sample_rate": runtime.KOKORO_SAMPLE_RATE,
        }

    monkeypatch.setattr(runtime.kokoro_full, "synthesize", _stub_synthesize)

    client = TestClient(runtime.app)
    response = client.post(
        "/synthesize/batch",
        json={
            "parallelism": 2,
            "items": [
                {"id": "a", "text": "hello one", "voiceId": "hf_alpha"},
                {"id": "b", "text": "hello two", "voice_id": "hf_beta"},
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["summary"]["requested"] == 2
    assert payload["summary"]["succeeded"] == 2
    assert payload["summary"]["failed"] == 0
    assert [item["index"] for item in payload["items"]] == [0, 1]
    assert [item["id"] for item in payload["items"]] == ["a", "b"]
    assert base64.b64decode(payload["items"][0]["audioBase64"]) == b"wav::hello one"
    assert base64.b64decode(payload["items"][1]["audioBase64"]) == b"wav::hello two"


def test_kokoro_batch_invalid_limits_return_400(monkeypatch) -> None:
    runtime = _load_kokoro_runtime_module()
    client = TestClient(runtime.app)

    monkeypatch.setattr(runtime, "KOKORO_BATCH_MAX_ITEMS", 1)
    too_many = client.post(
        "/synthesize/batch",
        json={
            "items": [
                {"text": "one"},
                {"text": "two"},
            ],
        },
    )
    assert too_many.status_code == 400

    monkeypatch.setattr(runtime, "KOKORO_BATCH_MAX_PARALLEL", 1)
    bad_parallel = client.post(
        "/synthesize/batch",
        json={
            "parallelism": 2,
            "items": [{"text": "one"}],
        },
    )
    assert bad_parallel.status_code == 400


def test_kokoro_batch_partial_failure_keeps_success_items(monkeypatch) -> None:
    runtime = _load_kokoro_runtime_module()
    monkeypatch.setattr(runtime.kokoro_full, "ready", True, raising=False)
    monkeypatch.setattr(runtime.kokoro_full, "error", None, raising=False)

    def _stub_synthesize(
        text: str,
        voice_id: str,
        speed: float,
        language_hint: str | None,
        trace_id: str | None = None,
    ):
        if "fail" in text.lower():
            raise RuntimeError("forced kokoro failure")
        return b"wav-ok", {
            "voice": voice_id,
            "segments": 1,
            "word_count": 2,
            "sample_rate": runtime.KOKORO_SAMPLE_RATE,
        }

    monkeypatch.setattr(runtime.kokoro_full, "synthesize", _stub_synthesize)

    client = TestClient(runtime.app)
    response = client.post(
        "/synthesize/batch",
        json={
            "items": [
                {"id": "ok", "text": "normal text"},
                {"id": "bad", "text": "please fail now"},
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["summary"]["requested"] == 2
    assert payload["summary"]["succeeded"] == 1
    assert payload["summary"]["failed"] == 1
    assert payload["items"][0]["ok"] is True
    assert payload["items"][1]["ok"] is False
    assert payload["items"][1]["error"]["statusCode"] == 500
