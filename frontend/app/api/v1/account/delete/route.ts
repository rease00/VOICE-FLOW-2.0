import type { NextRequest } from 'next/server';

import { handleAuthedAccountBillingRoute } from '../../_accountBillingRouteHandler';
import { deleteUserAccount } from '../../../../../src/server/account/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['account', 'delete'],
  async (user) => {
    const body = await request.json().catch(() => ({}));
    const result = await deleteUserAccount(user, String(body?.confirmPhrase || ''));
    return Response.json({ ok: true, ...result });
  }
);
