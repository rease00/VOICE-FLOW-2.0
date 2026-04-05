# Server Startup Commands

This file lists the exact commands to start and manage all local servers for this repo.

## Prerequisites

- Node.js
- Python 3.10+
- FFmpeg on `PATH`
- Project dependencies installed:

```powershell
npm install
```

## One-Command Start (Recommended)

Start full stack (services + Vite in one lifecycle):

```powershell
npm run dev
```

Frontend-only mode:

```powershell
npm run dev:ui
```

Separated start commands:

```powershell
npm run start:frontend
npm run start:backend
npm run start:backend:gpu
```

`start:backend:gpu` keeps the dedicated Cloud TTS runtime and Vertex text runtime split while enabling GPU mode for eligible local runtimes.

`npm run start:backend` is idempotent: it reconciles PID files with active listener PIDs and avoids unnecessary restarts unless runtime code/dependencies changed.

Unified command entrypoints:

```powershell
npm run frontend -- build
npm run frontend -- test:ci
npm run backend -- services:check
npm run backend -- ci:reliability
```

`npm run dev` reuses pre-running services, retries bootstrap failures, and auto-restarts crashed session-owned services with capped attempts.

## Services-Only Bootstrap

Start all servers and run health checks:

```powershell
npm run services:bootstrap
```

Start all servers in GPU mode for eligible runtimes:

```powershell
npm run services:bootstrap:gpu
```

Check service health only:

```powershell
npm run services:check
```

Quick verification:

```powershell
npm run backend -- services:check
```

Stop all servers:

```powershell
npm run services:down
```

Dev orchestration env knobs:

```powershell
$env:VF_DEV_BOOTSTRAP_MODE="cpu"   # or "gpu"; Cloud TTS and Vertex text remain split
$env:VF_DEV_BOOTSTRAP_RETRIES="3"
$env:VF_DEV_RETRY_BASE_MS="1500"
$env:VF_DEV_RETRY_MAX_MS="10000"
$env:VF_DEV_SERVICE_RESTART_MAX="3"
$env:VF_DEV_CRASH_WINDOW_MS="120000"
```

Log rotation knobs for bootstrap:

```powershell
$env:VF_SERVICE_LOG_ROTATE_MAX_BYTES="20971520"  # 20 MB default
$env:VF_SERVICE_LOG_ROTATE_KEEP="3"
```

## Firebase-Only Admin Login

Local encrypted admin login is disabled. Authentication is Firebase-only.

Production requirement: keep `VF_AUTH_ENFORCE=1` and `VITE_ENABLE_DEV_UID_HEADER=0`.

Optional local-dev bootstrap: set `VF_DEV_AUTO_SEED_FIREBASE_ADMINS=1` so `npm run dev` seeds allowlisted Firebase admins before the frontend starts when `GOOGLE_APPLICATION_CREDENTIALS` or `FIREBASE_SERVICE_ACCOUNT_JSON` is available.

Frontend `.env` keys (optional admin mapping):

```powershell
NEXT_PUBLIC_ADMIN_LOGIN_EMAIL=<your-admin-email>
NEXT_PUBLIC_ADMIN_EMAIL_ALLOWLIST=<comma-separated-emails>   # optional
NEXT_PUBLIC_ADMIN_UID_ALLOWLIST=<comma-separated-uids>       # optional
VITE_ADMIN_LOGIN_EMAIL=<your-admin-email>                     # transitional alias
VITE_ADMIN_EMAIL_ALLOWLIST=<comma-separated-emails>          # transitional alias
VITE_ADMIN_UID_ALLOWLIST=<comma-separated-uids>              # transitional alias
FIREBASE_SEED_ADMIN_PASSWORD=<strong-admin-password>   # local-dev seed password
VITE_DEV_SERVER_EXPOSE=0
VITE_ENABLE_LOCAL_BOOTSTRAP_ENDPOINT=0
```

Local Google sign-in note:
- Open the app on `http://localhost:3000` in dev. The frontend also redirects `127.0.0.1` to `localhost` so Firebase OAuth stays on an authorized domain.

If guardian approval actions are used, allow explicit admin UIDs:

```powershell
$env:VF_ADMIN_APPROVER_UIDS="<firebase_uid_1>,<firebase_uid_2>"
```

Firestore admin role mapping (optional UI/admin resolution):
- `users/<uid>` document with `isAdmin: true` or `role: "admin"` (or `roles: ["admin"]`).

## Manual Per-Service Start (Separate Terminals)

If you do not want to use bootstrap, run each server manually.
Python entrypoints now auto-load `backend/.env` then root `.env` when env vars are unset/empty.

Media backend (port `7800`):

```powershell
python -m uvicorn app:app --app-dir backend --host 127.0.0.1 --port 7800
```

Gemini runtime (port `7810`):

```powershell
python -m uvicorn app:app --app-dir backend/engines/gemini-runtime --host 127.0.0.1 --port 7810
```

Gemini runtime env vars (optional, for multi-key rate-limit fallback):

```powershell
$env:GEMINI_RUNTIME_ADMIN_TOKEN="<shared-admin-token>"
$env:GEMINI_API_KEYS="AIzaKey1,AIzaKey2,AIzaKey3"
$env:GEMINI_API_KEYS_FILE="C:\Users\1wasi\OneDrive\Desktop\voice-Flow\API.txt"
$env:GEMINI_KEY_COOLDOWN_BASE_MS="8000"
$env:GEMINI_KEY_COOLDOWN_MAX_MS="120000"
$env:GEMINI_KEY_RETRY_LIMIT="8"
$env:GEMINI_KEY_WAIT_SLICE_MS="1000"
# Optional override. When unset, allocator rotates to the next key after each success.
$env:GEMINI_KEY_ROTATION_BURST="3"
# Optional. Re-enable sticky speaker-to-key affinity for repeated voices if you prefer consistency over spread.
$env:GEMINI_SPEAKER_KEY_AFFINITY_ENABLED="1"
$env:GEMINI_ALLOCATOR_DEFAULT_WAIT_TIMEOUT_MS="90000"
$env:GEMINI_TTS_ALLOCATOR_RPM="3"
$env:GEMINI_TTS_ALLOCATOR_TPM="10000"
$env:GEMINI_TTS_ADMISSION_MAX_WAIT_MS="18000"
$env:GEMINI_TTS_ADMISSION_SOFT_MARGIN_MS="1200"
$env:GEMINI_BATCH_DEFAULT_PARALLEL="4"
$env:GEMINI_BATCH_PARALLEL_LIMIT="100"
```

`GEMINI_API_KEYS_FILE` can be used by both backend and Gemini runtime to load key pools from a local file.
Baseline allocator defaults should match cloud limits for Gemini 2.5 Flash TTS (`3 RPM / 10K TPM` per key) unless you explicitly override env vars.
By default, allocator rotates one successful request at a time so large key pools get used more evenly. Set `GEMINI_KEY_ROTATION_BURST` to a value greater than `1` only if you intentionally want consecutive requests to stay on the same key.
Cross-request speaker-to-key affinity is disabled by default for the same reason. Set `GEMINI_SPEAKER_KEY_AFFINITY_ENABLED=1` only if you explicitly want repeated speaker groups to prefer the same key.
After changing allocator limits or key pool files, restart both media backend and gemini runtime so active processes pick up the new effective limits.

The local stack now uses a dedicated Cloud TTS runtime for synthesis and a separate Vertex text runtime for text/AI calls.
OpenVoice/Seed-VC is also Modal-hosted remotely; configure `VF_OPENVOICE_RUNTIME_URL`, and set `VF_OPENVOICE_RUNTIME_TOKEN` plus `VF_OPENVOICE_ARTIFACT_SECRET` when the Modal service is private.

Media backend TTS gateway concurrency env vars:

```powershell
$env:VF_TTS_GATEWAY_MAX_ACTIVE="100"
$env:VF_TTS_GATEWAY_QUEUE_MAX="300"
$env:VF_TTS_GATEWAY_QUEUE_WAIT_TIMEOUT_MS="30000"
```

## Health Endpoints

- Media backend: `http://127.0.0.1:7800/health`
- Gemini runtime: `http://127.0.0.1:7810/health`
- Duno runtime: use the media backend TTS gateway; there is no local `7820` process anymore.
- Runtime capabilities (per engine):
  - Gemini: `http://127.0.0.1:7810/v1/capabilities`
  - Duno: use `http://127.0.0.1:7800/tts/engines/capabilities`
- Aggregated capabilities:
  - Media backend: `http://127.0.0.1:7800/tts/engines/capabilities`
- Account generation history:
  - `GET http://127.0.0.1:7800/account/generation-history?limit=30`
  - `DELETE http://127.0.0.1:7800/account/generation-history`
- Admin Gemini key pool:
  - `GET http://127.0.0.1:7800/admin/gemini/pool/status`
  - `POST http://127.0.0.1:7800/admin/gemini/pool/reload`
  - Runtime reload proxy target: `POST http://127.0.0.1:7810/v1/admin/api-pool/reload`
- Admin integrations usage:
  - `GET http://127.0.0.1:7800/admin/integrations/usage`
  - `GET http://127.0.0.1:7800/admin/integrations/usage/export?format=json|csv&window=total|24h|7d`
  - `GET http://127.0.0.1:7800/admin/tts/gateway/status`
- Admin coupons:
  - `POST http://127.0.0.1:7800/admin/coupons/generate-code`
  - `POST http://127.0.0.1:7800/admin/coupons`
  - `GET http://127.0.0.1:7800/admin/coupons?couponType=wallet_credit|subscription_discount`
  - `PATCH http://127.0.0.1:7800/admin/coupons/{coupon_id}`
- Billing checkout (internal + Stripe fallback promotions):
  - `POST http://127.0.0.1:7800/billing/checkout-session` with optional `couponCode`

## Useful Commands

Install backend requirements:

```powershell
npm run backend:install
```

Switch active TTS engine (bootstrap helper):

```powershell
node backend/scripts/bootstrap-services.mjs switch PRIME
node backend/scripts/bootstrap-services.mjs switch VECTOR
```

Legacy retired-engine selections are normalized to `VECTOR`, so there is no separate bootstrap switch target for the removed engine.

Run strict reliability gate pipeline:

```powershell
npm run ci:reliability
```

Run Gemini/runtime wiring audit:

```powershell
npm run audit:gemini-stack
```

## Logs and Runtime State

- Runtime logs: `backend/.runtime/logs/`
- PID files: `backend/.runtime/pids/`
- Venvs used by bootstrap: `backend/.venvs/`
- Legacy root `.runtime/` can contain stale logs from old startup paths; treat `backend/.runtime/` as canonical.
- Bootstrap reconciles tracked PID files to live listener PIDs on each run.
- Oversized logs are rotated to `.log.1`, `.log.2`, etc before service spawn.

Bootstrap idempotency audit:

```powershell
npm run backend -- audit:bootstrap:idempotency
```

Per-service Python interpreter env vars (optional):
- `VF_PYTHON_BIN_MEDIA_BACKEND`
- `VF_PYTHON_BIN_GEMINI_RUNTIME`
