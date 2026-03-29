import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authFetchMock } = vi.hoisted(() => ({
  authFetchMock: vi.fn(),
}));

vi.mock('../services/authHttpClient', () => ({
  authFetch: authFetchMock,
}));

import {
  fetchAdminVoiceCloneProvider,
  patchAdminVoiceCloneProvider,
} from '../services/adminService';
import { resolveApiBaseUrl } from '../src/shared/api/config';

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('admin voice clone provider service', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  const resolvedBaseUrl = resolveApiBaseUrl('http://127.0.0.1:7800');

  it('reads the active provider from the admin endpoint', async () => {
    authFetchMock.mockResolvedValue(jsonResponse({
      ok: true,
      activeProvider: 'cloud_run',
      defaultProvider: 'cloud_run',
      revision: 3,
    }));

    const payload = await fetchAdminVoiceCloneProvider('http://127.0.0.1:7800');

    expect(payload).toMatchObject({
      ok: true,
      activeProvider: 'cloud_run',
      defaultProvider: 'cloud_run',
      revision: 3,
    });
    expect(authFetchMock).toHaveBeenCalledWith(
      `${resolvedBaseUrl}/admin/voice-clone/provider`,
      undefined,
      expect.objectContaining({ requireAuth: true })
    );
  });

  it('patches the active provider with the expected payload shape', async () => {
    authFetchMock.mockResolvedValue(jsonResponse({
      ok: true,
      activeProvider: 'modal',
      defaultProvider: 'cloud_run',
      revision: 4,
    }));

    const payload = await patchAdminVoiceCloneProvider(
      { activeProvider: 'modal' },
      'http://127.0.0.1:7800'
    );

    expect(payload).toMatchObject({
      ok: true,
      activeProvider: 'modal',
      defaultProvider: 'cloud_run',
      revision: 4,
    });
    expect(authFetchMock).toHaveBeenCalledWith(
      `${resolvedBaseUrl}/admin/voice-clone/provider`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ activeProvider: 'modal' }),
      }),
      { requireAuth: true }
    );
  });
});
