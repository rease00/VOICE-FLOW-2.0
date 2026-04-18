import { readEnvValue } from '../../shared/runtime/env';

export type AccountBillingMode = 'native' | 'proxy';

const normalizeMode = (value: string): AccountBillingMode => {
  const token = String(value || '').trim().toLowerCase();
  return token === 'proxy' ? 'proxy' : 'native';
};

export const getAccountBillingMode = (): AccountBillingMode => normalizeMode(
  readEnvValue(
    process.env.VF_ACCOUNT_BILLING_MODE,
    process.env.NEXT_PUBLIC_ACCOUNT_BILLING_MODE,
  ) || 'native'
);

export const isAccountBillingProxyMode = (): boolean => getAccountBillingMode() === 'proxy';
