import type { NextRequest } from 'next/server';

import { handleAuthedAccountBillingRoute } from '../../../../_accountBillingRouteHandler';
import { convertWalletVfToVc } from '../../../../../../../src/server/billing/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['wallet', 'vc', 'convert'],
  async (user) => {
    const body = await request.json().catch(() => ({}));
    return Response.json(await convertWalletVfToVc(user, {
      ...(body || {}),
      idempotencyKey: request.headers.get('idempotency-key') || body?.idempotencyKey || body?.requestId,
    }));
  }
);
