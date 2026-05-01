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
  uid: string;
  expiresAtMs: number;
}

const LEGACY_DRIVE_TOKEN_CACHE_KEY = 'vf_drive_google_token_cache';
const DRIVE_IDENTITY_HINT_KEY = '__anonymous__';
let driveTokenMemory: CachedDriveToken | null = null;
const driveIdentityHints = new Set<string>();

const purgeLegacyDriveTokenStorage = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.removeItem(LEGACY_DRIVE_TOKEN_CACHE_KEY);
  } catch {
    // no-op
  }
};

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

const rememberDriveIdentityHint = (uid?: string): void => {
  const safeUid = String(uid || '').trim();
  driveIdentityHints.add(safeUid || DRIVE_IDENTITY_HINT_KEY);
};

const readCachedToken = (expectedUid?: string): CachedDriveToken | null => {
  const token = driveTokenMemory;
  if (!token) {
    purgeLegacyDriveTokenStorage();
    return null;
  }
  if (token.expiresAtMs <= Date.now()) {
    driveTokenMemory = null;
    purgeLegacyDriveTokenStorage();
    return null;
  }
  const safeExpectedUid = String(expectedUid || '').trim();
  const tokenUid = String(token.uid || '').trim();
  if (safeExpectedUid && tokenUid && tokenUid !== safeExpectedUid) {
    driveTokenMemory = null;
    purgeLegacyDriveTokenStorage();
    return null;
  }
  if (safeExpectedUid && !tokenUid) {
    if (!driveIdentityHints.has(safeExpectedUid) && !driveIdentityHints.has(DRIVE_IDENTITY_HINT_KEY)) {
      return null;
    }
  }
  return token;
};

export const clearDriveTokenCache = (): void => {
  driveTokenMemory = null;
  purgeLegacyDriveTokenStorage();
};

const writeCachedToken = (token: string, uid: string): void => {
  if (!token) return;
  const safeUid = String(uid || '').trim();
  const payload: CachedDriveToken = {
    token,
    uid: safeUid,
    expiresAtMs: Date.now() + 55 * 60 * 1000,
  };
  driveTokenMemory = payload;
  purgeLegacyDriveTokenStorage();
};

interface DriveOAuthCredentialLike {
  accessToken?: string | null;
}

const extractAccessToken = (credential: DriveOAuthCredentialLike | null): string => {
  const token = String((credential as any)?.accessToken || '').trim();
  if (!token) return '';
  return token;
};

export const getDriveProviderToken = async (): Promise<DriveTokenResult> => {
  try {
    const cached = readCachedToken();
    if (cached?.token) {
      return {
        ok: true,
        status: 'connected',
        token: cached.token,
        message: 'Google Drive connected.',
      };
    }

    if (driveIdentityHints.size > 0) {
      return {
        ok: false,
        status: 'needs_consent',
        message: 'Google Drive permission is required. Reconnect Google Drive to continue.',
      };
    }

    return {
      ok: false,
      status: 'needs_login',
      message: 'Please log in to continue.',
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
  rememberDriveIdentityHint();
};

export const reconsentDriveScopes = async (): Promise<void> => {
  rememberDriveIdentityHint();
};

export const warmDriveTokenFromGoogleSignIn = (credential: DriveOAuthCredentialLike | null): void => {
  const token = extractAccessToken(credential);
  if (token) {
    writeCachedToken(token, '');
    rememberDriveIdentityHint();
  }
};

// Compatibility stub preserved for callers that only need a provider-shaped export.
export const googleProvider = {
  providerId: 'google.com',
  scopes: GOOGLE_DRIVE_OAUTH_SCOPES,
  customParameters: GOOGLE_DRIVE_OAUTH_QUERY_PARAMS,
} as const;
