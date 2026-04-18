import type { NextRequest } from 'next/server';

import { handleAuthedAccountBillingRoute } from '../../_accountBillingRouteHandler';
import { clearGenerationHistory, getGenerationHistory, addGenerationHistory } from '../../../../../src/server/account/service';

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

export const POST = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['account', 'generation-history'],
  async (user) => {
    try {
      const body = await request.json().catch(() => ({}));
      if (!body.item) {
        return Response.json({ ok: false, error: 'Missing item' }, { status: 400 });
      }
      
      // If we wanted to upload base64 here to R2 we could, but for tracking text and generated records this is fine.
      await addGenerationHistory(user, body.item);
      return Response.json({ ok: true });
    } catch (e) {
      return Response.json({ ok: false, error: 'Failed to process' }, { status: 500 });
    }
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
