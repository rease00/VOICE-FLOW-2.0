import type { NextRequest } from 'next/server';

import { handleAuthedAccountBillingRoute } from '../../_accountBillingRouteHandler';
import { createPlanCheckoutSession } from '../../../../../src/server/billing/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['billing', 'checkout-session'],
  async (user) => {
    const body = await request.json().catch(() => ({}));
    const launch = await createPlanCheckoutSession(user, body || {}, request.headers.get('idempotency-key') || undefined);
    return Response.json(launch);
  }
);
