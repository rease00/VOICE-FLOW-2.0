import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarketingLanding } from '../src/landing/MarketingLanding';

describe('marketing landing', () => {
  it('renders required sections and verified proof copy', () => {
    const html = renderToStaticMarkup(<MarketingLanding />);

    expect(html).toContain('data-landing-theme="neon"');
    expect(html).toContain('data-vf-brand-theme="neon"');
    expect(html).toContain('data-testid="landing-social-proof"');
    expect(html).toContain('data-testid="landing-demo-showcase"');
    expect(html).toContain('data-testid="landing-ai-directors"');
    expect(html).toContain('data-testid="landing-languages"');
    expect(html).toContain('data-testid="landing-use-cases"');
    expect(html).toContain('data-testid="landing-seo-content"');
    expect(html).toContain('data-testid="landing-cta"');
    expect(html).toContain('data-testid="landing-theme-switcher"');
    expect(html).toContain('data-testid="landing-theme-neon"');
    expect(html).toContain('data-testid="landing-theme-aurora"');
    expect(html).toContain('data-testid="landing-theme-sunset"');
    expect(html).toContain('data-testid="landing-theme-emerald"');
    expect(html).toContain('View Pricing');
    expect(html).toContain('href="/billing"');
    expect(html).toContain('vf-landing-header fixed inset-x-0 top-0 z-40');
    expect(html).toContain('AI Directors');
    expect(html).toContain('70+ languages');
    expect(html).toContain('83 configured languages');
    expect(html).not.toContain('data-testid="landing-pricing"');
    expect(html).not.toContain('Transparent plans from the live Buy Center.');
  });

  it('renders exactly ten demo cards on the default showcase view', () => {
    const html = renderToStaticMarkup(<MarketingLanding />);
    const allCards = html.match(/data-testid="landing-demo-card"/g) || [];
    const singleCards = html.match(/data-demo-kind="single"/g) || [];
    const multiCards = html.match(/data-demo-kind="multi"/g) || [];
    const themeButtons = html.match(/data-testid="landing-theme-(?:neon|aurora|sunset|emerald)"/g) || [];

    expect(allCards).toHaveLength(10);
    expect(singleCards).toHaveLength(5);
    expect(multiCards).toHaveLength(5);
    expect(themeButtons).toHaveLength(4);
    expect(html).not.toContain('Placeholder marker: replace with final director-tagged emotion/style metadata.');
  });
});
