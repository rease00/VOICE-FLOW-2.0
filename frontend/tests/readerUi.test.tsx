import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReaderCatalogItem, ReaderLibrary, VoiceOption } from '../types';
import { ReaderBrowseHome } from '../src/features/reader/components/ReaderBrowseHome';
import { ReaderUtilityTray } from '../src/features/reader/components/ReaderUtilityTray';
import { buildReaderDashboardPayloadFromLibrary, resolveReaderHomeViewModel } from '../src/features/reader/model/dashboard';
import type { ReaderTab } from '../src/features/reader/model/tabs';

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
    const library = {
      surface: 'all',
      regionId: 'english',
      regions: [{ id: 'english', label: 'English' }],
      items: [
        makeCatalogItem({
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
        }),
      ],
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
        recentlyImported: [],
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
    expect(markup).toContain('aria-label="Search reader catalog"');
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
});

describe('reader utility tray', () => {
  it('renders managed tabs with real panel relationships', () => {
    const tabs: ReaderTab[] = ['read', 'voices', 'cast', 'text', 'translate'];
    const markup = renderToStaticMarkup(
      <ReaderUtilityTray
        mode="novel"
        tabs={tabs}
        activeTab="voices"
        tabBadges={{
          voices: 'Multi-speaker',
          cast: '2 unassigned',
          text: 'Needs review',
          translate: 'Target: HI',
        }}
        sourceLanguage="en"
        targetLanguage="hi"
        playbackLanguage="en"
        translationPreview="Translated sample"
        translationSupported
        multiSpeakerEnabled
        narratorVoiceId="v1"
        speed={1}
        ambiencePreset="studio"
        stylePreset="default"
        voiceOptions={voiceOptions}
        detectedSpeakers={['Alice', 'Bob']}
        castDraft={{ Alice: 'v1' }}
        textDraft="Draft text"
        activeText="Active text"
        textDirty
        onChangeTab={noOp}
        onToggleMultiSpeaker={noOp}
        onNarratorVoiceChange={noOp}
        onSpeedChange={noOp}
        onAmbiencePresetChange={noOp}
        onStylePresetChange={noOp}
        onCastDraftChange={noOp}
        onTextDraftChange={noOp}
        onApplyTextEdit={noOp}
        onResetTextEdit={noOp}
        onSourceLanguageChange={noOp}
        onTargetLanguageChange={noOp}
        onPlaybackLanguageChange={noOp}
      />
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Reader utility tabs"');
    expect(markup).toContain('id="reader-utility-tab-voices"');
    expect(markup).toContain('aria-controls="reader-utility-panel-voices"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('role="tabpanel"');
    expect((markup.match(/role="tabpanel"/g) || []).length).toBe(tabs.length);
    expect((markup.match(/hidden=""/g) || []).length).toBe(tabs.length - 1);
  });
});
