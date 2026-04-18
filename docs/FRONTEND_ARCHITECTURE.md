# Frontend Architecture

## Target shape

The UI is organized as a feature-oriented architecture under `src/`:

- `src/app`: app root, providers, error boundary, screen router
- `src/features`: feature modules (`auth`, `admin`, `billing`, `studio`, `novel`, `workspace`)
- `src/entities`: shared cross-feature contracts
- `src/shared`: shared API/client, auth policy, storage policy/utilities

## Compatibility approach

This refactor is incremental. Existing root-level modules (`views/`, `components/`, `services/`, `contexts/`) remain active while feature wrappers and hooks are introduced in `src/features`.

## Security and token handling

- `services/authHttpClient.ts` resolves auth headers through `src/shared/auth/tokenPolicy.ts`.
- Firebase ID token is the auth source (`Authorization: Bearer <token>`).
- `x-dev-uid` forwarding is DEV-only and must stay disabled in production (`NEXT_PUBLIC_ENABLE_DEV_UID_HEADER=0`; legacy `VITE_ENABLE_DEV_UID_HEADER=0` is still honored during migration).
- Browser-facing frontend gateway base URL is `NEXT_PUBLIC_API_BASE_URL`.
- If unset, browser code resolves base URL to `/api/backend`, while the Cloudflare Worker proxy uses `VF_MEDIA_BACKEND_URL` as its server-side upstream origin.

## Storage policy

All app-level storage keys are centralized in `src/shared/storage/keys.ts` and reused by auth, settings, and session logic.

## Preserved public contracts

- Engine contract: `GenerationSettings.engine = 'PRIME' | 'VECTOR'`
- User auth/state contract: `UserContextType`
- Billing entitlements contract: `AccountEntitlements`
