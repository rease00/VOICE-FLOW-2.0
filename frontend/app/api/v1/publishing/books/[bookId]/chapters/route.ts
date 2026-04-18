import type { NextRequest } from 'next/server';

import { handlePublishingBookChaptersRoute } from '../../../../../../../src/server/publishing/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (
  request: NextRequest,
  context: RouteContext<'/api/v1/publishing/books/[bookId]/chapters'>
) => {
  const { bookId } = await context.params;
  return handlePublishingBookChaptersRoute(request, bookId);
};

export const POST = async (
  request: NextRequest,
  context: RouteContext<'/api/v1/publishing/books/[bookId]/chapters'>
) => {
  const { bookId } = await context.params;
  return handlePublishingBookChaptersRoute(request, bookId);
};
