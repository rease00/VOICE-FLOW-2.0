import { describe, expect, it, vi } from 'vitest';

import { fetchEngineRuntimeVoices, getStaticVoiceFallback } from '../services/ttsVoiceRegistryService';

vi.mock('../src/shared/api/gatewayClient', () => ({
  fetchTtsEngineVoices: vi.fn(async () => ({
    ok: true,
    engine: 'GEM',
    voices: [
      {
        voice_id: 'v2',
        name: 'Free Voice',
        voice: 'Kore',
        access_tier: 'free',
        is_plan_restricted: false,
      },
      {
        voice_id: 'v21',
        name: 'Pro Voice',
        voice: 'Orus',
      },
    ],
    fetchedAt: new Date().toISOString(),
  })),
}));

describe('ttsVoiceRegistryService', () => {
  it('maps runtime access tier fields and fallback tiers', async () => {
    const voices = await fetchEngineRuntimeVoices('GEM', '');
    expect(voices.length).toBeGreaterThanOrEqual(2);
    const byId = new Map(voices.map((voice) => [voice.id, voice]));
    expect(byId.get('v2')?.accessTier).toBe('free');
    expect(byId.get('v2')?.isPlanRestricted).toBe(false);
    expect(byId.get('v21')?.accessTier).toBe('pro');
    expect(byId.get('v21')?.isPlanRestricted).toBe(true);
  });

  it('applies static fallback tier classification', () => {
    const staticVoices = getStaticVoiceFallback('GEM');
    const byId = new Map(staticVoices.map((voice) => [voice.id, voice]));
    expect(byId.get('v1')?.accessTier).toBe('free');
    expect(byId.get('v10')?.accessTier).toBe('free');
    expect(byId.get('v11')?.accessTier).toBe('pro');
    expect(byId.get('v11')?.isPlanRestricted).toBe(true);
  });
});
