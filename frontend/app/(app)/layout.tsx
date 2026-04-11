import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppErrorBoundary } from '../../src/app/errors/AppErrorBoundary';
import { AppShellVisualBootstrap } from '../../src/app/providers/AppShellVisualBootstrap';
import { AppThemeBootstrap } from '../../src/app/providers/AppThemeBootstrap';
import { AppProviders } from '../../src/app/providers/AppProviders';
import { DEFAULT_UI_BRAND_THEME } from '../../src/shared/theme/brandThemes';
import './app/app-shell.css';

export const metadata: Metadata = {
  title: 'V FLOW AI | AI STUDIO',
  description: 'V FLOW AI workspace for creators and production teams.',
  robots: {
    index: false,
    follow: false,
  },
};

export default function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div
      className="vf-app-layout relative isolate min-h-screen overflow-hidden bg-[color:var(--vf-bg)] text-[color:var(--vf-text)]"
      data-vf-app-shell
      data-vf-visual-ready="false"
      data-vf-brand-theme={DEFAULT_UI_BRAND_THEME}
      data-vf-theme-mode="dark"
      data-vf-resolved-theme="dark"
    >
      <AppThemeBootstrap />
      <AppShellVisualBootstrap />
      <div className="vf-live-wallpaper" aria-hidden="true" />
      <div className="relative z-[1]">
        <AppProviders>
          <AppErrorBoundary>{children}</AppErrorBoundary>
        </AppProviders>
      </div>
    </div>
  );
}
