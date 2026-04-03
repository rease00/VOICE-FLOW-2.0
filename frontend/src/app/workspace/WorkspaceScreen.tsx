'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { BrandLogo } from '../../../components/BrandLogo';
import { AppScreen } from '../../../types';
import { useUser } from '../../features/auth/context/UserContext';
import { resolveAppPath, resolveLoginPath } from '../navigation';
import { WorkspaceMainApp } from './WorkspaceMainApp';
import { preloadWorkspaceMainApp } from './workspaceMainAppLoader';
import { shouldTrackWorkspaceBootstrapElapsed } from './workspaceBootstrap';
import { firebaseAuth } from '../../../services/firebaseClient';

type WorkspaceStartupState =
  | { kind: 'booting'; stalled: boolean; elapsedMs: number }
  | { kind: 'ready' };

const BOOTSTRAP_STALL_MS = 8_000;

const resolveWorkspaceAuthGateContent = (pathname?: string | null) => {
  const safePath = String(pathname || '').trim().toLowerCase();
  if (safePath.startsWith('/app/voices')) {
    return {
      eyebrow: 'Voices workspace',
      title: 'Sign in to open Voices',
      description: 'Voice library filters, clone tools, and cast presets stay behind secure workspace access.',
    };
  }
  if (safePath.startsWith('/app/reader')) {
    return {
      eyebrow: 'Reader workspace',
      title: 'Sign in to open Reader',
      description: 'Shelves, saved sessions, and playback controls restore after secure sign-in.',
    };
  }
  if (safePath.startsWith('/app/runs')) {
    return {
      eyebrow: 'Runs workspace',
      title: 'Sign in to open Runs',
      description: 'History, queue status, and job recovery stay tied to your account session.',
    };
  }
  if (safePath.startsWith('/app/admin')) {
    return {
      eyebrow: 'Admin workspace',
      title: 'Sign in to open Admin',
      description: 'Operational controls and audit tooling require a verified workspace session.',
    };
  }
  if (safePath.startsWith('/app/billing')) {
    return {
      eyebrow: 'Billing workspace',
      title: 'Sign in to open Billing',
      description: 'Usage, token balance, and checkout recovery stay attached to your secure account.',
    };
  }
  return {
    eyebrow: 'Studio workspace',
    title: 'Sign in to open Studio',
    description: 'Drafts, engine controls, and generation history stay inside your secure workspace session.',
  };
};

export function WorkspaceScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const { authReady, isAuthenticated } = useUser();
  const [bootStartedAt] = useState<number>(() => Date.now());
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const normalizedPathname = String(pathname || '').trim().toLowerCase();
  const isWorkspaceRootPath = normalizedPathname === '/app';
  const isReaderWorkspacePath = normalizedPathname === '/app/reader' || normalizedPathname.startsWith('/app/reader/');
  const hasBootstrapGraceElapsed = elapsedMs >= BOOTSTRAP_STALL_MS;
  const hasImmediateFirebaseSession = Boolean(firebaseAuth.currentUser);
  const shouldWarmWorkspaceShell = authReady ? isAuthenticated : hasImmediateFirebaseSession;
  const shouldShowWorkspaceAuthGate = authReady && !isAuthenticated && !isWorkspaceRootPath && !isReaderWorkspacePath;
  const workspaceAuthGate = useMemo(
    () => resolveWorkspaceAuthGateContent(normalizedPathname),
    [normalizedPathname]
  );
  const workspaceLoginHref = useMemo(
    () => resolveLoginPath('login', pathname),
    [pathname]
  );
  const workspaceSignupHref = useMemo(
    () => resolveLoginPath('signup', pathname),
    [pathname]
  );

  const setScreen = useCallback((screen: AppScreen) => {
    router.replace(resolveAppPath(screen));
  }, [router]);

  const shouldHoldWorkspaceBootstrap = !authReady && !shouldWarmWorkspaceShell && !hasBootstrapGraceElapsed;
  const shouldRedirectToOnboarding = authReady && !isAuthenticated && isWorkspaceRootPath;

  useEffect(() => {
    if (isReaderWorkspacePath || !shouldWarmWorkspaceShell) return;
    preloadWorkspaceMainApp();
  }, [isReaderWorkspacePath, shouldWarmWorkspaceShell]);

  useEffect(() => {
    if (!shouldRedirectToOnboarding) return;
    router.replace(resolveAppPath(AppScreen.ONBOARDING));
  }, [router, shouldRedirectToOnboarding]);

  useEffect(() => {
    if (!shouldTrackWorkspaceBootstrapElapsed(authReady)) return;
    const syncElapsed = () => {
      const nextElapsed = Math.max(0, Date.now() - bootStartedAt);
      setElapsedMs((previous) => (previous === nextElapsed ? previous : nextElapsed));
    };
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

  const elapsedSeconds = Math.max(0, Math.round(elapsedMs / 1_000));
  const loadingLabel = isWorkspaceRootPath ? 'Opening Studio' : 'Restoring your workspace';
  const loadingDescription = isWorkspaceRootPath
    ? "We're checking your session and sending you to the right starting point."
    : 'Reconnecting your account and saved workspace state.';

  if (shouldHoldWorkspaceBootstrap) {
    return (
      <div
        className="min-h-[100dvh] overflow-hidden bg-[radial-gradient(82%_72%_at_12%_10%,rgba(34,211,238,0.16),transparent_58%),radial-gradient(74%_66%_at_88%_14%,rgba(99,102,241,0.18),transparent_60%),linear-gradient(165deg,#020617_0%,#081226_52%,#050913_100%)] px-4 py-6 text-slate-100"
        role="status"
        aria-live="polite"
      >
        <div className="mx-auto flex min-h-[100dvh] w-full max-w-5xl items-center justify-center">
          <div className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-slate-950/68 p-6 shadow-[0_28px_70px_rgba(2,6,23,0.58)] backdrop-blur-xl sm:p-7">
            <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
              Workspace handoff
            </div>
            <div className="mt-5 flex items-start justify-between gap-4">
              <div>
                <BrandLogo size="lg" tone="light" />
                <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  {loadingLabel}
                </h1>
                <p className="mt-3 max-w-lg text-sm leading-7 text-slate-300 sm:text-base">
                  {loadingDescription}
                </p>
              </div>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/25 bg-cyan-500/12 text-cyan-100">
                <RefreshCw size={18} className="animate-spin" />
              </span>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                { label: 'Studio', value: 'Ready' },
                { label: 'Voices', value: 'Synced' },
                { label: 'History', value: 'Waiting' },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{item.label}</div>
                  <div className="mt-2 text-sm font-semibold text-white">{item.value}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-slate-300">
              <span>{isWorkspaceRootPath ? 'Checking session and route' : `Elapsed: ${elapsedSeconds}s`}</span>
              <span className="inline-flex items-center gap-1 text-cyan-100">
                Keep this tab open <ArrowRight size={13} />
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (shouldRedirectToOnboarding) {
    return (
      <div
        className="min-h-[100dvh] overflow-hidden bg-[radial-gradient(82%_72%_at_12%_10%,rgba(34,211,238,0.16),transparent_58%),radial-gradient(74%_66%_at_88%_14%,rgba(99,102,241,0.18),transparent_60%),linear-gradient(165deg,#020617_0%,#081226_52%,#050913_100%)] px-4 py-6 text-slate-100"
        role="status"
        aria-live="polite"
      >
        <div className="mx-auto flex min-h-[100dvh] w-full max-w-5xl items-center justify-center">
          <div className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-slate-950/68 p-6 shadow-[0_28px_70px_rgba(2,6,23,0.58)] backdrop-blur-xl sm:p-7">
            <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
              Workspace handoff
            </div>
            <div className="mt-5 flex items-start justify-between gap-4">
              <div>
                <BrandLogo size="lg" tone="light" />
                <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  Opening Studio
                </h1>
                <p className="mt-3 max-w-lg text-sm leading-7 text-slate-300 sm:text-base">
                  New users start with a short onboarding flow so the first step stays clear.
                </p>
              </div>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/25 bg-cyan-500/12 text-cyan-100">
                <RefreshCw size={18} className="animate-spin" />
              </span>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => router.replace(resolveAppPath(AppScreen.ONBOARDING))}
                className="rounded-full bg-gradient-to-r from-cyan-400 via-sky-500 to-indigo-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-[0_16px_36px_rgba(34,211,238,0.22)] transition hover:translate-y-[-1px] hover:brightness-105"
              >
                Continue to onboarding
              </button>
              <button
                type="button"
                onClick={() => setScreen(AppScreen.LOGIN)}
                className="rounded-full border border-white/12 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.08]"
              >
                Open secure sign-in
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (shouldShowWorkspaceAuthGate) {
    return (
      <div
        className="min-h-[100dvh] overflow-hidden bg-[radial-gradient(82%_72%_at_12%_10%,rgba(34,211,238,0.16),transparent_58%),radial-gradient(74%_66%_at_88%_14%,rgba(99,102,241,0.18),transparent_60%),linear-gradient(165deg,#020617_0%,#081226_52%,#050913_100%)] px-4 py-6 text-slate-100"
        role="status"
        aria-live="polite"
      >
        <div className="mx-auto flex min-h-[100dvh] w-full max-w-5xl items-center justify-center">
          <div className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-slate-950/68 p-6 shadow-[0_28px_70px_rgba(2,6,23,0.58)] backdrop-blur-xl sm:p-7">
            <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
              {workspaceAuthGate.eyebrow}
            </div>
            <div className="mt-5 flex items-start justify-between gap-4">
              <div>
                <BrandLogo size="lg" tone="light" />
                <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  {workspaceAuthGate.title}
                </h1>
                <p className="mt-3 max-w-lg text-sm leading-7 text-slate-300 sm:text-base">
                  {workspaceAuthGate.description}
                </p>
              </div>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/25 bg-cyan-500/12 text-cyan-100">
                <ArrowRight size={18} />
              </span>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <a
                href={workspaceLoginHref}
                className="rounded-full bg-gradient-to-r from-cyan-400 via-sky-500 to-indigo-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-[0_16px_36px_rgba(34,211,238,0.22)] transition hover:translate-y-[-1px] hover:brightness-105"
              >
                Open secure sign-in
              </a>
              <a
                href={workspaceSignupHref}
                className="rounded-full border border-white/12 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.08]"
              >
                Create account
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!authReady && !shouldWarmWorkspaceShell && hasBootstrapGraceElapsed) {
    return (
      <div className="min-h-[100dvh] overflow-hidden bg-[radial-gradient(78%_68%_at_14%_10%,rgba(34,211,238,0.14),transparent_58%),radial-gradient(72%_62%_at_88%_12%,rgba(244,114,182,0.14),transparent_60%),linear-gradient(165deg,#020617_0%,#081226_54%,#050913_100%)] px-4 py-6 text-slate-100">
        <div className="mx-auto flex min-h-[100dvh] w-full max-w-5xl items-center justify-center">
          <div className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-slate-950/72 p-6 shadow-[0_28px_70px_rgba(2,6,23,0.62)] backdrop-blur-xl sm:p-7">
            <BrandLogo size="lg" tone="light" />
            <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {isWorkspaceRootPath ? 'Studio is taking longer than usual' : 'Workspace is taking longer than usual'}
            </h1>
            <p className="mt-3 text-sm leading-7 text-slate-300">
              {isWorkspaceRootPath
                ? 'Retry the interface, open onboarding directly, or move to secure sign-in if this browser state is stale.'
                : 'Retry the interface or move to sign-in if this browser state is stale.'}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              Elapsed: {Math.round(elapsedMs / 1_000)}s
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => router.refresh()}
                className="rounded-full border border-white/12 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.08]"
              >
                Retry workspace
              </button>
              {isWorkspaceRootPath ? (
                <button
                  type="button"
                  onClick={() => router.replace(resolveAppPath(AppScreen.ONBOARDING))}
                  className="rounded-full border border-white/12 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.08]"
                >
                  Continue to onboarding
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setScreen(AppScreen.LOGIN)}
                className="rounded-full bg-gradient-to-r from-cyan-400 via-sky-500 to-indigo-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-[0_16px_36px_rgba(34,211,238,0.22)] transition hover:translate-y-[-1px] hover:brightness-105"
              >
                Open secure sign-in
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <WorkspaceMainApp setScreen={setScreen} />;
}
