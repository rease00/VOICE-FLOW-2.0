# TTS + RVC + Multi-Speaker Processing Flow

This diagram documents the current production pathway with isolated runtimes and stable frontend API contracts.

```mermaid
flowchart LR
    FE["Frontend UI"] -->|POST /tts/synthesize| MB["media-backend :7800"]
    FE -->|GET /tts/engines/voices| MB
    FE -->|GET /tts/voice-mapping/catalog| MB
    FE -->|GET /rvc/models| MB
    FE -->|POST /rvc/load-model| MB
    FE -->|POST /rvc/convert| MB

    MB -->|"engine=GEM"| GEM["gemini-runtime :7810"]
    MB -->|"engine=KOKORO"| KOK["kokoro-runtime :7820"]

    GEM -->|"WAV bytes"| MB
    KOK -->|"WAV bytes"| MB

    MB -->|"resolve voice -> profile -> model"| MAP["30-Speaker Mapping Catalog"]
    MAP -->|"model_name + profile_id"| MB

    MB -->|"POST /v1/convert (preset=tts_realtime)"| RVC["rvc-runtime :7830"]
    RVC -->|"Converted WAV + headers"| MB

    MB -->|"audio/wav (converted only in strict mode)"| FE
```

## Multi-Speaker (GEM) Internal Flow

```mermaid
flowchart LR
    A["/tts/synthesize payload"] --> B["speaker_voices + multi_speaker_line_map"]
    B --> C["media-backend queue + runtime routing"]
    C --> D["gemini-runtime studio_pair_groups batching"]
    D --> E["Single WAV output"]
    E --> F["media-backend post-TTS mapping resolve"]
    F --> G["rvc-runtime /v1/convert"]
    G --> H["Converted multi-speaker WAV"]
    H --> I["Final response to frontend"]
```

## Sequence: API Pathways

```mermaid
sequenceDiagram
    participant U as Frontend
    participant M as media-backend
    participant T as GEM/KOK runtime
    participant R as rvc-runtime

    U->>M: POST /tts/synthesize
    M->>T: POST /synthesize
    T-->>M: WAV + diagnostics
    M->>M: resolve mapped profile/model (1:1 voice ID mapping)
    M->>R: POST /v1/convert
    R-->>M: converted WAV + x-vf-rvc-*
    M-->>U: 200 audio/wav + x-vf-post-tts-*
```

## Notes

- Frontend-facing endpoints remain stable:
  - `/tts/synthesize`
  - `/rvc/models`
  - `/rvc/load-model`
  - `/rvc/convert`
- Internal RVC runtime API:
  - `GET /v1/health`
  - `GET /v1/models`
  - `POST /v1/load-model`
  - `POST /v1/convert`
- Shared mapping source:
  - `backend/config/voice_profile_bank.v1.json`
  - `backend/config/voice_id_map.v1.json`
