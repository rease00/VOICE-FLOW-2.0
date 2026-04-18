import { readEnvValue } from '../../shared/runtime/env';
import { hasConfiguredLegacyBackendOrigin } from '../replatform/backendProxyConfig';

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

export const hasLegacyVoiceCloneProxyConfigured = (): boolean => hasConfiguredLegacyBackendOrigin();
