import {
  GoogleAuthProvider,
  OAuthCredential,
  User,
  linkWithPopup,
  signInWithPopup,
} from 'firebase/auth';
import { firebaseAuth, googleProvider } from './firebaseClient';
import { STORAGE_KEYS } from '../src/shared/storage/keys';

export const GOOGLE_DRIVE_OAUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
].join(' ');

export const GOOGLE_DRIVE_OAUTH_QUERY_PARAMS: Record<string, string> = {
  prompt: 'consent select_account',
  access_type: 'offline',
  include_granted_scopes: 'true',
};

export type DriveTokenStatus =
  | 'connected'
  | 'needs_login'
  | 'guest'
  | 'needs_google_identity'
  | 'needs_consent'
  | 'error';

export interface DriveTokenResult {
  ok: boolean;
  status: DriveTokenStatus;
  token?: string;
  message: string;
}

interface CachedDriveToken {
  token: string;
  expiresAtMs: number;
}

const DRIVE_TOKEN_CACHE_KEY = STORAGE_KEYS.driveGoogleTokenCache;

const parseAuthError = (error: any): Error => {
  const rawMessage = String(error?.message || '').toLowerCase();
  if (rawMessage.includes('network') || rawMessage.includes('fetch')) {
    return new Error('Connection issue while contacting Google auth.');
  }
  if (rawMessage.includes('popup') || rawMessage.includes('cancel')) {
    return new Error('Google sign-in popup was closed before completing consent.');
  }
  if (rawMessage.includes('credential')) {
    return new Error('Google credential is missing required Drive scopes. Re-consent and retry.');
  }
  return new Error(error?.message || 'Authentication error');
};

const cloneDriveProvider = (): GoogleAuthProvider => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters(GOOGLE_DRIVE_OAUTH_QUERY_PARAMS);
  GOOGLE_DRIVE_OAUTH_SCOPES.split(' ')
    .map((scope) => scope.trim())
    .filter(Boolean)
    .forEach((scope) => provider.addScope(scope));
  return provider;
};

const hasGoogleIdentity = (user: User | null): boolean => {
  if (!user) return false;
  return (user.providerData || []).some((provider) => String(provider?.providerId || '') === 'google.com');
};

const readCachedToken = (): CachedDriveToken | null => {
  try {
    const raw = localStorage.getItem(DRIVE_TOKEN_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedDriveToken | null;
    if (!parsed || typeof parsed.token !== 'string' || typeof parsed.expiresAtMs !== 'number') return null;
    if (parsed.expiresAtMs <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeCachedToken = (token: string): void => {
  if (!token) return;
  const payload: CachedDriveToken = {
    token,
    expiresAtMs: Date.now() + 55 * 60 * 1000,
  };
  try {
    localStorage.setItem(DRIVE_TOKEN_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // no-op
  }
};

const extractAccessToken = (credential: OAuthCredential | null): string => {
  const token = String((credential as any)?.accessToken || '').trim();
  if (!token) return '';
  return token;
};

const withDriveConsent = async (user: User, mode: 'link' | 'signin'): Promise<string> => {
  const provider = cloneDriveProvider();
  const result = mode === 'link'
    ? await linkWithPopup(user, provider)
    : await signInWithPopup(firebaseAuth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const token = extractAccessToken(credential);
  if (!token) {
    throw new Error('Google OAuth did not return a Drive access token.');
  }
  writeCachedToken(token);
  return token;
};

export const getDriveProviderToken = async (): Promise<DriveTokenResult> => {
  try {
    const user = firebaseAuth.currentUser;
    if (!user) {
      return {
        ok: false,
        status: 'needs_login',
        message: 'Please log in with Google to continue.',
      };
    }

    if (!hasGoogleIdentity(user)) {
      return {
        ok: false,
        status: 'needs_google_identity',
        message: 'Link your Google account to enable Drive storage.',
      };
    }

    const cached = readCachedToken();
    if (cached?.token) {
      return {
        ok: true,
        status: 'connected',
        token: cached.token,
        message: 'Google Drive connected.',
      };
    }

    return {
      ok: false,
      status: 'needs_consent',
      message: 'Google Drive permission is required. Reconnect Google to continue.',
    };
  } catch (error: any) {
    return {
      ok: false,
      status: 'error',
      message: parseAuthError(error).message,
    };
  }
};

export const connectDriveIdentity = async (): Promise<void> => {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Please sign in first.');
  if (!hasGoogleIdentity(user)) {
    await withDriveConsent(user, 'link');
    return;
  }
  await withDriveConsent(user, 'signin');
};

export const reconsentDriveScopes = async (): Promise<void> => {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Please sign in first.');
  await withDriveConsent(user, 'signin');
};

export const warmDriveTokenFromGoogleSignIn = (credential: OAuthCredential | null): void => {
  const token = extractAccessToken(credential);
  if (token) {
    writeCachedToken(token);
  }
};

// Preserve import parity for code paths that still expect a provider instance.
export { googleProvider };
