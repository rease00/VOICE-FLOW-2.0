import React, { useMemo, useState } from 'react';
import { Check, Crown, Loader2, ShieldCheck, X } from 'lucide-react';
import { Button } from './Button';
import { useUser } from '../contexts/UserContext';
import { createCheckoutSession, createPortalSession } from '../services/accountService';

const resolveBackendUrl = (): string => {
  try {
    const raw = localStorage.getItem('vf_settings');
    if (!raw) return 'http://127.0.0.1:7800';
    const parsed = JSON.parse(raw) as { mediaBackendUrl?: string } | null;
    return String(parsed?.mediaBackendUrl || '').trim() || 'http://127.0.0.1:7800';
  } catch {
    return 'http://127.0.0.1:7800';
  }
};

export const SubscriptionModal: React.FC = () => {
  const { showSubscriptionModal, setShowSubscriptionModal, stats, refreshEntitlements } = useUser();
  const [isLoading, setIsLoading] = useState<'pro' | 'plus' | 'portal' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const planBadge = useMemo(() => stats.planName, [stats.planName]);
  if (!showSubscriptionModal) return null;

  const handleClose = () => {
    setShowSubscriptionModal(false);
    setError(null);
  };

  const startCheckout = async (plan: 'pro' | 'plus') => {
    setError(null);
    setIsLoading(plan);
    try {
      const { url } = await createCheckoutSession(plan, resolveBackendUrl(), {
        successUrl: `${window.location.origin}${window.location.pathname}?billing=success`,
        cancelUrl: `${window.location.origin}${window.location.pathname}?billing=cancel`,
      });
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
      const { url } = await createPortalSession(resolveBackendUrl(), window.location.href);
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

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-md sm:rounded-3xl rounded-t-3xl overflow-hidden shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors z-10"
        >
          <X size={20} className="text-gray-600" />
        </button>

        <div className="p-6 pt-12">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl mx-auto flex items-center justify-center shadow-lg shadow-orange-200 mb-4">
              <Crown size={32} className="text-white" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Upgrade Plan</h2>
            <p className="text-gray-500 mt-2">Current plan: <span className="font-semibold text-gray-800">{planBadge}</span></p>
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="space-y-3 mb-6">
            <div className="flex items-center gap-3 p-3 bg-indigo-50 rounded-xl border border-indigo-100">
              <div className="bg-indigo-100 p-1.5 rounded-full"><Check size={14} className="text-indigo-600" /></div>
              <span className="text-gray-700 font-medium text-sm">Monthly VF allowance by plan</span>
            </div>
            <div className="flex items-center gap-3 p-3 bg-indigo-50 rounded-xl border border-indigo-100">
              <div className="bg-indigo-100 p-1.5 rounded-full"><Check size={14} className="text-indigo-600" /></div>
              <span className="text-gray-700 font-medium text-sm">Daily generation cap: 30</span>
            </div>
          </div>

          <div className="grid gap-3">
            <button
              onClick={() => void startCheckout('pro')}
              disabled={Boolean(isLoading)}
              className="rounded-2xl border border-gray-200 px-4 py-4 text-left hover:border-indigo-300 hover:bg-indigo-50 transition-colors disabled:opacity-60"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Pro</p>
                  <p className="text-sm text-gray-700">200,000 VF / month</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-gray-900">₹699</p>
                  <p className="text-xs text-gray-500">/ month</p>
                </div>
              </div>
              {isLoading === 'pro' && <Loader2 className="mt-2 animate-spin text-indigo-600" size={16} />}
            </button>

            <button
              onClick={() => void startCheckout('plus')}
              disabled={Boolean(isLoading)}
              className="rounded-2xl border border-gray-200 px-4 py-4 text-left hover:border-indigo-300 hover:bg-indigo-50 transition-colors disabled:opacity-60"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Plus</p>
                  <p className="text-sm text-gray-700">500,000 VF / month</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-gray-900">₹2000</p>
                  <p className="text-xs text-gray-500">/ month</p>
                </div>
              </div>
              {isLoading === 'plus' && <Loader2 className="mt-2 animate-spin text-indigo-600" size={16} />}
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
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

