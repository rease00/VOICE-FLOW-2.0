import { GenerationSettings } from '../types';

export const ENGINE_DISPLAY_NAMES: Record<GenerationSettings['engine'], string> = {
  DUNO: 'Duno',
  VECTOR: 'Vector',
  PRIME: 'Prime',
};

export const ENGINE_COMPACT_LABELS: Record<GenerationSettings['engine'], string> = {
  DUNO: 'Duno',
  VECTOR: 'Vector',
  PRIME: 'Prime',
};

export const ENGINE_RUNTIME_SUBLABELS: Record<GenerationSettings['engine'], string> = {
  DUNO: 'Duno voice engine',
  VECTOR: 'Vector voice engine',
  PRIME: 'Prime voice engine',
};

const TTS_ENGINE_TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bvector runtime\b/gi, 'Vector Runtime'],
  [/\bprime runtime\b/gi, 'Prime Runtime'],
  [/\bduno runtime\b/gi, 'Duno Runtime'],
  [/\bvector\b/gi, 'Vector'],
  [/\bprime\b/gi, 'Prime'],
  [/\bduno\b/gi, 'Duno'],
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
