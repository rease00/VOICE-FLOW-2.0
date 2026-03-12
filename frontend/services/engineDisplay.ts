import { GenerationSettings } from '../types';

export const ENGINE_DISPLAY_NAMES: Record<GenerationSettings['engine'], string> = {
  KOKORO: 'Basic',
  NEURAL2: 'Vector',
  GEM: 'Prime',
};

export const ENGINE_COMPACT_LABELS: Record<GenerationSettings['engine'], string> = {
  KOKORO: 'Bas',
  NEURAL2: 'Vec',
  GEM: 'Pri',
};

export const ENGINE_RUNTIME_SUBLABELS: Record<GenerationSettings['engine'], string> = {
  KOKORO: 'Reliable voice engine',
  NEURAL2: 'Balanced voice engine',
  GEM: 'Flagship voice engine',
};

const TTS_ENGINE_TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bneural[\s_-]*2 runtime\b/gi, 'Vector Runtime'],
  [/\bkokoro runtime\b/gi, 'Basic Runtime'],
  [/\bgemini runtime\b/gi, 'Prime Runtime'],
  [/\bgem runtime\b/gi, 'Prime Runtime'],
  [/\bneural[\s_-]*2\b/gi, 'Vector'],
  [/\bkokoro\b/gi, 'Basic'],
  [/\bGEM\b/g, 'Prime'],
  [/\bGemini TTS\b/gi, 'Prime voice'],
];

export const getEngineDisplayName = (engine: GenerationSettings['engine']): string => ENGINE_DISPLAY_NAMES[engine] || engine;

export const getEngineCompactLabel = (engine: GenerationSettings['engine']): string =>
  ENGINE_COMPACT_LABELS[engine] || getEngineDisplayName(engine);

export const getEngineRuntimeLabel = (engine: GenerationSettings['engine']): string =>
  `${getEngineDisplayName(engine)} Runtime`;

export const getEngineRuntimeSubLabel = (engine: GenerationSettings['engine']): string =>
  ENGINE_RUNTIME_SUBLABELS[engine] || 'Voice engine';

export const sanitizeTtsEngineText = (input: string): string => {
  let value = String(input || '');
  for (const [pattern, replacement] of TTS_ENGINE_TEXT_REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }
  return value;
};
