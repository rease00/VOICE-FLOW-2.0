import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BillingLanding } from '../src/landing/BillingLanding';

describe('billing landing', () => {
  it('renders tabs and conversion rule copy', () => {
    const html = renderToStaticMarkup(<BillingLanding />);
    expect(html).toContain('Subscription');
    expect(html).toContain('Direct Token Buy');
    expect(html).toContain('Voice Clone - VC Token');
    expect(html).toContain('Calculated using your rules: 1.5 VF = 1 Char / 15 Chars = 1 Sec');
    expect(html).toContain('Launcher');
    expect(html).toContain('Scale');
  });
});

