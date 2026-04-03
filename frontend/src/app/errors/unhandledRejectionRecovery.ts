import { sanitizeUiText } from '../../shared/ui/terminology';

type UnhandledRejectionRecoveryKind = 'allowlist' | 'auth' | 'transient';

export interface UnhandledRejectionRecovery {
  kind: UnhandledRejectionRecoveryKind;
  telemetryReason: string;
  title: string;
  message: string;
  details: string;
  dedupeKey: string;
}

const isRecoverableAllowlistError = (message: string): boolean => {
  const lowered = String(message || '').trim().toLowerCase();
  if (!lowered) return false;
  return (
    lowered.includes('admin authorization failed: uid_not_allowlisted')
    || lowered.includes('uid_not_allowlisted')
  );
};

const isRecoverableAuthRejection = (message: string): boolean => {
  const lowered = String(message || '').trim().toLowerCase();
  if (!lowered) return false;
  return (
    lowered.includes('authentication required')
    || lowered.includes('missing bearer token')
    || lowered.includes('invalid auth token')
    || lowered.includes('auth token did not include uid')
  );
};

const TRANSIENT_UNHANDLED_REJECTION_PATTERNS = [
  'failed to fetch',
  'fetch failed',
  'network-request-failed',
  'networkerror',
  'network error',
  'connection reset',
  'connection closed',
  'socket hang up',
  'econnrefused',
  'econnreset',
  'etimedout',
  'enotfound',
  'offline',
  'timeout',
  'timed out',
  'deadline exceeded',
  'aborterror',
  'aborted',
  'cancelled',
  'canceled',
  'poll_failed',
  'background task',
  'background sync',
  'background refresh',
  'sync failed',
  'refresh failed',
];

const extractUnhandledRejectionDetails = (reason: unknown): { message: string; name: string; stack?: string } => {
  if (!reason) return { message: '', name: '' };
  if (typeof reason === 'string') {
    return { message: sanitizeUiText(reason.trim()), name: '' };
  }
  if (reason instanceof Error) {
    return {
      message: sanitizeUiText(String(reason.message || '').trim()),
      name: String(reason.name || '').trim(),
      ...(typeof reason.stack === 'string' ? { stack: reason.stack } : {}),
    };
  }
  if (typeof reason === 'object') {
    const candidate = reason as { message?: unknown; name?: unknown; stack?: unknown; cause?: unknown; detail?: unknown };
    const message = sanitizeUiText(
      String(candidate.message || candidate.detail || candidate.cause || '').trim() || String(reason).trim()
    );
    return {
      message,
      name: String(candidate.name || '').trim(),
      ...(typeof candidate.stack === 'string' ? { stack: candidate.stack } : {}),
    };
  }
  return { message: sanitizeUiText(String(reason).trim()), name: '' };
};

const isTransientUnhandledRejection = (message: string, name: string): boolean => {
  const lowered = String(message || '').trim().toLowerCase();
  const loweredName = String(name || '').trim().toLowerCase();
  if (!lowered && !loweredName) return false;
  if (loweredName === 'aborterror' || lowered.includes('aborterror')) return true;
  if (lowered.includes('aborted') || lowered.includes('cancelled') || lowered.includes('canceled')) return true;
  return TRANSIENT_UNHANDLED_REJECTION_PATTERNS.some((token) => lowered.includes(token));
};

const getTransientRecoveryDetails = (message: string, name: string): Pick<UnhandledRejectionRecovery, 'telemetryReason' | 'title' | 'message' | 'details' | 'dedupeKey'> => {
  const lowered = String(message || '').trim().toLowerCase();
  if (String(name || '').trim().toLowerCase() === 'aborterror' || lowered.includes('aborterror') || lowered.includes('aborted') || lowered.includes('cancelled') || lowered.includes('canceled')) {
    return {
      telemetryReason: 'abort',
      title: 'Request Cancelled',
      message: 'A request was cancelled before it completed. Retry if you still need it.',
      details: 'This looks like a normal cancellation, so the app stayed on screen.',
      dedupeKey: 'unhandled-rejection-transient-abort',
    };
  }
  if (lowered.includes('timeout') || lowered.includes('timed out') || lowered.includes('deadline exceeded') || lowered.includes('etimedout')) {
    return {
      telemetryReason: 'timeout',
      title: 'Request Timed Out',
      message: 'A request took too long to finish. Please retry in a moment.',
      details: 'The app stayed open because the request looks recoverable.',
      dedupeKey: 'unhandled-rejection-transient-timeout',
    };
  }
  if (
    lowered.includes('poll_failed')
    || lowered.includes('background task')
    || lowered.includes('background sync')
    || lowered.includes('background refresh')
    || lowered.includes('sync failed')
    || lowered.includes('refresh failed')
  ) {
    return {
      telemetryReason: 'background',
      title: 'Background Task Interrupted',
      message: 'A background task failed temporarily. The app stayed open so you can try again.',
      details: 'This looks like a recoverable background failure rather than a fatal app crash.',
      dedupeKey: 'unhandled-rejection-transient-background',
    };
  }
  return {
    telemetryReason: 'network',
    title: 'Connection Issue',
    message: 'A temporary connection problem interrupted part of the app. Check your connection and retry.',
    details: 'The app stayed open because the error looks transient.',
    dedupeKey: 'unhandled-rejection-transient-network',
  };
};

export const classifyUnhandledRejection = (reason: unknown): UnhandledRejectionRecovery | null => {
  const extracted = extractUnhandledRejectionDetails(reason);
  const message = extracted.message || sanitizeUiText(String(reason || 'Unhandled rejection'));
  if (isRecoverableAllowlistError(message)) {
    return {
      kind: 'allowlist',
      telemetryReason: 'uid_not_allowlisted',
      title: 'Admin Access Blocked',
      message: 'This admin action is restricted for your account.',
      details: 'Ask a workspace administrator to grant admin access for your account, then retry.',
      dedupeKey: 'admin-uid-not-allowlisted',
    };
  }
  if (isRecoverableAuthRejection(message)) {
    return {
      kind: 'auth',
      telemetryReason: 'auth_required',
      title: 'Sign In Required',
      message: 'Your session is missing or expired. Sign in again and retry.',
      details: 'The session looks recoverable after sign-in, so the app stayed open.',
      dedupeKey: 'auth-required-unhandled-rejection',
    };
  }
  if (isTransientUnhandledRejection(message, extracted.name)) {
    return {
      kind: 'transient',
      ...getTransientRecoveryDetails(message, extracted.name),
    };
  }
  return null;
};
