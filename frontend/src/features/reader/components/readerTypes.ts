import type { ReaderTab } from '../model/tabs';

export type { ReaderHomeTab } from '../model/tabs';

export type ReaderResolvedTheme = 'light' | 'dark';

export interface ReaderRestoreEntry {
  lastReaderTab: ReaderTab;
  lastChapter?: number;
  lastEpisode?: number;
  lastScrollPosition: number;
  jobId?: string;
  updatedAt: number;
}

export type ReaderRestoreStore = Record<string, ReaderRestoreEntry>;

export interface ReaderTabBadgeMap {
  settings?: string;
  scripts?: string;
  saved?: string;
}
