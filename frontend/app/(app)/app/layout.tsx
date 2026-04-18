import type { ReactNode } from 'react';
import { UiV2FlagProvider } from '../../../src/features/feature-flags/UiV2FlagContext';
import { AuroraDevPanel } from '../../../src/features/feature-flags/AuroraDevPanel';

// The /app workspace ships with a nonce-based CSP from middleware.ts.
// Force request-time rendering so Next can stamp matching nonces onto its
// inline flight/bootstrap scripts instead of prerendering nonce="undefined".
export const dynamic = 'force-dynamic';

export default function WorkspaceShellLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <UiV2FlagProvider>
      {children}
      <AuroraDevPanel />
    </UiV2FlagProvider>
  );
}
