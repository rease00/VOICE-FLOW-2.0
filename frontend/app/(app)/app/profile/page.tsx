'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppScreen } from '../../../../types';
import { Profile } from '../../../../views/Profile';
import { resolveAppPath } from '../../../../src/app/navigation';

export default function AppProfilePage() {
  const router = useRouter();
  const setScreen = useCallback((screen: AppScreen) => {
    const suffix = typeof window !== 'undefined' ? window.location.search : '';
    router.replace(`${resolveAppPath(screen)}${suffix}`);
  }, [router]);

  return <Profile setScreen={setScreen} />;
}
