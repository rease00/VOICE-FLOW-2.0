import { afterEach, describe, expect, it, vi } from 'vitest';

const verifyIdTokenMock = vi.hoisted(() => vi.fn());
const verifySessionCookieMock = vi.hoisted(() => vi.fn());
const getUserMock = vi.hoisted(() => vi.fn());

vi.mock('../src/server/firebaseAdmin', () => ({
  getFirebaseAdminAuth: () => ({
    verifyIdToken: (...args: unknown[]) => verifyIdTokenMock(...args),
    verifySessionCookie: (...args: unknown[]) => verifySessionCookieMock(...args),
    getUser: (...args: unknown[]) => getUserMock(...args),
  }),
}));

describe('/api/auth/me', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns 401 for an invalid bearer token instead of surfacing a 500', async () => {
    verifyIdTokenMock.mockRejectedValueOnce(new Error('invalid token'));
    const { GET } = await import('../app/api/auth/me/route');

    const response = await GET(
      new Request('http://localhost/api/auth/me', {
        headers: {
          authorization: 'Bearer bad-token',
        },
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'Unauthorized' });
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it('prefers a valid session cookie over an invalid bearer token', async () => {
    verifySessionCookieMock.mockResolvedValueOnce({ uid: 'session-user' });
    getUserMock.mockResolvedValueOnce({
      uid: 'session-user',
      email: 'admin1@voiceflow.local',
      displayName: 'Admin',
      photoURL: null,
      emailVerified: true,
    });
    const { GET } = await import('../app/api/auth/me/route');

    const response = await GET(
      new Request('http://localhost/api/auth/me', {
        headers: {
          authorization: 'Bearer stale-token',
          cookie: '__session=session-cookie-token',
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      uid: 'session-user',
      email: 'admin1@voiceflow.local',
    });
    expect(verifyIdTokenMock).not.toHaveBeenCalled();
    expect(verifySessionCookieMock).toHaveBeenCalledWith('session-cookie-token', true);
  });
});
