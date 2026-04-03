import type { Metadata } from 'next';

const landingPath = '/landing';

export const landingMetadata: Metadata = {
  title: 'Premium AI Voice Studio for Prime Cast Scenes, Direction, and Voice Cloning',
  description:
    'V FLOW AI combines Prime multi-speaker scenes, live voice direction, voice cloning, and reader-ready approvals in one premium production studio.',
  keywords: [
    'ai voice studio',
    'voice cloning',
    'prime multi-speaker voice',
    'ai narration',
    'production audio',
    'reader audio',
    'voice workflow',
  ],
  alternates: {
    canonical: landingPath,
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: 'website',
    url: landingPath,
    title: 'V FLOW AI | Premium AI Voice Studio',
    description:
      'Hear Prime cast scenes, direct performances, compare voice clones, and publish from a single premium AI studio.',
    siteName: 'V FLOW AI',
    images: [
      {
        url: '/brand-logo.svg',
        width: 512,
        height: 512,
        alt: 'V FLOW AI brand mark',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'V FLOW AI | Premium AI Voice Studio',
    description:
      'Hear Prime cast scenes, direct performances, compare voice clones, and publish from a single premium AI studio.',
    images: ['/brand-logo.svg'],
  },
};
