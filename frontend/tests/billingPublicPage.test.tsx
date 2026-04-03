import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PublicBillingPage } from '../src/features/billing/PublicBillingPage';

describe('public billing page', () => {
  it('shows public pricing before auth and keeps checkout gated', () => {
    const html = renderToStaticMarkup(<PublicBillingPage />);

    expect(html).toContain('vf-billing-shell');
    expect(html).toContain('data-vf-brand-theme="aurora"');
    expect(html).toContain('Billing, credits, and checkout');
    expect(html).toContain('Browse pricing first. Sign up or log in only when you are ready to start secure checkout.');
    expect(html).toContain('Launcher');
    expect(html).toContain('Scale');
    expect(html).toContain('Checkout');
    expect(html).not.toContain('Sign in to open billing');
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
