from __future__ import annotations

import base64
import io
import wave

import pytest
from fastapi.testclient import TestClient

import app as backend_app


client = TestClient(backend_app.app)


def _reset_state() -> None:
    backend_app._INMEMORY_OPENVOICE_RUNTIME_CONFIG.clear()
    backend_app._VOICE_CLONE_STRESS_JOBS.clear()
    backend_app._INMEMORY_ADMIN_ROLES.clear()
    backend_app._RBAC_ACTOR_CACHE.clear()
    backend_app._INMEMORY_ENTITLEMENTS.clear()
    backend_app._INMEMORY_USER_PROFILES.clear()
    backend_app._INMEMORY_USER_ID_INDEX.clear()


@pytest.fixture(autouse=True)
def _provider_switch_isolation(monkeypatch: pytest.MonkeyPatch):
    _reset_state()
    monkeypatch.setattr(backend_app, "VF_AUTH_ENFORCE", False)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENABLED", True)
    monkeypatch.setattr(backend_app, "VF_RBAC_ENFORCE", True)
    monkeypatch.setattr(backend_app, "VF_USER_ID_REQUIRED", False)
    monkeypatch.setattr(backend_app, "_firebase_ready", lambda: False)
    monkeypatch.setattr(
        backend_app,
        "_openvoice_provider_runtime_probe",
        lambda provider: {
            "configured": provider == backend_app.OPENVOICE_PROVIDER_CLOUD_RUN,
            "ready": provider == backend_app.OPENVOICE_PROVIDER_CLOUD_RUN,
            "detail": f"{provider}-ready",
            "device": "cuda:L4" if provider == backend_app.OPENVOICE_PROVIDER_CLOUD_RUN else "modal-device",
        },
    )
    yield
    _reset_state()


def _seed_role(uid: str, role: str) -> None:
    backend_app._rbac_write_assignment(
        uid,
        {
            "role": role,
            "allowOverrides": [],
            "denyOverrides": [],
            "status": "active",
            "updatedBy": "seed",
        },
    )


def _admin_headers(uid: str) -> dict[str, str]:
    return {"x-dev-uid": uid}


def _wav_b64(duration_sec: float = 0.2, sample_rate: int = 24_000) -> str:
    frames = max(1, int(duration_sec * sample_rate))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"\x00\x00" * frames)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _stress_payload() -> dict[str, object]:
    return {
        "benchmarkTarget": "OPENVOICE_L4_VC",
        "config": {
            "startRpm": 2,
            "stepRpm": 2,
            "maxRpm": 2,
            "stepDurationSec": 5,
            "concurrency": 1,
            "maxFailureRate": 0.0,
            "maxP95Ms": 20_000,
            "warmupRequests": 0,
            "requestTimeoutSec": 1.0,
        },
        "referenceAudioBase64": _wav_b64(),
        "referenceAudioName": "reference.wav",
        "sourceAudioBase64": _wav_b64(),
        "sourceAudioName": "source.wav",
        "text": "provider snapshot test",
        "voiceName": "Fenrir",
    }


def test_provider_get_requires_ops_read_and_alias_returns_status(monkeypatch: pytest.MonkeyPatch) -> None:
    _seed_role("billing_actor_user", backend_app.RBAC_ROLE_BILLING_OPS)
    _seed_role("ops_reader_user", backend_app.RBAC_ROLE_READ_ONLY_OPS)

    denied = client.get("/admin/voice-clone/provider", headers=_admin_headers("billing_actor_user"))
    assert denied.status_code == 403
    assert "Missing permission: ops.read" in str(denied.json().get("detail") or "")

    allowed = client.get("/v1/admin/voice-clone/provider", headers=_admin_headers("ops_reader_user"))
    assert allowed.status_code == 200
    payload = allowed.json()
    assert payload["ok"] is True
    assert payload["activeProvider"] == backend_app.OPENVOICE_PROVIDER_CLOUD_RUN
    assert payload["defaultProvider"] == backend_app.OPENVOICE_PROVIDER_CLOUD_RUN
    assert "token" not in str(payload).lower()
    assert "url" not in str(payload["providers"]).lower()


def test_provider_patch_requires_unlock_and_v1_alias_updates_active_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    _seed_role("voice_admin", backend_app.RBAC_ROLE_SUPER_ADMIN)
    unlock_calls: list[str] = []

    def _fake_unlock(request, *, expected_uid=None):
        unlock_calls.append(str(expected_uid or ""))
        return str(expected_uid or "")

    monkeypatch.setattr(backend_app, "_require_admin_mutation_unlock", _fake_unlock)

    first = client.patch(
        "/admin/voice-clone/provider",
        headers=_admin_headers("voice_admin"),
        json={"activeProvider": "modal"},
    )
    assert first.status_code == 200
    assert first.json()["revision"] == 1
    assert unlock_calls == ["voice_admin"]

    second = client.patch(
        "/v1/admin/voice-clone/provider",
        headers=_admin_headers("voice_admin"),
        json={"activeProvider": "modal"},
    )
    assert second.status_code == 200
    payload = second.json()
    assert payload["ok"] is True
    assert payload["activeProvider"] == "modal"
    assert payload["defaultProvider"] == backend_app.OPENVOICE_PROVIDER_CLOUD_RUN
    assert payload["revision"] == 2
    assert payload["updatedBy"] == "voice_admin"
    assert unlock_calls == ["voice_admin", "voice_admin"]
    assert backend_app._openvoice_runtime_config_get()["activeProvider"] == "modal"


def test_provider_snapshot_is_locked_into_running_stress_job(monkeypatch: pytest.MonkeyPatch) -> None:
    _seed_role("voice_admin", backend_app.RBAC_ROLE_SUPER_ADMIN)

    fake_calls: list[str] = []

    class FakeOpenVoiceClient:
        def health(self) -> dict[str, object]:
            return {"ok": True, "state": "online", "detail": "cloud run ready", "device": "cuda:L4", "warm": True}

        def capabilities(self) -> dict[str, object]:
            return {"ok": True, "supportsVC": True, "engine": "SEED_VC"}

        def vc(self, payload, *, timeout_sec=None):  # noqa: ANN001
            fake_calls.append(str(payload.get("requestId") or ""))
            return {
                "ok": True,
                "status": "completed",
                "timings": {"vcMs": 10, "gpuSeconds": 0.01},
                "runtime": {"device": "cuda:L4", "vcProvider": "openvoice-cloud-run"},
                "audioBase64": base64.b64encode(b"fake").decode("ascii"),
            }

    fake_client = FakeOpenVoiceClient()
    monkeypatch.setattr(backend_app, "_resolve_openvoice_client", lambda provider=None: (provider or "cloud_run", fake_client))
    monkeypatch.setattr(backend_app, "_openvoice_runtime_config_get", lambda: {"activeProvider": "modal"})
    monkeypatch.setattr(backend_app, "_launch_voice_clone_stress_job", lambda job_id: None)

    started = client.post(
        "/admin/voice-clone/stress/start",
        headers=_admin_headers("voice_admin"),
        json=_stress_payload(),
    )
    assert started.status_code == 202
    job_id = str(started.json()["jobId"])
    assert backend_app._VOICE_CLONE_STRESS_JOBS[job_id]["providerSnapshot"] == "modal"

    monkeypatch.setattr(backend_app, "_openvoice_runtime_config_get", lambda: {"activeProvider": "cloud_run"})
    backend_app._run_voice_clone_stress_job(job_id)

    row = backend_app._VOICE_CLONE_STRESS_JOBS[job_id]
    assert row["providerSnapshot"] == "modal"
    assert row["summary"]["stopReason"] == "max_rpm_reached"
    assert row["runtimePreflight"]["provider"] == "modal"
    assert fake_calls
