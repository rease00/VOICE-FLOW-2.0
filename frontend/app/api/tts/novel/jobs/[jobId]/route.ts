export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import type { NextRequest } from 'next/server';

import { handleAudioNovelJobStatusRoute } from '@/server/audioNovel/service';

export const GET = async (
  request: NextRequest,
  context: RouteContext<'/api/tts/novel/jobs/[jobId]'>
) => {
  const { jobId } = await context.params;
  return handleAudioNovelJobStatusRoute(request, jobId);
};
