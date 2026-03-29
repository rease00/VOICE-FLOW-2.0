import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authFetchMock } = vi.hoisted(() => ({
  authFetchMock: vi.fn(),
}));

vi.mock('../services/authHttpClient', () => ({
  authFetch: authFetchMock,
}));

import {
  ADMIN_READ_TIMEOUT_MS,
  createAdminNotice,
  deleteAdminNotice,
  fetchAdminNotices,
} from '../services/adminService';
import { resolveApiBaseUrl } from '../src/shared/api/config';

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('admin notice service', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  const resolvedBaseUrl = resolveApiBaseUrl('http://127.0.0.1:7800');

  it('applies the admin read timeout to notice list requests', async () => {
    authFetchMock.mockResolvedValue(jsonResponse({ items: [] }));

    await fetchAdminNotices('http://127.0.0.1:7800');

    expect(authFetchMock).toHaveBeenCalledWith(
      `${resolvedBaseUrl}/admin/notices`,
      undefined,
      expect.objectContaining({
        requireAuth: true,
        timeoutMs: ADMIN_READ_TIMEOUT_MS,
      })
    );
  });

  it('posts new admin notices to the notices collection', async () => {
    authFetchMock.mockResolvedValue(jsonResponse({ notice: { id: 'notice_1' } }));

    await createAdminNotice(
      {
        title: 'Maintenance',
        message: 'We will be down for 10 minutes.',
        severity: 'warning',
        expiresAt: '2026-03-27T18:00:00.000Z',
      },
      'http://127.0.0.1:7800'
    );

    expect(authFetchMock).toHaveBeenCalledWith(
      `${resolvedBaseUrl}/admin/notices`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          title: 'Maintenance',
          message: 'We will be down for 10 minutes.',
          severity: 'warning',
          expiresAt: '2026-03-27T18:00:00.000Z',
        }),
      }),
      { requireAuth: true }
    );
  });

  it('deletes notices by id', async () => {
    authFetchMock.mockResolvedValue(new Response('', { status: 200 }));

    await deleteAdminNotice('notice_1', 'http://127.0.0.1:7800');

    expect(authFetchMock).toHaveBeenCalledWith(
      `${resolvedBaseUrl}/admin/notices/notice_1`,
      expect.objectContaining({ method: 'DELETE' }),
      { requireAuth: true }
    );
  });
});
