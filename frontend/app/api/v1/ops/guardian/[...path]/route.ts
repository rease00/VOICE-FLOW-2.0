import type { NextRequest } from 'next/server';

import { handleOpsRoute } from '../../../../../../src/server/ops/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handle = async (
  request: NextRequest,
  context: RouteContext<'/api/v1/ops/guardian/[...path]'>
) => {
  const params = await context.params;
  return handleOpsRoute(request, ['guardian', ...params.path]);
};

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
