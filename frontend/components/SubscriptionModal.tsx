import React, { useMemo, useState } from 'react';
import { Check, Crown, Loader2, ShieldCheck, Sparkles, X } from 'lucide-react';
import { Button } from './Button';
import { useUser } from '../contexts/UserContext';
import { useBillingActions } from '../src/features/billing/hooks/useBillingActions';
import { STORAGE_KEYS } from '../src/shared/storage/keys';
import { readStorageJson } from '../src/shared/storage/localStore';

const resolveBackendUrl = (): string => {
  const parsed = readStorageJson<{ mediaBackendUrl?: string }>(STORAGE_KEYS.settings);
  return String(parsed?.mediaBackendUrl || '').trim() || 'http://127.0.0.1:7800';
};

interface PlanCardConfig {
  id: 'starter' | 'creator' | 'pro' | 'scale';
  title: string;
  priceLabel: string;
  description: string;
  bullets: string[];
  actionPlan?: 'pro' | 'plus';
  highlight?: boolean;
  ribbon?: string;
  note?: string;
}

export const SubscriptionModal: React.FC = () => {
  const { showSubscriptionModal, setShowSubscriptionModal, stats, refreshEntitlements } = useUser();
  const billingActions = useBillingActions({ baseUrl: resolveBackendUrl() });
  const [isLoading, setIsLoading] = useState<'pro' | 'plus' | 'portal' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const planBadge = useMemo(() => stats.planName, [stats.planName]);
  if (!showSubscriptionModal) return null;

  const currentCardId: PlanCardConfig['id'] = planBadge === 'Plus' ? 'scale' : planBadge === 'Pro' ? 'pro' : 'starter';

  const plans: PlanCardConfig[] = [
    {
      id: 'starter',
      title: 'Starter',
      priceLabel: 'Preview tier',
      description: 'For hobbyists creating projects with AI audio.',
      bullets: ['30,000 credits style layout', 'Preview card only', 'No direct checkout from this card'],
    },
    {
      id: 'creator',
      title: 'Creator',
      priceLabel: 'Preview tier',
      description: 'For creators making premium content for global audiences.',
      bullets: ['100,000 credits style layout', 'Most popular visual treatment', 'No direct checkout from this card'],
      highlight: true,
      ribbon: 'Most Popular',
    },
    {
      id: 'pro',
      title: 'Pro',
      priceLabel: 'INR 699 / month',
      description: 'Mapped to your current Pro checkout plan.',
      bullets: ['200,000 VF / month', 'Lower VF rate than Free', 'Live checkout enabled'],
      actionPlan: 'pro',
    },
    {
      id: 'scale',
      title: 'Scale',
      priceLabel: 'INR 2,000 / month',
      description: 'Large capacity visual tier mapped to current Plus checkout.',
      bullets: ['500,000 VF / month', 'Best current VF rate', 'Live checkout enabled'],
      actionPlan: 'plus',
      note: 'Uses current Plus checkout under the hood.',
    },
  ];

  const handleClose = () => {
    setShowSubscriptionModal(false);
    setError(null);
  };

  const startCheckout = async (plan: 'pro' | 'plus') => {
    setError(null);
    setIsLoading(plan);
    try {
      const { url } = await billingActions.startPlanCheckout(plan);
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
    await refreshEntitlements();
    handleClose();
  };

  const isCurrentPlanCard = (card: PlanCardConfig): boolean => card.id === currentCardId;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-6xl sm:rounded-3xl rounded-t-3xl overflow-hidden shadow-2xl relative max-h-[94vh] overflow-y-auto">
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors z-10"
          aria-label="Close subscription modal"
        >
          <X size={20} className="text-gray-600" />
        </button>

        <div className="p-6 pt-12 sm:p-8 sm:pt-12">
          <div className="text-center mb-6">
            <div className="w-14 h-14 bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl mx-auto flex items-center justify-center shadow-lg shadow-orange-200 mb-3">
              <Crown size={28} className="text-white" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Upgrade Plan</h2>
            <p className="text-gray-500 mt-2">
              Current plan: <span className="font-semibold text-gray-800">{planBadge}</span>
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-4 sm:grid-cols-2 grid-cols-1">
            {plans.map((plan) => {
              const loadingKey = plan.actionPlan ? plan.actionPlan : null;
              const isLoadingCard = loadingKey !== null && isLoading === loadingKey;
              const isCurrent = isCurrentPlanCard(plan);
              const isClickable = Boolean(plan.actionPlan);

              return (
                <article
                  key={plan.id}
                  className={[
                    'rounded-2xl border p-4 flex flex-col',
                    plan.highlight ? 'border-gray-300 bg-gray-50/80 shadow-sm' : 'border-gray-200 bg-white',
                    isCurrent ? 'ring-2 ring-emerald-300' : '',
                  ].join(' ')}
                >
                  {plan.ribbon && (
                    <div className="mb-3 inline-flex items-center gap-1 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-bold text-gray-800 w-fit">
                      <Sparkles size={11} />
                      {plan.ribbon}
                    </div>
                  )}

                  <h3 className="text-[28px] leading-none font-bold text-gray-900">{plan.title}</h3>
                  <p className="mt-2 text-2xl font-extrabold text-gray-900">{plan.priceLabel}</p>
                  <p className="mt-2 text-sm text-gray-600 min-h-[3rem]">{plan.description}</p>

                  <button
                    onClick={() => (plan.actionPlan ? void startCheckout(plan.actionPlan) : undefined)}
                    disabled={!isClickable || Boolean(isLoading) || isCurrent}
                    className={[
                      'mt-4 h-10 rounded-xl text-sm font-semibold border transition-colors',
                      isClickable
                        ? 'border-gray-900 bg-gray-900 text-white hover:bg-black disabled:opacity-60'
                        : 'border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed',
                    ].join(' ')}
                  >
                    {isCurrent ? 'Current Plan' : isClickable ? 'Subscribe' : 'Preview'}
                  </button>

                  {isLoadingCard && (
                    <div className="mt-2 inline-flex items-center gap-1 text-xs text-indigo-600">
                      <Loader2 size={13} className="animate-spin" />
                      Redirecting to checkout...
                    </div>
                  )}

                  <div className="mt-4 border-t border-gray-200 pt-3 space-y-2 text-sm text-gray-700">
                    {plan.bullets.map((bullet) => (
                      <div key={bullet} className="flex items-start gap-2">
                        <Check size={14} className="mt-0.5 text-emerald-600 shrink-0" />
                        <span>{bullet}</span>
                      </div>
                    ))}
                  </div>

                  {plan.note && (
                    <p className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-2 py-1.5 text-[11px] font-medium text-amber-800">
                      {plan.note}
                    </p>
                  )}
                </article>
              );
            })}
          </div>

          <div className="mt-6 grid sm:grid-cols-2 grid-cols-1 gap-2">
            <Button
              fullWidth
              onClick={() => void openPortal()}
              disabled={Boolean(isLoading)}
              className="bg-gray-900"
            >
              {isLoading === 'portal' ? <Loader2 className="animate-spin" /> : 'Manage Billing'}
            </Button>
            <Button fullWidth onClick={() => void refreshUsage()} className="bg-indigo-600 hover:bg-indigo-700">
              Refresh Usage
            </Button>
          </div>

          <div className="flex items-center justify-center gap-2 text-xs text-gray-400 mt-4">
            <ShieldCheck size={12} /> Secure Stripe checkout with INR base pricing
          </div>
        </div>
      </div>
    </div>
  );
};
