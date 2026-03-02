# Frontend Production Checklist

## Security and auth baseline
- Keep backend auth enforcement enabled in production: `VF_AUTH_ENFORCE=1`.
- Keep local admin and dev UID forwarding disabled in production:
  - `VITE_ENABLE_LOCAL_ADMIN_DEV_LOGIN=0`
  - `VITE_ENABLE_DEV_UID_HEADER=0`
- Keep Vite dev bootstrap endpoint disabled unless intentionally testing local orchestration:
  - `VITE_ENABLE_LOCAL_BOOTSTRAP_ENDPOINT=0`

## Caching policy
- HTML entry responses should include `Cache-Control: no-cache`.
- Hashed JS/CSS asset responses should include long-lived immutable caching (for example: `Cache-Control: public, max-age=31536000, immutable`).
- Validate headers with: `npm --prefix frontend run headers:verify -- <url>`.

## Security headers baseline
- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Frame-Options`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`

## Performance and quality gates
- Stage A (blocking): build + typecheck + prod dependency audit.
- Stage B (blocking next): lint + unit tests.
- Stage C (blocking later): e2e smoke + Lighthouse/bundle budgets.
- Bundle budget report scripts:
  - `npm --prefix frontend run bundle:report`
  - `npm --prefix frontend run bundle:budget`

## Observability rollout
- Frontend runtime errors are sent to backend endpoint `/ops/guardian/frontend-errors`.
- Web Vitals (`LCP`, `INP`, `CLS`) are sampled and sent using the same telemetry path.
- Suggested alert thresholds:
  - p75 `LCP` > 2.5s for 3 consecutive windows
  - p75 `INP` > 200ms for 3 consecutive windows
  - p75 `CLS` > 0.1 for 3 consecutive windows
  - Frontend error ingestion > 1% of active sessions

## Audit lockfile note
- Root/backend npm audits need lockfiles to run (`ENOLOCK` observed).
- Until lockfiles exist, enforce dependency gates at frontend package level.
