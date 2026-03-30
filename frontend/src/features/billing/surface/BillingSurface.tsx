'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { ArrowLeft, ArrowRight, Coins, CreditCard, Sparkles, Ticket, Wallet } from 'lucide-react';
import type { BillingPlanKey, TokenPackKey } from '../../../../services/accountService';
import { BrandLogo } from '../../../../components/BrandLogo';
import { firebaseAuth } from '../../../../services/firebaseClient';
import { useBillingActions } from '../hooks/useBillingActions';
import { BILLING_PLAN_ROWS, BILLING_TOKEN_PACK_ROWS } from '../catalog';
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

const tabTokenToId = (token: string, couponEnabled: boolean): BillingSurfaceTab => {
  const safeToken = String(token || '').trim().toLowerCase();
  if (safeToken === 'subscription' || safeToken === 'plan' || safeToken === 'plans') return 'plans';
  if (safeToken === 'token-buy' || safeToken === 'token' || safeToken === 'buy') return 'token';
  if (couponEnabled && safeToken === 'coupon') return 'coupon';
  return 'plans';
};

const parseTabFromSearch = (search: string, couponEnabled: boolean): BillingSurfaceTab => {
  const token = String(new URLSearchParams(search).get('tab') || '').trim();
  return tabTokenToId(token, couponEnabled);
};

const tabIdToToken = (tab: BillingSurfaceTab): string => {
  if (tab === 'plans') return 'subscription';
  if (tab === 'token') return 'token-buy';
  return 'coupon';
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
  appBuyUrl = '/app/buy',
  homeUrl = '/',
  authMode,
  isAuthenticated,
  onBackToWorkspace,
  onRefreshEntitlements,
  walletSummary = null,
  defaultTokenPackKey = 'standard',
}) => {
  const couponEnabled = true;
  const visibleTabs = ['plans', 'token', 'coupon'] as const;
  const selectedTabItems = visibleTabs.map((id) => ({ id }));

  const billingActions = useBillingActions({ baseUrl: resolveBackendUrl(), returnPath });

  const [activeTab, setActiveTab] = useState<BillingSurfaceTab>('plans');
  const [couponCode, setCouponCode] = useState('');
  const [selectedPack, setSelectedPack] = useState<TokenPackKey>(defaultTokenPackKey);
  const [loadingKey, setLoadingKey] = useState('');
  const [error, setError] = useState('');
  const [banner, setBanner] = useState<BillingSurfaceBanner | null>(null);
  const [hasFirebaseSession, setHasFirebaseSession] = useState<boolean | null>(() => (firebaseAuth.currentUser ? true : null));
  const resumeAttemptedRef = useRef(false);

  const resolvedAuthMode = authMode || (mode === 'public' ? 'signup' : 'login');
  const hasActiveAuthSession = Boolean(hasFirebaseSession || isAuthenticated);
  const publicSignInUrl = resolveLoginPath('login', resolveSafeInternalNextPath(appBuyUrl, appBuyUrl));

  const selectedPackSummary = useMemo(
    () => BILLING_TOKEN_PACK_ROWS.find((item) => item.key === selectedPack) || BILLING_TOKEN_PACK_ROWS[1] || BILLING_TOKEN_PACK_ROWS[0] || FALLBACK_TOKEN_PACK,
    [selectedPack]
  );

  const setTab = useCallback((tab: BillingSurfaceTab): void => {
    if (!couponEnabled && tab === 'coupon') return;
    setActiveTab(tab);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tabIdToToken(tab));
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, [couponEnabled]);

  const managedTabs = useManagedTabs<BillingSurfaceTab>({
    items: selectedTabItems,
    activeId: activeTab,
    onChange: setTab,
    label: 'Billing sections',
    idBase: `billing-surface-${mode}`,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const initialTab = parseTabFromSearch(window.location.search, couponEnabled);
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
          : 'Payment completed. Open Plans & Billing to refresh your live account summary.',
      });
    };

    void refreshAfterSuccess();
    return () => {
      cancelled = true;
    };
  }, [couponEnabled, onRefreshEntitlements]);

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

  const redirectToAuthTab = useCallback((tab: BillingSurfaceTab, authTarget: 'login' | 'signup' = resolvedAuthMode): void => {
    if (typeof window === 'undefined') return;
    const resumePath = resolveResumePath(tab);
    const safeNext = resolveSafeInternalNextPath(resumePath, resumePath);
    window.location.href = resolveLoginPath(authTarget, safeNext);
  }, [resolveResumePath, resolvedAuthMode]);

  const runPlanCheckout = useCallback(async (planKey: BillingPlanKey, rawCouponCode?: string): Promise<void> => {
    const couponCodeTrimmed = String(rawCouponCode || '').trim();
    if (!hasActiveAuthSession) {
      redirectToAuthWithIntent({
        kind: 'subscription',
        selection: couponCodeTrimmed ? { planKey, couponCode: couponCodeTrimmed } : { planKey },
        authMode: resolvedAuthMode,
        resumePath: resolveResumePath('plans'),
      });
      return;
    }

    setError('');
    setBanner(null);
    setLoadingKey(`plan:${planKey}`);
    try {
      const launch = await billingActions.startPlanCheckout(planKey, couponCodeTrimmed || undefined);
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
          selection: couponCodeTrimmed ? { planKey, couponCode: couponCodeTrimmed } : { planKey },
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
      const couponCodeToken = 'couponCode' in intent.selection ? String(intent.selection.couponCode || '') : '';
      setCouponCode(couponCodeToken);
      setTab('plans');
      void runPlanCheckout(intent.selection.planKey, couponCodeToken);
      return;
    }

    if (intent.kind === 'token-pack' && 'packKey' in intent.selection) {
      setSelectedPack(intent.selection.packKey);
      setTab('token');
      void runTokenCheckout(intent.selection.packKey);
    }
  }, [hasActiveAuthSession, runPlanCheckout, runTokenCheckout, setTab]);

  const handlePlanCheckout = async (planKey: BillingPlanKey) => {
    await runPlanCheckout(planKey, couponCode);
  };

  const handleTokenCheckout = async () => {
    await runTokenCheckout(selectedPack);
  };

  const handleRedeemCoupon = async () => {
    if (!hasActiveAuthSession) {
      redirectToAuthTab('coupon');
      return;
    }
    const code = couponCode.trim().toUpperCase();
    if (!code) {
      setError('Enter coupon code first.');
      return;
    }
    setError('');
    setBanner(null);
    setLoadingKey('coupon');
    try {
      const result = await billingActions.redeemWalletCoupon(code);
      setCouponCode('');
      setBanner({
        tone: 'success',
        message: `Coupon applied: +${formatNumber(result.creditedVf)} VF`,
      });
      if (onRefreshEntitlements) {
        await onRefreshEntitlements();
      }
    } catch (couponError: any) {
      setError(couponError?.message || 'Coupon redeem failed.');
    } finally {
      setLoadingKey('');
    }
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

      <div className={`relative z-10 mx-auto w-full ${mode === 'app' ? 'max-w-7xl px-4 pb-10 pt-5 sm:px-6 sm:pt-7' : 'max-w-6xl px-4 pb-10 pt-5 sm:px-6 sm:pt-8'}`}>
        <header className={`rounded-2xl border p-3 shadow-[0_18px_44px_rgba(2,6,23,0.45)] backdrop-blur ${
          mode === 'app'
            ? 'border-cyan-300/20 bg-slate-950/70'
            : 'border-white/10 bg-slate-950/72'
        }`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {mode === 'app' && onBackToWorkspace ? (
                <button
                  type="button"
                  onClick={onBackToWorkspace}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/80 px-3.5 py-2.5 text-[13px] font-semibold text-slate-200 transition hover:bg-slate-800"
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
                  className="inline-flex min-h-11 items-center rounded-full border border-white/14 bg-white/5 px-4 py-2.5 text-[13px] font-semibold text-slate-100 transition hover:bg-white/10"
                >
                  Home
                </a>
                <a
                  href={appBuyUrl}
                  className="inline-flex min-h-11 items-center rounded-full bg-gradient-to-r from-cyan-400 via-sky-500 to-indigo-500 px-5 py-2.5 text-[13px] font-semibold text-slate-950 shadow-[0_16px_36px_rgba(34,211,238,0.22)] transition hover:translate-y-[-1px] hover:brightness-105"
                >
                  Open Plans & Billing
                </a>
              </div>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className={`text-[11px] font-black uppercase tracking-[0.18em] ${
                mode === 'app' ? 'text-cyan-200/80' : 'text-cyan-200/80'
              }`}>Plans & Billing</p>
              <h1 className={`mt-1 text-xl font-semibold tracking-tight sm:text-2xl ${
                mode === 'app' ? 'text-white' : 'text-white'
              }`}>
                {mode === 'public'
                  ? 'Plans, credits, and billing'
                  : 'Manage plans, credits, and billing'}
              </h1>
              <p className={`mt-2 text-sm ${
                mode === 'app' ? 'text-slate-300' : 'text-slate-300'
              }`}>
                Choose the plan that fits your workflow, add credits when you need extra volume, and confirm pricing before checkout.
              </p>
            </div>

            {mode === 'app' && walletSummary ? (
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                <div className="rounded-xl border border-slate-700 bg-slate-900/65 px-3 py-2">
                  <div className="text-slate-400">Spendable</div>
                  <div className="mt-1 font-semibold text-slate-100">{formatNumber(walletSummary.spendableVf)} VF</div>
                  {walletSummary.hasUnlimitedAccess ? <div className="mt-1 text-[10px] text-emerald-300">Unlimited access active</div> : null}
                </div>
                <div className="rounded-xl border border-slate-700 bg-slate-900/65 px-3 py-2">
                  <div className="text-slate-400">Monthly free</div>
                  <div className="mt-1 font-semibold text-slate-100">{formatNumber(walletSummary.monthlyFree)} VF</div>
                </div>
                <div className="rounded-xl border border-slate-700 bg-slate-900/65 px-3 py-2">
                  <div className="text-slate-400">Paid credits</div>
                  <div className="mt-1 font-semibold text-slate-100">{formatNumber(walletSummary.paidBalance)} VF</div>
                </div>
              </div>
            ) : (
              <div className={`rounded-2xl border px-4 py-3 text-xs font-semibold ${
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
          <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${bannerToneClass}`}>
            {banner.message}
          </div>
        ) : null}

        {error ? (
          <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
            mode === 'app'
              ? 'border-rose-300/35 bg-rose-500/10 text-rose-100'
              : 'border-rose-300/35 bg-rose-500/12 text-rose-100'
          }`}>
            {error}
          </div>
        ) : null}

        <main className={`mt-4 rounded-2xl border p-3 shadow-[0_18px_44px_rgba(2,6,23,0.42)] backdrop-blur sm:p-4 ${
          mode === 'app'
            ? 'border-slate-700/70 bg-slate-950/70'
            : 'border-white/10 bg-slate-950/68'
        }`}>
          <div className={`grid grid-cols-1 gap-2 rounded-xl border p-2 sm:inline-grid ${
            couponEnabled ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
          } ${
            mode === 'app'
              ? 'border-slate-700 bg-slate-900/60'
              : 'border-white/10 bg-white/[0.04]'
          }`} {...managedTabs.listProps}>
            {visibleTabs.map((tab) => {
              const Icon = tab === 'plans' ? CreditCard : tab === 'token' ? Coins : Ticket;
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  {...managedTabs.getTabProps(tab)}
                    className={`inline-flex min-h-11 items-center justify-center rounded-lg px-3 py-2 text-[13px] font-semibold transition sm:text-xs ${
                      isActive
                        ? (mode === 'app' ? 'bg-cyan-500/18 text-cyan-100' : 'bg-white/10 text-white shadow-[0_10px_24px_rgba(2,6,23,0.28)]')
                        : (mode === 'app' ? 'bg-slate-900/70 text-slate-200 hover:bg-slate-800' : 'text-slate-300 hover:bg-white/5 hover:text-white')
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    <Icon size={13} />
                    {tab === 'plans' ? 'Plans' : tab === 'token' ? 'Credit Packs' : 'Promo Code'}
                  </span>
                </button>
              );
            })}
          </div>

          {activeTab === 'plans' ? (
            <section className="mt-4">
              <div className={`mb-3 flex items-center gap-2 text-sm font-semibold ${
                mode === 'app' ? 'text-slate-100' : 'text-white'
              }`}>
                <CreditCard size={15} />
                Plans
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {BILLING_PLAN_ROWS.map((plan) => {
                  const effectiveRate = Math.round((plan.priceInr / Math.max(1, plan.vfCredits)) * 10000);
                  return (
                    <article key={plan.key} className={`rounded-xl border p-3 ${
                      mode === 'app'
                        ? 'border-slate-700 bg-slate-900/60'
                        : 'border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.66),rgba(7,12,24,0.92))]'
                    }`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className={`text-sm font-semibold ${mode === 'app' ? 'text-slate-100' : 'text-white'}`}>{plan.name}</div>
                          <div className={`mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                            mode === 'app'
                              ? 'border-cyan-400/35 bg-cyan-500/12 text-cyan-100'
                              : 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100'
                          }`}>
                            {formatNumber(plan.vfCredits)} VF
                          </div>
                        </div>
                        <div className={`text-sm font-bold ${mode === 'app' ? 'text-white' : 'text-white'}`}>
                          {formatInr(plan.priceInr)}
                        </div>
                      </div>

                      <div className={`mt-2 text-[11px] ${mode === 'app' ? 'text-slate-400' : 'text-slate-400'}`}>
                        Effective: {formatInr(effectiveRate)} / 10k VF
                      </div>

                      <button
                        type="button"
                        onClick={() => void handlePlanCheckout(plan.key)}
                        disabled={Boolean(loadingKey)}
                        className={`mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
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
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={couponCode}
                  onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                  placeholder="Optional promo code"
                  className={`min-h-11 w-full rounded-lg border px-4 text-[13px] sm:w-72 ${
                    mode === 'app'
                      ? 'border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500'
                      : 'border-white/10 bg-black/20 text-slate-100 placeholder:text-slate-500'
                  }`}
                />
                {mode === 'public' ? (
                  <a href={publicSignInUrl} className="inline-flex min-h-11 items-center text-[13px] font-semibold text-cyan-200 transition hover:text-white">
                    Already have an account? Sign in
                  </a>
                ) : null}
              </div>
            </section>
          ) : null}

          {activeTab === 'token' ? (
            <section className={`mt-4 rounded-xl border p-3 ${
              mode === 'app'
                ? 'border-slate-700/60 bg-transparent'
                : 'border-white/10 bg-white/[0.04]'
            }`}>
              <div className={`flex items-center gap-2 text-sm font-semibold ${
                mode === 'app' ? 'text-slate-100' : 'text-white'
              }`}>
                <Wallet size={15} />
                Credit Packs
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {BILLING_TOKEN_PACK_ROWS.map((pack) => {
                  const isSelected = selectedPack === pack.key;
                  const effectiveRate = Math.round((pack.priceInr / Math.max(1, pack.vf)) * 10000);
                  return (
                    <button
                      key={pack.key}
                      type="button"
                      onClick={() => setSelectedPack(pack.key)}
                      className={`min-h-11 rounded-xl border px-4 py-3 text-left transition ${
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
                          <div className={`text-sm font-semibold ${mode === 'app' ? 'text-slate-100' : 'text-white'}`}>{pack.label}</div>
                          <div className={`text-xs ${mode === 'app' ? 'text-slate-400' : 'text-slate-400'}`}>{formatNumber(pack.vf)} VF</div>
                        </div>
                        <div className={`text-sm font-bold ${mode === 'app' ? 'text-white' : 'text-white'}`}>{formatInr(pack.priceInr)}</div>
                      </div>
                      <div className={`mt-2 text-[11px] ${mode === 'app' ? 'text-slate-400' : 'text-slate-400'}`}>
                        Effective: {formatInr(effectiveRate)} / 10k VF
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <p className={`text-xs ${mode === 'app' ? 'text-slate-300' : 'text-slate-300'}`}>
                  Selected: <span className={`font-semibold ${mode === 'app' ? 'text-slate-100' : 'text-white'}`}>{selectedPackSummary.label}</span> - {formatNumber(selectedPackSummary.vf)} VF for {formatInr(selectedPackSummary.priceInr)}.
                </p>
                <button
                  type="button"
                  onClick={() => void handleTokenCheckout()}
                  disabled={Boolean(loadingKey)}
                  className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
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
              <div className={`mt-4 rounded-xl border px-4 py-3 text-xs ${
                mode === 'app'
                  ? 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100'
                  : 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100'
              }`}>
                Credit pack pricing, validity, and renewal terms are confirmed before checkout is completed.
              </div>
            </section>
          ) : null}

          {couponEnabled && activeTab === 'coupon' ? (
            <section className="mt-4 rounded-xl border border-slate-700 bg-slate-900/60 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <Sparkles size={15} />
                Promo Code
              </div>
              <p className="mt-2 text-xs text-slate-400">Redeem a promo code to add credits directly to your account.</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  value={couponCode}
                  onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                  placeholder="Enter promo code"
                  className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-4 text-[13px] text-slate-100 placeholder:text-slate-500"
                />
                <button
                  type="button"
                  onClick={() => void handleRedeemCoupon()}
                  disabled={loadingKey === 'coupon'}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-cyan-400/35 bg-cyan-500/15 px-4 py-2.5 text-[13px] font-semibold text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingKey === 'coupon' ? 'Redeeming...' : hasActiveAuthSession ? 'Redeem' : authContinueLabel}
                </button>
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
