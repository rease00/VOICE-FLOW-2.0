export type ReaderResolvedTheme = 'light' | 'dark';
export type ReaderViewMode = 'grid' | 'list';
export type ReaderProgressFilter = 'all' | 'in_progress' | 'ready' | 'new';
export type ReaderContentFilter = 'all' | 'book' | 'comic';
export type ReaderAutoAdvanceProfile = 'off' | 'audio_sync' | 'slow' | 'medium' | 'fast';
export type UploadContentType = 'auto' | 'book' | 'comic';
export type ReaderPanelSection = 'library' | 'tools' | 'audit';

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
