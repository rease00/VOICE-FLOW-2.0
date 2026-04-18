import type { ReactNode } from 'react';

// The /app workspace ships with a nonce-based CSP from middleware.ts.
// Force request-time rendering so Next can stamp matching nonces onto its
// inline flight/bootstrap scripts instead of prerendering nonce="undefined".
export const dynamic = 'force-dynamic';

export default function WorkspaceShellLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <>{children}</>;
}
