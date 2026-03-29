import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BillingLanding } from '../src/landing/BillingLanding';

describe('billing landing', () => {
  it('renders public shared billing surface copy and hides app-only actions', () => {
    const html = renderToStaticMarkup(<BillingLanding />);

    expect(html).toContain('Buy Center');
    expect(html).toContain('Subscription, Token Buy, and Credit Rules');
    expect(html).toContain('Subscription');
    expect(html).toContain('Token Packs');
    expect(html).toContain('Calculated using your current VF conversion rules: 1.5 VF = 1 Char / 15 Chars = 1 Sec');
    expect(html).toContain('Direct token buys are valid for 3 months.');
    expect(html).toContain('Open App Buy Center');
    expect(html).toContain('Need sign-in help?');
    expect(html).toContain('Launcher');
    expect(html).toContain('Scale');
    expect(html).toContain('Copyright');
    expect(html).toContain('V FLOW AI Billing');
    expect(html).not.toContain('Wallet Coupon');
    expect(html).not.toContain('Workspace');
    expect(html).not.toContain('Intentionally kept blank for now.');
  });
});
