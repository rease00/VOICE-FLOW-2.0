import { describe, expect, it } from 'vitest';
import type { ReaderCatalogItem, ReaderSession } from '../types';
import { deriveReaderAuditModel } from '../src/features/reader/components/readerAudit';

const buildItem = (overrides: Partial<ReaderCatalogItem> = {}): ReaderCatalogItem => ({
  id: overrides.id || 'item-1',
  title: overrides.title || 'Reader Item',
  author: overrides.author || 'Author',
  regionId: overrides.regionId || 'english',
  contentKind: overrides.contentKind || 'book',
  surface: overrides.surface || 'books',
  provider: overrides.provider || 'internet_archive',
  license: overrides.license || 'Public domain',
  supportsReadHere: overrides.supportsReadHere ?? true,
  ...overrides,
});

const baseSession: ReaderSession = {
  id: 'session-1',
  title: 'Reader Session',
  contentKind: 'book',
  surface: 'books',
  regionId: 'english',
  direction: 'ltr',
  sourceLanguage: 'en',
  targetLanguage: 'es',
  pageViewMode: 'translated',
  ttsLanguageMode: 'target',
  multiSpeakerEnabled: true,
  effectiveMultiSpeakerMode: 'studio_pair_groups',
  translationState: 'ready',
  workKey: 'catalog:item-1',
  sourceKind: 'catalog',
  musicTrackId: 'm_none',
  castMemory: {},
  consumedChars: 120,
  totalChars: 1000,
  currentPanelIndex: 0,
  totalPanels: 0,
  progressPct: 12,
  cachedChars: 120,
  cacheLimitChars: 1000,
  deleteAtMs: 180000,
  warningActive: false,
  savepointDownloadUrl: '',
  billing: {
    vfPerChar: 1.5,
    rule: '1 char = 1.5 VF',
    label: 'Reader pricing: 1 char = 1.5 VF',
  },
  limits: {
    textWindowChars: 1000,
    prefetchThresholdChars: 500,
    panelBatchSize: 10,
    panelTriggerIndex: 5,
    deleteWarningMs: 180000,
  },
  windows: [],
  panels: [],
};

describe('reader audit derivation', () => {
  it('builds an idle audit for a selected catalog item', () => {
    const model = deriveReaderAuditModel({
      selectedItem: buildItem({
        summary: 'Shelf summary',
        readiness: { state: 'ready', label: 'Ready', playableItems: 2 },
        resume: { hasProgress: true, consumedChars: 200, currentPanelIndex: 0, progressPct: 40 },
        stats: { totalChars: 4000 },
      }),
      session: null,
      billingLabel: 'Reader pricing: 1 char = 1.5 VF',
      warningCountdown: '03:00',
      targetLanguageLabel: 'Spanish',
      pageViewModeLabel: 'Translated Page View',
      ttsLanguageModeLabel: 'Target (Spanish)',
      multiSpeakerLabel: 'Single narrator',
    });

    expect(model.headline).toBe('Reader Item');
    expect(model.metrics.map((metric) => metric.label)).toContain('Billing');
    expect(model.metrics.find((metric) => metric.label === 'Progress')?.value).toBe('40% complete');
    expect(model.rows[0]?.summary).toContain('Shelf summary');
  });

  it('builds a detailed book-session audit with warnings', () => {
    const model = deriveReaderAuditModel({
      selectedItem: buildItem(),
      session: {
        ...baseSession,
        warningActive: true,
        windows: [
          {
            index: 0,
            startChar: 0,
            endChar: 300,
            charCount: 300,
            displayText: 'Ready chunk',
            translationStatus: 'ready',
            estimatedReadMs: 7000,
            job: { status: 'completed' },
          },
          {
            index: 1,
            startChar: 301,
            endChar: 600,
            charCount: 300,
            displayText: 'Queued chunk',
            translationStatus: 'pending',
            estimatedReadMs: 8000,
            job: { status: 'queued' },
          },
        ],
      },
      billingLabel: 'Reader pricing: 1 char = 1.5 VF',
      warningCountdown: '02:10',
      targetLanguageLabel: 'Spanish',
      pageViewModeLabel: 'Translated Page View',
      ttsLanguageModeLabel: 'Target (Spanish)',
      multiSpeakerLabel: 'Studio grouped',
    });

    expect(model.alerts.some((alert) => alert.id === 'cache-warning')).toBe(true);
    expect(model.rows).toHaveLength(2);
    expect(model.rows[0]?.tone).toBe('success');
    expect(model.rows[1]?.tone).toBe('warning');
    expect(model.metrics.find((metric) => metric.label === 'Multi-Speaker')?.value).toBe('Studio grouped');
  });

  it('builds a comic-session audit with fallback alerts', () => {
    const model = deriveReaderAuditModel({
      selectedItem: buildItem({ contentKind: 'comic', surface: 'comics' }),
      session: {
        ...baseSession,
        title: 'Comic Session',
        contentKind: 'comic',
        surface: 'comics',
        totalPanels: 2,
        currentPanelIndex: 1,
        voiceFallbacks: {
          Hero: { requestedVoiceId: 'v_missing', resolvedVoiceId: 'v_safe', reason: 'fallback' },
        },
        prep: {
          state: 'degraded',
          stage: 'audio',
          completedItems: 1,
          totalItems: 2,
          failedItems: 1,
          message: '1 page failed during remote preparation.',
        },
        effectiveMultiSpeakerMode: 'line_map',
        panels: [
          {
            panelId: 'panel-1',
            pageId: 'page-1',
            index: 0,
            direction: 'ltr',
            text: 'Original panel text',
            translatedText: 'Translated panel text',
            displayText: 'Translated panel text',
            translationStatus: 'ready',
            emotion: 'tense',
            sfx: ['boom'],
            audioStatus: 'completed',
            audioJob: { status: 'completed' },
          },
          {
            panelId: 'panel-2',
            pageId: 'page-1',
            index: 1,
            direction: 'ltr',
            text: 'Second panel',
            translationStatus: 'pending',
            audioStatus: 'queued',
            audioJob: { status: 'queued' },
          },
        ],
        windows: [],
      },
      billingLabel: 'Reader pricing: 1 char = 1.5 VF',
      warningCountdown: '03:00',
      targetLanguageLabel: 'Japanese',
      pageViewModeLabel: 'Translated Page View',
      ttsLanguageModeLabel: 'Target (Japanese)',
      multiSpeakerLabel: 'Reader line map',
    });

    expect(model.headline).toBe('Comic Session');
    expect(model.alerts.some((alert) => alert.id === 'voice-fallbacks')).toBe(true);
    expect(model.alerts.some((alert) => alert.id === 'prep-degraded')).toBe(true);
    expect(model.metrics.find((metric) => metric.label === 'Preparation')?.value).toBe('1/2');
    expect(model.metrics.find((metric) => metric.label === 'Playable Coverage')?.value).toBe('1/2');
  });
});
