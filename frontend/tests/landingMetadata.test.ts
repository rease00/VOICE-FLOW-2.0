import { describe, expect, it } from 'vitest';
import { metadata } from '../app/(public)/page';
import { buildLandingMetadata } from '../src/features/landing/landingMetadata';

describe('landing metadata', () => {
  it('keeps the compatibility alias metadata aligned with the canonical landing page', () => {
    expect(metadata.title).toBe('Voice Flow | Audition voices, direct scenes, and approve the final take');
    expect(metadata.description).toContain('audition voices');
    expect(metadata.description).toContain('reader-ready audio');
    expect(metadata.alternates?.canonical).toBe('/landing');
    expect(metadata.robots).toEqual({ index: true, follow: true });

    expect(metadata.openGraph?.url).toBe('/landing');
    expect(metadata.openGraph?.siteName).toBe('V FLOW AI');
    expect(metadata.openGraph?.title).toBe('Voice Flow | Voice production workflow');
    expect(metadata.openGraph?.description).toContain('Audition voices');
    expect(metadata.openGraph?.images?.[0]?.url).toBe('/brand-logo.svg');
    expect(metadata.openGraph?.images?.[0]?.alt).toBe('V FLOW AI brand mark');

    expect(metadata.twitter?.card).toBe('summary_large_image');
    expect(metadata.twitter?.title).toBe('Voice Flow | Voice production workflow');
    expect(metadata.twitter?.description).toContain('Audition voices');
    expect(metadata.twitter?.images?.[0]).toBe('/brand-logo.svg');
  });

  it('builds detail metadata from the route definitions', () => {
    const detailMetadata = buildLandingMetadata('reader');

    expect(detailMetadata.title).toBe('Reader Review | Voice Flow');
    expect(detailMetadata.alternates?.canonical).toBe('/landing/reader');
    expect(detailMetadata.openGraph?.url).toBe('/landing/reader');
    expect(detailMetadata.twitter?.title).toBe('Reader Review | Voice Flow');
  });
});
