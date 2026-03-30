const normalizeHeaderEntries = (headers: HeadersInit | undefined): string => {
  if (!headers) return '';
  const normalized = new Headers(headers);
  return Array.from(normalized.entries())
    .map(([key, value]) => [key.toLowerCase(), String(value || '').trim()] as const)
    .sort(([aKey, aValue], [bKey, bValue]) => (
      aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey)
    ))
    .map(([key, value]) => `${key}:${value}`)
    .join('|');
};

const resolveRequestHeaders = (input: RequestInfo | URL, init?: RequestInit): HeadersInit | undefined => {
  const headers = new Headers();
  let hasHeaders = false;
  if (typeof Request !== 'undefined' && input instanceof Request) {
    input.headers.forEach((value, key) => {
      headers.set(key, value);
      hasHeaders = true;
    });
  }
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value);
      hasHeaders = true;
    });
  }
  return hasHeaders ? headers : undefined;
};

const resolveRequestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return String((input as { url?: unknown })?.url || '');
};

const resolveRequestMethod = (input: RequestInfo | URL, init?: RequestInit): string => {
  if (init?.method) return String(init.method || 'GET').trim().toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return String(input.method || 'GET').trim().toUpperCase();
  }
  return 'GET';
};

const resolveRequestSignal = (input: RequestInfo | URL, init?: RequestInit): AbortSignal | null => {
  if (init?.signal) return init.signal;
  if (typeof Request !== 'undefined' && input instanceof Request && input.signal) return input.signal;
  return null;
};

const stripSignalFromInit = (init?: RequestInit): RequestInit | undefined => {
  if (!init) return undefined;
  const next = { ...(init as RequestInit & { priority?: string }) };
  delete (next as RequestInit & { signal?: AbortSignal | null }).signal;
  return next;
};

const resolveRequestCache = (input: RequestInfo | URL, init?: RequestInit): string => {
  if (typeof init?.cache === 'string' && init.cache) return init.cache;
  if (typeof Request !== 'undefined' && input instanceof Request) return String(input.cache || '');
  return '';
};

const resolveRequestCredentials = (input: RequestInfo | URL, init?: RequestInit): string => {
  if (typeof init?.credentials === 'string' && init.credentials) return init.credentials;
  if (typeof Request !== 'undefined' && input instanceof Request) return String(input.credentials || '');
  return '';
};

const resolveRequestMode = (input: RequestInfo | URL, init?: RequestInit): string => {
  if (typeof init?.mode === 'string' && init.mode) return init.mode;
  if (typeof Request !== 'undefined' && input instanceof Request) return String(input.mode || '');
  return '';
};

const resolveRequestRedirect = (input: RequestInfo | URL, init?: RequestInit): string => {
  if (typeof init?.redirect === 'string' && init.redirect) return init.redirect;
  if (typeof Request !== 'undefined' && input instanceof Request) return String(input.redirect || '');
  return '';
};

const resolveRequestReferrerPolicy = (input: RequestInfo | URL, init?: RequestInit): string => {
  if (typeof init?.referrerPolicy === 'string' && init.referrerPolicy) return init.referrerPolicy;
  if (typeof Request !== 'undefined' && input instanceof Request) return String(input.referrerPolicy || '');
  return '';
};

const resolveRequestIntegrity = (input: RequestInfo | URL, init?: RequestInit): string => {
  if (typeof init?.integrity === 'string' && init.integrity) return init.integrity;
  if (typeof Request !== 'undefined' && input instanceof Request) return String(input.integrity || '');
  return '';
};

const resolveRequestKeepalive = (input: RequestInfo | URL, init?: RequestInit): string => {
  if (typeof init?.keepalive === 'boolean') return init.keepalive ? '1' : '0';
  if (typeof Request !== 'undefined' && input instanceof Request) return input.keepalive ? '1' : '0';
  return '0';
};

const resolveRequestPriority = (input: RequestInfo | URL, init?: RequestInit): string => {
  const initPriority = (init as RequestInit & { priority?: string })?.priority;
  if (typeof initPriority === 'string' && initPriority) return initPriority;
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return String((input as Request & { priority?: string }).priority || '');
  }
  return '';
};

const buildRequestKey = (input: RequestInfo | URL, init?: RequestInit): string | null => {
  const method = resolveRequestMethod(input, init);
  if (method !== 'GET') return null;

  const url = resolveRequestUrl(input).trim();
  if (!url) return null;

  const headers = normalizeHeaderEntries(resolveRequestHeaders(input, init));
  const requestCache = resolveRequestCache(input, init);
  const credentials = resolveRequestCredentials(input, init);
  const mode = resolveRequestMode(input, init);
  const redirect = resolveRequestRedirect(input, init);
  const referrerPolicy = resolveRequestReferrerPolicy(input, init);
  const integrity = resolveRequestIntegrity(input, init);
  const keepalive = resolveRequestKeepalive(input, init);
  const priority = resolveRequestPriority(input, init);

  return [
    method,
    url,
    headers,
    requestCache,
    credentials,
    mode,
    redirect,
    referrerPolicy,
    integrity,
    keepalive,
    priority,
  ].join('::');
};

const buildSharedFetchArgs = (
  input: RequestInfo | URL,
  init?: RequestInit
): { input: RequestInfo | URL; init?: RequestInit } => {
  const initWithoutSignal = stripSignalFromInit(init);
  if (!(typeof Request !== 'undefined' && input instanceof Request)) {
    return initWithoutSignal ? { input, init: initWithoutSignal } : { input };
  }

  const mergedInit: RequestInit & { priority?: string } = {
    ...initWithoutSignal,
    method: resolveRequestMethod(input, init),
  };

  const mergedHeaders = resolveRequestHeaders(input, init);
  if (mergedHeaders) mergedInit.headers = mergedHeaders;

  const cache = resolveRequestCache(input, init);
  if (cache) mergedInit.cache = cache as RequestCache;

  const credentials = resolveRequestCredentials(input, init);
  if (credentials) mergedInit.credentials = credentials as RequestCredentials;

  const mode = resolveRequestMode(input, init);
  if (mode) mergedInit.mode = mode as RequestMode;

  const redirect = resolveRequestRedirect(input, init);
  if (redirect) mergedInit.redirect = redirect as RequestRedirect;

  const referrerPolicy = resolveRequestReferrerPolicy(input, init);
  if (referrerPolicy) mergedInit.referrerPolicy = referrerPolicy as ReferrerPolicy;

  const integrity = resolveRequestIntegrity(input, init);
  if (integrity) mergedInit.integrity = integrity;

  if (resolveRequestKeepalive(input, init) === '1') {
    mergedInit.keepalive = true;
  }

  const priority = resolveRequestPriority(input, init);
  if (priority) mergedInit.priority = priority as RequestPriority;

  const url = resolveRequestUrl(input).trim();
  return { input: url || input, init: mergedInit };
};

const createAbortError = (): Error => {
  try {
    return new DOMException('The operation was aborted.', 'AbortError');
  } catch {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
  }
};

const awaitResponseWithSignal = async (pending: Promise<Response>, signal: AbortSignal | null): Promise<Response> => {
  if (!signal) return pending;
  if (signal.aborted) throw createAbortError();

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(createAbortError());
    };

    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (response) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(response);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      }
    );
  });
};

const inFlightRequests = new Map<string, Promise<Response>>();

export const fetchWithRequestDedup = async (
  input: RequestInfo | URL,
  init?: RequestInit,
  fetchImpl: typeof fetch = fetch
): Promise<Response> => {
  const key = buildRequestKey(input, init);
  if (!key) {
    return fetchImpl(input, init);
  }

  const callerSignal = resolveRequestSignal(input, init);
  const existing = inFlightRequests.get(key);
  if (existing) {
    const response = await awaitResponseWithSignal(existing, callerSignal);
    return response.clone();
  }

  const sharedArgs = buildSharedFetchArgs(input, init);
  const pending = fetchImpl(sharedArgs.input, sharedArgs.init);
  inFlightRequests.set(key, pending);
  const clearPendingRequest = () => {
    if (inFlightRequests.get(key) === pending) {
      inFlightRequests.delete(key);
    }
  };
  pending.then(clearPendingRequest, clearPendingRequest);

  return await awaitResponseWithSignal(pending, callerSignal);
};
