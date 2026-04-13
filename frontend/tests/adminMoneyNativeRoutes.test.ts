import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const originalDevUid = process.env.VF_DEV_UID_HEADER_ENABLED;
const originalMode = process.env.VF_ADMIN_OPS_MODE;
const originalGcpTable = process.env.VF_ADMIN_GCP_BILLING_EXPORT_TABLE;
const originalModalUrl = process.env.VF_ADMIN_MODAL_BILLING_REPORT_URL;
const originalModalFile = process.env.VF_ADMIN_MODAL_BILLING_REPORT_FILE;

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

describe('admin money native routes', () => {
  beforeEach(() => {
    process.env.VF_DEV_UID_HEADER_ENABLED = '1';
    process.env.VF_ADMIN_OPS_MODE = 'native';
    delete process.env.VF_ADMIN_GCP_BILLING_EXPORT_TABLE;
    delete process.env.VF_ADMIN_MODAL_BILLING_REPORT_URL;
    delete process.env.VF_ADMIN_MODAL_BILLING_REPORT_FILE;
  });

  afterEach(() => {
    if (originalDevUid === undefined) delete process.env.VF_DEV_UID_HEADER_ENABLED;
    else process.env.VF_DEV_UID_HEADER_ENABLED = originalDevUid;
    if (originalMode === undefined) delete process.env.VF_ADMIN_OPS_MODE;
    else process.env.VF_ADMIN_OPS_MODE = originalMode;
    if (originalGcpTable === undefined) delete process.env.VF_ADMIN_GCP_BILLING_EXPORT_TABLE;
    else process.env.VF_ADMIN_GCP_BILLING_EXPORT_TABLE = originalGcpTable;
    if (originalModalUrl === undefined) delete process.env.VF_ADMIN_MODAL_BILLING_REPORT_URL;
    else process.env.VF_ADMIN_MODAL_BILLING_REPORT_URL = originalModalUrl;
    if (originalModalFile === undefined) delete process.env.VF_ADMIN_MODAL_BILLING_REPORT_FILE;
    else process.env.VF_ADMIN_MODAL_BILLING_REPORT_FILE = originalModalFile;
    vi.resetModules();
  });

  it('returns the finance-first money summary shape', async () => {
    const { handleAdminRoute } = await import('../src/server/admin/service');

    const response = await handleAdminRoute(
      buildRequest('/api/v1/admin/money/summary'),
      ['money', 'summary']
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      summary: expect.objectContaining({
        generatedAt: expect.any(String),
        overview: expect.objectContaining({
          availableCashInr: expect.any(Number),
          monthProviderSpendInr: expect.any(Number),
          budgetRiskState: expect.any(String),
        }),
        providers: expect.objectContaining({
          items: expect.any(Array),
        }),
        cash: expect.objectContaining({
          accounts: expect.any(Array),
        }),
        budgets: expect.objectContaining({
          items: expect.any(Array),
        }),
        runway: expect.objectContaining({
          runwayDays: expect.any(Number),
        }),
      }),
    });
  }, 15_000);

  it('syncs provider routes in degraded-safe mode when credentials are absent', async () => {
    const { handleAdminRoute } = await import('../src/server/admin/service');

    const response = await handleAdminRoute(
      buildRequest('/api/v1/admin/money/providers/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'all' }),
      }),
      ['money', 'providers', 'sync']
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      provider: 'all',
      results: expect.arrayContaining([
        expect.objectContaining({
          provider: 'gcp',
          snapshot: expect.objectContaining({
            status: expect.any(String),
          }),
        }),
        expect.objectContaining({
          provider: 'modal',
          snapshot: expect.objectContaining({
            status: expect.any(String),
          }),
        }),
      ]),
    });
  }, 15_000);

  it('persists cash inputs and budgets behind unlock-protected mutations', async () => {
    const { handleAdminRoute } = await import('../src/server/admin/service');

    const issueResponse = await handleAdminRoute(
      buildRequest('/api/v1/admin/session-unlock/issue', { method: 'POST' }),
      ['session-unlock', 'issue']
    );
    const issued = await issueResponse.json() as { unlockKey?: string };

    const verifyResponse = await handleAdminRoute(
      buildRequest('/api/v1/admin/session-unlock/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ unlockKey: issued.unlockKey }),
      }),
      ['session-unlock', 'verify']
    );
    const verified = await verifyResponse.json() as { unlockToken?: string };
    const unlockHeader = { 'x-admin-unlock': `Bearer ${verified.unlockToken}` };

    const cashResponse = await handleAdminRoute(
      buildRequest('/api/v1/admin/money/cash', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          ...unlockHeader,
        },
        body: JSON.stringify({
          accounts: [
            { accountId: 'bank_main', balanceInr: 420000, notes: 'main reserve' },
            { accountId: 'fixed_monthly_burn', balanceInr: 90000, notes: 'fixed burn' },
          ],
        }),
      }),
      ['money', 'cash']
    );
    expect(cashResponse.status).toBe(200);
    await expect(cashResponse.json()).resolves.toMatchObject({
      cash: expect.objectContaining({
        availableCashInr: expect.any(Number),
      }),
    });

    const createBudgetResponse = await handleAdminRoute(
      buildRequest('/api/v1/admin/money/budgets', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-idempotency-key': 'budget-create-1',
          ...unlockHeader,
        },
        body: JSON.stringify({
          name: 'Studio Cloud Budget',
          scopeType: 'provider',
          scopeKey: 'gcp',
          amountInr: 25000,
          warningPct: 75,
          criticalPct: 95,
          source: 'manual',
        }),
      }),
      ['money', 'budgets']
    );
    expect(createBudgetResponse.status).toBe(200);
    const created = await createBudgetResponse.json() as { budget?: { budgetId?: string } };
    expect(created.budget?.budgetId).toBeTruthy();

    const patchBudgetResponse = await handleAdminRoute(
      buildRequest(`/api/v1/admin/money/budgets/${created.budget?.budgetId || ''}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-idempotency-key': 'budget-patch-1',
          ...unlockHeader,
        },
        body: JSON.stringify({
          amountInr: 30000,
          criticalPct: 100,
        }),
      }),
      ['money', 'budgets', String(created.budget?.budgetId || '')]
    );
    expect(patchBudgetResponse.status).toBe(200);
    await expect(patchBudgetResponse.json()).resolves.toMatchObject({
      budget: expect.objectContaining({
        budgetId: created.budget?.budgetId,
        amountInr: 30000,
      }),
    });
  }, 15_000);
});
