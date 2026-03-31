'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { ArrowLeft, ArrowRight, Coins, CreditCard, Sparkles, Wallet } from 'lucide-react';
import type { BillingPlanKey, BillingVcPackKey, TokenPackKey } from '../../../../services/accountService';
import { BrandLogo } from '../../../../components/BrandLogo';
import { firebaseAuth } from '../../../../services/firebaseClient';
import { useBillingActions } from '../hooks/useBillingActions';
import { BILLING_PLAN_ROWS, BILLING_TOKEN_PACK_ROWS, BILLING_VC_PACK_ROWS } from '../catalog';
import { resolveApiBaseUrl } from '../../../shared/api/config';
import { STORAGE_KEYS } from '../../../shared/storage/keys';
import { readStorageJson } from '../../../shared/storage/localStore';
import { useManagedTabs } from '../../../shared/ui/tabs';
import { LegalLinks } from '../../legal/LegalLinks';
import { resolveLoginPath, resolveSafeInternalNextPath } from '../../../app/navigation';
import {
  consumeBillingCheckoutIntent,
  writeBillingCheckoutIntent,
  type BillingCheckoutIntentDraft,
} from '../checkoutIntent';
import type { BillingSurfaceBanner, BillingSurfaceProps, BillingSurfaceTab } from './BillingSurface.types';

const formatInr = (amount: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.max(0, Number(amount || 0)));

const formatNumber = (amount: number): string =>
  new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(Math.max(0, Number(amount || 0)));

const parseBillingState = (search: string): 'success' | 'cancel' | '' => {
  const token = String(new URLSearchParams(search).get('billing') || '').trim().toLowerCase();
  if (token === 'success' || token === 'cancel') return token;
  return '';
};

const tabTokenToId = (token: string): BillingSurfaceTab => {
  const safeToken = String(token || '').trim().toLowerCase();
  if (safeToken === 'subscription' || safeToken === 'plan' || safeToken === 'plans') return 'plans';
  if (safeToken === 'token-buy' || safeToken === 'token' || safeToken === 'buy') return 'token';
  if (safeToken === 'vc-packs' || safeToken === 'vc' || safeToken === 'vc-pack') return 'vc';
  if (safeToken === 'coupon') return 'plans';
  return 'plans';
};

const parseTabFromSearch = (search: string): BillingSurfaceTab => {
  const token = String(new URLSearchParams(search).get('tab') || '').trim();
  return tabTokenToId(token);
};

const tabIdToToken = (tab: BillingSurfaceTab): string => {
  if (tab === 'plans') return 'subscription';
  if (tab === 'token') return 'token-buy';
  return 'vc-packs';
};

const resolveBackendUrl = (): string => {
  const parsed = readStorageJson<{ mediaBackendUrl?: string }>(STORAGE_KEYS.settings);
  return resolveApiBaseUrl(parsed?.mediaBackendUrl);
};

const FALLBACK_TOKEN_PACK: { key: TokenPackKey; label: string; vf: number; priceInr: number } = {
  key: 'standard',
  label: 'Standard',
  vf: 150000,
  priceInr: 1450,
};

const FALLBACK_VC_PACK: { key: BillingVcPackKey; label: string; vc: number; priceInr: number } = {
  key: 'standard',
  label: 'Standard',
  vc: 750,
  priceInr: 699,
};

const isAuthError = (error: unknown): boolean => {
  const candidate = error as { status?: unknown; cause?: { status?: unknown }; message?: unknown; detail?: unknown };
  const status = Number(candidate?.status ?? candidate?.cause?.status ?? 0);
  if (status === 401 || status === 403) return true;
  const message = String(candidate?.message || candidate?.detail || '').trim().toLowerCase();
  return message.includes('authentication required');
};

export const BillingSurface: React.FC<BillingSurfaceProps> = ({
  mode,
  returnPath,
  appBuyUrl = '/app/billing',
  homeUrl = '/',
  authMode,
  isAuthenticated,
  onBackToWorkspace,
  onRefreshEntitlements,
  walletSummary = null,
  defaultTokenPackKey = 'standard',
  defaultVcPackKey = 'standard',
}) => {
  const visibleTabs = ['plans', 'token', 'vc'] as const;
  const selectedTabItems = visibleTabs.map((id) => ({ id }));

  const billingActions = useBillingActions({ baseUrl: resolveBackendUrl(), returnPath });

  const [activeTab, setActiveTab] = useState<BillingSurfaceTab>('plans');
  const [selectedPack, setSelectedPack] = useState<TokenPackKey>(defaultTokenPackKey);
  const [selectedVcPack, setSelectedVcPack] = useState<BillingVcPackKey>(defaultVcPackKey);
  const [loadingKey, setLoadingKey] = useState('');
  const [error, setError] = useState('');
  const [banner, setBanner] = useState<BillingSurfaceBanner | null>(null);
  const [hasFirebaseSession, setHasFirebaseSession] = useState<boolean | null>(() => (firebaseAuth.currentUser ? true : null));
  const resumeAttemptedRef = useRef(false);

  const resolvedAuthMode = authMode || (mode === 'public' ? 'signup' : 'login');
  const hasActiveAuthSession = Boolean(hasFirebaseSession || isAuthenticated);

  const selectedPackSummary = useMemo(
    () => BILLING_TOKEN_PACK_ROWS.find((item) => item.key === selectedPack) || BILLING_TOKEN_PACK_ROWS[1] || BILLING_TOKEN_PACK_ROWS[0] || FALLBACK_TOKEN_PACK,
    [selectedPack]
  );

  const selectedVcPackSummary = useMemo(
    () => BILLING_VC_PACK_ROWS.find((item) => item.key === selectedVcPack) || BILLING_VC_PACK_ROWS[0] || FALLBACK_VC_PACK,
    [selectedVcPack]
  );

  const setTab = useCallback((tab: BillingSurfaceTab): void => {
    setActiveTab(tab);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tabIdToToken(tab));
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const managedTabs = useManagedTabs<BillingSurfaceTab>({
    items: selectedTabItems,
    activeId: activeTab,
    onChange: setTab,
    label: 'Billing sections',
    idBase: `billing-surface-${mode}`,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const initialTab = parseTabFromSearch(window.location.search);
    setActiveTab(initialTab);

    const state = parseBillingState(window.location.search);
    if (!state) return;

    const url = new URL(window.location.href);
    url.searchParams.delete('billing');
    if (!url.searchParams.get('tab')) {
      url.searchParams.set('tab', tabIdToToken(initialTab));
    }
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);

    if (state === 'cancel') {
      setBanner({
        tone: 'warning',
        message: 'Checkout was canceled. You can retry anytime.',
      });
      return;
    }

    let cancelled = false;
    const refreshAfterSuccess = async () => {
      let refreshed = false;
      if (onRefreshEntitlements) {
        try {
          await onRefreshEntitlements();
          refreshed = true;
        } catch {
          refreshed = false;
        }
      }
      if (cancelled) return;
      setBanner({
        tone: 'success',
        message: refreshed
          ? 'Payment completed. Account balances refreshed.'
          : 'Payment completed. Open Billing to refresh your live account summary.',
      });
    };

    void refreshAfterSuccess();
    return () => {
      cancelled = true;
    };
  }, [onRefreshEntitlements]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      setHasFirebaseSession(Boolean(user));
    });
    return () => unsubscribe();
  }, []);

  const resolveResumePath = useCallback((tab: BillingSurfaceTab): string => {
    if (typeof window === 'undefined') return `${returnPath}?resumeCheckout=1`;
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tabIdToToken(tab));
    url.searchParams.set('resumeCheckout', '1');
    url.searchParams.delete('billing');
    return `${url.pathname}${url.search}${url.hash}`;
  }, [returnPath]);

  const redirectToAuthWithIntent = useCallback((intentDraft: BillingCheckoutIntentDraft): void => {
    if (typeof window === 'undefined') return;
    const intent = writeBillingCheckoutIntent(intentDraft);
    const safeNext = resolveSafeInternalNextPath(intent?.resumePath, resolveResumePath(activeTab));
    window.location.href = resolveLoginPath(resolvedAuthMode, safeNext);
  }, [activeTab, resolveResumePath, resolvedAuthMode]);

  const runPlanCheckout = useCallback(async (planKey: BillingPlanKey): Promise<void> => {
    if (!hasActiveAuthSession) {
      redirectToAuthWithIntent({
        kind: 'subscription',
        selection: { planKey },
        authMode: resolvedAuthMode,
        resumePath: resolveResumePath('plans'),
      });
      return;
    }

    setError('');
    setBanner(null);
    setLoadingKey(`plan:${planKey}`);
    try {
      const launch = await billingActions.startPlanCheckout(planKey);
      await billingActions.launchCheckout(launch, {
        onSuccess: () => {
          window.location.href = `${returnPath}?billing=success`;
        },
        onDismiss: () => {
          setLoadingKey('');
        },
      });
    } catch (checkoutError: any) {
      if (isAuthError(checkoutError)) {
        redirectToAuthWithIntent({
          kind: 'subscription',
          selection: { planKey },
          authMode: resolvedAuthMode,
          resumePath: resolveResumePath('plans'),
        });
        return;
      }
      setError(checkoutError?.message || 'Could not start subscription checkout.');
    } finally {
      setLoadingKey('');
    }
  }, [billingActions, hasActiveAuthSession, redirectToAuthWithIntent, resolveResumePath, resolvedAuthMode, returnPath]);

  const runTokenCheckout = useCallback(async (packKey: TokenPackKey): Promise<void> => {
    if (!hasActiveAuthSession) {
      redirectToAuthWithIntent({
        kind: 'token-pack',
        selection: { packKey },
        authMode: resolvedAuthMode,
        resumePath: resolveResumePath('token'),
      });
      return;
    }

    setError('');
    setBanner(null);
    setLoadingKey(`token:${packKey}`);
    try {
      const launch = await billingActions.startTokenPackCheckout(packKey);
      await billingActions.launchCheckout(launch, {
        onSuccess: () => {
          window.location.href = `${returnPath}?billing=success`;
        },
        onDismiss: () => {
          setLoadingKey('');
        },
      });
    } catch (checkoutError: any) {
      if (isAuthError(checkoutError)) {
        redirectToAuthWithIntent({
          kind: 'token-pack',
          selection: { packKey },
          authMode: resolvedAuthMode,
          resumePath: resolveResumePath('token'),
        });
        return;
      }
      setError(checkoutError?.message || 'Could not start credit-pack checkout.');
    } finally {
      setLoadingKey('');
    }
  }, [billingActions, hasActiveAuthSession, redirectToAuthWithIntent, resolveResumePath, resolvedAuthMode, returnPath]);

  const runVcCheckout = useCallback(async (packKey: BillingVcPackKey): Promise<void> => {
    if (!hasActiveAuthSession) {
      redirectToAuthWithIntent({
        kind: 'vc-token-pack',
        selection: { vcPackKey: packKey },
        authMode: resolvedAuthMode,
        resumePath: resolveResumePath('vc'),
      });
      return;
    }

    setError('');
    setBanner(null);
    setLoadingKey(`vc:${packKey}`);
    try {
      const launch = await billingActions.startVcTokenPackCheckout(packKey);
      await billingActions.launchCheckout(launch, {
        onSuccess: () => {
          window.location.href = `${returnPath}?billing=success`;
        },
        onDismiss: () => {
          setLoadingKey('');
        },
      });
    } catch (checkoutError: any) {
      if (isAuthError(checkoutError)) {
        redirectToAuthWithIntent({
          kind: 'vc-token-pack',
          selection: { vcPackKey: packKey },
          authMode: resolvedAuthMode,
          resumePath: resolveResumePath('vc'),
        });
        return;
      }
      setError(checkoutError?.message || 'Could not start VC pack checkout.');
    } finally {
      setLoadingKey('');
    }
  }, [billingActions, hasActiveAuthSession, redirectToAuthWithIntent, resolveResumePath, resolvedAuthMode, returnPath]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('resumeCheckout') !== '1') return;
    if (!hasActiveAuthSession || resumeAttemptedRef.current) return;

    resumeAttemptedRef.current = true;
    const intent = consumeBillingCheckoutIntent();

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('resumeCheckout');
    window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);

    if (!intent) {
      setBanner({
        tone: 'info',
        message: 'Sign in completed. Select a plan or credit pack to continue checkout.',
      });
      return;
    }

    if (intent.kind === 'subscription' && 'planKey' in intent.selection) {
      setTab('plans');
      void runPlanCheckout(intent.selection.planKey);
      return;
    }

    if (intent.kind === 'token-pack' && 'packKey' in intent.selection) {
      setSelectedPack(intent.selection.packKey);
      setTab('token');
      void runTokenCheckout(intent.selection.packKey);
      return;
    }

    if (intent.kind === 'vc-token-pack' && 'vcPackKey' in intent.selection) {
      setSelectedVcPack(intent.selection.vcPackKey);
      setTab('vc');
      void runVcCheckout(intent.selection.vcPackKey);
    }
  }, [hasActiveAuthSession, runPlanCheckout, runTokenCheckout, runVcCheckout, setTab]);

  const handlePlanCheckout = async (planKey: BillingPlanKey) => {
    await runPlanCheckout(planKey);
  };

  const handleTokenCheckout = async () => {
    await runTokenCheckout(selectedPack);
  };

  const handleVcCheckout = async () => {
    await runVcCheckout(selectedVcPack);
  };

  const bannerToneClass = banner?.tone === 'success'
    ? (mode === 'app' ? 'border-emerald-300/35 bg-emerald-500/12 text-emerald-100' : 'border-emerald-300/30 bg-emerald-500/12 text-emerald-100')
      : banner?.tone === 'warning'
      ? (mode === 'app' ? 'border-amber-300/35 bg-amber-500/12 text-amber-100' : 'border-amber-300/30 bg-amber-500/12 text-amber-100')
      : (mode === 'app' ? 'border-cyan-300/35 bg-cyan-500/12 text-cyan-100' : 'border-cyan-300/30 bg-cyan-500/12 text-cyan-100');
  const authContinueLabel = resolvedAuthMode === 'signup' ? 'Sign up to continue' : 'Sign in to continue';

  return (
    <div className={`vf-billing-surface min-h-screen overflow-x-hidden ${
      mode === 'app'
        ? 'bg-[radial-gradient(82%_68%_at_12%_10%,rgba(14,165,233,0.16),transparent_62%),radial-gradient(76%_64%_at_92%_12%,rgba(6,182,212,0.12),transparent_62%),linear-gradient(160deg,#020617_0%,#0b1a3a_56%,#08142e_100%)] text-slate-100'
        : 'bg-[radial-gradient(84%_72%_at_8%_8%,rgba(34,211,238,0.18),transparent_60%),radial-gradient(74%_70%_at_92%_12%,rgba(139,92,246,0.16),transparent_62%),radial-gradient(82%_74%_at_52%_100%,rgba(16,185,129,0.10),transparent_72%),linear-gradient(165deg,#040813_0%,#081121_48%,#060b15_100%)] text-slate-100'
    }`}>
      {mode === 'public' ? (
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(78%_72%_at_6%_8%,rgba(34,211,238,0.14),transparent_62%),radial-gradient(72%_68%_at_92%_10%,rgba(139,92,246,0.12),transparent_64%),radial-gradient(80%_72%_at_50%_95%,rgba(37,99,235,0.10),transparent_72%)]" />
      ) : null}

      <div className={`relative z-10 mx-auto w-full ${mode === 'app' ? 'max-w-7xl px-4 pb-8 pt-4 sm:px-6 sm:pt-6' : 'max-w-6xl px-4 pb-8 pt-4 sm:px-6 sm:pt-7'}`}>
        <header className={`rounded-2xl border p-2.5 shadow-[0_18px_44px_rgba(2,6,23,0.45)] backdrop-blur ${
          mode === 'app'
            ? 'border-cyan-300/20 bg-slate-950/70'
            : 'border-white/10 bg-slate-950/72'
        }`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              {mode === 'app' && onBackToWorkspace ? (
                <button
                  type="button"
                  onClick={onBackToWorkspace}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/80 px-3 py-2 text-[12px] font-semibold text-slate-200 transition hover:bg-slate-800"
                >
                  <ArrowLeft size={15} />
                  Workspace
                </button>
              ) : null}
              <BrandLogo size="sm" tone="light" />
            </div>

            {mode === 'public' ? (
              <div className="flex items-center gap-2">
                <a
                  href={homeUrl}
                  className="inline-flex min-h-10 items-center rounded-full border border-white/14 bg-white/5 px-3.5 py-2 text-[12px] font-semibold text-slate-100 transition hover:bg-white/10"
                >
                  Home
                </a>
                <a
                  href={appBuyUrl}
                  className="inline-flex min-h-10 items-center rounded-full bg-gradient-to-r from-cyan-400 via-sky-500 to-indigo-500 px-4 py-2 text-[12px] font-semibold text-slate-950 shadow-[0_16px_36px_rgba(34,211,238,0.22)] transition hover:translate-y-[-1px] hover:brightness-105"
                >
                  Open Billing
                </a>
              </div>
            ) : null}
          </div>

          <div className="mt-2.5 flex flex-wrap items-end justify-between gap-2.5">
            <div>
              <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${
                mode === 'app' ? 'text-cyan-200/80' : 'text-cyan-200/80'
              }`}>Billing</p>
              <h1 className={`mt-1 text-lg font-semibold tracking-tight sm:text-xl ${
                mode === 'app' ? 'text-white' : 'text-white'
              }`}>
                {mode === 'public'
                  ? 'Billing, credits, and checkout'
                  : 'Manage billing, credits, and checkout'}
              </h1>
              <p className={`mt-1.5 text-[13px] leading-5 ${
                mode === 'app' ? 'text-slate-300' : 'text-slate-300'
              }`}>
                Choose the plan that fits your workflow, add credits when you need extra volume, and confirm pricing before checkout.
              </p>
            </div>

            {mode === 'app' && walletSummary ? (
              <div className="grid w-full grid-cols-3 gap-1.5 text-[11px]">
                <div className="rounded-xl border border-slate-700 bg-slate-900/65 px-2.5 py-1.5">
                  <div className="text-slate-400">Spendable</div>
                  <div className="mt-0.5 font-semibold text-slate-100">{formatNumber(walletSummary.spendableVf)} VF</div>
                  {walletSummary.hasUnlimitedAccess ? <div className="mt-0.5 text-[10px] text-emerald-300">Unlimited access active</div> : null}
                </div>
                <div className="rounded-xl border border-slate-700 bg-slate-900/65 px-2.5 py-1.5">
                  <div className="text-slate-400">Monthly free</div>
                  <div className="mt-0.5 font-semibold text-slate-100">{formatNumber(walletSummary.monthlyFree)} VF</div>
                </div>
                <div className="rounded-xl border border-slate-700 bg-slate-900/65 px-2.5 py-1.5">
                  <div className="text-slate-400">Paid credits</div>
                  <div className="mt-0.5 font-semibold text-slate-100">{formatNumber(walletSummary.paidBalance)} VF</div>
                </div>
              </div>
            ) : (
              <div className={`rounded-2xl border px-3.5 py-2.5 text-[11px] font-semibold ${
                mode === 'app'
                  ? 'border-cyan-300/25 bg-cyan-500/10 text-cyan-100'
                  : 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100'
              }`}>
                Billing terms, renewal details, and credit availability are confirmed before checkout is completed.
              </div>
            )}
          </div>
        </header>

        {banner ? (
          <div className={`mt-3 rounded-xl border px-3.5 py-2.5 text-[13px] ${bannerToneClass}`}>
            {banner.message}
          </div>
        ) : null}

        {error ? (
          <div className={`mt-3 rounded-xl border px-3.5 py-2.5 text-[13px] ${
            mode === 'app'
              ? 'border-rose-300/35 bg-rose-500/10 text-rose-100'
              : 'border-rose-300/35 bg-rose-500/12 text-rose-100'
          }`}>
            {error}
          </div>
        ) : null}

        <main className={`mt-3 rounded-2xl border p-2.5 shadow-[0_18px_44px_rgba(2,6,23,0.42)] backdrop-blur sm:p-3 ${
          mode === 'app'
            ? 'border-slate-700/70 bg-slate-950/70'
            : 'border-white/10 bg-slate-950/68'
        }`}>
          <div className={`grid w-full grid-cols-3 gap-1.5 rounded-xl border p-1.5 ${
            mode === 'app'
              ? 'border-slate-700 bg-slate-900/60'
              : 'border-white/10 bg-white/[0.04]'
          }`} {...managedTabs.listProps}>
            {visibleTabs.map((tab) => {
              const Icon = tab === 'plans' ? CreditCard : tab === 'token' ? Coins : Sparkles;
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  {...managedTabs.getTabProps(tab)}
                  className={`inline-flex min-h-10 items-center justify-center rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition sm:text-xs ${
                    isActive
                      ? (mode === 'app' ? 'bg-cyan-500/18 text-cyan-100' : 'bg-white/10 text-white shadow-[0_10px_24px_rgba(2,6,23,0.28)]')
                      : (mode === 'app' ? 'bg-slate-900/70 text-slate-200 hover:bg-slate-800' : 'text-slate-300 hover:bg-white/5 hover:text-white')
                  }`}
                >
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    <Icon size={13} />
                    {tab === 'plans' ? 'Plans' : tab === 'token' ? 'Credit Packs' : 'VC Packs'}
                  </span>
                </button>
              );
            })}
          </div>

          {activeTab === 'plans' ? (
            <section className="mt-3">
              <div className={`mb-2.5 flex items-center gap-2 text-[13px] font-semibold ${
                mode === 'app' ? 'text-slate-100' : 'text-white'
              }`}>
                <CreditCard size={14} />
                Plans
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:gap-2 lg:grid-cols-5">
                {BILLING_PLAN_ROWS.map((plan) => {
                  const effectiveRate = Math.round((plan.priceInr / Math.max(1, plan.vfCredits)) * 10000);
                  return (
                    <article key={plan.key} className={`rounded-xl border p-2.5 ${
                      mode === 'app'
                        ? 'border-slate-700 bg-slate-900/60'
                        : 'border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.66),rgba(7,12,24,0.92))]'
                    }`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className={`text-[13px] font-semibold ${mode === 'app' ? 'text-slate-100' : 'text-white'}`}>{plan.name}</div>
                          <div className={`mt-0.5 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            mode === 'app'
                              ? 'border-cyan-400/35 bg-cyan-500/12 text-cyan-100'
                              : 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100'
                          }`}>
                            {formatNumber(plan.vfCredits)} VF
                          </div>
                        </div>
                        <div className={`text-[13px] font-bold ${mode === 'app' ? 'text-white' : 'text-white'}`}>
                          {formatInr(plan.priceInr)}
                        </div>
                      </div>

                      <div className={`mt-1.5 text-[10px] ${mode === 'app' ? 'text-slate-400' : 'text-slate-400'}`}>
                        Effective: {formatInr(effectiveRate)} / 10k VF
                      </div>

                      <button
                        type="button"
                        onClick={() => void handlePlanCheckout(plan.key)}
                        disabled={Boolean(loadingKey)}
                        className={`mt-2.5 inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          mode === 'app'
                            ? 'border border-cyan-400/35 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25'
                            : 'border border-cyan-400/30 bg-cyan-500/12 text-cyan-50 hover:bg-cyan-500/22'
                        }`}
                      >
                        {loadingKey === `plan:${plan.key}` ? 'Starting...' : hasActiveAuthSession ? 'Checkout' : authContinueLabel}
                        <ArrowRight size={13} />
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {activeTab === 'token' ? (
            <section className={`mt-3 rounded-xl border p-2.5 ${
              mode === 'app'
                ? 'border-slate-700/60 bg-transparent'
                : 'border-white/10 bg-white/[0.04]'
            }`}>
              <div className={`flex items-center gap-2 text-[13px] font-semibold ${
                mode === 'app' ? 'text-slate-100' : 'text-white'
              }`}>
                <Wallet size={14} />
                Credit Packs
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:gap-2 lg:grid-cols-5">
                {BILLING_TOKEN_PACK_ROWS.map((pack) => {
                  const isSelected = selectedPack === pack.key;
                  const effectiveRate = Math.round((pack.priceInr / Math.max(1, pack.vf)) * 10000);
                  return (
                    <button
                      key={pack.key}
                      type="button"
                      onClick={() => setSelectedPack(pack.key)}
                      className={`min-h-10 rounded-xl border px-3.5 py-2.5 text-left transition ${
                        isSelected
                          ? (mode === 'app'
                              ? 'border-cyan-300/65 bg-cyan-500/18 shadow-[0_8px_18px_rgba(6,182,212,0.16)]'
                              : 'border-cyan-300/55 bg-cyan-500/14 shadow-[0_10px_24px_rgba(34,211,238,0.16)]')
                          : (mode === 'app'
                              ? 'border-slate-700 bg-slate-950/70 hover:border-cyan-400/35 hover:bg-cyan-500/10'
                              : 'border-white/10 bg-black/20 hover:border-cyan-300/35 hover:bg-cyan-500/10')
                      }`}
                      aria-pressed={isSelected}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className={`text-[13px] font-semibold ${mode === 'app' ? 'text-slate-100' : 'text-white'}`}>{pack.label}</div>
                          <div className={`text-[11px] ${mode === 'app' ? 'text-slate-400' : 'text-slate-400'}`}>{formatNumber(pack.vf)} VF</div>
                        </div>
                        <div className={`text-[13px] font-bold ${mode === 'app' ? 'text-white' : 'text-white'}`}>{formatInr(pack.priceInr)}</div>
                      </div>
                      <div className={`mt-1.5 text-[10px] ${mode === 'app' ? 'text-slate-400' : 'text-slate-400'}`}>
                        Effective: {formatInr(effectiveRate)} / 10k VF
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <p className={`text-[11px] ${mode === 'app' ? 'text-slate-300' : 'text-slate-300'}`}>
                  Selected: <span className={`font-semibold ${mode === 'app' ? 'text-slate-100' : 'text-white'}`}>{selectedPackSummary.label}</span> - {formatNumber(selectedPackSummary.vf)} VF for {formatInr(selectedPackSummary.priceInr)}.
                </p>
                <button
                  type="button"
                  onClick={() => void handleTokenCheckout()}
                  disabled={Boolean(loadingKey)}
                  className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 py-2 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    mode === 'app'
                      ? 'border border-cyan-400/35 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25'
                      : 'border border-cyan-400/30 bg-cyan-500/12 text-cyan-50 hover:bg-cyan-500/22'
                  }`}
                >
                  {loadingKey === `token:${selectedPack}`
                    ? 'Starting checkout...'
                    : hasActiveAuthSession
                      ? `Checkout ${selectedPackSummary.label} credit pack`
                      : authContinueLabel}
                  <ArrowRight size={14} />
                </button>
              </div>
              <div className={`mt-3 rounded-xl border px-3.5 py-2.5 text-[11px] ${
                mode === 'app'
                  ? 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100'
                  : 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100'
              }`}>
                Credit pack pricing, validity, and renewal terms are confirmed before checkout is completed.
              </div>
            </section>
          ) : null}

          {activeTab === 'vc' ? (
            <section className={`mt-3 rounded-xl border p-2.5 ${
              mode === 'app'
                ? 'border-slate-700/60 bg-transparent'
                : 'border-white/10 bg-white/[0.04]'
            }`}>
              <div className={`flex items-center gap-2 text-[13px] font-semibold ${
                mode === 'app' ? 'text-slate-100' : 'text-white'
              }`}>
                <Sparkles size={14} />
                VC Packs
              </div>
              <div className="mt-2.5 grid gap-1.5">
                {BILLING_VC_PACK_ROWS.map((pack) => {
                  const isSelected = selectedVcPack === pack.key;
                  const effectiveRate = Math.round((pack.priceInr / Math.max(1, pack.vc)) * 10000);
                  return (
                    <button
                      key={pack.key}
                      type="button"
                      onClick={() => setSelectedVcPack(pack.key)}
                      className={`min-h-10 rounded-xl border px-3.5 py-2.5 text-left transition ${
                        isSelected
                          ? (mode === 'app'
                              ? 'border-cyan-300/65 bg-cyan-500/18 shadow-[0_8px_18px_rgba(6,182,212,0.16)]'
                              : 'border-cyan-300/55 bg-cyan-500/14 shadow-[0_10px_24px_rgba(34,211,238,0.16)]')
                          : (mode === 'app'
                              ? 'border-slate-700 bg-slate-950/70 hover:border-cyan-400/35 hover:bg-cyan-500/10'
                              : 'border-white/10 bg-black/20 hover:border-cyan-300/35 hover:bg-cyan-500/10')
                      }`}
                      aria-pressed={isSelected}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className={`text-[13px] font-semibold ${mode === 'app' ? 'text-slate-100' : 'text-white'}`}>{pack.label}</div>
                          <div className={`text-[11px] ${mode === 'app' ? 'text-slate-400' : 'text-slate-400'}`}>{formatNumber(pack.vc)} VC</div>
                        </div>
                        <div className={`text-[13px] font-bold ${mode === 'app' ? 'text-white' : 'text-white'}`}>{formatInr(pack.priceInr)}</div>
                      </div>
                      <div className={`mt-1.5 text-[10px] ${mode === 'app' ? 'text-slate-400' : 'text-slate-400'}`}>
                        Effective: {formatInr(effectiveRate)} / 10k VC
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <p className={`text-[11px] ${mode === 'app' ? 'text-slate-300' : 'text-slate-300'}`}>
                  Selected: <span className={`font-semibold ${mode === 'app' ? 'text-slate-100' : 'text-white'}`}>{selectedVcPackSummary.label}</span> - {formatNumber(selectedVcPackSummary.vc)} VC for {formatInr(selectedVcPackSummary.priceInr)}.
                </p>
                <button
                  type="button"
                  onClick={() => void handleVcCheckout()}
                  disabled={Boolean(loadingKey)}
                  className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 py-2 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    mode === 'app'
                      ? 'border border-cyan-400/35 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25'
                      : 'border border-cyan-400/30 bg-cyan-500/12 text-cyan-50 hover:bg-cyan-500/22'
                  }`}
                >
                  {loadingKey === `vc:${selectedVcPack}`
                    ? 'Starting checkout...'
                    : hasActiveAuthSession
                      ? `Checkout ${selectedVcPackSummary.label} VC pack`
                      : authContinueLabel}
                  <ArrowRight size={14} />
                </button>
              </div>
              <div className={`mt-3 rounded-xl border px-3.5 py-2.5 text-[11px] ${
                mode === 'app'
                  ? 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100'
                  : 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100'
              }`}>
                VC pack pricing, validity, and renewal terms are confirmed before checkout is completed.
              </div>
            </section>
          ) : null}
        </main>
      </div>

      {mode === 'public' ? (
        <footer className="relative z-10 border-t border-white/10 bg-slate-950/78">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 sm:px-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-400">Copyright {new Date().getFullYear()} V FLOW AI Billing.</p>
            <LegalLinks linkClassName="vf-billing-legal-link" />
          </div>
        </footer>
      ) : null}
    </div>
  );
};
