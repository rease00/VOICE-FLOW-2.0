import { afterEach, describe, expect, it, vi } from 'vitest';

const resolveSessionTokenMock = vi.hoisted(() => vi.fn());

vi.mock('../src/server/auth/d1Auth', () => ({
  getD1AuthService: () => ({
    resolveSessionToken: (...args: unknown[]) => resolveSessionTokenMock(...args),
  }),
}));

describe('/api/auth/me', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns 401 for an invalid bearer token instead of surfacing a 500', async () => {
    resolveSessionTokenMock.mockResolvedValueOnce(null);
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
    expect(resolveSessionTokenMock).toHaveBeenCalledWith('bad-token');
  });

  it('prefers a valid session cookie over an invalid bearer token', async () => {
    resolveSessionTokenMock.mockResolvedValueOnce({
      uid: 'session-user',
      decodedToken: {
        uid: 'session-user',
        email: 'admin1@voiceflow.local',
        name: 'Admin',
        picture: null,
        email_verified: true,
      },
      userRef: { id: 'session-user' },
      userData: {
        uid: 'session-user',
        email: 'admin1@voiceflow.local',
        displayName: 'Admin',
        photoURL: null,
        emailVerified: true,
      },
      userExists: true,
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
    expect(resolveSessionTokenMock).toHaveBeenCalledWith('session-cookie-token');
  });
});
