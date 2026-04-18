import type { NextRequest } from 'next/server';

import { proxyBackendRequest } from '../../../backend/proxy';

const withTtsPrefix = async (
  context: RouteContext<'/api/v1/tts/[...path]'>
): Promise<string[]> => {
  const params = await context.params;
  return ['tts', ...params.path];
};

const handle = async (request: NextRequest, context: RouteContext<'/api/v1/tts/[...path]'>) => {
  return proxyBackendRequest(request, await withTtsPrefix(context));
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
