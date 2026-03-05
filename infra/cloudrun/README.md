# Cloud Run Split-Service Deployment

This folder contains Cloud Run production deployment assets for the split topology:

- `voiceflow-api` (public ingress)
- `voiceflow-worker` (internal ingress)
- `voiceflow-gemini-runtime` (internal ingress)
- `voiceflow-kokoro-runtime` (internal ingress)
- `voiceflow-llvc-runtime` (internal ingress)

The API and worker use the same backend image with role-based startup:

- `VF_SERVICE_ROLE=api` and `VF_TTS_QUEUE_WORKER_COUNT=0` on API
- `VF_SERVICE_ROLE=worker` on worker
- `VF_ENV=production` and `VF_AUTH_ENFORCE=1` on both API and worker

## Files

- `services.default.json`: service defaults, scaling, env mapping, Secret Manager bindings.
- `deploy.ps1`: build + deploy script for all services.
- `rollout-traffic.ps1`: staged traffic rollout (`10% -> 50% -> 100%`) with optional auto-rollback checks.
- `docker/`: container definitions.

## Prerequisites

1. `gcloud` authenticated with deploy permissions.
2. Artifact Registry Docker repo (script will create if missing).
3. Secret Manager secrets created (names referenced in `services.default.json`):
   - `firebase-service-account-json`
   - `stripe-secret-key`
   - `stripe-webhook-secret`
   - `vf-admin-unlock-signing-secret`
   - `gemini-runtime-admin-token`
4. Optional but recommended:
   - Serverless VPC connector (`-VpcConnector`) for Memorystore access.
   - Memorystore Redis URL (`-RedisUrl`, mapped to `VF_REDIS_URL`).

## Deploy

```powershell
cd infra/cloudrun
.\deploy.ps1 -ProjectId "<gcp-project-id>" -Region "us-central1" -VpcConnector "<connector-name>" -RedisUrl "redis://10.0.0.3:6379/0"
```

Dry run:

```powershell
.\deploy.ps1 -ProjectId "<gcp-project-id>" -DryRun
```

Deploy without rebuilding images:

```powershell
.\deploy.ps1 -ProjectId "<gcp-project-id>" -SkipBuild
```

## Scaling Defaults

`services.default.json` is preconfigured for growth-oriented defaults:

- API: `min=2`, `max=50`, concurrency `80`
- Worker: `min=2`, `max=50`, concurrency `1`, CPU always allocated
- Gemini runtime: `min=1`, `max=20`
- Kokoro runtime: `min=1`, `max=20`
- LLVC runtime: `min=0`, `max=10`

Adjust max instances after staging load tests.

## Rollout and Rollback

Recommended rollout flow:

1. Deploy to staging and soak.
2. Promote production traffic `10% -> 50% -> 100%`.
3. Run health checks after each step and keep a rollback-ready stable revision.

### Scripted traffic rollout

Use `rollout-traffic.ps1` to shift traffic with soak windows and optional auto-rollback.

Example:

```powershell
cd infra/cloudrun
.\rollout-traffic.ps1 `
  -ProjectId "<gcp-project-id>" `
  -Region "us-central1" `
  -ServiceName "voiceflow-api" `
  -Steps "10,50,100" `
  -SoakSeconds 300 `
  -ProbeUrl "https://voiceflow-api-xxxx.a.run.app/health" `
  -RuntimeHealthUrls @(
    "https://voiceflow-gemini-runtime-xxxx.a.run.app/health",
    "https://voiceflow-kokoro-runtime-xxxx.a.run.app/health"
  ) `
  -QueueMetricsUrl "https://voiceflow-api-xxxx.a.run.app/admin/tts/queue/metrics" `
  -MaxQueueDepth 200 `
  -MaxOldestQueuedAgeMs 120000 `
  -AutoRollback
```

Notes:

- `AUDIT_BEARER_TOKEN` is used automatically for protected probe endpoints.
- If no bearer token is present and dev fallback is allowed, `AUDIT_DEV_UID` is used.
- `-DryRun` prints exact gcloud/probe actions without mutating traffic.

### Rollback triggers

Rollback immediately on any of the following:

- Sustained API/runtime `5xx` growth after a traffic step.
- Queue timeout symptoms: depth/oldest-age breaching thresholds.
- Runtime health degradation (`/health` probe failures or unstable readiness).
- Admin unlock anomalies (unexpected unlock verify failures, token mismatch spikes).
