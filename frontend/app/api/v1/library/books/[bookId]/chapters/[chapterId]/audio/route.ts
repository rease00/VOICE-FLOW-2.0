import type { NextRequest } from 'next/server';

import { handleLibraryBookChapterAudioGetRoute } from '@/server/library/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (
  request: NextRequest,
  context: RouteContext<'/api/v1/library/books/[bookId]/chapters/[chapterId]/audio'>
) => {
  const { bookId, chapterId } = await context.params;
  return handleLibraryBookChapterAudioGetRoute(request, bookId, chapterId);
};
