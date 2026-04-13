import type { NextRequest } from 'next/server';

import { handlePublishingImportExtractRoute } from '@/server/publishing/importService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (request: NextRequest) => handlePublishingImportExtractRoute(request);
