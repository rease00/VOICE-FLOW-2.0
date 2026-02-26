import { initializeApp, getApps, getApp } from 'firebase/app';
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

const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

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

export const isFirebaseConfigured = hasRequiredFirebaseConfig;

export const resolveFirebaseLoginEmail = (rawEmail: string): string => {
  const trimmed = String(rawEmail || '').trim();
  if (!trimmed) return '';
  if (trimmed.includes('@')) return trimmed;
  if (trimmed.toLowerCase() !== 'admin') return trimmed;
  if (explicitAdminLoginEmail) return explicitAdminLoginEmail;
  if (firebaseConfig.authDomain) {
    return `admin@${firebaseConfig.authDomain}`.toLowerCase();
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
