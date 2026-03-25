'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppScreen } from '../../../../types';
import { Onboarding } from '../../../../views/Onboarding';
import { resolveAppPath } from '../../../../src/app/navigation';

export default function AppOnboardingPage() {
  const router = useRouter();
  const setScreen = useCallback((screen: AppScreen) => {
    router.replace(resolveAppPath(screen));
  }, [router]);

  return <Onboarding setScreen={setScreen} />;
}
