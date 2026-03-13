import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authFetchMock } = vi.hoisted(() => ({
  authFetchMock: vi.fn(),
}));

vi.mock('../services/authHttpClient', () => ({
  authFetch: authFetchMock,
}));

import {
  ADMIN_READ_TIMEOUT_MS,
  fetchAdminAccountingSummary,
  fetchAdminUsers,
  patchAdminUser,
} from '../services/adminService';

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('adminService read timeouts', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  it('applies the admin read timeout to users list requests', async () => {
    authFetchMock.mockResolvedValue(jsonResponse({ users: [] }));

    await fetchAdminUsers('http://127.0.0.1:7800', { limit: 20 });

    expect(authFetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:7800/admin/users?limit=20',
      undefined,
      expect.objectContaining({
        requireAuth: true,
        timeoutMs: ADMIN_READ_TIMEOUT_MS,
      })
    );
  });

  it('keeps write requests on their existing auth settings', async () => {
    authFetchMock.mockResolvedValue(jsonResponse({ entitlements: {} }));

    await patchAdminUser('uid_1', { plan: 'Pro' }, 'http://127.0.0.1:7800');

    expect(authFetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:7800/admin/users/uid_1',
      expect.objectContaining({ method: 'PATCH' }),
      { requireAuth: true }
    );
  });

  it('applies the admin read timeout to accounting summary requests', async () => {
    authFetchMock.mockResolvedValue(jsonResponse({ summary: {} }));

    await fetchAdminAccountingSummary('http://127.0.0.1:7800', { from: '2026-03-01', to: '2026-03-13' });

    expect(authFetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:7800/admin/accounting/summary?from=2026-03-01&to=2026-03-13',
      undefined,
      expect.objectContaining({
        requireAuth: true,
        timeoutMs: ADMIN_READ_TIMEOUT_MS,
      })
    );
  });
});
