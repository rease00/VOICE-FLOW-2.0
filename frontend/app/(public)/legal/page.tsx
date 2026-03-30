import type { Metadata } from 'next';
import { LegalCenter } from '../../../src/features/legal/LegalCenter';

export const metadata: Metadata = {
  title: 'V FLOW AI Legal Center',
  description: 'V FLOW AI policy center for terms, privacy, cookies, billing, and acceptable-use documents.',
  alternates: {
    canonical: '/legal',
  },
};

export default function LegalIndexPage() {
  return <LegalCenter activeDocument={null} />;
}
