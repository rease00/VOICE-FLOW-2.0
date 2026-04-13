import { beforeEach, describe, expect, it, vi } from 'vitest';

const activateTtsEngineMock = vi.hoisted(() => vi.fn());

vi.mock('../src/shared/api/gatewayClient', () => ({
  activateTtsEngine: (...args: unknown[]) => activateTtsEngineMock(...args),
  extractAudioFromVideo: vi.fn(),
  fetchTtsEngineCapabilities: vi.fn(),
  separateStem: vi.fn(),
  tailRuntimeLogs: vi.fn(),
  transcribeVideo: vi.fn(),
}));

describe('mediaBackendService engine switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activateTtsEngineMock.mockResolvedValue({
      ok: true,
      engine: 'PRIME',
      state: 'starting',
      detail: 'Runtime starting in background',
    });
  });

  it('uses the user activation endpoint for runtime startup', async () => {
    const { switchTtsEngineRuntime } = await import('../services/mediaBackendService');

    await switchTtsEngineRuntime('http://127.0.0.1:7800', 'PRIME');

    expect(activateTtsEngineMock).toHaveBeenCalledWith(
      'PRIME',
      expect.objectContaining({
        baseUrl: expect.any(String),
      })
    );
    const [, options] = activateTtsEngineMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(options).not.toHaveProperty('adminUnlockToken');
  });
});
