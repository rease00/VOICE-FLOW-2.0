import { sanitizeUiText } from '../ui/terminology';
import { isLikelyTechnicalErrorText } from '../errors/formatFrontendError';

const NETWORK_PATTERNS = [
  'cannot reach backend',
  'backend gateway is unreachable',
  'failed to fetch',
  'fetch failed',
  'network-request-failed',
  'networkerror',
  'econnrefused',
  'cors',
];

const TIMEOUT_PATTERNS = ['timeout', 'timed out', 'did not become online'];

const AUTH_PATTERNS = [
  'authentication failed',
  'authentication required',
  'invalid auth token',
  'missing bearer token',
  'invalid login',
  'invalid email or password',
  'email verification required',
  'unauthorized',
];
const TOKEN_TIMING_PATTERNS = ['token used too early', 'token is not yet valid', 'clock is out of sync'];
const ADMIN_RESTRICTION_PATTERNS = [
  'uid_not_allowlisted',
  'missing permission',
  'permission denied',
  'admin session unlock',
  'x-admin-unlock',
  'admin-unlock',
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
const INFRA_DETAIL_LEAK_PATTERNS = [
  'service_disabled',
  'googleapis.com',
  'firestore.googleapis.com',
  'activationurl',
  'metadata { key:',
  'cloud firestore api has not been used',
];
const FIREBASE_AUTH_CODE_RE = /\bauth\/[a-z0-9-]+\b/i;
const FIREBASE_PERMISSION_RE = /\bpermission[-_/]denied\b/i;

const extractRawText = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message || String(value);
  if (typeof value === 'object' && typeof (value as { message?: unknown }).message === 'string') {
    return String((value as { message: string }).message);
  }
  return String(value);
};

export const toUserMessage = (errorLike: unknown, fallback: string): string => {
  const raw = sanitizeUiText(extractRawText(errorLike).trim());
  const lowered = raw.toLowerCase();

  if (NETWORK_PATTERNS.some((token) => lowered.includes(token))) {
    return 'Cannot connect to service right now. Check connection or backend settings and retry.';
  }
  if (TIMEOUT_PATTERNS.some((token) => lowered.includes(token))) {
    return 'The request took too long. Please retry in a few moments.';
  }
  if (lowered.includes('slot set')) {
    return 'Primary AI slot set is not ready. Retry or adjust runtime settings.';
  }
  if (TOKEN_TIMING_PATTERNS.some((token) => lowered.includes(token))) {
    return 'Your device clock appears out of sync. Sync time, sign in again, and retry.';
  }
  if (FIREBASE_PERMISSION_RE.test(lowered) || ADMIN_RESTRICTION_PATTERNS.some((token) => lowered.includes(token))) {
    return 'This action is restricted for your current account permissions.';
  }
  if (SERVICE_ACCOUNT_CREDENTIAL_PATTERNS.some((token) => lowered.includes(token))) {
    return 'Runtime credentials are not configured correctly. Ask an admin to verify service-account settings.';
  }
  if (FIREBASE_AUTH_CODE_RE.test(lowered) || AUTH_PATTERNS.some((token) => lowered.includes(token))) {
    return 'Sign-in failed. Verify your account details and try again.';
  }
  if (
    lowered.includes('failed to save user profile') ||
    INFRA_DETAIL_LEAK_PATTERNS.some((token) => lowered.includes(token))
  ) {
    return 'Profile service is temporarily unavailable. Please try again in a few minutes.';
  }
  const safeFallback = sanitizeUiText(String(fallback || '').trim());
  if (!raw) return safeFallback;
  if (isLikelyTechnicalErrorText(raw)) return safeFallback || 'Something went wrong. Please try again.';
  return raw;
};

export const truncateForToast = (input: string, maxChars: number): string => {
  const compact = sanitizeUiText(String(input || '').replace(/\s+/g, ' ').trim());
  if (compact.length <= maxChars) return compact;
  if (maxChars <= 3) return '.'.repeat(Math.max(0, maxChars));
  return `${compact.slice(0, Math.max(0, maxChars - 3))}...`;
};

export const toCompactToastCopy = (title: string, message: string): { title: string; message: string } => ({
  title: truncateForToast(title, 42),
  message: truncateForToast(message, 110),
});
