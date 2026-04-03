import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/accountService', () => ({
  fetchAccountProfile: vi.fn(async () => {
    throw new Error('profile backend unavailable');
  }),
  fetchAccountEntitlements: vi.fn(),
  deleteAccount: vi.fn(),
  clearGenerationHistory: vi.fn(),
  fetchGenerationHistory: vi.fn(),
}));

import { mapFirebaseUserToProfile } from '../contexts/UserContext';

describe('mapFirebaseUserToProfile', () => {
  it('uses the provided Firebase user snapshot even when currentUser is not available', async () => {
    const profile = await mapFirebaseUserToProfile({
      uid: 'uid-123',
      email: 'creator@example.com',
      displayName: 'Creator One',
      phoneNumber: null,
      photoURL: 'https://example.com/avatar.png',
      providerData: [{ providerId: 'password' }],
      getIdTokenResult: async () => ({
        claims: {},
      }),
    } as any);

    expect(profile.uid).toBe('uid-123');
    expect(profile.email).toBe('creator@example.com');
    expect(profile.name).toBe('Creator One');
    expect(profile.providers).toContain('password');
    expect(profile.role).toBe('user');
    expect(profile.isAdmin).toBe(false);
    expect(profile.userId).toBeUndefined();
  });
});
