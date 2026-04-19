import { MarketingLandingV2 } from './MarketingLandingV2';
import { LandingMotionObserver } from './LandingMotionObserver';
import { LandingErrorBoundary } from './LandingErrorBoundary';
import {
  LANDING_DIRECTOR_PROOF,
  LANDING_MULTI_SPEAKER_DEMOS,
  LANDING_READER_PROOF,
  LANDING_SINGLE_SPEAKER_DEMOS,
} from './landingData';
import './MarketingLandingV2.css';

const landingUrl = 'https://v-flow-ai.com/landing';

const softwareStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'V FLOW AI',
  applicationCategory: 'MultimediaApplication',
  operatingSystem: 'Web',
  url: landingUrl,
  description:
    'Voice Flow is a web-based voice production workspace. Write scripts, assign AI voices across 30+ languages, direct delivery with prompts, and render final audio in one tool.',
  brand: {
    '@type': 'Brand',
    name: 'V FLOW AI',
  },
  featureList: [
    'Single voice auditions in 30+ languages',
    'Multi-speaker scene rendering',
    'AI-powered prompt-based direction',
    'Reader review and approval surface',
    'Token-based pay-as-you-go billing',
  ],
  audience: {
    '@type': 'Audience',
    audienceType: 'Content creators, media producers, and indie developers',
  },
  offers: {
    '@type': 'Offer',
    price: '129',
    priceCurrency: 'INR',
    description: 'Launcher plan — 30K VF Credits/month',
  },
};

const faqStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What is Voice Flow?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Voice Flow is a web-based voice production workspace. You write scripts, assign AI voices, direct delivery with prompts, and review rendered audio — all in one tool.',
      },
    },
    {
      '@type': 'Question',
      name: 'What languages are supported?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'The Prime engine supports 30+ languages including English, Hindi, Spanish, Japanese, Arabic, French, German, and more.',
      },
    },
    {
      '@type': 'Question',
      name: 'How does billing work?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'You purchase VF Credits in packs or via a subscription plan. Credits are consumed per generation — no hidden fees, no monthly minimum. You only pay for what you use.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can I use multiple voices in one scene?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. Multi-speaker mode lets you assign different voices to different speakers in a single script and render the entire scene in one pass.',
      },
    },
    {
      '@type': 'Question',
      name: 'Is there a free tier?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Pricing plans start at ₹129/month with credits included. Token top-up packs are also available if you need more without committing to a larger plan.',
      },
    },
    {
      '@type': 'Question',
      name: 'Who builds this?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'V FLOW AI is a solo-built product focused on doing a few things well rather than promising everything. Updates ship frequently based on real usage.',
      },
    },
  ],
};

export function PublicLandingPage() {
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
      <LandingErrorBoundary>
        <MarketingLandingV2
          singleSpeakerDemos={LANDING_SINGLE_SPEAKER_DEMOS}
          multiSpeakerDemos={LANDING_MULTI_SPEAKER_DEMOS}
          directorProof={LANDING_DIRECTOR_PROOF}
          readerProof={LANDING_READER_PROOF}
        />
      </LandingErrorBoundary>
    </>
  );
}
