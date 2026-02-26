import { firebaseAuth } from './firebaseClient';
import { getLocalAdminUid, readLocalAdminSession } from './localAdminAuth';

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
  const headers = new Headers(init.headers || {});
  const token = await getCurrentIdToken();
  let hasAuth = false;
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
    hasAuth = true;
  } else {
    const localAdminSession = await readLocalAdminSession();
    if (localAdminSession) {
      const uid = String(localAdminSession.uid || getLocalAdminUid()).trim();
      if (uid) {
        headers.set('x-dev-uid', uid);
        hasAuth = true;
      }
    }
  }

  if (!hasAuth && options.requireAuth) {
    throw new Error('Authentication required.');
  }

  return fetch(input, {
    ...init,
    headers,
  });
};
