import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppErrorBoundary } from '../../src/app/errors/AppErrorBoundary';
import { AppProviders } from '../../src/app/providers/AppProviders';

export const metadata: Metadata = {
  title: 'VoiceFlow Studio',
  description: 'VoiceFlow workspace for creators and production teams.',
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = 'force-dynamic';

export default function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="vf-theme-dark theme-dark min-h-screen bg-[color:var(--vf-bg)] text-[color:var(--vf-text)]">
      <AppProviders>
        <AppErrorBoundary>{children}</AppErrorBoundary>
      </AppProviders>
    </div>
  );
}
