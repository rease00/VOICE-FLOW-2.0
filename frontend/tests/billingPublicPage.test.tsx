import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PublicBillingPage } from '../src/features/billing/PublicBillingPage';

describe('public billing page', () => {
  it('shows a fully locked pricing preview with a coming soon message', () => {
    const html = renderToStaticMarkup(<PublicBillingPage />);

    expect(html).toContain('vf-billing-shell');
    expect(html).toContain('data-billing-state="coming-soon"');
    expect(html).toContain('data-vf-brand-theme="aurora"');
    expect(html).toContain('Pricing is coming soon.');
    expect(html).toContain('Plans are blurred until launch.');
    expect(html).toContain('New account creation is temporarily paused while we finish launch checks.');
    expect(html).toContain('If you already have access, sign in and continue in the studio. Public signup will open soon.');
    expect(html).toContain('Sign in');
    expect(html).toContain('Back to landing');
    expect(html).not.toContain('Checkout');
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
