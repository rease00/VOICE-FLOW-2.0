import type { NextRequest } from 'next/server';

import { handleAuthedAccountBillingRoute } from '../../../../../_accountBillingRouteHandler';
import { markConversationStillUnresolved } from '@/server/account/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (
  request: NextRequest,
  context: RouteContext<'/api/v1/account/support/conversations/[conversationId]/still-unresolved'>
) => handleAuthedAccountBillingRoute(
  request,
  ['support', 'conversations', (await context.params).conversationId, 'still-unresolved'],
  async (user) => {
    const { conversationId } = await context.params;
    const conversation = await markConversationStillUnresolved(user, conversationId);
    if (!conversation) {
      return Response.json({ detail: 'Support conversation not found.' }, { status: 404 });
    }
    return Response.json({ ok: true, conversation });
  }
);
