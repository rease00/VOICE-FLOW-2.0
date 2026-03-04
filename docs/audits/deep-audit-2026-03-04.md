# Deep Audit + Firebase/Auth Refactor (2026-03-04)

## Scope
- Frontend + backend runtime/audit status.
- `userId`/admin rule enforcement.
- Firebase admin bootstrap path from current allowlists.
- Regression status after refactor.

## Baseline Artifacts
- `artifacts/load/node-load-mixed-c10-1772351997504.json`
- `artifacts/load/node-load-mixed-c10-1772352099492.json`
- `artifacts/load/live_tts_performance_audit.json`
- `artifacts/load/k6-verdict-mixed-c10-1772352106101.json`

## Reproducible Command Results
1. Services health
- Command: `npm run services:check`
- Result: `PASS` for Gemini Runtime, Kokoro Runtime, LLVC Runtime, Media Backend.

2. Auth-gated backend audits (strict mode)
- Command: `npm run audit:connectivity` with `AUDIT_BEARER_TOKEN=<firebase_id_token>`
- Result: `PASS`.
- Command: `npm run audit:gemini-stack` with:
  - `AUDIT_BEARER_TOKEN=<firebase_id_token>`
  - `AUDIT_RUNTIME_ADMIN_TOKEN=<GEMINI_RUNTIME_ADMIN_TOKEN>`
- Result: `PASS`.
- Note: A 2-3s token warm-up delay is required after Firebase sign-in to avoid "Token used too early" on immediate verification.

3. Frontend production audit
- Command: `npm run frontend:audit:prod`
- Result: `PASS` (`typecheck`, `lint`, `vitest`, `build` all passed).

4. Backend tests
- Command: `python -m pytest tests -q` (from `backend/`)
- Result: `PASS` (`151 passed`).

5. Admin bootstrap dry run
- Command: `python scripts/firebase_seed_admins.py --dry-run` (from `backend/`)
- Result: `PASS` dry-run against current allowlisted UIDs from `.env`.

6. Firebase reset execution (full Firestore + Auth)
- Command: `python scripts/firebase_project_wipe.py` (dry-run)
- Result: `DRY RUN: firestore_docs_scanned=0 auth_users_scanned=6`.
- Command: `python scripts/firebase_project_wipe.py --apply --confirm WIPE_FIREBASE_NOW`
- Result: `APPLIED: firestore_docs_deleted=0 auth_users_deleted=6`.
- Command: `python scripts/firebase_seed_admins.py`
- Result: `APPLIED` with `created=5` admin users (password `rease1999`, custom claim `admin=true`, Firestore upserts enabled).

7. Live behavior validation after reset
- All 5 seeded admins returned `requiredUserId=false` on `GET /account/profile`.
- Non-admin without `userId` returned `requiredUserId=true` on `GET /account/profile`.
- Non-admin without `userId` received `428` on `POST /tts/synthesize?wait_ms=0`.

8. Firebase web config recovery
- Firebase Management API returned web app config for `voiceflow-000f`.
- `.env` was updated with `VITE_FIREBASE_*` values from `projects/voiceflow-000f/webApps/.../config`.

9. Local runtime admin token
- `.env` now includes `GEMINI_RUNTIME_ADMIN_TOKEN` (required for Gemini runtime `/v1/admin/api-pool*` endpoints).
- Services restarted and verified healthy.

10. Post-reset validation (final)
- Command: `npm run services:check`
- Result: `PASS`.
- Command: `python -m pytest tests -q` (from `backend/`)
- Result: `PASS (151 passed)`.
- Command: `npm run frontend:audit:prod`
- Result: `PASS`.
- Command: `npm run audit:connectivity` with bearer token
- Result: `PASS`.
- Command: `npm run audit:gemini-stack` with bearer + runtime admin token
- Result: `PASS`.
- Verified Firestore state:
  - `users` collection: 5 admin docs with `isAdmin/admin/role/roles`.
  - `admin_roles` collection: 5 docs with `role=super_admin`.
- Verified live auth behavior:
  - non-admin before setup: `requiredUserId=true`, `/tts/synthesize` -> `428`.
  - non-admin after one-time setup: `requiredUserId=false`, `/tts/synthesize` -> `202`.
  - admin: `requiredUserId=false`, profile `userId` write blocked (`403`), `/tts/synthesize` -> `202`.

## Implemented Refactor Summary
1. Backend `userId`/admin behavior
- Admins bypass `userId` middleware checks.
- Admin profile reads return `requiredUserId=false`.
- Admin profile writes reject `userId` updates (`403`).
- Admin bootstrap/readiness flow no longer attempts userId backfill.
- TTS submit path enforces one-time `userId` completion only for non-admin users (`428` on missing `userId`).

2. Backend Firestore resilience hardening
- Added Firestore boot probe in `backend/app.py`.
- If Firestore API is disabled/unavailable, backend now falls back to in-memory stores while keeping Firebase Auth active.
- Added `VF_FIRESTORE_ENABLE` env gate (`0` forces in-memory mode; pytest defaults to in-memory mode for deterministic tests).

3. Frontend auth + routing behavior
- Added dedicated one-time `USER_ID_SETUP` screen and route.
- Email/Google sign-in now returns and handles `requiresUserIdSetup`.
- Login flow routes to setup screen before `MAIN` when required.
- Facebook login entry removed from login UI.
- Added persistent setup flag key: `vf_uid_setup_required`.
- Profile screen no longer allows post-login editable `userId`.

4. Gemini runtime/test alignment
- Updated runtime model-candidate ordering logic for allocator-aware TTS path behavior.
- Updated key-pool and studio-pair test suites for current runtime function signatures and route behavior.
- Full backend pytest suite now passes.

5. Admin seed script v2
- Reworked `backend/scripts/firebase_seed_admins.py` to:
  - Seed from allowlists by default (`VF_ADMIN_APPROVER_UIDS`, `VITE_ADMIN_UID_ALLOWLIST`, `VITE_ADMIN_EMAIL_ALLOWLIST`, `VITE_ADMIN_LOGIN_EMAIL`).
  - Use fixed default password `rease1999` (overrideable via `--password`).
  - Set Firebase custom claim `admin=true`.
  - Upsert Firestore `users/{uid}` with `isAdmin/admin/role/roles`.
  - Upsert Firestore `admin_roles/{uid}` with `super_admin`.
  - Support `--dry-run` without firebase-admin dependency.

## Manual Cutover Steps Remaining (External Firebase Console)
1. Create brand-new Firebase project.
2. Enable: Auth, Firestore (Native), Storage.
3. Enable providers: Email/Password + Google only.
4. Generate new web app keys and replace `VITE_FIREBASE_*` env values.
5. Generate new service account key, store outside repo, set `GOOGLE_APPLICATION_CREDENTIALS` to external path.
6. Run admin seed script against new project:
   - `python scripts/firebase_seed_admins.py`
7. Validate with bearer token:
   - `npm run audit:connectivity`
   - `npm run audit:gemini-stack`
8. After validation, delete old Firebase project/data (no backup path).
   - Optional scripted wipe before project retirement:
   - `python scripts/firebase_project_wipe.py --apply --confirm WIPE_FIREBASE_NOW`

## Current Blocker
- None for reset/reseed/auth-flow scope in this project. Firestore + Auth reset and admin seeding are complete.

## Notes
- `.gitignore` already blocks service account key patterns (`*firebase-adminsdk*.json`).
- Auth-gated audits now pass with bearer + runtime admin tokens.
- Full "new Firebase project + delete old project" step still requires project-owner credentials in Firebase/GCP console.
