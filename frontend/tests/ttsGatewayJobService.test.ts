import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../services/ttsLongTextService', async () => {
  const actual = await vi.importActual<typeof import('../services/ttsLongTextService')>('../services/ttsLongTextService');
  return {
    ...actual,
    sleepMs: vi.fn(async () => undefined),
  };
});

import { pollTtsGatewayJobForAudio, resolveTtsGatewayJobPollDelayMs } from '../services/ttsGatewayJobService';
import { sleepMs } from '../services/ttsLongTextService';
import { TTS_GATEWAY_JOB_PROGRESS_EVENT } from '../services/ttsGatewayJobService';

const toBuffer = (bytes: number[]): ArrayBuffer => new Uint8Array(bytes).buffer;
const withStatus = (message: string, status: number): Error & { status: number } =>
  Object.assign(new Error(message), { status });
const mockedSleepMs = vi.mocked(sleepMs);
const windowListeners = new Map<string, Set<(event: Event) => void>>();

class TestCustomEvent<T = unknown> extends Event {
  detail: T;

  constructor(type: string, init?: CustomEventInit<T>) {
    super(type, init);
    this.detail = init?.detail as T;
  }
}

beforeAll(() => {
  vi.stubGlobal('CustomEvent', TestCustomEvent as unknown as typeof CustomEvent);
  vi.stubGlobal('document', { visibilityState: 'visible' });
  vi.stubGlobal('window', {
    dispatchEvent: (event: Event) => {
      const listeners = windowListeners.get(event.type);
      if (listeners) {
        for (const listener of listeners) {
          listener(event);
        }
      }
      return true;
    },
    addEventListener: (type: string, listener: (event: Event) => void) => {
      const listeners = windowListeners.get(type) || new Set<(event: Event) => void>();
      listeners.add(listener);
      windowListeners.set(type, listeners);
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => {
      const listeners = windowListeners.get(type);
      listeners?.delete(listener);
      if (listeners && listeners.size === 0) {
        windowListeners.delete(type);
      }
    },
  } as unknown as Window);
});

afterEach(() => {
  mockedSleepMs.mockClear();
  windowListeners.clear();
  if (typeof document !== 'undefined') {
    Object.assign(document, { visibilityState: 'visible' });
  }
});

describe('pollTtsGatewayJobForAudio', () => {
  it('uses a higher default polling floor and backs off between unchanged polls', () => {
    expect(resolveTtsGatewayJobPollDelayMs({ reset: true })).toBe(2000);
    expect(resolveTtsGatewayJobPollDelayMs({ currentDelayMs: 2000 })).toBe(3400);
    expect(resolveTtsGatewayJobPollDelayMs({ currentDelayMs: 3400 })).toBe(5780);
    expect(resolveTtsGatewayJobPollDelayMs({ currentDelayMs: 5780, maxDelayMs: 6000 })).toBe(6000);
  });

  it('polls status without inline result and fetches final payload exactly once', async () => {
    mockedSleepMs.mockClear();
    const getJob = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, jobId: 'job-1', status: 'queued' })
      .mockResolvedValueOnce({ ok: true, jobId: 'job-1', status: 'running' })
      .mockResolvedValueOnce({ ok: true, jobId: 'job-1', status: 'completed' });
    const fetchResult = vi
      .fn()
      .mockResolvedValue({ audioBytes: toBuffer([1, 2, 3]), responseHeaders: { 'X-Trace-Id': 'trace_1' } });

    const result = await pollTtsGatewayJobForAudio({
      jobId: 'job-1',
      runtimeLabel: 'Gemini runtime',
      engine: 'PRIME',
      timeoutMs: 5_000,
      client: {
        getJob,
        fetchResult,
        fetchChunkAudio: vi.fn().mockResolvedValue(toBuffer([])),
        cancelJob: vi.fn().mockResolvedValue({ ok: true }),
      },
    });

    expect(new Uint8Array(result.audioBytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.responseHeaders).toEqual({ 'x-trace-id': 'trace_1' });
    expect(fetchResult).toHaveBeenCalledTimes(1);
    expect(getJob).toHaveBeenCalledTimes(3);
    expect(getJob.mock.calls.every(([, options]) => options?.includeResult === false)).toBe(true);
    expect(mockedSleepMs.mock.calls.map(([delayMs]) => delayMs)).toEqual([2000, 2000]);
  });

  it('uses inline completed payload when already present and skips extra fetch', async () => {
    mockedSleepMs.mockClear();
    const inlineBytes = [9, 8, 7, 6];
    const getJob = vi.fn().mockResolvedValue({
      ok: true,
      jobId: 'job-inline',
      status: 'completed',
      result: {
        audioBase64: Buffer.from(inlineBytes).toString('base64'),
        headers: {
          'X-Direct': 'inline',
        },
      },
    });
    const fetchResult = vi.fn();

    const result = await pollTtsGatewayJobForAudio({
      jobId: 'job-inline',
      runtimeLabel: 'Gemini runtime',
      engine: 'PRIME',
      pollMs: 0,
      pollMaxMs: 0,
      timeoutMs: 5_000,
      client: {
        getJob,
        fetchResult,
        fetchChunkAudio: vi.fn().mockResolvedValue(toBuffer([])),
        cancelJob: vi.fn().mockResolvedValue({ ok: true }),
      },
    });

    expect(new Uint8Array(result.audioBytes)).toEqual(new Uint8Array(inlineBytes));
    expect(result.responseHeaders).toEqual({ 'x-direct': 'inline' });
    expect(fetchResult).not.toHaveBeenCalled();
    expect(getJob).toHaveBeenCalledTimes(1);
    expect(getJob.mock.calls[0]?.[1]?.includeResult).toBe(false);
    expect(mockedSleepMs).not.toHaveBeenCalled();
  });

  it('retries retryable chunk fetch failures without escalating to inline chunk mode', async () => {
    mockedSleepMs.mockClear();
    const getJob = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        jobId: 'job-2',
        status: 'queued',
        chunks: [{ index: 0, contentType: 'audio/wav', durationMs: 120, textChars: 24 }],
        chunkCursorNext: 1,
      })
      .mockResolvedValueOnce({
        ok: true,
        jobId: 'job-2',
        status: 'completed',
        result: {
          audioBase64: Buffer.from([4, 5, 6]).toString('base64'),
          headers: {},
        },
      });
    const fetchChunkAudio = vi
      .fn()
      .mockRejectedValueOnce(withStatus('chunk warming', 409))
      .mockRejectedValueOnce(withStatus('runtime warming', 503))
      .mockResolvedValueOnce(toBuffer([1, 2, 3]));
    const fetchResult = vi.fn();

    const result = await pollTtsGatewayJobForAudio({
      jobId: 'job-2',
      runtimeLabel: 'Gemini runtime',
      engine: 'PRIME',
      timeoutMs: 5_000,
      client: {
        getJob,
        fetchResult,
        fetchChunkAudio,
        cancelJob: vi.fn().mockResolvedValue({ ok: true }),
      },
    });

    expect(new Uint8Array(result.audioBytes)).toEqual(new Uint8Array([4, 5, 6]));
    expect(fetchChunkAudio).toHaveBeenCalledTimes(3);
    expect(fetchResult).not.toHaveBeenCalled();
    expect(getJob).toHaveBeenCalledTimes(2);
    expect(getJob.mock.calls.every(([, options]) => options?.includeChunkAudio === false)).toBe(true);
    const sleepCalls = mockedSleepMs.mock.calls.map(([delayMs]) => Number(delayMs));
    expect(sleepCalls).toContain(220);
    expect(sleepCalls).toContain(440);
    expect(sleepCalls).toContain(2000);
  });

  it('does not globally disable chunk downloads after a non-retryable chunk fetch failure', async () => {
    mockedSleepMs.mockClear();
    const getJob = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        jobId: 'job-2b',
        status: 'queued',
        chunks: [{ index: 0, contentType: 'audio/wav', durationMs: 120, textChars: 24 }],
        chunkCursorNext: 1,
      })
      .mockResolvedValueOnce({
        ok: true,
        jobId: 'job-2b',
        status: 'running',
        chunks: [{ index: 1, contentType: 'audio/wav', durationMs: 120, textChars: 24 }],
        chunkCursorNext: 2,
      })
      .mockResolvedValueOnce({
        ok: true,
        jobId: 'job-2b',
        status: 'completed',
        result: {
          audioBase64: Buffer.from([4, 5, 6]).toString('base64'),
          headers: {},
        },
      });
    const fetchChunkAudio = vi
      .fn()
      .mockRejectedValueOnce(withStatus('chunk bad request', 400))
      .mockResolvedValueOnce(toBuffer([8, 9, 10]));

    const result = await pollTtsGatewayJobForAudio({
      jobId: 'job-2b',
      runtimeLabel: 'Gemini runtime',
      engine: 'PRIME',
      timeoutMs: 5_000,
      client: {
        getJob,
        fetchResult: vi.fn(),
        fetchChunkAudio,
        cancelJob: vi.fn().mockResolvedValue({ ok: true }),
      },
    });

    expect(new Uint8Array(result.audioBytes)).toEqual(new Uint8Array([4, 5, 6]));
    expect(fetchChunkAudio).toHaveBeenCalledTimes(2);
    expect(fetchChunkAudio.mock.calls.map((call) => call[1])).toEqual([0, 1]);
    expect(getJob).toHaveBeenCalledTimes(3);
    expect(getJob.mock.calls.every(([, options]) => options?.includeChunkAudio === false)).toBe(true);
  });

  it('keeps polling in hidden tabs on a slower cadence and still emits progress heartbeats', async () => {
    Object.assign(document, { visibilityState: 'hidden' });
    const progressEvents: Array<Record<string, unknown>> = [];
    const onProgress = (event: Event) => {
      progressEvents.push(((event as CustomEvent).detail || {}) as Record<string, unknown>);
    };
    window.addEventListener(TTS_GATEWAY_JOB_PROGRESS_EVENT, onProgress as EventListener);

    const getJob = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, jobId: 'job-hidden', status: 'queued' })
      .mockResolvedValueOnce({ ok: true, jobId: 'job-hidden', status: 'running' })
      .mockResolvedValueOnce({
        ok: true,
        jobId: 'job-hidden',
        status: 'completed',
        result: {
          audioBase64: Buffer.from([7, 8, 9]).toString('base64'),
          headers: {},
        },
      });

    try {
      const result = await pollTtsGatewayJobForAudio({
        jobId: 'job-hidden',
        runtimeLabel: 'Gemini runtime',
        engine: 'PRIME',
        timeoutMs: 5_000,
        client: {
          getJob,
          fetchResult: vi.fn(),
          fetchChunkAudio: vi.fn().mockResolvedValue(toBuffer([])),
          cancelJob: vi.fn().mockResolvedValue({ ok: true }),
        },
      });

      expect(new Uint8Array(result.audioBytes)).toEqual(new Uint8Array([7, 8, 9]));
      expect(getJob).toHaveBeenCalledTimes(3);
      expect(mockedSleepMs.mock.calls.length).toBe(2);
      expect(mockedSleepMs.mock.calls.every(([delayMs]) => Number(delayMs) >= 5000)).toBe(true);
      expect(progressEvents.length).toBeGreaterThan(0);
      expect(progressEvents.some((event) => String(event.status || '').toLowerCase() === 'running')).toBe(true);
    } finally {
      window.removeEventListener(TTS_GATEWAY_JOB_PROGRESS_EVENT, onProgress as EventListener);
    }
  });
});

