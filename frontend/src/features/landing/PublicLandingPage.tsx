import { MarketingLanding, type LandingTabKey } from './MarketingLanding';
import { LandingMotionObserver } from './LandingMotionObserver';
import { landingMetadata } from './landingMetadata';

const landingUrl = 'https://v-flow-ai.com/landing';

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

interface PublicLandingPageProps {
  activeTab?: LandingTabKey;
}

export function PublicLandingPage({ activeTab = 'home' }: PublicLandingPageProps) {
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
      <MarketingLanding activeTab={activeTab} />
    </>
  );
}
