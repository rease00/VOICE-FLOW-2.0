import { describe, expect, it } from 'vitest';
import type { ReaderSession } from '../../../../types';
import {
  resolveReaderBillingEstimate,
  resolveReaderPlayableUnits,
  resolveReaderScriptSegments,
} from './session';

const createReaderSession = (overrides: Partial<ReaderSession> = {}): ReaderSession => ({
  id: 'session-1',
  title: 'Reader session',
  contentKind: 'book',
  surface: 'books',
  regionId: 'global',
  direction: 'ltr',
  sourceLanguage: 'en',
  targetLanguage: 'en',
  pageViewMode: 'original',
  ttsLanguageMode: 'source',
  translationState: 'idle',
  multiSpeakerEnabled: false,
  workKey: 'work-1',
  sourceKind: 'catalog',
  musicTrackId: 'none',
  castMemory: {},
  consumedChars: 0,
  totalChars: 0,
  currentPanelIndex: 0,
  totalPanels: 0,
  progressPct: 0,
  cachedChars: 0,
  cacheLimitChars: 1000,
  deleteAtMs: 0,
  warningActive: false,
  savepointDownloadUrl: '',
  billing: {
    vfPerChar: 0.01,
    rule: 'per_char',
    label: 'Reader billing',
  },
  limits: {
    textWindowChars: 1000,
    prefetchThresholdChars: 200,
    panelBatchSize: 10,
    panelTriggerIndex: 5,
    deleteWarningMs: 60_000,
  },
  windows: [],
  panels: [],
  ...overrides,
});

describe('reader session model', () => {
  it('derives a live VF estimate from session usage and billing data', () => {
    const session = createReaderSession({
      consumedChars: 200,
      totalChars: 1000,
      progressPct: 50,
      billing: {
        vfPerChar: 0.02,
        rule: 'per_char',
        label: 'Reader billing',
      },
    });

    const estimate = resolveReaderBillingEstimate(session, { progressPct: 50 });

    expect(estimate.vfPerChar).toBe(0.02);
    expect(estimate.liveChars).toBe(500);
    expect(estimate.label).toContain('VF est');
    expect(estimate.detail).toContain('chars tracked');
  });

  it('maps playable units into pending, processing, and ready script segments', () => {
    const session = createReaderSession({
      contentKind: 'book',
      consumedChars: 0,
      totalChars: 0,
      progressPct: 0,
      billing: {
        vfPerChar: 0.01,
        rule: 'per_char',
        label: 'Reader billing',
      },
      windows: [
        { index: 0, text: 'One', status: 'queued', charCount: 3 },
        { index: 1, text: 'Two', job: { jobId: 'job-2', status: 'running' }, status: 'running', charCount: 3 },
        { index: 2, text: 'Three', job: { jobId: 'job-3', status: 'completed' }, status: 'completed', charCount: 5 },
      ],
    });

    expect(resolveReaderPlayableUnits(session)).toHaveLength(3);

    const segments = resolveReaderScriptSegments(session);
    expect(segments.map((segment) => segment.status)).toEqual(['pending', 'processing', 'ready']);
    const readySegment = segments[2];
    expect(readySegment).toBeDefined();
    if (!readySegment) {
      throw new Error('Expected ready segment at index 2');
    }
    expect(readySegment.charCount).toBe(5);
  });
});
