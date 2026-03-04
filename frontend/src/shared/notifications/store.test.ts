import { describe, expect, it } from 'vitest';
import {
  applyPrefsFilter,
  archiveResolved,
  clearNotificationsByIds,
  clearNonCritical,
  clearReadNotifications,
  dedupeWithCooldown,
  limitNotifications,
  markAllRead,
  markRead,
  NOTIFICATION_MAX_ITEMS,
  pruneExpiredNotifications,
  resolveNotificationsByEventCodes,
} from './store';
import type { AppNotification, NotificationPrefs } from './types';

const createNotification = (overrides: Partial<AppNotification> = {}): AppNotification => ({
  id: overrides.id || 'n1',
  eventCode: overrides.eventCode || 'custom.message',
  entityKey: overrides.entityKey,
  title: overrides.title || 'Info',
  message: overrides.message || 'hello',
  details: overrides.details,
  severity: overrides.severity || 'info',
  category: overrides.category || 'activity',
  channel: overrides.channel || 'inbox',
  status: overrides.status || 'active',
  resolvedAt: overrides.resolvedAt ?? null,
  resolvedBy: overrides.resolvedBy ?? null,
  createdAt: overrides.createdAt ?? 1000,
  expiresAt: overrides.expiresAt ?? 1000 + 7 * 24 * 60 * 60 * 1000,
  readAt: overrides.readAt ?? null,
  sticky: overrides.sticky === true,
  dedupeKey: overrides.dedupeKey,
  toastVisible: overrides.toastVisible ?? false,
  action: overrides.action,
});

const basePrefs: NotificationPrefs = {
  allowTips: true,
  allowSystemInfo: true,
  playSound: false,
};

describe('notification store', () => {
  it('prunes expired notifications and caps max list size', () => {
    const now = 10_000;
    const rows: AppNotification[] = [
      createNotification({ id: 'expired', createdAt: 1, expiresAt: now - 1 }),
      ...Array.from({ length: NOTIFICATION_MAX_ITEMS + 10 }).map((_, index) =>
        createNotification({
          id: `n-${index}`,
          createdAt: now + index,
          expiresAt: now + 1_000,
        })
      ),
    ];

    const pruned = pruneExpiredNotifications(rows, now);
    const limited = limitNotifications(pruned, NOTIFICATION_MAX_ITEMS);

    expect(pruned.find((item) => item.id === 'expired')).toBeUndefined();
    expect(limited.length).toBe(NOTIFICATION_MAX_ITEMS);
    expect(limited[0]?.createdAt).toBeGreaterThanOrEqual(limited[limited.length - 1]?.createdAt || 0);
  });

  it('dedupes by key inside cooldown and keeps same notification id', () => {
    const now = 50_000;
    const existing = createNotification({
      id: 'existing',
      eventCode: 'backend.offline',
      message: 'old message',
      dedupeKey: 'backend-offline',
      createdAt: now - 2_000,
      channel: 'toast',
      toastVisible: true,
    });
    const incoming = createNotification({
      id: 'incoming',
      eventCode: 'backend.offline',
      message: 'new message',
      dedupeKey: 'backend-offline',
      createdAt: now,
      severity: 'critical',
      sticky: true,
      channel: 'toast',
      toastVisible: true,
    });

    const merged = dedupeWithCooldown([existing], incoming, 6_000, now);

    expect(merged.deduped).toBe(true);
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0]?.id).toBe('existing');
    expect(merged.items[0]?.message).toBe('new message');
    expect(merged.notification.id).toBe('existing');
  });

  it('critical notifications bypass preference filters', () => {
    const blockedPrefs: NotificationPrefs = {
      allowTips: false,
      allowSystemInfo: false,
      playSound: false,
    };
    const criticalSystem = createNotification({ severity: 'critical', category: 'system' });
    const infoSystem = createNotification({ severity: 'info', category: 'system' });
    const tipsInfo = createNotification({ severity: 'info', category: 'tips' });

    expect(applyPrefsFilter(criticalSystem, blockedPrefs)).toBe(true);
    expect(applyPrefsFilter(infoSystem, blockedPrefs)).toBe(false);
    expect(applyPrefsFilter(tipsInfo, blockedPrefs)).toBe(false);
    expect(applyPrefsFilter(createNotification({ severity: 'info', category: 'activity' }), basePrefs)).toBe(true);
  });

  it('resolves outage events when recovery event is emitted', () => {
    const now = 88_000;
    const rows = [
      createNotification({
        id: 'offline',
        eventCode: 'backend.offline',
        status: 'active',
        channel: 'toast',
        toastVisible: true,
        severity: 'critical',
      }),
      createNotification({
        id: 'other',
        eventCode: 'runtime.offline',
        entityKey: 'GEM',
        status: 'active',
      }),
    ];

    const resolved = resolveNotificationsByEventCodes(
      rows,
      ['backend.offline'],
      undefined,
      'recovery-id',
      now
    );
    const offline = resolved.find((item) => item.id === 'offline');

    expect(offline?.status).toBe('resolved');
    expect(offline?.resolvedBy).toBe('recovery-id');
    expect(offline?.resolvedAt).toBe(now);
    expect(offline?.toastVisible).toBe(false);
  });

  it('marks read and clears sets correctly', () => {
    const rows = [
      createNotification({ id: 'c1', severity: 'critical' }),
      createNotification({ id: 'i1', severity: 'info' }),
      createNotification({ id: 'w1', severity: 'warning' }),
      createNotification({ id: 'r1', severity: 'info', status: 'resolved' }),
    ];

    const oneRead = markRead(rows, 'i1', 1234);
    expect(oneRead.find((item) => item.id === 'i1')?.readAt).toBe(1234);

    const allRead = markAllRead(rows, 2222);
    expect(allRead.every((item) => item.readAt === 2222)).toBe(true);

    const criticalOnly = clearNonCritical(rows);
    expect(criticalOnly).toHaveLength(1);
    expect(criticalOnly[0]?.severity).toBe('critical');

    const unreadOnly = clearReadNotifications([
      createNotification({ id: 'n1', readAt: null }),
      createNotification({ id: 'n2', readAt: 1111 }),
    ]);
    expect(unreadOnly.map((item) => item.id)).toEqual(['n1']);

    const removedSome = clearNotificationsByIds(rows, ['i1', 'w1']);
    expect(removedSome.map((item) => item.id)).toEqual(['c1', 'r1']);
  });

  it('archives resolved non-critical notifications', () => {
    const rows = [
      createNotification({ id: 'critical-resolved', severity: 'critical', status: 'resolved' }),
      createNotification({ id: 'info-resolved', severity: 'info', status: 'resolved' }),
      createNotification({ id: 'active', severity: 'info', status: 'active' }),
    ];
    const archived = archiveResolved(rows);
    expect(archived.map((item) => item.id)).toEqual(['critical-resolved', 'active']);
  });
});
