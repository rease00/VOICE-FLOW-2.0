import type { ReactNode } from 'react';

// Public pages also ship behind the nonce-based CSP from middleware.ts.
// Render them at request time so Next can attach the active nonce to its
// inline/bootstrap scripts instead of emitting nonce="undefined" in prerendered HTML.
export const dynamic = 'force-dynamic';

export default function PublicLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <>{children}</>;
}
