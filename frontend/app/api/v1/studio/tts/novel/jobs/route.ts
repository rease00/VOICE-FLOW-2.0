import { NextRequest } from 'next/server';

import { handleAudioNovelJobCreateRoute } from '../../../../../../../src/server/audioNovel/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (request: NextRequest) => handleAudioNovelJobCreateRoute(request);
