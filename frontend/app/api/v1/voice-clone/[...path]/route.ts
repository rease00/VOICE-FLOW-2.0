import type { NextRequest } from 'next/server';

import { handleVoiceCloneRoute } from '../../../../../src/server/voiceClone/service';

const readPathSegments = async (
  context: RouteContext<'/api/v1/voice-clone/[...path]'>
): Promise<string[]> => {
  const params = await context.params;
  return params.path;
};

const handle = async (
  request: NextRequest,
  context: RouteContext<'/api/v1/voice-clone/[...path]'>
) => {
  return handleVoiceCloneRoute(request, await readPathSegments(context));
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
