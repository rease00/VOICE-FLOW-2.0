import type { DecodedIdToken } from 'firebase-admin/auth';
import type { DocumentData, DocumentReference } from 'firebase-admin/firestore';

import { readEnvBoolean } from '../../shared/runtime/env.ts';
import { getD1AuthService } from './d1Auth.ts';

export interface ServerAuthedUserContext {
  uid: string;
  decodedToken: DecodedIdToken;
  userRef: DocumentReference<DocumentData>;
  userData: DocumentData | null;
  userExists: boolean;
}

type HeaderSource = Pick<Headers, 'get'> | Record<string, string | string[] | undefined>;

export const SESSION_COOKIE_NAME = '__session';

const readHeaderValue = (headers: HeaderSource, name: string): string => {
  if (typeof (headers as Pick<Headers, 'get'>).get === 'function') {
    return String((headers as Pick<Headers, 'get'>).get(name) || '').trim();
  }
  const rawValue = (headers as Record<string, string | string[] | undefined>)[name.toLowerCase()];
  if (Array.isArray(rawValue)) {
    return String(rawValue[0] || '').trim();
  }
  return String(rawValue || '').trim();
};

export const readCookieValueFromHeader = (cookieHeader: string, cookieName: string): string => {
  const safeHeader = String(cookieHeader || '').trim();
  if (!safeHeader) return '';
  for (const entry of safeHeader.split(';')) {
    const [name, ...rawValue] = entry.split('=');
    if (String(name || '').trim() !== cookieName) continue;
    return decodeURIComponent(rawValue.join('=').trim());
  }
  return '';
};

export const extractBearerToken = (authorizationHeader: string): string => {
  const authHeader = String(authorizationHeader || '').trim();
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    throw new Error('Missing authorization');
  }
  return authHeader.slice(7).trim();
};

export const readBearerToken = (request: Request): string => extractBearerToken(readHeaderValue(request.headers, 'authorization'));

const isDevUidHeaderEnabled = (): boolean => {
  const configured = readEnvBoolean(
    process.env.VF_DEV_UID_HEADER_ENABLED,
    process.env.NEXT_PUBLIC_ENABLE_DEV_UID_HEADER,
  );
  return configured === true;
};

const resolveDevContext = (headers: HeaderSource): DecodedIdToken | null => {
  if (!isDevUidHeaderEnabled()) return null;
  const uid = readHeaderValue(headers, 'x-dev-uid');
  if (!uid) return null;
  const email = readHeaderValue(headers, 'x-dev-email') || undefined;
  const isAdmin = readHeaderValue(headers, 'x-dev-admin').toLowerCase() === 'true'
    || readHeaderValue(headers, 'x-dev-role').toLowerCase() === 'admin';
  return {
    uid,
    email,
    name: undefined,
    picture: undefined,
    email_verified: true,
    admin: isAdmin,
    role: isAdmin ? 'admin' : 'dev',
    roles: isAdmin ? ['admin'] : ['dev'],
  } as unknown as DecodedIdToken;
};

const toRequest = (headers: HeaderSource): Request => {
  const normalizedHeaders = new Headers();
  if (typeof (headers as Pick<Headers, 'get'>).get === 'function') {
    const headerNames = ['authorization', 'cookie', 'x-dev-uid', 'x-dev-email', 'x-dev-admin', 'x-dev-role'];
    for (const headerName of headerNames) {
      const value = readHeaderValue(headers, headerName);
      if (value) normalizedHeaders.set(headerName, value);
    }
    return new Request('http://localhost/api/auth/resolve', { headers: normalizedHeaders });
  }

  for (const [key, value] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (Array.isArray(value)) {
      if (value.length > 0) normalizedHeaders.set(key, String(value[0] || ''));
      continue;
    }
    if (typeof value === 'string' && value.trim()) {
      normalizedHeaders.set(key, value.trim());
    }
  }

  return new Request('http://localhost/api/auth/resolve', { headers: normalizedHeaders });
};

export const verifyFirebaseSessionCookie = async (sessionCookie: string): Promise<DecodedIdToken> => {
  const context = await getD1AuthService().resolveSessionToken(String(sessionCookie || '').trim());
  if (!context) {
    throw new Error('Invalid session token');
  }
  return context.decodedToken;
};

export const verifyFirebaseHeaders = async (headers: HeaderSource): Promise<DecodedIdToken> => {
  const request = toRequest(headers);
  const context = await getD1AuthService().resolveRequestUser(request, { preferCookie: false });
  if (context) {
    return context.decodedToken;
  }

  const devContext = resolveDevContext(headers);
  if (devContext) return devContext;
  throw new Error('Missing authorization');
};

export const verifyFirebaseRequest = async (request: Request): Promise<DecodedIdToken> => {
  const context = await getD1AuthService().resolveRequestUser(request, { preferCookie: false });
  if (context) return context.decodedToken;
  throw new Error('Missing authorization');
};

export const requireServerUser = async (request: Request): Promise<ServerAuthedUserContext> => {
  const context = await getD1AuthService().resolveRequestUser(request, { preferCookie: false });
  if (!context) {
    throw new Error('Missing authorization');
  }
  return context;
};
