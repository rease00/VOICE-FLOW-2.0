import type { NextRequest } from 'next/server';

import { handleAuthedAccountBillingRoute } from '../../../_accountBillingRouteHandler';
import { redeemCoupon } from '../../../../../../src/server/billing/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['wallet', 'coupons', 'redeem'],
  async (user) => {
    const body = await request.json().catch(() => ({}));
    return Response.json(await redeemCoupon(user, body || {}));
  }
);
