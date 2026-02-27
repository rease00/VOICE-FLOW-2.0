import { firebaseAuth } from './firebaseClient';
import { getLocalAdminUid, readLocalAdminSession } from './localAdminAuth';
import { resolveAuthHeaders } from '../src/shared/auth/tokenPolicy';

export interface AuthFetchOptions {
  requireAuth?: boolean;
}

export const getCurrentIdToken = async (): Promise<string> => {
  const user = firebaseAuth.currentUser;
  if (!user) return '';
  try {
    return await user.getIdToken();
  } catch {
    return '';
  }
};

export const authFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: AuthFetchOptions = {}
): Promise<Response> => {
  const currentUser = firebaseAuth.currentUser;
  const firebaseUid = String(currentUser?.uid || '').trim();
  const token = await getCurrentIdToken();
  const localAdminSession = token ? null : await readLocalAdminSession();
  const localAdminUid = localAdminSession ? String(localAdminSession.uid || getLocalAdminUid()).trim() : '';
  const { headers, hasAuth } = resolveAuthHeaders(init.headers, {
    idToken: token,
    localAdminUid,
  });

  // In local/dev backend mode (VF_AUTH_ENFORCE=0), backend UID comes from x-dev-uid.
  // Keep this header aligned with Firebase UID so per-user admin mapping works consistently.
  if (firebaseUid && !headers.has('x-dev-uid')) {
    headers.set('x-dev-uid', firebaseUid);
  }

  if (!hasAuth && options.requireAuth) {
    throw new Error('Authentication required.');
  }

  return fetch(input, {
    ...init,
    headers,
  });
};
