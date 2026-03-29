import { describe, expect, it } from 'vitest';
import type { ReaderCatalogItem, ReaderLibrary } from '../types';
import { resolveHomeTabItems, resolveImportedStatusBadge } from '../src/features/reader/model/library';

const createItem = (overrides: Partial<ReaderCatalogItem>): ReaderCatalogItem => ({
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

const createLibrary = (): ReaderLibrary => ({
  surface: 'all',
  regionId: 'english',
  regions: [{ id: 'english', label: 'English' }],
  items: [
    createItem({ id: 'novel-1', title: 'Novel One', contentKind: 'book', surface: 'books' }),
    createItem({ id: 'comic-1', title: 'Comic One', contentKind: 'comic', surface: 'comics' }),
    createItem({ id: 'resume-1', title: 'Resume Item', contentKind: 'book', surface: 'books', sessionId: 'session-1' }),
    createItem({ id: 'import-1', title: 'Import Item', contentKind: 'comic', surface: 'uploads', prep: { state: 'running', stage: 'ocr', completedItems: 2, totalItems: 8, failedItems: 0 } }),
  ],
  counts: { all: 4, visible: 4, books: 2, comics: 1, uploads: 1, resumable: 1 },
  facets: { providers: [], collections: [], progressStates: [] },
  shelves: { continueReading: [], trending: [], newArrivals: [], recentlyImported: [] },
  activeSession: null,
  activeSessions: [],
});

describe('reader home model', () => {
  it('filters content per home tab', () => {
    const library = createLibrary();
    expect(resolveHomeTabItems(library, 'novels', '').map((item) => item.id)).toEqual(['novel-1', 'resume-1']);
    expect(resolveHomeTabItems(library, 'library', '').map((item) => item.id)).toEqual(['resume-1']);
    expect(resolveHomeTabItems(library, 'imported', '').map((item) => item.id)).toEqual(['import-1']);
  });

  it('returns imported status badge labels', () => {
    const processing = createItem({
      id: 'import-processing',
      surface: 'uploads',
      prep: { state: 'running', stage: 'ocr', completedItems: 1, totalItems: 8, failedItems: 0 },
    });
    const ready = createItem({
      id: 'import-ready',
      surface: 'uploads',
      readiness: { state: 'ready', label: 'Ready', playableItems: 1 },
    });
    const review = createItem({
      id: 'import-review',
      surface: 'uploads',
      prep: { state: 'degraded', stage: 'ocr', completedItems: 6, totalItems: 8, failedItems: 2 },
    });
    expect(resolveImportedStatusBadge(processing)).toBe('Processing');
    expect(resolveImportedStatusBadge(ready)).toBe('Ready To Play');
    expect(resolveImportedStatusBadge(review)).toBe('Needs Review');
  });
});
