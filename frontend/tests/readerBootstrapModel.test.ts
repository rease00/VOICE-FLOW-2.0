import { describe, expect, it } from 'vitest';
import type { ReaderLibrary, ReaderSession } from '../types';
import {
  isReaderBootstrapAuthError,
  resolveReaderBootstrapState,
  resolveReaderResumeSession,
} from '../src/features/reader/model/bootstrap';

const buildSession = (id: string): ReaderSession => ({
  id,
  title: `Session ${id}`,
  contentKind: 'book',
  surface: 'books',
  regionId: 'english',
  direction: 'ltr',
  sourceLanguage: 'en',
  targetLanguage: 'en',
  pageViewMode: 'original',
  ttsLanguageMode: 'source',
  multiSpeakerEnabled: false,
  translationState: 'ready',
  workKey: `catalog:${id}`,
  sourceKind: 'catalog',
  musicTrackId: 'm_none',
  castMemory: {},
  consumedChars: 0,
  totalChars: 1000,
  currentPanelIndex: 0,
  totalPanels: 0,
  progressPct: 0,
  cachedChars: 0,
  cacheLimitChars: 1000,
  deleteAtMs: Date.now() + 60_000,
  warningActive: false,
  savepointDownloadUrl: '',
  billing: {
    vfPerChar: 1.0,
    rule: '1 char = 1 VF',
    label: 'Reader pricing: 1 char = 1 VF',
  },
  limits: {
    textWindowChars: 1500,
    prefetchThresholdChars: 1000,
    panelBatchSize: 10,
    panelTriggerIndex: 5,
    deleteWarningMs: 180000,
  },
  windows: [],
  panels: [],
});

const buildLibrary = (): ReaderLibrary => ({
  surface: 'all',
  regionId: 'english',
  regions: [{ id: 'english', label: 'English' }],
  items: [],
  activeSession: buildSession('primary'),
  activeSessions: [buildSession('primary'), buildSession('secondary')],
  counts: {
    all: 0,
    visible: 0,
    books: 0,
    comics: 0,
    uploads: 0,
    resumable: 1,
  },
  facets: {
    providers: [],
    collections: [],
    progressStates: [],
  },
  shelves: {
    continueReading: [],
    trending: [],
    newArrivals: [],
    recentlyImported: [],
  },
});

describe('reader bootstrap model', () => {
  it('classifies auth errors and bootstrap state', () => {
    expect(isReaderBootstrapAuthError({ status: 401, message: 'blocked' })).toBe(true);
    expect(resolveReaderBootstrapState({ library: buildLibrary() })).toBe('ready');
    expect(resolveReaderBootstrapState({ library: null, libraryError: new Error('Authentication required.') })).toBe('needs_auth');
    expect(resolveReaderBootstrapState({ library: null, libraryError: new Error('Backend down') })).toBe('error');
  });

  it('resolves matching active sessions for resume', () => {
    const library = buildLibrary();
    expect(resolveReaderResumeSession(library, 'secondary')?.id).toBe('secondary');
    expect(resolveReaderResumeSession(library, 'missing')?.id).toBe('primary');
  });
});
