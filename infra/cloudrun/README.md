# Cloud Run Split-Service Deployment

Important:
- The Dockerfiles in this folder still reference compatibility-backend sources under `backend/`.
- Those sources are not present in this checkout, so this folder is not currently buildable as a repo-only Cloud Run rollout.
- Use these assets only if you have restored the missing backend sources in your build context or are building from the external compatibility-backend repository.
- The launch-default topology from this workspace is Cloudflare Workers/OpenNext for the public frontend plus an external Cloud Run compatibility backend for still-proxied API families.

This folder contains Cloud Run production deployment assets for the split topology:

- `voiceflow-api` (public ingress, unauthenticated at Cloud Run, scale-to-zero, single primary region, no session affinity by default)
- `voiceflow-gemini-runtime` (internal ingress, authenticated, scale-to-zero, regional only)
- `voiceflow-gemini-runtime` is the dedicated Cloud TTS runtime for speech synthesis.
- `voiceflow-vertex-text-runtime` is the dedicated Vertex text runtime for text and AI endpoints.
- Voice Clone, OpenVoice compatibility, and Demucs separation stay Modal-backed in production and are configured through the backend Modal runtime env set.

The API uses the shared compatibility backend image with role-based startup:

- `VF_SERVICE_ROLE=api` and `VF_TTS_QUEUE_WORKER_COUNT=0` on API
- `VF_ENV=production` and `VF_AUTH_ENFORCE=1` on API

## Files

- `services.default.json`: service defaults, scaling, env mapping, Secret Manager bindings.
- `profiles.cloudrun-2vcpu.json`: named capacity contract used by deploy and load-test tooling.
- `deploy.ps1`: build + deploy script for all services.
- `validate-provider-drift.mjs`: lightweight drift check for provider mapping, docs wording, and secret references.
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
   - `voice-clone-runtime-token`
   - `voice-clone-artifact-secret`
   - Legacy compatibility aliases: `openvoice-runtime-token`, `openvoice-artifact-secret`
4. Optional but recommended:
   - Serverless VPC connector (`-VpcConnector`) for Memorystore access.
   - Memorystore Redis URL (`-RedisUrl`, mapped to `VF_REDIS_URL`).
   - Cloud Run invoker bindings for the API/runtime identities once the service accounts are finalized.

## Deploy

```powershell
cd infra/cloudrun
.\deploy.ps1 -ProjectId "<gcp-project-id>" -Region "us-central1" -VpcConnector "<connector-name>" -RedisUrl "redis://10.0.0.3:6379/0"
```

For Cloud TTS + Vertex text plus Modal VC, also set:

```powershell
$env:VF_TTS_RUNTIME_URL="__GEMINI_RUNTIME_URL__"
$env:VF_VERTEX_TEXT_RUNTIME_URL="__VERTEX_TEXT_RUNTIME_URL__"
$env:VF_VOICE_CLONE_MODAL_RUNTIME_URL="https://your-voice-clone-modal-endpoint"
```

Dry run:

```powershell
.\deploy.ps1 -ProjectId "<gcp-project-id>" -DryRun
```

Validate provider/env drift before deploy:

```powershell
node .\validate-provider-drift.mjs
```

Deploy without rebuilding images:

```powershell
.\deploy.ps1 -ProjectId "<gcp-project-id>" -SkipBuild
```

## Scaling Defaults

`services.default.json` is preconfigured for a conservative first rollout:

- Default profile: `cloudrun-2vcpu`
- API: `min=0`, `max=20`, concurrency `16`, single-region default, session affinity disabled
- Gemini runtime: `min=0`, `max=10`, concurrency `2`
- Execution environment: `gen2`
- Startup CPU boost: enabled
- Request timeouts: service-specific (`300s` to `1200s`)

Adjust max instances only after the `cloudrun-2vcpu` load profile is green in staging.

## TTS Drain Posture

The launch-default posture retires the dedicated Cloud Run worker and keeps TTS drain disabled in the API config. Do not recreate the legacy drain queue or worker unless the compatibility backend is explicitly reworked to depend on them again.

IAM requirements:

- The backend callers to `voiceflow-gemini-runtime` need `roles/run.invoker` on that service.

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
