import { authFetch } from './authHttpClient';
import { readJsonOrThrow } from '../src/shared/api/httpClient';
import { resolveApiBaseUrl } from '../src/shared/api/config';
import type { NotificationActionTarget, NotificationEventCode, NotificationPrefs } from '../src/shared/notifications/types';

const ACCOUNT_BILLING_API_BASE = '/api/v1';

const toBaseUrl = (input?: string): string => (
  typeof input === 'string' && input.trim()
    ? resolveApiBaseUrl(input)
    : ACCOUNT_BILLING_API_BASE
);

export interface NotificationWireAction {
  label?: string | undefined;
  target?: NotificationActionTarget | undefined;
}

export interface NotificationWireItem {
  id: string;
  eventCode: NotificationEventCode | string;
  entityKey?: string | null | undefined;
  title?: string | undefined;
  message?: string | undefined;
  userMessage?: string | null | undefined;
  details?: string | null | undefined;
  adminDetail?: string | null | undefined;
  severity?: string | undefined;
  category?: string | undefined;
  audience?: string | undefined;
  roleScope?: string | null | undefined;
  channel?: string | undefined;
  status?: string | undefined;
  resolvedAt?: string | null | undefined;
  resolvedBy?: string | null | undefined;
  createdAt?: string | null | undefined;
  updatedAt?: string | null | undefined;
  expiresAt?: string | null | undefined;
  readAt?: string | null | undefined;
  dismissedAt?: string | null | undefined;
  sticky?: boolean | undefined;
  dedupeKey?: string | null | undefined;
  requiredPermission?: string | null | undefined;
  emailEligible?: boolean | undefined;
  action?: NotificationWireAction | null | undefined;
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
