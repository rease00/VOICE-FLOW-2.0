import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PublicBillingPage } from '../src/features/billing/PublicBillingPage';

describe('billing landing', () => {
  it('keeps pricing public but fully locked behind a coming soon state', () => {
    const html = renderToStaticMarkup(<PublicBillingPage />);

    expect(html).toContain('data-billing-mode="public"');
    expect(html).toContain('data-billing-state="coming-soon"');
    expect(html).toContain('Pricing is coming soon.');
    expect(html).toContain('Plans are blurred until launch.');
    expect(html).toContain('New account creation is temporarily paused while we finish launch checks.');
    expect(html).toContain('Sign in');
    expect(html).toContain('Back to landing');
    expect(html).not.toContain('Sign in to open billing');
  });
});
