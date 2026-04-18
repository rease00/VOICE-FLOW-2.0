# Reliability Runbook

Note:
- This workspace contains the Next.js control plane and native `/api/v1/*` handlers that have already been migrated.
- References below to `backend/` or Python runtime internals describe the external compatibility backend used by still-proxied launch surfaces.
- Do not treat those backend paths as buildable from this checkout unless the missing backend sources have been restored.

## Admin Coupons and Ops

1. Coupon policy matrix:
   - `wallet_credit` + `single_global`: total one redemption across all users.
   - `wallet_credit` + `single_per_user`: each user can redeem once.
   - `wallet_credit` + `max_redemptions`: global cap from `usageLimit`.
   - `subscription_discount` supports the same usage policies and is applied only to first invoice.
2. Coupon expiry:
   - Default expiry is 6 months from creation.
   - Override with `expiresAt` at create/patch time when needed.
3. Coupon admin endpoints:
   - `POST /admin/coupons/generate-code`
   - `POST /admin/coupons`
   - `GET /admin/coupons`
   - `PATCH /admin/coupons/{coupon_id}`
4. Checkout + webhook flow:
   - `POST /billing/checkout-session` accepts optional `couponCode`.
   - Internal subscription coupon creates reservation first.
   - `checkout.session.completed` finalizes reservation -> redeemed.
   - `checkout.session.expired` and `checkout.session.async_payment_failed` release reservation.
5. Guardian approval flow:
   - Read routes: status/approvals are admin-only.
   - Mutations: admin-only route access + `adminToken` for execution.
   - Major actions can queue pending approvals (`202`) when token confirmation is missing.
6. Production toggles:
   - Keep `VF_AUTH_ENFORCE=1`.
   - Keep `NEXT_PUBLIC_ENABLE_DEV_UID_HEADER=0` (legacy `VITE_ENABLE_DEV_UID_HEADER=0` is still accepted during migration).
   - Keep `VF_ADMIN_COUPON_LIMIT_BYPASS=0` (dev-only escape hatch).
   - Set `GEMINI_RUNTIME_ADMIN_TOKEN` on both media-backend and gemini-runtime processes.

## Security Containment For This Repo

1. Firebase service-account handling:
   - Rotate and revoke any leaked Firebase service-account key immediately.
   - Keep service-account JSON out of the repo and rely on secret-manager injection only.
   - Run `npm run precommit:secrets` before sharing patches that touch config, auth, billing, or infra files.
2. Backend proxy hardening:
   - Set `VF_BACKEND_PROXY_ALLOWLIST` explicitly in production.
   - Set `VF_BACKEND_PROXY_MUTATION_ALLOWLIST` to only the prefixes that truly need write methods.
   - Treat any proxy allowlist expansion as a deploy review item, not a casual env tweak.
3. Canary gates for this remediation:
   - No secret-scan failures in `npm run audit:secrets`.
   - No 4xx or 5xx increase on proxy-routed traffic after tightening allowlists.
   - No job-queue growth or webhook reconciliation drift during rollout.

## Admin Control Plane Phase 2

1. RBAC role matrix:
   - `super_admin`: all permissions.
   - `billing_ops`: billing/coupon analytics + alert read.
   - `support_ops`: user/coupon support read-write + guardian/ops read.
   - `read_only_ops`: all `*.read` permissions only.
2. RBAC source and enforcement:
   - Source of truth: `admin_roles/{uid}`.
   - Use `VF_RBAC_ENABLED=1` and `VF_RBAC_ENFORCE=1` in production.
   - Legacy admin claims/flags are bootstrap fallback only when role doc is missing.
3. Approval-token mutation policy:
   - Alerts create/patch + ack/resolve require approval token confirmation.
   - Scheduler manual run (`/admin/scheduler/tasks/{taskId}/run`) requires approval token.
   - Guardian major actions continue to require approval-token flow.
4. Audit ledger verification:
   - Query events: `GET /admin/audit/events`.
   - Verify chain integrity: `GET /admin/audit/verify-chain`.
   - If mismatch is reported, freeze mutating admin operations and export relevant range for incident handling.
5. Alert webhook signature validation:
   - Webhook deliveries are HMAC SHA-256 signed using destination `secretRef`.
   - Validate signature on receiver side and reject missing/invalid signatures.
   - Retry cadence: 30s, 2m, 10m before marking delivery failed.
6. Scheduler safety and rollback:
   - Lock doc: `ops_scheduler_lock/current` prevents multi-instance duplicate runners.
   - Task runs are logged in `ops_task_runs/{runId}` with status/result/error.
   - For rollback, disable task (`enabled=false`) then manually run dry-run validation before re-enable.

## Startup Modes

1. Full local stack (recommended):
   - `npm run services:bootstrap`
2. GPU-preferred runtime mode:
   - `npm run services:bootstrap:gpu`
3. Verify runtime health:
   - `npm run services:check`
4. Audit Gemini/runtime wiring:
   - `npm run audit:gemini-stack`
5. Stop all managed runtimes:
   - `npm run services:down`

## Reliability CI Gate

1. Run strict reliability gates:
   - `npm run ci:reliability`
2. Included checks:
   - Type checks (`tsc --noEmit`)
   - Kubernetes manifest validation (`validate:k8s`)
   - PRIME and Duno Modal-gateway Hindi emotion audit
   - PRIME and Duno Modal-gateway long-text smoke audit
   - Media backend audit
   - Runtime contract conformance
3. Optional staging load gate:
   - `VF_ENABLE_LOAD_GATE=1 npm run ci:reliability`
   - Runs `test:load:50:all` (Node + k6).
4. Optional live TTS performance gate:
   - `VF_ENABLE_LIVE_AUDIT_GATE=1 npm run ci:reliability`
   - Runs `audit:tts:live` with balanced hard-fail checks.
5. Optional frontend/backend connectivity gate:
   - `VF_ENABLE_CONNECTIVITY_AUDIT_GATE=1 npm run ci:reliability`
   - Runs `audit:connectivity` (CORS preflight + auth boundary checks).
6. Run 50-concurrency load tests directly:
   - `npm run test:load:50:node`
   - `npm run test:load:50:k6`
   - `npm run test:load:50:all`
7. Load artifacts:
   - `backend/artifacts/load/*.json`
   - `backend/artifacts/frontend_backend_connectivity_audit.json`

## Frontend/Backend Connectivity Audit

1. Run connectivity audit:
   - `npm run audit:connectivity`
2. Optional custom origins:
   - `VF_AUDIT_ORIGINS=http://localhost:3000,http://127.0.0.1:3000 npm run audit:connectivity`
3. Auth for protected checks:
   - Preferred: `AUDIT_BEARER_TOKEN=<firebase_id_token>`
   - Dev fallback: `AUDIT_ALLOW_DEV_UID=1` and optional `AUDIT_DEV_UID=<uid>`
4. Report artifact:
   - `backend/artifacts/frontend_backend_connectivity_audit.json`
5. Interpretation:
   - Failing preflight checks indicate CORS/auth middleware regression.
   - Passing connectivity with key-pool warnings indicates transport is healthy but synthesis can still fail from key health/quota/auth issues.

## Core Runtime Flows

1. API pool allocator (Gemini):
   - Backend maps plan to pool hint in `_build_tts_upstream_payload` (`backend/app.py`) and forwards `poolHint`.
   - Gemini runtime resolves requested pool + fallback chain in `_resolve_request_key_plan` and `_ensure_runtime_pool_or_raise` (`backend/engines/gemini-runtime/app.py`).
   - Shared allocator (`backend/shared/gemini_allocator.py`) enforces RPM/TPM windows and key health through `acquire_for_task`, `release`, `mark_rate_limited`, and `mark_auth_failed`.
   - Pool visibility:
   - Runtime-native: `GET /v1/admin/api-pool` and `GET /v1/admin/api-pools`.
   - Backend merged view: `GET /admin/gemini/pools`.
2. Multispeaker synthesis path:
   - Frontend sends `speaker_voices`, `multi_speaker_mode`, and optional `multi_speaker_line_map`.
   - Backend validates/forwards fields via `_build_tts_upstream_payload` (`backend/app.py`).
   - Runtime normalizes voices + line-map and applies `studio_pair_groups` strategy in `_synthesize_text_to_wav` (`backend/engines/gemini-runtime/app.py`).
   - Shared normalization and grouping logic lives in `backend/shared/gemini_multi_speaker.py`.
3. POST `/tts/synthesize` and queued `/tts/jobs` flow:
   - Request enters `_submit_tts_job`, reserves quota/gateway capacity, and enqueues work.
   - Worker `_process_tts_job` calls runtime `/synthesize`, optionally emits live chunks, and persists chunk/result artifacts.
   - Retrieval:
   - Job status and chunk metadata: `GET /tts/jobs/{job_id}`.
   - Chunk bytes: `GET /tts/jobs/{job_id}/chunks/{chunk_index}`.

## Live Playback Without Full-Wait

1. Gateway callers should submit async live jobs:
   - Primary: `POST /tts/jobs` with `stream=true`
   - Fallback only: `POST /tts/synthesize?wait_ms=0`
2. Fast first-chunk tuning:
   - `live_chunk_chars=180`
   - `live_chunk_words=35`
3. Client polling for playback chunks:
   - Metadata poll: `GET /tts/jobs/{job_id}?includeResult=1&includeChunks=1&chunkCursor=<n>&chunkLimit=2&includeChunkAudio=0`
   - Chunk download: `GET /tts/jobs/{job_id}/chunks/{chunk_index}`
   - Legacy inline mode remains available via `includeChunkAudio=1`.
4. During generation:
   - Auto-play first chunk.
   - Queue-play subsequent chunks.
   - Keep seek disabled until final merged audio is ready.

## Live TTS Performance Audit

1. Default staged run (50 VUs / 200 requests):
   - `npm run audit:tts:live`
   - Or explicit profile shortcut: `npm run audit:tts:live:50`
2. Config knobs (env or CLI):
   - `VF_MEDIA_BACKEND_URL` / `--base-url`
   - `VF_LIVE_AUDIT_UID` / `--uid`
   - `VF_LIVE_AUDIT_CONCURRENCY` / `--concurrency`
   - `VF_LIVE_AUDIT_REQUESTS` / `--requests`
   - `VF_LIVE_AUDIT_REQUEST_TIMEOUT_MS` / `--request-timeout-ms`
   - `VF_LIVE_AUDIT_JOB_TIMEOUT_MS` / `--job-timeout-ms`
   - `VF_LIVE_AUDIT_POLL_MS` / `--poll-ms`
   - `VF_LIVE_AUDIT_SEED` / `--seed`
3. Output artifact:
   - `backend/artifacts/load/live_tts_performance_audit.json`
4. Balanced gate rules:
   - Hard-fail: completion rate, first-chunk observed rate, timeout rate, failed/cancelled rate, or preflight failure.
   - Warning-only: p95 first-chunk latency, p95 completion latency, p95 queue age, and admin telemetry p95 first-chunk latency.
5. Baseline comparison:
   - Keep prior artifact snapshots and compare `latencyMs`, `chunkMetrics`, and `queueSignals` across runs.

## Runtime Capabilities

1. Individual runtime capabilities:
   - `GET /v1/capabilities` on the Gemini runtime; Duno capabilities come from the backend `GET /tts/engines/capabilities` gateway
2. Aggregated capabilities:
   - `GET /tts/engines/capabilities` on media backend

## Failure Triage

1. Verify backend health:
   - `GET http://127.0.0.1:7800/health`
2. Check runtime capability availability:
   - `GET http://127.0.0.1:7800/tts/engines/capabilities`
3. Check gateway pressure and admin usage counters:
   - `GET /admin/tts/gateway/status`
   - `GET /admin/tts/queue/metrics`
   - `GET /admin/integrations/usage`
4. Inspect queued job debug fields:
   - `GET /tts/jobs/{job_id}`
   - Includes `deadlineAtMs`, `queueAgeMs`, `queueDepthAtRead`, `engineConcurrencyAtRead`.
5. Tail backend/runtime logs:
   - `GET /runtime/logs/tail?service=media-backend`
   - `GET /runtime/logs/tail?service=gemini-runtime`
   - Canonical log directory: `backend/.runtime/logs/`
6. If synthesis fails, use `trace_id`:
   - Request includes optional `trace_id`
   - Runtime response includes `X-VFlowAI-Trace-Id`
   - Find matching stage events in runtime logs
7. If live audio is not playing while generating:
   - Confirm gateway submission is async (`/tts/jobs` or `wait_ms=0` fallback).
   - Confirm job status returns `chunks` and increasing `chunkCursorNext`.
8. If frontend reports backend unreachable:
   - Run `npm run audit:connectivity`.
   - Confirm protected preflight checks are not returning `401`.
   - Ensure `VF_CORS_ORIGINS` includes the exact frontend origin.

## Quick Troubleshooting Map

1. Auth/permission failure on admin endpoints:
   - Symptom: `401/403` or unexpected `503` on `/admin/*`.
   - Check first:
   - `backend/artifacts/frontend_backend_connectivity_audit.json` (`audit:connectivity` result).
   - Backend auth logs around `_require_permission` and `_resolve_actor`.
   - Verify token source and `VF_AUTH_ENFORCE`.
2. Profile-store/identity enrichment failure:
   - Symptom: error contains `Failed to save user profile` or Firestore transaction rollback-id message.
   - Check first:
   - `/account/profile` and `/account/profile/bootstrap` behavior.
   - Firestore health/permissions for `user_profiles` and `user_id_index`.
   - Confirm fallback warning logs: `[user-profile-upsert] fallback_non_transactional ...`.
3. Pool allocator failure:
   - Symptom: `GEMINI_API_KEY_MISSING`, `GEMINI_KEY_POOL_OVERLOADED`, frequent 502/503 from runtime.
   - Check first:
   - `GET /admin/gemini/pools`.
   - Runtime `GET /v1/admin/api-pools`.
   - Key source files (`API.txt`, local `backend/config/gemini_api_pools.json`) and fallback chains.
   - Use tracked template `backend/config/gemini_api_pools.example.json` for schema only; never commit live pool state.
4. Post-TTS status and naming normalization checks:
   - Symptom: unexpected `x-vf-post-tts-conversion` value or stale history voice labels.
   - Check first:
   - Job payload from `GET /tts/jobs/{job_id}` and response headers.
   - Expected header value: `disabled` for PRIME/VECTOR because post-TTS conversion is not applied there.
   - `GET /account/generation-history` returns canonical `voiceId` and human `voiceName`.

## Recovery Procedure

1. Attempt idempotent engine switch:
   - `POST /tts/engines/switch` with `{ "engine": "VECTOR" | "PRIME", "gpu": false }`
2. If still unhealthy, restart services:
   - `npm run services:down`
   - `npm run services:bootstrap`
3. Re-run reliability checks:
   - `npm run audit:tts:hindi`
   - `npm run audit:tts:longtext:smoke`
   - `npm run audit:media`
   - `npm run test:contracts`
4. If queue overload persists under load:
   - Increase worker replicas and verify the Modal Duno endpoint capacity.
   - Scale managed Redis tier.
   - Tune:
     - `VF_TTS_ENGINE_CONCURRENCY_GEM`
     - `VF_TTS_ENGINE_CONCURRENCY_VECTOR`
     - `VF_TTS_QUEUE_JOB_TTL_MS`
     - `VF_TTS_QUEUE_SYNC_WAIT_MS`

