# Frontend Production Audit (TypeScript + Vite)
Date: 2026-02-28
Scope: Frontend production hardening for 10k+ users

## Audit Metadata
- Git head: `9e7b04f`
- Worktree: dirty before this audit pass
- Frontend package: `frontend/package.json`
- Report owner: `frontend`

## Baseline Command Outputs (Pre-Fix)
1. `npm --prefix frontend run build`
- Result: PASS

2. `npm --prefix frontend audit --json`
- Result: FAIL (vulnerabilities present)
- Summary: `high=3` (`minimatch`, `rollup`, `tar`)

3. `npm --prefix frontend audit --omit=dev --json`
- Result: FAIL (vulnerabilities present)
- Summary: `high=2` (`minimatch`, `tar`)

4. `npm run ci:reliability`
- Result: FAIL
- Root cause: hardcoded missing TypeScript path `frontend/node_modules/typescript/bin/tsc`

5. `npm --prefix frontend exec -- tsc --noEmit --project frontend/tsconfig.json`
- Result: FAIL
- Root cause: unresolved symbol `applyTagOnlyPreserveTextRule` in `frontend/services/geminiService.ts`

## Severity-Ranked Findings

### High
1. Reliability gate blocked by non-portable TypeScript path in `backend/scripts/ci-reliability.mjs`.
2. Frontend prod dependency graph contains high vulnerabilities (`minimatch`, `rollup`, `tar`).
3. Frontend auth path can include `x-dev-uid` and local-admin semantics without explicit production gating.
4. Vite dev bootstrap endpoint and exposed host settings were permissive by default.

### Medium
1. No explicit frontend stage-gate scripts for phased CI rollout.
2. No frontend unit/e2e/a11y/perf harness in package scripts.
3. No deploy-time automated header verifier.
4. No explicit bundle budget report/enforcement script.

### Low
1. No frontend-specific production checklist document capturing header/cache/observability requirements.

## Remediation Checklist
- [x] Fix `ci:reliability` typecheck invocation to portable frontend script invocation.
- [x] Remove non-deterministic debug ingest calls from reliability script.
- [x] Fix unresolved TypeScript symbol in `geminiService.ts`.
- [x] Add root/frontend phase gate scripts (`ci:frontend:phase1/2/3`).
- [x] Gate local-admin login and `x-dev-uid` forwarding to explicit dev-only flags.
- [x] Harden Vite dev host/bootstrap endpoint defaults.
- [x] Add frontend dependency overrides and regenerate lockfile.
- [x] Enforce prod dependency audit high/critical policy.
- [x] Add lint/test/e2e/a11y/perf script surface.
- [x] Add unit tests for auth/token policy.
- [x] Add e2e smoke harness.
- [x] Add bundle budget report and enforce modes.
- [x] Add deploy header verification script.
- [x] Wire frontend runtime errors and Web Vitals ingestion.
- [x] Add frontend production checklist doc.
- [x] Document root/backend npm audit `ENOLOCK` prerequisite.

## Acceptance Gate Matrix
| Gate | Command | Blocking Stage | Pass Condition |
|---|---|---|---|
| Build | `npm --prefix frontend run build` | A | Exit code 0 |
| Typecheck | `npm --prefix frontend run typecheck` | A | Exit code 0 |
| Prod audit | `npm --prefix frontend run audit:prod` | A | `high=0`, `critical=0` |
| Lint | `npm --prefix frontend run lint` | B | Exit code 0 |
| Unit tests | `npm --prefix frontend run test:ci` | B | Exit code 0 |
| E2E smoke | `npm --prefix frontend run e2e:smoke` | C | Exit code 0 |
| Perf budget | `npm --prefix frontend run perf:lighthouse` | C | Score threshold pass |
| Header verify | `npm --prefix frontend run headers:verify -- <url>` | Release gate | Required headers and cache policy pass |

## Post-Implementation Validation
1. `npm --prefix frontend run typecheck`
- Result: PASS

2. `npm --prefix frontend run build`
- Result: PASS

3. `npm --prefix frontend run audit:prod`
- Result: PASS
- Summary: `high=0`, `critical=0`

4. `npm --prefix frontend audit --omit=dev --json`
- Result: PASS
- Summary: `high=0`, `critical=0`

5. `npm --prefix frontend run test:ci`
- Result: PASS (`tokenPolicy` unit tests)

6. `npm --prefix frontend run e2e:smoke`
- Result: PASS (2 smoke checks)

7. `npm --prefix frontend run lint`
- Result: PASS with warnings only (`react-hooks/exhaustive-deps` warnings)

8. `npm --prefix frontend run a11y:smoke`
- Result: PASS

9. `npm --prefix frontend run bundle:report`
- Result: PASS
- Snapshot: `frontend/artifacts/bundle_budget_latest.json`

10. `npm --prefix frontend run perf:lighthouse`
- Result: SKIPPED (no `LIGHTHOUSE_URL` provided)

11. `npm run ci:frontend:phase1`
- Result: PASS

12. `npm run ci:reliability`
- Result: FAIL (current blocker now outside typecheck path)
- Failure step: `TTS long-text 5000 smoke gate`
- Failure detail: `This operation was aborted`

## Notes
- Frontend dependency vulnerability posture is remediated for `--omit=dev`.
- Reliability pipeline now advances through frontend typecheck and media audit before failing on long-text runtime stress gate.
- Root/backend npm audit lockfile prerequisite remains documented (`ENOLOCK` if lockfiles absent).
