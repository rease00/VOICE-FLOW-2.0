import { NextRequest } from 'next/server';

import { handleStudioLongTextRoute } from '../../../../../../src/server/studio/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (request: NextRequest) => handleStudioLongTextRoute(request);
