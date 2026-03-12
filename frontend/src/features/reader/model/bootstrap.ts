import type { ReaderLibrary, ReaderSession } from '../../../../types';

export type ReaderBootstrapState = 'loading' | 'ready' | 'needs_auth' | 'error';

const AUTH_ERROR_HINTS = [
  'authentication required',
  'authentication failed',
  'missing bearer token',
  'invalid auth token',
  'auth token',
  'sign in',
  'sign-in',
  'unauthorized',
  'forbidden',
  'token',
];

export const isReaderBootstrapAuthError = (error: unknown): boolean => {
  const status = Number((error as { status?: number } | null | undefined)?.status || 0);
  if (status === 401 || status === 403) return true;
  const message = String((error as { message?: string } | null | undefined)?.message || error || '').trim().toLowerCase();
  if (!message) return false;
  return AUTH_ERROR_HINTS.some((hint) => message.includes(hint));
};

export const resolveReaderBootstrapState = (params: {
  library: ReaderLibrary | null;
  libraryError?: unknown;
}): ReaderBootstrapState => {
  if (params.library) return 'ready';
  if (!params.libraryError) return 'loading';
  return isReaderBootstrapAuthError(params.libraryError) ? 'needs_auth' : 'error';
};

export const resolveReaderResumeSession = (
  library: ReaderLibrary | null | undefined,
  preferredSessionId?: string
): ReaderSession | null => {
  const safeSessionId = String(preferredSessionId || '').trim();
  const activeSessions = library?.activeSessions || [];
  if (safeSessionId) {
    const matched = activeSessions.find((item) => item.id === safeSessionId);
    if (matched) return matched;
    if (library?.activeSession?.id === safeSessionId) return library.activeSession;
  }
  return library?.activeSession || activeSessions[0] || null;
};
