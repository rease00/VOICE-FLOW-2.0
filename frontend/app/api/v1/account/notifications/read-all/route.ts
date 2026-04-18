import type { NextRequest } from 'next/server';

import { handleAuthedAccountBillingRoute } from '../../../_accountBillingRouteHandler';
import { markAllNotificationsRead } from '../../../../../../src/server/account/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['account', 'notifications', 'read-all'],
  async (user) => {
    const count = await markAllNotificationsRead(user);
    return Response.json({ ok: true, count });
  }
);
