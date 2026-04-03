import type { Metadata } from 'next';
import { PublicLandingPage } from '../../src/features/landing/PublicLandingPage';
import { landingMetadata } from '../../src/features/landing/landingMetadata';

export const metadata: Metadata = landingMetadata;
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function HomePage() {
  return <PublicLandingPage />;
}
