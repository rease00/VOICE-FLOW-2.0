import type { NextRequest } from 'next/server';

import { handleAuthedAccountBillingRoute } from '../../../_accountBillingRouteHandler';
import { createSupportMessage } from '../../../../../../src/server/account/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['support', 'messages'],
  async (user) => {
    const body = await request.json().catch(() => ({}));
    const result = await createSupportMessage(user, body || {});
    return Response.json({ ok: true, ...result });
  }
);
