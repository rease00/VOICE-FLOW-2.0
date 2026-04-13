import { readEnvValue } from '../../shared/runtime/env';

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

export const hasLegacyAdminOpsProxyConfigured = (): boolean => Boolean(
  readEnvValue(
    process.env.VF_MEDIA_BACKEND_URL,
    process.env.VF_MEDIA_BACKEND_ORIGINS_JSON,
    process.env.VF_MEDIA_BACKEND_URLS_JSON,
  )
);
