import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchEngineRuntimeVoices,
  fetchRuntimeVoiceRegistry,
  getStaticVoiceFallback,
} from '../services/ttsVoiceRegistryService';
import { fetchTtsEngineVoices } from '../src/shared/api/gatewayClient';

vi.mock('../src/shared/api/gatewayClient', () => ({
  fetchTtsEngineVoices: vi.fn(),
}));

describe('ttsVoiceRegistryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps runtime access tier fields and fallback tiers', async () => {
    vi.mocked(fetchTtsEngineVoices).mockResolvedValueOnce({
      ok: true,
      engine: 'PRIME',
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
    const voices = await fetchEngineRuntimeVoices('PRIME', '');
    expect(voices.length).toBeGreaterThanOrEqual(2);
    const byId = new Map(voices.map((voice) => [voice.id, voice]));
    expect(byId.get('v2')?.accessTier).toBe('free');
    expect(byId.get('v2')?.isPlanRestricted).toBe(false);
    expect(byId.get('v21')?.accessTier).toBe('pro');
    expect(byId.get('v21')?.isPlanRestricted).toBe(true);
  });

  it('prefers backend displayName over runtime or legacy names for PRIME voices', async () => {
    vi.mocked(fetchTtsEngineVoices).mockResolvedValueOnce({
      ok: true,
      engine: 'PRIME',
      voices: [
        {
          voice_id: 'v2',
          voice: 'Kore',
          name: 'Anika',
          displayName: 'Meera India Female',
          mapped_name: 'Meera India Female',
          gender: 'female',
          country: 'India',
          age_group: 'Adult',
        },
      ],
      fetchedAt: new Date().toISOString(),
    });

    const voices = await fetchEngineRuntimeVoices('PRIME', '');
    expect(voices).toHaveLength(1);
    expect(voices[0]).toMatchObject({
      id: 'v2',
      name: 'Meera India Female',
      geminiVoiceName: 'Kore',
      gender: 'Female',
      country: 'India',
      ageGroup: 'Adult',
    });
  });

  it('applies static fallback tier classification', () => {
    const staticVoices = getStaticVoiceFallback('PRIME');
    const byId = new Map(staticVoices.map((voice) => [voice.id, voice]));
    expect(byId.get('v1')?.accessTier).toBe('free');
    expect(byId.get('v10')?.accessTier).toBe('free');
    expect(byId.get('v11')?.accessTier).toBe('pro');
    expect(byId.get('v11')?.isPlanRestricted).toBe(true);
  });

  it('normalizes DUNO runtime voices back to canonical DUNO names', async () => {
    vi.mocked(fetchTtsEngineVoices).mockResolvedValueOnce({
      ok: true,
      engine: 'DUNO',
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

    const voices = await fetchEngineRuntimeVoices('DUNO', '');
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

  it('fetches DUNO runtime voices and falls back to the DUNO static catalog', async () => {
    vi.mocked(fetchTtsEngineVoices)
      .mockResolvedValueOnce({
        ok: true,
        engine: 'PRIME',
        voices: [
          {
            voice_id: 'v2',
            name: 'Free Voice',
            voice: 'Kore',
          },
        ],
        fetchedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        ok: true,
        engine: 'DUNO',
        voices: [
          {
            voice_id: 'af_heart',
            voice: 'af_heart',
            name: 'Lyra US',
          },
        ],
        fetchedAt: new Date().toISOString(),
      })
      .mockRejectedValueOnce(new Error('duno runtime unavailable'));

    const registry = await fetchRuntimeVoiceRegistry({});
    expect(fetchTtsEngineVoices).toHaveBeenCalledWith('DUNO');
    expect(registry.DUNO).toEqual(getStaticVoiceFallback('DUNO'));
    expect(registry.DUNO[0]).toMatchObject({
      engine: 'DUNO',
      id: 'af_heart',
      accessTier: 'free',
    });
  });
});

