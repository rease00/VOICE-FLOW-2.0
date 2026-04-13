import type { NextRequest } from 'next/server';

import { proxyStudioCompatibilityRequest } from '../../../../../src/server/studio/proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handleCompatibilityRoute = async (
  request: NextRequest,
  context: RouteContext<'/api/v1/studio/[...path]'>,
) => {
  const { path } = await context.params;
  return proxyStudioCompatibilityRequest(request, path);
};

export const GET = handleCompatibilityRoute;
export const POST = handleCompatibilityRoute;
export const PATCH = handleCompatibilityRoute;
export const PUT = handleCompatibilityRoute;
export const DELETE = handleCompatibilityRoute;
