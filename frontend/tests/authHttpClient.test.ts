import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSessionState = vi.hoisted(() => ({ token: '', uid: '' }));

vi.mock('../services/authSessionService', () => ({
  readStoredAuthSessionState: () => {
    const t = mockSessionState.token;
    const u = mockSessionState.uid;
    return t || u ? { token: t, uid: u } : null;
  },
}));

import { authFetch } from '../services/authHttpClient';

describe('authFetch', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mockSessionState.token = '';
    mockSessionState.uid = '';
    vi.stubGlobal('fetch', vi.fn());
  });

  it('retries Firebase token timing failures before sending a protected request', async () => {
    vi.useFakeTimers();
    mockSessionState.token = 'd1-session-token';
    mockSessionState.uid = 'test-user';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    );

    const request = authFetch('/account/profile', undefined, { requireAuth: true });

    await vi.advanceTimersByTimeAsync(1500);

    await expect(request).resolves.toMatchObject({ ok: true, status: 200 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('single-attempts backend failures without retry', async () => {
    mockSessionState.token = 'd1-session-token';
    mockSessionState.uid = 'test-user';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const request = await authFetch('/account/profile', undefined, { requireAuth: true });

    expect(request).toMatchObject({ ok: false, status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('single-attempts backend failures for idempotent writes', async () => {
    mockSessionState.token = 'd1-session-token';
    mockSessionState.uid = 'test-user';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const request = await authFetch('/account/profile', {
      method: 'POST',
      body: JSON.stringify({ test: true }),
      headers: { 'idempotency-key': 'key-1' },
    }, { requireAuth: true });

    expect(request).toMatchObject({ ok: false, status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails with a readable timeout when the backend does not respond', async () => {
    vi.useFakeTimers();
    mockSessionState.token = 'd1-session-token';
    mockSessionState.uid = 'test-user';
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise((resolve) => setTimeout(() => resolve(new Response(JSON.stringify({ ok: true }))), 10000)))
    );

    const request = authFetch('/account/profile', undefined, { requireAuth: true, timeoutMs: 5000 });

    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(6000);

    await expect(request).rejects.toThrow('timed out');
  });

  it('propagates caller abort signals through protected requests', async () => {
    vi.useFakeTimers();
    mockSessionState.token = 'd1-session-token';
    mockSessionState.uid = 'test-user';
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      })
    );

    const request = authFetch('/account/profile', undefined, { requireAuth: true, signal: controller.signal });

    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await vi.advanceTimersByTimeAsync(500);

    await expect(request).rejects.toThrow('aborted');
  });

  it('blocks Firebase auth forwarding to untrusted backend origins', async () => {
    mockSessionState.token = 'd1-session-token';
    mockSessionState.uid = 'test-user';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));

    await expect(
      authFetch('https://bad-origin.example.com/api/data', undefined, { requireAuth: true })
    ).rejects.toThrow('blocked');
  });
});
