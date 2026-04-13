import type { DecodedIdToken } from 'firebase-admin/auth';
import type { DocumentData, DocumentReference } from 'firebase-admin/firestore';

import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '../firebaseAdmin';
import { readEnvBoolean } from '../../shared/runtime/env';

export interface ServerAuthedUserContext {
  uid: string;
  decodedToken: DecodedIdToken;
  userRef: DocumentReference<DocumentData>;
  userData: DocumentData | null;
  userExists: boolean;
}

export const readBearerToken = (request: Request): string => {
  const authHeader = String(request.headers.get('authorization') || '').trim();
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    throw new Error('Missing authorization');
  }
  return authHeader.slice(7).trim();
};

const isDevUidHeaderEnabled = (): boolean => {
  const configured = readEnvBoolean(
    process.env.VF_DEV_UID_HEADER_ENABLED,
    process.env.NEXT_PUBLIC_ENABLE_DEV_UID_HEADER,
    process.env.VITE_ENABLE_DEV_UID_HEADER,
  );
  return configured === true;
};

const readDevUid = (request: Request): string => {
  if (!isDevUidHeaderEnabled()) return '';
  return String(request.headers.get('x-dev-uid') || '').trim();
};

export const verifyFirebaseRequest = async (request: Request): Promise<DecodedIdToken> => {
  try {
    const token = readBearerToken(request);
    return getFirebaseAdminAuth().verifyIdToken(token);
  } catch (error) {
    const devUid = readDevUid(request);
    if (!devUid) {
      throw error;
    }
    return {
      uid: devUid,
      email: String(request.headers.get('x-dev-email') || '').trim() || undefined,
    } as DecodedIdToken;
  }
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
