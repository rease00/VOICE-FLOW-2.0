import { afterEach, describe, expect, it, vi } from 'vitest';

const verifyIdTokenMock = vi.hoisted(() => vi.fn());
const verifySessionCookieMock = vi.hoisted(() => vi.fn());

vi.mock('../src/server/firebaseAdmin.ts', () => ({
  getFirebaseAdminAuth: () => ({
    verifyIdToken: (...args: unknown[]) => verifyIdTokenMock(...args),
    verifySessionCookie: (...args: unknown[]) => verifySessionCookieMock(...args),
  }),
}));

describe('request auth helpers', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.VF_DEV_UID_HEADER_ENABLED;
    delete process.env.NEXT_PUBLIC_ENABLE_DEV_UID_HEADER;
  });

  it('accepts the Firebase session cookie when no bearer token is present', async () => {
    verifySessionCookieMock.mockResolvedValueOnce({ uid: 'session-user' });

    const { verifyFirebaseRequest } = await import('../src/server/auth/requestAuth');
    await expect(
      verifyFirebaseRequest(
        new Request('http://localhost/api/v1/library/audio-novel/jobs', {
          headers: {
            cookie: '__session=session-cookie-token',
          },
        }),
      ),
    ).resolves.toMatchObject({ uid: 'session-user' });

    expect(verifyIdTokenMock).not.toHaveBeenCalled();
    expect(verifySessionCookieMock).toHaveBeenCalledWith('session-cookie-token', true);
  });
});
