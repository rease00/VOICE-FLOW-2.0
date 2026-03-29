import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppErrorBoundary } from '../../src/app/errors/AppErrorBoundary';
import { AppProviders } from '../../src/app/providers/AppProviders';
import { DEFAULT_UI_BRAND_THEME } from '../../src/shared/theme/brandThemes';
import './app/app-shell.css';

export const metadata: Metadata = {
  title: 'V FLOW AI Studio',
  description: 'V FLOW AI workspace for creators and production teams.',
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = 'force-dynamic';

export default function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div
      className="min-h-screen bg-[color:var(--vf-bg)] text-[color:var(--vf-text)]"
      data-vf-brand-theme={DEFAULT_UI_BRAND_THEME}
      data-vf-theme-mode="dark"
      data-vf-resolved-theme="dark"
    >
      <AppProviders>
        <AppErrorBoundary>{children}</AppErrorBoundary>
      </AppProviders>
    </div>
  );
}
