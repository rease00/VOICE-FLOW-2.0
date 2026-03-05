import { useCallback } from 'react';
import type { GenerationSettings } from '../../../../types';
import { generateSpeech } from '../../../../services/geminiService';

export const useStudioGenerate = () => {
  const synthesize = useCallback(async (
    text: string,
    settings: GenerationSettings,
    mode: 'speech' | 'singing' = 'speech',
    signal?: AbortSignal
  ) => {
    const voiceName = String(settings.voiceId || '').trim() || 'alloy';
    return generateSpeech(text, voiceName, settings, mode, signal, { context: 'studio', preferLiveChunks: true });
  }, []);

  return { synthesize };
};
