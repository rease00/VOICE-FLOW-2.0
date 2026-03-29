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

  it('surfaces token timing failures before sending a protected request without auth', async () => {
    mockFirebaseAuth.currentUser = {
      uid: 'firebase_user_1',
      getIdToken: vi.fn(async () => {
        throw new Error('Token used too early, check that your computer\'s clock is set correctly.');
      }),
    };

    await expect(authFetch('https://example.com/account/profile', undefined, { requireAuth: true })).rejects.toThrow(
      'System clock is out of sync. Sync your device clock and sign in again.'
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
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

    const request = authFetch('https://example.com/reader/library', undefined, { timeoutMs: 1200 });
    const expectation = expect(request).rejects.toThrow(
      'Request to https://example.com/reader/library timed out after 1s. Verify backend availability and retry.'
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
      'https://example.com/account/profile',
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
    const request = authFetch('https://example.com/account/profile/no-timeout-check', undefined, { signal: controller.signal });

    await expect(request).resolves.toMatchObject({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
