# Deep Backend Audit Report

- Audit date: 2026-03-09
- Finalized at: 2026-03-09T22:38:00+05:30
- Workspace: `C:\Users\1wasi\OneDrive\Desktop\voice-Flow`
- Scope: backend production-lens audit (security, authz, correctness, reliability, operational readiness)
- Baseline reference: `docs/audits/deep-audit-2026-03-07.md`
- Final evidence bundle: `docs/audits/artifacts/2026-03-09-backend-deep-audit-run-final2`

## Executive Summary

Verdict: **functional audit gates are passing** for this phase.

All targeted matrix commands now pass under strict audit auth settings, and backend pytest is clean:

- `python -m pytest tests -q` -> `226 passed, 1 skipped`
- `npm run ci:reliability` -> passed
- `npm run test:contracts` -> passed
- `npm run audit:media` -> passed
- `npm run audit:gemini-stack` -> passed
- `npm run audit:connectivity` -> passed
- `npm run audit:secrets:tracked-config` -> passed
- `npm run validate:k8s` -> passed

Auth-gated probes also pass:

- `/account/profile` with bearer auth -> `200`
- `/admin/actor` with bearer auth -> `200`

## Matrix Evidence

See exit summary: `docs/audits/artifacts/2026-03-09-backend-deep-audit-run-final2/18-command-summary.txt`.

All recorded commands in this final bundle are `exit=0`.

## Remediations Completed

### 1. Pytest config mutation guard instability (resolved)

Severity: P1 (previously)

Symptoms addressed:

- Guarded config mutation on `backend/config/gemini_api_pools.json` during suite teardown.

Changes:

- Hardened test isolation in `backend/tests/conftest.py` so Gemini pool file paths are isolated at import-time and during each test.
- Disabled auto-rotate-on-failure for generic suite execution via test env isolation to prevent persistent manifest writes.
- Added runtime monkeypatching safeguards for already-imported `app` module constants.

Verification:

- `python -m pytest tests -q` passes with guard intact.

### 2. Queue/reliability test network leakage and flake risk (resolved)

Severity: P2 (previously)

Symptoms addressed:

- Real runtime network calls leaking into unit tests in `test_tts_queue_reliability_gate.py`, causing nondeterministic behavior.

Changes:

- Updated tests to patch `backend_app._runtime_http_request` instead of `backend_app.requests.post` where the runtime path now flows through `_runtime_http_request`.

Verification:

- Full suite stable and passing.

### 3. Earlier functional regressions from baseline run (resolved)

Severity: P1/P2 (previously)

Resolved across the earlier implementation pass and re-verified here:

- Guardian test mutation path isolation
- Segmentation boundary regression
- Health/readiness contract behavior
- Gateway capability/status/voice endpoints
- Reader upload/archive/OCR resource controls
- Long-text reliability gate crash behavior and infra-blocked quota handling
- Voice-transfer naming drift in reliability/stress scripts and runbook aliases

## Open Findings (This Phase)

No open P0-P2 blockers remain in the functional matrix for this pass.

Residual note (P3):

- The audit plan preferred password-based Firebase sign-in for bearer token minting. In this run, password sign-in was unavailable for local allowlist identities, so bearer auth was established via Firebase custom-token exchange and then validated against protected endpoints. This is operationally acceptable for this audit run but should be documented as an explicit fallback path in audit runbooks.

## Delta vs Prior Audit (2026-03-07)

Newly resolved since the prior baseline and the earlier failing 2026-03-09 draft:

- Backend pytest: from failing to fully passing.
- CI reliability gate: from failing/unstable to passing.
- Auth-gated backend audits: from partially blocked/failing to passing.
- Contract and readiness checks: now passing with aligned endpoint behavior.

No newly introduced functional regressions were observed in the final matrix run.

## API / Interface Impact

- No intentional external API shape changes were introduced in this audit deliverable.
- Output remains audit evidence + remediation outcomes for the functional phase.

## Final Command Set (Final Evidence Bundle)

1. `npm run services:bootstrap`
2. `npm run services:check`
3. `npm run audit:secrets:tracked-config`
4. `npm run validate:k8s`
5. `cd backend && python -m pytest tests -q`
6. `npm run test:contracts`
7. `npm run audit:media`
8. `npm run audit:gemini-stack`
9. `npm run audit:connectivity`
10. `npm run ci:reliability`
