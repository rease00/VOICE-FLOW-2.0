import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarketingLanding } from '../src/features/landing/MarketingLanding';

describe('marketing landing', () => {
  it('renders the demo-first homepage structure', () => {
    const html = renderToStaticMarkup(<MarketingLanding />);

    expect(html).toContain('data-testid="marketing-landing"');
    expect(html).toContain('data-vf-brand-theme="aurora"');
    expect(html).toContain('data-testid="hero-primary-cta"');
    expect(html).toContain('Skip to main content');
    expect(html).toContain('href="/landing"');
    expect(html).toContain('href="#single-speaker"');
    expect(html).toContain('href="#multi-speaker"');
    expect(html).toContain('href="#voice-cloning"');
    expect(html).toContain('href="#ai-director"');
    expect(html).toContain('href="#reader-playback"');
    expect(html).toContain('id="single-speaker"');
    expect(html).toContain('id="multi-speaker"');
    expect(html).toContain('id="voice-cloning"');
    expect(html).toContain('id="ai-director"');
    expect(html).toContain('id="reader-playback"');

    expect(html).toContain('Single-speaker system');
    expect(html).toContain('Prime multi-speaker scenes');
    expect(html).toContain('Voice cloning proof');
    expect(html).toContain('AI Director');
    expect(html).toContain('Reader playback');

    expect(html).toContain('Open studio');
    expect(html).toContain('View pricing');
    expect(html).toContain('href="/billing"');
    expect(html).toContain('href="/app/studio"');
    expect(html).toContain('/audio/vector-demo/en-us.wav');
    expect(html).toContain('/audio/vector-multi-demo/en-roundtable.wav');
    expect(html).toContain('/audio/vector-multi-demo/ar-documentary.wav');
    expect(html).toContain('/audio/openvoice-demo/reference.wav');
    expect(html).toContain('/audio/openvoice-demo/rendered.wav');
    expect(html).toContain('data-audio-player="vf-marketing"');
    expect(html).toContain('data-testid="landing-ai-director-prompt"');
  });

  it('drops the brochure-style proof rail and marquee stack', () => {
    const html = renderToStaticMarkup(<MarketingLanding />);

    expect(html).not.toContain('href="#workflow"');
    expect(html).not.toContain('href="#surfaces"');
    expect(html).not.toContain('href="#pricing"');
    expect(html).not.toContain('configured languages');
    expect(html).not.toContain('Open Studio');
    expect(html).not.toContain('Open Voices');
    expect(html).not.toContain('Open Reader');
    expect(html).not.toContain('Cinematic Neon Landing');
    expect(html).not.toContain('landing-demo-card');
    expect(html).not.toContain('landing-theme-switcher');
    expect(html).not.toContain('public landing');
    expect(html).not.toContain('Canonical /landing');
  });
});
