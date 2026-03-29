import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { DevCanonicalHostRedirect } from '../components/DevCanonicalHostRedirect';

export const metadata: Metadata = {
  metadataBase: new URL('https://v-flow-ai.com'),
  title: {
    default: 'V FLOW AI',
    template: '%s | V FLOW AI',
  },
  description: 'V FLOW AI helps creators build polished voice experiences and production-ready audio workflows.',
  applicationName: 'V FLOW AI',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-[color:var(--vf-bg)] text-[color:var(--vf-text)] antialiased">
        <DevCanonicalHostRedirect />
        {children}
      </body>
    </html>
  );
}
