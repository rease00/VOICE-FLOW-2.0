## Google Cloud Support Request Draft

Prepared from the local `voice-Flow` repository and read-only Google Cloud discovery on 2026-04-10.

### Verified project details

- Project name: `V FLOW AI`
- Active project ID: `v-flow-ai-491311`
- Project number: `820011798437`
- Billing account ID: `012241-6355CE-4AF5A6`
- Billing enabled: `Yes`
- Primary verified business domain in the repo: `v-flow-ai.com`
- Verified business email provided by owner: `rease@v-flow-ai.com`
- Secondary personal email provided by owner: `ali9851229685@gmail.com`
- Verified Cloud Run services in `us-central1`: `v-flow-ai-frontend`, `voiceflow-api`, `voiceflow-gemini-runtime`
- Verified Cloud Tasks queue in `us-central1`: `voiceflow-tts-drain-us-central1`
- Verified Firestore database: Native mode, `us-central1`
- Verified Artifact Registry repository: `voiceflow` in `asia-southeast1`
- Additional verified project from local service-account setup: `v-flow-ai-2`
- Additional verified project name: `V FLOW AI 2`
- Additional verified project number: `219354580351`

### Architecture summary from the repo

V FLOW AI is a production-oriented AI voice platform with:

- Next.js frontend
- FastAPI backend
- Cloud Run services for frontend, API, worker, and Gemini runtime
- Firebase Authentication and Firestore
- Cloud Tasks-based async job flow
- Vertex AI / Gemini-backed text generation
- Google Cloud Text-to-Speech-backed synthesis path
- Artifact Registry and Secret Manager
- Optional Cloudflare frontend path and external voice-clone runtime integrations

The repo and deployed services indicate a queue-first architecture for text generation, TTS, voice cloning, multi-speaker synthesis, and billing-aware access control.

### Ready-to-send response

Use Case (Project details, service required, quota for which service is needed):
We are building and deploying V FLOW AI, an AI voice generation, dubbing, AI novel reader, and AI agent platform that supports text generation, text-to-speech, AI novel reading, voice cloning, multi-speaker synthesis, and asynchronous media processing. For launch, the frontend delivery layer is on Cloudflare, while Google Cloud powers the backend APIs, AI runtimes, Firebase Auth/Firestore, Cloud Tasks, and the quota-sensitive inference and TTS workloads.

The primary Google Cloud services required for this project are:
- Cloud Run
- Vertex AI / Gemini APIs
- Cloud Text-to-Speech
- Cloud Tasks
- Firestore / Firebase Auth
- Secret Manager
- Artifact Registry

Requested quota for launch:
- At least 1,000 RPM for Gemini 2.5 Flash text generation
- Sufficient Gemini text/token throughput for large AI Director and AI novel reader prompt windows
- At least 1,000 RPM for Pro TTS

The quota review we need is mainly for production traffic growth across:
- Gemini 2.5 Flash text-generation throughput for AI Director, AI novel reader, and AI agent workflows
- Gemini text/token throughput for large prompt windows during launch
- Pro TTS throughput
- Cloud Run scaling across `asia-south1`, `us-central1`, and `europe-west1`

Existing IT Infrastructure / Current spend:
Current infrastructure is already set up in Google Cloud under project `v-flow-ai-491311` with Cloud Run, Firebase, Firestore, Artifact Registry, Secret Manager, Cloud Tasks, and AI-related APIs enabled. For launch architecture, Cloudflare is used for the frontend edge layer, while Google Cloud is used for the backend API, Gemini runtime, queue handling, identity, and production AI workloads. The platform is currently under development and in the final integration and rollout phase. A Cloud Tasks queue for TTS drain handling and a Firestore Native database are also already provisioned.

Current exact spend is not available from the current read-only project access because Cloud Billing export and budget visibility were not exposed to the active service account. If needed, we can share current spend from the billing console directly.

Future Road Map / Allocated budget:
The roadmap is to move from active development and staged deployment into production launch, then scale usage for free and paid users with queue-based traffic control and higher throughput for paid generation lanes. We expect increasing demand for AI inference, TTS workloads, AI novel reader usage, and AI-agent-based workflow automation as the platform onboards more users.

Allocated budget:
- Initial controlled production rollout budget is planned and linked to billing account `012241-6355CE-4AF5A6`
- Please update this section with your exact monthly or quarterly spend commitment before sending

Billing entity name & domain:
V FLOW AI
Domain: `v-flow-ai.com`

Development timeframe for the project & go live date:
Development has been active since at least 2026-03-25, and Google Cloud service deployment is already live from early 2026-04. Our target launch / production rollout is by 2026-04-30 or during the first week of 2026-05.

Billing Location:
India

Business E-mail ID:
`rease@v-flow-ai.com`

Project Number:
`820011798437`

Project ID:
`v-flow-ai-491311`

Billing (Account) ID:
`012241-6355CE-4AF5A6`

Additional project used in the launch pool:
- Project ID: `v-flow-ai-2`
- Project Number: `219354580351`
- Billing account for this additional project could not be verified from current access because Cloud Billing API access is disabled or unavailable on that project

### Notes before sending

- `v-flow-ai-491311` is verified from the current authenticated Google Cloud environment.
- `v-flow-ai-2` could not be verified from the active credentials on 2026-04-10, so it is not included in the final draft above.
- Exact launch regions visible in the current project are `us-central1`, `europe-west1`, and `asia-south1` for rollout planning.
- Replace the budget line with the real amount you want to commit.
- Confirm `Billing Location` matches the billing profile legal address before sending.
