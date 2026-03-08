import { describe, expect, it } from 'vitest';
import { getToastAutoHideMs, TOAST_AUTO_HIDE_MS } from './toastTiming';
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
  channel: overrides.channel || 'toast',
  status: overrides.status || 'active',
  resolvedAt: overrides.resolvedAt ?? null,
  resolvedBy: overrides.resolvedBy ?? null,
  createdAt: overrides.createdAt ?? 1000,
  expiresAt: overrides.expiresAt ?? 2000,
  readAt: overrides.readAt ?? null,
  sticky: overrides.sticky === true,
  dedupeKey: overrides.dedupeKey,
  toastVisible: overrides.toastVisible ?? true,
  action: overrides.action,
});

describe('notification toast auto-hide', () => {
  it('uses the same 3 second timeout for runtime outage toasts', () => {
    const runtimeOffline = createNotification({
      eventCode: 'runtime.offline',
      severity: 'error',
      sticky: true,
    });

    expect(getToastAutoHideMs(runtimeOffline)).toBe(TOAST_AUTO_HIDE_MS);
  });

  it('uses the same 3 second timeout for critical toasts', () => {
    const critical = createNotification({
      eventCode: 'backend.offline',
      severity: 'critical',
      sticky: true,
    });

    expect(getToastAutoHideMs(critical)).toBe(TOAST_AUTO_HIDE_MS);
  });
});
