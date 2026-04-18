import { authFetch } from './authHttpClient';
import { AccountEntitlements } from './accountService';
import { parseResponseError, readJsonOrThrow } from '../src/shared/api/httpClient';
import { resolveApiBaseUrl } from '../src/shared/api/config';

const normalizeAdminApiRoot = (value: string): string => {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  if (!normalized) return '/api/v1';
  return normalized
    .replace(/\/api\/backend(?:\/(?:admin|ops))?$/i, '/api/v1')
    .replace(/\/api\/v1\/(?:admin|ops)$/i, '/api/v1');
};

const toBaseUrl = (input?: string): string => {
  return normalizeAdminApiRoot(resolveApiBaseUrl(input));
};

export const ADMIN_READ_TIMEOUT_MS = 12000;
const ADMIN_UNLOCK_STORAGE_KEY = 'vf_admin_unlock_token';

let adminUnlockTokenMemory = '';

const purgeLegacyAdminUnlockTokenStorage = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage?.removeItem(ADMIN_UNLOCK_STORAGE_KEY);
  } catch {
    // Ignore storage failures in constrained environments.
  }
};

export const setAdminUnlockToken = (token: string): void => {
  adminUnlockTokenMemory = String(token || '').trim();
  purgeLegacyAdminUnlockTokenStorage();
};

export const clearAdminUnlockToken = (): void => {
  adminUnlockTokenMemory = '';
  purgeLegacyAdminUnlockTokenStorage();
};

export const getAdminUnlockToken = (): string => {
  if (!adminUnlockTokenMemory) {
    purgeLegacyAdminUnlockTokenStorage();
  }
  return adminUnlockTokenMemory;
};

const adminAuthFetch: typeof authFetch = (url, init, options) => {
  const method = String(init?.method || 'GET').toUpperCase();
  const resolvedOptions = (
    method === 'GET' && !Number.isFinite(Number(options?.timeoutMs))
      ? { ...(options || {}), timeoutMs: ADMIN_READ_TIMEOUT_MS }
      : options
  );
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    const token = getAdminUnlockToken();
    if (token) {
      const headers = new Headers(init?.headers || {});
      if (!headers.has('X-Admin-Unlock')) {
        headers.set('X-Admin-Unlock', `Bearer ${token}`);
      }
      return authFetch(url, { ...(init || {}), headers }, resolvedOptions);
    }
  }
  return authFetch(url, init, resolvedOptions);
};

export interface AdminUserSummary {
  uid: string;
  userId?: string;
  email: string;
  displayName: string;
  disabled: boolean;
  admin: boolean;
  role?: string;
  permissions?: string[];
  status?: string;
  plan: 'Free' | 'Launcher' | 'Starter' | 'Creator' | 'Pro' | 'Scale';
  accountStatus?: string;
  features?: {
    earlyAccess?: boolean;
  };
  limits?: {
    maxCharsPerGeneration?: number;
  };
  wallet: {
    paidVfBalance: number;
    vffBalance: number;
    vcFreeBalance?: number;
    vcGrantedBalance?: number;
    vcPaidBalance?: number;
    vcSpendableBalance?: number;
  };
  usage: {
    monthlyVfUsed: number;
    dailyGenerationUsed: number;
  };
}

export interface AdminUserVcGrantRecord {
  id: string;
  amount: number;
  createdAt?: string;
  note?: string;
  requestId?: string;
  actorUid?: string;
  actorUserId?: string;
  before?: {
    vcFreeBalance?: number;
    vcGrantedBalance?: number;
    vcPaidBalance?: number;
    vcSpendableBalance?: number;
  };
  after?: {
    vcFreeBalance?: number;
    vcGrantedBalance?: number;
    vcPaidBalance?: number;
    vcSpendableBalance?: number;
  };
}

export interface AdminCoupon {
  id: string;
  code: string;
  couponType?: 'wallet_credit' | 'subscription_discount';
  creditVf?: number;
  usagePolicy?: 'single_global' | 'single_per_user' | 'max_redemptions';
  usageLimit?: number;
  active: boolean;
  maxRedemptions?: number;
  redeemedCount?: number;
  reservedCount?: number;
  expiresAt?: string | null;
  discountType?: 'percent' | 'fixed_inr';
  percentOff?: number;
  amountOffInr?: number;
  appliesToPlans?: string[];
  planDiscounts?: Record<string, {
    plan?: string;
    discountType?: 'percent' | 'fixed_inr';
    percentOff?: number;
    amountOffInr?: number;
    stripeCouponId?: string;
    stripePromotionCodeId?: string;
  }>;
  stripeCouponsByPlan?: Record<string, string>;
  subscriptionDuration?: 'first_invoice_only' | string;
  stripeCouponId?: string;
  stripePromotionCodeId?: string;
  note?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminSessionUnlockStatus {
  recordId?: string;
  unlockRequired?: boolean;
  hasIssuedKey?: boolean;
  isLocked?: boolean;
  lockedUntil?: string;
  lockedUntilMs?: number;
  isUnlocked?: boolean;
  unlockExpiresAt?: string;
  unlockExpiresAtMs?: number;
  keyExpiresAt?: string;
  keyExpiresAtMs?: number;
  failedAttempts?: number;
  attemptsRemaining?: number;
}

export interface AdminSessionUnlockIssuePayload {
  ok: boolean;
  uid?: string;
  unlockKey?: string;
  keyExpiresAt?: string;
  keyExpiresAtMs?: number;
  status?: AdminSessionUnlockStatus;
}

export interface AdminSessionUnlockVerifyPayload {
  ok: boolean;
  uid?: string;
  unlockToken?: string;
  expiresAt?: string;
  expiresAtMs?: number;
  status?: AdminSessionUnlockStatus;
}

export interface AdminSessionUnlockStatusPayload {
  ok: boolean;
  uid?: string;
  status?: AdminSessionUnlockStatus;
}

export interface GeminiServiceAccountSlotHealth {
  healthy?: boolean;
  status?: string;
  reason?: string;
  lastCheckedAt?: string;
}

export interface GeminiServiceAccountSlotUsage {
  requests?: number;
  tokens?: number;
  failures?: number;
  lastUsedAt?: string;
  lastFailureAt?: string;
}

export interface GeminiServiceAccountSlot {
  slotId?: string;
  label?: string;
  status?: string;
  health?: GeminiServiceAccountSlotHealth;
  usage?: GeminiServiceAccountSlotUsage;
  inFlight?: number;
  lastUsedAt?: string;
  lastFailureAt?: string;
  lastFailureReason?: string;
  quarantinedUntil?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GeminiSlotStatusPayload {
  ok: boolean;
  detail?: string;
  warnings?: string[];
  updatedAt?: string;
  slots?: GeminiServiceAccountSlot[];
  backend?: {
    ok?: boolean;
    updatedAt?: string;
    lastCheckedAt?: string;
    slotCount?: number;
    slots?: GeminiServiceAccountSlot[];
    [key: string]: unknown;
  };
  runtime?: {
    ok?: boolean;
    updatedAt?: string;
    lastCheckedAt?: string;
    slotCount?: number;
    slots?: GeminiServiceAccountSlot[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface GeminiSlotUsagePayload {
  ok: boolean;
  updatedAt?: string;
  slots?: GeminiServiceAccountSlot[];
  backend?: {
    ok?: boolean;
    updatedAt?: string;
    lastCheckedAt?: string;
    slotCount?: number;
    slots?: GeminiServiceAccountSlot[];
    usage?: Record<string, GeminiServiceAccountSlot>;
    [key: string]: unknown;
  };
  runtime?: {
    ok?: boolean;
    updatedAt?: string;
    lastCheckedAt?: string;
    slotCount?: number;
    slots?: GeminiServiceAccountSlot[];
    usage?: Record<string, GeminiServiceAccountSlot>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface DailyUsageResetSummary {
  ok: boolean;
  dryRun?: boolean;
  mode?: string;
  dayKey?: string;
  periodKey?: string;
  usersAffected?: number;
  docsCleared?: number;
  requestedBy?: string;
  ranAt?: string;
  reservedEventsToday?: number | null;
}

export interface DailyUsageResetStatusPayload {
  ok: boolean;
  status: 'never_run' | 'available';
  lastRun?: DailyUsageResetSummary;
}

export interface AdminIntegrationsUsagePayload {
  ok: boolean;
  windows?: Record<string, {
    requests?: number;
    success?: number;
    clientErrors?: number;
    serverErrors?: number;
    errorRatePct?: number;
    avgLatencyMs?: number;
    p95LatencyMs?: number;
    maxLatencyMs?: number;
  }>;
  integrations?: Array<{
    integration: string;
    windows?: Record<string, {
      requests?: number;
      success?: number;
      clientErrors?: number;
      serverErrors?: number;
      errorRatePct?: number;
      avgLatencyMs?: number;
      p95LatencyMs?: number;
      maxLatencyMs?: number;
    }>;
  }>;
  gateway?: Record<string, unknown>;
  jobQueue?: Record<string, unknown>;
}

export interface OpsGuardianStatusPayload {
  ok: boolean;
  pendingApprovalCount?: number;
  issues?: Array<Record<string, unknown>>;
  concurrency?: Record<string, unknown>;
  runtimes?: Record<string, unknown>;
  geminiPool?: Record<string, unknown>;
  routeStats?: Record<string, unknown>;
}

export interface OpsGuardianApprovalsPayload {
  ok: boolean;
  status: string;
  count: number;
  approvals: Array<Record<string, unknown>>;
}

export type AdminPermission =
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

export interface AdminRoleCatalogPayload {
  ok: boolean;
  roles: string[];
  permissions: AdminPermission[];
  matrix: Record<string, AdminPermission[]>;
}

export interface AdminRoleAssignment {
  uid: string;
  userId?: string;
  role: string;
  allowOverrides?: AdminPermission[];
  denyOverrides?: AdminPermission[];
  status: 'active' | 'disabled' | string;
  version?: number;
  updatedAt?: string;
  updatedBy?: string;
}

export interface AdminActor {
  uid: string;
  userId?: string;
  role: string;
  status: 'active' | 'disabled' | string;
  permissions: AdminPermission[];
  source?: string;
  allowOverrides?: AdminPermission[];
  denyOverrides?: AdminPermission[];
}

export interface AdminRoleAssignmentsPayload {
  ok: boolean;
  items: AdminRoleAssignment[];
  count: number;
  nextCursor?: string | null;
}

export interface AuditEvent {
  eventId: string;
  ts: string;
  actorUid: string;
  actorUserId?: string;
  actorRole?: string;
  subjectUid?: string;
  subjectUserId?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId?: string;
  sequence?: number;
  prevHash?: string;
  eventHash?: string;
  meta?: Record<string, unknown>;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface AuditEventsPayload {
  ok: boolean;
  items: AuditEvent[];
  count: number;
  nextCursor?: string | null;
}

export interface AuditVerifyPayload {
  ok: boolean;
  checked: number;
  mismatchAtSequence?: number | null;
  mismatchEventId?: string | null;
}

export interface AudioMetadataRecord {
  auditId: string;
  uid: string;
  userId?: string;
  identityType?: string;
  identityValue?: string;
  provenance?: Record<string, unknown> | null;
  outputSha256?: string;
  audibleLabelApplied?: boolean;
  watermarkMode?: string;
  watermarkId?: string;
  watermarkVersion?: string;
  watermarkDetectable?: boolean;
  c2paStatus?: string;
  c2paManifestRef?: string;
  provenanceVersion?: string;
  provenanceError?: string;
  email?: string;
  phoneNumber?: string;
  submittedAt?: string;
  audioCreatedAt?: string;
  terminalAt?: string;
  status: string;
  failureCode?: string;
  failureDetail?: string;
  engine?: string;
  voiceId?: string;
  voiceName?: string;
  language?: string;
  requestId?: string;
  jobId?: string;
  traceId?: string;
  inputText?: string;
  textPreview?: string;
  sourceIp?: string;
  ipHash?: string;
  paymentRefType?: string;
  paymentRef?: string;
  retentionDeleteAfter?: string;
}

export interface AudioMetadataFilters {
  uid?: string;
  userId?: string;
  identityValue?: string;
  paymentRef?: string;
  status?: string;
  engine?: string;
  outputSha256?: string;
  watermarkId?: string;
  c2paStatus?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface AudioMetadataListPayload {
  ok: boolean;
  items: AudioMetadataRecord[];
  count: number;
  nextCursor?: string | null;
}

export interface AlertPolicy {
  id: string;
  name: string;
  metricKey: string;
  operator: string;
  threshold: number;
  windowSec: number;
  cooldownSec: number;
  severity: string;
  enabled: boolean;
  channels: string[];
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AlertDestination {
  id: string;
  type: 'webhook' | string;
  name: string;
  url: string;
  secretRef?: string;
  enabled: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AlertEvent {
  id: string;
  policyId: string;
  status: 'open' | 'ack' | 'resolved' | string;
  severity?: string;
  openedAt?: string;
  lastTriggeredAt?: string;
  resolvedAt?: string | null;
  samples?: Array<Record<string, unknown>>;
  delivery?: Array<Record<string, unknown>>;
  note?: string;
}

export interface ScheduledTask {
  id: string;
  taskType: string;
  cronExpr: string;
  timezone: string;
  enabled: boolean;
  dryRun: boolean;
  payload?: Record<string, unknown>;
  concurrencyPolicy: 'forbid' | 'replace' | 'allow' | string;
  nextRunAt?: string;
  lastRunAt?: string | null;
  lastResult?: Record<string, unknown>;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ScheduledTaskRun {
  id: string;
  taskId: string;
  taskType?: string;
  scheduledAt?: string;
  startedAt?: string;
  finishedAt?: string | null;
  status: string;
  result?: Record<string, unknown>;
  error?: string;
  dryRun?: boolean;
  requestedBy?: string;
}

export interface CouponAnalyticsSummary {
  checkoutsStarted: number;
  checkoutsCompleted: number;
  subscriptionsActivated: number;
  cancellationsWithin30d: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  conversionRate: number;
  checkoutCompletionRate: number;
  d30ChurnRate: number;
  discountEfficiency: number;
}

export interface CouponAnalyticsPoint extends CouponAnalyticsSummary {
  bucket?: string;
  date?: string;
  plan?: string;
  couponCode?: string;
}

export interface AccountingRevenueSummary {
  paidInr: number;
  accruedInr: number;
  unpaidInr: number;
  taxInr: number;
}

export interface AccountingExpenditureSummary {
  walletInr: number;
  couponDiscountInr: number;
  cloudRunCpuInr: number;
  geminiInr: number;
  totalInr: number;
}

export interface AccountingGeminiSummary {
  generations: number;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostInr: number;
  fallbackEstimatedCount: number;
}

export interface AccountingCloudRunSummary {
  cpuCostInr: number;
}

export interface AccountingSummary {
  revenue: AccountingRevenueSummary;
  expenditure: AccountingExpenditureSummary;
  marginInr: number;
  marginPct: number;
  invoices: { paid: number; unpaid: number; total: number };
  gemini: AccountingGeminiSummary;
  cloudRun: AccountingCloudRunSummary;
}

export interface AccountingTimeseriesPoint {
  bucket: string;
  revenuePaidInr?: number;
  revenueAccruedInr?: number;
  revenueUnpaidInr?: number;
  taxAccruedInr?: number;
  walletExpenditureInr?: number;
  couponDiscountInr?: number;
  cloudRunCpuCostInr?: number;
  geminiCostInr?: number;
  geminiGenerations?: number;
  geminiPromptTokens?: number;
  geminiOutputTokens?: number;
  geminiTotalTokens?: number;
}

export interface AccountingRecord {
  id: string;
  timestamp: string;
  day: string;
  type: string;
  status: string;
  amountInr: number;
  paidInr?: number;
  unpaidInr?: number;
  taxInr?: number;
  currency?: string;
  amountOriginal?: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface AccountingSourceStatus {
  stripeInvoices?: string;
  cloudRunCpu?: string;
  usageEvents?: string;
}

export interface AccountingMonitorRun {
  id: string;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  requestedBy?: string;
  source?: string;
  dryRun?: boolean;
  anomalies?: Array<Record<string, unknown>>;
  alertActions?: Array<Record<string, unknown>>;
  status?: string;
  warnings?: string[];
}

export interface AdminTeam {
  teamId: string;
  name: string;
  slug: string;
  status: string;
  ownerUid: string;
  ownerUserId?: string;
  seatLimit: number;
  memberCount?: number;
  activeMembers?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminTeamMember {
  id?: string;
  teamId: string;
  uid: string;
  userId?: string;
  role: 'owner' | 'admin' | 'member' | 'viewer' | string;
  status: string;
  joinedAt?: string;
  invitedBy?: string;
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

export interface SupportAiPolicy {
  enabled: boolean;
  confidenceThreshold: number;
  maxAutoRepliesPerConversation: number;
  allowedActions: string[];
  blockedTopics: string[];
  requireHumanForTags: string[];
  updatedAt?: string;
  updatedBy?: string;
}

export interface AdminNotice {
  id: string;
  title: string;
  message: string;
  details?: string | null;
  severity?: 'success' | 'info' | 'warning' | 'error' | 'critical' | string;
  audience?: 'all' | 'admin' | 'user' | string;
  channel?: 'toast' | 'inbox' | 'silent' | string;
  status?: 'active' | 'deleted' | string;
  expiresAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
  isActive?: boolean;
  isExpired?: boolean;
  [key: string]: unknown;
}

export type VoiceCloneProviderKey = 'modal';

export interface VoiceCloneProviderRuntimeStatus {
  configured?: boolean;
  ready?: boolean;
  detail?: string;
  device?: string;
}

export interface VoiceCloneProviderStatusPayload {
  ok: boolean;
  activeProvider: VoiceCloneProviderKey | string;
  defaultProvider?: VoiceCloneProviderKey | string;
  provider?: VoiceCloneProviderKey | string;
  providerLabel?: string;
  configured?: boolean;
  ready?: boolean;
  detail?: string;
  device?: string;
  expectedGpuConcurrency?: number;
  runtimeGpuConcurrency?: number;
  concurrencyVerified?: boolean;
  revision?: number;
  updatedAt?: string;
  updatedBy?: string;
  providerStatus?: (VoiceCloneProviderRuntimeStatus & {
    key?: VoiceCloneProviderKey | string;
    expectedGpuConcurrency?: number;
    runtimeGpuConcurrency?: number;
    concurrencyVerified?: boolean;
  }) | null;
}

export const fetchAdminUsers = async (
  baseUrl?: string,
  options?: { q?: string; limit?: number }
): Promise<AdminUserSummary[]> => {
  const query = new URLSearchParams();
  if (options?.q?.trim()) query.set('q', options.q.trim());
  if (Number.isFinite(options?.limit)) query.set('limit', String(options?.limit));
  const payload = await readJsonOrThrow<{ users?: AdminUserSummary[] }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/users${query.toString() ? `?${query.toString()}` : ''}`,
    undefined,
    { requireAuth: true }
  ));
  return Array.isArray(payload?.users) ? (payload.users as AdminUserSummary[]) : [];
};

export const fetchAdminVoiceCloneProvider = async (
  baseUrl?: string
): Promise<VoiceCloneProviderStatusPayload> => readJsonOrThrow<VoiceCloneProviderStatusPayload>(await adminAuthFetch(
  `${toBaseUrl(baseUrl)}/admin/voice-clone/provider`,
  undefined,
  { requireAuth: true }
));

export const patchAdminVoiceCloneProvider = async (
  input: { activeProvider: VoiceCloneProviderKey | string },
  baseUrl?: string
): Promise<VoiceCloneProviderStatusPayload> => readJsonOrThrow<VoiceCloneProviderStatusPayload>(await adminAuthFetch(
  `${toBaseUrl(baseUrl)}/admin/voice-clone/provider`,
  {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  },
  { requireAuth: true }
));

export const patchAdminUser = async (
  uid: string,
  patch: {
    plan?: 'Free' | 'Launcher' | 'Starter' | 'Creator' | 'Pro' | 'Scale' | string;
    paidVfDelta?: number;
    vffDelta?: number;
    disabled?: boolean;
  },
  baseUrl?: string
): Promise<AccountEntitlements> => {
  const payload = await readJsonOrThrow<{ entitlements: AccountEntitlements }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/users/${encodeURIComponent(uid)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
    { requireAuth: true }
  ));
  return payload?.entitlements as AccountEntitlements;
};

export const fetchAdminUserVcGrants = async (
  uid: string,
  options?: { limit?: number },
  baseUrl?: string
): Promise<AdminUserVcGrantRecord[]> => {
  const query = new URLSearchParams();
  if (Number.isFinite(options?.limit)) query.set('limit', String(options?.limit));
  const payload = await readJsonOrThrow<{ items?: AdminUserVcGrantRecord[] }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/billing/users/${encodeURIComponent(uid)}/vc-grants${query.toString() ? `?${query.toString()}` : ''}`,
    undefined,
    { requireAuth: true }
  ));
  return Array.isArray(payload?.items) ? payload.items : [];
};

export const grantAdminUserVc = async (
  uid: string,
  input: { amount: number; note?: string; requestId?: string },
  baseUrl?: string
): Promise<{ entitlements: AccountEntitlements; items: AdminUserVcGrantRecord[] }> => {
  const payload = await readJsonOrThrow<{ entitlements: AccountEntitlements; items?: AdminUserVcGrantRecord[] }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/billing/users/${encodeURIComponent(uid)}/vc-grants`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { requireAuth: true }
  ));
  return {
    entitlements: payload.entitlements as AccountEntitlements,
    items: Array.isArray(payload?.items) ? payload.items : [],
  };
};

export const forceAdminUserIdChange = async (
  uid: string,
  input: { userId: string; reason?: string },
  baseUrl?: string
): Promise<{ uid: string; userId: string }> => {
  const payload = await readJsonOrThrow<{ profile?: { uid?: string; userId?: string } }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/users/${encodeURIComponent(uid)}/force-user-id`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { requireAuth: true }
  ));
  return {
    uid: String(payload?.profile?.uid || uid),
    userId: String(payload?.profile?.userId || '').trim().toLowerCase(),
  };
};

export const resetAdminUserPassword = async (uid: string, newPassword: string, baseUrl?: string): Promise<void> => {
  const response = await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/users/${encodeURIComponent(uid)}/reset-password`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword }),
    },
    { requireAuth: true }
  );
  if (!response.ok) throw await parseResponseError(response);
};

export const revokeAdminUserSessions = async (uid: string, baseUrl?: string): Promise<void> => {
  const response = await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/users/${encodeURIComponent(uid)}/revoke-sessions`,
    { method: 'POST' },
    { requireAuth: true }
  );
  if (!response.ok) throw await parseResponseError(response);
};

export const deleteAdminUser = async (uid: string, baseUrl?: string): Promise<void> => {
  const response = await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/users/${encodeURIComponent(uid)}`,
    { method: 'DELETE' },
    { requireAuth: true }
  );
  if (!response.ok) throw await parseResponseError(response);
};

export const createAdminCoupon = async (
  input: {
    code: string;
    couponType?: 'wallet_credit' | 'subscription_discount';
    creditVf?: number;
    usagePolicy?: 'single_global' | 'single_per_user' | 'max_redemptions';
    usageLimit?: number;
    maxRedemptions?: number; // legacy alias
    expiresAt?: string;
    discountType?: 'percent' | 'fixed_inr';
    percentOff?: number;
    amountOffInr?: number;
    appliesToPlans?: string[];
    planDiscounts?: Array<{
      plan: string;
      discountType?: 'percent' | 'fixed_inr';
      percentOff?: number;
      amountOffInr?: number;
    }>;
    active?: boolean;
    note?: string;
  },
  baseUrl?: string
): Promise<AdminCoupon> => {
  const payload = await readJsonOrThrow<{ coupon: AdminCoupon }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/coupons`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { requireAuth: true }
  ));
  return payload?.coupon as AdminCoupon;
};

export const generateAdminCouponCode = async (
  baseUrl?: string,
  options?: { prefix?: string; length?: number }
): Promise<string> => {
  const query = new URLSearchParams();
  if (options?.prefix?.trim()) query.set('prefix', options.prefix.trim());
  if (Number.isFinite(options?.length)) query.set('length', String(options?.length));
  const payload = await readJsonOrThrow<{ code?: string }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/coupons/generate-code${query.toString() ? `?${query.toString()}` : ''}`,
    { method: 'POST' },
    { requireAuth: true }
  ));
  return String(payload?.code || '').trim();
};

export const fetchAdminCoupons = async (
  baseUrl?: string,
  options?: number | { limit?: number; couponType?: 'wallet_credit' | 'subscription_discount' | string }
): Promise<AdminCoupon[]> => {
  const limit = typeof options === 'number' ? options : options?.limit ?? 100;
  const couponType = typeof options === 'number' ? '' : String(options?.couponType || '').trim();
  const query = new URLSearchParams();
  query.set('limit', String(limit));
  if (couponType) query.set('couponType', couponType);
  const payload = await readJsonOrThrow<{ coupons?: AdminCoupon[] }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/coupons?${query.toString()}`,
    undefined,
    { requireAuth: true }
  ));
  return Array.isArray(payload?.coupons) ? (payload.coupons as AdminCoupon[]) : [];
};

export const patchAdminCoupon = async (
  couponId: string,
  patch: {
    active?: boolean;
    creditVf?: number;
    usagePolicy?: 'single_global' | 'single_per_user' | 'max_redemptions';
    usageLimit?: number;
    maxRedemptions?: number;
    expiresAt?: string;
    note?: string;
    appliesToPlans?: string[];
    planDiscounts?: Array<{
      plan: string;
      discountType?: 'percent' | 'fixed_inr';
      percentOff?: number;
      amountOffInr?: number;
    }>;
  },
  baseUrl?: string
): Promise<AdminCoupon> => {
  const payload = await readJsonOrThrow<{ coupon: AdminCoupon }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/coupons/${encodeURIComponent(couponId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
    { requireAuth: true }
  ));
  return payload?.coupon as AdminCoupon;
};

export const fetchGeminiSlotStatus = async (baseUrl?: string): Promise<GeminiSlotStatusPayload> => (
  readJsonOrThrow<GeminiSlotStatusPayload>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/gemini/pools`,
    undefined,
    { requireAuth: true }
  ))
);

export const fetchGeminiSlotUsage = async (baseUrl?: string): Promise<GeminiSlotUsagePayload> => (
  readJsonOrThrow<GeminiSlotUsagePayload>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/gemini/pools/usage`,
    undefined,
    { requireAuth: true }
  ))
);

export const resetDailyUsageAll = async (baseUrl?: string, dryRun = false): Promise<DailyUsageResetSummary> => (
  readJsonOrThrow<DailyUsageResetSummary>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/usage/reset-daily-all${dryRun ? '?dryRun=1' : ''}`,
    { method: 'POST' },
    { requireAuth: true }
  ))
);

export const fetchDailyUsageResetStatus = async (baseUrl?: string): Promise<DailyUsageResetStatusPayload> => (
  readJsonOrThrow<DailyUsageResetStatusPayload>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/usage/reset-daily-all/status`,
    undefined,
    { requireAuth: true }
  ))
);

export const fetchAdminIntegrationsUsage = async (baseUrl?: string): Promise<AdminIntegrationsUsagePayload> => (
  readJsonOrThrow<AdminIntegrationsUsagePayload>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/integrations/usage`,
    undefined,
    { requireAuth: true }
  ))
);

export const fetchAdminTtsGatewayStatus = async (baseUrl?: string): Promise<Record<string, unknown>> => (
  readJsonOrThrow<Record<string, unknown>>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/tts/gateway/status`,
    undefined,
    { requireAuth: true }
  ))
);

export const fetchAdminTtsQueueMetrics = async (baseUrl?: string): Promise<Record<string, unknown>> => (
  readJsonOrThrow<Record<string, unknown>>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/tts/queue/metrics`,
    undefined,
    { requireAuth: true }
  ))
);

export const issueAdminSessionUnlock = async (baseUrl?: string): Promise<AdminSessionUnlockIssuePayload> => (
  readJsonOrThrow<AdminSessionUnlockIssuePayload>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/session-unlock/issue`,
    { method: 'POST' },
    { requireAuth: true }
  ))
);

export const verifyAdminSessionUnlock = async (
  unlockKey: string,
  baseUrl?: string
): Promise<AdminSessionUnlockVerifyPayload> => {
  const payload = await readJsonOrThrow<AdminSessionUnlockVerifyPayload>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/session-unlock/verify`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unlockKey }),
    },
    { requireAuth: true }
  ));
  const token = String(payload?.unlockToken || '').trim();
  if (token) setAdminUnlockToken(token);
  return payload;
};

export const fetchAdminSessionUnlockStatus = async (baseUrl?: string): Promise<AdminSessionUnlockStatusPayload> => (
  readJsonOrThrow<AdminSessionUnlockStatusPayload>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/session-unlock/status`,
    (() => {
      const token = getAdminUnlockToken();
      if (!token) return undefined;
      return {
        headers: {
          'X-Admin-Unlock': `Bearer ${token}`,
        },
      };
    })(),
    { requireAuth: true }
  ))
);

export const fetchOpsGuardianStatus = async (
  baseUrl?: string,
  includeRouteStats = false
): Promise<OpsGuardianStatusPayload> => (
  readJsonOrThrow<OpsGuardianStatusPayload>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/ops/guardian/status${includeRouteStats ? '?include_route_stats=1' : ''}`,
    undefined,
    { requireAuth: true }
  ))
);

export const fetchOpsGuardianApprovals = async (
  baseUrl?: string,
  status = 'pending'
): Promise<OpsGuardianApprovalsPayload> => (
  readJsonOrThrow<OpsGuardianApprovalsPayload>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/ops/guardian/approvals?status=${encodeURIComponent(status)}`,
    undefined,
    { requireAuth: true }
  ))
);

export const runOpsGuardianAction = async (
  action: string,
  options?: { payload?: Record<string, unknown>; gpu?: boolean; requireApproval?: boolean },
  baseUrl?: string
): Promise<Record<string, unknown>> => (
  readJsonOrThrow<Record<string, unknown>>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/ops/guardian/actions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        payload: options?.payload || {},
        gpu: Boolean(options?.gpu),
        requireApproval: options?.requireApproval !== false,
      }),
    },
    { requireAuth: true }
  ))
);

export const fetchAdminRbacRoles = async (baseUrl?: string): Promise<AdminRoleCatalogPayload> => (
  readJsonOrThrow<AdminRoleCatalogPayload>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/rbac/roles`,
    undefined,
    { requireAuth: true }
  ))
);

export const fetchAdminRbacUsers = async (
  baseUrl?: string,
  options?: { limit?: number; cursor?: string; q?: string }
): Promise<AdminRoleAssignmentsPayload> => {
  const query = new URLSearchParams();
  if (Number.isFinite(options?.limit)) query.set('limit', String(options?.limit));
  if (options?.cursor) query.set('cursor', String(options.cursor));
  if (options?.q) query.set('q', String(options.q));
  return readJsonOrThrow<AdminRoleAssignmentsPayload>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/rbac/users${query.toString() ? `?${query.toString()}` : ''}`,
    undefined,
    { requireAuth: true }
  ));
};

export const fetchAdminActor = async (baseUrl?: string): Promise<AdminActor> => {
  const payload = await readJsonOrThrow<{ ok: boolean; actor: AdminActor }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/actor`,
    undefined,
    { requireAuth: true }
  ));
  return payload.actor;
};

export const assignAdminRbacUser = async (
  uid: string,
  input: {
    role: string;
    allowOverrides?: string[];
    denyOverrides?: string[];
    status?: string;
  },
  baseUrl?: string
): Promise<AdminRoleAssignment> => {
  const payload = await readJsonOrThrow<{ assignment: AdminRoleAssignment }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/rbac/users/${encodeURIComponent(uid)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { requireAuth: true }
  ));
  return payload.assignment;
};

export const disableAdminRbacUser = async (
  uid: string,
  note: string,
  baseUrl?: string
): Promise<AdminRoleAssignment> => {
  const payload = await readJsonOrThrow<{ assignment: AdminRoleAssignment }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/rbac/users/${encodeURIComponent(uid)}/disable`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    },
    { requireAuth: true }
  ));
  return payload.assignment;
};

export const enableAdminRbacUser = async (
  uid: string,
  note: string,
  baseUrl?: string
): Promise<AdminRoleAssignment> => {
  const payload = await readJsonOrThrow<{ assignment: AdminRoleAssignment }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/rbac/users/${encodeURIComponent(uid)}/enable`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    },
    { requireAuth: true }
  ));
  return payload.assignment;
};

export const fetchAdminAuditEvents = async (
  baseUrl?: string,
  options?: {
    actorUid?: string;
    actorUserId?: string;
    subjectUid?: string;
    subjectUserId?: string;
    action?: string;
    resourceType?: string;
    from?: string;
    to?: string;
    cursor?: string;
    limit?: number;
  }
): Promise<AuditEventsPayload> => {
  const query = new URLSearchParams();
  if (options?.actorUid) query.set('actorUid', String(options.actorUid));
  if (options?.actorUserId) query.set('actorUserId', String(options.actorUserId));
  if (options?.subjectUid) query.set('subjectUid', String(options.subjectUid));
  if (options?.subjectUserId) query.set('subjectUserId', String(options.subjectUserId));
  if (options?.action) query.set('action', String(options.action));
  if (options?.resourceType) query.set('resourceType', String(options.resourceType));
  if (options?.from) query.set('from', String(options.from));
  if (options?.to) query.set('to', String(options.to));
  if (options?.cursor) query.set('cursor', String(options.cursor));
  if (Number.isFinite(options?.limit)) query.set('limit', String(options?.limit));
  return readJsonOrThrow<AuditEventsPayload>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/audit/events${query.toString() ? `?${query.toString()}` : ''}`,
    undefined,
    { requireAuth: true }
  ));
};

export const fetchAdminAuditEventById = async (eventId: string, baseUrl?: string): Promise<AuditEvent> => {
  const payload = await readJsonOrThrow<{ event: AuditEvent }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/audit/events/${encodeURIComponent(eventId)}`,
    undefined,
    { requireAuth: true }
  ));
  return payload.event;
};

const buildAudioMetadataQuery = (options?: AudioMetadataFilters): string => {
  const query = new URLSearchParams();
  if (options?.uid?.trim()) query.set('uid', options.uid.trim());
  if (options?.userId?.trim()) query.set('userId', options.userId.trim());
  if (options?.identityValue?.trim()) query.set('identityValue', options.identityValue.trim());
  if (options?.paymentRef?.trim()) query.set('paymentRef', options.paymentRef.trim());
  if (options?.status?.trim()) query.set('status', options.status.trim());
  if (options?.engine?.trim()) query.set('engine', options.engine.trim());
  if (options?.outputSha256?.trim()) query.set('outputSha256', options.outputSha256.trim());
  if (options?.watermarkId?.trim()) query.set('watermarkId', options.watermarkId.trim());
  if (options?.c2paStatus?.trim()) query.set('c2paStatus', options.c2paStatus.trim());
  if (options?.from?.trim()) query.set('from', options.from.trim());
  if (options?.to?.trim()) query.set('to', options.to.trim());
  if (options?.cursor?.trim()) query.set('cursor', options.cursor.trim());
  if (Number.isFinite(options?.limit)) query.set('limit', String(options?.limit));
  return query.toString();
};

export const fetchAdminAudioMetadata = async (
  baseUrl?: string,
  options?: AudioMetadataFilters
): Promise<AudioMetadataListPayload> => {
  const query = buildAudioMetadataQuery(options);
  return readJsonOrThrow<AudioMetadataListPayload>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/audio-metadata/records${query ? `?${query}` : ''}`,
    undefined,
    { requireAuth: true }
  ));
};

export const fetchAdminAudioMetadataById = async (auditId: string, baseUrl?: string): Promise<AudioMetadataRecord> => {
  const payload = await readJsonOrThrow<{ record: AudioMetadataRecord }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/audio-metadata/records/${encodeURIComponent(auditId)}`,
    undefined,
    { requireAuth: true }
  ));
  return payload.record;
};

export const exportAdminAudioMetadataCsv = async (
  baseUrl?: string,
  options?: Omit<AudioMetadataFilters, 'cursor' | 'limit'>
): Promise<Blob> => {
  const query = buildAudioMetadataQuery(options);
  const response = await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/audio-metadata/export.csv${query ? `?${query}` : ''}`,
    undefined,
    { requireAuth: true }
  );
  if (!response.ok) throw await parseResponseError(response);
  return response.blob();
};

export const verifyAdminAuditChain = async (
  baseUrl?: string,
  options?: { fromSeq?: number; toSeq?: number; limit?: number }
): Promise<AuditVerifyPayload> => {
  const query = new URLSearchParams();
  if (Number.isFinite(options?.fromSeq)) query.set('fromSeq', String(options?.fromSeq));
  if (Number.isFinite(options?.toSeq)) query.set('toSeq', String(options?.toSeq));
  if (Number.isFinite(options?.limit)) query.set('limit', String(options?.limit));
  return readJsonOrThrow<AuditVerifyPayload>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/audit/verify-chain${query.toString() ? `?${query.toString()}` : ''}`,
    undefined,
    { requireAuth: true }
  ));
};

export const fetchAlertPolicies = async (baseUrl?: string, limit = 100): Promise<AlertPolicy[]> => {
  const payload = await readJsonOrThrow<{ items?: AlertPolicy[] }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/alerts/policies?limit=${encodeURIComponent(String(limit))}`,
    undefined,
    { requireAuth: true }
  ));
  return Array.isArray(payload?.items) ? payload.items : [];
};

export const createAlertPolicy = async (
  input: Omit<AlertPolicy, 'id'>,
  baseUrl?: string
): Promise<AlertPolicy> => {
  const payload = await readJsonOrThrow<{ policy: AlertPolicy }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/alerts/policies`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { requireAuth: true }
  ));
  return payload.policy;
};

export const patchAlertPolicy = async (
  policyId: string,
  patch: Partial<Omit<AlertPolicy, 'id'>>,
  baseUrl?: string
): Promise<AlertPolicy> => {
  const payload = await readJsonOrThrow<{ policy: AlertPolicy }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/alerts/policies/${encodeURIComponent(policyId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
    { requireAuth: true }
  ));
  return payload.policy;
};

export const fetchAlertDestinations = async (baseUrl?: string, limit = 100): Promise<AlertDestination[]> => {
  const payload = await readJsonOrThrow<{ items?: AlertDestination[] }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/alerts/destinations?limit=${encodeURIComponent(String(limit))}`,
    undefined,
    { requireAuth: true }
  ));
  return Array.isArray(payload?.items) ? payload.items : [];
};

export const createAlertDestination = async (
  input: Omit<AlertDestination, 'id'>,
  baseUrl?: string
): Promise<AlertDestination> => {
  const payload = await readJsonOrThrow<{ destination: AlertDestination }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/alerts/destinations`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { requireAuth: true }
  ));
  return payload.destination;
};

export const patchAlertDestination = async (
  destinationId: string,
  patch: Partial<Omit<AlertDestination, 'id'>>,
  baseUrl?: string
): Promise<AlertDestination> => {
  const payload = await readJsonOrThrow<{ destination: AlertDestination }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/alerts/destinations/${encodeURIComponent(destinationId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
    { requireAuth: true }
  ));
  return payload.destination;
};

export const fetchAlertEvents = async (
  baseUrl?: string,
  options?: { status?: string; limit?: number }
): Promise<AlertEvent[]> => {
  const query = new URLSearchParams();
  if (options?.status) query.set('status', options.status);
  if (Number.isFinite(options?.limit)) query.set('limit', String(options?.limit));
  const payload = await readJsonOrThrow<{ items?: AlertEvent[] }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/alerts/events${query.toString() ? `?${query.toString()}` : ''}`,
    undefined,
    { requireAuth: true }
  ));
  return Array.isArray(payload?.items) ? payload.items : [];
};

export const ackAlertEvent = async (eventId: string, note = '', baseUrl?: string): Promise<AlertEvent> => {
  const payload = await readJsonOrThrow<{ event: AlertEvent }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/alerts/events/${encodeURIComponent(eventId)}/ack`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    },
    { requireAuth: true }
  ));
  return payload.event;
};

export const resolveAlertEvent = async (eventId: string, note = '', baseUrl?: string): Promise<AlertEvent> => {
  const payload = await readJsonOrThrow<{ event: AlertEvent }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/alerts/events/${encodeURIComponent(eventId)}/resolve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    },
    { requireAuth: true }
  ));
  return payload.event;
};

export const fetchSchedulerTasks = async (baseUrl?: string, limit = 200): Promise<ScheduledTask[]> => {
  const payload = await readJsonOrThrow<{ items?: ScheduledTask[] }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/scheduler/tasks?limit=${encodeURIComponent(String(limit))}`,
    undefined,
    { requireAuth: true }
  ));
  return Array.isArray(payload?.items) ? payload.items : [];
};

export const createSchedulerTask = async (
  input: Omit<ScheduledTask, 'id' | 'lastRunAt' | 'lastResult' | 'nextRunAt' | 'createdAt' | 'updatedAt'>,
  baseUrl?: string
): Promise<ScheduledTask> => {
  const payload = await readJsonOrThrow<{ task: ScheduledTask }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/scheduler/tasks`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { requireAuth: true }
  ));
  return payload.task;
};

export const patchSchedulerTask = async (
  taskId: string,
  patch: Partial<Omit<ScheduledTask, 'id' | 'taskType'>>,
  baseUrl?: string
): Promise<ScheduledTask> => {
  const payload = await readJsonOrThrow<{ task: ScheduledTask }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/scheduler/tasks/${encodeURIComponent(taskId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
    { requireAuth: true }
  ));
  return payload.task;
};

export const runSchedulerTask = async (
  taskId: string,
  dryRun?: boolean,
  baseUrl?: string
): Promise<ScheduledTaskRun> => {
  const payload = await readJsonOrThrow<{ run: ScheduledTaskRun }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/scheduler/tasks/${encodeURIComponent(taskId)}/run`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun }),
    },
    { requireAuth: true }
  ));
  return payload.run;
};

export const fetchSchedulerRuns = async (
  baseUrl?: string,
  options?: { taskId?: string; limit?: number }
): Promise<ScheduledTaskRun[]> => {
  const query = new URLSearchParams();
  if (options?.taskId) query.set('taskId', String(options.taskId));
  if (Number.isFinite(options?.limit)) query.set('limit', String(options?.limit));
  const payload = await readJsonOrThrow<{ items?: ScheduledTaskRun[] }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/scheduler/runs${query.toString() ? `?${query.toString()}` : ''}`,
    undefined,
    { requireAuth: true }
  ));
  return Array.isArray(payload?.items) ? payload.items : [];
};

export const fetchSchedulerRunById = async (runId: string, baseUrl?: string): Promise<ScheduledTaskRun> => {
  const payload = await readJsonOrThrow<{ run: ScheduledTaskRun }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/scheduler/runs/${encodeURIComponent(runId)}`,
    undefined,
    { requireAuth: true }
  ));
  return payload.run;
};

export const fetchCouponAnalyticsSummary = async (
  baseUrl?: string,
  options?: { from?: string; to?: string; plan?: string; couponKind?: string }
): Promise<{ summary: CouponAnalyticsSummary; count: number }> => {
  const query = new URLSearchParams();
  if (options?.from) query.set('from', options.from);
  if (options?.to) query.set('to', options.to);
  if (options?.plan) query.set('plan', options.plan);
  if (options?.couponKind) query.set('couponKind', options.couponKind);
  const payload = await readJsonOrThrow<{ summary: CouponAnalyticsSummary; count: number }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/analytics/coupons/summary${query.toString() ? `?${query.toString()}` : ''}`,
    undefined,
    { requireAuth: true }
  ));
  return payload;
};

export const fetchCouponAnalyticsTimeseries = async (
  baseUrl?: string,
  options?: { from?: string; to?: string; groupBy?: 'day' | 'week'; plan?: string; couponKind?: string }
): Promise<{ groupBy: string; series: CouponAnalyticsPoint[]; count: number }> => {
  const query = new URLSearchParams();
  if (options?.from) query.set('from', options.from);
  if (options?.to) query.set('to', options.to);
  if (options?.groupBy) query.set('groupBy', options.groupBy);
  if (options?.plan) query.set('plan', options.plan);
  if (options?.couponKind) query.set('couponKind', options.couponKind);
  const payload = await readJsonOrThrow<{ groupBy: string; series: CouponAnalyticsPoint[]; count: number }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/analytics/coupons/timeseries${query.toString() ? `?${query.toString()}` : ''}`,
    undefined,
    { requireAuth: true }
  ));
  return payload;
};

export const fetchCouponAnalyticsImpact = async (
  couponCode: string,
  baseUrl?: string,
  options?: { from?: string; to?: string }
): Promise<{ couponCode: string; overall: CouponAnalyticsSummary; byPlan: CouponAnalyticsPoint[] }> => {
  const query = new URLSearchParams();
  if (options?.from) query.set('from', options.from);
  if (options?.to) query.set('to', options.to);
  const payload = await readJsonOrThrow<{ couponCode: string; overall: CouponAnalyticsSummary; byPlan: CouponAnalyticsPoint[] }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/analytics/coupons/${encodeURIComponent(couponCode)}/impact${query.toString() ? `?${query.toString()}` : ''}`,
    undefined,
    { requireAuth: true }
  ));
  return payload;
};

export const fetchAdminAccountingSummary = async (
  baseUrl?: string,
  options?: { from?: string; to?: string; includeUnpaidAccrual?: boolean }
): Promise<{
  summary: AccountingSummary;
  currency?: string;
  timezone?: string;
  sourceStatus?: AccountingSourceStatus;
  warnings?: string[];
  range?: Record<string, unknown>;
}> => {
  const query = new URLSearchParams();
  if (options?.from) query.set('from', options.from);
  if (options?.to) query.set('to', options.to);
  if (typeof options?.includeUnpaidAccrual === 'boolean') query.set('includeUnpaidAccrual', String(options.includeUnpaidAccrual));
  return readJsonOrThrow<{
    summary: AccountingSummary;
    currency?: string;
    timezone?: string;
    sourceStatus?: AccountingSourceStatus;
    warnings?: string[];
    range?: Record<string, unknown>;
  }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/accounting/summary${query.toString() ? `?${query.toString()}` : ''}`,
    undefined,
    { requireAuth: true }
  ));
};

export const fetchAdminAccountingTimeseries = async (
  baseUrl?: string,
  options?: { from?: string; to?: string; groupBy?: 'day' | 'month' | 'year'; includeUnpaidAccrual?: boolean }
): Promise<{
  groupBy: string;
  series: AccountingTimeseriesPoint[];
  count: number;
  currency?: string;
  timezone?: string;
  sourceStatus?: AccountingSourceStatus;
  warnings?: string[];
  range?: Record<string, unknown>;
}> => {
  const query = new URLSearchParams();
  if (options?.from) query.set('from', options.from);
  if (options?.to) query.set('to', options.to);
  if (options?.groupBy) query.set('groupBy', options.groupBy);
  if (typeof options?.includeUnpaidAccrual === 'boolean') query.set('includeUnpaidAccrual', String(options.includeUnpaidAccrual));
  return readJsonOrThrow<{
    groupBy: string;
    series: AccountingTimeseriesPoint[];
    count: number;
    currency?: string;
    timezone?: string;
    sourceStatus?: AccountingSourceStatus;
    warnings?: string[];
    range?: Record<string, unknown>;
  }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/accounting/timeseries${query.toString() ? `?${query.toString()}` : ''}`,
    undefined,
    { requireAuth: true }
  ));
};

export const fetchAdminAccountingRecords = async (
  baseUrl?: string,
  options?: { from?: string; to?: string; limit?: number; includeUnpaidAccrual?: boolean }
): Promise<{
  items: AccountingRecord[];
  count: number;
  currency?: string;
  timezone?: string;
  sourceStatus?: AccountingSourceStatus;
  warnings?: string[];
  range?: Record<string, unknown>;
}> => {
  const query = new URLSearchParams();
  if (options?.from) query.set('from', options.from);
  if (options?.to) query.set('to', options.to);
  if (Number.isFinite(options?.limit)) query.set('limit', String(options?.limit));
  if (typeof options?.includeUnpaidAccrual === 'boolean') query.set('includeUnpaidAccrual', String(options.includeUnpaidAccrual));
  return readJsonOrThrow<{
    items: AccountingRecord[];
    count: number;
    currency?: string;
    timezone?: string;
    sourceStatus?: AccountingSourceStatus;
    warnings?: string[];
    range?: Record<string, unknown>;
  }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/accounting/records${query.toString() ? `?${query.toString()}` : ''}`,
    undefined,
    { requireAuth: true }
  ));
};

export const fetchAdminAccountingMonitorRuns = async (
  baseUrl?: string,
  limit = 40
): Promise<{ items: AccountingMonitorRun[]; count: number }> => (
  readJsonOrThrow<{ items: AccountingMonitorRun[]; count: number }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/accounting/monitor/runs?limit=${encodeURIComponent(String(limit))}`,
    undefined,
    { requireAuth: true }
  ))
);

export const runAdminAccountingMonitor = async (
  baseUrl?: string,
  options?: { dryRun?: boolean }
): Promise<{
  runId: string;
  anomalyCount: number;
  alertActions?: Array<Record<string, unknown>>;
  summary?: Record<string, unknown>;
}> => (
  readJsonOrThrow<{
    runId: string;
    anomalyCount: number;
    alertActions?: Array<Record<string, unknown>>;
    summary?: Record<string, unknown>;
  }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/accounting/monitor/run`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: Boolean(options?.dryRun) }),
    },
    { requireAuth: true }
  ))
);

export const fetchAdminTeams = async (
  baseUrl?: string,
  options?: { q?: string; limit?: number }
): Promise<AdminTeam[]> => {
  const query = new URLSearchParams();
  if (options?.q) query.set('q', String(options.q));
  if (Number.isFinite(options?.limit)) query.set('limit', String(options?.limit));
  const payload = await readJsonOrThrow<{ items?: AdminTeam[] }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/teams${query.toString() ? `?${query.toString()}` : ''}`,
    undefined,
    { requireAuth: true }
  ));
  return Array.isArray(payload?.items) ? payload.items : [];
};

export const createAdminTeam = async (
  input: { name: string; slug: string; ownerUid: string; seatLimit?: number; status?: string },
  baseUrl?: string
): Promise<AdminTeam> => {
  const payload = await readJsonOrThrow<{ team: AdminTeam }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/teams`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { requireAuth: true }
  ));
  return payload.team;
};

export const patchAdminTeam = async (
  teamId: string,
  patch: { name?: string; slug?: string; ownerUid?: string; seatLimit?: number; status?: string },
  baseUrl?: string
): Promise<AdminTeam> => {
  const payload = await readJsonOrThrow<{ team: AdminTeam }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/teams/${encodeURIComponent(teamId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
    { requireAuth: true }
  ));
  return payload.team;
};

export const fetchAdminTeamMembers = async (
  teamId: string,
  baseUrl?: string,
  limit = 500
): Promise<AdminTeamMember[]> => {
  const payload = await readJsonOrThrow<{ items?: AdminTeamMember[] }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/teams/${encodeURIComponent(teamId)}/members?limit=${encodeURIComponent(String(limit))}`,
    undefined,
    { requireAuth: true }
  ));
  return Array.isArray(payload?.items) ? payload.items : [];
};

export const createAdminTeamMember = async (
  teamId: string,
  input: { uid: string; role?: string; status?: string },
  baseUrl?: string
): Promise<AdminTeamMember> => {
  const payload = await readJsonOrThrow<{ member: AdminTeamMember }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/teams/${encodeURIComponent(teamId)}/members`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { requireAuth: true }
  ));
  return payload.member;
};

export const patchAdminTeamMember = async (
  teamId: string,
  uid: string,
  patch: { role?: string; status?: string },
  baseUrl?: string
): Promise<AdminTeamMember> => {
  const payload = await readJsonOrThrow<{ member: AdminTeamMember }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(uid)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
    { requireAuth: true }
  ));
  return payload.member;
};

export const deleteAdminTeamMember = async (
  teamId: string,
  uid: string,
  baseUrl?: string
): Promise<void> => {
  const response = await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(uid)}`,
    { method: 'DELETE' },
    { requireAuth: true }
  );
  if (!response.ok) throw await parseResponseError(response);
};

export const fetchAdminSupportConversations = async (
  baseUrl?: string,
  options?: { status?: string; q?: string; limit?: number }
): Promise<SupportConversation[]> => {
  const query = new URLSearchParams();
  if (options?.status) query.set('status', String(options.status));
  if (options?.q) query.set('q', String(options.q));
  if (Number.isFinite(options?.limit)) query.set('limit', String(options?.limit));
  const payload = await readJsonOrThrow<{ items?: SupportConversation[] }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/support/conversations${query.toString() ? `?${query.toString()}` : ''}`,
    undefined,
    { requireAuth: true }
  ));
  return Array.isArray(payload?.items) ? payload.items : [];
};

export const fetchAdminSupportConversationById = async (
  conversationId: string,
  baseUrl?: string
): Promise<{ conversation: SupportConversation; messages: SupportMessage[] }> => {
  return readJsonOrThrow<{ conversation: SupportConversation; messages: SupportMessage[] }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/support/conversations/${encodeURIComponent(conversationId)}`,
    undefined,
    { requireAuth: true }
  ));
};

export const replyAdminSupportConversation = async (
  conversationId: string,
  text: string,
  baseUrl?: string
): Promise<{ conversation: SupportConversation; message: SupportMessage }> => (
  readJsonOrThrow<{ conversation: SupportConversation; message: SupportMessage }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/support/conversations/${encodeURIComponent(conversationId)}/reply`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    },
    { requireAuth: true }
  ))
);

export const resolveAdminSupportConversation = async (
  conversationId: string,
  baseUrl?: string
): Promise<SupportConversation> => {
  const payload = await readJsonOrThrow<{ conversation: SupportConversation }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/support/conversations/${encodeURIComponent(conversationId)}/resolve`,
    {
      method: 'POST',
    },
    { requireAuth: true }
  ));
  return payload.conversation;
};

export const fetchAdminSupportAiPolicy = async (baseUrl?: string): Promise<SupportAiPolicy> => {
  const payload = await readJsonOrThrow<{ policy: SupportAiPolicy }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/support/ai-policy`,
    undefined,
    { requireAuth: true }
  ));
  return payload.policy;
};

export const patchAdminSupportAiPolicy = async (
  patch: Partial<SupportAiPolicy>,
  baseUrl?: string
): Promise<SupportAiPolicy> => {
  const payload = await readJsonOrThrow<{ policy: SupportAiPolicy }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/support/ai-policy`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
    { requireAuth: true }
  ));
  return payload.policy;
};

export const fetchAdminBroadcastNotices = async (
  baseUrl?: string,
  options?: { status?: 'active' | 'deleted' | 'all'; limit?: number }
): Promise<AdminNotice[]> => {
  const query = new URLSearchParams();
  if (options?.status) query.set('status', String(options.status));
  if (Number.isFinite(options?.limit)) query.set('limit', String(options?.limit));
  const payload = await readJsonOrThrow<{ items?: AdminNotice[]; notices?: AdminNotice[] }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/notices${query.toString() ? `?${query.toString()}` : ''}`,
    undefined,
    { requireAuth: true }
  ));
  return Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.notices) ? payload.notices : [];
};

export const createAdminBroadcastNotice = async (
  input: {
    title?: string;
    message: string;
    details?: string;
    expiresAt: string;
    severity?: 'success' | 'info' | 'warning' | 'error' | 'critical' | string;
    audience?: 'all' | 'admin' | 'user' | string;
    channel?: 'toast' | 'inbox' | 'silent' | string;
  },
  baseUrl?: string
): Promise<AdminNotice> => {
  const payload = await readJsonOrThrow<{ notice?: AdminNotice; item?: AdminNotice }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/notices`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { requireAuth: true }
  ));
  return payload?.notice || payload?.item || ({} as AdminNotice);
};

export const deleteAdminBroadcastNotice = async (noticeId: string, baseUrl?: string): Promise<void> => {
  const response = await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/notices/${encodeURIComponent(String(noticeId || '').trim())}`,
    { method: 'DELETE' },
    { requireAuth: true }
  );
  if (!response.ok) {
    throw await parseResponseError(response);
  }
};

export const fetchAdminNotices = fetchAdminBroadcastNotices;
export const createAdminNotice = createAdminBroadcastNotice;
export const deleteAdminNotice = deleteAdminBroadcastNotice;

export interface AdminSpendAnomaly {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  metricValue?: number;
  threshold?: number;
  detectedAt?: string;
}

export interface AdminIncident {
  incidentId: string;
  title: string;
  summary?: string;
  status: 'open' | 'monitoring' | 'resolved' | string;
  severity: 'info' | 'warning' | 'critical' | string;
  domains?: string[];
  linkedConversationIds?: string[];
  noticeId?: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
}

export interface AdminFeatureFlag {
  key: string;
  enabled: boolean;
  scope?: string;
  description?: string;
  updatedAt?: string;
  updatedBy?: string;
  metadata?: Record<string, unknown>;
}

export interface AdminAutomationRun {
  runId: string;
  feature: string;
  status: 'completed' | 'failed' | 'skipped' | string;
  model: string;
  fingerprint?: string;
  sourceId?: string;
  tokenEstimate?: number;
  result?: Record<string, unknown>;
  createdAt?: string;
  expiresAt?: string;
}

export interface ModerationReport {
  reportId: string;
  subjectType: string;
  subjectId: string;
  reason: string;
  details?: string;
  status: 'open' | 'reviewing' | 'resolved' | string;
  reporterUid?: string;
  createdAt?: string;
  resolvedAt?: string;
  resolution?: string;
}

export interface AdminSupportQueueItem {
  queue: 'critical' | 'blocked' | 'incidentLinked' | 'backlog' | 'autoHandled' | string;
  count: number;
  conversations: SupportConversation[];
}

export interface AdminRuntimeSummary {
  generatedAt?: string;
  geminiPool?: Record<string, unknown>;
  ttsGateway?: Record<string, unknown>;
  ttsQueue?: Record<string, unknown>;
  guardian?: Record<string, unknown>;
  voiceCloneProvider?: Record<string, unknown>;
  flags?: AdminFeatureFlag[];
}

export interface AdminProviderCostWindow {
  todayInr: number;
  last7dInr: number;
  monthInr: number;
  trailing30dInr: number;
}

export interface AdminProviderSyncStatus {
  provider: string;
  displayName: string;
  source: string;
  status: string;
  stale: boolean;
  currency: string;
  configured: boolean;
  supported: boolean;
  providerCoverage: number;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastProviderSyncAt?: string;
  detail?: string;
}

export interface AdminProviderCostSummary extends AdminProviderSyncStatus {
  actualWindows: AdminProviderCostWindow;
  estimatedWindows?: AdminProviderCostWindow;
  estimatedVsActualDelta?: number;
  series?: Array<{ bucket: string; actualInr: number }>;
  topDrivers?: Array<{ label: string; amountInr: number; detail?: string }>;
}

export interface AdminCashAccount {
  accountId: string;
  name: string;
  type: string;
  balanceInr: number;
  editable: boolean;
  source: string;
  notes?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface AdminCashSnapshot {
  generatedAt?: string;
  availableCashInr: number;
  pendingCashInr: number;
  liabilityInr: number;
  outstandingWithdrawalsInr: number;
  fixedMonthlyBurnInr: number;
  netAvailableCashInr: number;
  accounts: AdminCashAccount[];
}

export interface AdminBudget {
  budgetId: string;
  name: string;
  scopeType: string;
  scopeKey: string;
  amountInr: number;
  currency: string;
  period: string;
  warningPct: number;
  criticalPct: number;
  status?: string;
  source: string;
  readOnly?: boolean;
  enabled: boolean;
  externalRef?: string;
  safeActions?: string[];
  metadata?: Record<string, unknown>;
  updatedAt?: string;
  updatedBy?: string;
  currentSpendInr?: number;
  remainingInr?: number;
  warningThresholdInr?: number;
  criticalThresholdInr?: number;
  riskState?: string;
  recommendedActions?: string[];
}

export interface AdminBudgetThreshold {
  riskState: string;
  warningCount: number;
  criticalCount: number;
  totalBudgetInr: number;
  items: AdminBudget[];
}

export interface AdminRunwaySnapshot {
  generatedAt?: string;
  availableCashInr: number;
  trailing30dProviderSpendInr: number;
  fixedMonthlyBurnInr: number;
  monthlyBurnInr: number;
  dailyBurnInr: number;
  runwayDays: number;
  status: string;
}

export interface AdminMoneySummary {
  generatedAt?: string;
  overview?: {
    availableCashInr: number;
    monthRevenueInr: number;
    monthProviderSpendInr: number;
    monthBurnInr: number;
    runwayDays: number;
    budgetRiskState: string;
    marginInr: number;
    estimatedProviderSpendInr?: number;
  };
  providers?: {
    generatedAt?: string;
    items: AdminProviderCostSummary[];
    staleCount?: number;
    warningCount?: number;
    lastSyncedAt?: string;
  };
  cash?: AdminCashSnapshot | null;
  budgets?: AdminBudgetThreshold | null;
  runway?: AdminRunwaySnapshot | null;
  accounting?: AccountingSummary | null;
  couponSummary?: CouponAnalyticsSummary | null;
  anomalies?: AdminSpendAnomaly[];
}

export interface AdminDashboardSummary {
  generatedAt: string;
  health: {
    status: 'ok' | 'warning' | 'critical' | string;
    activeIncidents: number;
    openAlerts: number;
    supportBacklog: number;
    queuePressure: number;
    guardIssues: number;
  };
  failuresByDomain: Record<string, number>;
  support: {
    critical: number;
    blocked: number;
    incidentLinked: number;
    backlog: number;
    autoHandled: number;
  };
  spending: {
    todayInr: number;
    last7dInr: number;
    monthInr: number;
    topCostSurface?: string;
  };
  anomalies: AdminSpendAnomaly[];
  incidents: AdminIncident[];
  featureFlags: AdminFeatureFlag[];
  recentRiskyActions: AuditEvent[];
  runtime: {
    geminiPoolStatus?: string;
    ttsGatewayStatus?: string;
    voiceCloneProvider?: string;
  };
}

export interface AdminUserTimeline {
  uid: string;
  summary: AdminUserSummary;
  entitlements: AccountEntitlements | Record<string, unknown>;
  supportConversations: SupportConversation[];
  recentAuditEvents: AuditEvent[];
  recentVcGrants: AdminUserVcGrantRecord[];
  audioFailures: AudioMetadataRecord[];
  riskIndicators: string[];
  snapshot: {
    openSupport: number;
    failedAudioJobs: number;
    vcGrantCount: number;
    accountStatus?: string;
  };
}

export const fetchAdminDashboardSummary = async (baseUrl?: string): Promise<AdminDashboardSummary> => {
  const response = await adminAuthFetch(`${toBaseUrl(baseUrl)}/admin/dashboard/summary`, undefined, { requireAuth: true });
  const payload = await readJsonOrThrow<{ summary?: AdminDashboardSummary }>(response);
  return payload.summary || (payload as unknown as AdminDashboardSummary);
};

export const fetchAdminUserTimeline = async (uid: string, baseUrl?: string): Promise<AdminUserTimeline> => {
  const response = await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/users/${encodeURIComponent(String(uid || '').trim())}/timeline`,
    undefined,
    { requireAuth: true }
  );
  const payload = await readJsonOrThrow<{ timeline?: AdminUserTimeline }>(response);
  return payload.timeline || (payload as unknown as AdminUserTimeline);
};

export const fetchAdminRuntimeSummary = async (baseUrl?: string): Promise<AdminRuntimeSummary> => {
  const response = await adminAuthFetch(`${toBaseUrl(baseUrl)}/admin/runtime/summary`, undefined, { requireAuth: true });
  const payload = await readJsonOrThrow<{ summary?: AdminRuntimeSummary }>(response);
  return payload.summary || (payload as unknown as AdminRuntimeSummary);
};

export const fetchAdminMoneySummary = async (baseUrl?: string): Promise<AdminMoneySummary> => {
  const response = await adminAuthFetch(`${toBaseUrl(baseUrl)}/admin/money/summary`, undefined, { requireAuth: true });
  const payload = await readJsonOrThrow<{ summary?: AdminMoneySummary }>(response);
  return payload.summary || (payload as unknown as AdminMoneySummary);
};

const buildAdminMutationHeaders = (idempotencyPrefix?: string, headers?: HeadersInit): HeadersInit => {
  const next = new Headers(headers || {});
  if (idempotencyPrefix) {
    next.set('X-Idempotency-Key', `${idempotencyPrefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  }
  return Object.fromEntries(next.entries());
};

export const fetchAdminMoneyProviders = async (baseUrl?: string): Promise<{ items: AdminProviderCostSummary[]; providers?: AdminMoneySummary['providers'] }> => {
  const response = await adminAuthFetch(`${toBaseUrl(baseUrl)}/admin/money/providers`, undefined, { requireAuth: true });
  const payload = await readJsonOrThrow<{ items?: AdminProviderCostSummary[]; providers?: AdminMoneySummary['providers'] }>(response);
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    providers: payload.providers,
  };
};

export const syncAdminMoneyProviders = async (
  input?: { provider?: 'gcp' | 'modal' | 'all' | string },
  baseUrl?: string,
): Promise<{ ok?: boolean; provider?: string; results?: Array<Record<string, unknown>>; summary?: AdminMoneySummary }> => {
  const response = await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/money/providers/sync`,
    {
      method: 'POST',
      headers: buildAdminMutationHeaders('money_sync', { 'content-type': 'application/json' }),
      body: JSON.stringify(input || {}),
    },
    { requireAuth: true }
  );
  return readJsonOrThrow<{ ok?: boolean; provider?: string; results?: Array<Record<string, unknown>>; summary?: AdminMoneySummary }>(response);
};

export const fetchAdminMoneyCash = async (baseUrl?: string): Promise<AdminCashSnapshot | null> => {
  const response = await adminAuthFetch(`${toBaseUrl(baseUrl)}/admin/money/cash`, undefined, { requireAuth: true });
  const payload = await readJsonOrThrow<{ cash?: AdminCashSnapshot | null }>(response);
  return payload.cash || null;
};

export const patchAdminMoneyCash = async (
  input: { accounts: Array<Partial<AdminCashAccount> & { accountId: string }> },
  baseUrl?: string,
): Promise<{ cash?: AdminCashSnapshot | null; updatedAccounts?: AdminCashAccount[] }> => {
  const response = await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/money/cash`,
    {
      method: 'PATCH',
      headers: buildAdminMutationHeaders('money_cash_patch', { 'content-type': 'application/json' }),
      body: JSON.stringify(input || {}),
    },
    { requireAuth: true }
  );
  return readJsonOrThrow<{ cash?: AdminCashSnapshot | null; updatedAccounts?: AdminCashAccount[] }>(response);
};

export const fetchAdminMoneyBudgets = async (baseUrl?: string): Promise<AdminBudgetThreshold | null> => {
  const response = await adminAuthFetch(`${toBaseUrl(baseUrl)}/admin/money/budgets`, undefined, { requireAuth: true });
  const payload = await readJsonOrThrow<{ budgets?: AdminBudgetThreshold | null }>(response);
  return payload.budgets || null;
};

export const createAdminMoneyBudget = async (
  input: Partial<AdminBudget> & { name: string; amountInr: number },
  baseUrl?: string,
): Promise<{ budget?: AdminBudget; budgets?: AdminBudgetThreshold | null; summary?: AdminMoneySummary }> => {
  const response = await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/money/budgets`,
    {
      method: 'POST',
      headers: buildAdminMutationHeaders('money_budget_create', { 'content-type': 'application/json' }),
      body: JSON.stringify(input || {}),
    },
    { requireAuth: true }
  );
  return readJsonOrThrow<{ budget?: AdminBudget; budgets?: AdminBudgetThreshold | null; summary?: AdminMoneySummary }>(response);
};

export const patchAdminMoneyBudget = async (
  budgetId: string,
  input: Partial<AdminBudget>,
  baseUrl?: string,
): Promise<{ budget?: AdminBudget; budgets?: AdminBudgetThreshold | null; summary?: AdminMoneySummary }> => {
  const response = await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/money/budgets/${encodeURIComponent(String(budgetId || '').trim())}`,
    {
      method: 'PATCH',
      headers: buildAdminMutationHeaders(`money_budget_patch_${budgetId}`, { 'content-type': 'application/json' }),
      body: JSON.stringify(input || {}),
    },
    { requireAuth: true }
  );
  return readJsonOrThrow<{ budget?: AdminBudget; budgets?: AdminBudgetThreshold | null; summary?: AdminMoneySummary }>(response);
};

export const fetchAdminMoneyAnomalies = async (baseUrl?: string): Promise<AdminSpendAnomaly[]> => {
  const response = await adminAuthFetch(`${toBaseUrl(baseUrl)}/admin/money/anomalies`, undefined, { requireAuth: true });
  const payload = await readJsonOrThrow<{ items?: AdminSpendAnomaly[] }>(response);
  return Array.isArray(payload.items) ? payload.items : [];
};

export const fetchAdminMoneyRunway = async (baseUrl?: string): Promise<AdminRunwaySnapshot | null> => {
  const response = await adminAuthFetch(`${toBaseUrl(baseUrl)}/admin/money/runway`, undefined, { requireAuth: true });
  const payload = await readJsonOrThrow<{ runway?: AdminRunwaySnapshot | null }>(response);
  return payload.runway || null;
};

export const fetchAdminSupportQueues = async (baseUrl?: string): Promise<AdminSupportQueueItem[]> => {
  const response = await adminAuthFetch(`${toBaseUrl(baseUrl)}/admin/support/queues`, undefined, { requireAuth: true });
  const payload = await readJsonOrThrow<{ items?: AdminSupportQueueItem[] }>(response);
  return Array.isArray(payload.items) ? payload.items : [];
};

export const classifyAdminSupportConversation = async (
  conversationId: string,
  baseUrl?: string
): Promise<SupportConversation> => {
  const response = await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/support/conversations/${encodeURIComponent(String(conversationId || '').trim())}/classify`,
    { method: 'POST' },
    { requireAuth: true }
  );
  const payload = await readJsonOrThrow<{ conversation?: SupportConversation }>(response);
  return payload.conversation || (payload as unknown as SupportConversation);
};

export const draftAdminSupportReply = async (
  conversationId: string,
  baseUrl?: string
): Promise<{ draft: string; run?: AdminAutomationRun }> => {
  const response = await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/support/conversations/${encodeURIComponent(String(conversationId || '').trim())}/draft-reply`,
    { method: 'POST' },
    { requireAuth: true }
  );
  return readJsonOrThrow<{ draft: string; run?: AdminAutomationRun }>(response);
};

export const fetchAdminFeatureFlags = async (baseUrl?: string): Promise<AdminFeatureFlag[]> => {
  const response = await adminAuthFetch(`${toBaseUrl(baseUrl)}/admin/feature-flags`, undefined, { requireAuth: true });
  const payload = await readJsonOrThrow<{ items?: AdminFeatureFlag[] }>(response);
  return Array.isArray(payload.items) ? payload.items : [];
};

export const patchAdminFeatureFlag = async (
  flagKey: string,
  input: Partial<Pick<AdminFeatureFlag, 'enabled' | 'scope' | 'description' | 'metadata'>>,
  baseUrl?: string
): Promise<AdminFeatureFlag> => {
  const response = await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/feature-flags/${encodeURIComponent(String(flagKey || '').trim())}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input || {}),
    },
    { requireAuth: true }
  );
  const payload = await readJsonOrThrow<{ flag?: AdminFeatureFlag }>(response);
  return payload.flag || (payload as unknown as AdminFeatureFlag);
};

export const fetchAdminAutomationRuns = async (baseUrl?: string): Promise<AdminAutomationRun[]> => {
  const response = await adminAuthFetch(`${toBaseUrl(baseUrl)}/admin/automation/runs`, undefined, { requireAuth: true });
  const payload = await readJsonOrThrow<{ items?: AdminAutomationRun[] }>(response);
  return Array.isArray(payload.items) ? payload.items : [];
};

export const fetchAdminIncidents = async (baseUrl?: string): Promise<AdminIncident[]> => {
  const response = await adminAuthFetch(`${toBaseUrl(baseUrl)}/admin/incidents`, undefined, { requireAuth: true });
  const payload = await readJsonOrThrow<{ items?: AdminIncident[] }>(response);
  return Array.isArray(payload.items) ? payload.items : [];
};

export const createAdminIncident = async (
  input: Partial<AdminIncident> & { title: string },
  baseUrl?: string
): Promise<AdminIncident> => {
  const response = await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/incidents`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input || {}),
    },
    { requireAuth: true }
  );
  const payload = await readJsonOrThrow<{ incident?: AdminIncident }>(response);
  return payload.incident || (payload as unknown as AdminIncident);
};

export const patchAdminIncident = async (
  incidentId: string,
  input: Partial<AdminIncident>,
  baseUrl?: string
): Promise<AdminIncident> => {
  const response = await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/incidents/${encodeURIComponent(String(incidentId || '').trim())}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input || {}),
    },
    { requireAuth: true }
  );
  const payload = await readJsonOrThrow<{ incident?: AdminIncident }>(response);
  return payload.incident || (payload as unknown as AdminIncident);
};

export const linkAdminIncidentConversations = async (
  incidentId: string,
  conversationIds: string[],
  baseUrl?: string
): Promise<AdminIncident> => {
  const response = await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/incidents/${encodeURIComponent(String(incidentId || '').trim())}/link-conversations`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationIds }),
    },
    { requireAuth: true }
  );
  const payload = await readJsonOrThrow<{ incident?: AdminIncident }>(response);
  return payload.incident || (payload as unknown as AdminIncident);
};

export const broadcastAdminIncident = async (
  incidentId: string,
  input: { message?: string; details?: string; expiresAt?: string } = {},
  baseUrl?: string
): Promise<{ incident: AdminIncident; notice?: AdminNotice }> => {
  const response = await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/incidents/${encodeURIComponent(String(incidentId || '').trim())}/broadcast`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input || {}),
    },
    { requireAuth: true }
  );
  return readJsonOrThrow<{ incident: AdminIncident; notice?: AdminNotice }>(response);
};

export const fetchAdminModerationReports = async (baseUrl?: string): Promise<ModerationReport[]> => {
  const response = await adminAuthFetch(`${toBaseUrl(baseUrl)}/admin/moderation/reports`, undefined, { requireAuth: true });
  const payload = await readJsonOrThrow<{ items?: ModerationReport[] }>(response);
  return Array.isArray(payload.items) ? payload.items : [];
};

export const resolveAdminModerationReport = async (
  reportId: string,
  input: { resolution?: string; status?: string } = {},
  baseUrl?: string
): Promise<ModerationReport> => {
  const response = await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/moderation/reports/${encodeURIComponent(String(reportId || '').trim())}/resolve`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input || {}),
    },
    { requireAuth: true }
  );
  const payload = await readJsonOrThrow<{ report?: ModerationReport }>(response);
  return payload.report || (payload as unknown as ModerationReport);
};
