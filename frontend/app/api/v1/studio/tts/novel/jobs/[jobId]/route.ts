import { NextRequest } from 'next/server';

import { handleAudioNovelJobStatusRoute } from '../../../../../../../../src/server/audioNovel/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (
  request: NextRequest,
  context: RouteContext<'/api/v1/studio/tts/novel/jobs/[jobId]'>,
) => {
  const { jobId } = await context.params;
  return handleAudioNovelJobStatusRoute(request, jobId);
};
