import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  AccountBillingSummary,
  BillingCheckoutLaunch,
  BillingPlanName,
  BillingSubscriptionActionResult,
  BillingVcPackKey,
  TokenPackKey,
  VnTokenPackKey,
} from '../../../services/accountService';
import {
  BILLING_PLAN_ROWS,
  BILLING_TOKEN_PACK_ROWS,
  BILLING_VC_PACK_ROWS,
  BILLING_VN_PACK_ROWS,
  type BillingPlanCatalogRow,
  type BillingTokenPackCatalogRow,
  type BillingVcPackCatalogRow,
  type BillingVnPackCatalogRow,
} from '../../features/billing/catalog';
import { readEnvNumber, readEnvValue } from '../../shared/runtime/env';
import { BILLING_CHECKOUT_LOCK_MESSAGE, isBillingCheckoutLocked } from '../../shared/billing/checkoutLock';
import type { ServerAuthedUserContext } from '../auth/requestAuth.ts';
import { getFirebaseAdminFirestore } from '../firebaseAdmin';
import { getAccountEntitlements, getAccountProfile, updateAccountEntitlements } from '../account/service';
import { getD1Database, ensureD1Schema, readD1JsonRecord, writeD1JsonRecord, deleteD1JsonRecord, readD1JsonRows } from '../d1/util';

const firestore = () => getFirebaseAdminFirestore();

const BILLING_D1_TABLES = Object.freeze({
  operations: 'billing_operations',
  webhookEvents: 'billing_webhook_events',
  stripeCustomers: 'billing_stripe_customers',
  coupons: 'billing_coupons',
  couponRedemptions: 'billing_coupon_redemptions',
  walletTransactions: 'billing_wallet_transactions',
} as const);

const BILLING_D1_SCHEMA = `
CREATE TABLE IF NOT EXISTS billing_operations (
  id TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS billing_stripe_customers (
  customer_id TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS billing_coupons (
  code TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS billing_coupon_redemptions (
  redemption_id TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  coupon_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS billing_wallet_transactions (
  transaction_id TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

const getBillingD1Db = async () => {
  const db = await getD1Database();
  if (db) await ensureD1Schema(db, BILLING_D1_SCHEMA);
  return db;
};

const BILLING_PROVIDER_STRIPE = 'stripe';
const STRIPE_API_BASE = 'https://api.stripe.com/v1';

const asString = (value: unknown): string => String(value ?? '').trim();
const asLower = (value: unknown): string => asString(value).toLowerCase();
const asNumber = (value: unknown, fallback = 0): number => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};
const asPositiveNumber = (value: unknown, fallback = 0): number => Math.max(0, asNumber(value, fallback));
const asPositiveInt = (value: unknown, fallback = 0): number => Math.max(0, Math.floor(asNumber(value, fallback)));
const toIsoString = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value * 1000).toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const seconds = Number((value as { seconds?: number }).seconds);
    if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1000).toISOString();
  }
  return null;
};

const stripeSecretKey = (): string => readEnvValue(
  process.env.STRIPE_SECRET_KEY,
  process.env.VF_STRIPE_SECRET_KEY,
);

const stripeWebhookSecret = (): string => readEnvValue(
  process.env.STRIPE_WEBHOOK_SECRET,
  process.env.VF_STRIPE_WEBHOOK_SECRET,
);

const stripePortalConfigurationId = (): string => readEnvValue(
  process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID,
  process.env.VF_STRIPE_BILLING_PORTAL_CONFIGURATION_ID,
);

const vcConversionRate = (): number => readEnvNumber(
  process.env.VF_VC_CONVERSION_RATE,
  process.env.NEXT_PUBLIC_VF_VC_CONVERSION_RATE,
) || 0;

const currentIso = (): string => new Date().toISOString();

const throwHttpError = (status: number, message: string): never => {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  throw error;
};

const assertBillingCheckoutUnlocked = (): void => {
  if (isBillingCheckoutLocked()) {
    throwHttpError(403, BILLING_CHECKOUT_LOCK_MESSAGE);
  }
};

const assertStripeReady = (): string => {
  const secret = stripeSecretKey();
  if (!secret) {
    throwHttpError(503, 'Stripe billing config required.');
  }
  return secret;
};

const encodeStripeForm = (value: unknown, prefix?: string, target: URLSearchParams = new URLSearchParams()): URLSearchParams => {
  if (value === undefined) return target;
  if (value === null) {
    if (prefix) target.append(prefix, '');
    return target;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const nextPrefix = prefix ? `${prefix}[${index}]` : String(index);
      encodeStripeForm(item, nextPrefix, target);
    });
    return target;
  }
  if (typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
      const nextPrefix = prefix ? `${prefix}[${key}]` : key;
      encodeStripeForm(nested, nextPrefix, target);
    });
    return target;
  }
  if (prefix) target.append(prefix, String(value));
  return target;
};

const stripeRequest = async <T>(
  method: 'GET' | 'POST',
  path: string,
  options: {
    form?: Record<string, unknown>;
    idempotencyKey?: string | undefined;
  } = {}
): Promise<T> => {
  const secret = assertStripeReady();
  const headers = new Headers({
    Authorization: `Bearer ${secret}`,
  });
  let body: string | undefined;
  if (method === 'POST') {
    headers.set('Content-Type', 'application/x-www-form-urlencoded');
    body = encodeStripeForm(options.form || {}).toString();
  }
  if (options.idempotencyKey) {
    headers.set('Idempotency-Key', options.idempotencyKey);
  }
  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = asString((payload as { error?: { message?: string } }).error?.message) || 'Stripe request failed.';
    throwHttpError(response.status, detail);
  }
  return payload as T;
};

const billingPlanMeta = {
  free: { maxCharsPerGeneration: 8000, tokenPackDiscountPercent: 0, vcTokenPackDiscountPercent: 0, ttsSuccessRpm: 3, earlyAccess: false },
  launcher: { maxCharsPerGeneration: 9000, tokenPackDiscountPercent: 0, vcTokenPackDiscountPercent: 0, ttsSuccessRpm: 5, earlyAccess: false },
  starter: { maxCharsPerGeneration: 10000, tokenPackDiscountPercent: 5, vcTokenPackDiscountPercent: 0, ttsSuccessRpm: 5, earlyAccess: false },
  creator: { maxCharsPerGeneration: 10000, tokenPackDiscountPercent: 5, vcTokenPackDiscountPercent: 0, ttsSuccessRpm: 5, earlyAccess: false },
  pro: { maxCharsPerGeneration: 10000, tokenPackDiscountPercent: 10, vcTokenPackDiscountPercent: 5, ttsSuccessRpm: 5, earlyAccess: false },
  scale: { maxCharsPerGeneration: 15000, tokenPackDiscountPercent: 15, vcTokenPackDiscountPercent: 5, ttsSuccessRpm: 10, earlyAccess: true },
} as const;

const normalizePlanKey = (value: unknown): 'free' | 'launcher' | 'starter' | 'creator' | 'pro' | 'scale' => {
  const token = asLower(value);
  if (token === 'launcher' || token === 'launch') return 'launcher';
  if (token === 'starter') return 'starter';
  if (token === 'creator') return 'creator';
  if (token === 'pro') return 'pro';
  if (token === 'scale' || token === 'plus' || token === 'pro-plus' || token === 'pro_plus') return 'scale';
  return 'free';
};

const getPlanRow = (planKey: 'launcher' | 'starter' | 'creator' | 'pro' | 'scale'): BillingPlanCatalogRow => {
  const row = BILLING_PLAN_ROWS.find((item) => item.key === planKey);
  if (!row) {
    throwHttpError(400, 'Unknown billing plan.');
  }
  return row!;
};

const getTokenPackRow = (pack: TokenPackKey): BillingTokenPackCatalogRow => {
  const row = BILLING_TOKEN_PACK_ROWS.find((item) => item.key === pack);
  if (!row) throwHttpError(400, 'Unknown token pack.');
  return row!;
};

const getVcPackRow = (pack: BillingVcPackKey): BillingVcPackCatalogRow => {
  const row = BILLING_VC_PACK_ROWS.find((item) => item.key === pack);
  if (!row) throwHttpError(400, 'Unknown VC pack.');
  return row!;
};

const getVnPackRow = (pack: VnTokenPackKey): BillingVnPackCatalogRow => {
  const row = BILLING_VN_PACK_ROWS.find((item) => item.key === pack);
  if (!row) throwHttpError(400, 'Unknown VN pack.');
  return row!;
};

const applyPercentDiscount = (amountInr: number, percent: number): number => {
  if (percent <= 0) return Math.max(0, Math.round(amountInr));
  return Math.max(0, Math.round(amountInr * (1 - (percent / 100))));
};

const normalizeOperationToken = (value: unknown): string => String(value ?? '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9._:-]+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-+|-+$/g, '');

const buildStripeCustomerIdempotencyKey = (uid: string): string => (
  `stripe-customer:${normalizeOperationToken(uid) || 'anonymous'}`
);

const updateEntitlement = async (uid: string, patch: Record<string, unknown>): Promise<void> => {
  const db = await getBillingD1Db();
  if (db) {
    const current = await readD1JsonRecord(db, 'account_entitlements', 'uid', uid);
    await writeD1JsonRecord(db, 'account_entitlements', 'uid', uid, { ...(current || {}), ...patch, uid }, currentIso());
    return;
  }
  await updateAccountEntitlements(uid, patch);
};

const ensureStripeCustomer = async (user: ServerAuthedUserContext): Promise<string> => {
  const entitlements = await getAccountEntitlements(user);
  const existing = asString(entitlements.billing?.stripeCustomerId);
  if (existing) return existing;

  const { profile } = await getAccountProfile(user);
  const created = await stripeRequest<{ id: string }>('POST', '/customers', {
    idempotencyKey: buildStripeCustomerIdempotencyKey(user.uid),
    form: {
      email: profile.email || undefined,
      name: profile.displayName || profile.userId || user.uid,
      metadata: {
        uid: user.uid,
        userId: profile.userId || '',
      },
      ...(profile.billingProfile?.phone ? { phone: profile.billingProfile.phone } : {}),
      ...(profile.billingProfile?.addressLine1
        ? {
            address: {
              line1: profile.billingProfile.addressLine1,
              line2: profile.billingProfile.addressLine2 || undefined,
              city: profile.billingProfile.city || undefined,
              state: profile.billingProfile.state || undefined,
              postal_code: profile.billingProfile.postalCode || undefined,
              country: profile.billingProfile.country || undefined,
            },
          }
        : {}),
    },
  });

  const db = await getBillingD1Db();
  if (db) {
    await Promise.all([
      updateEntitlement(user.uid, { stripeCustomerId: created.id }),
      writeD1JsonRecord(db, BILLING_D1_TABLES.stripeCustomers, 'customer_id', created.id, { uid: user.uid }, currentIso()),
    ]);
  } else {
    const now = currentIso();
    await Promise.all([
      updateEntitlement(user.uid, { stripeCustomerId: created.id }),
      firestore().collection('stripe_customers').doc(created.id).set({ uid: user.uid, updatedAt: now }, { merge: true }),
    ]);
    // Dual-write: attempt D1 alongside Firestore
    const d1Dual = await getBillingD1Db();
    if (d1Dual) {
      await writeD1JsonRecord(d1Dual, BILLING_D1_TABLES.stripeCustomers, 'customer_id', created.id, { uid: user.uid }, now);
    }
  }
  return created.id;
};

const resolveStripeCustomerId = async (uid: string): Promise<string | null> => {
  const db = await getBillingD1Db();
  if (db) {
    const rows = await readD1JsonRows(
      db,
      `SELECT customer_id FROM ${BILLING_D1_TABLES.stripeCustomers} WHERE uid = ? LIMIT 1`,
      uid,
    );
    if (rows.length > 0) return asString(rows[0]?.customer_id) || null;
  }
  try {
    const snapshot = await firestore().collection('stripe_customers').where('uid', '==', uid).limit(1).get();
    if (!snapshot.empty) return snapshot.docs[0]?.id || null;
  } catch {
    // Firestore unavailable
  }
  return null;
};

const linkStripeCustomer = async (uid: string, customerId: string): Promise<void> => {
  const db = await getBillingD1Db();
  const now = currentIso();
  await updateEntitlement(uid, { stripeCustomerId: customerId });
  if (db) {
    await writeD1JsonRecord(db, BILLING_D1_TABLES.stripeCustomers, 'customer_id', customerId, { uid }, now);
  }
  try {
    await firestore().collection('stripe_customers').doc(customerId).set({ uid, updatedAt: now }, { merge: true });
  } catch {
    // Firestore unavailable
  }
};

const checkoutLaunchFromStripe = (
  session: { id?: string; url?: string },
  extras: Partial<BillingCheckoutLaunch> = {}
): BillingCheckoutLaunch => ({
  provider: BILLING_PROVIDER_STRIPE,
  kind: 'redirect',
  redirectUrl: asString(session.url),
  ...(asString(session.id) ? { sessionId: asString(session.id) } : {}),
  ...extras,
});

export const createPlanCheckoutSession = async (
  user: ServerAuthedUserContext,
  input: { plan: string; successUrl?: string; cancelUrl?: string; couponCode?: string },
  idempotencyKey?: string
): Promise<BillingCheckoutLaunch> => {
  assertBillingCheckoutUnlocked();
  const planKey = normalizePlanKey(input.plan);
  if (planKey === 'free') throwHttpError(400, 'Unknown billing plan.');
  const paidPlanKey = planKey as Exclude<ReturnType<typeof normalizePlanKey>, 'free'>;
  const plan = getPlanRow(paidPlanKey);
  const customer = await ensureStripeCustomer(user);
  const { profile } = await getAccountProfile(user);

  const session = await stripeRequest<{ id: string; url: string }>('POST', '/checkout/sessions', {
    idempotencyKey,
    form: {
      mode: 'subscription',
      customer,
      success_url: asString(input.successUrl),
      cancel_url: asString(input.cancelUrl),
      client_reference_id: user.uid,
      allow_promotion_codes: input.couponCode ? 'true' : 'true',
      metadata: {
        uid: user.uid,
        planKey,
        requestedCouponCode: asString(input.couponCode),
        billingKind: 'subscription',
      },
      subscription_data: {
        metadata: {
          uid: user.uid,
          userId: profile.userId || '',
          planKey,
          billingKind: 'subscription',
        },
      },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'inr',
          unit_amount: Math.round(plan.firstCycleInr * 100),
          recurring: { interval: 'month' },
          product_data: {
            name: `V FLOW AI ${plan.name}`,
            metadata: {
              uid: user.uid,
              planKey,
              billingKind: 'subscription',
            },
          },
        },
      }],
    },
  });

  return checkoutLaunchFromStripe(session);
};

const createOneTimeCheckoutSession = async (
  user: ServerAuthedUserContext,
  input: {
    kind: 'token-pack' | 'vc-token-pack' | 'vn-token-pack';
    name: string;
    amountInr: number;
    metadata: Record<string, unknown>;
    successUrl?: string | undefined;
    cancelUrl?: string | undefined;
  },
  idempotencyKey?: string
): Promise<{ session: { id: string; url: string }; customer: string }> => {
  assertBillingCheckoutUnlocked();
  const customer = await ensureStripeCustomer(user);
  const session = await stripeRequest<{ id: string; url: string }>('POST', '/checkout/sessions', {
    idempotencyKey,
    form: {
      mode: 'payment',
      customer,
      success_url: asString(input.successUrl),
      cancel_url: asString(input.cancelUrl),
      client_reference_id: user.uid,
      metadata: {
        uid: user.uid,
        billingKind: input.kind,
        ...input.metadata,
      },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'inr',
          unit_amount: Math.round(input.amountInr * 100),
          product_data: {
            name: input.name,
            metadata: {
              uid: user.uid,
              billingKind: input.kind,
              ...input.metadata,
            },
          },
        },
      }],
    },
  });
  return { session, customer };
};

export const createTokenPackCheckoutSession = async (
  user: ServerAuthedUserContext,
  input: { pack: TokenPackKey; successUrl?: string; cancelUrl?: string },
  idempotencyKey?: string
): Promise<BillingCheckoutLaunch> => {
  const pack = getTokenPackRow(input.pack);
  const entitlements = await getAccountEntitlements(user);
  const discountPercent = asPositiveInt(entitlements.limits?.tokenPackDiscountPercent, 0);
  const finalAmountInr = applyPercentDiscount(pack.priceInr, discountPercent);
  const { session } = await createOneTimeCheckoutSession(user, {
    kind: 'token-pack',
    name: `V FLOW AI ${pack.label} Token Pack`,
    amountInr: finalAmountInr,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    metadata: {
      packKey: pack.key,
      packVf: pack.vf,
      standardAmountInr: pack.priceInr,
      finalAmountInr,
      discountPercent,
    },
  }, idempotencyKey);
  return checkoutLaunchFromStripe(session, {
    packKey: pack.key,
    packVf: pack.vf,
    standardAmountInr: pack.priceInr,
    finalAmountInr,
    discountPercent,
  });
};

export const createVcTokenPackCheckoutSession = async (
  user: ServerAuthedUserContext,
  input: { pack: BillingVcPackKey; successUrl?: string; cancelUrl?: string },
  idempotencyKey?: string
): Promise<BillingCheckoutLaunch> => {
  const pack = getVcPackRow(input.pack);
  const entitlements = await getAccountEntitlements(user);
  const discountPercent = asPositiveInt(entitlements.limits?.vcTokenPackDiscountPercent, 0);
  const finalAmountInr = applyPercentDiscount(pack.priceInr, discountPercent);
  const { session } = await createOneTimeCheckoutSession(user, {
    kind: 'vc-token-pack',
    name: `V FLOW AI ${pack.label} VC Pack`,
    amountInr: finalAmountInr,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    metadata: {
      packKey: pack.key,
      packVc: pack.vc,
      standardAmountInr: pack.priceInr,
      finalAmountInr,
      discountPercent,
    },
  }, idempotencyKey);
  return checkoutLaunchFromStripe(session, {
    packKey: pack.key,
    packVc: pack.vc,
    standardAmountInr: pack.priceInr,
    finalAmountInr,
    discountPercent,
  });
};

export const createVnTokenPackCheckoutSession = async (
  user: ServerAuthedUserContext,
  input: { pack: VnTokenPackKey; successUrl?: string; cancelUrl?: string },
  idempotencyKey?: string
): Promise<BillingCheckoutLaunch> => {
  const pack = getVnPackRow(input.pack);
  const { session } = await createOneTimeCheckoutSession(user, {
    kind: 'vn-token-pack',
    name: `V FLOW AI ${pack.label} VN Pack`,
    amountInr: pack.priceInr,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    metadata: {
      packKey: pack.key,
      packVn: pack.vn,
      standardAmountInr: pack.priceInr,
      finalAmountInr: pack.priceInr,
      discountPercent: 0,
    },
  }, idempotencyKey);
  return checkoutLaunchFromStripe(session, {
    packKey: pack.key,
    standardAmountInr: pack.priceInr,
    finalAmountInr: pack.priceInr,
    discountPercent: 0,
  });
};

export const createPortalSession = async (
  user: ServerAuthedUserContext,
  input: { returnUrl?: string }
): Promise<{ ok: true; provider: string; url: string }> => {
  assertBillingCheckoutUnlocked();
  const customer = await ensureStripeCustomer(user);
  const configuration = stripePortalConfigurationId();
  const session = await stripeRequest<{ url: string }>('POST', '/billing_portal/sessions', {
    form: {
      customer,
      return_url: asString(input.returnUrl),
      ...(configuration ? { configuration } : {}),
    },
  });
  return {
    ok: true,
    provider: BILLING_PROVIDER_STRIPE,
    url: asString(session.url),
  };
};

const summarizeSubscription = (subscription: Record<string, unknown> | null) => ({
  id: asString(subscription?.id) || null,
  status: asString(subscription?.status) || 'inactive',
  active: ['trialing', 'active', 'past_due'].includes(asLower(subscription?.status)),
  cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
  cancelAt: toIsoString(subscription?.cancel_at),
  currentPeriodStart: toIsoString(subscription?.current_period_start),
  currentPeriodEnd: toIsoString(subscription?.current_period_end),
  nextBillingAt: toIsoString(subscription?.current_period_end),
  startedAt: toIsoString(subscription?.start_date),
  trialEnd: toIsoString(subscription?.trial_end),
  latestInvoiceId: asString(subscription?.latest_invoice) || null,
});

const summarizePaymentMethod = (paymentMethod: Record<string, unknown> | null) => {
  if (!paymentMethod) return null;
  const card = paymentMethod.card && typeof paymentMethod.card === 'object'
    ? paymentMethod.card as Record<string, unknown>
    : {};
  return {
    id: asString(paymentMethod.id) || null,
    brand: asString(card.brand) || null,
    last4: asString(card.last4) || null,
    funding: asString(card.funding) || null,
    expMonth: asPositiveInt(card.exp_month) || null,
    expYear: asPositiveInt(card.exp_year) || null,
  };
};

export const getBillingAccountSummary = async (user: ServerAuthedUserContext): Promise<AccountBillingSummary> => {
  const [{ profile }, entitlements] = await Promise.all([
    getAccountProfile(user),
    getAccountEntitlements(user),
  ]);
  const planKey = normalizePlanKey(entitlements.plan);
  const planMeta = billingPlanMeta[planKey];
  const planRow = planKey === 'free' ? null : getPlanRow(planKey);
  const planName = (planKey === 'free' ? 'Free' : planRow!.name) as BillingPlanName;
  const stripeReady = Boolean(stripeSecretKey());
  const customerId = asString(entitlements.billing?.stripeCustomerId);
  const subscriptionId = asString(entitlements.billing?.subscriptionId);

  let subscription: Record<string, unknown> | null = null;
  let customer: Record<string, unknown> | null = null;
  let invoices: Array<Record<string, unknown>> = [];
  let paymentMethod: Record<string, unknown> | null = null;

  if (stripeReady && customerId) {
    customer = await stripeRequest<Record<string, unknown>>('GET', `/customers/${encodeURIComponent(customerId)}`);
    const invoiceList = await stripeRequest<{ data?: Array<Record<string, unknown>> }>('GET', `/invoices?customer=${encodeURIComponent(customerId)}&limit=10`);
    invoices = Array.isArray(invoiceList.data) ? invoiceList.data : [];
  }
  if (stripeReady && subscriptionId) {
    subscription = await stripeRequest<Record<string, unknown>>('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  }
  const defaultPaymentMethodId = asString(
    (subscription?.default_payment_method as string | undefined)
    || ((customer?.invoice_settings as Record<string, unknown> | undefined)?.default_payment_method as string | undefined)
  );
  if (stripeReady && defaultPaymentMethodId) {
    paymentMethod = await stripeRequest<Record<string, unknown>>('GET', `/payment_methods/${encodeURIComponent(defaultPaymentMethodId)}`);
  }

  return {
    generatedAt: currentIso(),
    profile: {
      uid: user.uid,
      userId: profile.userId || null,
      displayName: profile.displayName || null,
      email: profile.email || null,
      billingProfile: profile.billingProfile || null,
      status: profile.status || null,
      createdAt: profile.createdAt || null,
      updatedAt: profile.updatedAt || null,
    },
    plan: {
      key: planKey,
      name: planName,
      status: entitlements.status,
      monthlyVfLimit: entitlements.monthly.vfLimit,
      ttsSuccessRpm: planMeta.ttsSuccessRpm,
      maxCharsPerGeneration: planMeta.maxCharsPerGeneration,
      allowedEngines: entitlements.limits.allowedEngines,
      earlyAccess: Boolean(entitlements.features?.earlyAccess) || planMeta.earlyAccess,
      pricing: {
        firstCycleInr: planRow?.firstCycleInr || 0,
        recurringInr: planRow?.recurringInr || 0,
        discountPercent: planRow && planRow.firstCycleInr > 0
          ? Math.max(0, Math.round(((planRow.firstCycleInr - planRow.recurringInr) / planRow.firstCycleInr) * 100))
          : 0,
      },
      tokenPackDiscountPercent: entitlements.limits.tokenPackDiscountPercent,
      vcTokenPackDiscountPercent: entitlements.limits.vcTokenPackDiscountPercent,
    },
    billing: {
      provider: BILLING_PROVIDER_STRIPE,
      hasBillingManagement: stripeReady,
      stripeReady,
      hasPortalAccess: stripeReady && Boolean(customerId),
      paymentGateway: BILLING_PROVIDER_STRIPE,
      stripeCustomerId: customerId || null,
      subscriptionId: subscriptionId || null,
      customerId: customerId || null,
      billingCountry: entitlements.billing.billingCountry || null,
      currencyMode: entitlements.billing.currencyMode || null,
    },
    subscription: summarizeSubscription(subscription),
    paymentMethod: summarizePaymentMethod(paymentMethod),
    tokenPack: {
      discountPercent: entitlements.limits.tokenPackDiscountPercent,
    },
    invoices: invoices.map((invoice) => ({
      id: asString(invoice.id),
      number: asString(invoice.number) || null,
      status: asString(invoice.status) || 'open',
      description: asString(invoice.description) || null,
      currency: asString(invoice.currency || 'inr').toUpperCase(),
      amountDueMinor: asPositiveInt(invoice.amount_due),
      amountPaidMinor: asPositiveInt(invoice.amount_paid),
      amountRemainingMinor: asPositiveInt(invoice.amount_remaining),
      createdAt: toIsoString(invoice.created),
      dueAt: toIsoString(invoice.due_date),
      paidAt: toIsoString(invoice.status_transitions && typeof invoice.status_transitions === 'object'
        ? (invoice.status_transitions as Record<string, unknown>).paid_at
        : null),
      periodStart: toIsoString(invoice.period_start),
      periodEnd: toIsoString(invoice.period_end),
      hostedInvoiceUrl: asString(invoice.hosted_invoice_url) || null,
      invoicePdf: asString(invoice.invoice_pdf) || null,
      billingReason: asString(invoice.billing_reason) || null,
    })),
    warnings: stripeReady ? [] : ['Stripe billing is not configured in this environment.'],
  };
};

const syncSubscriptionEntitlement = async (
  uid: string,
  input: { customerId?: string | undefined; subscription?: Record<string, unknown> | null | undefined; planKey?: string | undefined }
): Promise<void> => {
  const normalizedPlanKey = normalizePlanKey(input.planKey || (input.subscription?.metadata && typeof input.subscription.metadata === 'object'
    ? (input.subscription.metadata as Record<string, unknown>).planKey
    : 'free'));
  const planRow = normalizedPlanKey === 'free' ? null : getPlanRow(normalizedPlanKey as 'launcher' | 'starter' | 'creator' | 'pro' | 'scale');
  await updateEntitlement(uid, {
    plan: normalizedPlanKey === 'free' ? 'Free' : planRow!.name,
    status: asString(input.subscription?.status) || (normalizedPlanKey === 'free' ? 'free_active' : 'active'),
    monthlyVfLimit: normalizedPlanKey === 'free' ? 10_000 : planRow!.vfCredits,
    stripeCustomerId: input.customerId || null,
    subscriptionId: asString(input.subscription?.id) || null,
    earlyAccess: billingPlanMeta[normalizedPlanKey].earlyAccess,
  });
};

export const cancelSubscription = async (user: ServerAuthedUserContext): Promise<BillingSubscriptionActionResult> => {
  assertBillingCheckoutUnlocked();
  const entitlements = await getAccountEntitlements(user);
  const subscriptionId = asString(entitlements.billing?.subscriptionId);
  if (!subscriptionId) throwHttpError(400, 'No active subscription found.');
  const subscription = await stripeRequest<Record<string, unknown>>('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    form: { cancel_at_period_end: 'true' },
  });
  await syncSubscriptionEntitlement(user.uid, {
    customerId: entitlements.billing?.stripeCustomerId || undefined,
    subscription,
    planKey: entitlements.plan,
  });
  const summary = await getBillingAccountSummary(user);
  return { ok: true, provider: BILLING_PROVIDER_STRIPE, summary, subscription: summary.subscription, message: 'Subscription cancel scheduled.' };
};

export const resumeSubscription = async (user: ServerAuthedUserContext): Promise<BillingSubscriptionActionResult> => {
  assertBillingCheckoutUnlocked();
  const entitlements = await getAccountEntitlements(user);
  const subscriptionId = asString(entitlements.billing?.subscriptionId);
  if (!subscriptionId) throwHttpError(400, 'No active subscription found.');
  const subscription = await stripeRequest<Record<string, unknown>>('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    form: { cancel_at_period_end: 'false' },
  });
  await syncSubscriptionEntitlement(user.uid, {
    customerId: entitlements.billing?.stripeCustomerId || undefined,
    subscription,
    planKey: entitlements.plan,
  });
  const summary = await getBillingAccountSummary(user);
  return { ok: true, provider: BILLING_PROVIDER_STRIPE, summary, subscription: summary.subscription, message: 'Subscription resumed.' };
};

export const redeemCoupon = async (
  user: ServerAuthedUserContext,
  input: { code?: string }
): Promise<{ ok: true; creditedVf: number; entitlements: Awaited<ReturnType<typeof getAccountEntitlements>> }> => {
  const code = asLower(input.code).toUpperCase();
  if (!code) throwHttpError(400, 'Coupon code is required.');

  const db = await getBillingD1Db();
  let couponId: string;
  let coupon: Record<string, unknown>;

  if (db) {
    coupon = await readD1JsonRecord(db, BILLING_D1_TABLES.coupons, 'code', code) || {};
    if (!coupon || Object.keys(coupon).length === 0) throwHttpError(404, 'Coupon not found.');
    couponId = code;
  } else {
    const couponIndexSnapshot = await firestore().collection('coupons').where('code', '==', code).limit(1).get();
    if (couponIndexSnapshot.empty) throwHttpError(404, 'Coupon not found.');
    const couponDoc = couponIndexSnapshot.docs[0]!;
    coupon = couponDoc.data() as Record<string, unknown>;
    couponId = couponDoc.id;
  }

  const creditedVf = asPositiveInt(coupon.creditVf);
  if (!asPositiveInt(creditedVf)) throwHttpError(400, 'Coupon has no redeemable value.');
  if (coupon.active === false) throwHttpError(400, 'Coupon is inactive.');

  const redemptionId = `${couponId}::${user.uid}::wallet`;

  if (db) {
    const existingRedemption = await readD1JsonRecord(db, BILLING_D1_TABLES.couponRedemptions, 'redemption_id', redemptionId);
    if (existingRedemption) throwHttpError(409, 'Coupon already redeemed by this user.');
  } else {
    const existingRedemption = await firestore().collection('coupon_redemptions').doc(redemptionId).get();
    if (existingRedemption.exists) throwHttpError(409, 'Coupon already redeemed by this user.');
  }

  const entitlements = await getAccountEntitlements(user);
  const nextPaidVfBalance = asPositiveNumber(entitlements.wallet?.paidVfBalance) + creditedVf;

  const now = currentIso();
  const transactionId = `coupon_wallet_${couponId}_${user.uid}`;

  if (db) {
    const current = await readD1JsonRecord(db, 'account_entitlements', 'uid', user.uid);
    await writeD1JsonRecord(db, 'account_entitlements', 'uid', user.uid, {
      ...(current || {}),
      paidVfBalance: nextPaidVfBalance,
      updatedAt: now,
    }, now);
    await writeD1JsonRecord(db, BILLING_D1_TABLES.couponRedemptions, 'redemption_id', redemptionId, {
      id: redemptionId,
      couponId,
      uid: user.uid,
      code,
      creditedVf,
      channel: 'wallet',
      status: 'redeemed',
      createdAt: now,
    }, now);
    await writeD1JsonRecord(db, BILLING_D1_TABLES.walletTransactions, 'transaction_id', transactionId, {
      uid: user.uid,
      kind: 'credit',
      bucket: 'paidVF',
      amount: creditedVf,
      reason: 'coupon_redeem',
      metadata: { couponId, code, channel: 'wallet' },
      createdAt: now,
    }, now);
  } else {
    // D1 write + Firestore write rather than Firestore-only transaction
    const d1Fallback = await getBillingD1Db();
    if (d1Fallback) {
      const current = await readD1JsonRecord(d1Fallback, 'account_entitlements', 'uid', user.uid);
      await writeD1JsonRecord(d1Fallback, 'account_entitlements', 'uid', user.uid, {
        ...(current || {}),
        paidVfBalance: nextPaidVfBalance,
        updatedAt: now,
      }, now);
      await writeD1JsonRecord(d1Fallback, BILLING_D1_TABLES.couponRedemptions, 'redemption_id', redemptionId, {
        id: redemptionId,
        couponId,
        uid: user.uid,
        code,
        creditedVf,
        channel: 'wallet',
        status: 'redeemed',
        createdAt: now,
      }, now);
      await writeD1JsonRecord(d1Fallback, BILLING_D1_TABLES.walletTransactions, 'transaction_id', transactionId, {
        uid: user.uid,
        kind: 'credit',
        bucket: 'paidVF',
        amount: creditedVf,
        reason: 'coupon_redeem',
        metadata: { couponId, code, channel: 'wallet' },
        createdAt: now,
      }, now);
    }
    // Firestore writes alongside D1
    await Promise.all([
      firestore().collection('entitlements').doc(user.uid).set({
        paidVfBalance: nextPaidVfBalance,
        updatedAt: now,
      }, { merge: true }),
      firestore().collection('coupon_redemptions').doc(redemptionId).set({
        id: redemptionId,
        couponId,
        uid: user.uid,
        code,
        creditedVf,
        channel: 'wallet',
        status: 'redeemed',
        createdAt: now,
      }, { merge: true }),
      firestore().collection('wallet_transactions').doc(transactionId).set({
        uid: user.uid,
        kind: 'credit',
        bucket: 'paidVF',
        amount: creditedVf,
        reason: 'coupon_redeem',
        metadata: { couponId, code, channel: 'wallet' },
        createdAt: now,
      }, { merge: true }),
    ]);
  }
  await updateAccountEntitlements(user.uid, {
    paidVfBalance: nextPaidVfBalance,
  });

  return {
    ok: true,
    creditedVf,
    entitlements: await getAccountEntitlements(user),
  };
};

export const convertWalletVfToVc = async (
  user: ServerAuthedUserContext,
  input: { vfAmount?: number; requestId?: string; idempotencyKey?: string }
): Promise<{ ok: true; vfDebited: number; vcCredited: number; entitlements: Awaited<ReturnType<typeof getAccountEntitlements>> }> => {
  const rate = vcConversionRate();
  if (rate <= 0) throwHttpError(503, 'VC conversion config required.');
  const vfAmount = asPositiveNumber(input.vfAmount);
  if (vfAmount <= 0) throwHttpError(400, 'vfAmount is required.');
  const replayToken = normalizeOperationToken(input.idempotencyKey || input.requestId);
  const operationId = replayToken ? `vf_to_vc:${normalizeOperationToken(user.uid)}:${replayToken}` : '';
  const entitlements = await getAccountEntitlements(user);
  const now = currentIso();
  const vcCredited = vfAmount * rate;
  const walletTransactionId = operationId
    ? operationId.replace(/[:]/g, '_')
    : `vf_to_vc_${normalizeOperationToken(user.uid)}_${Date.now()}`;

  const db = await getBillingD1Db();
  if (db && operationId) {
    const existingOp = await readD1JsonRecord(db, BILLING_D1_TABLES.operations, 'id', operationId);
    if (existingOp) {
      return {
        ok: true,
        vfDebited: asPositiveNumber(existingOp.vfDebited),
        vcCredited: asPositiveNumber(existingOp.vcCredited),
        entitlements: await getAccountEntitlements(user),
      };
    }
  }

  const currentPaidVf = asPositiveNumber(entitlements.wallet?.paidVfBalance);
  if (currentPaidVf < vfAmount) throwHttpError(429, 'Insufficient paid VF balance.');

  const nextPaidVfBalance = currentPaidVf - vfAmount;
  const nextVcPaidBalance = asPositiveNumber(entitlements.wallet?.vcPaidBalance) + vcCredited;
  const nextVcSpendableBalance = asPositiveNumber(entitlements.wallet?.vcSpendableBalance) + vcCredited;

  if (db) {
    const current = await readD1JsonRecord(db, 'account_entitlements', 'uid', user.uid);
    await writeD1JsonRecord(db, 'account_entitlements', 'uid', user.uid, {
      ...(current || {}),
      paidVfBalance: nextPaidVfBalance,
      vcPaidBalance: nextVcPaidBalance,
      vcSpendableBalance: nextVcSpendableBalance,
      updatedAt: now,
    }, now);
    await writeD1JsonRecord(db, BILLING_D1_TABLES.walletTransactions, 'transaction_id', walletTransactionId, {
      uid: user.uid,
      kind: 'conversion',
      bucket: 'vcPaid',
      amount: vcCredited,
      metadata: { vfDebited: vfAmount, rate, ...(replayToken ? { replayToken } : {}) },
      createdAt: now,
    }, now);
    if (operationId) {
      await writeD1JsonRecord(db, BILLING_D1_TABLES.operations, 'id', operationId, {
        id: operationId,
        uid: user.uid,
        kind: 'vf_to_vc',
        replayToken,
        vfDebited: vfAmount,
        vcCredited,
        rate,
        createdAt: now,
        updatedAt: now,
      }, now);
    }
  } else {
    // D1 write + Firestore write rather than Firestore-only transaction
    let alreadyProcessed = false;
    if (operationId) {
      const d1Fallback = await getBillingD1Db();
      if (d1Fallback) {
        const existingOp = await readD1JsonRecord(d1Fallback, BILLING_D1_TABLES.operations, 'id', operationId);
        if (existingOp) {
          return {
            ok: true,
            vfDebited: asPositiveNumber(existingOp.vfDebited),
            vcCredited: asPositiveNumber(existingOp.vcCredited),
            entitlements: await getAccountEntitlements(user),
          };
        }
      } else {
        const operationRef = firestore().collection('billing_operations').doc(operationId);
        const opSnap = await operationRef.get();
        if (opSnap.exists) {
          alreadyProcessed = true;
        }
      }
    }
    if (!alreadyProcessed) {
      const d1Fallback = await getBillingD1Db();
      if (d1Fallback) {
        const current = await readD1JsonRecord(d1Fallback, 'account_entitlements', 'uid', user.uid);
        await writeD1JsonRecord(d1Fallback, 'account_entitlements', 'uid', user.uid, {
          ...(current || {}),
          paidVfBalance: nextPaidVfBalance,
          vcPaidBalance: nextVcPaidBalance,
          vcSpendableBalance: nextVcSpendableBalance,
          updatedAt: now,
        }, now);
        await writeD1JsonRecord(d1Fallback, BILLING_D1_TABLES.walletTransactions, 'transaction_id', walletTransactionId, {
          uid: user.uid,
          kind: 'conversion',
          bucket: 'vcPaid',
          amount: vcCredited,
          metadata: { vfDebited: vfAmount, rate, ...(replayToken ? { replayToken } : {}) },
          createdAt: now,
        }, now);
        if (operationId) {
          await writeD1JsonRecord(d1Fallback, BILLING_D1_TABLES.operations, 'id', operationId, {
            id: operationId,
            uid: user.uid,
            kind: 'vf_to_vc',
            replayToken,
            vfDebited: vfAmount,
            vcCredited,
            rate,
            createdAt: now,
            updatedAt: now,
          }, now);
        }
      }
      // Firestore writes alongside D1
      await Promise.all([
        firestore().collection('entitlements').doc(user.uid).set({
          paidVfBalance: nextPaidVfBalance,
          vcPaidBalance: nextVcPaidBalance,
          vcSpendableBalance: nextVcSpendableBalance,
          updatedAt: now,
        }, { merge: true }),
        firestore().collection('wallet_transactions').doc(walletTransactionId).set({
          uid: user.uid,
          kind: 'conversion',
          bucket: 'vcPaid',
          amount: vcCredited,
          metadata: { vfDebited: vfAmount, rate, ...(replayToken ? { replayToken } : {}) },
          createdAt: now,
        }, { merge: true }),
        ...(operationId ? [firestore().collection('billing_operations').doc(operationId).set({
          id: operationId,
          uid: user.uid,
          kind: 'vf_to_vc',
          replayToken,
          vfDebited: vfAmount,
          vcCredited,
          rate,
          createdAt: now,
          updatedAt: now,
        }, { merge: true })] : []),
      ]);
    }
  }
  await updateAccountEntitlements(user.uid, {
    paidVfBalance: nextPaidVfBalance,
    vcPaidBalance: nextVcPaidBalance,
    vcSpendableBalance: nextVcSpendableBalance,
  });

  return {
    ok: true,
    vfDebited: vfAmount,
    vcCredited,
    entitlements: await getAccountEntitlements(user),
  };
};

const verifyStripeSignature = (payload: string, signatureHeader: string, secret: string): boolean => {
  const fields = Object.fromEntries(signatureHeader.split(',').map((entry) => {
    const [key, value] = entry.split('=');
    return [key, value];
  }));
  const timestamp = asString(fields.t);
  const signature = asString(fields.v1);
  if (!timestamp || !signature) return false;
  const signedPayload = `${timestamp}.${payload}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');
  return timingSafeEqual(Buffer.from(signature, 'utf-8'), Buffer.from(expected, 'utf-8'));
};

const processCheckoutCompletion = async (session: Record<string, unknown>): Promise<void> => {
  const metadata = session.metadata && typeof session.metadata === 'object' ? session.metadata as Record<string, unknown> : {};
  const uid = asString(metadata.uid || session.client_reference_id);
  if (!uid) return;
  const kind = asString(metadata.billingKind);
  if (kind === 'subscription') {
      const subscriptionId = asString(session.subscription);
      const customerId = asString(session.customer);
      if (subscriptionId && customerId) {
        const subscription = await stripeRequest<Record<string, unknown>>('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
        await syncSubscriptionEntitlement(uid, {
          customerId,
          subscription,
          planKey: asString(metadata.planKey) || undefined,
        });
      }
    return;
  }

  if (kind === 'token-pack') {
    const db = await getBillingD1Db();
    const now = currentIso();
    if (db) {
      const current = await readD1JsonRecord(db, 'account_entitlements', 'uid', uid);
      const currentPaidVf = asPositiveNumber(current?.paidVfBalance);
      const nextPaidVfBalance = currentPaidVf + asPositiveNumber(metadata.packVf);
      await writeD1JsonRecord(db, 'account_entitlements', 'uid', uid, {
        ...(current || {}),
        paidVfBalance: nextPaidVfBalance,
        updatedAt: now,
      }, now);
    } else {
      // D1 write + Firestore write rather than Firestore-only transaction
      const entSnap = await firestore().collection('entitlements').doc(uid).get();
      const entitlement = (entSnap.data() || {}) as Record<string, unknown>;
      const nextPaidVfBalance = asPositiveNumber(entitlement.paidVfBalance) + asPositiveNumber(metadata.packVf);
      const d1Fallback = await getBillingD1Db();
      if (d1Fallback) {
        const d1Current = await readD1JsonRecord(d1Fallback, 'account_entitlements', 'uid', uid);
        await writeD1JsonRecord(d1Fallback, 'account_entitlements', 'uid', uid, {
          ...(d1Current || {}),
          paidVfBalance: nextPaidVfBalance,
          updatedAt: now,
        }, now);
      }
      await firestore().collection('entitlements').doc(uid).set({
        paidVfBalance: nextPaidVfBalance,
        updatedAt: now,
      }, { merge: true });
      await updateAccountEntitlements(uid, { paidVfBalance: nextPaidVfBalance });
    }
    return;
  }

  if (kind === 'vc-token-pack') {
    const db = await getBillingD1Db();
    const now = currentIso();
    if (db) {
      const current = await readD1JsonRecord(db, 'account_entitlements', 'uid', uid);
      const credited = asPositiveNumber(metadata.packVc);
      const nextVcPaidBalance = asPositiveNumber(current?.vcPaidBalance) + credited;
      const nextVcSpendableBalance = asPositiveNumber(current?.vcSpendableBalance) + credited;
      await writeD1JsonRecord(db, 'account_entitlements', 'uid', uid, {
        ...(current || {}),
        vcPaidBalance: nextVcPaidBalance,
        vcSpendableBalance: nextVcSpendableBalance,
        updatedAt: now,
      }, now);
    } else {
      // D1 write + Firestore write rather than Firestore-only transaction
      const entSnap = await firestore().collection('entitlements').doc(uid).get();
      const entitlement = (entSnap.data() || {}) as Record<string, unknown>;
      const credited = asPositiveNumber(metadata.packVc);
      const nextVcPaidBalance = asPositiveNumber(entitlement.vcPaidBalance) + credited;
      const nextVcSpendableBalance = asPositiveNumber(entitlement.vcSpendableBalance) + credited;
      const d1Fallback = await getBillingD1Db();
      if (d1Fallback) {
        const d1Current = await readD1JsonRecord(d1Fallback, 'account_entitlements', 'uid', uid);
        await writeD1JsonRecord(d1Fallback, 'account_entitlements', 'uid', uid, {
          ...(d1Current || {}),
          vcPaidBalance: nextVcPaidBalance,
          vcSpendableBalance: nextVcSpendableBalance,
          updatedAt: now,
        }, now);
      }
      await firestore().collection('entitlements').doc(uid).set({
        vcPaidBalance: nextVcPaidBalance,
        vcSpendableBalance: nextVcSpendableBalance,
        updatedAt: now,
      }, { merge: true });
      await updateAccountEntitlements(uid, {
        vcPaidBalance: nextVcPaidBalance,
        vcSpendableBalance: nextVcSpendableBalance,
      });
    }
    return;
  }

  if (kind === 'vn-token-pack') {
    const db = await getBillingD1Db();
    const now = currentIso();
    if (db) {
      const current = await readD1JsonRecord(db, 'account_entitlements', 'uid', uid);
      const nextVnBalance = asPositiveNumber(current?.vnBalance) + asPositiveNumber(metadata.packVn);
      await writeD1JsonRecord(db, 'account_entitlements', 'uid', uid, {
        ...(current || {}),
        vnBalance: nextVnBalance,
        updatedAt: now,
      }, now);
    } else {
      // D1 write + Firestore write rather than Firestore-only transaction
      const entSnap = await firestore().collection('entitlements').doc(uid).get();
      const entitlement = (entSnap.data() || {}) as Record<string, unknown>;
      const nextVnBalance = asPositiveNumber(entitlement.vnBalance) + asPositiveNumber(metadata.packVn);
      const d1Fallback = await getBillingD1Db();
      if (d1Fallback) {
        const d1Current = await readD1JsonRecord(d1Fallback, 'account_entitlements', 'uid', uid);
        await writeD1JsonRecord(d1Fallback, 'account_entitlements', 'uid', uid, {
          ...(d1Current || {}),
          vnBalance: nextVnBalance,
          updatedAt: now,
        }, now);
      }
      await firestore().collection('entitlements').doc(uid).set({
        vnBalance: nextVnBalance,
        updatedAt: now,
      }, { merge: true });
      await updateAccountEntitlements(uid, { vnBalance: nextVnBalance });
    }
  }
};

export const handleStripeWebhook = async (
  rawBody: string,
  signatureHeader: string
): Promise<{ ok: true }> => {
  const secret = stripeWebhookSecret();
  if (secret) {
    if (!verifyStripeSignature(rawBody, signatureHeader, secret)) {
      throwHttpError(400, 'Invalid Stripe webhook signature.');
    }
  } else if (!rawBody) {
    throwHttpError(503, 'Stripe webhook config required.');
  }

  const event = JSON.parse(rawBody || '{}') as { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  const eventId = asString(event.id);
  if (eventId) {
    const db = await getBillingD1Db();
    const now = currentIso();
    if (db) {
      const existing = await readD1JsonRecord(db, BILLING_D1_TABLES.webhookEvents, 'id', eventId);
      if (existing) return { ok: true };
      await writeD1JsonRecord(db, BILLING_D1_TABLES.webhookEvents, 'id', eventId, {
        id: eventId,
        type: asString(event.type),
        createdAt: now,
      }, now);
    } else {
      const eventRef = firestore().collection('billing_webhook_events').doc(eventId);
      const existing = await eventRef.get();
      if (existing.exists) return { ok: true };
      await eventRef.set({
        id: eventId,
        type: asString(event.type),
        createdAt: now,
      }, { merge: true });
      // Dual-write: attempt D1 alongside Firestore
      const d1Dual = await getBillingD1Db();
      if (d1Dual) {
        await writeD1JsonRecord(d1Dual, BILLING_D1_TABLES.webhookEvents, 'id', eventId, {
          id: eventId,
          type: asString(event.type),
          createdAt: now,
        }, now);
      }
    }
  }

  const object = event.data?.object || {};
  if (event.type === 'checkout.session.completed') {
    await processCheckoutCompletion(object);
  } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const metadata = object.metadata && typeof object.metadata === 'object' ? object.metadata as Record<string, unknown> : {};
    const uid = asString(metadata.uid);
    if (uid) {
      await syncSubscriptionEntitlement(uid, {
        customerId: asString(object.customer),
        subscription: object,
        planKey: asString(metadata.planKey) || undefined,
      });
    }
  }
  return { ok: true };
};
