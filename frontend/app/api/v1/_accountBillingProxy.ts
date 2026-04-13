import type { NextRequest } from 'next/server';

import { proxyBackendRequest } from '../backend/proxy';
import { isAccountBillingProxyMode } from '../../../src/server/replatform/accountBillingMode';

export const proxyWhenAccountBillingMode = async (
  request: NextRequest,
  pathSegments: string[]
): Promise<Response | null> => {
  if (!isAccountBillingProxyMode()) {
    return null;
  }
  return proxyBackendRequest(request, pathSegments);
};
