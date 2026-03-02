const FALLBACK_MEDIA_BACKEND_URL = 'http://127.0.0.1:7800';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const trimTrailingSlashes = (input: string): string => input.replace(/\/+$/, '');

const resolveBrowserOriginBaseUrl = (): string => {
  if (typeof window === 'undefined' || !window.location) return '';
  const protocol = String(window.location.protocol || '').toLowerCase();
  const hostname = String(window.location.hostname || '').trim().toLowerCase();
  const origin = String(window.location.origin || '').trim();
  if (!origin) return '';
  if (protocol !== 'http:' && protocol !== 'https:') return '';
  if (LOCAL_HOSTS.has(hostname)) return '';
  return trimTrailingSlashes(origin);
};

export const resolveApiBaseUrl = (override?: string): string => {
  const fromOverride = String(override || '').trim();
  if (fromOverride) return trimTrailingSlashes(fromOverride);

  const fromEnv = String(import.meta.env.VITE_API_BASE_URL || '').trim();
  if (fromEnv) return trimTrailingSlashes(fromEnv);

  const fromBrowserOrigin = resolveBrowserOriginBaseUrl();
  if (fromBrowserOrigin) return fromBrowserOrigin;

  return FALLBACK_MEDIA_BACKEND_URL;
};

export const resolveApiUrl = (path: string, overrideBaseUrl?: string): string => {
  const rawPath = String(path || '').trim();
  if (!rawPath) return resolveApiBaseUrl(overrideBaseUrl);
  if (/^https?:\/\//i.test(rawPath)) return rawPath;

  const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  return `${resolveApiBaseUrl(overrideBaseUrl)}${normalizedPath}`;
};

export const getDefaultApiBaseUrl = (): string => resolveApiBaseUrl(undefined);
