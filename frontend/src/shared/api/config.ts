const FALLBACK_MEDIA_BACKEND_URL = 'http://127.0.0.1:7800';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const LEADING_SCHEME_TYPO_PATTERN = /^((?:https?):\/\/)!+/i;

const trimTrailingSlashes = (input: string): string => input.replace(/\/+$/, '');

const normalizeTypoPrefix = (input: string): string => input.replace(LEADING_SCHEME_TYPO_PATTERN, '$1');

const isLocalHostname = (input: string): boolean => LOCAL_HOSTS.has(String(input || '').trim().toLowerCase());

const toNormalizedHttpUrl = (input: string): string => {
  const candidate = String(input || '').trim();
  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `http://${candidate}`;
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

const resolveHostedReplacementBaseUrl = (fallbackValue?: string): string => {
  const normalizedFallback = trimTrailingSlashes(String(fallbackValue || '').trim());
  if (normalizedFallback && !isLocalHttpUrl(normalizedFallback)) {
    return normalizedFallback;
  }

  const browserOrigin = resolveBrowserOriginBaseUrl();
  if (browserOrigin) return browserOrigin;

  return normalizedFallback;
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

const resolveBrowserOriginBaseUrl = (): string => {
  if (typeof window === 'undefined' || !window.location) return '';
  const protocol = String(window.location.protocol || '').toLowerCase();
  const hostname = String(window.location.hostname || '').trim().toLowerCase();
  const origin = String(window.location.origin || '').trim();
  if (!origin) return '';
  if (protocol !== 'http:' && protocol !== 'https:') return '';
  if (isLocalHostname(hostname)) return '';
  return trimTrailingSlashes(origin);
};

const healHostedRuntimeLocalUrl = (candidate: string, fallbackValue?: string): string => {
  const replacement = resolveHostedReplacementBaseUrl(fallbackValue);
  if (!replacement || isLocalHttpUrl(replacement)) return candidate;
  if (!isLocalHttpUrl(candidate)) return candidate;
  return replacement;
};

const sanitizeConfiguredApiBaseUrlInternal = (input: string | undefined, fallbackValue: string): SanitizedApiBaseUrlResult => {
  const raw = String(input || '').trim();
  const normalizedFallback = trimTrailingSlashes(
    String(fallbackValue || FALLBACK_MEDIA_BACKEND_URL).trim() || FALLBACK_MEDIA_BACKEND_URL
  );
  const fallback = healHostedRuntimeLocalUrl(normalizedFallback, normalizedFallback);

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
    const normalized = healHostedRuntimeLocalUrl(toNormalizedHttpUrl(typoHealed), fallback);
    return {
      input: raw,
      value: normalized,
      wasProvided: true,
      wasHealed: raw !== normalized,
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

export const sanitizeConfiguredApiBaseUrl = (
  input: string | undefined,
  fallbackValue: string = resolveApiBaseUrl()
): SanitizedApiBaseUrlResult => {
  return sanitizeConfiguredApiBaseUrlInternal(input, fallbackValue);
};

export const getDefaultApiBaseUrl = (): string => {
  const fromEnv = String(import.meta.env.VITE_API_BASE_URL || '').trim();
  if (fromEnv) return sanitizeConfiguredApiBaseUrl(fromEnv, FALLBACK_MEDIA_BACKEND_URL).value;

  const fromBrowserOrigin = resolveBrowserOriginBaseUrl();
  if (fromBrowserOrigin) return fromBrowserOrigin;

  return FALLBACK_MEDIA_BACKEND_URL;
};

export const resolveApiBaseUrl = (override?: string): string => {
  const defaultBaseUrl = getDefaultApiBaseUrl();
  const fromOverride = sanitizeConfiguredApiBaseUrl(override, defaultBaseUrl);
  if (fromOverride.wasProvided) return fromOverride.value;
  return defaultBaseUrl;
};

export const resolveApiUrl = (path: string, overrideBaseUrl?: string): string => {
  const rawPath = String(path || '').trim();
  if (!rawPath) return resolveApiBaseUrl(overrideBaseUrl);
  if (/^https?:\/\//i.test(rawPath)) return rawPath;

  const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  return `${resolveApiBaseUrl(overrideBaseUrl)}${normalizedPath}`;
};
