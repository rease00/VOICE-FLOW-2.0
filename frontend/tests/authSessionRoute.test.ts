import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const verifyIdTokenMock = vi.hoisted(() => vi.fn(async () => ({ uid: 'user-1' })));
const createSessionCookieMock = vi.hoisted(() => vi.fn(async () => 'session-cookie-value'));

vi.mock('../src/server/firebaseAdmin', () => ({
  getFirebaseAdminAuth: () => ({
    verifyIdToken: (...args: unknown[]) => verifyIdTokenMock(...args),
    createSessionCookie: (...args: unknown[]) => createSessionCookieMock(...args),
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
    expect(setCookie).toContain('__session=session-cookie-value');
    expect(setCookie).not.toContain('Secure');
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
    expect(setCookie).toContain('__session=session-cookie-value');
    expect(setCookie).toContain('Secure');
  });

  it('omits the Secure flag when deleting localhost production QA cookies over http', async () => {
    const { DELETE } = await import('../app/api/auth/session/route');
    const response = await DELETE(
      buildRequest('http://127.0.0.1:3000/api/auth/session', {}, 'DELETE'),
    );

    expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie') || '';
    expect(setCookie).toContain('__session=');
    expect(setCookie).not.toContain('Secure');
  });

  it('keeps the Secure flag when deleting public https cookies', async () => {
    const { DELETE } = await import('../app/api/auth/session/route');
    const response = await DELETE(
      buildRequest(
        'https://app.voiceflow.local/api/auth/session',
        {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'app.voiceflow.local',
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
