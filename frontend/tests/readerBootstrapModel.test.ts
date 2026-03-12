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
  effectiveMultiSpeakerMode: 'single_narrator',
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
    vfPerChar: 1.5,
    rule: '1 char = 1.5 VF',
    label: 'Reader pricing: 1 char = 1.5 VF',
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
  it('classifies auth failures by status and message', () => {
    expect(isReaderBootstrapAuthError({ status: 401, message: 'blocked' })).toBe(true);
    expect(isReaderBootstrapAuthError(new Error('Authentication required.'))).toBe(true);
    expect(isReaderBootstrapAuthError(new Error('Reader request failed.'))).toBe(false);
  });

  it('derives bootstrap state from library availability', () => {
    expect(resolveReaderBootstrapState({ library: buildLibrary() })).toBe('ready');
    expect(resolveReaderBootstrapState({ library: null, libraryError: new Error('Authentication required.') })).toBe('needs_auth');
    expect(resolveReaderBootstrapState({ library: null, libraryError: new Error('Cannot reach backend.') })).toBe('error');
  });

  it('prefers the matching active session when resuming', () => {
    const library = buildLibrary();
    expect(resolveReaderResumeSession(library, 'secondary')?.id).toBe('secondary');
    expect(resolveReaderResumeSession(library, 'missing')?.id).toBe('primary');
    expect(resolveReaderResumeSession(null, 'missing')).toBeNull();
  });
});
