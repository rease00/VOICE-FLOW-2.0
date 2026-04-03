'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { ArrowRight, RefreshCw, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrandLogo } from '../../../components/BrandLogo';
import { firebaseAuth } from '../../../services/firebaseClient';
import type { GenerationSettings } from '../../../types';
import { resolveLoginPath } from '../../app/navigation';
import { useUser } from '../../features/auth/context/UserContext';
import { resolveApiBaseUrl } from '../../shared/api/config';
import { useNotifications } from '../../shared/notifications/NotificationProvider';
import { STORAGE_KEYS } from '../../shared/storage/keys';
import { readStorageJson, readStorageString } from '../../shared/storage/localStore';
import { readUiThemeModeFromStorage } from '../../shared/theme/themeDom';
import type { ReaderResolvedTheme } from '../../features/reader/components/readerTypes';

interface ReaderTabContentBridgeProps {
  mediaBackendUrl: string;
  settings?: GenerationSettings;
  resolvedTheme: ReaderResolvedTheme;
  denseTabs?: boolean;
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  authReturnPath?: string;
  syncLocation?: boolean;
  isActive?: boolean;
}

const loadReaderTabContent = () => import('../../features/reader/components/ReaderTabContent').then((module) => module.ReaderTabContent);

const ReaderTabContent = dynamic<ReaderTabContentBridgeProps>(
  loadReaderTabContent,
  {
    ssr: false,
    loading: () => <ReaderRouteLoading />,
  }
);
const AUTH_GATE_FALLBACK_MS = 350;

const resolveReaderTheme = (): ReaderResolvedTheme => {
  const themeMode = readUiThemeModeFromStorage(readStorageString(STORAGE_KEYS.uiTheme));
  if (themeMode === 'system') {
    if (typeof window === 'undefined') return 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return themeMode;
};

const resolveReaderReturnPath = (pathname?: string | null): string => {
  const safePath = String(pathname || '').trim().replace(/\/+$/, '') || '/app/reader';
  if (safePath === '/app/reader' || safePath.startsWith('/app/reader/')) return safePath;
  if (safePath === '/reader' || safePath.startsWith('/reader/')) {
    return safePath.replace(/^\/reader/, '/app/reader');
  }
  return '/app/reader';
};

const ReaderRouteLoading = () => {
  const pathname = usePathname();
  const readerReturnPath = useMemo(() => resolveReaderReturnPath(pathname), [pathname]);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[radial-gradient(80%_70%_at_12%_8%,rgba(34,211,238,0.16),transparent_58%),radial-gradient(74%_64%_at_88%_12%,rgba(99,102,241,0.15),transparent_62%),linear-gradient(165deg,#020617_0%,#081226_52%,#050913_100%)] px-4 py-8 text-slate-100">
    <div className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-slate-950/68 p-6 shadow-[0_28px_70px_rgba(2,6,23,0.58)] backdrop-blur-xl sm:p-7">
      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
        <Sparkles size={13} />
        Reader workspace
      </div>
      <div className="mt-5 flex items-start justify-between gap-4">
        <div>
          <BrandLogo size="lg" tone="light" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Opening Reader
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-7 text-slate-300 sm:text-base">
            Loading shelves, deep links, and the compact reading surface.
          </p>
        </div>
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/25 bg-cyan-500/12 text-cyan-100">
          <RefreshCw size={18} className="animate-spin" />
        </span>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Shelves', value: 'Restoring' },
          { label: 'Session', value: 'Hydrating' },
          { label: 'Controls', value: 'Loading' },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              {item.label}
            </div>
            <div className="mt-2 text-sm font-semibold text-white">{item.value}</div>
          </div>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-slate-300">
        <span>Reader mode is waiting for shared bootstrap to finish.</span>
        <a
          href={resolveLoginPath('login', readerReturnPath)}
          className="inline-flex min-h-11 items-center gap-1 rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:border-white/[0.2] hover:bg-white/[0.08]"
        >
          Sign in
          <ArrowRight size={14} />
        </a>
      </div>
    </div>
    </div>
  );
};

export function ReaderRouteScreen() {
  const settings = useMemo<Partial<GenerationSettings>>(() => (
    readStorageJson<Partial<GenerationSettings>>(STORAGE_KEYS.settings) || {}
  ), []);
  const mediaBackendUrl = useMemo(() => resolveApiBaseUrl(settings.mediaBackendUrl), [settings.mediaBackendUrl]);
  const resolvedTheme = useMemo<ReaderResolvedTheme>(() => resolveReaderTheme(), []);
  const pathname = usePathname();
  const readerReturnPath = useMemo(() => resolveReaderReturnPath(pathname), [pathname]);
  const { authReady, isAuthenticated } = useUser();
  const hasImmediateFirebaseSession = Boolean(firebaseAuth.currentUser);
  const [authGateFallbackElapsed, setAuthGateFallbackElapsed] = useState(false);
  const { notifyError, notifyInfo, notifySuccess } = useNotifications();
  const shouldShowOptimisticSignInGate = !authReady && !hasImmediateFirebaseSession && authGateFallbackElapsed;

  const onToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const text = String(message || '').trim();
    if (!text) return;
    if (type === 'success') {
      notifySuccess(text);
      return;
    }
    if (type === 'error') {
      notifyError(text);
      return;
    }
    notifyInfo(text);
  }, [notifyError, notifyInfo, notifySuccess]);

  useEffect(() => {
    if (authReady || hasImmediateFirebaseSession) {
      setAuthGateFallbackElapsed(false);
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      setAuthGateFallbackElapsed(true);
    }, AUTH_GATE_FALLBACK_MS);
    return () => window.clearTimeout(timeoutId);
  }, [authReady, hasImmediateFirebaseSession]);

  if (!authReady) {
    if (shouldShowOptimisticSignInGate) {
      return (
        <main className="min-h-[100dvh] overflow-hidden bg-[radial-gradient(80%_70%_at_12%_8%,rgba(34,211,238,0.16),transparent_58%),radial-gradient(74%_64%_at_88%_12%,rgba(99,102,241,0.15),transparent_62%),linear-gradient(165deg,#020617_0%,#081226_52%,#050913_100%)] px-4 py-8 text-slate-100">
          <div className="mx-auto flex min-h-[100dvh] w-full max-w-5xl items-center justify-center">
            <div className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-slate-950/68 p-6 shadow-[0_28px_70px_rgba(2,6,23,0.58)] backdrop-blur-xl sm:p-7">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                <Sparkles size={13} />
                Reader workspace
              </div>
              <div className="mt-5 flex items-start justify-between gap-4">
                <div>
                  <BrandLogo size="lg" tone="light" />
                  <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                    Sign in to open Reader
                  </h1>
                  <p className="mt-3 max-w-lg text-sm leading-7 text-slate-300 sm:text-base">
                    Shelves, saved sessions, and playback tools restore after secure sign-in.
                  </p>
                </div>
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/25 bg-cyan-500/12 text-cyan-100">
                  <ArrowRight size={18} />
                </span>
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                <a
                  href={resolveLoginPath('login', readerReturnPath)}
                  className="rounded-full bg-gradient-to-r from-cyan-400 via-sky-500 to-indigo-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-[0_16px_36px_rgba(34,211,238,0.22)] transition hover:translate-y-[-1px] hover:brightness-105"
                >
                  Open secure sign-in
                </a>
                <a
                  href={resolveLoginPath('signup', readerReturnPath)}
                  className="rounded-full border border-white/12 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.08]"
                >
                  Create account
                </a>
              </div>
            </div>
          </div>
        </main>
      );
    }
    return <ReaderRouteLoading />;
  }

  if (!isAuthenticated && hasImmediateFirebaseSession) {
    return <ReaderRouteLoading />;
  }

  if (!isAuthenticated) {
    return (
      <main className="min-h-[100dvh] overflow-hidden bg-[radial-gradient(80%_70%_at_12%_8%,rgba(34,211,238,0.16),transparent_58%),radial-gradient(74%_64%_at_88%_12%,rgba(99,102,241,0.15),transparent_62%),linear-gradient(165deg,#020617_0%,#081226_52%,#050913_100%)] px-4 py-8 text-slate-100">
        <div className="mx-auto flex min-h-[100dvh] w-full max-w-5xl items-center justify-center">
          <div className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-slate-950/68 p-6 shadow-[0_28px_70px_rgba(2,6,23,0.58)] backdrop-blur-xl sm:p-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
              <Sparkles size={13} />
              Reader workspace
            </div>
            <div className="mt-5 flex items-start justify-between gap-4">
              <div>
                <BrandLogo size="lg" tone="light" />
                <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  Sign in to open Reader
                </h1>
                <p className="mt-3 max-w-lg text-sm leading-7 text-slate-300 sm:text-base">
                  Shelves, saved sessions, and playback tools restore after secure sign-in.
                </p>
              </div>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/25 bg-cyan-500/12 text-cyan-100">
                <ArrowRight size={18} />
              </span>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <a
                href={resolveLoginPath('login', readerReturnPath)}
                className="rounded-full bg-gradient-to-r from-cyan-400 via-sky-500 to-indigo-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-[0_16px_36px_rgba(34,211,238,0.22)] transition hover:translate-y-[-1px] hover:brightness-105"
              >
                Open secure sign-in
              </a>
              <a
                href={resolveLoginPath('signup', readerReturnPath)}
                className="rounded-full border border-white/12 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.08]"
              >
                Create account
              </a>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] overflow-hidden">
      <ReaderTabContent
        mediaBackendUrl={mediaBackendUrl}
        settings={settings as GenerationSettings}
        resolvedTheme={resolvedTheme}
        onToast={onToast}
        authReturnPath={readerReturnPath}
        syncLocation
        isActive
      />
    </main>
  );
}
