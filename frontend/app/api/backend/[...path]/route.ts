import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '../proxy';

interface BackendProxyRouteContext {
  params: Promise<{ path?: string[] }>;
}

const resolvePathSegments = async (context: BackendProxyRouteContext): Promise<string[]> => {
  const resolved = await context.params;
  return Array.isArray(resolved.path) ? resolved.path : [];
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = async (request: NextRequest, context: BackendProxyRouteContext) =>
  proxyBackendRequest(request, await resolvePathSegments(context));
export const POST = async (request: NextRequest, context: BackendProxyRouteContext) =>
  proxyBackendRequest(request, await resolvePathSegments(context));
export const PUT = async (request: NextRequest, context: BackendProxyRouteContext) =>
  proxyBackendRequest(request, await resolvePathSegments(context));
export const PATCH = async (request: NextRequest, context: BackendProxyRouteContext) =>
  proxyBackendRequest(request, await resolvePathSegments(context));
export const DELETE = async (request: NextRequest, context: BackendProxyRouteContext) =>
  proxyBackendRequest(request, await resolvePathSegments(context));
export const HEAD = async (request: NextRequest, context: BackendProxyRouteContext) =>
  proxyBackendRequest(request, await resolvePathSegments(context));
export const OPTIONS = async (request: NextRequest, context: BackendProxyRouteContext) =>
  proxyBackendRequest(request, await resolvePathSegments(context));
