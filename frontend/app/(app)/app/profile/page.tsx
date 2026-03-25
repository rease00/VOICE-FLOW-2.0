'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppScreen } from '../../../../types';
import { Profile } from '../../../../views/Profile';
import { resolveAppPath } from '../../../../src/app/navigation';

export default function AppProfilePage() {
  const router = useRouter();
  const setScreen = useCallback((screen: AppScreen) => {
    router.replace(resolveAppPath(screen));
  }, [router]);

  return <Profile setScreen={setScreen} />;
}
