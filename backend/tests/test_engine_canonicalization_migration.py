from __future__ import annotations

from fastapi.testclient import TestClient

import app as backend_app


client = TestClient(backend_app.app)


def _reset_migration_state() -> None:
    backend_app._INMEMORY_ENTITLEMENTS.clear()
    backend_app._INMEMORY_USAGE_MONTHLY.clear()
    backend_app._INMEMORY_USAGE_DAILY.clear()
    backend_app._INMEMORY_USAGE_EVENTS.clear()
    backend_app._INMEMORY_GENERATION_HISTORY.clear()
    backend_app._INMEMORY_AUDIO_GENERATION_AUDIT.clear()
    backend_app._TTS_V2_ENGINE._jobs.clear()
    backend_app._TTS_V2_ENGINE._request_to_job.clear()
    backend_app._TTS_V2_ENGINE._job_cache_order.clear()
    queue = backend_app._TTS_V2_ENGINE._queue
    with queue._lock:
        queue._jobs.clear()
        queue._job_lanes.clear()
        queue._job_cache_order.clear()
        queue._compat_queue = queue._compat_queue.__class__(queue._weights)


def test_engine_canonicalization_migration_dry_run_apply_verify(monkeypatch) -> None:
    _reset_migration_state()
    monkeypatch.setattr(backend_app, "_firestore_collection", lambda _name: None)

    backend_app._INMEMORY_ENTITLEMENTS["user_1"] = {
        "uid": "user_1",
        "plan": "Free",
        "allowedEngines": ["KOKORO", "NEURAL2", "GEM1", "GEM PRO", "DUNO"],
        "vfRates": {"KOKORO": 0.5, "NEURAL2": 1.2, "GEM": 1.5},
        "spendableNowByEngine": {"KOKORO": 10, "NEURAL2": 20, "GEM": 30},
        "dunoVoiceCloneMap": {
            "legacy": {
                "voiceId": "voice-legacy",
                "speaker": "speaker-a",
                "referenceHash": "hash-a",
                "model": "model-a",
                "updatedAt": "2026-03-29T00:00:00Z",
            }
        },
    }
    backend_app._INMEMORY_USAGE_MONTHLY["user_1_202603"] = {
        "uid": "user_1",
        "periodKey": "2026-03",
        "vfUsed": 4.5,
        "monthlyFreeVfUsed": 1.0,
        "generationCount": 2,
        "byEngine": {
            "KOKORO": {"chars": 7, "vf": 0.5},
            "GEM1": {"chars": 11, "vf": 1.2},
            "GEM PRO": {"chars": 13, "vf": 1.5},
        },
    }
    backend_app._INMEMORY_USAGE_DAILY["user_1_20260329"] = {
        "uid": "user_1",
        "periodKey": "2026-03-29",
        "vfUsed": 2.5,
        "generationCount": 1,
        "byEngine": {
            "BASIC": {"chars": 5, "vf": 0.5},
            "NEURAL2": {"chars": 9, "vf": 1.2},
        },
    }
    backend_app._INMEMORY_USAGE_EVENTS["evt_1"] = {
        "uid": "user_1",
        "requestId": "req-1",
        "status": "reserved",
        "engine": "GEM",
        "monthDocId": "user_1_202603",
        "dayDocId": "user_1_20260329",
    }
    backend_app._INMEMORY_GENERATION_HISTORY["user_1"] = {
        "uid": "user_1",
        "itemsGzipB64": backend_app._history_encode_items_gzip_b64(
            [
                {
                    "engine": "KOKORO",
                    "voiceId": "voice-legacy",
                    "voiceName": "Legacy voice",
                    "chars": 100,
                    "textPreview": "hello",
                }
            ]
        ),
    }
    backend_app._INMEMORY_AUDIO_GENERATION_AUDIT["audit_1"] = {
        "auditId": "audit_1",
        "uid": "user_1",
        "submittedAt": "2026-03-29T00:00:00Z",
        "status": "received",
        "engine": "GEM PRO",
        "voiceId": "voice-legacy",
        "voiceName": "Legacy voice",
        "inputText": "hello audit",
        "requestId": "req-audit-1",
        "jobId": "job-audit-1",
        "traceId": "trace-audit-1",
    }
    legacy_queue_record = {
        "jobId": "job_legacy",
        "idempotencyKey": "job_legacy",
        "uid": "user_1",
        "requestId": "request_legacy",
        "traceId": "trace_legacy",
        "lane": "free",
        "createdAtMs": 1,
        "updatedAtMs": 1,
        "status": "queued",
        "attempts": 0,
        "cancelRequested": False,
        "planKey": "free",
        "engine": "GEM",
        "mode": "single_speaker",
        "text": "queue job",
        "payload": {
            "engine": "KOKORO",
            "sourceEngine": "NEURAL2",
            "nested": {"fallbackEngine": "GEM1"},
        },
        "liveState": {
            "engine": "GEM PRO",
            "chunks": [
                {"index": 0, "engine": "KOKORO_RUNTIME"},
                {"index": 1, "engine": "VECTOR"},
            ],
        },
        "result": {"audioRef": {"kind": "file", "path": "", "engine": "GEMINI"}},
        "error": {},
        "statusCode": 0,
        "expiresAtMs": 2,
    }
    legacy_job = backend_app._TTS_V2_ENGINE._job_from_queue_record(legacy_queue_record)
    legacy_job.engine = "GEM"
    legacy_job.payload["engine"] = "KOKORO"
    legacy_job.payload["sourceEngine"] = "NEURAL2"
    backend_app._TTS_V2_ENGINE._jobs[legacy_job.id] = legacy_job
    backend_app._TTS_V2_ENGINE._request_to_job[legacy_job.request_id] = legacy_job.id
    queue = backend_app._TTS_V2_ENGINE._queue
    with queue._lock:
        queue._jobs[legacy_queue_record["jobId"]] = dict(legacy_queue_record)
        queue._job_lanes[legacy_queue_record["jobId"]] = "free"
        queue._compat_queue.push("free", dict(legacy_queue_record))

    dry_run = backend_app._engine_canonicalization_migration(mode="dry_run", requested_by="admin")
    assert dry_run["ok"] is True
    assert dry_run["dryRun"] is True
    assert dry_run["collections"]["usage_monthly"]["changed"] == 1
    assert dry_run["collections"]["audio_generation_audit"]["changed"] == 1
    assert dry_run["queueJobMetadata"]["queueRecords"]["changed"] == 1
    assert dry_run["queueJobMetadata"]["jobCache"]["changed"] == 1
    assert dry_run["legacyTokensRemaining"] == 0
    assert backend_app._INMEMORY_AUDIO_GENERATION_AUDIT["audit_1"]["engine"] == "GEM PRO"
    assert backend_app._TTS_V2_ENGINE._jobs["job_legacy"].engine == "GEM"
    assert backend_app._TTS_V2_ENGINE._queue._jobs["job_legacy"]["engine"] == "GEM"

    apply_result = backend_app._engine_canonicalization_migration(mode="apply", requested_by="admin")
    assert apply_result["ok"] is True
    assert apply_result["applied"] is True
    assert apply_result["collections"]["audio_generation_audit"]["changed"] == 1
    assert apply_result["queueJobMetadata"]["queueRecords"]["changed"] == 1
    assert apply_result["queueJobMetadata"]["jobCache"]["changed"] == 1
    assert apply_result["legacyTokensRemaining"] == 0

    verify_result = backend_app._engine_canonicalization_migration(mode="verify", requested_by="admin")
    assert verify_result["ok"] is True
    assert verify_result["verified"] is True
    assert verify_result["legacyTokensRemaining"] == 0
    assert verify_result["queueJobMetadata"]["legacyTokensRemaining"] == 0

    entitlement = backend_app._INMEMORY_ENTITLEMENTS["user_1"]
    assert entitlement["allowedEngines"] == ["DUNO", "VECTOR", "PRIME"]
    assert entitlement["vfRates"] == {"DUNO": 0.5, "VECTOR": 1.2, "PRIME": 1.5}
    assert entitlement["spendableNowByEngine"] == {"DUNO": 10, "VECTOR": 20, "PRIME": 30}

    monthly = backend_app._INMEMORY_USAGE_MONTHLY["user_1_202603"]
    assert set(monthly["byEngine"].keys()) == {"DUNO", "VECTOR", "PRIME"}
    daily = backend_app._INMEMORY_USAGE_DAILY["user_1_20260329"]
    assert set(daily["byEngine"].keys()) == {"DUNO", "VECTOR"}

    event = backend_app._INMEMORY_USAGE_EVENTS["evt_1"]
    assert event["engine"] == "PRIME"

    audit_row = backend_app._INMEMORY_AUDIO_GENERATION_AUDIT["audit_1"]
    assert audit_row["engine"] == "PRIME"

    history_items = backend_app._history_decode_items_gzip_b64(
        backend_app._INMEMORY_GENERATION_HISTORY["user_1"]["itemsGzipB64"],
    )
    assert history_items[0]["engine"] == "DUNO"

    migrated_queue_record = backend_app._TTS_V2_ENGINE._queue._jobs["job_legacy"]
    assert migrated_queue_record["engine"] == "PRIME"
    assert migrated_queue_record["payload"]["engine"] == "DUNO"
    assert migrated_queue_record["payload"]["sourceEngine"] == "VECTOR"
    assert migrated_queue_record["payload"]["nested"]["fallbackEngine"] == "VECTOR"
    assert migrated_queue_record["liveState"]["engine"] == "PRIME"
    assert migrated_queue_record["liveState"]["chunks"][0]["engine"] == "DUNO"
    assert migrated_queue_record["result"]["audioRef"]["engine"] == "PRIME"
    assert backend_app._TTS_V2_ENGINE._jobs["job_legacy"].engine == "PRIME"
    assert backend_app._TTS_V2_ENGINE._jobs["job_legacy"].payload["engine"] == "DUNO"
