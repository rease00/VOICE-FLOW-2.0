import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://v-flow-ai.com'),
  title: {
    default: 'VoiceFlow',
    template: '%s | VoiceFlow',
  },
  description: 'VoiceFlow helps creators build polished voice experiences and production-ready audio workflows.',
  applicationName: 'VoiceFlow',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-[color:var(--vf-bg)] text-[color:var(--vf-text)] antialiased">
        {children}
      </body>
    </html>
  );
}
