import { MarketingLanding, type LandingTabKey } from './MarketingLanding';
import { LandingMotionObserver } from './LandingMotionObserver';
import { landingMetadata } from './landingMetadata';

const landingUrl = 'https://v-flow-ai.com/';

const softwareStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'V FLOW AI',
  applicationCategory: 'MultimediaApplication',
  operatingSystem: 'Web',
  url: landingUrl,
  description:
    'Voice studio for Prime scenes, clone checks, direction, and writing review.',
  brand: {
    '@type': 'Brand',
    name: 'V FLOW AI',
  },
  featureList: [
    'Prime scenes',
    'Voice clone checks',
    'Direction prompts',
    'Writing review',
    'Billing',
  ],
  audience: {
    '@type': 'Audience',
    audienceType: 'Creators and teams',
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
        text: 'A voice studio for demos, clone checks, direction, and review.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can I mix Prime scenes and voice cloning?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. They stay in one flow.',
      },
    },
    {
      '@type': 'Question',
      name: 'Where do I find pricing?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Pricing is on /billing.',
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
