import { describe, expect, it, vi } from 'vitest';

import { fetchEngineRuntimeVoices, getStaticVoiceFallback } from '../services/ttsVoiceRegistryService';
import { fetchTtsEngineVoices } from '../src/shared/api/gatewayClient';

vi.mock('../src/shared/api/gatewayClient', () => ({
  fetchTtsEngineVoices: vi.fn(),
}));

describe('ttsVoiceRegistryService', () => {
  it('maps runtime access tier fields and fallback tiers', async () => {
    vi.mocked(fetchTtsEngineVoices).mockResolvedValueOnce({
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
    });
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

  it('normalizes kokoro runtime voices back to canonical kokoro names', async () => {
    vi.mocked(fetchTtsEngineVoices).mockResolvedValueOnce({
      ok: true,
      engine: 'KOKORO',
      voices: [
        {
          voice_id: 'af_heart',
          voice: 'af_heart',
          name: 'Meera India Female',
          mapped_name: 'Meera India Female',
          accent: 'Hindi',
          gender: 'female',
          country: 'India',
          age_group: 'Adult',
        },
      ],
      fetchedAt: new Date().toISOString(),
    });

    const voices = await fetchEngineRuntimeVoices('KOKORO', '');
    expect(voices).toHaveLength(1);
    expect(voices[0]).toMatchObject({
      id: 'af_heart',
      name: 'Lyra US',
      accent: 'American English',
      gender: 'Female',
      country: 'United States',
      ageGroup: 'Adult',
    });
  });
});
