import type { NextRequest } from 'next/server';

import { proxyBackendRequest } from '../../../backend/proxy';

const withLibraryPrefix = async (
  context: RouteContext<'/api/v1/library/[...path]'>
): Promise<string[]> => {
  const params = await context.params;
  return ['reader', ...params.path];
};

const handle = async (request: NextRequest, context: RouteContext<'/api/v1/library/[...path]'>) => {
  return proxyBackendRequest(request, await withLibraryPrefix(context));
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
