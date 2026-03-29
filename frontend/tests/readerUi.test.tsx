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
        libraryErrorMessage=""
        onChangeHomeTab={noOp}
        onChangeSearchTerm={noOp}
        onSelectItem={noOp}
        onOpenItem={noOp}
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
    expect(markup).toContain('Reader Dashboard');
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
