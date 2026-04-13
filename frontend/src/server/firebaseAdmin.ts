import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { resolveFirebaseAdminServiceAccount } from './googleCredentials.ts';

let cachedApp: App | null = null;

export const getFirebaseAdminApp = (): App => {
  if (cachedApp) return cachedApp;

  const existing = getApps();
  if (existing.length > 0) {
    cachedApp = existing[0] || null;
    if (cachedApp) return cachedApp;
  }

  const credentials = resolveFirebaseAdminServiceAccount();
  cachedApp = initializeApp({
    credential: cert({
      projectId: credentials.projectId,
      clientEmail: credentials.clientEmail,
      privateKey: credentials.privateKey,
    }),
  });
  return cachedApp;
};

export const getFirebaseAdminAuth = () => getAuth(getFirebaseAdminApp());

export const getFirebaseAdminFirestore = () => getFirestore(getFirebaseAdminApp());
