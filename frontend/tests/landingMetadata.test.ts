import { describe, expect, it } from 'vitest';
import { metadata } from '../app/(public)/landing/page';

describe('landing metadata', () => {
  it('keeps the public landing metadata aligned with the marketing surface', () => {
    expect(metadata.title).toContain('Cinematic AI Voice Studio');
    expect(metadata.description).toContain('cinematic AI voiceovers');
    expect(metadata.description).toContain('dedicated /billing page');
    expect(metadata.description).toContain('70+ language reach');
    expect(metadata.alternates?.canonical).toBe('/landing');
    expect(metadata.robots).toEqual({ index: true, follow: true });

    expect(metadata.openGraph?.url).toBe('/landing');
    expect(metadata.openGraph?.siteName).toBe('V FLOW AI');
    expect(metadata.openGraph?.title).toContain('Cinematic AI Voice Studio');
    expect(metadata.openGraph?.description).toContain('live demo playback');
    expect(metadata.openGraph?.description).toContain('single/multi-speaker workflows');
    expect(metadata.openGraph?.images?.[0]?.url).toBe('/brand-logo.svg');
    expect(metadata.openGraph?.images?.[0]?.alt).toContain('brand mark');

    expect(metadata.twitter?.card).toBe('summary_large_image');
    expect(metadata.twitter?.title).toContain('Cinematic AI Voice Studio');
    expect(metadata.twitter?.description).toContain('live demo playback');
    expect(metadata.twitter?.images?.[0]).toBe('/brand-logo.svg');
  });
});
