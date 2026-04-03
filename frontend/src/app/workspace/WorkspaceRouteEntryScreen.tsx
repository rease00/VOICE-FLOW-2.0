'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
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

const hasHealthyWorkspaceStylesheets = (): boolean => {
  if (typeof document === 'undefined') return true;
  const nextStyleSheets = Array.from(document.styleSheets).filter((sheet) => (
    String((sheet as CSSStyleSheet | null)?.href || '').includes('/_next/static/css/')
  ));
  if (nextStyleSheets.length === 0) return false;
  return nextStyleSheets.some((sheet) => {
    const candidate = sheet as CSSStyleSheet;
    try {
      return candidate.cssRules.length > 0;
    } catch {
      return false;
    }
  });
};

function WorkspaceRouteShell(props: {
  eyebrow: string;
  title: string;
  description: string;
  loading?: boolean;
  badges?: WorkspaceRouteBadge[];
  loginHref?: string;
  signupHref?: string;
}) {
  const {
    eyebrow,
    title,
    description,
    loading = false,
    badges = DEFAULT_LOADING_BADGES,
    loginHref = '',
    signupHref = '',
  } = props;

  return (
    <div
      className="min-h-[100dvh] overflow-hidden bg-[radial-gradient(82%_72%_at_12%_10%,rgba(34,211,238,0.16),transparent_58%),radial-gradient(74%_66%_at_88%_14%,rgba(99,102,241,0.18),transparent_60%),linear-gradient(165deg,#020617_0%,#081226_52%,#050913_100%)] px-4 py-6 text-slate-100"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-5xl items-center justify-center">
        <div className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-slate-950/68 p-6 shadow-[0_28px_70px_rgba(2,6,23,0.58)] backdrop-blur-xl sm:p-7">
          <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
            {eyebrow}
          </div>
          <div className="mt-5 flex items-start justify-between gap-4">
            <div>
              <BrandLogo size="lg" tone="light" />
              <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                {title}
              </h1>
              <p className="mt-3 max-w-lg text-sm leading-7 text-slate-300 sm:text-base">
                {description}
              </p>
            </div>
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/25 bg-cyan-500/12 text-cyan-100">
              {loading ? <RefreshCw size={18} className="animate-spin" /> : <ArrowRight size={18} />}
            </span>
          </div>

          <div className="mt-6 min-h-[11rem]">
            {loading ? (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  {badges.map((item) => (
                    <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                        {item.label}
                      </div>
                      <div className="mt-2 text-sm font-semibold text-white">{item.value}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-slate-300">
                  <span>Waiting for secure workspace access.</span>
                  <span className="inline-flex items-center gap-1 text-cyan-100">
                    Keep this tab open <ArrowRight size={13} />
                  </span>
                </div>
              </>
            ) : (
              <div className="flex min-h-[11rem] flex-wrap items-end gap-2">
                <a
                  href={loginHref}
                  className="rounded-full bg-gradient-to-r from-cyan-400 via-sky-500 to-indigo-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-[0_16px_36px_rgba(34,211,238,0.22)] transition hover:translate-y-[-1px] hover:brightness-105"
                >
                  Open secure sign-in
                </a>
                <a
                  href={signupHref}
                  className="rounded-full border border-white/12 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.08]"
                >
                  Create account
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const hasImmediateFirebaseSession = Boolean(firebaseAuth.currentUser);
  const [authGateFallbackElapsed, setAuthGateFallbackElapsed] = useState(false);
  const shouldWarmWorkspaceShell = authReady ? isAuthenticated : hasImmediateFirebaseSession;
  const shouldShowOptimisticSignInGate = !authReady && !hasImmediateFirebaseSession && authGateFallbackElapsed;
  const loginHref = useMemo(() => resolveLoginPath('login', pathname), [pathname]);
  const signupHref = useMemo(() => resolveLoginPath('signup', pathname), [pathname]);

  const setScreen = useCallback((screen: AppScreen) => {
    router.replace(resolveAppPath(screen));
  }, [router]);

  useEffect(() => {
    if (!shouldWarmWorkspaceShell) return;
    if (typeof window === 'undefined') return;

    const recoveryTimer = window.setTimeout(() => {
      if (hasHealthyWorkspaceStylesheets()) {
        document.documentElement.removeAttribute('data-vf-workspace-style-fallback');
        return;
      }
      // Do not hard-reload the page; emit a soft recovery signal only.
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
    const timeoutId = window.setTimeout(() => {
      setAuthGateFallbackElapsed(true);
    }, AUTH_GATE_FALLBACK_MS);
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
