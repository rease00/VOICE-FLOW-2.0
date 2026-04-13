import type { NextRequest } from 'next/server';

import { handleAuthedAccountBillingRoute } from '../../_accountBillingRouteHandler';
import { getAccountEntitlements } from '../../../../../src/server/account/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['account', 'entitlements'],
  async (user) => {
    const entitlements = await getAccountEntitlements(user);
    return Response.json({ ok: true, entitlements });
  }
);
