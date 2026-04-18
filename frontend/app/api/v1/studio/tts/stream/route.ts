import { NextRequest } from 'next/server';

import { handleStudioStreamRoute } from '../../../../../../src/server/studio/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (request: NextRequest) => handleStudioStreamRoute(request);
