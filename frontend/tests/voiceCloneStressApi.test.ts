import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestJsonMock } = vi.hoisted(() => ({
  requestJsonMock: vi.fn(),
}));

class MockHttpError extends Error {
  status: number;
  statusText: string;
  detail: string;

  constructor(status: number, statusText: string, detail: string) {
    super(detail || `${status} ${statusText}`);
    this.status = status;
    this.statusText = statusText;
    this.detail = detail || `${status} ${statusText}`;
  }
}

vi.mock('../src/shared/api/httpClient', () => ({
  requestJson: (...args: unknown[]) => requestJsonMock(...args),
  HttpError: MockHttpError,
}));

describe('voice clone stress api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts start payload to admin stress start endpoint', async () => {
    const { startVoiceCloneStressTest } = await import('../src/features/voice-cloning/api');
    requestJsonMock.mockResolvedValueOnce({ ok: true, jobId: 'vcs_1', status: 'queued' });

    const payload = {
      benchmarkTarget: 'OPENVOICE_L4_VC',
      config: {
        startRpm: 20,
        stepRpm: 10,
        maxRpm: 60,
        stepDurationSec: 30,
        concurrency: 4,
        maxFailureRate: 0.05,
        maxP95Ms: 20000,
        warmupRequests: 2,
        requestTimeoutSec: 60,
      },
      referenceAudioBase64: 'ref',
      sourceAudioBase64: 'src',
    } as const;

    const response = await startVoiceCloneStressTest(payload, {
      baseUrl: 'https://backend.example',
      timeoutMs: 45000,
    });

    expect(response).toMatchObject({ ok: true, jobId: 'vcs_1', status: 'queued' });
    expect(requestJsonMock).toHaveBeenCalledTimes(1);
    const [path, init, options] = requestJsonMock.mock.calls[0] as [string, RequestInit, { baseUrl: string; timeoutMs: number; requireAuth: boolean }];
    expect(path).toBe('/admin/voice-clone/stress/start');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init.body || '{}'))).toMatchObject(payload);
    expect(options).toMatchObject({ baseUrl: 'https://backend.example', timeoutMs: 45000, requireAuth: true });
  });

  it('fetches status using encoded job id', async () => {
    const { fetchVoiceCloneStressTestStatus } = await import('../src/features/voice-cloning/api');
    requestJsonMock.mockResolvedValueOnce({ ok: true, jobId: 'vcs id/1', status: 'running' });

    await fetchVoiceCloneStressTestStatus('vcs id/1', {
      baseUrl: 'https://backend.example',
    });

    expect(requestJsonMock).toHaveBeenCalledTimes(1);
    const [path, init, options] = requestJsonMock.mock.calls[0] as [string, RequestInit | undefined, { baseUrl: string; requireAuth: boolean }];
    expect(path).toBe('/admin/voice-clone/stress/vcs%20id%2F1');
    expect(init).toBeUndefined();
    expect(options).toMatchObject({ baseUrl: 'https://backend.example', requireAuth: true });
  });

  it('posts cancel request to admin stress cancel endpoint', async () => {
    const { cancelVoiceCloneStressTest } = await import('../src/features/voice-cloning/api');
    requestJsonMock.mockResolvedValueOnce({ ok: true, jobId: 'vcs_2', status: 'cancelled' });

    await cancelVoiceCloneStressTest('vcs_2');

    expect(requestJsonMock).toHaveBeenCalledTimes(1);
    const [path, init, options] = requestJsonMock.mock.calls[0] as [string, RequestInit, { requireAuth: boolean }];
    expect(path).toBe('/admin/voice-clone/stress/vcs_2/cancel');
    expect(init.method).toBe('POST');
    expect(options).toMatchObject({ requireAuth: true });
  });

  it('falls back by stripping /v1 suffix from baseUrl when first admin route call is 404', async () => {
    const { startVoiceCloneStressTest } = await import('../src/features/voice-cloning/api');
    requestJsonMock
      .mockRejectedValueOnce(new MockHttpError(404, 'Not Found', 'Not Found'))
      .mockResolvedValueOnce({ ok: true, jobId: 'vcs_3', status: 'queued' });

    const payload = {
      benchmarkTarget: 'OPENVOICE_L4_VC',
      config: {
        startRpm: 20,
        stepRpm: 10,
        maxRpm: 60,
        stepDurationSec: 30,
        concurrency: 4,
        maxFailureRate: 0.05,
        maxP95Ms: 20000,
        warmupRequests: 2,
        requestTimeoutSec: 60,
      },
      referenceAudioBase64: 'ref',
      sourceAudioBase64: 'src',
    } as const;

    const response = await startVoiceCloneStressTest(payload, {
      baseUrl: 'https://backend.example/v1',
      timeoutMs: 45000,
    });

    expect(response).toMatchObject({ ok: true, jobId: 'vcs_3', status: 'queued' });
    expect(requestJsonMock).toHaveBeenCalledTimes(2);
    const firstCall = requestJsonMock.mock.calls[0] as [string, RequestInit, { baseUrl: string; timeoutMs: number; requireAuth: boolean }];
    const secondCall = requestJsonMock.mock.calls[1] as [string, RequestInit, { baseUrl: string; timeoutMs: number; requireAuth: boolean }];
    expect(firstCall[0]).toBe('/admin/voice-clone/stress/start');
    expect(firstCall[2]).toMatchObject({ baseUrl: 'https://backend.example/v1', timeoutMs: 45000, requireAuth: true });
    expect(secondCall[0]).toBe('/admin/voice-clone/stress/start');
    expect(secondCall[2]).toMatchObject({ baseUrl: 'https://backend.example', timeoutMs: 45000, requireAuth: true });
  });

  it('treats plain 404-like errors as retryable during fallback', async () => {
    const { startVoiceCloneStressTest } = await import('../src/features/voice-cloning/api');
    requestJsonMock
      .mockRejectedValueOnce({ status: 404, detail: 'Not Found' })
      .mockResolvedValueOnce({ ok: true, jobId: 'vcs_4', status: 'queued' });

    const payload = {
      benchmarkTarget: 'OPENVOICE_L4_VC',
      config: {
        startRpm: 20,
        stepRpm: 10,
        maxRpm: 60,
        stepDurationSec: 30,
        concurrency: 4,
        maxFailureRate: 0.05,
        maxP95Ms: 20000,
        warmupRequests: 2,
        requestTimeoutSec: 60,
      },
      referenceAudioBase64: 'ref',
      sourceAudioBase64: 'src',
    } as const;

    const response = await startVoiceCloneStressTest(payload, {
      baseUrl: 'https://backend.example/v1',
      timeoutMs: 45000,
    });

    expect(response).toMatchObject({ ok: true, jobId: 'vcs_4', status: 'queued' });
    expect(requestJsonMock).toHaveBeenCalledTimes(2);
  });

  it('always requires auth for voice-clone openvoice endpoints', async () => {
    const {
      fetchOpenVoiceCloneStatus,
      cloneVoiceWithOpenVoice,
      separateVoiceAndBackgroundWithDemucs,
    } = await import('../src/features/voice-cloning/api');

    requestJsonMock
      .mockResolvedValueOnce({ ok: true, status: 'ready' })
      .mockResolvedValueOnce({ ok: true, status: 'completed' })
      .mockResolvedValueOnce({ ok: true, status: 'completed' });

    await fetchOpenVoiceCloneStatus();
    await cloneVoiceWithOpenVoice({
      referenceAudioBase64: 'ref',
      referenceAudioName: 'ref.mp3',
      sourceAudioBase64: 'src',
      sourceAudioName: 'src.mp3',
    } as any);
    await separateVoiceAndBackgroundWithDemucs({
      sourceAudioBase64: 'mix',
      sourceAudioName: 'mix.mp3',
    });

    expect(requestJsonMock).toHaveBeenCalledTimes(3);
    const statusCall = requestJsonMock.mock.calls[0] as [string, RequestInit | undefined, { requireAuth: boolean }];
    const cloneCall = requestJsonMock.mock.calls[1] as [string, RequestInit, { requireAuth: boolean }];
    const separateCall = requestJsonMock.mock.calls[2] as [string, RequestInit, { requireAuth: boolean }];
    expect(statusCall[0]).toBe('/voice-clone/openvoice/status');
    expect(cloneCall[0]).toBe('/voice-clone/openvoice');
    expect(separateCall[0]).toBe('/voice-clone/openvoice/separate');
    expect(statusCall[2]).toMatchObject({ requireAuth: true });
    expect(cloneCall[2]).toMatchObject({ requireAuth: true });
    expect(separateCall[2]).toMatchObject({ requireAuth: true });
  });
});
