import type { NextRequest } from 'next/server';

import { handleLibraryReaderObjectRoute } from '../../../../../../src/server/library/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = (request: NextRequest) => handleLibraryReaderObjectRoute(request);
