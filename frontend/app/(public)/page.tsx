import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PublicLandingPage } from '../../src/features/landing/PublicLandingPage';
import { landingMetadata } from '../../src/features/landing/landingMetadata';

export const metadata: Metadata = landingMetadata;

export default function HomePage() {
  redirect('/landing');
  return <PublicLandingPage />;
}
