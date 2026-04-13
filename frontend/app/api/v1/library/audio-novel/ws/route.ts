import type { NextRequest } from 'next/server';

import { handleAudioNovelWebSocketHttpRequest } from '@/server/audioNovel/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = (_request: NextRequest) => handleAudioNovelWebSocketHttpRequest();
