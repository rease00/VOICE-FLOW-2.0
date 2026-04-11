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
      benchmarkTarget: 'VOICE_CLONE_L4_VC',
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

  it('posts cancel request to voice clone job cancel endpoint', async () => {
    const { cancelVoiceCloneJob } = await import('../src/features/voice-cloning/api');
    requestJsonMock.mockResolvedValueOnce({ ok: true, jobId: 'vc_job_1', status: 'cancelled' });

    await cancelVoiceCloneJob('vc_job_1', { baseUrl: 'https://backend.example' });

    expect(requestJsonMock).toHaveBeenCalledTimes(1);
    const [path, init, options] = requestJsonMock.mock.calls[0] as [string, RequestInit, { baseUrl: string; requireAuth: boolean }];
    expect(path).toBe('/voice-clone/jobs/vc_job_1/cancel');
    expect(init.method).toBe('POST');
    expect(options).toMatchObject({ baseUrl: 'https://backend.example', requireAuth: true });
  });

  it('retries voice clone cancel across proxy and direct backend even without idempotency key', async () => {
    const { cancelVoiceCloneJob } = await import('../src/features/voice-cloning/api');
    requestJsonMock
      .mockRejectedValueOnce({ status: 404, detail: 'Not Found' })
      .mockResolvedValueOnce({ ok: true, jobId: 'vc_job_2', status: 'cancelled' });

    const response = await cancelVoiceCloneJob('vc_job_2', {
      baseUrl: 'http://127.0.0.1:7800',
      timeoutMs: 12000,
    });

    expect(response).toMatchObject({ ok: true, jobId: 'vc_job_2', status: 'cancelled' });
    expect(requestJsonMock).toHaveBeenCalledTimes(2);
    const firstCall = requestJsonMock.mock.calls[0] as [string, RequestInit, { baseUrl: string; timeoutMs: number; requireAuth: boolean }];
    const secondCall = requestJsonMock.mock.calls[1] as [string, RequestInit, { baseUrl: string; timeoutMs: number; requireAuth: boolean }];
    expect(firstCall[0]).toBe('/voice-clone/jobs/vc_job_2/cancel');
    expect(secondCall[0]).toBe('/voice-clone/jobs/vc_job_2/cancel');
    expect(firstCall[2]).toMatchObject({ baseUrl: '/api/backend', timeoutMs: 12000, requireAuth: true });
    expect(secondCall[2]).toMatchObject({ baseUrl: 'http://127.0.0.1:7800', timeoutMs: 12000, requireAuth: true });
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
      benchmarkTarget: 'VOICE_CLONE_L4_VC',
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
      benchmarkTarget: 'VOICE_CLONE_L4_VC',
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

  it('keeps POST stress retries on the direct backend and /v1 alias only', async () => {
    const { startVoiceCloneStressTest } = await import('../src/features/voice-cloning/api');
    requestJsonMock
      .mockRejectedValueOnce(new MockHttpError(404, 'Not Found', 'Not Found'))
      .mockRejectedValueOnce(new MockHttpError(404, 'Not Found', 'Not Found'));

    const payload = {
      benchmarkTarget: 'VOICE_CLONE_L4_VC',
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

    await expect(startVoiceCloneStressTest(payload, {
      baseUrl: 'https://backend.example',
      timeoutMs: 45000,
    })).rejects.toMatchObject({ status: 404 });

    expect(requestJsonMock).toHaveBeenCalledTimes(2);
    const firstCall = requestJsonMock.mock.calls[0] as [string, RequestInit, { baseUrl: string; timeoutMs: number; requireAuth: boolean }];
    const secondCall = requestJsonMock.mock.calls[1] as [string, RequestInit, { baseUrl: string; timeoutMs: number; requireAuth: boolean }];
    expect(firstCall[0]).toBe('/admin/voice-clone/stress/start');
    expect(firstCall[2]).toMatchObject({ baseUrl: 'https://backend.example', timeoutMs: 45000, requireAuth: true });
    expect(secondCall[0]).toBe('/v1/admin/voice-clone/stress/start');
    expect(secondCall[2]).toMatchObject({ baseUrl: 'https://backend.example', timeoutMs: 45000, requireAuth: true });
  });

  it('always requires auth for voice-clone endpoints', async () => {
    const {
      fetchOpenVoiceCloneStatus,
      cloneVoiceWithOpenVoice,
      separateVoiceAndBackgroundWithDemucs,
    } = await import('../src/features/voice-cloning/api');

    requestJsonMock
      .mockResolvedValueOnce({ ok: true, status: 'ready' })
      .mockResolvedValueOnce({ ok: true, status: 'completed' })
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
    expect(statusCall[0]).toBe('/voice-clone/status');
    expect(cloneCall[0]).toBe('/voice-clone/render');
    expect(separateCall[0]).toBe('/voice-clone/separate');
    expect(statusCall[2]).toMatchObject({ requireAuth: true });
    expect(cloneCall[2]).toMatchObject({ requireAuth: true });
    expect(separateCall[2]).toMatchObject({ requireAuth: true });
  });

  it('adds a stable Idempotency-Key header to voice-clone POST retries', async () => {
    const { cloneVoiceWithOpenVoice } = await import('../src/features/voice-cloning/api');
    requestJsonMock.mockResolvedValueOnce({ ok: true, status: 'completed' });

    await cloneVoiceWithOpenVoice({
      referenceAudioBase64: 'ref',
      referenceAudioName: 'ref.mp3',
      sourceAudioBase64: 'src',
      sourceAudioName: 'src.mp3',
      requestId: 'voice_clone_req_123',
    } as any, {
      baseUrl: 'https://backend.example',
    });

    expect(requestJsonMock).toHaveBeenCalledTimes(1);
    const [path, init, options] = requestJsonMock.mock.calls[0] as [string, RequestInit, { requireAuth: boolean; baseUrl: string }];
    expect(path).toBe('/voice-clone/render');
    expect(options).toMatchObject({ requireAuth: true, baseUrl: 'https://backend.example' });
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('voice_clone_req_123');
  });

  it('forwards abort signals to the voice clone helpers', async () => {
    const {
      fetchOpenVoiceCloneStatus,
      cloneVoiceWithOpenVoice,
      separateVoiceAndBackgroundWithDemucs,
    } = await import('../src/features/voice-cloning/api');

    const controller = new AbortController();
    requestJsonMock
      .mockResolvedValueOnce({ ok: true, status: 'ready' })
      .mockResolvedValueOnce({ ok: true, status: 'completed' })
      .mockResolvedValueOnce({ ok: true, status: 'completed' })
      .mockResolvedValueOnce({ ok: true, status: 'completed' });

    await fetchOpenVoiceCloneStatus({ signal: controller.signal });
    await cloneVoiceWithOpenVoice({
      referenceAudioBase64: 'ref',
      referenceAudioName: 'ref.mp3',
      sourceAudioBase64: 'src',
      sourceAudioName: 'src.mp3',
    } as any, { signal: controller.signal });
    await separateVoiceAndBackgroundWithDemucs({
      sourceAudioBase64: 'mix',
      sourceAudioName: 'mix.mp3',
    }, { signal: controller.signal });

    expect(requestJsonMock).toHaveBeenCalledTimes(3);
    for (const call of requestJsonMock.mock.calls.slice(0, 3)) {
      const init = call[1] as RequestInit | undefined;
      expect(init?.signal).toBe(controller.signal);
    }
  });

  it('uses the app proxy and adds idempotency headers for local clone submissions', async () => {
    const { cloneVoiceWithOpenVoice } = await import('../src/features/voice-cloning/api');
    requestJsonMock.mockResolvedValueOnce({ ok: true, status: 'completed' });

    const response = await cloneVoiceWithOpenVoice({
      referenceAudioBase64: 'ref',
      referenceAudioName: 'ref.wav',
      sourceAudioBase64: 'src',
      sourceAudioName: 'src.wav',
      requestId: 'clone_req_123',
    } as any, {
      baseUrl: 'http://127.0.0.1:7800',
      timeoutMs: 12000,
    });

    expect(response).toMatchObject({ ok: true, status: 'completed' });
    expect(requestJsonMock).toHaveBeenCalledTimes(1);
    const [path, init, options] = requestJsonMock.mock.calls[0] as [string, RequestInit, { baseUrl: string; timeoutMs: number; requireAuth: boolean }];
    expect(path).toBe('/voice-clone/render');
    expect(options).toMatchObject({ baseUrl: '/api/backend', timeoutMs: 12000, requireAuth: true });
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('clone_req_123');
  });

  it('does not replay clone POST submissions across base URLs when the first target fails', async () => {
    const { cloneVoiceWithOpenVoice } = await import('../src/features/voice-cloning/api');
    requestJsonMock.mockReset();
    requestJsonMock.mockRejectedValueOnce(new MockHttpError(404, 'Not Found', 'Not Found'));

    await expect(cloneVoiceWithOpenVoice({
      referenceAudioBase64: 'ref',
      referenceAudioName: 'ref.wav',
      sourceAudioBase64: 'src',
      sourceAudioName: 'src.wav',
      requestId: 'clone_req_once',
    } as any, {
      baseUrl: 'http://127.0.0.1:7800',
      timeoutMs: 12000,
    })).rejects.toMatchObject({ status: 404 });

    expect(requestJsonMock).toHaveBeenCalledTimes(1);
    const [path, init, options] = requestJsonMock.mock.calls[0] as [string, RequestInit, { baseUrl: string; timeoutMs: number; requireAuth: boolean }];
    expect(path).toBe('/voice-clone/render');
    expect(options).toMatchObject({ baseUrl: '/api/backend', timeoutMs: 12000, requireAuth: true });
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('clone_req_once');
  });
});
