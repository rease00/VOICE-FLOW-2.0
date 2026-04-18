import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BILLING_PLAN_KEYS,
  BILLING_PLAN_ROWS,
  BILLING_TOKEN_PACK_KEYS,
  BILLING_TOKEN_PACK_ROWS,
  BILLING_VC_PACK_KEYS,
  BILLING_VC_PACK_ROWS,
} from '../src/features/billing/catalog';

const readText = (relativePath: string): string => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

describe('billing catalog parity', () => {
  it('keeps one canonical catalog with the expected plan and token keys', () => {
    expect(BILLING_PLAN_KEYS).toEqual(['launcher', 'starter', 'creator', 'pro', 'scale']);
    expect(BILLING_TOKEN_PACK_KEYS).toEqual(['micro', 'standard', 'mega', 'ultra']);
    expect(BILLING_VC_PACK_KEYS).toEqual(['starter', 'standard', 'growth', 'pro', 'scale']);
    expect(BILLING_PLAN_ROWS.map((row) => row.name)).toEqual(['Launcher', 'Starter', 'Creator', 'Pro', 'Scale']);
    expect(BILLING_PLAN_ROWS.map((row) => row.firstCycleInr)).toEqual([129, 450, 1499, 2999, 4500]);
    expect(BILLING_PLAN_ROWS.map((row) => row.recurringInr)).toEqual([129, 428, 1424, 2699, 3825]);
    expect(BILLING_TOKEN_PACK_ROWS.map((row) => row.label)).toEqual(['Micro', 'Standard', 'Mega', 'Ultra']);
    expect(BILLING_VC_PACK_ROWS.map((row) => row.label)).toEqual(['Starter', 'Standard', 'Growth', 'Pro', 'Scale']);
    expect(BILLING_VC_PACK_ROWS.map((row) => row.vc)).toEqual([55, 200, 500, 1500, 2600]);
    expect(BILLING_VC_PACK_ROWS.map((row) => row.priceInr)).toEqual([110, 400, 1000, 3000, 5000]);
  });

  it('routes both wrappers through shared BillingSurface and keeps catalog ownership centralized', () => {
    const billingSurfaceSource = readText('../src/features/billing/surface/BillingSurface.tsx');
    const billingCenterSource = readText('../src/features/billing/AppBillingPage.tsx');
    const publicBillingPageSource = readText('../src/features/billing/PublicBillingPage.tsx');

    expect(billingSurfaceSource).toContain("from '../catalog'");
    expect(billingSurfaceSource).toContain('BILLING_PLAN_ROWS');
    expect(billingSurfaceSource).toContain('BILLING_TOKEN_PACK_ROWS');
    expect(billingSurfaceSource).toContain('BILLING_VC_PACK_ROWS');
    expect(billingSurfaceSource).toContain("defaultVcPackKey = 'scale'");
    expect(billingSurfaceSource).toContain('USD preview uses an approximate FX rate. Native pricing follows your billing country or browser locale. Checkout remains INR-based.');
    expect(billingSurfaceSource).toContain('Switch VC pricing display to native currency');
    expect(billingSurfaceSource).toContain('Best value');

    expect(billingCenterSource).toContain("from './surface/BillingSurface'");
    expect(billingCenterSource).toContain('mode="app"');
    expect(billingCenterSource).toContain('walletSummary={walletSummary}');
    expect(billingCenterSource).toContain('APP_ROUTE_PATHS.billing');
    expect(billingCenterSource).toContain('vcTokenPackDiscountPercent={vcTokenPackDiscountPercent}');
    expect(billingCenterSource).toContain('billingCountry={stats.billingCountry || null}');

    expect(publicBillingPageSource).toContain("from './surface/BillingSurface'");
    expect(publicBillingPageSource).toContain('mode="public"');
    expect(publicBillingPageSource).toContain('homeUrl="/landing"');
    expect(publicBillingPageSource).toContain('const BILLING_PATH = \'/billing\'');
    expect(publicBillingPageSource).toContain('appBuyUrl={BILLING_PATH}');
    expect(publicBillingPageSource).not.toContain('window.location.replace');

    expect(billingCenterSource).not.toContain('const PLAN_ROWS');
    expect(publicBillingPageSource).not.toContain('const PLAN_ROWS');
    expect(billingSurfaceSource).not.toContain('const PLAN_ROWS');
    expect(billingCenterSource).not.toContain('const TOKEN_PACK_ROWS');
    expect(publicBillingPageSource).not.toContain('const TOKEN_PACK_ROWS');
    expect(billingSurfaceSource).not.toContain('const TOKEN_PACK_ROWS');
  });
});
