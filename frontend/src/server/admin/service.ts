// @ts-nocheck
import { createHash, randomUUID } from 'node:crypto';

import type { NextRequest } from 'next/server';

import { proxyBackendRequest } from '../../../app/api/backend/proxy';
import { ACCOUNT_DELETE_CONFIRM_PHRASE } from '../../../services/accountService';
import { handleVoiceCloneRoute } from '../voiceClone/service';
import {
  deleteUserAccount,
  getAccountEntitlements,
  getAccountProfile,
  updateAccountEntitlements,
  upsertAccountProfile,
  readCouponD1Record,
  writeCouponD1Record,
  listCouponD1Records,
} from '../account/service';
import { verifyFirebaseRequest } from '../auth/requestAuth.ts';
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '../firebaseAdmin';
import { getReplatformRuntimeSummary } from '../replatform/runtime';
import { readEnvBoolean, readEnvValue } from '../../shared/runtime/env';
import { isAdminOpsProxyMode } from './mode';
import { getCloudflareContext } from '@opennextjs/cloudflare';

type AnyRecord = Record<string, unknown>;

type AdminPermission =
  | 'users.read' | 'users.write'
  | 'coupons.read' | 'coupons.write'
  | 'billing.read' | 'billing.write'
  | 'ops.read' | 'ops.mutate'
  | 'guardian.read' | 'guardian.mutate'
  | 'analytics.read' | 'audit.read'
  | 'alerts.read' | 'alerts.write'
  | 'scheduler.read' | 'scheduler.write'
  | 'rbac.read' | 'rbac.write'
  | 'teams.read' | 'teams.write'
  | 'support.read' | 'support.reply' | 'support.ai.review' | 'support.ai.config';

type AdminContext = {
  uid: string;
  userData: AnyRecord | null;
  actor: AnyRecord;
};

const ALL_PERMISSIONS: AdminPermission[] = [
  'users.read', 'users.write',
  'coupons.read', 'coupons.write',
  'billing.read', 'billing.write',
  'ops.read', 'ops.mutate',
  'guardian.read', 'guardian.mutate',
  'analytics.read', 'audit.read',
  'alerts.read', 'alerts.write',
  'scheduler.read', 'scheduler.write',
  'rbac.read', 'rbac.write',
  'teams.read', 'teams.write',
  'support.read', 'support.reply', 'support.ai.review', 'support.ai.config',
];

const ROLE_MATRIX: Record<string, AdminPermission[]> = {
  super_admin: [...ALL_PERMISSIONS],
  ops_admin: ['ops.read', 'ops.mutate', 'guardian.read', 'guardian.mutate', 'alerts.read', 'alerts.write', 'scheduler.read', 'scheduler.write', 'audit.read', 'analytics.read'],
  billing_admin: ['users.read', 'users.write', 'billing.read', 'billing.write', 'coupons.read', 'coupons.write', 'analytics.read', 'audit.read'],
  support_admin: ['support.read', 'support.reply', 'support.ai.review', 'support.ai.config', 'audit.read'],
  auditor: ['audit.read', 'analytics.read', 'users.read', 'coupons.read', 'billing.read', 'alerts.read', 'scheduler.read', 'teams.read', 'support.read'],
  viewer: ['users.read', 'coupons.read', 'billing.read', 'alerts.read', 'scheduler.read', 'teams.read', 'support.read', 'analytics.read', 'audit.read', 'ops.read', 'guardian.read'],
};

const COLLECTIONS = Object.freeze({
  users: 'users',
  userProfiles: 'user_profiles',
  userIdIndex: 'user_id_index',
  entitlements: 'entitlements',
  usageDaily: 'usage_daily',
  walletTransactions: 'wallet_transactions',
  couponRedemptions: 'coupon_redemptions',
  coupons: 'coupons',
  adminSessionUnlock: 'admin_session_unlock',
  adminRbacAssignments: 'admin_rbac_assignments',
  adminAuditEvents: 'admin_audit_events',
  adminUsageResetState: 'admin_usage_reset_state',
  adminVcGrantRecords: 'admin_vc_grant_records',
  adminAlertPolicies: 'admin_alert_policies',
  adminAlertDestinations: 'admin_alert_destinations',
  adminAlertEvents: 'admin_alert_events',
  adminSchedulerTasks: 'admin_scheduler_tasks',
  adminSchedulerRuns: 'admin_scheduler_runs',
  adminAccountingRecords: 'admin_accounting_records',
  adminAccountingMonitorRuns: 'admin_accounting_monitor_runs',
  adminTeams: 'admin_teams',
  adminTeamMembers: 'admin_team_members',
  supportConversations: 'support_conversations',
  supportMessages: 'support_messages',
  adminSupportAiPolicy: 'admin_support_ai_policy',
  adminNotices: 'admin_notices',
  audioMetadataRecords: 'audio_metadata_records',
  opsGuardianApprovals: 'ops_guardian_approvals',
  opsGuardianActions: 'ops_guardian_actions',
  adminGeminiSlots: 'admin_gemini_slots',
  adminIncidents: 'admin_incidents',
  adminFeatureFlags: 'admin_feature_flags',
  adminAutomationRuns: 'admin_automation_runs',
  moderationReports: 'moderation_reports',
  withdrawals: 'withdrawals',
  adminFinanceCashAccounts: 'admin_finance_cash_accounts',
  adminFinanceBudgets: 'admin_finance_budgets',
  adminFinanceProviderSnapshots: 'admin_finance_provider_snapshots',
  adminFinanceProviderSyncRuns: 'admin_finance_provider_sync_runs',
  adminFinanceAdjustments: 'admin_finance_adjustments',
});

const ADMIN_D1_TABLES = Object.freeze({
  auditEvents: 'admin_audit_events',
  rbacAssignments: 'admin_rbac_assignments',
  config: 'admin_config',
} as const);

const ADMIN_D1_SCHEMA = `
CREATE TABLE IF NOT EXISTS admin_audit_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  ts TEXT NOT NULL,
  actor_uid TEXT,
  action TEXT,
  resource_type TEXT,
  subject_uid TEXT
);
CREATE INDEX IF NOT EXISTS admin_audit_events_ts_idx ON admin_audit_events (ts DESC);
CREATE INDEX IF NOT EXISTS admin_audit_events_actor_uid_idx ON admin_audit_events (actor_uid);
CREATE INDEX IF NOT EXISTS admin_audit_events_action_idx ON admin_audit_events (action);
CREATE INDEX IF NOT EXISTS admin_audit_events_subject_uid_idx ON admin_audit_events (subject_uid);
CREATE INDEX IF NOT EXISTS admin_audit_events_sequence_idx ON admin_audit_events (sequence DESC);
CREATE TABLE IF NOT EXISTS admin_rbac_assignments (
  uid TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_config (
  config_key TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

type AdminD1Statement = {
  bind: (...values: unknown[]) => AdminD1Statement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
};

type AdminD1Database = {
  prepare: (sql: string) => AdminD1Statement;
  exec: (sql: string) => Promise<unknown>;
};

let adminD1DatabasePromise: Promise<AdminD1Database | null> | null = null;
let adminD1SchemaPromise: Promise<void> | null = null;

const parseAdminPersistedJsonRecord = (value: string | null | undefined): Record<string, unknown> | null => {
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

const getAdminD1Database = async (): Promise<AdminD1Database | null> => {
  if (!adminD1DatabasePromise) {
    adminD1DatabasePromise = (async () => {
      try {
        const { env } = await getCloudflareContext({ async: true });
        const db = (env as { DB?: AdminD1Database }).DB;
        return db && typeof db.prepare === 'function' ? db : null;
      } catch {
        return null;
      }
    })();
  }
  return adminD1DatabasePromise;
};

const ensureAdminD1Schema = async (db: AdminD1Database): Promise<void> => {
  if (!adminD1SchemaPromise) {
    adminD1SchemaPromise = db.exec(ADMIN_D1_SCHEMA).then(() => undefined).catch((error: unknown) => {
      adminD1SchemaPromise = null;
      throw error;
    });
  }
  await adminD1SchemaPromise;
};

const readAdminD1Record = async (
  db: AdminD1Database,
  table: string,
  keyColumn: string,
  keyValue: string
): Promise<Record<string, unknown> | null> => {
  const row = await db.prepare(`SELECT payload_json FROM ${table} WHERE ${keyColumn} = ? LIMIT 1`)
    .bind(keyValue)
    .first<{ payload_json?: string }>();
  return parseAdminPersistedJsonRecord(row?.payload_json || null);
};

const readAdminD1Rows = async (
  db: AdminD1Database,
  sql: string,
  ...values: unknown[]
): Promise<Record<string, unknown>[]> => {
  const response = await db.prepare(sql).bind(...values).all<Record<string, unknown>>();
  return Array.isArray(response?.results) ? response.results : [];
};

const writeAdminD1Record = async (
  db: AdminD1Database,
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

const deleteAdminD1Record = async (
  db: AdminD1Database,
  table: string,
  keyColumn: string,
  keyValue: string
): Promise<void> => {
  await db.prepare(`DELETE FROM ${table} WHERE ${keyColumn} = ?`)
    .bind(keyValue)
    .run();
};

const writeAdminD1AuditEvent = async (
  db: AdminD1Database,
  payload: Record<string, unknown>,
): Promise<void> => {
  const eventId = asString(payload.eventId) || randomUUID();
  const sequence = asPositiveInt(payload.sequence, 0);
  const ts = asString(payload.ts) || nowIso();
  await db.prepare(`
    INSERT INTO ${ADMIN_D1_TABLES.auditEvents} (event_id, payload_json, sequence, ts, actor_uid, action, resource_type, subject_uid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      sequence = excluded.sequence,
      ts = excluded.ts,
      actor_uid = excluded.actor_uid,
      action = excluded.action,
      resource_type = excluded.resource_type,
      subject_uid = excluded.subject_uid
  `)
    .bind(
      eventId,
      JSON.stringify(payload),
      sequence,
      ts,
      asString(payload.actorUid) || null,
      asString(payload.action) || null,
      asString(payload.resourceType) || null,
      asString(payload.subjectUid) || null,
    )
    .run();
};

const DEFAULT_ADMIN_AUTOMATION_MODEL = 'gemini-2.5-flash-lite';

const DEFAULT_FEATURE_FLAGS = Object.freeze([
  {
    key: 'publishing_enabled',
    enabled: true,
    scope: 'publishing',
    description: 'Controls book publishing and chapter-audio mutations.',
  },
  {
    key: 'tts_soft_shedding',
    enabled: false,
    scope: 'runtime',
    description: 'Degrades noncritical TTS paths when runtime pressure is high.',
  },
  {
    key: 'voice_clone_enabled',
    enabled: true,
    scope: 'voice_clone',
    description: 'Controls user-facing voice-clone submission surfaces.',
  },
  {
    key: 'maintenance_mode',
    enabled: false,
    scope: 'global',
    description: 'Turns on the operator-managed maintenance experience.',
  },
  {
    key: 'signup_enabled',
    enabled: true,
    scope: 'account',
    description: 'Controls new-account onboarding and signup entry points.',
  },
]);

const DEFAULT_FINANCE_CASH_ACCOUNTS = Object.freeze([
  {
    accountId: 'bank_main',
    name: 'Bank Cash',
    type: 'bank',
    balanceInr: 0,
    editable: true,
    source: 'manual',
  },
  {
    accountId: 'stripe_available',
    name: 'Stripe Available',
    type: 'stripe_available',
    balanceInr: 0,
    editable: true,
    source: 'manual',
  },
  {
    accountId: 'stripe_pending',
    name: 'Stripe Pending',
    type: 'stripe_pending',
    balanceInr: 0,
    editable: true,
    source: 'manual',
  },
  {
    accountId: 'wallet_liability',
    name: 'Wallet Liability',
    type: 'wallet_liability',
    balanceInr: 0,
    editable: true,
    source: 'manual',
  },
  {
    accountId: 'fixed_monthly_burn',
    name: 'Fixed Monthly Burn',
    type: 'fixed_burn',
    balanceInr: 0,
    editable: true,
    source: 'manual',
  },
]);

const PLAN_META = {
  Free: { plan: 'Free', monthlyVfLimit: 10_000, maxCharsPerGeneration: 8_000, earlyAccess: false, status: 'free_active' },
  Launcher: { plan: 'Launcher', monthlyVfLimit: 25_000, maxCharsPerGeneration: 9_000, earlyAccess: false, status: 'active' },
  Starter: { plan: 'Starter', monthlyVfLimit: 75_000, maxCharsPerGeneration: 10_000, earlyAccess: false, status: 'active' },
  Creator: { plan: 'Creator', monthlyVfLimit: 150_000, maxCharsPerGeneration: 10_000, earlyAccess: false, status: 'active' },
  Pro: { plan: 'Pro', monthlyVfLimit: 500_000, maxCharsPerGeneration: 10_000, earlyAccess: false, status: 'active' },
  Scale: { plan: 'Scale', monthlyVfLimit: 2_000_000, maxCharsPerGeneration: 15_000, earlyAccess: true, status: 'active' },
} as const;

const DEFAULT_UNLOCK_KEY_TTL_MS = 10 * 60_000;
const DEFAULT_UNLOCK_TOKEN_TTL_MS = 30 * 60_000;
const DEFAULT_UNLOCK_LOCK_MS = 5 * 60_000;
const DEFAULT_UNLOCK_MAX_ATTEMPTS = 5;
const memoryDb = new Map<string, Map<string, AnyRecord>>();

const asString = (value: unknown): string => String(value ?? '').trim();
const asLower = (value: unknown): string => asString(value).toLowerCase();
const asUpper = (value: unknown): string => asString(value).toUpperCase();
const asNumber = (value: unknown, fallback = 0): number => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};
const asPositiveNumber = (value: unknown, fallback = 0): number => Math.max(0, asNumber(value, fallback));
const asPositiveInt = (value: unknown, fallback = 0): number => Math.max(0, Math.floor(asNumber(value, fallback)));
const asBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  const token = asLower(value);
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
};
const nowIso = (): string => new Date().toISOString();
const nowMs = (): number => Date.now();
const cloneRecord = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;
const parseJsonRecord = (value: unknown): AnyRecord | null => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as AnyRecord : null;
  } catch {
    return null;
  }
};

type FinanceProvidersModule = typeof import('./financeProviders');
let financeProvidersModulePromise: Promise<FinanceProvidersModule> | null = null;

const loadFinanceProvidersModule = async (): Promise<FinanceProvidersModule> => {
  if (!financeProvidersModulePromise) {
    financeProvidersModulePromise = import('./financeProviders');
  }
  return financeProvidersModulePromise;
};

const json = (payload: unknown, status = 200, headers?: HeadersInit): Response => (
  Response.json(payload, {
    status,
    headers: {
      'x-vf-admin-ops-mode': isAdminOpsProxyMode() ? 'proxy' : 'native',
      ...(headers || {}),
    },
  })
);

const text = (payload: string, status = 200, contentType = 'text/plain; charset=utf-8', headers?: HeadersInit): Response => (
  new Response(payload, {
    status,
    headers: {
      'content-type': contentType,
      'x-vf-admin-ops-mode': isAdminOpsProxyMode() ? 'proxy' : 'native',
      ...(headers || {}),
    },
  })
);

const httpError = (status: number, detail: string): never => {
  const error = new Error(detail) as Error & { status: number };
  error.status = status;
  throw error;
};

const getCollection = (name: string): Map<string, AnyRecord> => {
  const existing = memoryDb.get(name);
  if (existing) return existing;
  const created = new Map<string, AnyRecord>();
  memoryDb.set(name, created);
  return created;
};

const getFirestoreHandle = () => {
  try {
    return getFirebaseAdminFirestore();
  } catch {
    return null;
  }
};

const listRecords = async (collectionName: string): Promise<Array<{ id: string; data: AnyRecord }>> => {
  const firestore = getFirestoreHandle();
  if (!firestore) {
    return Array.from(getCollection(collectionName).entries()).map(([id, data]) => ({ id, data: cloneRecord(data) }));
  }
  const snapshot = await firestore.collection(collectionName).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, data: cloneRecord(doc.data() as AnyRecord) }));
};

const readRecord = async (collectionName: string, id: string): Promise<AnyRecord | null> => {
  const safeId = asString(id);
  if (!safeId) return null;
  const firestore = getFirestoreHandle();
  if (!firestore) {
    return cloneRecord(getCollection(collectionName).get(safeId) || null);
  }
  const snapshot = await firestore.collection(collectionName).doc(safeId).get();
  return snapshot.exists ? cloneRecord(snapshot.data() as AnyRecord) : null;
};

const writeRecord = async (collectionName: string, id: string, data: AnyRecord, merge = true): Promise<AnyRecord> => {
  const safeId = asString(id) || randomUUID();
  const nextValue = cloneRecord(data);
  const firestore = getFirestoreHandle();
  if (!firestore) {
    const collection = getCollection(collectionName);
    const previous = merge ? (collection.get(safeId) || {}) : {};
    const next = merge ? { ...previous, ...nextValue } : nextValue;
    collection.set(safeId, next);
    return cloneRecord(next);
  }
  await firestore.collection(collectionName).doc(safeId).set(nextValue, { merge });
  return (await readRecord(collectionName, safeId)) || {};
};

const deleteRecord = async (collectionName: string, id: string): Promise<boolean> => {
  const safeId = asString(id);
  if (!safeId) return false;
  const firestore = getFirestoreHandle();
  if (!firestore) {
    return getCollection(collectionName).delete(safeId);
  }
  const ref = firestore.collection(collectionName).doc(safeId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return false;
  await ref.delete();
  return true;
};

const readJsonBody = async (request: Request): Promise<AnyRecord> => {
  try {
    const payload = await request.json();
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as AnyRecord
      : {};
  } catch {
    return {};
  }
};

const getQueryInt = (request: NextRequest, key: string, fallback: number): number => {
  const value = request.nextUrl.searchParams.get(key);
  return value === null ? fallback : asPositiveInt(value, fallback);
};

const getQueryBool = (request: NextRequest, key: string): boolean => (
  asBoolean(request.nextUrl.searchParams.get(key))
);

const queryRecords = async (
  collectionName: string,
  options: {
    filter?: (item: { id: string; data: AnyRecord }) => boolean;
    sort?: (left: { id: string; data: AnyRecord }, right: { id: string; data: AnyRecord }) => number;
    limit?: number;
  } = {},
): Promise<Array<{ id: string; data: AnyRecord }>> => {
  let rows = await listRecords(collectionName);
  if (options.filter) rows = rows.filter(options.filter);
  if (options.sort) rows = rows.sort(options.sort);
  if (Number.isFinite(options.limit)) rows = rows.slice(0, Math.max(0, Number(options.limit)));
  return rows;
};

const normalizePlanName = (value: unknown): keyof typeof PLAN_META => {
  const token = asLower(value);
  if (token === 'launcher' || token === 'launch') return 'Launcher';
  if (token === 'starter') return 'Starter';
  if (token === 'creator') return 'Creator';
  if (token === 'pro') return 'Pro';
  if (token === 'scale' || token === 'plus' || token === 'pro_plus' || token === 'pro-plus') return 'Scale';
  return 'Free';
};

const buildFallbackEntitlements = (uid: string, userData: AnyRecord | null, entitlementsDoc: AnyRecord | null): AnyRecord => {
  const plan = normalizePlanName(entitlementsDoc?.plan || userData?.plan);
  const meta = PLAN_META[plan];
  const monthKey = new Date().toISOString().slice(0, 7);
  const dayKey = new Date().toISOString().slice(0, 10);
  const paidVfBalance = asPositiveNumber(entitlementsDoc?.paidVfBalance);
  const vffBalance = asPositiveNumber(entitlementsDoc?.vffBalance);
  const vcFreeBalance = asPositiveNumber(entitlementsDoc?.vcFreeBalance);
  const vcGrantedBalance = asPositiveNumber(entitlementsDoc?.vcGrantedBalance);
  const vcPaidBalance = asPositiveNumber(entitlementsDoc?.vcPaidBalance);
  return {
    uid,
    plan: meta.plan,
    status: asString(entitlementsDoc?.status) || meta.status,
    monthly: {
      vfLimit: asPositiveInt(entitlementsDoc?.monthlyVfLimit, meta.monthlyVfLimit),
      vfUsed: 0,
      vfRemaining: Math.max(0, asPositiveInt(entitlementsDoc?.monthlyVfLimit, meta.monthlyVfLimit)),
      generationCount: 0,
      periodKey: monthKey,
      windowStartUtc: '',
      windowEndUtc: '',
      byEngine: { VECTOR: { chars: 0, vf: 0 }, PRIME: { chars: 0, vf: 0 } },
    },
    daily: {
      generationUsed: 0,
      vfUsed: 0,
      periodKey: dayKey,
      windowStartUtc: '',
      windowEndUtc: '',
      byEngine: { VECTOR: { chars: 0, vf: 0 }, PRIME: { chars: 0, vf: 0 } },
    },
    billing: {
      stripeCustomerId: asString(entitlementsDoc?.stripeCustomerId) || null,
      subscriptionId: asString(entitlementsDoc?.subscriptionId) || null,
      currencyMode: asString(entitlementsDoc?.currencyMode) || 'INR_BASE_AUTO_FX',
      billingCountry: asString(entitlementsDoc?.billingCountry) || null,
    },
    limits: {
      vfRates: { VECTOR: 1, PRIME: 1 },
      monthlyPlanCaps: Object.fromEntries(Object.entries(PLAN_META).map(([key, row]) => [key.toLowerCase(), row.monthlyVfLimit])),
      maxCharsPerGeneration: asPositiveInt(entitlementsDoc?.maxCharsPerGeneration, meta.maxCharsPerGeneration),
      allowedEngines: ['VECTOR', 'PRIME'],
      tokenPackDiscountPercent: asPositiveInt(entitlementsDoc?.tokenPackDiscountPercent),
      vcTokenPackDiscountPercent: asPositiveInt(entitlementsDoc?.vcTokenPackDiscountPercent),
    },
    features: { earlyAccess: asBoolean(entitlementsDoc?.earlyAccess) || meta.earlyAccess },
    wallet: {
      monthlyFreeRemaining: 0,
      monthlyFreeLimit: 0,
      vffBalance,
      paidVfBalance,
      vcFreeBalance,
      vcGrantedBalance,
      vcPaidBalance,
      vcSpendableBalance: asPositiveNumber(entitlementsDoc?.vcSpendableBalance, vcFreeBalance + vcGrantedBalance + vcPaidBalance),
      vffMonthKey: monthKey,
      vcMonthKey: monthKey,
      spendableNowByEngine: { VECTOR: paidVfBalance + vffBalance, PRIME: paidVfBalance + vffBalance },
      vnBalance: asPositiveNumber(entitlementsDoc?.vnBalance),
    },
  };
};

const getUserEntitlements = async (uid: string, userData: AnyRecord | null): Promise<AnyRecord> => {
  const firestore = getFirestoreHandle();
  const ref = firestore
    ? firestore.collection(COLLECTIONS.users).doc(uid)
    : null;
  return getAccountEntitlements({
    uid,
    decodedToken: { uid } as never,
    userRef: ref as never,
    userData,
    userExists: Boolean(userData),
  } as never) as unknown as AnyRecord;
};

const getAdminAccountProfile = async (uid: string, userData: AnyRecord | null): Promise<AnyRecord> => {
  const profile = await getAccountProfile({
    uid,
    decodedToken: {
      uid,
      email: asString(userData?.email) || undefined,
    } as never,
    userRef: null as never,
    userData,
    userExists: Boolean(userData),
  } as never);
  return profile.profile as AnyRecord;
};

const isDevUidHeaderEnabled = (): boolean => Boolean(readEnvBoolean(
  process.env.VF_DEV_UID_HEADER_ENABLED,
  process.env.NEXT_PUBLIC_ENABLE_DEV_UID_HEADER,
));

const buildDefaultAdminActor = (uid: string, userData: AnyRecord | null, source = 'native_admin_default'): AnyRecord => ({
  uid,
  userId: asString(userData?.userId) || undefined,
  role: 'super_admin',
  status: 'active',
  permissions: [...ALL_PERMISSIONS],
  source,
});

const resolveActorPermissions = (assignment: AnyRecord): AdminPermission[] => {
  const base = ROLE_MATRIX[asString(assignment.role) || 'viewer'] || [];
  const allowOverrides = Array.isArray(assignment.allowOverrides)
    ? assignment.allowOverrides.map((entry) => asString(entry)).filter(Boolean) as AdminPermission[]
    : [];
  const denyOverrides = Array.isArray(assignment.denyOverrides)
    ? assignment.denyOverrides.map((entry) => asString(entry)).filter(Boolean) as AdminPermission[]
    : [];
  return Array.from(new Set([...base, ...allowOverrides])).filter((permission) => !denyOverrides.includes(permission));
};

const hasPermission = (actor: AnyRecord | null, permission: AdminPermission): boolean => {
  if (!actor) return false;
  const permissions = Array.isArray(actor.permissions) ? actor.permissions.map((entry) => asString(entry)) : [];
  return permissions.includes(permission);
};

const persistUserActorMirror = async (uid: string, actor: AnyRecord | null): Promise<void> => {
  await writeRecord(COLLECTIONS.users, uid, actor
    ? { adminActor: actor, isAdmin: true, role: asString(actor.role) || 'admin' }
    : { adminActor: null }, true);
};

const resolveAdminContext = async (request: NextRequest): Promise<AdminContext> => {
  const decodedToken = await verifyFirebaseRequest(request);
  const uid = asString(decodedToken.uid);
  const userData = await readRecord(COLLECTIONS.users, uid);
  const devHeaderAdmin = isDevUidHeaderEnabled() && (
    asBoolean(request.headers.get('x-dev-admin'))
    || asLower(request.headers.get('x-dev-role')) === 'admin'
  );
  const db = await getAdminD1Database();
  let assignment: AnyRecord | null = null;
  if (db) {
    try {
      await ensureAdminD1Schema(db);
      assignment = await readAdminD1Record(db, ADMIN_D1_TABLES.rbacAssignments, 'uid', uid) as AnyRecord | null;
    } catch {
      // D1 read fallback to Firestore
    }
  }
  if (!assignment) {
    assignment = await readRecord(COLLECTIONS.adminRbacAssignments, uid);
  }
  const hasIntrinsicAdmin =
    devHeaderAdmin
    || asBoolean((decodedToken as AnyRecord).admin)
    || asBoolean(userData?.isAdmin)
    || asLower(userData?.role) === 'admin';
  const isAdmin = hasIntrinsicAdmin || Boolean(assignment);
  const actor = hasIntrinsicAdmin
    ? buildDefaultAdminActor(uid, userData, devHeaderAdmin ? 'dev_header' : 'intrinsic_admin')
    : (assignment
      ? {
          uid,
          userId: asString(userData?.userId) || undefined,
          role: asString(assignment.role) || 'viewer',
          status: asString(assignment.status) || 'active',
          permissions: resolveActorPermissions(assignment),
          source: asString(assignment.source) || 'rbac_assignment',
          allowOverrides: Array.isArray(assignment.allowOverrides) ? assignment.allowOverrides : [],
          denyOverrides: Array.isArray(assignment.denyOverrides) ? assignment.denyOverrides : [],
        }
      : null);
  if (!isAdmin || !actor || asLower(actor.status) === 'disabled' || !Array.isArray(actor.permissions) || actor.permissions.length === 0) {
    httpError(403, 'Admin access is not available for this account.');
  }
  return { uid, userData, actor };
};

const requirePermission = async (request: NextRequest, permission: AdminPermission): Promise<AdminContext> => {
  const context = await resolveAdminContext(request);
  if (!hasPermission(context.actor, permission)) {
    httpError(403, `Missing admin permission: ${permission}`);
  }
  return context;
};

const readUnlockToken = (request: Request): string => {
  const raw = asString(request.headers.get('x-admin-unlock'));
  if (!raw.toLowerCase().startsWith('bearer ')) return '';
  return raw.slice(7).trim();
};

const readUnlockState = async (uid: string): Promise<AnyRecord> => ((await readRecord(COLLECTIONS.adminSessionUnlock, uid)) || {});

const buildUnlockStatus = (state: AnyRecord, requestToken = ''): AnyRecord => {
  const keyExpiresAtMs = asNumber(state.keyExpiresAtMs);
  const unlockExpiresAtMs = asNumber(state.unlockExpiresAtMs);
  const lockedUntilMs = asNumber(state.lockedUntilMs);
  const now = nowMs();
  const storedToken = asString(state.unlockToken);
  const isUnlocked = Boolean(storedToken && requestToken && storedToken === requestToken && unlockExpiresAtMs > now);
  const failedAttempts = asPositiveInt(state.failedAttempts);
  return {
    recordId: asString(state.recordId) || undefined,
    unlockRequired: true,
    hasIssuedKey: keyExpiresAtMs > now,
    isLocked: lockedUntilMs > now,
    lockedUntil: lockedUntilMs > now ? new Date(lockedUntilMs).toISOString() : undefined,
    lockedUntilMs: lockedUntilMs > now ? lockedUntilMs : undefined,
    isUnlocked,
    unlockExpiresAt: unlockExpiresAtMs > now ? new Date(unlockExpiresAtMs).toISOString() : undefined,
    unlockExpiresAtMs: unlockExpiresAtMs > now ? unlockExpiresAtMs : undefined,
    keyExpiresAt: keyExpiresAtMs > now ? new Date(keyExpiresAtMs).toISOString() : undefined,
    keyExpiresAtMs: keyExpiresAtMs > now ? keyExpiresAtMs : undefined,
    failedAttempts,
    attemptsRemaining: Math.max(0, DEFAULT_UNLOCK_MAX_ATTEMPTS - failedAttempts),
  };
};

const requireUnlockForMutation = async (request: NextRequest, context: AdminContext, exempt = false): Promise<void> => {
  if (exempt) return;
  const method = request.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
  const state = await readUnlockState(context.uid);
  const token = readUnlockToken(request);
  const status = buildUnlockStatus(state, token);
  if (status.isLocked) httpError(423, 'Admin session is temporarily locked.');
  if (!token) httpError(401, 'X-Admin-Unlock bearer token is required.');
  if (!status.isUnlocked) httpError(401, 'Admin unlock token expired.');
};

const proxyWithAdminOpsHeaders = async (request: NextRequest, pathSegments: string[]): Promise<Response> => {
  const response = await proxyBackendRequest(request, pathSegments);
  const headers = new Headers(response.headers);
  headers.set('x-vf-admin-ops-mode', 'proxy');
  headers.set('x-vf-admin-ops-compatibility', 'true');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const recordAuditEvent = async (
  context: AdminContext,
  input: { action: string; resourceType: string; resourceId: string; subjectUid?: string; subjectUserId?: string; before?: AnyRecord; after?: AnyRecord; meta?: AnyRecord },
): Promise<AnyRecord> => {
  const rows = await queryRecords(COLLECTIONS.adminAuditEvents, {
    sort: (left, right) => asPositiveInt(left.data.sequence) - asPositiveInt(right.data.sequence),
  });
  const previous = rows.length > 0 ? rows[rows.length - 1] : null;
  const sequence = (previous ? asPositiveInt(previous.data.sequence) : 0) + 1;
  const prevHash = asString(previous?.data.eventHash);
  const eventId = `audit_${randomUUID()}`;
  const payload = {
    eventId,
    ts: nowIso(),
    actorUid: context.uid,
    actorUserId: asString(context.userData?.userId) || undefined,
    actorRole: asString(context.actor.role) || undefined,
    subjectUid: input.subjectUid,
    subjectUserId: input.subjectUserId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    requestId: randomUUID(),
    sequence,
    prevHash: prevHash || undefined,
    meta: input.meta || {},
    before: input.before,
    after: input.after,
  };
  const eventHash = createHash('sha256').update(JSON.stringify({ prevHash, payload })).digest('hex');
  const fullEntry = { ...payload, eventHash };
  // Dual-write: D1 primary, Firestore secondary
  const db = await getAdminD1Database();
  if (db) {
    try {
      await ensureAdminD1Schema(db);
      await writeAdminD1AuditEvent(db, fullEntry);
    } catch {
      // D1 write is best-effort
    }
  }
  return writeRecord(COLLECTIONS.adminAuditEvents, eventId, fullEntry, false);
};

const verifyAuditChain = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'audit.read');
  const db = await getAdminD1Database();
  let rows: Array<{ id: string; data: AnyRecord }>;
  if (db) {
    try {
      await ensureAdminD1Schema(db);
      const d1Rows = await readAdminD1Rows(db, `SELECT event_id, payload_json FROM ${ADMIN_D1_TABLES.auditEvents} ORDER BY sequence ASC`);
      rows = d1Rows
        .map((row) => {
          const data = parseAdminPersistedJsonRecord(asString(row.payload_json)) || {};
          return { id: asString(row.event_id) || asString(data.eventId), data };
        })
        .filter((item) => item.id && Object.keys(item.data).length > 0);
    } catch {
      rows = await queryRecords(COLLECTIONS.adminAuditEvents, {
        sort: (left, right) => asPositiveInt(left.data.sequence) - asPositiveInt(right.data.sequence),
      });
    }
  } else {
    rows = await queryRecords(COLLECTIONS.adminAuditEvents, {
      sort: (left, right) => asPositiveInt(left.data.sequence) - asPositiveInt(right.data.sequence),
    });
  }
  let prevHash = '';
  let mismatchAtSequence: number | null = null;
  let mismatchEventId: string | null = null;
  for (const row of rows) {
    const payload = {
      eventId: row.data.eventId,
      ts: row.data.ts,
      actorUid: row.data.actorUid,
      actorUserId: row.data.actorUserId,
      actorRole: row.data.actorRole,
      subjectUid: row.data.subjectUid,
      subjectUserId: row.data.subjectUserId,
      action: row.data.action,
      resourceType: row.data.resourceType,
      resourceId: row.data.resourceId,
      requestId: row.data.requestId,
      sequence: row.data.sequence,
      prevHash: row.data.prevHash,
      meta: row.data.meta,
      before: row.data.before,
      after: row.data.after,
    };
    const expected = createHash('sha256').update(JSON.stringify({ prevHash, payload })).digest('hex');
    if (expected !== asString(row.data.eventHash)) {
      mismatchAtSequence = asPositiveInt(row.data.sequence);
      mismatchEventId = asString(row.data.eventId) || row.id;
      break;
    }
    prevHash = expected;
  }
  return json({
    ok: mismatchAtSequence === null,
    checked: rows.length,
    mismatchAtSequence,
    mismatchEventId,
  });
};

const getSupportAiPolicy = async (): Promise<AnyRecord> => {
  const existing = await readRecord(COLLECTIONS.adminSupportAiPolicy, 'default');
  return existing || {
    enabled: false,
    confidenceThreshold: 0.75,
    maxAutoRepliesPerConversation: 1,
    allowedActions: ['suggest', 'summarize'],
    blockedTopics: [],
    requireHumanForTags: ['billing', 'refund', 'legal'],
    updatedAt: nowIso(),
  };
};

const listSupportMessagesByConversation = async (conversationId: string): Promise<AnyRecord[]> => {
  const rows = await queryRecords(COLLECTIONS.supportMessages, {
    filter: (row) => asString(row.data.conversationId) === conversationId,
    sort: (left, right) => asString(left.data.createdAt).localeCompare(asString(right.data.createdAt)),
  });
  return rows.map((row) => ({
    messageId: row.id,
    conversationId: asString(row.data.conversationId),
    fromType: asString(row.data.fromType) || 'user',
    uid: asString(row.data.uid) || undefined,
    userId: asString(row.data.userId) || undefined,
    text: asString(row.data.text),
    createdAt: asString(row.data.createdAt) || undefined,
  }));
};

const buildAdminUserSummary = async (uid: string, userData: AnyRecord | null): Promise<AnyRecord> => {
  const profile = await getAdminAccountProfile(uid, userData);
  const entitlements = await getUserEntitlements(uid, userData);
  const db = await getAdminD1Database();
  let hasRbacAssignment = false;
  if (db) {
    try {
      await ensureAdminD1Schema(db);
      const d1Assignment = await readAdminD1Record(db, ADMIN_D1_TABLES.rbacAssignments, 'uid', uid) as AnyRecord | null;
      hasRbacAssignment = Boolean(d1Assignment);
    } catch {
      hasRbacAssignment = Boolean(await readRecord(COLLECTIONS.adminRbacAssignments, uid));
    }
  } else {
    hasRbacAssignment = Boolean(await readRecord(COLLECTIONS.adminRbacAssignments, uid));
  }
  return {
    uid,
    userId: asString(profile.userId || userData?.userId) || undefined,
    email: asString(profile.email || userData?.email),
    displayName: asString(profile.displayName || userData?.displayName || userData?.name),
    disabled: asBoolean(userData?.disabled),
    admin: asBoolean(userData?.isAdmin) || asLower(userData?.role) === 'admin' || hasRbacAssignment,
    role: asString(userData?.role) || undefined,
    plan: entitlements.plan,
    accountStatus: asString(userData?.status || entitlements.status) || undefined,
    features: { earlyAccess: asBoolean(entitlements.features?.earlyAccess) },
    limits: { maxCharsPerGeneration: asPositiveInt(entitlements.limits?.maxCharsPerGeneration) },
    wallet: {
      paidVfBalance: asPositiveNumber(entitlements.wallet?.paidVfBalance),
      vffBalance: asPositiveNumber(entitlements.wallet?.vffBalance),
      vcFreeBalance: asPositiveNumber(entitlements.wallet?.vcFreeBalance),
      vcGrantedBalance: asPositiveNumber(entitlements.wallet?.vcGrantedBalance),
      vcPaidBalance: asPositiveNumber(entitlements.wallet?.vcPaidBalance),
      vcSpendableBalance: asPositiveNumber(entitlements.wallet?.vcSpendableBalance, asPositiveNumber(entitlements.wallet?.vcFreeBalance) + asPositiveNumber(entitlements.wallet?.vcGrantedBalance) + asPositiveNumber(entitlements.wallet?.vcPaidBalance)),
    },
    usage: {
      monthlyVfUsed: asPositiveNumber(entitlements.monthly?.vfUsed),
      dailyGenerationUsed: asPositiveInt(entitlements.daily?.generationUsed),
    },
  };
};

const listAdminUsers = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'users.read');
  const q = asLower(request.nextUrl.searchParams.get('q'));
  const limit = getQueryInt(request, 'limit', 100);
  let rows = await listRecords(COLLECTIONS.users);
  if (rows.length === 0) {
    const ctx = await resolveAdminContext(request);
    rows = [{ id: ctx.uid, data: ctx.userData || { isAdmin: true } }];
  }
  const users: AnyRecord[] = [];
  for (const row of rows.slice(0, limit * 3)) {
    const summary = await buildAdminUserSummary(row.id, row.data);
    const haystack = [summary.uid, summary.userId, summary.email, summary.displayName].map((entry) => asLower(entry)).join(' ');
    if (q && !haystack.includes(q)) continue;
    users.push(summary);
    if (users.length >= limit) break;
  }
  return json({ users });
};

const patchAdminUserHandler = async (request: NextRequest, uid: string): Promise<Response> => {
  const context = await requirePermission(request, 'users.write');
  await requireUnlockForMutation(request, context);
  const input = await readJsonBody(request);
  const beforeUser = await readRecord(COLLECTIONS.users, uid);
  const beforeEntitlements = await getUserEntitlements(uid, beforeUser);
  const plan = input.plan === undefined ? normalizePlanName(beforeEntitlements?.plan || beforeUser?.plan) : normalizePlanName(input.plan);
  const meta = PLAN_META[plan];
  await updateAccountEntitlements(uid, {
    plan: meta.plan,
    status: meta.status,
    monthlyVfLimit: meta.monthlyVfLimit,
    maxCharsPerGeneration: meta.maxCharsPerGeneration,
    earlyAccess: meta.earlyAccess,
    paidVfBalance: asPositiveNumber(beforeEntitlements.wallet?.paidVfBalance) + asNumber(input.paidVfDelta),
    vffBalance: asPositiveNumber(beforeEntitlements.wallet?.vffBalance) + asNumber(input.vffDelta),
  }, asLower(plan) as never);
  if (input.disabled !== undefined) {
    await writeRecord(COLLECTIONS.users, uid, { disabled: Boolean(input.disabled), updatedAt: nowIso() }, true);
    try {
      await getFirebaseAdminAuth().updateUser(uid, { disabled: Boolean(input.disabled) });
    } catch {
      // Best effort only.
    }
  }
  const afterEntitlements = await getUserEntitlements(uid, beforeUser);
  await recordAuditEvent(context, {
    action: 'admin.users.patch',
    resourceType: 'user',
    resourceId: uid,
    subjectUid: uid,
    subjectUserId: asString(beforeUser?.userId) || undefined,
    before: { user: beforeUser, entitlements: beforeEntitlements },
    after: { entitlements: afterEntitlements },
    meta: input,
  });
  return json({ entitlements: afterEntitlements });
};

const forceAdminUserIdHandler = async (request: NextRequest, uid: string): Promise<Response> => {
  const context = await requirePermission(request, 'users.write');
  await requireUnlockForMutation(request, context);
  const input = await readJsonBody(request);
  const nextUserId = asLower(input.userId).replace(/[^a-z0-9_]+/g, '_');
  if (!nextUserId) httpError(400, 'userId is required.');
  const beforeUser = await readRecord(COLLECTIONS.users, uid);
  const beforeProfile = await getAdminAccountProfile(uid, beforeUser);
  const targetUserData = beforeUser
    ? {
        ...beforeUser,
        isAdmin: false,
        role: asLower(beforeUser.role) === 'admin' ? 'user' : beforeUser.role,
      }
    : null;
  const nextProfile = await upsertAccountProfile({
    uid,
    decodedToken: {
      uid,
      email: asString(beforeProfile?.email || beforeUser?.email) || undefined,
    } as never,
    userRef: null as never,
    userData: targetUserData,
    userExists: Boolean(beforeUser),
  } as never, {
    userId: nextUserId,
    forceUserId: true,
  });
  await recordAuditEvent(context, {
    action: 'admin.users.force_user_id',
    resourceType: 'user',
    resourceId: uid,
    subjectUid: uid,
    subjectUserId: nextUserId,
    before: beforeProfile || undefined,
    after: nextProfile,
    meta: input,
  });
  return json({ profile: nextProfile });
};

const resetAdminUserPasswordHandler = async (request: NextRequest, uid: string): Promise<Response> => {
  const context = await requirePermission(request, 'users.write');
  await requireUnlockForMutation(request, context);
  const input = await readJsonBody(request);
  const newPassword = asString(input.newPassword);
  if (!newPassword) httpError(400, 'newPassword is required.');
  try {
    await getFirebaseAdminAuth().updateUser(uid, { password: newPassword });
  } catch {
    // Best effort only.
  }
  await recordAuditEvent(context, {
    action: 'admin.users.reset_password',
    resourceType: 'user',
    resourceId: uid,
    subjectUid: uid,
  });
  return json({ ok: true });
};

const revokeAdminUserSessionsHandler = async (request: NextRequest, uid: string): Promise<Response> => {
  const context = await requirePermission(request, 'users.write');
  await requireUnlockForMutation(request, context);
  try {
    await getFirebaseAdminAuth().revokeRefreshTokens(uid);
  } catch {
    // Best effort only.
  }
  await recordAuditEvent(context, {
    action: 'admin.users.revoke_sessions',
    resourceType: 'user',
    resourceId: uid,
    subjectUid: uid,
  });
  return json({ ok: true });
};

const deleteAdminUserHandler = async (request: NextRequest, uid: string): Promise<Response> => {
  const context = await requirePermission(request, 'users.write');
  await requireUnlockForMutation(request, context);
  const firestore = getFirestoreHandle();
  if (firestore) {
    await deleteUserAccount({
      uid,
      decodedToken: { uid } as never,
      userRef: firestore.collection(COLLECTIONS.users).doc(uid) as never,
      userData: await readRecord(COLLECTIONS.users, uid),
      userExists: true,
    } as never, ACCOUNT_DELETE_CONFIRM_PHRASE);
  } else {
    await Promise.all([
      deleteRecord(COLLECTIONS.users, uid),
      deleteRecord(COLLECTIONS.userProfiles, uid),
      deleteRecord(COLLECTIONS.entitlements, uid),
      deleteRecord(COLLECTIONS.adminRbacAssignments, uid),
    ]);
  }
  // Clean D1 RBAC assignment
  const db = await getAdminD1Database();
  if (db) {
    try {
      await ensureAdminD1Schema(db);
      await deleteAdminD1Record(db, ADMIN_D1_TABLES.rbacAssignments, 'uid', uid);
    } catch {
      // D1 delete is best-effort
    }
  }
  await recordAuditEvent(context, {
    action: 'admin.users.delete',
    resourceType: 'user',
    resourceId: uid,
    subjectUid: uid,
  });
  return json({ ok: true });
};

const listVcGrantItems = async (uid: string, limit: number): Promise<AnyRecord[]> => {
  const rows = await queryRecords(COLLECTIONS.adminVcGrantRecords, {
    filter: (row) => asString(row.data.uid) === uid,
    sort: (left, right) => asString(right.data.createdAt).localeCompare(asString(left.data.createdAt)),
    limit,
  });
  return rows.map((row) => ({
    id: row.id,
    amount: asPositiveNumber(row.data.amount),
    createdAt: asString(row.data.createdAt) || undefined,
    note: asString(row.data.note) || undefined,
    requestId: asString(row.data.requestId) || undefined,
    actorUid: asString(row.data.actorUid) || undefined,
    actorUserId: asString(row.data.actorUserId) || undefined,
    before: row.data.before,
    after: row.data.after,
  }));
};

const listAdminUserVcGrants = async (request: NextRequest, uid: string): Promise<Response> => {
  await requirePermission(request, 'billing.read');
  return json({ items: await listVcGrantItems(uid, getQueryInt(request, 'limit', 50)) });
};

const grantAdminUserVcHandler = async (request: NextRequest, uid: string): Promise<Response> => {
  const context = await requirePermission(request, 'billing.write');
  await requireUnlockForMutation(request, context);
  const input = await readJsonBody(request);
  const amount = asPositiveNumber(input.amount);
  if (amount <= 0) httpError(400, 'amount must be greater than zero.');
  const beforeEntitlements = await getUserEntitlements(uid, await readRecord(COLLECTIONS.users, uid));
  await updateAccountEntitlements(uid, {
    vcGrantedBalance: asPositiveNumber(beforeEntitlements.wallet?.vcGrantedBalance) + amount,
    vcSpendableBalance: asPositiveNumber(beforeEntitlements.wallet?.vcSpendableBalance) + amount,
  });
  const afterEntitlements = await getUserEntitlements(uid, await readRecord(COLLECTIONS.users, uid));
  await writeRecord(COLLECTIONS.adminVcGrantRecords, randomUUID(), {
    uid,
    amount,
    note: asString(input.note) || undefined,
    requestId: asString(input.requestId) || undefined,
    actorUid: context.uid,
    actorUserId: asString(context.userData?.userId) || undefined,
    before: beforeEntitlements.wallet,
    after: afterEntitlements.wallet,
    createdAt: nowIso(),
  }, false);
  await recordAuditEvent(context, {
    action: 'admin.billing.vc_grant',
    resourceType: 'user_vc_grant',
    resourceId: uid,
    subjectUid: uid,
    before: beforeEntitlements.wallet || {},
    after: afterEntitlements.wallet || {},
    meta: { amount, note: asString(input.note) || undefined },
  });
  return json({ entitlements: afterEntitlements, items: await listVcGrantItems(uid, 50) });
};

const normalizeCouponInput = (input: AnyRecord): AnyRecord => {
  const couponType = asString(input.couponType) || 'wallet_credit';
  return {
    code: asUpper(input.code),
    couponType,
    creditVf: asPositiveInt(input.creditVf),
    usagePolicy: asString(input.usagePolicy) || 'single_per_user',
    usageLimit: asPositiveInt(input.usageLimit || input.maxRedemptions),
    maxRedemptions: asPositiveInt(input.maxRedemptions || input.usageLimit),
    active: input.active === undefined ? true : Boolean(input.active),
    expiresAt: asString(input.expiresAt) || null,
    discountType: asString(input.discountType) || undefined,
    percentOff: input.percentOff === undefined ? undefined : asPositiveNumber(input.percentOff),
    amountOffInr: input.amountOffInr === undefined ? undefined : asPositiveNumber(input.amountOffInr),
    appliesToPlans: Array.isArray(input.appliesToPlans) ? input.appliesToPlans.map((entry) => asString(entry)).filter(Boolean) : [],
    planDiscounts: Array.isArray(input.planDiscounts)
      ? Object.fromEntries(input.planDiscounts.map((entry) => [asString((entry as AnyRecord).plan), entry]))
      : (input.planDiscounts && typeof input.planDiscounts === 'object' ? input.planDiscounts : {}),
    note: asString(input.note) || undefined,
  };
};

const listCouponsHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'coupons.read');
  const limit = getQueryInt(request, 'limit', 100);
  const couponType = asString(request.nextUrl.searchParams.get('couponType'));
  const d1Rows = await listCouponD1Records();
  let coupons: AnyRecord[];
  if (d1Rows.length > 0) {
    const parsed = d1Rows
      .map((row) => {
        const data = parseJsonRecord(row.payload_json) || {};
        return { id: row.coupon_id, ...data };
      })
      .filter((row) => !couponType || asString(row.couponType) === couponType)
      .sort((a, b) => asString(b.updatedAt || b.createdAt).localeCompare(asString(a.updatedAt || a.createdAt)))
      .slice(0, limit);
    coupons = parsed;
  } else {
    const rows = await queryRecords(COLLECTIONS.coupons, {
      filter: (row) => !couponType || asString(row.data.couponType) === couponType,
      sort: (left, right) => asString(right.data.updatedAt || right.data.createdAt).localeCompare(asString(left.data.updatedAt || left.data.createdAt)),
      limit,
    });
    coupons = rows.map((row) => ({ id: row.id, ...row.data }));
  }
  return json({ coupons });
};

const createCouponHandler = async (request: NextRequest): Promise<Response> => {
  const context = await requirePermission(request, 'coupons.write');
  await requireUnlockForMutation(request, context);
  const input = normalizeCouponInput(await readJsonBody(request));
  if (!input.code) httpError(400, 'Coupon code is required.');
  const couponId = randomUUID();
  const coupon = {
    ...input,
    redeemedCount: 0,
    reservedCount: 0,
    createdBy: context.uid,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await writeCouponD1Record(couponId, coupon);
  await writeRecord(COLLECTIONS.coupons, couponId, coupon, false);
  await recordAuditEvent(context, {
    action: 'admin.coupons.create',
    resourceType: 'coupon',
    resourceId: asString(coupon.code),
    after: coupon,
  });
  return json({ coupon: { id: couponId, ...coupon } });
};

const generateCouponCodeHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'coupons.write');
  const prefix = asUpper(request.nextUrl.searchParams.get('prefix') || 'VF');
  const length = Math.max(4, Math.min(16, getQueryInt(request, 'length', 8)));
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = prefix.replace(/[^A-Z0-9]+/g, '').slice(0, 8);
  while (code.length < length) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)] || 'X';
  }
  return json({ code: code.slice(0, length) });
};

const patchCouponHandler = async (request: NextRequest, couponId: string): Promise<Response> => {
  const context = await requirePermission(request, 'coupons.write');
  await requireUnlockForMutation(request, context);
  let before = await readCouponD1Record(couponId) as AnyRecord;
  if (!before) {
    before = await readRecord(COLLECTIONS.coupons, couponId);
  }
  if (!before) httpError(404, 'Coupon not found.');
  const input = normalizeCouponInput({ ...before, ...(await readJsonBody(request)) });
  const coupon = { ...before, ...input, updatedAt: nowIso() };
  await writeCouponD1Record(couponId, coupon);
  await writeRecord(COLLECTIONS.coupons, couponId, coupon, true);
  await recordAuditEvent(context, {
    action: 'admin.coupons.patch',
    resourceType: 'coupon',
    resourceId: couponId,
    before,
    after: coupon,
  });
  return json({ coupon: { id: couponId, ...coupon } });
};

const buildGeminiSlots = async (): Promise<AnyRecord[]> => {
  const rows = await queryRecords(COLLECTIONS.adminGeminiSlots, {
    sort: (left, right) => asString(left.data.slotId).localeCompare(asString(right.data.slotId)),
  });
  if (rows.length > 0) {
    return rows.map((row) => ({ id: row.id, ...row.data }));
  }
  const configured = Boolean(readEnvValue(
    process.env.GEMINI_API_KEY,
    process.env.VF_GEMINI_API_KEY,
    process.env.GOOGLE_CLOUD_PROJECT,
    process.env.GCLOUD_PROJECT,
  ));
  return [{
    slotId: 'primary',
    label: 'Primary AI slot set',
    status: configured ? 'ready' : 'not_configured',
    source: 'nextjs-native',
    health: {
      healthy: configured,
      status: configured ? 'ready' : 'not_configured',
      reason: configured ? '' : 'Primary AI credentials are not configured.',
      lastCheckedAt: nowIso(),
    },
    usage: {
      requests: 0,
      tokens: 0,
      failures: 0,
      lastUsedAt: undefined,
    },
    inFlight: 0,
    lastUsedAt: undefined,
    quarantinedUntil: undefined,
  }];
};

const getGeminiPoolStatusHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'ops.read');
  const slots = await buildGeminiSlots();
  const slotCount = slots.length;
  const updatedAt = nowIso();
  return json({
    ok: true,
    updatedAt,
    warnings: [],
    slots,
    backend: { ok: true, updatedAt, lastCheckedAt: updatedAt, slotCount, slots },
    runtime: { ok: true, updatedAt, lastCheckedAt: updatedAt, slotCount, slots },
  });
};

const getGeminiPoolUsageHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'ops.read');
  const slots = await buildGeminiSlots();
  const updatedAt = nowIso();
  return json({
    ok: true,
    updatedAt,
    slots,
    backend: {
      ok: true,
      updatedAt,
      lastCheckedAt: updatedAt,
      slotCount: slots.length,
      slots,
      usage: Object.fromEntries(slots.map((slot) => [asString(slot.slotId), slot])),
    },
    runtime: {
      ok: true,
      updatedAt,
      lastCheckedAt: updatedAt,
      slotCount: slots.length,
      slots,
      usage: Object.fromEntries(slots.map((slot) => [asString(slot.slotId), slot])),
    },
  });
};

const issueSessionUnlockHandler = async (request: NextRequest): Promise<Response> => {
  const context = await resolveAdminContext(request);
  const current = await readUnlockState(context.uid);
  const now = nowMs();
  if (asNumber(current.lockedUntilMs) > now) {
    return json({ ok: false, uid: context.uid, status: buildUnlockStatus(current) }, 423);
  }
  const unlockKey = createHash('sha256').update(`${context.uid}:${randomUUID()}:${now}`).digest('hex').slice(0, 12).toUpperCase();
  const next = await writeRecord(COLLECTIONS.adminSessionUnlock, context.uid, {
    recordId: `unlock_${context.uid}`,
    uid: context.uid,
    unlockKey,
    keyExpiresAtMs: now + DEFAULT_UNLOCK_KEY_TTL_MS,
    unlockToken: '',
    unlockExpiresAtMs: 0,
    failedAttempts: 0,
    lockedUntilMs: 0,
    updatedAt: nowIso(),
  }, true);
  await recordAuditEvent(context, {
    action: 'admin.session_unlock.issue',
    resourceType: 'admin_session_unlock',
    resourceId: context.uid,
  });
  return json({
    ok: true,
    uid: context.uid,
    unlockKey,
    keyExpiresAt: new Date(asNumber(next.keyExpiresAtMs)).toISOString(),
    keyExpiresAtMs: asNumber(next.keyExpiresAtMs),
    status: buildUnlockStatus(next),
  });
};

const verifySessionUnlockHandler = async (request: NextRequest): Promise<Response> => {
  const context = await resolveAdminContext(request);
  const input = await readJsonBody(request);
  const unlockKey = asUpper(input.unlockKey);
  const current = await readUnlockState(context.uid);
  const now = nowMs();
  if (asNumber(current.lockedUntilMs) > now) {
    return json({ ok: false, uid: context.uid, status: buildUnlockStatus(current) }, 423);
  }
  const keyMatches = unlockKey && unlockKey === asUpper(current.unlockKey) && asNumber(current.keyExpiresAtMs) > now;
  if (!keyMatches) {
    const failedAttempts = asPositiveInt(current.failedAttempts) + 1;
    const lockedUntilMs = failedAttempts >= DEFAULT_UNLOCK_MAX_ATTEMPTS ? now + DEFAULT_UNLOCK_LOCK_MS : 0;
    const next = await writeRecord(COLLECTIONS.adminSessionUnlock, context.uid, { failedAttempts, lockedUntilMs, updatedAt: nowIso() }, true);
    return json({ ok: false, uid: context.uid, status: buildUnlockStatus(next) }, 401);
  }
  const unlockToken = createHash('sha256').update(`${context.uid}:${randomUUID()}:${now}`).digest('hex');
  const next = await writeRecord(COLLECTIONS.adminSessionUnlock, context.uid, {
    unlockToken,
    unlockExpiresAtMs: now + DEFAULT_UNLOCK_TOKEN_TTL_MS,
    failedAttempts: 0,
    lockedUntilMs: 0,
    updatedAt: nowIso(),
  }, true);
  await recordAuditEvent(context, {
    action: 'admin.session_unlock.verify',
    resourceType: 'admin_session_unlock',
    resourceId: context.uid,
  });
  return json({
    ok: true,
    uid: context.uid,
    unlockToken,
    expiresAt: new Date(asNumber(next.unlockExpiresAtMs)).toISOString(),
    expiresAtMs: asNumber(next.unlockExpiresAtMs),
    status: buildUnlockStatus(next, unlockToken),
  });
};

const sessionUnlockStatusHandler = async (request: NextRequest): Promise<Response> => {
  const context = await resolveAdminContext(request);
  const state = await readUnlockState(context.uid);
  return json({ ok: true, uid: context.uid, status: buildUnlockStatus(state, readUnlockToken(request)) });
};

const getVoiceCloneProviderStatusHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'ops.read');
  const response = await handleVoiceCloneRoute(request, ['provider']);
  const payload = await response.json().catch(() => ({}));
  return json({
    ok: true,
    activeProvider: asString((payload as AnyRecord).activeProvider || (payload as AnyRecord).provider || 'modal') || 'modal',
    defaultProvider: asString((payload as AnyRecord).defaultProvider || (payload as AnyRecord).provider || 'modal') || 'modal',
    provider: asString((payload as AnyRecord).provider || (payload as AnyRecord).activeProvider || 'modal') || 'modal',
    providerLabel: asString((payload as AnyRecord).providerLabel || (payload as AnyRecord).provider || 'modal') || 'modal',
    configured: (payload as AnyRecord).configured === undefined ? true : Boolean((payload as AnyRecord).configured),
    ready: Boolean((payload as AnyRecord).ready),
    detail: asString((payload as AnyRecord).detail) || undefined,
    device: asString((payload as AnyRecord).device) || undefined,
    expectedGpuConcurrency: asPositiveInt((payload as AnyRecord).expectedGpuConcurrency, 1),
    runtimeGpuConcurrency: asPositiveInt((payload as AnyRecord).runtimeGpuConcurrency, asPositiveInt((payload as AnyRecord).expectedGpuConcurrency, 1)),
    concurrencyVerified: (payload as AnyRecord).concurrencyVerified === undefined ? true : Boolean((payload as AnyRecord).concurrencyVerified),
    revision: asPositiveInt((payload as AnyRecord).revision, 1),
    updatedAt: nowIso(),
    providerStatus: (payload as AnyRecord).providerStatus && typeof (payload as AnyRecord).providerStatus === 'object'
      ? (payload as AnyRecord).providerStatus
      : {
          key: asString((payload as AnyRecord).provider || (payload as AnyRecord).activeProvider || 'modal') || 'modal',
          configured: (payload as AnyRecord).configured === undefined ? true : Boolean((payload as AnyRecord).configured),
          ready: Boolean((payload as AnyRecord).ready),
          detail: asString((payload as AnyRecord).detail) || undefined,
          device: asString((payload as AnyRecord).device) || undefined,
          expectedGpuConcurrency: asPositiveInt((payload as AnyRecord).expectedGpuConcurrency, 1),
          runtimeGpuConcurrency: asPositiveInt((payload as AnyRecord).runtimeGpuConcurrency, asPositiveInt((payload as AnyRecord).expectedGpuConcurrency, 1)),
          concurrencyVerified: (payload as AnyRecord).concurrencyVerified === undefined ? true : Boolean((payload as AnyRecord).concurrencyVerified),
        },
  });
};

const patchVoiceCloneProviderHandler = async (request: NextRequest): Promise<Response> => {
  const context = await requirePermission(request, 'ops.mutate');
  await requireUnlockForMutation(request, context);
  return json({
    ok: false,
    activeProvider: 'modal',
    defaultProvider: 'modal',
    detail: 'Voice clone provider switching is no longer supported. Modal is the only supported VC runtime.',
  }, 410);
};

const usageResetStatusHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'ops.read');
  const lastRun = await readRecord(COLLECTIONS.adminUsageResetState, 'daily');
  return json({ ok: true, status: lastRun ? 'available' : 'never_run', ...(lastRun ? { lastRun } : {}) });
};

const resetDailyUsageAllHandler = async (request: NextRequest): Promise<Response> => {
  const context = await requirePermission(request, 'ops.mutate');
  await requireUnlockForMutation(request, context);
  const dryRun = getQueryBool(request, 'dryRun');
  const dailyDocs = await listRecords(COLLECTIONS.usageDaily);
  const summary = {
    ok: true,
    dryRun,
    mode: 'native_nextjs',
    dayKey: new Date().toISOString().slice(0, 10),
    periodKey: new Date().toISOString().slice(0, 10),
    usersAffected: dailyDocs.length,
    docsCleared: dailyDocs.length,
    requestedBy: context.uid,
    ranAt: nowIso(),
    reservedEventsToday: null,
  };
  if (!dryRun) {
    for (const row of dailyDocs) {
      await writeRecord(COLLECTIONS.usageDaily, row.id, {
        vfUsed: 0,
        generationUsed: 0,
        byEngine: { VECTOR: { chars: 0, vf: 0 }, PRIME: { chars: 0, vf: 0 } },
        updatedAt: nowIso(),
      }, true);
    }
    await writeRecord(COLLECTIONS.adminUsageResetState, 'daily', summary, false);
    await recordAuditEvent(context, {
      action: 'admin.usage.reset_daily_all',
      resourceType: 'usage_daily',
      resourceId: 'all',
      meta: { dryRun, docsCleared: dailyDocs.length },
    });
  }
  return json(summary);
};

const integrationsUsageHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'ops.read');
  const jobs = await queryRecords(COLLECTIONS.opsGuardianActions);
  return json({
    ok: true,
    windows: {
      total: {
        requests: jobs.length,
        success: jobs.filter((row) => asString(row.data.status) === 'completed').length,
        clientErrors: 0,
        serverErrors: jobs.filter((row) => asString(row.data.status) === 'failed').length,
        errorRatePct: 0,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        maxLatencyMs: 0,
      },
    },
    integrations: [
      { integration: 'stripe', windows: { total: { requests: 0, success: 0, clientErrors: 0, serverErrors: 0, errorRatePct: 0, avgLatencyMs: 0, p95LatencyMs: 0, maxLatencyMs: 0 } } },
      { integration: 'primary-ai', windows: { total: { requests: 0, success: 0, clientErrors: 0, serverErrors: 0, errorRatePct: 0, avgLatencyMs: 0, p95LatencyMs: 0, maxLatencyMs: 0 } } },
    ],
    gateway: getReplatformRuntimeSummary(),
    jobQueue: { pending: jobs.filter((row) => asString(row.data.status) === 'pending').length },
  });
};

const ttsGatewayStatusHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'ops.read');
  return json({
    ok: true,
    runtime: getReplatformRuntimeSummary(),
    updatedAt: nowIso(),
    model: readEnvValue(process.env.VF_TTS_TEXTTOSPEECH_MODEL, process.env.VF_READER_TTS_MODEL, 'gemini-2.5-flash-tts'),
  });
};

const ttsQueueMetricsHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'ops.read');
  return json({
    ok: true,
    updatedAt: nowIso(),
    queue: { depth: 0, pending: 0, running: 0, completed24h: 0, failed24h: 0 },
  });
};

const getRoleCatalogHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'rbac.read');
  return json({ ok: true, roles: Object.keys(ROLE_MATRIX), permissions: ALL_PERMISSIONS, matrix: ROLE_MATRIX });
};

const countActiveSuperAdmins = async (): Promise<number> => {
  const db = await getAdminD1Database();
  if (db) {
    try {
      await ensureAdminD1Schema(db);
      const rows = await readAdminD1Rows(db, `SELECT payload_json FROM ${ADMIN_D1_TABLES.rbacAssignments}`);
      const assignments = rows
        .map((row) => parseAdminPersistedJsonRecord(asString(row.payload_json)))
        .filter(Boolean)
        .filter((data) => asString(data!.role) === 'super_admin' && asLower(asString(data!.status)) !== 'disabled');
      return assignments.length;
    } catch {
      // Fall through to Firestore
    }
  }
  const assignments = await queryRecords(COLLECTIONS.adminRbacAssignments, {
    filter: (row) => asString(row.data.role) === 'super_admin' && asLower(row.data.status) !== 'disabled',
  });
  return assignments.length;
};

const listRbacUsersHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'rbac.read');
  const q = asLower(request.nextUrl.searchParams.get('q'));
  const limit = getQueryInt(request, 'limit', 200);
  let items: Array<{ id: string; data: AnyRecord }>;
  const db = await getAdminD1Database();
  if (db) {
    try {
      await ensureAdminD1Schema(db);
      const rows = await readAdminD1Rows(db, `SELECT uid, payload_json, updated_at FROM ${ADMIN_D1_TABLES.rbacAssignments} ORDER BY updated_at DESC`);
      items = rows
        .map((row) => {
          const data = parseAdminPersistedJsonRecord(asString(row.payload_json)) || {};
          return { id: asString(row.uid), data };
        })
        .filter((item) => item.id);
    } catch {
      items = await queryRecords(COLLECTIONS.adminRbacAssignments, {
        sort: (left, right) => asString(right.data.updatedAt).localeCompare(asString(left.data.updatedAt)),
      });
    }
  } else {
    items = await queryRecords(COLLECTIONS.adminRbacAssignments, {
      sort: (left, right) => asString(right.data.updatedAt).localeCompare(asString(left.data.updatedAt)),
    });
  }
  const filtered = items
    .map((row) => ({
      uid: row.id,
      userId: asString(row.data.userId) || undefined,
      role: asString(row.data.role) || 'viewer',
      allowOverrides: Array.isArray(row.data.allowOverrides) ? row.data.allowOverrides : [],
      denyOverrides: Array.isArray(row.data.denyOverrides) ? row.data.denyOverrides : [],
      status: asString(row.data.status) || 'active',
      version: asPositiveInt(row.data.version, 1),
      updatedAt: asString(row.data.updatedAt) || undefined,
      updatedBy: asString(row.data.updatedBy) || undefined,
    }))
    .filter((item) => !q || [item.uid, item.userId, item.role].map((value) => asLower(value)).join(' ').includes(q))
    .slice(0, limit);
  return json({ ok: true, items: filtered, count: filtered.length, nextCursor: null });
};

const actorHandler = async (request: NextRequest): Promise<Response> => {
  const context = await resolveAdminContext(request);
  return json({ ok: true, actor: context.actor });
};

const upsertRbacAssignment = async (request: NextRequest, uid: string): Promise<Response> => {
  const context = await requirePermission(request, 'rbac.write');
  await requireUnlockForMutation(request, context);
  const input = await readJsonBody(request);
  const db = await getAdminD1Database();
  let existing: AnyRecord | null = null;
  if (db) {
    try {
      await ensureAdminD1Schema(db);
      existing = await readAdminD1Record(db, ADMIN_D1_TABLES.rbacAssignments, 'uid', uid) as AnyRecord | null;
    } catch {
      existing = await readRecord(COLLECTIONS.adminRbacAssignments, uid);
    }
  } else {
    existing = await readRecord(COLLECTIONS.adminRbacAssignments, uid);
  }
  const targetRole = asString(input.role) || 'viewer';
  const targetStatus = asString(input.status) || 'active';
  if (uid === context.uid && targetRole !== asString(context.actor.role)) httpError(409, 'rbac_self_demote_forbidden');
  if (existing && asString(existing.role) === 'super_admin' && targetRole !== 'super_admin' && (await countActiveSuperAdmins()) <= 1) {
    httpError(409, 'rbac_last_super_admin_forbidden');
  }
  const userData = await readRecord(COLLECTIONS.users, uid);
  const assignment = await writeRecord(COLLECTIONS.adminRbacAssignments, uid, {
    uid,
    userId: asString(userData?.userId) || undefined,
    role: targetRole,
    allowOverrides: Array.isArray(input.allowOverrides) ? input.allowOverrides : [],
    denyOverrides: Array.isArray(input.denyOverrides) ? input.denyOverrides : [],
    status: targetStatus,
    version: asPositiveInt(existing?.version, 0) + 1,
    updatedAt: nowIso(),
    updatedBy: context.uid,
  }, true);
  if (db) {
    try {
      await writeAdminD1Record(db, ADMIN_D1_TABLES.rbacAssignments, 'uid', uid, assignment, asString(assignment.updatedAt));
    } catch {
      // D1 write is best-effort
    }
  }
  const actor = {
    uid,
    userId: asString(userData?.userId) || undefined,
    role: asString(assignment.role) || 'viewer',
    status: asString(assignment.status) || 'active',
    permissions: resolveActorPermissions(assignment),
    source: 'rbac_assignment',
    allowOverrides: Array.isArray(assignment.allowOverrides) ? assignment.allowOverrides : [],
    denyOverrides: Array.isArray(assignment.denyOverrides) ? assignment.denyOverrides : [],
  };
  await persistUserActorMirror(uid, actor);
  await recordAuditEvent(context, { action: 'admin.rbac.assign', resourceType: 'admin_actor', resourceId: uid, subjectUid: uid, before: existing || undefined, after: assignment });
  return json({ assignment });
};

const disableRbacUser = async (request: NextRequest, uid: string): Promise<Response> => {
  const context = await requirePermission(request, 'rbac.write');
  await requireUnlockForMutation(request, context);
  const db = await getAdminD1Database();
  let existing: AnyRecord | null = null;
  if (db) {
    try {
      await ensureAdminD1Schema(db);
      existing = await readAdminD1Record(db, ADMIN_D1_TABLES.rbacAssignments, 'uid', uid) as AnyRecord | null;
    } catch {
      existing = await readRecord(COLLECTIONS.adminRbacAssignments, uid);
    }
  } else {
    existing = await readRecord(COLLECTIONS.adminRbacAssignments, uid);
  }
  if (uid === context.uid) httpError(409, 'rbac_self_disable_forbidden');
  if (asString(existing?.role) === 'super_admin' && asLower(existing?.status) !== 'disabled' && (await countActiveSuperAdmins()) <= 1) {
    httpError(409, 'rbac_last_super_admin_forbidden');
  }
  const now = nowIso();
  const assignment = await writeRecord(COLLECTIONS.adminRbacAssignments, uid, { status: 'disabled', updatedAt: now, updatedBy: context.uid }, true);
  if (db) {
    try {
      await writeAdminD1Record(db, ADMIN_D1_TABLES.rbacAssignments, 'uid', uid, { ...existing, status: 'disabled', updatedAt: now, updatedBy: context.uid }, now);
    } catch {
      // D1 write is best-effort
    }
  }
  const actor = {
    uid,
    userId: asString(existing?.userId) || undefined,
    role: asString(assignment.role) || 'viewer',
    status: 'disabled',
    permissions: resolveActorPermissions(assignment),
    source: 'rbac_assignment',
    allowOverrides: Array.isArray(assignment.allowOverrides) ? assignment.allowOverrides : [],
    denyOverrides: Array.isArray(assignment.denyOverrides) ? assignment.denyOverrides : [],
  };
  await persistUserActorMirror(uid, actor);
  await recordAuditEvent(context, { action: 'admin.rbac.disable', resourceType: 'admin_actor', resourceId: uid, subjectUid: uid, before: existing || undefined, after: assignment });
  return json({ assignment });
};

const enableRbacUser = async (request: NextRequest, uid: string): Promise<Response> => {
  const context = await requirePermission(request, 'rbac.write');
  await requireUnlockForMutation(request, context);
  const db = await getAdminD1Database();
  let existing: AnyRecord | null = null;
  if (db) {
    try {
      await ensureAdminD1Schema(db);
      existing = await readAdminD1Record(db, ADMIN_D1_TABLES.rbacAssignments, 'uid', uid) as AnyRecord | null;
    } catch {
      existing = await readRecord(COLLECTIONS.adminRbacAssignments, uid);
    }
  } else {
    existing = await readRecord(COLLECTIONS.adminRbacAssignments, uid);
  }
  const now = nowIso();
  const assignment = await writeRecord(COLLECTIONS.adminRbacAssignments, uid, { status: 'active', updatedAt: now, updatedBy: context.uid }, true);
  if (db) {
    try {
      await writeAdminD1Record(db, ADMIN_D1_TABLES.rbacAssignments, 'uid', uid, { ...(existing || {}), status: 'active', updatedAt: now, updatedBy: context.uid }, now);
    } catch {
      // D1 write is best-effort
    }
  }
  const actor = {
    uid,
    userId: asString(existing?.userId) || undefined,
    role: asString(assignment.role) || 'viewer',
    status: 'active',
    permissions: resolveActorPermissions(assignment),
    source: 'rbac_assignment',
    allowOverrides: Array.isArray(assignment.allowOverrides) ? assignment.allowOverrides : [],
    denyOverrides: Array.isArray(assignment.denyOverrides) ? assignment.denyOverrides : [],
  };
  await persistUserActorMirror(uid, actor);
  await recordAuditEvent(context, { action: 'admin.rbac.enable', resourceType: 'admin_actor', resourceId: uid, subjectUid: uid, before: existing || undefined, after: assignment });
  return json({ assignment });
};

const listAuditEventsHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'audit.read');
  const limit = getQueryInt(request, 'limit', 200);
  const queryTokens = {
    actorUid: asString(request.nextUrl.searchParams.get('actorUid')),
    actorUserId: asString(request.nextUrl.searchParams.get('actorUserId')),
    subjectUid: asString(request.nextUrl.searchParams.get('subjectUid')),
    subjectUserId: asString(request.nextUrl.searchParams.get('subjectUserId')),
    action: asString(request.nextUrl.searchParams.get('action')),
    resourceType: asString(request.nextUrl.searchParams.get('resourceType')),
  };
  let items: Array<{ id: string; data: AnyRecord }>;
  const db = await getAdminD1Database();
  if (db) {
    try {
      await ensureAdminD1Schema(db);
      // Build SQL WHERE clauses from indexed columns
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (queryTokens.actorUid) { conditions.push('actor_uid = ?'); params.push(queryTokens.actorUid); }
      if (queryTokens.subjectUid) { conditions.push('subject_uid = ?'); params.push(queryTokens.subjectUid); }
      if (queryTokens.action) { conditions.push('action = ?'); params.push(queryTokens.action); }
      if (queryTokens.resourceType) { conditions.push('resource_type = ?'); params.push(queryTokens.resourceType); }
      const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
      const rows = await readAdminD1Rows(db,
        `SELECT event_id, payload_json FROM ${ADMIN_D1_TABLES.auditEvents}${whereClause} ORDER BY sequence DESC LIMIT ?`,
        ...params, limit * 2, // Read extra for post-filtering
      );
      let filtered = rows
        .map((row) => {
          const data = parseAdminPersistedJsonRecord(asString(row.payload_json)) || {};
          return { id: asString(row.event_id) || asString(data.eventId), data };
        })
        .filter((item) => item.id);
      // Apply in-memory filters for fields not indexed in D1
      if (queryTokens.actorUserId) {
        filtered = filtered.filter((item) => asString(item.data.actorUserId) === queryTokens.actorUserId);
      }
      if (queryTokens.subjectUserId) {
        filtered = filtered.filter((item) => asString(item.data.subjectUserId) === queryTokens.subjectUserId);
      }
      items = filtered.slice(0, limit);
    } catch {
      items = await queryRecords(COLLECTIONS.adminAuditEvents, {
        filter: (row) => (
          (!queryTokens.actorUid || asString(row.data.actorUid) === queryTokens.actorUid)
          && (!queryTokens.actorUserId || asString(row.data.actorUserId) === queryTokens.actorUserId)
          && (!queryTokens.subjectUid || asString(row.data.subjectUid) === queryTokens.subjectUid)
          && (!queryTokens.subjectUserId || asString(row.data.subjectUserId) === queryTokens.subjectUserId)
          && (!queryTokens.action || asString(row.data.action) === queryTokens.action)
          && (!queryTokens.resourceType || asString(row.data.resourceType) === queryTokens.resourceType)
        ),
        sort: (left, right) => asPositiveInt(right.data.sequence) - asPositiveInt(left.data.sequence),
        limit,
      });
    }
  } else {
    items = await queryRecords(COLLECTIONS.adminAuditEvents, {
      filter: (row) => (
        (!queryTokens.actorUid || asString(row.data.actorUid) === queryTokens.actorUid)
        && (!queryTokens.actorUserId || asString(row.data.actorUserId) === queryTokens.actorUserId)
        && (!queryTokens.subjectUid || asString(row.data.subjectUid) === queryTokens.subjectUid)
        && (!queryTokens.subjectUserId || asString(row.data.subjectUserId) === queryTokens.subjectUserId)
        && (!queryTokens.action || asString(row.data.action) === queryTokens.action)
        && (!queryTokens.resourceType || asString(row.data.resourceType) === queryTokens.resourceType)
      ),
      sort: (left, right) => asPositiveInt(right.data.sequence) - asPositiveInt(left.data.sequence),
      limit,
    });
  }
  return json({ ok: true, items: items.map((row) => row.data), count: items.length, nextCursor: null });
};

const getAuditEventByIdHandler = async (request: NextRequest, eventId: string): Promise<Response> => {
  await requirePermission(request, 'audit.read');
  const db = await getAdminD1Database();
  let event: AnyRecord | null = null;
  if (db) {
    try {
      await ensureAdminD1Schema(db);
      event = await readAdminD1Record(db, ADMIN_D1_TABLES.auditEvents, 'event_id', eventId) as AnyRecord | null;
    } catch {
      event = await readRecord(COLLECTIONS.adminAuditEvents, eventId);
    }
  } else {
    event = await readRecord(COLLECTIONS.adminAuditEvents, eventId);
  }
  if (!event) httpError(404, 'Audit event not found.');
  return json({ event });
};

const listAudioMetadataHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'audit.read');
  const filters = Object.fromEntries(request.nextUrl.searchParams.entries());
  const limit = getQueryInt(request, 'limit', 100);
  const items = await queryRecords(COLLECTIONS.audioMetadataRecords, {
    filter: (row) => Object.entries(filters).every(([key, value]) => {
      if (key === 'limit' || key === 'cursor') return true;
      return !value || asString(row.data[key]) === asString(value);
    }),
    sort: (left, right) => asString(right.data.submittedAt || right.data.createdAt).localeCompare(asString(left.data.submittedAt || left.data.createdAt)),
    limit,
  });
  return json({ ok: true, items: items.map((row) => ({ auditId: row.id, ...row.data })), count: items.length, nextCursor: null });
};

const getAudioMetadataByIdHandler = async (request: NextRequest, auditId: string): Promise<Response> => {
  await requirePermission(request, 'audit.read');
  const record = await readRecord(COLLECTIONS.audioMetadataRecords, auditId);
  if (!record) httpError(404, 'Audio metadata record not found.');
  return json({ record: { auditId, ...record } });
};

const exportAudioMetadataCsvHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'audit.read');
  const response = await listAudioMetadataHandler(request);
  const payload = await response.json().catch(() => ({ items: [] }));
  const items = Array.isArray((payload as AnyRecord).items) ? (payload as AnyRecord).items as AnyRecord[] : [];
  const headers = ['auditId', 'uid', 'userId', 'status', 'engine', 'submittedAt', 'outputSha256', 'watermarkId', 'c2paStatus', 'paymentRef'];
  const rows = [headers.join(','), ...items.map((item) => headers.map((header) => JSON.stringify(asString(item[header]))).join(','))];
  return text(rows.join('\n'), 200, 'text/csv; charset=utf-8');
};

const listAlertsHandler = async (request: NextRequest, collection: string): Promise<Response> => {
  await requirePermission(request, 'alerts.read');
  const limit = getQueryInt(request, 'limit', 200);
  const status = asString(request.nextUrl.searchParams.get('status'));
  const items = await queryRecords(collection, {
    filter: (row) => !status || asString(row.data.status) === status,
    sort: (left, right) => asString(right.data.updatedAt || right.data.createdAt || right.data.openedAt).localeCompare(asString(left.data.updatedAt || left.data.createdAt || left.data.openedAt)),
    limit,
  });
  return json({ items: items.map((row) => ({ id: row.id, ...row.data })) });
};

const createAlertPolicyHandler = async (request: NextRequest): Promise<Response> => {
  const context = await requirePermission(request, 'alerts.write');
  await requireUnlockForMutation(request, context);
  const input = await readJsonBody(request);
  const policyId = randomUUID();
  const policy = await writeRecord(COLLECTIONS.adminAlertPolicies, policyId, {
    name: asString(input.name) || `policy-${Date.now()}`,
    metricKey: asString(input.metricKey),
    operator: asString(input.operator) || 'gt',
    threshold: asNumber(input.threshold),
    windowSec: asPositiveInt(input.windowSec, 60),
    cooldownSec: asPositiveInt(input.cooldownSec, 300),
    severity: asString(input.severity) || 'warning',
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    channels: Array.isArray(input.channels) ? input.channels.map((entry) => asString(entry)).filter(Boolean) : ['in_app'],
    createdBy: context.uid,
    updatedBy: context.uid,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }, false);
  await recordAuditEvent(context, { action: 'admin.alerts.policy.create', resourceType: 'alert_policy', resourceId: policyId, after: policy });
  return json({ policy: { id: policyId, ...policy } });
};

const patchAlertPolicyHandler = async (request: NextRequest, policyId: string): Promise<Response> => {
  const context = await requirePermission(request, 'alerts.write');
  await requireUnlockForMutation(request, context);
  const before = await readRecord(COLLECTIONS.adminAlertPolicies, policyId);
  if (!before) httpError(404, 'Alert policy not found.');
  const patch = await readJsonBody(request);
  const policy = await writeRecord(COLLECTIONS.adminAlertPolicies, policyId, { ...patch, updatedBy: context.uid, updatedAt: nowIso() }, true);
  await recordAuditEvent(context, { action: 'admin.alerts.policy.patch', resourceType: 'alert_policy', resourceId: policyId, before, after: policy });
  return json({ policy: { id: policyId, ...policy } });
};

const createAlertDestinationHandler = async (request: NextRequest): Promise<Response> => {
  const context = await requirePermission(request, 'alerts.write');
  await requireUnlockForMutation(request, context);
  const input = await readJsonBody(request);
  const destinationId = randomUUID();
  const destination = await writeRecord(COLLECTIONS.adminAlertDestinations, destinationId, {
    type: asString(input.type) || 'webhook',
    name: asString(input.name) || `dest-${Date.now()}`,
    url: asString(input.url),
    secretRef: asString(input.secretRef) || undefined,
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    createdBy: context.uid,
    updatedBy: context.uid,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }, false);
  await recordAuditEvent(context, { action: 'admin.alerts.destination.create', resourceType: 'alert_destination', resourceId: destinationId, after: destination });
  return json({ destination: { id: destinationId, ...destination } });
};

const patchAlertDestinationHandler = async (request: NextRequest, destinationId: string): Promise<Response> => {
  const context = await requirePermission(request, 'alerts.write');
  await requireUnlockForMutation(request, context);
  const before = await readRecord(COLLECTIONS.adminAlertDestinations, destinationId);
  if (!before) httpError(404, 'Alert destination not found.');
  const patch = await readJsonBody(request);
  const destination = await writeRecord(COLLECTIONS.adminAlertDestinations, destinationId, { ...patch, updatedBy: context.uid, updatedAt: nowIso() }, true);
  await recordAuditEvent(context, { action: 'admin.alerts.destination.patch', resourceType: 'alert_destination', resourceId: destinationId, before, after: destination });
  return json({ destination: { id: destinationId, ...destination } });
};

const patchAlertEventStatusHandler = async (request: NextRequest, eventId: string, status: 'ack' | 'resolved'): Promise<Response> => {
  const context = await requirePermission(request, 'alerts.write');
  await requireUnlockForMutation(request, context);
  const before = await readRecord(COLLECTIONS.adminAlertEvents, eventId);
  if (!before) httpError(404, 'Alert event not found.');
  const input = await readJsonBody(request);
  const patch: AnyRecord = { status, note: asString(input.note) || undefined, updatedAt: nowIso() };
  if (status === 'resolved') patch.resolvedAt = nowIso();
  const event = await writeRecord(COLLECTIONS.adminAlertEvents, eventId, patch, true);
  await recordAuditEvent(context, { action: `admin.alerts.event.${status}`, resourceType: 'alert_event', resourceId: eventId, before, after: event });
  return json({ event: { id: eventId, ...event } });
};

const listSchedulerTasksHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'scheduler.read');
  const limit = getQueryInt(request, 'limit', 200);
  const items = await queryRecords(COLLECTIONS.adminSchedulerTasks, {
    sort: (left, right) => asString(right.data.updatedAt || right.data.createdAt).localeCompare(asString(left.data.updatedAt || left.data.createdAt)),
    limit,
  });
  return json({ items: items.map((row) => ({ id: row.id, ...row.data })) });
};

const createSchedulerTaskHandler = async (request: NextRequest): Promise<Response> => {
  const context = await requirePermission(request, 'scheduler.write');
  await requireUnlockForMutation(request, context);
  const input = await readJsonBody(request);
  const taskId = randomUUID();
  const task = await writeRecord(COLLECTIONS.adminSchedulerTasks, taskId, {
    taskType: asString(input.taskType) || 'usage_reset_daily',
    cronExpr: asString(input.cronExpr) || '0 0 * * *',
    timezone: asString(input.timezone) || 'UTC',
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    dryRun: Boolean(input.dryRun),
    payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
    concurrencyPolicy: asString(input.concurrencyPolicy) || 'forbid',
    nextRunAt: asString(input.nextRunAt) || undefined,
    lastRunAt: null,
    lastResult: null,
    updatedBy: context.uid,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }, false);
  await recordAuditEvent(context, { action: 'admin.scheduler.task.create', resourceType: 'scheduler_task', resourceId: taskId, after: task });
  return json({ task: { id: taskId, ...task } });
};

const patchSchedulerTaskHandler = async (request: NextRequest, taskId: string): Promise<Response> => {
  const context = await requirePermission(request, 'scheduler.write');
  await requireUnlockForMutation(request, context);
  const before = await readRecord(COLLECTIONS.adminSchedulerTasks, taskId);
  if (!before) httpError(404, 'Scheduler task not found.');
  const patch = await readJsonBody(request);
  const task = await writeRecord(COLLECTIONS.adminSchedulerTasks, taskId, { ...patch, updatedBy: context.uid, updatedAt: nowIso() }, true);
  await recordAuditEvent(context, { action: 'admin.scheduler.task.patch', resourceType: 'scheduler_task', resourceId: taskId, before, after: task });
  return json({ task: { id: taskId, ...task } });
};

const runSchedulerTaskHandler = async (request: NextRequest, taskId: string): Promise<Response> => {
  const context = await requirePermission(request, 'scheduler.write');
  await requireUnlockForMutation(request, context);
  const task = await readRecord(COLLECTIONS.adminSchedulerTasks, taskId);
  if (!task) httpError(404, 'Scheduler task not found.');
  const input = await readJsonBody(request);
  const runId = randomUUID();
  const run = await writeRecord(COLLECTIONS.adminSchedulerRuns, runId, {
    taskId,
    taskType: asString(task.taskType),
    scheduledAt: nowIso(),
    startedAt: nowIso(),
    finishedAt: nowIso(),
    status: 'accepted',
    result: { ok: true, dryRun: Boolean(input.dryRun) },
    dryRun: Boolean(input.dryRun),
    requestedBy: context.uid,
  }, false);
  await writeRecord(COLLECTIONS.adminSchedulerTasks, taskId, { lastRunAt: asString(run.startedAt), lastResult: run.result, updatedAt: nowIso() }, true);
  await recordAuditEvent(context, { action: 'admin.scheduler.task.run', resourceType: 'scheduler_task', resourceId: taskId, after: run });
  return json({ run: { id: runId, ...run } });
};

const listSchedulerRunsHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'scheduler.read');
  const taskId = asString(request.nextUrl.searchParams.get('taskId'));
  const limit = getQueryInt(request, 'limit', 200);
  const items = await queryRecords(COLLECTIONS.adminSchedulerRuns, {
    filter: (row) => !taskId || asString(row.data.taskId) === taskId,
    sort: (left, right) => asString(right.data.startedAt).localeCompare(asString(left.data.startedAt)),
    limit,
  });
  return json({ items: items.map((row) => ({ id: row.id, ...row.data })) });
};

const getSchedulerRunByIdHandler = async (request: NextRequest, runId: string): Promise<Response> => {
  await requirePermission(request, 'scheduler.read');
  const run = await readRecord(COLLECTIONS.adminSchedulerRuns, runId);
  if (!run) httpError(404, 'Scheduler run not found.');
  return json({ run: { id: runId, ...run } });
};

const buildZeroCouponAnalyticsSummary = (): AnyRecord => ({
  checkoutsStarted: 0,
  checkoutsCompleted: 0,
  subscriptionsActivated: 0,
  cancellationsWithin30d: 0,
  grossAmount: 0,
  discountAmount: 0,
  netAmount: 0,
  conversionRate: 0,
  checkoutCompletionRate: 0,
  d30ChurnRate: 0,
  discountEfficiency: 0,
});

const buildCouponAnalyticsSummary = (items: Array<{ id: string; data: AnyRecord }>): AnyRecord => {
  const summary = buildZeroCouponAnalyticsSummary();
  for (const item of items) {
    const amount = asPositiveNumber(item.data.amountInr || item.data.amount || item.data.grossAmount);
    const discount = asPositiveNumber(item.data.discountAmountInr || item.data.discountAmount);
    const completed = asBoolean(item.data.completed ?? true);
    const activated = asBoolean(item.data.subscriptionActivated ?? completed);
    const cancelled = asBoolean(item.data.cancelledWithin30d);
    summary.checkoutsStarted += 1;
    summary.checkoutsCompleted += completed ? 1 : 0;
    summary.subscriptionsActivated += activated ? 1 : 0;
    summary.cancellationsWithin30d += cancelled ? 1 : 0;
    summary.grossAmount += amount;
    summary.discountAmount += discount;
  }
  summary.netAmount = Math.max(0, summary.grossAmount - summary.discountAmount);
  summary.conversionRate = summary.checkoutsStarted > 0 ? summary.subscriptionsActivated / summary.checkoutsStarted : 0;
  summary.checkoutCompletionRate = summary.checkoutsStarted > 0 ? summary.checkoutsCompleted / summary.checkoutsStarted : 0;
  summary.d30ChurnRate = summary.subscriptionsActivated > 0 ? summary.cancellationsWithin30d / summary.subscriptionsActivated : 0;
  summary.discountEfficiency = summary.grossAmount > 0 ? summary.discountAmount / summary.grossAmount : 0;
  return summary;
};

const readCouponAnalyticsItems = async (request: NextRequest): Promise<Array<{ id: string; data: AnyRecord }>> => {
  await requirePermission(request, 'analytics.read');
  const from = asString(request.nextUrl.searchParams.get('from'));
  const to = asString(request.nextUrl.searchParams.get('to'));
  const plan = asString(request.nextUrl.searchParams.get('plan'));
  const couponKind = asString(request.nextUrl.searchParams.get('couponKind'));
  return queryRecords(COLLECTIONS.couponRedemptions, {
    filter: (row) => {
      const ts = asString(row.data.createdAt || row.data.redeemedAt || row.data.timestamp);
      const rowPlan = normalizePlanName(row.data.plan);
      const rowKind = asString(row.data.couponKind || row.data.couponType || row.data.kind);
      if (from && ts && ts < from) return false;
      if (to && ts && ts > `${to}T23:59:59.999Z`) return false;
      if (plan && rowPlan !== normalizePlanName(plan)) return false;
      if (couponKind && rowKind !== couponKind) return false;
      return true;
    },
  });
};

const couponAnalyticsSummaryHandler = async (request: NextRequest): Promise<Response> => {
  const items = await readCouponAnalyticsItems(request);
  return json({ summary: buildCouponAnalyticsSummary(items), count: items.length });
};

const couponAnalyticsTimeseriesHandler = async (request: NextRequest): Promise<Response> => {
  const items = await readCouponAnalyticsItems(request);
  const groupBy = asString(request.nextUrl.searchParams.get('groupBy')) || 'day';
  const buckets = new Map<string, Array<{ id: string; data: AnyRecord }>>();
  for (const item of items) {
    const ts = asString(item.data.createdAt || item.data.redeemedAt || item.data.timestamp) || nowIso();
    const bucket = groupBy === 'week' ? ts.slice(0, 10) : ts.slice(0, 10);
    buckets.set(bucket, [...(buckets.get(bucket) || []), item]);
  }
  const series = Array.from(buckets.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bucket, bucketItems]) => ({ bucket, ...buildCouponAnalyticsSummary(bucketItems) }));
  return json({ groupBy, series, count: series.length });
};

const couponAnalyticsImpactHandler = async (request: NextRequest, couponCode: string): Promise<Response> => {
  const items = (await readCouponAnalyticsItems(request))
    .filter((row) => asUpper(row.data.code || row.data.couponCode) === asUpper(couponCode));
  const byPlanMap = new Map<string, Array<{ id: string; data: AnyRecord }>>();
  for (const item of items) {
    const plan = normalizePlanName(item.data.plan);
    byPlanMap.set(plan, [...(byPlanMap.get(plan) || []), item]);
  }
  const byPlan = Array.from(byPlanMap.entries()).map(([plan, planItems]) => ({ plan, ...buildCouponAnalyticsSummary(planItems) }));
  return json({ couponCode: asUpper(couponCode), overall: buildCouponAnalyticsSummary(items), byPlan });
};

const readAccountingRecords = async (request: NextRequest): Promise<Array<{ id: string; data: AnyRecord }>> => {
  await requirePermission(request, 'billing.read');
  const from = asString(request.nextUrl.searchParams.get('from'));
  const to = asString(request.nextUrl.searchParams.get('to'));
  return queryRecords(COLLECTIONS.adminAccountingRecords, {
    filter: (row) => {
      const ts = asString(row.data.timestamp || row.data.createdAt);
      if (from && ts && ts < from) return false;
      if (to && ts && ts > `${to}T23:59:59.999Z`) return false;
      return true;
    },
    sort: (left, right) => asString(right.data.timestamp || right.data.createdAt).localeCompare(asString(left.data.timestamp || left.data.createdAt)),
    limit: getQueryInt(request, 'limit', 250),
  });
};

const buildAccountingSummary = (records: Array<{ id: string; data: AnyRecord }>): AnyRecord => {
  const summary: AnyRecord = {
    revenue: { paidInr: 0, accruedInr: 0, unpaidInr: 0, taxInr: 0 },
    expenditure: { walletInr: 0, couponDiscountInr: 0, cloudRunCpuInr: 0, geminiInr: 0, totalInr: 0 },
    marginInr: 0,
    marginPct: 0,
    invoices: { paid: 0, unpaid: 0, total: 0 },
    gemini: { generations: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostInr: 0, fallbackEstimatedCount: 0 },
    cloudRun: { cpuCostInr: 0 },
  };
  for (const row of records) {
    const type = asLower(row.data.type);
    const paidInr = asPositiveNumber(row.data.paidInr || row.data.amountInr);
    const unpaidInr = asPositiveNumber(row.data.unpaidInr);
    const taxInr = asPositiveNumber(row.data.taxInr);
    const amountInr = asPositiveNumber(row.data.amountInr || paidInr || unpaidInr);
    if (type.includes('invoice') || type.includes('revenue')) {
      summary.revenue.paidInr += paidInr;
      summary.revenue.accruedInr += amountInr;
      summary.revenue.unpaidInr += unpaidInr;
      summary.revenue.taxInr += taxInr;
      summary.invoices.total += 1;
      summary.invoices.paid += paidInr > 0 ? 1 : 0;
      summary.invoices.unpaid += unpaidInr > 0 ? 1 : 0;
    } else if (type.includes('wallet')) {
      summary.expenditure.walletInr += amountInr;
    } else if (type.includes('coupon')) {
      summary.expenditure.couponDiscountInr += amountInr;
    } else if (type.includes('cloudrun') || type.includes('cloud_run')) {
      summary.expenditure.cloudRunCpuInr += amountInr;
      summary.cloudRun.cpuCostInr += amountInr;
    } else if (type.includes('gemini')) {
      summary.expenditure.geminiInr += amountInr;
      summary.gemini.estimatedCostInr += amountInr;
      summary.gemini.generations += asPositiveInt(row.data.generations, 1);
      summary.gemini.promptTokens += asPositiveInt(row.data.promptTokens);
      summary.gemini.outputTokens += asPositiveInt(row.data.outputTokens);
    }
  }
  summary.expenditure.totalInr = summary.expenditure.walletInr + summary.expenditure.couponDiscountInr + summary.expenditure.cloudRunCpuInr + summary.expenditure.geminiInr;
  summary.gemini.totalTokens = summary.gemini.promptTokens + summary.gemini.outputTokens;
  summary.marginInr = summary.revenue.paidInr - summary.expenditure.totalInr;
  summary.marginPct = summary.revenue.paidInr > 0 ? summary.marginInr / summary.revenue.paidInr : 0;
  return summary;
};

const buildAccountingResponseMeta = (): AnyRecord => ({
  currency: 'INR',
  timezone: 'UTC',
  sourceStatus: { stripeInvoices: 'native', cloudRunCpu: 'native', usageEvents: 'native' },
  warnings: [],
});

const accountingSummaryHandler = async (request: NextRequest): Promise<Response> => {
  const records = await readAccountingRecords(request);
  return json({ summary: buildAccountingSummary(records), ...buildAccountingResponseMeta(), range: Object.fromEntries(request.nextUrl.searchParams.entries()) });
};

const accountingTimeseriesHandler = async (request: NextRequest): Promise<Response> => {
  const records = await readAccountingRecords(request);
  const groupBy = asString(request.nextUrl.searchParams.get('groupBy')) || 'day';
  const buckets = new Map<string, Array<{ id: string; data: AnyRecord }>>();
  for (const record of records) {
    const ts = asString(record.data.timestamp || record.data.createdAt) || nowIso();
    const bucket = groupBy === 'month' ? ts.slice(0, 7) : groupBy === 'year' ? ts.slice(0, 4) : ts.slice(0, 10);
    buckets.set(bucket, [...(buckets.get(bucket) || []), record]);
  }
  const series = Array.from(buckets.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bucket, bucketRecords]) => {
      const summary = buildAccountingSummary(bucketRecords);
      return {
        bucket,
        revenuePaidInr: summary.revenue.paidInr,
        revenueAccruedInr: summary.revenue.accruedInr,
        revenueUnpaidInr: summary.revenue.unpaidInr,
        taxAccruedInr: summary.revenue.taxInr,
        walletExpenditureInr: summary.expenditure.walletInr,
        couponDiscountInr: summary.expenditure.couponDiscountInr,
        cloudRunCpuCostInr: summary.expenditure.cloudRunCpuInr,
        geminiCostInr: summary.expenditure.geminiInr,
        geminiGenerations: summary.gemini.generations,
        geminiPromptTokens: summary.gemini.promptTokens,
        geminiOutputTokens: summary.gemini.outputTokens,
        geminiTotalTokens: summary.gemini.totalTokens,
      };
    });
  return json({ groupBy, series, count: series.length, ...buildAccountingResponseMeta(), range: Object.fromEntries(request.nextUrl.searchParams.entries()) });
};

const accountingRecordsHandler = async (request: NextRequest): Promise<Response> => {
  const records = await readAccountingRecords(request);
  return json({ items: records.map((row) => ({ id: row.id, ...row.data })), count: records.length, ...buildAccountingResponseMeta(), range: Object.fromEntries(request.nextUrl.searchParams.entries()) });
};

const accountingMonitorRunsHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'billing.read');
  const limit = getQueryInt(request, 'limit', 40);
  const items = await queryRecords(COLLECTIONS.adminAccountingMonitorRuns, {
    sort: (left, right) => asString(right.data.createdAt || right.data.startedAt).localeCompare(asString(left.data.createdAt || left.data.startedAt)),
    limit,
  });
  return json({ items: items.map((row) => ({ id: row.id, ...row.data })), count: items.length });
};

const runAccountingMonitorHandler = async (request: NextRequest): Promise<Response> => {
  const context = await requirePermission(request, 'billing.write');
  await requireUnlockForMutation(request, context);
  const input = await readJsonBody(request);
  const records = await readAccountingRecords(request);
  const anomalies = records.filter((row) => asLower(row.data.status) === 'failed' || asBoolean(row.data.anomaly)).slice(0, 25).map((row) => ({ id: row.id, type: row.data.type, status: row.data.status, amountInr: row.data.amountInr }));
  const runId = randomUUID();
  const run = await writeRecord(COLLECTIONS.adminAccountingMonitorRuns, runId, {
    createdAt: nowIso(),
    startedAt: nowIso(),
    finishedAt: nowIso(),
    requestedBy: context.uid,
    source: 'native',
    dryRun: Boolean(input.dryRun),
    anomalies,
    alertActions: anomalies.length > 0 ? [{ type: 'flag_anomalies', count: anomalies.length }] : [],
    status: 'completed',
    summary: buildAccountingSummary(records),
  }, false);
  await recordAuditEvent(context, { action: 'admin.accounting.monitor.run', resourceType: 'accounting_monitor_run', resourceId: runId, after: run });
  return json({ runId, anomalyCount: anomalies.length, alertActions: run.alertActions, summary: run.summary });
};

const roundTwo = (value: number): number => Math.round(asNumber(value) * 100) / 100;

const normalizeFinanceProviderSnapshot = (provider: string, data: AnyRecord | null): AnyRecord => {
  const safeProvider = asLower(provider) || 'unknown';
  const series = Array.isArray(data?.series) ? data.series : [];
  const topDrivers = Array.isArray(data?.topDrivers) ? data.topDrivers : [];
  const actualWindows = (data?.actualWindows && typeof data.actualWindows === 'object') ? data.actualWindows as AnyRecord : {};
  return {
    provider: safeProvider,
    displayName: asString(data?.displayName || (safeProvider === 'gcp' ? 'Google Cloud' : safeProvider === 'modal' ? 'Modal' : safeProvider)) || safeProvider,
    source: asString(data?.source || `${safeProvider}_snapshot`) || `${safeProvider}_snapshot`,
    configured: data?.configured !== false,
    supported: data?.supported !== false,
    status: asString(data?.status || 'missing') || 'missing',
    stale: asBoolean(data?.stale),
    currency: asString(data?.currency || 'INR') || 'INR',
    actualWindows: {
      todayInr: asPositiveNumber(actualWindows.todayInr),
      last7dInr: asPositiveNumber(actualWindows.last7dInr),
      monthInr: asPositiveNumber(actualWindows.monthInr),
      trailing30dInr: asPositiveNumber(actualWindows.trailing30dInr),
    },
    series: series.map((item) => ({
      bucket: asString((item as AnyRecord)?.bucket),
      actualInr: asPositiveNumber((item as AnyRecord)?.actualInr),
    })).filter((item) => item.bucket),
    topDrivers: topDrivers.map((item) => ({
      label: asString((item as AnyRecord)?.label || 'Unknown'),
      amountInr: asPositiveNumber((item as AnyRecord)?.amountInr),
      ...(asString((item as AnyRecord)?.detail) ? { detail: asString((item as AnyRecord)?.detail) } : {}),
    })),
    providerCoverage: asPositiveNumber(data?.providerCoverage, 0),
    lastAttemptAt: asString(data?.lastAttemptAt) || nowIso(),
    ...(asString(data?.lastSuccessAt) ? { lastSuccessAt: asString(data?.lastSuccessAt) } : {}),
    ...(asString(data?.lastProviderSyncAt) ? { lastProviderSyncAt: asString(data?.lastProviderSyncAt) } : {}),
    ...(asString(data?.detail) ? { detail: asString(data?.detail) } : {}),
  };
};

const listFinanceProviderSnapshots = async (): Promise<AnyRecord[]> => {
  const rows = await queryRecords(COLLECTIONS.adminFinanceProviderSnapshots, {
    sort: (left, right) => asString(left.id).localeCompare(asString(right.id)),
  });
  const byProvider = new Map(rows.map((row) => [asLower(row.id || row.data.provider), row.data]));
  return ['gcp', 'modal'].map((provider) => normalizeFinanceProviderSnapshot(provider, byProvider.get(provider) || null));
};

const saveFinanceProviderSnapshot = async (provider: string, snapshot: AnyRecord): Promise<AnyRecord> => {
  const safeProvider = asLower(provider);
  return writeRecord(COLLECTIONS.adminFinanceProviderSnapshots, safeProvider, {
    ...normalizeFinanceProviderSnapshot(safeProvider, snapshot),
    provider: safeProvider,
    updatedAt: nowIso(),
  }, false);
};

const recordFinanceProviderSyncRun = async (
  provider: string,
  result: AnyRecord,
  context?: AdminContext,
): Promise<AnyRecord> => {
  const runId = `money_sync_${asLower(provider)}_${randomUUID()}`;
  const run = await writeRecord(COLLECTIONS.adminFinanceProviderSyncRuns, runId, {
    runId,
    provider: asLower(provider),
    status: asString(result.status || 'completed') || 'completed',
    detail: asString(result.detail || ''),
    snapshotStatus: asString(result.snapshot?.status || result.status || ''),
    lastProviderSyncAt: asString(result.snapshot?.lastProviderSyncAt || ''),
    createdAt: nowIso(),
    requestedBy: context?.uid,
  }, false);
  return { id: runId, ...run };
};

const normalizeFinanceCashAccount = (accountId: string, data: AnyRecord | null): AnyRecord => {
  const fallback = DEFAULT_FINANCE_CASH_ACCOUNTS.find((item) => item.accountId === accountId);
  return {
    accountId,
    name: asString(data?.name || fallback?.name || accountId) || accountId,
    type: asString(data?.type || fallback?.type || 'manual') || 'manual',
    balanceInr: asNumber(data?.balanceInr ?? fallback?.balanceInr ?? 0),
    editable: data?.editable !== false,
    source: asString(data?.source || fallback?.source || 'manual') || 'manual',
    notes: asString(data?.notes || ''),
    updatedAt: asString(data?.updatedAt || ''),
    updatedBy: asString(data?.updatedBy || ''),
  };
};

const listFinanceCashAccounts = async (): Promise<AnyRecord[]> => {
  const rows = await queryRecords(COLLECTIONS.adminFinanceCashAccounts, {
    sort: (left, right) => asString(left.id).localeCompare(asString(right.id)),
  });
  const byId = new Map(rows.map((row) => [row.id, row.data]));
  return DEFAULT_FINANCE_CASH_ACCOUNTS.map((account) => normalizeFinanceCashAccount(account.accountId, byId.get(account.accountId) || null));
};

const saveFinanceCashAccounts = async (accounts: AnyRecord[], context: AdminContext): Promise<AnyRecord[]> => {
  const saved: AnyRecord[] = [];
  for (const raw of accounts) {
    const accountId = asString(raw?.accountId);
    if (!accountId) continue;
    const payload = normalizeFinanceCashAccount(accountId, {
      ...raw,
      updatedAt: nowIso(),
      updatedBy: context.uid,
      editable: true,
      source: 'manual',
    });
    saved.push(await writeRecord(COLLECTIONS.adminFinanceCashAccounts, accountId, payload, false));
  }
  return saved.map((item) => normalizeFinanceCashAccount(asString(item.accountId), item));
};

const readOutstandingWithdrawalsInr = async (): Promise<number> => {
  const rows = await queryRecords(COLLECTIONS.withdrawals, {
    filter: (row) => ['pending', 'processing'].includes(asLower(row.data.status)),
  });
  return roundTwo(rows.reduce((sum, row) => sum + asPositiveNumber(row.data.inrAmount || row.data.amountInr || (asPositiveNumber(row.data.vnAmount) / 10)), 0));
};

const buildCashSnapshot = async (): Promise<AnyRecord> => {
  const accounts = await listFinanceCashAccounts();
  const outstandingWithdrawalsInr = await readOutstandingWithdrawalsInr();
  const findBalance = (accountId: string): number => asNumber(accounts.find((item) => item.accountId === accountId)?.balanceInr || 0);
  const bankCashInr = findBalance('bank_main');
  const stripeAvailableInr = findBalance('stripe_available');
  const stripePendingInr = findBalance('stripe_pending');
  const walletLiabilityInr = findBalance('wallet_liability');
  const fixedMonthlyBurnInr = findBalance('fixed_monthly_burn');
  const availableCashInr = roundTwo(bankCashInr + stripeAvailableInr);
  const pendingCashInr = roundTwo(stripePendingInr);
  const liabilityInr = roundTwo(walletLiabilityInr + outstandingWithdrawalsInr);
  const netAvailableCashInr = roundTwo(availableCashInr - liabilityInr);
  return {
    generatedAt: nowIso(),
    availableCashInr,
    pendingCashInr,
    liabilityInr,
    outstandingWithdrawalsInr,
    fixedMonthlyBurnInr,
    netAvailableCashInr,
    accounts: [
      ...accounts,
      {
        accountId: 'outstanding_withdrawals',
        name: 'Outstanding Withdrawals',
        type: 'withdrawal_hold',
        balanceInr: outstandingWithdrawalsInr,
        editable: false,
        source: 'derived',
        updatedAt: nowIso(),
      },
    ],
  };
};

const normalizeFinanceBudget = (budgetId: string, data: AnyRecord | null): AnyRecord => {
  const warningPct = Math.max(1, Math.min(99, asPositiveNumber(data?.warningPct, 80)));
  const criticalPct = Math.max(warningPct, Math.min(200, asPositiveNumber(data?.criticalPct, 100)));
  return {
    budgetId,
    name: asString(data?.name || budgetId) || budgetId,
    scopeType: asString(data?.scopeType || 'global') || 'global',
    scopeKey: asString(data?.scopeKey || 'all') || 'all',
    amountInr: asPositiveNumber(data?.amountInr),
    currency: 'INR',
    period: asString(data?.period || 'monthly') || 'monthly',
    warningPct,
    criticalPct,
    status: asString(data?.status || 'ok') || 'ok',
    source: asString(data?.source || 'manual') || 'manual',
    readOnly: asBoolean(data?.readOnly),
    enabled: data?.enabled !== false,
    externalRef: asString(data?.externalRef || '') || undefined,
    safeActions: Array.isArray(data?.safeActions) ? data.safeActions.map((item) => asString(item)).filter(Boolean) : [],
    metadata: (data?.metadata && typeof data.metadata === 'object') ? cloneRecord(data.metadata as AnyRecord) : {},
    updatedAt: asString(data?.updatedAt || ''),
    updatedBy: asString(data?.updatedBy || ''),
  };
};

const listFinanceBudgetRecords = async (): Promise<AnyRecord[]> => {
  const rows = await queryRecords(COLLECTIONS.adminFinanceBudgets, {
    sort: (left, right) => asString(left.data.name || left.id).localeCompare(asString(right.data.name || right.id)),
  });
  return rows.map((row) => normalizeFinanceBudget(row.id, row.data));
};

const saveFinanceBudgetRecord = async (budgetId: string, data: AnyRecord): Promise<AnyRecord> => (
  normalizeFinanceBudget(budgetId, await writeRecord(COLLECTIONS.adminFinanceBudgets, budgetId, data, true))
);

const scopeMatchesBudget = (budget: AnyRecord, provider: string): boolean => {
  const scopeType = asLower(budget.scopeType);
  const scopeKey = asLower(budget.scopeKey);
  if (scopeType === 'provider') return scopeKey === asLower(provider);
  if (scopeType === 'domain') {
    if (scopeKey === 'studio' || scopeKey === 'audio-novel' || scopeKey === 'audio_novel' || scopeKey === 'publishing') {
      return provider === 'gcp';
    }
    if (scopeKey === 'voice-clone' || scopeKey === 'voice_clone' || scopeKey === 'media') {
      return provider === 'modal';
    }
  }
  return false;
};

const resolveBudgetCurrentSpendInr = (
  budget: AnyRecord,
  providers: AnyRecord[],
  monthBurnInr: number,
): number => {
  const scopeType = asLower(budget.scopeType);
  if (scopeType === 'global') return monthBurnInr;
  const providerMatch = providers.find((item) => scopeMatchesBudget(budget, asLower(item.provider)));
  if (!providerMatch) return 0;
  return asPositiveNumber(providerMatch.actualWindows?.monthInr || providerMatch.estimatedWindows?.monthInr);
};

const toRecommendedMoneyActions = (budget: AnyRecord): string[] => {
  const scopeKey = asLower(budget.scopeKey);
  if (scopeKey === 'gcp' || scopeKey === 'studio' || scopeKey === 'audio-novel' || scopeKey === 'audio_novel') {
    return ['enable_tts_soft_shedding', 'enable_runtime_soft_shedding'];
  }
  if (scopeKey === 'modal' || scopeKey === 'voice-clone' || scopeKey === 'voice_clone') {
    return ['disable_voice_clone'];
  }
  if (scopeKey === 'publishing') {
    return ['pause_publishing_generation'];
  }
  return ['enable_runtime_soft_shedding'];
};

const buildRunwaySnapshot = (cashSnapshot: AnyRecord, providerSpendMonthInr: number, trailing30dProviderSpendInr: number): AnyRecord => {
  const fixedMonthlyBurnInr = asPositiveNumber(cashSnapshot.fixedMonthlyBurnInr);
  const monthlyBurnInr = roundTwo(Math.max(providerSpendMonthInr, trailing30dProviderSpendInr) + fixedMonthlyBurnInr);
  const dailyBurnInr = monthlyBurnInr > 0 ? roundTwo(monthlyBurnInr / 30) : 0;
  const availableCashInr = asNumber(cashSnapshot.netAvailableCashInr ?? cashSnapshot.availableCashInr);
  const runwayDays = dailyBurnInr > 0 ? Math.max(0, Math.floor(availableCashInr / dailyBurnInr)) : 0;
  return {
    generatedAt: nowIso(),
    availableCashInr,
    trailing30dProviderSpendInr: roundTwo(trailing30dProviderSpendInr),
    fixedMonthlyBurnInr,
    monthlyBurnInr,
    dailyBurnInr,
    runwayDays,
    status: runwayDays <= 14 ? 'critical' : runwayDays <= 45 ? 'warning' : 'ok',
  };
};

const buildMoneyAnomalies = async (
  providers: AnyRecord[],
  budgets: AnyRecord[],
  cashSnapshot: AnyRecord,
  accountingSummary: AnyRecord,
): Promise<AnyRecord[]> => {
  const anomalies: AnyRecord[] = [];
  const providerSpendMonthInr = roundTwo(providers.reduce((sum, item) => sum + asPositiveNumber(item.actualWindows?.monthInr || item.estimatedWindows?.monthInr), 0));
  const trailing30dProviderSpendInr = roundTwo(providers.reduce((sum, item) => sum + asPositiveNumber(item.actualWindows?.trailing30dInr || item.estimatedWindows?.trailing30dInr), 0));
  const runway = buildRunwaySnapshot(cashSnapshot, providerSpendMonthInr, trailing30dProviderSpendInr);

  for (const provider of providers) {
    const actualMonth = asPositiveNumber(provider.actualWindows?.monthInr);
    const estimatedMonth = asPositiveNumber(provider.estimatedWindows?.monthInr);
    const delta = roundTwo(Math.abs(actualMonth - estimatedMonth));
    if (actualMonth > 0 && delta > Math.max(500, actualMonth * 0.25)) {
      anomalies.push({
        id: `variance_${provider.provider}`,
        type: 'variance',
        severity: delta > actualMonth * 0.5 ? 'critical' : 'warning',
        title: `${asString(provider.displayName)} variance is elevated`,
        detail: 'Actual provider billing has drifted away from internal estimated cost for the current month.',
        metricValue: delta,
        threshold: roundTwo(Math.max(500, actualMonth * 0.25)),
        detectedAt: nowIso(),
        provider: provider.provider,
        source: asString(provider.source),
        recommendedActions: ['enable_runtime_soft_shedding'],
      });
    }
    if (provider.status === 'stale' || provider.status === 'warning' || provider.status === 'missing') {
      anomalies.push({
        id: `provider_sync_${provider.provider}`,
        type: 'provider_sync',
        severity: provider.status === 'missing' ? 'warning' : provider.status === 'warning' ? 'warning' : 'critical',
        title: `${asString(provider.displayName)} billing sync needs attention`,
        detail: asString(provider.detail || 'Provider billing data is stale or unavailable.'),
        detectedAt: nowIso(),
        provider: provider.provider,
        source: asString(provider.source),
        recommendedActions: ['sync_provider_data'],
      });
    }
  }

  const monthBurnInr = roundTwo(providerSpendMonthInr + asPositiveNumber(cashSnapshot.fixedMonthlyBurnInr));
  for (const budget of budgets.filter((item) => item.enabled !== false)) {
    const currentSpendInr = resolveBudgetCurrentSpendInr(budget, providers, monthBurnInr);
    const warningThreshold = roundTwo(asPositiveNumber(budget.amountInr) * (asPositiveNumber(budget.warningPct) / 100));
    const criticalThreshold = roundTwo(asPositiveNumber(budget.amountInr) * (asPositiveNumber(budget.criticalPct) / 100));
    const severity = currentSpendInr >= criticalThreshold
      ? 'critical'
      : currentSpendInr >= warningThreshold
        ? 'warning'
        : '';
    if (!severity) continue;
    anomalies.push({
      id: `budget_${budget.budgetId}`,
      type: 'budget',
      severity,
      title: `${budget.name} is over ${severity === 'critical' ? 'critical' : 'warning'} threshold`,
      detail: `Current spend is INR ${currentSpendInr.toLocaleString()} against a monthly budget of INR ${asPositiveNumber(budget.amountInr).toLocaleString()}.`,
      metricValue: currentSpendInr,
      threshold: severity === 'critical' ? criticalThreshold : warningThreshold,
      detectedAt: nowIso(),
      provider: scopeMatchesBudget(budget, 'gcp') ? 'gcp' : scopeMatchesBudget(budget, 'modal') ? 'modal' : 'global',
      source: asString(budget.source),
      recommendedActions: toRecommendedMoneyActions(budget),
      budgetId: budget.budgetId,
    });
  }

  if (asPositiveNumber(runway.runwayDays) > 0 && asPositiveNumber(runway.runwayDays) <= 30) {
    anomalies.push({
      id: 'runway_shortfall',
      type: 'cash',
      severity: asPositiveNumber(runway.runwayDays) <= 14 ? 'critical' : 'warning',
      title: 'Cash runway is tightening',
      detail: `Projected runway is ${asPositiveNumber(runway.runwayDays)} days at the current burn rate.`,
      metricValue: asPositiveNumber(runway.runwayDays),
      threshold: 30,
      detectedAt: nowIso(),
      source: 'runway_projection',
      recommendedActions: ['enable_runtime_soft_shedding'],
    });
  }

  if (asPositiveNumber(accountingSummary?.marginInr) < 0) {
    anomalies.push({
      id: 'negative_margin',
      type: 'margin',
      severity: 'warning',
      title: 'Current margin is negative',
      detail: 'Paid revenue is trailing expenditure in the current accounting window.',
      metricValue: Math.abs(asPositiveNumber(accountingSummary?.marginInr)),
      detectedAt: nowIso(),
      source: 'accounting',
      recommendedActions: ['enable_runtime_soft_shedding'],
    });
  }

  return anomalies;
};

const syncFinanceProviders = async (provider: string, context: AdminContext): Promise<AnyRecord[]> => {
  const financeProviders = await loadFinanceProvidersModule();
  const targets = provider === 'all' ? ['gcp', 'modal'] : [provider];
  const results: AnyRecord[] = [];
  for (const target of targets) {
    if (target === 'gcp') {
      const payload = await financeProviders.syncGcpProviderSnapshot();
      const snapshot = normalizeFinanceProviderSnapshot('gcp', payload.snapshot as AnyRecord);
      await saveFinanceProviderSnapshot('gcp', snapshot);
      for (const budget of payload.budgets || []) {
        await saveFinanceBudgetRecord(asString(budget.budgetId), {
          ...budget,
          updatedAt: nowIso(),
          updatedBy: context.uid,
        });
      }
      const run = await recordFinanceProviderSyncRun('gcp', { snapshot, status: snapshot.status, detail: snapshot.detail }, context);
      results.push({ provider: 'gcp', snapshot, run });
      continue;
    }
    if (target === 'modal') {
      const payload = await financeProviders.syncModalProviderSnapshot();
      const snapshot = normalizeFinanceProviderSnapshot('modal', payload.snapshot as AnyRecord);
      await saveFinanceProviderSnapshot('modal', snapshot);
      const run = await recordFinanceProviderSyncRun('modal', { snapshot, status: snapshot.status, detail: snapshot.detail }, context);
      results.push({ provider: 'modal', snapshot, run });
    }
  }
  return results;
};

const readIdempotencyKey = (request: Request): string => asString(request.headers.get('x-idempotency-key'));

const buildFinanceIdempotencyReceiptId = (context: AdminContext, action: string, key: string): string => {
  const digest = createHash('sha256')
    .update(`${context.uid}:${action}:${asString(key)}`)
    .digest('hex')
    .slice(0, 40);
  return `finance_receipt_${digest}`;
};

const withFinanceMutationIdempotency = async (
  request: NextRequest,
  context: AdminContext,
  action: string,
  runner: () => Promise<AnyRecord>,
): Promise<{ payload: AnyRecord; replayed: boolean }> => {
  const idempotencyKey = readIdempotencyKey(request);
  if (!idempotencyKey) {
    return { payload: await runner(), replayed: false };
  }
  const receiptId = buildFinanceIdempotencyReceiptId(context, action, idempotencyKey);
  const existing = await readRecord(COLLECTIONS.adminFinanceAdjustments, receiptId);
  if (existing && asString(existing.type) === 'idempotency_receipt') {
    return { payload: cloneRecord(existing.payload as AnyRecord), replayed: true };
  }
  const payload = await runner();
  await writeRecord(COLLECTIONS.adminFinanceAdjustments, receiptId, {
    receiptId,
    type: 'idempotency_receipt',
    action,
    keyHash: createHash('sha256').update(idempotencyKey).digest('hex'),
    payload,
    createdAt: nowIso(),
    updatedBy: context.uid,
  }, false);
  return { payload, replayed: false };
};

const buildEstimatedProviderWindows = (
  daySummary: AnyRecord,
  weekSummary: AnyRecord,
  monthSummary: AnyRecord,
  trailing30Summary: AnyRecord,
): Record<string, AnyRecord> => {
  const buildGcpWindows = (summary: AnyRecord): AnyRecord => ({
    todayInr: 0,
    last7dInr: 0,
    monthInr: 0,
    trailing30dInr: 0,
    ...summary,
  });
  const buildModalWindows = (summary: AnyRecord): AnyRecord => ({
    todayInr: 0,
    last7dInr: 0,
    monthInr: 0,
    trailing30dInr: 0,
    ...summary,
  });
  const gcp = buildGcpWindows({
    todayInr: roundTwo(asPositiveNumber(daySummary?.expenditure?.cloudRunCpuInr) + asPositiveNumber(daySummary?.expenditure?.geminiInr)),
    last7dInr: roundTwo(asPositiveNumber(weekSummary?.expenditure?.cloudRunCpuInr) + asPositiveNumber(weekSummary?.expenditure?.geminiInr)),
    monthInr: roundTwo(asPositiveNumber(monthSummary?.expenditure?.cloudRunCpuInr) + asPositiveNumber(monthSummary?.expenditure?.geminiInr)),
    trailing30dInr: roundTwo(asPositiveNumber(trailing30Summary?.expenditure?.cloudRunCpuInr) + asPositiveNumber(trailing30Summary?.expenditure?.geminiInr)),
  });
  const modal = buildModalWindows({
    todayInr: roundTwo(Math.max(0, asPositiveNumber(daySummary?.expenditure?.totalInr) - gcp.todayInr)),
    last7dInr: roundTwo(Math.max(0, asPositiveNumber(weekSummary?.expenditure?.totalInr) - gcp.last7dInr)),
    monthInr: roundTwo(Math.max(0, asPositiveNumber(monthSummary?.expenditure?.totalInr) - gcp.monthInr)),
    trailing30dInr: roundTwo(Math.max(0, asPositiveNumber(trailing30Summary?.expenditure?.totalInr) - gcp.trailing30dInr)),
  });
  return { gcp, modal };
};

const decorateMoneyProviders = (
  providers: AnyRecord[],
  estimatedByProvider: Record<string, AnyRecord>,
): AnyRecord[] => providers.map((provider) => {
  const estimatedWindows = estimatedByProvider[asLower(provider.provider)] || {
    todayInr: 0,
    last7dInr: 0,
    monthInr: 0,
    trailing30dInr: 0,
  };
  const actualMonth = asPositiveNumber(provider.actualWindows?.monthInr);
  const estimatedMonth = asPositiveNumber(estimatedWindows.monthInr);
  return {
    ...provider,
    estimatedWindows,
    estimatedVsActualDelta: roundTwo(actualMonth - estimatedMonth),
    lastProviderSyncAt: asString(provider.lastProviderSyncAt || provider.lastSuccessAt || provider.lastAttemptAt) || undefined,
    source: asString(provider.source || `${asLower(provider.provider)}_snapshot`) || `${asLower(provider.provider)}_snapshot`,
  };
});

const buildBudgetView = (
  budgets: AnyRecord[],
  providers: AnyRecord[],
  cashSnapshot: AnyRecord,
): AnyRecord => {
  const providerSpendMonthInr = roundTwo(providers.reduce((sum, item) => sum + asPositiveNumber(item.actualWindows?.monthInr || item.estimatedWindows?.monthInr), 0));
  const monthBurnInr = roundTwo(providerSpendMonthInr + asPositiveNumber(cashSnapshot.fixedMonthlyBurnInr));
  const items = budgets.map((budget) => {
    const currentSpendInr = resolveBudgetCurrentSpendInr(budget, providers, monthBurnInr);
    const amountInr = asPositiveNumber(budget.amountInr);
    const warningThresholdInr = roundTwo(amountInr * (asPositiveNumber(budget.warningPct) / 100));
    const criticalThresholdInr = roundTwo(amountInr * (asPositiveNumber(budget.criticalPct) / 100));
    const riskState = !amountInr
      ? 'inactive'
      : currentSpendInr >= criticalThresholdInr
        ? 'critical'
        : currentSpendInr >= warningThresholdInr
          ? 'warning'
          : 'ok';
    return {
      ...budget,
      amountInr,
      currentSpendInr,
      remainingInr: roundTwo(Math.max(0, amountInr - currentSpendInr)),
      warningThresholdInr,
      criticalThresholdInr,
      riskState,
      recommendedActions: Array.isArray(budget.safeActions) && budget.safeActions.length > 0
        ? budget.safeActions
        : toRecommendedMoneyActions(budget),
    };
  });
  const criticalCount = items.filter((item) => item.riskState === 'critical').length;
  const warningCount = items.filter((item) => item.riskState === 'warning').length;
  return {
    items,
    riskState: criticalCount > 0 ? 'critical' : warningCount > 0 ? 'warning' : 'ok',
    warningCount,
    criticalCount,
    totalBudgetInr: roundTwo(items.reduce((sum, item) => sum + asPositiveNumber(item.amountInr), 0)),
  };
};

const listTeamsHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'teams.read');
  const q = asLower(request.nextUrl.searchParams.get('q'));
  const limit = getQueryInt(request, 'limit', 100);
  const items = await queryRecords(COLLECTIONS.adminTeams, {
    filter: (row) => !q || asLower(row.data.name).includes(q) || asLower(row.data.slug).includes(q),
    sort: (left, right) => asString(right.data.updatedAt || right.data.createdAt).localeCompare(asString(left.data.updatedAt || left.data.createdAt)),
    limit,
  });
  return json({ items: items.map((row) => ({ teamId: row.id, ...row.data })) });
};

const createTeamHandler = async (request: NextRequest): Promise<Response> => {
  const context = await requirePermission(request, 'teams.write');
  await requireUnlockForMutation(request, context);
  const input = await readJsonBody(request);
  const teamId = randomUUID();
  const team = await writeRecord(COLLECTIONS.adminTeams, teamId, {
    name: asString(input.name) || `Team ${teamId.slice(0, 6)}`,
    slug: asLower(input.slug) || `team-${teamId.slice(0, 8)}`,
    ownerUid: asString(input.ownerUid),
    ownerUserId: asString(input.ownerUserId) || undefined,
    seatLimit: Math.max(1, asPositiveInt(input.seatLimit, 5)),
    status: asString(input.status) || 'active',
    memberCount: 0,
    activeMembers: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }, false);
  await recordAuditEvent(context, { action: 'admin.teams.create', resourceType: 'team', resourceId: teamId, after: team });
  return json({ team: { teamId, ...team } });
};

const patchTeamHandler = async (request: NextRequest, teamId: string): Promise<Response> => {
  const context = await requirePermission(request, 'teams.write');
  await requireUnlockForMutation(request, context);
  const before = await readRecord(COLLECTIONS.adminTeams, teamId);
  if (!before) httpError(404, 'Team not found.');
  const patch = await readJsonBody(request);
  const team = await writeRecord(COLLECTIONS.adminTeams, teamId, { ...patch, updatedAt: nowIso() }, true);
  await recordAuditEvent(context, { action: 'admin.teams.patch', resourceType: 'team', resourceId: teamId, before, after: team });
  return json({ team: { teamId, ...team } });
};

const listTeamMembersHandler = async (request: NextRequest, teamId: string): Promise<Response> => {
  await requirePermission(request, 'teams.read');
  const limit = getQueryInt(request, 'limit', 500);
  const items = await queryRecords(COLLECTIONS.adminTeamMembers, {
    filter: (row) => asString(row.data.teamId) === teamId,
    sort: (left, right) => asString(left.data.uid).localeCompare(asString(right.data.uid)),
    limit,
  });
  return json({ items: items.map((row) => ({ id: row.id, ...row.data })) });
};

const updateTeamMemberCounts = async (teamId: string): Promise<void> => {
  const members = await queryRecords(COLLECTIONS.adminTeamMembers, { filter: (row) => asString(row.data.teamId) === teamId });
  const activeMembers = members.filter((row) => asLower(row.data.status) !== 'disabled').length;
  await writeRecord(COLLECTIONS.adminTeams, teamId, { memberCount: members.length, activeMembers, updatedAt: nowIso() }, true);
};

const createTeamMemberHandler = async (request: NextRequest, teamId: string): Promise<Response> => {
  const context = await requirePermission(request, 'teams.write');
  await requireUnlockForMutation(request, context);
  const team = await readRecord(COLLECTIONS.adminTeams, teamId);
  if (!team) httpError(404, 'Team not found.');
  const input = await readJsonBody(request);
  const uid = asString(input.uid);
  if (!uid) httpError(400, 'uid is required.');
  const user = await readRecord(COLLECTIONS.users, uid);
  const memberId = `${teamId}:${uid}`;
  const member = await writeRecord(COLLECTIONS.adminTeamMembers, memberId, {
    teamId,
    uid,
    userId: asString(user?.userId) || undefined,
    role: asString(input.role) || 'member',
    status: asString(input.status) || 'active',
    joinedAt: nowIso(),
    invitedBy: context.uid,
    updatedAt: nowIso(),
  }, false);
  await updateTeamMemberCounts(teamId);
  await recordAuditEvent(context, { action: 'admin.teams.member.create', resourceType: 'team_member', resourceId: memberId, subjectUid: uid, after: member });
  return json({ member });
};

const patchTeamMemberHandler = async (request: NextRequest, teamId: string, uid: string): Promise<Response> => {
  const context = await requirePermission(request, 'teams.write');
  await requireUnlockForMutation(request, context);
  const memberId = `${teamId}:${uid}`;
  const before = await readRecord(COLLECTIONS.adminTeamMembers, memberId);
  if (!before) httpError(404, 'Team member not found.');
  const patch = await readJsonBody(request);
  const member = await writeRecord(COLLECTIONS.adminTeamMembers, memberId, { ...patch, updatedAt: nowIso() }, true);
  await updateTeamMemberCounts(teamId);
  await recordAuditEvent(context, { action: 'admin.teams.member.patch', resourceType: 'team_member', resourceId: memberId, subjectUid: uid, before, after: member });
  return json({ member });
};

const deleteTeamMemberHandler = async (request: NextRequest, teamId: string, uid: string): Promise<Response> => {
  const context = await requirePermission(request, 'teams.write');
  await requireUnlockForMutation(request, context);
  const memberId = `${teamId}:${uid}`;
  const before = await readRecord(COLLECTIONS.adminTeamMembers, memberId);
  if (!before) httpError(404, 'Team member not found.');
  await deleteRecord(COLLECTIONS.adminTeamMembers, memberId);
  await updateTeamMemberCounts(teamId);
  await recordAuditEvent(context, { action: 'admin.teams.member.delete', resourceType: 'team_member', resourceId: memberId, subjectUid: uid, before });
  return json({ ok: true });
};

const listSupportConversationsHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'support.read');
  const status = asString(request.nextUrl.searchParams.get('status'));
  const q = asLower(request.nextUrl.searchParams.get('q'));
  const limit = getQueryInt(request, 'limit', 200);
  const items = await queryRecords(COLLECTIONS.supportConversations, {
    filter: (row) => {
      if (status && asString(row.data.status) !== status) return false;
      if (!q) return true;
      return asLower(row.data.userId).includes(q) || asLower(row.data.uid).includes(q) || asLower(row.data.subject).includes(q);
    },
    sort: (left, right) => asString(right.data.updatedAt || right.data.lastMessageAt).localeCompare(asString(left.data.updatedAt || left.data.lastMessageAt)),
    limit,
  });
  return json({ items: items.map((row) => ({ conversationId: row.id, ...row.data })) });
};

const getSupportConversationHandler = async (request: NextRequest, conversationId: string): Promise<Response> => {
  await requirePermission(request, 'support.read');
  const conversation = await readRecord(COLLECTIONS.supportConversations, conversationId);
  if (!conversation) httpError(404, 'Support conversation not found.');
  const messages = await listSupportMessagesByConversation(conversationId);
  return json({ conversation: { conversationId, ...conversation }, messages });
};

const replySupportConversationHandler = async (request: NextRequest, conversationId: string): Promise<Response> => {
  const context = await requirePermission(request, 'support.reply');
  await requireUnlockForMutation(request, context);
  const conversation = await readRecord(COLLECTIONS.supportConversations, conversationId);
  if (!conversation) httpError(404, 'Support conversation not found.');
  const input = await readJsonBody(request);
  const safeText = asString(input.text);
  if (!safeText) httpError(400, 'Reply text is required.');
  const messageId = randomUUID();
  const message = await writeRecord(COLLECTIONS.supportMessages, messageId, {
    conversationId,
    fromType: 'agent',
    uid: context.uid,
    userId: asString(context.actor.userId) || undefined,
    text: safeText,
    createdAt: nowIso(),
  }, false);
  const nextConversation = await writeRecord(COLLECTIONS.supportConversations, conversationId, {
    status: 'resolved',
    lastMessageAt: asString(message.createdAt),
    updatedAt: asString(message.createdAt),
    assignedTo: context.uid,
  }, true);
  await recordAuditEvent(context, { action: 'admin.support.reply', resourceType: 'support_conversation', resourceId: conversationId, after: message });
  return json({ conversation: { conversationId, ...nextConversation }, message: { messageId, ...message } });
};

const resolveSupportConversationHandler = async (request: NextRequest, conversationId: string): Promise<Response> => {
  const context = await requirePermission(request, 'support.reply');
  await requireUnlockForMutation(request, context);
  const before = await readRecord(COLLECTIONS.supportConversations, conversationId);
  if (!before) httpError(404, 'Support conversation not found.');
  const conversation = await writeRecord(COLLECTIONS.supportConversations, conversationId, { status: 'resolved', updatedAt: nowIso(), assignedTo: context.uid }, true);
  await recordAuditEvent(context, { action: 'admin.support.resolve', resourceType: 'support_conversation', resourceId: conversationId, before, after: conversation });
  return json({ conversation: { conversationId, ...conversation } });
};

const getSupportAiPolicyHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'support.ai.review');
  return json({ policy: await getSupportAiPolicy() });
};

const patchSupportAiPolicyHandler = async (request: NextRequest): Promise<Response> => {
  const context = await requirePermission(request, 'support.ai.config');
  await requireUnlockForMutation(request, context);
  const before = await getSupportAiPolicy();
  const patch = await readJsonBody(request);
  const policy = await writeRecord(COLLECTIONS.adminSupportAiPolicy, 'policy', { ...patch, updatedAt: nowIso(), updatedBy: context.uid }, true);
  await recordAuditEvent(context, { action: 'admin.support.ai_policy.patch', resourceType: 'support_ai_policy', resourceId: 'policy', before, after: policy });
  return json({ policy });
};

const normalizeNoticeRecord = (id: string, notice: AnyRecord): AnyRecord => {
  const expiresAt = asString(notice.expiresAt);
  const isExpired = Boolean(expiresAt && expiresAt < nowIso());
  const status = asString(notice.status) || 'active';
  return { id, ...notice, status, isExpired, isActive: status === 'active' && !isExpired };
};

const listNoticesHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'support.read');
  const status = asLower(request.nextUrl.searchParams.get('status')) || 'active';
  const limit = getQueryInt(request, 'limit', 200);
  const items = await queryRecords(COLLECTIONS.adminNotices, {
    filter: (row) => {
      const normalized = normalizeNoticeRecord(row.id, row.data);
      if (status === 'all') return true;
      if (status === 'deleted') return asLower(normalized.status) === 'deleted';
      return normalized.isActive;
    },
    sort: (left, right) => asString(right.data.updatedAt || right.data.createdAt).localeCompare(asString(left.data.updatedAt || left.data.createdAt)),
    limit,
  });
  return json({ items: items.map((row) => normalizeNoticeRecord(row.id, row.data)) });
};

const createNoticeHandler = async (request: NextRequest): Promise<Response> => {
  const context = await requirePermission(request, 'support.reply');
  await requireUnlockForMutation(request, context);
  const input = await readJsonBody(request);
  const noticeId = randomUUID();
  const notice = await writeRecord(COLLECTIONS.adminNotices, noticeId, {
    title: asString(input.title) || 'Notice',
    message: asString(input.message),
    details: asString(input.details) || null,
    severity: asString(input.severity) || 'info',
    audience: asString(input.audience) || 'all',
    channel: asString(input.channel) || 'toast',
    status: 'active',
    expiresAt: asString(input.expiresAt) || null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    createdBy: context.uid,
    deletedAt: null,
    deletedBy: null,
  }, false);
  await recordAuditEvent(context, { action: 'admin.notices.create', resourceType: 'notice', resourceId: noticeId, after: notice });
  return json({ notice: normalizeNoticeRecord(noticeId, notice) });
};

const deleteNoticeHandler = async (request: NextRequest, noticeId: string): Promise<Response> => {
  const context = await requirePermission(request, 'support.reply');
  await requireUnlockForMutation(request, context);
  const before = await readRecord(COLLECTIONS.adminNotices, noticeId);
  if (!before) httpError(404, 'Notice not found.');
  const notice = await writeRecord(COLLECTIONS.adminNotices, noticeId, { status: 'deleted', deletedAt: nowIso(), deletedBy: context.uid, updatedAt: nowIso() }, true);
  await recordAuditEvent(context, { action: 'admin.notices.delete', resourceType: 'notice', resourceId: noticeId, before, after: notice });
  return json({ ok: true });
};

const listFeatureFlagRecords = async (): Promise<AnyRecord[]> => {
  const items = await queryRecords(COLLECTIONS.adminFeatureFlags, {
    sort: (left, right) => asString(left.data.key || left.id).localeCompare(asString(right.data.key || right.id)),
  });
  if (items.length > 0) {
    return items.map((row) => ({ key: asString(row.data.key) || row.id, ...row.data }));
  }
  const seeded: AnyRecord[] = [];
  for (const definition of DEFAULT_FEATURE_FLAGS) {
    const flag = await writeRecord(COLLECTIONS.adminFeatureFlags, definition.key, {
      ...definition,
      updatedAt: nowIso(),
      updatedBy: 'system',
      metadata: {},
    }, false);
    seeded.push({ key: definition.key, ...flag });
  }
  return seeded;
};

const normalizeFeatureFlagRecord = (input: AnyRecord): AnyRecord => ({
  key: asString(input.key),
  enabled: input.enabled !== false,
  scope: asString(input.scope) || 'global',
  description: asString(input.description) || '',
  updatedAt: asString(input.updatedAt) || undefined,
  updatedBy: asString(input.updatedBy) || undefined,
  metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {},
});

const createAutomationRunRecord = async (
  context: AdminContext | null,
  input: {
    feature: string;
    sourceId?: string;
    fingerprint?: string;
    status?: string;
    tokenEstimate?: number;
    result?: AnyRecord;
  },
): Promise<AnyRecord> => {
  const runId = randomUUID();
  const run = await writeRecord(COLLECTIONS.adminAutomationRuns, runId, {
    runId,
    feature: asString(input.feature) || 'unknown',
    status: asString(input.status) || 'completed',
    model: DEFAULT_ADMIN_AUTOMATION_MODEL,
    sourceId: asString(input.sourceId) || undefined,
    fingerprint: asString(input.fingerprint) || undefined,
    tokenEstimate: asPositiveInt(input.tokenEstimate),
    result: input.result || {},
    createdAt: nowIso(),
    expiresAt: new Date(nowMs() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    actorUid: context?.uid || undefined,
    mode: 'rules_first',
  }, false);
  return { runId, ...run };
};

const deriveSupportCategory = (text: string): string => {
  const lower = asLower(text);
  if (/(refund|charge|charged|billing|invoice|payment|wallet|coupon|subscription)/.test(lower)) return 'billing';
  if (/(login|password|sign[ -]?in|account locked|locked out|cannot access|can.t access)/.test(lower)) return 'account';
  if (/(voice clone|clone|reference audio|separate|separation)/.test(lower)) return 'voice_clone';
  if (/(publish|chapter audio|book|reader|library)/.test(lower)) return 'publishing';
  if (/(tts|studio|generate|generation|audio novel|novel)/.test(lower)) return 'generation';
  if (/(abuse|report|copyright|dmca|illegal|fraud|spam)/.test(lower)) return 'abuse';
  if (/(feature request|idea|wish|roadmap)/.test(lower)) return 'feature_request';
  return 'general';
};

const deriveSupportUrgency = (text: string): string => {
  const lower = asLower(text);
  if (/(security|legal|dmca|charged twice|charged but|data loss|account locked|locked out|urgent|refund now)/.test(lower)) return 'critical';
  if (/(cannot|can't|cant|failed|broken|blocked|stuck|not working|issue)/.test(lower)) return 'high';
  if (/(slow|question|help|clarify)/.test(lower)) return 'medium';
  return 'low';
};

const deriveSupportQueue = (conversation: AnyRecord, classification: AnyRecord): string => {
  const status = asLower(conversation.status);
  if (asString(conversation.incidentId)) return 'incidentLinked';
  if (status === 'resolved' || status === 'closed' || status === 'dismissed') return 'autoHandled';
  if (classification.needsHuman || classification.urgency === 'critical') return 'critical';
  if (classification.blocked) return 'blocked';
  return 'backlog';
};

const buildSupportConversationAutomation = async (conversationId: string, conversation: AnyRecord): Promise<AnyRecord> => {
  const messages = await listSupportMessagesByConversation(conversationId);
  const joinedText = [
    asString(conversation.subject),
    asString(conversation.category),
    asString(conversation.lastMessagePreview),
    ...messages.map((message) => asString(message.text)),
  ].join('\n');
  const category = deriveSupportCategory(joinedText);
  const urgency = deriveSupportUrgency(joinedText);
  const blocked = /(cannot|can't|cant|blocked|stuck|unable|won.t let me)/.test(asLower(joinedText));
  const needsHuman = ['billing', 'account', 'abuse'].includes(category) || urgency === 'critical';
  const suggestedMacro = category === 'billing'
    ? 'billing_triage'
    : category === 'account'
      ? 'account_recovery'
      : category === 'generation'
        ? 'generation_retry'
        : category === 'voice_clone'
          ? 'voice_clone_triage'
          : conversation.incidentId
            ? 'incident_ack'
            : 'manual_review';
  const similarIssueKey = createHash('sha1')
    .update(`${category}:${asLower(joinedText).replace(/[^a-z0-9]+/g, ' ').slice(0, 120)}`)
    .digest('hex')
    .slice(0, 16);
  const classification = {
    summary: asString(joinedText).slice(0, 240),
    category,
    urgency,
    blocked,
    needsHuman,
    suggestedMacro,
    similarIssueKey,
  };
  return {
    ...classification,
    queue: deriveSupportQueue(conversation, classification),
  };
};

const buildSupportReplyDraft = (conversation: AnyRecord, classification: AnyRecord): string => {
  const userName = asString(conversation.userId || conversation.uid || 'there');
  if (asString(conversation.incidentId)) {
    return `Hi ${userName}, we have linked this to an active incident and are tracking it centrally. You do not need to resend details right now. We will post the next update in the app notice feed as soon as we have one.`;
  }
  if (classification.category === 'billing') {
    return `Hi ${userName}, I have marked this as a billing review so it stays in the priority queue. Please avoid retrying any paid action until we confirm the account state, and include the invoice or payment reference if you have it.`;
  }
  if (classification.category === 'account') {
    return `Hi ${userName}, this looks like an account-access issue. I have queued it for recovery review. If you are blocked from signing in or your account looks locked, please keep this thread open and avoid repeated reset attempts while we verify the account state.`;
  }
  if (classification.category === 'generation' || classification.category === 'voice_clone') {
    return `Hi ${userName}, this looks like a generation/runtime issue. I have queued it with the runtime details for review. Please keep the job or project open if possible and avoid repeated retries for now so we can inspect the failing state accurately.`;
  }
  return `Hi ${userName}, thanks for reporting this. I have queued it with the latest account and runtime context so it can be reviewed without you having to resend the same details.`;
};

const buildSupportQueueItems = async (): Promise<AnyRecord[]> => {
  const conversations = await queryRecords(COLLECTIONS.supportConversations, {
    sort: (left, right) => asString(right.data.updatedAt || right.data.lastMessageAt || right.data.createdAt)
      .localeCompare(asString(left.data.updatedAt || left.data.lastMessageAt || left.data.createdAt)),
    limit: 300,
  });
  const grouped = new Map<string, AnyRecord[]>();
  for (const row of conversations) {
    const conversation = { conversationId: row.id, ...row.data };
    const existingClassification = conversation.aiClassification && typeof conversation.aiClassification === 'object'
      ? conversation.aiClassification as AnyRecord
      : null;
    const classification = existingClassification || await buildSupportConversationAutomation(row.id, row.data);
    const queue = asString(existingClassification?.queue || classification.queue) || 'backlog';
    grouped.set(queue, [...(grouped.get(queue) || []), { ...conversation, aiClassification: classification }]);
  }
  const preferredOrder = ['critical', 'blocked', 'incidentLinked', 'backlog', 'autoHandled'];
  return preferredOrder.map((queue) => ({
    queue,
    count: (grouped.get(queue) || []).length,
    conversations: (grouped.get(queue) || []).slice(0, 20),
  }));
};

const listFeatureFlagsHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'ops.read');
  return json({ items: (await listFeatureFlagRecords()).map(normalizeFeatureFlagRecord) });
};

const patchFeatureFlagHandler = async (request: NextRequest, flagKey: string): Promise<Response> => {
  const context = await requirePermission(request, 'ops.mutate');
  await requireUnlockForMutation(request, context);
  const before = await readRecord(COLLECTIONS.adminFeatureFlags, flagKey);
  const input = await readJsonBody(request);
  const next = await writeRecord(COLLECTIONS.adminFeatureFlags, flagKey, {
    key: flagKey,
    ...(input.enabled !== undefined ? { enabled: Boolean(input.enabled) } : {}),
    ...(input.scope !== undefined ? { scope: asString(input.scope) || 'global' } : {}),
    ...(input.description !== undefined ? { description: asString(input.description) } : {}),
    ...(input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? { metadata: input.metadata } : {}),
    updatedAt: nowIso(),
    updatedBy: context.uid,
  }, true);
  await recordAuditEvent(context, { action: 'admin.feature_flags.patch', resourceType: 'feature_flag', resourceId: flagKey, before: before || undefined, after: next });
  return json({ flag: normalizeFeatureFlagRecord(next) });
};

const listAutomationRunsHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'support.ai.review');
  const items = await queryRecords(COLLECTIONS.adminAutomationRuns, {
    sort: (left, right) => asString(right.data.createdAt).localeCompare(asString(left.data.createdAt)),
    limit: getQueryInt(request, 'limit', 100),
  });
  return json({ items: items.map((row) => ({ runId: row.id, ...row.data })) });
};

const classifySupportConversationHandler = async (request: NextRequest, conversationId: string): Promise<Response> => {
  const context = await requirePermission(request, 'support.ai.review');
  const conversation = await readRecord(COLLECTIONS.supportConversations, conversationId);
  if (!conversation) httpError(404, 'Support conversation not found.');
  const classification = await buildSupportConversationAutomation(conversationId, conversation);
  const nextConversation = await writeRecord(COLLECTIONS.supportConversations, conversationId, {
    aiClassification: classification,
    queue: classification.queue,
    aiModel: DEFAULT_ADMIN_AUTOMATION_MODEL,
    aiUpdatedAt: nowIso(),
    updatedAt: nowIso(),
  }, true);
  const run = await createAutomationRunRecord(context, {
    feature: 'support_classifier',
    sourceId: conversationId,
    fingerprint: classification.similarIssueKey,
    tokenEstimate: Math.max(64, Math.ceil(asString(classification.summary).length / 4)),
    result: classification,
  });
  return json({ conversation: { conversationId, ...nextConversation }, run });
};

const draftSupportReplyHandler = async (request: NextRequest, conversationId: string): Promise<Response> => {
  const context = await requirePermission(request, 'support.ai.review');
  const conversation = await readRecord(COLLECTIONS.supportConversations, conversationId);
  if (!conversation) httpError(404, 'Support conversation not found.');
  const classification = conversation.aiClassification && typeof conversation.aiClassification === 'object'
    ? conversation.aiClassification as AnyRecord
    : await buildSupportConversationAutomation(conversationId, conversation);
  const draft = buildSupportReplyDraft(conversation, classification);
  const run = await createAutomationRunRecord(context, {
    feature: 'support_reply_draft',
    sourceId: conversationId,
    fingerprint: createHash('sha1').update(`${conversationId}:${classification.similarIssueKey}:${draft}`).digest('hex').slice(0, 16),
    tokenEstimate: Math.max(96, Math.ceil(draft.length / 4)),
    result: { draft, classification },
  });
  return json({ draft, run });
};

const supportQueuesHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'support.read');
  return json({ items: await buildSupportQueueItems() });
};

const normalizeIncidentRecord = (incidentId: string, incident: AnyRecord): AnyRecord => ({
  incidentId,
  title: asString(incident.title) || 'Untitled incident',
  summary: asString(incident.summary) || '',
  status: asString(incident.status) || 'open',
  severity: asString(incident.severity) || 'warning',
  domains: Array.isArray(incident.domains) ? incident.domains.map((entry) => asString(entry)).filter(Boolean) : [],
  linkedConversationIds: Array.isArray(incident.linkedConversationIds) ? incident.linkedConversationIds.map((entry) => asString(entry)).filter(Boolean) : [],
  noticeId: asString(incident.noticeId) || undefined,
  createdAt: asString(incident.createdAt) || undefined,
  updatedAt: asString(incident.updatedAt) || undefined,
  createdBy: asString(incident.createdBy) || undefined,
});

const listIncidentsHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'support.read');
  const items = await queryRecords(COLLECTIONS.adminIncidents, {
    sort: (left, right) => asString(right.data.updatedAt || right.data.createdAt).localeCompare(asString(left.data.updatedAt || left.data.createdAt)),
    limit: getQueryInt(request, 'limit', 100),
  });
  return json({ items: items.map((row) => normalizeIncidentRecord(row.id, row.data)) });
};

const createIncidentHandler = async (request: NextRequest): Promise<Response> => {
  const context = await requirePermission(request, 'support.reply');
  await requireUnlockForMutation(request, context);
  const input = await readJsonBody(request);
  const incidentId = randomUUID();
  const incident = await writeRecord(COLLECTIONS.adminIncidents, incidentId, {
    title: asString(input.title) || 'Untitled incident',
    summary: asString(input.summary) || '',
    status: asString(input.status) || 'open',
    severity: asString(input.severity) || 'warning',
    domains: Array.isArray(input.domains) ? input.domains.map((entry) => asString(entry)).filter(Boolean) : [],
    linkedConversationIds: Array.isArray(input.linkedConversationIds) ? input.linkedConversationIds.map((entry) => asString(entry)).filter(Boolean) : [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    createdBy: context.uid,
  }, false);
  await recordAuditEvent(context, { action: 'admin.incidents.create', resourceType: 'incident', resourceId: incidentId, after: incident });
  return json({ incident: normalizeIncidentRecord(incidentId, incident) });
};

const patchIncidentHandler = async (request: NextRequest, incidentId: string): Promise<Response> => {
  const context = await requirePermission(request, 'support.reply');
  await requireUnlockForMutation(request, context);
  const before = await readRecord(COLLECTIONS.adminIncidents, incidentId);
  if (!before) httpError(404, 'Incident not found.');
  const input = await readJsonBody(request);
  const incident = await writeRecord(COLLECTIONS.adminIncidents, incidentId, {
    ...(asString(input.title) ? { title: asString(input.title) } : {}),
    ...(input.summary !== undefined ? { summary: asString(input.summary) } : {}),
    ...(asString(input.status) ? { status: asString(input.status) } : {}),
    ...(asString(input.severity) ? { severity: asString(input.severity) } : {}),
    ...(Array.isArray(input.domains) ? { domains: input.domains.map((entry) => asString(entry)).filter(Boolean) } : {}),
    updatedAt: nowIso(),
    updatedBy: context.uid,
  }, true);
  await recordAuditEvent(context, { action: 'admin.incidents.patch', resourceType: 'incident', resourceId: incidentId, before, after: incident });
  return json({ incident: normalizeIncidentRecord(incidentId, incident) });
};

const linkIncidentConversationsHandler = async (request: NextRequest, incidentId: string): Promise<Response> => {
  const context = await requirePermission(request, 'support.reply');
  await requireUnlockForMutation(request, context);
  const incident = await readRecord(COLLECTIONS.adminIncidents, incidentId);
  if (!incident) httpError(404, 'Incident not found.');
  const input = await readJsonBody(request);
  const conversationIds = Array.isArray(input.conversationIds) ? input.conversationIds.map((entry) => asString(entry)).filter(Boolean) : [];
  const linkedConversationIds = Array.from(new Set([...(Array.isArray(incident.linkedConversationIds) ? incident.linkedConversationIds : []), ...conversationIds]));
  for (const conversationId of conversationIds) {
    await writeRecord(COLLECTIONS.supportConversations, conversationId, { incidentId, updatedAt: nowIso() }, true);
  }
  const nextIncident = await writeRecord(COLLECTIONS.adminIncidents, incidentId, {
    linkedConversationIds,
    updatedAt: nowIso(),
    updatedBy: context.uid,
  }, true);
  await recordAuditEvent(context, { action: 'admin.incidents.link_conversations', resourceType: 'incident', resourceId: incidentId, before: incident, after: nextIncident, meta: { conversationIds } });
  return json({ incident: normalizeIncidentRecord(incidentId, nextIncident) });
};

const broadcastIncidentHandler = async (request: NextRequest, incidentId: string): Promise<Response> => {
  const context = await requirePermission(request, 'support.reply');
  await requireUnlockForMutation(request, context);
  const incident = await readRecord(COLLECTIONS.adminIncidents, incidentId);
  if (!incident) httpError(404, 'Incident not found.');
  const input = await readJsonBody(request);
  const noticeId = randomUUID();
  const notice = await writeRecord(COLLECTIONS.adminNotices, noticeId, {
    title: asString(input.title) || `Incident: ${asString(incident.title) || 'Update'}`,
    message: asString(input.message) || asString(incident.summary) || 'We are investigating an incident affecting part of the app.',
    details: asString(input.details) || null,
    severity: asString(incident.severity) || 'warning',
    audience: 'all',
    channel: 'banner',
    status: 'active',
    expiresAt: asString(input.expiresAt) || null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    createdBy: context.uid,
    deletedAt: null,
    deletedBy: null,
  }, false);
  const nextIncident = await writeRecord(COLLECTIONS.adminIncidents, incidentId, {
    noticeId,
    status: asString(incident.status) || 'monitoring',
    updatedAt: nowIso(),
    updatedBy: context.uid,
  }, true);
  await recordAuditEvent(context, { action: 'admin.incidents.broadcast', resourceType: 'incident', resourceId: incidentId, before: incident, after: nextIncident, meta: { noticeId } });
  return json({ incident: normalizeIncidentRecord(incidentId, nextIncident), notice: normalizeNoticeRecord(noticeId, notice) });
};

const normalizeModerationReport = (reportId: string, report: AnyRecord): AnyRecord => ({
  reportId,
  subjectType: asString(report.subjectType) || 'content',
  subjectId: asString(report.subjectId),
  reason: asString(report.reason) || 'unspecified',
  details: asString(report.details) || undefined,
  status: asString(report.status) || 'open',
  reporterUid: asString(report.reporterUid) || undefined,
  createdAt: asString(report.createdAt) || undefined,
  resolvedAt: asString(report.resolvedAt) || undefined,
  resolution: asString(report.resolution) || undefined,
});

const listModerationReportsHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'support.read');
  const items = await queryRecords(COLLECTIONS.moderationReports, {
    sort: (left, right) => asString(right.data.updatedAt || right.data.createdAt).localeCompare(asString(left.data.updatedAt || left.data.createdAt)),
    limit: getQueryInt(request, 'limit', 100),
  });
  return json({ items: items.map((row) => normalizeModerationReport(row.id, row.data)) });
};

const resolveModerationReportHandler = async (request: NextRequest, reportId: string): Promise<Response> => {
  const context = await requirePermission(request, 'support.reply');
  await requireUnlockForMutation(request, context);
  const before = await readRecord(COLLECTIONS.moderationReports, reportId);
  if (!before) httpError(404, 'Moderation report not found.');
  const input = await readJsonBody(request);
  const report = await writeRecord(COLLECTIONS.moderationReports, reportId, {
    status: asString(input.status) || 'resolved',
    resolution: asString(input.resolution) || 'resolved_by_admin',
    resolvedAt: nowIso(),
    resolvedBy: context.uid,
    updatedAt: nowIso(),
  }, true);
  await recordAuditEvent(context, { action: 'admin.moderation.resolve', resourceType: 'moderation_report', resourceId: reportId, before, after: report });
  return json({ report: normalizeModerationReport(reportId, report) });
};

const readAccountingWindow = async (fromIso: string): Promise<Array<{ id: string; data: AnyRecord }>> => (
  queryRecords(COLLECTIONS.adminAccountingRecords, {
    filter: (row) => {
      const ts = asString(row.data.timestamp || row.data.createdAt);
      return !fromIso || (ts && ts >= fromIso);
    },
    sort: (left, right) => asString(right.data.timestamp || right.data.createdAt).localeCompare(asString(left.data.timestamp || left.data.createdAt)),
  })
);

const buildSpendAnomalies = async (weekSummaryInput?: AnyRecord | null): Promise<AnyRecord[]> => {
  const anomalies: AnyRecord[] = [];
  const weekSummary = weekSummaryInput || buildAccountingSummary(
    await readAccountingWindow(new Date(nowMs() - 7 * 24 * 60 * 60 * 1000).toISOString())
  );
  if (asPositiveNumber(weekSummary.expenditure?.geminiInr) > 5_000) {
    anomalies.push({
      id: 'gemini_spend_7d',
      type: 'spend',
      severity: 'warning',
      title: 'Gemini spend is elevated this week',
      detail: 'Primary AI spend crossed the solo-operator warning threshold for the trailing 7 days.',
      metricValue: asPositiveNumber(weekSummary.expenditure?.geminiInr),
      threshold: 5_000,
      detectedAt: nowIso(),
    });
  }
  const openAlerts = await queryRecords(COLLECTIONS.adminAlertEvents, {
    filter: (row) => !['resolved', 'dismissed'].includes(asLower(row.data.status)),
  });
  if (openAlerts.length >= 5) {
    anomalies.push({
      id: 'open_alert_backlog',
      type: 'ops',
      severity: 'critical',
      title: 'Alert backlog is growing',
      detail: 'Open alert volume is above the recommended solo-operator threshold.',
      metricValue: openAlerts.length,
      threshold: 5,
      detectedAt: nowIso(),
    });
  }
  return anomalies;
};

type AdminMoneyFastSummaryContext = {
  summary: AnyRecord;
  daySummary: AnyRecord;
  weekSummary: AnyRecord;
  monthSummary: AnyRecord;
};

const buildAdminRuntimeSummary = async (): Promise<AnyRecord> => {
  const geminiSlots = await buildGeminiSlots();
  const guardian = await buildGuardianStatus(true);
  let voiceClonePayload: AnyRecord = {};
  try {
    const voiceCloneResponse = await handleVoiceCloneRoute(new NextRequest('http://127.0.0.1/api/v1/voice-clone/provider'), ['provider']);
    voiceClonePayload = await voiceCloneResponse.json().catch(() => ({}));
  } catch {
    voiceClonePayload = {
      provider: 'modal',
      detail: 'provider status unavailable',
    };
  }
  const flags = (await listFeatureFlagRecords()).map(normalizeFeatureFlagRecord);
  return {
    generatedAt: nowIso(),
    geminiPool: {
      status: geminiSlots.some((slot) => asLower(slot.status) === 'degraded' || slot.healthy === false) ? 'warning' : 'ok',
      slots: geminiSlots.length,
      healthySlots: geminiSlots.filter((slot) => slot.healthy !== false).length,
    },
    ttsGateway: {
      status: 'ok',
      model: readEnvValue(process.env.VF_TTS_TEXTTOSPEECH_MODEL, process.env.VF_READER_TTS_MODEL, 'gemini-2.5-flash-tts'),
    },
    ttsQueue: {
      pressure: asPositiveInt(guardian.pendingApprovalCount),
      pendingApprovalCount: asPositiveInt(guardian.pendingApprovalCount),
    },
    guardian,
    voiceCloneProvider: voiceClonePayload,
    flags,
  };
};

const buildAdminMoneyFastSummary = async (): Promise<AdminMoneyFastSummaryContext> => {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const last7Start = new Date(nowMs() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const trailing30Start = new Date(nowMs() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const monthStart = new Date(Date.UTC(todayStart.getUTCFullYear(), todayStart.getUTCMonth(), 1)).toISOString();
  const [dayRecords, weekRecords, monthRecords, trailing30Records, providerSnapshots, cashSnapshot, budgets] = await Promise.all([
    readAccountingWindow(todayStart.toISOString()),
    readAccountingWindow(last7Start),
    readAccountingWindow(monthStart),
    readAccountingWindow(trailing30Start),
    listFinanceProviderSnapshots(),
    buildCashSnapshot(),
    listFinanceBudgetRecords(),
  ]);

  const daySummary = buildAccountingSummary(dayRecords);
  const weekSummary = buildAccountingSummary(weekRecords);
  const monthSummary = buildAccountingSummary(monthRecords);
  const trailing30Summary = buildAccountingSummary(trailing30Records);
  const estimatedByProvider = buildEstimatedProviderWindows(daySummary, weekSummary, monthSummary, trailing30Summary);
  const providers = decorateMoneyProviders(providerSnapshots, estimatedByProvider);
  const providerSpendMonthInr = roundTwo(providers.reduce((sum, item) => sum + asPositiveNumber(item.actualWindows?.monthInr || item.estimatedWindows?.monthInr), 0));
  const providerSpendTrailing30Inr = roundTwo(providers.reduce((sum, item) => sum + asPositiveNumber(item.actualWindows?.trailing30dInr || item.estimatedWindows?.trailing30dInr), 0));
  const budgetsView = buildBudgetView(budgets, providers, cashSnapshot);
  const runway = buildRunwaySnapshot(cashSnapshot, providerSpendMonthInr, providerSpendTrailing30Inr);
  const anomalies = [
    ...(await buildSpendAnomalies(weekSummary)),
    ...(await buildMoneyAnomalies(providers, budgetsView.items, cashSnapshot, monthSummary)),
  ];
  const overview = {
    availableCashInr: asPositiveNumber(cashSnapshot.netAvailableCashInr ?? cashSnapshot.availableCashInr),
    monthRevenueInr: asPositiveNumber(monthSummary.revenue?.paidInr),
    monthProviderSpendInr: providerSpendMonthInr,
    monthBurnInr: asPositiveNumber(runway.monthlyBurnInr),
    runwayDays: asPositiveInt(runway.runwayDays),
    budgetRiskState: asString(budgetsView.riskState || 'ok') || 'ok',
    marginInr: asNumber(monthSummary.marginInr),
    estimatedProviderSpendInr: roundTwo(providers.reduce((sum, item) => sum + asPositiveNumber(item.estimatedWindows?.monthInr), 0)),
  };
  const providersView = {
    generatedAt: nowIso(),
    items: providers,
    staleCount: providers.filter((item) => item.stale || ['stale', 'warning', 'missing'].includes(asLower(item.status))).length,
    warningCount: providers.filter((item) => ['warning', 'missing'].includes(asLower(item.status))).length,
    lastSyncedAt: providers
      .map((item) => asString(item.lastProviderSyncAt || item.lastSuccessAt || item.lastAttemptAt))
      .filter(Boolean)
      .sort()
      .pop(),
  };
  return {
    summary: {
      generatedAt: nowIso(),
      overview,
      providers: providersView,
      cash: cashSnapshot,
      budgets: budgetsView,
      runway,
      anomalies,
    },
    daySummary,
    weekSummary,
    monthSummary,
  };
};

const buildAdminMoneyAccountingDrilldown = async (): Promise<Pick<AnyRecord, 'accounting' | 'couponSummary'>> => {
  const [allRecords, couponItems] = await Promise.all([
    queryRecords(COLLECTIONS.adminAccountingRecords, {
      sort: (left, right) => asString(right.data.timestamp || right.data.createdAt).localeCompare(asString(left.data.timestamp || left.data.createdAt)),
    }),
    queryRecords(COLLECTIONS.couponRedemptions, {
      sort: (left, right) => asString(right.data.redeemedAt || right.data.createdAt).localeCompare(asString(left.data.redeemedAt || left.data.createdAt)),
    }),
  ]);

  return {
    accounting: buildAccountingSummary(allRecords),
    couponSummary: buildCouponAnalyticsSummary(couponItems),
  };
};

const buildAdminMoneySummary = async (
  options?: { includeAccounting?: boolean },
): Promise<AnyRecord> => {
  const fastContext = await buildAdminMoneyFastSummary();
  if (!options?.includeAccounting) {
    return fastContext.summary;
  }

  return {
    ...fastContext.summary,
    ...(await buildAdminMoneyAccountingDrilldown()),
  };
};

const readAdminAuditRows = async (limit: number): Promise<Array<{ id: string; data: AnyRecord }>> => {
  const db = await getAdminD1Database();
  if (db) {
    try {
      await ensureAdminD1Schema(db);
      const rows = await readAdminD1Rows(db, `SELECT event_id, payload_json FROM ${ADMIN_D1_TABLES.auditEvents} ORDER BY sequence DESC LIMIT ?`, limit);
      return rows
        .map((row) => {
          const data = parseAdminPersistedJsonRecord(asString(row.payload_json)) || {};
          return { id: asString(row.event_id) || asString(data.eventId), data };
        })
        .filter((item) => item.id && Object.keys(item.data).length > 0)
        .slice(0, limit);
    } catch {
      return queryRecords(COLLECTIONS.adminAuditEvents, {
        sort: (left, right) => asPositiveInt(right.data.sequence) - asPositiveInt(left.data.sequence),
        limit,
      });
    }
  }
  return queryRecords(COLLECTIONS.adminAuditEvents, {
    sort: (left, right) => asPositiveInt(right.data.sequence) - asPositiveInt(left.data.sequence),
    limit,
  });
};

const readAdminAuditRowsForUid = async (uid: string, limit: number): Promise<Array<{ id: string; data: AnyRecord }>> => {
  const db = await getAdminD1Database();
  if (db) {
    try {
      await ensureAdminD1Schema(db);
      const rows = await readAdminD1Rows(db, `SELECT event_id, payload_json, sequence FROM ${ADMIN_D1_TABLES.auditEvents} WHERE actor_uid = ? OR subject_uid = ? ORDER BY sequence DESC LIMIT ?`, uid, uid, limit);
      return rows
        .map((row) => {
          const data = parseAdminPersistedJsonRecord(asString(row.payload_json)) || {};
          return { id: asString(row.event_id) || asString(data.eventId), data };
        })
        .filter((item) => item.id && Object.keys(item.data).length > 0)
        .slice(0, limit);
    } catch {
      return queryRecords(COLLECTIONS.adminAuditEvents, {
        filter: (row) => asString(row.data.subjectUid) === uid || asString(row.data.actorUid) === uid,
        sort: (left, right) => asPositiveInt(right.data.sequence) - asPositiveInt(left.data.sequence),
        limit,
      });
    }
  }
  return queryRecords(COLLECTIONS.adminAuditEvents, {
    filter: (row) => asString(row.data.subjectUid) === uid || asString(row.data.actorUid) === uid,
    sort: (left, right) => asPositiveInt(right.data.sequence) - asPositiveInt(left.data.sequence),
    limit,
  });
};

const dashboardSummaryHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'ops.read');
  const [runtime, moneyContext, queues, incidentsRows, auditRows, flags, alerts] = await Promise.all([
    buildAdminRuntimeSummary(),
    buildAdminMoneyFastSummary(),
    buildSupportQueueItems(),
    queryRecords(COLLECTIONS.adminIncidents, {
      sort: (left, right) => asString(right.data.updatedAt || right.data.createdAt).localeCompare(asString(left.data.updatedAt || left.data.createdAt)),
      limit: 10,
    }),
    readAdminAuditRows(12),
    listFeatureFlagRecords(),
    queryRecords(COLLECTIONS.adminAlertEvents, {
      filter: (row) => !['resolved', 'dismissed'].includes(asLower(row.data.status)),
    }),
  ]);
  const money = moneyContext.summary;
  const supportCounts = Object.fromEntries(queues.map((item) => [item.queue, item.count]));
  const riskyActions = auditRows
    .map((row) => row.data)
    .filter((row) => /(delete|grant|reset|unlock|disable|run|broadcast|patch)/i.test(asString(row.action)))
    .slice(0, 8);
  const activeIncidents = incidentsRows
    .map((row) => normalizeIncidentRecord(row.id, row.data))
    .filter((item) => !['resolved', 'closed'].includes(asLower(item.status)));
  const healthStatus = activeIncidents.some((item) => asLower(item.severity) === 'critical') || alerts.length >= 5
    ? 'critical'
      : activeIncidents.length > 0 || alerts.length > 0
        ? 'warning'
        : 'ok';
  return json({
    summary: {
      generatedAt: nowIso(),
      health: {
        status: healthStatus,
        activeIncidents: activeIncidents.length,
        openAlerts: alerts.length,
        supportBacklog: asPositiveInt(supportCounts.backlog),
        queuePressure: asPositiveInt(runtime.ttsQueue?.pressure),
        guardIssues: Array.isArray(runtime.guardian?.issues) ? runtime.guardian.issues.length : 0,
      },
      failuresByDomain: {
        studio: alerts.filter((row) => asLower(row.data.metricKey).includes('tts') || asLower(row.data.metricKey).includes('studio')).length,
        reader: alerts.filter((row) => asLower(row.data.metricKey).includes('reader')).length,
        publishing: alerts.filter((row) => asLower(row.data.metricKey).includes('publish')).length,
        voiceClone: alerts.filter((row) => asLower(row.data.metricKey).includes('voice') || asLower(row.data.metricKey).includes('clone')).length,
        media: alerts.filter((row) => asLower(row.data.metricKey).includes('media') || asLower(row.data.metricKey).includes('dub')).length,
      },
      support: {
        critical: asPositiveInt(supportCounts.critical),
        blocked: asPositiveInt(supportCounts.blocked),
        incidentLinked: asPositiveInt(supportCounts.incidentLinked),
        backlog: asPositiveInt(supportCounts.backlog),
        autoHandled: asPositiveInt(supportCounts.autoHandled),
      },
      spending: {
        todayInr: asPositiveNumber(moneyContext.daySummary.expenditure?.totalInr),
        last7dInr: asPositiveNumber(moneyContext.weekSummary.expenditure?.totalInr),
        monthInr: asPositiveNumber(moneyContext.monthSummary.expenditure?.totalInr),
        topCostSurface: asPositiveNumber(moneyContext.monthSummary.expenditure?.geminiInr) >= asPositiveNumber(moneyContext.monthSummary.expenditure?.walletInr)
          ? 'gemini'
          : 'wallet',
      },
      anomalies: money.anomalies || [],
      incidents: activeIncidents,
      featureFlags: flags.map(normalizeFeatureFlagRecord),
      recentRiskyActions: riskyActions,
      runtime: {
        geminiPoolStatus: asString(runtime.geminiPool?.status) || 'ok',
        ttsGatewayStatus: asString(runtime.ttsGateway?.status) || 'ok',
        voiceCloneProvider: asString(runtime.voiceCloneProvider?.provider || runtime.voiceCloneProvider?.defaultProvider || runtime.voiceCloneProvider?.detail) || 'unknown',
      },
    },
  });
};

const runtimeSummaryHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'ops.read');
  return json({ summary: await buildAdminRuntimeSummary() });
};

const moneySummaryHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'billing.read');
  return json({ summary: await buildAdminMoneySummary() });
};

const moneyProvidersHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'billing.read');
  const summary = await buildAdminMoneySummary();
  return json({ providers: summary.providers, items: summary.providers?.items || [] });
};

const syncMoneyProvidersHandler = async (request: NextRequest): Promise<Response> => {
  const context = await requirePermission(request, 'billing.write');
  const input = await readJsonBody(request);
  const provider = asLower(input.provider || request.nextUrl.searchParams.get('provider') || 'all') || 'all';
  const { payload, replayed } = await withFinanceMutationIdempotency(request, context, `money.providers.sync:${provider}`, async () => {
    const results = await syncFinanceProviders(provider === 'gcp' || provider === 'modal' ? provider : 'all', context);
    const summary = await buildAdminMoneySummary();
    await recordAuditEvent(context, {
      action: 'admin.money.providers.sync',
      resourceType: 'money_provider_sync',
      resourceId: provider || 'all',
      after: { provider, resultCount: results.length, summaryGeneratedAt: summary.generatedAt },
    });
    return { ok: true, provider, results, summary };
  });
  return json(payload, 200, replayed ? { 'x-vf-idempotent-replay': 'true' } : undefined);
};

const moneyCashHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'billing.read');
  return json({ cash: await buildCashSnapshot() });
};

const patchMoneyCashHandler = async (request: NextRequest): Promise<Response> => {
  const context = await requirePermission(request, 'billing.write');
  await requireUnlockForMutation(request, context);
  const input = await readJsonBody(request);
  const { payload, replayed } = await withFinanceMutationIdempotency(request, context, 'money.cash.patch', async () => {
    const before = await buildCashSnapshot();
    const currentAccounts = await listFinanceCashAccounts();
    const byId = new Map(currentAccounts.map((item) => [asString(item.accountId), item]));
    const incoming = Array.isArray(input.accounts) ? input.accounts : [];
    const accountsToSave = incoming
      .map((entry) => ({
        accountId: asString((entry as AnyRecord)?.accountId),
        name: asString((entry as AnyRecord)?.name),
        type: asString((entry as AnyRecord)?.type),
        balanceInr: asNumber((entry as AnyRecord)?.balanceInr),
        notes: asString((entry as AnyRecord)?.notes),
      }))
      .filter((entry) => entry.accountId && entry.accountId !== 'outstanding_withdrawals' && byId.get(entry.accountId)?.editable !== false);
    await saveFinanceCashAccounts(accountsToSave, context);
    const after = await buildCashSnapshot();
    const adjustmentId = `cash_adjustment_${randomUUID()}`;
    await writeRecord(COLLECTIONS.adminFinanceAdjustments, adjustmentId, {
      adjustmentId,
      type: 'cash_patch',
      accounts: accountsToSave,
      before,
      after,
      createdAt: nowIso(),
      createdBy: context.uid,
    }, false);
    await recordAuditEvent(context, {
      action: 'admin.money.cash.patch',
      resourceType: 'money_cash',
      resourceId: 'operator_cash',
      before,
      after,
    });
    return { cash: after, updatedAccounts: accountsToSave };
  });
  return json(payload, 200, replayed ? { 'x-vf-idempotent-replay': 'true' } : undefined);
};

const moneyBudgetsHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'billing.read');
  const summary = await buildAdminMoneySummary();
  return json({ budgets: summary.budgets, items: summary.budgets?.items || [] });
};

const upsertMoneyBudget = async (
  request: NextRequest,
  context: AdminContext,
  budgetId: string,
  input: AnyRecord,
  before?: AnyRecord | null,
): Promise<AnyRecord> => {
  const safeBudgetId = asString(budgetId) || `budget_${randomUUID()}`;
  const source = asLower(input.source || before?.source || 'manual') || 'manual';
  const normalizedInput = {
    name: asString(input.name || before?.name || safeBudgetId) || safeBudgetId,
    scopeType: asString(input.scopeType || before?.scopeType || 'global') || 'global',
    scopeKey: asString(input.scopeKey || before?.scopeKey || 'all') || 'all',
    amountInr: asPositiveNumber(input.amountInr ?? before?.amountInr),
    period: asString(input.period || before?.period || 'monthly') || 'monthly',
    warningPct: asPositiveNumber(input.warningPct ?? before?.warningPct ?? 80),
    criticalPct: asPositiveNumber(input.criticalPct ?? before?.criticalPct ?? 100),
    enabled: input.enabled === undefined ? before?.enabled !== false : asBoolean(input.enabled),
    safeActions: Array.isArray(input.safeActions) ? input.safeActions.map((item) => asString(item)).filter(Boolean) : (before?.safeActions || []),
    metadata: input.metadata && typeof input.metadata === 'object' ? cloneRecord(input.metadata as AnyRecord) : (before?.metadata || {}),
    source,
  };

  let externalRef = asString(before?.externalRef || input.externalRef);
  let readOnly = asBoolean(before?.readOnly);
  if (source === 'gcp_budget_api') {
    const financeProviders = await loadFinanceProvidersModule();
    const externalBudget = await financeProviders.createOrUpdateGcpBudgetRecord({
      externalRef,
      displayName: normalizedInput.name,
      amountInr: normalizedInput.amountInr,
      thresholdRules: [
        { percent: normalizedInput.warningPct / 100, spendBasis: 'CURRENT_SPEND' },
        { percent: normalizedInput.criticalPct / 100, spendBasis: 'CURRENT_SPEND' },
      ],
      filter: {
        scopeType: normalizedInput.scopeType,
        scopeKey: normalizedInput.scopeKey,
      },
    });
    externalRef = asString(externalBudget.externalRef || externalRef);
    readOnly = false;
  }

  return saveFinanceBudgetRecord(safeBudgetId, {
    ...(before || {}),
    ...normalizedInput,
    source,
    externalRef: externalRef || undefined,
    readOnly,
    updatedAt: nowIso(),
    updatedBy: context.uid,
  });
};

const createMoneyBudgetHandler = async (request: NextRequest): Promise<Response> => {
  const context = await requirePermission(request, 'billing.write');
  await requireUnlockForMutation(request, context);
  const input = await readJsonBody(request);
  const { payload, replayed } = await withFinanceMutationIdempotency(request, context, 'money.budgets.create', async () => {
    const budgetId = asString(input.budgetId) || `budget_${randomUUID()}`;
    const budget = await upsertMoneyBudget(request, context, budgetId, input, null);
    const summary = await buildAdminMoneySummary();
    await recordAuditEvent(context, {
      action: 'admin.money.budgets.create',
      resourceType: 'money_budget',
      resourceId: budgetId,
      after: budget,
    });
    return { budget, budgets: summary.budgets, summary };
  });
  return json(payload, 200, replayed ? { 'x-vf-idempotent-replay': 'true' } : undefined);
};

const patchMoneyBudgetHandler = async (request: NextRequest, budgetId: string): Promise<Response> => {
  const context = await requirePermission(request, 'billing.write');
  await requireUnlockForMutation(request, context);
  const before = await readRecord(COLLECTIONS.adminFinanceBudgets, budgetId);
  if (!before) httpError(404, 'Budget not found.');
  const input = await readJsonBody(request);
  const { payload, replayed } = await withFinanceMutationIdempotency(request, context, `money.budgets.patch:${budgetId}`, async () => {
    const budget = await upsertMoneyBudget(request, context, budgetId, input, before);
    const summary = await buildAdminMoneySummary();
    await recordAuditEvent(context, {
      action: 'admin.money.budgets.patch',
      resourceType: 'money_budget',
      resourceId: budgetId,
      before,
      after: budget,
    });
    return { budget, budgets: summary.budgets, summary };
  });
  return json(payload, 200, replayed ? { 'x-vf-idempotent-replay': 'true' } : undefined);
};

const moneyAnomaliesHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'billing.read');
  const summary = await buildAdminMoneySummary();
  return json({ items: summary.anomalies || [] });
};

const moneyRunwayHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'billing.read');
  const summary = await buildAdminMoneySummary();
  return json({ runway: summary.runway || null });
};

const userTimelineHandler = async (request: NextRequest, uid: string): Promise<Response> => {
  await requirePermission(request, 'users.read');
  const userData = await readRecord(COLLECTIONS.users, uid);
  if (!userData) httpError(404, 'User not found.');
  const [summary, entitlements, supportRows, auditRows, vcGrantRows, audioRows] = await Promise.all([
    buildAdminUserSummary(uid, userData),
    getUserEntitlements(uid, userData),
    queryRecords(COLLECTIONS.supportConversations, {
      filter: (row) => asString(row.data.uid) === uid || asString(row.data.userId) === asString(userData.userId),
      sort: (left, right) => asString(right.data.updatedAt || right.data.createdAt).localeCompare(asString(left.data.updatedAt || left.data.createdAt)),
      limit: 10,
    }),
    readAdminAuditRowsForUid(uid, 10),
    queryRecords(COLLECTIONS.adminVcGrantRecords, {
      filter: (row) => asString(row.data.uid) === uid,
      sort: (left, right) => asString(right.data.createdAt).localeCompare(asString(left.data.createdAt)),
      limit: 10,
    }),
    queryRecords(COLLECTIONS.audioMetadataRecords, {
      filter: (row) => (asString(row.data.uid) === uid || asString(row.data.userId) === asString(userData.userId)) && asLower(row.data.status) === 'failed',
      sort: (left, right) => asString(right.data.createdAt).localeCompare(asString(left.data.createdAt)),
      limit: 10,
    }),
  ]);
  const supportConversations = supportRows.map((row) => ({ conversationId: row.id, ...row.data }));
  const recentAuditEvents = auditRows.map((row) => ({ eventId: row.id, ...row.data }));
  const recentVcGrants = vcGrantRows.map((row) => ({ id: row.id, ...row.data }));
  const audioFailures = audioRows.map((row) => ({ auditId: row.id, ...row.data }));
  const riskIndicators = [
    asBoolean(userData.disabled) ? 'account_disabled' : '',
    supportConversations.some((row) => asLower(row.status) !== 'resolved') ? 'open_support' : '',
    audioFailures.length > 0 ? 'audio_failures' : '',
    recentVcGrants.length >= 3 ? 'frequent_vc_grants' : '',
  ].filter(Boolean);
  return json({
    timeline: {
      uid,
      summary,
      entitlements,
      supportConversations,
      recentAuditEvents,
      recentVcGrants,
      audioFailures,
      riskIndicators,
      snapshot: {
        openSupport: supportConversations.filter((row) => asLower(row.status) !== 'resolved').length,
        failedAudioJobs: audioFailures.length,
        vcGrantCount: recentVcGrants.length,
        accountStatus: asString(summary.accountStatus) || undefined,
      },
    },
  });
};

const buildGuardianStatus = async (includeRouteStats: boolean): Promise<AnyRecord> => {
  const approvals = await listRecords(COLLECTIONS.opsGuardianApprovals);
  return {
    ok: true,
    pendingApprovalCount: approvals.filter((row) => asLower(row.data.status) === 'pending').length,
    issues: [],
    concurrency: { adminRouteMode: isAdminOpsProxyMode() ? 'proxy' : 'native' },
    runtimes: getReplatformRuntimeSummary(),
    geminiPool: { status: 'ok', slots: (await buildGeminiSlots()).length },
    ...(includeRouteStats ? { routeStats: { adminNative: true, opsNative: true } } : {}),
  };
};

const guardianStatusHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'guardian.read');
  return json(await buildGuardianStatus(getQueryBool(request, 'include_route_stats')));
};

const guardianApprovalsHandler = async (request: NextRequest): Promise<Response> => {
  await requirePermission(request, 'guardian.read');
  const status = asLower(request.nextUrl.searchParams.get('status')) || 'pending';
  const approvals = await queryRecords(COLLECTIONS.opsGuardianApprovals, {
    filter: (row) => status === 'all' || asLower(row.data.status) === status,
    sort: (left, right) => asString(right.data.createdAt).localeCompare(asString(left.data.createdAt)),
    limit: getQueryInt(request, 'limit', 100),
  });
  return json({ ok: true, status, count: approvals.length, approvals: approvals.map((row) => ({ id: row.id, ...row.data })) });
};

const guardianActionsHandler = async (request: NextRequest): Promise<Response> => {
  const context = await requirePermission(request, 'guardian.mutate');
  await requireUnlockForMutation(request, context);
  const input = await readJsonBody(request);
  const actionId = randomUUID();
  const action = await writeRecord(COLLECTIONS.opsGuardianActions, actionId, {
    action: asString(input.action) || 'unknown',
    payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
    status: 'accepted',
    createdAt: nowIso(),
    requestedBy: context.uid,
  }, false);
  await recordAuditEvent(context, { action: 'ops.guardian.action', resourceType: 'guardian_action', resourceId: actionId, after: action });
  return json({ ok: true, actionId, status: 'accepted' });
};

const isMethod = (request: Request, method: string): boolean => request.method.toUpperCase() === method;

const handleNativeAdminRoute = async (request: NextRequest, pathSegments: string[]): Promise<Response> => {
  const path = Array.isArray(pathSegments) ? pathSegments.map((segment) => asString(segment)).filter(Boolean) : [];
  if (path.length === 0) return json({ ok: true, domain: 'admin' });
  if (isMethod(request, 'OPTIONS')) return new Response(null, { status: 204, headers: { 'x-vf-admin-ops-mode': 'native' } });

  if (path.length === 2 && path[0] === 'dashboard' && path[1] === 'summary' && isMethod(request, 'GET')) return dashboardSummaryHandler(request);
  if (path.length === 2 && path[0] === 'runtime' && path[1] === 'summary' && isMethod(request, 'GET')) return runtimeSummaryHandler(request);
  if (path.length === 2 && path[0] === 'money' && path[1] === 'summary' && isMethod(request, 'GET')) return moneySummaryHandler(request);
  if (path.length === 2 && path[0] === 'money' && path[1] === 'providers' && isMethod(request, 'GET')) return moneyProvidersHandler(request);
  if (path.length === 3 && path[0] === 'money' && path[1] === 'providers' && path[2] === 'sync' && isMethod(request, 'POST')) return syncMoneyProvidersHandler(request);
  if (path.length === 2 && path[0] === 'money' && path[1] === 'cash' && isMethod(request, 'GET')) return moneyCashHandler(request);
  if (path.length === 2 && path[0] === 'money' && path[1] === 'cash' && isMethod(request, 'PATCH')) return patchMoneyCashHandler(request);
  if (path.length === 2 && path[0] === 'money' && path[1] === 'budgets' && isMethod(request, 'GET')) return moneyBudgetsHandler(request);
  if (path.length === 2 && path[0] === 'money' && path[1] === 'budgets' && isMethod(request, 'POST')) return createMoneyBudgetHandler(request);
  if (path.length === 3 && path[0] === 'money' && path[1] === 'budgets' && isMethod(request, 'PATCH')) return patchMoneyBudgetHandler(request, path[2]);
  if (path.length === 2 && path[0] === 'money' && path[1] === 'anomalies' && isMethod(request, 'GET')) return moneyAnomaliesHandler(request);
  if (path.length === 2 && path[0] === 'money' && path[1] === 'runway' && isMethod(request, 'GET')) return moneyRunwayHandler(request);
  if (path.length === 1 && path[0] === 'actor' && isMethod(request, 'GET')) return actorHandler(request);
  if (path.length === 1 && path[0] === 'users' && isMethod(request, 'GET')) return listAdminUsers(request);
  if (path.length === 3 && path[0] === 'users' && path[2] === 'timeline' && isMethod(request, 'GET')) return userTimelineHandler(request, path[1]);
  if (path.length === 2 && path[0] === 'users' && isMethod(request, 'PATCH')) return patchAdminUserHandler(request, path[1]);
  if (path.length === 2 && path[0] === 'users' && isMethod(request, 'DELETE')) return deleteAdminUserHandler(request, path[1]);
  if (path.length === 3 && path[0] === 'users' && path[2] === 'force-user-id' && isMethod(request, 'POST')) return forceAdminUserIdHandler(request, path[1]);
  if (path.length === 3 && path[0] === 'users' && path[2] === 'reset-password' && isMethod(request, 'POST')) return resetAdminUserPasswordHandler(request, path[1]);
  if (path.length === 3 && path[0] === 'users' && path[2] === 'revoke-sessions' && isMethod(request, 'POST')) return revokeAdminUserSessionsHandler(request, path[1]);
  if (path.length === 4 && path[0] === 'billing' && path[1] === 'users' && path[3] === 'vc-grants' && isMethod(request, 'GET')) return listAdminUserVcGrants(request, path[2]);
  if (path.length === 4 && path[0] === 'billing' && path[1] === 'users' && path[3] === 'vc-grants' && isMethod(request, 'POST')) return grantAdminUserVcHandler(request, path[2]);
  if (path.length === 1 && path[0] === 'coupons' && isMethod(request, 'GET')) return listCouponsHandler(request);
  if (path.length === 1 && path[0] === 'coupons' && isMethod(request, 'POST')) return createCouponHandler(request);
  if (path.length === 2 && path[0] === 'coupons' && path[1] === 'generate-code' && isMethod(request, 'GET')) return generateCouponCodeHandler(request);
  if (path.length === 2 && path[0] === 'coupons' && isMethod(request, 'PATCH')) return patchCouponHandler(request, path[1]);
  if (path.length === 3 && path[0] === 'gemini' && path[1] === 'pools' && path[2] === 'usage' && isMethod(request, 'GET')) return getGeminiPoolUsageHandler(request);
  if (path.length === 2 && path[0] === 'gemini' && path[1] === 'pools' && isMethod(request, 'GET')) return getGeminiPoolStatusHandler(request);
  if (path.length === 3 && path[0] === 'usage' && path[1] === 'reset-daily-all' && path[2] === 'status' && isMethod(request, 'GET')) return usageResetStatusHandler(request);
  if (path.length === 2 && path[0] === 'usage' && path[1] === 'reset-daily-all' && isMethod(request, 'POST')) return resetDailyUsageAllHandler(request);
  if (path.length === 2 && path[0] === 'integrations' && path[1] === 'usage' && isMethod(request, 'GET')) return integrationsUsageHandler(request);
  if (path.length === 3 && path[0] === 'tts' && path[1] === 'gateway' && path[2] === 'status' && isMethod(request, 'GET')) return ttsGatewayStatusHandler(request);
  if (path.length === 3 && path[0] === 'tts' && path[1] === 'queue' && path[2] === 'metrics' && isMethod(request, 'GET')) return ttsQueueMetricsHandler(request);
  if (path.length === 2 && path[0] === 'session-unlock' && path[1] === 'issue' && isMethod(request, 'POST')) return issueSessionUnlockHandler(request);
  if (path.length === 2 && path[0] === 'session-unlock' && path[1] === 'verify' && isMethod(request, 'POST')) return verifySessionUnlockHandler(request);
  if (path.length === 2 && path[0] === 'session-unlock' && path[1] === 'status' && isMethod(request, 'GET')) return sessionUnlockStatusHandler(request);
  if (path.length === 2 && path[0] === 'voice-clone' && path[1] === 'provider' && isMethod(request, 'GET')) return getVoiceCloneProviderStatusHandler(request);
  if (path.length === 2 && path[0] === 'voice-clone' && path[1] === 'provider' && isMethod(request, 'PATCH')) return patchVoiceCloneProviderHandler(request);
  if (path.length === 2 && path[0] === 'rbac' && path[1] === 'roles' && isMethod(request, 'GET')) return getRoleCatalogHandler(request);
  if (path.length === 2 && path[0] === 'rbac' && path[1] === 'users' && isMethod(request, 'GET')) return listRbacUsersHandler(request);
  if (path.length === 3 && path[0] === 'rbac' && path[1] === 'users' && (isMethod(request, 'POST') || isMethod(request, 'PATCH'))) return upsertRbacAssignment(request, path[2]);
  if (path.length === 4 && path[0] === 'rbac' && path[1] === 'users' && path[3] === 'disable' && isMethod(request, 'POST')) return disableRbacUser(request, path[2]);
  if (path.length === 4 && path[0] === 'rbac' && path[1] === 'users' && path[3] === 'enable' && isMethod(request, 'POST')) return enableRbacUser(request, path[2]);
  if (path.length === 2 && path[0] === 'audit' && path[1] === 'events' && isMethod(request, 'GET')) return listAuditEventsHandler(request);
  if (path.length === 3 && path[0] === 'audit' && path[1] === 'events' && isMethod(request, 'GET')) return getAuditEventByIdHandler(request, path[2]);
  if (path.length === 2 && path[0] === 'audit' && path[1] === 'verify-chain' && isMethod(request, 'GET')) return verifyAuditChain(request);
  if (path.length === 2 && path[0] === 'audio-metadata' && path[1] === 'records' && isMethod(request, 'GET')) return listAudioMetadataHandler(request);
  if (path.length === 3 && path[0] === 'audio-metadata' && path[1] === 'records' && isMethod(request, 'GET')) return getAudioMetadataByIdHandler(request, path[2]);
  if (path.length === 2 && path[0] === 'audio-metadata' && path[1] === 'export.csv' && isMethod(request, 'GET')) return exportAudioMetadataCsvHandler(request);
  if (path.length === 2 && path[0] === 'alerts' && path[1] === 'policies' && isMethod(request, 'GET')) return listAlertsHandler(request, COLLECTIONS.adminAlertPolicies);
  if (path.length === 2 && path[0] === 'alerts' && path[1] === 'policies' && isMethod(request, 'POST')) return createAlertPolicyHandler(request);
  if (path.length === 3 && path[0] === 'alerts' && path[1] === 'policies' && isMethod(request, 'PATCH')) return patchAlertPolicyHandler(request, path[2]);
  if (path.length === 2 && path[0] === 'alerts' && path[1] === 'destinations' && isMethod(request, 'GET')) return listAlertsHandler(request, COLLECTIONS.adminAlertDestinations);
  if (path.length === 2 && path[0] === 'alerts' && path[1] === 'destinations' && isMethod(request, 'POST')) return createAlertDestinationHandler(request);
  if (path.length === 3 && path[0] === 'alerts' && path[1] === 'destinations' && isMethod(request, 'PATCH')) return patchAlertDestinationHandler(request, path[2]);
  if (path.length === 2 && path[0] === 'alerts' && path[1] === 'events' && isMethod(request, 'GET')) return listAlertsHandler(request, COLLECTIONS.adminAlertEvents);
  if (path.length === 4 && path[0] === 'alerts' && path[1] === 'events' && path[3] === 'ack' && isMethod(request, 'POST')) return patchAlertEventStatusHandler(request, path[2], 'ack');
  if (path.length === 4 && path[0] === 'alerts' && path[1] === 'events' && path[3] === 'resolve' && isMethod(request, 'POST')) return patchAlertEventStatusHandler(request, path[2], 'resolved');
  if (path.length === 2 && path[0] === 'scheduler' && path[1] === 'tasks' && isMethod(request, 'GET')) return listSchedulerTasksHandler(request);
  if (path.length === 2 && path[0] === 'scheduler' && path[1] === 'tasks' && isMethod(request, 'POST')) return createSchedulerTaskHandler(request);
  if (path.length === 3 && path[0] === 'scheduler' && path[1] === 'tasks' && isMethod(request, 'PATCH')) return patchSchedulerTaskHandler(request, path[2]);
  if (path.length === 4 && path[0] === 'scheduler' && path[1] === 'tasks' && path[3] === 'run' && isMethod(request, 'POST')) return runSchedulerTaskHandler(request, path[2]);
  if (path.length === 2 && path[0] === 'scheduler' && path[1] === 'runs' && isMethod(request, 'GET')) return listSchedulerRunsHandler(request);
  if (path.length === 3 && path[0] === 'scheduler' && path[1] === 'runs' && isMethod(request, 'GET')) return getSchedulerRunByIdHandler(request, path[2]);
  if (path.length === 3 && path[0] === 'analytics' && path[1] === 'coupons' && path[2] === 'summary' && isMethod(request, 'GET')) return couponAnalyticsSummaryHandler(request);
  if (path.length === 3 && path[0] === 'analytics' && path[1] === 'coupons' && path[2] === 'timeseries' && isMethod(request, 'GET')) return couponAnalyticsTimeseriesHandler(request);
  if (path.length === 4 && path[0] === 'analytics' && path[1] === 'coupons' && path[3] === 'impact' && isMethod(request, 'GET')) return couponAnalyticsImpactHandler(request, path[2]);
  if (path.length === 2 && path[0] === 'accounting' && path[1] === 'summary' && isMethod(request, 'GET')) return accountingSummaryHandler(request);
  if (path.length === 2 && path[0] === 'accounting' && path[1] === 'timeseries' && isMethod(request, 'GET')) return accountingTimeseriesHandler(request);
  if (path.length === 2 && path[0] === 'accounting' && path[1] === 'records' && isMethod(request, 'GET')) return accountingRecordsHandler(request);
  if (path.length === 3 && path[0] === 'accounting' && path[1] === 'monitor' && path[2] === 'runs' && isMethod(request, 'GET')) return accountingMonitorRunsHandler(request);
  if (path.length === 3 && path[0] === 'accounting' && path[1] === 'monitor' && path[2] === 'run' && isMethod(request, 'POST')) return runAccountingMonitorHandler(request);
  if (path.length === 1 && path[0] === 'teams' && isMethod(request, 'GET')) return listTeamsHandler(request);
  if (path.length === 1 && path[0] === 'teams' && isMethod(request, 'POST')) return createTeamHandler(request);
  if (path.length === 2 && path[0] === 'teams' && isMethod(request, 'PATCH')) return patchTeamHandler(request, path[1]);
  if (path.length === 3 && path[0] === 'teams' && path[2] === 'members' && isMethod(request, 'GET')) return listTeamMembersHandler(request, path[1]);
  if (path.length === 3 && path[0] === 'teams' && path[2] === 'members' && isMethod(request, 'POST')) return createTeamMemberHandler(request, path[1]);
  if (path.length === 4 && path[0] === 'teams' && path[2] === 'members' && isMethod(request, 'PATCH')) return patchTeamMemberHandler(request, path[1], path[3]);
  if (path.length === 4 && path[0] === 'teams' && path[2] === 'members' && isMethod(request, 'DELETE')) return deleteTeamMemberHandler(request, path[1], path[3]);
  if (path.length === 2 && path[0] === 'support' && path[1] === 'conversations' && isMethod(request, 'GET')) return listSupportConversationsHandler(request);
  if (path.length === 2 && path[0] === 'support' && path[1] === 'queues' && isMethod(request, 'GET')) return supportQueuesHandler(request);
  if (path.length === 3 && path[0] === 'support' && path[1] === 'conversations' && isMethod(request, 'GET')) return getSupportConversationHandler(request, path[2]);
  if (path.length === 4 && path[0] === 'support' && path[1] === 'conversations' && path[3] === 'classify' && isMethod(request, 'POST')) return classifySupportConversationHandler(request, path[2]);
  if (path.length === 4 && path[0] === 'support' && path[1] === 'conversations' && path[3] === 'draft-reply' && isMethod(request, 'POST')) return draftSupportReplyHandler(request, path[2]);
  if (path.length === 4 && path[0] === 'support' && path[1] === 'conversations' && path[3] === 'reply' && isMethod(request, 'POST')) return replySupportConversationHandler(request, path[2]);
  if (path.length === 4 && path[0] === 'support' && path[1] === 'conversations' && path[3] === 'resolve' && isMethod(request, 'POST')) return resolveSupportConversationHandler(request, path[2]);
  if (path.length === 2 && path[0] === 'support' && path[1] === 'ai-policy' && isMethod(request, 'GET')) return getSupportAiPolicyHandler(request);
  if (path.length === 2 && path[0] === 'support' && path[1] === 'ai-policy' && isMethod(request, 'PATCH')) return patchSupportAiPolicyHandler(request);
  if (path.length === 1 && path[0] === 'notices' && isMethod(request, 'GET')) return listNoticesHandler(request);
  if (path.length === 1 && path[0] === 'notices' && isMethod(request, 'POST')) return createNoticeHandler(request);
  if (path.length === 2 && path[0] === 'notices' && isMethod(request, 'DELETE')) return deleteNoticeHandler(request, path[1]);
  if (path.length === 1 && path[0] === 'feature-flags' && isMethod(request, 'GET')) return listFeatureFlagsHandler(request);
  if (path.length === 2 && path[0] === 'feature-flags' && isMethod(request, 'PATCH')) return patchFeatureFlagHandler(request, path[1]);
  if (path.length === 2 && path[0] === 'automation' && path[1] === 'runs' && isMethod(request, 'GET')) return listAutomationRunsHandler(request);
  if (path.length === 1 && path[0] === 'incidents' && isMethod(request, 'GET')) return listIncidentsHandler(request);
  if (path.length === 1 && path[0] === 'incidents' && isMethod(request, 'POST')) return createIncidentHandler(request);
  if (path.length === 2 && path[0] === 'incidents' && isMethod(request, 'PATCH')) return patchIncidentHandler(request, path[1]);
  if (path.length === 3 && path[0] === 'incidents' && path[2] === 'link-conversations' && isMethod(request, 'POST')) return linkIncidentConversationsHandler(request, path[1]);
  if (path.length === 3 && path[0] === 'incidents' && path[2] === 'broadcast' && isMethod(request, 'POST')) return broadcastIncidentHandler(request, path[1]);
  if (path.length === 2 && path[0] === 'moderation' && path[1] === 'reports' && isMethod(request, 'GET')) return listModerationReportsHandler(request);
  if (path.length === 4 && path[0] === 'moderation' && path[1] === 'reports' && path[3] === 'resolve' && isMethod(request, 'POST')) return resolveModerationReportHandler(request, path[2]);
  httpError(404, `Admin route not found: /${path.join('/')}`);
};

export const handleAdminRoute = async (request: NextRequest, pathSegments: string[]): Promise<Response> => {
  const safePath = Array.isArray(pathSegments) ? pathSegments.map((segment) => asString(segment)).filter(Boolean) : [];
  if (isAdminOpsProxyMode()) return proxyWithAdminOpsHeaders(request, ['admin', ...safePath]);
  try {
    return await handleNativeAdminRoute(request, safePath);
  } catch (error) {
    const status = typeof error?.status === 'number' ? Number(error.status) : 500;
    const detail = error instanceof Error ? error.message : 'Admin request failed.';
    return json({ error: detail }, status);
  }
};

export const handleOpsRoute = async (request: NextRequest, pathSegments: string[]): Promise<Response> => {
  const safePath = Array.isArray(pathSegments) ? pathSegments.map((segment) => asString(segment)).filter(Boolean) : [];
  if (isAdminOpsProxyMode()) return proxyWithAdminOpsHeaders(request, ['ops', ...safePath]);
  try {
    if (safePath.length === 0) return json({ ok: true, domain: 'ops' });
    if (isMethod(request, 'OPTIONS')) return new Response(null, { status: 204, headers: { 'x-vf-admin-ops-mode': 'native' } });
    if (safePath.length === 2 && safePath[0] === 'guardian' && safePath[1] === 'status' && isMethod(request, 'GET')) return guardianStatusHandler(request);
    if (safePath.length === 2 && safePath[0] === 'guardian' && safePath[1] === 'approvals' && isMethod(request, 'GET')) return guardianApprovalsHandler(request);
    if (safePath.length === 2 && safePath[0] === 'guardian' && safePath[1] === 'actions' && isMethod(request, 'POST')) return guardianActionsHandler(request);
    httpError(404, `Ops route not found: /${safePath.join('/')}`);
  } catch (error) {
    const status = typeof error?.status === 'number' ? Number(error.status) : 500;
    const detail = error instanceof Error ? error.message : 'Ops request failed.';
    return json({ error: detail }, status);
  }
};
