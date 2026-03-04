const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

export const parseBool = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  const token = String(value).trim().toLowerCase();
  if (!token) return fallback;
  if (TRUTHY.has(token)) return true;
  if (FALSY.has(token)) return false;
  return fallback;
};

export const normalizeBaseUrl = (value, fallback = 'http://127.0.0.1:7800') => {
  const raw = String(value || '').trim();
  if (!raw) return fallback.replace(/\/+$/, '');
  return raw.replace(/\/+$/, '');
};

export const resolveAuditAuthContext = (options = {}) => {
  const scriptName = String(options.scriptName || 'audit-script');
  const requireAuth = parseBool(process.env.AUDIT_REQUIRE_AUTH, true);
  const allowDevUid = parseBool(process.env.AUDIT_ALLOW_DEV_UID, false);
  const tokenRaw = String(process.env.AUDIT_BEARER_TOKEN || '').trim();
  const devUid = String(process.env.AUDIT_DEV_UID || options.defaultDevUid || 'local_admin').trim() || 'local_admin';

  const headers = {};
  if (tokenRaw) {
    headers.Authorization = tokenRaw.toLowerCase().startsWith('bearer ') ? tokenRaw : `Bearer ${tokenRaw}`;
  } else if (allowDevUid) {
    headers['x-dev-uid'] = devUid;
  }

  const mode = tokenRaw ? 'bearer' : (allowDevUid ? 'dev_uid' : 'none');
  const hasAuth = mode !== 'none';
  const missingAuthMessage =
    `[${scriptName}] missing auth for audit calls. Set AUDIT_BEARER_TOKEN, ` +
    `or explicitly opt into dev fallback with AUDIT_ALLOW_DEV_UID=1 and optional AUDIT_DEV_UID=<uid>.`;

  return {
    scriptName,
    requireAuth,
    allowDevUid,
    tokenPresent: Boolean(tokenRaw),
    devUid,
    hasAuth,
    mode,
    headers,
    missingAuthMessage,
  };
};

export const buildAuditHeaders = (baseHeaders = {}, options = {}) => {
  const auth = resolveAuditAuthContext(options);
  if (!auth.hasAuth && auth.requireAuth) {
    throw new Error(auth.missingAuthMessage);
  }
  return {
    headers: {
      ...baseHeaders,
      ...auth.headers,
    },
    auth,
  };
};

const parseBody = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const fetchJsonWithTimeout = async (url, init = {}, timeoutMs = 12_000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = await parseBody(response);
    return {
      ok: response.ok,
      status: response.status,
      payload,
      headers: response.headers,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = String(error?.name || '').toLowerCase() === 'aborterror';
    return {
      ok: false,
      status: 0,
      payload: { error: message },
      headers: null,
      networkError: true,
      timeout: isTimeout,
    };
  } finally {
    clearTimeout(timer);
  }
};

const toLowerText = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.toLowerCase();
  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return String(value).toLowerCase();
  }
};

export const classifyAuditFailure = (input = {}) => {
  const status = Number(input.status || 0);
  const payloadText = toLowerText(input.payload);
  if (status === 401 || status === 403 || payloadText.includes('missing bearer token')) return 'auth';
  if (status === 429 || payloadText.includes('rate limit') || payloadText.includes('throttle') || payloadText.includes('quota')) {
    return 'quota_or_throttle';
  }
  if (status === 408 || status === 504 || payloadText.includes('timeout') || payloadText.includes('aborted')) return 'timeout';
  if (status === 0 && payloadText.includes('fetch')) return 'backend_unavailable';
  if (status >= 500) return 'backend_error';
  if (status >= 400) return 'client_error';
  return 'unknown';
};

export const isTransientFailureClass = (classification) => (
  classification === 'timeout' ||
  classification === 'quota_or_throttle' ||
  classification === 'backend_unavailable' ||
  classification === 'backend_error'
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const withBoundedRetry = async (runner, options = {}) => {
  const maxRetries = Math.max(0, Number(options.maxRetries || 0));
  const baseDelayMs = Math.max(100, Number(options.baseDelayMs || 600));
  const shouldRetry = typeof options.shouldRetry === 'function' ? options.shouldRetry : () => false;

  let attempt = 0;
  // Retries are bounded and only applied to transient classes.
  while (attempt <= maxRetries) {
    const result = await runner(attempt);
    if (attempt >= maxRetries || !shouldRetry(result, attempt)) {
      return {
        ...result,
        attempts: attempt + 1,
      };
    }
    const backoffMs = baseDelayMs * Math.pow(2, attempt);
    await sleep(backoffMs);
    attempt += 1;
  }
  return { attempts: maxRetries + 1 };
};
