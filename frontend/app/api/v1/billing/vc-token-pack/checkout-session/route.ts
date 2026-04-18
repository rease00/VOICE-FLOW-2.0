import type { NextRequest } from 'next/server';

import { handleAuthedAccountBillingRoute } from '../../../_accountBillingRouteHandler';
import { createVcTokenPackCheckoutSession } from '../../../../../../src/server/billing/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['billing', 'vc-token-pack', 'checkout-session'],
  async (user) => {
    const body = await request.json().catch(() => ({}));
    const launch = await createVcTokenPackCheckoutSession(user, body || {}, request.headers.get('idempotency-key') || undefined);
    return Response.json(launch);
  }
);
