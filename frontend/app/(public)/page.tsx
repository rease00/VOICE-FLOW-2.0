import type { Metadata } from 'next';
import { MarketingLanding } from '../../src/features/landing/MarketingLanding';

export const metadata: Metadata = {
  title: 'Premium AI Voice Studio for Live Direction, Dubbing, and Voice Cloning',
  description:
    'V FLOW AI combines live voice direction, multilingual dubbing, voice cloning, and reader-ready delivery in one premium production studio.',
  keywords: [
    'ai voice studio',
    'voice cloning',
    'multilingual dubbing',
    'ai narration',
    'production audio',
    'reader audio',
    'voice workflow',
  ],
  alternates: {
    canonical: '/',
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: 'website',
    url: '/',
    title: 'V FLOW AI | Premium AI Voice Studio',
    description:
      'Direct, clone, dub, and publish voice productions from a single cinematic AI studio.',
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
      'Direct, clone, dub, and publish voice productions from a single cinematic AI studio.',
    images: ['/brand-logo.svg'],
  },
};

const softwareStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'V FLOW AI',
  applicationCategory: 'MultimediaApplication',
  operatingSystem: 'Web',
  url: 'https://v-flow-ai.com/',
  description:
    'A premium AI voice production studio for live direction, multilingual dubbing, voice cloning, and reader-ready publishing.',
  brand: {
    '@type': 'Brand',
    name: 'V FLOW AI',
  },
  featureList: [
    'Studio voice direction workflows',
    'Voice cloning and approvals',
    'Multilingual dubbing and narration',
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
        text: 'V FLOW AI is a premium AI voice studio for directing voiceovers, dubbing scenes, cloning voices, and reviewing listening flows before release.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can I use voice cloning and dubbing in the same workflow?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. The workspace is designed so studio generation, multilingual dubbing, voice cloning, and reader review stay in one connected production lane.',
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

export default function HomePage() {
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
