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
  it('uses the proxy backend by default when the app is running remotely', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    setWindowLocation('https://app.voiceflow.example');

    expect(getDefaultApiBaseUrl()).toBe('/api/backend');
  });

  it('heals stale localhost overrides on hosted deployments', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    setWindowLocation('https://app.voiceflow.example');

    expect(resolveApiBaseUrl('http://127.0.0.1:7800')).toBe('/api/backend');
    expect(sanitizeConfiguredApiBaseUrl('localhost:7800', 'http://127.0.0.1:7800').value).toBe('/api/backend');
  });

  it('keeps explicit local backend overrides during local development', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    setWindowLocation('http://localhost:5173');

    expect(resolveApiBaseUrl('http://127.0.0.1:7800')).toBe('http://127.0.0.1:7800');
  });

  it('uses explicit local env backend during local development', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:7800');
    setWindowLocation('http://localhost:5173');

    expect(getDefaultApiBaseUrl()).toBe('http://127.0.0.1:7800');
  });

  it('forces hosted browser sessions back onto the internal proxy for remote backends', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    setWindowLocation('https://app.voiceflow.example');

    expect(resolveApiBaseUrl('https://api.voiceflow.example')).toBe('/api/backend');
  });

  it('heals stale localhost overrides to the configured remote backend when one is set', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.voiceflow.example');
    setWindowLocation('https://voiceflow-demo.pages.dev');

    expect(resolveApiBaseUrl('http://127.0.0.1:7800')).toBe('/api/backend');
    expect(sanitizeConfiguredApiBaseUrl('localhost:7800', 'https://api.voiceflow.example').value).toBe('/api/backend');
  });
});
