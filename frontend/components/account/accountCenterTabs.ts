export type AccountTabKey = 'account' | 'billing' | 'usage' | 'preferences' | 'support' | 'activity';

export const ACCOUNT_TAB_ORDER: AccountTabKey[] = [
  'account',
  'billing',
  'usage',
  'preferences',
  'support',
];

export const DEFAULT_ACCOUNT_TAB: AccountTabKey = 'account';

export const normalizeAccountTab = (
  value: unknown,
  fallback: AccountTabKey = DEFAULT_ACCOUNT_TAB
): AccountTabKey => {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'account' || token === 'overview') return 'account';
  if (token === 'billing' || token === 'plan') return 'billing';
  if (token === 'usage') return 'usage';
  if (token === 'preferences' || token === 'settings') return 'preferences';
  if (token === 'support' || token === 'help') return 'support';
  if (token === 'activity' || token === 'history') return fallback;
  return fallback;
};

export const resolveAccountTabFromSearch = (
  search: string,
  fallback: AccountTabKey = DEFAULT_ACCOUNT_TAB
): AccountTabKey => {
  const params = new URLSearchParams(String(search || ''));
  return normalizeAccountTab(params.get('vf-tab'), fallback);
};

export const shouldLazyLoadAccountTab = (tab: AccountTabKey): boolean => tab === 'support';

export const shouldKeepConversationSelection = (tab: AccountTabKey): boolean => tab === 'support';
