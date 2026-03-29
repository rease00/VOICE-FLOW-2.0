import type { Metadata } from 'next';
import { BillingLanding } from '../../../src/landing/BillingLanding';

export const metadata: Metadata = {
  title: 'V FLOW AI Billing',
  description:
    'Unified V FLOW AI Buy Center for plans and token packs. Sign in or sign up to continue, then launch secure checkout.',
  alternates: {
    canonical: '/billing',
  },
};

export default function BillingPage() {
  return <BillingLanding />;
}
