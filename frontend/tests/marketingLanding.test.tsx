import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarketingLanding } from '../src/features/landing/MarketingLanding';

describe('marketing landing', () => {
  it('renders the compact overview route with sticky page tabs and guided next navigation', () => {
    const html = renderToStaticMarkup(<MarketingLanding />);

    expect(html).toContain('data-testid="marketing-landing"');
    expect(html).toContain('data-vf-brand-theme="aurora"');
    expect(html).toContain('data-active-page="overview"');
    expect(html).toContain('data-testid="landing-home-hero"');
    expect(html).toContain('data-testid="landing-home"');
    expect(html).toContain('data-testid="landing-tab-bar"');
    expect(html).toContain('data-testid="landing-next-nav"');
    expect(html).toContain('data-testid="hero-primary-cta"');
    expect(html).toContain('Skip to main content');
    expect(html).toContain('href="/landing"');
    expect(html).toContain('>Overview<');
    expect(html).toContain('>Single Voice<');
    expect(html).toContain('>Prime Scenes<');
    expect(html).toContain('>AI Direction<');
    expect(html).toContain('>Reader<');
    expect(html).toContain('Audition voices.');
    expect(html).toContain('Approve the final take.');
    expect(html).toContain('Voice Flow product tour');
    expect(html).toContain('Voice Flow gives creators one clear path');
    expect(html).toContain('Five product lanes, one cleaner review flow.');
    expect(html).toContain('Use the public tour to choose your lane');
    expect(html).toContain('New account creation is temporarily paused while we finish launch checks.');
    expect(html).toContain('If you already have access, sign in and continue in the studio. Public signup will open soon.');
    expect(html).toContain('Next: Single Voice');
    expect(html).toContain('href="/landing/single-voice"');
    expect(html).toContain('href="/billing"');
    expect(html).toContain('href="/app/studio"');

    expect(html).not.toContain('data-testid="landing-single-speaker"');
    expect(html).not.toContain('data-testid="landing-multi-speaker"');
    expect(html).not.toContain('data-testid="landing-voice-cloning"');
    expect(html).not.toContain('data-testid="landing-ai-director"');
    expect(html).not.toContain('data-testid="landing-reader-playback"');
  });

  it('renders the single voice route as an isolated page with only its own demos mounted', () => {
    const html = renderToStaticMarkup(<MarketingLanding activePage="single-voice" />);

    expect(html).toContain('data-active-page="single-voice"');
    expect(html).toContain('data-testid="landing-single-speaker"');
    expect(html).toContain('Hear short reads before you commit the scene.');
    expect(html).toContain('Next: Prime Scenes');
    expect(html).toContain('/audio/vector-demo/');
    expect(html).toContain('data-audio-player="vf-marketing"');

    expect(html).not.toContain('data-testid="landing-home-hero"');
    expect(html).not.toContain('data-testid="landing-multi-speaker"');
    expect(html).not.toContain('data-testid="landing-voice-cloning"');
    expect(html).not.toContain('data-testid="landing-ai-director"');
    expect(html).not.toContain('data-testid="landing-reader-playback"');
    expect(html).not.toContain('/audio/openvoice-demo/reference.wav');
  });

  it('sends the final next action from the reader page into the app reader workflow', () => {
    const html = renderToStaticMarkup(<MarketingLanding activePage="reader" />);

    expect(html).toContain('data-active-page="reader"');
    expect(html).toContain('data-testid="landing-reader-playback"');
    expect(html).toContain('data-testid="landing-reader-virtual-book"');
    expect(html).toContain('The Lighthouse Ledger');
    expect(html).toContain('Chapter 01');
    expect(html).toContain('Chapter 02');
    expect(html).toContain('/audio/reader-demo/chapter-01-fog-over-meridian-bay.wav');
    expect(html).toContain('/audio/reader-demo/chapter-02-the-second-signal.wav');
    expect(html).toContain('data-testid="landing-reader-sample"');
    expect(html).toContain('/audio/reader-demo/');
    expect(html).toContain('/images/reader-demo-poster.svg');
    expect(html).toContain('Open Reader in App');
    expect(html).toContain('href="/app/library"');
    expect(html).toContain('Open Studio');
    expect(html).not.toContain('data-testid="landing-home"');
  });
});
