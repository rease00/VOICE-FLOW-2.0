export type ReaderMode = 'novel' | 'comic';
export type ReaderTab = 'read' | 'panels' | 'voices' | 'cast' | 'text' | 'translate';
export const READER_HOME_TABS = ['novels', 'comics', 'library', 'imported'] as const;
export type ReaderHomeTab = (typeof READER_HOME_TABS)[number];
export type ReaderHomeTabCounts = Record<ReaderHomeTab, number>;

export interface ReaderTabAvailabilityInput {
  mode: ReaderMode;
  multiSpeakerEnabled: boolean;
  speakerCount: number;
  translationSupported: boolean;
  sourceLanguage?: string;
  playbackLanguage?: string;
}

const normalizeLang = (value: string | undefined): string =>
  String(value || '').trim().toLowerCase();

const READER_HOME_TAB_LABELS: Record<ReaderHomeTab, string> = {
  novels: 'Novels',
  comics: 'Comics',
  library: 'Library',
  imported: 'Imported',
};

export const getReaderHomeTabLabel = (tab: ReaderHomeTab): string =>
  READER_HOME_TAB_LABELS[tab] || READER_HOME_TAB_LABELS.novels;

export const coerceReaderHomeTab = (
  requestedTab: string | null | undefined,
  fallback: ReaderHomeTab = 'novels'
): ReaderHomeTab => {
  const token = String(requestedTab || '').trim().toLowerCase() as ReaderHomeTab;
  return READER_HOME_TABS.includes(token) ? token : fallback;
};

export const getReaderPrimaryTab = (mode: ReaderMode): ReaderTab =>
  mode === 'novel' ? 'read' : 'panels';

export const shouldShowCastTab = (input: Pick<ReaderTabAvailabilityInput, 'multiSpeakerEnabled' | 'speakerCount'>): boolean =>
  input.multiSpeakerEnabled && Math.max(0, Number(input.speakerCount || 0)) >= 2;

export const shouldShowTranslateTab = (input: Pick<ReaderTabAvailabilityInput, 'translationSupported' | 'sourceLanguage' | 'playbackLanguage'>): boolean => {
  if (input.translationSupported) return true;
  const source = normalizeLang(input.sourceLanguage);
  const playback = normalizeLang(input.playbackLanguage);
  if (!source || !playback) return false;
  return source !== playback;
};

export const getReaderTabs = (input: ReaderTabAvailabilityInput): ReaderTab[] => {
  const tabs: ReaderTab[] = input.mode === 'novel'
    ? ['read', 'voices', 'text']
    : ['panels', 'voices', 'text'];

  if (shouldShowCastTab(input)) {
    tabs.push('cast');
  }
  if (shouldShowTranslateTab(input)) {
    tabs.push('translate');
  }

  // Enforce requested order exactly.
  const orderNovel: ReaderTab[] = ['read', 'voices', 'cast', 'text', 'translate'];
  const orderComic: ReaderTab[] = ['panels', 'voices', 'cast', 'text', 'translate'];
  const order = input.mode === 'novel' ? orderNovel : orderComic;
  return order.filter((tab) => tabs.includes(tab));
};

export const getReaderTabLabel = (tab: ReaderTab): string => {
  if (tab === 'read') return 'Read';
  if (tab === 'panels') return 'Panels';
  if (tab === 'voices') return 'Voices';
  if (tab === 'cast') return 'Cast';
  if (tab === 'text') return 'Text';
  return 'Translate';
};

export const coerceReaderTab = (
  requestedTab: string | null | undefined,
  availableTabs: ReaderTab[],
  mode: ReaderMode
): ReaderTab => {
  const token = String(requestedTab || '').trim().toLowerCase() as ReaderTab;
  if (availableTabs.includes(token)) return token;
  return availableTabs[0] || getReaderPrimaryTab(mode);
};

export const resolveImportedDefaultTab = (input: {
  mode: ReaderMode;
  imported: boolean;
  lowConfidence: boolean;
  availableTabs: ReaderTab[];
}): ReaderTab => {
  if (!input.imported) return input.availableTabs[0] || getReaderPrimaryTab(input.mode);
  const preferred = input.mode === 'comic'
    ? 'text'
    : input.lowConfidence
      ? 'text'
      : 'read';
  if (input.availableTabs.includes(preferred)) return preferred;
  return input.availableTabs[0] || getReaderPrimaryTab(input.mode);
};
