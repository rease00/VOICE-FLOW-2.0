export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import type { NextRequest } from 'next/server';

import { handleAudioNovelJobStatusRoute } from '@/server/audioNovel/service';

export const GET = async (
  _request: NextRequest,
  context: RouteContext<'/api/v1/tts/novel/jobs/[jobId]'>
) => {
  const { jobId } = await context.params;
  return handleAudioNovelJobStatusRoute(jobId);
};
