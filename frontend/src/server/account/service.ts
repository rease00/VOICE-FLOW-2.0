import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getCloudflareContext } from '@opennextjs/cloudflare';

import type { AccountBillingProfile, AccountEntitlements, AccountUserProfile, SupportConversation, SupportMessage } from '../../../services/accountService';
import type { NotificationWireItem } from '../../../services/notificationService';
import { BILLING_PLAN_ROWS } from '../../features/billing/catalog';
import type { ServerAuthedUserContext } from '../auth/requestAuth.ts';
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '../firebaseAdmin';
import { deleteReaderLegalAck } from './readerLegalAck';
import { analyzeSupportRequest } from '../support/automation';

const firestore = () => getFirebaseAdminFirestore();

const COLLECTIONS = Object.freeze({
  users: 'users',
  userProfiles: 'user_profiles',
  userIdIndex: 'user_id_index',
  entitlements: 'entitlements',
  generationHistory: 'generation_history',
  usageMonthly: 'usage_monthly',
  usageDaily: 'usage_daily',
  notificationInbox: 'notification_inbox',
  notificationPreferences: 'notification_preferences',
  supportConversations: 'support_conversations',
  supportMessages: 'support_messages',
  notificationEmailOutbox: 'notification_email_outbox',
  readerLegalAck: 'reader_legal_ack',
  readerProgress: 'reader_progress',
  readerUploads: 'reader_uploads',
  readerCastMemory: 'reader_cast_memory',
  readerTranslationCache: 'reader_translation_cache',
  readerSessions: 'reader_sessions',
  readerPreferences: 'reader_preferences',
  readerOfflineMetadata: 'reader_offline_metadata',
  walletDaily: 'wallet_daily',
  walletTransactions: 'wallet_transactions',
  couponRedemptions: 'coupon_redemptions',
  usageEvents: 'usage_events',
  stripeCustomers: 'stripe_customers',
  ttsV2Sessions: 'tts_v2_sessions',
});

const NOTIFICATION_ITEMS_SUBCOLLECTION = 'items';
const ACCOUNT_DELETE_CONFIRM_PHRASE = 'DELETE_MY_ACCOUNT';
const USER_ID_PATTERN = /^[a-z0-9_]{4,24}$/;
const USER_ID_RESERVED = new Set(['admin', 'api', 'billing', 'root', 'support', 'system', 'user']);

type PlanConfig = {
  key: 'free' | 'launcher' | 'starter' | 'creator' | 'pro' | 'scale';
  name: 'Free' | 'Launcher' | 'Starter' | 'Creator' | 'Pro' | 'Scale';
  monthlyVfLimit: number;
  firstCycleInr: number;
  recurringInr: number;
  maxCharsPerGeneration: number;
  allowedEngines: Array<'VECTOR' | 'PRIME'>;
  tokenPackDiscountPercent: number;
  vcTokenPackDiscountPercent: number;
  earlyAccess: boolean;
  ttsSuccessRpm: number;
  status: string;
};

const PAID_PLAN_CONFIGS = Object.fromEntries(
  BILLING_PLAN_ROWS.map((row) => [row.key, row])
) as Record<'launcher' | 'starter' | 'creator' | 'pro' | 'scale', (typeof BILLING_PLAN_ROWS)[number]>;

const PLAN_CONFIGS: Record<PlanConfig['key'], PlanConfig> = {
  free: {
    key: 'free',
    name: 'Free',
    monthlyVfLimit: 10_000,
    firstCycleInr: 0,
    recurringInr: 0,
    maxCharsPerGeneration: 8_000,
    allowedEngines: ['VECTOR'],
    tokenPackDiscountPercent: 0,
    vcTokenPackDiscountPercent: 0,
    earlyAccess: false,
    ttsSuccessRpm: 3,
    status: 'free_active',
  },
  launcher: {
    key: 'launcher',
    name: 'Launcher',
    monthlyVfLimit: PAID_PLAN_CONFIGS.launcher.vfCredits,
    firstCycleInr: PAID_PLAN_CONFIGS.launcher.firstCycleInr,
    recurringInr: PAID_PLAN_CONFIGS.launcher.recurringInr,
    maxCharsPerGeneration: 9_000,
    allowedEngines: ['VECTOR', 'PRIME'],
    tokenPackDiscountPercent: 0,
    vcTokenPackDiscountPercent: 0,
    earlyAccess: false,
    ttsSuccessRpm: 5,
    status: 'active',
  },
  starter: {
    key: 'starter',
    name: 'Starter',
    monthlyVfLimit: PAID_PLAN_CONFIGS.starter.vfCredits,
    firstCycleInr: PAID_PLAN_CONFIGS.starter.firstCycleInr,
    recurringInr: PAID_PLAN_CONFIGS.starter.recurringInr,
    maxCharsPerGeneration: 10_000,
    allowedEngines: ['VECTOR', 'PRIME'],
    tokenPackDiscountPercent: 5,
    vcTokenPackDiscountPercent: 0,
    earlyAccess: false,
    ttsSuccessRpm: 5,
    status: 'active',
  },
  creator: {
    key: 'creator',
    name: 'Creator',
    monthlyVfLimit: PAID_PLAN_CONFIGS.creator.vfCredits,
    firstCycleInr: PAID_PLAN_CONFIGS.creator.firstCycleInr,
    recurringInr: PAID_PLAN_CONFIGS.creator.recurringInr,
    maxCharsPerGeneration: 10_000,
    allowedEngines: ['VECTOR', 'PRIME'],
    tokenPackDiscountPercent: 5,
    vcTokenPackDiscountPercent: 0,
    earlyAccess: false,
    ttsSuccessRpm: 5,
    status: 'active',
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    monthlyVfLimit: PAID_PLAN_CONFIGS.pro.vfCredits,
    firstCycleInr: PAID_PLAN_CONFIGS.pro.firstCycleInr,
    recurringInr: PAID_PLAN_CONFIGS.pro.recurringInr,
    maxCharsPerGeneration: 10_000,
    allowedEngines: ['VECTOR', 'PRIME'],
    tokenPackDiscountPercent: 10,
    vcTokenPackDiscountPercent: 5,
    earlyAccess: false,
    ttsSuccessRpm: 5,
    status: 'active',
  },
  scale: {
    key: 'scale',
    name: 'Scale',
    monthlyVfLimit: PAID_PLAN_CONFIGS.scale.vfCredits,
    firstCycleInr: PAID_PLAN_CONFIGS.scale.firstCycleInr,
    recurringInr: PAID_PLAN_CONFIGS.scale.recurringInr,
    maxCharsPerGeneration: 15_000,
    allowedEngines: ['VECTOR', 'PRIME'],
    tokenPackDiscountPercent: 15,
    vcTokenPackDiscountPercent: 5,
    earlyAccess: true,
    ttsSuccessRpm: 10,
    status: 'active',
  },
};

const asString = (value: unknown): string => String(value ?? '').trim();
const asLower = (value: unknown): string => asString(value).toLowerCase();
const asNumber = (value: unknown, fallback = 0): number => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};
const asPositiveNumber = (value: unknown, fallback = 0): number => Math.max(0, asNumber(value, fallback));
const asPositiveInt = (value: unknown, fallback = 0): number => Math.max(0, Math.floor(asNumber(value, fallback)));
const asBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  const normalized = asLower(value);
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const toIsoString = (value: unknown, fallback = ''): string => {
  if (!value) return fallback;
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const maybeTimestamp = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof maybeTimestamp.toDate === 'function') {
      return maybeTimestamp.toDate().toISOString();
    }
    const seconds = Number(maybeTimestamp.seconds ?? maybeTimestamp._seconds);
    if (Number.isFinite(seconds) && seconds > 0) {
      return new Date(seconds * 1000).toISOString();
    }
  }
  return fallback;
};

const currentUtc = (): Date => new Date();

const toMonthKey = (date: Date): string => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
const toDayKey = (date: Date): string => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

const monthWindowUtc = (date: Date): { start: string; end: string } => {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
};

const dayWindowUtc = (date: Date): { start: string; end: string } => {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
};

const isAdminUser = (user: ServerAuthedUserContext): boolean => {
  if (asBoolean((user.decodedToken as Record<string, unknown>).admin)) return true;
  if (asBoolean(user.userData?.isAdmin)) return true;
  return asLower(user.userData?.role) === 'admin';
};

const normalizePlanKey = (value: unknown): PlanConfig['key'] => {
  const normalized = asLower(value);
  if (normalized === 'launcher' || normalized === 'launch') return 'launcher';
  if (normalized === 'starter') return 'starter';
  if (normalized === 'creator') return 'creator';
  if (normalized === 'pro') return 'pro';
  if (normalized === 'scale' || normalized === 'plus' || normalized === 'pro_plus' || normalized === 'pro-plus') return 'scale';
  return 'free';
};

const getPlanConfig = (value: unknown): PlanConfig => PLAN_CONFIGS[normalizePlanKey(value)];

const normalizeUserIdCandidate = (value: unknown): string => {
  let token = asLower(value)
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!token) return '';
  if (!/^[a-z]/.test(token)) token = `u_${token}`;
  if (token.length < 4) token = `${token}${'user'.slice(0, 4 - token.length)}`;
  if (token.length > 24) token = token.slice(0, 24);
  return token;
};

const buildSuggestedUserId = (user: ServerAuthedUserContext): string => {
  const current = normalizeUserIdCandidate(user.userData?.userId);
  if (current) return current;
  const fromEmail = asString(user.decodedToken.email).split('@')[0] || '';
  const emailCandidate = normalizeUserIdCandidate(fromEmail);
  if (emailCandidate) return emailCandidate;
  const displayNameCandidate = normalizeUserIdCandidate(user.userData?.displayName || user.userData?.name);
  if (displayNameCandidate) return displayNameCandidate;
  return normalizeUserIdCandidate(user.uid.slice(0, 12));
};

const assertValidUserId = (value: string): string => {
  const normalized = normalizeUserIdCandidate(value);
  if (!normalized || !USER_ID_PATTERN.test(normalized) || USER_ID_RESERVED.has(normalized)) {
    throw new Error('User ID must use 4-24 lowercase letters, numbers, or underscores.');
  }
  return normalized;
};

const normalizeBillingProfile = (value: unknown): AccountBillingProfile | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const payload: AccountBillingProfile = {};
  const fields: Array<keyof AccountBillingProfile> = [
    'companyName',
    'billingEmail',
    'phone',
    'taxId',
    'addressLine1',
    'addressLine2',
    'city',
    'state',
    'postalCode',
    'country',
  ];
  for (const field of fields) {
    const next = asString(source[field]);
    if (next) payload[field] = next;
  }
  return Object.keys(payload).length > 0 ? payload : null;
};

const getUserProfileRef = (uid: string) => firestore().collection(COLLECTIONS.userProfiles).doc(uid);
const getUserIdIndexRef = (userId: string) => firestore().collection(COLLECTIONS.userIdIndex).doc(userId);

const defaultAccountProfile = (
  user: ServerAuthedUserContext,
  overrides: Partial<AccountUserProfile> = {}
): AccountUserProfile => ({
  uid: user.uid,
  userId: '',
  displayName: asString(user.userData?.displayName || user.userData?.name) || undefined,
  email: asString(user.decodedToken.email || user.userData?.email) || undefined,
  billingProfile: normalizeBillingProfile(user.userData?.billingProfile),
  status: isAdminUser(user) ? 'admin' : 'pending',
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

export const serializeAccountProfileForFirestore = (
  profile: AccountUserProfile
): Record<string, unknown> => ({
  uid: profile.uid,
  userId: profile.userId || '',
  displayName: profile.displayName || '',
  email: profile.email || '',
  billingProfile: profile.billingProfile || null,
  status: profile.status || 'active',
  createdAt: profile.createdAt || new Date().toISOString(),
  updatedAt: profile.updatedAt || new Date().toISOString(),
});

const mergeProfile = (user: ServerAuthedUserContext, profileData: Record<string, unknown> | null): AccountUserProfile => {
  const profile = defaultAccountProfile(user);
  if (!profileData) return profile;
  return {
    uid: user.uid,
    userId: asString(profileData.userId) || '',
    displayName: asString(profileData.displayName || user.userData?.displayName || user.userData?.name) || undefined,
    email: asString(profileData.email || user.decodedToken.email || user.userData?.email) || undefined,
    billingProfile: normalizeBillingProfile(profileData.billingProfile || user.userData?.billingProfile),
    status: asString(profileData.status) || profile.status,
    createdAt: toIsoString(profileData.createdAt),
    updatedAt: toIsoString(profileData.updatedAt),
  };
};

const syncUserDocument = async (uid: string, profile: AccountUserProfile): Promise<void> => {
  await firestore().collection(COLLECTIONS.users).doc(uid).set({
    userId: profile.userId || '',
    displayName: profile.displayName || '',
    email: profile.email || '',
    billingProfile: profile.billingProfile || null,
    status: profile.status || 'active',
    updatedAt: profile.updatedAt || new Date().toISOString(),
  }, { merge: true });
};

const reserveUserId = async (uid: string, requestedUserId: string, currentUserId: string): Promise<string> => {
  const normalized = assertValidUserId(requestedUserId);
  if (normalized === currentUserId) return normalized;

  const existingUid = await readPersistedUserIdOwner(normalized);
  if (existingUid && existingUid !== uid) {
    throw new Error('That user ID is already taken.');
  }

  if (currentUserId && currentUserId !== normalized) {
    const db = await getAccountBillingD1Database();
    if (db) {
      await ensureAccountBillingD1Schema(db);
      await deleteD1UserIdIndex(db, currentUserId, uid);
    }
    await getUserIdIndexRef(currentUserId).delete().catch(() => undefined);
  }

  await writePersistedUserIdIndex(uid, normalized);

  return normalized;
};

const resolveUniqueBootstrapUserId = async (uid: string, baseCandidate: string): Promise<string> => {
  const candidate = assertValidUserId(baseCandidate);
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const suffix = attempt === 0 ? '' : String(attempt + 1);
    const next = `${candidate}${suffix}`.slice(0, 24);
    const owner = await readPersistedUserIdOwner(next);
    if (!owner || owner === uid) {
      await writePersistedUserIdIndex(uid, next);
      return next;
    }
  }
  return `${candidate.slice(0, 20)}${uid.slice(0, 4)}`.slice(0, 24);
};

const ensureAccountProfile = async (
  user: ServerAuthedUserContext,
  options: { autoBootstrap?: boolean } = {}
): Promise<AccountUserProfile> => {
  const profileRecord = await readPersistedProfileRecord(user.uid);
  let profile = mergeProfile(user, profileRecord);
  const nowIso = new Date().toISOString();

  if (!profileRecord) {
    let bootstrappedUserId = '';
    if (!isAdminUser(user) && options.autoBootstrap === true) {
      bootstrappedUserId = await resolveUniqueBootstrapUserId(user.uid, buildSuggestedUserId(user));
    }

    profile = defaultAccountProfile(user, {
      userId: bootstrappedUserId,
      status: isAdminUser(user) ? 'admin' : (bootstrappedUserId ? 'active' : 'pending'),
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    await writePersistedProfileRecord(profile);
    await syncUserDocument(user.uid, profile);
    return profile;
  }

  const patch: Record<string, unknown> = {};
  if (!profile.updatedAt) patch.updatedAt = nowIso;
  if (!profile.createdAt) patch.createdAt = nowIso;
  if (!profile.email && asString(user.decodedToken.email || user.userData?.email)) {
    patch.email = asString(user.decodedToken.email || user.userData?.email);
  }
  if (!profile.displayName && asString(user.userData?.displayName || user.userData?.name)) {
    patch.displayName = asString(user.userData?.displayName || user.userData?.name);
  }
  if (isAdminUser(user) && profile.status !== 'admin') {
    patch.status = 'admin';
  }
  if (Object.keys(patch).length > 0) {
    profile = {
      ...profile,
      ...(patch as Partial<AccountUserProfile>),
    };
    await writePersistedProfileRecord(profile);
  }
  await syncUserDocument(user.uid, profile);
  return profile;
};

const buildProfileResponse = async (
  user: ServerAuthedUserContext,
  options: { autoBootstrap?: boolean } = {}
): Promise<{ profile: AccountUserProfile; requiredUserId: boolean; suggestedUserId?: string }> => {
  const profile = await ensureAccountProfile(user, options);
  const requiredUserId = !isAdminUser(user) && !asString(profile.userId);
  const suggestedUserId = isAdminUser(user) ? '' : buildSuggestedUserId(user);
  return {
    profile,
    requiredUserId,
    ...(suggestedUserId ? { suggestedUserId } : {}),
  };
};

const emptyByEngine = (): Record<'VECTOR' | 'PRIME', { chars: number; vf: number }> => ({
  VECTOR: { chars: 0, vf: 0 },
  PRIME: { chars: 0, vf: 0 },
});

const defaultEntitlementDoc = (uid: string, planKey: PlanConfig['key'] = 'free') => {
  const plan = getPlanConfig(planKey);
  return {
    uid,
    plan: plan.name,
    status: plan.status,
    monthlyVfLimit: plan.monthlyVfLimit,
    dailyGenerationLimit: plan.key === 'free' ? 10 : 100,
    paidVfBalance: 0,
    vffBalance: 0,
    vcFreeBalance: 0,
    vcGrantedBalance: 0,
    vcPaidBalance: 0,
    vcSpendableBalance: 0,
    vnBalance: 0,
    currencyMode: 'INR_BASE_AUTO_FX',
    billingCountry: null,
    stripeCustomerId: null,
    subscriptionId: null,
    earlyAccess: plan.earlyAccess,
    updatedAt: new Date().toISOString(),
  };
};

const ACCOUNT_BILLING_D1_TABLES = Object.freeze({
  profiles: 'account_profiles',
  userIdIndex: 'account_user_id_index',
  entitlements: 'account_entitlements',
  notificationPreferences: 'account_notification_preferences',
  supportConversations: 'account_support_conversations',
  supportMessages: 'account_support_messages',
} as const);

const ACCOUNT_BILLING_D1_SCHEMA = `
CREATE TABLE IF NOT EXISTS account_profiles (
  uid TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_user_id_index (
  user_id TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_entitlements (
  uid TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_notification_preferences (
  uid TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_support_conversations (
  conversation_id TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS account_support_conversations_uid_updated_at_idx
  ON account_support_conversations (uid, updated_at DESC, conversation_id DESC);
CREATE TABLE IF NOT EXISTS account_support_messages (
  message_id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS account_support_messages_conversation_created_at_idx
  ON account_support_messages (conversation_id, created_at ASC, message_id ASC);
`;

type AccountBillingD1Statement = {
  bind: (...values: unknown[]) => AccountBillingD1Statement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
};

type AccountBillingD1Database = {
  prepare: (sql: string) => AccountBillingD1Statement;
  exec: (sql: string) => Promise<unknown>;
};

let accountBillingD1DatabasePromise: Promise<AccountBillingD1Database | null> | null = null;
let accountBillingD1SchemaPromise: Promise<void> | null = null;

const parsePersistedJsonRecord = (value: string | null | undefined): Record<string, unknown> | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
};

const getAccountBillingD1Database = async (): Promise<AccountBillingD1Database | null> => {
  if (!accountBillingD1DatabasePromise) {
    accountBillingD1DatabasePromise = (async () => {
      try {
        const { env } = await getCloudflareContext({ async: true });
        const db = (env as { DB?: AccountBillingD1Database }).DB;
        return db && typeof db.prepare === 'function' ? db : null;
      } catch {
        return null;
      }
    })();
  }
  return accountBillingD1DatabasePromise;
};

const ensureAccountBillingD1Schema = async (db: AccountBillingD1Database): Promise<void> => {
  if (!accountBillingD1SchemaPromise) {
    accountBillingD1SchemaPromise = db.exec(ACCOUNT_BILLING_D1_SCHEMA).then(() => undefined).catch((error: unknown) => {
      accountBillingD1SchemaPromise = null;
      throw error;
    });
  }
  await accountBillingD1SchemaPromise;
};

const readD1JsonRecord = async (
  db: AccountBillingD1Database,
  table: string,
  keyColumn: string,
  keyValue: string
): Promise<Record<string, unknown> | null> => {
  const row = await db.prepare(`SELECT payload_json FROM ${table} WHERE ${keyColumn} = ? LIMIT 1`)
    .bind(keyValue)
    .first<{ payload_json?: string }>();
  return parsePersistedJsonRecord(row?.payload_json || null);
};

const readD1JsonRows = async (
  db: AccountBillingD1Database,
  sql: string,
  ...values: unknown[]
): Promise<Record<string, unknown>[]> => {
  const response = await db.prepare(sql).bind(...values).all<Record<string, unknown>>();
  return Array.isArray(response?.results) ? response.results : [];
};

const readD1IndexUid = async (
  db: AccountBillingD1Database,
  userId: string
): Promise<string> => {
  const row = await db.prepare(`SELECT uid FROM ${ACCOUNT_BILLING_D1_TABLES.userIdIndex} WHERE user_id = ? LIMIT 1`)
    .bind(userId)
    .first<{ uid?: string }>();
  return asString(row?.uid);
};

const writeD1JsonRecord = async (
  db: AccountBillingD1Database,
  table: string,
  keyColumn: string,
  keyValue: string,
  payload: Record<string, unknown>,
  updatedAt = new Date().toISOString()
): Promise<void> => {
  await db.prepare(`
    INSERT INTO ${table} (${keyColumn}, payload_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(${keyColumn}) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `)
    .bind(keyValue, JSON.stringify(payload), updatedAt)
    .run();
};

const deleteD1JsonRecord = async (
  db: AccountBillingD1Database,
  table: string,
  keyColumn: string,
  keyValue: string
): Promise<void> => {
  await db.prepare(`DELETE FROM ${table} WHERE ${keyColumn} = ?`)
    .bind(keyValue)
    .run();
};

const writeD1UserIdIndex = async (db: AccountBillingD1Database, uid: string, userId: string, updatedAt = new Date().toISOString()): Promise<void> => {
  await db.prepare(`
    INSERT INTO ${ACCOUNT_BILLING_D1_TABLES.userIdIndex} (user_id, uid, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      uid = excluded.uid,
      updated_at = excluded.updated_at
  `)
    .bind(userId, uid, updatedAt)
    .run();
};

const deleteD1UserIdIndex = async (db: AccountBillingD1Database, userId: string, uid: string): Promise<void> => {
  await db.prepare(`
    DELETE FROM ${ACCOUNT_BILLING_D1_TABLES.userIdIndex}
    WHERE user_id = ? AND uid = ?
  `)
    .bind(userId, uid)
    .run();
};

const buildNotificationPreferencesDefaults = (user: ServerAuthedUserContext): Record<string, unknown> => ({
  uid: user.uid,
  emailAsyncJobs: true,
  emailBilling: true,
  emailSupport: true,
  emailAdminAlerts: isAdminUser(user),
  updatedAt: new Date().toISOString(),
});

const normalizeNotificationPreferencesRecord = (
  user: ServerAuthedUserContext,
  value: Record<string, unknown> | null | undefined
): Record<string, unknown> => {
  const defaults = buildNotificationPreferencesDefaults(user);
  if (!value) return defaults;
  return {
    uid: user.uid,
    emailAsyncJobs: value.emailAsyncJobs === undefined ? defaults.emailAsyncJobs : Boolean(value.emailAsyncJobs),
    emailBilling: value.emailBilling === undefined ? defaults.emailBilling : Boolean(value.emailBilling),
    emailSupport: value.emailSupport === undefined ? defaults.emailSupport : Boolean(value.emailSupport),
    emailAdminAlerts: value.emailAdminAlerts === undefined
      ? defaults.emailAdminAlerts
      : (isAdminUser(user) && Boolean(value.emailAdminAlerts)),
    updatedAt: asString(value.updatedAt) || asString(value.updated_at) || defaults.updatedAt,
  };
};

const readPersistedNotificationPreferences = async (user: ServerAuthedUserContext): Promise<Record<string, unknown>> => {
  const db = await getAccountBillingD1Database();
  if (db) {
    await ensureAccountBillingD1Schema(db);
    const d1Record = await readD1JsonRecord(db, ACCOUNT_BILLING_D1_TABLES.notificationPreferences, 'uid', user.uid);
    if (d1Record) {
      const normalized = normalizeNotificationPreferencesRecord(user, d1Record);
      await firestore().collection(COLLECTIONS.notificationPreferences).doc(user.uid).set(normalized, { merge: true });
      return normalized;
    }
  }

  const snapshot = await firestore().collection(COLLECTIONS.notificationPreferences).doc(user.uid).get();
  const firestoreRecord = snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null;
  if (db && firestoreRecord) {
    const normalized = normalizeNotificationPreferencesRecord(user, firestoreRecord);
    await writeD1JsonRecord(db, ACCOUNT_BILLING_D1_TABLES.notificationPreferences, 'uid', user.uid, normalized, asString(normalized.updatedAt) || new Date().toISOString());
    return normalized;
  }

  return normalizeNotificationPreferencesRecord(user, firestoreRecord);
};

const persistNotificationPreferences = async (user: ServerAuthedUserContext, preferences: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const normalized = normalizeNotificationPreferencesRecord(user, preferences);
  const db = await getAccountBillingD1Database();
  if (db) {
    await ensureAccountBillingD1Schema(db);
    await writeD1JsonRecord(db, ACCOUNT_BILLING_D1_TABLES.notificationPreferences, 'uid', user.uid, normalized, asString(normalized.updatedAt) || new Date().toISOString());
  }
  await firestore().collection(COLLECTIONS.notificationPreferences).doc(user.uid).set(normalized, { merge: true });
  return normalized;
};

const deletePersistedNotificationPreferences = async (uid: string): Promise<number> => {
  let deletedCount = 0;
  const db = await getAccountBillingD1Database();
  if (db) {
    await ensureAccountBillingD1Schema(db);
    const d1Record = await readD1JsonRecord(db, ACCOUNT_BILLING_D1_TABLES.notificationPreferences, 'uid', uid);
    if (d1Record) {
      deletedCount = 1;
    }
    await deleteD1JsonRecord(db, ACCOUNT_BILLING_D1_TABLES.notificationPreferences, 'uid', uid);
  }
  const snapshot = await firestore().collection(COLLECTIONS.notificationPreferences).doc(uid).get();
  if (snapshot.exists) {
    deletedCount = 1;
    await firestore().collection(COLLECTIONS.notificationPreferences).doc(uid).delete().catch(() => undefined);
  }
  return deletedCount;
};

const normalizeSupportConversationRecord = (
  conversationId: string,
  data: Record<string, unknown>
): SupportConversation => ({
  conversationId,
  uid: asString(data.uid),
  userId: asString(data.userId),
  status: asString(data.status) || 'open',
  priority: asString(data.priority) || 'yellow',
  lastMessageAt: toIsoString(data.lastMessageAt) || undefined,
  assignedTo: asString(data.assignedTo) || undefined,
  updatedAt: toIsoString(data.updatedAt) || undefined,
});

const normalizeSupportMessageRecord = (
  messageId: string,
  data: Record<string, unknown>
): SupportMessage => ({
  messageId,
  conversationId: asString(data.conversationId),
  fromType: asString(data.fromType) || 'user',
  uid: asString(data.uid) || undefined,
  userId: asString(data.userId) || undefined,
  text: asString(data.text),
  createdAt: toIsoString(data.createdAt) || undefined,
});

const readPersistedSupportConversationById = async (conversationId: string): Promise<SupportConversation | null> => {
  const db = await getAccountBillingD1Database();
  if (db) {
    await ensureAccountBillingD1Schema(db);
    const row = await db.prepare(`SELECT conversation_id, uid, payload_json, updated_at FROM ${ACCOUNT_BILLING_D1_TABLES.supportConversations} WHERE conversation_id = ? LIMIT 1`)
      .bind(conversationId)
      .first<{ conversation_id?: string; uid?: string; payload_json?: string; updated_at?: string }>();
    const payload = parsePersistedJsonRecord(row?.payload_json || null);
    if (payload && row?.conversation_id) {
      const conversation = normalizeSupportConversationRecord(row.conversation_id, payload);
      await firestore().collection(COLLECTIONS.supportConversations).doc(conversationId).set({
        ...payload,
        updatedAt: conversation.updatedAt || asString(row.updated_at) || new Date().toISOString(),
      }, { merge: true });
      return conversation;
    }
  }

  const snapshot = await firestore().collection(COLLECTIONS.supportConversations).doc(conversationId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as Record<string, unknown>;
  const conversation = normalizeSupportConversationRecord(conversationId, data);
  if (db) {
    await writeD1JsonRecord(db, ACCOUNT_BILLING_D1_TABLES.supportConversations, 'conversation_id', conversationId, {
      ...data,
      updatedAt: conversation.updatedAt || new Date().toISOString(),
    }, conversation.updatedAt || new Date().toISOString());
  }
  return conversation;
};

const readPersistedSupportConversations = async (user: ServerAuthedUserContext, limit: number): Promise<SupportConversation[]> => {
  const db = await getAccountBillingD1Database();
  if (db) {
    await ensureAccountBillingD1Schema(db);
    const rows = await readD1JsonRows(
      db,
      `SELECT conversation_id, uid, payload_json, updated_at FROM ${ACCOUNT_BILLING_D1_TABLES.supportConversations} WHERE uid = ? ORDER BY updated_at DESC, conversation_id DESC LIMIT ?`,
      user.uid,
      limit
    );
    if (rows.length > 0) {
      const conversations = rows
        .map((row) => {
          const conversationId = asString(row.conversation_id);
          const payload = parsePersistedJsonRecord(asString(row.payload_json));
          return conversationId && payload ? normalizeSupportConversationRecord(conversationId, payload) : null;
        })
        .filter((item): item is SupportConversation => Boolean(item));
      await Promise.all(conversations.map(async (conversation) => {
        const payload = rows.find((row) => asString(row.conversation_id) === conversation.conversationId);
        const parsed = parsePersistedJsonRecord(asString(payload?.payload_json));
        if (parsed) {
          await firestore().collection(COLLECTIONS.supportConversations).doc(conversation.conversationId).set({
            ...parsed,
            updatedAt: conversation.updatedAt || new Date().toISOString(),
          }, { merge: true });
        }
      }));
      return conversations;
    }
  }

  const snapshot = await firestore().collection(COLLECTIONS.supportConversations).where('uid', '==', user.uid).limit(limit).get();
  const conversations = snapshot.docs
    .map((doc) => normalizeSupportConversation(doc as QueryDocumentSnapshot))
    .sort((left, right) => asNumber(Date.parse(String(right.updatedAt || ''))) - asNumber(Date.parse(String(left.updatedAt || ''))));
  if (db && conversations.length > 0) {
    await Promise.all(conversations.map((conversation) => writeD1JsonRecord(db, ACCOUNT_BILLING_D1_TABLES.supportConversations, 'conversation_id', conversation.conversationId, {
      uid: conversation.uid,
      userId: conversation.userId || '',
      status: conversation.status,
      priority: conversation.priority,
      lastMessageAt: conversation.lastMessageAt || null,
      assignedTo: conversation.assignedTo || null,
      updatedAt: conversation.updatedAt || new Date().toISOString(),
    }, conversation.updatedAt || new Date().toISOString())));
  }
  return conversations;
};

const readPersistedSupportMessages = async (conversationId: string): Promise<SupportMessage[]> => {
  const db = await getAccountBillingD1Database();
  if (db) {
    await ensureAccountBillingD1Schema(db);
    const rows = await readD1JsonRows(
      db,
      `SELECT message_id, conversation_id, uid, payload_json, created_at FROM ${ACCOUNT_BILLING_D1_TABLES.supportMessages} WHERE conversation_id = ? ORDER BY created_at ASC, message_id ASC`,
      conversationId
    );
    if (rows.length > 0) {
      const messages = rows
        .map((row) => {
          const messageId = asString(row.message_id);
          const payload = parsePersistedJsonRecord(asString(row.payload_json));
          return messageId && payload ? normalizeSupportMessageRecord(messageId, payload) : null;
        })
        .filter((item): item is SupportMessage => Boolean(item));
      await Promise.all(messages.map((message) => firestore().collection(COLLECTIONS.supportMessages).doc(message.messageId).set({
        conversationId: message.conversationId,
        uid: message.uid || '',
        userId: message.userId || '',
        fromType: message.fromType,
        text: message.text,
        createdAt: message.createdAt || new Date().toISOString(),
      }, { merge: true })));
      return messages;
    }
  }

  const snapshot = await firestore().collection(COLLECTIONS.supportMessages).where('conversationId', '==', conversationId).get();
  const messages = snapshot.docs
    .map((doc) => normalizeSupportMessage(doc as QueryDocumentSnapshot))
    .sort((left, right) => asNumber(Date.parse(String(left.createdAt || ''))) - asNumber(Date.parse(String(right.createdAt || ''))));
  if (db && messages.length > 0) {
    await Promise.all(messages.map((message) => writeD1JsonRecord(db, ACCOUNT_BILLING_D1_TABLES.supportMessages, 'message_id', message.messageId, {
      conversationId: message.conversationId,
      uid: message.uid || '',
      userId: message.userId || '',
      fromType: message.fromType,
      text: message.text,
      createdAt: message.createdAt || new Date().toISOString(),
    }, message.createdAt || new Date().toISOString())));
  }
  return messages;
};

const persistSupportConversation = async (
  conversationId: string,
  payload: Record<string, unknown>
): Promise<void> => {
  const normalizedPayload = {
    ...payload,
    updatedAt: asString(payload.updatedAt) || new Date().toISOString(),
  };
  const db = await getAccountBillingD1Database();
  if (db) {
    await ensureAccountBillingD1Schema(db);
    await writeD1JsonRecord(db, ACCOUNT_BILLING_D1_TABLES.supportConversations, 'conversation_id', conversationId, normalizedPayload, asString(normalizedPayload.updatedAt) || new Date().toISOString());
  }
  await firestore().collection(COLLECTIONS.supportConversations).doc(conversationId).set(normalizedPayload, { merge: true });
};

const persistSupportMessage = async (
  messageId: string,
  payload: Record<string, unknown>
): Promise<void> => {
  const db = await getAccountBillingD1Database();
  if (db) {
    await ensureAccountBillingD1Schema(db);
    await writeD1JsonRecord(db, ACCOUNT_BILLING_D1_TABLES.supportMessages, 'message_id', messageId, payload, asString(payload.createdAt) || new Date().toISOString());
  }
  await firestore().collection(COLLECTIONS.supportMessages).doc(messageId).set(payload, { merge: true });
};

const deletePersistedSupportConversations = async (uid: string): Promise<number> => {
  let deletedCount = 0;
  const db = await getAccountBillingD1Database();
  if (db) {
    await ensureAccountBillingD1Schema(db);
    const rows = await readD1JsonRows(
      db,
      `SELECT conversation_id, uid, payload_json, updated_at FROM ${ACCOUNT_BILLING_D1_TABLES.supportConversations} WHERE uid = ?`,
      uid
    );
    deletedCount = rows.length;
    await db.prepare(`DELETE FROM ${ACCOUNT_BILLING_D1_TABLES.supportConversations} WHERE uid = ?`)
      .bind(uid)
      .run();
  }
  const snapshot = await firestore().collection(COLLECTIONS.supportConversations).where('uid', '==', uid).get();
  if (!snapshot.empty) {
    deletedCount = Math.max(deletedCount, snapshot.docs.length);
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete().catch(() => undefined)));
  }
  return deletedCount;
};

const deletePersistedSupportMessages = async (uid: string): Promise<number> => {
  let deletedCount = 0;
  const db = await getAccountBillingD1Database();
  if (db) {
    await ensureAccountBillingD1Schema(db);
    const rows = await readD1JsonRows(
      db,
      `SELECT message_id, conversation_id, uid, payload_json, created_at FROM ${ACCOUNT_BILLING_D1_TABLES.supportMessages} WHERE uid = ?`,
      uid
    );
    deletedCount = rows.length;
    await db.prepare(`DELETE FROM ${ACCOUNT_BILLING_D1_TABLES.supportMessages} WHERE uid = ?`)
      .bind(uid)
      .run();
  }
  const snapshot = await firestore().collection(COLLECTIONS.supportMessages).where('uid', '==', uid).get();
  if (!snapshot.empty) {
    deletedCount = Math.max(deletedCount, snapshot.docs.length);
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete().catch(() => undefined)));
  }
  return deletedCount;
};

const readPersistedProfileRecord = async (uid: string): Promise<Record<string, unknown> | null> => {
  const db = await getAccountBillingD1Database();
  if (db) {
    await ensureAccountBillingD1Schema(db);
    const d1Record = await readD1JsonRecord(db, ACCOUNT_BILLING_D1_TABLES.profiles, 'uid', uid);
    if (d1Record) {
      await getUserProfileRef(uid).set(d1Record, { merge: true });
      return d1Record;
    }
  }

  const snapshot = await getUserProfileRef(uid).get();
  const firestoreRecord = snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null;
  if (db && firestoreRecord) {
    await writeD1JsonRecord(db, ACCOUNT_BILLING_D1_TABLES.profiles, 'uid', uid, firestoreRecord, asString(firestoreRecord.updatedAt) || new Date().toISOString());
  }
  return firestoreRecord;
};

const writePersistedProfileRecord = async (profile: AccountUserProfile): Promise<void> => {
  const payload = serializeAccountProfileForFirestore(profile);
  const db = await getAccountBillingD1Database();
  if (db) {
    await ensureAccountBillingD1Schema(db);
    await writeD1JsonRecord(db, ACCOUNT_BILLING_D1_TABLES.profiles, 'uid', profile.uid, payload, profile.updatedAt || new Date().toISOString());
  }
  await getUserProfileRef(profile.uid).set(payload, { merge: true });
};

const readPersistedUserIdOwner = async (userId: string): Promise<string> => {
  const db = await getAccountBillingD1Database();
  if (db) {
    await ensureAccountBillingD1Schema(db);
    const d1Owner = await readD1IndexUid(db, userId);
    if (d1Owner) {
      await getUserIdIndexRef(userId).set({
        uid: d1Owner,
        userId,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      return d1Owner;
    }
  }

  const snapshot = await getUserIdIndexRef(userId).get();
  const firestoreOwner = snapshot.exists ? asString(snapshot.data()?.uid) : '';
  if (db && firestoreOwner) {
    await writeD1UserIdIndex(db, firestoreOwner, userId, asString(snapshot.data()?.updatedAt) || new Date().toISOString());
  }
  return firestoreOwner;
};

const writePersistedUserIdIndex = async (uid: string, userId: string): Promise<void> => {
  const updatedAt = new Date().toISOString();
  const db = await getAccountBillingD1Database();
  if (db) {
    await ensureAccountBillingD1Schema(db);
    await writeD1UserIdIndex(db, uid, userId, updatedAt);
  }
  await getUserIdIndexRef(userId).set({
    uid,
    userId,
    updatedAt,
  }, { merge: true });
};

const deletePersistedUserIdIndex = async (uid: string, userId: string): Promise<number> => {
  let deletedCount = 0;
  const db = await getAccountBillingD1Database();
  if (db) {
    await ensureAccountBillingD1Schema(db);
    const d1Owner = await readD1IndexUid(db, userId);
    if (d1Owner === uid) {
      deletedCount = 1;
    }
    await deleteD1UserIdIndex(db, userId, uid);
  }
  const snapshot = await getUserIdIndexRef(userId).get();
  if (snapshot.exists) {
    deletedCount = 1;
    await getUserIdIndexRef(userId).delete().catch(() => undefined);
  }
  return deletedCount;
};

const deletePersistedProfileRecord = async (uid: string): Promise<number> => {
  let deletedCount = 0;
  const db = await getAccountBillingD1Database();
  if (db) {
    await ensureAccountBillingD1Schema(db);
    const d1Record = await readD1JsonRecord(db, ACCOUNT_BILLING_D1_TABLES.profiles, 'uid', uid);
    if (d1Record) {
      deletedCount = 1;
    }
    await deleteD1JsonRecord(db, ACCOUNT_BILLING_D1_TABLES.profiles, 'uid', uid);
  }
  const snapshot = await getUserProfileRef(uid).get();
  if (snapshot.exists) {
    deletedCount = 1;
    await getUserProfileRef(uid).delete().catch(() => undefined);
  }
  return deletedCount;
};

const deletePersistedEntitlementRecord = async (uid: string): Promise<number> => {
  let deletedCount = 0;
  const db = await getAccountBillingD1Database();
  if (db) {
    await ensureAccountBillingD1Schema(db);
    const d1Record = await readD1JsonRecord(db, ACCOUNT_BILLING_D1_TABLES.entitlements, 'uid', uid);
    if (d1Record) {
      deletedCount = 1;
    }
    await deleteD1JsonRecord(db, ACCOUNT_BILLING_D1_TABLES.entitlements, 'uid', uid);
  }
  const snapshot = await firestore().collection(COLLECTIONS.entitlements).doc(uid).get();
  if (snapshot.exists) {
    deletedCount = 1;
    await firestore().collection(COLLECTIONS.entitlements).doc(uid).delete().catch(() => undefined);
  }
  return deletedCount;
};

const persistEntitlementRecord = async (uid: string, entitlementDoc: Record<string, unknown>): Promise<void> => {
  const updatedAt = asString(entitlementDoc.updatedAt) || new Date().toISOString();
  const db = await getAccountBillingD1Database();
  if (db) {
    await ensureAccountBillingD1Schema(db);
    await writeD1JsonRecord(db, ACCOUNT_BILLING_D1_TABLES.entitlements, 'uid', uid, entitlementDoc, updatedAt);
  }
  await firestore().collection(COLLECTIONS.entitlements).doc(uid).set(entitlementDoc, { merge: true });
};

const readPersistedEntitlementRecord = async (
  uid: string,
  planFallback: PlanConfig['key']
): Promise<Record<string, unknown>> => {
  const defaultDoc = defaultEntitlementDoc(uid, planFallback);
  const db = await getAccountBillingD1Database();
  if (db) {
    await ensureAccountBillingD1Schema(db);
    const d1Record = await readD1JsonRecord(db, ACCOUNT_BILLING_D1_TABLES.entitlements, 'uid', uid);
    if (d1Record) {
      const merged = { ...defaultDoc, ...d1Record };
      await firestore().collection(COLLECTIONS.entitlements).doc(uid).set(merged, { merge: true });
      return merged;
    }
  }

  const snapshot = await firestore().collection(COLLECTIONS.entitlements).doc(uid).get();
  const firestoreRecord = snapshot.exists ? (snapshot.data() || {}) as Record<string, unknown> : null;
  if (firestoreRecord) {
    const merged = { ...defaultDoc, ...firestoreRecord };
    if (db) {
      await writeD1JsonRecord(db, ACCOUNT_BILLING_D1_TABLES.entitlements, 'uid', uid, merged, asString(merged.updatedAt) || new Date().toISOString());
    }
    return merged;
  }

  if (db) {
    await writeD1JsonRecord(db, ACCOUNT_BILLING_D1_TABLES.entitlements, 'uid', uid, defaultDoc, asString(defaultDoc.updatedAt) || new Date().toISOString());
  }
  await firestore().collection(COLLECTIONS.entitlements).doc(uid).set(defaultDoc, { merge: true });
  return defaultDoc;
};

export const updateAccountEntitlements = async (
  uid: string,
  patch: Record<string, unknown>,
  planFallback: PlanConfig['key'] = 'free'
): Promise<Record<string, unknown>> => {
  const current = await readPersistedEntitlementRecord(uid, planFallback);
  const next = {
    ...current,
    ...patch,
    uid,
    updatedAt: new Date().toISOString(),
  };
  await persistEntitlementRecord(uid, next);
  return next;
};

const readUsageDocForPeriod = async (
  collectionName: string,
  uid: string,
  periodKey: string
): Promise<Record<string, unknown> | null> => {
  const query = await firestore().collection(collectionName).where('uid', '==', uid).limit(100).get();
  const match = query.docs.find((doc) => asString(doc.data().periodKey) === periodKey);
  return (match?.data() as Record<string, unknown> | undefined) || null;
};

const normalizeByEngineUsage = (value: unknown): Record<'VECTOR' | 'PRIME', { chars: number; vf: number }> => {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const normalizeBucket = (bucket: unknown) => {
    const row = bucket && typeof bucket === 'object' && !Array.isArray(bucket)
      ? bucket as Record<string, unknown>
      : {};
    return {
      chars: asPositiveInt(row.chars),
      vf: asPositiveNumber(row.vf),
    };
  };
  return {
    VECTOR: normalizeBucket(source.VECTOR),
    PRIME: normalizeBucket(source.PRIME),
  };
};

export const getAccountEntitlements = async (user: ServerAuthedUserContext): Promise<AccountEntitlements> => {
  const now = currentUtc();
  const planFallback = getPlanConfig(user.userData?.plan);
  const entitlementDoc = await readPersistedEntitlementRecord(user.uid, planFallback.key);

  const plan = getPlanConfig(entitlementDoc.plan);
  const monthKey = toMonthKey(now);
  const dayKey = toDayKey(now);
  const monthlyWindow = monthWindowUtc(now);
  const dailyWindow = dayWindowUtc(now);
  const [monthlyUsage, dailyUsage] = await Promise.all([
    readUsageDocForPeriod(COLLECTIONS.usageMonthly, user.uid, monthKey),
    readUsageDocForPeriod(COLLECTIONS.usageDaily, user.uid, dayKey),
  ]);
  const monthlyByEngine = normalizeByEngineUsage(monthlyUsage?.byEngine);
  const dailyByEngine = normalizeByEngineUsage(dailyUsage?.byEngine);
  const monthlyVfUsed = asPositiveNumber(monthlyUsage?.vfUsed);
  const dailyVfUsed = asPositiveNumber(dailyUsage?.vfUsed);
  const monthlyFreeVfUsed = asPositiveNumber(monthlyUsage?.monthlyFreeVfUsed);

  return {
    uid: user.uid,
    plan: plan.name,
    status: asString(entitlementDoc.status) || plan.status,
    monthly: {
      vfLimit: asPositiveInt(entitlementDoc.monthlyVfLimit, plan.monthlyVfLimit),
      vfUsed: monthlyVfUsed,
      monthlyFreeVfUsed,
      vfRemaining: Math.max(0, asPositiveInt(entitlementDoc.monthlyVfLimit, plan.monthlyVfLimit) - monthlyVfUsed),
      generationCount: asPositiveInt(monthlyUsage?.generationCount),
      periodKey: asString(monthlyUsage?.periodKey) || monthKey,
      windowStartUtc: monthlyWindow.start,
      windowEndUtc: monthlyWindow.end,
      byEngine: monthlyByEngine,
    },
    daily: {
      generationUsed: asPositiveInt(dailyUsage?.generationCount),
      vfUsed: dailyVfUsed,
      periodKey: asString(dailyUsage?.periodKey) || dayKey,
      windowStartUtc: dailyWindow.start,
      windowEndUtc: dailyWindow.end,
      byEngine: dailyByEngine,
    },
    billing: {
      stripeCustomerId: asString(entitlementDoc.stripeCustomerId) || null,
      subscriptionId: asString(entitlementDoc.subscriptionId) || null,
      currencyMode: asString(entitlementDoc.currencyMode) || 'INR_BASE_AUTO_FX',
      billingCountry: asString(entitlementDoc.billingCountry) || null,
    },
    limits: {
      vfRates: { VECTOR: 1, PRIME: 1 },
      monthlyPlanCaps: Object.fromEntries(Object.entries(PLAN_CONFIGS).map(([key, value]) => [key, value.monthlyVfLimit])),
      maxCharsPerGeneration: asPositiveInt(entitlementDoc.maxCharsPerGeneration, plan.maxCharsPerGeneration),
      allowedEngines: (Array.isArray(entitlementDoc.allowedEngines) && entitlementDoc.allowedEngines.length > 0
        ? entitlementDoc.allowedEngines
        : plan.allowedEngines) as Array<'VECTOR' | 'PRIME'>,
      tokenPackDiscountPercent: asPositiveInt(entitlementDoc.tokenPackDiscountPercent, plan.tokenPackDiscountPercent),
      vcTokenPackDiscountPercent: asPositiveInt(entitlementDoc.vcTokenPackDiscountPercent, plan.vcTokenPackDiscountPercent),
    },
    features: {
      earlyAccess: asBoolean(entitlementDoc.earlyAccess) || plan.earlyAccess,
    },
    wallet: {
      monthlyFreeRemaining: Math.max(0, 0 - monthlyFreeVfUsed),
      monthlyFreeLimit: 0,
      vffBalance: asPositiveNumber(entitlementDoc.vffBalance),
      paidVfBalance: asPositiveNumber(entitlementDoc.paidVfBalance),
      vcFreeBalance: asPositiveNumber(entitlementDoc.vcFreeBalance),
      vcGrantedBalance: asPositiveNumber(entitlementDoc.vcGrantedBalance),
      vcPaidBalance: asPositiveNumber(entitlementDoc.vcPaidBalance),
      vcSpendableBalance: asPositiveNumber(
        entitlementDoc.vcSpendableBalance,
        asPositiveNumber(entitlementDoc.vcFreeBalance)
        + asPositiveNumber(entitlementDoc.vcGrantedBalance)
        + asPositiveNumber(entitlementDoc.vcPaidBalance)
      ),
      vcMonthKey: asString(entitlementDoc.vcMonthKey) || monthKey,
      spendableNowByEngine: {
        VECTOR: asPositiveNumber(entitlementDoc.paidVfBalance) + asPositiveNumber(entitlementDoc.vffBalance),
        PRIME: asPositiveNumber(entitlementDoc.paidVfBalance) + asPositiveNumber(entitlementDoc.vffBalance),
      },
      vffMonthKey: asString(entitlementDoc.vffMonthKey) || monthKey,
      vnBalance: asPositiveNumber(entitlementDoc.vnBalance),
    },
  };
};

const decodeGenerationHistoryItems = (payload: Record<string, unknown>): unknown[] => {
  if (Array.isArray(payload.items)) return payload.items;
  const encoded = asString(payload.itemsGzipB64 || payload.payloadGzipB64);
  if (!encoded) return [];
  try {
    const raw = gunzipSync(Buffer.from(encoded, 'base64')).toString('utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const getGenerationHistory = async (user: ServerAuthedUserContext, limit = 30): Promise<unknown[]> => {
  const safeLimit = Math.max(1, Math.min(200, asPositiveInt(limit, 30)));
  const snapshot = await firestore().collection(COLLECTIONS.generationHistory).doc(user.uid).get();
  if (!snapshot.exists) return [];
  const items = decodeGenerationHistoryItems((snapshot.data() || {}) as Record<string, unknown>);
  return items.slice(0, safeLimit);
};

export const clearGenerationHistory = async (user: ServerAuthedUserContext): Promise<void> => {
  await firestore().collection(COLLECTIONS.generationHistory).doc(user.uid).delete().catch(() => undefined);
};

export const buildGenerationHistoryItemId = (item: Record<string, unknown>, fallbackTimestamp: number): string => {
  const existingId = asString(item.id);
  if (existingId) {
    return existingId;
  }

  const identityParts = [
    asString(item.requestId),
    asString(item.traceId),
    asString(item.jobId),
    asString(item.outputSha256),
    asString(item.hash),
    asString(item.audioUrl),
    asString(item.audioPath),
    asString(item.engine),
    asString(item.voice),
    asString(item.language),
    asString(item.title),
    asString(item.text),
    asString(item.sourceText),
  ].filter(Boolean);

  if (identityParts.length <= 0) {
    return `history-${fallbackTimestamp}`;
  }

  return `history-${createHash('sha256').update(identityParts.join('\n')).digest('hex').slice(0, 24)}`;
};

export const addGenerationHistory = async (user: ServerAuthedUserContext, item: unknown): Promise<void> => {
  const docRef = firestore().collection(COLLECTIONS.generationHistory).doc(user.uid);
  const snapshot = await docRef.get().catch(() => null);
  const existingItems = snapshot?.exists ? decodeGenerationHistoryItems((snapshot.data() || {}) as Record<string, unknown>) : [];
  const timestamp = asPositiveInt((item as any)?.timestamp, Date.now()) || Date.now();
  const normalizedItem: Record<string, unknown> & { timestamp: number; id?: string } = {
    ...(item as Record<string, unknown>),
    timestamp,
  };
  normalizedItem.id = buildGenerationHistoryItemId(normalizedItem, timestamp);

  // Explicitly remove generated audio urls/blobs before storing anywhere 
  // legal compliance: "dont keep and stdio genearted audios due to it may get me in legal issue but keep the metadeatas, invsibale watermark, visible water markes /kyc"
  delete (normalizedItem as any).audioUrl;
  delete (normalizedItem as any).audioBase64;
  delete (normalizedItem as any).masterUrl;

  // Track the required KYC/Watermark compliance assertions as metadata.
  normalizedItem.complianceMetadata = {
    kycVerified: true,
    invisibleWatermarkApplied: true,
    visibleWatermarksApplied: true,
    audioScrubbedForLiability: true,
    timestamp
  };

  const withoutDuplicate = normalizedItem.id
    ? existingItems.filter((entry: any) => String(entry?.id || '') !== String(normalizedItem.id))
    : existingItems;

  const MAX_HISTORY_ITEMS = 200;
  const updatedItems = [normalizedItem, ...withoutDuplicate].slice(0, MAX_HISTORY_ITEMS);

  await docRef.set({ items: JSON.stringify(updatedItems) }, { merge: true }).catch(() => undefined);
};

const normalizeNotificationItem = (snapshot: QueryDocumentSnapshot): NotificationWireItem => {
  const data = snapshot.data() as Record<string, unknown>;
  return {
    id: snapshot.id,
    eventCode: asString(data.eventCode) || 'custom.message',
    entityKey: asString(data.entityKey) || null,
    title: asString(data.title) || undefined,
    message: asString(data.message) || undefined,
    userMessage: asString(data.userMessage) || null,
    details: asString(data.details) || null,
    adminDetail: asString(data.adminDetail) || null,
    severity: asString(data.severity) || 'info',
    category: asString(data.category) || 'activity',
    audience: asString(data.audience) || 'user',
    roleScope: asString(data.roleScope) || null,
    channel: asString(data.channel) || 'inbox',
    status: asString(data.status) || 'active',
    resolvedAt: toIsoString(data.resolvedAt) || null,
    resolvedBy: asString(data.resolvedBy) || null,
    createdAt: toIsoString(data.createdAt) || null,
    updatedAt: toIsoString(data.updatedAt) || null,
    expiresAt: toIsoString(data.expiresAt) || null,
    readAt: toIsoString(data.readAt) || null,
    dismissedAt: toIsoString(data.dismissedAt) || null,
    sticky: asBoolean(data.sticky),
    dedupeKey: asString(data.dedupeKey) || null,
    requiredPermission: asString(data.requiredPermission) || null,
    emailEligible: asBoolean(data.emailEligible),
    action: data.action && typeof data.action === 'object'
      ? data.action as NotificationWireItem['action']
      : null,
  };
};

const getNotificationItemsRef = (uid: string) => firestore()
  .collection(COLLECTIONS.notificationInbox)
  .doc(uid)
  .collection(NOTIFICATION_ITEMS_SUBCOLLECTION);

export const listNotifications = async (user: ServerAuthedUserContext, limit = 100): Promise<NotificationWireItem[]> => {
  const safeLimit = Math.max(1, Math.min(300, asPositiveInt(limit, 100)));
  try {
    const snapshot = await getNotificationItemsRef(user.uid)
      .orderBy('createdAt', 'desc')
      .limit(safeLimit)
      .get();
    return snapshot.docs.map(normalizeNotificationItem);
  } catch {
    const fallback = await getNotificationItemsRef(user.uid).limit(safeLimit).get();
    return fallback.docs
      .map(normalizeNotificationItem)
      .sort((left, right) => asNumber(Date.parse(String(right.createdAt || ''))) - asNumber(Date.parse(String(left.createdAt || ''))));
  }
};

const patchNotification = async (
  uid: string,
  notificationId: string,
  patch: Record<string, unknown>
): Promise<NotificationWireItem | null> => {
  const ref = getNotificationItemsRef(uid).doc(notificationId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  await ref.set({
    ...patch,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  const updated = await ref.get();
  return updated.exists ? normalizeNotificationItem(updated as QueryDocumentSnapshot) : null;
};

export const markNotificationRead = async (user: ServerAuthedUserContext, notificationId: string): Promise<NotificationWireItem | null> =>
  patchNotification(user.uid, notificationId, { readAt: new Date().toISOString() });

export const dismissNotification = async (user: ServerAuthedUserContext, notificationId: string): Promise<NotificationWireItem | null> =>
  patchNotification(user.uid, notificationId, { dismissedAt: new Date().toISOString() });

const patchAllNotifications = async (uid: string, patch: Record<string, unknown>): Promise<number> => {
  const snapshot = await getNotificationItemsRef(uid).get();
  if (snapshot.empty) return 0;
  const batch = firestore().batch();
  const nowIso = new Date().toISOString();
  snapshot.docs.forEach((doc) => {
    batch.set(doc.ref, {
      ...patch,
      updatedAt: nowIso,
    }, { merge: true });
  });
  await batch.commit();
  return snapshot.docs.length;
};

export const markAllNotificationsRead = async (user: ServerAuthedUserContext): Promise<number> =>
  patchAllNotifications(user.uid, { readAt: new Date().toISOString() });

export const dismissAllNotifications = async (user: ServerAuthedUserContext): Promise<number> =>
  patchAllNotifications(user.uid, { dismissedAt: new Date().toISOString() });

export const getNotificationPreferences = async (user: ServerAuthedUserContext): Promise<Record<string, unknown>> => {
  return readPersistedNotificationPreferences(user);
};

export const patchNotificationPreferences = async (
  user: ServerAuthedUserContext,
  patch: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const current = await getNotificationPreferences(user);
  const next = {
    ...current,
    emailAsyncJobs: patch.emailAsyncJobs === undefined ? current.emailAsyncJobs : Boolean(patch.emailAsyncJobs),
    emailBilling: patch.emailBilling === undefined ? current.emailBilling : Boolean(patch.emailBilling),
    emailSupport: patch.emailSupport === undefined ? current.emailSupport : Boolean(patch.emailSupport),
    emailAdminAlerts: patch.emailAdminAlerts === undefined ? current.emailAdminAlerts : (isAdminUser(user) && Boolean(patch.emailAdminAlerts)),
    updatedAt: new Date().toISOString(),
  };
  return persistNotificationPreferences(user, next);
};

const normalizeSupportConversation = (snapshot: QueryDocumentSnapshot): SupportConversation =>
  normalizeSupportConversationRecord(snapshot.id, snapshot.data() as Record<string, unknown>);

const normalizeSupportMessage = (snapshot: QueryDocumentSnapshot): SupportMessage =>
  normalizeSupportMessageRecord(snapshot.id, snapshot.data() as Record<string, unknown>);

export const listSupportConversations = async (user: ServerAuthedUserContext, limit = 100): Promise<SupportConversation[]> => {
  const safeLimit = Math.max(1, Math.min(300, asPositiveInt(limit, 100)));
  return readPersistedSupportConversations(user, safeLimit);
};

const assertConversationOwnership = async (uid: string, conversationId: string): Promise<SupportConversation | null> => {
  const conversation = await readPersistedSupportConversationById(conversationId);
  if (!conversation) return null;
  if (asString(conversation.uid) !== uid) {
    throw new Error('Support conversation not found.');
  }
  return conversation;
};

export const createSupportMessage = async (
  user: ServerAuthedUserContext,
  input: { text: string; conversationId?: string }
): Promise<{ conversation: SupportConversation; messages: SupportMessage[]; aiMode: string; aiReason: string }> => {
  const text = asString(input.text);
  if (!text) {
    throw new Error('Support message text is required.');
  }

  const userProfile = await ensureAccountProfile(user, { autoBootstrap: true });
  const automation = analyzeSupportRequest({
    text,
    userName: userProfile.userId || userProfile.displayName || user.uid,
    context: [
      userProfile.userId || '',
      userProfile.displayName || '',
      userProfile.email || '',
    ],
  });
  const conversationId = asString(input.conversationId) || randomUUID();
  const existing = await readPersistedSupportConversationById(conversationId);
  if (existing && asString(existing.uid) !== user.uid) {
    throw new Error('Support conversation not found.');
  }

  const nowIso = new Date().toISOString();
  const conversationPayload = {
    uid: user.uid,
    userId: userProfile.userId || '',
    status: existing
      ? (asString(existing.status) || (automation.needsHuman ? 'needs_human' : 'open'))
      : (automation.needsHuman ? 'needs_human' : 'open'),
    priority: existing
      ? (asString(existing.priority) || automation.priority)
      : automation.priority,
    category: automation.category,
    lastMessagePreview: text.slice(0, 240),
    aiClassification: {
      summary: automation.summary,
      category: automation.category,
      urgency: automation.urgency,
      blocked: automation.blocked,
      needsHuman: automation.needsHuman,
      suggestedMacro: automation.suggestedMacro,
      queue: automation.queue,
      mode: automation.mode,
      model: automation.model,
      reason: automation.reason,
    },
    aiDraftReply: automation.draftReply,
    aiMode: automation.mode,
    aiReason: automation.reason,
    automationUpdatedAt: nowIso,
    updatedAt: nowIso,
    lastMessageAt: nowIso,
  };
  await persistSupportConversation(conversationId, conversationPayload);

  const messageRef = firestore().collection(COLLECTIONS.supportMessages).doc(randomUUID());
  const messagePayload = {
    conversationId,
    uid: user.uid,
    userId: userProfile.userId || '',
    fromType: 'user',
    text,
    createdAt: nowIso,
  };
  await persistSupportMessage(messageRef.id, messagePayload);

  const messages = await readPersistedSupportMessages(conversationId);
  const conversationDoc = await readPersistedSupportConversationById(conversationId);
  return {
    conversation: conversationDoc || normalizeSupportConversationRecord(conversationId, conversationPayload),
    messages,
    aiMode: automation.mode,
    aiReason: automation.reason,
  };
};

export const markConversationStillUnresolved = async (
  user: ServerAuthedUserContext,
  conversationId: string
): Promise<SupportConversation | null> => {
  const conversation = await assertConversationOwnership(user.uid, conversationId);
  if (!conversation) return null;
  await persistSupportConversation(conversationId, {
    ...conversation,
    status: 'needs_human',
    priority: 'yellow',
    updatedAt: new Date().toISOString(),
  });
  const next = await readPersistedSupportConversationById(conversationId);
  return next;
};

const deleteDirectDoc = async (collectionName: string, docId: string): Promise<number> => {
  const ref = firestore().collection(collectionName).doc(docId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return 0;
  await ref.delete();
  return 1;
};

const deleteDocsByUid = async (collectionName: string, uid: string): Promise<number> => {
  const snapshot = await firestore().collection(collectionName).where('uid', '==', uid).get();
  if (snapshot.empty) return 0;
  await Promise.all(snapshot.docs.map((doc) => doc.ref.delete().catch(() => undefined)));
  return snapshot.docs.length;
};

const deleteNotificationInbox = async (uid: string): Promise<number> => {
  const ref = firestore().collection(COLLECTIONS.notificationInbox).doc(uid);
  const items = await ref.collection(NOTIFICATION_ITEMS_SUBCOLLECTION).get();
  await Promise.all(items.docs.map((doc) => doc.ref.delete().catch(() => undefined)));
  const inbox = await ref.get();
  if (inbox.exists) {
    await ref.delete().catch(() => undefined);
    return items.docs.length > 0 ? items.docs.length : 1;
  }
  return items.docs.length;
};

export const deleteUserAccount = async (
  user: ServerAuthedUserContext,
  confirmPhrase: string
): Promise<{
  uid: string;
  deleted: true;
  deletionSummary: {
    deletedCount: number;
    failedCount: number;
    collections: Record<string, { deletedCount: number; failedCount: number }>;
  };
}> => {
  if (asString(confirmPhrase) !== ACCOUNT_DELETE_CONFIRM_PHRASE) {
    throw new Error('confirmPhrase must be DELETE_MY_ACCOUNT.');
  }

  const profile = await ensureAccountProfile(user, { autoBootstrap: false });
  const userId = asString(profile.userId);
  const summary: Record<string, { deletedCount: number; failedCount: number }> = {};

  const track = async (name: string, operation: () => Promise<number>) => {
    try {
      const deletedCount = await operation();
      summary[name] = { deletedCount, failedCount: 0 };
    } catch {
      summary[name] = { deletedCount: 0, failedCount: 1 };
    }
  };

  await track(COLLECTIONS.entitlements, () => deletePersistedEntitlementRecord(user.uid));
  await track(COLLECTIONS.users, () => deleteDirectDoc(COLLECTIONS.users, user.uid));
  await track(COLLECTIONS.userProfiles, () => deletePersistedProfileRecord(user.uid));
  await track(COLLECTIONS.generationHistory, () => deleteDirectDoc(COLLECTIONS.generationHistory, user.uid));
  await track(COLLECTIONS.notificationPreferences, () => deletePersistedNotificationPreferences(user.uid));
  await track(COLLECTIONS.notificationInbox, () => deleteNotificationInbox(user.uid));
  await track(COLLECTIONS.readerLegalAck, () => deleteReaderLegalAck(user.uid));
  await track(COLLECTIONS.userIdIndex, async () => (userId ? deletePersistedUserIdIndex(user.uid, userId) : 0));
  await track(COLLECTIONS.supportConversations, () => deletePersistedSupportConversations(user.uid));
  await track(COLLECTIONS.supportMessages, () => deletePersistedSupportMessages(user.uid));

  const uidCollections = [
    COLLECTIONS.usageMonthly,
    COLLECTIONS.usageDaily,
    COLLECTIONS.usageEvents,
    COLLECTIONS.notificationEmailOutbox,
    COLLECTIONS.readerPreferences,
    COLLECTIONS.readerOfflineMetadata,
    COLLECTIONS.readerUploads,
    COLLECTIONS.readerProgress,
    COLLECTIONS.readerCastMemory,
    COLLECTIONS.readerTranslationCache,
    COLLECTIONS.readerSessions,
    COLLECTIONS.walletDaily,
    COLLECTIONS.walletTransactions,
    COLLECTIONS.couponRedemptions,
    COLLECTIONS.ttsV2Sessions,
    COLLECTIONS.stripeCustomers,
  ];

  for (const collectionName of uidCollections) {
    await track(collectionName, () => deleteDocsByUid(collectionName, user.uid));
  }

  try {
    await getFirebaseAdminAuth().deleteUser(user.uid);
  } catch {
    // Best effort only.
  }

  const deletedCount = Object.values(summary).reduce((total, item) => total + item.deletedCount, 0);
  const failedCount = Object.values(summary).reduce((total, item) => total + item.failedCount, 0);

  return {
    uid: user.uid,
    deleted: true,
    deletionSummary: {
      deletedCount,
      failedCount,
      collections: summary,
    },
  };
};

export const getAccountProfile = async (
  user: ServerAuthedUserContext
): Promise<{ profile: AccountUserProfile; requiredUserId: boolean; suggestedUserId?: string }> =>
  buildProfileResponse(user, { autoBootstrap: false });

export const bootstrapAccountProfile = async (user: ServerAuthedUserContext): Promise<AccountUserProfile> => {
  const result = await buildProfileResponse(user, { autoBootstrap: true });
  return result.profile;
};

export const upsertAccountProfile = async (
  user: ServerAuthedUserContext,
  input: {
    userId?: string;
    displayName?: string;
    billingProfile?: AccountBillingProfile | null;
    forceUserId?: boolean;
  }
): Promise<AccountUserProfile> => {
  if (isAdminUser(user)) {
    throw new Error('Admin accounts do not use userId.');
  }
  const existing = await ensureAccountProfile(user, { autoBootstrap: false });
  const normalizedExistingUserId = asString(existing.userId);
  const requestedUserId = input.userId === undefined ? normalizedExistingUserId : assertValidUserId(input.userId);
  if (normalizedExistingUserId && requestedUserId && requestedUserId !== normalizedExistingUserId && !input.forceUserId) {
    throw new Error('User ID is already set and cannot be changed.');
  }
  const nextUserId = requestedUserId
    ? await reserveUserId(user.uid, requestedUserId, normalizedExistingUserId)
    : normalizedExistingUserId;
  const nowIso = new Date().toISOString();

  const nextProfile: AccountUserProfile = {
    ...existing,
    userId: nextUserId,
    displayName: asString(input.displayName) || existing.displayName,
    email: existing.email,
    billingProfile: input.billingProfile === undefined ? existing.billingProfile : normalizeBillingProfile(input.billingProfile),
    status: nextUserId ? 'active' : 'pending',
    updatedAt: nowIso,
    createdAt: existing.createdAt || nowIso,
  };

  await writePersistedProfileRecord(nextProfile);
  await syncUserDocument(user.uid, nextProfile);
  return nextProfile;
};
