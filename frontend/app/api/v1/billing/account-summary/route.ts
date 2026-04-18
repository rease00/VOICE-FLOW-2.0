import type { NextRequest } from 'next/server';

import { handleAuthedAccountBillingRoute } from '../../_accountBillingRouteHandler';
import { getBillingAccountSummary } from '../../../../../src/server/billing/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['billing', 'account-summary'],
  async (user) => {
    const summary = await getBillingAccountSummary(user);
    return Response.json({ summary });
  }
);
