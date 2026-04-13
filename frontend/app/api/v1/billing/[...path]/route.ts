import type { NextRequest } from 'next/server';

import { proxyBackendRequest } from '../../../backend/proxy';

const withBillingPrefix = async (
  context: RouteContext<'/api/v1/billing/[...path]'>
): Promise<string[]> => {
  const params = await context.params;
  return ['billing', ...params.path];
};

const handle = async (request: NextRequest, context: RouteContext<'/api/v1/billing/[...path]'>) => {
  return proxyBackendRequest(request, await withBillingPrefix(context));
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
