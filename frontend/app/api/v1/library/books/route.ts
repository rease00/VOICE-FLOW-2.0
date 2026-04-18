import type { NextRequest } from 'next/server';

import { handleLibraryBooksRoute } from '../../../../../src/server/library/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = (request: NextRequest) => handleLibraryBooksRoute(request);
