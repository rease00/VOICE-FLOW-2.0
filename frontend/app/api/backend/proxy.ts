import { NextRequest } from 'next/server';

const DEFAULT_BACKEND_ORIGIN = 'http://127.0.0.1:7800';
const DEFAULT_ALLOWED_PATH_PREFIXES = [
  '/account',
  '/admin',
  '/api',
  '/auth',
  '/billing',
  '/health',
  '/reader',
  '/runtime',
  '/tts',
  '/v1',
  '/v2',
  '/voice-clone',
  '/voice-lab',
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

const resolveBackendOrigin = (): string => {
  const raw = String(process.env.VF_MEDIA_BACKEND_URL || '').trim();
  const candidate = raw || DEFAULT_BACKEND_ORIGIN;
  return candidate.replace(/\/+$/, '');
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

export const proxyBackendRequest = async (
  request: NextRequest,
  pathSegments: string[] = []
): Promise<Response> => {
  const target = new URL(resolveBackendOrigin());
  target.pathname = normalizePathSegments(pathSegments);
  target.search = request.nextUrl.search;

  const method = request.method.toUpperCase();
  const allowedPathPrefixes = getAllowedPathPrefixes();
  const unsafeMethodPrefixes = getUnsafeMethodPrefixes();
  const hasAuthContext = Boolean(
    String(request.headers.get('authorization') || '').trim()
    || String(request.headers.get('cookie') || '').trim()
  );
  if (!pathMatchesPrefix(target.pathname, allowedPathPrefixes)) {
    return new Response('Backend path is not allowed by proxy policy.', { status: 403 });
  }
  if (UNSAFE_METHODS.has(method) && !pathMatchesPrefix(target.pathname, unsafeMethodPrefixes)) {
    return new Response('Backend method is not allowed by proxy policy.', { status: 405 });
  }
  if (UNSAFE_METHODS.has(method) && !hasAuthContext) {
    return new Response('Backend proxy requires authentication for write methods.', { status: 401 });
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

  let upstream: Response;
  try {
    upstream = await fetch(target, upstreamInit);
  } catch (error: unknown) {
    return new Response(
      JSON.stringify({ detail: toUpstreamFailureMessage(target, error) }),
      {
        status: 502,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }
    );
  }
  const responseHeaders = new Headers(upstream.headers);
  for (const headerName of HOP_BY_HOP_HEADERS) {
    responseHeaders.delete(headerName);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};
