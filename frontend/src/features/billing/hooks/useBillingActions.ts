import { useCallback } from 'react';
import {
  createCheckoutSession,
  createPortalSession,
  createTokenPackCheckoutSession,
  redeemCoupon,
} from '../api/billingApi';

interface UseBillingActionsArgs {
  baseUrl: string;
}

export const useBillingActions = ({ baseUrl }: UseBillingActionsArgs) => {
  const startPlanCheckout = useCallback(async (plan: 'pro' | 'plus') => {
    return createCheckoutSession(plan, baseUrl, {
      successUrl: `${window.location.origin}${window.location.pathname}?billing=success`,
      cancelUrl: `${window.location.origin}${window.location.pathname}?billing=cancel`,
    });
  }, [baseUrl]);

  const openBillingPortal = useCallback(async () => {
    return createPortalSession(baseUrl, window.location.href);
  }, [baseUrl]);

  const startTokenPackCheckout = useCallback(async () => {
    return createTokenPackCheckoutSession(baseUrl, {
      successUrl: `${window.location.origin}${window.location.pathname}?billing=success`,
      cancelUrl: `${window.location.origin}${window.location.pathname}?billing=cancel`,
    });
  }, [baseUrl]);

  const redeemWalletCoupon = useCallback(async (code: string) => {
    return redeemCoupon(code, baseUrl);
  }, [baseUrl]);

  return {
    startPlanCheckout,
    openBillingPortal,
    startTokenPackCheckout,
    redeemWalletCoupon,
  };
};
