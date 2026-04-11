import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestJsonMock = vi.hoisted(() => vi.fn());

vi.mock('../src/shared/api/httpClient', () => ({
  requestBlob: vi.fn(),
  requestJson: (...args: unknown[]) => requestJsonMock(...args),
  requestPublicJson: vi.fn(),
}));

describe('switchTtsEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestJsonMock.mockResolvedValue({
      ok: true,
      engine: 'PRIME',
      state: 'starting',
      detail: 'Runtime starting in background',
    });
  });

  it('forwards X-Admin-Unlock when an unlock token is provided', async () => {
    const { switchTtsEngine } = await import('../src/shared/api/gatewayClient');
    await switchTtsEngine('PRIME', {
      baseUrl: 'https://backend.example.test',
      gpu: false,
      adminUnlockToken: 'unlock-token-123',
    });

    const [, init] = requestJsonMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers || {});
    expect(headers.get('X-Admin-Unlock')).toBe('Bearer unlock-token-123');
  });

  it('posts runtime activation to the non-admin endpoint', async () => {
    const { activateTtsEngine } = await import('../src/shared/api/gatewayClient');
    await activateTtsEngine('PRIME', {
      baseUrl: 'https://backend.example.test',
    });

    const [path, init] = requestJsonMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers || {});
    expect(path).toBe('/tts/engines/activate');
    expect(headers.get('X-Admin-Unlock')).toBeNull();
  });
});
