export type AdminMainTab = 'today' | 'users' | 'runtime' | 'money' | 'safety';

export const ADMIN_MAIN_TAB_ORDER: readonly AdminMainTab[] = [
  'today',
  'users',
  'runtime',
  'money',
  'safety',
] as const;

export const DEFAULT_ADMIN_MAIN_TAB: AdminMainTab = 'today';

export const resolveAdminMainTab = (
  value: unknown,
  fallback: AdminMainTab = DEFAULT_ADMIN_MAIN_TAB
): AdminMainTab => {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'today' || token === 'home' || token === 'dashboard') return 'today';
  if (token === 'users' || token === 'user') return 'users';
  if (token === 'runtime' || token === 'ops' || token === 'operations' || token === 'pool' || token === 'pools') return 'runtime';
  if (token === 'money' || token === 'billing' || token === 'finance' || token === 'accounting') return 'money';
  if (token === 'safety' || token === 'support' || token === 'messages' || token === 'unlock') return 'safety';
  return fallback;
};

