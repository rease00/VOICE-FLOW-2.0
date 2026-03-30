import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HomePage from '../app/(public)/page';
import { MarketingLanding } from '../src/features/landing/MarketingLanding';

describe('marketing landing page', () => {
  it('renders the premium homepage copy and core public links', () => {
    const html = renderToStaticMarkup(<MarketingLanding />);

    expect(html).toContain('Make every line feel');
    expect(html).toContain('Premium AI voice studio');
    expect(html).toContain('href="/app/login?mode=signup&amp;next=%2Fapp"');
    expect(html).toContain('href="/app"');
    expect(html).toContain('href="/billing"');
    expect(html).toContain('href="/legal/terms"');
    expect(html).toContain('configured languages');
    expect(html).toContain('Voice cloning');
    expect(html).toContain('Reader review');
    expect(html).toContain('data-vf-brand-theme="aurora"');
    expect(html).toContain('vf-marketing-shell');
  });

  it('keeps software and faq structured data on the public homepage', () => {
    const html = renderToStaticMarkup(<HomePage />);

    expect(html).toContain('application/ld+json');
    expect(html).toContain('SoftwareApplication');
    expect(html).toContain('FAQPage');
    expect(html).toContain('https://v-flow-ai.com/');
    expect(html).toContain('/billing');
  });
});
