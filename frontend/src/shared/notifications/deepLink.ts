import type { NotificationActionTarget } from './types';

export const NOTIFICATION_DEEP_LINK_EVENT = 'vf:notification-deeplink';

export const readNotificationDeepLink = (): NotificationActionTarget => {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const screen = String(params.get('vf-screen') || '').trim();
  const tab = String(params.get('vf-tab') || '').trim();
  const adminTab = String(params.get('vf-admin-tab') || '').trim();
  const conversationId = String(params.get('vf-conversation-id') || '').trim();
  const jobId = String(params.get('vf-job-id') || '').trim();
  const href = String(params.get('vf-href') || '').trim();
  return {
    ...(screen ? { screen } : {}),
    ...(tab ? { tab } : {}),
    ...(adminTab ? { adminTab } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(jobId ? { jobId } : {}),
    ...(href ? { href } : {}),
  };
};

export const applyNotificationActionTarget = (target: NotificationActionTarget | undefined): void => {
  if (!target || typeof window === 'undefined') return;
  const href = String(target.href || '').trim();
  if (href && /^https?:\/\//i.test(href)) {
    window.location.assign(href);
    return;
  }

  const url = new URL(window.location.href);
  const setOrDelete = (key: string, value?: string): void => {
    const safeValue = String(value || '').trim();
    if (safeValue) {
      url.searchParams.set(key, safeValue);
      return;
    }
    url.searchParams.delete(key);
  };

  setOrDelete('vf-screen', target.screen);
  setOrDelete('vf-tab', target.tab);
  setOrDelete('vf-admin-tab', target.adminTab);
  setOrDelete('vf-conversation-id', target.conversationId);
  setOrDelete('vf-job-id', target.jobId);
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new CustomEvent<NotificationActionTarget>(NOTIFICATION_DEEP_LINK_EVENT, { detail: target }));
};
