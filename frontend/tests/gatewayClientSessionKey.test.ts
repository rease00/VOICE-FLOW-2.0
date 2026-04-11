import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requestJsonMock = vi.hoisted(() => vi.fn());
const memoryLocalStorage = vi.hoisted(() => {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => {
      entries.clear();
    },
    getItem: (key: string) => entries.get(String(key)) ?? null,
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key: string) => {
      entries.delete(String(key));
    },
    setItem: (key: string, value: string) => {
      entries.set(String(key), String(value));
    },
  } satisfies Storage;
});

const createDeferred = <T,>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

vi.mock('../src/shared/api/httpClient', () => ({
  requestBlob: vi.fn(),
  requestJson: (...args: unknown[]) => requestJsonMock(...args),
  requestPublicJson: vi.fn(),
}));

describe('issueTtsV2SessionKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memoryLocalStorage.clear();
    vi.stubGlobal('localStorage', memoryLocalStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends region metadata, keeps slot probing disabled by default, and caches the session key', async () => {
    requestJsonMock
      .mockResolvedValueOnce({
        ok: true,
        sessionKey: 'session-key-1',
        ttlSeconds: 1800,
        expiresAtMs: Date.now() + 3_600_000,
      })
      .mockResolvedValueOnce({
        ok: true,
        sessionKey: 'session-key-2',
        ttlSeconds: 1800,
        expiresAtMs: Date.now() + 3_600_000,
      });

    const { issueTtsV2SessionKey } = await import('../src/shared/api/gatewayClient');
    const baseUrl = `https://backend.example.test/${crypto.randomUUID()}`;

    const first = await issueTtsV2SessionKey({
      baseUrl,
      regionHint: 'asia',
      regionSource: 'login_auto_nearest',
    });
    const cached = await issueTtsV2SessionKey({ baseUrl });
    const forced = await issueTtsV2SessionKey({
      baseUrl,
      force: true,
      probeAllSlotRegions: true,
    });

    expect(first).toBe('session-key-1');
    expect(cached).toBe('session-key-1');
    expect(forced).toBe('session-key-2');
    expect(requestJsonMock).toHaveBeenCalledTimes(2);

    const [firstPath, firstInit, firstOptions] = requestJsonMock.mock.calls[0] as [
      string,
      RequestInit,
      { baseUrl?: string; requireAuth?: boolean },
    ];
    expect(firstPath).toBe('/tts/v2/sessions');
    expect(firstOptions).toEqual({ baseUrl, requireAuth: true });
    expect(JSON.parse(String(firstInit.body || '{}'))).toEqual({
      regionHint: 'asia',
      regionSource: 'login_auto_nearest',
      probeAllSlotRegions: false,
    });

    const [, secondInit] = requestJsonMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(secondInit.body || '{}'))).toEqual({
      probeAllSlotRegions: true,
    });
  });

  it('sends request_id as an idempotency key when creating a TTS job', async () => {
    requestJsonMock
      .mockResolvedValueOnce({
        ok: true,
        sessionKey: 'session-key-1',
        ttlSeconds: 1800,
        expiresAtMs: Date.now() + 3_600_000,
      })
      .mockResolvedValueOnce({
        ok: true,
        jobId: 'job-1',
        status: 'queued',
      });

    const { createTtsJob } = await import('../src/shared/api/gatewayClient');
    const baseUrl = `https://backend.example.test/${crypto.randomUUID()}`;

    await createTtsJob(
      {
        request_id: 'tts-request-123',
        text: 'hello world',
      },
      { baseUrl }
    );

    expect(requestJsonMock).toHaveBeenCalledTimes(2);

    const [, createInit, createOptions] = requestJsonMock.mock.calls[1] as [
      string,
      RequestInit,
      { baseUrl?: string; requireAuth?: boolean },
    ];
    expect(createOptions).toEqual({ baseUrl, requireAuth: true });
    expect(createInit.headers).toMatchObject({
      'Content-Type': 'application/json',
      'Idempotency-Key': 'tts-request-123',
      'x-vf-tts-session-key': 'session-key-1',
    });
  });

  it('generates request_id and idempotency key when payload omits request id', async () => {
    requestJsonMock
      .mockResolvedValueOnce({
        ok: true,
        sessionKey: 'session-key-1',
        ttlSeconds: 1800,
        expiresAtMs: Date.now() + 3_600_000,
      })
      .mockResolvedValueOnce({
        ok: true,
        jobId: 'job-2',
        status: 'queued',
      });

    const randomSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('generated-req-001');
    try {
      const { createTtsJob } = await import('../src/shared/api/gatewayClient');
      await createTtsJob(
        {
          text: 'hello world',
        },
        { baseUrl: 'https://backend.example.test/generated-id' }
      );
    } finally {
      randomSpy.mockRestore();
    }

    const [, createInit] = requestJsonMock.mock.calls[1] as [string, RequestInit];
    const headers = new Headers(createInit.headers || {});
    const body = JSON.parse(String(createInit.body || '{}')) as Record<string, string>;
    expect(headers.get('Idempotency-Key')).toBe('generated-req-001');
    expect(body.request_id).toBe('generated-req-001');
    expect(body.requestId).toBeUndefined();
    expect(body.idempotencyKey).toBeUndefined();
  });

  it('reuses an auto-generated request id across module reloads for the same canonical payload', async () => {
    requestJsonMock
      .mockResolvedValueOnce({
        ok: true,
        sessionKey: 'session-key-reload-1',
        ttlSeconds: 1800,
        expiresAtMs: Date.now() + 3_600_000,
      })
      .mockResolvedValueOnce({
        ok: true,
        jobId: 'job-reload-1',
        requestId: 'persisted-request-001',
        status: 'queued',
      })
      .mockResolvedValueOnce({
        ok: true,
        sessionKey: 'session-key-reload-2',
        ttlSeconds: 1800,
        expiresAtMs: Date.now() + 3_600_000,
      })
      .mockResolvedValueOnce({
        ok: true,
        jobId: 'job-reload-2',
        requestId: 'persisted-request-001',
        status: 'queued',
      });

    const randomSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('persisted-request-001');
    const baseUrl = 'https://backend.example.test/reload-idempotency';

    try {
      const { createTtsJob } = await import('../src/shared/api/gatewayClient');
      const payload = {
        text: 'reload-safe request id',
        voice_id: 'voice-a',
      };

      const first = await createTtsJob(payload, { baseUrl });
      expect(first.clientDedupe).toBeUndefined();

      vi.resetModules();
      const { createTtsJob: createTtsJobReloaded } = await import('../src/shared/api/gatewayClient');
      const second = await createTtsJobReloaded(payload, { baseUrl });

      expect(second).toMatchObject({
        jobId: 'job-reload-2',
        requestId: 'persisted-request-001',
      });
      expect(randomSpy).toHaveBeenCalledTimes(1);

      const firstCreateCall = requestJsonMock.mock.calls[1] as [string, RequestInit];
      const secondCreateCall = requestJsonMock.mock.calls[3] as [string, RequestInit];
      expect(firstCreateCall[0]).toBe('/tts/v2/jobs');
      expect(secondCreateCall[0]).toBe('/tts/v2/jobs');
      expect(new Headers(firstCreateCall[1].headers || {}).get('Idempotency-Key')).toBe('persisted-request-001');
      expect(new Headers(secondCreateCall[1].headers || {}).get('Idempotency-Key')).toBe('persisted-request-001');
      expect(new Headers(secondCreateCall[1].headers || {}).get('X-VF-Client-Request-Dedupe')).toBe('auto-request-id-reuse');
    } finally {
      randomSpy.mockRestore();
      vi.resetModules();
    }
  });

  it('marks deduped create responses with a client-side diagnostic marker', async () => {
    requestJsonMock
      .mockResolvedValueOnce({
        ok: true,
        sessionKey: 'session-key-dedupe-1',
        ttlSeconds: 1800,
        expiresAtMs: Date.now() + 3_600_000,
      })
      .mockResolvedValueOnce({
        ok: true,
        jobId: 'job-dedupe-1',
        requestId: 'marker-request-001',
        status: 'queued',
      });

    const { createTtsJob } = await import('../src/shared/api/gatewayClient');
    const baseUrl = `https://backend.example.test/${crypto.randomUUID()}`;
    const payload = {
      request_id: 'marker-request-001',
      text: 'duplicate payload',
      voice_id: 'voice-a',
    };

    const first = await createTtsJob(payload, { baseUrl });
    const second = await createTtsJob(payload, { baseUrl });

    expect(first.clientDedupe).toBeUndefined();
    expect(second.clientDedupe).toMatchObject({
      kind: 'recent-cache-hit',
      requestId: 'marker-request-001',
    });
    expect(requestJsonMock).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent create requests that share the same request id', async () => {
    const deferredCreate = createDeferred<{
      ok: boolean;
      jobId: string;
      status: string;
    }>();
    requestJsonMock.mockImplementation((path: string) => {
      if (path === '/tts/v2/sessions') {
        return Promise.resolve({
          ok: true,
          sessionKey: 'session-key-shared-create',
          ttlSeconds: 1800,
          expiresAtMs: Date.now() + 3_600_000,
        });
      }
      if (path === '/tts/v2/jobs') {
        return deferredCreate.promise;
      }
      throw new Error(`Unexpected request path: ${path}`);
    });

    const { createTtsJob } = await import('../src/shared/api/gatewayClient');
    const baseUrl = `https://backend.example.test/${crypto.randomUUID()}`;

    const first = createTtsJob(
      {
        request_id: 'coalesce-create-001',
        text: 'hello world',
      },
      { baseUrl }
    );
    const second = createTtsJob(
      {
        request_id: 'coalesce-create-001',
        text: 'hello world',
      },
      { baseUrl }
    );

    deferredCreate.resolve({
      ok: true,
      jobId: 'job-coalesced',
      status: 'queued',
    });

    await expect(first).resolves.toMatchObject({ jobId: 'job-coalesced', status: 'queued' });
    await expect(second).resolves.toMatchObject({ jobId: 'job-coalesced', status: 'queued' });
    expect(requestJsonMock).toHaveBeenCalledTimes(2);
  });

  it('reuses recent auto-generated request id for duplicate payload re-submits', async () => {
    requestJsonMock
      .mockResolvedValueOnce({
        ok: true,
        sessionKey: 'session-key-auto-dup',
        ttlSeconds: 1800,
        expiresAtMs: Date.now() + 3_600_000,
      })
      .mockResolvedValueOnce({
        ok: true,
        jobId: 'job-auto-dedupe',
        status: 'queued',
      });

    const randomSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('generated-repeat-req-001');
    try {
      const { createTtsJob } = await import('../src/shared/api/gatewayClient');
      const baseUrl = `https://backend.example.test/${crypto.randomUUID()}`;
      const first = await createTtsJob(
        {
          text: 'duplicate payload should reuse request id',
          voice_id: 'voice-a',
        },
        { baseUrl }
      );
      const second = await createTtsJob(
        {
          text: 'duplicate payload should reuse request id',
          voice_id: 'voice-a',
        },
        { baseUrl }
      );
      expect(first).toMatchObject({ jobId: 'job-auto-dedupe', status: 'queued' });
      expect(second).toMatchObject({ jobId: 'job-auto-dedupe', status: 'queued' });
    } finally {
      randomSpy.mockRestore();
    }

    expect(requestJsonMock).toHaveBeenCalledTimes(2);

    const [, createInit] = requestJsonMock.mock.calls[1] as [string, RequestInit];
    const headers = new Headers(createInit.headers || {});
    const body = JSON.parse(String(createInit.body || '{}')) as Record<string, string>;
    expect(headers.get('Idempotency-Key')).toBe('generated-repeat-req-001');
    expect(body.request_id).toBe('generated-repeat-req-001');
    expect(body.requestId).toBeUndefined();
  });

  it('coalesces concurrent session bootstrap requests for the same backend payload', async () => {
    const deferred = createDeferred<{
      ok: boolean;
      sessionKey: string;
      ttlSeconds: number;
      expiresAtMs: number;
    }>();
    requestJsonMock.mockImplementation(async () => deferred.promise);

    const { issueTtsV2SessionKey } = await import('../src/shared/api/gatewayClient');
    const baseUrl = `https://backend.example.test/${crypto.randomUUID()}`;

    const first = issueTtsV2SessionKey({
      baseUrl,
      force: true,
      regionHint: 'asia',
      regionSource: 'login_auto_nearest',
      probeAllSlotRegions: true,
    });
    const second = issueTtsV2SessionKey({
      baseUrl,
      force: true,
      regionHint: 'asia',
      regionSource: 'login_auto_nearest',
      probeAllSlotRegions: true,
    });

    deferred.resolve({
      ok: true,
      sessionKey: 'session-key-shared',
      ttlSeconds: 1800,
      expiresAtMs: Date.now() + 3_600_000,
    });

    await expect(first).resolves.toBe('session-key-shared');
    await expect(second).resolves.toBe('session-key-shared');
    expect(requestJsonMock).toHaveBeenCalledTimes(1);
  });

  it('cancels the cached TTS session through the session cancel endpoint', async () => {
    requestJsonMock
      .mockResolvedValueOnce({
        ok: true,
        sessionKey: 'session-key-cancel',
        ttlSeconds: 1800,
        expiresAtMs: Date.now() + 3_600_000,
      })
      .mockResolvedValueOnce({
        ok: true,
        sessionKey: 'session-key-cancel',
        cancelledCount: 1,
        jobs: [],
      });

    const { issueTtsV2SessionKey, cancelTtsSession } = await import('../src/shared/api/gatewayClient');
    const baseUrl = `https://backend.example.test/${crypto.randomUUID()}`;

    await issueTtsV2SessionKey({ baseUrl, force: true });
    const result = await cancelTtsSession({ baseUrl });

    expect(result.ok).toBe(true);
    expect(requestJsonMock).toHaveBeenCalledTimes(2);

    const [cancelPath, cancelInit, cancelOptions] = requestJsonMock.mock.calls[1] as [
      string,
      RequestInit,
      { baseUrl?: string; requireAuth?: boolean },
    ];
    expect(cancelPath).toBe('/tts/v2/sessions/session-key-cancel/cancel');
    expect(cancelInit.method).toBe('POST');
    expect(cancelOptions).toEqual({ baseUrl, requireAuth: true });
  });
});
