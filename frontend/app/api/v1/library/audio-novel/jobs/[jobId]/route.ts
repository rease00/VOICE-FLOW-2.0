import type { NextRequest } from 'next/server';

import { handleAudioNovelJobStatusRoute } from '../../../../../../../src/server/audioNovel/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (
  _request: NextRequest,
  context: RouteContext<'/api/v1/library/audio-novel/jobs/[jobId]'>
) => {
  const { jobId } = await context.params;
  return handleAudioNovelJobStatusRoute(jobId);
};
