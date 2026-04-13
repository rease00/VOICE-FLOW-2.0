# V FLOW AI

V FLOW AI is now a Next.js-first product with a single browser-facing control plane under `/api/v1/*`.

## Architecture

- `frontend/` contains the app, server routes, and domain services.
- Cloudflare handles edge delivery and cached object access.
- Next.js on Node/Cloud Run handles product-facing APIs, auth, billing, studio flows, publishing, reader flows, and live audio orchestration.
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

- Legacy backend runtime
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
