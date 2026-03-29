export type AdminMainTab = 'unlock' | 'users' | 'messages' | 'readerLibrary' | 'pools' | 'ops';

export const ADMIN_MAIN_TAB_ORDER: readonly AdminMainTab[] = [
  'unlock',
  'users',
  'messages',
  'readerLibrary',
  'pools',
  'ops',
] as const;

export const DEFAULT_ADMIN_MAIN_TAB: AdminMainTab = 'users';

export const resolveAdminMainTab = (
  value: unknown,
  fallback: AdminMainTab = DEFAULT_ADMIN_MAIN_TAB
): AdminMainTab => {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'unlock') return 'unlock';
  if (token === 'users' || token === 'user') return 'users';
  if (token === 'messages' || token === 'support') return 'messages';
  if (token === 'readerlibrary' || token === 'reader-library' || token === 'reader') return 'readerLibrary';
  if (token === 'pools' || token === 'pool') return 'pools';
  if (token === 'ops' || token === 'operations') return 'ops';
  return fallback;
};

