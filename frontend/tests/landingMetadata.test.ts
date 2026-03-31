import { describe, expect, it } from 'vitest';
import { metadata } from '../app/(public)/page';

describe('landing metadata', () => {
  it('keeps the compatibility alias metadata aligned with the canonical landing page', () => {
    expect(metadata.title).toBe('Premium AI Voice Studio for Prime Cast Scenes, Direction, and Voice Cloning');
    expect(metadata.description).toContain('premium production studio');
    expect(metadata.description).toContain('Prime multi-speaker scenes');
    expect(metadata.description).toContain('reader-ready approvals');
    expect(metadata.alternates?.canonical).toBe('/landing');
    expect(metadata.robots).toEqual({ index: true, follow: true });

    expect(metadata.openGraph?.url).toBe('/landing');
    expect(metadata.openGraph?.siteName).toBe('V FLOW AI');
    expect(metadata.openGraph?.title).toBe('V FLOW AI | Premium AI Voice Studio');
    expect(metadata.openGraph?.description).toContain('Prime cast scenes');
    expect(metadata.openGraph?.images?.[0]?.url).toBe('/brand-logo.svg');
    expect(metadata.openGraph?.images?.[0]?.alt).toBe('V FLOW AI brand mark');

    expect(metadata.twitter?.card).toBe('summary_large_image');
    expect(metadata.twitter?.title).toBe('V FLOW AI | Premium AI Voice Studio');
    expect(metadata.twitter?.description).toContain('Prime cast scenes');
    expect(metadata.twitter?.images?.[0]).toBe('/brand-logo.svg');
  });
});
