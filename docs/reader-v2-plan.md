# Reader v2 Implementation Plan

## Goal

Ship a Reader tab recreation that can open novels, manga, and comics as AI TTS playback sessions while preserving the existing repo shape:

- reader sessions remain the stateful unit
- TTS v2 remains the synthesis path
- imports remain the ingestion path
- legal ack remains a required gate

The target is not a cosmetic refresh. This is a coordinated rebuild of launch, playback, voice/cast/text/translate, and export/share flows.

## Existing Contracts To Preserve

- `reader_legal_ack` must continue to gate Reader usage.
- Reader sessions must remain persistable and resumable.
- TTS v2 session issuing and job creation must stay compatible with the current backend flow.
- Import extraction and split endpoints must remain the source of truth for imported content.
- The home tabs should stay aligned to `novels`, `comics`, `library`, and `imported`.

## Delivery Phases

### Phase 0: Alignment and contract lock

Backend:

- Inventory the current reader session payloads and decide which fields are authoritative versus derived.
- Confirm the minimum bootstrap data needed to render home, launch modal, and playback shell.
- Define which fields belong in session state versus which can be recomputed on demand.

Frontend:

- Map the current Reader tab model to the v2 state machine.
- Identify the smallest set of screens that must be rebuilt first: home, launch, playback shell, and utility tray.

Design:

- Lock terminology: novel, manga, comic, session, unit, voice, cast, text, translate, export.
- Define loading, error, and low-confidence states before implementation starts.

Testing:

- Freeze the contract fixtures that current tests rely on.
- Add regression coverage for tab ordering and default tab selection before changing behavior.

### Phase 1: Bootstrap and home

Backend:

- Build a dashboard/bootstrap contract that returns everything Reader home needs in one request.
- Include:
  - legal ack status
  - reader preferences
  - home shelf data
  - recent sessions
  - import status
  - feature flags
  - session restore hints

Frontend:

- Replace ad hoc loading with a single bootstrapped Reader state.
- Render home shelves, search, and primary launch actions from that bootstrap payload.
- Keep the launch surface simple: pick a title, confirm mode, start session.

Design:

- Design a fast, card-driven home with clear primary actions.
- Reserve visual emphasis for "play now" and "resume session".

Testing:

- Add API contract tests for bootstrap shape.
- Add UI tests for home tab normalization and empty/loading/error states.

### Phase 2: Session launch and playback shell

Backend:

- Standardize session creation payloads for novel and comic launches.
- Ensure the session response includes:
  - session id
  - mode
  - title metadata
  - active unit pointers
  - language data
  - translation availability
  - multi-speaker metadata
  - restore state

Frontend:

- Build the launch modal around the backend session response instead of guessing locally.
- Render a stable playback shell with:
  - stage
  - sticky dock
  - utility tray
  - active unit navigator

Design:

- Create separate default reading surfaces for novel and comic modes.
- Make the shell feel like a playback environment, not a settings form.

Testing:

- Add integration tests for launch -> session creation -> playback shell render.
- Verify deep links restore the correct tab and active unit.

### Phase 3: Voice, cast, text, translate

Backend:

- Confirm endpoints for voice lists, cast persistence, text edits, and translation state are stable.
- Add response fields for speaker confidence, unresolved speakers, translation readiness, and low-confidence markers.

Frontend:

- Build each utility tab as a focused work surface:
  - Voices: narrator selection and previews
  - Cast: speaker-to-voice mapping
  - Text: source, cleaned, and translated text editing
  - Translate: activation, status, and target language visibility
- Keep state local during edits and commit on explicit save.

Design:

- Use a task-oriented layout with clear affordances for unresolved items.
- Show confidence, not just status, for OCR and cast mapping.

Testing:

- Add component tests for tab gating and fallback behavior.
- Add fixture tests for speaker assignment and translation availability.

### Phase 4: Import, OCR, and low-confidence review

Backend:

- Tighten import extraction responses so the frontend can understand confidence and fallback quality.
- Ensure low-confidence metadata can travel from import to session.

Frontend:

- Add a review-first path for weak OCR, scanned manga, and panel-heavy imports.
- Surface warnings where the user can act immediately instead of burying them in logs.

Design:

- Use strong visual warning states for low-confidence pages and panels.
- Keep the review flow close to the playback flow so users do not lose momentum.

Testing:

- Add OCR confidence regression cases.
- Add tests for fallback mode selection when panel extraction is weak or missing.

### Phase 5: Export, share, and polish

Backend:

- Define export payloads for audio and session manifests.
- Make shareable session links resolve to the right restore state.

Frontend:

- Add export/share actions to the playback shell and session menu.
- Preserve current position, tab, voice setup, and translation context in shared outputs.

Design:

- Make export feel like a finish line, not a hidden admin action.

Testing:

- Add export and share smoke tests.
- Verify session restoration after reload, logout/login, and partial failures.

## API Contract Proposals

### 1. Reader dashboard/bootstrap

Purpose: one request to render Reader home and decide whether the user can launch a session.

Suggested shape:

```json
{
  "legalAck": { "accepted": true, "acceptedAt": "..." },
  "flags": {
    "readerV2": true,
    "readerBootstrapV2": true,
    "readerLowConfidenceReview": true
  },
  "preferences": {
    "homeTab": "novels",
    "defaultVoiceId": "voice_123",
    "defaultPlaybackLanguage": "en"
  },
  "home": {
    "novels": [],
    "comics": [],
    "library": [],
    "imported": []
  },
  "recentSessions": [],
  "restoreHints": {
    "sessionId": "sess_123",
    "activeTab": "read",
    "activeUnitIndex": 4
  },
  "limits": {
    "maxUploadBytes": 52428800,
    "maxSessionTextBytes": 524288
  }
}
```

Notes:

- This contract should be cheap to call and safe to cache briefly.
- The frontend should be able to render a useful home screen even if some sections are empty.

### 2. Session create

Purpose: create a Reader session from a catalog item or import.

Suggested response fields:

- `session.id`
- `session.mode`
- `session.title`
- `session.summary`
- `session.coverUrl`
- `session.activeUnitIndex`
- `session.progressPct`
- `session.multiSpeakerEnabled`
- `session.speakerCount`
- `session.translationState`
- `session.translationSupported`
- `session.lowConfidence`
- `session.restoreState`
- `session.castMemory`
- `session.windows`
- `session.panels`

### 3. Session patch/save

Purpose: persist edits without needing full session recreation.

Suggested writable fields:

- `restoreState`
- `castOverrides`
- `textDraft`
- `unitOverrides`
- `translationState`
- `narratorVoiceId`
- `progress`

### 4. Export/share

Purpose: create either audio output or a shareable session manifest.

Suggested outputs:

- export artifact url or blob reference
- session id
- title
- mode
- current unit
- generatedAt
- included lanes
- checksum or version stamp

## Data Model Plan

### Core entities

- `ReaderCatalogItem`
  - static or lightly mutable metadata for a title
  - content kind, ownership basis, direction, language, cover, summary, and import source

- `ReaderSession`
  - active runtime object for playback and editing
  - current mode, current tab, active unit, progress, restore state, and derived metadata

- `ReaderUnit`
  - a playable chunk
  - for novels: chapters, paragraphs, or text windows
  - for comics: pages, panels, or panel groups

- `ReaderVoicePlan`
  - narrator voice plus optional cast mapping

- `ReaderTranslationState`
  - availability, source language, target language, and readiness

- `ReaderConfidenceState`
  - OCR confidence, panel confidence, speaker confidence, and error markers

### UI state slices

- `homeState`
  - tab, search term, shelf lists, loading flags, and selected item

- `launchState`
  - chosen item, requested mode, launch tab, voice defaults, and legal gate status

- `sessionState`
  - session id, mode, title metadata, active unit index, restore state, and sync status

- `utilityState`
  - active tab, draft text, cast draft, voice preview state, translation edits, and save status

- `telemetryState`
  - event queue, boot timings, error buckets, and retry counters

## Rollout Strategy

### Flags

- `readerV2` for the overall new Reader experience.
- `readerBootstrapV2` for the new dashboard/bootstrap contract.
- `readerLaunchV2` for the new launch flow.
- `readerPlaybackV2` for the new playback shell.
- `readerLowConfidenceReview` for OCR and panel review warnings.
- `readerShareExportV2` for the export/share flow.

### Rollout order

1. Internal dogfood behind flags.
2. Small percentage of authenticated users with telemetry.
3. Expand by content type, starting with novel sessions and then comics/manga.
4. Enable imports-only users after OCR and low-confidence paths are stable.
5. Remove fallback behavior only after session restore and export are proven.

### Telemetry

Capture at least:

- bootstrap latency
- launch latency
- time to first audio
- OCR failure rate
- low-confidence review open rate
- cast assignment completion rate
- translation activation rate
- export success rate
- session resume success rate
- error rate by endpoint and tab

## Definition Of Done

- Reader home loads from the bootstrap contract without extra blocking calls.
- Users can launch a novel, manga, or comic session end to end.
- Session playback supports read/panels, voices, cast, text, and translate tabs.
- Imports can be opened into a usable session with clear low-confidence handling.
- Legal ack is enforced consistently before Reader usage.
- Session state survives refresh and restores the correct tab and unit.
- Export/share works for completed or in-progress sessions.
- All reader tab model tests pass, including tab ordering and fallback behavior.
- New API contract tests exist for bootstrap, session create, and session patch flows.
- E2E smoke coverage proves at least one novel and one comic path.
- Telemetry is wired for rollout analysis and failure triage.
- The docs here remain in sync with the implemented payload shapes.

## Open Questions To Resolve During Build

- Should the bootstrap contract include full shelf data or just summaries and counts?
- Which low-confidence thresholds should trigger a blocking warning versus a passive badge?
- Do we want export to bundle audio only, or audio plus a session manifest by default?
- How aggressive should auto-recovery be when OCR or synthesis is incomplete?

