import type { AppNotification, NotificationEventCode, NotificationPrefs } from './types';

export const NOTIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const NOTIFICATION_MAX_ITEMS = 100;

export const pruneExpiredNotifications = (
  notifications: AppNotification[],
  nowMs: number = Date.now()
): AppNotification[] => notifications.filter((item) => Number(item.expiresAt || 0) > nowMs);

export const limitNotifications = (
  notifications: AppNotification[],
  maxItems: number = NOTIFICATION_MAX_ITEMS
): AppNotification[] => {
  if (notifications.length <= maxItems) return notifications;
  return [...notifications]
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, maxItems);
};

const getDedupeIdentity = (notification: AppNotification): string => {
  const explicit = String(notification.dedupeKey || '').trim();
  if (explicit) return explicit;
  const eventCode = String(notification.eventCode || 'custom.message').trim();
  const entityKey = String(notification.entityKey || 'global').trim() || 'global';
  return `${eventCode}::${entityKey}`;
};

export const dedupeWithCooldown = (
  notifications: AppNotification[],
  incoming: AppNotification,
  cooldownMs: number,
  nowMs: number = Date.now(),
  options?: { resurfaceOnDedupe?: boolean }
): { items: AppNotification[]; notification: AppNotification; deduped: boolean } => {
  const key = getDedupeIdentity(incoming);
  if (!key) return { items: [incoming, ...notifications], notification: incoming, deduped: false };

  const index = notifications.findIndex((item) => getDedupeIdentity(item) === key);
  if (index < 0) {
    return { items: [incoming, ...notifications], notification: incoming, deduped: false };
  }

  const existing = notifications[index];
  if (!existing) {
    return { items: [incoming, ...notifications], notification: incoming, deduped: false };
  }
  const elapsed = Math.max(0, nowMs - Number(existing.createdAt || 0));
  if (elapsed > cooldownMs) {
    return { items: [incoming, ...notifications], notification: incoming, deduped: false };
  }

  const merged: AppNotification = {
    ...existing,
    ...incoming,
    id: existing.id,
    createdAt: nowMs,
    readAt: incoming.status === 'resolved' ? existing.readAt : null,
    toastVisible: options?.resurfaceOnDedupe === true ? incoming.toastVisible : existing.toastVisible,
    resolvedAt: incoming.status === 'resolved' ? Number(incoming.resolvedAt || nowMs) : null,
    resolvedBy: incoming.status === 'resolved' ? incoming.resolvedBy || null : null,
  };
  const next = [...notifications];
  next.splice(index, 1);
  next.unshift(merged);
  return { items: next, notification: merged, deduped: true };
};

export const applyPrefsFilter = (notification: AppNotification, prefs: NotificationPrefs): boolean => {
  if (notification.severity === 'critical') return true;
  if (notification.category === 'tips' && !prefs.allowTips) return false;
  if (notification.category === 'system' && !prefs.allowSystemInfo) return false;
  return true;
};

export const resolveNotificationsByEventCodes = (
  notifications: AppNotification[],
  eventCodes: readonly NotificationEventCode[],
  entityKey?: string,
  resolvedBy?: string | null,
  nowMs: number = Date.now()
): AppNotification[] => {
  if (!eventCodes.length) return notifications;
  const codeSet = new Set(eventCodes);
  const trimmedEntity = String(entityKey || '').trim();
  let changed = false;
  const next = notifications.map((item) => {
    if (item.status !== 'active') return item;
    if (!codeSet.has(item.eventCode)) return item;
    if (trimmedEntity && String(item.entityKey || '').trim() !== trimmedEntity) return item;
    changed = true;
    return {
      ...item,
      status: 'resolved' as const,
      resolvedAt: nowMs,
      resolvedBy: resolvedBy || null,
      toastVisible: false,
      readAt: item.severity === 'critical' ? item.readAt : nowMs,
    };
  });
  return changed ? next : notifications;
};

export const archiveResolved = (notifications: AppNotification[]): AppNotification[] =>
  notifications.filter((item) => !(item.status === 'resolved' && item.severity !== 'critical'));

export const markRead = (
  notifications: AppNotification[],
  id: string,
  readAtMs: number = Date.now()
): AppNotification[] =>
  notifications.map((item) => {
    if (item.id !== id) return item;
    return { ...item, readAt: readAtMs };
  });

export const markAllRead = (
  notifications: AppNotification[],
  readAtMs: number = Date.now()
): AppNotification[] => notifications.map((item) => ({ ...item, readAt: readAtMs }));

export const clearNonCritical = (notifications: AppNotification[]): AppNotification[] =>
  notifications.filter((item) => item.severity === 'critical');

export const clearReadNotifications = (notifications: AppNotification[]): AppNotification[] =>
  notifications.filter((item) => !item.readAt);

export const clearNotificationsByIds = (
  notifications: AppNotification[],
  ids: readonly string[]
): AppNotification[] => {
  if (!ids.length) return notifications;
  const idSet = new Set(ids.map((id) => String(id || '').trim()).filter(Boolean));
  if (idSet.size === 0) return notifications;
  return notifications.filter((item) => !idSet.has(item.id));
};

export const removeNotification = (notifications: AppNotification[], id: string): AppNotification[] =>
  notifications.filter((item) => item.id !== id);
