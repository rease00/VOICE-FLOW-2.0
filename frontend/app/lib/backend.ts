type FetchLike = {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

export type BackendEnv = Record<string, unknown> & {
  BACKEND?: FetchLike;
  BACKEND_SERVICE?: FetchLike;
  BACKEND_WORKER?: FetchLike;
  BACKEND_ORIGIN?: string;
  API_ORIGIN?: string;
  VF_BACKEND_ORIGIN?: string;
  VF_API_ORIGIN?: string;
};

export type BackendTransport =
  | { kind: "binding"; binding: FetchLike }
  | { kind: "origin"; origin: string }
  | { kind: "fallback"; origin: string };

const BACKEND_BINDING_KEYS = ["BACKEND", "BACKEND_SERVICE", "BACKEND_WORKER"] as const;
const BACKEND_ORIGIN_KEYS = ["BACKEND_ORIGIN", "API_ORIGIN", "VF_BACKEND_ORIGIN", "VF_API_ORIGIN"] as const;
const DEFAULT_BACKEND_ORIGIN = "http://127.0.0.1:8787";

function isFetchLike(value: unknown): value is FetchLike {
  return Boolean(value) && typeof value === "object" && typeof (value as FetchLike).fetch === "function";
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readRuntimeString(env: BackendEnv, key: string): string | null {
  const direct = readString(env[key]);
  if (direct) {
    return direct;
  }

  const runtimeEnv = (typeof import.meta !== "undefined" ? import.meta.env : undefined) as Record<string, string | undefined> | undefined;
  const processEnv = (typeof process !== "undefined" ? process.env : undefined) as Record<string, string | undefined> | undefined;

  return readString(runtimeEnv?.[key] ?? processEnv?.[key] ?? null);
}

export function resolveBackendTransport(env: BackendEnv = {}): BackendTransport {
  for (const key of BACKEND_BINDING_KEYS) {
    const candidate = env[key];
    if (isFetchLike(candidate)) {
      return { kind: "binding", binding: candidate };
    }
  }

  for (const key of BACKEND_ORIGIN_KEYS) {
    const candidate = readRuntimeString(env, key);
    if (!candidate) {
      continue;
    }

    try {
      return { kind: "origin", origin: new URL(candidate).origin };
    } catch {
      continue;
    }
  }

  return { kind: "fallback", origin: DEFAULT_BACKEND_ORIGIN };
}

export function resolveBackendOrigin(env: BackendEnv = {}): string {
  const transport = resolveBackendTransport(env);
  return transport.kind === "binding" ? DEFAULT_BACKEND_ORIGIN : transport.origin;
}

function buildTargetUrl(input: string | URL, origin: string): URL {
  if (input instanceof URL) {
    return input;
  }

  if (/^https?:\/\//i.test(input)) {
    return new URL(input);
  }

  return new URL(input, origin);
}

function mergeForwardedHeaders(target: Headers, source: HeadersInit | undefined): void {
  if (!source) {
    return;
  }

  const headers = new Headers(source);
  for (const [name, value] of headers.entries()) {
    const lowerName = name.toLowerCase();
    if (lowerName === "authorization" || lowerName === "cookie" || lowerName === "x-dev-session-token" || lowerName === "x-session-token") {
      target.set(name, value);
    }
  }
}

function prepareHeaders(initHeaders: HeadersInit | undefined, request?: Request): Headers {
  const headers = new Headers(initHeaders);
  if (request) {
    mergeForwardedHeaders(headers, request.headers);
  }
  return headers;
}

export type BackendFetchOptions = Omit<RequestInit, "body" | "headers"> & {
  env?: BackendEnv;
  request?: Request;
  headers?: HeadersInit;
  body?: BodyInit | null;
  json?: unknown;
  origin?: string;
};

export async function backendFetch(input: string | URL, options: BackendFetchOptions = {}): Promise<Response> {
  const transport = options.env ? resolveBackendTransport(options.env) : resolveBackendTransport();
  const origin = options.origin || (transport.kind === "binding" ? DEFAULT_BACKEND_ORIGIN : transport.origin);
  const headers = prepareHeaders(options.headers, options.request);
  const init: RequestInit = {
    ...options,
    headers
  };

  if (options.json !== undefined) {
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    init.body = JSON.stringify(options.json);
  } else if (options.body !== undefined) {
    init.body = options.body;
  }

  const target = buildTargetUrl(input, origin);

  if (transport.kind === "binding") {
    return transport.binding.fetch(target, init);
  }

  return fetch(target, init);
}

export type BackendJsonOptions = BackendFetchOptions & {
  responseType?: "json" | "text";
};

export async function backendJson<T = unknown>(input: string | URL, options: BackendJsonOptions = {}): Promise<T> {
  const response = await backendFetch(input, options);
  const text = await response.text();

  if (!response.ok) {
    const error = new Error(text || `Backend request failed with status ${response.status}.`);
    (error as Error & { response?: Response; body?: string }).response = response;
    (error as Error & { response?: Response; body?: string }).body = text || undefined;
    throw error;
  }

  if (!text) {
    return undefined as T;
  }

  if (options.responseType === "text") {
    return text as T;
  }

  return JSON.parse(text) as T;
}
