import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authFetchMock } = vi.hoisted(() => ({
  authFetchMock: vi.fn(),
}));

vi.mock('../services/authHttpClient', () => ({
  authFetch: authFetchMock,
}));

import { requestJson, requestPublicJson } from '../src/shared/api/httpClient';

const originalFetch = globalThis.fetch;

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  authFetchMock.mockReset();
});

afterEach(() => {
  authFetchMock.mockReset();
  globalThis.fetch = originalFetch;
});

describe('httpClient public request path', () => {
  it('uses native fetch for public JSON requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await requestPublicJson<{ ok: boolean }>('/health', undefined, {
      baseUrl: 'http://127.0.0.1:8000',
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authFetchMock).not.toHaveBeenCalled();
  });

  it('continues using authFetch for protected JSON requests', async () => {
    authFetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    const result = await requestJson<{ ok: boolean }>('/protected', undefined, {
      baseUrl: 'http://127.0.0.1:8000',
      requireAuth: true,
    });

    expect(result.ok).toBe(true);
    expect(authFetchMock).toHaveBeenCalledTimes(1);
  });
});
