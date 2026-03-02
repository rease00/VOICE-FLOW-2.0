# Scaling Architecture

## Target Model

VoiceFlow scaling is queue-first and asynchronous:

1. API layer accepts synthesis requests and writes jobs to Redis-backed queue.
2. Worker layer consumes queued jobs and calls engine runtimes.
3. Engine runtimes (Gemini and Kokoro) process synthesis in parallel with engine-specific limits.
4. Clients poll `GET /tts/jobs/{job_id}` until terminal status.

This supports high user volume by horizontal scaling, rather than single-process synchronous rendering.

## Services

1. `voiceflow-api`
   - FastAPI app (`backend/app.py`)
   - Handles auth, admission control, queue enqueue, status APIs, admin metrics.
2. `voiceflow-worker`
   - Same codebase, worker-focused deployment profile.
   - Runs queue consumers and runtime dispatch loops.
3. `gemini-runtime`
   - `/synthesize` and `/v1/generate-text` for Gemini-backed workloads.
4. `kokoro-runtime`
   - `/synthesize` for Kokoro workloads.
5. Managed Redis
   - Queue ownership and rate-limit state (`VF_REDIS_URL`).
   - Shared across API and worker pods.

## Queue and Concurrency Strategy

1. Queue TTL and ingress behavior:
   - `VF_TTS_QUEUE_JOB_TTL_MS=300000`
   - `VF_TTS_QUEUE_SYNC_WAIT_MS=3000`
2. Engine concurrency:
   - `VF_TTS_ENGINE_CONCURRENCY_GEM=12`
   - `VF_TTS_ENGINE_CONCURRENCY_KOKORO=8`
3. Admission safeguards:
   - Queue depth limit (`VF_TTS_QUEUE_MAX_DEPTH`).
   - Projected queue-timeout rejection:
     - `503`
     - `errorCode=ENGINE_OVERLOADED`
     - `reason=estimated_queue_timeout`

## Autoscaling Signals

Use HPA/KEDA signals:

1. API deployment:
   - CPU/Memory
   - Request rate
2. Worker deployment:
   - Redis queue depth
   - `oldestQueuedAgeMs` from `/admin/tts/queue/metrics`
   - Worker CPU
3. Runtime deployments:
   - Runtime latency p95
   - In-flight concurrency
   - 5xx rate

## Staging Promotion Gate

Before production promotion:

1. Reliability suite:
   - `npm run ci:reliability`
2. Load gate:
   - `VF_ENABLE_LOAD_GATE=1 npm run ci:reliability`
3. Required outcomes at 50 concurrency:
   - `completed=100%` for async jobs
   - `5xx=0`
   - No queue-timeout regressions

## Operational Endpoints

1. Queue health:
   - `GET /admin/tts/gateway/status`
2. Queue telemetry:
   - `GET /admin/tts/queue/metrics`
3. Job diagnostics:
   - `GET /tts/jobs/{job_id}`

