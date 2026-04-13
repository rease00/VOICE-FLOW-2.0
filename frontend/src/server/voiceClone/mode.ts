import { readEnvValue } from '../../shared/runtime/env';

export type VoiceCloneMode = 'native' | 'proxy';

const normalizeMode = (value: string): VoiceCloneMode => {
  const token = String(value || '').trim().toLowerCase();
  return token === 'proxy' ? 'proxy' : 'native';
};

export const getVoiceCloneMode = (): VoiceCloneMode => normalizeMode(
  readEnvValue(
    process.env.VF_VOICE_CLONE_MODE,
    process.env.NEXT_PUBLIC_VOICE_CLONE_MODE,
  ) || 'native'
);

export const isVoiceCloneProxyMode = (): boolean => getVoiceCloneMode() === 'proxy';

export const hasLegacyVoiceCloneProxyConfigured = (): boolean => Boolean(
  readEnvValue(
    process.env.VF_MEDIA_BACKEND_URL,
    process.env.VF_MEDIA_BACKEND_ORIGINS_JSON,
    process.env.VF_MEDIA_BACKEND_URLS_JSON,
  )
);
