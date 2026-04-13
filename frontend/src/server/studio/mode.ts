import { readEnvValue } from '../../shared/runtime/env';

export type StudioMode = 'native' | 'proxy';

const normalizeMode = (value: string): StudioMode => {
  const token = String(value || '').trim().toLowerCase();
  return token === 'proxy' ? 'proxy' : 'native';
};

export const getStudioMode = (): StudioMode => normalizeMode(
  readEnvValue(
    process.env.VF_STUDIO_MODE,
    process.env.NEXT_PUBLIC_STUDIO_MODE,
  ) || 'native'
);

export const isStudioProxyMode = (): boolean => getStudioMode() === 'proxy';
