import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MockWorker {
  onmessage: ((event: MessageEvent<any>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
}

describe('kokoroStudioWorkerClient', () => {
  let createdWorkers: MockWorker[] = [];

  beforeEach(() => {
    vi.resetModules();
    createdWorkers = [];
    const WorkerCtor = vi.fn(() => {
      const worker = new MockWorker();
      createdWorkers.push(worker);
      return worker as unknown as Worker;
    });
    vi.stubGlobal('window', { URL } as any);
    vi.stubGlobal('Worker', WorkerCtor as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('streams progress/chunks and resolves final merged audio', async () => {
    const onProgress = vi.fn();
    const onChunk = vi.fn();
    const clientModule = await import('../services/kokoroStudioWorkerClient');

    const promise = clientModule.synthesizeKokoroStudioInWorker(
      {
        text: 'Hello there',
        voiceId: 'af_heart',
        language: 'en',
        speed: 1,
        backendBaseUrl: 'http://127.0.0.1:7800',
      },
      { onProgress, onChunk },
    );

    const worker = createdWorkers[0];
    expect(worker).toBeTruthy();
    const synthRequest = worker.postMessage.mock.calls[0]?.[0];
    expect(synthRequest?.type).toBe('synthesize');
    const requestId = synthRequest?.requestId;

    worker.onmessage?.({
      data: {
        type: 'progress',
        requestId,
        payload: {
          progressPct: 35,
          stage: 'Generating audio...',
          threadBudget: 2,
        },
      },
    } as MessageEvent<any>);

    worker.onmessage?.({
      data: {
        type: 'chunk',
        requestId,
        payload: {
          index: 0,
          text: 'Hello there',
          durationMs: 420,
          sampleRate: 24000,
          contentType: 'audio/wav',
          audioBase64: 'UklGRgABAABXQVZFZm10IA==',
        },
      },
    } as MessageEvent<any>);

    worker.onmessage?.({
      data: {
        type: 'done',
        requestId,
        payload: {
          sampleRate: 24000,
          threadBudget: 2,
          mergedAudio: new Float32Array([0.1, -0.1, 0.2, 0.15]).buffer,
        },
      },
    } as MessageEvent<any>);

    const result = await promise;
    expect(result.sampleRate).toBe(24000);
    expect(result.threadBudget).toBe(2);
    const received = Array.from(result.mergedAudio);
    const expected = [0.1, -0.1, 0.2, 0.15];
    expect(received).toHaveLength(expected.length);
    received.forEach((value, index) => {
      expect(value).toBeCloseTo(expected[index] || 0, 5);
    });
    expect(onProgress).toHaveBeenCalled();
    expect(onChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'audio/wav',
        audioBase64: expect.any(String),
      }),
    );
  });

  it('terminates and recreates worker lifecycle on abort', async () => {
    const clientModule = await import('../services/kokoroStudioWorkerClient');
    const controller = new AbortController();

    const promise = clientModule.synthesizeKokoroStudioInWorker(
      {
        text: 'Abort me',
        voiceId: 'af_heart',
        language: 'en',
        speed: 1,
        backendBaseUrl: 'http://127.0.0.1:7800',
      },
      { signal: controller.signal },
    );

    const worker = createdWorkers[0];
    expect(worker).toBeTruthy();
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    const postedTypes = worker.postMessage.mock.calls.map((call) => call?.[0]?.type).filter(Boolean);
    expect(postedTypes).toContain('cancel');
  });

  it('returns a graceful unsupported-browser error when Worker is unavailable', async () => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.stubGlobal('window', { URL } as any);
    vi.stubGlobal('Worker', undefined as any);

    const clientModule = await import('../services/kokoroStudioWorkerClient');
    const promise = clientModule.synthesizeKokoroStudioInWorker({
      text: 'Hello',
      voiceId: 'af_heart',
      language: 'en',
      speed: 1,
      backendBaseUrl: 'http://127.0.0.1:7800',
    });

    let thrown: unknown;
    try {
      await promise;
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      name: 'KokoroStudioWorkerClientError',
      code: 'UNSUPPORTED_BROWSER',
    });
    expect(String((thrown as Error)?.message || '')).toMatch(/unavailable in this environment/i);
  });
});
