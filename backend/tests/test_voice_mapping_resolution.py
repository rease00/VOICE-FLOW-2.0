from __future__ import annotations

import json
from pathlib import Path

import app as backend_app


def _read_json(path: Path) -> dict[str, object]:
    raw = path.read_text(encoding="utf-8")
    return json.loads(raw.lstrip("\ufeff"))


def test_resolve_gem_runtime_voice_name_supports_alias_tokens() -> None:
    assert backend_app._resolve_gem_runtime_voice_name("fenrir") == "Fenrir"
    assert backend_app._resolve_gem_runtime_voice_name("fenir") == "Fenrir"
    assert backend_app._resolve_gem_runtime_voice_name("\"Fenrir\"") == "Fenrir"
    assert backend_app._resolve_gem_runtime_voice_name(" Rohan ") == "Fenrir"
    assert backend_app._resolve_gem_runtime_voice_name("v1") == "Fenrir"


def test_resolve_mapped_profile_supports_normalized_tokens() -> None:
    profile_a = backend_app._resolve_mapped_profile("PRIME", "\"v1\"", voice_name="\"Fenrir\"")
    profile_b = backend_app._resolve_mapped_profile("VECTOR", "v1", voice_name="fenrir")
    profile_c = backend_app._resolve_mapped_profile("PRIME", "fenir", voice_name="fenir")
    assert isinstance(profile_a, dict)
    assert isinstance(profile_b, dict)
    assert isinstance(profile_c, dict)
    assert str(profile_a.get("profileId") or "") == "p01_india_m_adult"
    assert str(profile_b.get("profileId") or "") == "p01_india_m_adult"
    assert str(profile_c.get("profileId") or "") == "p01_india_m_adult"


def test_resolve_history_voice_fields_uses_canonical_id_and_human_display() -> None:
    voice_id, voice_name = backend_app._resolve_history_voice_fields(
        engine="PRIME",
        voice_id="",
        voice_name="fenir",
    )
    assert voice_id == "Fenrir"
    assert voice_name == "Arjun India Male"

    fallback_id, fallback_name = backend_app._resolve_history_voice_fields(
        engine="PRIME",
        voice_id="custom_voice",
        voice_name="",
    )
    assert fallback_id == "custom_voice"
    assert fallback_name == "custom_voice"


def test_apply_mapped_voice_fields_prefers_public_display_name() -> None:
    mapped = backend_app._apply_mapped_voice_fields(
        "PRIME",
        "Fenrir",
        {
            "voice_id": "Fenrir",
            "voice": "Fenrir",
            "name": "Rohan",
        },
    )

    assert mapped["name"] == "Arjun India Male"
    assert mapped["displayName"] == "Arjun India Male"
    assert mapped["mapped_name"] == "Arjun India Male"
    assert mapped["profile_id"] == "p01_india_m_adult"


def test_resolve_mapped_profile_keeps_alias_gender_pairs_consistent() -> None:
    expected = {
        "Kore": ("Meera India Female", "Female"),
        "Achird": ("Adi India Boy", "Male"),
        "Schedar": ("Schedar France Male", "Male"),
        "Umbriel": ("Umbriel UAE Male", "Male"),
        "Zubenelgenubi": ("Zubenelgenubi Russia Male", "Male"),
    }

    for voice_name, (display_name, gender) in expected.items():
        profile = backend_app._resolve_mapped_profile("PRIME", voice_name, voice_name=voice_name)
        assert isinstance(profile, dict)
        assert str(profile.get("displayName") or "") == display_name
        assert str(profile.get("gender") or "") == gender


def test_history_sanitize_item_exposes_display_name() -> None:
    sanitized = backend_app._history_sanitize_item(
        {
            "engine": "PRIME",
            "voiceName": "Rohan",
            "voiceId": "v1",
            "textPreview": "hello",
        }
    )

    assert sanitized["voiceName"] == "Arjun India Male"
    assert sanitized["displayName"] == "Arjun India Male"
    assert sanitized["voiceId"] == "Fenrir"


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


def test_runtime_voice_catalog_matches_profile_bank_genders() -> None:
    root = Path(__file__).resolve().parents[1]
    voice_map = _read_json(root / "config" / "voice_id_map.v1.json")
    profile_bank = _read_json(root / "config" / "voice_profile_bank.v1.json")
    profiles = {
        str(profile.get("profileId") or ""): profile
        for profile in list(profile_bank.get("profiles") or [])
        if isinstance(profile, dict)
    }

    mismatches: list[str] = []
    for row in list(voice_map.get("engines", {}).get("PRIME", {}).get("runtimeVoices") or []):
        if not isinstance(row, dict):
            continue
        voice_id = str(row.get("voice_id") or "").strip()
        voice_name = str(row.get("voice") or "").strip()
        profile_id = str(
          voice_map.get("engines", {}).get("PRIME", {}).get("voiceToProfile", {}).get(voice_name)
          or voice_map.get("engines", {}).get("PRIME", {}).get("voiceToProfile", {}).get(voice_id)
          or ""
        ).strip()
        profile = profiles.get(profile_id)
        if not profile:
            mismatches.append(f"{voice_id or voice_name}:missing-profile")
            continue
        declared_gender = str(row.get("gender") or "").strip().lower()
        profile_gender = str(profile.get("gender") or "").strip().lower()
        if declared_gender and profile_gender and declared_gender != profile_gender:
            mismatches.append(voice_id)

    assert mismatches == []


def test_gem_runtime_voice_catalog_fallback_genders_are_consistent(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "_load_voice_id_map", lambda: {"version": "0", "engines": {}})
    catalog = backend_app._gem_runtime_voice_catalog()

    by_voice = {str(row.get("voice_id") or ""): row for row in catalog if isinstance(row, dict)}
    assert str(by_voice.get("Fenrir", {}).get("gender") or "").lower() == "male"
    assert str(by_voice.get("Kore", {}).get("gender") or "").lower() == "female"
    assert str(by_voice.get("Achernar", {}).get("gender") or "").lower() == "female"
    assert str(by_voice.get("Charon", {}).get("gender") or "").lower() == "male"


def test_prime_runtime_voice_genders_match_official_gcp_catalog() -> None:
    # Google Cloud Gemini TTS voice-gender mapping (official docs table).
    expected = {
        "Achernar": "female",
        "Achird": "male",
        "Algenib": "male",
        "Algieba": "male",
        "Alnilam": "male",
        "Aoede": "female",
        "Autonoe": "female",
        "Callirrhoe": "female",
        "Charon": "male",
        "Despina": "female",
        "Enceladus": "male",
        "Erinome": "female",
        "Fenrir": "male",
        "Gacrux": "female",
        "Iapetus": "male",
        "Kore": "female",
        "Laomedeia": "female",
        "Leda": "female",
        "Orus": "male",
        "Pulcherrima": "female",
        "Puck": "male",
        "Rasalgethi": "male",
        "Sadachbia": "male",
        "Sadaltager": "male",
        "Schedar": "male",
        "Sulafat": "female",
        "Umbriel": "male",
        "Vindemiatrix": "female",
        "Zephyr": "female",
        "Zubenelgenubi": "male",
    }

    root = Path(__file__).resolve().parents[1]
    voice_map = _read_json(root / "config" / "voice_id_map.v1.json")
    rows = list(voice_map.get("engines", {}).get("PRIME", {}).get("runtimeVoices") or [])
    by_voice = {
        str(row.get("voice") or "").strip(): str(row.get("gender") or "").strip().lower()
        for row in rows
        if isinstance(row, dict) and str(row.get("voice") or "").strip()
    }

    for voice_name, expected_gender in expected.items():
        assert voice_name in by_voice
        assert by_voice[voice_name] == expected_gender
