import { getNotificationCatalogEntry } from './catalog';
import type { NotificationCatalogEntry } from './catalog';
import type {
  NotificationAudience,
  NotificationChannel,
  NotificationEmitPayload,
  NotificationEventCode,
  NotificationSeverity,
} from './types';

// Immediate action/result feedback that should surface as popup toasts.
const TOAST_ACTION_EVENT_CODES = new Set<NotificationEventCode>([
  'generation.completed',
  'generation.failed',
  'generation.cancelled',
  'auth.signin.success',
  'auth.signin.failed',
  'auth.signup.success',
  'auth.signup.failed',
  'auth.reset.failed',
  'billing.checkout.success',
  'billing.coupon.success',
  'billing.coupon.failed',
  'profile.userid.saved',
  'profile.userid.failed',
  'support.message.failed',
]);

// Operationally urgent events that should always interrupt with a toast.
const TOAST_PRIORITY_EVENT_CODES = new Set<NotificationEventCode>([
  'connectivity.offline',
  'backend.offline',
  'runtime.offline',
  'runtime.activation_failed',
  'generation.failed_repeated',
  'quota.daily.reached',
  'app.crash.captured',
  'admin.pool.reload.failed',
  'admin.guard.action.failed',
  'admin.access.load.failed',
]);

// Passive telemetry updates that belong in the inbox unless explicitly overridden.
const INBOX_ONLY_EVENT_CODES = new Set<NotificationEventCode>([
  'generation.started',
  'connectivity.online',
  'runtime.starting',
  'runtime.online',
  'backend.online',
  'runtime.recovered',
  'quota.daily.80',
  'quota.daily.95',
  'wallet.low_balance',
  'auth.reset.success',
  'billing.checkout.cancel',
  'billing.history.refresh.success',
  'support.message.sent',
  'support.conversation.unresolved',
  'support.reply.received',
  'support.conversation.resolved',
  'tts.job.completed',
  'tts.job.failed',
  'tts.job.cancelled',
  'admin.alert.opened',
  'admin.approval.pending',
  'admin.audit.chain.mismatch',
  'admin.session.unlock.issued',
  'admin.session.unlock.verified',
  'admin.scheduler.run.accepted',
  'admin.rbac.saved',
]);

// Admin control-plane notifications that must never surface for non-admin users.
const ADMIN_ONLY_EVENT_CODES = new Set<NotificationEventCode>([
  'admin.alert.opened',
  'admin.approval.pending',
  'admin.audit.chain.mismatch',
  'admin.pool.reload.success',
  'admin.pool.reload.failed',
  'admin.guard.action.submitted',
  'admin.guard.action.failed',
  'admin.session.unlock.issued',
  'admin.session.unlock.verified',
  'admin.scheduler.run.accepted',
  'admin.rbac.saved',
  'admin.access.load.failed',
]);

export interface ResolvedNotificationPolicy {
  catalog: NotificationCatalogEntry;
  severity: NotificationSeverity;
  category: NotificationCatalogEntry['category'];
  audience: NotificationAudience;
  channel: NotificationChannel;
  sticky: boolean;
  dedupeCooldownMs: number;
  resolveEventCodes: NotificationEventCode[];
}

export interface NotificationPolicyContext {
  isAdmin?: boolean;
}

const isAudienceAllowed = (audience: NotificationAudience, context: NotificationPolicyContext): boolean => {
  if (audience !== 'admin') return true;
  return context.isAdmin === true;
};

export const isAdminOnlyNotificationEvent = (eventCode: NotificationEventCode): boolean =>
  ADMIN_ONLY_EVENT_CODES.has(eventCode);

const shouldUseToastForWarning = (
  eventCode: NotificationEventCode,
  catalog: NotificationCatalogEntry,
  payload: NotificationEmitPayload
): boolean => {
  if (TOAST_PRIORITY_EVENT_CODES.has(eventCode)) return true;
  if (payload.channel === 'toast') return true;
  if (catalog.actionableToast) return true;
  if (payload.sticky === true) return true;
  if (payload.action) return true;
  return eventCode === 'quota.daily.reached';
};

const shouldUseToastForSuccessOrInfo = (
  eventCode: NotificationEventCode,
  catalog: NotificationCatalogEntry,
  payload: NotificationEmitPayload
): boolean => {
  if (payload.channel === 'toast') return true;
  if (TOAST_ACTION_EVENT_CODES.has(eventCode)) return true;
  if (catalog.actionableToast && payload.action) return true;
  return false;
};

export const resolveNotificationPolicy = (
  eventCode: NotificationEventCode,
  payload: NotificationEmitPayload = {},
  context: NotificationPolicyContext = {}
): ResolvedNotificationPolicy => {
  const catalog = getNotificationCatalogEntry(eventCode);
  const severity = (payload.severity || catalog.severity) as NotificationSeverity;
  const category = payload.category || catalog.category;
  const audience = payload.audience || catalog.audience || 'all';
  const sticky = payload.sticky === true || catalog.sticky || severity === 'critical';
  const requestedChannel = payload.channel;
  let channel: NotificationChannel = requestedChannel || catalog.channel;

  if (requestedChannel === 'silent') {
    channel = 'silent';
  } else if (!isAudienceAllowed(audience, context)) {
    channel = 'silent';
  } else if (TOAST_PRIORITY_EVENT_CODES.has(eventCode)) {
    channel = 'toast';
  } else if (severity === 'critical' || severity === 'error') {
    channel = requestedChannel || 'toast';
  } else if (severity === 'warning') {
    channel = shouldUseToastForWarning(eventCode, catalog, payload) ? 'toast' : 'inbox';
  } else {
    channel = shouldUseToastForSuccessOrInfo(eventCode, catalog, payload) ? 'toast' : 'inbox';
  }

  if (INBOX_ONLY_EVENT_CODES.has(eventCode) && requestedChannel !== 'toast' && channel !== 'silent') {
    channel = 'inbox';
  }

  return {
    catalog,
    severity,
    category,
    audience,
    channel,
    sticky,
    dedupeCooldownMs: Math.max(1000, Number(payload.dedupeKey ? catalog.dedupeCooldownMs : catalog.dedupeCooldownMs || 6000)),
    resolveEventCodes: catalog.resolveEventCodes || [],
  };
};

export const buildEventDedupeKey = (
  eventCode: NotificationEventCode,
  entityKey?: string,
  override?: string
): string => {
  const explicit = String(override || '').trim();
  if (explicit) return explicit;
  const entity = String(entityKey || 'global').trim() || 'global';
  return `${eventCode}::${entity}`;
};
