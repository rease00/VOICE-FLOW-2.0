# Reader v2 Brainstorm

## Mission

Rebuild Reader as a true "play novel, manga, and comic with AI TTS" experience.

The product should let a user import or pick a title, open a session in seconds, and move through reading, voice assignment, text cleanup, translation, and export without leaving the Reader tab. The key promise is continuity: a title can start as raw pages or text and become a guided playback session with minimal friction.

## North-Star Metrics

### Primary

- Time to first playable session from home open: under 60 seconds for library items, under 2 minutes for imports.
- Session completion rate: percentage of launched Reader sessions that reach at least 80 percent progress.
- Playback success rate: percent of sessions that generate usable audio without a manual restart.

### Secondary

- Import-to-session conversion rate.
- Cast assignment completion rate for multi-speaker sessions.
- Translation activation rate for titles that support translation.
- Export/share usage rate per active Reader session.
- Return rate: users who reopen a saved session within 7 days.

## Personas

### 1. Fast Reader

- Wants to open a novel or comic and listen immediately.
- Cares about low latency, stable playback, and resume state.
- Typical job: continue a title during commute, chores, or gaming.

### 2. Manga Adjuster

- Wants panel-by-panel reading, better OCR, and voice separation by speaker or panel.
- Cares about panel order, low-confidence detection, and text extraction quality.
- Typical job: make a scanned chapter usable for guided playback.

### 3. Power Editor

- Wants to fine-tune voices, cast mappings, translations, and text corrections.
- Cares about control, preview speed, and the ability to save overrides.
- Typical job: polish a title into a high-quality session for repeated playback.

### 4. Library Curator

- Wants to manage multiple imported works and keep them organized.
- Cares about shelf structure, metadata, legal status, and shareable outputs.
- Typical job: review recent imports, reopen a session, and export audio.

## Top User Jobs

- Find a title in the Reader home and launch it fast.
- Import a PDF, EPUB, TXT, CBZ, or image set and convert it into a session.
- Hear the title with the right narrator and cast voices.
- Clean up broken OCR, low-confidence panels, or misread text.
- Switch between original text, translated text, and playback text.
- Save a session, resume it later, and export audio for reuse.
- Share a session link or generated output with a teammate.

## Differentiated Feature Ideas

1. **One-tap "Play" launch from home**
   - Home items expose a primary action that starts a ready-to-play session.
   - The system preselects the best default tab based on mode, translation support, and import confidence.

2. **Novel line-aware playback**
   - Split prose into chunks that preserve chapter, paragraph, and quote boundaries.
   - Keep chapter navigation visible while audio is playing so users can jump without losing place.

3. **Manga panel rhythm mode**
   - Present panels as a guided sequence with panel-level playback and optional pause points between speech bubbles.
   - Support low-confidence panel markers so users can inspect OCR trouble spots before synthesis.

4. **Cast assignment with confidence scoring**
   - Auto-detect speakers and show confidence per speaker-to-voice mapping.
   - Surface unresolved speakers as a focused task instead of burying them in settings.

5. **Voice preview bench**
   - Let users audition narrator and cast voices on the current unit before committing a full synthesis run.
   - Include a side-by-side compare mode for alternate voice assignments.

6. **Text cleanup workspace**
   - Show source text, normalized text, and translated text in a diff-friendly layout.
   - Allow quick fixes such as punctuation repair, OCR correction, and speaker label edits.

7. **Translation lane with safety rails**
   - Offer translation only when supported or when the source and playback languages differ enough to justify it.
   - Keep the source text visible so users can verify meaning before export.

8. **Export packages, not just audio**
   - Export audio plus a session manifest that includes cast mapping, text version, translation version, and voice choices.
   - Make share links resolve to the right session state so someone else can reopen the exact playback context.

9. **Progressive OCR confidence surfacing**
   - Highlight low-confidence pages, panels, and extracted text segments before playback.
   - Offer a "review first" mode for scanned comics and weak PDFs.

10. **Session continuity and recovery**
    - Auto-save active tab, active unit, progress, cast overrides, and translation status.
    - Recover gracefully if synthesis or OCR work is interrupted.

11. **Import intelligence**
    - Detect whether a title is better treated as novel, manga, or comic, then adapt the launch path automatically.
    - Pre-fill the launch modal with a recommended mode, language path, and voice plan.

12. **Batch shelf actions**
    - Let users select several recently imported items and open them in sequence, inspect them, or export them in batches.

## UX Flow Map

### 1. Home

- User lands on Reader home with shelves for novels, comics, library, and imported items.
- Search and sort reduce the shelf to the right title quickly.
- Each card shows content type, quality flags, and a primary launch action.

### 2. Launch

- User opens a launch modal or direct deep link.
- System resolves:
  - mode: novel or comic
  - launch tab: read or panels
  - availability of voices, cast, text, and translate tabs
  - legal ack requirement
  - import or catalog source
- User confirms voice plan and optional language preferences.

### 3. Playback

- Session opens with sticky playback controls and a visible current unit.
- The main stage keeps the reading surface and the generated audio context in sync.
- Auto-save preserves progress and the current tab.

### 4. Voice

- User sets narrator voice and optional cast mappings.
- Multi-speaker sessions show speaker assignment gaps and confidence.
- Changes should preview quickly and update the session state without losing progress.

### 5. Cast

- User maps detected speakers to specific voices.
- Unassigned speakers are surfaced first.
- The UI should support "good enough now" defaults and later refinement.

### 6. Text

- User inspects source text, cleaned text, and any OCR fixes.
- Inline edits should remain local until the user commits them to the session.
- Text view should be the fallback when audio or cast data is incomplete.

### 7. Translate

- User enables translation if supported by the title or needed because source and playback language differ.
- The translated lane should remain tied to the same unit index as the source lane.
- Users should be able to compare source and translation without losing sync.

### 8. Export / Share

- User exports audio or session artifacts.
- User shares a session link that reopens the current state when permissions allow.
- Shared payload should preserve mode, active unit, cast setup, and translation context.

## Risk Register

### Copyright and commercial policy

- Risk: users may import titles they do not have rights to use commercially.
- Mitigation:
  - keep the legal ack gate in front of Reader usage
  - distinguish imported, licensed, and shared catalog items in metadata
  - add an explicit "commercial use" check before export or publication paths
  - log proof-of-ownership or licensing basis where the backend already supports it

### Latency

- Risk: OCR, translation, and synthesis can stack into a slow first-play experience.
- Mitigation:
  - stage work in parallel when possible
  - show bootstrapping progress with clear substeps
  - cache session bootstrap results
  - defer nonessential work like export packaging until after playback starts

### Poor OCR

- Risk: scanned comics or PDFs can produce low-quality extraction.
- Mitigation:
  - detect low-confidence pages and panels early
  - route weak pages into review mode
  - allow manual correction before full synthesis
  - keep source images and extracted text aligned for fast inspection

### Low-confidence panels

- Risk: panel ordering or panel boundaries may be wrong on manga/comics.
- Mitigation:
  - expose a panel confidence flag in the UI
  - let users re-order or ignore ambiguous panels
  - avoid auto-playing low-confidence content without a visible warning
  - preserve a fallback whole-page reading mode

### Session drift

- Risk: audio, text, and translation can get out of sync after edits or retries.
- Mitigation:
  - make the active unit the source of truth
  - persist restore state after each tab change and synthesis milestone
  - recalculate derived lanes when source text changes

### Cost blow-ups

- Risk: repeated retries or over-eager precomputation can waste compute.
- Mitigation:
  - gate heavy work behind explicit user intent
  - use telemetry to find repeated failure loops
  - cap body sizes and session payload sizes

