from __future__ import annotations

import base64
import importlib.util
import sys
import types as pytypes
from pathlib import Path

from fastapi.testclient import TestClient


def _load_kokoro_runtime_module():
    root = Path(__file__).resolve().parents[1]
    runtime_dir = root / "engines" / "kokoro-runtime"
    module_path = runtime_dir / "app.py"
    if str(runtime_dir) not in sys.path:
        sys.path.insert(0, str(runtime_dir))
    fake_kokoro = pytypes.ModuleType("kokoro")

    class _StubPipeline:
        created: list[dict[str, object]] = []

        def __init__(self, lang_code: str, device: str | None = None) -> None:
            self.lang_code = lang_code
            self.device = device
            self.__class__.created.append({"lang_code": lang_code, "device": device})

        def __call__(self, *_: object, **__: object):
            return iter([])

    fake_kokoro.KPipeline = _StubPipeline
    sys.modules["kokoro"] = fake_kokoro
    spec = importlib.util.spec_from_file_location("kokoro_runtime_app", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module._stub_pipeline_cls = _StubPipeline
    return module


def test_kokoro_batch_endpoint_present() -> None:
    runtime = _load_kokoro_runtime_module()
    paths = {getattr(route, "path", "") for route in runtime.app.routes}
    assert "/synthesize/batch" in paths


def test_kokoro_runtime_forces_cpu_pipeline_device() -> None:
    runtime = _load_kokoro_runtime_module()
    runtime._stub_pipeline_cls.created.clear()

    pipeline = runtime.kokoro_full._pipeline_for("h")

    assert pipeline.device == "cpu"
    assert runtime._stub_pipeline_cls.created == [{"lang_code": "h", "device": "cpu"}]


def test_kokoro_runtime_ignores_non_cpu_device_env(monkeypatch) -> None:
    monkeypatch.setenv("KOKORO_DEVICE", "cuda")
    monkeypatch.setenv("CUDA_VISIBLE_DEVICES", "0")

    runtime = _load_kokoro_runtime_module()

    assert runtime.KOKORO_DEVICE == "cpu"
    assert runtime.os.environ.get("KOKORO_DEVICE") == "cpu"
    assert runtime.os.environ.get("CUDA_VISIBLE_DEVICES") == ""
    assert runtime.kokoro_full._pipeline_device == "cpu"


def test_kokoro_health_and_capabilities_report_cpu_only() -> None:
    runtime = _load_kokoro_runtime_module()
    client = TestClient(runtime.app)

    health_response = client.get("/health")
    assert health_response.status_code == 200
    health_payload = health_response.json()
    assert health_payload["device"] == "cpu"
    assert health_payload["device_mode"] == "cpu"
    assert health_payload["provider"] == "cpu"
    assert health_payload["gpu_enabled"] is False
    assert health_payload["openvino_enabled"] is False
    assert health_payload["idle_unload_ms"] == 120000

    capabilities_response = client.get("/v1/capabilities")
    assert capabilities_response.status_code == 200
    capabilities_payload = capabilities_response.json()
    assert capabilities_payload["metadata"]["deviceMode"] == "cpu"
    assert capabilities_payload["metadata"]["provider"] == "cpu"
    assert capabilities_payload["metadata"]["gpuEnabled"] is False
    assert capabilities_payload["metadata"]["openvinoEnabled"] is False
    assert capabilities_payload["metadata"]["idleUnloadMs"] == 120000


def test_kokoro_runtime_keeps_british_english_voice_when_language_hint_is_english() -> None:
    runtime = _load_kokoro_runtime_module()

    assert runtime.kokoro_full.resolve_lang("Hello there.", "bf_emma", "en") == "b"


def test_kokoro_runtime_maps_cross_language_voices_without_collapsing_everyone_to_one_fallback() -> None:
    runtime = _load_kokoro_runtime_module()

    assert runtime.kokoro_full.resolve_lang("The market opens at sunrise.", "hf_alpha", "en") == "a"
    assert runtime.kokoro_full.resolve_voice("af_bella", "h") == "hf_beta"
    assert runtime.kokoro_full.resolve_voice("am_echo", "h") == "hm_psi"
    assert runtime.kokoro_full.resolve_voice("hf_beta", "a") == "af_bella"
    assert runtime.kokoro_full.resolve_voice("hm_psi", "a") == "am_michael"


def test_kokoro_runtime_accepts_spoof_display_names_as_voice_aliases() -> None:
    runtime = _load_kokoro_runtime_module()

    assert runtime.kokoro_full.resolve_voice("Lyra US", "a") == "af_heart"
    assert runtime.kokoro_full.resolve_voice("Kaia US", "h") == "hf_beta"


def test_kokoro_runtime_transliterates_devanagari_hindi_for_synthesis() -> None:
    runtime = _load_kokoro_runtime_module()

    assert runtime.kokoro_full.normalize_text("नमस्ते, यह आवाज २ है।", "h") == "namaste, yaha aavaaja do hai."


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
