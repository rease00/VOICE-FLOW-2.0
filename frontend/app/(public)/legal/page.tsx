import type { Metadata } from 'next';
import { LegalCenter } from '../../../src/landing/legal/LegalCenter';

export const metadata: Metadata = {
  title: 'VoiceFlow Legal Center',
  description: 'VoiceFlow policy center for terms, privacy, cookies, billing, and acceptable-use documents.',
  alternates: {
    canonical: '/legal',
  },
};

export default function LegalIndexPage() {
  return <LegalCenter activeDocument={null} />;
}
