import type { NextRequest } from 'next/server';

import { handleAuthedAccountBillingRoute } from '../../../../_accountBillingRouteHandler';
import { dismissNotification } from '../../../../../../../src/server/account/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (
  request: NextRequest,
  context: RouteContext<'/api/v1/account/notifications/[notificationId]/dismiss'>
) => handleAuthedAccountBillingRoute(
  request,
  ['account', 'notifications', (await context.params).notificationId, 'dismiss'],
  async (user) => {
    const { notificationId } = await context.params;
    const item = await dismissNotification(user, notificationId);
    if (!item) {
      return Response.json({ detail: 'Notification not found.' }, { status: 404 });
    }
    return Response.json({ ok: true, item });
  }
);
