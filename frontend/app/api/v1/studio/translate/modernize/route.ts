import { NextRequest } from 'next/server';

import { handleModernizeRoute } from '../../../../../../src/server/studio/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (request: NextRequest) => handleModernizeRoute(request);
