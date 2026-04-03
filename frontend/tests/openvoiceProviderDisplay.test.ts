import { describe, expect, it } from 'vitest';

import { getVoiceCloneProviderDisplayStatus, getOpenVoiceProviderDisplayStatus } from '../src/features/voice-cloning/openvoiceTypes';

describe('voice clone provider display status', () => {
  it('reads the modal-only provider status payload', () => {
    expect(
      getVoiceCloneProviderDisplayStatus({
        ok: true,
        activeProvider: 'modal',
        defaultProvider: 'modal',
        providerStatus: {
          key: 'modal',
          configured: true,
          ready: true,
          detail: 'Modal VC runtime ready',
          device: 'nvidia-l4',
          expectedGpuConcurrency: 2,
          runtimeGpuConcurrency: 2,
          concurrencyVerified: true,
        },
      } as any)
    ).toMatchObject({
      activeProvider: 'modal',
      activeProviderLabel: 'Modal',
      readyLabel: 'Ready',
      detail: 'Modal VC runtime ready',
      device: 'nvidia-l4',
      expectedGpuConcurrency: 2,
      runtimeGpuConcurrency: 2,
      concurrencyVerified: true,
    });
    expect(
      getOpenVoiceProviderDisplayStatus({
        ok: true,
        activeProvider: 'modal',
        defaultProvider: 'modal',
      } as any)
    ).toMatchObject({
      activeProvider: 'modal',
      activeProviderLabel: 'Modal',
    });
  });

  it('falls back to runtime vc provider labels when provider payload is missing', () => {
    expect(
      getVoiceCloneProviderDisplayStatus({
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
