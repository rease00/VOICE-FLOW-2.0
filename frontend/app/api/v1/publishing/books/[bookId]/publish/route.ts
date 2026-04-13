import type { NextRequest } from 'next/server';

import { handlePublishingBookPublishRoute } from '../../../../../../../src/server/publishing/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (
  request: NextRequest,
  context: RouteContext<'/api/v1/publishing/books/[bookId]/publish'>
) => {
  const { bookId } = await context.params;
  return handlePublishingBookPublishRoute(request, bookId);
};

export const PATCH = async (
  request: NextRequest,
  context: RouteContext<'/api/v1/publishing/books/[bookId]/publish'>
) => {
  const { bookId } = await context.params;
  return handlePublishingBookPublishRoute(request, bookId);
};
