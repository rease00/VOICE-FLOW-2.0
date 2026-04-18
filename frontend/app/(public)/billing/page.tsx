import type { Metadata } from 'next';
import { PublicBillingPage } from '../../../src/features/billing/PublicBillingPage';

export const metadata: Metadata = {
  title: 'Pricing Coming Soon | V FLOW AI',
  description:
    'Public pricing for V FLOW AI is coming soon. Browse the locked preview now and return when plans and checkout are live.',
  alternates: {
    canonical: '/billing',
  },
};

export default function BillingPage() {
  return <PublicBillingPage />;
}
