import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  FacebookAuthProvider,
  GoogleAuthProvider,
  getAuth,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: String(import.meta.env.VITE_FIREBASE_API_KEY || ''),
  authDomain: String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || ''),
  projectId: String(import.meta.env.VITE_FIREBASE_PROJECT_ID || ''),
  storageBucket: String(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || ''),
  messagingSenderId: String(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || ''),
  appId: String(import.meta.env.VITE_FIREBASE_APP_ID || ''),
};

const hasRequiredFirebaseConfig =
  Boolean(firebaseConfig.apiKey) &&
  Boolean(firebaseConfig.authDomain) &&
  Boolean(firebaseConfig.projectId) &&
  Boolean(firebaseConfig.appId);

const FALLBACK_FIREBASE_APP_NAME = 'voiceflow-fallback';
const FALLBACK_FIREBASE_CONFIG = {
  apiKey: 'demo-key',
  authDomain: 'demo.firebaseapp.com',
  projectId: 'demo-project',
  appId: '1:1:web:1',
};

const parseCsvEnv = (raw: unknown): string[] =>
  String(raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const adminEmailAllowlist = new Set(
  parseCsvEnv(import.meta.env.VITE_ADMIN_EMAIL_ALLOWLIST).map((item) => item.toLowerCase())
);

const adminUidAllowlist = new Set(parseCsvEnv(import.meta.env.VITE_ADMIN_UID_ALLOWLIST));

const explicitAdminLoginEmail = String(import.meta.env.VITE_ADMIN_LOGIN_EMAIL || '')
  .trim()
  .toLowerCase();

if (!hasRequiredFirebaseConfig) {
  // eslint-disable-next-line no-console
  console.warn('Firebase config is incomplete. Set VITE_FIREBASE_* environment variables.');
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

try {
  // Accessing auth eagerly allows us to fallback safely instead of crashing module init.
  getAuth(firebaseApp);
} catch (error) {
  usingFirebaseFallback = true;
  firebaseApp = getOrCreateApp(FALLBACK_FIREBASE_CONFIG, FALLBACK_FIREBASE_APP_NAME);
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

export const isFirebaseConfigured = hasRequiredFirebaseConfig && !usingFirebaseFallback;

export const resolveFirebaseLoginEmail = (rawEmail: string): string => {
  const trimmed = String(rawEmail || '').trim();
  if (!trimmed) return '';
  if (trimmed.includes('@')) return trimmed;
  const token = trimmed.toLowerCase();
  if (/^admin[0-9]*$/.test(token) && firebaseConfig.authDomain) {
    if (token === 'admin' && explicitAdminLoginEmail) return explicitAdminLoginEmail;
    return `${token}@${firebaseConfig.authDomain}`.toLowerCase();
  }
  return trimmed;
};

export const isAdminIdentity = (uid?: string | null, email?: string | null, hasAdminClaim = false): boolean => {
  if (hasAdminClaim) return true;
  const normalizedUid = String(uid || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (normalizedUid && adminUidAllowlist.has(normalizedUid)) return true;
  if (normalizedEmail && adminEmailAllowlist.has(normalizedEmail)) return true;
  return false;
};
