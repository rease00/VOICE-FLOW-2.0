import type { NextRequest } from 'next/server';

import type { ServerAuthedUserContext } from '../../../src/server/auth/requestAuth';
import { requireServerUser } from '../../../src/server/auth/requestAuth';
import { proxyWhenAccountBillingMode } from './_accountBillingProxy';

const toErrorStatus = (error: unknown): number => {
  const directStatus = Number((error as { status?: unknown })?.status);
  if (Number.isFinite(directStatus) && directStatus >= 100) {
    return directStatus;
  }
  const message = String((error as { message?: unknown })?.message || error || '').trim().toLowerCase();
  if (!message) return 500;
  if (message.includes('missing authorization') || message.includes('authentication required')) return 401;
  if (message.includes('do not use userid')) return 403;
  if (message.includes('insufficient') || message.includes('daily ad reward limit')) return 429;
  if (message.includes('already taken') || message.includes('already redeemed')) return 409;
  if (message.includes('not found')) return 404;
  if (
    message.includes('required')
    || message.includes('confirmphrase')
    || message.includes('must use 4-24')
    || message.includes('cannot be changed')
  ) {
    return 400;
  }
  if (message.includes('config required') || message.includes('temporarily unavailable')) {
    return 503;
  }
  return 500;
};

export const toRouteErrorResponse = (error: unknown): Response => {
  const detail = String((error as { message?: unknown })?.message || error || 'Request failed.').trim() || 'Request failed.';
  return Response.json({ detail }, { status: toErrorStatus(error) });
};

export const handleAuthedAccountBillingRoute = async (
  request: NextRequest,
  pathSegments: string[],
  handler: (user: ServerAuthedUserContext) => Promise<Response>
): Promise<Response> => {
  const proxied = await proxyWhenAccountBillingMode(request, pathSegments);
  if (proxied) return proxied;
  try {
    const user = await requireServerUser(request);
    return await handler(user);
  } catch (error) {
    return toRouteErrorResponse(error);
  }
};

export const handlePublicAccountBillingRoute = async (
  request: NextRequest,
  pathSegments: string[],
  handler: () => Promise<Response>
): Promise<Response> => {
  const proxied = await proxyWhenAccountBillingMode(request, pathSegments);
  if (proxied) return proxied;
  try {
    return await handler();
  } catch (error) {
    return toRouteErrorResponse(error);
  }
};
