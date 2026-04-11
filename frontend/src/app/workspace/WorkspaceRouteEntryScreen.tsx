'use client';

import React, { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';

import { ArrowRight } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { BrandLogo } from '../../../components/BrandLogo';
import { firebaseAuth } from '../../../services/firebaseClient';
import { AppScreen } from '../../../types';
import { useUser } from '../../features/auth/context/UserContext';
import { resolveAppPath, resolveLoginPath } from '../navigation';
import { WorkspaceMainApp } from './WorkspaceMainApp';

interface WorkspaceRouteBadge {
  label: string;
  value: string;
}

interface WorkspaceRouteEntryScreenProps {
  eyebrow: string;
  loadingLabel: string;
  loadingDescription: string;
  signInTitle: string;
  signInDescription: string;
  loadingBadges?: WorkspaceRouteBadge[];
}

const DEFAULT_LOADING_BADGES: WorkspaceRouteBadge[] = [
  { label: 'Session', value: 'Checking' },
  { label: 'Workspace', value: 'Preparing' },
  { label: 'Access', value: 'Waiting' },
];

const AUTH_GATE_FALLBACK_MS = 350;
const WORKSPACE_STYLESHEET_CHECK_DELAY_MS = 1_000;
const WORKSPACE_STYLESHEET_RECOVERY_EVENT = 'vf:workspace-stylesheet-healthcheck-failed';

const WAVE_HEIGHTS = [0.55, 0.82, 0.48, 0.9, 0.65, 0.78, 0.52, 0.88] as const;

const hasHealthyWorkspaceStylesheets = (): boolean => {
  if (typeof document === 'undefined') return true;
  const nextStyleSheets = Array.from(document.styleSheets).filter((sheet) => (
    String((sheet as CSSStyleSheet | null)?.href || '').includes('/_next/static/css/')
  ));
  if (nextStyleSheets.length === 0) return false;
  return nextStyleSheets.some((sheet) => {
    const candidate = sheet as CSSStyleSheet;
    try { return candidate.cssRules.length > 0; } catch { return false; }
  });
};

// ── Shared shell ─────────────────────────────────────────────────────────────

function PremiumShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="ap-shell" role="status" aria-live="polite">
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

// ── WorkspaceRouteShell ───────────────────────────────────────────────────────

function WorkspaceRouteShell({
  eyebrow,
  title,
  description,
  loading = false,
  badges = DEFAULT_LOADING_BADGES,
  loginHref = '',
  signupHref = '',
}: {
  eyebrow: string;
  title: string;
  description: string;
  loading?: boolean;
  badges?: WorkspaceRouteBadge[];
  loginHref?: string;
  signupHref?: string;
}) {
  return (
    <PremiumShell>
      <div className="ap-card w-full max-w-lg p-6 sm:p-8">

        {/* Eyebrow */}
        <span className="ap-eyebrow">
          {loading && <span className="ap-live-dot" style={{ height: '6px', width: '6px' }} />}
          {eyebrow}
        </span>

        {/* Brand + heading */}
        <div className="mt-6 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <BrandLogo size="md" tone="light" />
            <h1 className="mt-4 text-2xl font-black tracking-tight text-white sm:text-3xl">{title}</h1>
            <p className="mt-2 text-sm leading-7 text-slate-400">{description}</p>
          </div>

          {/* Waveform if loading */}
          {loading && (
            <div className="ap-wave-loader shrink-0 pt-1" aria-hidden="true">
              {WAVE_HEIGHTS.map((h, i) => (
                <span
                  key={`rwave-${i}`}
                  className="ap-wave-bar"
                  style={{ height: `${h * 100}%`, animationDelay: `${i * 120}ms` } as CSSProperties}
                />
              ))}
            </div>
          )}
        </div>

        {/* Loading state */}
        {loading ? (
          <div className="mt-6 space-y-4">
            {/* Progress bar */}
            <div className="ap-progress-track">
              <div className="ap-progress-bar" />
            </div>

            {/* Status grid */}
            <div className="ap-status-grid">
              {badges.map((item) => (
                <div key={item.label} className="ap-status-item">
                  <p className="ap-status-item__label">{item.label}</p>
                  <p className="ap-status-item__value">{item.value}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-2.5 text-xs text-slate-400">
              <span>Waiting for secure workspace access.</span>
              <span className="flex items-center gap-1 text-cyan-300">Keep this tab open <ArrowRight size={12} /></span>
            </div>
          </div>
        ) : (
          /* Auth gate buttons */
          <div className="mt-6 flex flex-wrap gap-3">
            <a href={loginHref} className="ap-btn-primary flex-1 sm:flex-none" style={{ width: 'auto' }}>
              Open secure sign-in <ArrowRight size={15} />
            </a>
            <a href={signupHref} className="ap-btn-secondary flex-1 sm:flex-none" style={{ width: 'auto' }}>
              Create account
            </a>
          </div>
        )}
      </div>
    </PremiumShell>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function WorkspaceRouteEntryScreen({
  eyebrow,
  loadingLabel,
  loadingDescription,
  signInTitle,
  signInDescription,
  loadingBadges = DEFAULT_LOADING_BADGES,
}: WorkspaceRouteEntryScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { authReady, isAuthenticated } = useUser();
  const [hasImmediateFirebaseSession, setHasImmediateFirebaseSession] = useState(() => Boolean(firebaseAuth.currentUser));
  const [authGateFallbackElapsed, setAuthGateFallbackElapsed] = useState(false);
  const shouldWarmWorkspaceShell = authReady ? isAuthenticated : hasImmediateFirebaseSession;
  const shouldShowOptimisticSignInGate = !authReady && !hasImmediateFirebaseSession && authGateFallbackElapsed;
  const loginHref = useMemo(() => resolveLoginPath('login', pathname), [pathname]);
  const signupHref = useMemo(() => resolveLoginPath('signup', pathname), [pathname]);

  const setScreen = useCallback((screen: AppScreen) => {
    router.replace(resolveAppPath(screen));
  }, [router]);

  useEffect(() => {
    setHasImmediateFirebaseSession(Boolean(firebaseAuth.currentUser));
  }, []);

  useEffect(() => {
    if (!shouldWarmWorkspaceShell) return;
    if (typeof window === 'undefined') return;
    const recoveryTimer = window.setTimeout(() => {
      if (hasHealthyWorkspaceStylesheets()) {
        document.documentElement.removeAttribute('data-vf-workspace-style-fallback');
        return;
      }
      document.documentElement.setAttribute('data-vf-workspace-style-fallback', '1');
      window.dispatchEvent(new CustomEvent(WORKSPACE_STYLESHEET_RECOVERY_EVENT));
    }, WORKSPACE_STYLESHEET_CHECK_DELAY_MS);
    return () => window.clearTimeout(recoveryTimer);
  }, [shouldWarmWorkspaceShell]);

  useEffect(() => {
    if (authReady || hasImmediateFirebaseSession) {
      setAuthGateFallbackElapsed(false);
      return undefined;
    }
    const timeoutId = window.setTimeout(() => { setAuthGateFallbackElapsed(true); }, AUTH_GATE_FALLBACK_MS);
    return () => window.clearTimeout(timeoutId);
  }, [authReady, hasImmediateFirebaseSession]);

  if ((authReady && !isAuthenticated) || shouldShowOptimisticSignInGate) {
    return (
      <WorkspaceRouteShell
        eyebrow={eyebrow}
        title={signInTitle}
        description={signInDescription}
        loginHref={loginHref}
        signupHref={signupHref}
      />
    );
  }

  if (!shouldWarmWorkspaceShell) {
    return (
      <WorkspaceRouteShell
        eyebrow={eyebrow}
        title={loadingLabel}
        description={loadingDescription}
        loading
        badges={loadingBadges}
      />
    );
  }

  return <WorkspaceMainApp setScreen={setScreen} />;
}
