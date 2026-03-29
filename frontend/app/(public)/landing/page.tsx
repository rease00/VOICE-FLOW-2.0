import type { Metadata } from 'next';
import { MarketingLanding } from '../../../src/landing/MarketingLanding';

export const metadata: Metadata = {
  title: 'V FLOW AI | Cinematic AI Voice Studio for Single & Multi-Speaker Production',
  description:
    'Create cinematic AI voiceovers with emotional control, AI Directors, live demo playback, and 70+ language reach. Pricing lives on the dedicated /billing page with auth-first checkout.',
  keywords: [
    'ai text to speech',
    'expressive text to speech',
    'multilingual tts',
    'ai voice generator',
    'multi-speaker tts',
    'emotional ai voice',
    'studio-quality ai voice',
    'ai directors voice',
    'single speaker voice generation',
    'voiceover studio software',
  ],
  alternates: {
    canonical: '/landing',
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: 'website',
    url: '/landing',
    title: 'V FLOW AI | Cinematic AI Voice Studio',
    description:
      'Direct cinematic, multilingual voice performances with AI Directors, live demo playback, and premium single/multi-speaker workflows. Pricing is on the dedicated /billing surface.',
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
    title: 'V FLOW AI | Cinematic AI Voice Studio',
    description:
      'Direct cinematic, multilingual voice performances with AI Directors, live demo playback, and premium single/multi-speaker workflows. Pricing is on /billing.',
    images: ['/brand-logo.svg'],
  },
};

const softwareStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'V FLOW AI',
  applicationCategory: 'MultimediaApplication',
  operatingSystem: 'Web',
  url: 'https://v-flow-ai.com/landing',
  description:
    'Create cinematic AI voiceovers with emotional control, AI Directors, live demo playback, and 70+ language reach.',
  brand: {
    '@type': 'Brand',
    name: 'V FLOW AI',
  },
  featureList: [
    'Cast-aware multi-speaker narration',
    'AI Director pass preview and apply flow',
    'Single-speaker and multi-speaker generation',
    '15 bundled single-speaker demo clips',
    '5 bundled multi-speaker demo clips',
    '83 configured language options with 70+ market positioning',
    'Dedicated pricing available at /billing with sign-in/sign-up before checkout',
  ],
  audience: {
    '@type': 'Audience',
    audienceType: 'Creators, studios, and production teams',
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
        text: 'V FLOW AI is an expressive AI text to speech platform for studio-quality voiceovers, AI-directed performances, single-speaker narration, and multi-speaker production.',
      },
    },
    {
      '@type': 'Question',
      name: 'Does V FLOW AI support multilingual text to speech?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. The product catalog includes 83 configured language options, and the landing positions this as 70+ language global reach.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can I generate both single-speaker and multi-speaker audio?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. The product supports both single-speaker generation and cast-aware multi-speaker generation, with bundled demo assets for both flows.',
      },
    },
    {
      '@type': 'Question',
      name: 'How do AI Directors improve voice quality?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'AI Directors provide a premium control layer for scene intent, emotion, pacing, and delivery. Users can preview proposed script changes and apply only approved direction before generation.',
      },
    },
    {
      '@type': 'Question',
      name: 'Where can I find pricing?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Pricing is available on the dedicated /billing page, separate from the landing page content. Users sign in or sign up before checkout.',
      },
    },
  ],
};

export default function LandingPage() {
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
