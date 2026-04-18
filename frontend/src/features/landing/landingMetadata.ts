import type { Metadata } from 'next';
import type { LandingPageVariant } from './landingTabs';
import { getLandingTabDefinition } from './landingTabs';

const landingPath = '/landing';

export const landingMetadata: Metadata = {
  title: 'V FLOW AI — Script to voice. One workspace. No filler.',
  description:
    'Write scripts, assign AI voices across 30+ languages, direct delivery with prompts, and render final audio — all in one web workspace. Token-based billing, no monthly minimum.',
  keywords: [
    'AI voice generator',
    'text to speech',
    'multi-speaker TTS',
    'AI voice direction',
    'voice production workflow',
    'script to audio',
    'multi-language TTS',
    'voice over AI',
    'audio production tool',
    'V FLOW AI',
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
    title: 'V FLOW AI — Script to voice. One workspace.',
    description:
      'Write scripts, pick AI voices across 30+ languages, direct delivery, and render audio. Token-based billing, no monthly minimum.',
    siteName: 'V FLOW AI',
    images: [
      {
        url: '/brand-logo.svg',
        width: 512,
        height: 512,
        alt: 'V FLOW AI — AI voice production workspace',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'V FLOW AI — Script to voice. One workspace.',
    description:
      'Write scripts, pick AI voices across 30+ languages, direct delivery, and render audio. Token-based billing, no monthly minimum.',
    images: ['/brand-logo.svg'],
  },
};

export const buildLandingMetadata = (page: LandingPageVariant): Metadata => {
  if (page === 'overview') {
    return landingMetadata;
  }

  const tab = getLandingTabDefinition(page);
  return {
    ...landingMetadata,
    title: `${tab.title} | Voice Flow`,
    description: tab.description,
    alternates: {
      canonical: tab.href,
    },
    openGraph: {
      ...landingMetadata.openGraph,
      url: tab.href,
      title: `${tab.title} | Voice Flow`,
      description: tab.description,
    },
    twitter: {
      ...landingMetadata.twitter,
      title: `${tab.title} | Voice Flow`,
      description: tab.description,
    },
  };
};
