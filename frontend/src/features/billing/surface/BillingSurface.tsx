'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { ArrowLeft, ArrowLeftRight, ArrowRight, BookOpen, Coins, CreditCard, Sparkles, Wallet } from 'lucide-react';
import type { BillingPlanKey, TokenPackKey, VnTokenPackKey } from '../../../../services/accountService';
import { BrandLogo } from '../../../../components/BrandLogo';
import { firebaseAuth } from '../../../../services/firebaseClient';
import { useBillingActions } from '../hooks/useBillingActions';
import { BILLING_PLAN_ROWS, BILLING_TOKEN_PACK_ROWS, BILLING_VC_PACK_ROWS, BILLING_VN_PACK_ROWS, type BillingVcPackCatalogKey } from '../catalog';
import { useManagedTabs } from '../../../shared/ui/tabs';
import { LegalLinks } from '../../legal/LegalLinks';
import { resolveLoginPath, resolveSafeInternalNextPath, type AuthRouteMode } from '../../../app/navigation';
import {
  SIGNUP_DISABLED_MARKETING_DETAIL,
  SIGNUP_DISABLED_TITLE,
} from '../../../shared/auth/signupLock';
import {
  BILLING_CHECKOUT_LOCK_MESSAGE,
  BILLING_CHECKOUT_LOCK_TITLE,
  isBillingCheckoutLocked,
} from '../../../shared/billing/checkoutLock';
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

const formatUsd = (amount: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.max(0, Number(amount || 0)));

const formatNumber = (amount: number): string =>
  new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(Math.max(0, Number(amount || 0)));

type SupportedBillingDisplayCurrency = 'INR' | 'USD' | 'EUR' | 'GBP';
type VcDisplayCurrency = 'usd' | 'native';
const VC_DISPLAY_INR_FX_RATES: Record<SupportedBillingDisplayCurrency, number> = {
  INR: 1,
  USD: 83,
  EUR: 90,
  GBP: 105,
};
const EUR_COUNTRY_CODES = new Set([
  'AD', 'AT', 'AX', 'BE', 'BL', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GF', 'GP', 'GR', 'HR', 'IE',
  'IT', 'LT', 'LU', 'LV', 'MC', 'ME', 'MF', 'MQ', 'MT', 'NL', 'PM', 'PT', 'RE', 'SI', 'SK', 'SM',
  'VA', 'XK',
]);
const COUNTRY_TO_NATIVE_CURRENCY: Partial<Record<string, SupportedBillingDisplayCurrency>> = {
  GB: 'GBP',
  IN: 'INR',
  IE: 'EUR',
  US: 'USD',
};

const resolveNativeCurrencyCode = (billingCountry?: string | null): SupportedBillingDisplayCurrency => {
  const normalizedBillingCountry = String(billingCountry || '').trim().toUpperCase();
  if (normalizedBillingCountry) {
    if (EUR_COUNTRY_CODES.has(normalizedBillingCountry)) return 'EUR';
    const mapped = COUNTRY_TO_NATIVE_CURRENCY[normalizedBillingCountry];
    if (mapped) return mapped;
  }

  if (typeof navigator !== 'undefined') {
    const localeCandidates = Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];
    for (const locale of localeCandidates) {
      const regionMatch = String(locale || '').trim().match(/-([A-Za-z]{2}|\d{3})$/);
      const regionCode = String(regionMatch?.[1] || '').trim().toUpperCase();
      if (!regionCode) continue;
      if (EUR_COUNTRY_CODES.has(regionCode)) return 'EUR';
      const mapped = COUNTRY_TO_NATIVE_CURRENCY[regionCode];
      if (mapped) return mapped;
    }
  }

  return 'USD';
};

const formatNativeCurrency = (amountInr: number, currencyCode: SupportedBillingDisplayCurrency): string => {
  const safeAmountInr = Math.max(0, Number(amountInr || 0));
  if (currencyCode === 'INR') return formatInr(safeAmountInr);
  const fxRate = Math.max(0.0001, Number(VC_DISPLAY_INR_FX_RATES[currencyCode] || VC_DISPLAY_INR_FX_RATES.USD));
  const convertedAmount = safeAmountInr / fxRate;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: currencyCode === 'USD' ? 2 : 0,
    maximumFractionDigits: currencyCode === 'USD' ? 2 : 0,
  }).format(convertedAmount);
};

const formatVcPrice = (
  amountInr: number,
  displayCurrency: VcDisplayCurrency,
  nativeCurrencyCode: SupportedBillingDisplayCurrency
): string => {
  if (displayCurrency === 'native') {
    return formatNativeCurrency(amountInr, nativeCurrencyCode);
  }
  return `~${formatUsd(amountInr / VC_DISPLAY_INR_FX_RATES.USD)}`;
};

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
  if (safeToken === 'vn-packs' || safeToken === 'vn' || safeToken === 'vn-pack') return 'vn';
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
  if (tab === 'vn') return 'vn-packs';
  return 'vc-packs';
};

const ACCOUNT_BILLING_API_BASE = '/api/v1';

const FALLBACK_TOKEN_PACK: { key: TokenPackKey; label: string; vf: number; priceInr: number; benefitPercent?: number } = {
  key: 'standard',
  label: 'Standard',
  vf: 150000,
  priceInr: 1450,
  benefitPercent: 12,
};

const FALLBACK_VC_PACK: { key: BillingVcPackCatalogKey; label: string; vc: number; priceInr: number } = {
  key: 'scale',
  label: 'Scale',
  vc: 2600,
  priceInr: 5000,
};

const FEATURED_PUBLIC_PLAN_KEY: BillingPlanKey = 'creator';

const BILLING_TAB_CONTENT: Record<
  BillingSurfaceTab,
  { eyebrow: string; title: string; description: string }
> = {
  plans: {
    eyebrow: 'Studio plans',
    title: 'Pick a monthly lane with your renewal math already visible.',
    description: 'Compare launch pricing, ongoing cost, and the amount of VF included before you enter secure checkout.',
  },
  token: {
    eyebrow: 'VF top-ups',
    title: 'Buy one-off credits when you need extra production headroom.',
    description: 'Top up without changing your plan and keep the exact VF-to-price ratio visible while you compare packs.',
  },
  vc: {
    eyebrow: 'Voice clone packs',
    title: 'Unlock voice-clone capacity without guessing the checkout path.',
    description: 'Choose the right voice-minute pack, preview USD with a native toggle, and complete checkout in INR.',
  },
  vn: {
    eyebrow: 'Novel tokens (VN)',
    title: 'Buy VN tokens to unlock published novel chapters.',
    description: 'Each VN token lets you unlock chapters from published novels. Compare packs and pick the best value.',
  },
};

const PUBLIC_PLAN_STORY: Record<BillingPlanKey, string> = {
  launcher: 'A small entry pack for first experiments and quick publish tests.',
  starter: 'A lighter monthly lane for solo publishing and steady drafts.',
  creator: 'The best balance for consistent launches, revisions, and review cycles.',
  pro: 'More room for multi-project teams shipping polished voice work every week.',
  scale: 'High-volume capacity for production teams and bigger output pipelines.',
};

const PUBLIC_TOKEN_PACK_STORY: Record<TokenPackKey, string> = {
  micro: 'Quick top-up for focused edits, testing, and short delivery runs.',
  standard: 'Balanced refill for ongoing production without changing your plan.',
  mega: 'High-capacity refill for frequent exports and heavier studio throughput.',
  ultra: 'Largest refill for teams that need sustained burst capacity on demand.',
};

const PUBLIC_VC_PACK_STORY: Record<BillingVcPackCatalogKey, string> = {
  starter: 'A focused entry pack for short cloning sessions and quick iterations.',
  standard: 'Balanced voice minutes for weekly projects and recurring updates.',
  growth: 'Higher minute volume for teams scaling outputs across multiple voices.',
  pro: 'Premium minute capacity for heavy studio workloads and tight delivery cycles.',
  scale: 'Maximum voice-minute headroom for enterprise-grade throughput.',
};

const isAuthError = (error: unknown): boolean => {
  const candidate = error as { status?: unknown; cause?: { status?: unknown }; message?: unknown; detail?: unknown };
  const status = Number(candidate?.status ?? candidate?.cause?.status ?? 0);
  if (status === 401 || status === 403) return true;
  const message = String(candidate?.message || candidate?.detail || '').trim().toLowerCase();
  return message.includes('authentication required');
};

interface BillingAuthPromptState {
  intentDraft: Omit<BillingCheckoutIntentDraft, 'authMode'>;
  message: string;
}

export const BillingSurface: React.FC<BillingSurfaceProps> = ({
  mode,
  returnPath,
  appBuyUrl = '/billing',
  homeUrl = '/',
  authMode,
  isAuthenticated,
  billingCountry = null,
  onBackToWorkspace,
  onRefreshEntitlements,
  walletSummary = null,
  tokenPackDiscountPercent = 0,
  vcTokenPackDiscountPercent = 0,
  defaultTokenPackKey = 'standard',
  defaultVcPackKey = 'scale',
}) => {
  const visibleTabs = ['plans', 'token', 'vc', 'vn'] as const;
  const selectedTabItems = visibleTabs.map((id) => ({ id }));

  const billingActions = useBillingActions({ baseUrl: ACCOUNT_BILLING_API_BASE, returnPath });

  const [activeTab, setActiveTab] = useState<BillingSurfaceTab>('plans');
  const [selectedPack, setSelectedPack] = useState<TokenPackKey>(defaultTokenPackKey);
  const [selectedVcPack, setSelectedVcPack] = useState<BillingVcPackCatalogKey>(defaultVcPackKey);
  const [selectedVnPack, setSelectedVnPack] = useState<VnTokenPackKey>('vn_standard');
  const [vcDisplayCurrency, setVcDisplayCurrency] = useState<VcDisplayCurrency>('usd');
  const [loadingKey, setLoadingKey] = useState('');
  const [error, setError] = useState('');
  const [banner, setBanner] = useState<BillingSurfaceBanner | null>(null);
  const [hasFirebaseSession, setHasFirebaseSession] = useState<boolean | null>(() => (firebaseAuth.currentUser ? true : null));
  const [authPrompt, setAuthPrompt] = useState<BillingAuthPromptState | null>(null);
  const resumeAttemptedRef = useRef(false);

  const resolvedAuthMode = 'login';
  const hasActiveAuthSession = Boolean(hasFirebaseSession || isAuthenticated);
  const nativeCurrencyCode = useMemo(() => resolveNativeCurrencyCode(billingCountry), [billingCountry]);
  const billingCheckoutLocked = isBillingCheckoutLocked();

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

  const redirectToAuthWithIntent = useCallback((
    intentDraft: Omit<BillingCheckoutIntentDraft, 'authMode'>,
    chosenMode: AuthRouteMode
  ): void => {
    if (typeof window === 'undefined') return;
    const intent = writeBillingCheckoutIntent({
      ...intentDraft,
      authMode: chosenMode,
    });
    const safeNext = resolveSafeInternalNextPath(intent?.resumePath, resolveResumePath(activeTab));
    window.location.href = resolveLoginPath(chosenMode, safeNext);
  }, [activeTab, resolveResumePath]);

  const promptForCheckoutAuth = useCallback((
    intentDraft: Omit<BillingCheckoutIntentDraft, 'authMode'>,
    selectionLabel: string
  ): void => {
    setError('');
    setBanner(null);
    if (mode === 'public') {
      setAuthPrompt({
        intentDraft,
        message: `Sign in to continue checkout for ${selectionLabel}. We will bring you back here and resume the flow.`,
      });
      return;
    }
    redirectToAuthWithIntent(intentDraft, resolvedAuthMode);
  }, [mode, redirectToAuthWithIntent, resolvedAuthMode]);

  const runPlanCheckout = useCallback(async (planKey: BillingPlanKey): Promise<void> => {
    if (!hasActiveAuthSession) {
      const planSummary = BILLING_PLAN_ROWS.find((item) => item.key === planKey);
      promptForCheckoutAuth({
        kind: 'subscription',
        selection: { planKey },
        resumePath: resolveResumePath('plans'),
      }, `${planSummary?.name || 'your selected'} plan`);
      return;
    }

    setError('');
    setBanner(null);
    setAuthPrompt(null);
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
        const planSummary = BILLING_PLAN_ROWS.find((item) => item.key === planKey);
        promptForCheckoutAuth({
          kind: 'subscription',
          selection: { planKey },
          resumePath: resolveResumePath('plans'),
        }, `${planSummary?.name || 'your selected'} plan`);
        return;
      }
      setError(checkoutError?.message || 'Could not start subscription checkout.');
    } finally {
      setLoadingKey('');
    }
  }, [billingActions, hasActiveAuthSession, promptForCheckoutAuth, resolveResumePath, returnPath]);

  const runTokenCheckout = useCallback(async (packKey: TokenPackKey): Promise<void> => {
    if (!hasActiveAuthSession) {
      const packSummary = BILLING_TOKEN_PACK_ROWS.find((item) => item.key === packKey);
      promptForCheckoutAuth({
        kind: 'token-pack',
        selection: { packKey },
        resumePath: resolveResumePath('token'),
      }, `${packSummary?.label || 'your selected'} credit pack`);
      return;
    }

    setError('');
    setBanner(null);
    setAuthPrompt(null);
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
        const packSummary = BILLING_TOKEN_PACK_ROWS.find((item) => item.key === packKey);
        promptForCheckoutAuth({
          kind: 'token-pack',
          selection: { packKey },
          resumePath: resolveResumePath('token'),
        }, `${packSummary?.label || 'your selected'} credit pack`);
        return;
      }
      setError(checkoutError?.message || 'Could not start credit-pack checkout.');
    } finally {
      setLoadingKey('');
    }
  }, [billingActions, hasActiveAuthSession, promptForCheckoutAuth, resolveResumePath, returnPath]);

  const runVcCheckout = useCallback(async (packKey: BillingVcPackCatalogKey): Promise<void> => {
    if (!hasActiveAuthSession) {
      const packSummary = BILLING_VC_PACK_ROWS.find((item) => item.key === packKey);
      promptForCheckoutAuth({
        kind: 'vc-token-pack',
        selection: { vcPackKey: packKey },
        resumePath: resolveResumePath('vc'),
      }, `${packSummary?.label || 'your selected'} voice-minutes pack`);
      return;
    }

    setError('');
    setBanner(null);
    setAuthPrompt(null);
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
        const packSummary = BILLING_VC_PACK_ROWS.find((item) => item.key === packKey);
        promptForCheckoutAuth({
          kind: 'vc-token-pack',
          selection: { vcPackKey: packKey },
          resumePath: resolveResumePath('vc'),
        }, `${packSummary?.label || 'your selected'} voice-minutes pack`);
        return;
      }
      setError(checkoutError?.message || 'Could not start voice-minutes pack checkout.');
    } finally {
      setLoadingKey('');
    }
  }, [billingActions, hasActiveAuthSession, promptForCheckoutAuth, resolveResumePath, returnPath]);

  const runVnCheckout = useCallback(async (packKey: VnTokenPackKey): Promise<void> => {
    if (!hasActiveAuthSession) {
      const packSummary = BILLING_VN_PACK_ROWS.find((item) => item.key === packKey);
      promptForCheckoutAuth({
        kind: 'vn-token-pack',
        selection: { vnPackKey: packKey },
        resumePath: resolveResumePath('vn'),
      }, `${packSummary?.label || 'your selected'} novel token pack`);
      return;
    }

    setError('');
    setBanner(null);
    setAuthPrompt(null);
    setLoadingKey(`vn:${packKey}`);
    try {
      const launch = await billingActions.startVnTokenPackCheckout(packKey);
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
        const packSummary = BILLING_VN_PACK_ROWS.find((item) => item.key === packKey);
        promptForCheckoutAuth({
          kind: 'vn-token-pack',
          selection: { vnPackKey: packKey },
          resumePath: resolveResumePath('vn'),
        }, `${packSummary?.label || 'your selected'} novel token pack`);
        return;
      }
      setError(checkoutError?.message || 'Could not start novel token pack checkout.');
    } finally {
      setLoadingKey('');
    }
  }, [billingActions, hasActiveAuthSession, promptForCheckoutAuth, resolveResumePath, returnPath]);

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

    if (intent.kind === 'vn-token-pack' && 'vnPackKey' in intent.selection) {
      setSelectedVnPack(intent.selection.vnPackKey);
      setTab('vn');
      void runVnCheckout(intent.selection.vnPackKey);
    }
  }, [hasActiveAuthSession, runPlanCheckout, runTokenCheckout, runVcCheckout, runVnCheckout, setTab]);

  useEffect(() => {
    if (!hasActiveAuthSession) return;
    setAuthPrompt(null);
  }, [hasActiveAuthSession]);

  const handlePlanCheckout = async (planKey: BillingPlanKey) => {
    await runPlanCheckout(planKey);
  };

  const handleTokenCheckout = async () => {
    await runTokenCheckout(selectedPack);
  };

  const handleVcCheckout = async () => {
    await runVcCheckout(selectedVcPack);
  };

  const activeTabContent = BILLING_TAB_CONTENT[activeTab];
  const lowestPlanPrice = BILLING_PLAN_ROWS.reduce((lowest, plan) => Math.min(lowest, plan.firstCycleInr), Number.POSITIVE_INFINITY);
  const highestPlanCredits = BILLING_PLAN_ROWS.reduce((highest, plan) => Math.max(highest, plan.vfCredits), 0);
  const highestRenewalDiscountPercent = BILLING_PLAN_ROWS.reduce((highest, plan) => {
    const renewalDiscount = Math.round(((plan.firstCycleInr - plan.recurringInr) / Math.max(plan.firstCycleInr, 1)) * 100);
    return Math.max(highest, renewalDiscount);
  }, 0);
  const selectedTokenPackCheckoutPrice = Math.max(
    1,
    Math.round(selectedPackSummary.priceInr * (1 - Math.max(0, tokenPackDiscountPercent) / 100))
  );
  const selectedTokenPackSavingsInr = Math.max(0, selectedPackSummary.priceInr - selectedTokenPackCheckoutPrice);
  const selectedVcPackCheckoutPrice = Math.max(
    1,
    Math.round(selectedVcPackSummary.priceInr * (1 - Math.max(0, vcTokenPackDiscountPercent) / 100))
  );
  const selectedVcPackSavingsInr = Math.max(0, selectedVcPackSummary.priceInr - selectedVcPackCheckoutPrice);

  const bannerToneClass = banner?.tone === 'success'
    ? (mode === 'app' ? 'border-emerald-300/35 bg-emerald-500/12 text-emerald-100' : 'border-emerald-300/30 bg-emerald-500/12 text-emerald-100')
      : banner?.tone === 'warning'
      ? (mode === 'app' ? 'border-amber-300/35 bg-amber-500/12 text-amber-100' : 'border-amber-300/30 bg-amber-500/12 text-amber-100')
      : (mode === 'app' ? 'border-cyan-300/35 bg-cyan-500/12 text-cyan-100' : 'border-cyan-300/30 bg-cyan-500/12 text-cyan-100');
  const showOpenBillingAction = String(appBuyUrl || '').trim() !== String(returnPath || '').trim();

  return (
    <div className={`vf-billing-surface vf-billing-surface--${mode} min-h-screen overflow-x-hidden ${
      mode === 'app'
        ? 'bg-[radial-gradient(86%_72%_at_8%_8%,rgba(71,214,202,0.18),transparent_60%),radial-gradient(74%_68%_at_90%_12%,rgba(243,184,107,0.14),transparent_62%),radial-gradient(80%_72%_at_52%_100%,rgba(47,128,237,0.12),transparent_70%),linear-gradient(165deg,#041321_0%,#071f39_48%,#0b1730_74%,#17161f_100%)] text-slate-100'
        : 'flex flex-col bg-[radial-gradient(86%_72%_at_8%_8%,rgba(71,214,202,0.2),transparent_60%),radial-gradient(74%_70%_at_92%_12%,rgba(243,184,107,0.16),transparent_62%),radial-gradient(82%_74%_at_52%_100%,rgba(47,128,237,0.12),transparent_72%),linear-gradient(165deg,#041321_0%,#071f39_48%,#0b1730_74%,#17161f_100%)] text-slate-100'
    }`}>
      {mode === 'public' ? (
        <>
          <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(78%_72%_at_6%_8%,rgba(71,214,202,0.16),transparent_62%),radial-gradient(72%_68%_at_92%_10%,rgba(243,184,107,0.12),transparent_64%),radial-gradient(80%_72%_at_50%_95%,rgba(47,128,237,0.12),transparent_72%)]" />
          <div className="vf-billing-public-mesh pointer-events-none fixed inset-0 opacity-80" />
        </>
      ) : null}

      <div className={`relative z-10 mx-auto w-full ${mode === 'app' ? 'max-w-7xl px-4 pb-8 pt-4 sm:px-6 sm:pt-6' : 'flex-1 max-w-6xl px-4 pb-10 pt-4 sm:px-6 sm:pt-6 lg:pb-12'}`}>
        {mode === 'public' ? (
          <header className="vf-billing-public-hero relative overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(145deg,rgba(6,12,26,0.92),rgba(8,18,34,0.94)_52%,rgba(8,16,33,0.98))] shadow-[0_28px_90px_rgba(2,6,23,0.52)]">
            <div className="pointer-events-none absolute inset-0">
              <div className="vf-billing-public-orb vf-billing-public-orb--primary absolute -left-16 top-6 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(71,214,202,0.28)_0%,rgba(71,214,202,0)_72%)] blur-2xl" />
              <div className="vf-billing-public-orb vf-billing-public-orb--secondary absolute right-[-2rem] top-12 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(47,128,237,0.24)_0%,rgba(47,128,237,0)_70%)] blur-3xl" />
              <div className="vf-billing-public-orb vf-billing-public-orb--tertiary absolute bottom-[-3rem] left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(243,184,107,0.16)_0%,rgba(243,184,107,0)_72%)] blur-3xl" />
            </div>

            <div className="relative grid gap-6 px-5 py-5 sm:px-6 sm:py-6 lg:grid-cols-[minmax(0,1.14fr)_minmax(18rem,0.86fr)] lg:gap-8 lg:px-8 lg:py-8">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <BrandLogo size="sm" tone="light" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold uppercase tracking-[0.08em] text-slate-100">V FLOW AI Billing</div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">AI Studio</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <a
                      href={homeUrl}
                      className="inline-flex min-h-11 items-center rounded-full border border-white/14 bg-white/5 px-4 py-2 text-[12px] font-semibold text-slate-100 transition hover:bg-white/10"
                    >
                      Home
                    </a>
                    {showOpenBillingAction ? (
                      <a
                        href={appBuyUrl}
                        className="vf-billing-public-cta inline-flex min-h-11 items-center rounded-full bg-gradient-to-r from-[#47d6ca] via-[#2f80ed] to-[#f3b86b] px-4 py-2 text-[12px] font-semibold text-slate-950 shadow-[0_18px_40px_rgba(71,214,202,0.24)] transition hover:brightness-105"
                      >
                        Open Billing
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="mt-6 max-w-2xl">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200/80">Billing</p>
                  <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-[2.55rem] sm:leading-[1.05]">
                    Billing, credits, and checkout
                  </h1>
                  <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300 sm:text-[15px]">
                    Choose the plan that fits your workflow, compare month-one and renewal pricing, and confirm the exact checkout path before you pay.
                  </p>
                </div>

                <div className="mt-6 flex flex-wrap gap-2.5">
                  <div className="rounded-full border border-white/12 bg-white/[0.05] px-3 py-2 text-[11px] font-semibold text-slate-100">
                    {BILLING_PLAN_ROWS.length} plans from {formatInr(lowestPlanPrice)}
                  </div>
                  <div className="rounded-full border border-white/12 bg-white/[0.05] px-3 py-2 text-[11px] font-semibold text-slate-100">
                    Up to {formatNumber(highestPlanCredits)} VF included
                  </div>
                  <div className="rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold text-emerald-100">
                    Up to {highestRenewalDiscountPercent}% lower on renewal
                  </div>
                </div>

                <div className="mt-6 rounded-[1.35rem] border border-emerald-300/20 bg-emerald-500/10 px-4 py-3 text-[11px] font-semibold text-emerald-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  Billing terms, renewal details, and credit availability are confirmed before checkout is completed.
                </div>
              </div>

              <aside className="vf-billing-public-insight relative overflow-hidden rounded-[1.65rem] border border-white/10 bg-white/[0.05] p-4 backdrop-blur-xl sm:p-5">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.14),transparent_55%)] opacity-70" />
                <div className="relative">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">At a glance</p>
                  <div className="mt-4 grid grid-cols-3 gap-2.5">
                    <div className="rounded-2xl border border-white/10 bg-slate-950/48 px-3 py-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">From</div>
                      <div className="mt-1 text-lg font-semibold text-white">{formatInr(lowestPlanPrice)}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-slate-950/48 px-3 py-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Plans</div>
                      <div className="mt-1 text-lg font-semibold text-white">{BILLING_PLAN_ROWS.length}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-slate-950/48 px-3 py-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Packs</div>
                      <div className="mt-1 text-lg font-semibold text-white">{BILLING_TOKEN_PACK_ROWS.length + BILLING_VC_PACK_ROWS.length}</div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-[1.35rem] border border-cyan-300/16 bg-[linear-gradient(180deg,rgba(11,22,42,0.84),rgba(7,15,30,0.96))] p-4 shadow-[0_16px_40px_rgba(2,6,23,0.28)]">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200/78">Checkout path</div>
                    <p className="mt-2 text-sm leading-6 text-slate-300">
                      Review a plan or pack first. Sign in only when you decide to continue into secure checkout.
                    </p>
                    <p className="mt-3 text-[11px] leading-5 text-cyan-100/86">
                      Renewal pricing stays visible up front, so the comparison never disappears once you select a lane.
                    </p>
                  </div>
                </div>
              </aside>
            </div>
          </header>
        ) : (
          <header className="rounded-2xl border border-cyan-300/20 bg-slate-950/70 p-2.5 shadow-[0_18px_44px_rgba(2,6,23,0.45)] backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                {onBackToWorkspace ? (
                  <button
                    type="button"
                    onClick={onBackToWorkspace}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/80 px-3 py-2 text-[12px] font-semibold text-slate-200 transition hover:bg-slate-800"
                  >
                    <ArrowLeft size={15} />
                    Workspace
                  </button>
                ) : null}
                <div className="flex min-w-0 items-center gap-2">
                  <BrandLogo size="sm" tone="light" />
                  <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-200/90">
                    Billing
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-end justify-between gap-2.5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200/80">Billing</p>
                <h1 className="mt-1 text-lg font-semibold tracking-tight text-white sm:text-xl">
                  Manage billing, credits, and checkout
                </h1>
                <p className="mt-1.5 text-[13px] leading-5 text-slate-300">
                  Choose the plan that fits your workflow, compare month-one and renewal pricing, and confirm the exact checkout path before you pay.
                </p>
              </div>

              {walletSummary ? (
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
                <div className="rounded-2xl border border-cyan-300/25 bg-cyan-500/10 px-3.5 py-2.5 text-[11px] font-semibold text-cyan-100">
                  Billing terms, renewal details, and credit availability are confirmed before checkout is completed.
                </div>
              )}
            </div>
          </header>
        )}

        {banner ? (
          <div className={`mt-3 rounded-xl border px-3.5 py-2.5 text-[13px] ${bannerToneClass}`}>
            {banner.message}
          </div>
        ) : null}

        {mode === 'public' && !hasActiveAuthSession ? (
          <div className="mt-3 rounded-xl border border-cyan-300/20 bg-cyan-500/8 px-3.5 py-2.5 text-[13px] text-cyan-50">
            Browse pricing first. Sign in only when you are ready to start secure checkout.
          </div>
        ) : null}

        {billingCheckoutLocked ? (
          <div className={`mt-3 rounded-xl border px-3.5 py-3 text-[13px] ${
            mode === 'app'
              ? 'border-amber-300/35 bg-amber-500/12 text-amber-100'
              : 'border-amber-300/30 bg-amber-500/12 text-amber-100'
          }`}>
            <p className="font-semibold">{BILLING_CHECKOUT_LOCK_TITLE}</p>
            <p className="mt-1 text-[12px] leading-5 text-amber-100/90">{BILLING_CHECKOUT_LOCK_MESSAGE}</p>
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

        <main className={`mt-2 rounded-[1.5rem] border p-2.5 shadow-[0_18px_44px_rgba(2,6,23,0.42)] backdrop-blur sm:p-3 ${
          mode === 'app'
            ? 'border-slate-700/70 bg-slate-950/70'
            : 'vf-billing-public-main border-white/10 bg-[linear-gradient(180deg,rgba(7,13,27,0.82),rgba(5,10,20,0.96))]'
        }`}>
          {mode === 'public' ? (
            <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-200/78">{activeTabContent.eyebrow}</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-[1.7rem] sm:leading-[1.15]">
                  {activeTabContent.title}
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                  {activeTabContent.description}
                </p>
              </div>
              <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.045] px-4 py-3 text-[13px] leading-5 text-slate-300">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Secure path</div>
                <p className="mt-2">Review what you want first, then continue only when you are ready to authenticate and pay.</p>
              </div>
            </div>
          ) : null}

          <div className={`grid w-full grid-cols-4 gap-1 rounded-[1rem] border p-1 ${
            mode === 'app'
              ? 'border-slate-700 bg-slate-900/60'
              : 'border-white/10 bg-white/[0.04]'
          }`} {...managedTabs.listProps}>
            {visibleTabs.map((tab) => {
              const Icon = tab === 'plans' ? CreditCard : tab === 'token' ? Coins : tab === 'vn' ? BookOpen : Sparkles;
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  {...managedTabs.getTabProps(tab)}
                  className={`vf-billing-tab-button inline-flex min-h-11 items-center justify-center rounded-[1rem] px-2.5 py-2 text-[12px] font-semibold transition sm:text-xs ${
                    isActive
                      ? (mode === 'app' ? 'bg-cyan-500/18 text-cyan-100' : 'bg-white/10 text-white shadow-[0_10px_24px_rgba(2,6,23,0.28)]')
                      : (mode === 'app' ? 'bg-slate-900/70 text-slate-200 hover:bg-slate-800' : 'text-slate-300 hover:bg-white/5 hover:text-white')
                  }`}
                >
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    <Icon size={13} />
                    {tab === 'plans' ? 'Plans' : tab === 'token' ? 'Credit Packs' : tab === 'vn' ? 'Novel Tokens' : 'Voice Minutes'}
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {BILLING_PLAN_ROWS.map((plan) => {
                  const recurringDiscountPercent = Math.max(
                    0,
                    Math.round(((plan.firstCycleInr - plan.recurringInr) / Math.max(plan.firstCycleInr, 1)) * 100)
                  );
                  const effectiveRecurringRate = Math.round((plan.recurringInr / Math.max(1, plan.vfCredits)) * 10000);
                  const isFeaturedPlan = mode === 'public' && plan.key === FEATURED_PUBLIC_PLAN_KEY;
                  return (
                    <article key={plan.key} className={`vf-billing-plan-card relative isolate flex h-full flex-col overflow-hidden rounded-[1rem] border p-3 ${
                      mode === 'app'
                        ? 'border-slate-700 bg-slate-900/60 hover:bg-slate-800/80 transition-colors'
                        : isFeaturedPlan
                          ? 'border-cyan-300/26 bg-[linear-gradient(180deg,rgba(12,30,53,0.92),rgba(7,12,24,0.98))] shadow-[0_18px_42px_rgba(8,47,73,0.22)]'
                          : 'border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.66),rgba(7,12,24,0.92))]'
                    }`}>
                      {mode === 'public' ? (
                        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_48%)] opacity-80" />
                      ) : null}
                      <div className="relative flex items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className={`text-[14px] font-semibold ${mode === 'app' ? 'text-slate-100' : 'text-white'}`}>{plan.name}</div>
                            {isFeaturedPlan ? (
                              <span className="rounded-full border border-cyan-300/30 bg-cyan-500/14 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100">
                                Best balance
                              </span>
                            ) : null}
                          </div>
                          <div className={`mt-0.5 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            mode === 'app'
                              ? 'border-cyan-400/35 bg-cyan-500/12 text-cyan-100'
                              : 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100'
                          }`}>
                            {formatNumber(plan.vfCredits)} VF
                          </div>
                          {mode === 'public' ? (
                            <p className="mt-3 max-w-[18rem] text-[12px] leading-5 text-slate-300">
                              {PUBLIC_PLAN_STORY[plan.key]}
                            </p>
                          ) : null}
                        </div>
                        <div className="text-right">
                          {plan.key === 'launcher' ? (
                            <div className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
                              mode === 'app' ? 'text-amber-400' : 'text-amber-400'
                            }`}>
                              One-Time Offer
                            </div>
                          ) : (
                            <div className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
                              mode === 'app' ? 'text-slate-400' : 'text-slate-400'
                            }`}>
                              Month 1
                            </div>
                          )}
                          <div className={`mt-1 text-[16px] font-bold ${mode === 'app' ? 'text-white' : 'text-white'}`}>
                            {formatInr(plan.firstCycleInr)}
                          </div>
                          {plan.key !== 'launcher' && (
                            <div className={`mt-1 text-[10px] font-semibold ${
                              mode === 'app' ? 'text-cyan-200' : 'text-cyan-100'
                            }`}>
                              {formatInr(plan.recurringInr)} / month after
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                        {plan.key === 'launcher' ? (
                           <div className={`text-[10px] ${mode === 'app' ? 'text-amber-300 font-bold' : 'text-amber-300 font-bold'}`}>
                             Special launch pack for all users!
                           </div>
                        ) : (
                           <div className={`text-[10px] ${mode === 'app' ? 'text-slate-400' : 'text-slate-400'}`}>
                             Effective renewal rate: {formatInr(effectiveRecurringRate)} / 10k VF
                           </div>
                        )}
                        {recurringDiscountPercent > 0 && plan.key !== 'launcher' ? (
                          <div className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            mode === 'app'
                              ? 'border-emerald-400/35 bg-emerald-500/12 text-emerald-100'
                              : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
                          }`}>
                            {recurringDiscountPercent}% lower on renewal
                          </div>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        onClick={() => void handlePlanCheckout(plan.key)}
                        disabled={Boolean(loadingKey) || billingCheckoutLocked}
                        className={`vf-billing-public-cta mt-auto inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          mode === 'app'
                            ? 'border border-cyan-400/35 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25'
                            : 'border border-cyan-400/30 bg-cyan-500/12 text-cyan-50 hover:bg-cyan-500/22'
                        }`}
                      >
                        {billingCheckoutLocked ? 'Checkout paused' : loadingKey === `plan:${plan.key}` ? 'Starting...' : 'Checkout'}
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
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {BILLING_TOKEN_PACK_ROWS.map((pack) => {
                  const isSelected = selectedPack === pack.key;
                  const effectiveRate = Math.round((pack.priceInr / Math.max(1, pack.vf)) * 10000);
                  const packBenefitPercent = Math.max(0, Number(pack.benefitPercent || 0));
                  return (
                    <button
                      key={pack.key}
                      type="button"
                      onClick={() => setSelectedPack(pack.key)}
                      className={`vf-billing-plan-card min-h-10 rounded-[1rem] border px-3 py-2 text-left transition ${
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
                      {mode === 'public' ? (
                        <p className="mt-2 text-[12px] leading-5 text-slate-300">
                          {PUBLIC_TOKEN_PACK_STORY[pack.key]}
                        </p>
                      ) : null}
                      <div className={`mt-1.5 text-[10px] ${mode === 'app' ? 'text-slate-400' : 'text-slate-400'}`}>
                        Effective: {formatInr(effectiveRate)} / 10k VF
                      </div>
                      {(packBenefitPercent > 0 || (mode === 'app' && tokenPackDiscountPercent > 0)) ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {packBenefitPercent > 0 ? (
                            <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
                              {packBenefitPercent}% better rate
                            </span>
                          ) : null}
                          {mode === 'app' && tokenPackDiscountPercent > 0 ? (
                            <span className="inline-flex items-center rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-100">
                              {tokenPackDiscountPercent}% plan discount at checkout
                            </span>
                          ) : null}
                        </div>
                      ) : null}
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
                  disabled={Boolean(loadingKey) || billingCheckoutLocked}
                  className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 py-2 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    mode === 'app'
                      ? 'border border-cyan-400/35 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25'
                      : 'border border-cyan-400/30 bg-cyan-500/12 text-cyan-50 hover:bg-cyan-500/22'
                  }`}
                >
                  {loadingKey === `token:${selectedPack}`
                    ? 'Checkout paused'
                    : loadingKey === `token:${selectedPack}`
                      ? 'Starting checkout...'
                      : `Checkout ${selectedPackSummary.label} credit pack`}
                  <ArrowRight size={14} />
                </button>
              </div>
              {mode === 'app' && tokenPackDiscountPercent > 0 ? (
                <div className="mt-3 rounded-xl border border-cyan-300/25 bg-cyan-500/10 px-3.5 py-2.5 text-[11px] text-cyan-100">
                  Your current plan unlocks {tokenPackDiscountPercent}% off token packs at checkout. Current selection saves {formatInr(selectedTokenPackSavingsInr)} and checks out at {formatInr(selectedTokenPackCheckoutPrice)}.
                </div>
              ) : null}
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
              <div className="flex items-center justify-between gap-2">
                <div className={`flex items-center gap-2 text-[13px] font-semibold ${
                  mode === 'app' ? 'text-slate-100' : 'text-white'
                }`}>
                  <Sparkles size={14} />
                  Voice Minutes Packs
                </div>
                <button
                  type="button"
                  onClick={() => setVcDisplayCurrency((current) => (current === 'usd' ? 'native' : 'usd'))}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition ${
                    mode === 'app'
                      ? 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/16'
                      : 'border-cyan-300/30 bg-cyan-500/10 text-cyan-50 hover:bg-cyan-500/16'
                  }`}
                  aria-label={vcDisplayCurrency === 'usd' ? 'Switch VC pricing display to native currency' : 'Switch VC pricing display to USD'}
                  title={vcDisplayCurrency === 'usd' ? `Show native ${nativeCurrencyCode} pricing` : 'Show USD pricing'}
                >
                  <ArrowLeftRight size={11} />
                  {vcDisplayCurrency === 'usd' ? 'Native' : 'USD'}
                </button>
              </div>
              <div className={`mt-1.5 text-[10px] ${mode === 'app' ? 'text-slate-400' : 'text-slate-300'}`}>
                USD preview uses an approximate FX rate. Native pricing follows your billing country or browser locale. Checkout remains INR-based.
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {BILLING_VC_PACK_ROWS.map((pack) => {
                  const isSelected = selectedVcPack === pack.key;
                  const isFeaturedVcPack = pack.key === 'scale';
                  const displayPrice = formatVcPrice(pack.priceInr, vcDisplayCurrency, nativeCurrencyCode);
                  return (
                    <button
                      key={pack.key}
                      type="button"
                      onClick={() => setSelectedVcPack(pack.key)}
                      className={`vf-billing-plan-card relative isolate flex h-full flex-col overflow-hidden rounded-[1rem] border p-3 text-left transition ${
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
                      {mode === 'public' ? (
                        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_48%)] opacity-80" />
                      ) : null}
                      <div className="relative flex h-full flex-col gap-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <div className={`text-[13px] font-semibold ${mode === 'app' ? 'text-slate-100' : 'text-white'}`}>{pack.label}</div>
                              {isFeaturedVcPack ? (
                                <span className="inline-flex items-center rounded-full border border-amber-300/35 bg-amber-500/12 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.09em] text-amber-100">
                                  Best value
                                </span>
                              ) : null}
                            </div>
                            <div className={`mt-0.5 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                              mode === 'app'
                                ? 'border-cyan-400/35 bg-cyan-500/12 text-cyan-100'
                                : 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100'
                            }`}>
                              {formatNumber(pack.vc)} VC minutes
                            </div>
                          </div>
                          <div className="text-right">
                            <div className={`text-[16px] font-bold ${mode === 'app' ? 'text-white' : 'text-white'}`}>{displayPrice}</div>
                            {(vcDisplayCurrency === 'usd' || nativeCurrencyCode !== 'INR') ? (
                              <div className={`mt-1 text-[10px] ${mode === 'app' ? 'text-slate-400' : 'text-slate-400'}`}>INR checkout: {formatInr(pack.priceInr)}</div>
                            ) : null}
                          </div>
                        </div>
                        {mode === 'public' ? (
                          <p className="text-[12px] leading-5 text-slate-300">
                            {PUBLIC_VC_PACK_STORY[pack.key]}
                          </p>
                        ) : null}
                        {mode === 'app' && vcTokenPackDiscountPercent > 0 ? (
                          <div className="inline-flex w-fit items-center rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-100">
                            {vcTokenPackDiscountPercent}% plan discount at checkout
                          </div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <p className={`text-[11px] ${mode === 'app' ? 'text-slate-300' : 'text-slate-300'}`}>
                  Selected: <span className={`font-semibold ${mode === 'app' ? 'text-slate-100' : 'text-white'}`}>{selectedVcPackSummary.label}</span> - {formatNumber(selectedVcPackSummary.vc)} minutes for {formatVcPrice(selectedVcPackSummary.priceInr, vcDisplayCurrency, nativeCurrencyCode)}{(vcDisplayCurrency === 'usd' || nativeCurrencyCode !== 'INR') ? ` (${formatInr(selectedVcPackSummary.priceInr)} INR checkout)` : ''}.
                </p>
                <button
                  type="button"
                  onClick={() => void handleVcCheckout()}
                  disabled={Boolean(loadingKey) || billingCheckoutLocked}
                  className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 py-2 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    mode === 'app'
                      ? 'border border-cyan-400/35 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25'
                      : 'border border-cyan-400/30 bg-cyan-500/12 text-cyan-50 hover:bg-cyan-500/22'
                  }`}
                >
                  {billingCheckoutLocked
                    ? 'Checkout paused'
                    : loadingKey === `vc:${selectedVcPack}`
                      ? 'Starting checkout...'
                      : `Checkout ${selectedVcPackSummary.label} minutes pack`}
                  <ArrowRight size={14} />
                </button>
              </div>
              {mode === 'app' && vcTokenPackDiscountPercent > 0 ? (
                <div className="mt-3 rounded-xl border border-cyan-300/25 bg-cyan-500/10 px-3.5 py-2.5 text-[11px] text-cyan-100">
                  Your current plan unlocks {vcTokenPackDiscountPercent}% off voice-minutes packs at checkout. Current selection saves {formatInr(selectedVcPackSavingsInr)} and checks out at {formatInr(selectedVcPackCheckoutPrice)}.
                </div>
              ) : null}
              <div className={`mt-3 rounded-xl border px-3.5 py-2.5 text-[11px] ${
                mode === 'app'
                  ? 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100'
                  : 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100'
              }`}>
                Voice-minutes pack pricing, validity, and renewal terms are confirmed before checkout is completed.
              </div>
            </section>
          ) : null}

          {activeTab === 'vn' ? (
            <section className={`mt-3 rounded-xl border p-2.5 ${
              mode === 'app'
                ? 'border-slate-700/60 bg-transparent'
                : 'border-white/10 bg-white/[0.04]'
            }`}>
              <div className={`flex items-center gap-2 text-[13px] font-semibold ${
                mode === 'app' ? 'text-slate-100' : 'text-white'
              }`}>
                <BookOpen size={14} />
                Novel Token Packs (VN)
              </div>
              <p className={`mt-1.5 text-[10px] ${mode === 'app' ? 'text-slate-400' : 'text-slate-300'}`}>
                VN tokens let you unlock published novel chapters. 1 INR = 10 VN.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {BILLING_VN_PACK_ROWS.map((pack) => {
                  const isSelected = selectedVnPack === pack.key;
                  return (
                    <button
                      key={pack.key}
                      type="button"
                      onClick={() => setSelectedVnPack(pack.key)}
                      className={`rounded-xl border p-3 text-left transition ${
                        isSelected
                          ? (mode === 'app' ? 'border-cyan-400/50 bg-cyan-500/14' : 'border-cyan-400/50 bg-cyan-500/14')
                          : (mode === 'app' ? 'border-slate-700/50 bg-slate-900/40 hover:border-slate-600' : 'border-white/10 bg-white/[0.03] hover:border-white/20')
                      }`}
                    >
                      <div className={`text-[11px] font-semibold ${isSelected ? 'text-cyan-100' : 'text-slate-200'}`}>
                        {pack.label}
                      </div>
                      <div className={`mt-1 text-lg font-bold ${isSelected ? 'text-white' : 'text-slate-100'}`}>
                        {formatNumber(pack.vn)} VN
                      </div>
                      <div className={`mt-0.5 text-[11px] ${isSelected ? 'text-cyan-200/70' : 'text-slate-400'}`}>
                        {formatInr(pack.priceInr)}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center justify-end gap-3">
                <button
                  type="button"
                  disabled={Boolean(loadingKey) || billingCheckoutLocked}
                  onClick={() => void runVnCheckout(selectedVnPack)}
                  className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 py-2 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    mode === 'app'
                      ? 'border border-cyan-400/35 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25'
                      : 'border border-cyan-400/30 bg-cyan-500/12 text-cyan-50 hover:bg-cyan-500/22'
                  }`}
                >
                  {billingCheckoutLocked
                    ? 'Checkout paused'
                    : loadingKey === `vn:${selectedVnPack}`
                      ? 'Starting checkout...'
                      : `Checkout ${BILLING_VN_PACK_ROWS.find((p) => p.key === selectedVnPack)?.label || ''} VN pack`}
                  <ArrowRight size={14} />
                </button>
              </div>
              <div className={`mt-3 rounded-xl border px-3.5 py-2.5 text-[11px] ${
                mode === 'app'
                  ? 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100'
                  : 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100'
              }`}>
                Novel token pricing is confirmed before checkout. VN tokens have no expiry.
              </div>
            </section>
          ) : null}
        </main>
      </div>

      {authPrompt ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/70 px-4 py-6 backdrop-blur-sm">
          <div
            className="w-full max-w-md rounded-[1.75rem] border border-cyan-300/20 bg-[linear-gradient(180deg,rgba(8,17,33,0.96),rgba(9,14,27,0.98))] p-5 shadow-[0_24px_70px_rgba(2,6,23,0.52)]"
            role="dialog"
            aria-modal="true"
            aria-label="Continue to checkout"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200/80">Secure checkout</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-white">Continue with sign-in</h2>
              </div>
              <button
                type="button"
                onClick={() => setAuthPrompt(null)}
                className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-full border border-white/12 bg-white/5 px-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
                aria-label="Close checkout auth dialog"
              >
                Close
              </button>
            </div>

            <p className="mt-3 text-sm leading-6 text-slate-300">
              {authPrompt.message}
            </p>

            <div className="mt-5 grid gap-3">
              <button
                type="button"
                onClick={() => redirectToAuthWithIntent(authPrompt.intentDraft, 'login')}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#47d6ca] via-[#2f80ed] to-[#f3b86b] px-4 py-2 text-sm font-semibold text-slate-950 shadow-[0_16px_36px_rgba(71,214,202,0.24)] transition hover:translate-y-[-1px] hover:brightness-105"
              >
                Sign in
                <ArrowRight size={15} />
              </button>
            </div>

            <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-400/10 px-3.5 py-3 text-xs leading-5 text-amber-50">
              <p className="font-semibold">{SIGNUP_DISABLED_TITLE}</p>
              <p className="mt-1 text-amber-100/90">{SIGNUP_DISABLED_MARKETING_DETAIL}</p>
            </div>
          </div>
        </div>
      ) : null}

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
