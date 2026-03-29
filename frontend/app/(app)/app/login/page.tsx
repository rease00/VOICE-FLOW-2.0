'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppScreen } from '../../../../types';
import { Login } from '../../../../views/Login';
import {
  resolveAppPath,
  resolveLoginPath,
  resolveSafeInternalNextPath,
  type AuthRouteMode,
} from '../../../../src/app/navigation';

export default function AppLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedMode = searchParams.get('mode');
  const requestedNext = resolveSafeInternalNextPath(searchParams.get('next'), null);
  const initialMode: AuthRouteMode | undefined =
    requestedMode === 'signup' || requestedMode === 'login' ? requestedMode : undefined;

  const setScreen = useCallback((screen: AppScreen) => {
    router.replace(resolveAppPath(screen));
  }, [router]);

  const syncModeToRoute = useCallback((mode: AuthRouteMode) => {
    router.replace(resolveLoginPath(mode, requestedNext));
  }, [requestedNext, router]);

  const navigateToPath = useCallback((path: string) => {
    router.replace(path);
  }, [router]);

  return (
    <Login
      setScreen={setScreen}
      syncModeToRoute={syncModeToRoute}
      navigateToPath={navigateToPath}
      {...(requestedNext ? { nextPath: requestedNext } : {})}
      {...(initialMode ? { initialMode } : {})}
    />
  );
}
