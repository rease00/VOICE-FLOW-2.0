import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const originalDevUid = process.env.VF_DEV_UID_HEADER_ENABLED;
const originalMode = process.env.VF_ADMIN_OPS_MODE;

const buildRequest = (path: string, init: RequestInit & { headers?: HeadersInit } = {}): NextRequest => {
  return new NextRequest(`http://127.0.0.1:3000${path}`, {
    ...init,
    headers: {
      'x-dev-uid': 'admin_uid_1',
      'x-dev-admin': '1',
      ...(init.headers || {}),
    },
  });
};

describe('admin and ops native routes', () => {
  beforeEach(() => {
    process.env.VF_DEV_UID_HEADER_ENABLED = '1';
    process.env.VF_ADMIN_OPS_MODE = 'native';
  });

  afterEach(() => {
    if (originalDevUid === undefined) delete process.env.VF_DEV_UID_HEADER_ENABLED;
    else process.env.VF_DEV_UID_HEADER_ENABLED = originalDevUid;
    if (originalMode === undefined) delete process.env.VF_ADMIN_OPS_MODE;
    else process.env.VF_ADMIN_OPS_MODE = originalMode;
    vi.resetModules();
  });

  it('serves actor and ops guardian status from the native dispatcher', async () => {
    const { handleAdminRoute, handleOpsRoute } = await import('../src/server/admin/service');

    const actorResponse = await handleAdminRoute(
      buildRequest('/api/v1/admin/actor'),
      ['actor']
    );
    expect(actorResponse.status).toBe(200);
    await expect(actorResponse.json()).resolves.toMatchObject({
      ok: true,
      actor: expect.objectContaining({
        uid: 'admin_uid_1',
        role: 'super_admin',
      }),
    });

    const opsResponse = await handleOpsRoute(
      buildRequest('/api/v1/ops/guardian/status?include_route_stats=1'),
      ['guardian', 'status']
    );
    expect(opsResponse.status).toBe(200);
    await expect(opsResponse.json()).resolves.toMatchObject({
      ok: true,
      routeStats: expect.objectContaining({
        adminNative: true,
        opsNative: true,
      }),
    });
  }, 15_000);

  it('supports native session unlock and notice creation', async () => {
    const { handleAdminRoute } = await import('../src/server/admin/service');

    const issueResponse = await handleAdminRoute(
      buildRequest('/api/v1/admin/session-unlock/issue', { method: 'POST' }),
      ['session-unlock', 'issue']
    );
    expect(issueResponse.status).toBe(200);
    const issued = await issueResponse.json() as { unlockKey?: string };
    expect(issued.unlockKey).toBeTruthy();

    const verifyResponse = await handleAdminRoute(
      buildRequest('/api/v1/admin/session-unlock/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ unlockKey: issued.unlockKey }),
      }),
      ['session-unlock', 'verify']
    );
    expect(verifyResponse.status).toBe(200);
    const verified = await verifyResponse.json() as { unlockToken?: string };
    expect(verified.unlockToken).toBeTruthy();

    const createNoticeResponse = await handleAdminRoute(
      buildRequest('/api/v1/admin/notices', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-admin-unlock': `Bearer ${verified.unlockToken}`,
        },
        body: JSON.stringify({
          title: 'Maintenance',
          message: 'Brief maintenance window',
          expiresAt: '2026-05-01T00:00:00.000Z',
        }),
      }),
      ['notices']
    );
    expect(createNoticeResponse.status).toBe(200);
    await expect(createNoticeResponse.json()).resolves.toMatchObject({
      notice: expect.objectContaining({
        title: 'Maintenance',
        message: 'Brief maintenance window',
      }),
    });
  }, 15_000);

  it('serves the solo dashboard summary and native feature flags', async () => {
    const { handleAdminRoute } = await import('../src/server/admin/service');

    const summaryResponse = await handleAdminRoute(
      buildRequest('/api/v1/admin/dashboard/summary'),
      ['dashboard', 'summary']
    );
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      summary: expect.objectContaining({
        generatedAt: expect.any(String),
        health: expect.objectContaining({
          status: expect.any(String),
        }),
        support: expect.objectContaining({
          backlog: expect.any(Number),
        }),
      }),
    });

    const flagsResponse = await handleAdminRoute(
      buildRequest('/api/v1/admin/feature-flags'),
      ['feature-flags']
    );
    expect(flagsResponse.status).toBe(200);
    const flagsPayload = await flagsResponse.json() as { items?: Array<{ key: string }> };
    expect(Array.isArray(flagsPayload.items)).toBe(true);
    expect(flagsPayload.items?.some((item) => item.key === 'maintenance_mode')).toBe(true);
  }, 15_000);
});
