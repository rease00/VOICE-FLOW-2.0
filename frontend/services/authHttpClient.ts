import { firebaseAuth } from './firebaseClient';
import { resolveAuthHeaders } from '../src/shared/auth/tokenPolicy';
import { readEnvBoolean } from '../src/shared/runtime/env';
import { fetchWithRequestDedup } from '../src/shared/api/requestDeduper';

export interface AuthFetchOptions {
  requireAuth?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface TokenResolution {
  token: string;
  hadCurrentUser: boolean;
  error: Error | null;
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

const DEV_UID_HEADER_ENABLED = Boolean(readEnvBoolean(
  process.env.NEXT_PUBLIC_ENABLE_DEV_UID_HEADER,
  process.env.VITE_ENABLE_DEV_UID_HEADER
));
const TOKEN_TIMING_HINTS = [
  'token used too early',
  'token is not yet valid',
  "check that your computer's clock is set correctly",
];
const TOKEN_TIMING_RETRY_DELAYS_MS = [1500, 3000, 6000, 12000];

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
    const pathname = String(target.pathname || '').replace(/\/+$/, '');
    return `${target.origin}${pathname}${target.search || ''}` || safeRaw;
  } catch {
    if (safeRaw.startsWith('/')) return safeRaw;
    return safeRaw;
  }
};

const isLocalRequestHostname = (hostname: string): boolean => {
  const safeHostname = String(hostname || '').trim().toLowerCase();
  return safeHostname === 'localhost' || safeHostname === '127.0.0.1' || safeHostname === '::1';
};

const isTrustedAuthTarget = (input: RequestInfo | URL): boolean => {
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
  if (!safeRaw) return true;
  if (safeRaw.startsWith('/') && !safeRaw.startsWith('//')) return true;

  try {
    const browserOrigin = typeof window !== 'undefined' && window.location ? window.location.origin : undefined;
    const parsed = new URL(safeRaw, browserOrigin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (!browserOrigin) {
      return isLocalRequestHostname(parsed.hostname);
    }
    if (parsed.origin === browserOrigin) {
      return true;
    }
    const browserHostname = String(window.location.hostname || '').trim().toLowerCase();
    const localBrowser = isLocalRequestHostname(browserHostname);
    return localBrowser && isLocalRequestHostname(parsed.hostname);
  } catch {
    return false;
  }
};

const formatRequestTimeoutMessage = (input: RequestInfo | URL, timeoutMs: number): string => {
  const target = resolveRequestTarget(input);
  const timeoutSeconds = Math.max(1, Math.round(timeoutMs / 1000));
  return `Request to ${target} timed out after ${timeoutSeconds}s. Verify backend availability and retry.`;
};

export const getCurrentIdToken = async (): Promise<string> => {
  const result = await getCurrentIdTokenWithRefresh(false);
  return result.token;
};

const mapTokenReadFailure = (error: Error): string => {
  const detail = String(error.message || error || '').trim();
  if (isTokenTimingAuthDetail(detail)) {
    return 'System clock is out of sync. Sync your device clock and sign in again.';
  }
  if (isLikelyNetworkFetchFailure(detail)) {
    return 'Cannot reach authentication service right now. Check internet connection, then retry.';
  }
  return 'Authentication session could not be refreshed. Sign in again.';
};

const getCurrentIdTokenWithRefresh = async (
  forceRefresh: boolean,
  signal?: AbortSignal
): Promise<TokenResolution> => {
  const user = firebaseAuth.currentUser;
  if (!user) {
    return { token: '', hadCurrentUser: false, error: null };
  }
  let shouldForceRefresh = forceRefresh;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= TOKEN_TIMING_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return {
        token: await user.getIdToken(shouldForceRefresh || attempt > 0),
        hadCurrentUser: true,
        error: null,
      };
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error || 'Authentication token refresh failed.'));
      if (!isTokenTimingAuthDetail(lastError.message) || attempt >= TOKEN_TIMING_RETRY_DELAYS_MS.length) {
        break;
      }
      const retryDelayMs = TOKEN_TIMING_RETRY_DELAYS_MS[attempt];
      if (typeof retryDelayMs !== 'number') {
        break;
      }
      await sleep(retryDelayMs, signal);
      shouldForceRefresh = true;
    }
  }
  return {
    token: '',
    hadCurrentUser: true,
    error: lastError || new Error('Authentication token refresh failed.'),
  };
};

const createAbortError = (): Error => {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
};

const sleep = async (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  const timeoutId = setTimeout(() => {
    cleanup();
    resolve();
  }, Math.max(0, ms));

  const onAbort = () => {
    cleanup();
    reject(createAbortError());
  };

  const cleanup = () => {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onAbort);
  };

  if (signal?.aborted) {
    cleanup();
    reject(createAbortError());
    return;
  }

  signal?.addEventListener('abort', onAbort, { once: true });
});

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
  const trustedAuthTarget = isTrustedAuthTarget(input);
  const resolveRequestHeaders = async (forceTokenRefresh: boolean) => {
    if (!trustedAuthTarget) {
      if (options.requireAuth) {
        throw new Error('Authentication headers are blocked for untrusted backend origins. Use the default backend proxy or a localhost backend.');
      }
      return {
        headers: new Headers(init.headers || {}),
        hasFirebaseToken: false,
      };
    }
    const currentUser = firebaseAuth.currentUser;
    const firebaseUid = String(currentUser?.uid || '').trim();
    const requestSignal = options.signal ?? (init.signal === null ? undefined : init.signal);
    const tokenResult = await getCurrentIdTokenWithRefresh(forceTokenRefresh, requestSignal);
    const token = tokenResult.token;
    const { headers, hasAuth } = resolveAuthHeaders(init.headers, {
      idToken: token,
    });

    // In local/dev backend mode (VF_AUTH_ENFORCE=0), backend UID comes from x-dev-uid.
    // Keep this header aligned with Firebase UID so per-user admin mapping works consistently.
    if (DEV_UID_HEADER_ENABLED && firebaseUid && !headers.has('x-dev-uid')) {
      headers.set('x-dev-uid', firebaseUid);
    }

    if (!hasAuth && options.requireAuth) {
      if (tokenResult.hadCurrentUser && tokenResult.error) {
        throw new Error(mapTokenReadFailure(tokenResult.error));
      }
      throw new Error('Authentication required.');
    }

    return {
      headers,
      hasFirebaseToken: Boolean(token),
    };
  };

  const runAttempt = async (forceTokenRefresh: boolean): Promise<{ response: Response; hasFirebaseToken: boolean }> => {
    const attempt = await resolveRequestHeaders(forceTokenRefresh);
    const timeoutMs = Number(options.timeoutMs || 0);
    const shouldApplyTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
    const callerSignals = [init.signal, options.signal].filter(Boolean) as AbortSignal[];
    const controller = shouldApplyTimeout || callerSignals.length > 0 ? new AbortController() : null;
    let timeoutTriggered = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const forwardAbort = () => controller?.abort();

    if (controller) {
      for (const signal of callerSignals) {
        if (signal.aborted) {
          controller.abort();
        } else {
          signal.addEventListener('abort', forwardAbort, { once: true });
        }
      }
    }

    if (controller && shouldApplyTimeout) {
      timeoutId = setTimeout(() => {
        timeoutTriggered = true;
        controller.abort();
      }, timeoutMs);
    }

    try {
      const fetchInit: RequestInit = {
        ...init,
        headers: attempt.headers,
      };
      if (controller?.signal) {
        fetchInit.signal = controller.signal;
      }
      const response = await fetchWithRequestDedup(input, fetchInit);
      return {
        response,
        hasFirebaseToken: attempt.hasFirebaseToken,
      };
    } catch (error: unknown) {
      if (timeoutTriggered && controller && !callerSignals.some((signal) => signal.aborted)) {
        throw new Error(formatRequestTimeoutMessage(input, timeoutMs));
      }
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (controller) {
        for (const signal of callerSignals) {
          signal.removeEventListener('abort', forwardAbort);
        }
      }
    }
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
      const retrySignal = options.signal || init.signal;
      await sleep(retryDelayMs, retrySignal ?? undefined);
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
