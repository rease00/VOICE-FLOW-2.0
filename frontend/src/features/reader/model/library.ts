import type { ReaderCatalogItem, ReaderLibrary } from '../../../../types';
import type { ReaderHomeTab } from './tabs';
import { READER_HOME_TABS } from './tabs';

export const HOME_TAB_ORDER: ReaderHomeTab[] = [...READER_HOME_TABS];

const asLower = (value: string | undefined): string =>
  String(value || '').trim().toLowerCase();

const matchesSearch = (item: ReaderCatalogItem, searchTerm: string): boolean => {
  const query = asLower(searchTerm);
  if (!query) return true;
  const haystack = [
    item.title,
    item.author,
    item.summary,
    item.provider,
    item.collectionLabel,
  ].map((value) => asLower(value)).join(' ');
  return haystack.includes(query);
};

export const resolveHomeTabItems = (
  library: ReaderLibrary | null,
  tab: ReaderHomeTab,
  searchTerm: string
): ReaderCatalogItem[] => {
  const items = (library?.items || []).filter((item) => matchesSearch(item, searchTerm));
  if (tab === 'novels') {
    return items.filter((item) => item.contentKind === 'book' && item.surface !== 'uploads');
  }
  if (tab === 'comics') {
    return items.filter((item) => item.contentKind === 'comic' && item.surface !== 'uploads');
  }
  if (tab === 'library') {
    return items.filter((item) => Boolean(item.sessionId || item.resume?.hasProgress));
  }
  return items.filter((item) => item.surface === 'uploads');
};

export const sortReaderItems = (items: ReaderCatalogItem[]): ReaderCatalogItem[] => (
  [...items].sort((left, right) => {
    const rightScore = Number(right.resume?.progressPct || 0) + (right.sessionId ? 20 : 0);
    const leftScore = Number(left.resume?.progressPct || 0) + (left.sessionId ? 20 : 0);
    if (rightScore !== leftScore) return rightScore - leftScore;
    return String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || ''));
  })
);

export const isImportedItem = (item: ReaderCatalogItem | null | undefined): boolean =>
  String(item?.surface || '').trim().toLowerCase() === 'uploads';

export const isLowConfidenceItem = (item: ReaderCatalogItem | null | undefined): boolean => {
  const prep = asLower(item?.prep?.state);
  const readiness = asLower(item?.readiness?.state);
  if (prep === 'error' || prep === 'degraded') return true;
  if (readiness === 'blocked') return true;
  const reason = asLower(item?.readiness?.reason);
  return reason.includes('confidence') || reason.includes('review');
};

export const resolveImportedStatusBadge = (item: ReaderCatalogItem): string => {
  const prepState = asLower(item.prep?.state);
  const readinessState = asLower(item.readiness?.state);
  if (prepState === 'queued' || prepState === 'running') return 'Processing';
  if (isLowConfidenceItem(item)) return 'Needs Review';
  if (readinessState === 'ready') return 'Ready To Play';
  if (item.contentKind === 'comic') return 'Text Detected';
  return 'Text Ready';
};
