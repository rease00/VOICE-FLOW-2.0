import type { NextRequest } from 'next/server';

import { handleAuthedAccountBillingRoute } from '../../_accountBillingRouteHandler';
import { clearGenerationHistory, getGenerationHistory } from '../../../../../src/server/account/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['account', 'generation-history'],
  async (user) => {
    const limit = Number(request.nextUrl.searchParams.get('limit') || '30');
    const items = await getGenerationHistory(user, limit);
    return Response.json({
      ok: true,
      limit: Math.max(1, Math.min(200, Number.isFinite(limit) ? limit : 30)),
      count: items.length,
      codec: 'json',
      items,
    });
  }
);

export const DELETE = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['account', 'generation-history'],
  async (user) => {
    await clearGenerationHistory(user);
    return Response.json({ ok: true });
  }
);
