import type { NextRequest } from 'next/server';

import { handleAuthedAccountBillingRoute } from '../../../../_accountBillingRouteHandler';
import { listSupportConversations } from '@/server/account/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['support', 'conversations', 'me'],
  async (user) => {
    const limit = Number(request.nextUrl.searchParams.get('limit') || '100');
    const items = await listSupportConversations(user, limit);
    return Response.json({ ok: true, items, count: items.length });
  }
);
