import { authFetch } from './authHttpClient';
import { readJsonOrThrow } from '../src/shared/api/httpClient';
import { resolveApiBaseUrl } from '../src/shared/api/config';
import { HistoryItem } from '../types';

const toBaseUrl = (input?: string): string => {
  return resolveApiBaseUrl(input);
};

export type BillingPlanName = 'Free' | 'Launcher' | 'Starter' | 'Creator' | 'Pro' | 'Scale';
export type BillingPlanKey = 'launcher' | 'starter' | 'creator' | 'pro' | 'scale';
export type TokenPackKey = 'micro' | 'standard' | 'mega' | 'ultra';
export type TtsEngineKey = 'KOKORO' | 'NEURAL2' | 'GEM';

export interface AccountEntitlements {
  uid: string;
  plan: BillingPlanName;
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
    generationUsed: number;
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
    vfRates: Record<TtsEngineKey, number>;
    monthlyPlanCaps: Record<string, number>;
    maxCharsPerGeneration: number;
    allowedEngines: TtsEngineKey[];
  };
  features: {
    earlyAccess: boolean;
  };
  wallet?: {
    monthlyFreeRemaining: number;
    monthlyFreeLimit: number;
    vffBalance: number;
    paidVfBalance: number;
    spendableNowByEngine: Record<'KOKORO' | 'NEURAL2' | 'GEM', number>;
    vffMonthKey?: string;
  };
}

export interface AccountBillingPlanSummary {
  key: 'free' | BillingPlanKey;
  name: BillingPlanName;
  status: string;
  monthlyVfLimit: number;
  ttsSuccessRpm: number;
  maxCharsPerGeneration: number;
  allowedEngines: TtsEngineKey[];
  earlyAccess: boolean;
  pricing: {
    firstCycleInr: number;
    recurringInr: number;
    discountPercent: number;
  };
}

export interface AccountInvoiceSummary {
  id: string;
  number?: string | null;
  status: string;
  description?: string | null;
  currency: string;
  amountDueMinor: number;
  amountPaidMinor: number;
  amountRemainingMinor: number;
  createdAt?: string | null;
  dueAt?: string | null;
  paidAt?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  hostedInvoiceUrl?: string | null;
  invoicePdf?: string | null;
  billingReason?: string | null;
}

export interface AccountBillingSummary {
  generatedAt?: string;
  profile: {
    uid: string;
    userId?: string | null;
    displayName?: string | null;
    email?: string | null;
    status?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  };
  plan: AccountBillingPlanSummary;
  billing: {
    stripeReady: boolean;
    hasPortalAccess: boolean;
    stripeCustomerId?: string | null;
    billingCountry?: string | null;
    currencyMode?: string | null;
  };
  subscription: {
    id?: string | null;
    status: string;
    active: boolean;
    cancelAtPeriodEnd: boolean;
    cancelAt?: string | null;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    nextBillingAt?: string | null;
    startedAt?: string | null;
    trialEnd?: string | null;
    latestInvoiceId?: string | null;
  };
  paymentMethod?: {
    id?: string | null;
    brand?: string | null;
    last4?: string | null;
    funding?: string | null;
    expMonth?: number | null;
    expYear?: number | null;
  } | null;
  invoices: AccountInvoiceSummary[];
  warnings: string[];
}

export interface AccountUserProfile {
  uid: string;
  userId: string;
  displayName?: string;
  email?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SupportConversation {
  conversationId: string;
  uid: string;
  userId: string;
  status: 'open' | 'ai_answered' | 'needs_human' | 'resolved' | string;
  priority: 'green' | 'yellow' | 'red' | string;
  lastMessageAt?: string;
  assignedTo?: string;
  updatedAt?: string;
}

export interface SupportMessage {
  messageId: string;
  conversationId: string;
  fromType: 'user' | 'ai' | 'agent' | string;
  uid?: string;
  userId?: string;
  text: string;
  createdAt?: string;
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

export const fetchAccountProfile = async (
  baseUrl?: string
): Promise<{ profile: AccountUserProfile; requiredUserId: boolean; suggestedUserId?: string }> => {
  const payload = await readJsonOrThrow<{ profile: AccountUserProfile; requiredUserId?: boolean; suggestedUserId?: string }>(
    await authFetch(`${toBaseUrl(baseUrl)}/account/profile`, undefined, { requireAuth: true })
  );
  return {
    profile: payload.profile,
    requiredUserId: Boolean(payload.requiredUserId),
    ...(payload.suggestedUserId ? { suggestedUserId: payload.suggestedUserId } : {}),
  };
};

export const bootstrapAccountProfile = async (baseUrl?: string): Promise<AccountUserProfile> => {
  const payload = await readJsonOrThrow<{ profile: AccountUserProfile }>(
    await authFetch(
      `${toBaseUrl(baseUrl)}/account/profile/bootstrap`,
      { method: 'POST' },
      { requireAuth: true }
    )
  );
  return payload.profile;
};

export const upsertAccountProfile = async (
  input: { userId: string; displayName?: string },
  baseUrl?: string
): Promise<AccountUserProfile> => {
  const payload = await readJsonOrThrow<{ profile: AccountUserProfile }>(
    await authFetch(
      `${toBaseUrl(baseUrl)}/account/profile`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
      { requireAuth: true }
    )
  );
  return payload.profile;
};

export const createCheckoutSession = async (
  plan: BillingPlanKey | 'plus' | 'launch',
  baseUrl?: string,
  options?: { successUrl?: string; cancelUrl?: string; couponCode?: string }
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
        couponCode: options?.couponCode,
      }),
    },
    { requireAuth: true }
  ));
  const sessionId = payload?.sessionId ? String(payload.sessionId) : undefined;
  return {
    url: String(payload?.url || ''),
    ...(sessionId ? { sessionId } : {}),
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

export const fetchAccountBillingSummary = async (baseUrl?: string): Promise<AccountBillingSummary> => {
  const payload = await readJsonOrThrow<{ summary: AccountBillingSummary }>(
    await authFetch(`${toBaseUrl(baseUrl)}/billing/account-summary`, undefined, { requireAuth: true })
  );
  return payload?.summary as AccountBillingSummary;
};

export const createTokenPackCheckoutSession = async (
  pack: TokenPackKey,
  baseUrl?: string,
  options?: { successUrl?: string; cancelUrl?: string }
): Promise<{ url: string; sessionId?: string; packKey?: TokenPackKey; packVf?: number; standardAmountInr?: number; finalAmountInr?: number; discountPercent?: number }> => {
  const payload = await readJsonOrThrow<{
    url?: string;
    sessionId?: string;
    packKey?: TokenPackKey;
    packVf?: number;
    standardAmountInr?: number;
    finalAmountInr?: number;
    discountPercent?: number;
  }>(await authFetch(
    `${toBaseUrl(baseUrl)}/billing/token-pack/checkout-session`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pack,
        successUrl: options?.successUrl,
        cancelUrl: options?.cancelUrl,
      }),
    },
    { requireAuth: true }
  ));
  const sessionId = payload?.sessionId ? String(payload.sessionId) : undefined;
  const packKey = payload?.packKey ? String(payload.packKey) as TokenPackKey : undefined;
  const packVf = Number.isFinite(payload?.packVf) ? Number(payload.packVf) : undefined;
  const standardAmountInr = Number.isFinite(payload?.standardAmountInr) ? Number(payload.standardAmountInr) : undefined;
  const finalAmountInr = Number.isFinite(payload?.finalAmountInr) ? Number(payload.finalAmountInr) : undefined;
  const discountPercent = Number.isFinite(payload?.discountPercent) ? Number(payload.discountPercent) : undefined;
  return {
    url: String(payload?.url || ''),
    ...(sessionId ? { sessionId } : {}),
    ...(packKey ? { packKey } : {}),
    ...(packVf !== undefined ? { packVf } : {}),
    ...(standardAmountInr !== undefined ? { standardAmountInr } : {}),
    ...(finalAmountInr !== undefined ? { finalAmountInr } : {}),
    ...(discountPercent !== undefined ? { discountPercent } : {}),
  };
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

export const postSupportMessage = async (
  input: { text: string; conversationId?: string },
  baseUrl?: string
): Promise<{ conversation: SupportConversation; messages: SupportMessage[]; aiMode?: string; aiReason?: string }> => {
  const payload = await readJsonOrThrow<{
    conversation: SupportConversation;
    messages: SupportMessage[];
    aiMode?: string;
    aiReason?: string;
  }>(
    await authFetch(
      `${toBaseUrl(baseUrl)}/support/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
      { requireAuth: true }
    )
  );
  return payload;
};

export const fetchMySupportConversations = async (
  baseUrl?: string,
  limit = 100
): Promise<SupportConversation[]> => {
  const payload = await readJsonOrThrow<{ items?: SupportConversation[] }>(
    await authFetch(
      `${toBaseUrl(baseUrl)}/support/conversations/me?limit=${encodeURIComponent(String(limit))}`,
      undefined,
      { requireAuth: true }
    )
  );
  return Array.isArray(payload?.items) ? payload.items : [];
};

export const markSupportConversationUnresolved = async (
  conversationId: string,
  baseUrl?: string
): Promise<SupportConversation> => {
  const payload = await readJsonOrThrow<{ conversation: SupportConversation }>(
    await authFetch(
      `${toBaseUrl(baseUrl)}/support/conversations/${encodeURIComponent(conversationId)}/still-unresolved`,
      { method: 'POST' },
      { requireAuth: true }
    )
  );
  return payload.conversation;
};
