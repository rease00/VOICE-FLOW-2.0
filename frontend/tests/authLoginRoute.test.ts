import { afterEach, describe, expect, it, vi } from 'vitest';

const loginWithEmailAndPasswordMock = vi.hoisted(() => vi.fn());
const ensureAdminSeedsMock = vi.hoisted(() => vi.fn());

vi.mock('../src/server/auth/d1Auth', () => ({
  D1AuthError: class D1AuthError extends Error {
    code: string;
    status: number;

    constructor(message: string, code = 'auth/error', status = 401) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
  getD1AuthService: () => ({
    ensureAdminSeeds: (...args: unknown[]) => ensureAdminSeedsMock(...args),
    loginWithEmailAndPassword: (...args: unknown[]) => loginWithEmailAndPasswordMock(...args),
  }),
}));

describe('/api/auth/login', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns a D1 session token and user payload on successful email login', async () => {
    loginWithEmailAndPasswordMock.mockResolvedValueOnce({
      uid: 'admin-1',
      token: 'session-token-123',
      user: {
        email: 'admin1@example.com',
        displayName: 'Admin One',
        photoURL: null,
        emailVerified: true,
      },
    });

    const { POST } = await import('../app/api/auth/login/route');
    const response = await POST(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'admin1@example.com',
          password: 'secret-password',
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Login successful',
      uid: 'admin-1',
      token: 'session-token-123',
      user: {
        email: 'admin1@example.com',
        displayName: 'Admin One',
        photoURL: null,
      },
    });
    expect(ensureAdminSeedsMock).toHaveBeenCalledTimes(1);
    expect(loginWithEmailAndPasswordMock).toHaveBeenCalledWith('admin1@example.com', 'secret-password');
  });

  it('returns a credential error when the D1 login rejects', async () => {
    const error = Object.assign(new Error('Invalid credentials'), { code: 'auth/wrong-password' });
    loginWithEmailAndPasswordMock.mockRejectedValueOnce(error);

    const { POST } = await import('../app/api/auth/login/route');
    const response = await POST(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'admin1@example.com',
          password: 'wrong',
        }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid credentials',
      code: 'auth/wrong-password',
    });
  });
});
