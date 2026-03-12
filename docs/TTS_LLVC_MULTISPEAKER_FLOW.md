# TTS + Voice-Transfer Mapping + Multi-Speaker Processing Flow

This diagram documents the active production path with queue-based synthesis and canonical voice naming.

```mermaid
flowchart LR
    FE["Frontend UI"] -->|POST /tts/synthesize| MB["media-backend :7800"]
    FE -->|GET /tts/engines/voices| MB
    FE -->|GET /tts/voice-mapping/catalog| MB

    MB -->|"engine=GEM"| GEM["gemini-runtime :7810"]
    MB -->|"engine=KOKORO"| KOK["kokoro-runtime :7820"]

    GEM -->|"WAV bytes"| MB
    KOK -->|"WAV bytes"| MB

    MB -->|"resolve canonical voiceId + profile displayName"| MAP["Voice Mapping Catalog"]
    MAP -->|"profile metadata + displayName"| MB

    MB -->|"audio/wav + x-vf-post-tts-conversion=disabled* "| FE
```

\* For Kokoro responses, `x-vf-post-tts-conversion=disabled_for_kokoro`.

## Multi-Speaker (GEM) Internal Flow

```mermaid
flowchart LR
    A["/tts/synthesize payload"] --> B["speaker_voices + multi_speaker_line_map"]
    B --> C["media-backend queue + runtime routing"]
    C --> D["gemini-runtime studio_pair_groups batching"]
    D --> E["Single WAV output"]
    E --> F["media-backend history/audit normalization (voiceId + voiceName)"]
    F --> G["Final response to frontend"]
```

## Sequence: API Pathways

```mermaid
sequenceDiagram
    participant U as Frontend
    participant M as media-backend
    participant T as GEM/KOK runtime

    U->>M: POST /tts/synthesize
    M->>T: POST /synthesize
    T-->>M: WAV + diagnostics
    M->>M: normalize history/audit voice fields
    M-->>U: 200 audio/wav + x-vf-post-tts-conversion
```

## Notes

- Frontend-facing endpoints:
  - `/tts/synthesize`
  - `/tts/engines/voices`
  - `/tts/voice-mapping/catalog`
- Voice-transfer profile mapping remains active for canonicalization and profile metadata.
- Post-TTS conversion branches are disabled in the active runtime flow.
- Shared mapping sources:
  - `backend/config/voice_profile_bank.v1.json`
  - `backend/config/voice_id_map.v1.json`
