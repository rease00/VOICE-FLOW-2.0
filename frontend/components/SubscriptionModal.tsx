import React, { useMemo, useState } from 'react';
import { ArrowRight, Check, Crown, RefreshCw, ShieldCheck, Sparkles, Wallet, X } from 'lucide-react';
import { Button } from './Button';
import { useUser } from '../contexts/UserContext';
import { useBillingActions } from '../src/features/billing/hooks/useBillingActions';
import { resolveApiBaseUrl } from '../src/shared/api/config';
import { STORAGE_KEYS } from '../src/shared/storage/keys';
import { readStorageJson } from '../src/shared/storage/localStore';
import type { BillingPlanKey } from '../services/accountService';

const resolveBackendUrl = (): string => {
  const parsed = readStorageJson<{ mediaBackendUrl?: string }>(STORAGE_KEYS.settings);
  return resolveApiBaseUrl(parsed?.mediaBackendUrl);
};

interface PlanCardConfig {
  id: BillingPlanKey;
  title: string;
  firstCycleInr: number;
  recurringInr: number;
  description: string;
  bullets: string[];
  actionPlan: BillingPlanKey;
  highlight?: boolean;
  ribbon?: string;
}

const formatInr = (amount: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.max(0, Number(amount || 0)));

const resolveCurrentPlanCard = (planName: string): PlanCardConfig['id'] | null => {
  const token = String(planName || '').trim().toLowerCase();
  if (token === 'starter') return 'starter';
  if (token === 'creator') return 'creator';
  if (token === 'pro') return 'pro';
  if (token === 'scale' || token === 'plus') return 'scale';
  return null;
};

export const SubscriptionModal: React.FC = () => {
  const { showSubscriptionModal, setShowSubscriptionModal, stats, refreshEntitlements } = useUser();
  const billingActions = useBillingActions({ baseUrl: resolveBackendUrl() });
  const [isLoading, setIsLoading] = useState<BillingPlanKey | 'portal' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshingUsage, setIsRefreshingUsage] = useState(false);
  const [subscriptionCouponCode, setSubscriptionCouponCode] = useState('');

  const planBadge = useMemo(() => stats.planName, [stats.planName]);
  const isDarkUi = typeof document !== 'undefined' && document.body.classList.contains('theme-dark');
  if (!showSubscriptionModal) return null;

  const currentCardId = resolveCurrentPlanCard(planBadge);
  const isBusy = Boolean(isLoading) || isRefreshingUsage;

  const plans: PlanCardConfig[] = [
    {
      id: 'starter',
      title: 'Starter',
      firstCycleInr: 450,
      recurringInr: 405,
      description: 'Best for consistent monthly AI audio output.',
      bullets: ['50,000 VF monthly cap', 'All engines, 10k chars per generation', 'Priority support'],
      actionPlan: 'starter',
    },
    {
      id: 'creator',
      title: 'Creator',
      firstCycleInr: 1200,
      recurringInr: 1080,
      description: 'For creators publishing regularly at higher volume.',
      bullets: ['150,000 VF monthly cap', 'All engines, 10k chars per generation', 'Priority support'],
      actionPlan: 'creator',
      highlight: true,
      ribbon: 'Most Popular',
    },
    {
      id: 'pro',
      title: 'Pro',
      firstCycleInr: 2400,
      recurringInr: 2160,
      description: 'For heavy production workloads and team throughput.',
      bullets: ['300,000 VF monthly cap', 'All engines, 10k chars per generation', 'Priority support'],
      actionPlan: 'pro',
    },
    {
      id: 'scale',
      title: 'Scale',
      firstCycleInr: 4300,
      recurringInr: 3440,
      description: 'For highest-volume pipelines and release velocity.',
      bullets: ['600,000 VF monthly cap', 'All engines, 15k chars per generation', 'Early access to all future features'],
      actionPlan: 'scale',
      ribbon: 'Early Access',
    },
  ];

  const handleClose = () => {
    setShowSubscriptionModal(false);
    setError(null);
  };

  const startCheckout = async (plan: BillingPlanKey) => {
    setError(null);
    setIsLoading(plan);
    try {
      const code = subscriptionCouponCode.trim();
      const { url } = await billingActions.startPlanCheckout(plan, code || undefined);
      if (!url) throw new Error('Checkout URL is missing.');
      window.location.href = url;
    } catch (checkoutError: any) {
      setError(checkoutError?.message || 'Could not start checkout.');
      setIsLoading(null);
    }
  };

  const openPortal = async () => {
    setError(null);
    setIsLoading('portal');
    try {
      const { url } = await billingActions.openBillingPortal();
      if (!url) throw new Error('Billing portal URL is missing.');
      window.location.href = url;
    } catch (portalError: any) {
      setError(portalError?.message || 'Could not open billing portal.');
      setIsLoading(null);
    }
  };

  const refreshUsage = async () => {
    setError(null);
    setIsRefreshingUsage(true);
    try {
      await refreshEntitlements();
      handleClose();
    } catch (refreshError: any) {
      setError(refreshError?.message || 'Could not refresh usage.');
    } finally {
      setIsRefreshingUsage(false);
    }
  };

  const isCurrentPlanCard = (card: PlanCardConfig): boolean => card.id === currentCardId;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/72 px-3 py-3 backdrop-blur-md animate-in fade-in duration-200 sm:items-center sm:px-6 sm:py-6">
      <div
        className={[
          'relative w-full max-w-6xl overflow-hidden rounded-[2rem] border shadow-[0_30px_90px_rgba(2,6,23,0.52)]',
          'max-h-[94vh] overflow-y-auto',
          isDarkUi
            ? 'border-cyan-400/18 bg-[linear-gradient(180deg,rgba(5,12,26,0.98),rgba(8,19,38,0.95))] text-slate-100'
            : 'border-slate-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,250,255,0.98))] text-slate-900',
        ].join(' ')}
      >
        <div
          className={[
            'pointer-events-none absolute inset-x-0 top-0 h-48',
            isDarkUi
              ? 'bg-[radial-gradient(82%_120%_at_50%_0%,rgba(34,211,238,0.18),transparent_70%)]'
              : 'bg-[radial-gradient(82%_120%_at_50%_0%,rgba(56,189,248,0.16),transparent_72%)]',
          ].join(' ')}
        />

        <button
          onClick={handleClose}
          className={[
            'absolute right-4 top-4 z-10 rounded-full p-2 transition-colors',
            isDarkUi ? 'bg-white/6 hover:bg-white/12' : 'bg-slate-100 hover:bg-slate-200',
          ].join(' ')}
          aria-label="Close subscription modal"
        >
          <X size={20} className={isDarkUi ? 'text-slate-300' : 'text-slate-600'} />
        </button>

        <div className="relative p-5 pt-12 sm:p-8 sm:pt-12">
          <div className="mb-7 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg shadow-orange-500/20">
              <Crown size={28} className="text-white" />
            </div>
            <div className={`text-[11px] font-black uppercase tracking-[0.22em] ${isDarkUi ? 'text-cyan-200/80' : 'text-cyan-700/70'}`}>
              Billing
            </div>
            <h2 className={`mt-2 text-3xl font-semibold tracking-tight ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>Upgrade Plan</h2>
            <p className={`mx-auto mt-2 max-w-2xl text-sm leading-6 ${isDarkUi ? 'text-slate-300' : 'text-slate-600'}`}>
              Cleaner pricing, larger monthly caps, and checkout that stays inside the project billing flow.
            </p>
            <div className="mt-4 flex items-center justify-center">
              <span
                className={[
                  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold',
                  isDarkUi
                    ? 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100'
                    : 'border-cyan-200 bg-cyan-50 text-cyan-800',
                ].join(' ')}
              >
                <Sparkles size={12} />
                Current plan: {planBadge}
              </span>
            </div>
          </div>

          {error && (
            <div
              className={[
                'mb-4 rounded-2xl border px-4 py-3 text-sm',
                isDarkUi
                  ? 'border-rose-400/25 bg-rose-500/10 text-rose-100'
                  : 'border-rose-200 bg-rose-50 text-rose-700',
              ].join(' ')}
            >
              {error}
            </div>
          )}

          <div
            className={[
              'mb-5 rounded-[1.4rem] border px-4 py-4',
              isDarkUi ? 'border-slate-700/80 bg-slate-950/45' : 'border-slate-200 bg-slate-50/90',
            ].join(' ')}
          >
            <label className={`mb-1 block text-[11px] font-black uppercase tracking-[0.18em] ${isDarkUi ? 'text-slate-400' : 'text-slate-500'}`}>
              Subscription Coupon (Optional)
            </label>
            <input
              value={subscriptionCouponCode}
              onChange={(event) => setSubscriptionCouponCode(event.target.value)}
              placeholder="Enter coupon code"
              className={[
                'h-11 w-full rounded-xl border px-3 text-sm outline-none transition-colors',
                isDarkUi
                  ? 'border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500 focus:border-cyan-400'
                  : 'border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:border-slate-900',
              ].join(' ')}
            />
            <p className={`mt-2 text-[11px] ${isDarkUi ? 'text-slate-400' : 'text-slate-500'}`}>
              If valid, this applies to the first invoice. Stripe promotion codes still work at checkout.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {plans.map((plan) => {
              const isLoadingCard = isLoading === plan.actionPlan;
              const isCurrent = isCurrentPlanCard(plan);
              const recurringBenefit = Math.max(
                0,
                Math.round(((plan.firstCycleInr - plan.recurringInr) / Math.max(plan.firstCycleInr, 1)) * 100)
              );

              return (
                <article
                  key={plan.id}
                  className={[
                    'vf-surface-card relative flex h-full flex-col rounded-[1.5rem] border p-5 transition-all duration-200',
                    plan.highlight ? 'translate-y-0 sm:-translate-y-1' : '',
                    isCurrent
                      ? (isDarkUi
                        ? 'border-emerald-400/45 ring-2 ring-emerald-300/55'
                        : 'border-emerald-300 ring-2 ring-emerald-200')
                      : '',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      {plan.ribbon ? (
                        <div
                          className={[
                            'mb-3 inline-flex w-fit items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide',
                            plan.highlight
                              ? (isDarkUi
                                ? 'border-indigo-400/35 bg-indigo-500/14 text-indigo-100'
                                : 'border-indigo-200 bg-indigo-50 text-indigo-700')
                              : (isDarkUi
                                ? 'border-amber-400/25 bg-amber-500/10 text-amber-100'
                                : 'border-amber-200 bg-amber-50 text-amber-700'),
                          ].join(' ')}
                        >
                          <Sparkles size={11} />
                          {plan.ribbon}
                        </div>
                      ) : null}
                      <h3 className={`text-[1.9rem] font-semibold leading-none ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{plan.title}</h3>
                      <p className={`mt-2 min-h-[3rem] text-sm leading-6 ${isDarkUi ? 'text-slate-300' : 'text-slate-600'}`}>{plan.description}</p>
                    </div>
                    {isCurrent ? (
                      <span
                        className={[
                          'inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide',
                          isDarkUi
                            ? 'border-emerald-400/30 bg-emerald-500/12 text-emerald-100'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700',
                        ].join(' ')}
                      >
                        Current
                      </span>
                    ) : null}
                  </div>

                  <div className={`mt-4 rounded-[1.25rem] border px-4 py-4 ${isDarkUi ? 'border-slate-700/70 bg-slate-950/50' : 'border-slate-200 bg-white/80'}`}>
                    <div className={`text-[11px] font-black uppercase tracking-[0.18em] ${isDarkUi ? 'text-slate-400' : 'text-slate-500'}`}>Month 1</div>
                    <div className={`mt-2 text-3xl font-semibold tracking-tight ${isDarkUi ? 'text-white' : 'text-slate-950'}`}>{formatInr(plan.firstCycleInr)}</div>
                    <div className={`mt-2 text-sm font-semibold ${isDarkUi ? 'text-cyan-200' : 'text-cyan-800'}`}>{formatInr(plan.recurringInr)} / month after that</div>
                    <div className={`mt-2 text-[11px] ${isDarkUi ? 'text-slate-400' : 'text-slate-500'}`}>
                      {recurringBenefit > 0 ? `Recurring rate stays ${recurringBenefit}% lower after the first month.` : 'No recurring discount on this plan.'}
                    </div>
                  </div>

                  <div className={`mt-4 space-y-2 border-t pt-4 text-sm ${isDarkUi ? 'border-slate-700/80 text-slate-200' : 'border-slate-200 text-slate-700'}`}>
                    {plan.bullets.map((bullet) => (
                      <div key={bullet} className="flex items-start gap-2">
                        <Check size={14} className="mt-0.5 shrink-0 text-emerald-500" />
                        <span>{bullet}</span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5">
                    <Button
                      fullWidth
                      onClick={() => void startCheckout(plan.actionPlan)}
                      isLoading={isLoadingCard}
                      disabled={isBusy || isCurrent}
                      className={[
                        'h-11 rounded-xl border text-sm font-semibold',
                        isCurrent
                          ? 'cursor-default border-transparent bg-slate-400/30 text-slate-500'
                          : plan.highlight
                            ? 'border-indigo-400/40 bg-indigo-600 hover:bg-indigo-500'
                            : 'border-cyan-400/20 bg-slate-900 hover:bg-slate-950',
                      ].join(' ')}
                    >
                      {isCurrent ? 'Current Plan' : 'Choose Plan'}
                      {!isCurrent ? <ArrowRight size={15} className="ml-2" /> : null}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Button
              fullWidth
              onClick={() => void openPortal()}
              isLoading={isLoading === 'portal'}
              disabled={isBusy}
              variant="secondary"
              className={[
                'h-11 rounded-xl border',
                isDarkUi
                  ? 'border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800'
                  : 'border-slate-300 bg-white text-slate-900 hover:bg-slate-50',
              ].join(' ')}
            >
              <Wallet size={15} className="mr-2" />
              Open Billing Portal
            </Button>
            <Button
              fullWidth
              onClick={() => void refreshUsage()}
              isLoading={isRefreshingUsage}
              disabled={isBusy}
              className="h-11 rounded-xl bg-indigo-600 hover:bg-indigo-500"
            >
              <RefreshCw size={15} className="mr-2" />
              Refresh Usage
            </Button>
          </div>

          <div className={`mt-4 flex items-center justify-center gap-2 text-xs ${isDarkUi ? 'text-slate-400' : 'text-slate-500'}`}>
            <ShieldCheck size={12} /> Secure Stripe checkout with INR base pricing
          </div>
        </div>
      </div>
    </div>
  );
};
