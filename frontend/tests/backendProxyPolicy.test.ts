import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyFirebaseRequestMock = vi.hoisted(() => vi.fn(async () => ({ uid: 'user-1' })));

vi.mock('../src/server/auth/requestAuth', () => ({
  verifyFirebaseRequest: (...args: unknown[]) => verifyFirebaseRequestMock(...args),
}));

import { proxyBackendRequest } from '../app/api/backend/proxy';

interface EnvSnapshot {
  VF_MEDIA_BACKEND_URL?: string;
  VF_MEDIA_BACKEND_ORIGINS_JSON?: string;
  VF_BACKEND_PROXY_ALLOWLIST?: string;
  VF_BACKEND_PROXY_MUTATION_ALLOWLIST?: string;
  NODE_ENV?: string;
}

const createRequest = (input: {
  method?: string;
  url?: string;
  headers?: HeadersInit;
  body?: ReadableStream<Uint8Array> | null;
} = {}): NextRequest => {
  return {
    method: input.method || 'GET',
    headers: new Headers(input.headers),
    body: input.body ?? null,
    nextUrl: new URL(input.url || 'https://v-flow-ai.local/api/backend/tts/v2/jobs'),
  } as unknown as NextRequest;
};

let envSnapshot: EnvSnapshot = {};

describe('backend proxy header policy', () => {
  beforeEach(() => {
    envSnapshot = {
      VF_MEDIA_BACKEND_URL: process.env.VF_MEDIA_BACKEND_URL,
      VF_MEDIA_BACKEND_ORIGINS_JSON: process.env.VF_MEDIA_BACKEND_ORIGINS_JSON,
      VF_BACKEND_PROXY_ALLOWLIST: process.env.VF_BACKEND_PROXY_ALLOWLIST,
      VF_BACKEND_PROXY_MUTATION_ALLOWLIST: process.env.VF_BACKEND_PROXY_MUTATION_ALLOWLIST,
      NODE_ENV: process.env.NODE_ENV,
    };
    process.env.VF_MEDIA_BACKEND_URL = 'http://127.0.0.1:7800';
    delete process.env.VF_MEDIA_BACKEND_ORIGINS_JSON;
    delete process.env.VF_BACKEND_PROXY_ALLOWLIST;
    delete process.env.VF_BACKEND_PROXY_MUTATION_ALLOWLIST;
  });

  afterEach(() => {
    if (envSnapshot.VF_MEDIA_BACKEND_URL === undefined) delete process.env.VF_MEDIA_BACKEND_URL;
    else process.env.VF_MEDIA_BACKEND_URL = envSnapshot.VF_MEDIA_BACKEND_URL;
    if (envSnapshot.VF_MEDIA_BACKEND_ORIGINS_JSON === undefined) delete process.env.VF_MEDIA_BACKEND_ORIGINS_JSON;
    else process.env.VF_MEDIA_BACKEND_ORIGINS_JSON = envSnapshot.VF_MEDIA_BACKEND_ORIGINS_JSON;
    if (envSnapshot.VF_BACKEND_PROXY_ALLOWLIST === undefined) delete process.env.VF_BACKEND_PROXY_ALLOWLIST;
    else process.env.VF_BACKEND_PROXY_ALLOWLIST = envSnapshot.VF_BACKEND_PROXY_ALLOWLIST;
    if (envSnapshot.VF_BACKEND_PROXY_MUTATION_ALLOWLIST === undefined) delete process.env.VF_BACKEND_PROXY_MUTATION_ALLOWLIST;
    else process.env.VF_BACKEND_PROXY_MUTATION_ALLOWLIST = envSnapshot.VF_BACKEND_PROXY_MUTATION_ALLOWLIST;
    if (envSnapshot.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = envSnapshot.NODE_ENV;
    vi.unstubAllGlobals();
    verifyFirebaseRequestMock.mockResolvedValue({ uid: 'user-1' });
    vi.clearAllMocks();
  });

  it('forwards only allowlisted headers and strips spoofed transport headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const request = createRequest({
      method: 'POST',
      url: 'https://v-flow-ai.local/api/backend/tts/v2/jobs?trace=1',
      headers: {
        authorization: 'Bearer token',
        cookie: 'session=abc',
        'content-type': 'application/json',
        'idempotency-key': 'idem-123',
        'x-vf-tts-session-key': 'session-key',
        'x-forwarded-for': '203.0.113.10',
        'x-forwarded-host': 'evil.example',
        'x-dev-uid': 'spoofed-user',
        'x-real-ip': '198.51.100.1',
        'x-user-id': 'spoofed-id',
        'x-custom-header': 'drop-me',
      },
    });

    const response = await proxyBackendRequest(request, ['tts', 'v2', 'jobs']);
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(target)).toBe('http://127.0.0.1:7800/tts/v2/jobs?trace=1');

    const forwarded = new Headers(init.headers);
    expect(forwarded.get('authorization')).toBe('Bearer token');
    expect(forwarded.get('cookie')).toBe('session=abc');
    expect(forwarded.get('content-type')).toBe('application/json');
    expect(forwarded.get('idempotency-key')).toBe('idem-123');
    expect(forwarded.get('x-vf-tts-session-key')).toBe('session-key');
    expect(forwarded.has('x-forwarded-for')).toBe(false);
    expect(forwarded.has('x-forwarded-host')).toBe(false);
    expect(forwarded.has('x-dev-uid')).toBe(false);
    expect(forwarded.has('x-real-ip')).toBe(false);
    expect(forwarded.has('x-user-id')).toBe(false);
    expect(forwarded.has('x-custom-header')).toBe(false);
  });

  it('does not treat x-dev-uid as authenticated context for unsafe methods', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    verifyFirebaseRequestMock.mockRejectedValueOnce(new Error('Missing authorization'));

    const response = await proxyBackendRequest(
      createRequest({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-uid': 'spoofed-user',
        },
      }),
      ['tts', 'v2', 'jobs']
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows public routing region reads through the proxy allowlist', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ regions: ['us-central1', 'europe-west1'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const response = await proxyBackendRequest(
      createRequest({
        method: 'GET',
        url: 'https://v-flow-ai.local/api/backend/routing/regions?source=studio',
      }),
      ['routing', 'regions']
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(target)).toBe('http://127.0.0.1:7800/routing/regions?source=studio');
  });

  it('allows authenticated AI generation writes through the proxy allowlist', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: '{"ok":true}' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const response = await proxyBackendRequest(
      createRequest({
        method: 'POST',
        url: 'https://v-flow-ai.local/api/backend/ai/generate-text',
        headers: {
          authorization: 'Bearer token',
          'content-type': 'application/json',
        },
      }),
      ['ai', 'generate-text']
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(target)).toBe('http://127.0.0.1:7800/ai/generate-text');
  });

  it('rejects unsafe writes when bearer or cookie headers are present but Firebase verification fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    verifyFirebaseRequestMock.mockRejectedValueOnce(new Error('Invalid session cookie'));

    const response = await proxyBackendRequest(
      createRequest({
        method: 'POST',
        url: 'https://v-flow-ai.local/api/backend/admin/voice-clone/provider',
        headers: {
          authorization: 'Bearer invalid-token',
          cookie: '__session=bad-cookie',
          'content-type': 'application/json',
        },
      }),
      ['admin', 'voice-clone', 'provider']
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a structured 502 response when the upstream backend fetch throws', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const response = await proxyBackendRequest(
      createRequest({
        method: 'POST',
        headers: {
          authorization: 'Bearer token',
          'content-type': 'application/json',
        },
      }),
      ['voice-clone', 'openvoice', 'separate']
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      detail: expect.stringContaining('/voice-clone/openvoice/separate'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed in production when no compatibility backend is configured', async () => {
    delete process.env.VF_MEDIA_BACKEND_URL;
    delete process.env.VF_MEDIA_BACKEND_ORIGINS_JSON;
    process.env.NODE_ENV = 'production';

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const response = await proxyBackendRequest(
      createRequest({
        method: 'GET',
        url: 'https://v-flow-ai.local/api/backend/tts/v2/jobs',
      }),
      ['tts', 'v2', 'jobs']
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      detail: expect.stringContaining('require VF_MEDIA_BACKEND_URL'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects loopback compatibility backend origins in production', async () => {
    process.env.VF_MEDIA_BACKEND_URL = 'http://127.0.0.1:7800';
    process.env.NODE_ENV = 'production';

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const response = await proxyBackendRequest(
      createRequest({
        method: 'GET',
        url: 'https://v-flow-ai.local/api/backend/routing/regions',
      }),
      ['routing', 'regions']
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      detail: expect.stringContaining('cannot use localhost or loopback origins'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('chooses the healthiest configured regional origin for safe requests', async () => {
    process.env.VF_MEDIA_BACKEND_ORIGINS_JSON = JSON.stringify({
      'asia-southeast1': 'https://asia.api.example',
      'europe-west1': 'https://eu.api.example',
      'us-central1': 'https://us.api.example',
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://asia.api.example/health') {
        return new Response('down', { status: 503 });
      }
      if (url === 'https://eu.api.example/health' || url === 'https://us.api.example/health') {
        return new Response('ok', { status: 200 });
      }
      if (url === 'https://eu.api.example/tts/voice-profiles/demo.wav') {
        return new Response('image', { status: 200, headers: { 'content-type': 'image/png' } });
      }
      throw new Error(`Unexpected fetch target: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const response = await proxyBackendRequest(
      createRequest({
        method: 'GET',
        url: 'https://v-flow-ai.com/api/backend/tts/voice-profiles/demo.wav',
        headers: {
          'cf-ipcountry': 'IN',
        },
      }),
      ['tts', 'voice-profiles', 'demo.wav']
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-v-flow-ai-backend-region')).toBe('europe-west1');
    expect(response.headers.get('x-v-flow-ai-backend-origin')).toBe('https://eu.api.example');
  });

  it('allows admin stress routes and still strips spoofed x-dev-uid header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const response = await proxyBackendRequest(
      createRequest({
        method: 'POST',
        url: 'https://v-flow-ai.local/api/backend/admin/voice-clone/stress/start?trace=stress',
        headers: {
          authorization: 'Bearer token',
          'content-type': 'application/json',
          'x-dev-uid': 'spoofed-admin',
        },
      }),
      ['admin', 'voice-clone', 'stress', 'start']
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(target)).toBe('http://127.0.0.1:7800/admin/voice-clone/stress/start?trace=stress');
    const forwarded = new Headers(init.headers);
    expect(forwarded.get('authorization')).toBe('Bearer token');
    expect(forwarded.get('content-type')).toBe('application/json');
    expect(forwarded.has('x-dev-uid')).toBe(false);
  });

  it('allows admin voice clone provider routes and strips spoofed x-dev-uid header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const response = await proxyBackendRequest(
      createRequest({
        method: 'PATCH',
        url: 'https://v-flow-ai.local/api/backend/admin/voice-clone/provider',
        headers: {
          authorization: 'Bearer token',
          'content-type': 'application/json',
          'x-dev-uid': 'spoofed-admin',
        },
      }),
      ['admin', 'voice-clone', 'provider']
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(target)).toBe('http://127.0.0.1:7800/admin/voice-clone/provider');
    const forwarded = new Headers(init.headers);
    expect(forwarded.get('authorization')).toBe('Bearer token');
    expect(forwarded.get('content-type')).toBe('application/json');
    expect(forwarded.has('x-dev-uid')).toBe(false);
  });
});

