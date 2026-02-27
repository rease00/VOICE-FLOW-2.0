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

`npm run dev` reuses pre-running services, retries bootstrap failures, and auto-restarts crashed session-owned services with capped attempts.

## Services-Only Bootstrap

Start all servers and run health checks:

```powershell
npm run services:bootstrap
```

Start all servers in GPU mode:

```powershell
npm run services:bootstrap:gpu
```

Check service health only:

```powershell
npm run services:check
```

Stop all servers:

```powershell
npm run services:down
```

Dev orchestration env knobs:

```powershell
$env:VF_DEV_BOOTSTRAP_MODE="cpu"   # or "gpu"
$env:VF_DEV_BOOTSTRAP_RETRIES="3"
$env:VF_DEV_RETRY_BASE_MS="1500"
$env:VF_DEV_RETRY_MAX_MS="10000"
$env:VF_DEV_SERVICE_RESTART_MAX="3"
$env:VF_DEV_CRASH_WINDOW_MS="120000"
```

## Local Encrypted Admin Login (Frontend + Dev Backend)

This mode relies on backend UID resolution from `x-dev-uid`, so keep:

```powershell
$env:VF_AUTH_ENFORCE="0"
```

Frontend `.env` keys required:

```powershell
VITE_LOCAL_ADMIN_USERNAME=admin
VITE_LOCAL_ADMIN_UID=local_admin
VITE_LOCAL_ADMIN_PASSWORD_HASH_B64=<base64>
VITE_LOCAL_ADMIN_PASSWORD_SALT_B64=<base64>
VITE_LOCAL_ADMIN_PBKDF2_ITERATIONS=210000
VITE_LOCAL_ADMIN_SESSION_TTL_MIN=480
VITE_LOCAL_ADMIN_SESSION_KEY_B64=<base64>
```

If guardian approval actions are used, add the same UID to backend allowlist:

```powershell
$env:VF_ADMIN_APPROVER_UIDS="local_admin"
```

If local admin env keys are missing/invalid, `admin` login falls back to Firebase email/password:

```powershell
VITE_ADMIN_LOGIN_EMAIL=<your-admin-email>
VITE_ADMIN_EMAIL_ALLOWLIST=<comma-separated-emails>   # optional
VITE_ADMIN_UID_ALLOWLIST=<comma-separated-uids>       # optional
```

Firestore admin fallback (optional UI/admin resolution):
- `users/<uid>` document with `isAdmin: true` or `role: "admin"` (or `roles: ["admin"]`).

## Manual Per-Service Start (Separate Terminals)

If you do not want to use bootstrap, run each server manually.
Python entrypoints now auto-load `backend/.env` then root `.env` when env vars are unset/empty.

Media backend (port `7800`):

```powershell
python backend/app.py
```

Gemini runtime (port `7810`):

```powershell
python -m uvicorn app:app --app-dir backend/engines/gemini-runtime --host 127.0.0.1 --port 7810
```

Gemini runtime env vars (optional, for multi-key rate-limit fallback):

```powershell
$env:GEMINI_API_KEYS="AIzaKey1,AIzaKey2,AIzaKey3"
$env:GEMINI_API_KEYS_FILE="C:\Users\1wasi\OneDrive\Desktop\voice-Flow\API.txt"
$env:GEMINI_KEY_COOLDOWN_BASE_MS="8000"
$env:GEMINI_KEY_COOLDOWN_MAX_MS="120000"
$env:GEMINI_KEY_RETRY_LIMIT="8"
$env:GEMINI_KEY_WAIT_SLICE_MS="1000"
```

`GEMINI_API_KEYS_FILE` can be used by both backend and Gemini runtime to load key pools from a local file.

Kokoro runtime (port `7820`):

```powershell
python -m uvicorn app:app --app-dir backend/engines/kokoro-runtime --host 127.0.0.1 --port 7820
```

## Health Endpoints

- Media backend: `http://127.0.0.1:7800/health`
- Gemini runtime: `http://127.0.0.1:7810/health`
- Kokoro runtime: `http://127.0.0.1:7820/health`
- Runtime capabilities (per engine):
  - Gemini: `http://127.0.0.1:7810/v1/capabilities`
  - Kokoro: `http://127.0.0.1:7820/v1/capabilities`
- Aggregated capabilities:
  - Media backend: `http://127.0.0.1:7800/tts/engines/capabilities`
- Account generation history:
  - `GET http://127.0.0.1:7800/account/generation-history?limit=30`
  - `DELETE http://127.0.0.1:7800/account/generation-history`
- Admin Gemini key pool:
  - `GET http://127.0.0.1:7800/admin/gemini/pool/status`
  - `POST http://127.0.0.1:7800/admin/gemini/pool/reload`
  - Runtime reload proxy target: `POST http://127.0.0.1:7810/v1/admin/api-pool/reload`

## Useful Commands

Install backend requirements:

```powershell
npm run backend:install
```

Install optional RVC requirements:

```powershell
npm run backend:install:rvc
```

Switch active TTS engine (bootstrap helper):

```powershell
node backend/scripts/bootstrap-services.mjs switch KOKORO
node backend/scripts/bootstrap-services.mjs switch GEM
```

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
