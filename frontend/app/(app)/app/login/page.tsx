'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppScreen } from '../../../../types';
import { Login } from '../../../../views/Login';
import { resolveAppPath } from '../../../../src/app/navigation';

export default function AppLoginPage() {
  const router = useRouter();
  const setScreen = useCallback((screen: AppScreen) => {
    router.replace(resolveAppPath(screen));
  }, [router]);

  return <Login setScreen={setScreen} />;
}
