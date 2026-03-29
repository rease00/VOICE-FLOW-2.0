import { describe, expect, it } from 'vitest';

import { getOpenVoiceProviderDisplayStatus } from '../src/features/voice-cloning/openvoiceTypes';

describe('openvoice provider display status', () => {
  it('prefers explicit provider payload fields', () => {
    expect(
      getOpenVoiceProviderDisplayStatus({
        ok: true,
        activeProvider: 'cloud_run',
        defaultProvider: 'cloud_run',
        provider: {
          activeProvider: 'cloud_run',
          providers: {
            cloud_run: {
              configured: true,
              ready: true,
              detail: 'Seed VC runtime ready',
              device: 'nvidia-l4',
            },
          },
        },
      } as any)
    ).toMatchObject({
      activeProvider: 'cloud_run',
      activeProviderLabel: 'Cloud Run',
      readyLabel: 'Ready',
      detail: 'Seed VC runtime ready',
      device: 'nvidia-l4',
    });
  });

  it('falls back to runtime vc provider labels when provider payload is missing', () => {
    expect(
      getOpenVoiceProviderDisplayStatus({
        ok: true,
        state: 'online',
        ready: false,
        runtime: {
          vcProvider: 'modal',
          device: 'L4',
        },
      } as any)
    ).toMatchObject({
      activeProvider: 'modal',
      activeProviderLabel: 'Modal',
      readyLabel: 'Not ready',
      device: 'L4',
    });
  });
});
