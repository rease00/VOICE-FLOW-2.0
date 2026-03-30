import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authFetchMock } = vi.hoisted(() => ({
  authFetchMock: vi.fn(),
}));

vi.mock('../services/authHttpClient', () => ({
  authFetch: authFetchMock,
}));

const createStorageMock = () => {
  const store = new Map<string, string>();
  return {
    store,
    getItem: vi.fn((key: string) => store.get(String(key)) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(String(key), String(value));
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(String(key));
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
};

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('adminService unlock token storage', () => {
  const legacyAdminUnlockKey = 'vf_admin_unlock_token';
  const originalWindow = globalThis.window;
  const originalSessionStorage = globalThis.sessionStorage;
  const storage = createStorageMock();

  beforeEach(async () => {
    storage.clear();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { sessionStorage: storage },
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: storage,
    });
    authFetchMock.mockReset();
    const { clearAdminUnlockToken } = await import('../services/adminService');
    clearAdminUnlockToken();
  });

  afterEach(() => {
    authFetchMock.mockReset();
  });

  afterAll(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: originalSessionStorage,
    });
  });

  it('keeps unlock tokens in memory only and clears legacy storage', async () => {
    const {
      clearAdminUnlockToken,
      createAdminBroadcastNotice,
      getAdminUnlockToken,
      verifyAdminSessionUnlock,
    } = await import('../services/adminService');

    storage.store.set(legacyAdminUnlockKey, 'legacy-token');
    authFetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          uid: 'admin_1',
          unlockToken: 'unlock-token',
          status: {
            isUnlocked: true,
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          notice: {
            id: 'notice_1',
            message: 'hello',
          },
        })
      );

    const verifyPayload = await verifyAdminSessionUnlock('unlock-key', 'http://127.0.0.1:7800');
    expect(verifyPayload.unlockToken).toBe('unlock-token');
    expect(getAdminUnlockToken()).toBe('unlock-token');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.removeItem).toHaveBeenCalledWith(legacyAdminUnlockKey);

    await createAdminBroadcastNotice(
      {
        message: 'hello',
        expiresAt: '2026-01-01T00:00:00.000Z',
      },
      'http://127.0.0.1:7800'
    );

    expect(authFetchMock).toHaveBeenCalledTimes(2);
    const mutationCall = authFetchMock.mock.calls[1] as [string, RequestInit, { requireAuth: boolean }];
    expect(new Headers(mutationCall[1]?.headers || {}).get('X-Admin-Unlock')).toBe('Bearer unlock-token');

    clearAdminUnlockToken();
    expect(getAdminUnlockToken()).toBe('');
  });
});
