import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LandingPage, { metadata } from '../app/(public)/landing/page';

describe('marketing landing page', () => {
  it('renders the canonical /landing route and keeps its metadata aligned', () => {
    expect(metadata.alternates?.canonical).toBe('/landing');
    expect(metadata.openGraph?.url).toBe('/landing');

    const html = renderToStaticMarkup(<LandingPage />);

    expect(html).toContain('Publish voice work that already sounds finished.');
    expect(html).toContain('data-testid="landing-home-hero"');
    expect(html).toContain('data-testid="landing-home"');
    expect(html).toContain('Single-speaker system');
    expect(html).toContain('Prime multi-speaker scenes');
    expect(html).toContain('Voice Clone proof');
    expect(html).toContain('AI Director');
    expect(html).toContain('Reader playback');
    expect(html).toContain('id="single-speaker"');
    expect(html).toContain('id="multi-speaker"');
    expect(html).toContain('id="voice-cloning"');
    expect(html).toContain('id="ai-director"');
    expect(html).toContain('id="reader-playback"');
    expect(html).toContain('data-testid="landing-single-speaker"');
    expect(html).toContain('data-testid="landing-multi-speaker"');
    expect(html).toContain('data-testid="landing-voice-cloning"');
    expect(html).toContain('data-testid="landing-ai-director"');
    expect(html).toContain('data-testid="landing-reader-playback"');
    expect(html).toContain('data-testid="landing-ai-director-prompt"');
    expect(html).toContain('href="/landing"');
    expect(html).toContain('href="/billing"');
    expect(html).toContain('href="/app/studio"');
    expect(html).toContain('vf-marketing-stat-grid--five-up');
    expect(html).toContain('vf-marketing-audio-grid--five-up');
    expect(html).toContain('vf-marketing-scene-grid--five-up');
    expect(html).toContain('/audio/vector-demo/en-us.wav');
    expect(html).toContain('/audio/vector-multi-demo/en-weekend-plan.wav');
    expect(html).toContain('/audio/vector-multi-demo/fr-city-tour.wav');
    expect(html).toContain('/audio/openvoice-demo/reference.wav');
    expect(html).toContain('Voice Clone comparison');
    expect(html).toContain('application/ld+json');
    expect(html).toContain('SoftwareApplication');
    expect(html).toContain('FAQPage');
    expect(html).toContain('https://v-flow-ai.com/landing');
  });
});

