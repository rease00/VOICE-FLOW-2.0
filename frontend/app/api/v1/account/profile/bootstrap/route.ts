import type { NextRequest } from 'next/server';

import { handleAuthedAccountBillingRoute } from '../../../_accountBillingRouteHandler';
import { bootstrapAccountProfile } from '../../../../../../src/server/account/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['account', 'profile', 'bootstrap'],
  async (user) => {
    const profile = await bootstrapAccountProfile(user);
    return Response.json({ ok: true, profile });
  }
);
