import type { NextRequest } from 'next/server';

import { handleAuthedAccountBillingRoute } from '../../_accountBillingRouteHandler';
import { getAccountProfile, upsertAccountProfile } from '../../../../../src/server/account/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['account', 'profile'],
  async (user) => {
    const payload = await getAccountProfile(user);
    return Response.json({ ok: true, ...payload });
  }
);

export const POST = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['account', 'profile'],
  async (user) => {
    const body = await request.json().catch(() => ({}));
    const profile = await upsertAccountProfile(user, body || {});
    return Response.json({ ok: true, profile });
  }
);
