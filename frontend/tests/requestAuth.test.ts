import { afterEach, describe, expect, it, vi } from 'vitest';

const resolveRequestUserMock = vi.hoisted(() => vi.fn());
const resolveSessionTokenMock = vi.hoisted(() => vi.fn());

vi.mock('../src/server/auth/d1Auth', () => ({
  getD1AuthService: () => ({
    resolveRequestUser: (...args: unknown[]) => resolveRequestUserMock(...args),
    resolveSessionToken: (...args: unknown[]) => resolveSessionTokenMock(...args),
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
    resolveRequestUserMock.mockImplementationOnce(async (request: Request) => {
      expect(request.headers.get('cookie')).toBe('__session=session-cookie-token');
      expect(request.headers.get('authorization')).toBeNull();
      return {
        uid: 'session-user',
        decodedToken: { uid: 'session-user' },
        userRef: { id: 'session-user' },
        userData: null,
        userExists: false,
      };
    });

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

    expect(resolveRequestUserMock).toHaveBeenCalledTimes(1);
    expect(resolveRequestUserMock.mock.calls[0]?.[0]).toBeInstanceOf(Request);
    expect(resolveRequestUserMock.mock.calls[0]?.[1]).toEqual({ preferCookie: false });
  });

  it('resolves a raw session cookie explicitly through the session helper', async () => {
    resolveSessionTokenMock.mockResolvedValueOnce({
      uid: 'session-user',
      decodedToken: { uid: 'session-user' },
      userRef: { id: 'session-user' },
      userData: null,
      userExists: false,
    });

    const { verifyFirebaseSessionCookie } = await import('../src/server/auth/requestAuth');
    await expect(verifyFirebaseSessionCookie('session-cookie-token')).resolves.toMatchObject({
      uid: 'session-user',
    });

    expect(resolveSessionTokenMock).toHaveBeenCalledWith('session-cookie-token');
  });
});
