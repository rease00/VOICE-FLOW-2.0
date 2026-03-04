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

const truthyEnv = (value: unknown): boolean => {
  const token = String(value || '').trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
};

const DEV_UID_HEADER_ENABLED = truthyEnv(import.meta.env.VITE_ENABLE_DEV_UID_HEADER);
const TOKEN_TIMING_HINTS = [
  'token used too early',
  'token is not yet valid',
  "check that your computer's clock is set correctly",
];
const TOKEN_TIMING_RETRY_DELAYS_MS = [1200, 2000];

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

const getCurrentIdTokenWithRefresh = async (forceRefresh: boolean): Promise<string> => {
  const user = firebaseAuth.currentUser;
  if (!user) return '';
  try {
    return await user.getIdToken(forceRefresh);
  } catch {
    return '';
  }
};

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

const readResponseDetail = async (response: Response): Promise<string> => {
  try {
    const cloned = response.clone();
    const payload = await cloned.json().catch(async () => {
      const text = await cloned.text().catch(() => '');
      return { detail: text };
    });
    const detail = String((payload as any)?.detail || (payload as any)?.error || '').trim();
    return detail;
  } catch {
    return '';
  }
};

const isTokenTimingAuthDetail = (detail: string): boolean => {
  const lowered = String(detail || '').trim().toLowerCase();
  if (!lowered) return false;
  return TOKEN_TIMING_HINTS.some((hint) => lowered.includes(hint));
};

export const authFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: AuthFetchOptions = {}
): Promise<Response> => {
  const resolveRequestHeaders = async (forceTokenRefresh: boolean) => {
    const currentUser = firebaseAuth.currentUser;
    const firebaseUid = String(currentUser?.uid || '').trim();
    const token = await getCurrentIdTokenWithRefresh(forceTokenRefresh);
    const localAdminSession = token ? null : await readLocalAdminSession();
    const localAdminUid = localAdminSession ? String(localAdminSession.uid || getLocalAdminUid()).trim() : '';
    const { headers, hasAuth } = resolveAuthHeaders(init.headers, {
      idToken: token,
      localAdminUid,
    });

    // In local/dev backend mode (VF_AUTH_ENFORCE=0), backend UID comes from x-dev-uid.
    // Keep this header aligned with Firebase UID so per-user admin mapping works consistently.
    if (DEV_UID_HEADER_ENABLED && firebaseUid && !headers.has('x-dev-uid')) {
      headers.set('x-dev-uid', firebaseUid);
    }

    if (!hasAuth && options.requireAuth) {
      throw new Error('Authentication required.');
    }

    return {
      headers,
      hasFirebaseToken: Boolean(token),
    };
  };

  const runAttempt = async (forceTokenRefresh: boolean): Promise<{ response: Response; hasFirebaseToken: boolean }> => {
    const attempt = await resolveRequestHeaders(forceTokenRefresh);
    const response = await fetch(input, {
      ...init,
      headers: attempt.headers,
    });
    return {
      response,
      hasFirebaseToken: attempt.hasFirebaseToken,
    };
  };

  try {
    let { response, hasFirebaseToken } = await runAttempt(false);
    if (!hasFirebaseToken || (response.status !== 401 && response.status !== 403)) {
      return response;
    }

    let detail = await readResponseDetail(response);
    if (!isTokenTimingAuthDetail(detail)) {
      return response;
    }

    for (const retryDelayMs of TOKEN_TIMING_RETRY_DELAYS_MS) {
      await sleep(retryDelayMs);
      const retry = await runAttempt(true);
      response = retry.response;
      hasFirebaseToken = retry.hasFirebaseToken;
      if (!hasFirebaseToken || (response.status !== 401 && response.status !== 403)) {
        return response;
      }
      detail = await readResponseDetail(response);
      if (!isTokenTimingAuthDetail(detail)) {
        return response;
      }
    }

    return response;
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
