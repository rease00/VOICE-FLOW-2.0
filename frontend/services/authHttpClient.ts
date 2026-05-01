import { readStoredAuthSessionState } from './authSessionService';
import { resolveAuthHeaders } from '../src/shared/auth/tokenPolicy';
import { readEnvBoolean } from '../src/shared/runtime/env';
import { fetchWithRequestDedup } from '../src/shared/api/requestDeduper';

export interface AuthFetchOptions {
  requireAuth?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
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
  process.env.NEXT_PUBLIC_ENABLE_DEV_UID_HEADER
));
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
  return readStoredSessionToken().token;
};

const readStoredSessionToken = (): { token: string; uid: string } => {
  const state = readStoredAuthSessionState();
  return {
    token: String(state?.token || '').trim(),
    uid: String(state?.uid || '').trim(),
  };
};

export const authFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: AuthFetchOptions = {}
): Promise<Response> => {
  const trustedAuthTarget = isTrustedAuthTarget(input);
  const resolveRequestHeaders = async () => {
    if (!trustedAuthTarget) {
      if (options.requireAuth) {
        throw new Error('Authentication headers are blocked for untrusted backend origins. Use the default backend proxy or a localhost backend.');
      }
      return {
        headers: new Headers(init.headers || {}),
      };
    }
    const storedSession = readStoredSessionToken();
    const token = storedSession.token;
    const { headers, hasAuth } = resolveAuthHeaders(init.headers, {
      idToken: token,
    });

    // In local/dev backend mode (VF_AUTH_ENFORCE=0), backend UID comes from x-dev-uid.
    // Keep this header aligned with the session UID so per-user admin mapping works consistently.
    const effectiveDevUid = storedSession.uid;
    if (DEV_UID_HEADER_ENABLED && effectiveDevUid && !headers.has('x-dev-uid')) {
      headers.set('x-dev-uid', effectiveDevUid);
    }

    if (!hasAuth && options.requireAuth) {
      throw new Error('Authentication required.');
    }

    return {
      headers,
    };
  };

  const runAttempt = async (): Promise<Response> => {
    const attempt = await resolveRequestHeaders();
    const timeoutMs = Number(options.timeoutMs || 0);
    const shouldApplyTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
    const callerSignals = [init.signal, options.signal].filter(Boolean) as AbortSignal[];
    const controller = shouldApplyTimeout || callerSignals.length > 0 ? new AbortController() : null;
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
        controller.abort();
      }, timeoutMs);
    }

    try {
      const fetchInit: RequestInit = {
        ...init,
        headers: attempt.headers,
        credentials: init.credentials || 'same-origin',
      };
      if (controller?.signal) {
        fetchInit.signal = controller.signal;
      }
      return await fetchWithRequestDedup(input, fetchInit);
    } catch (error: unknown) {
      if (controller && shouldApplyTimeout && !callerSignals.some((signal) => signal.aborted) && controller.signal.aborted) {
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
    return await runAttempt();
  } catch (error: unknown) {
    if (isLikelyNetworkFetchFailure(error)) {
      const target = resolveRequestTarget(input);
      throw new Error(
        `Cannot reach service endpoint at ${target}. Verify your app configuration and ensure the target runtime is available.`
      );
    }
    throw error instanceof Error ? error : new Error(String(error || 'Request failed.'));
  }
};
