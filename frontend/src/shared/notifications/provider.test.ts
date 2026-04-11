import { describe, expect, it } from 'vitest';
import {
  combineNotificationFeeds,
  DEFAULT_NOTIFICATION_PREFS,
  coerceNotificationPrefs,
  prepareNotificationsForStorage,
  resolveNotificationPollDelayMs,
  shouldEscalateRepeatedGenerationFailure,
} from './NotificationProvider';
import { limitNotifications, NOTIFICATION_MAX_ITEMS } from './store';
import type { AppNotification } from './types';

const createNotification = (overrides: Partial<AppNotification> = {}): AppNotification => ({
  id: overrides.id || 'n1',
  eventCode: overrides.eventCode || 'custom.message',
  entityKey: overrides.entityKey,
  title: overrides.title || 'Info',
  message: overrides.message || 'hello',
  details: overrides.details,
  severity: overrides.severity || 'info',
  category: overrides.category || 'activity',
  audience: overrides.audience || 'all',
  scope: overrides.scope || 'ephemeral',
  channel: overrides.channel || 'inbox',
  status: overrides.status || 'active',
  resolvedAt: overrides.resolvedAt ?? null,
  resolvedBy: overrides.resolvedBy ?? null,
  createdAt: overrides.createdAt ?? 1000,
  expiresAt: overrides.expiresAt ?? 2000,
  readAt: overrides.readAt ?? null,
  sticky: overrides.sticky === true,
  dedupeKey: overrides.dedupeKey,
  toastVisible: overrides.toastVisible ?? false,
  action: overrides.action,
});

describe('notification provider helpers', () => {
  it('coerces persisted preferences with safe defaults', () => {
    expect(coerceNotificationPrefs(undefined)).toEqual(DEFAULT_NOTIFICATION_PREFS);

    expect(
      coerceNotificationPrefs({
        allowTips: false,
        allowSystemInfo: false,
        playSound: true,
        emailAsyncJobs: false,
        emailBilling: true,
        emailSupport: false,
        emailAdminAlerts: true,
      })
    ).toEqual({
      allowTips: false,
      allowSystemInfo: false,
      playSound: true,
      emailAsyncJobs: false,
      emailBilling: true,
      emailSupport: false,
      emailAdminAlerts: true,
    });
  });

  it('prepares notifications for storage without callbacks and with sanitized labels', () => {
    const rows = [
      createNotification({
        id: 'row-1',
        message: 'Gemini Runtime offline',
        action: {
          label: 'Open Gemini Diagnostics',
          onClick: () => {
            throw new Error('should not be persisted');
          },
        },
      }),
      createNotification({ id: 'row-2', action: undefined }),
    ];

    const prepared = prepareNotificationsForStorage(rows);

    expect(prepared).toHaveLength(2);
    expect(prepared[0]?.message).toBe('Primary AI Runtime offline');
    expect(prepared[0]?.action?.label).toBe('Open Primary AI Diagnostics');
    expect(prepared[0]?.action && 'onClick' in prepared[0].action).toBe(false);
    expect(prepared[1]?.action).toBeUndefined();
  });

  it('caps stored notification list to max size', () => {
    const rows = Array.from({ length: NOTIFICATION_MAX_ITEMS + 25 }).map((_, index) =>
      createNotification({
        id: `n-${index}`,
        createdAt: 1000 + index,
      })
    );
    const limited = limitNotifications(rows);
    expect(limited.length).toBe(NOTIFICATION_MAX_ITEMS);
  });

  it('does not escalate repeated generation failures for auth/profile blockers', () => {
    expect(shouldEscalateRepeatedGenerationFailure('Sign in again to enable AI/TTS requests.')).toBe(false);
    expect(
      shouldEscalateRepeatedGenerationFailure('Complete your user ID setup to enable AI/TTS requests.')
    ).toBe(false);
    expect(shouldEscalateRepeatedGenerationFailure('Profile service is temporarily unavailable.')).toBe(false);
  });

  it('keeps escalation for runtime/backend failure patterns', () => {
    expect(
      shouldEscalateRepeatedGenerationFailure('Runtime is offline. Start services and retry.')
    ).toBe(true);
    expect(
      shouldEscalateRepeatedGenerationFailure('Cannot connect to backend service. Verify backend health and retry.')
    ).toBe(true);
  });

  it('backs notification polling off by visibility and error state', () => {
    expect(resolveNotificationPollDelayMs({ visibilityState: 'visible' })).toBe(60_000);
    expect(resolveNotificationPollDelayMs({ visibilityState: 'hidden' })).toBe(5 * 60_000);
    expect(resolveNotificationPollDelayMs({ errorCount: 1 })).toBe(75_000);
    expect(resolveNotificationPollDelayMs({ errorCount: 3 })).toBe(300_000);
    expect(resolveNotificationPollDelayMs({ errorCount: 10 })).toBe(600_000);
  });

  it('prefers server expiry timestamps when rehydrating persisted notifications', async () => {
    const { coercePersistedNotification } = await import('./NotificationProvider');
    const nowMs = 1_700_000_000_000;
    const createdAt = '2026-03-27T10:00:00.000Z';
    const serverExpiresAt = '2026-03-28T10:00:00.000Z';

    const withServerExpiry = coercePersistedNotification(
      {
        id: 'server-expiry',
        eventCode: 'custom.message',
        message: 'Server-controlled expiry',
        createdAt,
        expiresAt: serverExpiresAt,
      } as never,
      nowMs
    );
    const withFallbackExpiry = coercePersistedNotification(
      {
        id: 'fallback-expiry',
        eventCode: 'custom.message',
        message: 'Fallback expiry',
        createdAt,
      } as never,
      nowMs
    );

    expect(withServerExpiry?.expiresAt).toBe(Date.parse(serverExpiresAt));
    expect(withFallbackExpiry?.expiresAt).toBe(Date.parse(createdAt) + 30 * 24 * 60 * 60 * 1000);
  });

  it('preserves channel and audience metadata for persisted notifications', async () => {
    const { coercePersistedNotification } = await import('./NotificationProvider');
    const row = coercePersistedNotification(
      {
        id: 'persisted-1',
        eventCode: 'custom.message',
        title: 'Server notice',
        message: 'User-safe message',
        userMessage: 'User-safe message',
        adminDetail: 'Internal trace details',
        audience: 'all',
        channel: 'toast',
        roleScope: 'admins_and_users',
      } as never,
      Date.now()
    );

    expect(row?.audience).toBe('all');
    expect(row?.channel).toBe('toast');
    expect(row?.roleScope).toBe('admins_and_users');
    expect(row?.userMessage).toBe('User-safe message');
    expect(row?.adminDetail).toBe('Internal trace details');
  });

  it('combines local toast history with persisted inbox items for the center feed', () => {
    const persisted = [
      createNotification({
        id: 'persisted-1',
        channel: 'inbox',
        scope: 'persisted',
        createdAt: 1000,
      }),
    ];
    const local = [
      createNotification({
        id: 'toast-1',
        channel: 'toast',
        scope: 'ephemeral',
        createdAt: 2000,
        toastVisible: true,
      }),
    ];

    const combined = combineNotificationFeeds(persisted, local);

    expect(combined.map((item) => item.id)).toEqual(['toast-1', 'persisted-1']);
  });
});

