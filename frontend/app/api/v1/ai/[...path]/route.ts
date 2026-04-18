import type { NextRequest } from 'next/server';

import { proxyBackendRequest } from '../../../backend/proxy';
import { handleAiGenerateTextRoute } from '../../../../../src/server/ai/service';

const withAiPrefix = async (
  context: RouteContext<'/api/v1/ai/[...path]'>
): Promise<string[]> => {
  const params = await context.params;
  return ['ai', ...params.path];
};

const handle = async (request: NextRequest, context: RouteContext<'/api/v1/ai/[...path]'>) => {
  const pathSegments = await withAiPrefix(context);
  if (pathSegments.length === 2 && pathSegments[0] === 'ai' && pathSegments[1] === 'generate-text') {
    return handleAiGenerateTextRoute(request);
  }
  return proxyBackendRequest(request, pathSegments);
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
