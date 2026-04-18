import type { NextRequest } from 'next/server';

import { handleAiScriptRoute } from '../../../src/server/ai/scriptService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (request: NextRequest) => handleAiScriptRoute(request);
