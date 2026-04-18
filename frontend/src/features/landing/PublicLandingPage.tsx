import { MarketingLanding } from './MarketingLanding';
import { LandingMotionObserver } from './LandingMotionObserver';
import {
  LANDING_DIRECTOR_PROOF,
  LANDING_MULTI_SPEAKER_DEMOS,
  LANDING_READER_PROOF,
  LANDING_SINGLE_SPEAKER_DEMOS,
} from './landingData';
import type { LandingPageVariant } from './landingTabs';

const landingUrl = 'https://v-flow-ai.com/landing';

const softwareStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'V FLOW AI',
  applicationCategory: 'MultimediaApplication',
  operatingSystem: 'Web',
  url: landingUrl,
  description:
    'Voice Flow helps teams audition voices, review multi-speaker scenes, direct delivery, and approve reader-ready audio.',
  brand: {
    '@type': 'Brand',
    name: 'V FLOW AI',
  },
  featureList: [
    'Single voice auditions',
    'Prime multi-speaker scene review',
    'Prompt-based direction workflows',
    'Reader-ready approval surfaces',
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
      name: 'What is Voice Flow used for?',
      acceptedAnswer: {
      '@type': 'Answer',
        text: 'Voice Flow is a web voice production workflow for auditioning voices, reviewing scenes, directing delivery, and approving reader-ready audio.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can I review single-voice reads and multi-speaker scenes in the same product?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. The public tour shows each lane separately, and the studio brings them back together in one workflow.',
      },
    },
    {
      '@type': 'Question',
      name: 'Where do I find pricing?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Pricing lives on the dedicated public /billing page before you continue into the secure studio flow.',
      },
    },
  ],
};

interface PublicLandingPageProps {
  activePage?: LandingPageVariant;
}

export function PublicLandingPage({ activePage = 'overview' }: PublicLandingPageProps) {
  return (
    <>
      <LandingMotionObserver />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareStructuredData) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqStructuredData) }}
      />
      <MarketingLanding
        activePage={activePage}
        singleSpeakerDemos={LANDING_SINGLE_SPEAKER_DEMOS}
        multiSpeakerDemos={LANDING_MULTI_SPEAKER_DEMOS}
        directorProof={LANDING_DIRECTOR_PROOF}
        readerProof={LANDING_READER_PROOF}
      />
    </>
  );
}
