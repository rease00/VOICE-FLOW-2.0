import { authFetch } from './authHttpClient';
import { readJsonOrThrow } from '../src/shared/api/httpClient';
import { HistoryItem } from '../types';

const FALLBACK_MEDIA_BACKEND_URL = 'http://127.0.0.1:7800';

const toBaseUrl = (input?: string): string => {
  const raw = String(input || FALLBACK_MEDIA_BACKEND_URL).trim();
  return raw.replace(/\/+$/, '');
};

export interface AccountEntitlements {
  uid: string;
  plan: 'Free' | 'Pro' | 'Plus';
  status: string;
  monthly: {
    vfLimit: number;
    vfUsed: number;
    monthlyFreeVfUsed?: number;
    vfRemaining: number;
    generationCount: number;
    periodKey: string;
    windowStartUtc: string;
    windowEndUtc: string;
    byEngine: Record<string, { chars: number; vf: number }>;
  };
  daily: {
    generationLimit: number;
    generationUsed: number;
    generationRemaining: number;
    vfUsed: number;
    periodKey: string;
    windowStartUtc: string;
    windowEndUtc: string;
    byEngine: Record<string, { chars: number; vf: number }>;
  };
  billing: {
    stripeCustomerId?: string | null;
    subscriptionId?: string | null;
    currencyMode?: string;
    billingCountry?: string | null;
  };
  limits: {
    vfRates: Record<string, number>;
    monthlyPlanCaps: Record<string, number>;
  };
  wallet?: {
    monthlyFreeRemaining: number;
    monthlyFreeLimit: number;
    vffBalance: number;
    paidVfBalance: number;
    spendableNowByEngine: Record<'KOKORO' | 'GEM', number>;
    adClaimsToday: number;
    adClaimsDailyLimit: number;
    vffMonthKey?: string;
  };
}

interface GenerationHistoryResponse {
  ok: boolean;
  limit?: number;
  count?: number;
  items?: HistoryItem[];
}

export const fetchAccountEntitlements = async (baseUrl?: string): Promise<AccountEntitlements> => {
  const payload = await readJsonOrThrow<{ entitlements: AccountEntitlements }>(
    await authFetch(`${toBaseUrl(baseUrl)}/account/entitlements`, undefined, { requireAuth: true })
  );
  return payload?.entitlements as AccountEntitlements;
};

export const createCheckoutSession = async (
  plan: 'pro' | 'plus',
  baseUrl?: string,
  options?: { successUrl?: string; cancelUrl?: string }
): Promise<{ url: string; sessionId?: string }> => {
  const payload = await readJsonOrThrow<{ url?: string; sessionId?: string }>(await authFetch(
    `${toBaseUrl(baseUrl)}/billing/checkout-session`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan,
        successUrl: options?.successUrl,
        cancelUrl: options?.cancelUrl,
      }),
    },
    { requireAuth: true }
  ));
  return {
    url: String(payload?.url || ''),
    sessionId: payload?.sessionId ? String(payload.sessionId) : undefined,
  };
};

export const createPortalSession = async (baseUrl?: string, returnUrl?: string): Promise<{ url: string }> => {
  const payload = await readJsonOrThrow<{ url?: string }>(await authFetch(
    `${toBaseUrl(baseUrl)}/billing/portal-session`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnUrl }),
    },
    { requireAuth: true }
  ));
  return { url: String(payload?.url || '') };
};

export const createTokenPackCheckoutSession = async (
  baseUrl?: string,
  options?: { successUrl?: string; cancelUrl?: string }
): Promise<{ url: string; sessionId?: string; packVf?: number; finalAmountInr?: number }> => {
  const payload = await readJsonOrThrow<{ url?: string; sessionId?: string; packVf?: number; finalAmountInr?: number }>(await authFetch(
    `${toBaseUrl(baseUrl)}/billing/token-pack/checkout-session`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        successUrl: options?.successUrl,
        cancelUrl: options?.cancelUrl,
      }),
    },
    { requireAuth: true }
  ));
  return {
    url: String(payload?.url || ''),
    sessionId: payload?.sessionId ? String(payload.sessionId) : undefined,
    packVf: Number.isFinite(payload?.packVf) ? Number(payload.packVf) : undefined,
    finalAmountInr: Number.isFinite(payload?.finalAmountInr) ? Number(payload.finalAmountInr) : undefined,
  };
};

export const claimAdReward = async (baseUrl?: string): Promise<AccountEntitlements> => {
  const payload = await readJsonOrThrow<{ entitlements: AccountEntitlements }>(await authFetch(
    `${toBaseUrl(baseUrl)}/wallet/ad-reward/claim`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    { requireAuth: true }
  ));
  return payload?.entitlements as AccountEntitlements;
};

export const redeemCoupon = async (code: string, baseUrl?: string): Promise<{ creditedVf: number; entitlements: AccountEntitlements }> => {
  const payload = await readJsonOrThrow<{ creditedVf?: number; entitlements: AccountEntitlements }>(await authFetch(
    `${toBaseUrl(baseUrl)}/wallet/coupons/redeem`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    },
    { requireAuth: true }
  ));
  return {
    creditedVf: Math.max(0, Number(payload?.creditedVf || 0)),
    entitlements: payload?.entitlements as AccountEntitlements,
  };
};

export const fetchGenerationHistory = async (baseUrl?: string, limit = 30): Promise<HistoryItem[]> => {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 30));
  const payload = await readJsonOrThrow<GenerationHistoryResponse>(
    await authFetch(`${toBaseUrl(baseUrl)}/account/generation-history?limit=${encodeURIComponent(String(safeLimit))}`, undefined, { requireAuth: true })
  );
  return Array.isArray(payload?.items) ? payload.items : [];
};

export const clearGenerationHistory = async (baseUrl?: string): Promise<void> => {
  const response = await authFetch(`${toBaseUrl(baseUrl)}/account/generation-history`, { method: 'DELETE' }, { requireAuth: true });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || 'Failed to clear generation history.');
  }
};
