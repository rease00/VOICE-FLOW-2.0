<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1qQyJJgWzAPyyxA7ZA5J-aZQpALSdbKM7

## Run Locally

**Prerequisites:** Node.js, Python 3.10+, Git, FFmpeg


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run full local stack (services + UI in one lifecycle):
   `npm run dev`
4. Frontend-only mode (no service orchestration):
   `npm run dev:ui`

## Local Encrypted Admin Login

Use this only for local/dev operation when backend auth enforcement is disabled (`VF_AUTH_ENFORCE=0`).

1. Generate local admin credential values:

```powershell
node -e "const c=require('node:crypto');const pwd=process.argv[1];if(!pwd){console.error('Usage: node <script> <admin_password>');process.exit(1);}const salt=c.randomBytes(16);const it=210000;const hash=c.pbkdf2Sync(pwd,salt,it,32,'sha256');const key=c.randomBytes(32);console.log('VITE_LOCAL_ADMIN_PASSWORD_HASH_B64='+hash.toString('base64'));console.log('VITE_LOCAL_ADMIN_PASSWORD_SALT_B64='+salt.toString('base64'));console.log('VITE_LOCAL_ADMIN_PBKDF2_ITERATIONS='+it);console.log('VITE_LOCAL_ADMIN_SESSION_KEY_B64='+key.toString('base64'));" "<your_admin_password>"
```

2. Set these in `.env`:
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

## Real RVC + Media Backend

The app now supports a real local media backend for:
- RVC cover conversion (`rvc-python`)
- FFmpeg-based media utilities

## Isolated Python Runtimes (Per-Engine venv)

All backends now run locally using Python, each in its own virtual environment:
- `Media backend` on `7800`
- `Gemini runtime` on `7810`
- `Kokoro runtime` on `7820` (full Kokoro path, Hindi-enabled with tuned chunk/token flow)
- `XTTS runtime` on `7860`

Then set URLs in app Settings:
- `Gemini TTS Runtime URL` (e.g. `http://127.0.0.1:7810`)
- `Kokoro TTS Runtime URL` (e.g. `http://127.0.0.1:7820`)
- `XTTS Runtime URL` (default `http://127.0.0.1:7860`)

### One-click backend + TTS bootstrap

Create/update venvs, start all local services, and validate endpoints:
- `npm run services:bootstrap`

GPU-capable host:
- `npm run services:bootstrap:gpu`

Validate endpoints only:
- `npm run services:check`

Restart all services after backend/runtime code updates:
- `npm run services:restart`
- Or target a single service/engine:
  - `node scripts/bootstrap-services.mjs restart media-backend`
  - `node scripts/bootstrap-services.mjs restart XTTS`

Stop all bootstrapped services:
- `npm run services:down`

Dev orchestration env knobs (optional):
- `VF_DEV_BOOTSTRAP_MODE=cpu|gpu` (default `cpu`)
- `VF_DEV_BOOTSTRAP_RETRIES=<n>` (default `3`)
- `VF_DEV_RETRY_BASE_MS=<ms>` (default `1500`)
- `VF_DEV_RETRY_MAX_MS=<ms>` (default `10000`)
- `VF_DEV_SERVICE_RESTART_MAX=<n>` (default `3`)
- `VF_DEV_CRASH_WINDOW_MS=<ms>` (default `120000`)

`npm run dev` behavior:
- retries bootstrap failures with bounded backoff
- auto-restarts crashed session-owned services (up to capped attempts)
- prints concise actionable errors and points to `.runtime/logs/*.log`

Health checks include:
- `http://127.0.0.1:7800/health` (media backend)
- `http://127.0.0.1:7810/health` (Gemini runtime)
- `http://127.0.0.1:7820/health` (Kokoro runtime)
- `http://127.0.0.1:7860/health` (XTTS runtime)
- `http://127.0.0.1:7860/v1/voices` (XTTS voice registry)

Notes:
- Each runtime gets an isolated venv under `.venvs/`.
- First bootstrap installs Python dependencies for each runtime.
- `services:bootstrap:gpu` sets GPU-first runtime envs where available.
- For full RVC conversion features, install optional deps with `npm run backend:install:rvc`.
- Kokoro runtime includes Hindi voices (`hf_alpha`, `hf_beta`, `hm_omega`, `hm_psi`) and runs in strict no-fallback mode.

### RVC model folder

Put your RVC model files under:
- `backend/models/rvc/<model-name>/model.pth`
- `backend/models/rvc/<model-name>/model.index` (optional)

Then open Voice Lab -> `AI Covers (RVC)` -> `Refresh Models`.

### Deep audit command

Run backend audit:
`npm run audit:media`

Optional sample checks:
- `VF_AUDIT_VIDEO=/path/to/sample.mp4 npm run audit:media`
- `VF_AUDIT_VIDEO=/path/to/sample.mp4 VF_AUDIT_AUDIO=/path/to/dub.wav npm run audit:media`

Audit report output:
- `artifacts/media_backend_audit.json`

### XTTS + Audio-Mix Audit v2 (Phase 1-2)

Run smoke audit (default path-compatible command):
- `npm run audit:xtts:audio-mix`
- `npm run audit:xtts:audio-mix:smoke`

Run matrix audit:
- `npm run audit:xtts:audio-mix:matrix`
  - Matrix selection is deterministic and capped by `VF_XTTS_AUDIO_AUDIT_MAX_SCENARIOS` (default `24`).

Compare current report vs baseline:
- `npm run audit:xtts:audio-mix:baseline`

Bless current report as new baseline (intentional update only):
- `npm run audit:xtts:audio-mix:bless`

CI-style flow (matrix + baseline compare):
- `npm run audit:xtts:audio-mix:ci`

Full strict reliability pipeline (type checks + all required audits/contracts):
- `npm run ci:reliability`

Primary outputs:
- `artifacts/xtts_audio_mix_audit_report.v2.json`
- `artifacts/xtts_audio_mix_audit_report.json` (compatibility summary)
- `artifacts/xtts_audio_mix_baseline_compare.json`
- `artifacts/runtime_contract_conformance_report.json`

Scenario config and baseline files:
- `data/tts/xtts_audio_mix_scenarios.json`
- `data/tts/baselines/xtts_audio_mix_baseline.json`

Environment variables:
- `VF_XTTS_AUDIO_AUDIT_MODE=smoke|matrix` (default `smoke`)
- `VF_XTTS_AUDIO_GATE_MODE=warn|enforce` (default `warn`)
- `VF_XTTS_AUDIO_BASELINE_PATH=<path>` (default `data/tts/baselines/xtts_audio_mix_baseline.json`)
- `VF_XTTS_AUDIO_AUDIT_MAX_SCENARIOS=<n>` (default `24`)
- `VF_XTTS_AUDIO_AUDIT_FAIL_FAST=0|1` (default `0`)

Gate lifecycle:
- `warn`: reports regressions and prints `would_fail=true`, exits success.
- `enforce`: same checks, exits non-zero when gates are violated.

Notes:
- Baseline should be blessed only after review of matrix results.
- PDF/perceptual/MOS scoring is intentionally not part of this phase.
- Reliability runbook: `docs/RELIABILITY_RUNBOOK.md`

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
