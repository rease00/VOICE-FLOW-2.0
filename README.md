<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

Frontend architecture reference: `docs/FRONTEND_ARCHITECTURE.md`

View your app in AI Studio: https://ai.studio/apps/drive/1qQyJJgWzAPyyxA7ZA5J-aZQpALSdbKM7

## Run Locally

**Prerequisites:** Node.js, Python 3.10+, Git, FFmpeg


1. Install dependencies:
   `npm install`
2. Configure Gemini key pool in [`.env`](.env):
   `GEMINI_API_KEYS_FILE=C:\Users\1wasi\OneDrive\Desktop\voice-Flow\API.txt`
3. Run full local stack (services + UI in one lifecycle):
   `npm run dev`
4. Frontend-only mode (no service orchestration):
   `npm run dev:ui`

## Separated Frontend/Backend Commands

- Start frontend only: `npm run start:frontend`
- Start backend services only: `npm run start:backend`
- Start backend services in GPU mode for eligible runtimes: `npm run start:backend:gpu`

`start:backend` is idempotent: it reuses healthy running services, reconciles PID files to active listeners, and only restarts when runtime code/dependencies changed.

Run all frontend commands from one root command:
- `npm run frontend -- <frontend-script>`
- Example: `npm run frontend -- build`
- Production frontend audit contract (used by root CI): `npm run frontend -- audit:prod`

Run all backend commands from one root command:
- `npm run backend -- <backend-script>`
- Example: `npm run backend -- services:check`
- Verify backend status at any time: `npm run backend -- services:check`

Optional multi-key pool from file:
- Set `GEMINI_API_KEYS_FILE` to a local text file path (for example `C:\Users\1wasi\OneDrive\Desktop\voice-Flow\API.txt`).
- File format supports one key per line or comma/newline-separated keys.

## Local Encrypted Admin Login

Use this only for local/dev operation when backend auth enforcement is disabled (`VF_AUTH_ENFORCE=0`).
Production requirement: keep `VF_AUTH_ENFORCE=1`, `VITE_ENABLE_LOCAL_ADMIN_DEV_LOGIN=0`, and `VITE_ENABLE_DEV_UID_HEADER=0`.

1. Generate local admin credential values:

```powershell
node -e "const c=require('node:crypto');const pwd=process.argv[1];if(!pwd){console.error('Usage: node <script> <admin_password>');process.exit(1);}const salt=c.randomBytes(16);const it=210000;const hash=c.pbkdf2Sync(pwd,salt,it,32,'sha256');const key=c.randomBytes(32);console.log('VITE_LOCAL_ADMIN_PASSWORD_HASH_B64='+hash.toString('base64'));console.log('VITE_LOCAL_ADMIN_PASSWORD_SALT_B64='+salt.toString('base64'));console.log('VITE_LOCAL_ADMIN_PBKDF2_ITERATIONS='+it);console.log('VITE_LOCAL_ADMIN_SESSION_KEY_B64='+key.toString('base64'));" "<your_admin_password>"
```

2. Set these in `.env`:
- `VITE_ENABLE_LOCAL_ADMIN_DEV_LOGIN=1` (local dev only)
- `VITE_ENABLE_DEV_UID_HEADER=1` (local dev only)
- `VITE_LOCAL_ADMIN_USERNAME=admin`
- `VITE_LOCAL_ADMIN_UID=local_admin`
- `VITE_LOCAL_ADMIN_PASSWORD_HASH_B64=...`
- `VITE_LOCAL_ADMIN_PASSWORD_SALT_B64=...`
- `VITE_LOCAL_ADMIN_PBKDF2_ITERATIONS=210000`
- `VITE_LOCAL_ADMIN_SESSION_TTL_MIN=480`
- `VITE_LOCAL_ADMIN_SESSION_KEY_B64=...`

3. Ensure backend uses dev-UID resolution:
- `VF_AUTH_ENFORCE=0`
- Optional fallback UID: `VF_DEV_BYPASS_UID=dev_local_user`
- For guardian approvals, include local UID in `VF_ADMIN_APPROVER_UIDS` and configure `VF_ADMIN_APPROVAL_TOKEN`.

4. Keep dev server endpoints locked down by default:
- `VITE_DEV_SERVER_EXPOSE=0` (binds UI dev server to loopback)
- `VITE_ENABLE_LOCAL_BOOTSTRAP_ENDPOINT=0` (disables `/__local/bootstrap-services` route)
- `VF_DEV_BOOTSTRAP_TOKEN=<strong_random_token>` (required when enabling local bootstrap route)
- `VITE_API_BASE_URL=http://127.0.0.1:7800` (canonical frontend backend gateway base URL; same default when unset)
- `VF_CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000` (and add deployed frontend origins in remote environments)

## Admin Firebase Fallback (when local admin env is missing)

If `VITE_LOCAL_ADMIN_PASSWORD_HASH_B64` (or related local admin env vars) is missing/invalid, signing in with `admin` now falls back to Firebase email/password login.

1. Set frontend env mapping in `.env`:
- `VITE_ADMIN_LOGIN_EMAIL=<your-admin-email>`
- Optional: `VITE_ADMIN_EMAIL_ALLOWLIST=<comma-separated-emails>`
- Optional: `VITE_ADMIN_UID_ALLOWLIST=<comma-separated-uids>`

2. In Firebase (Firestore), mark the admin user for UI/admin fallback:
- Document path: `users/<uid>`
- Add one of:
  - `isAdmin: true`
  - `admin: true`
  - `role: "admin"`
  - `roles: ["admin"]`

3. Restart the frontend dev server after `.env` changes.

## Mandatory User ID Flow

- Email signup must include `userId` (immutable after creation).
- Google/email sign-in for non-admin users can return `requiredUserId=true`; frontend routes to one-time `USER_ID_SETUP` before `MAIN`.
- Admin users do not require or set `userId`.
- Profile screen shows `userId` read-only (no post-login edit flow).

## Seed Admins From Allowlists

Use backend allowlists as source-of-truth and seed Firebase Auth + Firestore admin flags:

```bash
cd backend
python scripts/firebase_seed_admins.py --dry-run
python scripts/firebase_seed_admins.py
```

Defaults:
- Password: `rease1999` (override with `--password`).
- Reads allowlists from env or `.env`: `VF_ADMIN_APPROVER_UIDS`, `VITE_ADMIN_UID_ALLOWLIST`, `VITE_ADMIN_EMAIL_ALLOWLIST`, `VITE_ADMIN_LOGIN_EMAIL`.
- Writes:
  - Firebase custom claim: `admin=true`
  - Firestore: `users/{uid}` with `isAdmin/admin/role/roles`
  - Firestore: `admin_roles/{uid}` with `super_admin`
- If Firestore API is disabled, run temporary Auth-only seed with `--skip-firestore` after enabling Auth APIs.
- For local runtime continuity when Firestore API is unavailable, set `VF_FIRESTORE_ENABLE=0` (in-memory fallback).

## Wipe Old Firebase Project Data

`backend/scripts/firebase_project_wipe.py` performs Firestore + Firebase Auth wipe for the currently configured project.

```bash
cd backend
python scripts/firebase_project_wipe.py
python scripts/firebase_project_wipe.py --apply --confirm WIPE_FIREBASE_NOW
```

- Default mode is dry-run.
- `--apply` requires explicit confirmation token.
- Use `--skip-firestore` or `--skip-auth-users` for partial cleanup.

## Real Voice Transfer + Media Backend

The app now supports a real local media backend for:
- Voice transfer cover conversion (`w-okada`)
- FFmpeg-based media utilities

## Isolated Python Runtimes (Per-Engine venv)

All backends now run locally using Python, each in its own virtual environment:
- `Media backend` on `7800`
- `Gemini runtime` on `7810`
- `Kokoro runtime` on `7820` (full Kokoro path, Hindi-enabled with tuned chunk/token flow)
- `Voice Transfer runtime` on `7830` (isolated timbre-transfer inference service)

Runtime/backend URLs are wired internally to local defaults in the app.

### One-click backend + TTS bootstrap

Create/update venvs, start all local services, and validate endpoints:
- `npm run services:bootstrap`

GPU-capable host (Gemini/voice-transfer can prefer GPU; Kokoro remains CPU-only):
- `npm run services:bootstrap:gpu`

Validate endpoints only:
- `npm run services:check`

Restart all services after backend/runtime code updates:
- `npm run services:restart`

Stop all bootstrapped services:
- `npm run services:down`

Dev orchestration env knobs (optional):
- `VF_DEV_BOOTSTRAP_MODE=cpu|gpu` (default `cpu`; Kokoro stays CPU-only in both modes)
- `VF_DEV_BOOTSTRAP_RETRIES=<n>` (default `3`)
- `VF_DEV_RETRY_BASE_MS=<ms>` (default `1500`)
- `VF_DEV_RETRY_MAX_MS=<ms>` (default `10000`)
- `VF_DEV_SERVICE_RESTART_MAX=<n>` (default `3`)
- `VF_DEV_CRASH_WINDOW_MS=<ms>` (default `120000`)

`npm run dev` behavior:
- retries bootstrap failures with bounded backoff
- auto-restarts crashed session-owned services (up to capped attempts)
- prints concise actionable errors and points to `backend/.runtime/logs/*.log`

Health checks include:
- `http://127.0.0.1:7800/health` (media backend)
- `http://127.0.0.1:7810/health` (Gemini runtime)
- `http://127.0.0.1:7820/health` (Kokoro runtime)
- `http://127.0.0.1:7830/v1/health` (Voice Transfer runtime)

Notes:
- Each runtime gets an isolated venv under `backend/.venvs/`.
- First bootstrap installs Python dependencies for each runtime.
- `services:bootstrap:gpu` sets GPU-first runtime envs for eligible runtimes; Kokoro ignores GPU mode and stays on CPU.
- Kokoro runtime includes Hindi voices (`hf_alpha`, `hf_beta`, `hm_omega`, `hm_psi`) and runs in strict no-fallback mode.
- `KOKORO_DEVICE` is retained for compatibility, but the Kokoro runtime is hard-pinned to CPU.
- Browser-side Kokoro execution is disabled. The app uses the backend Python Kokoro runtime instead of frontend-local inference.
- Runtime PID files are reconciled against live port listeners to avoid Windows launcher-PID drift.
- Service logs auto-rotate on startup/restart.

### Per-service Python interpreters

Set these only when you need hard interpreter isolation:
- `VF_PYTHON_BIN_MEDIA_BACKEND`
- `VF_PYTHON_BIN_GEMINI_RUNTIME`
- `VF_PYTHON_BIN_KOKORO_RUNTIME`
- `VF_PYTHON_BIN_VOICE_TRANSFER_RUNTIME`

`voice-transfer-runtime` enforces Python `3.11.x` and bootstrap will fail fast on mismatch.

### Bootstrap Log Rotation

`services:bootstrap` rotates oversized runtime logs before spawning services.

- `VF_SERVICE_LOG_ROTATE_MAX_BYTES` (default: `20971520`, i.e. 20 MB)
- `VF_SERVICE_LOG_ROTATE_KEEP` (default: `3`)

Set `VF_SERVICE_LOG_ROTATE_MAX_BYTES=0` to disable rotation.

### Troubleshooting: PID vs Listener Drift (Windows)

If a service appears to restart repeatedly, verify listeners directly:

- `npm run backend -- services:check`
- `npm run backend -- audit:bootstrap:idempotency`

### Voice Transfer model folder

Put your voice-transfer model files under:
- `backend/models/voice-transfer/<model-name>/model.pth`
- `backend/models/voice-transfer/<model-name>/model.index` (optional)

Then open Voice Lab -> `AI Covers (Voice Transfer)` -> `Refresh Models`.

### Voice Transfer OpenVINO (optional)

The default voice-transfer ONNX provider mode is `auto`.
On CPU/default bootstraps, `auto` now prefers OpenVINO first and bootstrap installs `onnxruntime-openvino` by default.
On GPU bootstraps, the runtime keeps the generic `onnxruntime` wheel and the existing CUDA -> DML -> CPU fallback path.

If you want the Intel OpenVINO execution provider instead:
- install `onnxruntime-openvino`
- on Windows, install the OpenVINO runtime/toolkit and load `setupvars.bat` before bootstrap
- set `VF_VOICE_TRANSFER_ONNX_PROVIDER=openvino`
- optionally set `VF_VOICE_TRANSFER_OPENVINO_DEVICE_TYPE` to `CPU`, `GPU`, `NPU`, or `AUTO:GPU,NPU,CPU`

### Voice Transfer CPU Defaults

CPU-oriented defaults now bias toward lower latency and cheaper pitch extraction:
- `VF_VOICE_TRANSFER_EXTRA_CONVERT_SIZE=256`
- default F0 extractor stays `rmvpe`
- CPU runtime requests that ask for `harvest` or `crepe*` are coerced back to `rmvpe`
- `pm` remains allowed and is mapped to the runtime's `dio` path

### Deep audit command

Run backend audit:
`npm run audit:media`

Run Gemini/runtime wiring audit:
`npm run audit:gemini-stack`

Run frontend/backend connectivity audit (CORS + auth preflight):
`npm run audit:connectivity`

Validate Kubernetes runtime/deployment manifests:
`npm run validate:k8s`

Optional sample checks:
- `VF_AUDIT_VIDEO=/path/to/sample.mp4 npm run audit:media`
- `VF_AUDIT_VIDEO=/path/to/sample.mp4 VF_AUDIT_AUDIO=/path/to/dub.wav npm run audit:media`

Audit report output:
- `backend/artifacts/media_backend_audit.json`
- `backend/artifacts/gemini_stack_audit.json`
- `backend/artifacts/frontend_backend_connectivity_audit.json`
- `backend/artifacts/k8s_manifest_validation_report.json`

### TTS Audits (GEM + KOKORO)

Run Hindi emotion coverage audit:
- `npm run audit:tts:hindi`

Run long-text smoke audit:
- `npm run audit:tts:longtext:smoke`

Run long-text matrix audit:
- `npm run audit:tts:longtext:matrix`

Full strict reliability pipeline (type checks + all required audits/contracts):
- `npm run ci:reliability`

Primary outputs:
- `backend/artifacts/tts_hi_30s_report.json`
- `backend/artifacts/runtime_contract_conformance_report.json`

Notes:
- Reliability runbook: `docs/RELIABILITY_RUNBOOK.md`
- Auth-first audit scripts:
  - `AUDIT_BEARER_TOKEN=<firebase_id_token>` (primary)
  - `AUDIT_RUNTIME_ADMIN_TOKEN=<gemini_runtime_admin_token>` for `audit:gemini-stack`
  - optional strict gate for k6: `VF_REQUIRE_K6=1`
  - optional explicit dev fallback only: `AUDIT_ALLOW_DEV_UID=1` and optional `AUDIT_DEV_UID=<uid>`
  - optional connectivity gate in CI: `VF_ENABLE_CONNECTIVITY_AUDIT_GATE=1`
  - if connectivity audit passes but synthesis still fails, inspect Gemini pool health in the audit output (`unhealthyKeys`, `atLimitKeys`, auth/leak issues).

## Generation History + Gemini Pool Admin

- Backend now stores per-user generation history as compressed metadata (`gzip+base64+json`) with no audio bytes.
- Frontend sidebar (`MainApp`) shows `Recent Generations` under `Recent Drafts`, including engine, voice, preview text, chars, and timestamp.
- History API:
  - `GET /account/generation-history?limit=30`
  - `DELETE /account/generation-history`
- Admin Gemini pool API:
  - `GET /admin/gemini/pool/status`
  - `POST /admin/gemini/pool/reload`
- Runtime pool reload endpoint:
  - `POST /v1/admin/api-pool/reload` on Gemini runtime (`7810`)

## Billing + Access Policy (2026)

- Canonical plans: `Free`, `Starter`, `Creator`, `Pro`, `Scale`.
- TTS engine access:
  - Free: `KOKORO`, `GOOD`, `NEURAL2` only (Prime `GEM` blocked).
  - Paid (`Starter|Creator|Pro|Scale`): all engines.
- Per-generation character cap:
  - Free: `8,000`
  - Starter/Creator/Pro: `10,000`
  - Scale: `15,000`
- Scale includes `features.earlyAccess=true` for future launches.
- Entitlements API (`GET /account/entitlements`) includes:
  - `limits.maxCharsPerGeneration`
  - `limits.allowedEngines`
  - `features.earlyAccess`

## Admin SaaS Control Plane (Phase 1)

- Admin panel layout is now priority-ordered and responsive:
  - `Users Control`
  - `Coupons`
  - `Gemini Pool`
  - `Ops / Usage`
- Coupons now support:
  - `wallet_credit` and `subscription_discount`
  - usage policies: `single_global`, `single_per_user`, `max_redemptions`
  - expiry default of 6 months (admin override supported)
  - auto-generated secure code flow (`POST /admin/coupons/generate-code`) with manual override support
- Subscription coupons:
  - support `percent` and `fixed_inr`
  - are constrained to first invoice (`duration=once`)
  - support plan scoping (`starter`, `creator`, `pro`, `scale`; legacy `plus` aliases to `scale`)
  - are auto-synced to Stripe promotion artifacts on create
- Checkout now supports internal coupon application:
  - `POST /billing/checkout-session` accepts optional `couponCode`
  - canonical checkout plans are `starter|creator|pro|scale` (`plus` input remains alias-compatible)
  - reservation/finalization flow is used for subscription coupons to keep policy enforcement safe under concurrency
  - Stripe promotion-code entry remains enabled in hosted checkout as fallback
- Token pack checkout:
  - `POST /billing/token-pack/checkout-session` accepts `pack`=`micro|standard|mega|ultra`
  - pricing matrix is fixed all-inclusive INR; Scale plan receives 20% pack discount
- Security hardening:
  - runtime-sensitive routes (`/runtime/logs/tail`, `/tts/engines/switch`, `/services/dubbing/prepare`, `/voice-transfer/load-model`) are admin-gated
  - mutating guardian operations are admin-gated
  - Gemini runtime `/v1/admin/api-pool*` routes require `GEMINI_RUNTIME_ADMIN_TOKEN`
  - production defaults should remain strict (`VF_AUTH_ENFORCE=1`, `VITE_ENABLE_DEV_UID_HEADER=0`)

## Admin SaaS Control Plane (Phase 2)

- RBAC tiers (Firestore-first):
  - roles: `super_admin`, `billing_ops`, `support_ops`, `read_only_ops`
  - source of truth: `admin_roles/{uid}`
  - legacy `admin` flags/claims are bootstrap fallback when no RBAC doc exists
- Immutable audit ledger:
  - append-only chain in `admin_audit_ledger/{eventId}` with state in `admin_audit_state/current`
  - SHA-256 hash chaining with chain verification endpoint
- Alerts engine:
  - policy store: `ops_alert_policies/{policyId}`
  - destinations: `ops_alert_destinations/{destId}` (webhook supported in Phase 2)
  - events: `ops_alert_events/{eventId}` with open/ack/resolved lifecycle
- Scheduler:
  - task store: `ops_scheduled_tasks/{taskId}`
  - run log: `ops_task_runs/{runId}`
  - distributed lock: `ops_scheduler_lock/current`
- Coupon analytics v2:
  - daily facts: `coupon_analytics_daily/{date_coupon_plan}`
  - attribution: `coupon_subscription_attributions/{subscriptionId}`
  - metrics: conversion, checkout completion, d30 churn, discount efficiency

### Phase 2 API families

- `GET /admin/rbac/roles`
- `GET /admin/rbac/users`
- `PUT /admin/rbac/users/{uid}`
- `POST /admin/rbac/users/{uid}/disable`
- `POST /admin/rbac/users/{uid}/enable`
- `GET /admin/audit/events`
- `GET /admin/audit/events/{eventId}`
- `GET /admin/audit/verify-chain`
- `GET /admin/alerts/policies`
- `POST /admin/alerts/policies`
- `PATCH /admin/alerts/policies/{policyId}`
- `GET /admin/alerts/destinations`
- `POST /admin/alerts/destinations`
- `PATCH /admin/alerts/destinations/{destId}`
- `GET /admin/alerts/events`
- `POST /admin/alerts/events/{eventId}/ack`
- `POST /admin/alerts/events/{eventId}/resolve`
- `GET /admin/scheduler/tasks`
- `POST /admin/scheduler/tasks`
- `PATCH /admin/scheduler/tasks/{taskId}`
- `POST /admin/scheduler/tasks/{taskId}/run`
- `GET /admin/scheduler/runs`
- `GET /admin/scheduler/runs/{runId}`
- `GET /admin/analytics/coupons/summary`
- `GET /admin/analytics/coupons/timeseries`
- `GET /admin/analytics/coupons/{couponCode}/impact`

## Novel Workspace v1 (Google Drive Powered)

The `Novel` tab now uses Google Drive as the primary workspace backend.

### Requirements

- You must authenticate with Google and grant Drive permissions.
- Email/password users can still sign in, but must link Google before using Novel storage/conversion tools.

### Storage Model

- Root folder: `VoiceFlow Novels`
- Novel folders: one folder per novel
- Chapters: Google Docs files (`Chapter 001 - <title>`, etc.)
- Exports: `Exports` subfolder inside each novel folder

### Conversion Flows

- Chapter -> PDF (Drive export)
- Word (`.docx`) -> PDF (import to Google Doc, then export PDF)
- PDF -> Word (`.docx`) (import PDF as Google Doc, then export DOCX)

Note: PDF -> DOCX may lose formatting for complex layouts depending on OCR/import quality.

### Idea Import (Metadata Only)

Backend endpoint:
- `POST /novel/ideas/extract`

Request body:
- `{ "source": "webnovel" | "pocketnovel", "url": "<source-url>" }`

Response shape:
- `{ ok, source, url, title, synopsis, tags, warnings }`

Only metadata is extracted for inspiration workflows. Full story scraping/copy ingestion is intentionally out of scope.
