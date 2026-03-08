import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  ExternalLink,
  Headset,
  History,
  Loader2,
  LogOut,
  MessageSquareText,
  MonitorSmartphone,
  Moon,
  Receipt,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Sun,
  Wallet,
} from 'lucide-react';
import { AppScreen, GenerationSettings, VfUsageWindow } from '../../types';
import { BrandLogo } from '../BrandLogo';
import { EngineLogo } from '../EngineLogo';
import { useUser } from '../../contexts/UserContext';
import { useBillingActions } from '../../src/features/billing/hooks/useBillingActions';
import { useNotifications } from '../../src/shared/notifications/NotificationProvider';
import { resolveApiBaseUrl } from '../../src/shared/api/config';
import { STORAGE_KEYS } from '../../src/shared/storage/keys';
import { readStorageJson, readStorageString, writeStorageString } from '../../src/shared/storage/localStore';
import { sanitizeUiText } from '../../src/shared/ui/terminology';
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
} from '../../services/accountService';

type ThemeChoice = 'light' | 'dark' | 'system';
type SectionKey = 'overview' | 'billing' | 'usage' | 'preferences' | 'support' | 'activity';

const DEFAULT_OPEN_SECTIONS: Record<SectionKey, boolean> = {
  overview: true,
  billing: true,
  usage: false,
  preferences: false,
  support: false,
  activity: false,
};

const ENGINE_ORDER: GenerationSettings['engine'][] = ['KOKORO', 'GOOD', 'NEURAL2', 'GEM'];

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
  if (token === 'starter') return 'starter';
  if (token === 'creator') return 'creator';
  if (token === 'pro') return 'pro';
  if (token === 'scale' || token === 'plus' || token === 'pro-plus' || token === 'pro_plus') return 'scale';
  return 'free';
};

const toPlanName = (planKey: 'free' | BillingPlanKey): AccountBillingSummary['plan']['name'] => {
  if (planKey === 'starter') return 'Starter';
  if (planKey === 'creator') return 'Creator';
  if (planKey === 'pro') return 'Pro';
  if (planKey === 'scale') return 'Scale';
  return 'Free';
};

const titleCase = (value: string): string =>
  String(value || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());

const humanizeToken = (value?: string | null, fallback = '-'): string => {
  const token = String(value || '').trim();
  if (!token) return fallback;
  return titleCase(token);
};

const formatProviderLabel = (value: string): string => {
  const token = String(value || '').trim();
  if (!token) return 'Unknown';
  if (token.includes('google')) return 'Google';
  if (token.includes('facebook')) return 'Facebook';
  if (token.includes('phone')) return 'Phone';
  if (token.includes('password')) return 'Email';
  return titleCase(token);
};

const formatNumber = (value: number): string => new Intl.NumberFormat('en-IN').format(Math.max(0, Number(value || 0)));

const formatCompactNumber = (value: number): string =>
  new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.max(0, Number(value || 0)));

const formatCurrencyMinor = (minor: number, currency: string): string => {
  const major = Number(minor || 0) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: String(currency || 'INR').toUpperCase(),
    maximumFractionDigits: 0,
  }).format(major);
};

const formatCurrencyInr = (amount: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.max(0, Number(amount || 0)));

const formatVfValue = (value: number): string => (Number.isFinite(value) ? `${formatNumber(value)} VF` : 'Unlimited');

const formatDate = (value?: string | null, options?: Intl.DateTimeFormatOptions): string => {
  const token = String(value || '').trim();
  if (!token) return '-';
  const parsed = Date.parse(token);
  if (!Number.isFinite(parsed)) return '-';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...options,
  }).format(parsed);
};

const formatDateTime = (value?: string | null): string => formatDate(value, {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const describePaymentMethod = (summary: AccountBillingSummary): string => {
  if (summary.paymentMethod?.brand && summary.paymentMethod?.last4) {
    return `${String(summary.paymentMethod.brand).toUpperCase()} ending in ${summary.paymentMethod.last4}`;
  }
  if (summary.billing.hasPortalAccess) return 'Payment method stored in Stripe Billing';
  return 'No payment method on file';
};

const surfaceClass = (isDarkUi: boolean): string =>
  isDarkUi
    ? 'border-white/10 bg-[linear-gradient(180deg,rgba(10,15,27,0.86),rgba(8,13,24,0.74))] shadow-[0_24px_64px_rgba(2,6,23,0.48)]'
    : 'border-slate-200/90 bg-white/88 shadow-[0_24px_56px_rgba(15,23,42,0.08)]';

const mutedClass = (isDarkUi: boolean): string => (isDarkUi ? 'text-slate-300' : 'text-slate-600');

const subduedClass = (isDarkUi: boolean): string => (isDarkUi ? 'text-slate-400' : 'text-slate-500');

const labelClass = (isDarkUi: boolean): string =>
  isDarkUi ? 'text-[11px] font-black uppercase tracking-[0.22em] text-slate-500' : 'text-[11px] font-black uppercase tracking-[0.22em] text-slate-400';

const cardInsetClass = (isDarkUi: boolean): string =>
  isDarkUi ? 'border-white/10 bg-white/[0.04]' : 'border-slate-200/90 bg-slate-50/90';

const statusToneFromPriority = (priority?: string): 'success' | 'warning' | 'neutral' => {
  const token = String(priority || '').trim().toLowerCase();
  if (token === 'green') return 'success';
  if (token === 'yellow' || token === 'red') return 'warning';
  return 'neutral';
};

const statusToneFromConversation = (status?: string): 'success' | 'warning' | 'neutral' => {
  const token = String(status || '').trim().toLowerCase();
  if (token === 'resolved') return 'success';
  if (token === 'ai_answered' || token === 'needs_human') return 'warning';
  return 'neutral';
};

const WindowCard: React.FC<{ title: string; data: VfUsageWindow; isDarkUi: boolean }> = ({ title, data, isDarkUi }) => (
  <div className={`rounded-[1.35rem] border p-4 ${surfaceClass(isDarkUi)}`}>
    <div className="mb-4 flex items-center justify-between gap-3">
      <div>
        <p className={labelClass(isDarkUi)}>{title}</p>
        <h3 className={`mt-2 text-xl font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{formatNumber(data.totalVf)} VF</h3>
      </div>
      <div className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}>
        {formatCompactNumber(data.totalChars)} chars
      </div>
    </div>
    <div className="space-y-2.5">
      {ENGINE_ORDER.map((engine) => (
        <div key={engine} className={`flex items-center justify-between rounded-2xl border px-3 py-2 ${cardInsetClass(isDarkUi)}`}>
          <div className={`flex items-center gap-2 ${mutedClass(isDarkUi)}`}>
            <EngineLogo engine={engine} size="sm" variant="ringed" />
            <span className="text-sm font-medium">{engine}</span>
          </div>
          <span className={`text-xs font-semibold ${isDarkUi ? 'text-cyan-200' : 'text-cyan-800'}`}>
            {formatNumber(data.byEngine[engine]?.vf || 0)} VF
          </span>
        </div>
      ))}
    </div>
  </div>
);

const MetricTile: React.FC<{
  isDarkUi: boolean;
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  detail: string;
}> = ({ isDarkUi, icon, eyebrow, title, detail }) => (
  <div className={`rounded-[1.35rem] border p-4 ${surfaceClass(isDarkUi)}`}>
    <div className={`mb-3 inline-flex h-11 w-11 items-center justify-center rounded-2xl border ${cardInsetClass(isDarkUi)} ${isDarkUi ? 'text-cyan-200' : 'text-cyan-800'}`}>
      {icon}
    </div>
    <p className={labelClass(isDarkUi)}>{eyebrow}</p>
    <div className={`mt-2 text-xl font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{title}</div>
    <div className={`mt-1 text-sm ${subduedClass(isDarkUi)}`}>{detail}</div>
  </div>
);

const PreferenceToggle: React.FC<{
  isDarkUi: boolean;
  title: string;
  detail: string;
  checked: boolean;
  onToggle: () => void;
}> = ({ isDarkUi, title, detail, checked, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    className={`flex w-full items-center justify-between rounded-[1.1rem] border px-4 py-3 text-left transition ${cardInsetClass(isDarkUi)} ${
      isDarkUi ? 'hover:border-cyan-300/30 hover:bg-white/[0.06]' : 'hover:border-cyan-200 hover:bg-white'
    }`}
  >
    <div className="pr-4">
      <div className={`text-sm font-semibold ${isDarkUi ? 'text-slate-100' : 'text-slate-900'}`}>{title}</div>
      <div className={`mt-1 text-xs ${subduedClass(isDarkUi)}`}>{detail}</div>
    </div>
    <div
      className={`relative h-7 w-12 rounded-full transition ${
        checked
          ? isDarkUi
            ? 'bg-cyan-400'
            : 'bg-cyan-500'
          : isDarkUi
            ? 'bg-slate-700'
            : 'bg-slate-300'
      }`}
    >
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'left-6' : 'left-1'}`} />
    </div>
  </button>
);

const ThemeButton: React.FC<{
  active: boolean;
  isDarkUi: boolean;
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
}> = ({ active, isDarkUi, icon, title, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
      active
        ? isDarkUi
          ? 'border-cyan-300/45 bg-cyan-400/15 text-white'
          : 'border-cyan-300 bg-cyan-50 text-cyan-900'
        : `${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`
    }`}
  >
    {icon}
    {title}
  </button>
);

const StatusBadge: React.FC<{ isDarkUi: boolean; tone: 'success' | 'warning' | 'neutral'; label: string }> = ({
  isDarkUi,
  tone,
  label,
}) => {
  const toneClass = tone === 'success'
    ? (isDarkUi ? 'border-emerald-400/25 bg-emerald-400/12 text-emerald-100' : 'border-emerald-200 bg-emerald-50 text-emerald-800')
    : tone === 'warning'
      ? (isDarkUi ? 'border-amber-400/25 bg-amber-400/12 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-800')
      : (isDarkUi ? 'border-white/10 bg-white/[0.06] text-slate-200' : 'border-slate-200 bg-slate-100 text-slate-700');
  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${toneClass}`}>{label}</span>;
};

const InfoRow: React.FC<{ isDarkUi: boolean; label: string; value: string }> = ({ isDarkUi, label, value }) => (
  <div className={`rounded-[1rem] border px-3 py-3 ${cardInsetClass(isDarkUi)}`}>
    <div className={labelClass(isDarkUi)}>{label}</div>
    <div className={`mt-2 break-words text-sm font-medium ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{value}</div>
  </div>
);

const AccordionSection: React.FC<{
  title: string;
  summary: string;
  icon: React.ReactNode;
  isDarkUi: boolean;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
}> = ({ title, summary, icon, isDarkUi, isOpen, onToggle, children, className }) => (
  <section
    className={`overflow-hidden rounded-[1.45rem] border transition ${surfaceClass(isDarkUi)} ${
      isOpen ? (isDarkUi ? 'border-cyan-300/20' : 'border-cyan-200/80') : ''
    } ${className || ''}`}
  >
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      className="flex w-full items-start justify-between gap-4 px-4 py-4 text-left sm:px-5"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${cardInsetClass(isDarkUi)} ${isDarkUi ? 'text-cyan-200' : 'text-cyan-800'}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className={`text-lg font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{title}</div>
          <div className={`mt-1 text-xs leading-5 sm:text-sm ${subduedClass(isDarkUi)}`}>{summary}</div>
        </div>
      </div>
      <div className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}>
        {isOpen ? 'Collapse' : 'Expand'}
        <ChevronDown size={14} className={`transition ${isOpen ? 'rotate-180' : ''}`} />
      </div>
    </button>
    {isOpen ? <div className={`border-t px-4 py-4 sm:px-5 ${isDarkUi ? 'border-white/10' : 'border-slate-200/90'}`}>{children}</div> : null}
  </section>
);

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
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(readSavedUiTheme);
  const [isDarkUi, setIsDarkUi] = useState<boolean>(() => resolveThemeChoice(readSavedUiTheme()));
  const [accountProfile, setAccountProfile] = useState<AccountUserProfile | null>(null);
  const [accountEntitlements, setAccountEntitlements] = useState<AccountEntitlements | null>(null);
  const [billingSummary, setBillingSummary] = useState<AccountBillingSummary | null>(null);
  const [supportText, setSupportText] = useState('');
  const [supportConversations, setSupportConversations] = useState<SupportConversation[]>([]);
  const [isLoadingSupport, setIsLoadingSupport] = useState(false);
  const [isSendingSupport, setIsSendingSupport] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [portalIntent, setPortalIntent] = useState<'manage' | 'cancel' | null>(null);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [showAllInvoices, setShowAllInvoices] = useState(false);
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>(() => ({ ...DEFAULT_OPEN_SECTIONS }));
  const baseUrl = useMemo(() => readSettingsBackendUrl(), []);
  const billingActions = useBillingActions({ baseUrl });

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

  const planKey = normalizePlanKey(stats.planName);
  const planName = billingSummary?.plan.name || toPlanName(planKey);
  const isPaidPlan = planKey !== 'free';
  const hasBillingSummary = billingSummary !== null;
  const summary: AccountBillingSummary = billingSummary || {
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
      dailyGenerationLimit: 0,
      maxCharsPerGeneration: Math.max(0, Number(accountEntitlements?.limits?.maxCharsPerGeneration || stats.limits?.maxCharsPerGeneration || 0)),
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
  const recurringBenefit = hasBillingSummary ? summary.plan.pricing.discountPercent : 0;
  const monthlyUsed = Math.max(0, Number(stats.vfUsage.monthly.totalVf || 0));
  const monthlyLimit = summary?.plan.monthlyVfLimit ?? null;
  const monthlyRemaining = hasUnlimitedAccess
    ? Number.POSITIVE_INFINITY
    : monthlyLimit !== null
      ? Math.max(0, Number(monthlyLimit || 0) - monthlyUsed)
      : null;
  const availableBalance = hasUnlimitedAccess
    ? Number.POSITIVE_INFINITY
    : Math.max(0, Number(stats.wallet?.monthlyFreeRemaining || 0) + Number(stats.wallet?.paidVfBalance || 0));
  const paymentMethodLabel = summary ? describePaymentMethod(summary) : 'Billing sync pending';
  const memberSince = accountProfile?.createdAt || null;
  const memberSinceLabel = memberSince ? formatDate(memberSince) : 'Unavailable';
  const canManageBilling = Boolean(summary?.billing.hasPortalAccess);
  const canCancelRecurring = isPaidPlan && Boolean(summary?.subscription.active) && canManageBilling;
  const providerLabels = Array.isArray(user.providers) ? user.providers.filter(Boolean) : [];
  const providerSummary = providerLabels.length > 0 ? providerLabels.map(formatProviderLabel).join(', ') : 'Email';
  const refreshLabel = isRefreshing ? 'Refreshing...' : 'Refresh account';
  const usageTone: 'success' | 'warning' | 'neutral' = hasUnlimitedAccess
    ? 'success'
    : monthlyRemaining !== null && monthlyLimit !== null && monthlyRemaining <= Number(monthlyLimit || 0) * 0.15
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
  const invoices = summary?.invoices || [];
  const visibleInvoices = showAllInvoices ? invoices : invoices.slice(0, 3);
  const supportPreview = supportConversations.slice(0, 4);
  const recentActivity = history.slice(0, 5);
  const userDisplayName = accountProfile?.displayName || user.name || 'VoiceFlow user';
  const userEmail = accountProfile?.email || user.email || 'Email unavailable';
  const accountStatus = humanizeToken(accountProfile?.status || '', 'Active');
  const renewalHeadline = !isPaidPlan
    ? 'Free plan'
    : !summary
      ? 'Awaiting billing sync'
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
    ? 'Upgrade to unlock recurring billing and invoice history.'
    : !summary
      ? 'Live billing details will appear after the account summary sync succeeds.'
      : summary.subscription.cancelAtPeriodEnd
        ? 'Your plan remains active until the current billing period ends.'
        : summary.subscription.nextBillingAt
          ? `Recurring billing is scheduled for ${formatDateTime(summary.subscription.nextBillingAt)}.`
          : 'The current billing schedule is being synced from Stripe.';
  const overviewSummary = `${summary.plan.name} plan • Member since ${memberSinceLabel} • ${providerSummary}`;
  const billingSummaryText = `${paymentMethodLabel} • ${
    summary.invoices.length > 0 ? `${summary.invoices.length} invoice${summary.invoices.length === 1 ? '' : 's'} synced` : 'No invoices yet'
  }`;
  const usageSummaryText = hasUnlimitedAccess
    ? `Unlimited access • ${formatNumber(monthlyUsed)} VF used this month`
    : `${formatNumber(monthlyUsed)} of ${formatNumber(summary.plan.monthlyVfLimit || 0)} VF used this month`;
  const preferencesSummary = `${activeThemeLabel} theme • ${enabledPreferenceCount}/${totalPreferenceCount} preference toggles enabled`;
  const supportSummaryText = isLoadingSupport
    ? 'Loading support conversations...'
    : supportConversations.length > 0
      ? `${
          supportConversations.filter((row) => {
            const status = String(row.status || '').trim().toLowerCase();
            return status === 'open' || status === 'needs_human';
          }).length
        } active conversation${supportConversations.length === 1 ? '' : 's'}`
      : 'No active support conversations';
  const activitySummaryText = recentActivity.length > 0 ? `${recentActivity.length} recent generation${recentActivity.length === 1 ? '' : 's'} ready` : 'No generation history yet';

  const syncAccountCenter = async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) setIsRefreshing(true);
    try {
      await Promise.allSettled([refreshEntitlements(), loadHistory(20)]);
      const [profileResult, entitlementsResult, summaryResult, supportResult] = await Promise.allSettled([
        fetchAccountProfile(baseUrl),
        fetchAccountEntitlements(baseUrl),
        fetchAccountBillingSummary(baseUrl),
        fetchMySupportConversations(baseUrl, 40),
      ]);
      if (profileResult.status === 'fulfilled') {
        setAccountProfile(profileResult.value.profile);
      } else if (!silent) {
        setAccountProfile(null);
      }
      if (entitlementsResult.status === 'fulfilled') {
        setAccountEntitlements(entitlementsResult.value);
      } else if (!silent) {
        setAccountEntitlements(null);
      }
      if (summaryResult.status === 'fulfilled') {
        setBillingSummary(summaryResult.value);
        setShowAllInvoices(false);
        const resolvedUserId = String(summaryResult.value.profile.userId || '').trim().toLowerCase();
        if (resolvedUserId) updateUser({ userId: resolvedUserId });
      } else if (!silent) {
        setBillingSummary(null);
      }
      if (supportResult.status === 'fulfilled') {
        setSupportConversations(supportResult.value);
      } else if (!silent) {
        setSupportConversations([]);
      }
    } catch {
      if (!silent) {
        emit('custom.message', {
          title: 'Account',
          message: 'Could not refresh account details. Showing cached information.',
          severity: 'warning',
          category: 'system',
          dedupeKey: 'account-refresh-warning',
        });
      }
    } finally {
      if (!silent) setIsRefreshing(false);
      setIsLoadingSupport(false);
    }
  };

  useEffect(() => {
    setIsLoadingSupport(true);
    void syncAccountCenter({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSection = (section: SectionKey) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const handleOpenPortal = async (intent: 'manage' | 'cancel') => {
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
  };

  const handleSendSupport = async () => {
    const text = supportText.trim();
    if (!text) return;
    setIsSendingSupport(true);
    try {
      await postSupportMessage({ text }, baseUrl);
      setSupportText('');
      const rows = await fetchMySupportConversations(baseUrl, 40);
      setSupportConversations(rows);
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
  };

  const handleMarkUnresolved = async (conversationId: string) => {
    try {
      await markSupportConversationUnresolved(conversationId, baseUrl);
      const rows = await fetchMySupportConversations(baseUrl, 40);
      setSupportConversations(rows);
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
  };

  return (
    <div className="h-[100dvh] w-full overflow-y-auto overflow-x-hidden overscroll-y-contain bg-transparent px-4 py-5 sm:px-6 sm:py-6">
      <div
        className={`pointer-events-none fixed inset-0 ${
          isDarkUi
            ? 'bg-[radial-gradient(90%_80%_at_0%_0%,rgba(34,211,238,0.16),transparent_50%),radial-gradient(82%_78%_at_100%_14%,rgba(251,191,36,0.12),transparent_54%),radial-gradient(86%_74%_at_50%_100%,rgba(244,114,182,0.12),transparent_58%),linear-gradient(180deg,#020617_0%,#071220_42%,#050b14_100%)]'
            : 'bg-[radial-gradient(88%_72%_at_0%_0%,rgba(34,211,238,0.16),transparent_50%),radial-gradient(82%_76%_at_100%_12%,rgba(251,191,36,0.14),transparent_54%),radial-gradient(80%_74%_at_50%_100%,rgba(244,114,182,0.12),transparent_58%),linear-gradient(180deg,#eef8ff_0%,#f8fbff_45%,#fffaf4_100%)]'
        }`}
      />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-4">
        <section className={`overflow-hidden rounded-[1.85rem] border p-4 sm:p-5 ${surfaceClass(isDarkUi)}`}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                onClick={() => setScreen(AppScreen.MAIN)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition ${
                  isDarkUi ? 'border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08]' : 'border-slate-200 bg-white/80 text-slate-800 hover:bg-white'
                }`}
              >
                <ArrowLeft size={16} />
                Back to workspace
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void syncAccountCenter()}
                  disabled={isRefreshing}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition disabled:opacity-60 ${
                    isDarkUi ? 'border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08]' : 'border-slate-200 bg-white/80 text-slate-800 hover:bg-white'
                  }`}
                >
                  {isRefreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
                  {refreshLabel}
                </button>
                <button
                  onClick={async () => {
                    try {
                      await signOutUser();
                      emit('custom.message', {
                        title: 'Session',
                        message: 'Signed out successfully.',
                        severity: 'success',
                        category: 'security',
                        channel: 'toast',
                      });
                    } catch (error) {
                      emit('custom.message', {
                        title: 'Session',
                        message: sanitizeUiText(error instanceof Error ? error.message : 'Sign out failed.'),
                        severity: 'error',
                        category: 'security',
                        dedupeKey: 'profile-signout-failed',
                      });
                    }
                    setScreen(AppScreen.LOGIN);
                  }}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition ${
                    isDarkUi ? 'border-rose-300/25 bg-rose-400/12 text-rose-50 hover:bg-rose-400/18' : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                  }`}
                >
                  <LogOut size={16} />
                  Sign out
                </button>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.18fr_0.82fr]">
              <div className="space-y-4">
                <div className={`inline-flex items-center gap-3 rounded-full border px-4 py-2 ${cardInsetClass(isDarkUi)}`}>
                  <BrandLogo size="sm" tone={isDarkUi ? 'light' : 'dark'} />
                  <span className={`text-[11px] font-black uppercase tracking-[0.26em] ${isDarkUi ? 'text-cyan-100' : 'text-cyan-900'}`}>Account Center</span>
                </div>
                <div>
                  <h1 className={`text-2xl font-semibold tracking-tight sm:text-3xl ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>Billing, preferences, and support in one screen.</h1>
                  <p className={`mt-2 max-w-3xl text-sm leading-6 ${mutedClass(isDarkUi)}`}>Compact account controls for plan management, invoices, usage, notifications, support, and recent activity.</p>
                </div>
                <div className="flex items-start gap-4">
                  <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-[1.2rem] border text-xl font-black ${isDarkUi ? 'border-white/10 bg-white/[0.06] text-white' : 'border-slate-200 bg-white text-slate-900'}`}>
                    {user.avatarUrl ? <img src={user.avatarUrl} alt={`${userDisplayName} avatar`} className="h-full w-full rounded-[1.2rem] object-cover" /> : userDisplayName.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className={`truncate text-xl font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{userDisplayName}</div>
                    <div className={`truncate text-sm ${subduedClass(isDarkUi)}`}>{userEmail}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusBadge isDarkUi={isDarkUi} tone={summary.subscription.active ? 'success' : 'neutral'} label={planName} />
                      <StatusBadge isDarkUi={isDarkUi} tone={usageTone} label={hasUnlimitedAccess ? 'Unlimited access' : (hasBillingSummary ? humanizeToken(summary.plan.status) : 'Entitlements synced')} />
                      {summary.plan.earlyAccess ? <StatusBadge isDarkUi={isDarkUi} tone="warning" label="Early access" /> : null}
                    </div>
                  </div>
                </div>
                {summary.warnings.length > 0 ? <div className={`rounded-[1.1rem] border px-4 py-3 text-sm ${isDarkUi ? 'border-amber-300/20 bg-amber-400/10 text-amber-50' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{summary.warnings[0]}</div> : null}
              </div>

              <div className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                  <button type="button" onClick={() => setShowSubscriptionModal(true)} className={`inline-flex items-center justify-between rounded-[1.15rem] border px-4 py-3 text-left text-sm font-semibold transition ${isDarkUi ? 'border-cyan-300/25 bg-cyan-400/12 text-cyan-50 hover:bg-cyan-400/18' : 'border-cyan-200 bg-cyan-50 text-cyan-900 hover:bg-cyan-100'}`}>
                    Change plan
                    <ChevronRight size={16} />
                  </button>
                  <button type="button" onClick={() => void handleOpenPortal('manage')} disabled={!canManageBilling || portalIntent !== null} className={`inline-flex items-center justify-between rounded-[1.15rem] border px-4 py-3 text-left text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${isDarkUi ? 'border-white/10 bg-white/[0.05] text-slate-100 hover:bg-white/[0.08]' : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'}`}>
                    {portalIntent === 'manage' ? <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Opening billing</span> : <><span>Manage billing</span><ExternalLink size={16} /></>}
                  </button>
                  <button type="button" onClick={() => setIsCancelDialogOpen(true)} disabled={!canCancelRecurring} className={`inline-flex items-center justify-between rounded-[1.15rem] border px-4 py-3 text-left text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${isDarkUi ? 'border-rose-300/20 bg-rose-400/10 text-rose-50 hover:bg-rose-400/18' : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'}`}>
                    Cancel recurring
                    <ChevronRight size={16} />
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className={`rounded-[1.2rem] border px-4 py-4 ${cardInsetClass(isDarkUi)}`}>
                    <div className={labelClass(isDarkUi)}>Recurring benefit</div>
                    <div className={`mt-2 text-lg font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{hasBillingSummary ? (recurringBenefit > 0 ? `${recurringBenefit}% locked in` : 'No recurring benefit') : 'Billing sync pending'}</div>
                    <div className={`mt-1 text-xs leading-5 ${subduedClass(isDarkUi)}`}>{hasBillingSummary ? (recurringBenefit > 0 ? `${planName} renews at ${formatCurrencyInr(summary.plan.pricing.recurringInr)} per month.` : 'Upgrade to a paid plan to unlock recurring billing perks.') : 'Recurring discounts and renewal pricing will appear after live billing data loads.'}</div>
                  </div>
                  <div className={`rounded-[1.2rem] border px-4 py-4 ${cardInsetClass(isDarkUi)}`}>
                    <div className={labelClass(isDarkUi)}>Billing status</div>
                    <div className={`mt-2 text-lg font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{hasBillingSummary ? (canManageBilling ? 'Live billing connected' : 'Portal unavailable') : 'Live billing pending'}</div>
                    <div className={`mt-1 text-xs leading-5 ${subduedClass(isDarkUi)}`}>{hasBillingSummary ? paymentMethodLabel : 'The backend billing summary did not return yet, so payment and renewal metadata are intentionally hidden.'}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
          <AccordionSection title="Overview" summary="Identity, access, and current entitlements" icon={<ShieldCheck size={18} />} isDarkUi={isDarkUi} isOpen={openSections.overview} onToggle={() => toggleSection('overview')}>
            <div className="grid gap-4 xl:grid-cols-[1.02fr_0.98fr]">
              <div className="grid gap-3 sm:grid-cols-2">
                <InfoRow isDarkUi={isDarkUi} label="Display name" value={userDisplayName} />
                <InfoRow isDarkUi={isDarkUi} label="Email" value={userEmail} />
                <InfoRow isDarkUi={isDarkUi} label="User ID" value={accountProfile?.userId || user.userId || 'Pending'} />
                <InfoRow isDarkUi={isDarkUi} label="Account status" value={accountStatus} />
                <InfoRow isDarkUi={isDarkUi} label="Auth providers" value={providerSummary} />
                <InfoRow isDarkUi={isDarkUi} label="Member since" value={memberSinceLabel} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <MetricTile isDarkUi={isDarkUi} icon={<CircleDollarSign size={18} />} eyebrow="Current plan" title={planName} detail={monthlyLimit !== null ? `${formatCompactNumber(monthlyLimit)} VF monthly cap | ${summary.plan.allowedEngines.length} engines` : `${summary.plan.allowedEngines.length || stats.limits?.allowedEngines?.length || 0} engines enabled`} />
                <MetricTile isDarkUi={isDarkUi} icon={<Wallet size={18} />} eyebrow="Monthly remaining" title={monthlyRemaining === null ? 'Pending sync' : formatVfValue(monthlyRemaining)} detail={hasUnlimitedAccess ? 'Unlimited access across your account.' : monthlyLimit !== null ? `${formatNumber(monthlyUsed)} VF already used in the current monthly window.` : 'Monthly allowance becomes visible when live billing and entitlement metadata are available.'} />
                <MetricTile isDarkUi={isDarkUi} icon={<Sparkles size={18} />} eyebrow="Spendable balance" title={formatVfValue(availableBalance)} detail={hasUnlimitedAccess ? 'Unlimited access removes wallet spend constraints.' : `${formatNumber(stats.wallet?.monthlyFreeRemaining || 0)} free VF and ${formatNumber(stats.wallet?.paidVfBalance || 0)} paid VF available.`} />
                <MetricTile isDarkUi={isDarkUi} icon={<CalendarClock size={18} />} eyebrow="Renewal state" title={renewalHeadline} detail={renewalDetail} />
              </div>
            </div>
          </AccordionSection>

          <AccordionSection title="Billing" summary={hasBillingSummary ? billingSummaryText : 'Live billing data unavailable'} icon={<CreditCard size={18} />} isDarkUi={isDarkUi} isOpen={openSections.billing} onToggle={() => toggleSection('billing')}>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className={`rounded-[1.2rem] border p-4 ${cardInsetClass(isDarkUi)}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className={labelClass(isDarkUi)}>Plan & renewal</div>
                    <div className={`mt-2 text-lg font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{planName}</div>
                  </div>
                  <StatusBadge isDarkUi={isDarkUi} tone={summary.subscription.active ? 'success' : 'neutral'} label={hasBillingSummary ? humanizeToken(summary.subscription.status || summary.plan.status) : 'Sync pending'} />
                </div>
                <div className={`mt-3 space-y-2 text-sm ${mutedClass(isDarkUi)}`}>
                  <div className="flex items-center justify-between gap-3"><span>Recurring rate</span><span className={`font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{hasBillingSummary ? (isPaidPlan ? formatCurrencyInr(summary.plan.pricing.recurringInr) : 'Free') : 'Unavailable'}</span></div>
                  <div className="flex items-center justify-between gap-3"><span>Current period</span><span className={`font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{hasBillingSummary && (summary.subscription.currentPeriodStart || summary.subscription.currentPeriodEnd) ? `${formatDate(summary.subscription.currentPeriodStart)} - ${formatDate(summary.subscription.currentPeriodEnd)}` : 'Unavailable'}</span></div>
                  <div className="flex items-center justify-between gap-3"><span>Renewal state</span><span className={`font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{renewalHeadline}</span></div>
                </div>
              </div>

              <div className={`rounded-[1.2rem] border p-4 ${cardInsetClass(isDarkUi)}`}>
                <div className={labelClass(isDarkUi)}>Payment method</div>
                <div className={`mt-2 text-lg font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{paymentMethodLabel}</div>
                <div className={`mt-1 text-sm ${subduedClass(isDarkUi)}`}>{hasBillingSummary ? (summary.paymentMethod?.expMonth && summary.paymentMethod?.expYear ? `Expires ${String(summary.paymentMethod.expMonth).padStart(2, '0')}/${summary.paymentMethod.expYear}` : canManageBilling ? 'Manage the default payment method from the billing portal.' : 'No active billing portal session is available yet.') : 'Live payment method details are not available until billing sync completes.'}</div>
                <div className={`mt-4 rounded-[1rem] border px-3 py-3 text-xs ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}>{hasBillingSummary ? `${summary.billing.billingCountry ? `Billing country: ${summary.billing.billingCountry}` : 'Billing country is not available.'}${summary.billing.currencyMode ? ` Currency mode: ${summary.billing.currencyMode}.` : ''}` : 'Billing country and currency mode will appear when the backend billing summary is available.'}</div>
              </div>

              <div className={`rounded-[1.2rem] border p-4 ${cardInsetClass(isDarkUi)} lg:col-span-2`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className={labelClass(isDarkUi)}>Recent invoices</div>
                    <div className={`mt-2 text-lg font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>Invoices and receipts</div>
                  </div>
                  {invoices.length > 3 ? <button type="button" onClick={() => setShowAllInvoices((prev) => !prev)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}>{showAllInvoices ? 'Show recent 3' : `Show all ${invoices.length}`}</button> : null}
                </div>
                {invoices.length === 0 ? <div className={`mt-4 rounded-[1rem] border px-4 py-4 text-sm ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}>{hasBillingSummary ? 'No invoices synced yet. Once Stripe posts invoice activity, recent receipts will appear here.' : 'Live billing data is unavailable, so invoices and receipts are intentionally hidden until the backend summary sync succeeds.'}</div> : <div className={`mt-4 space-y-2 ${showAllInvoices ? 'max-h-72 overflow-y-auto pr-1' : ''}`}>{visibleInvoices.map((invoice) => <div key={invoice.id} className={`rounded-[1rem] border px-3 py-3 ${cardInsetClass(isDarkUi)}`}><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className={`truncate text-sm font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{invoice.description || invoice.number || invoice.id}</div><div className={`mt-1 text-xs ${subduedClass(isDarkUi)}`}>Created {formatDateTime(invoice.createdAt)}{invoice.paidAt ? ` • Paid ${formatDateTime(invoice.paidAt)}` : ''}</div></div><div className="flex flex-wrap items-center gap-2"><StatusBadge isDarkUi={isDarkUi} tone={invoice.status === 'paid' ? 'success' : invoice.status === 'open' ? 'warning' : 'neutral'} label={humanizeToken(invoice.status)} /><span className={`text-sm font-semibold ${isDarkUi ? 'text-cyan-100' : 'text-cyan-900'}`}>{formatCurrencyMinor(invoice.amountPaidMinor || invoice.amountDueMinor, invoice.currency)}</span>{invoice.hostedInvoiceUrl ? <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${isDarkUi ? 'border-white/10 bg-white/[0.06] text-slate-100 hover:bg-white/[0.08]' : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'}`}>Open<ExternalLink size={12} /></a> : invoice.invoicePdf ? <a href={invoice.invoicePdf} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${isDarkUi ? 'border-white/10 bg-white/[0.06] text-slate-100 hover:bg-white/[0.08]' : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'}`}>PDF<ExternalLink size={12} /></a> : null}</div></div></div>)}</div>}
              </div>

              <div className={`rounded-[1.2rem] border p-4 ${cardInsetClass(isDarkUi)} lg:col-span-2`}>
                <div className={labelClass(isDarkUi)}>Billing actions</div>
                <div className={`mt-2 text-lg font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>Stripe portal controls</div>
                <div className={`mt-1 text-sm ${subduedClass(isDarkUi)}`}>Manage payment methods, invoice downloads, and cancellation through the billing portal.</div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button type="button" onClick={() => void handleOpenPortal('manage')} disabled={!canManageBilling || portalIntent !== null} className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${isDarkUi ? 'border-white/10 bg-white/[0.06] text-slate-100 hover:bg-white/[0.08]' : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'}`}>{portalIntent === 'manage' ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}Open billing portal</button>
                  <button type="button" onClick={() => setIsCancelDialogOpen(true)} disabled={!canCancelRecurring} className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${isDarkUi ? 'border-rose-300/20 bg-rose-400/10 text-rose-50 hover:bg-rose-400/18' : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'}`}>Cancel recurring</button>
                </div>
              </div>
            </div>
          </AccordionSection>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <AccordionSection title="Usage" summary={hasUnlimitedAccess ? `Unlimited access | ${formatNumber(monthlyUsed)} VF used this month` : monthlyLimit !== null ? `${formatNumber(monthlyUsed)} of ${formatNumber(monthlyLimit)} VF used this month` : `${formatNumber(monthlyUsed)} VF used this month`} icon={<History size={18} />} isDarkUi={isDarkUi} isOpen={openSections.usage} onToggle={() => toggleSection('usage')}>
            <div className="grid gap-3 xl:grid-cols-3">
              <WindowCard title="Daily" data={stats.vfUsage.daily} isDarkUi={isDarkUi} />
              <WindowCard title="Monthly" data={stats.vfUsage.monthly} isDarkUi={isDarkUi} />
              <WindowCard title="Lifetime" data={stats.vfUsage.lifetime} isDarkUi={isDarkUi} />
            </div>
          </AccordionSection>

          <AccordionSection title="Preferences" summary={`${activeThemeLabel} theme | ${enabledPreferenceCount}/${totalPreferenceCount} preference toggles enabled`} icon={<MonitorSmartphone size={18} />} isDarkUi={isDarkUi} isOpen={openSections.preferences} onToggle={() => toggleSection('preferences')}>
            <div className="grid gap-4 xl:grid-cols-[0.72fr_1.28fr]">
              <div className={`rounded-[1.2rem] border p-4 ${cardInsetClass(isDarkUi)}`}>
                <div className={labelClass(isDarkUi)}>Theme</div>
                <div className={`mt-2 text-lg font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>Appearance mode</div>
                <div className={`mt-1 text-sm ${subduedClass(isDarkUi)}`}>Choose how the account center should look in light and dark environments.</div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                  <ThemeButton active={themeChoice === 'light'} isDarkUi={isDarkUi} icon={<Sun size={16} />} title="Light" onClick={() => setThemeChoice('light')} />
                  <ThemeButton active={themeChoice === 'dark'} isDarkUi={isDarkUi} icon={<Moon size={16} />} title="Dark" onClick={() => setThemeChoice('dark')} />
                  <ThemeButton active={themeChoice === 'system'} isDarkUi={isDarkUi} icon={<MonitorSmartphone size={16} />} title="System" onClick={() => setThemeChoice('system')} />
                </div>
              </div>

              <div className={`rounded-[1.2rem] border p-4 ${cardInsetClass(isDarkUi)}`}>
                <div className={labelClass(isDarkUi)}>Notifications</div>
                <div className={`mt-2 text-lg font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>Inbox and email preferences</div>
                <div className={`mt-1 text-sm ${subduedClass(isDarkUi)}`}>Critical alerts always remain enabled. Email toggles sync to the existing notification preference service.</div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <PreferenceToggle isDarkUi={isDarkUi} title="Tips" detail="Allow educational hints and helpful prompts." checked={prefs.allowTips} onToggle={() => setPrefs((prev) => ({ ...prev, allowTips: !prev.allowTips }))} />
                  <PreferenceToggle isDarkUi={isDarkUi} title="System info" detail="Show runtime and backend status notices." checked={prefs.allowSystemInfo} onToggle={() => setPrefs((prev) => ({ ...prev, allowSystemInfo: !prev.allowSystemInfo }))} />
                  <PreferenceToggle isDarkUi={isDarkUi} title="Notification sound" detail="Play a tone for warning, error, and critical alerts." checked={prefs.playSound} onToggle={() => setPrefs((prev) => ({ ...prev, playSound: !prev.playSound }))} />
                  <PreferenceToggle isDarkUi={isDarkUi} title="Email async jobs" detail="Email queued TTS and dubbing job updates." checked={prefs.emailAsyncJobs} onToggle={() => setPrefs((prev) => ({ ...prev, emailAsyncJobs: !prev.emailAsyncJobs }))} />
                  <PreferenceToggle isDarkUi={isDarkUi} title="Email billing" detail="Email quota, receipt, and balance notifications." checked={prefs.emailBilling} onToggle={() => setPrefs((prev) => ({ ...prev, emailBilling: !prev.emailBilling }))} />
                  <PreferenceToggle isDarkUi={isDarkUi} title="Email support" detail="Email support replies and resolution updates." checked={prefs.emailSupport} onToggle={() => setPrefs((prev) => ({ ...prev, emailSupport: !prev.emailSupport }))} />
                  {isAdmin ? <PreferenceToggle isDarkUi={isDarkUi} title="Email admin alerts" detail="Workspace-scoped admin notices and escalation alerts." checked={prefs.emailAdminAlerts} onToggle={() => setPrefs((prev) => ({ ...prev, emailAdminAlerts: !prev.emailAdminAlerts }))} /> : null}
                </div>
              </div>
            </div>
          </AccordionSection>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <AccordionSection title="Support" summary={supportSummaryText} icon={<Headset size={18} />} isDarkUi={isDarkUi} isOpen={openSections.support} onToggle={() => toggleSection('support')} className="xl:col-span-2">
            <div className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
              <div className={`rounded-[1.2rem] border p-4 ${cardInsetClass(isDarkUi)}`}>
                <div className={labelClass(isDarkUi)}>Compose request</div>
                <div className={`mt-2 text-lg font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>Send a support message</div>
                <div className={`mt-1 text-sm ${subduedClass(isDarkUi)}`}>Use this for billing questions, account issues, or anything that needs a human follow-up.</div>
                <textarea value={supportText} onChange={(event) => setSupportText(event.target.value)} placeholder="Describe the issue, expected outcome, and anything already tried." className={`mt-4 min-h-[132px] w-full rounded-[1.1rem] border px-4 py-3 text-sm outline-none transition ${isDarkUi ? 'border-white/10 bg-slate-950/40 text-white placeholder:text-slate-500 focus:border-cyan-300/45' : 'border-slate-200 bg-white text-slate-950 placeholder:text-slate-400 focus:border-cyan-300'}`} />
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className={`text-xs ${subduedClass(isDarkUi)}`}>Recent conversations refresh automatically after sending.</div>
                  <button type="button" onClick={() => void handleSendSupport()} disabled={isSendingSupport || supportText.trim().length === 0} className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${isDarkUi ? 'border-cyan-300/25 bg-cyan-400/12 text-cyan-50 hover:bg-cyan-400/18' : 'border-cyan-200 bg-cyan-50 text-cyan-900 hover:bg-cyan-100'}`}>{isSendingSupport ? <Loader2 size={16} className="animate-spin" /> : <MessageSquareText size={16} />}Send request</button>
                </div>
              </div>
              <div className={`rounded-[1.2rem] border p-4 ${cardInsetClass(isDarkUi)}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className={labelClass(isDarkUi)}>Recent conversations</div>
                    <div className={`mt-2 text-lg font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>Support timeline</div>
                  </div>
                  {isLoadingSupport ? <Loader2 size={18} className={`animate-spin ${isDarkUi ? 'text-cyan-200' : 'text-cyan-800'}`} /> : null}
                </div>
                {isLoadingSupport ? <div className={`mt-4 rounded-[1rem] border px-4 py-4 text-sm ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}>Syncing support conversations...</div> : supportPreview.length === 0 ? <div className={`mt-4 rounded-[1rem] border px-4 py-4 text-sm ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}>No support conversations yet.</div> : <div className="mt-4 space-y-3">{supportPreview.map((conversation) => { const statusLabel = humanizeToken(conversation.status, 'Open'); const priorityLabel = humanizeToken(conversation.priority, 'Normal'); const lastUpdated = conversation.lastMessageAt || conversation.updatedAt; const canReopen = !['open', 'needs_human'].includes(String(conversation.status || '').trim().toLowerCase()); return <div key={conversation.conversationId} className={`rounded-[1rem] border px-4 py-4 ${cardInsetClass(isDarkUi)}`}><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className={`text-sm font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>Conversation {conversation.conversationId.slice(0, 8)}</div><div className={`mt-1 text-xs ${subduedClass(isDarkUi)}`}>Last updated {formatDateTime(lastUpdated)}{conversation.assignedTo ? ` • Assigned to ${conversation.assignedTo}` : ''}</div></div><div className="flex flex-wrap items-center gap-2"><StatusBadge isDarkUi={isDarkUi} tone={statusToneFromConversation(conversation.status)} label={statusLabel} /><StatusBadge isDarkUi={isDarkUi} tone={statusToneFromPriority(conversation.priority)} label={priorityLabel} /></div></div>{canReopen ? <button type="button" onClick={() => void handleMarkUnresolved(conversation.conversationId)} className={`mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${isDarkUi ? 'border-white/10 bg-white/[0.06] text-slate-100 hover:bg-white/[0.08]' : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'}`}>Reopen with support</button> : null}</div>; })}</div>}
              </div>
            </div>
          </AccordionSection>

          <AccordionSection title="Activity" summary={activitySummaryText} icon={<Bell size={18} />} isDarkUi={isDarkUi} isOpen={openSections.activity} onToggle={() => toggleSection('activity')}>
            <div className="space-y-3">
              {recentActivity.length === 0 ? <div className={`rounded-[1rem] border px-4 py-4 text-sm ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}>No generation history yet.</div> : recentActivity.map((item) => <div key={item.id} className={`rounded-[1rem] border px-4 py-4 ${cardInsetClass(isDarkUi)}`}><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className={`truncate text-sm font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{item.voiceName}</div><div className={`mt-1 text-xs ${subduedClass(isDarkUi)}`}>{formatDateTime(new Date(item.timestamp).toISOString())}{item.engine ? ` • ${item.engine}` : ''}{item.chars ? ` • ${formatNumber(item.chars)} chars` : ''}</div></div><StatusBadge isDarkUi={isDarkUi} tone={item.status === 'failed' ? 'warning' : 'success'} label={humanizeToken(item.status || 'completed')} /></div><div className={`mt-2 line-clamp-2 text-sm leading-6 ${mutedClass(isDarkUi)}`}>{item.text || 'No preview available'}</div></div>)}
            </div>
          </AccordionSection>
        </div>
      </div>

      {isCancelDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-md">
          <div className={`w-full max-w-xl rounded-[1.8rem] border p-6 ${surfaceClass(isDarkUi)}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className={labelClass(isDarkUi)}>Recurring plan benefit</p>
                <h2 className={`mt-2 text-3xl font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>
                  Before you cancel, you still have a {recurringBenefit}% recurring benefit on {summary.plan.name}.
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsCancelDialogOpen(false)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}
              >
                Close
              </button>
            </div>

            <div className={`mt-5 rounded-[1.2rem] border p-4 ${cardInsetClass(isDarkUi)}`}>
              <div className={`text-sm font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>
                {summary.plan.name} renews at {formatCurrencyInr(summary.plan.pricing.recurringInr)} / month
              </div>
              <div className={`mt-2 text-sm leading-6 ${mutedClass(isDarkUi)}`}>
                The current recurring rate reflects your plan benefit versus the first-cycle pricing of{' '}
                {formatCurrencyInr(summary.plan.pricing.firstCycleInr)}. Cancellation itself is completed inside the Stripe billing portal.
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
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Receipt size={16} />
                    Continue to cancel
                  </div>
                  <div className="mt-2 text-xs">Your cancellation settings will be handled in the billing portal.</div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsCancelDialogOpen(false)}
                className={`rounded-full border px-4 py-2 text-sm font-semibold ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}
              >
                Keep my plan
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCancelDialogOpen(false);
                  void handleOpenPortal('cancel');
                }}
                disabled={portalIntent !== null}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold ${
                  isDarkUi
                    ? 'border-rose-300/20 bg-rose-400/12 text-rose-50 hover:bg-rose-400/18'
                    : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                }`}
              >
                {portalIntent === 'cancel' ? <Loader2 size={16} className="animate-spin" /> : null}
                Continue to billing portal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
