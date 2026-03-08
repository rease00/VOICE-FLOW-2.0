import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultApiBaseUrl, resolveApiBaseUrl, sanitizeConfiguredApiBaseUrl } from './config';

const originalWindow = globalThis.window;

const setWindowLocation = (origin: string) => {
  const target = new URL(origin);
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        origin: target.origin,
        protocol: target.protocol,
        hostname: target.hostname,
      },
    },
  });
};

afterEach(() => {
  vi.unstubAllEnvs();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
});

describe('api config', () => {
  it('uses the hosted origin by default when the app is running remotely', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    setWindowLocation('https://app.voiceflow.example');

    expect(getDefaultApiBaseUrl()).toBe('https://app.voiceflow.example');
  });

  it('heals stale localhost overrides on hosted deployments', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    setWindowLocation('https://app.voiceflow.example');

    expect(resolveApiBaseUrl('http://127.0.0.1:7800')).toBe('https://app.voiceflow.example');
    expect(sanitizeConfiguredApiBaseUrl('localhost:7800', 'http://127.0.0.1:7800').value).toBe('https://app.voiceflow.example');
  });

  it('keeps localhost overrides during local development', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    setWindowLocation('http://localhost:5173');

    expect(resolveApiBaseUrl('http://127.0.0.1:7800')).toBe('http://127.0.0.1:7800');
  });

  it('preserves explicit remote backends', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    setWindowLocation('https://app.voiceflow.example');

    expect(resolveApiBaseUrl('https://api.voiceflow.example')).toBe('https://api.voiceflow.example');
  });
});
