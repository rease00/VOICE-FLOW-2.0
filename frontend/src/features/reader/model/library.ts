import type { ReaderCatalogItem, ReaderSession } from '../../../../types';

export type ReaderSurfaceFilter = 'all' | 'books' | 'comics' | 'uploads';
export type ReaderProgressFilter = 'all' | 'in_progress' | 'ready' | 'new';
export type ReaderSortOption = 'featured' | 'resume' | 'title' | 'newest';

export interface ReaderLibraryFilters {
  surface: ReaderSurfaceFilter;
  search: string;
  provider: string;
  contentKind: 'all' | 'book' | 'comic';
  progress: ReaderProgressFilter;
  collection: string;
  sort: ReaderSortOption;
}

export interface ReaderPrimaryAction {
  label: string;
  intent: 'resume' | 'prepare' | 'play' | 'blocked';
  disabled: boolean;
}

const matchesProgressFilter = (item: ReaderCatalogItem, progress: ReaderProgressFilter): boolean => {
  if (progress === 'all') return true;
  const resume = item.resume;
  const readinessState = item.readiness?.state || '';
  if (progress === 'in_progress') return Boolean(resume?.hasProgress);
  if (progress === 'ready') return Boolean(item.sessionId) && readinessState === 'ready';
  return !resume?.hasProgress && !item.sessionId;
};

export const filterReaderLibraryItems = (
  items: ReaderCatalogItem[],
  filters: ReaderLibraryFilters
): ReaderCatalogItem[] => {
  const query = filters.search.trim().toLowerCase();
  return [...items]
    .filter((item) => (filters.surface === 'all' ? true : item.surface === filters.surface))
    .filter((item) => (filters.provider === 'all' ? true : item.provider === filters.provider))
    .filter((item) => (filters.collection === 'all' ? true : item.collectionLabel === filters.collection))
    .filter((item) => (filters.contentKind === 'all' ? true : item.contentKind === filters.contentKind))
    .filter((item) => matchesProgressFilter(item, filters.progress))
    .filter((item) => {
      if (!query) return true;
      return `${item.title} ${item.author} ${item.summary || ''} ${item.provider} ${item.collectionLabel || ''}`.toLowerCase().includes(query);
    })
    .sort((left, right) => {
      if (filters.sort === 'title') return left.title.localeCompare(right.title);
      if (filters.sort === 'newest') {
        return String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || ''));
      }
      if (filters.sort === 'resume') {
        return Number(right.resume?.progressPct || 0) - Number(left.resume?.progressPct || 0);
      }
      const rightScore = Number(right.resume?.progressPct || 0) + (right.sessionId ? 15 : 0) + (right.readiness?.state === 'ready' ? 10 : 0);
      const leftScore = Number(left.resume?.progressPct || 0) + (left.sessionId ? 15 : 0) + (left.readiness?.state === 'ready' ? 10 : 0);
      return rightScore - leftScore;
    });
};

export const getReaderPrimaryAction = (item: ReaderCatalogItem): ReaderPrimaryAction => {
  const commercialStatus = String(item.commercialUseStatus || '').trim().toLowerCase();
  if (commercialStatus === 'blocked') {
    return { label: 'Blocked', intent: 'blocked', disabled: true };
  }
  if (commercialStatus === 'review') {
    return { label: 'Needs Review', intent: 'blocked', disabled: true };
  }
  const prepState = String(item.prep?.state || '').trim().toLowerCase();
  const hasPrepError = prepState === 'error';
  if (item.readiness?.state === 'blocked' && (hasPrepError || (!item.supportsReadHere && item.surface !== 'uploads' && !item.sessionId))) {
    return { label: 'Unavailable', intent: 'blocked', disabled: true };
  }
  if (item.sessionId && item.resume?.hasProgress) {
    return { label: 'Resume', intent: 'resume', disabled: false };
  }
  if (item.sessionId && item.readiness?.state === 'ready') {
    return { label: 'Play', intent: 'play', disabled: false };
  }
  if (item.supportsReadHere || item.surface === 'uploads' || item.sessionId) {
    return { label: 'Prepare', intent: 'prepare', disabled: false };
  }
  if (hasPrepError || item.readiness?.state === 'blocked') {
    return { label: 'Unavailable', intent: 'blocked', disabled: true };
  }
  return { label: 'Unavailable', intent: 'blocked', disabled: true };
};

export const isReaderAutoSwipeAvailable = (session: ReaderSession | null | undefined): boolean =>
  Boolean(session && session.contentKind === 'comic');

export const getReaderAutoAdvanceDelay = (profile: string | null | undefined): number | null => {
  const safe = String(profile || '').trim().toLowerCase();
  if (safe === 'slow') return 9000;
  if (safe === 'medium') return 6500;
  if (safe === 'fast') return 4000;
  return null;
};
