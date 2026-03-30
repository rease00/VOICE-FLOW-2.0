import { readEnvValue } from '../runtime/env';

const FALLBACK_MEDIA_BACKEND_URL = '/api/backend';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const LEADING_SCHEME_TYPO_PATTERN = /^((?:https?):\/\/)!+/i;

const trimTrailingSlashes = (input: string): string => input.replace(/\/+$/, '');

const normalizeTypoPrefix = (input: string): string => input.replace(LEADING_SCHEME_TYPO_PATTERN, '$1');

const isLocalHostname = (input: string): boolean => LOCAL_HOSTS.has(String(input || '').trim().toLowerCase());

const isAbsoluteHttpUrl = (input: string): boolean => /^https?:\/\//i.test(String(input || '').trim());

const isRelativeApiBaseUrl = (input: string): boolean => {
  const token = String(input || '').trim();
  return Boolean(token) && token.startsWith('/') && !token.startsWith('//');
};

const normalizeRelativeApiBaseUrl = (input: string): string => {
  const token = String(input || '').trim();
  if (!token) {
    throw new Error('Empty API base URL.');
  }
  if (token.startsWith('//')) {
    throw new Error('Protocol-relative URLs are not supported.');
  }
  const normalized = token.startsWith('/') ? token : `/${token}`;
  return trimTrailingSlashes(normalized);
};

const toNormalizedHttpUrl = (input: string): string => {
  const candidate = String(input || '').trim();
  const withScheme = isAbsoluteHttpUrl(candidate) ? candidate : `http://${candidate}`;
  const parsed = new URL(withScheme);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are supported.');
  }
  return trimTrailingSlashes(parsed.toString());
};

const isLocalHttpUrl = (input: string): boolean => {
  try {
    return isLocalHostname(new URL(String(input || '').trim()).hostname);
  } catch {
    return false;
  }
};

const isLocalBrowserOrigin = (): boolean => {
  if (typeof window === 'undefined' || !window.location) return false;
  const protocol = String(window.location.protocol || '').toLowerCase();
  const hostname = String(window.location.hostname || '').trim().toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') return false;
  return isLocalHostname(hostname);
};

const isHostedBrowserRuntime = (): boolean => {
  if (typeof window === 'undefined' || !window.location) return false;
  const protocol = String(window.location.protocol || '').toLowerCase();
  const hostname = String(window.location.hostname || '').trim().toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') return false;
  return !isLocalHostname(hostname);
};

const resolveHostedReplacementBaseUrl = (fallbackValue?: string): string => {
  const normalizedFallback = trimTrailingSlashes(String(fallbackValue || '').trim()) || FALLBACK_MEDIA_BACKEND_URL;
  if (isHostedBrowserRuntime() && isAbsoluteHttpUrl(normalizedFallback)) {
    return FALLBACK_MEDIA_BACKEND_URL;
  }
  if (normalizedFallback && !isLocalHttpUrl(normalizedFallback)) {
    return normalizedFallback;
  }
  return FALLBACK_MEDIA_BACKEND_URL;
};

const normalizeConfiguredApiBaseUrl = (input: string | undefined, fallbackValue: string): SanitizedApiBaseUrlResult => {
  const raw = String(input || '').trim();
  const normalizedFallback = trimTrailingSlashes(
    String(fallbackValue || FALLBACK_MEDIA_BACKEND_URL).trim() || FALLBACK_MEDIA_BACKEND_URL
  );
  const fallback = resolveHostedReplacementBaseUrl(normalizedFallback);

  if (!raw) {
    return {
      input: raw,
      value: fallback,
      wasProvided: false,
      wasHealed: false,
      wasInvalid: false,
      usedFallback: true,
      fallbackValue: fallback,
    };
  }

  const typoHealed = normalizeTypoPrefix(raw);

  try {
    const normalized = isRelativeApiBaseUrl(typoHealed)
      ? normalizeRelativeApiBaseUrl(typoHealed)
      : toNormalizedHttpUrl(typoHealed);
    const shouldForceHostedProxy = (
      isHostedBrowserRuntime()
      && isAbsoluteHttpUrl(normalized)
    );
    const shouldHealLocalToFallback = (
      isLocalHttpUrl(normalized)
      && !isLocalHttpUrl(fallback)
      && !isLocalBrowserOrigin()
    );
    const healed = shouldForceHostedProxy
      ? fallback
      : (shouldHealLocalToFallback ? fallback : normalized);
    return {
      input: raw,
      value: healed,
      wasProvided: true,
      wasHealed: raw !== healed,
      wasInvalid: false,
      usedFallback: false,
      fallbackValue: fallback,
    };
  } catch {
    return {
      input: raw,
      value: fallback,
      wasProvided: true,
      wasHealed: raw !== typoHealed,
      wasInvalid: true,
      usedFallback: true,
      fallbackValue: fallback,
    };
  }
};

export interface SanitizedApiBaseUrlResult {
  input: string;
  value: string;
  wasProvided: boolean;
  wasHealed: boolean;
  wasInvalid: boolean;
  usedFallback: boolean;
  fallbackValue: string;
}

export const sanitizeConfiguredApiBaseUrl = (
  input: string | undefined,
  fallbackValue: string = getDefaultApiBaseUrl()
): SanitizedApiBaseUrlResult => {
  return normalizeConfiguredApiBaseUrl(input, fallbackValue);
};

const readConfiguredApiBaseUrl = (): string => readEnvValue(
  process.env.NEXT_PUBLIC_API_BASE_URL,
  process.env.VITE_API_BASE_URL
);

export const getDefaultApiBaseUrl = (): string => {
  const fromEnv = readConfiguredApiBaseUrl();
  if (fromEnv) return normalizeConfiguredApiBaseUrl(fromEnv, FALLBACK_MEDIA_BACKEND_URL).value;
  return FALLBACK_MEDIA_BACKEND_URL;
};

export const resolveApiBaseUrl = (override?: string): string => {
  const defaultBaseUrl = getDefaultApiBaseUrl();
  const fromOverride = normalizeConfiguredApiBaseUrl(override, defaultBaseUrl);
  if (fromOverride.wasProvided) return fromOverride.value;
  return defaultBaseUrl;
};

export const resolveApiUrl = (path: string, overrideBaseUrl?: string): string => {
  const rawPath = String(path || '').trim();
  if (!rawPath) return resolveApiBaseUrl(overrideBaseUrl);
  if (isAbsoluteHttpUrl(rawPath)) return rawPath;

  const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const baseUrl = resolveApiBaseUrl(overrideBaseUrl);
  if (isRelativeApiBaseUrl(baseUrl)) {
    return `${trimTrailingSlashes(baseUrl)}${normalizedPath}`;
  }
  return `${trimTrailingSlashes(baseUrl)}${normalizedPath}`;
};
