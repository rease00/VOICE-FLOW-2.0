import type { Metadata } from 'next';
import { PublicLandingPage, landingMetadata } from '../../../src/features/landing/PublicLandingPage';

export const metadata: Metadata = landingMetadata;

export default function LandingPage() {
  return <PublicLandingPage />;
}
