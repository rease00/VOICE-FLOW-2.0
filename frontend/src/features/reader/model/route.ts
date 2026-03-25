import type { ReaderMode, ReaderTab } from './tabs';

export interface ReaderDeepLinkState {
  mode: ReaderMode;
  titleId: string;
  tab?: ReaderTab;
  chapter?: number;
  episode?: number;
}

const LEGACY_KEYS = {
  mode: 'vf-reader-mode',
  item: 'vf-reader-item',
  tab: 'vf-reader-tab',
  chapter: 'vf-reader-chapter',
  episode: 'vf-reader-episode',
} as const;

const normalizeMode = (value: string | null | undefined): ReaderMode | null => {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'novel' || token === 'book') return 'novel';
  if (token === 'comic' || token === 'manga') return 'comic';
  return null;
};

const normalizeTab = (value: string | null | undefined): ReaderTab | null => {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'read' || token === 'panels' || token === 'voices' || token === 'cast' || token === 'text' || token === 'translate') {
    return token;
  }
  return null;
};

const normalizePositiveInt = (value: string | null | undefined): number | undefined => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
};

export const isReaderPath = (pathname: string): boolean => {
  const normalized = String(pathname || '').trim().toLowerCase();
  return normalized === '/reader' || normalized.startsWith('/reader/');
};

export const parseReaderDeepLink = (pathname: string, search: string): ReaderDeepLinkState | null => {
  const params = new URLSearchParams(search || '');
  const segments = String(pathname || '')
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .filter(Boolean);

  const pathMode = normalizeMode(segments[1]);
  const pathTitleId = segments.length >= 3 ? String(segments[2] || '').trim() : '';
  const legacyMode = normalizeMode(params.get(LEGACY_KEYS.mode));
  const legacyTitleId = String(params.get(LEGACY_KEYS.item) || params.get('vf-reader-title') || '').trim();

  const mode = pathMode || legacyMode;
  const titleId = pathTitleId || legacyTitleId;
  if (!mode || !titleId) return null;

  const tab = normalizeTab(params.get('tab')) || normalizeTab(params.get(LEGACY_KEYS.tab)) || undefined;
  const chapter = normalizePositiveInt(params.get('chapter')) || normalizePositiveInt(params.get(LEGACY_KEYS.chapter));
  const episode = normalizePositiveInt(params.get('episode')) || normalizePositiveInt(params.get(LEGACY_KEYS.episode));

  return {
    mode,
    titleId,
    ...(tab ? { tab } : {}),
    ...(chapter ? { chapter } : {}),
    ...(episode ? { episode } : {}),
  };
};

export const buildReaderDeepLink = (
  state: ReaderDeepLinkState,
  currentHref: string
): string => {
  const url = new URL(currentHref);
  const params = new URLSearchParams(url.search);
  const modeToken = state.mode === 'novel' ? 'novel' : 'comic';
  const encodedTitleId = encodeURIComponent(String(state.titleId).trim());
  url.pathname = `/reader/${modeToken}/${encodedTitleId}`;

  const readerQueryKeys = [
    'tab',
    'chapter',
    'episode',
    LEGACY_KEYS.mode,
    LEGACY_KEYS.item,
    LEGACY_KEYS.tab,
    LEGACY_KEYS.chapter,
    LEGACY_KEYS.episode,
    'vf-reader-title',
  ];
  readerQueryKeys.forEach((key) => params.delete(key));

  params.set(LEGACY_KEYS.mode, modeToken);
  params.set(LEGACY_KEYS.item, String(state.titleId));
  params.set('vf-reader-title', String(state.titleId));

  if (state.tab) {
    params.set('tab', state.tab);
    params.set(LEGACY_KEYS.tab, state.tab);
  }
  if (state.mode === 'novel' && state.chapter) {
    params.set('chapter', String(state.chapter));
    params.set(LEGACY_KEYS.chapter, String(state.chapter));
  }
  if (state.mode === 'comic' && state.episode) {
    params.set('episode', String(state.episode));
    params.set(LEGACY_KEYS.episode, String(state.episode));
  }

  url.search = params.toString() ? `?${params.toString()}` : '';
  return `${url.pathname}${url.search}${url.hash}`;
};
