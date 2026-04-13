import type { NextRequest } from 'next/server';

import { handleAuthedAccountBillingRoute } from '../../../_accountBillingRouteHandler';
import { dismissAllNotifications } from '../../../../../../src/server/account/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['account', 'notifications', 'dismiss-all'],
  async (user) => {
    const count = await dismissAllNotifications(user);
    return Response.json({ ok: true, count });
  }
);
