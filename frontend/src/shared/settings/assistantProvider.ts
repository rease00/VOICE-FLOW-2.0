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
  void settings;
  const controlsEnabled = false;
  const provider: AssistantProvider = 'GEMINI';
  const preferUserGeminiKey = false;

  return {
    controlsEnabled,
    provider,
    preferUserGeminiKey,
  };
};
