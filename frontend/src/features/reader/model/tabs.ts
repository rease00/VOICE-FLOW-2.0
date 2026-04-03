export type ReaderMode = 'novel' | 'comic';
export type ReaderTab = 'read' | 'panels' | 'settings' | 'scripts' | 'saved';
export const READER_HOME_TABS = ['novels', 'library', 'imported'] as const;
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

const LEGACY_TAB_ALIASES: Record<string, ReaderTab> = {
  voices: 'settings',
  cast: 'settings',
  text: 'scripts',
  translate: 'settings',
  savedaudio: 'saved',
  'saved-audio': 'saved',
};

const normalizeLang = (value: string | undefined): string =>
  String(value || '').trim().toLowerCase();

const READER_HOME_TAB_LABELS: Record<ReaderHomeTab, string> = {
  novels: 'Novels',
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

export const normalizeReaderTabToken = (requestedTab: string | null | undefined): ReaderTab | null => {
  const token = String(requestedTab || '').trim().toLowerCase();
  if (!token) return null;
  if (token === 'read' || token === 'panels' || token === 'settings' || token === 'scripts' || token === 'saved') {
    return token;
  }
  return LEGACY_TAB_ALIASES[token] || null;
};

export const getReaderTabs = (input: ReaderTabAvailabilityInput): ReaderTab[] => {
  return input.mode === 'novel'
    ? ['read', 'settings', 'scripts', 'saved']
    : ['panels', 'settings', 'scripts', 'saved'];
};

export const getReaderTabLabel = (tab: ReaderTab): string => {
  if (tab === 'read') return 'Read';
  if (tab === 'panels') return 'Panels';
  if (tab === 'settings') return 'Settings';
  if (tab === 'scripts') return 'Scripts';
  return 'Saved Audio';
};

export const coerceReaderTab = (
  requestedTab: string | null | undefined,
  availableTabs: ReaderTab[],
  mode: ReaderMode
): ReaderTab => {
  const token = normalizeReaderTabToken(requestedTab);
  if (token && availableTabs.includes(token)) return token;
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
    ? 'scripts'
    : input.lowConfidence
      ? 'scripts'
      : 'read';
  if (input.availableTabs.includes(preferred)) return preferred;
  return input.availableTabs[0] || getReaderPrimaryTab(input.mode);
};
