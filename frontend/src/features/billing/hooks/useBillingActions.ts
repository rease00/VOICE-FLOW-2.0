import { useCallback } from 'react';
import {
  createCheckoutSession,
  cancelBillingSubscription,
  createTokenPackCheckoutSession,
  convertVfToVc,
  redeemCoupon,
  resumeBillingSubscription,
  startVcTokenPackCheckout as startVcTokenPackCheckoutSession,
  startVnTokenPackCheckout as startVnTokenPackCheckoutSession,
  type BillingCheckoutLaunch,
  type BillingSubscriptionActionResult,
  type RazorpayCheckoutOptions,
} from '../api/billingApi';
import type { BillingPlanKey, BillingVcPackKey, TokenPackKey, VnTokenPackKey } from '../../../../services/accountService';
import { BILLING_CHECKOUT_LOCK_MESSAGE, isBillingCheckoutLocked } from '../../../shared/billing/checkoutLock';

interface UseBillingActionsArgs {
  baseUrl: string;
  returnPath?: string;
}

type BillingRouteState = 'success' | 'cancel' | 'none';
type BillingRouteTab = 'plans' | 'token' | 'vc' | 'vn';
type BillingLocationLike = Pick<Location, 'origin' | 'pathname'>;
const BILLING_PUBLIC_PATH = '/billing';

const resolveBillingLocation = (): BillingLocationLike => ({
  origin: window.location.origin,
  pathname: window.location.pathname,
});

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions & {
      handler?: (response: Record<string, string>) => void;
      modal?: Record<string, unknown> & { ondismiss?: () => void };
      theme?: { color?: string };
    }) => {
      open: () => void;
      close?: () => void;
    };
  }
}

let razorpayScriptPromise: Promise<void> | null = null;

const assertBillingCheckoutAvailable = (): void => {
  if (isBillingCheckoutLocked()) {
    throw new Error(BILLING_CHECKOUT_LOCK_MESSAGE);
  }
};

const loadRazorpayScript = async (): Promise<void> => {
  if (typeof window === 'undefined') {
    throw new Error('Billing checkout is only available in the browser.');
  }
  if (window.Razorpay) return;
  if (!razorpayScriptPromise) {
    razorpayScriptPromise = new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-vf-razorpay="1"]');
      if (existing) {
        if ((window as any).Razorpay) {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Unable to load Razorpay checkout.')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.defer = true;
      script.dataset.vfRazorpay = '1';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Unable to load Razorpay checkout.'));
      document.head.appendChild(script);
    });
  }
  try {
    await razorpayScriptPromise;
  } catch (error) {
    razorpayScriptPromise = null;
    throw error;
  }
  if (!window.Razorpay) {
    throw new Error('Razorpay checkout failed to initialize.');
  }
};

const launchRazorpayCheckout = async (
  launch: BillingCheckoutLaunch,
  callbacks: { onSuccess?: () => void; onDismiss?: () => void } = {}
): Promise<void> => {
  if (!launch.checkoutOptions && !launch.subscriptionOptions) {
    if (launch.redirectUrl) {
      window.location.href = launch.redirectUrl;
      return;
    }
    throw new Error('Checkout options are missing.');
  }
  await loadRazorpayScript();
  const options = (launch.checkoutOptions || launch.subscriptionOptions) as RazorpayCheckoutOptions;
  const RazorpayCtor = window.Razorpay;
  if (!RazorpayCtor) {
    throw new Error('Razorpay checkout is unavailable.');
  }
  const instance = new RazorpayCtor({
    ...options,
    handler: () => {
      callbacks.onSuccess?.();
    },
    modal: {
      ...(options.modal || {}),
      ondismiss: () => {
        callbacks.onDismiss?.();
      },
    },
  });
  instance.open();
};

export const buildBillingReturnUrl = (
  state: BillingRouteState,
  location: BillingLocationLike = resolveBillingLocation(),
  returnPath: string = BILLING_PUBLIC_PATH,
  tab: BillingRouteTab = 'plans'
): string => {
  const safeReturnPath = String(returnPath || BILLING_PUBLIC_PATH).trim();
  const normalizedReturnPath = safeReturnPath.startsWith('/') ? safeReturnPath : BILLING_PUBLIC_PATH;
  const url = new URL(`${location.origin}${normalizedReturnPath}`);
  url.searchParams.set(
    'tab',
    tab === 'token'
      ? 'token-buy'
      : tab === 'vc'
        ? 'vc-packs'
        : tab === 'vn'
          ? 'vn-packs'
          : 'subscription'
  );
  if (state === 'success' || state === 'cancel') {
    url.searchParams.set('billing', state);
  } else {
    url.searchParams.delete('billing');
  }
  return url.toString();
};

export const useBillingActions = ({ baseUrl, returnPath = BILLING_PUBLIC_PATH }: UseBillingActionsArgs) => {
  const startPlanCheckout = useCallback(async (plan: BillingPlanKey, couponCode?: string) => {
    assertBillingCheckoutAvailable();
    const options: { successUrl: string; cancelUrl: string; couponCode?: string } = {
      successUrl: buildBillingReturnUrl('success', resolveBillingLocation(), returnPath, 'plans'),
      cancelUrl: buildBillingReturnUrl('cancel', resolveBillingLocation(), returnPath, 'plans'),
    };
    const normalizedCoupon = couponCode ? String(couponCode).trim() : '';
    if (normalizedCoupon) {
      options.couponCode = normalizedCoupon;
    }
    return createCheckoutSession(plan, baseUrl, options);
  }, [baseUrl, returnPath]);

  const startTokenPackCheckout = useCallback(async (pack: TokenPackKey) => {
    assertBillingCheckoutAvailable();
    return createTokenPackCheckoutSession(pack, baseUrl, {
      successUrl: buildBillingReturnUrl('success', resolveBillingLocation(), returnPath, 'token'),
      cancelUrl: buildBillingReturnUrl('cancel', resolveBillingLocation(), returnPath, 'token'),
    });
  }, [baseUrl, returnPath]);

  const startVcTokenPackCheckout = useCallback(async (pack: BillingVcPackKey) => {
    assertBillingCheckoutAvailable();
    return startVcTokenPackCheckoutSession(pack, baseUrl, {
      successUrl: buildBillingReturnUrl('success', resolveBillingLocation(), returnPath, 'vc'),
      cancelUrl: buildBillingReturnUrl('cancel', resolveBillingLocation(), returnPath, 'vc'),
    });
  }, [baseUrl, returnPath]);

  const startVnTokenPackCheckout = useCallback(async (pack: VnTokenPackKey) => {
    assertBillingCheckoutAvailable();
    return startVnTokenPackCheckoutSession(pack, baseUrl, {
      successUrl: buildBillingReturnUrl('success', resolveBillingLocation(), returnPath, 'vn'),
      cancelUrl: buildBillingReturnUrl('cancel', resolveBillingLocation(), returnPath, 'vn'),
    });
  }, [baseUrl, returnPath]);

  const convertVfToVcTokens = useCallback(async (vfAmount: number) => {
    return convertVfToVc(vfAmount, baseUrl);
  }, [baseUrl]);

  const launchCheckout = useCallback(async (
    launch: BillingCheckoutLaunch,
    callbacks: { onSuccess?: () => void; onDismiss?: () => void } = {}
  ) => {
    await launchRazorpayCheckout(launch, callbacks);
  }, []);

  const cancelRecurringSubscription = useCallback(async (): Promise<BillingSubscriptionActionResult> => {
    return cancelBillingSubscription(baseUrl);
  }, [baseUrl]);

  const resumeRecurringSubscription = useCallback(async (): Promise<BillingSubscriptionActionResult> => {
    return resumeBillingSubscription(baseUrl);
  }, [baseUrl]);

  const redeemWalletCoupon = useCallback(async (code: string) => {
    return redeemCoupon(code, baseUrl);
  }, [baseUrl]);

  return {
    startPlanCheckout,
    startTokenPackCheckout,
    startVcTokenPackCheckout,
    startVnTokenPackCheckout,
    convertVfToVc: convertVfToVcTokens,
    launchCheckout,
    cancelRecurringSubscription,
    resumeRecurringSubscription,
    redeemWalletCoupon,
  };
};
