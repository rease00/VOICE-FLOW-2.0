import { describe, expect, it } from 'vitest';
import type { ReaderCatalogItem, ReaderLibrary } from '../types';
import { resolveHomeTabItems } from '../src/features/reader/model/library';

const buildItem = (overrides: Partial<ReaderCatalogItem> = {}): ReaderCatalogItem => ({
  id: overrides.id || 'item-1',
  title: overrides.title || 'Reader Item',
  author: overrides.author || 'Author',
  regionId: overrides.regionId || 'english',
  contentKind: overrides.contentKind || 'book',
  surface: overrides.surface || 'books',
  provider: overrides.provider || 'internet_archive',
  license: overrides.license || 'Public domain',
  ...overrides,
});

const buildLibrary = (items: ReaderCatalogItem[]): ReaderLibrary => ({
  surface: 'all',
  regionId: 'english',
  regions: [{ id: 'english', label: 'English' }],
  items,
  activeSession: null,
  activeSessions: [],
  counts: {
    all: items.length,
    visible: items.length,
    books: items.filter((item) => item.contentKind === 'book').length,
    comics: items.filter((item) => item.contentKind === 'comic').length,
    uploads: items.filter((item) => item.surface === 'uploads').length,
    resumable: items.filter((item) => Boolean(item.sessionId || item.resume?.hasProgress)).length,
  },
  facets: { providers: [], collections: [], progressStates: [] },
  shelves: { continueReading: [], trending: [], newArrivals: [], recentlyImported: [] },
});

describe('reader library model', () => {
  it('partitions content into home tabs', () => {
    const items = [
      buildItem({ id: 'book-1', contentKind: 'book', surface: 'books' }),
      buildItem({ id: 'comic-1', contentKind: 'comic', surface: 'comics' }),
      buildItem({ id: 'resume-1', contentKind: 'book', surface: 'books', sessionId: 'session-1' }),
      buildItem({ id: 'upload-1', contentKind: 'comic', surface: 'uploads' }),
    ];
    const library = buildLibrary(items);

    expect(resolveHomeTabItems(library, 'novels', '').map((item) => item.id)).toEqual(['book-1', 'resume-1']);
    expect(resolveHomeTabItems(library, 'comics', '').map((item) => item.id)).toEqual(['comic-1']);
    expect(resolveHomeTabItems(library, 'library', '').map((item) => item.id)).toEqual(['resume-1']);
    expect(resolveHomeTabItems(library, 'imported', '').map((item) => item.id)).toEqual(['upload-1']);
  });

  it('supports search filtering per tab', () => {
    const items = [
      buildItem({ id: 'book-1', title: 'Sky Novel', contentKind: 'book', surface: 'books' }),
      buildItem({ id: 'book-2', title: 'Forest Tales', contentKind: 'book', surface: 'books' }),
    ];
    const library = buildLibrary(items);
    expect(resolveHomeTabItems(library, 'novels', 'sky').map((item) => item.id)).toEqual(['book-1']);
  });
});
