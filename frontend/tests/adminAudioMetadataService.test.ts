import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAuthFetch } = vi.hoisted(() => ({
  mockAuthFetch: vi.fn(),
}));

vi.mock('../services/authHttpClient', () => ({
  authFetch: mockAuthFetch,
}));

vi.mock('../src/shared/api/httpClient', () => ({
  parseResponseError: async (response: Response) => new Error(`HTTP ${response.status}`),
  readJsonOrThrow: async <T>(response: Response) => response.json() as Promise<T>,
}));

vi.mock('../src/shared/api/config', () => ({
  resolveApiBaseUrl: (input?: string) => input || 'http://backend.test',
}));

import { exportAdminAudioMetadataCsv, fetchAdminAudioMetadata } from '../services/adminService';

describe('admin audio metadata service', () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
  });

  it('serializes audio metadata filters for list requests', async () => {
    mockAuthFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, items: [], count: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await fetchAdminAudioMetadata('http://backend.test', {
      uid: 'uid_1',
      userId: 'user_1',
      identityValue: 'user@example.com',
      paymentRef: 'pi_123',
      status: 'completed',
      engine: 'GEM',
      from: '2026-03-01',
      to: '2026-03-07',
      cursor: 'cursor_1',
      limit: 50,
    });

    expect(mockAuthFetch).toHaveBeenCalledWith(
      'http://backend.test/admin/audio-metadata/records?uid=uid_1&userId=user_1&identityValue=user%40example.com&paymentRef=pi_123&status=completed&engine=GEM&from=2026-03-01&to=2026-03-07&cursor=cursor_1&limit=50',
      undefined,
      { requireAuth: true }
    );
  });

  it('serializes export filters and returns the CSV blob', async () => {
    mockAuthFetch.mockResolvedValue(
      new Response('auditId,uid\n1,user_1\n', {
        status: 200,
        headers: { 'Content-Type': 'text/csv' },
      })
    );

    const blob = await exportAdminAudioMetadataCsv('http://backend.test', {
      uid: 'uid_1',
      status: 'failed',
      engine: 'KOKORO',
    });

    expect(mockAuthFetch).toHaveBeenCalledWith(
      'http://backend.test/admin/audio-metadata/export.csv?uid=uid_1&status=failed&engine=KOKORO',
      undefined,
      { requireAuth: true }
    );
    await expect(blob.text()).resolves.toContain('auditId,uid');
  });
});
