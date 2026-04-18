export type ManagedTtsEngine = 'VECTOR' | 'PRIME';
export type TtsStoragePolicy = 'ephemeral' | 'durable-r2';

export interface RuntimePolicyMeta {
  engine: ManagedTtsEngine;
  runtimeLabel: string;
  model: string;
  storagePolicy: TtsStoragePolicy;
}

export const ENGINE_RUNTIME_LABELS: Record<ManagedTtsEngine, string> = {
  VECTOR: 'Vector Runtime',
  PRIME: 'Prime Runtime',
};

export const ENGINE_MODEL_POLICY: Record<ManagedTtsEngine, { primary: string }> = {
  VECTOR: {
    primary: 'gemini-2.5-flash-tts',
  },
  PRIME: {
    primary: 'gemini-2.5-pro-tts',
  },
};

export const normalizeManagedTtsEngine = (value: unknown): ManagedTtsEngine => {
  const token = String(value || '').trim().toUpperCase();
  return token === 'PRIME' ? 'PRIME' : 'VECTOR';
};

export const getRuntimeLabelForEngine = (engine: ManagedTtsEngine): string => (
  ENGINE_RUNTIME_LABELS[normalizeManagedTtsEngine(engine)]
);

export const getModelPolicyForEngine = (engine: ManagedTtsEngine): { primary: string } => (
  ENGINE_MODEL_POLICY[normalizeManagedTtsEngine(engine)]
);

export const buildRuntimePolicyMeta = (
  engine: ManagedTtsEngine,
  storagePolicy: TtsStoragePolicy,
  model?: string,
): RuntimePolicyMeta => {
  const normalizedEngine = normalizeManagedTtsEngine(engine);
  const preferredModel = getModelPolicyForEngine(normalizedEngine);
  return {
    engine: normalizedEngine,
    runtimeLabel: getRuntimeLabelForEngine(normalizedEngine),
    model: String(model || preferredModel.primary).trim() || preferredModel.primary,
    storagePolicy,
  };
};
