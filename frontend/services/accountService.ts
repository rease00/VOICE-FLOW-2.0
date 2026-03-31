import { authFetch } from './authHttpClient';
import { parseResponseError, readJsonOrThrow } from '../src/shared/api/httpClient';
import { requestJson } from '../src/shared/api/httpClient';
import { resolveApiBaseUrl } from '../src/shared/api/config';
import { firebaseAuth } from './firebaseClient';
import { HistoryItem } from '../types';

const toBaseUrl = (input?: string): string => {
  return resolveApiBaseUrl(input);
};

const BILLING_IDEMPOTENCY_WINDOW_MS = 60_000;

const normalizeBillingIdempotencyToken = (value: string): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

const resolveBillingIdempotencyActor = (): string => {
  const uid = String(firebaseAuth.currentUser?.uid || '').trim();
  if (uid) return `uid:${uid}`;
  return 'uid:anonymous';
};

const makeBillingIdempotencyKey = (operation: string, subject: string, extra?: string): string => {
  const minuteBucket = Math.floor(Date.now() / BILLING_IDEMPOTENCY_WINDOW_MS);
  const fallback = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  const parts = [
    'vf',
    normalizeBillingIdempotencyToken(operation) || 'billing',
    normalizeBillingIdempotencyToken(resolveBillingIdempotencyActor()) || 'uid:anonymous',
    normalizeBillingIdempotencyToken(subject) || normalizeBillingIdempotencyToken(fallback),
  ];
  const extraToken = normalizeBillingIdempotencyToken(extra || '');
  if (extraToken) {
    parts.push(extraToken);
  }
  parts.push(String(minuteBucket));
  return parts.join(':');
};

export type BillingPlanName = 'Free' | 'Launcher' | 'Starter' | 'Creator' | 'Pro' | 'Scale';
export type BillingPlanKey = 'launcher' | 'starter' | 'creator' | 'pro' | 'scale';
export type TokenPackKey = 'micro' | 'standard' | 'mega' | 'ultra';
export type BillingVcPackKey = 'standard';
export type TtsEngineKey = 'DUNO' | 'VECTOR' | 'PRIME';

export interface AccountEntitlements {
  uid: string;
  plan: BillingPlanName;
  status: string;
  monthly: {
    vfLimit: number;
    vfUsed: number;
    vcUsed?: number;
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
    vcUsed?: number;
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
    tokenPackDiscountPercent?: number;
  };
  features: {
    earlyAccess: boolean;
  };
  wallet?: {
    monthlyFreeRemaining: number;
    monthlyFreeLimit: number;
    vffBalance: number;
    paidVfBalance: number;
    vcFreeBalance?: number;
    vcPaidBalance?: number;
    vcSpendableBalance?: number;
    vcMonthKey?: string;
    spendableNowByEngine: Record<TtsEngineKey, number>;
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
  tokenPackDiscountPercent?: number;
  launcherOfferConsumed?: boolean;
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
    provider?: string | null;
    hasBillingManagement?: boolean;
    stripeReady?: boolean;
    hasPortalAccess?: boolean;
    paymentGateway?: string | null;
    stripeCustomerId?: string | null;
    subscriptionId?: string | null;
    customerId?: string | null;
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
    tokenPack?: {
      discountPercent?: number;
    } | null;
  invoices: AccountInvoiceSummary[];
  warnings: string[];
}

export interface RazorpayCheckoutOptions {
  key?: string;
  order_id?: string;
  subscription_id?: string;
  amount?: number;
  currency?: string;
  name?: string;
  description?: string;
  image?: string;
  prefill?: Record<string, string>;
  notes?: Record<string, string>;
  theme?: { color?: string };
  modal?: Record<string, unknown>;
  retry?: Record<string, unknown>;
  config?: Record<string, unknown>;
  readonly [key: string]: any;
}

export interface BillingCheckoutLaunch {
  provider: string;
  kind: 'checkout' | 'subscription' | 'redirect';
  redirectUrl?: string;
  checkoutOptions?: RazorpayCheckoutOptions | null;
  subscriptionOptions?: RazorpayCheckoutOptions | null;
  sessionId?: string;
  packKey?: TokenPackKey;
  packVf?: number;
  standardAmountInr?: number;
  finalAmountInr?: number;
  discountPercent?: number;
}

export interface BillingSubscriptionActionResult {
  ok?: boolean;
  provider?: string;
  summary?: AccountBillingSummary | null;
  subscription?: AccountBillingSummary['subscription'] | null;
  message?: string | null;
}

export const ACCOUNT_DELETE_CONFIRM_PHRASE = 'DELETE_MY_ACCOUNT';

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
  baseUrl?: string,
  options?: { signal?: AbortSignal }
): Promise<{ profile: AccountUserProfile; requiredUserId: boolean; suggestedUserId?: string }> => {
  const payload = await readJsonOrThrow<{ profile: AccountUserProfile; requiredUserId?: boolean; suggestedUserId?: string }>(
    await authFetch(
      `${toBaseUrl(baseUrl)}/account/profile`,
      options?.signal ? { signal: options.signal } : undefined,
      { requireAuth: true, ...(options?.signal ? { signal: options.signal } : {}) }
    )
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

export const deleteAccount = async (
  baseUrl?: string,
  confirmPhrase: string = ACCOUNT_DELETE_CONFIRM_PHRASE
): Promise<void> => {
  const response = await authFetch(
    `${toBaseUrl(baseUrl)}/account/delete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmPhrase: String(confirmPhrase || '').trim() }),
    },
    { requireAuth: true }
  );
  if (!response.ok) {
    throw await parseResponseError(response);
  }
};

export const createCheckoutSession = async (
  plan: BillingPlanKey | 'plus' | 'launch',
  baseUrl?: string,
  options?: { successUrl?: string; cancelUrl?: string; couponCode?: string }
): Promise<BillingCheckoutLaunch> => {
  const idempotencyKey = makeBillingIdempotencyKey('checkout', `plan:${plan}`, options?.couponCode || '');
  const payload = await requestJson<Record<string, any>>(
    `${toBaseUrl(baseUrl)}/billing/checkout-session`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        plan,
        successUrl: options?.successUrl,
        cancelUrl: options?.cancelUrl,
        couponCode: options?.couponCode,
      }),
    },
    { requireAuth: true }
  );
  return normalizeBillingCheckoutLaunch(payload, 'checkout');
};

export const cancelBillingSubscription = async (baseUrl?: string): Promise<BillingSubscriptionActionResult> => {
  const payload = await readJsonOrThrow<Record<string, any>>(await authFetch(
    `${toBaseUrl(baseUrl)}/billing/subscription/cancel`,
    {
      method: 'POST',
    },
    { requireAuth: true }
  ));
  return normalizeSubscriptionActionResult(payload);
};

export const resumeBillingSubscription = async (baseUrl?: string): Promise<BillingSubscriptionActionResult> => {
  const payload = await readJsonOrThrow<Record<string, any>>(await authFetch(
    `${toBaseUrl(baseUrl)}/billing/subscription/resume`,
    {
      method: 'POST',
    },
    { requireAuth: true }
  ));
  return normalizeSubscriptionActionResult(payload);
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
): Promise<BillingCheckoutLaunch> => {
  const idempotencyKey = makeBillingIdempotencyKey('checkout', `token-pack:${pack}`);
  const payload = await requestJson<Record<string, any>>(
    `${toBaseUrl(baseUrl)}/billing/token-pack/checkout-session`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        pack,
        successUrl: options?.successUrl,
        cancelUrl: options?.cancelUrl,
      }),
    },
    { requireAuth: true }
  );
  return normalizeBillingCheckoutLaunch(
    {
      ...payload,
      pack,
    },
    'checkout'
  );
};

export const startVcTokenPackCheckout = async (
  pack: string,
  baseUrl?: string,
  options?: { successUrl?: string; cancelUrl?: string }
): Promise<BillingCheckoutLaunch> => {
  const idempotencyKey = makeBillingIdempotencyKey('checkout', `vc-token-pack:${pack}`);
  const payload = await requestJson<Record<string, any>>(
    `${toBaseUrl(baseUrl)}/billing/vc-token-pack/checkout-session`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        pack,
        successUrl: options?.successUrl,
        cancelUrl: options?.cancelUrl,
      }),
    },
    { requireAuth: true }
  );
  return normalizeBillingCheckoutLaunch(
    {
      ...payload,
      pack,
    },
    'checkout'
  );
};

export const convertVfToVc = async (
  vfAmount: number,
  baseUrl?: string
): Promise<AccountEntitlements> => {
  const payload = await readJsonOrThrow<{ entitlements: AccountEntitlements }>(await authFetch(
    `${toBaseUrl(baseUrl)}/wallet/vc/convert`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vfAmount }),
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

const normalizeBillingCheckoutLaunch = (
  payload: Record<string, any>,
  fallbackKind: BillingCheckoutLaunch['kind']
): BillingCheckoutLaunch => {
  const provider = String(payload?.provider || payload?.gateway || payload?.paymentProvider || 'razorpay').trim() || 'razorpay';
  const redirectUrl = String(payload?.redirectUrl || payload?.url || payload?.checkoutUrl || '').trim();
  const rawCheckoutOptions =
    payload?.checkoutOptions ||
    payload?.razorpayCheckoutOptions ||
    payload?.razorpayOptions ||
    payload?.subscriptionOptions ||
    payload?.options ||
    null;
  const checkoutOptions = rawCheckoutOptions && typeof rawCheckoutOptions === 'object' ? (rawCheckoutOptions as RazorpayCheckoutOptions) : null;
  const rawSubscriptionOptions =
    payload?.subscriptionOptions ||
    payload?.razorpaySubscriptionOptions ||
    payload?.subscription ||
    null;
  const subscriptionOptions = rawSubscriptionOptions && typeof rawSubscriptionOptions === 'object'
    ? (rawSubscriptionOptions as RazorpayCheckoutOptions)
    : null;
  const sessionId = payload?.sessionId ? String(payload.sessionId) : undefined;
  const packKey = payload?.packKey
    ? (String(payload.packKey) as TokenPackKey)
    : payload?.pack
      ? (String(payload.pack) as TokenPackKey)
      : undefined;
  const packVf = Number.isFinite(payload?.packVf) ? Number(payload.packVf) : undefined;
  const standardAmountInr = Number.isFinite(payload?.standardAmountInr) ? Number(payload.standardAmountInr) : undefined;
  const finalAmountInr = Number.isFinite(payload?.finalAmountInr) ? Number(payload.finalAmountInr) : undefined;
  const discountPercent = Number.isFinite(payload?.discountPercent) ? Number(payload.discountPercent) : undefined;

  return {
    provider,
    kind: checkoutOptions ? fallbackKind : subscriptionOptions ? 'subscription' : 'redirect',
    ...(redirectUrl ? { redirectUrl } : {}),
    ...(checkoutOptions ? { checkoutOptions } : {}),
    ...(subscriptionOptions ? { subscriptionOptions } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(packKey ? { packKey } : {}),
    ...(packVf !== undefined ? { packVf } : {}),
    ...(standardAmountInr !== undefined ? { standardAmountInr } : {}),
    ...(finalAmountInr !== undefined ? { finalAmountInr } : {}),
    ...(discountPercent !== undefined ? { discountPercent } : {}),
  };
};

const normalizeSubscriptionActionResult = (payload: Record<string, any>): BillingSubscriptionActionResult => {
  const summary = payload?.summary && typeof payload.summary === 'object' ? payload.summary as AccountBillingSummary : null;
  const subscription = payload?.subscription && typeof payload.subscription === 'object'
    ? payload.subscription as AccountBillingSummary['subscription']
    : null;
  const result: BillingSubscriptionActionResult = {};
  if (typeof payload?.ok === 'boolean') {
    result.ok = payload.ok;
  }
  if (typeof payload?.provider === 'string') {
    result.provider = payload.provider;
  }
  if (summary) {
    result.summary = summary;
  }
  if (subscription) {
    result.subscription = subscription;
  }
  if (payload?.message) {
    result.message = String(payload.message);
  }
  return result;
};
