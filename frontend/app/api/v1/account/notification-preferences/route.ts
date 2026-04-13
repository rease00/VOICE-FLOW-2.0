import type { NextRequest } from 'next/server';

import { handleAuthedAccountBillingRoute } from '../../_accountBillingRouteHandler';
import { getNotificationPreferences, patchNotificationPreferences } from '../../../../../src/server/account/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['account', 'notification-preferences'],
  async (user) => {
    const preferences = await getNotificationPreferences(user);
    return Response.json({ ok: true, preferences });
  }
);

export const PATCH = async (request: NextRequest) => handleAuthedAccountBillingRoute(
  request,
  ['account', 'notification-preferences'],
  async (user) => {
    const body = await request.json().catch(() => ({}));
    const preferences = await patchNotificationPreferences(user, body || {});
    return Response.json({ ok: true, preferences });
  }
);
