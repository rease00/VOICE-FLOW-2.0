import type { Metadata } from 'next';
import { PublicBillingPage } from '../../../src/features/billing/PublicBillingPage';

export const metadata: Metadata = {
  title: 'V FLOW AI Billing | Premium Studio Pricing',
  description:
    'Review V FLOW AI studio plans, credit packs, and billing terms with transparent pricing before you continue into secure checkout.',
  alternates: {
    canonical: '/billing',
  },
};

export default function BillingPage() {
  return <PublicBillingPage />;
}
