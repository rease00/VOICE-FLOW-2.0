export const AUTH_HEADER_KEYS = {
  authorization: 'Authorization',
  devUid: 'x-dev-uid',
} as const;

export type AuthMode = 'firebase_id_token' | 'none';

export interface AuthHeaderInput {
  idToken?: string;
}

export interface AuthHeaderResolution {
  headers: Headers;
  hasAuth: boolean;
  mode: AuthMode;
}

export const resolveAuthHeaders = (
  source: HeadersInit | undefined,
  input: AuthHeaderInput
): AuthHeaderResolution => {
  const headers = new Headers(source || {});
  const idToken = String(input.idToken || '').trim();
  if (idToken) {
    headers.set(AUTH_HEADER_KEYS.authorization, `Bearer ${idToken}`);
    return { headers, hasAuth: true, mode: 'firebase_id_token' };
  }

  return { headers, hasAuth: false, mode: 'none' };
};
