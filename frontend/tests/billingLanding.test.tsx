import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PublicBillingPage } from '../src/features/billing/PublicBillingPage';

describe('billing landing', () => {
  it('renders canonical public billing copy and actions', () => {
    const html = renderToStaticMarkup(<PublicBillingPage />);

    expect(html).toContain('data-billing-mode="public"');
    expect(html).toContain('Billing, credits, and checkout');
    expect(html).toContain('Choose the plan that fits your workflow');
    expect(html).toContain('Plans');
    expect(html).toContain('Credit Packs');
    expect(html).toContain('VC Packs');
    expect(html).toContain('Open Billing');
    expect(html).toContain('href="/app/billing"');
    expect(html).toContain('href="/landing"');
    expect(html).toContain('V FLOW AI Billing');

    expect(html).not.toContain('Buy Center');
    expect(html).not.toContain('Need sign-in help?');
    expect(html).not.toContain('Wallet Coupon');
    expect(html).not.toContain('Promo Code');
    expect(html).not.toContain('Workspace');
    expect(html).not.toContain('Intentionally kept blank for now.');
  });
});
