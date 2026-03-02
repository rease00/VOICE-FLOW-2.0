# Reliability Runbook

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
   - Keep `VITE_ENABLE_DEV_UID_HEADER=0`.
   - Keep `VF_ADMIN_COUPON_LIMIT_BYPASS=0` (dev-only escape hatch).
   - Set `GEMINI_RUNTIME_ADMIN_TOKEN` on both media-backend and gemini-runtime processes.

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
   - GEM/KOKORO Hindi emotion audit
   - GEM/KOKORO long-text smoke audit
   - Media backend audit
   - Runtime contract conformance
3. Optional staging load gate:
   - `VF_ENABLE_LOAD_GATE=1 npm run ci:reliability`
   - Runs `test:load:50:all` (Node + k6).
4. Optional live TTS performance gate:
   - `VF_ENABLE_LIVE_AUDIT_GATE=1 npm run ci:reliability`
   - Runs `audit:tts:live` with balanced hard-fail checks.
5. Optional LLVC mapping audit gate:
   - `VF_ENABLE_LLVC_MAPPING_AUDIT_GATE=1 npm run ci:reliability`
   - Runs `audit:llvc:mapping` (gender and profile-map integrity).
6. Run 50-concurrency load tests directly:
   - `npm run test:load:50:node`
   - `npm run test:load:50:k6`
   - `npm run test:load:50:all`
7. Load artifacts:
   - `backend/artifacts/load/*.json`

## Live Playback Without Full-Wait

1. Gateway callers should submit async live jobs:
   - Primary: `POST /tts/jobs` with `stream=true`
   - Fallback only: `POST /tts/synthesize?wait_ms=0`
2. Fast first-chunk tuning:
   - `live_chunk_chars=180`
   - `live_chunk_words=35`
3. Client polling for playback chunks:
   - `GET /tts/jobs/{job_id}?includeResult=1&includeChunks=1&chunkCursor=<n>&chunkLimit=2&includeChunkAudio=1`
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
   - `VF_LIVE_AUDIT_STRICT_LLVC` / `--strict-llvc`
3. Output artifact:
   - `backend/artifacts/load/live_tts_performance_audit.json`
4. Balanced gate rules:
   - Hard-fail: completion rate, first-chunk observed rate, timeout rate, failed/cancelled rate, strict LLVC coverage, or preflight failure.
   - Warning-only: p95 first-chunk latency, p95 completion latency, p95 queue age, and admin telemetry p95 first-chunk latency.
5. Baseline comparison:
   - Keep prior artifact snapshots and compare `latencyMs`, `chunkMetrics`, `llvcMetrics`, and `queueSignals` across runs.

## LLVC Voice Mapping Audit

1. Run mapping audit:
   - `npm run audit:llvc:mapping`
2. Output artifact:
   - `backend/artifacts/load/llvc_voice_mapping_audit.json`
3. What it verifies:
   - Every runtime voice resolves to exactly one profile.
   - Mapped profile exists in profile bank.
   - Gender compatibility:
     - GEM uses runtime voice gender.
     - KOKORO uses prefix rule (`af/bf/hf=female`, `am/bm/hm=male`).
   - Designated child/elder slots remain correctly mapped.
4. Fix mode:
   - Enabled by default for deterministic mismatches.
   - Disable auto-fix with `VF_LLVC_MAPPING_AUDIT_FIX=0`.

## Runtime Capabilities

1. Individual runtime capabilities:
   - `GET /v1/capabilities` on Gemini/Kokoro runtimes
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
   - `GET /runtime/logs/tail?service=kokoro-runtime`
   - `GET /runtime/logs/tail?service=gemini-runtime`
   - Canonical log directory: `backend/.runtime/logs/`
6. If synthesis fails, use `trace_id`:
   - Request includes optional `trace_id`
   - Runtime response includes `X-VoiceFlow-Trace-Id`
   - Find matching stage events in runtime logs
7. If live audio is not playing while generating:
   - Confirm gateway submission is async (`/tts/jobs` or `wait_ms=0` fallback).
   - Confirm job status returns `chunks` and increasing `chunkCursorNext`.
   - Confirm `x-vf-post-tts-conversion=llvc` in terminal headers.
8. If strict LLVC fails during live chunks:
   - Check LLVC runtime health and model load.
   - Verify `VF_TTS_POST_LLVC_ENABLED=1` and `VF_TTS_POST_LLVC_REQUIRED=1`.
   - Run `npm run audit:llvc:mapping` and resolve mapping failures.
9. If male/female voices sound swapped:
   - Inspect `backend/config/voice_id_map.v1.json`.
   - Re-run `npm run audit:llvc:mapping` and review mismatch list in artifact.

## Recovery Procedure

1. Attempt idempotent engine switch:
   - `POST /tts/engines/switch` with `{ "engine": "KOKORO" | "GEM", "gpu": false }`
2. If still unhealthy, restart services:
   - `npm run services:down`
   - `npm run services:bootstrap`
3. Re-run reliability checks:
   - `npm run audit:tts:hindi`
   - `npm run audit:tts:longtext:smoke`
   - `npm run audit:media`
   - `npm run test:contracts`
4. If queue overload persists under load:
   - Increase worker/runtime replicas in Kubernetes.
   - Scale managed Redis tier.
   - Tune:
     - `VF_TTS_ENGINE_CONCURRENCY_GEM`
     - `VF_TTS_ENGINE_CONCURRENCY_KOKORO`
     - `VF_TTS_QUEUE_JOB_TTL_MS`
     - `VF_TTS_QUEUE_SYNC_WAIT_MS`

