# GCP Quota Increase Justification

Prepared on `2026-04-13` for project `v-flow-ai-491311` (`V FLOW AI`).

## Recommended Short Request Description

We are requesting a quota increase for Google Cloud Text-to-Speech Gemini-TTS and Cloud Run regional capacity for the production launch of V FLOW AI, an AI voice generation, dubbing, multilingual reader, and creator tooling platform. This is a real launch workload, not an experimental sandbox. Billing is enabled on the project, the primary Cloud Run control plane is already deployed in `us-central1`, and we have already observed regional quota blocking while attempting to initialize additional Cloud Run services in Asia. Our application is queue-first, plan-tiered, and rate-limited, so higher quota will be used in a controlled way for paid and priority traffic rather than unbounded burst traffic.

We are asking for higher quota because the default limits are below our launch requirements for multilingual TTS, creator dubbing, and audiobook-style synthesis. The business case is supported by strong growth in AI voice, dubbing, audiobooks, and India’s creator economy, and by direct platform evidence that multilingual audio materially increases reach and watch time. We are prepared for paid usage on a billing-enabled account and have built traffic controls, queue admission limits, and per-user caps into the product.

## Recommended Long-Form Support Note

V FLOW AI is a production-oriented AI voice platform for text-to-speech, multilingual dubbing, AI novel reading, creator publishing, and voice workflows. Google Cloud is the core serving layer for our launch stack:

- Cloud Run for the public API and internal runtimes
- Cloud Text-to-Speech for synthesis
- Vertex AI / Gemini for text generation and orchestration
- Firebase Auth and Firestore for identity and product data
- Cloud Tasks / queue-first orchestration for async workloads

This is not a speculative request. As of `2026-04-13`:

- billing is enabled for project `v-flow-ai-491311`
- `voiceflow-api` is live on Cloud Run in `us-central1`
- `voiceflow-gemini-runtime` is live on Cloud Run in `us-central1`
- additional service initialization in `asia-southeast1` has already returned `ProjectInitFailedQuotaExceeded`

That means our next-stage regional rollout is being constrained by quota before launch traffic has fully begun.

We need higher TTS quota because the current default Gemini-TTS limits are too low for the product shape we are launching. Google’s current Cloud Text-to-Speech quota page lists default Gemini-TTS limits of:

- `gemini-2.5-flash-tts`: `150 QPM`
- `gemini-2.5-pro-tts`: `125 QPM`

Those defaults are not enough for our launch traffic model once multilingual creator dubbing, long-form reader playback, and bursty user demand overlap.

We also need higher Cloud Run regional headroom because our product is intentionally split into multiple bounded services rather than one monolith:

- public API
- internal Gemini/TTS runtime
- internal worker / queue drain layer
- frontend / control plane

Our launch profile uses small request-based Cloud Run services with bounded concurrency and queue admission controls. We are not asking for quota because of inefficient architecture. We are asking because the architecture is already designed for controlled scale and the default regional limits are now the gating factor.

## Actual Live Quota State

As of `2026-04-13`, the live project already has these granted values:

### 1. Google Cloud Text-to-Speech

- `RequestsPerMinutePerProject`: `1000`
- `Neural2RequestsPerMinutePerProject`: `1000`
- `PolyglotRequestsPerMinutePerProject`: `1000`
- `StudioRequestsPerMinutePerProject`: `500`
- `Chirp3RequestsPerMinutePerProject`: `200`
- `ConcurrentStreamingSessionsPerProject`: `100`

### 2. Google AI Studio / Generative Language

- `gemini-2.5-flash-tts` request limit: `1000 RPM` per project per model in paid tier 2
- `gemini-2.5-pro-tts` request limit: `250 RPM` per project per model in paid tier 2
- `gemini-2.5-flash-tts` input tokens: `100000 tokens/min`
- `gemini-2.5-pro-tts` input tokens: `25000 tokens/min`

### 3. Vertex AI Generative Quota

- `gemini-2.5-flash-tts` global RPM: `5`
- `gemini-2.5-flash-tts` regional RPM: `5`
- `gemini-2.5-pro-tts` global RPM: `5`
- `gemini-2.5-pro-tts` regional RPM: `5`

### 4. Cloud Run

- `CpuAllocPerProjectRegion`: `20000` milli-vCPU per region, which is `20 vCPU`
- `ReadPerMinutePerProjectRegion`: `600`
- `WritePerMinutePerProjectRegion`: `30`

## Suggested Quota Requests

Use these values as the recommended ask in the console or support form.

### 1. Minimum request that can work now

This is the most credible support request for a low-usage project. It avoids asking for obviously oversized quota while still solving the real launch blockers.

- Do not request `1000 RPM in 3 regions` for Text-to-Speech. The current TTS request quota is already `1000 RPM` at the project level, not `1000 per region`.
- Request Cloud Run regional CPU quota as the main increase:
- `us-central1`: increase from `20 vCPU` to `32 vCPU`
- `asia-south1`: keep `20 vCPU` if it is only passive failover, or increase to `24 vCPU` if it will take active traffic
- `asia-southeast1`: keep `20 vCPU` if it is only passive failover, or increase to `24 vCPU` if it will take active traffic
- If support asks for one Asia region only, choose `asia-southeast1` first because the project has already hit `ProjectInitFailedQuotaExceeded` there.
- If Vertex AI TTS is part of the near-term plan, request a small regional uplift first instead of a large one:
- `gemini-2.5-flash-tts` on Vertex AI: `30 RPM` global and `15-30 RPM` per active region
- `gemini-2.5-pro-tts` on Vertex AI: `10-15 RPM` global and `5-10 RPM` per active region

Why this is the right minimum:

- the current deployment profile is built around multiple `2 vCPU / 2 GiB` Cloud Run services
- one instance each of API, worker, and internal runtime already consumes most of a small regional budget
- the app is queue-first and rate-limited, so modest increases are enough for launch traffic
- this project currently lacks the usage history Google usually wants before granting large jumps

### 2. Better request after some usage history

After stable paid traffic is visible, the stronger request becomes:

- Cloud Run CPU:
- `us-central1`: `40-48 vCPU`
- `asia-south1`: `24-32 vCPU`
- `asia-southeast1`: `24-32 vCPU`
- Vertex AI TTS:
- `gemini-2.5-flash-tts`: `60-120 RPM` per active region
- `gemini-2.5-pro-tts`: `20-40 RPM` per active region

### 3. What is not worth requesting right now

- Do not lead with a request for higher `texttospeech.googleapis.com` RPM unless Google specifically asks. The project already has `1000 RPM`, which is enough for early launch.
- Do not ask for `1000 RPM` on Vertex AI TTS today. The project currently has `5 RPM` there, and support has already refused much larger jumps due to insufficient usage history.

If the support agent asks for a simpler version, say:

`Our current blocker is not project-level Text-to-Speech RPM. This project already has 1000 RPM granted for Google Cloud Text-to-Speech and 1000 RPM granted for gemini-2.5-flash-tts in Generative Language paid tier 2. The actual launch blocker is Cloud Run regional CPU allocation at 20 vCPU per region, and secondarily Vertex AI regional TTS quota at 5 RPM per model. Please increase Cloud Run CPU quota in us-central1 and one Asia region first, and approve a modest initial Vertex AI TTS uplift for active launch regions.`

## Why This Request Is Commercially Credible

### 1. AI voice is a fast-growth category

Recent market trackers cited by major research firms place the AI voice / voice generator market on a steep growth curve:

- MarketsandMarkets lists the AI voice generator market at `USD 4.16B` in `2025`, projected to `USD 20.71B` by `2031`, around `30.7% CAGR`
- Grand View Research estimates the AI voice generators market at `USD 3.5B` in `2023`, growing to `USD 21.75B` by `2030`, around `29.6% CAGR`

For a quota reviewer, the point is simple: this is a category with credible paid demand, not a novelty workload.

### 2. Audiobook demand remains large and growing

Recent industry data shows the audiobook market is still expanding:

- The Audio Publishers Association reported `USD 2.22B` in `2024` audiobook sales revenue, up `13%` year over year
- The same APA release says `51%` of U.S. adults have listened to an audiobook, and interest among non-listeners is rising
- Publishers Weekly reported U.K. audiobook revenue of `GBP 268M` in `2024`, up `31%`

This matters because V FLOW AI is not only a short-form creator tool. The repo also includes reader, publishing, and chapter-audio workflows, so audiobook-style usage is a core demand driver.

### 3. India is a strong fit for multilingual audio products

PwC India’s `2025–29` entertainment and media outlook points to several signals directly aligned with this product:

- India’s total music, radio, and podcast market grew from `USD 438M` in `2020` to `USD 1.0B` in `2024`
- India had `177M` monthly podcast listeners in `2024`, projected to grow to `267M` by `2029`
- PwC describes regional content as a major growth driver
- PwC also reports India’s creator economy has grown to over `4M` influencers, with only `8–10%` monetising effectively today

That combination is exactly the kind of market where lower-cost creation, dubbing, narration, and localized publishing tools can convert into real paid demand.

### 4. Multilingual dubbing is no longer optional

Direct platform evidence shows multilingual audio increases reach:

- YouTube said creators using multi-language audio saw, on average, more than `25%` of watch time from viewers in the video’s non-primary language
- YouTube also said that for videos with dubbed audio, more than `40%` of total watch time can come from viewers choosing a dubbed language
- TED reports a `115%` increase in plays on dubbed talks

For a GCP reviewer, this supports the core thesis: higher TTS quota is directly tied to measurable audience expansion, not just internal experimentation.

## Competitor Pressure Supports the Need for Launch Headroom

This category is active, funded, and already commercialized.

### Official pricing signals

- ElevenLabs: `Creator $11/mo`, `Pro $99/mo`, `Scale $330/mo`, `Business $1,320/mo`
- ElevenLabs also advertises approximately `~200` Flash minutes on Creator, `~1,000` Flash minutes on Pro, and `~4,000` Flash minutes on Scale
- Speechify Studio: `Starter $19/mo` with `7,200` credits and `Creator $49/mo` with `28,800` credits; voiceover uses `1 credit/second` and dubbing uses `3 credits/second`
- HeyGen: `Creator $29/mo`, `Pro $99/mo`, `Business $149/mo` with voice cloning and video translation as core features
- Deepgram Aura-2 TTS: `USD 0.030 / 1k characters`

This shows that users already pay for AI voice, dubbing, and creator localization products. The competitive risk is not lack of market demand. The real risk is launching with quota low enough to create poor latency, failed requests, or region-blocked scale while competitors offer smoother throughput.

## Why Google Should Be Comfortable Approving This

Our repo and deployed configuration show multiple cost and safety controls already in place:

- queue-first architecture rather than synchronous fan-out
- separate API and worker/runtime roles
- bounded Cloud Run max scale and container concurrency
- per-user queue caps
- queue depth limits
- admission control and soft/hard concurrency controls
- Stripe-backed subscriptions and token packs
- free-versus-paid lane separation already reflected in product architecture and planning docs

This is the profile of a workload that should receive more quota:

- it is commercial
- it is billing-enabled
- it has demand evidence
- it has a clear deployment plan
- it uses guardrails to avoid runaway abuse

## Recommended Budget Line

If the reviewer asks for budget commitment, use this recommended wording and adjust if needed:

`We have budgeted for an initial post-launch Google Cloud spend in the low-thousands USD per month and expect spend to grow with paid usage. Based on current architecture and pricing, we expect Google Cloud and TTS costs to move from controlled early-launch levels into the USD 1,000–2,500/month range as creator, dubbing, and reader usage ramps.`

If you want a more conservative statement, use:

`We have budgeted for an initial Google Cloud spend of approximately USD 1,500/month for launch-phase production workloads, with room to increase as revenue and usage scale.`

## Copy-Paste Version For The Quota Form

Use this if the form gives only a short free-text description:

`We are launching V FLOW AI, a billing-enabled AI voice platform on Google Cloud for multilingual text-to-speech, dubbing, creator workflows, and audiobook-style reading. The project already has a live Cloud Run control plane in us-central1, and our secondary-region rollout has already encountered quota-related service initialization failure. We need higher Gemini-TTS and Cloud Run regional quota to support controlled production launch traffic. This is a queue-first, rate-limited, plan-tiered workload with clear per-user and per-service safeguards. Demand is commercially credible: audiobook sales and AI voice markets are growing, India’s creator economy and regional-language demand are expanding, and multilingual dubbing measurably increases audience reach on platforms like YouTube and TED. Please approve higher Gemini-TTS QPM and additional Cloud Run regional CPU/memory headroom for launch.` 

## Source Notes

Primary and near-primary sources used for this justification:

- Google Cloud Text-to-Speech quotas: default Gemini-TTS limits and statement that limits may be increased upon request
- Google Cloud Run quotas: regional CPU and memory quota can be increased upon request
- Google Cloud pricing pages for TTS, Cloud Run, Firebase, and Cloud Tasks
- Audio Publishers Association 2025 sales and consumer survey release
- PwC India Global Entertainment & Media Outlook 2025–29
- YouTube official blog on multi-language audio and auto-dubbing
- TED “TED in your language” program page
- Official pricing pages from ElevenLabs, Speechify Studio, HeyGen, and Deepgram

## Reviewer-Facing Links

- Cloud Text-to-Speech quotas: https://cloud.google.com/text-to-speech/quotas
- Cloud Run quotas: https://cloud.google.com/run/quotas
- Cloud Text-to-Speech pricing: https://cloud.google.com/text-to-speech/pricing
- Cloud Run pricing: https://cloud.google.com/run/pricing
- Firebase pricing: https://firebase.google.com/pricing
- Cloud Tasks pricing: https://cloud.google.com/tasks/pricing
- Audio Publishers Association survey page: https://www.audiopub.org/surveys
- PwC India E&M outlook 2025–29 PDF: https://www.pwc.in/assets/pdfs/industries/entertainment-and-media/global-entertainment-and-media-outlook-2025-29-india-perspective.pdf
- YouTube multi-language audio: https://blog.youtube/news-and-events/multi-language-audio/
- YouTube auto-dubbing / expressive speech: https://blog.youtube/news-and-events/youtube-auto-dubbing-expressive-speech/
- TED in your language: https://www.ted.com/about/programs/ted-in-your-language
- ElevenLabs pricing: https://elevenlabs.io/pricing
- Speechify Studio pricing: https://speechify.com/pricing-studio/
- HeyGen pricing: https://www.heygen.com/pricing
- Deepgram pricing: https://deepgram.com/pricing
