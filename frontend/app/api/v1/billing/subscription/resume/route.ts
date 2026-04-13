import type { NextRequest } from 'next/server';

import { handleAuthedAccountBillingRoute } from '../../../_accountBillingRouteHandler';
import { resumeSubscription } from '../../../../../../src/server/billing/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['billing', 'subscription', 'resume'],
  async (user) => Response.json(await resumeSubscription(user))
);
