import type { DecodedIdToken } from 'firebase-admin/auth';
import type { DocumentData, DocumentReference } from 'firebase-admin/firestore';

import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '../firebaseAdmin.ts';
import { readEnvBoolean } from '../../shared/runtime/env.ts';

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

const readDevUid = (headers: HeaderSource): string => {
  if (!isDevUidHeaderEnabled()) return '';
  return readHeaderValue(headers, 'x-dev-uid');
};

export const verifyFirebaseSessionCookie = async (sessionCookie: string): Promise<DecodedIdToken> => {
  return getFirebaseAdminAuth().verifySessionCookie(String(sessionCookie || '').trim(), true);
};

export const verifyFirebaseHeaders = async (headers: HeaderSource): Promise<DecodedIdToken> => {
  try {
    const token = extractBearerToken(readHeaderValue(headers, 'authorization'));
    return getFirebaseAdminAuth().verifyIdToken(token);
  } catch (bearerError) {
    const sessionCookie = readCookieValueFromHeader(readHeaderValue(headers, 'cookie'), SESSION_COOKIE_NAME);
    if (sessionCookie) {
      try {
        return await verifyFirebaseSessionCookie(sessionCookie);
      } catch (sessionError) {
        const devUid = readDevUid(headers);
        if (!devUid) {
          throw sessionError;
        }
        return {
          uid: devUid,
          email: readHeaderValue(headers, 'x-dev-email') || undefined,
        } as DecodedIdToken;
      }
    }

    const devUid = readDevUid(headers);
    if (!devUid) {
      throw bearerError;
    }
    return {
      uid: devUid,
      email: readHeaderValue(headers, 'x-dev-email') || undefined,
    } as DecodedIdToken;
  }
};

export const verifyFirebaseRequest = async (request: Request): Promise<DecodedIdToken> => {
  return verifyFirebaseHeaders(request.headers);
};

export const requireServerUser = async (request: Request): Promise<ServerAuthedUserContext> => {
  const decodedToken = await verifyFirebaseRequest(request);
  const firestore = getFirebaseAdminFirestore();
  const userRef = firestore.collection('users').doc(decodedToken.uid);
  const userSnapshot = await userRef.get();

  return {
    uid: decodedToken.uid,
    decodedToken,
    userRef,
    userData: userSnapshot.data() ?? null,
    userExists: userSnapshot.exists,
  };
};
