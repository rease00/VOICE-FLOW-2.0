# Permanent Hosting Blueprint

## Zero-Cash First 90 Days, Then a Clean Path to 100k Users

## Executive Decision

This repository should use a two-stage hosting strategy:

1. First 90 days: optimize for zero cash out of pocket.
2. After credits or real traffic arrive: optimize for predictable paid scale.

The permanent architecture should stay queue-first, but the product promise must split into two lanes:

- Free users = standard generation
- Paid users = fast generation

That split already matches the direction of the current codebase better than a "same model for everyone" setup.

## Core Assumptions

- The `$300` budget is the standard Google Cloud Free Trial welcome credit.
- The target is `100k` users as a product milestone, not `100k simultaneous TTS jobs`.
- Free users can tolerate cold starts, async queueing, and lower-priority throughput.
- Paid users need visibly faster queue admission and faster median generation time.
- The current repository remains the source of truth for service layout and product entitlements.

## Honest Constraint

`100k users for free for 3 months` is only realistic under one of these meanings:

- `100k registered users`, with a much smaller active backend slice
- `100k monthly users`, with a much smaller simultaneous TTS slice

It is not realistic if the real target is:

- `100k monthly active users all generating audio heavily`
- `hundreds or thousands of simultaneous long TTS jobs`

The zero-cash plan can get you to launch and early growth. It cannot make heavy TTS free at large scale.

## Repo-Grounded Findings

### 1. Frontend is ready for Cloudflare Workers/OpenNext

- `frontend/wrangler.jsonc` already points Workers/OpenNext at `.open-next/worker.js`
- `README.md` already documents a Cloudflare Workers deploy flow

This means the frontend should deploy through Cloudflare Workers from day one.

### 2. The backend is already split by workload type

The current service layout is:

- `voiceflow-api`
- `voiceflow-worker`
- `voiceflow-gemini-runtime`
- Duno runtime (Modal-hosted endpoint configured via `VF_DUNO_RUNTIME_URL`)

This is the correct permanent shape. Do not collapse everything just because it is possible.

### 3. Production worker logic cannot simply be merged into API

The app explicitly treats `api` and `worker` as separate production roles. The worker threads only start when the service is running in worker mode with a positive worker count.

Blueprint implication:

- Keep a dedicated worker service in production
- Do not build the 90-day plan around `VF_SERVICE_ROLE=all`

### 4. Free-versus-paid policy already exists in the app

The repository already contains:

- free plan engine restrictions
- plan-specific character caps
- plan-specific RPM guardrails
- weighted queue lanes for higher plans

Blueprint implication:

- You do not need a new product model from scratch
- You need to harden and operationalize the existing split

Current gap:

- the current backend still gives the free plan a much larger `monthlyVfLimit` than this blueprint wants
- default `VFF` starts at zero, so a `10k VFF` free-user grant needs an explicit policy change

### 5. Current Gemini pool config is still AI Studio style

The live Gemini pool config is currently driven by `gemini_api`, not Vertex.

Blueprint implication:

- If you want the first 90 days to stay cash-free, paid Gemini traffic should move to Vertex-backed billing
- Do not assume Google Cloud welcome credits will cover Gemini Developer API / AI Studio billing

### 6. Current output artifacts are local-file based

TTS result artifacts are currently written to local disk and referenced as local file paths.

Blueprint implication:

- durable artifact storage is not a phase-0 requirement
- R2 should be introduced as a storage adapter, not as an assumption the current code already supports

## Permanent Architecture

```text
Users
  -> Cloudflare Workers frontend
  -> Cloud Run API
      -> Firebase Auth / Firestore
      -> Redis queue
      -> Stripe
      -> Worker service
           -> Gemini fast runtime
           -> Duno standard runtime (Modal)
           -> Artifact store
```

## The Permanent Product Model

### Free = Standard Lane

- Engine access: `DUNO`, `VECTOR`
- Delivery mode: async-first
- Queue lane: `free`
- Priority: best effort
- Wallet policy: `1,000 VF` monthly free limit plus `10,000 VFF` monthly promo balance
- Output retention: short
- Use case: hobby, sampling, low-cost acquisition

### Starter and Creator = Fast Lane

- Engine access: all engines
- Preferred fast path: Gemini-backed generation
- Queue lane: `pro`
- Priority: clearly above free
- Output retention: medium
- Use case: users who pay to avoid waiting

### Pro and Scale = Faster Lane

- Engine access: all engines
- Queue lane: `pro` for `Pro`, `pro_plus` for `Scale`
- Priority: highest
- Output retention: longest
- Use case: heavy use, premium expectations, future reserved capacity

## Permanent Model Routing Rule

Do not promise "fast" on the CPU-heavy Duno path.

The permanent rule should be:

- Free users get the standard Duno / Neural2 path
- Paid users get the Gemini fast path first
- Duno remains the budget or fallback engine, not the premium low-latency promise

This matters because Duno is the slower CPU-heavy path in your current architecture.

## Phase 1: First 90 Days With Zero Cash

This is the launch architecture I would actually use.

| Component | Provider | Phase-1 Role | Reason |
|---|---|---|---|
| Frontend | Cloudflare Workers + OpenNext | permanent | already configured, cheap, stable |
| API | Cloud Run | permanent | bursty public HTTP |
| Worker | Cloud Run | temporary-but-valid | repo requires a dedicated worker role |
| Gemini runtime | Cloud Run + Vertex mode | permanent | lets paid fast lane consume Google Cloud credits |
| Duno runtime | Modal | permanent | external runtime configured via `VF_DUNO_RUNTIME_URL` |
| Redis | Upstash Free | temporary | shared queue state without cash spend |
| Auth/Profile | Firebase Auth + Firestore | permanent | already integrated |
| Artifact storage | local TTL first, R2 later | staged | current code already supports local file refs |

## Why No Hetzner in Phase 1

Do not use a VPS in the first 90 days if the goal is truly zero cash.

Reasons:

- it requires real payment setup
- it breaks the "no rupee" constraint immediately
- your current goal is credit preservation, not lowest long-run unit cost

Hetzner becomes the right move later, after credits end or when Duno traffic becomes steady enough to justify fixed monthly compute.

## Phase-1 Service Settings

These are the blueprint targets, not a promise that every number is already optimal for your code.

### `voiceflow-api`

- `minInstances = 0`
- keep request/response autoscaling
- keep it stateless
- keep queue admission strict

### `voiceflow-gemini-runtime`

- `minInstances = 0`
- keep concurrency low at first
- bill Gemini usage through Vertex-backed mode, not AI Studio billing
- reserve this path primarily for paid users

### Duno runtime (Modal)

- configure `VF_DUNO_RUNTIME_URL` on API/worker
- treat it as the free or standard lane
- avoid promising premium latency on this path

### `voiceflow-worker`

- keep it separate
- start with one small always-available instance
- keep worker count low
- preserve queue fairness and backpressure

### Redis

- use Upstash Free until command volume or queue depth says otherwise
- move to paid managed Redis only after you have real load

## Phase-1 Budget Rule

Your real budget ceiling is not `$300 total`.

Your real operating guardrail is:

- about `$3.33` average spend per day

That means every phase-1 design choice should answer:

- does this increase or decrease daily burn?
- does this protect paid speed without giving free users the same expensive path?

## Phase-1 Product Guardrails

These are the launch rules I would enforce.

### Free plan

- async-only for long jobs
- no premium fast-lane promise
- no long retention guarantee
- only `1,000 VF` monthly free limit
- only `10,000 VFF` monthly promo balance
- tighter RPM
- lower max characters
- no paid fast path consumption by default

Important:

- do not add any refill path that bypasses the intended `10,000 VFF` free cap
- otherwise users can exceed the intended free cap very quickly

### Paid base plan

- gets the Gemini fast path first
- gets a better queue lane
- gets better queue admission under load
- gets faster target latency
- gets longer artifact retention

### Scale plan

- highest queue weight
- highest quotas
- future reserved-capacity candidate

## What "100k Ready" Actually Means

For this blueprint, `100k ready` should mean:

- the control plane can support `100k` accounts
- the frontend can serve `100k` user sessions over time
- the backend can support a smaller active generation slice without collapsing

A sane planning model is:

- `100k` registered users
- `3k to 8k` daily active users
- `100 to 400` concurrent active sessions
- `10 to 50` concurrent TTS jobs

That is ambitious but realistic.

This blueprint is not a promise for:

- `500 to 1000+` simultaneous long TTS jobs
- premium latency for everyone

## Capacity Ladder

## Stage A: 0 to 1k Daily Active Users

- one worker service
- one Redis free tier
- Duno on Modal-hosted runtime
- paid users routed to Gemini fast path
- free users pushed to standard async behavior

Upgrade when:

- paid queue age becomes noticeable
- Cloud Run burn rate exceeds the daily target
- Duno cold starts become a frequent complaint

## Stage B: 1k to 10k Daily Active Users

- add durable artifact storage
- raise worker ceiling carefully
- keep plan lanes separate
- add stronger cost alerts and per-route dashboards

Upgrade when:

- paid lane queue delay exceeds your product promise
- free lane starts starving paid traffic
- Redis free tier is clearly inadequate

## Stage C: 10k to 50k Daily Active Users

- move Duno to dedicated CPU compute after the free-credit phase ends
- keep API and Gemini runtime on autoscaling serverless
- move Redis to a paid managed tier
- add artifact CDN and retention policy

Upgrade when:

- standard lane volume dominates CPU usage
- paid and free traffic interfere with each other
- queue projections regularly reject jobs

## Stage D: 50k to 100k Daily Active Users

- split worker pools by lane or by engine
- consider dedicated free-worker and paid-worker services
- give paid traffic reserved runtime headroom
- keep free traffic as best effort

At this stage, the service is no longer a "free for 3 months" problem. It becomes an efficiency and SLO problem.

## Permanent Data Strategy

## Phase 1

- use local TTL artifacts for finished jobs
- do not block launch on object-store integration

## Phase 2

- add a storage abstraction for `file`, `r2`, or `gcs`
- migrate finished artifact refs to durable object storage

## Permanent target

- use R2 for durable public-download storage if you want low-cost egress and Cloudflare delivery

## Redis Strategy

## Phase 1

- Upstash Free

## Phase 2

- paid Upstash or managed Redis

## Permanent rule

- never design the multi-service production queue around in-memory state

## Required Repo Changes

These are the changes the project should eventually absorb to match this blueprint.

### 1. Cloud Run deployment profile

- lower `voiceflow-api` minimum instances to zero
- lower `voiceflow-gemini-runtime` minimum instances to zero
- keep `voiceflow-worker` as a distinct service
- ensure `VF_DUNO_RUNTIME_URL` points at the Modal endpoint in the credit-preservation phase

### 2. Gemini provider strategy

- move the Gemini runtime source policy from `gemini_api` to `vertex`
- keep separate pool identities for `free`, `pro`, and `pro_plus`
- do not route paid fast-lane traffic through AI Studio billing if the goal is zero cash

### 3. Product access policy

- keep free users on the standard lane
- map paid users to the fast lane
- do not give free users the same expensive low-latency path you use to justify payment

### 4. Free wallet policy

- lower the free-plan `monthlyVfLimit` from its current larger value to `1,000`
- add a monthly free-user `VFF` grant of `10,000`
- treat that `VFF` grant as a monthly allowance, not an unlimited refill path

### 5. Artifact storage adapter

- keep local-file artifact refs initially
- add durable object-store support as a dedicated follow-up
- do not pretend R2 is already integrated if it is not

### 6. Operational safety

- add billing alerts
- add daily spend tracking
- add queue-age dashboards by plan lane
- add plan-specific SLOs

## Metrics That Decide When To Upgrade

Track these from day one:

- queue depth by lane
- oldest queued age by lane
- paid-lane p50 and p95 queue wait
- Duno endpoint cold-start frequency (Modal)
- worker CPU utilization
- Gemini runtime error rate
- daily burn against the `$3.33/day` target

## Permanent Blueprint Summary

The permanent answer is:

- Cloudflare Workers for frontend
- Cloud Run API permanently
- Cloud Run Gemini runtime permanently
- Dedicated worker permanently
- Duno on Modal-hosted runtime first, then dedicated CPU later if needed
- Redis shared queue permanently
- Free users on standard lane
- Paid users on fast lane
- R2 as the long-term artifact target, not a fake assumption for phase 1

## Decision

If your top priority is:

- `no cash for 90 days`

Then use:

- Cloudflare Workers
- Cloud Run
- Vertex-backed Gemini
- Upstash Free
- Firebase / Firestore
- local TTL artifacts first

If your top priority later becomes:

- `lowest steady monthly cost after credits`

Then move Duno and perhaps workers to a VPS or fixed CPU node after the 90-day phase.

## Pricing And Policy Checkpoints

These are the external rules this blueprint is based on as of `2026-03-11`:

- Google Cloud Free Trial: `90` days and up to `$300` in welcome credits
- Google states the welcome credit cannot be used for Gemini Developer API / AI Studio billing
- Cloud Run has a free tier and request-based serverless billing
- Cloudflare Workers is suitable for a dynamic Next.js frontend
- Cloudflare R2 has a free allowance and is appropriate later for durable artifacts
- Firebase pricing and Firestore/Auth limits are friendly for an early-stage launch
- Upstash provides a free Redis tier for small workloads

## Final Recommendation

Do not try to make the whole product "fast for everyone" during the free-credit phase.

Instead:

- let free users be standard
- let paid users be fast
- use the first 90 days to validate demand
- preserve credits by protecting the expensive path

That is the cleanest way to make this project both launchable now and still structurally correct when traffic grows.
