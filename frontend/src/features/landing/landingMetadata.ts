import type { Metadata } from 'next';
import type { LandingPageVariant } from './landingTabs';
import { getLandingTabDefinition } from './landingTabs';

const landingPath = '/landing';

export const landingMetadata: Metadata = {
  title: 'Voice Flow | Audition voices, direct scenes, and approve the final take',
  description:
    'Voice Flow helps teams audition voices, review multi-speaker scenes, direct delivery, and approve reader-ready audio.',
  keywords: [
    'voice workflow',
    'single voice audition',
    'multi-speaker scenes',
    'ai direction',
    'reader review',
    'production audio',
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
    title: 'Voice Flow | Voice production workflow',
    description:
      'Audition voices, review scenes, direct delivery, and move into the full Voice Flow studio.',
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
    title: 'Voice Flow | Voice production workflow',
    description:
      'Audition voices, review scenes, direct delivery, and move into the full Voice Flow studio.',
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
