# Reliability Runbook

## Startup Modes

1. Full local stack (recommended):
   - `npm run services:bootstrap`
2. GPU-preferred runtime mode:
   - `npm run services:bootstrap:gpu`
3. Verify runtime health:
   - `npm run services:check`
4. Stop all managed runtimes:
   - `npm run services:down`

## Reliability CI Gate

1. Run strict reliability gates:
   - `npm run ci:reliability`
2. Included checks:
   - Type checks (`tsc --noEmit`)
   - XTTS frontend all-speaker audit
   - XTTS audio-mix regression gate (enforced baseline)
   - Media backend audit
   - Runtime contract conformance

## Runtime Capabilities

1. Individual runtime capabilities:
   - `GET /v1/capabilities` on Gemini/Kokoro/XTTS runtimes
2. Aggregated capabilities:
   - `GET /tts/engines/capabilities` on media backend

## Failure Triage

1. Verify backend health:
   - `GET http://127.0.0.1:7800/health`
2. Check runtime capability availability:
   - `GET http://127.0.0.1:7800/tts/engines/capabilities`
3. Tail backend/runtime logs:
   - `GET /runtime/logs/tail?service=media-backend`
   - `GET /runtime/logs/tail?service=xtts-runtime`
   - `GET /runtime/logs/tail?service=kokoro-runtime`
   - `GET /runtime/logs/tail?service=gemini-runtime`
4. If synthesis fails, use `trace_id`:
   - Request includes optional `trace_id`
   - Runtime response includes `X-VoiceFlow-Trace-Id`
   - Find matching stage events in runtime logs

## Recovery Procedure

1. Attempt idempotent engine switch:
   - `POST /tts/engines/switch` with `{ "engine": "XTTS" | "KOKORO" | "GEM", "gpu": false }`
2. If still unhealthy, restart services:
   - `npm run services:down`
   - `npm run services:bootstrap`
3. Re-run reliability checks:
   - `npm run audit:xtts:frontend-speakers`
   - `npm run audit:xtts:audio-mix:ci`
   - `npm run audit:media`
   - `npm run test:contracts`

