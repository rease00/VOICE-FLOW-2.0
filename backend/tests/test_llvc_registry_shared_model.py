from __future__ import annotations

import json
from pathlib import Path


def test_llvc_registry_profile_ids_stable_and_shared_model() -> None:
    registry_path = Path(__file__).resolve().parents[1] / "config" / "llvc_model_registry.json"
    payload = json.loads(registry_path.read_text(encoding="utf-8"))
    rows = payload.get("models") if isinstance(payload.get("models"), list) else []

    ids = {str(row.get("id") or "").strip() for row in rows if isinstance(row, dict)}
    expected_profile_ids = {f"p{idx:02d}_{suffix}" for idx, suffix in [
        (1, "india_m_adult"),
        (2, "india_f_adult"),
        (3, "us_m_adult"),
        (4, "us_f_adult"),
        (5, "uk_m_adult"),
        (6, "uk_f_adult"),
        (7, "canada_m_adult"),
        (8, "canada_f_adult"),
        (9, "au_m_adult"),
        (10, "au_f_adult"),
        (11, "jp_m_adult"),
        (12, "jp_f_adult"),
        (13, "br_m_adult"),
        (14, "br_f_adult"),
        (15, "es_m_adult"),
        (16, "es_f_adult"),
        (17, "india_boy"),
        (18, "india_girl"),
        (19, "india_old_man"),
        (20, "uk_old_woman"),
        (21, "novel_artist_m"),
        (22, "novel_artist_f"),
        (23, "de_m_adult"),
        (24, "de_f_adult"),
        (25, "fr_m_adult"),
        (26, "fr_f_adult"),
        (27, "ae_m_adult"),
        (28, "ae_f_adult"),
        (29, "ru_m_adult"),
        (30, "ru_f_adult"),
    ]}

    assert "llvc_hq_cpu" in ids
    assert "llvc_default" in ids
    assert expected_profile_ids.issubset(ids)

    resolved_ids = {
        str(row.get("resolvedModelId") or "").strip()
        for row in rows
        if isinstance(row, dict) and str(row.get("id") or "").strip() in expected_profile_ids.union({"llvc_hq_cpu", "llvc_default"})
    }
    assert resolved_ids == {"f_8312_32k-325"}

    checkpoints = {
        str(row.get("checkpointPath") or "").strip()
        for row in rows
        if isinstance(row, dict) and str(row.get("id") or "").strip() in expected_profile_ids
    }
    assert checkpoints == {"models/rvc/f_8312_32k-325.pth"}
