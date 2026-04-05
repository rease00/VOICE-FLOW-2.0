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

  it('prefers public display labels while preserving runtime metadata', async () => {
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

  it('uses the vector catalog as the compatibility fallback', () => {
    const voices = getStaticVoiceFallback('VECTOR');
    const byId = new Map(voices.map((voice) => [voice.id, voice]));

    expect(voices.length).toBeGreaterThanOrEqual(30);
    expect(byId.get('v2')).toMatchObject({
      name: 'Meera India Female',
      accessTier: 'free',
      isPlanRestricted: false,
    });
  });

  it('fetches runtime voices for supported engines and returns a stable catalog', async () => {
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
        engine: 'VECTOR',
        voices: [
          {
            voice_id: 'v2',
            voice: 'Kore',
            name: 'Free Voice',
          },
        ],
        fetchedAt: new Date().toISOString(),
      });

    const registry = await fetchRuntimeVoiceRegistry({});
    expect(fetchTtsEngineVoices).toHaveBeenNthCalledWith(1, 'PRIME');
    expect(fetchTtsEngineVoices).toHaveBeenNthCalledWith(2, 'VECTOR');
    expect(registry.PRIME).toHaveLength(1);
    expect(registry.VECTOR).toHaveLength(1);
  });
});

