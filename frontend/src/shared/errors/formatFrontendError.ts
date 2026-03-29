import { sanitizeUiText } from '../ui/terminology';

export type FrontendErrorContext =
  | 'auth'
  | 'generation'
  | 'billing'
  | 'support'
  | 'media'
  | 'runtime'
  | 'generic';

export interface FormatFrontendErrorOptions {
  fallback?: string;
  context?: FrontendErrorContext;
  isAdmin?: boolean;
}

export interface FormattedFrontendError {
  publicMessage: string;
  adminDetails?: string;
  isTechnical: boolean;
  rawMessage: string;
}

const DEFAULT_CONTEXT_COPY: Record<FrontendErrorContext, string> = {
  auth: 'We could not verify your account right now. Please sign in again and try once more.',
  generation: 'Generation could not complete right now. Please try again in a moment.',
  billing: 'Billing is temporarily unavailable. Please try again in a moment.',
  support: 'Support is temporarily unavailable. Please try again in a moment.',
  media: 'Media processing could not complete right now. Please try again.',
  runtime: 'The runtime is temporarily unavailable right now. Please try again in a moment.',
  generic: 'Something went wrong. Please try again.',
};

const NETWORK_PATTERNS = [
  'cannot reach backend',
  'backend gateway is unreachable',
  'failed to fetch',
  'fetch failed',
  'network-request-failed',
  'networkerror',
  'cors',
  'econnrefused',
  'socket hang up',
  'network error',
  'connection refused',
  'backend unreachable',
];

const TIMEOUT_PATTERNS = [
  'timeout',
  'timed out',
  'did not become online',
  'deadline exceeded',
  'took too long',
];

const AUTH_PATTERNS = [
  'missing bearer token',
  'invalid auth token',
  'authentication was rejected',
  'authentication required',
  'authentication failed',
  'auth token',
  'unauthorized',
  'invalid email or password',
  'email verification required',
  'token used too early',
  'token is not yet valid',
  'clock is out of sync',
];

const ADMIN_RESTRICTION_PATTERNS = [
  'uid_not_allowlisted',
  'missing permission',
  'permission denied',
  'forbidden',
];

const SERVICE_ACCOUNT_CREDENTIAL_PATTERNS = [
  'service account',
  'google_application_credentials',
  'credential_path',
  'credentials path',
  'credentials file',
  'application default credentials',
  'metadata server',
];

const PROFILE_PATTERNS = [
  'complete your user id',
  'complete your userid',
  'requireduserid',
  'failed to save user profile',
  'profile service',
  'user profile',
  'service_disabled',
  'googleapis.com',
  'firestore.googleapis.com',
  'cloud firestore api has not been used',
  'metadata { key:',
];

const QUOTA_PATTERNS = [
  'quota',
  'rate limit',
  'too many requests',
  'limit reached',
  'rpm_exhausted',
  'capacity_pressure',
];

const BALANCE_PATTERNS = [
  'insufficient',
  'low balance',
  'wallet',
  'not enough vf',
  'balance',
];

const BILLING_PATTERNS = [
  'checkout',
  'billing portal',
  'stripe',
  'invoice',
  'payment',
  'coupon',
];

const SUPPORT_PATTERNS = [
  'support conversation',
  'support request',
  'support message',
  'help desk',
];

const MEDIA_PATTERNS = [
  'audio',
  'video',
  'upload',
  'download',
  'import failed',
  'dub',
  'transcription',
  'media resource',
];

const RUNTIME_PATTERNS = [
  'runtime',
  'slot set',
  'x-admin-unlock',
  'admin-unlock',
  'admin session unlock',
  'uid_not_allowlisted',
  'upstream_model_failed',
  'upstream model failed',
  'tail_carry_retry',
  'chunk_gap_blocked',
  'structured_chunk_missing',
  'runtime_corrupt_audio',
  'codec_decode_failed',
  'cache_io_failed',
  'poll_failed',
  'session_migration_failed',
  'chunk_failed',
  'generation_failed',
  'provider_error',
  'upstream_failure',
];

const SENSITIVE_TECHNICAL_PATTERNS = [
  'missing bearer token',
  'invalid auth token',
  'token used too early',
  'token is not yet valid',
  'complete your user id',
  'complete your userid',
  'requireduserid',
  'uid_not_allowlisted',
  'service_disabled',
  'googleapis.com',
  'firestore.googleapis.com',
  'cloud firestore api has not been used',
  'metadata { key:',
  'billing portal url is missing',
  'x-admin-unlock',
  'admin-unlock',
  'slot set',
  'upstream_model_failed',
  'upstream model failed',
  'missing permission',
  'permission denied',
  'service account',
  'google_application_credentials',
  'credentials path',
  'application default credentials',
];

const TECHNICAL_TOKENS = [
  'trace_id',
  'trace-id',
  'stack',
  'exception',
  'response headers',
  'status code',
  'status:',
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  'http://',
  'https://',
  'wss://',
  'ws://',
  'json',
  'chunk_failed',
  'generation_failed',
  'provider_error',
  'upstream_failure',
];

const URL_OR_HOST_PATTERN = /\b(?:https?:\/\/|wss?:\/\/|ws:\/\/|localhost(?::\d+)?|127(?:\.\d{1,3}){3}(?::\d+)?|0\.0\.0\.0(?::\d+)?)/i;
const STACK_PATTERN = /(^|\n)\s*at\s+[^\n]+/i;
const JSON_PATTERN = /^\s*[{[][\s\S]*[}\]]\s*$/;
const JSON_FIELD_PATTERN = /"[^"]+"\s*:/;
const STATUS_PATTERN = /\b(?:status(?:\s+code)?|http)\s*(?:=|:)?\s*(4\d{2}|5\d{2})\b/i;
const PORT_PATTERN = /\b[A-Za-z0-9._-]+:\d{2,5}\b/;
const FIREBASE_AUTH_CODE_RE = /\bauth\/[a-z0-9-]+\b/i;
const FIREBASE_PERMISSION_RE = /\bpermission[-_/]denied\b/i;

const matchesAny = (value: string, tokens: string[]): boolean =>
  tokens.some((token) => value.includes(token));

const PASS_THROUGH_BLOCK_PATTERNS = [
  ...AUTH_PATTERNS,
  ...ADMIN_RESTRICTION_PATTERNS,
  ...SERVICE_ACCOUNT_CREDENTIAL_PATTERNS,
  'authentication failed',
  'authentication required',
  'forbidden',
  'unauthorized',
];

const networkCopyForContext = (context: FrontendErrorContext): string => {
  if (context === 'billing') return 'Billing is temporarily unavailable. Check your connection and try again.';
  if (context === 'support') return 'Support is temporarily unavailable. Check your connection and try again.';
  if (context === 'generation') return 'Generation services are temporarily unavailable. Check your connection and try again.';
  if (context === 'media') return 'Media services are temporarily unavailable. Check your connection and try again.';
  if (context === 'auth') return 'We could not verify your account right now. Check your connection, then sign in again.';
  if (context === 'runtime') return 'Cannot connect to the runtime right now. Check your connection and try again.';
  return 'Cannot connect to service right now. Check your connection and try again.';
};

const timeoutCopyForContext = (context: FrontendErrorContext): string => {
  if (context === 'billing') return 'Billing is taking too long to respond. Please retry in a moment.';
  if (context === 'support') return 'Support is taking too long to respond. Please retry in a moment.';
  if (context === 'generation') return 'The request took too long. Please retry generation in a moment.';
  if (context === 'media') return 'Media processing is taking too long. Please retry in a moment.';
  if (context === 'runtime') return 'The runtime is taking too long to respond. Please retry in a moment.';
  return 'The request took too long. Please try again in a moment.';
};

const profileCopyForContext = (context: FrontendErrorContext): string => {
  if (context === 'auth') return 'Complete your user ID setup to continue.';
  return 'Profile service is temporarily unavailable. Please try again in a few minutes.';
};

const truncateDetails = (input: string, maxChars = 1600): string => {
  const compact = String(input || '').replace(/\r/g, '').trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 3))}...`;
};

export const extractFrontendErrorText = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    const errorWithDetail = value as Error & { detail?: unknown; cause?: unknown };
    const parts = [
      String(value.message || '').trim(),
      extractFrontendErrorText(errorWithDetail.detail),
      extractFrontendErrorText(errorWithDetail.cause),
    ].filter((part) => typeof part === 'string' && part.trim().length > 0);
    return parts.join('\n');
  }
  if (typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    const preferredFields = ['message', 'code', 'errorCode', 'reason', 'detail', 'error', 'statusText'];
    const parts = preferredFields
      .map((key) => candidate[key])
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .map((part) => part.trim());
    if (typeof candidate.trace_id === 'string' && candidate.trace_id.trim()) {
      parts.push(`trace_id=${candidate.trace_id.trim()}`);
    }
    if (parts.length > 0) return parts.join('\n');
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

export const isLikelyTechnicalErrorText = (input: string): boolean => {
  const raw = String(input || '').trim();
  if (!raw) return false;
  const lowered = raw.toLowerCase();
  return (
    matchesAny(lowered, TECHNICAL_TOKENS)
    || matchesAny(lowered, NETWORK_PATTERNS)
    || matchesAny(lowered, TIMEOUT_PATTERNS)
    || matchesAny(lowered, SENSITIVE_TECHNICAL_PATTERNS)
    || STACK_PATTERN.test(raw)
    || JSON_PATTERN.test(raw)
    || JSON_FIELD_PATTERN.test(raw)
    || URL_OR_HOST_PATTERN.test(raw)
    || STATUS_PATTERN.test(raw)
    || PORT_PATTERN.test(raw)
  );
};

const isSafePassThrough = (input: string): boolean => {
  const raw = String(input || '').trim();
  if (!raw) return false;
  if (raw.length > 220) return false;
  if (raw.includes('\n')) return false;
  const lowered = raw.toLowerCase();
  if (matchesAny(lowered, PASS_THROUGH_BLOCK_PATTERNS)) return false;
  if (FIREBASE_AUTH_CODE_RE.test(raw) || FIREBASE_PERMISSION_RE.test(raw)) return false;
  return !isLikelyTechnicalErrorText(raw);
};

export const formatFrontendError = (
  errorLike: unknown,
  options: FormatFrontendErrorOptions = {}
): FormattedFrontendError => {
  const context = options.context || 'generic';
  const fallback = sanitizeUiText(String(options.fallback || DEFAULT_CONTEXT_COPY[context] || DEFAULT_CONTEXT_COPY.generic).trim())
    || DEFAULT_CONTEXT_COPY[context]
    || DEFAULT_CONTEXT_COPY.generic;
  const rawMessage = sanitizeUiText(extractFrontendErrorText(errorLike).trim());

  if (!rawMessage) {
    return {
      publicMessage: fallback,
      isTechnical: false,
      rawMessage: '',
    };
  }

  if (isSafePassThrough(rawMessage)) {
    return {
      publicMessage: rawMessage,
      isTechnical: false,
      rawMessage,
    };
  }

  const lowered = rawMessage.toLowerCase();
  let publicMessage = fallback;

  if (matchesAny(lowered, NETWORK_PATTERNS)) {
    publicMessage = networkCopyForContext(context);
  } else if (matchesAny(lowered, TIMEOUT_PATTERNS)) {
    publicMessage = timeoutCopyForContext(context);
  } else if (
    lowered.includes('token used too early')
    || lowered.includes('token is not yet valid')
    || lowered.includes('clock is out of sync')
  ) {
    publicMessage = 'Your device clock appears out of sync. Sync the clock, sign in again, and retry.';
  } else if (lowered.includes('uid_not_allowlisted')) {
    publicMessage = 'This admin action is restricted for your account.';
  } else if (
    lowered.includes('x-admin-unlock')
    || lowered.includes('admin session unlock')
    || lowered.includes('admin-unlock')
  ) {
    publicMessage = 'This action requires an active admin session unlock.';
  } else if (matchesAny(lowered, ADMIN_RESTRICTION_PATTERNS)) {
    publicMessage = 'This action is restricted for your account permissions.';
  } else if (matchesAny(lowered, SERVICE_ACCOUNT_CREDENTIAL_PATTERNS)) {
    publicMessage = 'Runtime credentials are not configured correctly. Ask an admin to verify service-account settings.';
  } else if (
    lowered.includes('complete your user id')
    || lowered.includes('complete your userid')
    || lowered.includes('requireduserid')
  ) {
    publicMessage = 'Complete your user ID setup to continue.';
  } else if (FIREBASE_AUTH_CODE_RE.test(lowered) || matchesAny(lowered, AUTH_PATTERNS)) {
    publicMessage = DEFAULT_CONTEXT_COPY.auth;
  } else if (FIREBASE_PERMISSION_RE.test(lowered)) {
    publicMessage = 'This action is restricted for your account permissions.';
  } else if (matchesAny(lowered, PROFILE_PATTERNS)) {
    publicMessage = profileCopyForContext(context);
  } else if (matchesAny(lowered, QUOTA_PATTERNS)) {
    publicMessage = 'This action is temporarily rate-limited. Please wait a moment and try again.';
  } else if (lowered.includes('tail_carry_retry')) {
    publicMessage = 'Live generation is retrying a delayed chunk. Please wait a moment and try again if playback stalls.';
  } else if (lowered.includes('chunk_gap_blocked') || lowered.includes('structured_chunk_missing')) {
    publicMessage = 'Live playback is waiting for an earlier chunk to finish. Please retry in a moment.';
  } else if (lowered.includes('runtime_corrupt_audio') || lowered.includes('codec_decode_failed')) {
    publicMessage = 'Audio playback data could not be decoded cleanly. Please retry generation.';
  } else if (lowered.includes('cache_io_failed')) {
    publicMessage = 'Generated audio could not be stored safely. Please retry in a moment.';
  } else if (lowered.includes('poll_failed')) {
    publicMessage = 'We lost contact with the live job status stream. Please retry in a moment.';
  } else if (lowered.includes('session_migration_failed')) {
    publicMessage = 'A saved live session could not be restored cleanly. Please start a fresh run.';
  } else if (matchesAny(lowered, BALANCE_PATTERNS)) {
    publicMessage = 'You do not have enough VF balance for this action.';
  } else if (matchesAny(lowered, BILLING_PATTERNS) || lowered.includes('billing portal url is missing')) {
    publicMessage = DEFAULT_CONTEXT_COPY.billing;
  } else if (matchesAny(lowered, SUPPORT_PATTERNS)) {
    publicMessage = DEFAULT_CONTEXT_COPY.support;
  } else if (matchesAny(lowered, MEDIA_PATTERNS)) {
    publicMessage = DEFAULT_CONTEXT_COPY.media;
  } else if (matchesAny(lowered, RUNTIME_PATTERNS)) {
    publicMessage = DEFAULT_CONTEXT_COPY.runtime;
  } else if (JSON_PATTERN.test(rawMessage) || JSON_FIELD_PATTERN.test(rawMessage)) {
    publicMessage = fallback;
  }

  const isTechnical = publicMessage !== rawMessage || isLikelyTechnicalErrorText(rawMessage);
  return {
    publicMessage: publicMessage || fallback,
    ...(options.isAdmin && isTechnical ? { adminDetails: truncateDetails(rawMessage) } : {}),
    isTechnical,
    rawMessage,
  };
};
