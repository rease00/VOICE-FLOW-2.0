import { useCallback } from 'react';
import {
  createCheckoutSession,
  createPortalSession,
  createTokenPackCheckoutSession,
  redeemCoupon,
} from '../api/billingApi';
import type { BillingPlanKey, TokenPackKey } from '../../../../services/accountService';

interface UseBillingActionsArgs {
  baseUrl: string;
}

export const useBillingActions = ({ baseUrl }: UseBillingActionsArgs) => {
  const startPlanCheckout = useCallback(async (plan: BillingPlanKey, couponCode?: string) => {
    const options: { successUrl: string; cancelUrl: string; couponCode?: string } = {
      successUrl: `${window.location.origin}${window.location.pathname}?billing=success`,
      cancelUrl: `${window.location.origin}${window.location.pathname}?billing=cancel`,
    };
    const normalizedCoupon = couponCode ? String(couponCode).trim() : '';
    if (normalizedCoupon) {
      options.couponCode = normalizedCoupon;
    }
    return createCheckoutSession(plan, baseUrl, options);
  }, [baseUrl]);

  const openBillingPortal = useCallback(async () => {
    return createPortalSession(baseUrl, window.location.href);
  }, [baseUrl]);

  const startTokenPackCheckout = useCallback(async (pack: TokenPackKey) => {
    return createTokenPackCheckoutSession(pack, baseUrl, {
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
