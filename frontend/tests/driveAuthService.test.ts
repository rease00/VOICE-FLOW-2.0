import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFirebaseAuth } = vi.hoisted(() => ({
  mockFirebaseAuth: {
    currentUser: null as
      | null
      | {
          uid: string;
          providerData?: Array<{ providerId?: string | null }>;
        },
  },
}));

vi.mock('../services/firebaseClient', () => ({
  firebaseAuth: mockFirebaseAuth,
  googleProvider: {},
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

describe('driveAuthService', () => {
  const legacyDriveTokenKey = 'vf_drive_google_token_cache';
  const originalLocalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;
  const storage = createStorageMock();

  beforeEach(async () => {
    storage.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage,
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: storage },
    });
    mockFirebaseAuth.currentUser = null;
    const { clearDriveTokenCache } = await import('../services/driveAuthService');
    clearDriveTokenCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockFirebaseAuth.currentUser = null;
  });

  afterAll(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: originalLocalStorage,
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  it('keeps Drive access tokens in memory only and clears legacy storage', async () => {
    const {
      clearDriveTokenCache,
      getDriveProviderToken,
      warmDriveTokenFromGoogleSignIn,
    } = await import('../services/driveAuthService');

    mockFirebaseAuth.currentUser = {
      uid: 'user_123',
      providerData: [{ providerId: 'google.com' }],
    };
    storage.store.set(legacyDriveTokenKey, 'legacy-token');

    warmDriveTokenFromGoogleSignIn({ accessToken: 'drive-token' } as any);

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.removeItem).toHaveBeenCalledWith(legacyDriveTokenKey);

    const connected = await getDriveProviderToken();
    expect(connected).toMatchObject({
      ok: true,
      status: 'connected',
      token: 'drive-token',
    });

    clearDriveTokenCache();

    const afterClear = await getDriveProviderToken();
    expect(afterClear).toMatchObject({
      ok: false,
      status: 'needs_consent',
    });
  });
});
