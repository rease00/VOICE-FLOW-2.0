import { describe, expect, it } from 'vitest';
import { metadata } from '../app/(public)/page';
import { buildLandingMetadata } from '../src/features/landing/landingMetadata';

describe('landing metadata', () => {
  it('keeps the compatibility alias metadata aligned with the canonical landing page', () => {
    expect(metadata.title).toBe('V FLOW AI — Script to voice. One workspace. No filler.');
    expect(metadata.description).toContain('Write scripts');
    expect(metadata.description).toContain('Token-based billing');
    expect(metadata.alternates?.canonical).toBe('/landing');
    expect(metadata.robots).toEqual({ index: true, follow: true });

    expect(metadata.openGraph?.url).toBe('/landing');
    expect(metadata.openGraph?.siteName).toBe('V FLOW AI');
    expect(metadata.openGraph?.title).toBe('V FLOW AI — Script to voice. One workspace.');
    expect(metadata.openGraph?.description).toContain('AI voices');
    expect(metadata.openGraph?.images?.[0]?.url).toBe('/og-landing.png');
    expect(metadata.openGraph?.images?.[0]?.alt).toContain('V FLOW AI');

    expect(metadata.twitter?.card).toBe('summary_large_image');
    expect(metadata.twitter?.title).toBe('V FLOW AI — Script to voice. One workspace.');
    expect(metadata.twitter?.description).toContain('AI voices');
    expect(metadata.twitter?.images?.[0]).toBe('/og-landing.png');
  });

  it('builds detail metadata from the route definitions', () => {
    const detailMetadata = buildLandingMetadata('direction');

    expect(detailMetadata.title).toBe('AI Direction | Voice Flow');
    expect(detailMetadata.alternates?.canonical).toBe('/landing/direction');
    expect(detailMetadata.openGraph?.url).toBe('/landing/direction');
    expect(detailMetadata.twitter?.title).toBe('AI Direction | Voice Flow');
  });
});
