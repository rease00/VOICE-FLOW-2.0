import { getNotificationCatalogEntry } from './catalog';
import type { NotificationCatalogEntry } from './catalog';
import type {
  NotificationChannel,
  NotificationEmitPayload,
  NotificationEventCode,
  NotificationSeverity,
} from './types';

const SUCCESS_TOAST_ALLOWLIST = new Set<NotificationEventCode>([
  'generation.completed',
]);

const INBOX_ONLY_EVENT_CODES = new Set<NotificationEventCode>([
  'generation.started',
  'runtime.starting',
  'runtime.online',
  'backend.online',
  'runtime.recovered',
]);

const isGenerationRelatedToastEvent = (eventCode: NotificationEventCode): boolean =>
  eventCode.startsWith('generation.') || eventCode.startsWith('quota.daily.');

export interface ResolvedNotificationPolicy {
  catalog: NotificationCatalogEntry;
  severity: NotificationSeverity;
  category: NotificationCatalogEntry['category'];
  channel: NotificationChannel;
  sticky: boolean;
  dedupeCooldownMs: number;
  resolveEventCodes: NotificationEventCode[];
}

const shouldUseToastForWarning = (
  eventCode: NotificationEventCode,
  catalog: NotificationCatalogEntry,
  payload: NotificationEmitPayload
): boolean => {
  if (payload.channel === 'toast') return true;
  if (catalog.actionableToast) return true;
  if (payload.sticky === true) return true;
  if (payload.action) return true;
  return eventCode === 'quota.daily.reached';
};

export const resolveNotificationPolicy = (
  eventCode: NotificationEventCode,
  payload: NotificationEmitPayload = {}
): ResolvedNotificationPolicy => {
  const catalog = getNotificationCatalogEntry(eventCode);
  const severity = (payload.severity || catalog.severity) as NotificationSeverity;
  const category = payload.category || catalog.category;
  const sticky = payload.sticky === true || catalog.sticky || severity === 'critical';
  const requestedChannel = payload.channel;
  let channel: NotificationChannel = requestedChannel || catalog.channel;

  if (severity === 'critical' || severity === 'error') {
    channel = requestedChannel || 'toast';
  } else if (severity === 'warning') {
    channel = shouldUseToastForWarning(eventCode, catalog, payload) ? 'toast' : 'inbox';
  } else {
    const allowToast = SUCCESS_TOAST_ALLOWLIST.has(eventCode);
    if (!allowToast && !requestedChannel) {
      channel = 'inbox';
    } else if (!allowToast && channel === 'toast' && requestedChannel !== 'toast') {
      channel = 'inbox';
    }
  }

  if (INBOX_ONLY_EVENT_CODES.has(eventCode) && requestedChannel !== 'toast') {
    channel = 'inbox';
  }

  // Product rule: show popup toasts only for generation-related events.
  if (channel === 'toast' && !isGenerationRelatedToastEvent(eventCode)) {
    channel = 'inbox';
  }

  return {
    catalog,
    severity,
    category,
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
