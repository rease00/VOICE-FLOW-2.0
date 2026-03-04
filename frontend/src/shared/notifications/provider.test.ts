import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFS,
  coerceNotificationPrefs,
  prepareNotificationsForStorage,
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
      })
    ).toEqual({
      allowTips: false,
      allowSystemInfo: false,
      playSound: true,
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
    expect(prepared[0]?.message).toBe('Cloud runtime offline');
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
});
