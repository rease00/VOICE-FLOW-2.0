import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authFetchMock } = vi.hoisted(() => ({
  authFetchMock: vi.fn(),
}));

vi.mock('../services/authHttpClient', () => ({
  authFetch: authFetchMock,
}));

import {
  ADMIN_READ_TIMEOUT_MS,
  fetchAdminDashboardSummary,
  fetchAdminAccountingSummary,
  fetchAdminSupportQueues,
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
      '/api/v1/admin/users?limit=20',
      undefined,
      {
        requireAuth: true,
        timeoutMs: ADMIN_READ_TIMEOUT_MS,
      }
    );
  });

  it('keeps write requests on their existing auth settings', async () => {
    authFetchMock.mockResolvedValue(jsonResponse({ entitlements: {} }));

    await patchAdminUser('uid_1', { plan: 'Pro' }, 'http://127.0.0.1:7800');

    expect(authFetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/users/uid_1',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'Pro' }),
      },
      { requireAuth: true }
    );
  });

  it('applies the admin read timeout to accounting summary requests', async () => {
    authFetchMock.mockResolvedValue(jsonResponse({ summary: {} }));

    await fetchAdminAccountingSummary('http://127.0.0.1:7800', { from: '2026-03-01', to: '2026-03-13' });

    expect(authFetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/accounting/summary?from=2026-03-01&to=2026-03-13',
      undefined,
      {
        requireAuth: true,
        timeoutMs: ADMIN_READ_TIMEOUT_MS,
      }
    );
  });

  it('normalizes admin-shaped base urls back to the canonical v1 root', async () => {
    authFetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, health: {}, spending: {}, support: {}, incidents: [], anomalies: [], recentRiskyActions: [] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, queues: [] }));

    await fetchAdminDashboardSummary('/api/v1/admin');
    await fetchAdminSupportQueues('/api/backend/admin');

    expect(authFetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/admin/dashboard/summary',
      undefined,
      {
        requireAuth: true,
        timeoutMs: ADMIN_READ_TIMEOUT_MS,
      }
    );
    expect(authFetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/admin/support/queues',
      undefined,
      {
        requireAuth: true,
        timeoutMs: ADMIN_READ_TIMEOUT_MS,
      }
    );
  });
});
