import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const originalDevUid = process.env.VF_DEV_UID_HEADER_ENABLED;

const buildRequest = (path: string, init: RequestInit & { headers?: HeadersInit } = {}): NextRequest => {
  return new NextRequest(`http://127.0.0.1:3000${path}`, {
    ...init,
    headers: {
      'x-dev-uid': 'admin_uid_1',
      ...(init.headers || {}),
    },
  });
};

describe('studio engine runtime routes', () => {
  beforeEach(() => {
    process.env.VF_DEV_UID_HEADER_ENABLED = '1';
  });

  afterEach(() => {
    if (originalDevUid === undefined) delete process.env.VF_DEV_UID_HEADER_ENABLED;
    else process.env.VF_DEV_UID_HEADER_ENABLED = originalDevUid;
    vi.resetModules();
  });

  it('serves native engine status and activation without the legacy backend', async () => {
    const { handleStudioEngineStatusRoute, handleStudioEngineActivateRoute } = await import('../src/server/studio/service');

    const statusResponse = await handleStudioEngineStatusRoute(
      buildRequest('/api/v1/studio/tts/engines/status?engine=all')
    );
    expect(statusResponse.status).toBe(200);
    await expect(statusResponse.json()).resolves.toMatchObject({
      ok: true,
      engines: expect.objectContaining({
        VECTOR: expect.objectContaining({
          healthUrl: expect.stringContaining('/api/v1/studio/tts/engines/status'),
        }),
        PRIME: expect.objectContaining({
          runtimeUrl: expect.stringContaining('/api/v1/studio/tts/synthesize'),
        }),
      }),
    });

    const activateResponse = await handleStudioEngineActivateRoute(
      buildRequest('/api/v1/studio/tts/engines/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ engine: 'PRIME' }),
      })
    );
    expect(activateResponse.status).toBe(200);
    await expect(activateResponse.json()).resolves.toMatchObject({
      ok: true,
      engine: 'PRIME',
      healthUrl: expect.stringContaining('/api/v1/studio/tts/engines/status'),
      gpuMode: false,
    });
  }, 15_000);
});
