import { NextRequest } from 'next/server';

const DEFAULT_BACKEND_ORIGIN = 'http://127.0.0.1:7800';
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

const resolveBackendOrigin = (): string => {
  const raw = String(process.env.VF_MEDIA_BACKEND_URL || '').trim();
  const candidate = raw || DEFAULT_BACKEND_ORIGIN;
  return candidate.replace(/\/+$/, '');
};

const normalizePathSegments = (segments: string[] | undefined): string => {
  const safeSegments = Array.isArray(segments) ? segments : [];
  if (safeSegments.length === 0) return '/';
  return `/${safeSegments.map((segment) => encodeURIComponent(String(segment || '').trim())).join('/')}`;
};

const createForwardHeaders = (requestHeaders: Headers): Headers => {
  const headers = new Headers(requestHeaders);
  headers.delete('host');
  headers.delete('content-length');
  for (const headerName of HOP_BY_HOP_HEADERS) {
    headers.delete(headerName);
  }
  return headers;
};

export const proxyBackendRequest = async (
  request: NextRequest,
  pathSegments: string[] = []
): Promise<Response> => {
  const target = new URL(resolveBackendOrigin());
  target.pathname = normalizePathSegments(pathSegments);
  target.search = request.nextUrl.search;

  const method = request.method.toUpperCase();
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

  const upstream = await fetch(target, upstreamInit);
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
