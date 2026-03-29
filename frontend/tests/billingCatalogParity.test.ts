import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BILLING_PLAN_KEYS,
  BILLING_PLAN_ROWS,
  BILLING_TOKEN_PACK_KEYS,
  BILLING_TOKEN_PACK_ROWS,
} from '../src/features/billing/catalog';

const readText = (relativePath: string): string => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

describe('billing catalog parity', () => {
  it('keeps one canonical catalog with the expected plan and token keys', () => {
    expect(BILLING_PLAN_KEYS).toEqual(['launcher', 'starter', 'creator', 'pro', 'scale']);
    expect(BILLING_TOKEN_PACK_KEYS).toEqual(['micro', 'standard', 'mega', 'ultra']);
    expect(BILLING_PLAN_ROWS.map((row) => row.name)).toEqual(['Launcher', 'Starter', 'Creator', 'Pro', 'Scale']);
    expect(BILLING_TOKEN_PACK_ROWS.map((row) => row.label)).toEqual(['Micro', 'Standard', 'Mega', 'Ultra']);
  });

  it('routes both wrappers through shared BillingSurface and keeps catalog ownership centralized', () => {
    const billingSurfaceSource = readText('../src/features/billing/surface/BillingSurface.tsx');
    const buyCenterSource = readText('../views/BuyCenter.tsx');
    const billingLandingSource = readText('../src/landing/BillingLanding.tsx');

    expect(billingSurfaceSource).toContain("from '../catalog'");
    expect(billingSurfaceSource).toContain('BILLING_PLAN_ROWS');
    expect(billingSurfaceSource).toContain('BILLING_TOKEN_PACK_ROWS');

    expect(buyCenterSource).toContain("from '../src/features/billing/surface/BillingSurface'");
    expect(buyCenterSource).toContain('mode="app"');
    expect(buyCenterSource).toContain('walletSummary={walletSummary}');

    expect(billingLandingSource).toContain("from '../features/billing/surface/BillingSurface'");
    expect(billingLandingSource).toContain('mode="public"');

    expect(buyCenterSource).not.toContain('const PLAN_ROWS');
    expect(billingLandingSource).not.toContain('const PLAN_ROWS');
    expect(billingSurfaceSource).not.toContain('const PLAN_ROWS');
    expect(buyCenterSource).not.toContain('const TOKEN_PACK_ROWS');
    expect(billingLandingSource).not.toContain('const TOKEN_PACK_ROWS');
    expect(billingSurfaceSource).not.toContain('const TOKEN_PACK_ROWS');
  });
});
