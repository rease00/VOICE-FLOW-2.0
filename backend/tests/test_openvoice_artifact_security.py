from __future__ import annotations

import base64
import time
import types
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import app as backend_app
import services.openvoice_modal as openvoice_modal
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
    monkeypatch.setattr(openvoice_modal, "OPENVOICE_ARTIFACT_SECRET", "test-secret")

    owner_uid = "owner_uid_123"
    other_uid = "other_uid_456"
    artifact_id = f"{backend_app._openvoice_artifact_uid_prefix(owner_uid)}_sample_req"
    artifact_path = (tmp_path / f"{artifact_id}.wav").resolve()
    artifact_path.write_bytes(b"RIFFsample")
    sig = backend_app.build_openvoice_artifact_signature(
        artifact_id,
        secret="test-secret",
        uid=owner_uid,
        exp=int(time.time()) + 120,
    )

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


def test_openvoice_artifact_endpoint_rejects_expired_signature(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "OPENVOICE_ARTIFACT_ROOT", tmp_path.resolve())
    monkeypatch.setattr(openvoice_modal, "OPENVOICE_ARTIFACT_SECRET", "test-secret")

    owner_uid = "owner_uid_123"
    artifact_id = f"{backend_app._openvoice_artifact_uid_prefix(owner_uid)}_sample_req"
    artifact_path = (tmp_path / f"{artifact_id}.wav").resolve()
    artifact_path.write_bytes(b"RIFFsample")
    expired_sig = backend_app.build_openvoice_artifact_signature(
        artifact_id,
        secret="test-secret",
        uid=owner_uid,
        exp=int(time.time()) - 5,
    )

    response = client.get(
        f"/voice-lab/openvoice/artifacts/{artifact_id}",
        params={"sig": expired_sig},
        headers={"x-dev-uid": owner_uid},
    )
    assert response.status_code == 403
    assert "Invalid artifact signature" in response.text


def test_openvoice_artifact_endpoint_allows_signed_link_without_auth_header_in_dev_mode(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "OPENVOICE_ARTIFACT_ROOT", tmp_path.resolve())
    monkeypatch.setattr(openvoice_modal, "OPENVOICE_ARTIFACT_SECRET", "test-secret")

    owner_uid = "owner_uid_123"
    artifact_id = f"{backend_app._openvoice_artifact_uid_prefix(owner_uid)}_sample_req"
    artifact_path = (tmp_path / f"{artifact_id}.wav").resolve()
    artifact_path.write_bytes(b"RIFFsample")
    sig = backend_app.build_openvoice_artifact_signature(
        artifact_id,
        secret="test-secret",
        uid=owner_uid,
        exp=int(time.time()) + 120,
    )

    response = client.get(
        f"/voice-lab/openvoice/artifacts/{artifact_id}",
        params={"sig": sig},
    )
    assert response.status_code == 200
    assert response.content == b"RIFFsample"


def test_openvoice_artifact_endpoint_rejects_signature_replay(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "OPENVOICE_ARTIFACT_ROOT", tmp_path.resolve())
    monkeypatch.setattr(backend_app, "VF_OPENVOICE_ARTIFACT_ONE_TIME", True)
    monkeypatch.setattr(openvoice_modal, "OPENVOICE_ARTIFACT_SECRET", "test-secret")

    owner_uid = "owner_uid_replay"
    artifact_id = f"{backend_app._openvoice_artifact_uid_prefix(owner_uid)}_sample_replay"
    artifact_path = (tmp_path / f"{artifact_id}.wav").resolve()
    artifact_path.write_bytes(b"RIFFsample")
    sig = backend_app.build_openvoice_artifact_signature(
        artifact_id,
        secret="test-secret",
        uid=owner_uid,
        exp=int(time.time()) + 120,
    )

    first = client.get(
        f"/voice-lab/openvoice/artifacts/{artifact_id}",
        params={"sig": sig},
    )
    assert first.status_code == 200
    replay = client.get(
        f"/voice-lab/openvoice/artifacts/{artifact_id}",
        params={"sig": sig},
    )
    assert replay.status_code == 403
    assert "already used" in replay.text.lower()


def test_openvoice_artifact_endpoint_requires_auth_when_auth_enforced(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", True)
    monkeypatch.setattr(backend_app, "OPENVOICE_ARTIFACT_ROOT", tmp_path.resolve())
    monkeypatch.setattr(openvoice_modal, "OPENVOICE_ARTIFACT_SECRET", "test-secret")

    owner_uid = "owner_uid_123"
    artifact_id = f"{backend_app._openvoice_artifact_uid_prefix(owner_uid)}_sample_req"
    artifact_path = (tmp_path / f"{artifact_id}.wav").resolve()
    artifact_path.write_bytes(b"RIFFsample")
    sig = backend_app.build_openvoice_artifact_signature(
        artifact_id,
        secret="test-secret",
        uid=owner_uid,
        exp=int(time.time()) + 120,
    )

    unauthenticated = client.get(
        f"/voice-lab/openvoice/artifacts/{artifact_id}",
        params={"sig": sig},
    )
    assert unauthenticated.status_code == 401

    monkeypatch.setattr(backend_app, "_verify_firebase_id_token", lambda _token: {"uid": owner_uid})
    authenticated = client.get(
        f"/voice-lab/openvoice/artifacts/{artifact_id}",
        params={"sig": sig},
        headers={"Authorization": "Bearer test-token"},
    )
    assert authenticated.status_code == 200
    assert authenticated.content == b"RIFFsample"


def test_openvoice_artifact_signature_rejects_uid_mismatch(monkeypatch) -> None:
    monkeypatch.setattr(openvoice_modal, "OPENVOICE_ARTIFACT_SECRET", "test-secret")

    owner_uid = "owner_uid_123"
    other_uid = "other_uid_456"
    artifact_id = f"{backend_app._openvoice_artifact_uid_prefix(owner_uid)}_sample_req"
    sig = openvoice_modal.build_openvoice_artifact_signature(
        artifact_id,
        secret="test-secret",
        uid=owner_uid,
        exp=int(time.time()) + 120,
    )

    assert openvoice_modal.verify_openvoice_artifact_signature(
        artifact_id,
        sig,
        secret="test-secret",
        uid=owner_uid,
    )
    assert not openvoice_modal.verify_openvoice_artifact_signature(
        artifact_id,
        sig,
        secret="test-secret",
        uid=other_uid,
    )


def test_voice_clone_openvoice_separate_returns_503_when_artifact_signing_is_missing(monkeypatch) -> None:
    monkeypatch.setattr(backend_app, "_require_request_uid", lambda request: "test-uid")
    monkeypatch.setattr(openvoice_modal, "OPENVOICE_ARTIFACT_SECRET", "")
    monkeypatch.setattr(openvoice_modal, "OPENVOICE_DEV_ALLOW_EPHEMERAL_SECRET", False)

    payload = backend_app.OpenVoiceStemSeparationRequest(
        sourceAudioBase64=base64.b64encode(b"RIFFsample").decode("ascii"),
        sourceAudioName="mix.wav",
        requestId="sep-missing-secret",
        traceId="trace-missing-secret",
    )

    with pytest.raises(HTTPException) as excinfo:
        backend_app.voice_clone_openvoice_separate(payload, request=types.SimpleNamespace())

    assert excinfo.value.status_code == 503
    assert "VF_OPENVOICE_ARTIFACT_SECRET" in str(excinfo.value.detail)


def test_openvoice_artifact_secret_rejects_runtime_token_fallback_in_production(monkeypatch) -> None:
    monkeypatch.setenv("VF_ENV", "production")
    monkeypatch.setattr(openvoice_modal, "OPENVOICE_ARTIFACT_SECRET", "")
    monkeypatch.setattr(openvoice_modal, "OPENVOICE_RUNTIME_TOKEN", "runtime-secret")
    monkeypatch.setattr(openvoice_modal, "OPENVOICE_DEV_ALLOW_EPHEMERAL_SECRET", True)

    with pytest.raises(RuntimeError, match="production"):
        openvoice_modal.build_openvoice_artifact_signature("artifact-123")
