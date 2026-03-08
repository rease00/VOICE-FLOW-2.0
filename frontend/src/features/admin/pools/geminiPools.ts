export type GeminiPoolTone = 'bad' | 'warn' | 'ok' | 'neutral';

export interface GeminiPoolKeyStatusShape {
  status?: string;
  limit?: {
    atLimit?: boolean;
  };
  health?: {
    healthy?: boolean;
    reason?: string;
  };
}

export interface EditableGeminiPoolConfig {
  pools?: Record<string, { keys?: string[] }>;
  fallbackChains?: Record<string, string[]>;
  planPools?: {
    free?: string;
    pro?: string;
    plus?: string;
  };
  defaultFallbackChain?: string[];
  constraints?: {
    uniqueKeyMembership?: boolean;
  };
  sourcePolicy?: {
    provider?: 'gemini_api' | 'vertex';
    ttsModelFallbackEnabled?: boolean;
    vertexProject?: string;
    vertexLocation?: string;
    vertexServiceAccountRef?: string;
    vertexServiceAccountJson?: string;
    [key: string]: unknown;
  };
}

export const classifyGeminiPoolKeyTone = (row: GeminiPoolKeyStatusShape | null | undefined): GeminiPoolTone => {
  const status = String(row?.status || '').trim().toLowerCase();
  const healthy = Boolean(row?.health?.healthy);
  const atLimit = Boolean(row?.limit?.atLimit);
  if (!healthy || status === 'auth_issue' || status === 'error') return 'bad';
  if (atLimit || status === 'rate_limited') return 'warn';
  if (status === 'healthy' || status === 'in_flight') return 'ok';
  return 'neutral';
};

export const normalizePoolIdInput = (value: string): string => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 48);
};

export const createPoolInConfig = (
  config: EditableGeminiPoolConfig,
  poolName: string
): EditableGeminiPoolConfig => {
  const pools = { ...(config.pools || {}) };
  if (pools[poolName]) return config;
  pools[poolName] = { keys: [] };
  const fallbackChains = { ...(config.fallbackChains || {}) };
  const defaultFallbackChain = Array.isArray(config.defaultFallbackChain) ? config.defaultFallbackChain : [];
  fallbackChains[poolName] = [poolName, ...defaultFallbackChain.filter((name) => name !== poolName)];
  return {
    ...config,
    pools,
    fallbackChains,
  };
};

export const deletePoolFromConfig = (
  config: EditableGeminiPoolConfig,
  poolName: string
): EditableGeminiPoolConfig => {
  const pools = { ...(config.pools || {}) };
  const fallbackChains = { ...(config.fallbackChains || {}) };
  delete pools[poolName];
  delete fallbackChains[poolName];
  const planPools = {
    free: String(config.planPools?.free || 'free'),
    pro: String(config.planPools?.pro || 'free'),
    plus: String(config.planPools?.plus || 'free'),
  };
  for (const planKey of ['free', 'pro', 'plus'] as const) {
    if (planPools[planKey] === poolName) {
      planPools[planKey] = '';
    }
  }
  const defaultFallbackChain = (config.defaultFallbackChain || []).filter((item) => String(item || '').trim() !== poolName);
  return {
    ...config,
    pools,
    fallbackChains,
    planPools,
    defaultFallbackChain,
  };
};

export const setPlanPoolInConfig = (
  config: EditableGeminiPoolConfig,
  planKey: 'free' | 'pro' | 'plus',
  poolName: string
): EditableGeminiPoolConfig => {
  return {
    ...config,
    planPools: {
      free: String(config.planPools?.free || 'free'),
      pro: String(config.planPools?.pro || 'free'),
      plus: String(config.planPools?.plus || 'free'),
      [planKey]: String(poolName || ''),
    },
  };
};

export const parseGeminiKeysInput = (value: string): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of String(value || '').split(/[\r\n,]+/)) {
    const normalized = String(token || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

export const applyKeysToPoolInConfig = (
  config: EditableGeminiPoolConfig,
  poolName: string,
  keys: string[]
): EditableGeminiPoolConfig => {
  const safePool = String(poolName || '').trim();
  if (!safePool) return config;
  const nextKeys = Array.isArray(keys) ? keys.map((item) => String(item || '').trim()).filter(Boolean) : [];
  if (nextKeys.length === 0) return config;
  const pools = { ...(config.pools || {}) };
  const currentPool = pools[safePool] || { keys: [] as string[] };
  const currentKeys = Array.isArray(currentPool.keys) ? [...currentPool.keys] : [];
  const seen = new Set(currentKeys.map((item) => String(item || '').trim()).filter(Boolean));
  for (const key of nextKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    currentKeys.push(key);
  }
  pools[safePool] = { keys: currentKeys };
  return {
    ...config,
    pools,
  };
};

export const applySelectedPoolToAllPlans = (
  config: EditableGeminiPoolConfig,
  poolName: string
): EditableGeminiPoolConfig => {
  const safePool = String(poolName || '').trim();
  if (!safePool) return config;
  return {
    ...config,
    planPools: {
      free: safePool,
      pro: safePool,
      plus: safePool,
    },
  };
};

export const setSourcePolicyProvider = (
  config: EditableGeminiPoolConfig,
  provider: 'gemini_api' | 'vertex'
): EditableGeminiPoolConfig => {
  const safeProvider = provider === 'vertex' ? 'vertex' : 'gemini_api';
  return {
    ...config,
    sourcePolicy: {
      ...(config.sourcePolicy || {}),
      provider: safeProvider,
    },
  };
};

export const setTtsModelFallbackEnabled = (
  config: EditableGeminiPoolConfig,
  enabled: boolean
): EditableGeminiPoolConfig => {
  return {
    ...config,
    sourcePolicy: {
      ...(config.sourcePolicy || {}),
      ttsModelFallbackEnabled: Boolean(enabled),
    },
  };
};

export const setVertexSourcePolicyFields = (
  config: EditableGeminiPoolConfig,
  fields: {
    vertexProject?: string;
    vertexLocation?: string;
    vertexServiceAccountJson?: string;
  }
): EditableGeminiPoolConfig => {
  return {
    ...config,
    sourcePolicy: {
      ...(config.sourcePolicy || {}),
      ...(fields.vertexProject !== undefined ? { vertexProject: String(fields.vertexProject || '').trim() } : {}),
      ...(fields.vertexLocation !== undefined ? { vertexLocation: String(fields.vertexLocation || '').trim() } : {}),
      ...(fields.vertexServiceAccountJson !== undefined
        ? { vertexServiceAccountJson: String(fields.vertexServiceAccountJson || '').trim() }
        : {}),
    },
  };
};
