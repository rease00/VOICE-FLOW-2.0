import { ActiveTtsEngineKey, GenerationSettings } from '../types';

const normalizeActiveEngine = (engine: GenerationSettings['engine']): ActiveTtsEngineKey =>
  engine === 'PRIME' ? 'PRIME' : 'VECTOR';

export const ENGINE_DISPLAY_NAMES: Record<ActiveTtsEngineKey, string> = {
  VECTOR: 'Vector',
  PRIME: 'Prime',
};

export const ENGINE_COMPACT_LABELS: Record<ActiveTtsEngineKey, string> = {
  VECTOR: 'Vector',
  PRIME: 'Prime',
};

export const ENGINE_RUNTIME_SUBLABELS: Record<ActiveTtsEngineKey, string> = {
  VECTOR: 'Vector voice engine',
  PRIME: 'Prime voice engine',
};

const TTS_ENGINE_TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bvector runtime\b/gi, 'Vector Runtime'],
  [/\bprime runtime\b/gi, 'Prime Runtime'],
  [/\bvector\b/gi, 'Vector'],
  [/\bprime\b/gi, 'Prime'],
];

export const getEngineDisplayName = (engine: GenerationSettings['engine']): string =>
  ENGINE_DISPLAY_NAMES[normalizeActiveEngine(engine)] || 'Vector';

export const getEngineCompactLabel = (engine: GenerationSettings['engine']): string =>
  ENGINE_COMPACT_LABELS[normalizeActiveEngine(engine)] || getEngineDisplayName(engine);

export const getEngineRuntimeLabel = (engine: GenerationSettings['engine']): string =>
  `${getEngineDisplayName(engine)} Runtime`;

export const getEngineRuntimeSubLabel = (engine: GenerationSettings['engine']): string =>
  ENGINE_RUNTIME_SUBLABELS[normalizeActiveEngine(engine)] || 'Voice engine';

export const sanitizeTtsEngineText = (input: string): string => {
  let value = String(input || '');
  for (const [pattern, replacement] of TTS_ENGINE_TEXT_REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }
  return value;
};
