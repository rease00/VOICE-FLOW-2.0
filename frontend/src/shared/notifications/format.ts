import { sanitizeUiText } from '../ui/terminology';

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

const AUTH_PATTERNS = ['auth', 'credential', 'invalid login', 'unauthorized', 'forbidden'];
const INFRA_DETAIL_LEAK_PATTERNS = [
  'service_disabled',
  'googleapis.com',
  'firestore.googleapis.com',
  'activationurl',
  'metadata { key:',
  'cloud firestore api has not been used',
];

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
  if (lowered.includes('key pool')) {
    return 'Primary AI key pool is not ready. Retry or adjust runtime settings.';
  }
  if (AUTH_PATTERNS.some((token) => lowered.includes(token))) {
    return 'Authentication failed. Verify credentials and try again.';
  }
  if (
    lowered.includes('failed to save user profile') ||
    INFRA_DETAIL_LEAK_PATTERNS.some((token) => lowered.includes(token))
  ) {
    return 'Profile service is temporarily unavailable. Please try again in a few minutes.';
  }
  if (!raw) return sanitizeUiText(String(fallback || '').trim());
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
