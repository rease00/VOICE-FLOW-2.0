'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppScreen } from '../../../types';
import { useUser } from '../../features/auth/context/UserContext';
import { MainApp } from '../../../views/MainApp';
import { resolveAppPath } from '../navigation';

type WorkspaceStartupState =
  | { kind: 'booting'; stalled: boolean; elapsedMs: number }
  | { kind: 'ready' };

const BOOTSTRAP_STALL_MS = 8_000;

export function WorkspaceScreen() {
  const router = useRouter();
  const { authReady } = useUser();
  const [bootStartedAt] = useState<number>(() => Date.now());
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  const setScreen = useCallback((screen: AppScreen) => {
    router.replace(resolveAppPath(screen));
  }, [router]);

  useEffect(() => {
    if (authReady) return;
    const syncElapsed = () => setElapsedMs(Math.max(0, Date.now() - bootStartedAt));
    syncElapsed();
    const timerId = window.setInterval(syncElapsed, 1_000);
    return () => window.clearInterval(timerId);
  }, [authReady, bootStartedAt]);

  const startupState: WorkspaceStartupState = useMemo(() => {
    if (authReady) return { kind: 'ready' };
    const safeElapsed = Math.max(0, elapsedMs || 0);
    return {
      kind: 'booting',
      stalled: safeElapsed >= BOOTSTRAP_STALL_MS,
      elapsedMs: safeElapsed,
    };
  }, [authReady, elapsedMs]);

  if (startupState.kind === 'booting' && !startupState.stalled) {
    return (
      <div
        className="flex min-h-[100dvh] items-center justify-center text-sm opacity-80"
        role="status"
        aria-live="polite"
      >
        Restoring workspace...
      </div>
    );
  }

  if (startupState.kind === 'booting' && startupState.stalled) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-300 bg-white p-5 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
          <h1 className="text-base font-semibold">Still restoring workspace</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Session bootstrap is taking longer than expected. You can retry the interface or open the sign-in screen.
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Elapsed: {Math.round(startupState.elapsedMs / 1_000)}s
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => router.refresh()}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Retry bootstrap
            </button>
            <button
              type="button"
              onClick={() => setScreen(AppScreen.LOGIN)}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Open sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <MainApp setScreen={setScreen} />;
}
