from __future__ import annotations

import app as backend_app


def test_resolve_gem_runtime_voice_name_supports_alias_tokens() -> None:
    assert backend_app._resolve_gem_runtime_voice_name("fenrir") == "Fenrir"
    assert backend_app._resolve_gem_runtime_voice_name("fenir") == "Fenrir"
    assert backend_app._resolve_gem_runtime_voice_name("\"Fenrir\"") == "Fenrir"
    assert backend_app._resolve_gem_runtime_voice_name(" Arjun India Male ") == "Fenrir"
    assert backend_app._resolve_gem_runtime_voice_name("v1") == "Fenrir"


def test_resolve_mapped_profile_supports_normalized_tokens() -> None:
    profile_a = backend_app._resolve_mapped_profile("GEM", "\"v1\"", voice_name="\"Fenrir\"")
    profile_b = backend_app._resolve_mapped_profile("NEURAL2", "v1", voice_name="fenrir")
    profile_c = backend_app._resolve_mapped_profile("GEM", "fenir", voice_name="fenir")
    assert isinstance(profile_a, dict)
    assert isinstance(profile_b, dict)
    assert isinstance(profile_c, dict)
    assert str(profile_a.get("profileId") or "") == "p01_india_m_adult"
    assert str(profile_b.get("profileId") or "") == "p01_india_m_adult"
    assert str(profile_c.get("profileId") or "") == "p01_india_m_adult"


def test_resolve_history_voice_fields_uses_canonical_id_and_human_display() -> None:
    voice_id, voice_name = backend_app._resolve_history_voice_fields(
        engine="GEM",
        voice_id="",
        voice_name="fenir",
    )
    assert voice_id == "Fenrir"
    assert voice_name == "Arjun India Male"

    fallback_id, fallback_name = backend_app._resolve_history_voice_fields(
        engine="GEM",
        voice_id="custom_voice",
        voice_name="",
    )
    assert fallback_id == "custom_voice"
    assert fallback_name == "custom_voice"


def test_resolve_llvc_model_name_for_runtime_aliases_legacy_profile_ids(monkeypatch) -> None:
    monkeypatch.setattr(
        backend_app,
        "_llvc_runtime_model_snapshot",
        lambda force_refresh=False: ({"voice_transfer_hq_cpu"}, False),
    )
    assert backend_app._resolve_llvc_model_name_for_runtime("p17_india_boy") == "voice_transfer_hq_cpu"


def test_speaker_display_label_preserves_human_labels() -> None:
    assert backend_app._speaker_display_label("Speaker 1") == "Speaker 1"
    assert backend_app._speaker_display_label("speaker 2") == "Speaker 2"
    assert backend_app._speaker_display_label("SPEAKER_00") == "Speaker 1"
    assert backend_app._speaker_display_label("speaker-01") == "Speaker 2"


def test_build_preferred_voice_map_for_segments_matches_display_labels() -> None:
    resolved = backend_app._build_preferred_voice_map_for_segments(
        {
            " [Speaker 1] ": "voice_a",
            "**Speaker 2**": "voice_b",
            "default": "voice_default",
        },
        [
            {"speaker": "SPEAKER_00", "speaker_raw": "Speaker 1"},
            {"speaker": "SPEAKER_01", "speaker_raw": "Speaker 2"},
        ],
    )

    assert resolved == {
        "SPEAKER_00": "voice_a",
        "SPEAKER_01": "voice_b",
        "default": "voice_default",
    }
