import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestJsonMock = vi.hoisted(() => vi.fn());

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
});
