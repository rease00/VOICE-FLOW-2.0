import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFirebaseAuth, mockReadLocalAdminSession } = vi.hoisted(() => ({
  mockFirebaseAuth: {
    currentUser: null as { uid: string; getIdToken: (forceRefresh?: boolean) => Promise<string> } | null,
  },
  mockReadLocalAdminSession: vi.fn(async () => null),
}));

vi.mock('../services/firebaseClient', () => ({
  firebaseAuth: mockFirebaseAuth,
}));

vi.mock('../services/localAdminAuth', () => ({
  getLocalAdminUid: () => 'local_admin',
  readLocalAdminSession: mockReadLocalAdminSession,
}));

import { authFetch } from '../services/authHttpClient';

describe('authFetch', () => {
  beforeEach(() => {
    mockFirebaseAuth.currentUser = null;
    mockReadLocalAdminSession.mockClear();
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
});
