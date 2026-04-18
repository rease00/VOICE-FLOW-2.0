'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  ArrowRight,
  BookOpen,
  Check,
  Coins,
  CreditCard,
  Crown,
  Globe,
  HelpCircle,
  Mic2,
  Shield,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { BrandLogo } from '../../../components/BrandLogo';
import { firebaseAuth } from '../../../services/firebaseClient';
import { useBillingActions } from './hooks/useBillingActions';
import {
  BILLING_PLAN_ROWS,
  BILLING_TOKEN_PACK_ROWS,
  BILLING_VC_PACK_ROWS,
  BILLING_VN_PACK_ROWS,
  type BillingVcPackCatalogKey,
} from './catalog';
import { LegalLinks } from '../legal/LegalLinks';
import { resolveLoginPath } from '../../app/navigation';
import type { BillingPlanKey, TokenPackKey, VnTokenPackKey } from '../../../services/accountService';
import {
  consumeBillingCheckoutIntent,
  writeBillingCheckoutIntent,
  type BillingCheckoutIntentDraft,
} from './checkoutIntent';

const ACCOUNT_BILLING_API_BASE = '/api/v1';
const BILLING_PATH = '/billing';
const FEATURED_PLAN_KEY: BillingPlanKey = 'creator';

type TabId = 'plans' | 'credits' | 'voice-clone' | 'novel';

const formatInr = (amount: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.max(0, Number(amount || 0)));

const formatNumber = (amount: number): string =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(
    Math.max(0, Number(amount || 0)),
  );

const TAB_CONFIG: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'plans', label: 'Plans', icon: CreditCard },
  { id: 'credits', label: 'Credits', icon: Coins },
  { id: 'voice-clone', label: 'Voice Clone', icon: Mic2 },
  { id: 'novel', label: 'Novel', icon: BookOpen },
];

const PLAN_ICONS: Record<BillingPlanKey, React.ElementType> = {
  launcher: Zap,
  starter: Globe,
  creator: Crown,
  pro: TrendingUp,
  scale: Shield,
};

const PLAN_FEATURES: Record<BillingPlanKey, string[]> = {
  launcher: [
    '30,000 VF credits included',
    'Basic voice synthesis',
    'Standard export quality',
    'Community support',
    'Perfect for first experiments',
  ],
  starter: [
    '65,000 VF credits included',
    'All voice styles access',
    'HD export quality',
    'Email support',
    'Great for solo publishing',
  ],
  creator: [
    '225,000 VF credits included',
    'Priority voice processing',
    '4K export quality',
    'Priority support queue',
    'Advanced tone controls',
    'Batch processing',
  ],
  pro: [
    '500,000 VF credits included',
    'Ultra-fast processing',
    'Lossless export quality',
    'Dedicated support',
    'Team collaboration',
    'API access',
  ],
  scale: [
    '850,000 VF credits included',
    'Maximum throughput',
    'All formats supported',
    'SLA guarantee',
    'Custom voice training',
    'Enterprise integrations',
  ],
};

const FAQ_ITEMS = [
  {
    q: 'How do VF credits work?',
    a: 'VF credits are consumed each time you generate or export voice content. Each plan includes a monthly allocation, and unused credits roll over for the duration of your billing cycle.',
  },
  {
    q: 'Can I switch plans anytime?',
    a: 'Yes. You can upgrade or downgrade your plan at any time. Changes take effect at the start of your next billing cycle, and any unused credits are preserved.',
  },
  {
    q: 'What happens if I run out of credits?',
    a: 'You can purchase one-off credit packs at any time without changing your plan. Credit packs are permanent and do not expire.',
  },
  {
    q: 'Is there a free trial?',
    a: 'New accounts receive a limited trial allocation so you can explore the platform before committing to a paid plan.',
  },
  {
    q: 'What payment methods are accepted?',
    a: 'We support all major credit and debit cards, UPI, net banking, and popular wallets through our secure Razorpay checkout.',
  },
  {
    q: 'Can I cancel my subscription?',
    a: 'Absolutely. You can cancel anytime from your billing dashboard. Your access and remaining credits continue until the end of your current billing period.',
  },
];

const isAuthError = (error: unknown): boolean => {
  const candidate = error as {
    status?: unknown;
    cause?: { status?: unknown };
    message?: unknown;
  };
  const status = Number(candidate?.status ?? candidate?.cause?.status ?? 0);
  if (status === 401 || status === 403) return true;
  const message = String(candidate?.message || '')
    .trim()
    .toLowerCase();
  return message.includes('authentication required');
};

export function PremiumBillingPage() {
  const billingActions = useBillingActions({
    baseUrl: ACCOUNT_BILLING_API_BASE,
    returnPath: BILLING_PATH,
  });

  const [activeTab, setActiveTab] = useState<TabId>('plans');
  const [loadingKey, setLoadingKey] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [hasFirebaseSession, setHasFirebaseSession] = useState<boolean | null>(() =>
    typeof window !== 'undefined' && firebaseAuth.currentUser ? true : null,
  );
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const resumeAttemptedRef = useRef(false);

  const hasActiveAuthSession = Boolean(hasFirebaseSession);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      setHasFirebaseSession(Boolean(user));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('billing') === 'success') {
      setSuccessMessage('Payment completed successfully. Your account has been updated.');
      const url = new URL(window.location.href);
      url.searchParams.delete('billing');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
    if (params.get('billing') === 'cancel') {
      setError('Checkout was canceled. You can retry anytime.');
      const url = new URL(window.location.href);
      url.searchParams.delete('billing');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  const resolveResumePath = useCallback((tab: TabId): string => {
    if (typeof window === 'undefined') return `${BILLING_PATH}?resumeCheckout=1`;
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    url.searchParams.set('resumeCheckout', '1');
    url.searchParams.delete('billing');
    return `${url.pathname}${url.search}${url.hash}`;
  }, []);

  const redirectToAuth = useCallback(
    (intentDraft: Omit<BillingCheckoutIntentDraft, 'authMode'>) => {
      if (typeof window === 'undefined') return;
      writeBillingCheckoutIntent({ ...intentDraft, authMode: 'login' });
      const resumePath =
        intentDraft.resumePath || resolveResumePath(activeTab);
      window.location.href = resolveLoginPath('login', resumePath);
    },
    [activeTab, resolveResumePath],
  );

  const runPlanCheckout = useCallback(
    async (planKey: BillingPlanKey): Promise<void> => {
      if (!hasActiveAuthSession) {
        redirectToAuth({
          kind: 'subscription',
          selection: { planKey },
          resumePath: resolveResumePath('plans'),
        });
        return;
      }
      setError('');
      setSuccessMessage('');
      setLoadingKey(`plan:${planKey}`);
      try {
        const launch = await billingActions.startPlanCheckout(planKey);
        await billingActions.launchCheckout(launch, {
          onSuccess: () => {
            window.location.href = `${BILLING_PATH}?billing=success`;
          },
          onDismiss: () => setLoadingKey(''),
        });
      } catch (checkoutError: any) {
        if (isAuthError(checkoutError)) {
          redirectToAuth({
            kind: 'subscription',
            selection: { planKey },
            resumePath: resolveResumePath('plans'),
          });
          return;
        }
        setError(checkoutError?.message || 'Could not start subscription checkout.');
      } finally {
        setLoadingKey('');
      }
    },
    [billingActions, hasActiveAuthSession, redirectToAuth, resolveResumePath],
  );

  const runTokenCheckout = useCallback(
    async (packKey: TokenPackKey): Promise<void> => {
      if (!hasActiveAuthSession) {
        redirectToAuth({
          kind: 'token-pack',
          selection: { packKey },
          resumePath: resolveResumePath('credits'),
        });
        return;
      }
      setError('');
      setSuccessMessage('');
      setLoadingKey(`token:${packKey}`);
      try {
        const launch = await billingActions.startTokenPackCheckout(packKey);
        await billingActions.launchCheckout(launch, {
          onSuccess: () => {
            window.location.href = `${BILLING_PATH}?billing=success`;
          },
          onDismiss: () => setLoadingKey(''),
        });
      } catch (checkoutError: any) {
        if (isAuthError(checkoutError)) {
          redirectToAuth({
            kind: 'token-pack',
            selection: { packKey },
            resumePath: resolveResumePath('credits'),
          });
          return;
        }
        setError(checkoutError?.message || 'Could not start credit-pack checkout.');
      } finally {
        setLoadingKey('');
      }
    },
    [billingActions, hasActiveAuthSession, redirectToAuth, resolveResumePath],
  );

  const runVcCheckout = useCallback(
    async (packKey: BillingVcPackCatalogKey): Promise<void> => {
      if (!hasActiveAuthSession) {
        redirectToAuth({
          kind: 'vc-token-pack',
          selection: { vcPackKey: packKey },
          resumePath: resolveResumePath('voice-clone'),
        });
        return;
      }
      setError('');
      setSuccessMessage('');
      setLoadingKey(`vc:${packKey}`);
      try {
        const launch = await billingActions.startVcTokenPackCheckout(packKey);
        await billingActions.launchCheckout(launch, {
          onSuccess: () => {
            window.location.href = `${BILLING_PATH}?billing=success`;
          },
          onDismiss: () => setLoadingKey(''),
        });
      } catch (checkoutError: any) {
        if (isAuthError(checkoutError)) {
          redirectToAuth({
            kind: 'vc-token-pack',
            selection: { vcPackKey: packKey },
            resumePath: resolveResumePath('voice-clone'),
          });
          return;
        }
        setError(checkoutError?.message || 'Could not start voice-clone pack checkout.');
      } finally {
        setLoadingKey('');
      }
    },
    [billingActions, hasActiveAuthSession, redirectToAuth, resolveResumePath],
  );

  const runVnCheckout = useCallback(
    async (packKey: VnTokenPackKey): Promise<void> => {
      if (!hasActiveAuthSession) {
        redirectToAuth({
          kind: 'vn-token-pack',
          selection: { vnPackKey: packKey },
          resumePath: resolveResumePath('novel'),
        });
        return;
      }
      setError('');
      setSuccessMessage('');
      setLoadingKey(`vn:${packKey}`);
      try {
        const launch = await billingActions.startVnTokenPackCheckout(packKey);
        await billingActions.launchCheckout(launch, {
          onSuccess: () => {
            window.location.href = `${BILLING_PATH}?billing=success`;
          },
          onDismiss: () => setLoadingKey(''),
        });
      } catch (checkoutError: any) {
        if (isAuthError(checkoutError)) {
          redirectToAuth({
            kind: 'vn-token-pack',
            selection: { vnPackKey: packKey },
            resumePath: resolveResumePath('novel'),
          });
          return;
        }
        setError(checkoutError?.message || 'Could not start novel token pack checkout.');
      } finally {
        setLoadingKey('');
      }
    },
    [billingActions, hasActiveAuthSession, redirectToAuth, resolveResumePath],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('resumeCheckout') !== '1') return;
    if (!hasActiveAuthSession || resumeAttemptedRef.current) return;

    resumeAttemptedRef.current = true;
    const intent = consumeBillingCheckoutIntent();

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('resumeCheckout');
    window.history.replaceState(
      {},
      '',
      `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`,
    );

    if (!intent) {
      setSuccessMessage('Sign in completed. Select a plan or pack to continue checkout.');
      return;
    }

    if (intent.kind === 'subscription' && 'planKey' in intent.selection) {
      setActiveTab('plans');
      void runPlanCheckout(intent.selection.planKey);
      return;
    }
    if (intent.kind === 'token-pack' && 'packKey' in intent.selection) {
      setActiveTab('credits');
      void runTokenCheckout(intent.selection.packKey);
      return;
    }
    if (intent.kind === 'vc-token-pack' && 'vcPackKey' in intent.selection) {
      setActiveTab('voice-clone');
      void runVcCheckout(intent.selection.vcPackKey);
      return;
    }
    if (intent.kind === 'vn-token-pack' && 'vnPackKey' in intent.selection) {
      setActiveTab('novel');
      void runVnCheckout(intent.selection.vnPackKey);
    }
  }, [hasActiveAuthSession, runPlanCheckout, runTokenCheckout, runVcCheckout, runVnCheckout]);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[radial-gradient(86%_72%_at_8%_8%,rgba(71,214,202,0.2),transparent_60%),radial-gradient(74%_70%_at_92%_12%,rgba(243,184,107,0.16),transparent_62%),radial-gradient(82%_74%_at_52%_100%,rgba(47,128,237,0.12),transparent_72%),linear-gradient(165deg,#041321_0%,#071f39_48%,#0b1730_74%,#17161f_100%)] text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(78%_72%_at_6%_8%,rgba(71,214,202,0.16),transparent_62%),radial-gradient(72%_68%_at_92%_10%,rgba(243,184,107,0.12),transparent_64%),radial-gradient(80%_72%_at_50%_95%,rgba(47,128,237,0.12),transparent_72%)]" />

      <div className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
        {/* Hero Section */}
        <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(145deg,rgba(6,12,26,0.92),rgba(8,18,34,0.94)_52%,rgba(8,16,33,0.98))] px-6 py-12 shadow-[0_28px_90px_rgba(2,6,23,0.52)] sm:px-10 sm:py-16 lg:px-16 lg:py-20">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-16 top-6 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(71,214,202,0.28)_0%,rgba(71,214,202,0)_72%)] blur-2xl" />
            <div className="absolute right-[-2rem] top-12 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(47,128,237,0.24)_0%,rgba(47,128,237,0)_70%)] blur-3xl" />
            <div className="absolute bottom-[-3rem] left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(243,184,107,0.16)_0%,rgba(243,184,107,0)_72%)] blur-3xl" />
          </div>

          <div className="relative text-center">
            <div className="mb-6 flex justify-center">
              <BrandLogo size="lg" tone="light" />
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200/80">
              Pricing
            </p>
            <h1 className="mt-4 bg-gradient-to-r from-[#47d6ca] via-[#2f80ed] to-[#f3b86b] bg-clip-text text-4xl font-extrabold tracking-tight text-transparent sm:text-5xl lg:text-6xl">
              Build voices. Ship faster.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
              Choose the plan that fits your workflow. Transparent pricing with renewal
              rates shown upfront. No hidden fees, cancel anytime.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <div className="rounded-full border border-white/12 bg-white/[0.05] px-4 py-2 text-[12px] font-semibold text-slate-100">
                {BILLING_PLAN_ROWS.length} plans from {formatInr(Math.min(...BILLING_PLAN_ROWS.map((p) => p.firstCycleInr)))}
              </div>
              <div className="rounded-full border border-white/12 bg-white/[0.05] px-4 py-2 text-[12px] font-semibold text-slate-100">
                Up to {formatNumber(Math.max(...BILLING_PLAN_ROWS.map((p) => p.vfCredits)))} VF included
              </div>
              <div className="rounded-full border border-emerald-300/20 bg-emerald-500/10 px-4 py-2 text-[12px] font-semibold text-emerald-100">
                Save up to 15% on renewal
              </div>
            </div>
          </div>
        </section>

        {/* Messages */}
        {successMessage ? (
          <div className="mt-4 rounded-xl border border-emerald-300/30 bg-emerald-500/12 px-4 py-3 text-[13px] text-emerald-100">
            {successMessage}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-rose-300/35 bg-rose-500/12 px-4 py-3 text-[13px] text-rose-100">
            {error}
          </div>
        ) : null}

        {/* Tab Navigation */}
        <div className="mt-8">
          <div className="grid w-full grid-cols-4 gap-1 rounded-[1rem] border border-white/10 bg-white/[0.04] p-1">
            {TAB_CONFIG.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex min-h-11 items-center justify-center rounded-[1rem] px-2.5 py-2 text-[12px] font-semibold transition sm:text-xs ${
                    isActive
                      ? 'bg-white/10 text-white shadow-[0_10px_24px_rgba(2,6,23,0.28)]'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Icon size={14} />
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Plans Tab */}
        {activeTab === 'plans' ? (
          <section className="mt-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {BILLING_PLAN_ROWS.map((plan) => {
                const Icon = PLAN_ICONS[plan.key];
                const isFeatured = plan.key === FEATURED_PLAN_KEY;
                const recurringDiscount = Math.max(
                  0,
                  Math.round(
                    ((plan.firstCycleInr - plan.recurringInr) /
                      Math.max(plan.firstCycleInr, 1)) *
                      100,
                  ),
                );
                const features = PLAN_FEATURES[plan.key] || [];

                return (
                  <article
                    key={plan.key}
                    className={`relative flex h-full flex-col overflow-hidden rounded-[1.25rem] border p-4 transition-all duration-300 ${
                      isFeatured
                        ? 'border-[#47d6ca]/40 bg-[linear-gradient(180deg,rgba(12,30,53,0.92),rgba(7,12,24,0.98))] shadow-[0_0_40px_rgba(71,214,202,0.15),0_18px_42px_rgba(8,47,73,0.22)] ring-1 ring-[#47d6ca]/20'
                        : 'border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.66),rgba(7,12,24,0.92))] hover:border-white/20 hover:shadow-[0_12px_32px_rgba(2,6,23,0.3)]'
                    }`}
                  >
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_48%)] opacity-80" />

                    <div className="relative">
                      {isFeatured ? (
                        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[#47d6ca]/30 bg-[#47d6ca]/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#47d6ca]">
                          <Sparkles size={11} />
                          Most Popular
                        </div>
                      ) : null}

                      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06]">
                        <Icon size={20} className="text-[#47d6ca]" />
                      </div>

                      <h3 className="text-lg font-bold text-white">{plan.name}</h3>

                      <div className="mt-2 inline-flex items-center rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-100">
                        {formatNumber(plan.vfCredits)} VF credits
                      </div>

                      <div className="mt-4">
                        {plan.key === 'launcher' ? (
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-400">
                            One-Time Offer
                          </div>
                        ) : (
                          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            First month
                          </div>
                        )}
                        <div className="mt-1 text-2xl font-extrabold text-white">
                          {formatInr(plan.firstCycleInr)}
                        </div>
                        {plan.key !== 'launcher' ? (
                          <div className="mt-1 text-[11px] font-semibold text-cyan-200">
                            {formatInr(plan.recurringInr)}/mo renewal
                          </div>
                        ) : null}
                      </div>

                      {recurringDiscount > 0 && plan.key !== 'launcher' ? (
                        <div className="mt-2 inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-100">
                          <TrendingUp size={10} className="mr-1" />
                          Save {recurringDiscount}% on renewal
                        </div>
                      ) : null}

                      <ul className="mt-4 space-y-2">
                        {features.map((feature, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 text-[12px] leading-5 text-slate-300"
                          >
                            <Check
                              size={14}
                              className="mt-0.5 shrink-0 text-[#47d6ca]"
                            />
                            {feature}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <button
                      type="button"
                      onClick={() => void runPlanCheckout(plan.key)}
                      disabled={Boolean(loadingKey)}
                      className={`relative mt-auto w-full rounded-full px-4 py-3 text-[13px] font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${
                        isFeatured
                          ? 'bg-gradient-to-r from-[#47d6ca] via-[#2f80ed] to-[#f3b86b] text-slate-950 shadow-[0_18px_40px_rgba(71,214,202,0.24)] hover:brightness-110'
                          : 'border border-cyan-400/30 bg-cyan-500/12 text-cyan-50 hover:bg-cyan-500/22'
                      }`}
                    >
                      <span className="inline-flex items-center justify-center gap-1.5">
                        {loadingKey === `plan:${plan.key}`
                          ? 'Starting...'
                          : 'Get Started'}
                        <ArrowRight size={14} />
                      </span>
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* Credits Tab */}
        {activeTab === 'credits' ? (
          <section className="mt-6">
            <div className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-white">
              <Coins size={14} />
              VF Credit Packs
            </div>
            <p className="mb-5 text-sm leading-6 text-slate-300">
              Buy one-off credits when you need extra production headroom. Top up
              without changing your plan.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {BILLING_TOKEN_PACK_ROWS.map((pack) => {
                const effectiveRate = Math.round(
                  (pack.priceInr / Math.max(1, pack.vf)) * 10000,
                );
                const benefit = Math.max(0, Number(pack.benefitPercent || 0));

                return (
                  <article
                    key={pack.key}
                    className="relative flex h-full flex-col overflow-hidden rounded-[1.25rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.66),rgba(7,12,24,0.92))] p-5 transition-all duration-300 hover:border-white/20 hover:shadow-[0_12px_32px_rgba(2,6,23,0.3)]"
                  >
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_48%)]" />

                    <div className="relative">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-bold text-white">
                          {pack.label}
                        </h3>
                        {benefit > 0 ? (
                          <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
                            +{benefit}% value
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-2 text-3xl font-extrabold text-white">
                        {formatNumber(pack.vf)}
                        <span className="ml-1 text-sm font-semibold text-slate-400">VF</span>
                      </div>

                      <div className="mt-3 text-[11px] text-slate-400">
                        Effective rate: {formatInr(effectiveRate)} / 10k VF
                      </div>

                      <div className="mt-4 border-t border-white/10 pt-4">
                        <div className="text-2xl font-bold text-white">
                          {formatInr(pack.priceInr)}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          One-time purchase
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void runTokenCheckout(pack.key)}
                      disabled={Boolean(loadingKey)}
                      className="relative mt-auto w-full rounded-full border border-cyan-400/30 bg-cyan-500/12 px-4 py-3 text-[13px] font-semibold text-cyan-50 transition-all duration-200 hover:bg-cyan-500/22 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="inline-flex items-center justify-center gap-1.5">
                        {loadingKey === `token:${pack.key}`
                          ? 'Starting...'
                          : 'Buy Credits'}
                        <ArrowRight size={14} />
                      </span>
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* Voice Clone Tab */}
        {activeTab === 'voice-clone' ? (
          <section className="mt-6">
            <div className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-white">
              <Mic2 size={14} />
              Voice Clone Packs
            </div>
            <p className="mb-5 text-sm leading-6 text-slate-300">
              Unlock voice-clone capacity for your projects. Each pack gives you
              dedicated voice processing minutes.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {BILLING_VC_PACK_ROWS.map((pack) => (
                <article
                  key={pack.key}
                  className="relative flex h-full flex-col overflow-hidden rounded-[1.25rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.66),rgba(7,12,24,0.92))] p-5 transition-all duration-300 hover:border-white/20 hover:shadow-[0_12px_32px_rgba(2,6,23,0.3)]"
                >
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_48%)]" />

                  <div className="relative">
                    <h3 className="text-lg font-bold text-white">{pack.label}</h3>

                    <div className="mt-2 text-3xl font-extrabold text-white">
                      {formatNumber(pack.vc)}
                      <span className="ml-1 text-sm font-semibold text-slate-400">min</span>
                    </div>

                    <div className="mt-4 border-t border-white/10 pt-4">
                      <div className="text-2xl font-bold text-white">
                        {formatInr(pack.priceInr)}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        One-time purchase
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void runVcCheckout(pack.key)}
                    disabled={Boolean(loadingKey)}
                    className="relative mt-auto w-full rounded-full border border-[#f3b86b]/30 bg-[#f3b86b]/10 px-4 py-3 text-[13px] font-semibold text-[#f3b86b] transition-all duration-200 hover:bg-[#f3b86b]/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="inline-flex items-center justify-center gap-1.5">
                      {loadingKey === `vc:${pack.key}`
                        ? 'Starting...'
                        : 'Buy Minutes'}
                      <ArrowRight size={14} />
                    </span>
                  </button>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {/* Novel Tab */}
        {activeTab === 'novel' ? (
          <section className="mt-6">
            <div className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-white">
              <BookOpen size={14} />
              Novel Token Packs
            </div>
            <p className="mb-5 text-sm leading-6 text-slate-300">
              Buy VN tokens to unlock chapters from published novels. Each token
              unlocks one chapter.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {BILLING_VN_PACK_ROWS.map((pack) => {
                const benefit = Math.max(0, Number(pack.benefitPercent || 0));
                return (
                  <article
                    key={pack.key}
                    className="relative flex h-full flex-col overflow-hidden rounded-[1.25rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.66),rgba(7,12,24,0.92))] p-5 transition-all duration-300 hover:border-white/20 hover:shadow-[0_12px_32px_rgba(2,6,23,0.3)]"
                  >
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_48%)]" />

                    <div className="relative">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-bold text-white">
                          {pack.label}
                        </h3>
                        {benefit > 0 ? (
                          <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
                            +{benefit}% value
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-2 text-3xl font-extrabold text-white">
                        {formatNumber(pack.vn)}
                        <span className="ml-1 text-sm font-semibold text-slate-400">VN</span>
                      </div>

                      <div className="mt-4 border-t border-white/10 pt-4">
                        <div className="text-2xl font-bold text-white">
                          {formatInr(pack.priceInr)}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          One-time purchase
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void runVnCheckout(pack.key)}
                      disabled={Boolean(loadingKey)}
                      className="relative mt-auto w-full rounded-full border border-[#2f80ed]/30 bg-[#2f80ed]/10 px-4 py-3 text-[13px] font-semibold text-[#2f80ed] transition-all duration-200 hover:bg-[#2f80ed]/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="inline-flex items-center justify-center gap-1.5">
                        {loadingKey === `vn:${pack.key}`
                          ? 'Starting...'
                          : 'Buy Tokens'}
                        <ArrowRight size={14} />
                      </span>
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* FAQ Section */}
        <section className="mt-16">
          <div className="text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200/80">
              FAQ
            </p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Common questions
            </h2>
          </div>

          <div className="mx-auto mt-8 max-w-3xl space-y-3">
            {FAQ_ITEMS.map((item, index) => {
              const isOpen = openFaqIndex === index;
              return (
                <div
                  key={index}
                  className="overflow-hidden rounded-[1rem] border border-white/10 bg-white/[0.03] transition-all duration-200"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setOpenFaqIndex(isOpen ? null : index)
                    }
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-[14px] font-semibold text-white transition hover:bg-white/[0.03]"
                  >
                    <span className="flex items-center gap-2.5">
                      <HelpCircle
                        size={16}
                        className="shrink-0 text-[#47d6ca]"
                      />
                      {item.q}
                    </span>
                    <span
                      className={`shrink-0 text-slate-400 transition-transform duration-200 ${
                        isOpen ? 'rotate-45' : ''
                      }`}
                    >
                      +
                    </span>
                  </button>
                  {isOpen ? (
                    <div className="px-5 pb-4 pl-10 text-[13px] leading-6 text-slate-300">
                      {item.a}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        {/* Final CTA */}
        <section className="mt-16 overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(145deg,rgba(6,12,26,0.92),rgba(8,18,34,0.94)_52%,rgba(8,16,33,0.98))] px-6 py-12 text-center shadow-[0_28px_90px_rgba(2,6,23,0.52)] sm:px-10 sm:py-16">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/4 top-0 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(71,214,202,0.2)_0%,transparent_72%)] blur-2xl" />
            <div className="absolute right-1/4 bottom-0 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(243,184,107,0.16)_0%,transparent_72%)] blur-2xl" />
          </div>

          <div className="relative">
            <Sparkles size={28} className="mx-auto text-[#47d6ca]" />
            <h2 className="mt-4 bg-gradient-to-r from-[#47d6ca] via-[#2f80ed] to-[#f3b86b] bg-clip-text text-3xl font-extrabold tracking-tight text-transparent sm:text-4xl">
              Ready to start creating?
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-base leading-7 text-slate-300">
              Join thousands of creators shipping production-quality voice content
              with V Flow AI. Start with a plan that fits your needs.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('plans');
                  if (typeof window !== 'undefined') {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }}
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#47d6ca] via-[#2f80ed] to-[#f3b86b] px-8 py-3.5 text-[14px] font-semibold text-slate-950 shadow-[0_18px_40px_rgba(71,214,202,0.24)] transition hover:brightness-110"
              >
                View Plans
                <ArrowRight size={16} />
              </button>
              {!hasActiveAuthSession ? (
                <a
                  href={resolveLoginPath('login', BILLING_PATH)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/14 bg-white/5 px-8 py-3.5 text-[14px] font-semibold text-slate-100 transition hover:bg-white/10"
                >
                  Sign In
                </a>
              ) : null}
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-16 border-t border-white/10 pt-8">
          <div className="flex flex-col items-center gap-6">
            <BrandLogo size="sm" tone="light" />
            <LegalLinks
              className="justify-center"
              linkClassName="text-slate-400 hover:text-slate-200"
            />
            <p className="text-center text-[11px] text-slate-500">
              &copy; {new Date().getFullYear()} V Flow AI. All rights reserved.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
