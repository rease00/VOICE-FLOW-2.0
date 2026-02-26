import { authFetch } from './authHttpClient';

const FALLBACK_MEDIA_BACKEND_URL = 'http://127.0.0.1:7800';

const toBaseUrl = (input?: string): string => {
  const raw = String(input || FALLBACK_MEDIA_BACKEND_URL).trim();
  return raw.replace(/\/+$/, '');
};

const parseError = async (response: Response): Promise<string> => {
  try {
    const payload = await response.json();
    if (typeof payload?.detail === 'string' && payload.detail.trim()) return payload.detail.trim();
    if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error.trim();
    return `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
};

export interface AccountEntitlements {
  uid: string;
  plan: 'Free' | 'Pro' | 'Plus';
  status: string;
  monthly: {
    vfLimit: number;
    vfUsed: number;
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
}

export const fetchAccountEntitlements = async (baseUrl?: string): Promise<AccountEntitlements> => {
  const response = await authFetch(`${toBaseUrl(baseUrl)}/account/entitlements`, undefined, { requireAuth: true });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const payload = await response.json();
  return payload?.entitlements as AccountEntitlements;
};

export const createCheckoutSession = async (
  plan: 'pro' | 'plus',
  baseUrl?: string,
  options?: { successUrl?: string; cancelUrl?: string }
): Promise<{ url: string; sessionId?: string }> => {
  const response = await authFetch(
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
  );
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const payload = await response.json();
  return {
    url: String(payload?.url || ''),
    sessionId: payload?.sessionId ? String(payload.sessionId) : undefined,
  };
};

export const createPortalSession = async (baseUrl?: string, returnUrl?: string): Promise<{ url: string }> => {
  const response = await authFetch(
    `${toBaseUrl(baseUrl)}/billing/portal-session`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnUrl }),
    },
    { requireAuth: true }
  );
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const payload = await response.json();
  return { url: String(payload?.url || '') };
};

