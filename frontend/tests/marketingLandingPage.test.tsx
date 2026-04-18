import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LandingPage, { metadata } from '../app/(public)/landing/page';
import { generateMetadata as generateLandingTabMetadata } from '../app/(public)/landing/[tab]/page';

describe('marketing landing page', () => {
  it('renders the canonical /landing route and keeps its base metadata aligned', () => {
    expect(metadata.alternates?.canonical).toBe('/landing');
    expect(metadata.openGraph?.url).toBe('/landing');

    const html = renderToStaticMarkup(<LandingPage />);

    expect(html).toContain('data-testid="landing-home"');
    expect(html).toContain('data-testid="landing-home-hero"');
    expect(html).toContain('data-testid="landing-tab-bar"');
    expect(html).toContain('Audition voices.');
    expect(html).toContain('Approve the final take.');
    expect(html).toContain('Voice Flow product tour');
    expect(html).toContain('href="/landing/single-voice"');
    expect(html).toContain('href="/landing/prime-scenes"');
    expect(html).toContain('href="/landing/direction"');
    expect(html).toContain('href="/landing/reader"');
    expect(html).toContain('href="/billing"');
    expect(html).toContain('href="/app/studio"');
    expect(html).toContain('application/ld+json');
    expect(html).toContain('SoftwareApplication');
    expect(html).toContain('FAQPage');
    expect(html).toContain('https://v-flow-ai.com/landing');

    expect(html).not.toContain('data-testid="landing-single-speaker"');
    expect(html).not.toContain('data-testid="landing-multi-speaker"');
  });

  it('keeps route-specific metadata for detail pages', async () => {
    const metadataForSingleVoice = await generateLandingTabMetadata({
      params: Promise.resolve({ tab: 'single-voice' }),
    });

    expect(metadataForSingleVoice.alternates?.canonical).toBe('/landing/single-voice');
    expect(metadataForSingleVoice.title).toBe('Single Voice | Voice Flow');
    expect(metadataForSingleVoice.description).toContain('Audition short reads quickly');
    expect(metadataForSingleVoice.openGraph?.url).toBe('/landing/single-voice');
    expect(metadataForSingleVoice.twitter?.title).toBe('Single Voice | Voice Flow');
  });
});
