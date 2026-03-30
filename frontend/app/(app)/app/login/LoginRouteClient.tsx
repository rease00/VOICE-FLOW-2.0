'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppScreen } from '../../../../types';
import { Login } from '../../../../views/Login';
import { resolveAppPath, resolveLoginPath, type AuthRouteMode } from '../../../../src/app/navigation';

interface LoginRouteClientProps {
  initialMode?: AuthRouteMode;
  nextPath?: string | null;
}

export function LoginRouteClient({ initialMode, nextPath }: LoginRouteClientProps) {
  const router = useRouter();

  const setScreen = useCallback((screen: AppScreen) => {
    router.replace(resolveAppPath(screen));
  }, [router]);

  const syncModeToRoute = useCallback((mode: AuthRouteMode) => {
    router.replace(resolveLoginPath(mode, nextPath));
  }, [nextPath, router]);

  const navigateToPath = useCallback((path: string) => {
    router.replace(path);
  }, [router]);

  return (
    <Login
      setScreen={setScreen}
      syncModeToRoute={syncModeToRoute}
      navigateToPath={navigateToPath}
      {...(nextPath ? { nextPath } : {})}
      {...(initialMode ? { initialMode } : {})}
    />
  );
}
