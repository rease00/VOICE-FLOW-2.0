import type { Metadata } from 'next';
import { BillingLanding } from '../../../src/landing/BillingLanding';

export const metadata: Metadata = {
  title: 'VoiceFlow Billing',
  description: 'Manage VoiceFlow plans, token packs, and checkout flows in one secure billing surface.',
  alternates: {
    canonical: '/billing',
  },
};

export default function BillingPage() {
  return <BillingLanding />;
}
