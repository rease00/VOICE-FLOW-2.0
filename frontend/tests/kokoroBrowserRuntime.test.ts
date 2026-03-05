import { beforeEach, describe, expect, it, vi } from 'vitest';

const fromPretrainedMock = vi.fn();

vi.mock('kokoro-js', () => ({
  KokoroTTS: {
    from_pretrained: (...args: any[]) => fromPretrainedMock(...args),
  },
}));

vi.mock('@huggingface/transformers', () => ({
  env: {
    allowLocalModels: false,
    allowRemoteModels: true,
    localModelPath: '',
    useBrowserCache: false,
  },
}));

import { kokoroBrowserRuntime, shouldUseBrowserKokoroExecution } from '../services/kokoroBrowserRuntime';

const makePrimeStatus = () => ({
  ok: true,
  available: true,
  repoId: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  revision: 'main',
  modelPath: '/models/onnx-community/Kokoro-82M-v1.0-ONNX',
  fileCount: 4,
  totalBytes: 123,
  ready: true,
  missing: [],
  hash: 'abc',
  fetchedAt: new Date().toISOString(),
});

describe('kokoroBrowserRuntime', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('navigator', { gpu: {} } as any);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => makePrimeStatus(),
    })) as any);
    fromPretrainedMock.mockResolvedValue({
      voices: { af_heart: {} },
      model: { dispose: vi.fn(async () => []) },
      tokenizer: { dispose: vi.fn() },
      stream: async function* () {
        // noop
      },
    });
    await kokoroBrowserRuntime.suspend();
  });

  it('selects browser kokoro only for studio/preview contexts', () => {
    expect(shouldUseBrowserKokoroExecution('KOKORO', 'studio', 'browser_webgpu')).toBe(true);
    expect(shouldUseBrowserKokoroExecution('KOKORO', 'preview', undefined)).toBe(true);
    expect(shouldUseBrowserKokoroExecution('KOKORO', 'dubbing', 'browser_webgpu')).toBe(false);
    expect(shouldUseBrowserKokoroExecution('KOKORO', 'studio', 'backend_runtime')).toBe(false);
    expect(shouldUseBrowserKokoroExecution('GEM', 'studio', 'browser_webgpu')).toBe(false);
  });

  it('transitions from warming to ready and then suspended', async () => {
    let resolveModel: ((value: any) => void) | null = null;
    fromPretrainedMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveModel = resolve;
    }));

    const pending = kokoroBrowserRuntime.ensureReady({ backendBaseUrl: 'http://127.0.0.1:7800' });
    expect(kokoroBrowserRuntime.getState()).toBe('warming');

    resolveModel?.({
      voices: { af_heart: {} },
      model: { dispose: vi.fn(async () => []) },
      tokenizer: { dispose: vi.fn() },
      stream: async function* () {
        // noop
      },
    });

    await pending;
    expect(kokoroBrowserRuntime.getState()).toBe('ready');

    await kokoroBrowserRuntime.suspend();
    expect(kokoroBrowserRuntime.getState()).toBe('suspended');
  });

  it('checks local mirror readiness through status endpoint', async () => {
    const status = await kokoroBrowserRuntime.primeAssets('http://127.0.0.1:7800');
    expect(status.ready).toBe(true);
    expect((globalThis.fetch as any).mock.calls[0]?.[0]).toContain('/models/kokoro/status');
  });
});
