export type NotificationSeverity = 'success' | 'info' | 'warning' | 'error' | 'critical';

export type NotificationCategory = 'system' | 'activity' | 'security' | 'tips';

export type NotificationChannel = 'toast' | 'inbox' | 'silent';

export type NotificationStatus = 'active' | 'resolved';

export const NOTIFICATION_EVENT_CODES = [
  'custom.message',
  'connectivity.offline',
  'connectivity.online',
  'backend.offline',
  'backend.online',
  'runtime.starting',
  'runtime.online',
  'runtime.offline',
  'runtime.activation_failed',
  'runtime.recovered',
  'generation.started',
  'generation.completed',
  'generation.cancelled',
  'generation.failed',
  'generation.failed_repeated',
  'quota.daily.80',
  'quota.daily.95',
  'quota.daily.reached',
  'wallet.low_balance',
  'auth.signin.success',
  'auth.signin.failed',
  'auth.signup.success',
  'auth.signup.failed',
  'auth.reset.success',
  'auth.reset.failed',
  'billing.checkout.success',
  'billing.checkout.cancel',
  'billing.coupon.success',
  'billing.coupon.failed',
  'billing.history.refresh.success',
  'billing.history.refresh.failed',
  'billing.history.clear.success',
  'billing.history.clear.failed',
  'profile.userid.saved',
  'profile.userid.failed',
  'support.message.sent',
  'support.message.failed',
  'support.conversation.unresolved',
  'admin.pool.reload.success',
  'admin.pool.reload.failed',
  'admin.guard.action.submitted',
  'admin.guard.action.failed',
  'admin.access.load.failed',
  'app.crash.captured',
] as const;

export type NotificationEventCode = (typeof NOTIFICATION_EVENT_CODES)[number];

export const isNotificationEventCode = (value: string): value is NotificationEventCode =>
  (NOTIFICATION_EVENT_CODES as readonly string[]).includes(value);

export interface NotificationAction {
  label: string;
  onClick?: (() => void) | undefined;
}

export interface AppNotification {
  id: string;
  eventCode: NotificationEventCode;
  entityKey?: string | undefined;
  title: string;
  message: string;
  details?: string | undefined;
  severity: NotificationSeverity;
  category: NotificationCategory;
  channel: NotificationChannel;
  status: NotificationStatus;
  resolvedAt: number | null;
  resolvedBy: string | null;
  createdAt: number;
  expiresAt: number;
  readAt: number | null;
  sticky: boolean;
  dedupeKey?: string | undefined;
  toastVisible: boolean;
  action?: NotificationAction | undefined;
}

export interface NotificationPrefs {
  allowTips: boolean;
  allowSystemInfo: boolean;
  playSound: boolean;
}

export interface NotificationInput {
  eventCode?: NotificationEventCode;
  entityKey?: string;
  title?: string;
  message: string;
  details?: string;
  severity?: NotificationSeverity;
  category?: NotificationCategory;
  channel?: NotificationChannel;
  status?: NotificationStatus;
  resolvedAt?: number | null;
  resolvedBy?: string | null;
  sticky?: boolean;
  dedupeKey?: string;
  toastVisible?: boolean;
  action?: NotificationAction;
  expiresAt?: number;
}

export interface NotifyOptions {
  cooldownMs?: number;
  resurfaceOnDedupe?: boolean;
}

export interface NotificationEmitPayload {
  entityKey?: string;
  title?: string;
  message?: string;
  details?: string;
  severity?: NotificationSeverity;
  category?: NotificationCategory;
  channel?: NotificationChannel;
  sticky?: boolean;
  dedupeKey?: string;
  toastVisible?: boolean;
  action?: NotificationAction;
}

export interface EmitOptions extends NotifyOptions {
  skipEscalation?: boolean;
  suppressAutoResolve?: boolean;
}
