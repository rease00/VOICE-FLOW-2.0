import { beforeEach, describe, expect, it, vi } from 'vitest';

const switchTtsEngineMock = vi.hoisted(() => vi.fn());

vi.mock('../src/shared/api/gatewayClient', () => ({
  cancelDubbingJob: vi.fn(),
  createDubbingJobV2: vi.fn(),
  downloadDubbingChunk: vi.fn(),
  downloadDubbingReport: vi.fn(),
  downloadDubbingResult: vi.fn(),
  extractAudioFromVideo: vi.fn(),
  fetchTtsEngineCapabilities: vi.fn(),
  getDubbingJob: vi.fn(),
  getDubbingJobWithOptions: vi.fn(),
  muxDubbedVideo: vi.fn(),
  separateStem: vi.fn(),
  switchTtsEngine: (...args: unknown[]) => switchTtsEngineMock(...args),
  tailRuntimeLogs: vi.fn(),
  transcribeVideo: vi.fn(),
}));

describe('mediaBackendService engine switch', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { clearAdminUnlockToken } = await import('../services/adminService');
    clearAdminUnlockToken();
    switchTtsEngineMock.mockResolvedValue({
      ok: true,
      engine: 'PRIME',
      state: 'starting',
      detail: 'Runtime starting in background',
    });
  });

  it('forwards in-memory admin unlock token through the switch mutation path', async () => {
    const { setAdminUnlockToken } = await import('../services/adminService');
    const { switchTtsEngineRuntime } = await import('../services/mediaBackendService');
    setAdminUnlockToken('runtime-unlock-token');

    await switchTtsEngineRuntime('http://127.0.0.1:7800', 'PRIME');

    expect(switchTtsEngineMock).toHaveBeenCalledWith(
      'PRIME',
      expect.objectContaining({
        adminUnlockToken: 'runtime-unlock-token',
      })
    );
  });
});
