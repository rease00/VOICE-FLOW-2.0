import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PublicBillingPage } from '../src/features/billing/PublicBillingPage';

describe('public billing page', () => {
  it('renders public shared billing surface copy and hides app-only actions', () => {
    const html = renderToStaticMarkup(<PublicBillingPage />);

    expect(html).toContain('Billing');
    expect(html).toContain('Billing, credits, and checkout');
    expect(html).toContain('Plans');
    expect(html).toContain('Credit Packs');
    expect(html).toContain('VC Packs');
    expect(html).toContain('Choose the plan that fits your workflow, add credits when you need extra volume, and confirm pricing before checkout.');
    expect(html).toContain('Open Billing');
    expect(html).toContain('Launcher');
    expect(html).toContain('Scale');
    expect(html).toContain('Copyright');
    expect(html).toContain('V FLOW AI Billing');
    expect(html).toContain('vf-billing-shell');
    expect(html).toContain('data-vf-brand-theme="aurora"');
    expect(html).toContain('vf-billing-legal-link');
    expect(html).toContain('href="/landing"');
    expect(html).toContain('bg-slate-950/72');
    expect(html).not.toContain('bg-[#f2f6ff]');
    expect(html).not.toContain('bg-white/85');
    expect(html).not.toContain('bg-white/80');
    expect(html).not.toContain('bg-white/75');
    expect(html).not.toContain('Wallet Coupon');
    expect(html).not.toContain('Promo Code');
    expect(html).not.toContain('Workspace');
    expect(html).not.toContain('Intentionally kept blank for now.');
  });

  it('keeps billing legal links readable on dark buy-center surfaces', () => {
    const cssPath = [resolve(process.cwd(), 'frontend/index.css'), resolve(process.cwd(), 'index.css')].find((candidate) =>
      existsSync(candidate),
    );

    expect(cssPath).toBeDefined();

    const css = readFileSync(cssPath!, 'utf-8');
    expect(css).toContain('.vf-billing-shell .vf-billing-legal-link');
    expect(css).toContain('.vf-billing-shell .vf-billing-legal-link:hover');
  });
});
