from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

import app as backend_app
from services.openvoice_modal import save_openvoice_artifact


client = TestClient(backend_app.app)


def test_save_openvoice_artifact_normalizes_and_contains_path(tmp_path: Path) -> None:
    artifact = save_openvoice_artifact(b"not-really-wav", "../..//evil\\\\name", root=tmp_path)
    assert artifact.path.parent.resolve() == tmp_path.resolve()
    assert artifact.path.suffix == ".wav"
    assert ".." not in artifact.path.name
    assert "/" not in artifact.path.name
    assert "\\" not in artifact.path.name


def test_openvoice_artifact_endpoint_enforces_uid_scope(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "OPENVOICE_ARTIFACT_ROOT", tmp_path.resolve())

    owner_uid = "owner_uid_123"
    other_uid = "other_uid_456"
    artifact_id = f"{backend_app._openvoice_artifact_uid_prefix(owner_uid)}_sample_req"
    artifact_path = (tmp_path / f"{artifact_id}.wav").resolve()
    artifact_path.write_bytes(b"RIFFsample")
    sig = backend_app.build_openvoice_artifact_signature(artifact_id)

    owner_res = client.get(
        f"/voice-lab/openvoice/artifacts/{artifact_id}",
        params={"sig": sig},
        headers={"x-dev-uid": owner_uid},
    )
    assert owner_res.status_code == 200

    other_res = client.get(
        f"/voice-lab/openvoice/artifacts/{artifact_id}",
        params={"sig": sig},
        headers={"x-dev-uid": other_uid},
    )
    assert other_res.status_code == 403

