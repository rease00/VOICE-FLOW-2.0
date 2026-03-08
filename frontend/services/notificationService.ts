import { authFetch } from './authHttpClient';
import { readJsonOrThrow } from '../src/shared/api/httpClient';
import { resolveApiBaseUrl } from '../src/shared/api/config';
import type { NotificationActionTarget, NotificationEventCode, NotificationPrefs } from '../src/shared/notifications/types';

const toBaseUrl = (input?: string): string => resolveApiBaseUrl(input);

export interface NotificationWireAction {
  label?: string;
  target?: NotificationActionTarget;
}

export interface NotificationWireItem {
  id: string;
  eventCode: NotificationEventCode | string;
  entityKey?: string | null;
  title?: string;
  message?: string;
  details?: string | null;
  severity?: string;
  category?: string;
  audience?: string;
  channel?: string;
  status?: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  readAt?: string | null;
  dismissedAt?: string | null;
  sticky?: boolean;
  dedupeKey?: string | null;
  requiredPermission?: string | null;
  emailEligible?: boolean;
  action?: NotificationWireAction | null;
}

export interface NotificationPreferencesResponse {
  ok: boolean;
  preferences?: Partial<NotificationPrefs>;
}

export const fetchAccountNotifications = async (
  baseUrl?: string,
  options?: { limit?: number }
): Promise<NotificationWireItem[]> => {
  const query = new URLSearchParams();
  if (typeof options?.limit === 'number' && Number.isFinite(options.limit)) {
    query.set('limit', String(Math.max(1, Math.floor(options.limit))));
  }
  const payload = await readJsonOrThrow<{ items?: NotificationWireItem[] }>(
    await authFetch(
      `${toBaseUrl(baseUrl)}/account/notifications${query.toString() ? `?${query.toString()}` : ''}`,
      undefined,
      { requireAuth: true }
    )
  );
  return Array.isArray(payload?.items) ? payload.items : [];
};

export const markAccountNotificationRead = async (notificationId: string, baseUrl?: string): Promise<void> => {
  await readJsonOrThrow(
    await authFetch(
      `${toBaseUrl(baseUrl)}/account/notifications/${encodeURIComponent(String(notificationId || '').trim())}/read`,
      { method: 'POST' },
      { requireAuth: true }
    )
  );
};

export const markAllAccountNotificationsRead = async (baseUrl?: string): Promise<void> => {
  await readJsonOrThrow(
    await authFetch(
      `${toBaseUrl(baseUrl)}/account/notifications/read-all`,
      { method: 'POST' },
      { requireAuth: true }
    )
  );
};

export const dismissAccountNotification = async (notificationId: string, baseUrl?: string): Promise<void> => {
  await readJsonOrThrow(
    await authFetch(
      `${toBaseUrl(baseUrl)}/account/notifications/${encodeURIComponent(String(notificationId || '').trim())}/dismiss`,
      { method: 'POST' },
      { requireAuth: true }
    )
  );
};

export const dismissAllAccountNotifications = async (baseUrl?: string): Promise<void> => {
  await readJsonOrThrow(
    await authFetch(
      `${toBaseUrl(baseUrl)}/account/notifications/dismiss-all`,
      { method: 'POST' },
      { requireAuth: true }
    )
  );
};

export const fetchNotificationPreferences = async (baseUrl?: string): Promise<Partial<NotificationPrefs>> => {
  const payload = await readJsonOrThrow<NotificationPreferencesResponse>(
    await authFetch(
      `${toBaseUrl(baseUrl)}/account/notification-preferences`,
      undefined,
      { requireAuth: true }
    )
  );
  return payload?.preferences || {};
};

export const patchNotificationPreferences = async (
  patch: Partial<Pick<NotificationPrefs, 'emailAsyncJobs' | 'emailBilling' | 'emailSupport' | 'emailAdminAlerts'>>,
  baseUrl?: string
): Promise<Partial<NotificationPrefs>> => {
  const payload = await readJsonOrThrow<NotificationPreferencesResponse>(
    await authFetch(
      `${toBaseUrl(baseUrl)}/account/notification-preferences`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
      { requireAuth: true }
    )
  );
  return payload?.preferences || {};
};
