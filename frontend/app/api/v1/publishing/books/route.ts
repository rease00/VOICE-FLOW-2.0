import type { NextRequest } from 'next/server';

import { handlePublishingBooksRoute } from '../../../../../src/server/publishing/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = (request: NextRequest) => handlePublishingBooksRoute(request);
export const POST = (request: NextRequest) => handlePublishingBooksRoute(request);
export const PATCH = (request: NextRequest) => handlePublishingBooksRoute(request);
