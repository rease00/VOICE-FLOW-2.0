'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppScreen } from '../../../types';
import { useUser } from '../../features/auth/context/UserContext';
import { MainApp } from '../../../views/MainApp';
import { resolveAppPath } from '../navigation';

export function WorkspaceScreen() {
  const router = useRouter();
  const { authReady } = useUser();
  const setScreen = useCallback((screen: AppScreen) => {
    router.replace(resolveAppPath(screen));
  }, [router]);

  if (!authReady) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center text-sm opacity-80">
        Restoring workspace...
      </div>
    );
  }

  return <MainApp setScreen={setScreen} />;
}
