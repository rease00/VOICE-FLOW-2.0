import type { NextRequest } from 'next/server';

import { handlePublicAccountBillingRoute } from '../../_accountBillingRouteHandler';
import { handleStripeWebhook } from '../../../../../src/server/billing/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (request: NextRequest) => handlePublicAccountBillingRoute(
  request,
  ['billing', 'webhook'],
  async () => {
    const rawBody = await request.text();
    const result = await handleStripeWebhook(rawBody, request.headers.get('stripe-signature') || '');
    return Response.json(result);
  }
);
