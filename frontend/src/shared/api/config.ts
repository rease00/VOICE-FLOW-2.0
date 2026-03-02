const FALLBACK_MEDIA_BACKEND_URL = 'http://127.0.0.1:7800';

const trimTrailingSlashes = (input: string): string => input.replace(/\/+$/, '');

export const resolveApiBaseUrl = (override?: string): string => {
  const fromOverride = String(override || '').trim();
  if (fromOverride) return trimTrailingSlashes(fromOverride);

  const fromEnv = String(import.meta.env.VITE_API_BASE_URL || '').trim();
  if (fromEnv) return trimTrailingSlashes(fromEnv);

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
