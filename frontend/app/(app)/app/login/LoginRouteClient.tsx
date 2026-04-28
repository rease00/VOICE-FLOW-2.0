'use client';

import React from 'react';
import type { AuthRouteMode } from '../../../../src/app/navigation';
import { RouteLoginScreen } from './RouteLoginScreen';

interface LoginRouteClientProps {
  initialMode?: AuthRouteMode;
  nextPath?: string | null;
}

export function LoginRouteClient({ nextPath }: LoginRouteClientProps) {
  return <RouteLoginScreen {...(nextPath !== undefined ? { nextPath } : {})} />;
}
