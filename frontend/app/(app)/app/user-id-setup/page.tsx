'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppScreen } from '../../../../types';
import { UserIdSetup } from '../../../../views/UserIdSetup';
import { resolveAppPath } from '../../../../src/app/navigation';

export default function AppUserIdSetupPage() {
  const router = useRouter();
  const setScreen = useCallback((screen: AppScreen) => {
    router.replace(resolveAppPath(screen));
  }, [router]);

  return <UserIdSetup setScreen={setScreen} />;
}
