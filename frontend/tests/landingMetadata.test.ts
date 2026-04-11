import { describe, expect, it } from 'vitest';
import { metadata } from '../app/(public)/page';

describe('landing metadata', () => {
  it('keeps the root landing route canonical and aligned with marketing metadata', () => {
    expect(metadata.title).toBe('V FLOW AI | Premium voice studio');
    expect(metadata.description).toContain('Prime scenes');
    expect(metadata.description).toContain('clone checks');
    expect(metadata.description).toContain('writing review');
    expect(metadata.alternates?.canonical).toBe('/');
    expect(metadata.robots).toEqual({ index: true, follow: true });

    expect(metadata.openGraph?.url).toBe('/');
    expect(metadata.openGraph?.siteName).toBe('V FLOW AI');
    expect(metadata.openGraph?.title).toBe('V FLOW AI | Premium voice studio');
    expect(metadata.openGraph?.description).toContain('Prime scenes');
    expect(metadata.openGraph?.images?.[0]?.url).toBe('/brand-logo.svg');
    expect(metadata.openGraph?.images?.[0]?.alt).toBe('V FLOW AI brand mark');

    expect(metadata.twitter?.card).toBe('summary_large_image');
    expect(metadata.twitter?.title).toBe('V FLOW AI | Premium voice studio');
    expect(metadata.twitter?.description).toContain('clone checks');
    expect(metadata.twitter?.images?.[0]).toBe('/brand-logo.svg');
  });
});
