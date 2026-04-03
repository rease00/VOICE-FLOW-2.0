import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PublicBillingPage } from '../src/features/billing/PublicBillingPage';

describe('billing landing', () => {
  it('keeps the unified billing surface public and delays auth until checkout', () => {
    const html = renderToStaticMarkup(<PublicBillingPage />);

    expect(html).toContain('data-billing-mode="public"');
    expect(html).toContain('Billing, credits, and checkout');
    expect(html).toContain('Choose the plan that fits your workflow');
    expect(html).toContain('Browse pricing first. Sign up or log in only when you are ready to start secure checkout.');
    expect(html).toContain('Checkout');
    expect(html).not.toContain('Sign in to open billing');
  });
});
