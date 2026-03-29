# Deep Production Audit Report

- Audit date: 2026-03-07
- Run timestamp: 2026-03-07T10:37:17.6554378+05:30
- Workspace: `C:\Users\1wasi\OneDrive\Desktop\voice-Flow`
- Branch / base: `main` at `ae80ea30fa558ac38e8cf080f9005d038f6e56a9`
- Scope: current dirty workspace only, including uncommitted changes
- Release candidate size: 105 changed files
- Evidence bundle: `docs/audits/artifacts/2026-03-07-deep-audit-run`
- Referenced machine artifacts: `backend/artifacts/runtime_contract_conformance_report.json`, `backend/artifacts/k8s_manifest_validation_report.json`
- API / type changes: none made as part of this audit

## Executive Summary

This audit reviewed the current dirty `main` workspace as the release candidate, not just the last commit. Static gates are mostly green, but the build is not production-ready in its current state.

Current verdict:

- High severity findings: 2
- Medium severity findings: 2
- Low severity findings: 1
- Audit blockers: 1 material blocker

What passed:

- `npm run audit:secrets:tracked-config`
- `npm run frontend:audit:prod`
- `npm run validate:k8s`
- `cd backend && python -m pytest tests -q`

What failed or remained blocked:

- `npm run services:check` failed because the media backend health path never completed successfully
- `npm run test:contracts` failed with an aborted runtime contract audit
- `npm --prefix frontend run e2e:smoke` failed 2 reader playback tests
- `npm run audit:media`, `npm run audit:gemini-stack`, and the auth-gated portion of `npm run ci:reliability` were blocked by missing production-style bearer auth
- `audit:connectivity` was not run for the same reason

The highest-risk issues are deployment drift in the Cloud Run rollout path after the LLVC to voice-transfer rename, and a backend readiness / capabilities path that hangs badly enough to break readiness and contract checks.

## Environment Snapshot

- Local stack expected in scope: `3000`, `5173`, `7800`, `7810`, `7830`, plus the Modal-hosted Duno endpoint configured via `VF_DUNO_RUNTIME_URL`
- Major churn areas in this release candidate:
  - `backend/app.py`
  - `backend/engines/**`
  - `backend/video_dubbing/**`
  - `frontend/views/MainApp.tsx`
  - reader and notifications surfaces under `frontend/src/**`
  - deploy surfaces under `backend/deploy/k8s/**` and `infra/cloudrun/**`
- Relevant env posture captured by name only:
  - Firebase API key present
  - runtime admin token present
  - admin email absent
  - no production-style bearer token available from the current local env
- Existing backend artifacts were reused instead of duplicated where scripts already emitted reports

## Command Matrix

| Check | Status | Evidence | Notes |
| --- | --- | --- | --- |
| `npm run audit:secrets:tracked-config` | PASS | `01-audit-secrets-tracked-config.txt` | Tracked config scan passed |
| `npm run frontend:audit:prod` | PASS | `02-frontend-audit-prod.txt` | Typecheck, lint, vitest, and production build passed with 4 warnings |
| `npm run validate:k8s` | PASS | `03-validate-k8s.txt` | Validation report emitted under `backend/artifacts/` |
| `cd backend && python -m pytest tests -q` | PASS | `04-backend-pytest.txt` | Passed when run from the correct `backend` cwd |
| `npm run services:check` | FAIL | `05-services-check.txt` | Media backend health check aborted after retries; sibling runtimes passed |
| `npm run test:contracts` | FAIL | `06-test-contracts.txt` | Contract report written but failed with `This operation was aborted` |
| `npm run audit:media` | BLOCKED | `07-audit-media.txt` | Requires `AUDIT_BEARER_TOKEN`; dev fallback intentionally not used |
| `npm run audit:gemini-stack` | BLOCKED | `08-audit-gemini-stack.txt` | Requires `AUDIT_BEARER_TOKEN`; dev fallback intentionally not used |
| `npm run ci:reliability` | FAIL | `09-ci-reliability.txt` | Failed at auth-gated media backend audit stage |
| `npm --prefix frontend run e2e:smoke` | FAIL | `10-frontend-e2e-smoke.txt` | 8 passed, 2 failed in reader active-session playback flow |
| `audit:connectivity` | BLOCKED | `11-auth-token-attempt.txt` | Not run without a real bearer token |

## Findings

### 1. High: Cloud Run deploy path still targets LLVC-era placeholder and service names

- Severity: High
- Area: Deploy / production rollout
- Evidence:
  - `infra/cloudrun/services.default.json` now points at `voiceflow-voice-transfer-runtime` and uses `__VOICE_TRANSFER_RUNTIME_URL__`
  - `infra/cloudrun/deploy.ps1` still resolves `__LLVC_RUNTIME_URL__`, looks up `voiceflow-llvc-runtime`, falls back to `https://voiceflow-llvc-runtime.a.run.app`, and throws `LLVC runtime URL is not available yet.`
  - See evidence searches in `cloudrun-deploy-placeholder-search.txt` and `cloudrun-services-search.txt`
- Impact:
  - A production deploy can render stale runtime URLs into service config or fail while trying to resolve a service name that the config no longer uses
  - This is a concrete rollout bug, not just documentation drift
- Likely fix direction:
  - Align `infra/cloudrun/deploy.ps1` with `services.default.json`
  - Replace LLVC placeholder and service-name references with the voice-transfer equivalents everywhere in the deploy script
  - Add a post-render validation step that rejects unresolved runtime placeholders before deploy
- Verification step:
  - Re-render or dry-run the Cloud Run config and confirm there are no `LLVC` placeholders or `voiceflow-llvc-runtime` references left in the effective deployment payload

### 2. High: Media backend readiness and capability paths hang, breaking release gates

- Severity: High
- Area: Backend readiness / runtime integration
- Evidence:
  - `05-services-check.txt` shows `Media Backend` failed after 4 attempts and 72.1 seconds with `This operation was aborted`
  - `manual-probe-health-7800.txt` and `manual-probe-health-7800-curl.txt` show `http://127.0.0.1:7800/health` timing out
  - `manual-probe-media-capabilities-curl.txt` shows `http://127.0.0.1:7800/tts/engines/capabilities` timing out
  - Direct child runtime probes stayed healthy:
    - `manual-probe-gemini-health.txt`
    - `manual-probe-duno-health.txt`
    - `manual-probe-voice-transfer-health.txt`
  - The backend health route in `backend/app.py` performs synchronous downstream checks, including `llvc_runtime.ensure_engine()` and source-separation/video asset status work, instead of staying shallow
- Impact:
  - Health and capabilities endpoints are not usable as reliable readiness signals
  - Release gating scripts fail even when the underlying child runtimes are alive
  - This can create false outage signals, slow restarts, and failed orchestration in production-like environments
- Likely fix direction:
  - Split shallow health from deep dependency audits
  - Put strict time bounds and caching around expensive downstream checks
  - Keep `/health` fast and deterministic; move deeper engine validation to a separate diagnostic endpoint
- Verification step:
  - `curl http://127.0.0.1:7800/health` and `curl http://127.0.0.1:7800/tts/engines/capabilities` should complete quickly and `npm run services:check` plus `npm run test:contracts` should pass with populated reports

### 3. Medium: Reader active-session flow regressed and no longer reaches playback stage automatically

- Severity: Medium
- Area: Frontend reader flow
- Evidence:
  - `10-frontend-e2e-smoke.txt` shows 2 failures, desktop and mobile, both on `reader active session shows playback stage with dock pinned`
  - Both failures are waiting for the `Playback timeline` heading from the playback stage
  - `frontend/src/features/reader/components/ReaderTabContent.tsx` defaults `workspaceMode` to `browse`, restores `resumeSession`, but only switches into playback mode inside the explicit resume handler
  - `ReaderPlaybackStage.tsx` still contains the expected `Playback timeline` heading, so the view exists but is not being reached in the active-session path
- Impact:
  - Users landing with an active reader session do not arrive at the playback workspace expected by the smoke contract
  - The regression affects both desktop and mobile
- Likely fix direction:
  - Decide whether active-session restore should force playback mode
  - If yes, switch modes when a valid session is restored
  - If no, update the smoke contract and any product requirements to reflect the intentional behavior change
- Verification step:
  - Re-run `npm --prefix frontend run e2e:smoke` and confirm the reader active-session tests pass on both desktop and mobile

### 4. Medium: LLVC to voice-transfer migration is incomplete in operator-facing docs and runbooks

- Severity: Medium
- Area: Operational documentation / release hygiene
- Evidence:
  - `README.md` still refers to `LLVC runtime`, `backend:install:llvc`, `backend/models/llvc/...`, and `/llvc/load-model`
  - `infra/cloudrun/README.md` still refers to `voiceflow-llvc-runtime` and LLVC scaling guidance
  - Search evidence is captured in `llvc-reference-search.txt`
- Impact:
  - Operators and reviewers can follow broken or obsolete instructions during deploy, incident response, or environment setup
  - This increases rollout risk even if the application code has already moved on
- Likely fix direction:
  - Sweep root and infra docs for LLVC-era references
  - Replace them with voice-transfer runtime names, current endpoints, and current install/bootstrap commands
  - Remove or clearly mark historical references
- Verification step:
  - `rg -n "LLVC|backend:install:llvc|/llvc/" README.md infra/cloudrun` should return either nothing or clearly intentional historical notes only

### 5. Low: Frontend production bundle remains large and still carries warning debt

- Severity: Low
- Area: Frontend performance / release hygiene
- Evidence:
  - `02-frontend-audit-prod.txt` reports 4 lint warnings in:
    - `frontend/components/AudioPlayer.tsx`
    - `frontend/src/features/reader/components/ReaderTabContent.tsx`
    - `frontend/src/shared/notifications/NotificationProvider.tsx`
    - `frontend/src/shared/notifications/NotificationUI.tsx`
  - The production build emits chunk-size warnings, including:
    - `assets/vendor-CBeBMY-i.js` at `1,753.64 kB`
    - `assets/ort-wasm-simd-threaded.jsep-B0T3yYHD.wasm` at `21,596.02 kB`
- Impact:
  - Not an immediate release blocker, but it increases load cost, warning noise, and the chance of avoidable frontend regressions under weaker network conditions
- Likely fix direction:
  - Split large chunks more deliberately
  - Lazy-load the heaviest admin / ML / Firebase surfaces where practical
  - Resolve the current lint warnings so new signal is easier to detect
- Verification step:
  - Re-run `npm run frontend:audit:prod` and confirm the build either stays within an explicit performance budget or carries documented exceptions only

## Blockers

### Missing real bearer auth for protected audit coverage

- Evidence:
  - `11-auth-token-attempt.txt` shows `firebaseApiKeyPresent=True`, `adminEmailPresent=False`, `runtimeAdminTokenPresent=True`, `tokenAttempt=SKIPPED_MISSING_ENV`
  - `07-audit-media.txt` and `08-audit-gemini-stack.txt` explicitly require `AUDIT_BEARER_TOKEN` unless the audit is forced into a dev fallback mode
- Impact:
  - The production verdict remains incomplete for auth-gated backend surfaces
  - The following items are blocked until a real bearer token is supplied:
    - `audit:connectivity`
    - protected `/account/*` and `/admin/*` boundary checks
    - auth-gated reader and media backend audit coverage
- Required next step:
  - Provide a real bearer token for an admin-capable test identity and rerun the blocked checks without enabling dev UID fallback

## Improvements and Closed Risks

- `backend` pytest passed from the correct working directory, which removes concern that the current code delta is broadly test-broken at the Python suite level
- Runtime admin exposure on the Gemini runtime looks correctly gated in the checked path:
  - `manual-probe-gemini-runtime-admin.txt` shows no-auth `GET /v1/admin/api-pool` returned `403`
  - the configured runtime admin token returned `200` with the pool payload
- Tracked config secret scan passed, and this audit recorded env names and presence only, never secret values

## Release Hygiene Notes

- Secret exposure posture in tracked config is currently acceptable based on the tracked-file scan
- Env-contract drift exists in deploy automation, which is more serious than doc drift because it affects rendered production config
- Artifact sprawl is manageable, but reports are split between `docs/audits/artifacts/...` and `backend/artifacts/...`; keep that split documented rather than implicit
- LLVC-era references still exist after the migration and should be cleaned before release sign-off

## Remediation Order

1. Fix the Cloud Run deploy script so voice-transfer runtime URLs render correctly in production deploys.
2. Make backend `/health` and engine capability routes shallow, bounded, and reliable enough for readiness and contract gates.
3. Obtain a real `AUDIT_BEARER_TOKEN` and rerun all auth-gated audits and boundary probes without dev fallback.
4. Resolve the reader active-session behavior or update the smoke contract if the behavior change was intentional.
5. Clean LLVC-era docs and runbooks so operator instructions match the current runtime layout.
6. Reduce frontend warning debt and bundle size where feasible.

## Rerun Checklist

1. Bring up the same local stack on `3000`, `5173`, `7800`, `7810`, and `7830`, and confirm the Modal-hosted Duno endpoint is reachable via the backend gateway configuration.
2. Export a real `AUDIT_BEARER_TOKEN` for a test user with the intended privileges. Do not use `AUDIT_ALLOW_DEV_UID=1` for the production verdict.
3. Re-run the command matrix in the same order:
   - `npm run audit:secrets:tracked-config`
   - `npm run frontend:audit:prod`
   - `npm run validate:k8s`
   - `cd backend && python -m pytest tests -q`
   - `npm run services:check`
   - `npm run test:contracts`
   - `npm run audit:media`
   - `npm run audit:gemini-stack`
   - `npm run ci:reliability`
   - `npm --prefix frontend run e2e:smoke`
4. Re-run manual probes with no auth, invalid auth, non-admin auth, and admin auth for:
   - `/health`
   - `/account/*`
   - `/tts/synthesize`
   - `/tts/jobs/*`
   - `/admin/*`
   - `/runtime/logs/tail`
   - runtime `/v1/admin/api-pool*`
   - reader endpoints
   - dubbing endpoints
   - engine capability routes
5. Do not sign off the release until the blocked auth checks are completed and the high-severity findings are closed.
