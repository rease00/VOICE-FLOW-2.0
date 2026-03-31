import type { Metadata } from 'next';
import { MarketingLanding } from './MarketingLanding';

const landingPath = '/landing';
const landingUrl = 'https://v-flow-ai.com/landing';

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

const softwareStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'V FLOW AI',
  applicationCategory: 'MultimediaApplication',
  operatingSystem: 'Web',
  url: landingUrl,
  description:
    'A premium AI voice production studio for Prime multi-speaker scenes, live direction, voice cloning, and reader-ready publishing.',
  brand: {
    '@type': 'Brand',
    name: 'V FLOW AI',
  },
  featureList: [
    'Prime multi-speaker demo scenes',
    'Studio voice direction workflows',
    'Voice cloning and approval checks',
    'Reader-ready publishing surfaces',
    'Billing and launch controls',
  ],
  audience: {
    '@type': 'Audience',
    audienceType: 'Creators, media teams, and production operators',
  },
};

const faqStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What is V FLOW AI used for?',
      acceptedAnswer: {
      '@type': 'Answer',
        text: 'V FLOW AI is a premium AI voice studio for hearing Prime cast scenes, directing voice performances, cloning voices, and reviewing listening flows before release.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can I use Prime multi-speaker scenes and voice cloning in the same workflow?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. The workspace is designed so Prime scene generation, voice cloning, live direction, and reader review stay in one connected production lane.',
      },
    },
    {
      '@type': 'Question',
      name: 'Where do I find pricing?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Pricing and credits live on the dedicated public /billing page before you continue into the secure app buy flow.',
      },
    },
  ],
};

export function PublicLandingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareStructuredData) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqStructuredData) }}
      />
      <MarketingLanding />
    </>
  );
}
