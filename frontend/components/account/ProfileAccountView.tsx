import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  LogOut,
  RefreshCcw,
} from 'lucide-react';
import { AppScreen, GenerationSettings, HistoryItem } from '../../types';
import { BrandLogo } from '../BrandLogo';
import { EngineLogo } from '../EngineLogo';
import { useUser } from '../../contexts/UserContext';
import { useBillingActions } from '../../src/features/billing/hooks/useBillingActions';
import { useNotifications } from '../../src/shared/notifications/NotificationProvider';
import { NOTIFICATION_DEEP_LINK_EVENT, readNotificationDeepLink } from '../../src/shared/notifications/deepLink';
import { resolveApiBaseUrl } from '../../src/shared/api/config';
import { STORAGE_KEYS } from '../../src/shared/storage/keys';
import { readStorageJson, readStorageString, writeStorageString } from '../../src/shared/storage/localStore';
import { useManagedTabs } from '../../src/shared/ui/tabs';
import { sanitizeUiText } from '../../src/shared/ui/terminology';
import { resolveHistoryVoiceLabel } from '../../src/shared/voices/historyVoiceLabel';
import { getEngineDisplayName } from '../../services/engineDisplay';
import {
  fetchAccountEntitlements,
  fetchAccountProfile,
  fetchAccountBillingSummary,
  fetchMySupportConversations,
  markSupportConversationUnresolved,
  postSupportMessage,
  type AccountBillingSummary,
  type AccountEntitlements,
  type AccountUserProfile,
  type BillingPlanKey,
  type SupportConversation,
  type TtsEngineKey,
} from '../../services/accountService';
import {
  DEFAULT_ACCOUNT_TAB,
  resolveAccountTabFromSearch,
  shouldKeepConversationSelection,
  shouldLazyLoadAccountTab,
  type AccountTabKey,
} from './accountCenterTabs';
import { consumeBillingReturnState } from './billingReturnState';
import {
  ACCOUNT_TAB_ICONS,
  InfoRow,
  MetricCard,
  PreferenceToggle,
  StatusBadge,
  ThemeButton,
  WindowCard,
  cardInsetClass,
  describePaymentMethod,
  formatCompactNumber,
  formatCurrencyInr,
  formatCurrencyMinor,
  formatDate,
  formatDateTime,
  formatNumber,
  formatProviderLabel,
  formatVfValue,
  humanizeToken,
  labelClass,
  mutedClass,
  statusToneFromConversation,
  statusToneFromPriority,
  subduedClass,
  SUMMARY_ICONS,
  surfaceClass,
} from './accountCenterShared';
import {
  ACCOUNT_DETAIL_LABELS,
  getBillingActionVisibility,
} from './accountCenterLayout';

type ThemeChoice = 'light' | 'dark' | 'system';

const EAGER_ACCOUNT_TABS: AccountTabKey[] = ['account', 'billing', 'usage', 'preferences'];

const ACCOUNT_TAB_META: Record<AccountTabKey, { title: string; detail: string }> = {
  account: {
    title: 'Account',
    detail: 'Identity, access, membership, and synced entitlements.',
  },
  billing: {
    title: 'Billing',
    detail: 'Plan actions, payment status, invoices, and renewal controls.',
  },
  usage: {
    title: 'Usage',
    detail: 'Daily, monthly, and lifetime VF usage split by engine.',
  },
  preferences: {
    title: 'Preferences',
    detail: 'Theme plus inbox and email notification controls.',
  },
  support: {
    title: 'Support',
    detail: 'Create requests and track your support conversation status.',
  },
  activity: {
    title: 'Activity',
    detail: 'Recent generation history with normalized engine naming.',
  },
};

const readSettingsBackendUrl = (): string => {
  const parsed = readStorageJson<{ mediaBackendUrl?: string }>(STORAGE_KEYS.settings);
  return resolveApiBaseUrl(parsed?.mediaBackendUrl);
};

const readSavedUiTheme = (): ThemeChoice => {
  const token = String(readStorageString(STORAGE_KEYS.uiTheme) || '').trim().toLowerCase();
  if (token === 'dark' || token === 'light' || token === 'system') return token;
  return 'system';
};

const resolveThemeChoice = (themeChoice: ThemeChoice): boolean => {
  if (typeof window === 'undefined') return themeChoice === 'dark';
  if (themeChoice === 'dark') return true;
  if (themeChoice === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
};

const normalizePlanKey = (value: unknown): 'free' | BillingPlanKey => {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'launcher' || token === 'launch') return 'launcher';
  if (token === 'starter') return 'starter';
  if (token === 'creator') return 'creator';
  if (token === 'pro') return 'pro';
  if (token === 'scale' || token === 'plus' || token === 'pro-plus' || token === 'pro_plus') return 'scale';
  return 'free';
};

const toPlanName = (planKey: 'free' | BillingPlanKey): AccountBillingSummary['plan']['name'] => {
  if (planKey === 'launcher') return 'Launcher';
  if (planKey === 'starter') return 'Starter';
  if (planKey === 'creator') return 'Creator';
  if (planKey === 'pro') return 'Pro';
  if (planKey === 'scale') return 'Scale';
  return 'Free';
};

const setScreenSearchState = (screen: 'main' | 'profile' | 'login', tab?: AccountTabKey, conversationId?: string): void => {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('vf-screen', screen);
  url.searchParams.delete('billing');
  if (screen === 'profile') {
    url.searchParams.set('vf-tab', tab || DEFAULT_ACCOUNT_TAB);
    const nextConversationId = String(conversationId || '').trim();
    if (nextConversationId) url.searchParams.set('vf-conversation-id', nextConversationId);
    else url.searchParams.delete('vf-conversation-id');
  } else {
    url.searchParams.delete('vf-tab');
    url.searchParams.delete('vf-conversation-id');
  }
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
};

const buildFallbackBillingSummary = (
  user: { uid?: string | undefined; userId?: string | undefined; name?: string | undefined; email?: string | undefined },
  stats: ReturnType<typeof useUser>['stats'],
  accountProfile: AccountUserProfile | null,
  accountEntitlements: AccountEntitlements | null,
  billingSummary: AccountBillingSummary | null
): AccountBillingSummary => {
  if (billingSummary) return billingSummary;

  const planKey = normalizePlanKey(stats.planName);
  const planName = toPlanName(planKey);
  const isPaidPlan = planKey !== 'free';
  return {
    profile: {
      uid: String(user.uid || '').trim(),
      userId: String(accountProfile?.userId || user.userId || '').trim() || null,
      displayName: String(accountProfile?.displayName || user.name || '').trim() || null,
      email: String(accountProfile?.email || user.email || '').trim() || null,
      status: String(accountProfile?.status || '').trim() || null,
      createdAt: accountProfile?.createdAt || null,
      updatedAt: accountProfile?.updatedAt || null,
    },
    plan: {
      key: planKey,
      name: planName,
      status: isPaidPlan ? 'unavailable' : 'free_active',
      monthlyVfLimit: Math.max(0, Number(accountEntitlements?.monthly?.vfLimit || 0)),
      ttsSuccessRpm: planKey === 'scale' ? 10 : 5,
      maxCharsPerGeneration: Math.max(
        0,
        Number(accountEntitlements?.limits?.maxCharsPerGeneration || stats.limits?.maxCharsPerGeneration || 0)
      ),
      allowedEngines: Array.isArray(accountEntitlements?.limits?.allowedEngines)
        ? accountEntitlements.limits.allowedEngines
        : Array.isArray(stats.limits?.allowedEngines)
          ? stats.limits.allowedEngines
          : [],
      earlyAccess: Boolean(accountEntitlements?.features?.earlyAccess || stats.features?.earlyAccess),
      pricing: {
        firstCycleInr: 0,
        recurringInr: 0,
        discountPercent: 0,
      },
    },
    billing: {
      stripeReady: false,
      hasPortalAccess: false,
      stripeCustomerId: null,
      billingCountry: null,
      currencyMode: null,
    },
    subscription: {
      id: null,
      status: isPaidPlan ? 'unavailable' : 'inactive',
      active: false,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      nextBillingAt: null,
      startedAt: null,
      trialEnd: null,
      latestInvoiceId: null,
    },
    paymentMethod: null,
    invoices: [],
    warnings: [],
  };
};

const renderHistoryTimestamp = (timestamp: number): string => {
  if (!Number.isFinite(timestamp)) return '-';
  return formatDateTime(new Date(timestamp).toISOString());
};

const normalizeHistoryEngine = (value?: HistoryItem['engine']): GenerationSettings['engine'] => {
  if (value === 'KOKORO' || value === 'NEURAL2') return value;
  return 'GEM';
};

const ENGINE_RATE_ORDER: TtsEngineKey[] = ['KOKORO', 'NEURAL2', 'GEM'];

const formatDecimalValue = (value: number, minimumFractionDigits: number, maximumFractionDigits: number): string =>
  new Intl.NumberFormat('en-IN', {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(Math.max(0, Number(value || 0)));

const formatVfRatePerCharacter = (rate: number): string => {
  const safeRate = Number(rate || 0);
  if (!Number.isFinite(safeRate) || safeRate <= 0) return 'Unavailable';
  const minimumFractionDigits = safeRate < 10 && !Number.isInteger(safeRate) ? 1 : 0;
  return `${formatDecimalValue(safeRate, minimumFractionDigits, 2)} VF / char`;
};

const formatCharsPerVf = (rate: number): string => {
  const safeRate = Number(rate || 0);
  if (!Number.isFinite(safeRate) || safeRate <= 0) return 'Unavailable';
  const charsPerVf = 1 / safeRate;
  const minimumFractionDigits = charsPerVf < 1 ? 2 : charsPerVf < 10 && !Number.isInteger(charsPerVf) ? 1 : 0;
  return `${formatDecimalValue(charsPerVf, minimumFractionDigits, 2)} chars / 1 VF`;
};

export const ProfileAccountView: React.FC<{ setScreen: (s: AppScreen) => void }> = ({ setScreen }) => {
  const {
    user,
    stats,
    history,
    isAdmin,
    hasUnlimitedAccess,
    signOutUser,
    updateUser,
    setShowSubscriptionModal,
    loadHistory,
    refreshEntitlements,
  } = useUser();
  const { emit, prefs, setPrefs } = useNotifications();
  const baseUrl = useMemo(() => readSettingsBackendUrl(), []);
  const billingActions = useBillingActions({ baseUrl });

  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(readSavedUiTheme);
  const [isDarkUi, setIsDarkUi] = useState<boolean>(() => resolveThemeChoice(readSavedUiTheme()));
  const [accountProfile, setAccountProfile] = useState<AccountUserProfile | null>(null);
  const [accountEntitlements, setAccountEntitlements] = useState<AccountEntitlements | null>(null);
  const [billingSummary, setBillingSummary] = useState<AccountBillingSummary | null>(null);
  const [supportText, setSupportText] = useState('');
  const [supportConversations, setSupportConversations] = useState<SupportConversation[]>([]);
  const [isLoadingCore, setIsLoadingCore] = useState(true);
  const [isLoadingSupport, setIsLoadingSupport] = useState(false);
  const [isLoadingActivity, setIsLoadingActivity] = useState(false);
  const [isSendingSupport, setIsSendingSupport] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [portalIntent, setPortalIntent] = useState<'manage' | 'cancel' | null>(null);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [showAllInvoices, setShowAllInvoices] = useState(false);
  const [activeTab, setActiveTab] = useState<AccountTabKey>(() => {
    if (typeof window === 'undefined') return DEFAULT_ACCOUNT_TAB;
    return resolveAccountTabFromSearch(window.location.search, DEFAULT_ACCOUNT_TAB);
  });
  const [loadedTabs, setLoadedTabs] = useState<Set<AccountTabKey>>(() => new Set(EAGER_ACCOUNT_TABS));
  const [highlightedConversationId, setHighlightedConversationId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return String(new URLSearchParams(window.location.search).get('vf-conversation-id') || '').trim();
  });
  const conversationRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const dark = resolveThemeChoice(themeChoice);
      setIsDarkUi(dark);
      document.body.classList.toggle('theme-dark', dark);
      writeStorageString(STORAGE_KEYS.uiTheme, themeChoice);
    };

    applyTheme();
    if (themeChoice !== 'system') return undefined;
    media.addEventListener?.('change', applyTheme);
    media.addListener?.(applyTheme);
    return () => {
      media.removeEventListener?.('change', applyTheme);
      media.removeListener?.(applyTheme);
    };
  }, [themeChoice]);

  const markTabLoaded = useCallback((tab: AccountTabKey) => {
    setLoadedTabs((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, []);

  const syncCoreAccountData = useCallback(async (announceErrors: boolean) => {
    await refreshEntitlements();
    const [profileResult, entitlementsResult, billingResult] = await Promise.allSettled([
      fetchAccountProfile(baseUrl),
      fetchAccountEntitlements(baseUrl),
      fetchAccountBillingSummary(baseUrl),
    ]);

    let hadSuccess = false;

    if (profileResult.status === 'fulfilled') {
      hadSuccess = true;
      setAccountProfile(profileResult.value.profile);
    }

    if (entitlementsResult.status === 'fulfilled') {
      hadSuccess = true;
      setAccountEntitlements(entitlementsResult.value);
    }

    if (billingResult.status === 'fulfilled') {
      hadSuccess = true;
      setBillingSummary(billingResult.value);
      setShowAllInvoices(false);
      const resolvedUserId = String(billingResult.value.profile.userId || '').trim().toLowerCase();
      if (resolvedUserId) updateUser({ userId: resolvedUserId });
    }

    if (!hadSuccess && announceErrors) {
      emit('custom.message', {
        title: 'Account',
        message: 'Could not refresh account details. Showing cached information.',
        severity: 'warning',
        category: 'system',
        dedupeKey: 'account-refresh-warning',
      });
    }
  }, [baseUrl, emit, refreshEntitlements, updateUser]);

  const loadSupportData = useCallback(async (announceErrors: boolean) => {
    setIsLoadingSupport(true);
    try {
      const rows = await fetchMySupportConversations(baseUrl, 40);
      setSupportConversations(rows);
      markTabLoaded('support');
    } catch (error) {
      if (announceErrors) {
        emit('custom.message', {
          title: 'Support',
          message: sanitizeUiText(error instanceof Error ? error.message : 'Could not load support conversations.'),
          severity: 'warning',
          category: 'activity',
          dedupeKey: 'account-support-load-warning',
        });
      }
    } finally {
      setIsLoadingSupport(false);
    }
  }, [baseUrl, emit, markTabLoaded]);

  const loadActivityData = useCallback(async (announceErrors: boolean) => {
    setIsLoadingActivity(true);
    try {
      await loadHistory(20);
      markTabLoaded('activity');
    } catch (error) {
      if (announceErrors) {
        emit('custom.message', {
          title: 'Activity',
          message: sanitizeUiText(error instanceof Error ? error.message : 'Could not load recent activity.'),
          severity: 'warning',
          category: 'activity',
          dedupeKey: 'account-activity-load-warning',
        });
      }
    } finally {
      setIsLoadingActivity(false);
    }
  }, [emit, loadHistory, markTabLoaded]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setIsLoadingCore(true);
      try {
        await syncCoreAccountData(false);
      } finally {
        if (!cancelled) setIsLoadingCore(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [syncCoreAccountData]);

  useEffect(() => {
    if (!shouldLazyLoadAccountTab(activeTab) || loadedTabs.has(activeTab)) return;
    if (activeTab === 'support') {
      void loadSupportData(false);
      return;
    }
    if (activeTab === 'activity') {
      void loadActivityData(false);
    }
  }, [activeTab, loadedTabs, loadActivityData, loadSupportData]);

  useEffect(() => {
    const applyDeepLink = (target?: { screen?: string; tab?: string; conversationId?: string }): void => {
      const screenToken = String(target?.screen || '').trim().toLowerCase();
      if (screenToken && screenToken !== 'profile') return;

      const nextTabToken = String(target?.tab || '').trim();
      const nextConversationId = String(target?.conversationId || '').trim();
      if (nextTabToken) {
        setActiveTab(nextConversationId ? 'support' : resolveAccountTabFromSearch(`?vf-tab=${encodeURIComponent(nextTabToken)}`, DEFAULT_ACCOUNT_TAB));
      } else if (nextConversationId) {
        setActiveTab('support');
      }
      if (nextConversationId) setHighlightedConversationId(nextConversationId);
    };

    applyDeepLink(readNotificationDeepLink());
    const handleDeepLink = (event: Event) => {
      const detail = (event as CustomEvent<{ screen?: string; tab?: string; conversationId?: string }>).detail || {};
      applyDeepLink(detail);
    };
    window.addEventListener(NOTIFICATION_DEEP_LINK_EVENT, handleDeepLink as EventListener);
    return () => window.removeEventListener(NOTIFICATION_DEEP_LINK_EVENT, handleDeepLink as EventListener);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await consumeBillingReturnState({
        href: window.location.href,
        search: window.location.search,
        refreshBillingData: async () => {
          if (cancelled) return;
          await syncCoreAccountData(true);
        },
        replaceUrl: (nextUrl) => {
          if (cancelled) return;
          window.history.replaceState({}, '', nextUrl);
        },
        notify: (state, refreshed) => {
          if (cancelled) return;
          if (state === 'success') {
            emit('billing.checkout.success', {
              title: 'Billing',
              message: refreshed ? 'Billing updated successfully.' : 'Billing update received. Refresh failed.',
              category: 'activity',
              channel: 'toast',
            });
            return;
          }
          emit('billing.checkout.cancel', {
            title: 'Billing',
            message: 'Billing checkout canceled.',
            category: 'activity',
            channel: 'toast',
          });
        },
      });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [emit, syncCoreAccountData]);

  useEffect(() => {
    setScreenSearchState('profile', activeTab, shouldKeepConversationSelection(activeTab) ? highlightedConversationId : '');
  }, [activeTab, highlightedConversationId]);

  useEffect(() => {
    if (activeTab !== 'support' || !highlightedConversationId) return;
    const target = conversationRefs.current[highlightedConversationId];
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeTab, highlightedConversationId, supportConversations]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await syncCoreAccountData(true);
      if (loadedTabs.has('support')) await loadSupportData(false);
      if (loadedTabs.has('activity')) await loadActivityData(false);
    } finally {
      setIsRefreshing(false);
    }
  }, [loadActivityData, loadSupportData, loadedTabs, syncCoreAccountData]);

  const handleOpenPortal = useCallback(async (intent: 'manage' | 'cancel') => {
    setPortalIntent(intent);
    try {
      const { url } = await billingActions.openBillingPortal();
      if (!url) throw new Error('Billing portal URL is missing.');
      window.location.href = url;
    } catch (error) {
      emit('custom.message', {
        title: 'Billing',
        message: sanitizeUiText(error instanceof Error ? error.message : 'Could not open billing portal.'),
        severity: 'error',
        category: 'activity',
        dedupeKey: `billing-portal-${intent}-failed`,
      });
    } finally {
      setPortalIntent(null);
    }
  }, [billingActions, emit]);

  const handleSendSupport = useCallback(async () => {
    const text = supportText.trim();
    if (!text) return;
    setIsSendingSupport(true);
    try {
      await postSupportMessage({ text }, baseUrl);
      setSupportText('');
      await loadSupportData(false);
      setActiveTab('support');
      emit('support.message.sent', {
        title: 'Support',
        message: 'Support request sent.',
        dedupeKey: 'account-support-sent',
      });
    } catch (error) {
      emit('support.message.failed', {
        title: 'Support',
        message: sanitizeUiText(error instanceof Error ? error.message : 'Support request failed.'),
        dedupeKey: 'account-support-failed',
      });
    } finally {
      setIsSendingSupport(false);
    }
  }, [baseUrl, emit, loadSupportData, supportText]);

  const handleMarkUnresolved = useCallback(async (conversationId: string) => {
    try {
      await markSupportConversationUnresolved(conversationId, baseUrl);
      setHighlightedConversationId(conversationId);
      await loadSupportData(false);
      emit('support.conversation.unresolved', {
        title: 'Support',
        message: 'Conversation escalated back to support.',
        dedupeKey: `support-unresolved-${conversationId}`,
        channel: 'inbox',
      });
    } catch (error) {
      emit('custom.message', {
        title: 'Support',
        message: sanitizeUiText(error instanceof Error ? error.message : 'Could not update support conversation.'),
        severity: 'error',
        category: 'activity',
        dedupeKey: `support-unresolved-${conversationId}-failed`,
      });
    }
  }, [baseUrl, emit, loadSupportData]);

  const summary = useMemo(
    () => buildFallbackBillingSummary(user, stats, accountProfile, accountEntitlements, billingSummary),
    [accountEntitlements, accountProfile, billingSummary, stats, user]
  );

  const planName = summary.plan.name;
  const isPaidPlan = summary.plan.key !== 'free';
  const monthlyUsed = Math.max(0, Number(stats.vfUsage.monthly.totalVf || 0));
  const monthlyLimit = Number(summary.plan.monthlyVfLimit || 0);
  const monthlyRemaining = hasUnlimitedAccess ? Number.POSITIVE_INFINITY : Math.max(0, monthlyLimit - monthlyUsed);
  const availableBalance = hasUnlimitedAccess
    ? Number.POSITIVE_INFINITY
    : Math.max(0, Number(stats.wallet?.monthlyFreeRemaining || 0) + Number(stats.wallet?.paidVfBalance || 0));
  const paymentMethodLabel = describePaymentMethod(summary);
  const memberSinceLabel = accountProfile?.createdAt ? formatDate(accountProfile.createdAt) : 'Unavailable';
  const canManageBilling = Boolean(summary.billing.hasPortalAccess);
  const billingActionVisibility = useMemo(() => getBillingActionVisibility(summary), [summary]);
  const providerLabels = Array.isArray(user.providers) ? user.providers.filter(Boolean) : [];
  const providerSummary = providerLabels.length > 0 ? providerLabels.map(formatProviderLabel).join(', ') : 'Email';
  const refreshLabel = isRefreshing ? 'Refreshing...' : 'Refresh account';
  const usageTone: 'success' | 'warning' | 'neutral' = hasUnlimitedAccess
    ? 'success'
    : monthlyLimit > 0 && monthlyRemaining <= monthlyLimit * 0.15
      ? 'warning'
      : 'success';
  const activeThemeLabel = themeChoice === 'system' ? 'System' : themeChoice === 'dark' ? 'Dark' : 'Light';
  const totalPreferenceCount = isAdmin ? 7 : 6;
  const enabledPreferenceCount = [
    prefs.allowTips,
    prefs.allowSystemInfo,
    prefs.playSound,
    prefs.emailAsyncJobs,
    prefs.emailBilling,
    prefs.emailSupport,
    isAdmin ? prefs.emailAdminAlerts : undefined,
  ].filter(Boolean).length;
  const invoices = summary.invoices || [];
  const visibleInvoices = showAllInvoices ? invoices : invoices.slice(0, 4);
  const recentActivity = history.slice(0, 8);
  const userDisplayName = accountProfile?.displayName || user.name || 'VoiceFlow user';
  const userEmail = accountProfile?.email || user.email || 'Email unavailable';
  const accountStatus = humanizeToken(accountProfile?.status || summary.profile.status || '', 'Active');
  const recurringBenefit = Math.max(0, Number(summary.plan.pricing.discountPercent || 0));
  const ttsSuccessRpm = Math.max(1, Number(summary.plan.ttsSuccessRpm || (summary.plan.key === 'scale' ? 10 : 5)));
  const statsAllowedEngines = stats.limits?.allowedEngines;
  const allowedEngines = useMemo(
    () => (summary.plan.allowedEngines.length > 0
      ? summary.plan.allowedEngines
      : Array.isArray(statsAllowedEngines)
        ? statsAllowedEngines
        : []),
    [statsAllowedEngines, summary.plan.allowedEngines]
  );
  const allowedEngineSummary = allowedEngines.length > 0
    ? allowedEngines.map((engine) => getEngineDisplayName(engine)).join(', ')
    : 'Awaiting entitlement sync';
  const engineRateRows = useMemo(() => {
    const configuredRates = accountEntitlements?.limits?.vfRates || {} as AccountEntitlements['limits']['vfRates'];
    return ENGINE_RATE_ORDER.map((engine) => {
      const rate = Number(configuredRates[engine] || 0);
      return {
        engine,
        rate,
        isAllowed: allowedEngines.includes(engine),
        usageLabel: rate > 0 ? `${formatNumber(Math.round(rate * 1000))} VF / 1,000 chars` : 'Awaiting rate sync',
      };
    });
  }, [accountEntitlements?.limits?.vfRates, allowedEngines]);
  const renewalHeadline = !isPaidPlan
    ? 'Free plan'
    : summary.subscription.cancelAtPeriodEnd
      ? summary.subscription.currentPeriodEnd
        ? `Ends ${formatDate(summary.subscription.currentPeriodEnd)}`
        : 'Cancellation scheduled'
      : summary.subscription.nextBillingAt
        ? `Renews ${formatDate(summary.subscription.nextBillingAt)}`
        : summary.subscription.currentPeriodEnd
          ? `Active through ${formatDate(summary.subscription.currentPeriodEnd)}`
          : summary.subscription.active
            ? 'Recurring active'
            : 'Billing inactive';
  const renewalDetail = !isPaidPlan
    ? 'Upgrade to unlock recurring billing, invoices, and larger production limits.'
    : summary.subscription.cancelAtPeriodEnd
      ? 'Your plan remains active until the current billing period ends.'
      : summary.subscription.nextBillingAt
        ? `Recurring billing is scheduled for ${formatDateTime(summary.subscription.nextBillingAt)}.`
        : 'The billing backend has not returned the next renewal timestamp yet.';
  const activeSupportConversationCount = supportConversations.filter(
    (row) => ['open', 'needs_human'].includes(String(row.status || '').trim().toLowerCase())
  ).length;
  const supportSummaryText = !loadedTabs.has('support')
    ? 'Open Support to load your conversation queue.'
    : isLoadingSupport
      ? 'Loading support conversations...'
      : supportConversations.length > 0
        ? activeSupportConversationCount > 0
          ? `${activeSupportConversationCount} active conversation${activeSupportConversationCount === 1 ? '' : 's'}`
          : 'All conversations currently resolved.'
        : 'No support conversations yet.';
  const navItems = useMemo(() => ([
    { key: 'account' as AccountTabKey, label: 'Account', summary: `${planName} plan | Member since ${memberSinceLabel}` },
    { key: 'billing' as AccountTabKey, label: 'Billing', summary: canManageBilling ? `${paymentMethodLabel} | ${renewalHeadline}` : 'Portal and invoice management stay here.' },
    { key: 'usage' as AccountTabKey, label: 'Usage', summary: hasUnlimitedAccess ? `Unlimited access | ${formatNumber(monthlyUsed)} VF used this month` : `${formatNumber(monthlyUsed)} of ${formatNumber(monthlyLimit)} VF used this month` },
    { key: 'preferences' as AccountTabKey, label: 'Preferences', summary: `${activeThemeLabel} theme | ${enabledPreferenceCount}/${totalPreferenceCount} toggles enabled` },
    { key: 'support' as AccountTabKey, label: 'Support', summary: supportSummaryText },
  ]), [
    activeThemeLabel,
    canManageBilling,
    enabledPreferenceCount,
    hasUnlimitedAccess,
    memberSinceLabel,
    monthlyLimit,
    monthlyUsed,
    paymentMethodLabel,
    planName,
    renewalHeadline,
    supportSummaryText,
    totalPreferenceCount,
  ]);

  const setTab = (tab: AccountTabKey): void => {
    setActiveTab(tab);
    if (!shouldKeepConversationSelection(tab)) setHighlightedConversationId('');
  };

  const accountTabItems = useMemo(() => navItems.map((item) => ({ id: item.key })), [navItems]);
  const accountSectionTabs = useManagedTabs({
    items: accountTabItems,
    activeId: activeTab,
    onChange: setTab,
    label: 'Account sections',
    idBase: 'account-sections',
  });
  const sectionHeader = ACCOUNT_TAB_META[activeTab];

  const renderTabRail = () => (
    <div
      {...accountSectionTabs.listProps}
      className={`shrink-0 rounded-[0.95rem] border p-0.5 sm:p-1 ${surfaceClass(isDarkUi)}`}
    >
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2 xl:grid-cols-5">
        {navItems.map((item) => {
          const isActive = item.key === activeTab;
          return (
            <button
              key={item.key}
              type="button"
              {...accountSectionTabs.getTabProps(item.key)}
              className={`inline-flex w-full items-center justify-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold transition sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-xs ${
                isActive
                  ? (isDarkUi ? 'border-cyan-300/40 bg-cyan-400/14 text-white' : 'border-cyan-300 bg-cyan-50 text-cyan-900')
                  : `${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`
              }`}
            >
              {ACCOUNT_TAB_ICONS[item.key]}
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderAccountSection = () => (
    <div className={`rounded-[1.2rem] border p-3 sm:p-4 ${cardInsetClass(isDarkUi)}`}>
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        <InfoRow isDarkUi={isDarkUi} label={ACCOUNT_DETAIL_LABELS.displayName} value={userDisplayName} />
        <InfoRow isDarkUi={isDarkUi} label={ACCOUNT_DETAIL_LABELS.email} value={userEmail} />
        <InfoRow isDarkUi={isDarkUi} label={ACCOUNT_DETAIL_LABELS.userId} value={accountProfile?.userId || user.userId || 'Pending'} />
        <InfoRow isDarkUi={isDarkUi} label={ACCOUNT_DETAIL_LABELS.accountStatus} value={accountStatus} />
        <InfoRow isDarkUi={isDarkUi} label={ACCOUNT_DETAIL_LABELS.authProviders} value={providerSummary} />
        <InfoRow isDarkUi={isDarkUi} label={ACCOUNT_DETAIL_LABELS.memberSince} value={memberSinceLabel} />
        <InfoRow isDarkUi={isDarkUi} label="TTS success limit" value={`${formatNumber(ttsSuccessRpm)} RPM`} />
      </div>
    </div>
  );

  const renderBillingSection = () => (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex flex-wrap gap-2 sm:gap-3">
        {billingActionVisibility.showChangePlan ? (
          <button
            type="button"
            onClick={() => setShowSubscriptionModal(true)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition sm:px-4 sm:py-2 sm:text-sm ${
              isDarkUi ? 'border-cyan-300/25 bg-cyan-400/12 text-cyan-50 hover:bg-cyan-400/18' : 'border-cyan-200 bg-cyan-50 text-cyan-900 hover:bg-cyan-100'
            }`}
          >
            Change plan
          </button>
        ) : null}
        {billingActionVisibility.showOpenBillingPortal ? (
          <button
            type="button"
            onClick={() => void handleOpenPortal('manage')}
            disabled={portalIntent !== null}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 sm:px-4 sm:py-2 sm:text-sm ${
              isDarkUi ? 'border-white/10 bg-white/[0.06] text-slate-100 hover:bg-white/[0.08]' : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'
            }`}
          >
            {portalIntent === 'manage' ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:h-4 sm:w-4" /> : <ExternalLink className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
            Open billing portal
          </button>
        ) : null}
        {billingActionVisibility.showCancelRecurring ? (
          <button
            type="button"
            onClick={() => setIsCancelDialogOpen(true)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition sm:px-4 sm:py-2 sm:text-sm ${
              isDarkUi ? 'border-rose-300/20 bg-rose-400/10 text-rose-50 hover:bg-rose-400/18' : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
            }`}
          >
            Cancel recurring
          </button>
        ) : null}
      </div>
      <div className="grid gap-3 sm:gap-4 xl:grid-cols-[0.92fr_1.08fr]">
        <div className={`rounded-[1.2rem] border p-3 sm:p-4 ${cardInsetClass(isDarkUi)}`}>
          <div className="grid gap-2.5 sm:grid-cols-2 sm:gap-3">
            <InfoRow isDarkUi={isDarkUi} label="Plan" value={planName} />
            <InfoRow isDarkUi={isDarkUi} label="Plan status" value={humanizeToken(summary.subscription.status || summary.plan.status || 'inactive')} />
            <InfoRow isDarkUi={isDarkUi} label="Renewal" value={renewalHeadline} />
            <InfoRow isDarkUi={isDarkUi} label="Recurring rate" value={isPaidPlan ? formatCurrencyInr(summary.plan.pricing.recurringInr || 0) : 'Free'} />
            <InfoRow isDarkUi={isDarkUi} label="Current period" value={summary.subscription.currentPeriodStart || summary.subscription.currentPeriodEnd ? `${formatDate(summary.subscription.currentPeriodStart)} to ${formatDate(summary.subscription.currentPeriodEnd)}` : 'Unavailable'} />
            <InfoRow isDarkUi={isDarkUi} label="Allowed engines" value={allowedEngineSummary} />
          </div>
        </div>

        <div className={`rounded-[1.2rem] border p-3 sm:p-4 ${cardInsetClass(isDarkUi)}`}>
          <div className={labelClass(isDarkUi)}>Payment method</div>
          <div className={`mt-1.5 text-base font-semibold sm:mt-2 sm:text-lg ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{paymentMethodLabel}</div>
          <div className={`mt-1 text-xs sm:text-sm ${subduedClass(isDarkUi)}`}>
            {summary.paymentMethod?.expMonth && summary.paymentMethod?.expYear
              ? `Expires ${String(summary.paymentMethod.expMonth).padStart(2, '0')}/${summary.paymentMethod.expYear}`
              : canManageBilling
                ? 'Manage the default payment method from the billing portal.'
                : 'No live billing portal session is available yet.'}
          </div>
          <div className="mt-3 grid gap-2.5 sm:mt-4 sm:grid-cols-2 sm:gap-3">
            <InfoRow isDarkUi={isDarkUi} label="Billing country" value={summary.billing.billingCountry || 'Unavailable'} />
            <InfoRow isDarkUi={isDarkUi} label="Currency mode" value={summary.billing.currencyMode || 'Unavailable'} />
          </div>
          <div className={`mt-3 rounded-[1rem] border px-3 py-2.5 text-xs sm:mt-4 sm:px-4 sm:py-3 sm:text-sm ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}>
            {recurringBenefit > 0 ? `${recurringBenefit}% recurring benefit is locked in on ${planName}.` : 'Recurring discounts are not currently available for this plan.'}
          </div>
        </div>
      </div>

      <div className={`rounded-[1.2rem] border p-3 sm:p-4 ${cardInsetClass(isDarkUi)}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className={labelClass(isDarkUi)}>Invoices</div>
            <div className={`mt-1.5 text-base font-semibold sm:mt-2 sm:text-lg ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>Invoices and receipts</div>
          </div>
          {invoices.length > 4 ? (
            <button
              type="button"
              onClick={() => setShowAllInvoices((prev) => !prev)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}
            >
              {showAllInvoices ? 'Show recent 4' : `Show all ${invoices.length}`}
            </button>
          ) : null}
        </div>
        {visibleInvoices.length === 0 ? (
          <div className={`mt-3 rounded-[1rem] border px-3 py-3 text-xs sm:mt-4 sm:px-4 sm:py-4 sm:text-sm ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}>
            No invoices are synced yet. Stripe receipts appear here after billing activity posts.
          </div>
        ) : (
          <div className="mt-3 space-y-2 sm:mt-4">
            {visibleInvoices.map((invoice) => (
              <div key={invoice.id} className={`rounded-[1rem] border px-3 py-2.5 sm:px-4 sm:py-3 ${cardInsetClass(isDarkUi)}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className={`truncate text-[13px] font-semibold sm:text-sm ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>
                      {sanitizeUiText(invoice.description || invoice.number || invoice.id)}
                    </div>
                    <div className={`mt-1 text-xs ${subduedClass(isDarkUi)}`}>
                      Created {formatDateTime(invoice.createdAt)}
                      {invoice.paidAt ? ` | Paid ${formatDateTime(invoice.paidAt)}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge isDarkUi={isDarkUi} tone={invoice.status === 'paid' ? 'success' : invoice.status === 'open' ? 'warning' : 'neutral'} label={humanizeToken(invoice.status)} />
                    <span className={`text-xs font-semibold sm:text-sm ${isDarkUi ? 'text-cyan-100' : 'text-cyan-900'}`}>
                      {formatCurrencyMinor(invoice.amountPaidMinor || invoice.amountDueMinor, invoice.currency)}
                    </span>
                    {invoice.hostedInvoiceUrl ? (
                      <a
                        href={invoice.hostedInvoiceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}
                      >
                        Open
                        <ExternalLink size={12} />
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderUsageSection = () => (
    <div className="space-y-3 sm:space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-3">
        <MetricCard isDarkUi={isDarkUi} icon={SUMMARY_ICONS.balance} eyebrow="Monthly used" title={`${formatNumber(monthlyUsed)} VF`} detail={hasUnlimitedAccess ? 'Unlimited access is active.' : `${formatNumber(monthlyLimit)} VF monthly cap.`} />
        <MetricCard isDarkUi={isDarkUi} icon={SUMMARY_ICONS.spendable} eyebrow="Spendable now" title={formatVfValue(availableBalance)} detail={`${formatNumber(stats.wallet?.monthlyFreeRemaining || 0)} free VF available right now.`} />
        <MetricCard isDarkUi={isDarkUi} icon={SUMMARY_ICONS.currentPlan} eyebrow="Max chars" title={formatCompactNumber(summary.plan.maxCharsPerGeneration || stats.limits?.maxCharsPerGeneration || 0)} detail="Maximum characters allowed per generation request." />
      </div>

      <div className="grid gap-3 sm:gap-4 xl:grid-cols-3">
        <WindowCard title="Daily" data={stats.vfUsage.daily} isDarkUi={isDarkUi} />
        <WindowCard title="Monthly" data={stats.vfUsage.monthly} isDarkUi={isDarkUi} />
        <WindowCard title="Lifetime" data={stats.vfUsage.lifetime} isDarkUi={isDarkUi} />
      </div>

      <div className="grid gap-2.5 sm:gap-4">
        <div className={`rounded-[1.2rem] border p-2.5 sm:p-4 ${cardInsetClass(isDarkUi)}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className={labelClass(isDarkUi)}>Engine pricing</div>
              <div className={`mt-1 text-[15px] font-semibold sm:mt-2 sm:text-lg ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>VF rate per character</div>
              <div className={`mt-0.5 text-[11px] leading-5 sm:mt-1 sm:text-sm ${subduedClass(isDarkUi)}`}>
                Characters are billed by engine rate. Your plan changes engine access and queue priority, not the base VF pricing.
              </div>
            </div>
            <div className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold sm:px-3 sm:py-1 sm:text-[11px] ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}>
              {allowedEngines.length > 0 ? `${allowedEngines.length}/${engineRateRows.length} engines unlocked` : 'Waiting for plan sync'}
            </div>
          </div>

          <div className="mt-2.5 space-y-2 sm:mt-4 sm:space-y-3">
            {engineRateRows.map((row) => (
              <div key={row.engine} className={`rounded-[1rem] border px-2.5 py-2 sm:px-4 sm:py-3 ${cardInsetClass(isDarkUi)}`}>
                <div className="flex flex-col gap-2 sm:gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="origin-left scale-90 sm:scale-100">
                        <EngineLogo engine={row.engine} size="sm" variant="ringed" />
                      </div>
                      <div className="min-w-0">
                        <div className={`text-[12px] font-semibold sm:text-sm ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>
                          {getEngineDisplayName(row.engine)}
                        </div>
                        <div className={`mt-0.5 text-[10px] sm:mt-1 sm:text-xs ${subduedClass(isDarkUi)}`}>
                          {row.usageLabel}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 sm:gap-2 lg:min-w-[300px]">
                    <div className={`rounded-[0.9rem] border px-2.5 py-1.5 sm:px-3 sm:py-2 ${cardInsetClass(isDarkUi)}`}>
                      <div className={labelClass(isDarkUi)}>Exact rate</div>
                      <div className={`mt-0.5 text-[12px] font-semibold sm:mt-1.5 sm:text-sm ${isDarkUi ? 'text-cyan-100' : 'text-cyan-900'}`}>
                        {formatVfRatePerCharacter(row.rate)}
                      </div>
                    </div>
                    <div className={`rounded-[0.9rem] border px-2.5 py-1.5 sm:px-3 sm:py-2 ${cardInsetClass(isDarkUi)}`}>
                      <div className={labelClass(isDarkUi)}>Inverse view</div>
                      <div className={`mt-0.5 text-[12px] font-semibold sm:mt-1.5 sm:text-sm ${isDarkUi ? 'text-cyan-100' : 'text-cyan-900'}`}>
                        {formatCharsPerVf(row.rate)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:mt-3 sm:gap-2">
                  <StatusBadge
                    isDarkUi={isDarkUi}
                    tone={row.isAllowed ? 'success' : 'warning'}
                    label={row.isAllowed ? 'Available on current plan' : 'Upgrade required'}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const renderPreferencesSection = () => (
    <div className="grid gap-3 sm:gap-4 xl:grid-cols-[0.78fr_1.22fr]">
      <div className={`rounded-[1.2rem] border p-3 sm:p-4 ${cardInsetClass(isDarkUi)}`}>
        <div className={labelClass(isDarkUi)}>Theme</div>
        <div className={`mt-1.5 text-base font-semibold sm:mt-2 sm:text-lg ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>Appearance mode</div>
        <div className={`mt-1 text-xs sm:text-sm ${subduedClass(isDarkUi)}`}>Choose how the account center should render in light and dark environments.</div>
        <div className="mt-3 grid gap-2.5 sm:mt-4 sm:grid-cols-3 sm:gap-3 xl:grid-cols-1">
          <ThemeButton active={themeChoice === 'light'} isDarkUi={isDarkUi} icon={SUMMARY_ICONS.light} title="Light" onClick={() => setThemeChoice('light')} />
          <ThemeButton active={themeChoice === 'dark'} isDarkUi={isDarkUi} icon={SUMMARY_ICONS.dark} title="Dark" onClick={() => setThemeChoice('dark')} />
          <ThemeButton active={themeChoice === 'system'} isDarkUi={isDarkUi} icon={SUMMARY_ICONS.preferences} title="System" onClick={() => setThemeChoice('system')} />
        </div>
      </div>

      <div className={`rounded-[1.2rem] border p-3 sm:p-4 ${cardInsetClass(isDarkUi)}`}>
        <div className={labelClass(isDarkUi)}>Notifications</div>
        <div className={`mt-1.5 text-base font-semibold sm:mt-2 sm:text-lg ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>Inbox and email preferences</div>
        <div className={`mt-1 text-xs sm:text-sm ${subduedClass(isDarkUi)}`}>Critical warnings remain enabled. These toggles control helpful prompts and email delivery.</div>
        <div className="mt-3 grid gap-2.5 sm:mt-4 sm:gap-3 lg:grid-cols-2">
          <PreferenceToggle isDarkUi={isDarkUi} title="Tips" detail="Allow helpful prompts and educational hints." checked={prefs.allowTips} onToggle={() => setPrefs((prev) => ({ ...prev, allowTips: !prev.allowTips }))} />
          <PreferenceToggle isDarkUi={isDarkUi} title="System info" detail="Show runtime and backend notices." checked={prefs.allowSystemInfo} onToggle={() => setPrefs((prev) => ({ ...prev, allowSystemInfo: !prev.allowSystemInfo }))} />
          <PreferenceToggle isDarkUi={isDarkUi} title="Notification sound" detail="Play a tone for warning, error, and critical alerts." checked={prefs.playSound} onToggle={() => setPrefs((prev) => ({ ...prev, playSound: !prev.playSound }))} />
          <PreferenceToggle isDarkUi={isDarkUi} title="Email async jobs" detail="Email queued TTS and dubbing job updates." checked={prefs.emailAsyncJobs} onToggle={() => setPrefs((prev) => ({ ...prev, emailAsyncJobs: !prev.emailAsyncJobs }))} />
          <PreferenceToggle isDarkUi={isDarkUi} title="Email billing" detail="Email quota, receipt, and balance notifications." checked={prefs.emailBilling} onToggle={() => setPrefs((prev) => ({ ...prev, emailBilling: !prev.emailBilling }))} />
          <PreferenceToggle isDarkUi={isDarkUi} title="Email support" detail="Email support replies and resolution updates." checked={prefs.emailSupport} onToggle={() => setPrefs((prev) => ({ ...prev, emailSupport: !prev.emailSupport }))} />
          {isAdmin ? <PreferenceToggle isDarkUi={isDarkUi} title="Email admin alerts" detail="Operator notices and admin escalations." checked={prefs.emailAdminAlerts} onToggle={() => setPrefs((prev) => ({ ...prev, emailAdminAlerts: !prev.emailAdminAlerts }))} /> : null}
        </div>
      </div>
    </div>
  );

  const renderSupportSection = () => (
    <div className="grid gap-3 sm:gap-4 xl:grid-cols-[0.92fr_1.08fr]">
      <div className={`rounded-[1.2rem] border p-3 sm:p-4 ${cardInsetClass(isDarkUi)}`}>
        <div className={labelClass(isDarkUi)}>Compose request</div>
        <div className={`mt-1.5 text-base font-semibold sm:mt-2 sm:text-lg ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>Send a support message</div>
        <div className={`mt-1 text-xs sm:text-sm ${subduedClass(isDarkUi)}`}>Use this for billing questions, account issues, or anything that needs a human follow-up.</div>
        <textarea
          value={supportText}
          onChange={(event) => setSupportText(event.target.value)}
          placeholder="Describe the issue, expected outcome, and anything already tried."
          className={`mt-3 min-h-[120px] w-full rounded-[1rem] border px-3 py-2.5 text-[13px] outline-none transition sm:mt-4 sm:min-h-[148px] sm:rounded-[1.1rem] sm:px-4 sm:py-3 sm:text-sm ${
            isDarkUi
              ? 'border-white/10 bg-slate-950/40 text-white placeholder:text-slate-500 focus:border-cyan-300/45'
              : 'border-slate-200 bg-white text-slate-950 placeholder:text-slate-400 focus:border-cyan-300'
          }`}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 sm:mt-4 sm:gap-3">
          <div className={`text-xs ${subduedClass(isDarkUi)}`}>Recent conversations refresh after each message.</div>
          <button
            type="button"
            onClick={() => void handleSendSupport()}
            disabled={isSendingSupport || supportText.trim().length === 0}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 sm:px-4 sm:py-2 sm:text-sm ${
              isDarkUi ? 'border-cyan-300/25 bg-cyan-400/12 text-cyan-50 hover:bg-cyan-400/18' : 'border-cyan-200 bg-cyan-50 text-cyan-900 hover:bg-cyan-100'
            }`}
          >
            {isSendingSupport ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:h-4 sm:w-4" /> : SUMMARY_ICONS.support}
            Send request
          </button>
        </div>
      </div>

      <div className={`rounded-[1.2rem] border p-3 sm:p-4 ${cardInsetClass(isDarkUi)}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className={labelClass(isDarkUi)}>Recent conversations</div>
            <div className={`mt-1.5 text-base font-semibold sm:mt-2 sm:text-lg ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>Support timeline</div>
          </div>
          {isLoadingSupport ? <Loader2 className={`h-4 w-4 animate-spin sm:h-[18px] sm:w-[18px] ${isDarkUi ? 'text-cyan-200' : 'text-cyan-800'}`} /> : null}
        </div>
        {isLoadingSupport && supportConversations.length === 0 ? (
          <div className={`mt-3 rounded-[1rem] border px-3 py-3 text-xs sm:mt-4 sm:px-4 sm:py-4 sm:text-sm ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}>
            Syncing support conversations...
          </div>
        ) : supportConversations.length === 0 ? (
          <div className={`mt-3 rounded-[1rem] border px-3 py-3 text-xs sm:mt-4 sm:px-4 sm:py-4 sm:text-sm ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}>
            No support conversations yet.
          </div>
        ) : (
          <div className="mt-3 space-y-2.5 sm:mt-4 sm:space-y-3">
            {supportConversations.map((conversation) => {
              const isHighlighted = highlightedConversationId === conversation.conversationId;
              const canReopen = !['open', 'needs_human'].includes(String(conversation.status || '').trim().toLowerCase());
              const lastUpdated = conversation.lastMessageAt || conversation.updatedAt;
              return (
                <div
                  key={conversation.conversationId}
                  ref={(node) => {
                    conversationRefs.current[conversation.conversationId] = node;
                  }}
                  className={`rounded-[1rem] border px-3 py-3 sm:px-4 sm:py-4 transition ${
                    isHighlighted
                      ? (isDarkUi ? 'border-cyan-300/40 bg-cyan-400/10' : 'border-cyan-300 bg-cyan-50/70')
                      : cardInsetClass(isDarkUi)
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setHighlightedConversationId(conversation.conversationId)}
                        className={`text-left text-[13px] font-semibold sm:text-sm ${isDarkUi ? 'text-white' : 'text-slate-950'}`}
                      >
                        Conversation {conversation.conversationId.slice(0, 8)}
                      </button>
                      <div className={`mt-1 text-xs ${subduedClass(isDarkUi)}`}>
                        Last updated {formatDateTime(lastUpdated)}
                        {conversation.assignedTo ? ` | Assigned to ${sanitizeUiText(conversation.assignedTo)}` : ''}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge isDarkUi={isDarkUi} tone={statusToneFromConversation(conversation.status)} label={humanizeToken(conversation.status, 'Open')} />
                      <StatusBadge isDarkUi={isDarkUi} tone={statusToneFromPriority(conversation.priority)} label={humanizeToken(conversation.priority, 'Normal')} />
                    </div>
                  </div>
                  {canReopen ? (
                    <button
                      type="button"
                      onClick={() => void handleMarkUnresolved(conversation.conversationId)}
                      className={`mt-2.5 inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold sm:mt-3 sm:px-3 sm:py-1.5 sm:text-xs ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}
                    >
                      Reopen with support
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const renderActivitySection = () => (
    <div className="space-y-2.5 sm:space-y-3">
      {isLoadingActivity && recentActivity.length === 0 ? (
        <div className={`rounded-[1rem] border px-3 py-3 text-xs sm:px-4 sm:py-4 sm:text-sm ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}>
          Syncing recent generation history...
        </div>
      ) : recentActivity.length === 0 ? (
        <div className={`rounded-[1rem] border px-3 py-3 text-xs sm:px-4 sm:py-4 sm:text-sm ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}>
          No generation history yet.
        </div>
      ) : (
        recentActivity.map((item) => {
          const historyEngine = normalizeHistoryEngine(item.engine);
          const voiceLabel = sanitizeUiText(resolveHistoryVoiceLabel(item));
          const charCount = Math.max(0, Number(item.chars || (item.text || '').length || 0));
          const preview = sanitizeUiText(String(item.text || '').replace(/\s+/g, ' ').trim()) || 'No preview available.';
          return (
            <div key={item.id} className={`rounded-[1rem] border px-3 py-3 sm:px-4 sm:py-4 ${cardInsetClass(isDarkUi)}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className={`text-[13px] font-semibold sm:text-sm ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{voiceLabel}</div>
                  <div className={`mt-1 text-xs ${subduedClass(isDarkUi)}`}>
                    {renderHistoryTimestamp(Number(item.timestamp || Date.now()))}
                    {' | '}
                    {getEngineDisplayName(historyEngine)}
                    {' | '}
                    {formatNumber(charCount)} chars
                  </div>
                </div>
                <StatusBadge isDarkUi={isDarkUi} tone={item.status === 'failed' ? 'warning' : 'success'} label={humanizeToken(item.status || 'completed')} />
              </div>
              <div className={`mt-2.5 line-clamp-3 text-[13px] leading-5 sm:mt-3 sm:text-sm sm:leading-6 ${mutedClass(isDarkUi)}`}>{preview}</div>
            </div>
          );
        })
      )}
    </div>
  );

  const renderActiveSection = () => {
    if (isLoadingCore && EAGER_ACCOUNT_TABS.includes(activeTab)) {
      return (
        <div className={`rounded-[1.2rem] border px-3 py-4 text-xs sm:px-4 sm:py-6 sm:text-sm ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}>
          Syncing account details...
        </div>
      );
    }

    if (activeTab === 'account') return renderAccountSection();
    if (activeTab === 'billing') return renderBillingSection();
    if (activeTab === 'usage') return renderUsageSection();
    if (activeTab === 'preferences') return renderPreferencesSection();
    if (activeTab === 'support') return renderSupportSection();
    return renderActivitySection();
  };

  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-transparent px-2.5 py-3 sm:px-6 sm:py-6">
      <div
        className={`pointer-events-none fixed inset-0 ${
          isDarkUi
            ? 'bg-[radial-gradient(92%_78%_at_0%_0%,rgba(34,211,238,0.14),transparent_52%),radial-gradient(80%_74%_at_100%_12%,rgba(251,191,36,0.11),transparent_56%),radial-gradient(84%_72%_at_50%_100%,rgba(244,114,182,0.1),transparent_58%),linear-gradient(180deg,#020617_0%,#071220_44%,#050b14_100%)]'
            : 'bg-[radial-gradient(88%_72%_at_0%_0%,rgba(34,211,238,0.14),transparent_50%),radial-gradient(82%_76%_at_100%_12%,rgba(251,191,36,0.12),transparent_54%),radial-gradient(80%_74%_at_50%_100%,rgba(244,114,182,0.1),transparent_58%),linear-gradient(180deg,#eef8ff_0%,#f8fbff_45%,#fffaf4_100%)]'
        }`}
      />

      <div className="relative mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-2.5 sm:gap-4">
        <section className={`shrink-0 rounded-[1.45rem] border p-2.5 sm:p-4 ${surfaceClass(isDarkUi)}`}>
          <div className="flex flex-col gap-2.5 sm:gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setScreenSearchState('main');
                  setScreen(AppScreen.MAIN);
                }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition sm:gap-2 sm:px-3 sm:py-2 sm:text-sm ${
                  isDarkUi ? 'border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08]' : 'border-slate-200 bg-white/80 text-slate-800 hover:bg-white'
                }`}
              >
                <ArrowLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                Back to workspace
              </button>

              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
                <button
                  type="button"
                  onClick={() => void handleRefresh()}
                  disabled={isRefreshing}
                  className={`inline-flex w-full items-center justify-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition disabled:opacity-60 sm:w-auto sm:gap-2 sm:px-3 sm:py-2 sm:text-sm ${
                    isDarkUi ? 'border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08]' : 'border-slate-200 bg-white/80 text-slate-800 hover:bg-white'
                  }`}
                >
                  {isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:h-4 sm:w-4" /> : <RefreshCcw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
                  {refreshLabel}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await signOutUser();
                      emit('custom.message', { title: 'Session', message: 'Signed out successfully.', severity: 'success', category: 'security', channel: 'toast' });
                    } catch (error) {
                      emit('custom.message', { title: 'Session', message: sanitizeUiText(error instanceof Error ? error.message : 'Sign out failed.'), severity: 'error', category: 'security', dedupeKey: 'profile-signout-failed' });
                    }
                    setScreenSearchState('login');
                    setScreen(AppScreen.LOGIN);
                  }}
                  className={`inline-flex w-full items-center justify-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition sm:w-auto sm:gap-2 sm:px-3 sm:py-2 sm:text-sm ${
                    isDarkUi ? 'border-rose-300/25 bg-rose-400/12 text-rose-50 hover:bg-rose-400/18' : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                  }`}
                >
                  <LogOut className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  Sign out
                </button>
              </div>
            </div>

            <div className="grid gap-2.5 sm:gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,360px)] lg:items-start">
              <div className="flex items-center lg:min-h-[56px]">
                <div className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 ${cardInsetClass(isDarkUi)}`}>
                  <BrandLogo size="sm" tone={isDarkUi ? 'light' : 'dark'} />
                  <span className={`text-[10px] font-black uppercase tracking-[0.2em] sm:text-[11px] sm:tracking-[0.24em] ${isDarkUi ? 'text-cyan-100' : 'text-cyan-900'}`}>
                    Account Center
                  </span>
                </div>
              </div>

              <div className={`flex min-w-0 items-center gap-2 rounded-[1rem] border px-2.5 py-2 sm:px-3 sm:py-2.5 lg:justify-self-end ${cardInsetClass(isDarkUi)}`}>
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-sm font-black sm:h-10 sm:w-10 sm:text-base ${isDarkUi ? 'border-white/10 bg-white/[0.06] text-white' : 'border-slate-200 bg-white text-slate-900'}`}>
                  {user.avatarUrl ? <img src={user.avatarUrl} alt={`${userDisplayName} avatar`} className="h-full w-full rounded-xl object-cover" /> : userDisplayName.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className={`truncate text-[13px] font-semibold sm:text-sm ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{userDisplayName}</div>
                  <div className={`truncate text-[11px] sm:text-xs ${subduedClass(isDarkUi)}`}>{userEmail}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5 sm:mt-1.5">
                    <StatusBadge isDarkUi={isDarkUi} tone={summary.subscription.active ? 'success' : 'neutral'} label={planName} />
                    <StatusBadge isDarkUi={isDarkUi} tone={usageTone} label={hasUnlimitedAccess ? 'Unlimited access' : accountStatus} />
                    {summary.plan.earlyAccess ? <StatusBadge isDarkUi={isDarkUi} tone="warning" label="Early access" /> : null}
                  </div>
                  <div className={`mt-1 text-[10px] sm:mt-1.5 sm:text-[11px] ${subduedClass(isDarkUi)}`}>
                    <span>{hasUnlimitedAccess ? 'Monthly: Unlimited' : `Monthly: ${formatNumber(monthlyUsed)}/${formatNumber(monthlyLimit)}`}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {summary.warnings.length > 0 ? <div className={`shrink-0 rounded-[1.15rem] border px-3 py-2.5 text-xs sm:px-4 sm:py-3 sm:text-sm ${isDarkUi ? 'border-amber-300/20 bg-amber-400/10 text-amber-50' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{sanitizeUiText(summary.warnings[0] || '')}</div> : null}

        {renderTabRail()}

        <div className="min-h-0 flex flex-1">
          <section
            {...accountSectionTabs.getPanelProps(activeTab)}
            className={`min-h-0 flex-1 overflow-hidden rounded-[1.35rem] border p-2.5 sm:p-4 ${surfaceClass(isDarkUi)}`}
          >
            <div className="flex h-full min-h-0 flex-col gap-3 sm:gap-4">
              <div className={`shrink-0 border-b pb-2.5 sm:pb-3 ${isDarkUi ? 'border-white/10' : 'border-slate-200/80'}`}>
                <div className="flex flex-wrap items-start justify-between gap-2.5 sm:gap-3">
                  <div>
                    <div className={labelClass(isDarkUi)}>{sectionHeader.title} section</div>
                    <h2 className={`mt-1 text-base font-semibold sm:text-lg ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{sectionHeader.title}</h2>
                    <p className={`mt-1 text-[11px] leading-5 sm:text-sm sm:leading-6 ${mutedClass(isDarkUi)}`}>{sectionHeader.detail}</p>
                  </div>
                  {activeTab === 'billing' ? (
                    <StatusBadge isDarkUi={isDarkUi} tone={canManageBilling ? 'success' : 'neutral'} label={canManageBilling ? 'Portal ready' : 'Portal unavailable'} />
                  ) : activeTab === 'usage' ? (
                    <StatusBadge isDarkUi={isDarkUi} tone={usageTone} label={hasUnlimitedAccess ? 'Unlimited' : `${formatNumber(monthlyUsed)} VF used`} />
                  ) : activeTab === 'support' ? (
                    <StatusBadge isDarkUi={isDarkUi} tone={activeSupportConversationCount > 0 ? 'warning' : 'neutral'} label={activeSupportConversationCount > 0 ? `${activeSupportConversationCount} active` : 'No active threads'} />
                  ) : activeTab === 'activity' ? (
                    <StatusBadge isDarkUi={isDarkUi} tone={recentActivity.length > 0 ? 'success' : 'neutral'} label={recentActivity.length > 0 ? `${recentActivity.length} recent items` : 'No history'} />
                  ) : (
                    <StatusBadge isDarkUi={isDarkUi} tone="neutral" label={planName} />
                  )}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1">
                {renderActiveSection()}
              </div>
            </div>
          </section>
        </div>
      </div>

      {isCancelDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-md">
          <div className={`w-full max-w-xl rounded-[1.7rem] border p-6 ${surfaceClass(isDarkUi)}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className={labelClass(isDarkUi)}>Recurring plan benefit</p>
                <h2 className={`mt-2 text-2xl font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>
                  Before you cancel, you still have a {recurringBenefit}% recurring benefit on {planName}.
                </h2>
              </div>
              <button type="button" onClick={() => setIsCancelDialogOpen(false)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}>
                Close
              </button>
            </div>

            <div className={`mt-5 rounded-[1.2rem] border p-4 ${cardInsetClass(isDarkUi)}`}>
              <div className={`text-sm font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>
                {planName} renews at {formatCurrencyInr(summary.plan.pricing.recurringInr || 0)} / month
              </div>
              <div className={`mt-2 text-sm leading-6 ${mutedClass(isDarkUi)}`}>
                The current recurring rate reflects your plan benefit versus the first-cycle pricing of {formatCurrencyInr(summary.plan.pricing.firstCycleInr || 0)}. Cancellation itself is completed inside the Stripe billing portal.
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className={`rounded-[1rem] border px-4 py-3 ${isDarkUi ? 'border-emerald-300/15 bg-emerald-400/10 text-emerald-50' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <CheckCircle2 size={16} />
                    Keep recurring
                  </div>
                  <div className="mt-2 text-xs">Keep your current recurring benefit and uninterrupted access.</div>
                </div>
                <div className={`rounded-[1rem] border px-4 py-3 ${isDarkUi ? 'border-rose-300/15 bg-rose-400/10 text-rose-50' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
                  <div className="text-sm font-semibold">Continue to cancel</div>
                  <div className="mt-2 text-xs">Cancellation settings will be handled in the billing portal.</div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => setIsCancelDialogOpen(false)} className={`rounded-full border px-4 py-2 text-sm font-semibold ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}>
                Keep my plan
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCancelDialogOpen(false);
                  void handleOpenPortal('cancel');
                }}
                disabled={portalIntent !== null}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold ${isDarkUi ? 'border-rose-300/20 bg-rose-400/12 text-rose-50 hover:bg-rose-400/18' : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'}`}
              >
                {portalIntent === 'cancel' ? <Loader2 size={16} className="animate-spin" /> : null}
                Continue to billing portal
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
