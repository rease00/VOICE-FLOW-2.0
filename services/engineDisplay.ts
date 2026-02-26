import { GenerationSettings } from '../types';

export const ENGINE_DISPLAY_NAMES: Record<GenerationSettings['engine'], string> = {
  GEM: 'Plus',
  KOKORO: 'Basic',
};

export const ENGINE_RUNTIME_SUBLABELS: Record<GenerationSettings['engine'], string> = {
  GEM: 'Runtime',
  KOKORO: 'Runtime',
};

export const getEngineDisplayName = (engine: GenerationSettings['engine']): string => {
  return ENGINE_DISPLAY_NAMES[engine] || engine;
};

export const getEngineRuntimeSubLabel = (engine: GenerationSettings['engine']): string => {
  return ENGINE_RUNTIME_SUBLABELS[engine] || 'Runtime';
};
