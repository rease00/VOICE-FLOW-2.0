# Cloud Run Split-Service Deployment

This folder contains Cloud Run production deployment assets for the split topology:

- `voiceflow-api` (public ingress, unauthenticated at Cloud Run, scale-to-zero, single primary region, no session affinity by default)
- `voiceflow-worker` (internal ingress, authenticated, drained by Cloud Tasks, regional only)
- `voiceflow-gemini-runtime` (internal ingress, authenticated, scale-to-zero, regional only)
- DUNO runtime is provided by DeepInfra and configured via `VF_DUNO_RUNTIME_URL=https://api.deepinfra.com/v1`, `VF_DUNO_RUNTIME_MODEL=ResembleAI/chatterbox-turbo`, plus `VF_DUNO_RUNTIME_TOKEN` on the backend.
- Voice Clone is Modal-only in production and is configured via `VF_VOICE_CLONE_PROVIDER_DEFAULT=modal` plus `VF_VOICE_CLONE_MODAL_RUNTIME_URL` on the backend.

The API and worker use the same backend image with role-based startup:

- `VF_SERVICE_ROLE=api` and `VF_TTS_QUEUE_WORKER_COUNT=0` on API
- `VF_SERVICE_ROLE=worker` on worker
- `VF_ENV=production` and `VF_AUTH_ENFORCE=1` on both API and worker

## Files

- `services.default.json`: service defaults, scaling, env mapping, Secret Manager bindings.
- `profiles.cloudrun-2vcpu.json`: named capacity contract used by deploy and load-test tooling.
- `deploy.ps1`: build + deploy script for all services.
- `rollout-traffic.ps1`: staged traffic rollout (`10% -> 50% -> 100%`) with optional auto-rollback checks.
- `docker/`: container definitions.
- `../../.gcloudignore`: Cloud Build upload filter to avoid sending local dev artifacts/media.

## Prerequisites

1. `gcloud` authenticated with deploy permissions.
2. Artifact Registry Docker repo (script will create if missing).
3. Secret Manager secrets created (names referenced in `services.default.json`):
   - `firebase-service-account-json`
   - `stripe-secret-key`
   - `stripe-webhook-secret`
   - `vf-admin-unlock-signing-secret`
   - `gemini-runtime-admin-token`
   - `duno-runtime-token` (DeepInfra API token for the configured DUNO model, default `ResembleAI/chatterbox-turbo`)
   - `voice-clone-runtime-token`
   - `voice-clone-artifact-secret`
   - Legacy compatibility aliases: `openvoice-runtime-token`, `openvoice-artifact-secret`
4. Optional but recommended:
   - Serverless VPC connector (`-VpcConnector`) for Memorystore access.
   - Memorystore Redis URL (`-RedisUrl`, mapped to `VF_REDIS_URL`).
   - Cloud Run invoker bindings for the API/worker identities once the service accounts are finalized.

## Deploy

```powershell
cd infra/cloudrun
.\deploy.ps1 -ProjectId "<gcp-project-id>" -Region "us-central1" -VpcConnector "<connector-name>" -RedisUrl "redis://10.0.0.3:6379/0"
```

For DeepInfra DUNO plus Modal VC, also set:

```powershell
$env:VF_DUNO_RUNTIME_URL="https://api.deepinfra.com/v1"
$env:VF_DUNO_RUNTIME_MODEL="ResembleAI/chatterbox-turbo"
$env:VF_VOICE_CLONE_MODAL_RUNTIME_URL="https://your-voice-clone-modal-endpoint"
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

`services.default.json` is preconfigured for a conservative first rollout:

- Default profile: `cloudrun-2vcpu`
- API: `min=1`, `max=20`, concurrency `16`, single-region default, session affinity disabled
- Worker: `min=0`, `max=12`, concurrency `1`, CPU throttling enabled
- Gemini runtime: `min=0`, `max=10`, concurrency `2`
- Execution environment: `gen2`
- Startup CPU boost: enabled
- Request timeouts: service-specific (`300s` to `1200s`)

Adjust max instances only after the `cloudrun-2vcpu` load profile is green in staging.

## Cloud Tasks Drain

`voiceflow-worker` no longer polls Redis in a loop on Cloud Run. Instead, queued TTS jobs wake the worker through Cloud Tasks and the worker drains a bounded batch, then schedules the next task only if backlog remains.

During deployment, `deploy.ps1` bootstraps `VF_TTS_DRAIN_WORKER_URL` for `voiceflow-worker` after Cloud Run returns the service URL, then uses that URL for API-side wakeups.

The key runtime knobs are:

- `VF_TTS_DRAIN_QUEUE_NAME`
- `VF_TTS_DRAIN_QUEUE_LOCATION`
- `VF_TTS_DRAIN_WORKER_URL`
- `VF_TTS_DRAIN_BATCH_SIZE`
- `VF_TTS_DRAIN_LOCK_TTL_MS`
- `VF_TTS_DRAIN_DISPATCH_DEADLINE_SEC`

The worker endpoint is `POST /internal/tts/drain`.

IAM requirements:

- The service account creating tasks needs `roles/cloudtasks.enqueuer`.
- The worker service account needs `roles/run.invoker` on `voiceflow-worker`.
- The backend and worker callers to `voiceflow-gemini-runtime` need `roles/run.invoker` on that service as well.

The code uses Cloud Run ID tokens for Gemini/runtime calls and Cloud Tasks OIDC tokens for the worker drain target. The drain path no longer depends on an app-level shared admin token in the default launch posture.

The public API exposes a routing snapshot so the launch stays predictable while still letting the client pin the nearest healthy region. `GET /routing/regions` and `VF_PUBLIC_API_REGIONS` exist for observability and future expansion, but the default launch stays on one primary region.

Client bootstrapping discovers candidate regions through `GET /routing/regions`, then pins the selected `mediaBackendUrl` for the login session. If a backend health probe fails later, the app clears that pin and re-discovers the healthy route instead of staying stuck on a dead backend.

Set `VF_PUBLIC_API_REGIONS` to the active region list for staged rollouts, and optionally `VF_PUBLIC_API_REGION_BASE_URLS_JSON` if you need explicit per-region base URLs during testing or a future expansion.

The worker and Gemini runtime stay regional for now, which keeps the cost and failure domain predictable while the public API stays simple.

## Service Config Knobs

`deploy.ps1` now consumes these optional fields from each service entry in `services.default.json`:

- `timeoutSeconds` -> `gcloud run deploy --timeout`
- `regions` -> `gcloud run deploy --regions` for explicit multi-region services when you deliberately add a second launch region
- `executionEnvironment` -> `gcloud run deploy --execution-environment`
- `startupCpuBoost` -> `gcloud run deploy --cpu-boost|--no-cpu-boost`
- `sessionAffinity` -> `gcloud run deploy --session-affinity|--no-session-affinity`
- `gpuCount` and `gpuType` -> `gcloud run deploy --gpu` and `--gpu-type`
- `allowUnauthenticated`, `ingress`, and `serviceAccount` are also honored when present in the service definition.

## Rollout and Rollback

Recommended rollout flow:

1. Deploy to staging and soak.
2. Promote production traffic `10% -> 50% -> 100%`.
3. Run health checks after each step and keep a rollback-ready stable revision.
4. Validate an idle baseline, burst traffic, and a return-to-zero window before raising `maxInstances`.

### Scripted traffic rollout

Use `rollout-traffic.ps1` to shift traffic with soak windows and optional auto-rollback on the primary-region canary.

If you later add a second region, declare it in `services.default.json` and let `deploy.ps1` handle the rollout.

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
    "https://api.deepinfra.com/v1/voices"
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
