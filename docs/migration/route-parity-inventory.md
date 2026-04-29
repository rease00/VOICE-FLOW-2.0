# Route Parity Inventory

This file tracks the Cloudflare conversion surfaces that still need explicit parity coverage or migration gates.

## Canonical route contract

The backend contract endpoint at `backend/src/routes.js` publishes the canonical route map through `/api/v1/ops/contracts`.
The live parity test in `tests/deep-live.spec.mjs` now asserts the full browser route inventory:

- `/`
- `/landing`
- `/app`
- `/app/login`
- `/app/onboarding`
- `/app/studio`
- `/app/account`
- `/app/billing`
- `/app/reader`
- `/app/library`
- `/legal/terms`
- `/api/v1/ops`

Browser route coverage in `tests/frozen-surfaces.spec.mjs` mirrors that contract and now includes the dynamic reader redirect path:

- `/app/reader/demo-book` redirects to `/app/library/demo-book/read`
- `/app/library/demo-book/read` remains covered as the reader handoff/read contract

## Coverage matrix

| Surface | Current coverage | Notes |
| --- | --- | --- |
| Landing | `tests/frozen-surfaces.spec.mjs`, `tests/deep-live.spec.mjs` | Public entry and CTA path are covered. |
| Login | `tests/frozen-surfaces.spec.mjs` | The login bridge and seeded admin path are covered. |
| App shell | `tests/frozen-surfaces.spec.mjs` | `/app` handoff remains covered. |
| Onboarding | `tests/frozen-surfaces.spec.mjs` | Included as a shell handoff route. |
| Studio | `tests/frozen-surfaces.spec.mjs`, `tests/deep-live.spec.mjs` | Main workspace route remains covered. |
| Account | `tests/frozen-surfaces.spec.mjs`, `tests/deep-live.spec.mjs` | Account/profile/billing persistence is covered. |
| Billing | `tests/frozen-surfaces.spec.mjs`, `tests/deep-live.spec.mjs` | Public and authenticated billing paths are covered. |
| Reader base | `tests/frozen-surfaces.spec.mjs`, `tests/deep-live.spec.mjs` | The handoff shell is covered. |
| Reader book redirect | `tests/frozen-surfaces.spec.mjs` | Explicit redirect contract is now checked, but the current snapshot shell still returns 404 for this path. |
| Library read | `tests/frozen-surfaces.spec.mjs` | The read handoff path remains a live gap in the exported snapshot shell. |
| Admin | `tests/frozen-surfaces.spec.mjs`, `tests/deep-live.spec.mjs` | Session-gated admin surface remains covered. |
| Legal pages | `tests/frozen-surfaces.spec.mjs` | The legal route family is still covered as frozen snapshots. |
| Backend route contract map | `tests/deep-live.spec.mjs` | The canonical route map is asserted against the live backend. |

## Migration gates

### Firebase removal gate

Do not mark Firebase as fully removed until:

- Source and test search for `firebase` stays empty for runtime code, not just for the current checkout snapshot
- The remaining history/fixtures do not rely on Firebase SDKs, env vars, or auth/storage shims
- Cloudflare-native D1/R2/session/billing paths continue to pass the parity suite without fallback behavior

### Proxy removal gate

Do not remove `frontend/app/routes/api.$.tsx` until:

- The canonical route map in `/api/v1/ops/contracts` still matches the live backend
- Browser parity tests cover every promised route and redirect path that currently depends on the proxy
- No page still relies on the compatibility proxy for normal navigation or API traffic

## Current gap summary

- The browser route inventory now names the dynamic reader redirect explicitly, but the current snapshot shell still 404s on that route.
- The remaining compatibility proxy is still documented and should stay until canonical routing fully replaces it.
- Firebase removal is still a documentation gate, not a runtime claim.
