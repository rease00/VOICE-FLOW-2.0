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

type BillingRouteState = 'success' | 'cancel' | 'none';
type BillingLocationLike = Pick<Location, 'origin' | 'pathname'>;
const BILLING_PUBLIC_PATH = '/billing';

const resolveBillingLocation = (): BillingLocationLike => ({
  origin: window.location.origin,
  pathname: window.location.pathname,
});

export const buildBillingReturnUrl = (
  state: BillingRouteState,
  location: BillingLocationLike = resolveBillingLocation()
): string => {
  const url = new URL(`${location.origin}${BILLING_PUBLIC_PATH}`);
  url.searchParams.set('tab', 'subscription');
  if (state === 'success' || state === 'cancel') {
    url.searchParams.set('billing', state);
  } else {
    url.searchParams.delete('billing');
  }
  return url.toString();
};

export const useBillingActions = ({ baseUrl }: UseBillingActionsArgs) => {
  const startPlanCheckout = useCallback(async (plan: BillingPlanKey, couponCode?: string) => {
    const options: { successUrl: string; cancelUrl: string; couponCode?: string } = {
      successUrl: buildBillingReturnUrl('success'),
      cancelUrl: buildBillingReturnUrl('cancel'),
    };
    const normalizedCoupon = couponCode ? String(couponCode).trim() : '';
    if (normalizedCoupon) {
      options.couponCode = normalizedCoupon;
    }
    return createCheckoutSession(plan, baseUrl, options);
  }, [baseUrl]);

  const openBillingPortal = useCallback(async () => {
    return createPortalSession(baseUrl, buildBillingReturnUrl('none'));
  }, [baseUrl]);

  const startTokenPackCheckout = useCallback(async (pack: TokenPackKey) => {
    return createTokenPackCheckoutSession(pack, baseUrl, {
      successUrl: buildBillingReturnUrl('success'),
      cancelUrl: buildBillingReturnUrl('cancel'),
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
