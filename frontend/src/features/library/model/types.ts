// Library feature types — ported from Lumina Library, adapted for voice-Flow + Firestore

export interface Author {
  name: string;
  birth_year?: number | null;
  death_year?: number | null;
}

export interface BookFormat {
  [mimeType: string]: string;
}

export interface Book {
  id: string | number;
  title: string;
  authors: Author[];
  translators: Author[];
  subjects: string[];
  bookshelves: string[];
  languages: string[];
  copyright: boolean | null;
  media_type: string;
  formats: BookFormat;
  download_count: number;
  source?: 'gutenberg' | 'openlibrary' | 'published';
  description?: string;
  /** Firestore-published fields (only present for source='published') */
  authorId?: string;
  coverUrl?: string;
  genre?: string;
  vnPrice?: number;
  publishedAt?: string;
}

export interface GutendexResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Book[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface AudioChunk {
  id: string;
  bookId: string | number;
  chunkIndex: number;
  text: string;
  audioBlob?: Blob;
  duration: number;
  cached: boolean;
  timestamp: number;
}

export interface PlaybackState {
  bookId: string | number;
  currentChunkIndex: number;
  currentTime: number;
  isPlaying: boolean;
  isPreloading: boolean;
  totalChunks: number;
  chunkDuration?: number;
}

export type TtsEngine = 'gemini-native' | 'neural2';
export type SpeakerMode = 'single' | 'multi';

export interface SpeakerConfig {
  name: string;
  voice: string;
  inferredGender?: 'male' | 'female' | 'neutral' | undefined;
  inferredAge?: 'young' | 'adult' | 'elderly' | undefined;
}

export interface TtsSettings {
  engine: TtsEngine;
  voice: string;
  speed: number;
  pitch: number;
  language: string;
  speakerMode: SpeakerMode;
  speakerConfigs: SpeakerConfig[];
}

export interface AmbianceTrack {
  id: string;
  name: string;
  category: 'nature' | 'cafe' | 'ambient';
  url: string;
  duration: number;
  volume: number;
}

export interface DockState {
  isMinimized: boolean;
  currentView: 'player' | 'tts' | 'ambiance' | 'script' | 'speaker';
}

export interface SavedBook {
  id: string | number;
  bookId: string | number;
  title: string;
  author: string;
  cover?: string;
  textContent: string;
  audioChunks: AudioChunk[];
  savedAt: number;
  totalSize: number;
  playbackPosition: PlaybackState;
}

export interface StorageQuota {
  used: number;
  limit: number;
  percentage: number;
  booksCount: number;
  maxBooks: number;
}

export interface CacheConfig {
  bookId: string | number;
  chunkIndex: number;
  settingsHash: string;
}

export interface ReaderChapter {
  index: number;
  title: string;
  start: number;
  end: number;
  text: string;
}

export interface ChapterComment {
  id: string;
  bookId: string;
  chapterIndex: number;
  chapterTitle: string;
  body: string;
  userId: string | null;
  userLabel: string;
  createdAt: string;
}

export interface LastPlayedRecord {
  id: string;
  userId: string | null;
  bookId: string;
  chapterIndex: number;
  chapterTitle: string;
  progressPercent: number;
  currentTime: number;
  updatedAt: string;
  book: Book;
}

export type LibraryViewState =
  | 'BROWSE'
  | 'SEARCH'
  | 'BOOK_DETAIL'
  | 'FAVORITES'
  | 'AI_CHAT'
  | 'READ';

export type LanguageCode = 'en' | 'all';
