const AUTH_LOGIN_ROUTE = '/api/auth/login';
const AUTH_SESSION_ROUTE = '/api/auth/session';
const AUTH_ME_ROUTE = '/api/auth/me';
const AUTH_SESSION_STORAGE_KEY = 'vf.auth.session.v1';

export interface AuthSessionUser {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  emailVerified?: boolean | null;
}

export interface AuthSessionState {
  token: string;
  uid: string;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  emailVerified?: boolean | null;
}

export interface AuthLoginSuccess {
  ok: true;
  message?: string;
  uid: string;
  token: string;
  user: AuthSessionUser;
}

export interface AuthLoginFailure {
  ok: false;
  error: string;
  code?: string;
  provisioningHint?: string;
  requiresEmailVerification?: boolean;
  canResendVerification?: boolean;
}

export type AuthLoginResult = AuthLoginSuccess | AuthLoginFailure;

const inMemorySessionState: { value: AuthSessionState | null } = { value: null };

const isBrowser = (): boolean => typeof window !== 'undefined';

const readJson = async <T,>(response: Response): Promise<T | null> => {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
};

const normalizeString = (value: unknown): string => String(value ?? '').trim();

const normalizeSessionUser = (payload: unknown): AuthSessionUser | null => {
  if (!payload || typeof payload !== 'object') return null;
  const source = payload as Record<string, unknown>;
  const uid = normalizeString(source.uid);
  if (!uid) return null;
  return {
    uid,
    email: typeof source.email === 'string' ? source.email : null,
    displayName: typeof source.displayName === 'string' ? source.displayName : null,
    photoURL: typeof source.photoURL === 'string' ? source.photoURL : null,
    emailVerified: typeof source.emailVerified === 'boolean' ? source.emailVerified : null,
  };
};

const normalizeSessionState = (payload: unknown): AuthSessionState | null => {
  if (!payload || typeof payload !== 'object') return null;
  const source = payload as Record<string, unknown>;
  const token = normalizeString(source.token);
  const user = normalizeSessionUser(source.user) || normalizeSessionUser(source);
  if (!token || !user) return null;
  return {
    token,
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    photoURL: user.photoURL ?? null,
    emailVerified: user.emailVerified ?? null,
  };
};

const writeSessionState = (state: AuthSessionState | null): void => {
  inMemorySessionState.value = state;
  if (!isBrowser()) return;
  try {
    if (state) {
      window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(state));
    } else {
      window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    }
  } catch {
    // ignore storage failures
  }
};

const readSessionStateFromStorage = (): AuthSessionState | null => {
  if (inMemorySessionState.value) {
    return inMemorySessionState.value;
  }
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const state = normalizeSessionState(parsed);
    if (state) {
      inMemorySessionState.value = state;
    }
    return state;
  } catch {
    return null;
  }
};

export const readStoredAuthSessionToken = (): string => readSessionStateFromStorage()?.token || '';

export const readStoredAuthSessionUid = (): string => readSessionStateFromStorage()?.uid || '';

export const readStoredAuthSessionState = (): AuthSessionState | null => readSessionStateFromStorage();

export const setStoredAuthSessionState = (state: AuthSessionState | null): void => {
  writeSessionState(state);
};

export const clearStoredAuthSessionState = (): void => {
  writeSessionState(null);
};

const mapAuthErrorPayload = (payload: unknown, fallback: string): AuthLoginFailure => {
  if (payload && typeof payload === 'object') {
    const source = payload as Record<string, unknown>;
    const error = normalizeString(source.error || source.detail || source.message) || fallback;
    const code = normalizeString(source.code);
    const provisioningHint = normalizeString(source.provisioningHint);
    const requiresEmailVerification = Boolean(source.requiresEmailVerification);
    const canResendVerification = Boolean(source.canResendVerification);
    return {
      ok: false,
      error,
      ...(code ? { code } : {}),
      ...(provisioningHint ? { provisioningHint } : {}),
      ...(requiresEmailVerification ? { requiresEmailVerification: true } : {}),
      ...(canResendVerification ? { canResendVerification: true } : {}),
    };
  }
  return { ok: false, error: fallback };
};

const fetchJson = async (input: RequestInfo | URL, init: RequestInit): Promise<Response> => fetch(input, init);

export const syncAuthSession = async (token: string): Promise<void> => {
  const safeToken = normalizeString(token);
  if (!safeToken) {
    throw new Error('Missing auth session token.');
  }
  const response = await fetchJson(AUTH_SESSION_ROUTE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${safeToken}`,
    },
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Auth session sync failed with status ${response.status}`);
  }
  const current = readSessionStateFromStorage();
  writeSessionState({
    token: safeToken,
    uid: current?.uid || '',
    email: current?.email ?? null,
    displayName: current?.displayName ?? null,
    photoURL: current?.photoURL ?? null,
    emailVerified: current?.emailVerified ?? null,
  });
};

export const clearAuthSession = async (): Promise<void> => {
  const response = await fetchJson(AUTH_SESSION_ROUTE, {
    method: 'DELETE',
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Auth session clear failed with status ${response.status}`);
  }
  clearStoredAuthSessionState();
};

const persistSuccessfulLogin = async (token: string, user: AuthSessionUser): Promise<void> => {
  const nextState: AuthSessionState = {
    token,
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    photoURL: user.photoURL ?? null,
    emailVerified: user.emailVerified ?? null,
  };
  setStoredAuthSessionState(nextState);
  await syncAuthSession(token);
  setStoredAuthSessionState(nextState);
};

export const loginWithEmailAndPassword = async (
  email: string,
  password: string,
): Promise<AuthLoginResult> => {
  const normalizedEmail = normalizeString(email);
  const normalizedPassword = String(password ?? '');

  const response = await fetchJson(AUTH_LOGIN_ROUTE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify({
      email: normalizedEmail,
      password: normalizedPassword,
    }),
  });

  const payload = await readJson<Record<string, unknown>>(response);
  if (!response.ok) {
    return mapAuthErrorPayload(payload, 'Sign-in failed. Please check your details and try again.');
  }

  const token = normalizeString(payload?.token);
  const user = normalizeSessionUser(payload?.user || payload);
  if (!token || !user) {
    return {
      ok: false,
      error: 'Signed in, but the app could not finish starting your secure session. Please try again.',
    };
  }

  try {
    await persistSuccessfulLogin(token, user);
  } catch (error) {
    clearStoredAuthSessionState();
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Signed in, but the app could not finish starting your secure session. Please try again.',
    };
  }

  return {
    ok: true,
    message: normalizeString(payload?.message) || 'Login successful',
    uid: user.uid,
    token,
    user,
  };
};

export const fetchCurrentAuthSessionUser = async (): Promise<AuthSessionUser | null> => {
  const response = await fetchJson(AUTH_ME_ROUTE, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (response.status === 401 || response.status === 404) {
    clearStoredAuthSessionState();
    return null;
  }
  if (!response.ok) {
    throw new Error(`Auth session lookup failed with status ${response.status}`);
  }
  const payload = await readJson<Record<string, unknown>>(response);
  const user = normalizeSessionUser(payload);
  if (!user) {
    return null;
  }
  const current = readSessionStateFromStorage();
  if (current && current.uid === user.uid) {
    setStoredAuthSessionState({
      token: current.token,
      uid: user.uid,
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      photoURL: user.photoURL ?? null,
      emailVerified: user.emailVerified ?? null,
    });
  }
  return user;
};

export const syncFirebaseSession = syncAuthSession;
export const clearFirebaseSession = clearAuthSession;
