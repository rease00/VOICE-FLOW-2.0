import { authFetch } from '../../../services/authHttpClient';
import { resolveApiUrl } from './config';
import { fetchWithRequestDedup } from './requestDeduper';

export class HttpError extends Error {
  status: number;
  statusText: string;
  detail: string;

  constructor(status: number, statusText: string, detail: string) {
    super(detail || `${status} ${statusText}`);
    this.status = status;
    this.statusText = statusText;
    this.detail = detail || `${status} ${statusText}`;
  }
}

const SENSITIVE_INFRA_DETAIL_PATTERNS = [
  'service_disabled',
  'firestore.googleapis.com',
  'googleapis.com',
  'metadata { key:',
  'activationurl',
  'traceback',
];

const toSafeHttpErrorDetail = (rawDetail: string, status: number, statusText: string): string => {
  const detail = String(rawDetail || '').trim();
  const lowered = detail.toLowerCase();
  if (!detail) {
    return `${status} ${statusText}`.trim();
  }
  if (
    lowered.includes('failed to save user profile') ||
    SENSITIVE_INFRA_DETAIL_PATTERNS.some((token) => lowered.includes(token))
  ) {
    return 'Profile service is temporarily unavailable. Please try again in a few minutes.';
  }
  return detail;
};

const normalizeApiErrorFragment = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const extractApiErrorDetail = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') return '';
  const source = payload as Record<string, unknown>;
  const detail = source.detail;
  if (typeof detail === 'string') {
    const token = normalizeApiErrorFragment(detail);
    if (token) return token;
  }
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const nested = extractApiErrorDetail(detail);
    if (nested) return nested;
  }
  const message = normalizeApiErrorFragment(source.message);
  const summary = normalizeApiErrorFragment(source.summary);
  const error = normalizeApiErrorFragment(source.error);
  const reason = normalizeApiErrorFragment(source.reason);
  const errorCode = normalizeApiErrorFragment(source.errorCode);
  const primary = summary || error || message;
  const tags = [errorCode, reason].filter(Boolean);
  if (primary && tags.length > 0) return `${primary} (${tags.join(': ')})`;
  if (primary) return primary;
  if (tags.length > 0) return tags.join(': ');
  return '';
};

export const parseResponseError = async (response: Response): Promise<HttpError> => {
  let detail = `${response.status} ${response.statusText}`;
  try {
    const payload = await response.json();
    const apiDetail = extractApiErrorDetail(payload);
    if (apiDetail) detail = apiDetail;
  } catch {
    // no-op
  }
  return new HttpError(
    response.status,
    response.statusText,
    toSafeHttpErrorDetail(detail, response.status, response.statusText)
  );
};

export const readJsonOrThrow = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    throw await parseResponseError(response);
  }
  return response.json() as Promise<T>;
};

export interface ApiRequestOptions {
  baseUrl?: string;
  requireAuth?: boolean;
}

const request = async (
  pathOrUrl: string,
  init: RequestInit | undefined,
  options: ApiRequestOptions | undefined
): Promise<Response> => {
  const url = resolveApiUrl(pathOrUrl, options?.baseUrl);
  return authFetch(url, init, { requireAuth: Boolean(options?.requireAuth) });
};

const requestPublic = async (
  pathOrUrl: string,
  init: RequestInit | undefined,
  options: ApiRequestOptions | undefined
): Promise<Response> => {
  const url = resolveApiUrl(pathOrUrl, options?.baseUrl);
  return fetchWithRequestDedup(url, init);
};

export const requestJson = async <T>(
  pathOrUrl: string,
  init?: RequestInit,
  options?: ApiRequestOptions
): Promise<T> => {
  const response = await request(pathOrUrl, init, options);
  return readJsonOrThrow<T>(response);
};

export const requestPublicJson = async <T>(
  pathOrUrl: string,
  init?: RequestInit,
  options?: ApiRequestOptions
): Promise<T> => {
  const response = await requestPublic(pathOrUrl, init, options);
  return readJsonOrThrow<T>(response);
};

export const requestBlob = async (
  pathOrUrl: string,
  init?: RequestInit,
  options?: ApiRequestOptions
): Promise<Blob> => {
  const response = await request(pathOrUrl, init, options);
  if (!response.ok) {
    throw await parseResponseError(response);
  }
  return response.blob();
};
