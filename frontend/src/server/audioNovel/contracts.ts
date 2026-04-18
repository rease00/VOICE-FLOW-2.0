import type { DomainJobStatus } from '../jobs/domainJobStore.ts';

export type AudioNovelEmotion =
  | 'narration'
  | 'angry'
  | 'sad'
  | 'excited'
  | 'whisper'
  | 'dramatic'
  | 'cold'
  | 'fearful'
  | 'happy'
  | 'sarcastic'
  | 'confused'
  | 'commanding'
  | 'gentle'
  | 'tense'
  | 'laugh';

export interface AudioNovelDialogueLine {
  speaker: string;
  emotion: AudioNovelEmotion;
  text: string;
  index: number;
}

export interface AudioNovelSpeakerRun {
  runIndex: number;
  speaker: string;
  voice: string;
  emotion: AudioNovelEmotion;
  mergedText: string;
  rawLines: string[];
  lineIndices: number[];
  firstLine: number;
  lastLine: number;
  charCount: number;
}

export interface AudioNovelRunSyncEntry {
  runIndex: number;
  speaker: string;
  voice: string;
  emotion: AudioNovelEmotion;
  lines: string[];
  firstLine: number;
  lastLine: number;
  startByte: number;
  endByte: number;
}

export interface AudioNovelChapterAudioReadyResponse {
  generated: true;
  audioUrl: string;
  syncUrl: string;
  source: 'r2' | 'generated';
  cacheStatus: 'hit' | 'generated';
  storage: 'r2';
  engine: 'VECTOR';
  runtimeLabel: string;
  persisted: true;
  hash: string;
  totalRuns: number;
  speakers: string[];
}

export interface AudioNovelChapterAudioMissingResponse {
  generated: false;
  source: 'missing';
  cacheStatus: 'missing';
  storage: 'r2';
  engine: 'VECTOR';
  runtimeLabel: string;
  persisted: false;
  hash: string;
  reason: 'not-generated';
}

export type AudioNovelChapterAudioResponse =
  | AudioNovelChapterAudioReadyResponse
  | AudioNovelChapterAudioMissingResponse;

export interface AudioNovelJobRequest {
  mode: 'novel';
  bookId: string;
  chapterId?: string | undefined;
  text: string;
  language?: string | undefined;
  targetLanguage?: string | undefined;
  voice?: string | undefined;
  engine?: string | undefined;
  style?: string | undefined;
  speed?: number | undefined;
  pitch?: number | undefined;
  speakerConfigs?: Array<{ speaker: string; voice: string }> | undefined;
}

export interface AudioNovelJobResponse {
  jobId: string;
  status: DomainJobStatus;
  cacheHit: boolean;
  result?: AudioNovelChapterAudioResponse | undefined;
  error?: string | undefined;
}

export interface AudioNovelLiveStartMessage {
  status: 'start';
  totalRuns: number;
  totalLines: number;
  mode: 'single' | 'multi';
  transport?: 'bidi' | 'run';
}

export interface AudioNovelLiveBufferingMessage {
  status: 'buffering';
  waitMs: number;
  reason?: string;
}

export interface AudioNovelLiveRunMetaMessage {
  type: 'run-meta';
  runIndex: number;
  total: number;
  speaker: string;
  voice: string;
  emotion: AudioNovelEmotion;
  lines: string[];
  firstLine: number;
  lastLine: number;
}

export interface AudioNovelLiveDoneMessage {
  done: true;
  totalRuns: number;
  durationMs: number;
}

export interface AudioNovelLiveErrorMessage {
  error: string;
  code?: string | undefined;
}

export type AudioNovelLiveServerMessage =
  | AudioNovelLiveStartMessage
  | AudioNovelLiveBufferingMessage
  | AudioNovelLiveRunMetaMessage
  | AudioNovelLiveDoneMessage
  | AudioNovelLiveErrorMessage;

export interface AudioNovelLiveClientMessage {
  type: 'stdio' | 'book' | 'pong';
  text?: string;
  bookId?: string;
  chapterId?: string;
  guestSessionId?: string;
  bookSource?: string;
}

export type ReaderNovelJobRequest = AudioNovelJobRequest;
export type ReaderNovelJobResponse = AudioNovelJobResponse;
