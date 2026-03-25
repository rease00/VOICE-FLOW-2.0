'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, CreditCard, Sparkles, Wallet } from 'lucide-react';
import type { BillingPlanKey, TokenPackKey } from '../../services/accountService';
import { useBillingActions } from '../features/billing/hooks/useBillingActions';
import { resolveApiBaseUrl } from '../shared/api/config';
import { STORAGE_KEYS } from '../shared/storage/keys';
import { readStorageJson } from '../shared/storage/localStore';
import { BrandLogo } from '../../components/BrandLogo';
import { LegalLinks } from './LegalLinks';

type BillingTab = 'subscription' | 'token-buy' | 'voice-clone';

const appBillingUrl = '/app?vf-screen=profile&vf-tab=billing';

const resolveBackendUrl = (): string => {
  const parsed = readStorageJson<{ mediaBackendUrl?: string }>(STORAGE_KEYS.settings);
  return resolveApiBaseUrl(parsed?.mediaBackendUrl);
};

const formatInr = (amount: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.max(0, Number(amount || 0)));

const formatVfCount = (amount: number): string =>
  new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(Math.max(0, Number(amount || 0)));

const PLAN_ROWS: Array<{ key: BillingPlanKey; name: string; priceInr: number; vfCredits: number }> = [
  { key: 'launcher', name: 'Launcher', priceInr: 129, vfCredits: 30000 },
  { key: 'starter', name: 'Starter', priceInr: 450, vfCredits: 65000 },
  { key: 'creator', name: 'Creator', priceInr: 1499, vfCredits: 225000 },
  { key: 'pro', name: 'Pro', priceInr: 2999, vfCredits: 500000 },
  { key: 'scale', name: 'Scale', priceInr: 4500, vfCredits: 850000 },
];

const TOKEN_PACK_ROWS: Array<{ key: TokenPackKey; label: string; vf: number; priceInr: number }> = [
  { key: 'micro', label: 'Micro', vf: 50000, priceInr: 550 },
  { key: 'standard', label: 'Standard', vf: 150000, priceInr: 1450 },
  { key: 'mega', label: 'Mega', vf: 300000, priceInr: 2900 },
  { key: 'ultra', label: 'Ultra', vf: 600000, priceInr: 5200 },
];

const resolveTabFromUrl = (): BillingTab => {
  if (typeof window === 'undefined') return 'subscription';
  const token = String(new URLSearchParams(window.location.search).get('tab') || '').trim().toLowerCase();
  if (token === 'subscription') return 'subscription';
  if (token === 'token-buy' || token === 'token' || token === 'buy') return 'token-buy';
  if (token === 'voice-clone' || token === 'vc-token' || token === 'vc') return 'voice-clone';
  return 'subscription';
};

const resolveReturnState = (): 'success' | 'cancel' | '' => {
  if (typeof window === 'undefined') return '';
  const token = String(new URLSearchParams(window.location.search).get('billing') || '').trim().toLowerCase();
  if (token === 'success' || token === 'cancel') return token;
  return '';
};

export const BillingLanding: React.FC = () => {
  const [activeTab, setActiveTab] = useState<BillingTab>('subscription');
  const [couponCode, setCouponCode] = useState('');
  const [selectedPack, setSelectedPack] = useState<TokenPackKey>('standard');
  const [loadingKey, setLoadingKey] = useState('');
  const [error, setError] = useState('');
  const [returnState, setReturnState] = useState<'success' | 'cancel' | ''>('');
  const billingActions = useBillingActions({ baseUrl: resolveBackendUrl() });

  const fallbackPack = TOKEN_PACK_ROWS[1] ?? TOKEN_PACK_ROWS[0]!;
  const selectedPackSummary = useMemo(
    () => TOKEN_PACK_ROWS.find((item) => item.key === selectedPack) || fallbackPack,
    [fallbackPack, selectedPack]
  );

  useEffect(() => {
    setActiveTab(resolveTabFromUrl());
    setReturnState(resolveReturnState());
  }, []);

  const setTab = (tab: BillingTab) => {
    setActiveTab(tab);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const handlePlanCheckout = async (planKey: BillingPlanKey) => {
    setError('');
    setLoadingKey(`plan:${planKey}`);
    try {
      const code = couponCode.trim();
      const result = await billingActions.startPlanCheckout(planKey, code || undefined);
      if (!result.url) throw new Error('Checkout URL is missing.');
      window.location.href = result.url;
    } catch (checkoutError: any) {
      setError(checkoutError?.message || 'Could not start subscription checkout.');
    } finally {
      setLoadingKey('');
    }
  };

  const handleTokenCheckout = async () => {
    setError('');
    setLoadingKey(`token:${selectedPack}`);
    try {
      const result = await billingActions.startTokenPackCheckout(selectedPack);
      if (!result.url) throw new Error('Checkout URL is missing.');
      window.location.href = result.url;
    } catch (checkoutError: any) {
      setError(checkoutError?.message || 'Could not start token-pack checkout.');
    } finally {
      setLoadingKey('');
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f2f6ff] text-slate-900">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(78%_72%_at_6%_8%,rgba(14,165,233,0.18),transparent_62%),radial-gradient(72%_68%_at_92%_10%,rgba(16,185,129,0.12),transparent_64%),radial-gradient(80%_72%_at_50%_95%,rgba(37,99,235,0.12),transparent_72%)]" />

      <header className="relative z-10">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 pb-2 pt-5 sm:px-6 sm:pt-8">
          <BrandLogo size="md" tone="dark" />
          <div className="flex items-center gap-2">
            <a
              href="/"
              className="rounded-full border border-sky-200 bg-white/85 px-4 py-2 text-xs font-semibold text-sky-700 transition hover:bg-sky-50"
            >
              Home
            </a>
            <a
              href={appBillingUrl}
              className="rounded-full bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-cyan-200 transition hover:translate-y-[-1px] hover:brightness-105"
            >
              Open App Billing
            </a>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-10 sm:px-6">
        <section className="rounded-[2rem] border border-white/80 bg-white/85 p-5 shadow-2xl shadow-sky-100/70 backdrop-blur sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700">
                Billing Center
              </p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                Subscription, Token Buy, and Credit Rules
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                Calculated using your rules: 1.5 VF = 1 Char / 15 Chars = 1 Sec
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">
              Direct token buys are valid for 3 months.
            </div>
          </div>

          {returnState ? (
            <div
              className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
                returnState === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              {returnState === 'success'
                ? 'Payment completed. Open app billing to refresh your live account summary.'
                : 'Checkout was canceled. You can try again anytime.'}
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="mt-6 grid gap-2 rounded-2xl border border-sky-100 bg-sky-50/60 p-1 sm:inline-grid sm:grid-cols-3">
            <button
              type="button"
              onClick={() => setTab('subscription')}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                activeTab === 'subscription' ? 'bg-white text-sky-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Subscription
            </button>
            <button
              type="button"
              onClick={() => setTab('token-buy')}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                activeTab === 'token-buy' ? 'bg-white text-sky-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Direct Token Buy
            </button>
            <button
              type="button"
              onClick={() => setTab('voice-clone')}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                activeTab === 'voice-clone' ? 'bg-white text-sky-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Voice Clone - VC Token
            </button>
          </div>

          {activeTab === 'subscription' ? (
            <div className="mt-6 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <CreditCard size={16} />
                  Choose Subscription Plan
                </div>
                <div className="space-y-2">
                  {PLAN_ROWS.map((plan) => (
                    <div key={plan.key} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{plan.name}</div>
                          <div className="text-xs text-slate-600">{formatVfCount(plan.vfCredits)} VF credits</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">{formatInr(plan.priceInr)}</span>
                          <button
                            type="button"
                            onClick={() => void handlePlanCheckout(plan.key)}
                            disabled={Boolean(loadingKey)}
                            className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {loadingKey === `plan:${plan.key}` ? 'Starting...' : 'Checkout'}
                            <ArrowRight size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    value={couponCode}
                    onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                    placeholder="Optional coupon code"
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 sm:w-64"
                  />
                  <a href={appBillingUrl} className="text-xs font-semibold text-sky-700 hover:text-sky-900">
                    Need sign-in help?
                  </a>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Sparkles size={16} />
                  Conversion Table
                </div>
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
                      <tr>
                        <th className="px-3 py-2">Plan Name</th>
                        <th className="px-3 py-2">Price (₹)</th>
                        <th className="px-3 py-2">VF Credits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {PLAN_ROWS.map((plan) => (
                        <tr key={`table-${plan.key}`} className="border-t border-slate-200">
                          <td className="px-3 py-2 font-semibold text-slate-900">{plan.name}</td>
                          <td className="px-3 py-2 text-slate-700">{formatInr(plan.priceInr)}</td>
                          <td className="px-3 py-2 text-slate-700">{formatVfCount(plan.vfCredits)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === 'token-buy' ? (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Wallet size={16} />
                Direct Token Buy
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Token pack</label>
                  <select
                    value={selectedPack}
                    onChange={(event) => setSelectedPack(String(event.target.value || 'standard') as TokenPackKey)}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800"
                  >
                    {TOKEN_PACK_ROWS.map((pack) => (
                      <option key={pack.key} value={pack.key}>
                        {pack.label} - {formatVfCount(pack.vf)} VF - {formatInr(pack.priceInr)}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-slate-600">
                    Selected: {formatVfCount(selectedPackSummary.vf)} VF for {formatInr(selectedPackSummary.priceInr)}.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleTokenCheckout()}
                  disabled={Boolean(loadingKey)}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingKey === `token:${selectedPack}` ? 'Starting checkout...' : 'Buy Token Pack'}
                  <ArrowRight size={15} />
                </button>
              </div>
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
                All direct token buys are valid for 3 months from purchase date.
              </div>
            </div>
          ) : null}

          {activeTab === 'voice-clone' ? (
            <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white/70 p-8 text-center">
              <CheckCircle2 className="mx-auto h-6 w-6 text-slate-400" />
              <div className="mt-2 text-sm font-semibold text-slate-700">VC Token Section</div>
              <p className="mt-1 text-xs text-slate-500">Intentionally kept blank for now.</p>
            </div>
          ) : null}
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/80 bg-white/75">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 sm:px-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-600">© {new Date().getFullYear()} VoiceFlow Billing.</p>
          <LegalLinks />
        </div>
      </footer>
    </div>
  );
};
