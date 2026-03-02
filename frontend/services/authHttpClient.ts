import { firebaseAuth } from './firebaseClient';
import { getLocalAdminUid, readLocalAdminSession } from './localAdminAuth';
import { resolveAuthHeaders } from '../src/shared/auth/tokenPolicy';

export interface AuthFetchOptions {
  requireAuth?: boolean;
}

const NETWORK_FAILURE_HINTS = [
  'failed to fetch',
  'fetch failed',
  'networkerror',
  'network error',
  'load failed',
  'econnrefused',
  'err_connection_refused',
];

const isLikelyNetworkFetchFailure = (error: unknown): boolean => {
  const message = String((error as { message?: string })?.message || error || '').trim().toLowerCase();
  if (!message) return false;
  return NETWORK_FAILURE_HINTS.some((hint) => message.includes(hint));
};

const resolveRequestTarget = (input: RequestInfo | URL): string => {
  let raw = '';
  if (typeof input === 'string') {
    raw = input;
  } else if (input instanceof URL) {
    raw = input.toString();
  } else if (typeof Request !== 'undefined' && input instanceof Request) {
    raw = String(input.url || '');
  } else {
    raw = String((input as { url?: string })?.url || '');
  }

  const safeRaw = raw.trim();
  if (!safeRaw) return 'configured backend';

  try {
    const base = typeof window !== 'undefined' && window.location ? window.location.origin : undefined;
    const target = new URL(safeRaw, base);
    return target.origin || safeRaw;
  } catch {
    return safeRaw;
  }
};

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

  try {
    return await fetch(input, {
      ...init,
      headers,
    });
  } catch (error: unknown) {
    if (isLikelyNetworkFetchFailure(error)) {
      const target = resolveRequestTarget(input);
      throw new Error(
        `Cannot reach backend at ${target}. Verify backend URL in Settings and ensure backend/CORS are available.`
      );
    }
    throw error instanceof Error ? error : new Error(String(error || 'Request failed.'));
  }
};
