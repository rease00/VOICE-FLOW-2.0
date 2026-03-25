import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  FacebookAuthProvider,
  GoogleAuthProvider,
  getAuth,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { readEnvCsv, readEnvValue } from '../src/shared/runtime/env';

const DEFAULT_DEPLOY_FIREBASE_CONFIG = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  appId: '',
};

const firebaseConfig = {
  apiKey: readEnvValue(process.env.NEXT_PUBLIC_FIREBASE_API_KEY, process.env.VITE_FIREBASE_API_KEY) || DEFAULT_DEPLOY_FIREBASE_CONFIG.apiKey,
  authDomain: readEnvValue(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, process.env.VITE_FIREBASE_AUTH_DOMAIN) || DEFAULT_DEPLOY_FIREBASE_CONFIG.authDomain,
  projectId: readEnvValue(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, process.env.VITE_FIREBASE_PROJECT_ID) || DEFAULT_DEPLOY_FIREBASE_CONFIG.projectId,
  storageBucket: readEnvValue(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, process.env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: readEnvValue(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID, process.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  appId: readEnvValue(process.env.NEXT_PUBLIC_FIREBASE_APP_ID, process.env.VITE_FIREBASE_APP_ID) || DEFAULT_DEPLOY_FIREBASE_CONFIG.appId,
};

const hasRequiredFirebaseConfig =
  Boolean(firebaseConfig.apiKey) &&
  Boolean(firebaseConfig.authDomain) &&
  Boolean(firebaseConfig.projectId) &&
  Boolean(firebaseConfig.appId);

const REQUIRED_FIREBASE_ENV_KEYS = [
  { key: 'apiKey', primary: 'NEXT_PUBLIC_FIREBASE_API_KEY', fallback: 'VITE_FIREBASE_API_KEY' },
  { key: 'authDomain', primary: 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', fallback: 'VITE_FIREBASE_AUTH_DOMAIN' },
  { key: 'projectId', primary: 'NEXT_PUBLIC_FIREBASE_PROJECT_ID', fallback: 'VITE_FIREBASE_PROJECT_ID' },
  { key: 'appId', primary: 'NEXT_PUBLIC_FIREBASE_APP_ID', fallback: 'VITE_FIREBASE_APP_ID' },
] as const;

const missingRequiredFirebaseEnv = REQUIRED_FIREBASE_ENV_KEYS.filter(({ key }) => !String(firebaseConfig[key] || '').trim());

const FALLBACK_FIREBASE_APP_NAME = 'voiceflow-fallback';
const FALLBACK_FIREBASE_CONFIG = {
  apiKey: 'demo-key',
  authDomain: 'demo.firebaseapp.com',
  projectId: 'demo-project',
  appId: '1:1:web:1',
};

const adminEmailAllowlist = new Set(
  readEnvCsv(process.env.NEXT_PUBLIC_ADMIN_EMAIL_ALLOWLIST, process.env.VITE_ADMIN_EMAIL_ALLOWLIST).map((item) => item.toLowerCase())
);

const adminUidAllowlist = new Set(
  readEnvCsv(process.env.NEXT_PUBLIC_ADMIN_UID_ALLOWLIST, process.env.VITE_ADMIN_UID_ALLOWLIST)
);

if (!hasRequiredFirebaseConfig && process.env.NODE_ENV === 'development') {
  // eslint-disable-next-line no-console
  console.warn('Firebase config is incomplete. Set NEXT_PUBLIC_FIREBASE_* environment variables (or VITE_* during migration).');
}

const getOrCreateApp = (config: Record<string, string>, name?: string): FirebaseApp => {
  if (name) {
    const existing = getApps().find((entry) => entry.name === name);
    return existing || initializeApp(config, name);
  }
  return getApps().length > 0 ? getApp() : initializeApp(config);
};

let firebaseApp = getOrCreateApp(hasRequiredFirebaseConfig ? firebaseConfig : FALLBACK_FIREBASE_CONFIG);
let usingFirebaseFallback = !hasRequiredFirebaseConfig;
let firebaseInitIssue = '';

try {
  // Accessing auth eagerly allows us to fallback safely instead of crashing module init.
  getAuth(firebaseApp);
} catch (error) {
  usingFirebaseFallback = true;
  firebaseApp = getOrCreateApp(FALLBACK_FIREBASE_CONFIG, FALLBACK_FIREBASE_APP_NAME);
  firebaseInitIssue = error instanceof Error ? error.message : String(error || 'Unknown Firebase init error.');
  // eslint-disable-next-line no-console
  console.warn('Firebase auth init failed. Falling back to local-safe Firebase app.', error);
}

export const firebaseAuth = getAuth(firebaseApp);
export const firestoreDb = getFirestore(firebaseApp);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
googleProvider.addScope('email');
googleProvider.addScope('profile');
googleProvider.addScope('https://www.googleapis.com/auth/drive');
googleProvider.addScope('https://www.googleapis.com/auth/documents');

export const facebookProvider = new FacebookAuthProvider();
facebookProvider.addScope('email');

const buildFirebaseConfigIssue = (): string => {
  if (missingRequiredFirebaseEnv.length > 0) {
    const requiredVars = missingRequiredFirebaseEnv.map((item) => `${item.primary} (or ${item.fallback})`);
    return `Firebase config is missing required env vars: ${requiredVars.join(', ')}.`;
  }
  if (usingFirebaseFallback) {
    return firebaseInitIssue
      ? `Firebase initialization failed: ${firebaseInitIssue}`
      : 'Firebase is using fallback configuration.';
  }
  return '';
};

export const firebaseConfigIssue = buildFirebaseConfigIssue();
export const isFirebaseConfigured = hasRequiredFirebaseConfig && !usingFirebaseFallback && !firebaseConfigIssue;

export const resolveFirebaseLoginEmail = (rawEmail: string): string => {
  const trimmed = String(rawEmail || '').trim();
  if (!trimmed) return '';
  return trimmed.includes('@') ? trimmed : '';
};

export const isAdminIdentity = (uid?: string | null, email?: string | null, hasAdminClaim = false): boolean => {
  if (hasAdminClaim) return true;
  const normalizedUid = String(uid || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (normalizedUid && adminUidAllowlist.has(normalizedUid)) return true;
  if (normalizedEmail && adminEmailAllowlist.has(normalizedEmail)) return true;
  return false;
};
