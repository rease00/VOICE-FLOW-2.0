import type { NextRequest } from 'next/server';

import { handlePublishingChapterAudioRoute } from '../../../../../../../../../src/server/publishing/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (
  request: NextRequest,
  context: RouteContext<'/api/v1/publishing/books/[bookId]/chapters/[chapterId]/audio'>
) => {
  const { bookId, chapterId } = await context.params;
  return handlePublishingChapterAudioRoute(request, bookId, chapterId);
};
