from __future__ import annotations

import base64
import json
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

from video_dubbing.config import build_config
from video_dubbing.pipeline import stage6_tts


def _write_wav(path: Path, seconds: float = 2.0, sample_rate: int = 24000) -> None:
    samples = max(1, int(seconds * sample_rate))
    wave = np.linspace(-0.25, 0.25, samples, dtype=np.float32)
    sf.write(str(path), wave, sample_rate)


def _wav_bytes(sample_rate: int = 24000) -> bytes:
    signal = np.zeros(max(1, int(sample_rate * 0.25)), dtype=np.float32)
    out = BytesIO()
    sf.write(out, signal, sample_rate, format="WAV")
    return out.getvalue()


class _FakeResponse:
    def __init__(
        self,
        content: bytes = b"",
        status_code: int = 200,
        *,
        json_payload: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.content = content
        self.status_code = status_code
        self._json_payload = json_payload
        self.headers = headers or {}

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"upstream failed: {self.status_code}")

    def json(self) -> dict[str, Any]:
        if self._json_payload is not None:
            return dict(self._json_payload)
        if not self.content:
            return {}
        return json.loads(self.content.decode("utf-8"))


def test_stage6_tts_auto_route_prefers_kokoro_for_hindi(monkeypatch, tmp_path: Path) -> None:
    cfg = build_config(tmp_path)
    cfg.gemini_runtime_url = "http://gem-runtime"
    cfg.kokoro_runtime_url = "http://kokoro-runtime"
    vocals = cfg.output_root / "vocals.wav"
    _write_wav(vocals)

    calls: list[dict[str, Any]] = []

    def _stub_post(url: str, json: dict[str, Any], timeout: int) -> _FakeResponse:
        calls.append({"url": url, "json": dict(json), "timeout": timeout})
        return _FakeResponse(_wav_bytes())

    monkeypatch.setattr(stage6_tts.requests, "post", _stub_post)

    ctx = {
        "segments": [
            {
                "start": 0.0,
                "end": 1.0,
                "speaker": "SPEAKER_00",
                "text": "नमस्ते दुनिया",
                "translated_text": "नमस्ते दुनिया",
                "voice_id": "hf_alpha",
            }
        ],
        "target_language": "hi",
        "vocals": str(vocals),
        "output_dir": str(cfg.output_root),
        "tts_route": "auto",
    }

    result = stage6_tts.run(ctx, cfg, lambda _: None)

    assert len(calls) == 1
    assert calls[0]["url"] == "http://kokoro-runtime/synthesize"
    assert result["tts_requests"][0]["engine"] == "KOKORO"
    assert result["tts_segments"][0]["engine"] == "KOKORO"


def test_stage6_tts_route_gem_only(monkeypatch, tmp_path: Path) -> None:
    cfg = build_config(tmp_path)
    cfg.gemini_runtime_url = "http://gem-runtime"
    cfg.kokoro_runtime_url = "http://kokoro-runtime"
    vocals = cfg.output_root / "vocals.wav"
    _write_wav(vocals)

    calls: list[dict[str, Any]] = []

    def _stub_post(url: str, json: dict[str, Any], timeout: int) -> _FakeResponse:
        calls.append({"url": url, "json": dict(json), "timeout": timeout})
        return _FakeResponse(_wav_bytes())

    monkeypatch.setattr(stage6_tts.requests, "post", _stub_post)

    ctx = {
        "segments": [
            {
                "start": 0.0,
                "end": 1.0,
                "speaker": "Speaker A",
                "text": "hello",
                "translated_text": "hello",
                "voice_id": "alloy",
            }
        ],
        "target_language": "en",
        "vocals": str(vocals),
        "output_dir": str(cfg.output_root),
        "tts_route": "gem_only",
    }

    result = stage6_tts.run(ctx, cfg, lambda _: None)

    assert len(calls) == 1
    assert calls[0]["url"] == "http://gem-runtime/synthesize"
    assert result["tts_requests"][0]["engine"] == "GEM"
    assert result["tts_segments"][0]["engine"] == "GEM"


def test_stage6_tts_auto_route_falls_back_to_gem(monkeypatch, tmp_path: Path) -> None:
    cfg = build_config(tmp_path)
    cfg.gemini_runtime_url = "http://gem-runtime"
    cfg.kokoro_runtime_url = "http://kokoro-runtime"
    vocals = cfg.output_root / "vocals.wav"
    _write_wav(vocals)

    calls: list[dict[str, Any]] = []

    def _stub_post(url: str, json: dict[str, Any], timeout: int) -> _FakeResponse:
        calls.append({"url": url, "json": dict(json), "timeout": timeout})
        if "kokoro-runtime" in url:
            return _FakeResponse(b"", status_code=503)
        return _FakeResponse(_wav_bytes())

    monkeypatch.setattr(stage6_tts.requests, "post", _stub_post)

    ctx = {
        "segments": [
            {
                "start": 0.0,
                "end": 1.0,
                "speaker": "Speaker A",
                "text": "नमस्ते",
                "translated_text": "नमस्ते",
                "voice_id": "hf_alpha",
            }
        ],
        "target_language": "hi",
        "vocals": str(vocals),
        "output_dir": str(cfg.output_root),
        "tts_route": "auto",
    }

    result = stage6_tts.run(ctx, cfg, lambda _: None)
    assert len(calls) == 2
    assert calls[0]["url"] == "http://kokoro-runtime/synthesize"
    assert calls[1]["url"] == "http://gem-runtime/synthesize"
    assert result["tts_requests"][0]["engine"] == "GEM"
    assert result["tts_segments"][0]["engine"] == "GEM"


def test_stage6_tts_grouped_gemini_structured_success(monkeypatch, tmp_path: Path) -> None:
    cfg = build_config(tmp_path)
    cfg.gemini_runtime_url = "http://gem-runtime"
    cfg.kokoro_runtime_url = "http://kokoro-runtime"
    cfg.gemini_pair_group_max_concurrency = 7
    cfg.gemini_pair_group_retry_once = True
    cfg.gemini_pair_group_timeout_sec = 240
    vocals = cfg.output_root / "vocals.wav"
    _write_wav(vocals)

    calls: list[dict[str, Any]] = []

    def _chunk_wav_base64(line_index: int) -> str:
        signal = np.full(max(1, int(24000 * 0.1)), (line_index + 1) / 20.0, dtype=np.float32)
        out = BytesIO()
        sf.write(out, signal, 24000, format="WAV")
        return base64.b64encode(out.getvalue()).decode("ascii")

    def _stub_post(url: str, json: dict[str, Any], timeout: int) -> _FakeResponse:
        calls.append({"url": url, "json": dict(json), "timeout": timeout})
        if url.endswith("/synthesize/structured"):
            line_map = list(json.get("multi_speaker_line_map") or [])
            line_chunks = [
                {
                    "lineIndex": int(item.get("lineIndex", 0)),
                    "audioBase64": _chunk_wav_base64(int(item.get("lineIndex", 0))),
                    "contentType": "audio/wav",
                    "splitMode": "duration",
                    "silenceFallback": False,
                }
                for item in line_map
            ]
            payload = {
                "ok": True,
                "wavBase64": _chunk_wav_base64(0),
                "lineChunks": line_chunks,
                "diagnostics": {"realtimeFactorX": 180.0},
            }
            return _FakeResponse(json_payload=payload)
        return _FakeResponse(_wav_bytes())

    monkeypatch.setattr(stage6_tts.requests, "post", _stub_post)

    ctx = {
        "segments": [
            {"start": 0.0, "end": 1.0, "speaker": "A", "translated_text": "hello", "voice_id": "alloy"},
            {"start": 1.0, "end": 2.0, "speaker": "B", "translated_text": "there", "voice_id": "alloy"},
            {"start": 2.0, "end": 3.0, "speaker": "A", "translated_text": "again", "voice_id": "alloy"},
        ],
        "target_language": "en",
        "vocals": str(vocals),
        "output_dir": str(cfg.output_root),
        "tts_route": "auto",
    }

    result = stage6_tts.run(ctx, cfg, lambda _: None)
    assert calls[0]["url"] == "http://gem-runtime/synthesize/structured"
    assert len(result["tts_segments"]) == 3
    assert [item["index"] for item in result["tts_segments"]] == [0, 1, 2]
    assert all(item["engine"] == "GEM" for item in result["tts_segments"])
    assert all(item["strategy"] == "studio_pair_groups" for item in result["tts_requests"])


def test_stage6_tts_grouped_failure_falls_back_to_segmented(monkeypatch, tmp_path: Path) -> None:
    cfg = build_config(tmp_path)
    cfg.gemini_runtime_url = "http://gem-runtime"
    cfg.kokoro_runtime_url = "http://kokoro-runtime"
    vocals = cfg.output_root / "vocals.wav"
    _write_wav(vocals)

    calls: list[dict[str, Any]] = []

    def _stub_post(url: str, json: dict[str, Any], timeout: int) -> _FakeResponse:
        calls.append({"url": url, "json": dict(json), "timeout": timeout})
        if url.endswith("/synthesize/structured"):
            return _FakeResponse(status_code=503)
        return _FakeResponse(_wav_bytes())

    monkeypatch.setattr(stage6_tts.requests, "post", _stub_post)

    ctx = {
        "segments": [
            {"start": 0.0, "end": 1.0, "speaker": "A", "translated_text": "hello", "voice_id": "alloy"},
            {"start": 1.0, "end": 2.0, "speaker": "B", "translated_text": "there", "voice_id": "alloy"},
        ],
        "target_language": "en",
        "vocals": str(vocals),
        "output_dir": str(cfg.output_root),
        "tts_route": "auto",
    }

    result = stage6_tts.run(ctx, cfg, lambda _: None)
    assert calls[0]["url"] == "http://gem-runtime/synthesize/structured"
    fallback_calls = [item for item in calls if item["url"].endswith("/synthesize") and not item["url"].endswith("/synthesize/structured")]
    assert len(fallback_calls) >= 2
    assert len(result["tts_segments"]) == 2
    assert all(item["engine"] == "GEM" for item in result["tts_segments"])
