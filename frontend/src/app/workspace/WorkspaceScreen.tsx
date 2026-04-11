'use client';

import React, { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react';
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
  if (safePath.startsWith('/app/voices')) return { eyebrow: 'Voices workspace', title: 'Sign in to open Voices', description: 'Voice tools, clone flows, and cast presets stay behind secure workspace access.' };
  if (safePath.startsWith('/app/writing')) {
    return { eyebrow: 'Writing workspace', title: 'Sign in to open Writing', description: 'Drafts and workspace state restore after secure sign-in.' };
  }
  if (safePath.startsWith('/app/runs')) return { eyebrow: 'Runs workspace', title: 'Sign in to open Runs', description: 'History, queue status, and job recovery stay tied to your account session.' };
  if (safePath.startsWith('/app/admin')) return { eyebrow: 'Admin workspace', title: 'Sign in to open Admin', description: 'Operational controls and audit tooling require a verified workspace session.' };
  if (safePath.startsWith('/app/billing')) return { eyebrow: 'Billing workspace', title: 'Sign in to open Billing', description: 'Usage, token balance, and checkout recovery stay attached to your secure account.' };
  return { eyebrow: 'Studio workspace', title: 'Sign in to open Studio', description: 'Drafts, engine controls, and generation history stay inside your secure workspace session.' };
};

// ── Shared shell wrapper ─────────────────────────────────────────────────────

function PremiumShell({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div
      className="ap-shell overflow-hidden"
      role="status"
      aria-live="polite"
      aria-label={label || 'Loading workspace'}
    >
      <div className="ap-grid" aria-hidden="true" />
      <div className="ap-aurora ap-aurora--a" aria-hidden="true" />
      <div className="ap-aurora ap-aurora--b" aria-hidden="true" />
      <div className="ap-aurora ap-aurora--c" aria-hidden="true" />
      <div className="relative z-10 flex min-h-[100dvh] items-center justify-center px-4 py-8">
        {children}
      </div>
    </div>
  );
}

// ── Loading screen ───────────────────────────────────────────────────────────

const WAVE_HEIGHTS = [0.55, 0.82, 0.48, 0.9, 0.65, 0.78, 0.52, 0.88] as const;

function BootingCard({
  label,
  description,
  elapsedSeconds,
  badges,
  isRoot,
}: {
  label: string;
  description: string;
  elapsedSeconds: number;
  badges: Array<{ label: string; value: string }>;
  isRoot: boolean;
}) {
  return (
    <div className="ap-card w-full max-w-lg p-6 sm:p-8">
      {/* Eyebrow */}
      <span className="ap-eyebrow">
        <span className="ap-live-dot" style={{ height: '6px', width: '6px' }} />
        Workspace handoff
      </span>

      {/* Brand + title */}
      <div className="mt-6 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <BrandLogo size="md" tone="light" />
          <h1 className="mt-4 text-2xl font-black tracking-tight text-white sm:text-3xl">{label}</h1>
          <p className="mt-2 text-sm leading-7 text-slate-400">{description}</p>
        </div>

        {/* Animated waveform icon */}
        <div className="ap-wave-loader shrink-0 pt-1" aria-hidden="true">
          {WAVE_HEIGHTS.map((h, i) => (
            <span
              key={`bwave-${i}`}
              className="ap-wave-bar"
              style={{
                height: `${h * 100}%`,
                animationDelay: `${i * 120}ms`,
              } as CSSProperties}
            />
          ))}
        </div>
      </div>

      {/* Progress bar */}
      <div className="ap-progress-track mt-6">
        <div className="ap-progress-bar" />
      </div>

      {/* Status grid */}
      <div className="ap-status-grid mt-5">
        {badges.map((b) => (
          <div key={b.label} className="ap-status-item">
            <p className="ap-status-item__label">{b.label}</p>
            <p className="ap-status-item__value">{b.value}</p>
          </div>
        ))}
      </div>

      {/* Status strip */}
      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-2.5 text-xs text-slate-400">
        <span>{isRoot ? 'Checking session and route' : `Elapsed: ${elapsedSeconds}s`}</span>
        <span className="flex items-center gap-1 text-cyan-300">Keep this tab open <ArrowRight size={12} /></span>
      </div>
    </div>
  );
}

// ── Auth gate card ───────────────────────────────────────────────────────────

function AuthGateCard({
  eyebrow,
  title,
  description,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  onPrimaryClick,
  onSecondaryClick,
}: {
  eyebrow: string;
  title: string;
  description: string;
  primaryHref?: string;
  primaryLabel: string;
  secondaryHref?: string;
  secondaryLabel: string;
  onPrimaryClick?: () => void;
  onSecondaryClick?: () => void;
}) {
  return (
    <div className="ap-card w-full max-w-lg p-6 sm:p-8">
      <span className="ap-eyebrow">{eyebrow}</span>

      <div className="mt-6">
        <BrandLogo size="md" tone="light" />
        <h1 className="mt-5 text-2xl font-black tracking-tight text-white sm:text-3xl">{title}</h1>
        <p className="mt-3 text-sm leading-7 text-slate-400">{description}</p>
      </div>

      <hr className="ap-divider my-6" />

      <div className="flex flex-wrap gap-3">
        {primaryHref ? (
          <a href={primaryHref} className="ap-btn-primary flex-1 sm:flex-none" style={{ width: 'auto' }}>
            {primaryLabel} <ArrowRight size={15} />
          </a>
        ) : (
          <button type="button" onClick={onPrimaryClick} className="ap-btn-primary flex-1 sm:flex-none" style={{ width: 'auto' }}>
            {primaryLabel} <ArrowRight size={15} />
          </button>
        )}
        {secondaryHref ? (
          <a href={secondaryHref} className="ap-btn-secondary flex-1 sm:flex-none" style={{ width: 'auto' }}>
            {secondaryLabel}
          </a>
        ) : (
          <button type="button" onClick={onSecondaryClick} className="ap-btn-secondary flex-1 sm:flex-none" style={{ width: 'auto' }}>
            {secondaryLabel}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Stall card ───────────────────────────────────────────────────────────────

function StallCard({
  isRoot,
  elapsedMs,
  onRetry,
  onOnboarding,
  onSignIn,
}: {
  isRoot: boolean;
  elapsedMs: number;
  onRetry: () => void;
  onOnboarding?: () => void;
  onSignIn: () => void;
}) {
  return (
    <div className="ap-card w-full max-w-lg p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-rose-400/25 bg-rose-500/10 text-rose-300">
          <AlertTriangle size={18} />
        </span>
        <div>
          <BrandLogo size="md" tone="light" />
          <h1 className="mt-4 text-xl font-black text-white sm:text-2xl">
            {isRoot ? 'Studio is taking longer than usual' : 'Workspace is taking longer than usual'}
          </h1>
          <p className="mt-2 text-sm leading-7 text-slate-400">
            {isRoot
              ? 'Retry, open onboarding directly, or move to sign-in if this session is stale.'
              : 'Retry or move to sign-in if this browser state is stale.'}
          </p>
          <p className="mt-1 text-xs text-slate-500">Elapsed: {Math.round(elapsedMs / 1_000)}s</p>
        </div>
      </div>

      <hr className="ap-divider my-6" />

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onRetry} className="ap-btn-secondary flex-1 sm:flex-none" style={{ width: 'auto' }}>
          <RefreshCw size={14} /> Retry
        </button>
        {isRoot && onOnboarding && (
          <button type="button" onClick={onOnboarding} className="ap-btn-secondary flex-1 sm:flex-none" style={{ width: 'auto' }}>
            Onboarding
          </button>
        )}
        <button type="button" onClick={onSignIn} className="ap-btn-primary flex-1 sm:flex-none" style={{ width: 'auto' }}>
          Open sign-in <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────

export function WorkspaceScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const { authReady, isAuthenticated } = useUser();
  const [bootStartedAt] = useState<number>(() => Date.now());
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const normalizedPathname = String(pathname || '').trim().toLowerCase();
  const isWorkspaceRootPath = normalizedPathname === '/app';
  const hasBootstrapGraceElapsed = elapsedMs >= BOOTSTRAP_STALL_MS;
  const hasImmediateFirebaseSession = Boolean(firebaseAuth.currentUser);
  const shouldWarmWorkspaceShell = authReady ? isAuthenticated : hasImmediateFirebaseSession;
  const shouldShowWorkspaceAuthGate = authReady && !isAuthenticated && !isWorkspaceRootPath;
  const workspaceAuthGate = useMemo(() => resolveWorkspaceAuthGateContent(normalizedPathname), [normalizedPathname]);
  const workspaceLoginHref = useMemo(() => resolveLoginPath('login', pathname), [pathname]);
  const workspaceSignupHref = useMemo(() => resolveLoginPath('signup', pathname), [pathname]);

  const setScreen = useCallback((screen: AppScreen) => {
    router.replace(resolveAppPath(screen));
  }, [router]);

  const shouldHoldWorkspaceBootstrap = !authReady && !shouldWarmWorkspaceShell && !hasBootstrapGraceElapsed;
  const shouldRedirectToOnboarding = authReady && !isAuthenticated && isWorkspaceRootPath;

  const loadingLabel = isWorkspaceRootPath ? 'Opening Studio' : 'Restoring your workspace';
  const loadingDescription = isWorkspaceRootPath
    ? "We're checking your session and sending you to the right starting point."
    : 'Reconnecting your account and saved workspace state.';

  useEffect(() => {
    if (!shouldWarmWorkspaceShell) return;
    preloadWorkspaceMainApp();
  }, [shouldWarmWorkspaceShell]);

  useEffect(() => {
    if (!shouldRedirectToOnboarding) return;
    router.replace(resolveAppPath(AppScreen.ONBOARDING));
  }, [router, shouldRedirectToOnboarding]);

  useEffect(() => {
    if (!shouldTrackWorkspaceBootstrapElapsed(authReady)) return;
    const syncElapsed = () => {
      const nextElapsed = Math.max(0, Date.now() - bootStartedAt);
      setElapsedMs((prev) => (prev === nextElapsed ? prev : nextElapsed));
    };
    syncElapsed();
    const timerId = window.setInterval(syncElapsed, 1_000);
    return () => window.clearInterval(timerId);
  }, [authReady, bootStartedAt]);

  const elapsedSeconds = Math.max(0, Math.round(elapsedMs / 1_000));

  // ── 1. Booting (hold) ──
  if (shouldHoldWorkspaceBootstrap) {
    return (
      <PremiumShell label={loadingLabel}>
        <BootingCard
          label={loadingLabel}
          description={loadingDescription}
          elapsedSeconds={elapsedSeconds}
          isRoot={isWorkspaceRootPath}
          badges={[
            { label: 'Studio', value: 'Ready' },
            { label: 'Voices', value: 'Synced' },
            { label: 'History', value: 'Waiting' },
          ]}
        />
      </PremiumShell>
    );
  }

  // ── 2. Redirect to onboarding ──
  if (shouldRedirectToOnboarding) {
    return (
      <PremiumShell label="Opening Studio">
        <AuthGateCard
          eyebrow="Studio workspace"
          title="Opening Studio"
          description="New users start with a short onboarding flow so the first step stays clear."
          primaryLabel="Continue to onboarding"
          onPrimaryClick={() => router.replace(resolveAppPath(AppScreen.ONBOARDING))}
          secondaryLabel="Open secure sign-in"
          onSecondaryClick={() => setScreen(AppScreen.LOGIN)}
        />
      </PremiumShell>
    );
  }

  // ── 3. Auth gate ──
  if (shouldShowWorkspaceAuthGate) {
    return (
      <PremiumShell label={workspaceAuthGate.title}>
        <AuthGateCard
          eyebrow={workspaceAuthGate.eyebrow}
          title={workspaceAuthGate.title}
          description={workspaceAuthGate.description}
          primaryHref={workspaceLoginHref}
          primaryLabel="Open secure sign-in"
          secondaryHref={workspaceSignupHref}
          secondaryLabel="Create account"
        />
      </PremiumShell>
    );
  }

  // ── 4. Stall ──
  if (!authReady && !shouldWarmWorkspaceShell && hasBootstrapGraceElapsed) {
    return (
      <PremiumShell label="Workspace stalled">
        <StallCard
          isRoot={isWorkspaceRootPath}
          elapsedMs={elapsedMs}
          onRetry={() => router.refresh()}
          onSignIn={() => setScreen(AppScreen.LOGIN)}
          {...(isWorkspaceRootPath
            ? { onOnboarding: () => router.replace(resolveAppPath(AppScreen.ONBOARDING)) }
            : {})}
        />
      </PremiumShell>
    );
  }

  return <WorkspaceMainApp setScreen={setScreen} />;
}
