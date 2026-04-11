import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFirebaseAuth } = vi.hoisted(() => ({
  mockFirebaseAuth: {
    currentUser: null as { uid: string; getIdToken: (forceRefresh?: boolean) => Promise<string> } | null,
  },
}));

vi.mock('../services/firebaseClient', () => ({
  firebaseAuth: mockFirebaseAuth,
}));

import { authFetch } from '../services/authHttpClient';

describe('authFetch', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mockFirebaseAuth.currentUser = null;
    vi.stubGlobal('fetch', vi.fn());
  });

  it('retries Firebase token timing failures before sending a protected request', async () => {
    vi.useFakeTimers();
    const getIdToken = vi
      .fn()
      .mockRejectedValueOnce(new Error('Token used too early, check that your computer\'s clock is set correctly.'))
      .mockRejectedValueOnce(new Error('Token used too early, check that your computer\'s clock is set correctly.'))
      .mockResolvedValueOnce('firebase-token');

    mockFirebaseAuth.currentUser = {
      uid: 'firebase_user_1',
      getIdToken,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    );

    const request = authFetch('/account/profile', undefined, { requireAuth: true });

    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(3000);

    await expect(request).resolves.toMatchObject({ ok: true, status: 200 });
    expect(getIdToken).toHaveBeenCalledTimes(3);
    expect(getIdToken.mock.calls.map((call) => call[0])).toEqual([false, true, true]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries backend token timing responses before succeeding', async () => {
    vi.useFakeTimers();
    mockFirebaseAuth.currentUser = {
      uid: 'firebase_user_1',
      getIdToken: vi.fn(async () => 'firebase-token'),
    };

    const timingResponse = () => new Response(
      JSON.stringify({ detail: 'Invalid auth token: token is not yet valid.' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const okResponse = () => new Response(
      JSON.stringify({ ok: true }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(timingResponse())
      .mockResolvedValueOnce(timingResponse())
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const request = authFetch('/account/profile', undefined, { requireAuth: true });

    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(3000);

    await expect(request).resolves.toMatchObject({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry backend token timing responses for non-idempotent writes', async () => {
    vi.useFakeTimers();
    mockFirebaseAuth.currentUser = {
      uid: 'firebase_user_1',
      getIdToken: vi.fn(async () => 'firebase-token'),
    };

    const timingResponse = () => new Response(
      JSON.stringify({ detail: 'Invalid auth token: token is not yet valid.' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const okResponse = () => new Response(
      JSON.stringify({ ok: true }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(timingResponse())
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const request = authFetch(
      '/account/profile',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mutate' }),
      },
      { requireAuth: true }
    );

    await expect(request).resolves.toMatchObject({ ok: false, status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('allows backend token timing retries for idempotent writes with an idempotency key', async () => {
    vi.useFakeTimers();
    mockFirebaseAuth.currentUser = {
      uid: 'firebase_user_1',
      getIdToken: vi.fn(async () => 'firebase-token'),
    };

    const timingResponse = () => new Response(
      JSON.stringify({ detail: 'Invalid auth token: token is not yet valid.' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const okResponse = () => new Response(
      JSON.stringify({ ok: true }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(timingResponse())
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const request = authFetch(
      '/account/profile',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'idempotency-key': 'idem-token-1',
        },
        body: JSON.stringify({ action: 'mutate' }),
      },
      { requireAuth: true }
    );

    await vi.advanceTimersByTimeAsync(1500);

    await expect(request).resolves.toMatchObject({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails with a readable timeout when the backend does not respond', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const abort = () => reject(new DOMException('Aborted', 'AbortError'));
        if (signal?.aborted) {
          abort();
          return;
        }
        signal?.addEventListener('abort', abort, { once: true });
      })
    )));

    const request = authFetch('/tts/v2/jobs', undefined, { timeoutMs: 1200 });
    const expectation = expect(request).rejects.toThrow(
      'Request to /tts/v2/jobs timed out after 1s. Verify backend availability and retry.'
    );

    await vi.advanceTimersByTimeAsync(1200);

    await expectation;
  });

  it('propagates caller abort signals through protected requests', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const abort = () => reject(new DOMException('Aborted', 'AbortError'));
        if (signal?.aborted) {
          abort();
          return;
        }
        signal?.addEventListener('abort', abort, { once: true });
      })
    ));
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    const request = authFetch(
      '/account/profile',
      undefined,
      { signal: controller.signal }
    );
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not auto-abort when a caller signal is provided without a timeout', async () => {
    vi.useRealTimers();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        const abort = () => reject(new DOMException('Aborted', 'AbortError'));
        if (signal?.aborted) {
          abort();
          return;
        }
        signal?.addEventListener('abort', abort, { once: true });
        setTimeout(() => {
          signal?.removeEventListener('abort', abort);
          resolve({ ok: true, status: 200 } as Response);
        }, 20);
      })
    ));
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    const request = authFetch('/account/profile/no-timeout-check', undefined, { signal: controller.signal });

    await expect(request).resolves.toMatchObject({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks Firebase auth forwarding to untrusted backend origins', async () => {
    mockFirebaseAuth.currentUser = {
      uid: 'firebase_user_1',
      getIdToken: vi.fn(async () => 'firebase-token'),
    };

    await expect(
      authFetch('https://evil.example/account/profile', undefined, { requireAuth: true })
    ).rejects.toThrow(
      'Authentication headers are blocked for untrusted backend origins. Use the default backend proxy or a localhost backend.'
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

