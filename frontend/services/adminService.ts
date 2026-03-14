import { authFetch } from './authHttpClient';
import { AccountEntitlements } from './accountService';
import { parseResponseError, readJsonOrThrow } from '../src/shared/api/httpClient';
import { resolveApiBaseUrl } from '../src/shared/api/config';

const toBaseUrl = (input?: string): string => {
  return resolveApiBaseUrl(input);
};

export const ADMIN_READ_TIMEOUT_MS = 12000;

let adminUnlockTokenMemory = '';

export const setAdminUnlockToken = (token: string): void => {
  adminUnlockTokenMemory = String(token || '').trim();
};

export const clearAdminUnlockToken = (): void => {
  adminUnlockTokenMemory = '';
};

export const getAdminUnlockToken = (): string => adminUnlockTokenMemory;

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
  plan: 'Free' | 'Starter' | 'Creator' | 'Pro' | 'Scale';
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
  };
  usage: {
    monthlyVfUsed: number;
    dailyGenerationUsed: number;
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

export interface GeminiPoolStatusPayload {
  ok: boolean;
  config?: GeminiPoolConfig;
  validation?: GeminiPoolValidation;
  warnings?: string[];
  sourcePolicy?: GeminiSourcePolicy;
  poolSummaries?: Record<string, GeminiPoolSummary>;
  backend?: {
    ok?: boolean;
    pool?: {
      keyCount?: number;
      healthyKeys?: number;
      unhealthyKeys?: number;
      atLimitKeys?: number;
    };
    keys?: GeminiPoolKeyStatus[];
    poolSummaries?: Record<string, GeminiPoolSummary>;
    source?: {
      configuredFilePath?: string;
      filePath?: string;
      fileExists?: boolean;
      fileKeyCount?: number;
      envPoolKeyCount?: number;
      singleKeyPresent?: boolean;
    };
    [key: string]: unknown;
  };
  runtime?: {
    ok?: boolean;
    configuredKeyFilePath?: string;
    keyFilePath?: string;
    pool?: {
      keyCount?: number;
      healthyKeys?: number;
      unhealthyKeys?: number;
      atLimitKeys?: number;
    };
    [key: string]: unknown;
  };
  runtimeReload?: Record<string, unknown>;
  detail?: string;
  createdPools?: string[];
  deletedPools?: string[];
  planPoolChanges?: Record<string, { before?: string; after?: string }>;
  keyDiffByPool?: Record<string, { beforeCount?: number; afterCount?: number; addedCount?: number; removedCount?: number }>;
}

export type GeminiSourceProvider = 'gemini_api' | 'vertex';

export interface GeminiSourcePolicy {
  provider?: GeminiSourceProvider;
  freePoolMode?: 'api_file_authoritative' | 'config_managed' | string;
  freePoolFilePath?: string;
  freePoolLocked?: boolean;
  ttsModelFallbackEnabled?: boolean;
  failureMode?: string;
  lastSyncAt?: string;
  lastSyncStatus?: string;
  lastSyncHash?: string;
  fileKeyCount?: number;
  vertexProject?: string;
  vertexLocation?: string;
  vertexServiceAccountRef?: string;
  vertexServiceAccountConfigured?: boolean;
  vertexServiceAccountJson?: string;
  vertexAccessTokenRef?: string;
  vertexAccessTokenConfigured?: boolean;
  vertexAccessToken?: string;
  [key: string]: unknown;
}

export interface GeminiPoolConfig {
  version?: number;
  updatedAt?: string;
  pools?: Record<string, {
    keys?: string[];
    keyMetadata?: Array<{
      index?: number;
      fingerprint?: string;
      masked?: string;
    }>;
  }>;
  fallbackChains?: Record<string, string[]>;
  planPools?: {
    free?: string;
    pro?: string;
    plus?: string;
  };
  defaultFallbackChain?: string[];
  constraints?: {
    uniqueKeyMembership?: boolean;
  };
  sourcePolicy?: GeminiSourcePolicy;
  keyMetadata?: Record<string, Array<{
    index?: number;
    fingerprint?: string;
    masked?: string;
  }>>;
  singlePool?: {
    enabled?: boolean;
    canonicalPoolId?: string;
    effectivePlanPools?: {
      free?: string;
      pro?: string;
      plus?: string;
    };
  };
}

export interface GeminiPoolValidation {
  uniqueKeyMembership?: boolean;
  duplicateKeys?: Record<string, string[]>;
  missingPlanPools?: Record<string, string>;
  missingDefaultFallbackPools?: string[];
  isValid?: boolean;
}

export interface GeminiPoolSummary {
  pool?: string;
  directKeyCount?: number;
  effectiveKeyCount?: number;
  chain?: string[];
  effectiveChain?: string[];
  allocator?: {
    keyCount?: number;
    healthyKeys?: number;
    unhealthyKeys?: number;
    atLimitKeys?: number;
    inFlightTotal?: number;
    nextResetInMs?: number;
  };
}

export interface GeminiModelWindowUsage {
  requests?: number;
  tokens?: number;
  inFlightRequests?: number;
  inFlightTokens?: number;
  successes?: number;
  failures?: number;
  rateLimited?: number;
}

export interface GeminiModelRemainingCapacity {
  rpm?: number;
  tpm?: number;
  atLimit?: boolean;
}

export interface GeminiModelWindowMeta {
  startedAtMs?: number;
  resetsInMs?: number;
}

export interface GeminiPoolModelStatus {
  model?: string;
  status?: string;
  readyInMs?: number;
  rpm?: number;
  tpm?: number;
  enabledFor?: string[];
  routed?: boolean;
  usage?: GeminiModelWindowUsage;
  remaining?: GeminiModelRemainingCapacity;
  window?: GeminiModelWindowMeta;
  pool?: {
    keyCount?: number;
    atCapacityKeys?: number;
    availableKeys?: number;
    nextResetInMs?: number;
  };
}

export interface GeminiPoolKeyStatus {
  index?: number;
  fingerprint?: string;
  status?: string;
  inFlight?: number;
  readyInMs?: number;
  rateLimitStrikes?: number;
  usage?: GeminiModelWindowUsage;
  limit?: {
    dailyLimit?: number | null;
    remaining?: number | null;
    atLimit?: boolean;
  };
  health?: {
    healthy?: boolean;
    reason?: string;
  };
  models?: GeminiPoolModelStatus[];
  [key: string]: unknown;
}

export interface GeminiPoolAllocatorSnapshot {
  ok?: boolean;
  window?: {
    type?: string;
    seconds?: number;
    timestampMs?: number;
  };
  allocator?: {
    version?: number;
    defaultWaitTimeoutMs?: number;
    windowSeconds?: number;
  };
  pool?: {
    keyCount?: number;
    healthyKeys?: number;
    unhealthyKeys?: number;
    atLimitKeys?: number;
    inFlightTotal?: number;
    keyDailyLimit?: number | null;
    overallDailyLimit?: number | null;
    overallUsed?: number | null;
    overallRemaining?: number | null;
    overallAtLimit?: boolean;
    rotationMode?: string;
    nextIndex?: number;
  };
  keys?: GeminiPoolKeyStatus[];
  models?: GeminiPoolModelStatus[];
}

export interface GeminiPoolUsageEntry {
  pool?: string;
  directKeyCount?: number;
  effectiveKeyCount?: number;
  effectiveChain?: string[];
  direct?: GeminiPoolAllocatorSnapshot;
  effective?: GeminiPoolAllocatorSnapshot;
}

export interface GeminiPoolUsageResponseBlock {
  ok?: boolean;
  usage?: Record<string, GeminiPoolUsageEntry>;
  endpoint?: string;
  [key: string]: unknown;
}

export interface GeminiPoolsUsagePayload {
  ok: boolean;
  backend?: GeminiPoolUsageResponseBlock;
  runtime?: GeminiPoolUsageResponseBlock;
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

export interface AdminLabRuntimeDefaults {
  browserAccelerationDefault: 'webgpu_preferred' | 'cpu_only';
  backendHardwareDefault: 'gpu_preferred' | 'cpu_only';
  separatorBackendDefault: 'gpu_preferred' | 'cpu_only';
  labPerformanceMode: 'conservative' | 'balanced';
  exportStrategyDefault: 'browser_first';
  allowUserOverride: boolean;
  updatedAt?: string;
  updatedBy?: string;
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

export const patchAdminUser = async (
  uid: string,
  patch: {
    plan?: 'Free' | 'Starter' | 'Creator' | 'Pro' | 'Scale' | string;
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

export const fetchGeminiPoolStatus = async (baseUrl?: string): Promise<GeminiPoolStatusPayload> => (
  readJsonOrThrow<GeminiPoolStatusPayload>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/gemini/pool/status`,
    undefined,
    { requireAuth: true }
  ))
);

export const reloadGeminiPool = async (baseUrl?: string): Promise<GeminiPoolStatusPayload> => (
  readJsonOrThrow<GeminiPoolStatusPayload>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/gemini/pool/reload`,
    { method: 'POST' },
    { requireAuth: true }
  ))
);

export const fetchGeminiPools = async (baseUrl?: string): Promise<GeminiPoolStatusPayload> => (
  readJsonOrThrow<GeminiPoolStatusPayload>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/gemini/pools`,
    undefined,
    { requireAuth: true }
  ))
);

export const reloadGeminiPools = async (baseUrl?: string): Promise<GeminiPoolStatusPayload> => (
  readJsonOrThrow<GeminiPoolStatusPayload>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/gemini/pools/reload`,
    { method: 'POST' },
    { requireAuth: true }
  ))
);

export const updateGeminiPools = async (
  input: GeminiPoolConfig,
  baseUrl?: string
): Promise<GeminiPoolStatusPayload> => (
  readJsonOrThrow<GeminiPoolStatusPayload>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/gemini/pools`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    { requireAuth: true }
  ))
);

export const fetchGeminiPoolsUsage = async (baseUrl?: string): Promise<GeminiPoolsUsagePayload> => (
  readJsonOrThrow<GeminiPoolsUsagePayload>(await adminAuthFetch(
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
    undefined,
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

export const fetchAdminLabRuntimeDefaults = async (baseUrl?: string): Promise<AdminLabRuntimeDefaults> => {
  const payload = await readJsonOrThrow<{ defaults: AdminLabRuntimeDefaults }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/lab/runtime-defaults`,
    undefined,
    { requireAuth: true }
  ));
  return payload.defaults;
};

export const updateAdminLabRuntimeDefaults = async (
  patch: Partial<AdminLabRuntimeDefaults>,
  baseUrl?: string
): Promise<AdminLabRuntimeDefaults> => {
  const payload = await readJsonOrThrow<{ defaults: AdminLabRuntimeDefaults }>(await adminAuthFetch(
    `${toBaseUrl(baseUrl)}/admin/lab/runtime-defaults`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
    { requireAuth: true }
  ));
  return payload.defaults;
};
