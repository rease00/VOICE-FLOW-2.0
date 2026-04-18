# V FLOW AI

V FLOW AI is now a Next.js-first product with a single browser-facing control plane under `/api/v1/*`.

## Architecture

- `frontend/` contains the app, server routes, and domain services.
- Cloudflare Workers/OpenNext is the preferred public web edge for launch.
- Browser traffic stays on `/api/v1/*`.
- Some `/api/v1/*` families are already native in this workspace, but billing, library compatibility routes, and `/api/v1/tts/*` still rely on an external compatibility backend configured by `VF_MEDIA_BACKEND_URL` or `VF_MEDIA_BACKEND_ORIGINS_JSON`.
- Cloud Run is still required for that compatibility backend and any specialist runtimes, but the backend source is not included in this checkout.
- Finished chapter audio is stored in R2 and delivered by signed URL instead of being proxied through the app runtime.
- Hosted external runtimes remain only for specialist media workloads such as voice cloning and source separation.

## Product Scope

Active product areas:

- Account and billing
- Studio TTS and translation
- Library and reader
- Publishing and novel import
- Audio-novel live playback and chapter audio generation
- Voice clone and source separation

Removed from this codebase:

- Repo-local legacy backend runtime sources
- Legacy video post-processing pipeline

## Local Development

1. Install dependencies:

```bash
npm install
npm --prefix frontend install
```

2. Configure environment:

- copy values from `.env.example`
- keep `NEXT_PUBLIC_API_BASE_URL=/api/v1`
- add Firebase, R2, Stripe, and any hosted runtime credentials you need
- set `VF_MEDIA_BACKEND_URL` or `VF_MEDIA_BACKEND_ORIGINS_JSON` for any production deployment that still depends on compatibility-backed `/api/v1` routes

3. Start the app:

```bash
npm run dev
```

## Core Commands

```bash
npm run dev
npm run build
npm run frontend:typecheck
npm run frontend:audit:prod
```

## Notes

- `domainJobs` is the canonical async job substrate.
- Browser-facing product APIs should resolve through `/api/v1/*`.
- This workspace is launch-ready only as a split topology: Cloudflare for the public frontend, plus a separately deployed compatibility backend for unmigrated API families.
