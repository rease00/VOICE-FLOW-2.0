import type { NextRequest } from 'next/server';

import { handleAuthedAccountBillingRoute } from '../../_accountBillingRouteHandler';
import { createPortalSession } from '../../../../../src/server/billing/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['billing', 'portal-session'],
  async (user) => {
    const body = await request.json().catch(() => ({}));
    const session = await createPortalSession(user, body || {});
    return Response.json(session);
  }
);
