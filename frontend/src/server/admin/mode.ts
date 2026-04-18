import { readEnvValue } from '../../shared/runtime/env';
import { hasConfiguredLegacyBackendOrigin } from '../replatform/backendProxyConfig';

export type AdminOpsMode = 'native' | 'proxy';

const normalizeMode = (value: string): AdminOpsMode => {
  const token = String(value || '').trim().toLowerCase();
  return token === 'proxy' ? 'proxy' : 'native';
};

export const getAdminOpsMode = (): AdminOpsMode => normalizeMode(
  readEnvValue(
    process.env.VF_ADMIN_OPS_MODE,
    process.env.NEXT_PUBLIC_ADMIN_OPS_MODE,
  ) || 'native'
);

export const isAdminOpsProxyMode = (): boolean => getAdminOpsMode() === 'proxy';

export const hasLegacyAdminOpsProxyConfigured = (): boolean => hasConfiguredLegacyBackendOrigin();
