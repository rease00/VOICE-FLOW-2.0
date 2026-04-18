import type { NextRequest } from 'next/server';

import { handleLibraryBookChaptersRoute } from '../../../../../../../src/server/library/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (
  request: NextRequest,
  context: RouteContext<'/api/v1/library/books/[bookId]/chapters'>
) => {
  const { bookId } = await context.params;
  return handleLibraryBookChaptersRoute(request, bookId);
};
