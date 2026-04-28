import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const resolveSessionTokenMock = vi.hoisted(() => vi.fn(async () => ({
  uid: 'user-1',
  decodedToken: { uid: 'user-1' },
  userRef: { id: 'user-1' },
  userData: { uid: 'user-1' },
  userExists: true,
})));
const revokeSessionTokenMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock('../src/server/auth/d1Auth', () => ({
  getD1AuthService: () => ({
    resolveSessionToken: (token: string) => (resolveSessionTokenMock as unknown as (value: string) => unknown)(token),
    revokeSessionToken: (token: string) => (revokeSessionTokenMock as unknown as (value: string) => unknown)(token),
  }),
}));

const buildRequest = (
  url: string,
  headers: HeadersInit = {},
  method: 'POST' | 'DELETE' = 'POST',
): NextRequest => new NextRequest(url, {
  method,
  headers,
});

describe('auth session route cookie policy', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    vi.resetModules();
  });

  it('omits the Secure flag for localhost production QA requests over http', async () => {
    const { POST } = await import('../app/api/auth/session/route');
    const response = await POST(buildRequest('http://127.0.0.1:3000/api/auth/session', {
      authorization: 'Bearer token-123',
    }));

    expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie') || '';
    expect(setCookie).toContain('__session=token-123');
    expect(setCookie).not.toContain('Secure');
    expect(resolveSessionTokenMock).toHaveBeenCalledWith('token-123');
  });

  it('keeps the Secure flag for public https requests', async () => {
    const { POST } = await import('../app/api/auth/session/route');
    const response = await POST(buildRequest('https://app.voiceflow.local/api/auth/session', {
      authorization: 'Bearer token-123',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'app.voiceflow.local',
    }));

    expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie') || '';
    expect(setCookie).toContain('__session=token-123');
    expect(setCookie).toContain('Secure');
  });

  it('omits the Secure flag when deleting localhost production QA cookies over http', async () => {
    const { DELETE } = await import('../app/api/auth/session/route');
    const response = await DELETE(
      buildRequest('http://127.0.0.1:3000/api/auth/session', {
        cookie: '__session=token-123',
      }, 'DELETE'),
    );

    expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie') || '';
    expect(setCookie).toContain('__session=');
    expect(setCookie).not.toContain('Secure');
    expect(revokeSessionTokenMock).toHaveBeenCalledWith('token-123');
  });

  it('keeps the Secure flag when deleting public https cookies', async () => {
    const { DELETE } = await import('../app/api/auth/session/route');
    const response = await DELETE(
      buildRequest(
        'https://app.voiceflow.local/api/auth/session',
        {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'app.voiceflow.local',
          cookie: '__session=token-123',
        },
        'DELETE',
      ),
    );

    expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie') || '';
    expect(setCookie).toContain('__session=');
    expect(setCookie).toContain('Secure');
  });
});
