import type {
  NotificationAudience,
  NotificationCategory,
  NotificationChannel,
  NotificationEventCode,
  NotificationSeverity,
} from './types';

export interface NotificationCatalogEntry {
  eventCode: NotificationEventCode;
  title: string;
  message: string;
  severity: NotificationSeverity;
  category: NotificationCategory;
  audience: NotificationAudience;
  channel: NotificationChannel;
  sticky: boolean;
  dedupeCooldownMs: number;
  resolveEventCodes?: NotificationEventCode[];
  actionableToast?: boolean;
}

const entry = (
  eventCode: NotificationEventCode,
  title: string,
  message: string,
  severity: NotificationSeverity,
  category: NotificationCategory,
  channel: NotificationChannel,
  sticky: boolean,
  dedupeCooldownMs: number,
  options?: Partial<Pick<NotificationCatalogEntry, 'resolveEventCodes' | 'actionableToast' | 'audience'>>
): NotificationCatalogEntry => ({
  eventCode,
  title,
  message,
  severity,
  category,
  audience: options?.audience || 'all',
  channel,
  sticky,
  dedupeCooldownMs,
  ...(options?.resolveEventCodes ? { resolveEventCodes: options.resolveEventCodes } : {}),
  ...(options?.actionableToast === true ? { actionableToast: true } : {}),
});

export const NOTIFICATION_CATALOG: Record<NotificationEventCode, NotificationCatalogEntry> = {
  'custom.message': entry('custom.message', 'Notice', 'Notification', 'info', 'activity', 'inbox', false, 4_000),
  'connectivity.offline': entry(
    'connectivity.offline',
    "You're Offline",
    'Some actions are unavailable until your connection returns.',
    'critical',
    'system',
    'toast',
    true,
    15_000,
    { actionableToast: true }
  ),
  'connectivity.online': entry(
    'connectivity.online',
    'Connection Restored',
    'Your internet connection is back.',
    'success',
    'system',
    'inbox',
    false,
    8_000,
    { resolveEventCodes: ['connectivity.offline'] }
  ),
  'backend.offline': entry(
    'backend.offline',
    'Backend Unreachable',
    'Cannot reach backend service. Check Backend URL and retry.',
    'critical',
    'system',
    'toast',
    true,
    20_000,
    { actionableToast: true }
  ),
  'backend.online': entry(
    'backend.online',
    'Backend Online',
    'Backend connectivity has been restored.',
    'success',
    'system',
    'inbox',
    false,
    10_000,
    { resolveEventCodes: ['backend.offline'] }
  ),
  'runtime.starting': entry(
    'runtime.starting',
    'Runtime Starting',
    'Runtime startup is in progress.',
    'info',
    'system',
    'inbox',
    false,
    10_000
  ),
  'runtime.online': entry(
    'runtime.online',
    'Runtime Online',
    'Runtime is online.',
    'success',
    'system',
    'inbox',
    false,
    10_000,
    { resolveEventCodes: ['runtime.offline'] }
  ),
  'runtime.offline': entry(
    'runtime.offline',
    'Runtime Offline',
    'Runtime is offline. Start services or retry activation.',
    'error',
    'system',
    'toast',
    true,
    20_000,
    { actionableToast: true }
  ),
  'runtime.activation_failed': entry(
    'runtime.activation_failed',
    'Runtime Activation Failed',
    'Could not activate runtime. Check service health and retry.',
    'error',
    'system',
    'toast',
    true,
    20_000,
    { actionableToast: true }
  ),
  'runtime.recovered': entry(
    'runtime.recovered',
    'Runtime Recovery',
    'Runtime recovered and continued processing.',
    'info',
    'system',
    'inbox',
    false,
    15_000
  ),
  'generation.started': entry(
    'generation.started',
    'Generation Started',
    'Generation has started.',
    'info',
    'activity',
    'inbox',
    false,
    5_000
  ),
  'generation.completed': entry(
    'generation.completed',
    'Generation Complete',
    'Generation completed successfully.',
    'success',
    'activity',
    'toast',
    false,
    3_000,
    { resolveEventCodes: ['generation.started'], actionableToast: true }
  ),
  'generation.cancelled': entry(
    'generation.cancelled',
    'Generation Cancelled',
    'Generation was cancelled.',
    'info',
    'activity',
    'inbox',
    false,
    5_000,
    { resolveEventCodes: ['generation.started'] }
  ),
  'generation.failed': entry(
    'generation.failed',
    'Generation Failure',
    'Generation failed. Review error details and retry.',
    'error',
    'activity',
    'toast',
    false,
    15_000,
    { resolveEventCodes: ['generation.started'], actionableToast: true }
  ),
  'generation.failed_repeated': entry(
    'generation.failed_repeated',
    'Repeated Failures',
    'Generation has failed repeatedly. Review runtime/backend health and latest error details, then retry.',
    'critical',
    'system',
    'toast',
    true,
    300_000,
    { actionableToast: true }
  ),
  'quota.daily.80': entry(
    'quota.daily.80',
    'Usage Notice',
    'Daily generation usage is above 80%.',
    'warning',
    'activity',
    'inbox',
    false,
    60_000
  ),
  'quota.daily.95': entry(
    'quota.daily.95',
    'Usage Warning',
    'Daily generation usage is above 95%.',
    'warning',
    'activity',
    'inbox',
    false,
    60_000
  ),
  'quota.daily.reached': entry(
    'quota.daily.reached',
    'Daily Limit Reached',
    'Daily generation limit reached.',
    'error',
    'activity',
    'toast',
    true,
    60_000,
    { actionableToast: true }
  ),
  'wallet.low_balance': entry(
    'wallet.low_balance',
    'Low Balance',
    'Balance is low for your selected runtime.',
    'warning',
    'activity',
    'inbox',
    false,
    60_000
  ),
  'auth.signin.success': entry(
    'auth.signin.success',
    'Sign-In Success',
    'Signed in successfully.',
    'success',
    'security',
    'toast',
    false,
    10_000,
    { actionableToast: true }
  ),
  'auth.signin.failed': entry(
    'auth.signin.failed',
    'Sign-In Failed',
    'Sign-in failed. Verify your credentials and try again.',
    'error',
    'security',
    'toast',
    false,
    10_000,
    { actionableToast: true }
  ),
  'auth.signup.success': entry(
    'auth.signup.success',
    'Sign-Up Success',
    'Account created successfully.',
    'success',
    'security',
    'toast',
    false,
    10_000,
    { actionableToast: true }
  ),
  'auth.signup.failed': entry(
    'auth.signup.failed',
    'Sign-Up Failed',
    'Could not create account. Try again.',
    'error',
    'security',
    'toast',
    false,
    10_000,
    { actionableToast: true }
  ),
  'auth.reset.success': entry(
    'auth.reset.success',
    'Password Reset Requested',
    'If the account exists, a reset link has been sent.',
    'info',
    'security',
    'inbox',
    false,
    15_000
  ),
  'auth.reset.failed': entry(
    'auth.reset.failed',
    'Password Reset Failed',
    'Could not request password reset.',
    'error',
    'security',
    'toast',
    false,
    15_000,
    { actionableToast: true }
  ),
  'billing.checkout.success': entry(
    'billing.checkout.success',
    'Billing Updated',
    'Billing checkout completed successfully.',
    'success',
    'activity',
    'toast',
    false,
    20_000,
    { actionableToast: true }
  ),
  'billing.checkout.cancel': entry(
    'billing.checkout.cancel',
    'Checkout Canceled',
    'Billing checkout was canceled.',
    'info',
    'activity',
    'inbox',
    false,
    20_000
  ),
  'billing.coupon.success': entry(
    'billing.coupon.success',
    'Coupon Applied',
    'Coupon has been applied to your account.',
    'success',
    'activity',
    'toast',
    false,
    8_000,
    { actionableToast: true }
  ),
  'billing.coupon.failed': entry(
    'billing.coupon.failed',
    'Coupon Failed',
    'Coupon could not be applied.',
    'error',
    'activity',
    'toast',
    false,
    8_000,
    { actionableToast: true }
  ),
  'billing.history.refresh.success': entry(
    'billing.history.refresh.success',
    'History Refreshed',
    'Generation history refreshed.',
    'success',
    'activity',
    'inbox',
    false,
    10_000
  ),
  'billing.history.refresh.failed': entry(
    'billing.history.refresh.failed',
    'History Refresh Failed',
    'Could not refresh generation history.',
    'error',
    'activity',
    'toast',
    false,
    10_000
  ),
  'billing.history.clear.success': entry(
    'billing.history.clear.success',
    'History Cleared',
    'Generation history has been cleared.',
    'success',
    'activity',
    'toast',
    false,
    10_000,
    { actionableToast: true }
  ),
  'billing.history.clear.failed': entry(
    'billing.history.clear.failed',
    'History Clear Failed',
    'Could not clear generation history.',
    'error',
    'activity',
    'toast',
    false,
    10_000
  ),
  'profile.userid.saved': entry(
    'profile.userid.saved',
    'Profile Updated',
    'User ID saved.',
    'success',
    'activity',
    'toast',
    false,
    20_000,
    { actionableToast: true }
  ),
  'profile.userid.failed': entry(
    'profile.userid.failed',
    'Profile Update Failed',
    'Could not save user ID.',
    'error',
    'activity',
    'toast',
    false,
    20_000
  ),
  'support.message.sent': entry(
    'support.message.sent',
    'Support Message Sent',
    'Support message sent successfully.',
    'success',
    'activity',
    'inbox',
    false,
    8_000
  ),
  'support.message.failed': entry(
    'support.message.failed',
    'Support Message Failed',
    'Support message could not be sent.',
    'error',
    'activity',
    'toast',
    false,
    10_000
  ),
  'support.conversation.unresolved': entry(
    'support.conversation.unresolved',
    'Support Updated',
    'Conversation marked as unresolved.',
    'info',
    'activity',
    'inbox',
    false,
    8_000
  ),
  'admin.pool.reload.success': entry(
    'admin.pool.reload.success',
    'Primary AI Pool Reloaded',
    'Primary AI key pool reloaded.',
    'success',
    'system',
    'toast',
    false,
    8_000,
    { actionableToast: true, audience: 'admin' }
  ),
  'admin.pool.reload.failed': entry(
    'admin.pool.reload.failed',
    'Primary AI Pool Reload Failed',
    'Failed to reload primary AI pool.',
    'error',
    'system',
    'toast',
    false,
    10_000,
    { audience: 'admin' }
  ),
  'admin.guard.action.submitted': entry(
    'admin.guard.action.submitted',
    'Admin Action Submitted',
    'Guard action submitted successfully.',
    'success',
    'system',
    'inbox',
    false,
    10_000,
    { audience: 'admin' }
  ),
  'admin.guard.action.failed': entry(
    'admin.guard.action.failed',
    'Admin Action Failed',
    'Guard action failed.',
    'error',
    'system',
    'toast',
    false,
    10_000,
    { audience: 'admin' }
  ),
  'admin.access.load.failed': entry(
    'admin.access.load.failed',
    'Admin Data Failed',
    'Admin data could not be loaded.',
    'error',
    'system',
    'toast',
    false,
    12_000,
    { audience: 'admin' }
  ),
  'app.crash.captured': entry(
    'app.crash.captured',
    'Runtime Error',
    'The app encountered a runtime error. Reload the app to recover.',
    'critical',
    'system',
    'toast',
    true,
    60_000,
    { actionableToast: true }
  ),
};

export const getNotificationCatalogEntry = (eventCode: NotificationEventCode): NotificationCatalogEntry =>
  NOTIFICATION_CATALOG[eventCode] || NOTIFICATION_CATALOG['custom.message'];
