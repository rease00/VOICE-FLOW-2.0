/* eslint-disable react-refresh/only-export-components */
import React from 'react';
import { Bell, CalendarClock, CircleDollarSign, CreditCard, History, MessageSquareText, MonitorSmartphone, Moon, ShieldCheck, Sparkles, Sun, Wallet } from 'lucide-react';
import { EngineLogo } from '../EngineLogo';
import { GenerationSettings, VfUsageWindow } from '../../types';
import { AccountBillingSummary } from '../../services/accountService';
import { getEngineDisplayName } from '../../services/engineDisplay';
import { AccountTabKey } from './accountCenterTabs';

export const ENGINE_ORDER: GenerationSettings['engine'][] = ['KOKORO', 'NEURAL2', 'GEM'];

export const surfaceClass = (isDarkUi: boolean): string =>
  isDarkUi
    ? 'border-white/10 bg-[linear-gradient(180deg,rgba(10,15,27,0.9),rgba(8,13,24,0.76))] shadow-[0_20px_54px_rgba(2,6,23,0.42)]'
    : 'border-slate-200/90 bg-white/88 shadow-[0_18px_40px_rgba(15,23,42,0.08)]';

export const mutedClass = (isDarkUi: boolean): string => (isDarkUi ? 'text-slate-300' : 'text-slate-600');
export const subduedClass = (isDarkUi: boolean): string => (isDarkUi ? 'text-slate-400' : 'text-slate-500');
export const labelClass = (isDarkUi: boolean): string =>
  isDarkUi ? 'text-[11px] font-black uppercase tracking-[0.22em] text-slate-500' : 'text-[11px] font-black uppercase tracking-[0.22em] text-slate-400';
export const cardInsetClass = (isDarkUi: boolean): string =>
  isDarkUi ? 'border-white/10 bg-white/[0.04]' : 'border-slate-200/90 bg-slate-50/90';

export const formatNumber = (value: number): string => new Intl.NumberFormat('en-IN').format(Math.max(0, Number(value || 0)));
export const formatCompactNumber = (value: number): string =>
  new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.max(0, Number(value || 0)));
export const formatCurrencyMinor = (minor: number, currency: string): string => {
  const major = Number(minor || 0) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: String(currency || 'INR').toUpperCase(),
    maximumFractionDigits: 0,
  }).format(major);
};
export const formatCurrencyInr = (amount: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.max(0, Number(amount || 0)));
export const formatVfValue = (value: number): string => (Number.isFinite(value) ? `${formatNumber(value)} VF` : 'Unlimited');
export const formatDate = (value?: string | null, options?: Intl.DateTimeFormatOptions): string => {
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
export const formatDateTime = (value?: string | null): string =>
  formatDate(value, { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export const titleCase = (value: string): string =>
  String(value || '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
export const humanizeToken = (value?: string | null, fallback = '-'): string => {
  const token = String(value || '').trim();
  if (!token) return fallback;
  return titleCase(token);
};
export const formatProviderLabel = (value: string): string => {
  const token = String(value || '').trim();
  if (!token) return 'Unknown';
  if (token.includes('google')) return 'Google';
  if (token.includes('facebook')) return 'Facebook';
  if (token.includes('phone')) return 'Phone';
  if (token.includes('password')) return 'Email';
  return titleCase(token);
};
export const describePaymentMethod = (summary: AccountBillingSummary): string => {
  if (summary.paymentMethod?.brand && summary.paymentMethod?.last4) {
    return `${String(summary.paymentMethod.brand).toUpperCase()} ending in ${summary.paymentMethod.last4}`;
  }
  if (summary.billing.hasPortalAccess) return 'Payment method stored in Stripe Billing';
  return 'No payment method on file';
};

export const statusToneFromPriority = (priority?: string): 'success' | 'warning' | 'neutral' => {
  const token = String(priority || '').trim().toLowerCase();
  if (token === 'green') return 'success';
  if (token === 'yellow' || token === 'red') return 'warning';
  return 'neutral';
};

export const statusToneFromConversation = (status?: string): 'success' | 'warning' | 'neutral' => {
  const token = String(status || '').trim().toLowerCase();
  if (token === 'resolved') return 'success';
  if (token === 'ai_answered' || token === 'needs_human') return 'warning';
  return 'neutral';
};

export const StatusBadge: React.FC<{ isDarkUi: boolean; tone: 'success' | 'warning' | 'neutral'; label: string }> = ({ isDarkUi, tone, label }) => {
  const toneClass = tone === 'success'
    ? (isDarkUi ? 'border-emerald-400/25 bg-emerald-400/12 text-emerald-100' : 'border-emerald-200 bg-emerald-50 text-emerald-800')
    : tone === 'warning'
      ? (isDarkUi ? 'border-amber-400/25 bg-amber-400/12 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-800')
      : (isDarkUi ? 'border-white/10 bg-white/[0.06] text-slate-200' : 'border-slate-200 bg-slate-100 text-slate-700');
  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${toneClass}`}>{label}</span>;
};

export const InfoRow: React.FC<{ isDarkUi: boolean; label: string; value: string }> = ({ isDarkUi, label, value }) => (
  <div className={`rounded-[0.9rem] border px-3 py-2.5 ${cardInsetClass(isDarkUi)}`}>
    <div className={labelClass(isDarkUi)}>{label}</div>
    <div className={`mt-1.5 break-words text-sm font-medium ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{value}</div>
  </div>
);

export const AccountNavButton: React.FC<{
  isDarkUi: boolean;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  summary: string;
  onClick: () => void;
  buttonProps?: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onClick' | 'children'>;
  buttonRef?: React.Ref<HTMLButtonElement>;
}> = ({ isDarkUi, active, icon, label, summary, onClick, buttonProps, buttonRef }) => (
  <button
    {...buttonProps}
    ref={buttonRef}
    type="button"
    onClick={onClick}
    className={`flex w-full items-start gap-2.5 rounded-[1rem] border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 ${active ? (isDarkUi ? 'border-cyan-300/35 bg-cyan-400/12 text-white' : 'border-cyan-200 bg-cyan-50 text-slate-950') : `${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)} ${isDarkUi ? 'hover:bg-white/[0.06]' : 'hover:bg-white'}`}`}
  >
    <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${active ? (isDarkUi ? 'border-cyan-300/35 bg-cyan-400/10 text-cyan-100' : 'border-cyan-200 bg-white text-cyan-800') : `${cardInsetClass(isDarkUi)} ${isDarkUi ? 'text-cyan-200' : 'text-cyan-800'}`}`}>{icon}</div>
    <div className="min-w-0">
      <div className={`text-sm font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{label}</div>
      <div className={`mt-1 line-clamp-1 text-xs leading-5 ${subduedClass(isDarkUi)}`}>{summary}</div>
    </div>
  </button>
);

export const AccountSummaryStrip: React.FC<{ isDarkUi: boolean; items: Array<{ id: string; label: string; value: string; detail: string }> }> = ({ isDarkUi, items }) => (
  <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:gap-2.5 sm:overflow-visible sm:pb-0 xl:grid-cols-4">
    {items.map((item) => (
      <div key={item.id} className={`min-w-[178px] snap-start rounded-[1rem] border px-3 py-2.5 sm:min-w-0 ${cardInsetClass(isDarkUi)}`}>
        <div className={labelClass(isDarkUi)}>{item.label}</div>
        <div className={`mt-1.5 text-sm font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{item.value}</div>
        <div className={`mt-1 line-clamp-2 text-[11px] leading-4 ${subduedClass(isDarkUi)}`}>{item.detail}</div>
      </div>
    ))}
  </div>
);

export const ThemeButton: React.FC<{ active: boolean; isDarkUi: boolean; icon: React.ReactNode; title: string; onClick: () => void }> = ({ active, isDarkUi, icon, title, onClick }) => (
  <button type="button" onClick={onClick} className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${active ? (isDarkUi ? 'border-cyan-300/45 bg-cyan-400/15 text-white' : 'border-cyan-300 bg-cyan-50 text-cyan-900') : `${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}`}>{icon}{title}</button>
);

export const PreferenceToggle: React.FC<{ isDarkUi: boolean; title: string; detail: string; checked: boolean; onToggle: () => void }> = ({ isDarkUi, title, detail, checked, onToggle }) => (
  <button type="button" onClick={onToggle} className={`flex w-full items-center justify-between rounded-[0.95rem] border px-3 py-2.5 text-left transition ${cardInsetClass(isDarkUi)} ${isDarkUi ? 'hover:bg-white/[0.06]' : 'hover:bg-white'}`}>
    <div className="pr-4">
      <div className={`text-sm font-semibold ${isDarkUi ? 'text-slate-100' : 'text-slate-900'}`}>{title}</div>
      <div className={`mt-1 text-xs ${subduedClass(isDarkUi)}`}>{detail}</div>
    </div>
    <div className={`relative h-7 w-12 rounded-full transition ${checked ? (isDarkUi ? 'bg-cyan-400' : 'bg-cyan-500') : (isDarkUi ? 'bg-slate-700' : 'bg-slate-300')}`}>
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'left-6' : 'left-1'}`} />
    </div>
  </button>
);

export const MetricCard: React.FC<{ isDarkUi: boolean; icon: React.ReactNode; eyebrow: string; title: string; detail: string }> = ({ isDarkUi, icon, eyebrow, title, detail }) => (
  <div className={`rounded-[1.05rem] border p-3 ${cardInsetClass(isDarkUi)}`}>
    <div className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-xl border ${cardInsetClass(isDarkUi)} ${isDarkUi ? 'text-cyan-200' : 'text-cyan-800'}`}>{icon}</div>
    <p className={labelClass(isDarkUi)}>{eyebrow}</p>
    <div className={`mt-1.5 text-base font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{title}</div>
    <div className={`mt-1 text-xs leading-5 ${subduedClass(isDarkUi)}`}>{detail}</div>
  </div>
);

export const WindowCard: React.FC<{ title: string; data: VfUsageWindow; isDarkUi: boolean }> = ({ title, data, isDarkUi }) => (
  <div className={`rounded-[1.05rem] border p-3 ${cardInsetClass(isDarkUi)}`}>
    <div className="mb-3 flex items-center justify-between gap-3">
      <div>
        <p className={labelClass(isDarkUi)}>{title}</p>
        <h3 className={`mt-1.5 text-lg font-semibold ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{formatNumber(data.totalVf)} VF</h3>
      </div>
      <div className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${cardInsetClass(isDarkUi)} ${mutedClass(isDarkUi)}`}>{formatCompactNumber(data.totalChars)} chars</div>
    </div>
    <div className="space-y-2">
      {ENGINE_ORDER.map((engine) => (
        <div key={engine} className={`flex items-center justify-between rounded-xl border px-3 py-1.5 ${cardInsetClass(isDarkUi)}`}>
          <div className={`flex items-center gap-2 ${mutedClass(isDarkUi)}`}>
            <EngineLogo engine={engine} size="sm" variant="ringed" />
            <span className="text-xs font-medium">{getEngineDisplayName(engine)}</span>
          </div>
          <span className={`text-xs font-semibold ${isDarkUi ? 'text-cyan-200' : 'text-cyan-800'}`}>{formatNumber(data.byEngine[engine]?.vf || 0)} VF</span>
        </div>
      ))}
    </div>
  </div>
);

export const ACCOUNT_TAB_ICONS: Record<AccountTabKey, React.ReactNode> = {
  account: <ShieldCheck size={18} />,
  billing: <CreditCard size={18} />,
  usage: <History size={18} />,
  preferences: <MonitorSmartphone size={18} />,
  support: <MessageSquareText size={18} />,
  activity: <Bell size={18} />,
};

export const SUMMARY_ICONS = {
  account: <ShieldCheck size={18} />,
  billing: <CreditCard size={18} />,
  usage: <History size={18} />,
  preferences: <MonitorSmartphone size={18} />,
  support: <MessageSquareText size={18} />,
  activity: <Bell size={18} />,
  currentPlan: <CircleDollarSign size={18} />,
  renewal: <CalendarClock size={18} />,
  balance: <Wallet size={18} />,
  spendable: <Sparkles size={18} />,
  light: <Sun size={16} />,
  dark: <Moon size={16} />,
} as const;
