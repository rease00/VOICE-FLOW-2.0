'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { FullAppProviders } from './FullAppProviders';

const AUTH_SURFACE_PATHS = new Set(['/app/login']);

export const AppProviders: React.FC<React.PropsWithChildren> = ({ children }) => {
  const pathname = usePathname();
  const safePath = String(pathname || '').trim();

  if (AUTH_SURFACE_PATHS.has(safePath)) {
    return <>{children}</>;
  }

  return <FullAppProviders>{children}</FullAppProviders>;
};
