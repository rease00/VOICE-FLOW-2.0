import { NextRequest } from 'next/server';
import {
  getLocalDevLegacyBackendOrigin,
  isLoopbackOrigin,
  isProductionNodeEnv,
  readConfiguredLegacyBackendOriginValue,
} from '../../../src/server/replatform/backendProxyConfig';
import { verifyFirebaseRequest } from '../../../src/server/auth/requestAuth';

const DEFAULT_BACKEND_REGION_PRIORITY = ['us-central1', 'europe-west1', 'asia-southeast1'] as const;
const HEALTH_CACHE_TTL_MS = 10_000;
const DEFAULT_ALLOWED_PATH_PREFIXES = [
  '/ai',
  '/account',
  '/admin',
  '/api',
  '/auth',
  '/billing',
  '/health',
  '/routing',
  '/runtime',
  '/support',
  '/tts',
  '/v1',
  '/v2',
  '/voice-clone',
  '/voice-lab',
  '/wallet',
];
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const REQUEST_HEADER_ALLOWLIST = new Set([
  'accept',
  'accept-language',
  'authorization',
  'cache-control',
  'content-encoding',
  'content-type',
  'cookie',
  'idempotency-key',
  'if-match',
  'if-modified-since',
  'if-none-match',
  'if-range',
  'if-unmodified-since',
  'ngrok-skip-browser-warning',
  'pragma',
  'range',
  'x-correlation-id',
  'x-admin-unlock',
  'x-request-id',
  'x-vf-trace-id',
  'x-vf-tts-session-key',
]);
const SPOOFED_HEADER_PREFIXES = [
  'cf-',
  'x-amzn-',
  'x-envoy-',
  'x-forwarded-',
];
const SPOOFED_HEADERS = new Set([
  'content-length',
  'forwarded',
  'host',
  'proxy',
  'via',
  'x-client-ip',
  'x-cluster-client-ip',
  'x-dev-uid',
  'x-forwarded-client-cert',
  'x-original-forwarded-for',
  'x-original-url',
  'x-real-ip',
  'x-rewrite-url',
  'x-user-id',
]);
const SAFE_RETRY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ASIA_COUNTRIES = new Set([
  'AE', 'BD', 'BH', 'BN', 'CN', 'HK', 'ID', 'IL', 'IN', 'IQ', 'IR', 'JO', 'JP', 'KH', 'KR', 'KW',
  'KZ', 'LA', 'LB', 'LK', 'MM', 'MN', 'MO', 'MY', 'NP', 'OM', 'PH', 'PK', 'PS', 'QA', 'SA', 'SG',
  'SY', 'TH', 'TJ', 'TL', 'TM', 'TR', 'TW', 'UZ', 'VN', 'YE',
]);
const EUROPE_COUNTRIES = new Set([
  'AL', 'AD', 'AT', 'AX', 'BA', 'BE', 'BG', 'BY', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI',
  'FO', 'FR', 'GB', 'GG', 'GI', 'GR', 'HR', 'HU', 'IE', 'IM', 'IS', 'IT', 'JE', 'LI', 'LT', 'LU',
  'LV', 'MC', 'MD', 'ME', 'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'SE', 'SI', 'SJ', 'SK',
  'SM', 'UA', 'VA',
]);
const originHealthCache = new Map<string, { healthy: boolean; checkedAt: number }>();

type BackendOrigin = {
  origin: string;
  region: string;
};

const normalizeBackendOrigin = (candidate: string): string | null => {
  const raw = String(candidate || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
};

const getMissingBackendProxyReason = (): string => {
  const configuredValue = readConfiguredLegacyBackendOriginValue();
  if (configuredValue) {
    return isProductionNodeEnv()
      ? 'Legacy backend proxy targets cannot use localhost or loopback origins in production. Set VF_MEDIA_BACKEND_URL or VF_MEDIA_BACKEND_ORIGINS_JSON to a reachable remote HTTPS origin.'
      : 'Legacy backend proxy configuration is invalid. Check VF_MEDIA_BACKEND_URL or VF_MEDIA_BACKEND_ORIGINS_JSON.';
  }
  return isProductionNodeEnv()
    ? 'Legacy backend compatibility routes require VF_MEDIA_BACKEND_URL or VF_MEDIA_BACKEND_ORIGINS_JSON in production.'
    : 'Legacy backend compatibility routes require a reachable local backend or an explicit VF_MEDIA_BACKEND_URL.';
};

const parseBackendOrigins = (): BackendOrigin[] => {
  const configured = String(
    process.env.VF_MEDIA_BACKEND_ORIGINS_JSON || process.env.VF_MEDIA_BACKEND_URLS_JSON || ''
  ).trim();
  if (configured) {
    try {
      const payload = JSON.parse(configured);
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const mapped = Object.entries(payload).flatMap(([region, value]) => {
          const origin = normalizeBackendOrigin(String(value || ''));
          if (!origin) return [];
          if (isProductionNodeEnv() && isLoopbackOrigin(origin)) return [];
          return [{ region: String(region || '').trim().toLowerCase(), origin }];
        });
        if (mapped.length > 0) {
          return mapped;
        }
      }
    } catch {
      // Fall back to the single-origin path when config is malformed.
    }
  }

  const configuredOrigin = normalizeBackendOrigin(String(process.env.VF_MEDIA_BACKEND_URL || '').trim());
  if (configuredOrigin) {
    if (isProductionNodeEnv() && isLoopbackOrigin(configuredOrigin)) {
      return [];
    }
    return [{ region: 'default', origin: configuredOrigin.replace(/\/+$/, '') }];
  }

  const fallbackOrigin = normalizeBackendOrigin(getLocalDevLegacyBackendOrigin());
  if (!fallbackOrigin) {
    return [];
  }
  return [{ region: 'local-dev', origin: fallbackOrigin.replace(/\/+$/, '') }];
};

const preferredRegionOrder = (request: NextRequest, configuredRegions: string[]): string[] => {
  const available = Array.from(new Set(
    configuredRegions
      .map((region) => String(region || '').trim().toLowerCase())
      .filter(Boolean)
  ));
  if (available.length <= 1) return available;

  const explicitHint = String(request.headers.get('x-vf-region-hint') || '').trim().toLowerCase();
  const country = String(request.headers.get('cf-ipcountry') || '').trim().toUpperCase();

  let baseline = [...DEFAULT_BACKEND_REGION_PRIORITY];
  if (ASIA_COUNTRIES.has(country)) {
    baseline = ['asia-southeast1', 'europe-west1', 'us-central1'];
  } else if (EUROPE_COUNTRIES.has(country)) {
    baseline = ['europe-west1', 'us-central1', 'asia-southeast1'];
  }

  const ordered = [
    ...(explicitHint ? [explicitHint] : []),
    ...baseline,
    ...available,
  ];
  return Array.from(new Set(ordered)).filter((region) => available.includes(region));
};

const probeBackendOriginHealth = async (origin: string): Promise<boolean> => {
  const safeOrigin = String(origin || '').trim().replace(/\/+$/, '');
  if (!safeOrigin) return false;
  const now = Date.now();
  const cached = originHealthCache.get(safeOrigin);
  if (cached && (now - cached.checkedAt) < HEALTH_CACHE_TTL_MS) {
    return cached.healthy;
  }

  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 1500);
  let healthy = false;
  try {
    const response = await fetch(`${safeOrigin}/health`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'ngrok-skip-browser-warning': 'true' },
    });
    healthy = response.ok;
  } catch {
    healthy = false;
  } finally {
    globalThis.clearTimeout(timer);
  }

  originHealthCache.set(safeOrigin, { healthy, checkedAt: now });
  return healthy;
};

const resolveBackendOriginsForRequest = async (request: NextRequest): Promise<BackendOrigin[]> => {
  const origins = parseBackendOrigins();
  if (origins.length <= 1) return origins;

  const orderedRegions = preferredRegionOrder(
    request,
    origins.map((origin) => origin.region),
  );
  const prioritized = orderedRegions
    .map((region) => origins.find((origin) => origin.region === region))
    .filter((origin): origin is BackendOrigin => Boolean(origin));
  const remainder = origins.filter((origin) => !prioritized.some((item) => item.origin === origin.origin));
  const candidates = [...prioritized, ...remainder];

  const healthy: BackendOrigin[] = [];
  for (const candidate of candidates) {
    if (await probeBackendOriginHealth(candidate.origin)) {
      healthy.push(candidate);
    }
  }
  return healthy.length > 0 ? healthy : candidates;
};

const parsePathPrefixes = (raw: string | undefined, fallback: string[]): string[] => {
  const source = String(raw || '').trim();
  const candidates = (source ? source.split(',') : fallback)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .map((entry) => {
      const normalized = entry.startsWith('/') ? entry : `/${entry}`;
      return normalized.replace(/\/+$/, '') || '/';
    })
    .filter((entry) => entry !== '/');
  return Array.from(new Set(candidates));
};

const getAllowedPathPrefixes = (): string[] => parsePathPrefixes(
  process.env.VF_BACKEND_PROXY_ALLOWLIST,
  DEFAULT_ALLOWED_PATH_PREFIXES
);

const getUnsafeMethodPrefixes = (): string[] => parsePathPrefixes(
  process.env.VF_BACKEND_PROXY_MUTATION_ALLOWLIST,
  getAllowedPathPrefixes()
);

const normalizePathSegments = (segments: string[] | undefined): string => {
  const safeSegments = Array.isArray(segments) ? segments : [];
  if (safeSegments.length === 0) return '/';
  return `/${safeSegments.map((segment) => encodeURIComponent(String(segment || '').trim())).join('/')}`;
};

const pathMatchesPrefix = (pathname: string, prefixes: string[]): boolean => {
  const normalized = String(pathname || '').trim();
  if (!normalized || !normalized.startsWith('/')) return false;
  return prefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
};

const shouldStripClientHeader = (headerName: string): boolean => {
  const normalized = String(headerName || '').trim().toLowerCase();
  if (!normalized) return true;
  if (SPOOFED_HEADERS.has(normalized)) return true;
  return SPOOFED_HEADER_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

const createForwardHeaders = (requestHeaders: Headers): Headers => {
  const headers = new Headers();
  for (const [name, value] of requestHeaders.entries()) {
    const normalizedName = String(name || '').trim().toLowerCase();
    const normalizedValue = String(value || '').trim();
    if (!normalizedName || !normalizedValue) continue;
    if (shouldStripClientHeader(normalizedName)) continue;
    if (!REQUEST_HEADER_ALLOWLIST.has(normalizedName)) continue;
    headers.set(normalizedName, normalizedValue);
  }

  headers.delete('host');
  headers.delete('content-length');
  for (const headerName of HOP_BY_HOP_HEADERS) {
    headers.delete(headerName);
  }
  return headers;
};

const toUpstreamFailureMessage = (target: URL, error: unknown): string => {
  const reason = error instanceof Error
    ? String(error.message || '').trim()
    : String(error || '').trim();
  const targetPath = `${target.pathname || '/'}${target.search || ''}`;
  const base = `Backend upstream request failed for ${targetPath}.`;
  if (!reason) return base;
  return `${base} ${reason}`;
};

const applyLegacyProxyHeaders = (headers: Headers, pathname: string): Headers => {
  headers.set('x-vf-legacy-proxy', 'true');
  headers.set('x-vf-legacy-proxy-mode', 'compatibility-shim');
  headers.set('x-vf-canonical-api-base', '/api/v1');
  headers.set('x-vf-legacy-path', String(pathname || '/'));
  return headers;
};

const buildMissingBackendProxyResponse = (pathname: string): Response => {
  return new Response(
    JSON.stringify({
      detail: getMissingBackendProxyReason(),
      path: String(pathname || '/'),
    }),
    {
      status: 503,
      headers: applyLegacyProxyHeaders(
        new Headers({ 'content-type': 'application/json; charset=utf-8' }),
        pathname,
      ),
    }
  );
};

const hasVerifiedAuthContext = async (request: NextRequest): Promise<boolean> => {
  try {
    await verifyFirebaseRequest(request);
    return true;
  } catch {
    return false;
  }
};

export const proxyBackendRequest = async (
  request: NextRequest,
  pathSegments: string[] = []
): Promise<Response> => {
  const method = request.method.toUpperCase();
  const normalizedPath = normalizePathSegments(pathSegments);
  const allowedPathPrefixes = getAllowedPathPrefixes();
  const unsafeMethodPrefixes = getUnsafeMethodPrefixes();
  if (!pathMatchesPrefix(normalizedPath, allowedPathPrefixes)) {
    return new Response('Backend path is not allowed by proxy policy.', {
      status: 403,
      headers: applyLegacyProxyHeaders(new Headers(), normalizedPath),
    });
  }
  if (UNSAFE_METHODS.has(method) && !pathMatchesPrefix(normalizedPath, unsafeMethodPrefixes)) {
    return new Response('Backend method is not allowed by proxy policy.', {
      status: 405,
      headers: applyLegacyProxyHeaders(new Headers(), normalizedPath),
    });
  }
  if (UNSAFE_METHODS.has(method) && !(await hasVerifiedAuthContext(request))) {
    return new Response('Backend proxy requires authentication for write methods.', {
      status: 401,
      headers: applyLegacyProxyHeaders(new Headers(), normalizedPath),
    });
  }

  const hasBody = !['GET', 'HEAD'].includes(method) && request.body !== null;
  const forwardHeaders = createForwardHeaders(request.headers);
  const upstreamInit: RequestInit & { duplex?: 'half' } = {
    method,
    headers: forwardHeaders,
    cache: 'no-store',
  };
  if (hasBody) {
    upstreamInit.body = request.body;
    upstreamInit.duplex = 'half';
  }

  const backendCandidates = await resolveBackendOriginsForRequest(request);
  if (backendCandidates.length === 0) {
    return buildMissingBackendProxyResponse(normalizedPath);
  }
  const retryable = SAFE_RETRY_METHODS.has(method);
  const attempts = retryable ? backendCandidates : backendCandidates.slice(0, 1);
  let lastFailure: { target: URL; error: unknown; region: string } | null = null;

  for (const candidate of attempts) {
    const target = new URL(candidate.origin);
    target.pathname = normalizedPath;
    target.search = request.nextUrl.search;
    try {
      const upstream = await fetch(target, upstreamInit);
      const responseHeaders = new Headers(upstream.headers);
      for (const headerName of HOP_BY_HOP_HEADERS) {
        responseHeaders.delete(headerName);
      }
      responseHeaders.set('x-v-flow-ai-backend-origin', candidate.origin);
      if (candidate.region && candidate.region !== 'default') {
        responseHeaders.set('x-v-flow-ai-backend-region', candidate.region);
      }
      applyLegacyProxyHeaders(responseHeaders, normalizedPath);
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    } catch (error: unknown) {
      lastFailure = { target, error, region: candidate.region };
      if (!retryable) {
        break;
      }
    }
  }

  return new Response(
    JSON.stringify({
      detail: toUpstreamFailureMessage(
        lastFailure?.target || new URL(`https://unresolved.invalid${normalizedPath}`),
        lastFailure?.error || 'No healthy backend origin was available.'
      ),
      ...(lastFailure?.region ? { region: lastFailure.region } : {}),
    }),
    {
      status: 502,
      headers: applyLegacyProxyHeaders(
        new Headers({ 'content-type': 'application/json; charset=utf-8' }),
        normalizedPath,
      ),
    }
  );
};
