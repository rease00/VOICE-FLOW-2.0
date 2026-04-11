import type { Metadata } from 'next';

const landingPath = '/';

export const landingMetadata: Metadata = {
  title: 'V FLOW AI | Premium voice studio',
  description:
    'Prime scenes, voice clone checks, direction, and writing review in one clean flow.',
  keywords: [
    'ai voice studio',
    'voice cloning',
    'prime multi-speaker voice',
    'ai narration',
    'production audio',
    'writing review',
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
    title: 'V FLOW AI | Premium voice studio',
    description: 'Prime scenes, clone checks, direction, and writing review.',
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
    title: 'V FLOW AI | Premium voice studio',
    description: 'Prime scenes, clone checks, direction, and writing review.',
    images: ['/brand-logo.svg'],
  },
};
