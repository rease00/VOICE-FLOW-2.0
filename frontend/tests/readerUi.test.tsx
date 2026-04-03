import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ReaderCatalogItem, ReaderLibrary, VoiceOption } from '../types';
import { ReaderBrowseHome } from '../src/features/reader/components/ReaderBrowseHome';
import { ReaderUtilityTray } from '../src/features/reader/components/ReaderUtilityTray';
import { buildReaderDashboardPayloadFromLibrary, resolveReaderHomeViewModel } from '../src/features/reader/model/dashboard';
import type { ReaderTab } from '../src/features/reader/model/tabs';

vi.mock('../src/shared/notifications/format', () => ({
  toUserMessage: (value: unknown, fallback: string) => String(fallback || value || ''),
}));

const makeCatalogItem = (overrides: Partial<ReaderCatalogItem> = {}): ReaderCatalogItem => ({
  id: 'reader-item',
  title: 'Reader Item',
  author: 'Reader Author',
  regionId: 'english',
  contentKind: 'book',
  surface: 'uploads',
  provider: 'voiceflow_upload',
  license: 'user_responsible',
  ...overrides,
});

const voiceOptions: VoiceOption[] = [
  {
    id: 'v1',
    name: 'Narrator One',
    gender: 'Female',
    accent: 'US',
    geminiVoiceName: 'narrator_one',
  },
];

const noOp = () => undefined;

describe('reader browse home', () => {
  it('renders a dashboard view without a comics home tab', () => {
    const importedItem = makeCatalogItem({
      id: 'imported-1',
      title: 'Imported Story',
      author: 'A Reader',
      contentKind: 'book',
      surface: 'uploads',
      resume: {
        hasProgress: true,
        consumedChars: 240,
        currentPanelIndex: 0,
        progressPct: 42,
      },
    });
    const library = {
      surface: 'all',
      regionId: 'english',
      regions: [{ id: 'english', label: 'English' }],
      items: [importedItem],
      activeSession: null,
      activeSessions: [],
      counts: {
        all: 1,
        visible: 1,
        books: 0,
        comics: 0,
        uploads: 1,
        resumable: 1,
      },
      facets: { providers: [], collections: [], progressStates: [] },
      shelves: {
        continueReading: [],
        trending: [],
        newArrivals: [],
        recentlyImported: [importedItem],
      },
    } satisfies ReaderLibrary;
    const dashboard = buildReaderDashboardPayloadFromLibrary(library);
    const viewModel = resolveReaderHomeViewModel(dashboard, 'imported', '');
    const markup = renderToStaticMarkup(
      <ReaderBrowseHome
        viewModel={viewModel}
        homeTab="imported"
        searchTerm=""
        selectedItemId="imported-1"
        isLoading={false}
        bootstrapState="ready"
        legalAccepted
        showImportFlow={false}
        libraryErrorMessage=""
        onChangeHomeTab={noOp}
        onChangeSearchTerm={noOp}
        onSelectItem={noOp}
        onOpenItem={noOp}
        onAcceptReaderRights={noOp}
        resolveImportedStatusBadge={() => 'Ready To Play'}
        resolveMediaUrl={(url) => url || ''}
      />
    );

    expect(markup).toContain('role="group"');
    expect(markup).not.toContain('role="tablist"');
    expect(markup).not.toContain('role="tab"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('Imported');
    expect(markup).not.toContain('Comics');
    expect(markup).not.toContain('Reader is ready');
    expect(markup).not.toContain('Reader status panels');
    expect(markup).not.toContain('Reader Dashboard');
    expect(markup).not.toContain('Open Continue Reading');
    expect(markup).not.toContain('No trending titles match this filter yet.');
    expect(markup).not.toContain('No new arrivals match this filter yet.');
    expect(markup).toContain('aria-label="Search reader catalog"');
    expect(markup).toContain('data-testid="reader-shelf-recentlyImported"');
  });

  it('hides empty shelf cards and keeps continue reading only in the library tab', () => {
    const resumableNovel = makeCatalogItem({
      id: 'novel-1',
      title: 'Resume Me',
      author: 'Shelf Writer',
      surface: 'books',
      provider: 'catalog',
      license: 'public-domain',
      resume: {
        hasProgress: true,
        consumedChars: 180,
        currentPanelIndex: 0,
        progressPct: 60,
      },
    });
    const freshNovel = makeCatalogItem({
      id: 'novel-2',
      title: 'Fresh Arrival',
      author: 'Another Writer',
      surface: 'books',
      provider: 'catalog',
      license: 'public-domain',
    });
    const importedItem = makeCatalogItem({
      id: 'imported-2',
      title: 'Imported Shelf',
      author: 'Upload Author',
      surface: 'uploads',
    });
    const dashboard = buildReaderDashboardPayloadFromLibrary({
      surface: 'all',
      regionId: 'english',
      regions: [{ id: 'english', label: 'English' }],
      items: [resumableNovel, freshNovel, importedItem],
      activeSession: null,
      activeSessions: [],
      counts: {
        all: 3,
        visible: 3,
        books: 2,
        comics: 0,
        uploads: 1,
        resumable: 1,
      },
      facets: { providers: [], collections: [], progressStates: [] },
      shelves: {
        continueReading: [resumableNovel],
        trending: [freshNovel, resumableNovel],
        newArrivals: [],
        recentlyImported: [importedItem],
      },
    } satisfies ReaderLibrary);

    const libraryMarkup = renderToStaticMarkup(
      <ReaderBrowseHome
        viewModel={resolveReaderHomeViewModel(dashboard, 'library', '')}
        homeTab="library"
        searchTerm=""
        selectedItemId=""
        isLoading={false}
        bootstrapState="ready"
        legalAccepted
        showImportFlow={false}
        libraryErrorMessage=""
        onChangeHomeTab={noOp}
        onChangeSearchTerm={noOp}
        onSelectItem={noOp}
        onOpenItem={noOp}
        onAcceptReaderRights={noOp}
        resolveImportedStatusBadge={() => 'Ready To Play'}
        resolveMediaUrl={(url) => url || ''}
      />
    );

    const novelsMarkup = renderToStaticMarkup(
      <ReaderBrowseHome
        viewModel={resolveReaderHomeViewModel(dashboard, 'novels', '')}
        homeTab="novels"
        searchTerm=""
        selectedItemId=""
        isLoading={false}
        bootstrapState="ready"
        legalAccepted
        showImportFlow={false}
        libraryErrorMessage=""
        onChangeHomeTab={noOp}
        onChangeSearchTerm={noOp}
        onSelectItem={noOp}
        onOpenItem={noOp}
        onAcceptReaderRights={noOp}
        resolveImportedStatusBadge={() => 'Ready To Play'}
        resolveMediaUrl={(url) => url || ''}
      />
    );

    expect(libraryMarkup).toContain('Continue Reading');
    expect(libraryMarkup).not.toContain('No new arrivals match this filter yet.');
    expect(novelsMarkup).not.toContain('Continue Reading');
    expect(novelsMarkup).not.toContain('No new arrivals match this filter yet.');
  });

  it('shows sign-in required instead of import-rights pending when auth is required', () => {
    const dashboard = buildReaderDashboardPayloadFromLibrary({
      surface: 'all',
      regionId: 'english',
      regions: [{ id: 'english', label: 'English' }],
      items: [],
      activeSession: null,
      activeSessions: [],
      counts: {
        all: 0,
        visible: 0,
        books: 0,
        comics: 0,
        uploads: 0,
        resumable: 0,
      },
      facets: { providers: [], collections: [], progressStates: [] },
      shelves: {
        continueReading: [],
        trending: [],
        newArrivals: [],
        recentlyImported: [],
      },
    } satisfies ReaderLibrary);
    const viewModel = resolveReaderHomeViewModel(dashboard, 'novels', '');
    const markup = renderToStaticMarkup(
      <ReaderBrowseHome
        viewModel={viewModel}
        homeTab="novels"
        searchTerm=""
        selectedItemId=""
        isLoading={false}
        bootstrapState="needs_auth"
        legalAccepted={false}
        showImportFlow={false}
        libraryErrorMessage="Sign in required to restore Reader shelves, sessions, and your dashboard state."
        onChangeHomeTab={noOp}
        onChangeSearchTerm={noOp}
        onSelectItem={noOp}
        onOpenItem={noOp}
        onAcceptReaderRights={noOp}
        resolveImportedStatusBadge={() => 'Ready To Play'}
        resolveMediaUrl={(url) => url || ''}
      />
    );

    expect(markup).toContain('Sign in required');
    expect(markup).not.toContain('Reader rights pending');
  });

  it('shows the reader rights prompt only after the import flow is armed', () => {
    const dashboard = buildReaderDashboardPayloadFromLibrary({
      surface: 'all',
      regionId: 'english',
      regions: [{ id: 'english', label: 'English' }],
      items: [],
      activeSession: null,
      activeSessions: [],
      counts: {
        all: 0,
        visible: 0,
        books: 0,
        comics: 0,
        uploads: 0,
        resumable: 0,
      },
      facets: { providers: [], collections: [], progressStates: [] },
      shelves: {
        continueReading: [],
        trending: [],
        newArrivals: [],
        recentlyImported: [],
      },
    } satisfies ReaderLibrary);
    const viewModel = resolveReaderHomeViewModel(dashboard, 'novels', '');

    const idleMarkup = renderToStaticMarkup(
      <ReaderBrowseHome
        viewModel={viewModel}
        homeTab="novels"
        searchTerm=""
        selectedItemId=""
        isLoading={false}
        bootstrapState="ready"
        legalAccepted={false}
        showImportFlow={false}
        libraryErrorMessage=""
        onChangeHomeTab={noOp}
        onChangeSearchTerm={noOp}
        onSelectItem={noOp}
        onOpenItem={noOp}
        onAcceptReaderRights={noOp}
        resolveImportedStatusBadge={() => 'Ready To Play'}
        resolveMediaUrl={(url) => url || ''}
      />
    );

    const armedMarkup = renderToStaticMarkup(
      <ReaderBrowseHome
        viewModel={viewModel}
        homeTab="novels"
        searchTerm=""
        selectedItemId=""
        isLoading={false}
        bootstrapState="ready"
        legalAccepted={false}
        showImportFlow
        libraryErrorMessage=""
        onChangeHomeTab={noOp}
        onChangeSearchTerm={noOp}
        onSelectItem={noOp}
        onOpenItem={noOp}
        onAcceptReaderRights={noOp}
        resolveImportedStatusBadge={() => 'Ready To Play'}
        resolveMediaUrl={(url) => url || ''}
      />
    );

    expect(idleMarkup).not.toContain('Reader rights pending');
    expect(idleMarkup).not.toContain('Accept Once');
    expect(armedMarkup).toContain('Reader rights pending');
    expect(armedMarkup).toContain('Accept Once');
  });

  it('collapses empty shelves into a single browse empty state', () => {
    const dashboard = buildReaderDashboardPayloadFromLibrary({
      surface: 'all',
      regionId: 'english',
      regions: [{ id: 'english', label: 'English' }],
      items: [],
      activeSession: null,
      activeSessions: [],
      counts: {
        all: 0,
        visible: 0,
        books: 0,
        comics: 0,
        uploads: 0,
        resumable: 0,
      },
      facets: { providers: [], collections: [], progressStates: [] },
      shelves: {
        continueReading: [],
        trending: [],
        newArrivals: [],
        recentlyImported: [],
      },
    } satisfies ReaderLibrary);
    const viewModel = resolveReaderHomeViewModel(dashboard, 'novels', '');
    const markup = renderToStaticMarkup(
      <ReaderBrowseHome
        viewModel={viewModel}
        homeTab="novels"
        searchTerm=""
        selectedItemId=""
        isLoading={false}
        bootstrapState="ready"
        legalAccepted
        showImportFlow={false}
        libraryErrorMessage=""
        onChangeHomeTab={noOp}
        onChangeSearchTerm={noOp}
        onSelectItem={noOp}
        onOpenItem={noOp}
        onAcceptReaderRights={noOp}
        resolveImportedStatusBadge={() => 'Ready To Play'}
        resolveMediaUrl={(url) => url || ''}
      />
    );

    expect(markup).toContain('Fresh titles will appear here as soon as your Reader shelves are ready.');
    expect(markup).not.toContain('No trending titles match this filter yet.');
    expect(markup).not.toContain('No new arrivals match this filter yet.');
    expect(markup).not.toContain('No imported titles match this filter yet.');
  });
});

describe('reader utility tray', () => {
  it('renders managed tabs with real panel relationships', () => {
    const tabs: ReaderTab[] = ['read', 'settings', 'scripts', 'saved'];
    const markup = renderToStaticMarkup(
      <ReaderUtilityTray
        mode="novel"
        tabs={tabs}
        activeTab="settings"
        tabBadges={{
          settings: 'Cast on',
          scripts: '1/1',
          saved: '2',
        }}
        sourceLanguage="en"
        targetLanguage="hi"
        playbackLanguage="en"
        translationPreview="Translated sample"
        translationSupported
        multiSpeakerEnabled
        isCastModeEnabled
        ambienceSoundEnabled
        narratorVoiceId="v1"
        speed={1}
        ambiencePreset="m_cinematic_melody"
        stylePreset="default"
        voiceSettingsDirty={false}
        castSettingsDirty={false}
        isSavingVoiceSettings={false}
        isSavingCastAssignments={false}
        backgroundPrepLimitValue={1000}
        backgroundPrepLimitUnit="chars"
        voiceOptions={voiceOptions}
        detectedSpeakers={['Alice', 'Bob']}
        castDraft={{ Alice: 'v1' }}
        textDraft="Draft text"
        activeText="Active text"
        scriptSegments={[{ id: 'segment-1', title: 'Chapter 1', body: 'A line of text', status: 'ready', index: 0, charCount: 14 }]}
        currentUnitTitle="Chapter 1"
        savepointDownloadUrl="/reader/sessions/session-1/export"
        textDirty
        canInstallReaderApp
        isReaderAppInstalled={false}
        readerAppInstallHint="Install Reader shortcut for offline mode."
        savedAudioEntries={[{
          id: 'saved-1',
          title: 'Saved chapter',
          unitLabel: 'Chapter 1',
          sessionId: 'session-1',
          unitId: 'unit-1',
          sourceJobId: 'job-1',
          speakerMode: 'multi-speaker',
          mediaType: 'audio/wav',
          sizeBytes: 2048,
          createdAtMs: 1710000000000,
          watermark: { mode: 'invisible', enforced: true },
        }]}
        isSavingOfflineAudio={false}
        onChangeTab={noOp}
        onToggleMultiSpeaker={noOp}
        onToggleCastMode={noOp}
        onToggleAmbienceSound={noOp}
        onNarratorVoiceChange={noOp}
        onSpeedChange={noOp}
        onAmbiencePresetChange={noOp}
        onStylePresetChange={noOp}
        onCastDraftChange={noOp}
        onBackgroundPrepLimitValueChange={noOp}
        onBackgroundPrepLimitUnitChange={noOp}
        onSaveVoiceSettings={noOp}
        onSaveCastAssignments={noOp}
        onTextDraftChange={noOp}
        onApplyTextEdit={noOp}
        onResetTextEdit={noOp}
        onSourceLanguageChange={noOp}
        onTargetLanguageChange={noOp}
        onPlaybackLanguageChange={noOp}
        onInstallReaderApp={noOp}
        onSaveCurrentToLibrary={noOp}
        onPlaySavedAudio={noOp}
        onDownloadSavedAudio={noOp}
        onDeleteSavedAudio={noOp}
      />
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Reader utility tabs"');
    expect(markup).toContain('id="reader-utility-tab-settings"');
    expect(markup).toContain('aria-controls="reader-utility-panel-settings"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('role="tabpanel"');
    expect((markup.match(/role="tabpanel"/g) || []).length).toBeGreaterThan(1);
    expect(markup).toContain('aria-label="Reader settings sections"');
    expect(markup).toContain('data-reader-settings-tab="voice"');
    expect(markup).toContain('data-reader-settings-panel="voice"');
    expect(markup).toContain('hidden=""');
  });

  it('renders a compact settings-only surface with nested settings tabs', () => {
    const markup = renderToStaticMarkup(
      <ReaderUtilityTray
        mode="novel"
        tabs={['settings'] as ReaderTab[]}
        activeTab="settings"
        tabBadges={{ settings: 'Single' }}
        sourceLanguage="en"
        targetLanguage="hi"
        playbackLanguage="en"
        translationPreview="Translated sample"
        translationSupported
        multiSpeakerEnabled={false}
        isCastModeEnabled={false}
        ambienceSoundEnabled={false}
        narratorVoiceId="v1"
        speed={1}
        ambiencePreset="m_none"
        stylePreset="default"
        voiceSettingsDirty={false}
        castSettingsDirty={false}
        isSavingVoiceSettings={false}
        isSavingCastAssignments={false}
        backgroundPrepLimitValue={1000}
        backgroundPrepLimitUnit="chars"
        voiceOptions={voiceOptions}
        detectedSpeakers={[]}
        castDraft={{}}
        textDraft=""
        activeText=""
        scriptSegments={[]}
        currentUnitTitle="Reader settings"
        savepointDownloadUrl=""
        textDirty={false}
        canInstallReaderApp
        isReaderAppInstalled={false}
        readerAppInstallHint="Install Reader shortcut for offline mode."
        savedAudioEntries={[]}
        isSavingOfflineAudio={false}
        onChangeTab={noOp}
        onToggleMultiSpeaker={noOp}
        onToggleCastMode={noOp}
        onToggleAmbienceSound={noOp}
        onNarratorVoiceChange={noOp}
        onSpeedChange={noOp}
        onAmbiencePresetChange={noOp}
        onStylePresetChange={noOp}
        onCastDraftChange={noOp}
        onBackgroundPrepLimitValueChange={noOp}
        onBackgroundPrepLimitUnitChange={noOp}
        onSaveVoiceSettings={noOp}
        onSaveCastAssignments={noOp}
        onSourceLanguageChange={noOp}
        onTargetLanguageChange={noOp}
        onPlaybackLanguageChange={noOp}
        onTextDraftChange={noOp}
        onApplyTextEdit={noOp}
        onResetTextEdit={noOp}
        onInstallReaderApp={noOp}
        onSaveCurrentToLibrary={noOp}
        onPlaySavedAudio={noOp}
        onDownloadSavedAudio={noOp}
        onDeleteSavedAudio={noOp}
      />
    );

    expect(markup).toContain('Settings');
    expect(markup).toContain('Tune Reader voice defaults before you open a session.');
    expect(markup).toContain('Compact front-view controls with dedicated tabs');
    expect(markup).toContain('aria-label="Reader settings sections"');
    expect(markup).toContain('data-reader-settings-tab="voice"');
    expect(markup).toContain('data-reader-settings-tab="offline"');
    expect(markup).toContain('data-reader-settings-panel="voice"');
    expect(markup).toContain('data-reader-settings-panel="offline"');
  });
});
