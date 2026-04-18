import type { NextRequest } from 'next/server';

import { handleAdminRoute } from '../../../../../src/server/admin/service';

const withAdminPrefix = async (
  context: RouteContext<'/api/v1/admin/[...path]'>
): Promise<string[]> => {
  const params = await context.params;
  return ['admin', ...params.path];
};

const handle = async (request: NextRequest, context: RouteContext<'/api/v1/admin/[...path]'>) => (
  handleAdminRoute(request, (await withAdminPrefix(context)).slice(1))
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
