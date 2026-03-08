from __future__ import annotations

import json
from pathlib import Path


def test_voice_transfer_registry_profile_ids_stable_and_shared_model() -> None:
    registry_path = Path(__file__).resolve().parents[1] / "config" / "voice_transfer_model_registry.json"
    payload = json.loads(registry_path.read_text(encoding="utf-8"))
    rows = payload.get("models") if isinstance(payload.get("models"), list) else []

    ids = [str(row.get("id") or "").strip() for row in rows if isinstance(row, dict)]
    assert ids == ["voice_transfer_hq_cpu"]

    resolved_ids = {
        str(row.get("resolvedModelId") or "").strip()
        for row in rows
        if isinstance(row, dict)
    }
    assert resolved_ids == {"f_8312_32k-325"}

    checkpoints = {
        str(row.get("checkpointPath") or "").strip()
        for row in rows
        if isinstance(row, dict)
    }
    assert checkpoints == {"models/rvc/f_8312_32k-325.pth"}
