export type ReaderResolvedTheme = 'light' | 'dark';
export type ReaderViewMode = 'grid' | 'list';
export type ReaderProgressFilter = 'all' | 'in_progress' | 'ready' | 'new';
export type ReaderContentFilter = 'all' | 'book' | 'comic';
export type ReaderAutoAdvanceProfile = 'off' | 'audio_sync' | 'slow' | 'medium' | 'fast';
export type ReaderAudioEngine = 'tts_hd' | 'native_audio_dialog';
export type UploadContentType = 'auto' | 'book' | 'comic';
export type ReaderPanelSection = 'library' | 'tools' | 'audit';
export type ReaderUtilityPanel = 'import' | 'settings' | 'translator' | 'detected' | 'cast';
export type ReaderUtilityPanelScope = 'all' | 'translator_only';

export const getReaderAvailableUtilityPanels = (hasSession: boolean): ReaderUtilityPanel[] => (
  hasSession
    ? ['import', 'settings', 'translator', 'detected', 'cast']
    : ['import', 'settings', 'translator']
);

export const isReaderUtilityPanelAvailable = (
  panel: ReaderUtilityPanel,
  hasSession: boolean
): boolean => getReaderAvailableUtilityPanels(hasSession).includes(panel);

export interface PlaylistItem {
  key: string;
  kind: 'window' | 'panel';
  jobId: string;
  title: string;
  text: string;
  url: string;
  startChar?: number;
  endChar?: number;
  charCount?: number;
  panelIndex?: number;
  imageUrl?: string;
}
