import type { GenerationSettings } from '../../../types';

export type AssistantProvider = GenerationSettings['helperProvider'];

export interface AssistantProviderRouting {
  controlsEnabled: boolean;
  provider: AssistantProvider;
  preferUserGeminiKey: boolean;
}

export const normalizeAssistantProviderControlsEnabled = (value: unknown, fallback: boolean = true): boolean => {
  if (typeof value === 'boolean') return value;
  return fallback;
};

export const normalizePreferUserGeminiKey = (value: unknown, fallback: boolean = false): boolean => {
  if (typeof value === 'boolean') return value;
  return fallback;
};

export const resolveAssistantProviderRouting = (
  settings: Pick<GenerationSettings, 'assistantProviderControlsEnabled' | 'helperProvider' | 'preferUserGeminiKey'>
): AssistantProviderRouting => {
  const controlsEnabled = settings.assistantProviderControlsEnabled !== false;
  const requestedProvider = settings.helperProvider;
  const provider: AssistantProvider =
    controlsEnabled && (requestedProvider === 'PERPLEXITY' || requestedProvider === 'LOCAL' || requestedProvider === 'GEMINI')
      ? requestedProvider
      : 'GEMINI';
  const preferUserGeminiKey = controlsEnabled && provider === 'GEMINI' && settings.preferUserGeminiKey === true;

  return {
    controlsEnabled,
    provider,
    preferUserGeminiKey,
  };
};
