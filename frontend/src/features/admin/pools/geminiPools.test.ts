import { describe, expect, it } from 'vitest';
import {
  classifyGeminiPoolKeyTone,
  createPoolInConfig,
  deletePoolFromConfig,
  normalizePoolIdInput,
  setPlanPoolInConfig,
  setTtsModelFallbackEnabled,
  setVertexSourcePolicyFields,
} from './geminiPools';

describe('geminiPools helpers', () => {
  it('classifies key tones for unhealthy and quota-limited keys', () => {
    expect(classifyGeminiPoolKeyTone({ status: 'auth_issue', health: { healthy: false } })).toBe('bad');
    expect(classifyGeminiPoolKeyTone({ status: 'rate_limited', health: { healthy: true }, limit: { atLimit: true } })).toBe('warn');
    expect(classifyGeminiPoolKeyTone({ status: 'healthy', health: { healthy: true } })).toBe('ok');
  });

  it('normalizes pool ids from user input', () => {
    expect(normalizePoolIdInput(' Enterprise Gold!!! ')).toBe('enterprise_gold');
    expect(normalizePoolIdInput('VIP-POOL_01')).toBe('vip-pool_01');
  });

  it('creates and deletes pools while keeping config shape', () => {
    const base = {
      pools: {
        free: { keys: [] },
      },
      fallbackChains: {
        free: ['free'],
      },
      defaultFallbackChain: ['free'],
      planPools: {
        free: 'free',
        pro: 'free',
        plus: 'free',
      },
    };

    const withPool = createPoolInConfig(base, 'team_alpha');
    expect(withPool.pools?.team_alpha?.keys).toEqual([]);
    expect(withPool.fallbackChains?.team_alpha).toEqual(['team_alpha', 'free']);

    const withoutPool = deletePoolFromConfig(withPool, 'team_alpha');
    expect(withoutPool.pools?.team_alpha).toBeUndefined();
    expect(withoutPool.fallbackChains?.team_alpha).toBeUndefined();
  });

  it('updates plan mapping payload shape', () => {
    const base = {
      planPools: {
        free: 'free',
        pro: 'free',
        plus: 'free',
      },
    };
    const updated = setPlanPoolInConfig(base, 'plus', 'enterprise_gold');
    expect(updated.planPools?.plus).toBe('enterprise_gold');
    expect(updated.planPools?.free).toBe('free');
    expect(updated.planPools?.pro).toBe('free');
  });

  it('toggles Gemini TTS model fallback in source policy', () => {
    const base = {
      sourcePolicy: {
        provider: 'gemini_api' as const,
      },
    };

    const enabled = setTtsModelFallbackEnabled(base, true);
    expect(enabled.sourcePolicy?.ttsModelFallbackEnabled).toBe(true);

    const disabled = setTtsModelFallbackEnabled(enabled, false);
    expect(disabled.sourcePolicy?.ttsModelFallbackEnabled).toBe(false);
    expect(disabled.sourcePolicy?.provider).toBe('gemini_api');
  });

  it('stores write-only vertex credentials fields in source policy payload', () => {
    const base = { sourcePolicy: { provider: 'vertex' as const } };
    const updated = setVertexSourcePolicyFields(base, {
      vertexProject: 'voiceflow-000f',
      vertexLocation: 'us-central1',
      vertexAccessToken: 'AQ.example',
    });

    expect(updated.sourcePolicy?.vertexProject).toBe('voiceflow-000f');
    expect(updated.sourcePolicy?.vertexLocation).toBe('us-central1');
    expect(updated.sourcePolicy?.vertexAccessToken).toBe('AQ.example');
  });
});
