'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppScreen } from '../../../../types';
import { Login } from '../../../../views/Login';
import { resolveAppPath, resolveLoginPath, type AuthRouteMode } from '../../../../src/app/navigation';
import { UserProvider, useOptionalUser } from '../../../../src/features/auth/context/UserContext';

interface LoginRouteClientProps {
  initialMode?: AuthRouteMode;
  nextPath?: string | null;
}

export function LoginRouteClient({ initialMode, nextPath }: LoginRouteClientProps) {
  const router = useRouter();
  const userContext = useOptionalUser();

  const setScreen = useCallback((screen: AppScreen) => {
    router.replace(resolveAppPath(screen));
  }, [router]);

  const syncModeToRoute = useCallback((mode: AuthRouteMode) => {
    router.replace(resolveLoginPath(mode, nextPath));
  }, [nextPath, router]);

  const navigateToPath = useCallback((path: string) => {
    router.replace(path);
  }, [router]);

  const loginProps = {
    setScreen,
    syncModeToRoute,
    navigateToPath,
    ...(nextPath ? { nextPath } : {}),
    ...(initialMode ? { initialMode } : {}),
  };

  if (userContext) {
    return <Login {...loginProps} />;
  }

  return (
    <UserProvider>
      <Login {...loginProps} />
    </UserProvider>
  );
}
