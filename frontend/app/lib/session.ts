import { backendJson } from "./backend";
import type { BackendEnv, BackendFetchOptions } from "./backend";

export type SessionCredentials = {
  email: string;
  password: string;
  sessionTtlDays?: number;
};

export type SessionBootstrapInput = {
  seed: unknown;
  source?: string;
};

export type SessionEnvelope<T = unknown> = {
  ok: true;
  user?: T;
  session?: T;
  roles?: T[];
};

type SessionRequestOptions = BackendFetchOptions & {
  env?: BackendEnv;
};

function authPath(path: string): string {
  return `/api/auth${path.startsWith("/") ? path : `/${path}`}`;
}

export function readSession(options: SessionRequestOptions = {}) {
  return backendJson<SessionEnvelope>(authPath("/session"), {
    ...options,
    method: "GET"
  });
}

export function signInSession(credentials: SessionCredentials, options: SessionRequestOptions = {}) {
  return backendJson<SessionEnvelope>(authPath("/session"), {
    ...options,
    method: "POST",
    json: credentials
  });
}

export function bootstrapSession(input: SessionBootstrapInput, options: SessionRequestOptions = {}) {
  return backendJson<SessionEnvelope>(authPath("/session/bootstrap"), {
    ...options,
    method: "POST",
    json: input
  });
}

export function signOutSession(options: SessionRequestOptions = {}) {
  return backendJson<SessionEnvelope>(authPath("/session/logout"), {
    ...options,
    method: "POST"
  });
}

export function readCurrentUser(options: SessionRequestOptions = {}) {
  return backendJson<SessionEnvelope>(authPath("/me"), {
    ...options,
    method: "GET"
  });
}
