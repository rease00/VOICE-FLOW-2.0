import { describe, expect, it } from 'vitest';
import type { ReaderCatalogItem, ReaderLibrary } from '../types';
import {
  buildReaderDashboardPayloadFromLibrary,
  normalizeReaderDashboardPayload,
  resolveReaderHomeViewModel,
} from '../src/features/reader/model/dashboard';

const createItem = (overrides: Partial<ReaderCatalogItem> = {}): ReaderCatalogItem => ({
  id: overrides.id || 'item-1',
  title: overrides.title || 'Demo title',
  author: overrides.author || 'Demo author',
  regionId: overrides.regionId || 'english',
  contentKind: overrides.contentKind || 'book',
  surface: overrides.surface || 'books',
  provider: overrides.provider || 'source',
  license: overrides.license || 'license',
  ...overrides,
});

const createLibrary = (): ReaderLibrary => {
  const resume = createItem({
    id: 'resume-1',
    title: 'Resume One',
    contentKind: 'book',
    surface: 'books',
    sessionId: 'session-1',
    resume: { hasProgress: true, consumedChars: 240, currentPanelIndex: 0, progressPct: 60 },
  });
  const comic = createItem({ id: 'comic-1', title: 'Comic One', contentKind: 'comic', surface: 'comics' });
  const importItem = createItem({ id: 'import-1', title: 'Import One', surface: 'uploads' });

  return {
    surface: 'all',
    regionId: 'english',
    regions: [{ id: 'english', label: 'English' }],
    items: [resume, comic, importItem],
    activeSession: null,
    activeSessions: [],
    counts: {
      all: 3,
      visible: 3,
      books: 1,
      comics: 1,
      uploads: 1,
      resumable: 1,
    },
    facets: { providers: [], collections: [], progressStates: [] },
    shelves: {
      continueReading: [resume],
      trending: [comic],
      newArrivals: [createItem({ id: 'new-1', title: 'New One' })],
      recentlyImported: [importItem],
    },
  };
};

describe('reader dashboard model', () => {
  it('builds a dashboard payload from a library fallback', () => {
    const library = createLibrary();
    const dashboard = buildReaderDashboardPayloadFromLibrary(library);

    expect(dashboard.library.items).toHaveLength(3);
    expect(dashboard.spotlight?.id).toBe('resume-1');
    expect(dashboard.highlights.library).toBe(3);
    expect(dashboard.shelves.recentlyImported[0]?.id).toBe('import-1');
  });

  it('normalizes dashboard payloads from wrapped api responses', () => {
    const library = createLibrary();
    const payload = normalizeReaderDashboardPayload({
      dashboard: {
        library,
        mission: {
          title: 'Play any novel, manga, or comic with AI TTS',
          subtitle: 'Jump back into active sessions.',
          ctaText: 'Open your library and press Play',
        },
        highlights: {
          library: 3,
          resumable: 1,
          uploads: 1,
          comics: 1,
          books: 1,
        },
        spotlight: library.items[0],
        shelves: library.shelves,
        activeSessionSummary: null,
        blockedProviders: ['blocked-source'],
      },
    });

    expect(payload?.library.items).toHaveLength(3);
    expect(payload?.shelves.continueReading[0]?.id).toBe('resume-1');
    expect(payload?.blockedProviders).toEqual(['blocked-source']);
  });

  it('builds a home view model with section counts and spotlight priority', () => {
    const dashboard = buildReaderDashboardPayloadFromLibrary(createLibrary());
    const viewModel = resolveReaderHomeViewModel(dashboard, 'library', '');

    expect(viewModel.spotlight?.id).toBe('resume-1');
    expect(Object.keys(viewModel.tabCounts)).toEqual(['novels', 'library', 'imported']);
    expect(viewModel.tabCounts.library).toBe(1);
    expect(viewModel.sections[0]?.id).toBe('continueReading');
    expect(viewModel.sections[0]?.items[0]?.id).toBe('resume-1');
  });

  it('keeps continue reading inside the library tab and filters empty sections out of home rails', () => {
    const dashboard = buildReaderDashboardPayloadFromLibrary(createLibrary());
    const novelsView = resolveReaderHomeViewModel(dashboard, 'novels', '');
    const libraryView = resolveReaderHomeViewModel(dashboard, 'library', '');
    const emptyDashboard = buildReaderDashboardPayloadFromLibrary({
      ...createLibrary(),
      shelves: {
        continueReading: [],
        trending: [],
        newArrivals: [],
        recentlyImported: [],
      },
    });
    const emptyView = resolveReaderHomeViewModel(emptyDashboard, 'novels', '');

    expect(novelsView.sections.map((section) => section.id)).toEqual(['newArrivals']);
    expect(libraryView.sections.map((section) => section.id)).toContain('continueReading');
    expect(emptyView.sections).toEqual([]);
  });
});
