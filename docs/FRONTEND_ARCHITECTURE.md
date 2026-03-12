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
- Firebase ID token remains primary (`Authorization: Bearer <token>`).
- Local admin fallback and `x-dev-uid` forwarding are explicitly DEV-only and must be enabled via env flags:
  - `VITE_ENABLE_LOCAL_ADMIN_DEV_LOGIN=1`
  - `VITE_ENABLE_DEV_UID_HEADER=1`
- Frontend gateway base URL is `VITE_API_BASE_URL`.
- If unset, frontend resolves base URL to current non-localhost origin first, then falls back to `http://127.0.0.1:7800`.

## Storage policy

All app-level storage keys are centralized in `src/shared/storage/keys.ts` and reused by auth, settings, and session logic.

## Preserved public contracts

- Engine contract: `GenerationSettings.engine = 'GEM' | 'KOKORO'`
- User auth/state contract: `UserContextType`
- Billing entitlements contract: `AccountEntitlements`
