import { useCallback } from 'react';
import type { GenerationSettings } from '../../../../types';
import { generateSpeech } from '../../../../services/geminiService';

export const useStudioGenerate = () => {
  const synthesize = useCallback(async (
    text: string,
    settings: GenerationSettings,
    signal?: AbortSignal
  ) => {
    return generateSpeech(text, settings, signal);
  }, []);

  return { synthesize };
};
