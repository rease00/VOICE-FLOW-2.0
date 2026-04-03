'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppScreen } from '../../../../types';
import { Onboarding } from '../../../../src/features/onboarding/Onboarding';
import { resolveAppPath, resolveLoginPath, type AuthRouteMode } from '../../../../src/app/navigation';

export default function AppOnboardingPage() {
  const router = useRouter();
  const setScreen = useCallback((screen: AppScreen) => {
    router.replace(resolveAppPath(screen));
  }, [router]);

  const openAuthScreen = useCallback((mode: AuthRouteMode) => {
    router.replace(resolveLoginPath(mode));
  }, [router]);

  return <Onboarding setScreen={setScreen} openAuthScreen={openAuthScreen} />;
}
