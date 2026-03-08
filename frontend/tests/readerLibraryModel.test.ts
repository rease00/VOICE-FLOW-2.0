import { describe, expect, it } from 'vitest';
import type { ReaderCatalogItem } from '../types';
import {
  filterReaderLibraryItems,
  getReaderAutoAdvanceDelay,
  getReaderPrimaryAction,
  isReaderAutoSwipeAvailable,
  type ReaderLibraryFilters,
} from '../src/features/reader/model/library';

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

const defaultFilters: ReaderLibraryFilters = {
  surface: 'all',
  search: '',
  provider: 'all',
  contentKind: 'all',
  progress: 'all',
  collection: 'all',
  sort: 'featured',
};

describe('reader library model', () => {
  it('filters by progress state and provider', () => {
    const items = [
      buildItem({ id: 'resume', provider: 'internet_archive', resume: { hasProgress: true, consumedChars: 100, currentPanelIndex: 0, progressPct: 20 } }),
      buildItem({ id: 'ready', provider: 'open_library', sessionId: 'session-1', readiness: { state: 'ready', label: 'Ready', playableItems: 1 } }),
      buildItem({ id: 'new', provider: 'voiceflow_upload', surface: 'uploads', supportsReadHere: true }),
    ];
    const filtered = filterReaderLibraryItems(items, { ...defaultFilters, progress: 'in_progress', provider: 'internet_archive' });
    expect(filtered.map((item) => item.id)).toEqual(['resume']);
  });

  it('resolves CTA states for resume, play, prepare, and blocked items', () => {
    expect(getReaderPrimaryAction(buildItem({ sessionId: 'session-1', resume: { hasProgress: true, consumedChars: 20, currentPanelIndex: 0, progressPct: 10 } })).label).toBe('Resume');
    expect(getReaderPrimaryAction(buildItem({ sessionId: 'session-1', readiness: { state: 'ready', label: 'Ready', playableItems: 1 } })).label).toBe('Play');
    expect(getReaderPrimaryAction(buildItem({ surface: 'uploads', supportsReadHere: true })).label).toBe('Prepare');
    expect(getReaderPrimaryAction(buildItem({ supportsReadHere: false, readiness: { state: 'blocked', label: 'Blocked', playableItems: 0 } })).disabled).toBe(true);
  });

  it('keeps supported titles actionable during active prep and blocks only real prep errors', () => {
    expect(
      getReaderPrimaryAction(
        buildItem({
          contentKind: 'comic',
          surface: 'comics',
          supportsReadHere: true,
          sessionId: 'session-prep',
          readiness: { state: 'preparing', label: 'Preparing first playable item', playableItems: 0 },
          prep: { state: 'running', stage: 'ocr', completedItems: 1, totalItems: 8, failedItems: 0 },
        })
      ).label
    ).toBe('Prepare');

    expect(
      getReaderPrimaryAction(
        buildItem({
          contentKind: 'comic',
          surface: 'comics',
          supportsReadHere: true,
          sessionId: 'session-error',
          readiness: { state: 'blocked', label: 'Playback unavailable', playableItems: 0, reason: 'Remote comic preparation failed.' },
          prep: { state: 'error', stage: 'ocr', completedItems: 0, totalItems: 8, failedItems: 8, message: 'Remote comic preparation failed.' },
        })
      ).disabled
    ).toBe(true);
  });

  it('exposes auto-swipe only for comic sessions and maps timer profiles', () => {
    expect(isReaderAutoSwipeAvailable({ contentKind: 'comic' } as any)).toBe(true);
    expect(isReaderAutoSwipeAvailable({ contentKind: 'book' } as any)).toBe(false);
    expect(getReaderAutoAdvanceDelay('slow')).toBe(9000);
    expect(getReaderAutoAdvanceDelay('medium')).toBe(6500);
    expect(getReaderAutoAdvanceDelay('fast')).toBe(4000);
    expect(getReaderAutoAdvanceDelay('audio_sync')).toBeNull();
  });
});
