from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from fastapi.testclient import TestClient


def _load_gemini_runtime_module():
    workspace_root = Path(__file__).resolve().parents[1]
    runtime_dir = workspace_root / "engines" / "gemini-runtime"
    module_path = runtime_dir / "app.py"
    if str(workspace_root) not in sys.path:
        sys.path.insert(0, str(workspace_root))
    if str(runtime_dir) not in sys.path:
        sys.path.insert(0, str(runtime_dir))
    spec = importlib.util.spec_from_file_location("gemini_runtime_app_cloud_tts", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_cloud_tts_health_and_capabilities_publish_provider_metadata(monkeypatch) -> None:
    runtime = _load_gemini_runtime_module()
    runtime.VF_TTS_UPSTREAM_PROVIDER = runtime.TTS_UPSTREAM_PROVIDER_CLOUD_TTS
    runtime.VF_TTS_TEXTTOSPEECH_ONLY = True
    monkeypatch.setattr(runtime, "_cloud_tts_client_ready", lambda source_policy=None: True)
    monkeypatch.setattr(runtime, "_runtime_source_policy", lambda: {"provider": runtime.SOURCE_POLICY_PROVIDER_VERTEX})

    client = TestClient(runtime.app)

    health = client.get("/health")
    assert health.status_code == 200
    health_payload = health.json()
    assert health_payload["provider"] == "cloud-text-to-speech"
    assert health_payload["ttsProvider"] == "cloud-text-to-speech"
    assert health_payload["textProvider"] == "vertex-ai"
    assert health_payload["supportsMultiSpeaker"] is False

    capabilities = client.get("/v1/capabilities")
    assert capabilities.status_code == 200
    capabilities_payload = capabilities.json()
    metadata = dict(capabilities_payload.get("metadata") or {})
    assert capabilities_payload["ready"] is True
    assert capabilities_payload["supportsMultiSpeaker"] is False
    assert capabilities_payload["model"] == "google-cloud-text-to-speech"
    assert metadata["provider"] == "cloud-text-to-speech"
    assert metadata["ttsProvider"] == "cloud-text-to-speech"
    assert metadata["textProvider"] == "vertex-ai"
    assert metadata["multiSpeakerMaxSpeakersPerCall"] == 0


def test_cloud_tts_synthesis_uses_single_speaker_line_windows_for_grouped_scripts(monkeypatch) -> None:
    runtime = _load_gemini_runtime_module()
    runtime.VF_TTS_UPSTREAM_PROVIDER = runtime.TTS_UPSTREAM_PROVIDER_CLOUD_TTS
    runtime.VF_TTS_TEXTTOSPEECH_ONLY = True
    monkeypatch.setattr(runtime, "_cloud_tts_client_ready", lambda source_policy=None: True)
    monkeypatch.setattr(runtime, "_runtime_source_policy", lambda: {"provider": runtime.SOURCE_POLICY_PROVIDER_VERTEX})

    calls: list[tuple[str, str]] = []

    def _stub_synthesize_window_with_cloud_tts(**kwargs):
        text = str(kwargs.get("text") or "")
        requested_voice = str(kwargs.get("requested_voice") or "")
        calls.append((text, requested_voice))
        return runtime.pcm16_to_wav(b"\x01\x00" * 960, sample_rate=24000), {
            "resolvedVoice": f"cloud::{requested_voice or 'default'}",
        }

    monkeypatch.setattr(runtime, "_synthesize_window_with_cloud_tts", _stub_synthesize_window_with_cloud_tts)

    payload = runtime.SynthesizeRequest(
        text="Host: Hello there.\nGuest: Hi back.",
        voiceName="Fenrir",
        voice_id="Fenrir",
        language="en",
        trace_id="cloud_tts_grouped_test",
        multi_speaker_mode="studio_pair_groups",
        speaker_voices=[
            {"speaker": "Host", "voiceName": "Fenrir"},
            {"speaker": "Guest", "voiceName": "Kore"},
        ],
        multi_speaker_line_map=[
            {"lineIndex": 0, "speaker": "Host", "text": "Hello there."},
            {"lineIndex": 1, "speaker": "Guest", "text": "Hi back."},
        ],
    )

    result = runtime._synthesize_text_to_wav(payload)

    assert len(calls) == 2
    assert calls[0][0] == "Hello there."
    assert calls[1][0] == "Hi back."
    assert result["speechModeUsed"] == "studio_pair_groups"
    assert result["windowCount"] == 2
    diagnostics = dict(result.get("diagnostics") or {})
    assert diagnostics["provider"] == "cloud-text-to-speech"
    assert diagnostics["recoveryUsed"] is False
    assert diagnostics["strategies"] == ["dialogue_three_lane_scheduler", "sentence_aware_chunking"]


def test_cloud_tts_resolves_selected_vertex_slot_credentials(tmp_path) -> None:
    runtime = _load_gemini_runtime_module()
    slot_1 = tmp_path / "slot-1.json"
    slot_2 = tmp_path / "slot-2.json"
    slot_1.write_text("{}", encoding="utf-8")
    slot_2.write_text("{}", encoding="utf-8")

    resolved = runtime._resolve_cloud_tts_credentials_path(
        {
            "vertexServiceAccountRef": str(slot_1),
            "selectedVertexSlotId": "slot_2",
            "vertexAccounts": [
                {"memberId": "slot_1", "vertexServiceAccountRef": str(slot_1)},
                {"memberId": "slot_2", "vertexServiceAccountRef": str(slot_2)},
            ],
        }
    )

    assert resolved == slot_2.resolve()


def test_cloud_tts_client_cache_isolated_by_selected_slot(monkeypatch, tmp_path) -> None:
    runtime = _load_gemini_runtime_module()
    slot_1 = tmp_path / "slot-1.json"
    slot_2 = tmp_path / "slot-2.json"
    slot_1.write_text("{}", encoding="utf-8")
    slot_2.write_text("{}", encoding="utf-8")

    runtime._CLOUD_TTS_CLIENTS.clear()
    built_keys: list[str] = []

    def _stub_build_cloud_tts_client(source_policy=None):
        cache_key = runtime._cloud_tts_client_cache_key(source_policy=source_policy)
        built_keys.append(cache_key)
        return {"cacheKey": cache_key}

    monkeypatch.setattr(runtime, "_build_cloud_tts_client", _stub_build_cloud_tts_client)

    client_a = runtime._cloud_tts_client(
        {
            "selectedVertexSlotId": "slot_1",
            "vertexAccounts": [
                {"memberId": "slot_1", "vertexServiceAccountRef": str(slot_1)},
                {"memberId": "slot_2", "vertexServiceAccountRef": str(slot_2)},
            ],
        }
    )
    client_b = runtime._cloud_tts_client(
        {
            "selectedVertexSlotId": "slot_2",
            "vertexAccounts": [
                {"memberId": "slot_1", "vertexServiceAccountRef": str(slot_1)},
                {"memberId": "slot_2", "vertexServiceAccountRef": str(slot_2)},
            ],
        }
    )

    assert client_a != client_b
    assert len(built_keys) == 2
