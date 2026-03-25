import type { Metadata } from 'next';
import { MarketingLanding } from '../../src/landing/MarketingLanding';

export const metadata: Metadata = {
  title: 'VoiceFlow | AI Voice Studio for Creators',
  description: 'Create polished voiceovers, manage audio workflows, and ship creator content faster with VoiceFlow.',
  alternates: {
    canonical: '/',
  },
};

export default function PublicLandingPage() {
  return <MarketingLanding />;
}
