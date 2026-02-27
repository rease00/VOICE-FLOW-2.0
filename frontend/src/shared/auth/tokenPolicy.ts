export const AUTH_HEADER_KEYS = {
  authorization: 'Authorization',
  devUid: 'x-dev-uid',
} as const;

export type AuthMode = 'firebase_id_token' | 'local_admin_uid' | 'none';

export interface AuthHeaderInput {
  idToken?: string;
  localAdminUid?: string;
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

  const localAdminUid = String(input.localAdminUid || '').trim();
  if (localAdminUid) {
    headers.set(AUTH_HEADER_KEYS.devUid, localAdminUid);
    return { headers, hasAuth: true, mode: 'local_admin_uid' };
  }

  return { headers, hasAuth: false, mode: 'none' };
};
