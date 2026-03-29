# Deep Full-Stack Audit Report
Date: 2026-02-28  
Scope: Security/auth-first deep audit with live runtime + stress/load checks  
Target state: current dirty working tree (no reverts)

## Audit Metadata
- Run timestamp (local): `2026-02-28T15:36:04+05:30`
- Git HEAD: `9e7b04f5b1987e5d2bb50ed73a9f92a44b93e5ad`
- Worktree: dirty (tracked + untracked changes pre-existing)
- Evidence bundle: archived externally (local runtime artifacts are not committed in this repository).

## Executive Summary
- Total findings: **9**
- Severity split: **Critical 1 / High 4 / Medium 3 / Low 1**
- Main risk themes:
  1. Runtime control-plane endpoint exposed without auth.
  2. Dev-mode auth bypass allows privileged operations in `VF_AUTH_ENFORCE=0`.
  3. Reliability remains blocked by long-text TTS instability.
- Improvements vs earlier baseline:
  - Frontend dependency audit now reports `high=0`.
  - Reliability TypeScript path issue is fixed (gate now advances past typecheck).

## System Surfaces Audited
- Backend API: `backend/app.py`
- Gemini runtime: `backend/engines/gemini-runtime/app.py`
- Duno runtime: Modal-hosted endpoint configured via `VF_DUNO_RUNTIME_URL`
- CI/reliability gate: `backend/scripts/ci-reliability.mjs`
- Frontend build/type/audit/test harness + Playwright smoke surfaces

## Command Matrix and Outcomes

### Static and CI gates
- `npm --prefix frontend run build` -> **PASS**
- `npm --prefix frontend run typecheck` -> **PASS**
- `npm --prefix frontend exec -- tsc --noEmit --project frontend/tsconfig.json` -> **PASS**
- `npm run ci:frontend:phase1` -> **PASS**
- `npm --prefix frontend run lint` -> **PASS** (3 warnings)
- `npm --prefix frontend run test:ci` -> **PASS** (1 file, 3 tests)
- `npm run ci:reliability` -> **FAIL** at `TTS long-text 5000 smoke gate` (`This operation was aborted`)
- `npm --prefix backend run pytest` -> **FAIL** (`85 passed, 3 failed`)
- `npm --prefix frontend audit --json` -> **PASS** (`high=0`, `critical=0`)
- `npm --prefix frontend audit --omit=dev --json` -> **PASS** (`high=0`, `critical=0`)
- `npm audit --json` -> **FAIL** (`ENOLOCK`)
- `npm --prefix backend audit --json` -> **FAIL** (`ENOLOCK`)

### Live runtime probes
- `npm --prefix backend run services:check` -> **PASS** (`7800/7810/7820`)
- Runtime admin endpoints (no auth):
  - `GET http://127.0.0.1:7810/v1/admin/api-pool` -> **200**
  - `POST http://127.0.0.1:7810/v1/admin/api-pool/reload` -> **200**
- Backend auth matrix in current local mode (`VF_AUTH_ENFORCE=0`) from runtime probes:
  - `GET /account/entitlements` no auth -> **200**
  - `POST /tts/synthesize` no auth -> **200** (manual payload evidence; WAV returned)
  - `GET /admin/users` no auth -> **403**
  - `GET /runtime/logs/tail?service=gemini-runtime` no auth -> **200**
  - `GET /ops/guardian/status` no auth -> **200**

### Auth-enforced mode probe (`VF_AUTH_ENFORCE=1`, isolated backend on `7900`)
Evidence: `auth-enforced-probe-results.json`, `auth-enforced-backend-stdout.log`, `auth-enforced-backend-stderr.log`
- `GET /health` no auth -> **200**
- `GET /account/entitlements` no auth -> **401**
- `POST /tts/synthesize` no auth -> **401**
- `GET /admin/users` no auth -> **401**
- `x-dev-uid` without bearer in enforced mode -> **401**
- Invalid bearer -> **401** with detail `firebase-admin dependency is unavailable`

### Stress/load and contract scripts
- `npm run audit:gemini-stack` -> **PASS** (backend/runtime key pool: 64/64)
- `npm run audit:media` -> **PASS** (video checks skipped unless env set)
- `npm run test:contracts` -> **PASS**
- `python backend/scripts/audit-multi-speaker.py` -> **PASS**
- `npm run audit:tts:hindi` -> **FAIL**
  - Total 12 cases; pass 4, fail 8
  - Gemini: 2 failures (`synthesis_failed_504`, `synthesis_failed_503`)
  - Duno: 6 failures (`duration_out_of_range_24_36`)
- `npm run audit:tts:longtext:smoke` -> **FAIL** (`fetch failed` / abort)
- `npm run audit:tts:longtext:matrix` -> **FAIL** (`This operation was aborted`)

### Frontend Playwright main-page stability run
- `npm --prefix frontend run e2e:mcp:main-pages` -> **FAIL (preflight)**
- Cause: missing `PW_ADMIN_EMAIL` and `PW_ADMIN_PASSWORD`
- Evidence: `frontend/artifacts/playwright-mcp/2026-02-28T10-37-43-899Z/`

## Findings

### F-001 Runtime admin control plane unauthenticated
- Severity: **Critical**
- Area: `runtime`
- Evidence:
  - `GET /v1/admin/api-pool` no auth -> `200`
  - `POST /v1/admin/api-pool/reload` no auth -> `200`
- Impact:
  - Any reachable client can inspect key-pool internals and trigger reloads.
- Fix direction:
  - Require runtime admin auth (token/mTLS/shared secret).
  - Bind runtime admin routes to private interface only.
- Verify:
  - Same calls without auth return `401/403`.

### F-002 Dev-mode identity fallback allows unauthenticated user-scope access
- Severity: **High**
- Area: `backend`
- Evidence in `VF_AUTH_ENFORCE=0` mode:
  - `GET /account/entitlements` no auth -> `200`
  - `POST /tts/synthesize` no auth -> `200`
- Impact:
  - If auth-disabled mode leaks outside strict local scope, user routes are exposed.
- Fix direction:
  - Enforce startup guardrails: reject non-local deploys with `VF_AUTH_ENFORCE=0`.
  - Require explicit dev-mode flag + localhost binding.
- Verify:
  - In non-dev mode, no-auth calls return `401`.

### F-003 Non-admin (and no-auth fallback user) can execute minor guardian mutations
- Severity: **High**
- Area: `backend/ops`
- Evidence:
  - `POST /ops/guardian/actions` no auth `refresh_gemini_pool` -> `200`
  - `POST /ops/guardian/actions` user `enable_soft_shedding` -> `200`
  - Major action (`restart_all_runtimes`) returns approval path (`202`) for user.
- Impact:
  - Runtime behavior can be altered by non-admin identities in dev-mode fallback.
- Fix direction:
  - Restrict all mutating guardian actions to admin.
  - Keep non-admin access read-only (status only).
- Verify:
  - Non-admin mutate attempts return `403`.

### F-004 Long-text reliability gate unstable under load
- Severity: **High**
- Area: `runtime/reliability`
- Evidence:
  - `audit:tts:longtext:smoke` and `matrix` abort/fetch-fail.
  - `ci:reliability` now fails specifically at long-text smoke gate.
- Impact:
  - Release gate is red; long-form TTS behavior unreliable.
- Fix direction:
  - Add robust retry/error capture in long-text script and runtime call path.
  - Stabilize timeout/chunking for 5k-word synth workloads.
- Verify:
  - Two consecutive green runs for smoke + matrix + reliability gate.

### F-005 Auth-enforced mode currently cannot validate bearer tokens in this env
- Severity: **High**
- Area: `backend/auth setup`
- Evidence:
  - Enforced mode invalid bearer responses include: `firebase-admin dependency is unavailable`.
- Impact:
  - Auth-enforced runtime in this environment is non-functional for real bearer auth.
- Fix direction:
  - Ensure `firebase_admin` dependency and service-account config are present in enforced env.
- Verify:
  - Valid bearer token accepted, invalid token rejected with normal auth error semantics.

### F-006 Backend regression tests still failing (3 tests)
- Severity: **Medium**
- Area: `backend/tests`
- Failing tests:
  - `test_tts_synthesize_enforces_daily_limit`
  - `test_admin_tts_synthesize_bypasses_daily_and_balance_limits`
  - `test_grouped_synthesis_caps_concurrency_by_pool_size`
- Impact:
  - Quota/admin/concurrency contract drift unresolved.
- Fix direction:
  - Align implementation and test expectations for burst-vs-daily limits and grouping concurrency caps.
- Verify:
  - `npm --prefix backend run pytest` with zero failures.

### F-007 Runtime logs tail endpoint readable without admin in local mode
- Severity: **Medium**
- Area: `backend/ops`
- Evidence:
  - `GET /runtime/logs/tail?service=gemini-runtime` no auth -> `200`
- Impact:
  - Operational logs are exposed in auth-disabled dev mode.
- Fix direction:
  - Gate endpoint behind admin auth or explicit dev-only feature flag.
- Verify:
  - No-auth returns `401/403`, admin still works.

### F-008 Root/backend npm audit enforcement blocked by missing lockfiles
- Severity: **Medium**
- Area: `devops/dependency policy`
- Evidence:
  - Root and backend `npm audit --json` fail with `ENOLOCK`.
- Impact:
  - Supply-chain risk is not enforceable in those scopes.
- Fix direction:
  - Add lockfiles (`package-lock.json`) and enforce audit gates.
- Verify:
  - Root/backend audits execute and produce machine-readable reports.

### F-009 Frontend MCP deep page smoke is blocked by missing admin creds
- Severity: **Low**
- Area: `frontend/e2e`
- Evidence:
  - `e2e:mcp:main-pages` fails preflight: missing `PW_ADMIN_EMAIL`/`PW_ADMIN_PASSWORD`.
- Impact:
  - Automated admin-page stability checks cannot run.
- Fix direction:
  - Provide CI/local secrets for Playwright admin flow.
- Verify:
  - Desktop/mobile main-page suite runs to completion and emits artifact status.

## Top 5 Immediate Fixes
1. Add auth guard to Gemini runtime `/v1/admin/api-pool*` endpoints.
2. Require admin for all mutating `/ops/guardian/actions` operations.
3. Stabilize long-text TTS path (runtime + script) until `ci:reliability` is green.
4. Resolve the 3 backend pytest failures in quota/admin/concurrency contracts.
5. Add root/backend lockfiles so dependency audit can be enforced end-to-end.

## Validation Checklist (post-remediation)
- `npm run ci:reliability`
- `npm --prefix backend run pytest`
- `npm run audit:tts:hindi`
- `npm run audit:tts:longtext:smoke`
- `npm run audit:tts:longtext:matrix`
- `npm --prefix frontend audit --omit=dev --json`
- `curl -i http://127.0.0.1:7810/v1/admin/api-pool` (expect `401/403`)
- `curl -i http://127.0.0.1:7800/ops/guardian/actions ...` as non-admin mutate (expect `403`)
