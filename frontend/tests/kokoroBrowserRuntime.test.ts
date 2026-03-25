import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
  isBrowserKokoroExecutionEnabled,
  kokoroBrowserRuntime,
  shouldUseBrowserKokoroExecution,
} from '../services/kokoroBrowserRuntime';
import { __kokoroBrowserRuntimeTestOnly } from '../services/kokoroBrowserRuntime.impl';

let generateMock: ReturnType<typeof vi.fn>;
let generateFromIdsMock: ReturnType<typeof vi.fn>;
let tokenizerMock: ReturnType<typeof vi.fn>;

const toFetchUrl = (input: unknown): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  if (input && typeof input === 'object' && 'url' in (input as Record<string, unknown>)) {
    return String((input as { url?: unknown }).url || '');
  }
  return String(input || '');
};

describe('kokoroBrowserRuntime', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    generateMock = vi.fn(async (_text: string, options?: { voice?: string; speed?: number }) => ({
      audio: new Float32Array([0.1, -0.1, 0.08]),
      options,
    }));
    generateFromIdsMock = vi.fn(async (_inputIds: unknown, options?: { voice?: string; speed?: number }) => ({
      audio: new Float32Array([0.1, -0.1, 0.08]),
      options,
    }));
    tokenizerMock = Object.assign(
      vi.fn(async () => ({
        input_ids: { dims: [1, 8] },
      })),
      { dispose: vi.fn() },
    );
    vi.stubGlobal('window', { isSecureContext: true } as any);
    vi.stubGlobal('navigator', { gpu: {}, deviceMemory: 12, hardwareConcurrency: 8 } as any);
    const cacheStores = new Map<string, Map<string, Response>>();
    vi.stubGlobal(
      'caches',
      {
        open: vi.fn(async (cacheName: string) => {
          const normalizedName = String(cacheName || '');
          const existing = cacheStores.get(normalizedName);
          const store = existing || new Map<string, Response>();
          if (!existing) {
            cacheStores.set(normalizedName, store);
          }
          return {
            match: vi.fn(async (request: unknown) => {
              const key = toFetchUrl(request);
              const cached = store.get(key);
              return cached ? cached.clone() : undefined;
            }),
            put: vi.fn(async (request: unknown, response: Response) => {
              const key = toFetchUrl(request);
              store.set(key, response.clone());
            }),
          };
        }),
      } as any,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => (
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        })
      )) as any,
    );
    fromPretrainedMock.mockResolvedValue({
      voices: {
        af_heart: {},
        af_bella: {},
        af_nova: {},
        af_sarah: {},
        am_fenrir: {},
        am_michael: {},
        bf_emma: {},
        bf_isabella: {},
        hf_alpha: {},
        hf_beta: {},
        hm_omega: {},
        hm_psi: {},
      },
      generate: generateMock,
      generate_from_ids: generateFromIdsMock,
      model: { dispose: vi.fn(async () => []) },
      tokenizer: tokenizerMock,
      stream: async function* () {
        // noop
      },
    });
    await __kokoroBrowserRuntimeTestOnly.reset();
  });

  it('enables browser kokoro for supported Kokoro sessions by default', () => {
    expect(isBrowserKokoroExecutionEnabled()).toBe(true);
    expect(shouldUseBrowserKokoroExecution('KOKORO', 'studio')).toBe(true);
    expect(shouldUseBrowserKokoroExecution('KOKORO', 'preview')).toBe(true);
    expect(shouldUseBrowserKokoroExecution('KOKORO', 'dubbing')).toBe(true);
    expect(shouldUseBrowserKokoroExecution('GEM', 'studio')).toBe(false);
  });

  it('supports an env opt-out for browser kokoro execution', () => {
    vi.stubEnv('VITE_ENABLE_BROWSER_KOKORO', 'false');
    expect(isBrowserKokoroExecutionEnabled()).toBe(false);
    expect(shouldUseBrowserKokoroExecution('KOKORO', 'studio')).toBe(false);
  });

  it('keeps browser kokoro disabled when WebGPU is unavailable', () => {
    vi.stubGlobal('navigator', { deviceMemory: 4, hardwareConcurrency: 4 } as any);
    expect(isBrowserKokoroExecutionEnabled()).toBe(false);
    expect(shouldUseBrowserKokoroExecution('KOKORO', 'studio')).toBe(false);
  });

  it('transitions to ready and then suspended', async () => {
    let resolveModel: ((value: any) => void) | null = null;
    fromPretrainedMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveModel = resolve;
    }));

    const pending = kokoroBrowserRuntime.ensureReady({ backendBaseUrl: 'http://127.0.0.1:7800' });
    await Promise.resolve();

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

  it('checks local model assets and primes voice files', async () => {
    const status = await kokoroBrowserRuntime.primeAssets('http://127.0.0.1:7801');
    expect(status.ready).toBe(true);
    expect(status.runtime?.device).toBe('webgpu');
    const fetchCalls = (globalThis.fetch as any).mock.calls.map((call: any[]) => toFetchUrl(call?.[0]));
    expect(fetchCalls.length).toBeGreaterThan(0);
    expect(fetchCalls.some((entry: string) => entry.includes('/config.json'))).toBe(true);
    expect(fetchCalls.some((entry: string) => entry.includes('/voices/af_heart.bin'))).toBe(true);
  });

  it('reuses model and voice warmup when ensureReady follows primeAssets', async () => {
    await kokoroBrowserRuntime.primeAssets('http://127.0.0.1:7802', 'af_heart');
    await kokoroBrowserRuntime.ensureReady({ backendBaseUrl: 'http://127.0.0.1:7802', voiceId: 'af_heart' });

    const fetchCalls = (globalThis.fetch as any).mock.calls.map((call: any[]) => toFetchUrl(call?.[0]));
    const configCalls = fetchCalls.filter((entry: string) => entry.includes('/config.json'));
    const tokenizerCalls = fetchCalls.filter((entry: string) => entry.includes('/tokenizer.json'));
    const tokenizerConfigCalls = fetchCalls.filter((entry: string) => entry.includes('/tokenizer_config.json'));
    const modelCalls = fetchCalls.filter((entry: string) => entry.includes('/onnx/model_quantized.onnx'));
    const voiceCalls = fetchCalls.filter((entry: string) => entry.includes('/voices/af_heart.bin'));

    expect(configCalls).toHaveLength(1);
    expect(tokenizerCalls).toHaveLength(1);
    expect(tokenizerConfigCalls).toHaveLength(1);
    expect(modelCalls).toHaveLength(1);
    expect(voiceCalls).toHaveLength(1);
  });

  it('loads kokoro in strict webgpu q8 mode', async () => {
    await kokoroBrowserRuntime.ensureReady({ backendBaseUrl: 'http://127.0.0.1:7800' });
    expect(fromPretrainedMock).toHaveBeenCalledWith(
      'onnx-community/Kokoro-82M-v1.0-ONNX',
      expect.objectContaining({
        dtype: 'q8',
        device: 'webgpu',
      }),
    );
  });

  it('maps Hindi requests to distinct Hindi-compatible voices instead of one shared fallback', async () => {
    await kokoroBrowserRuntime.synthesizeLive({
      backendBaseUrl: 'http://127.0.0.1:7800',
      text: 'kya tum theek ho aaj?',
      voiceId: 'af_bella',
      language: 'hi',
      speed: 1.0,
    });

    expect(generateFromIdsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        voice: 'hf_beta',
        speed: 1,
      }),
    );
  });

  it('maps English requests away from Hindi voices to a stable English-compatible voice', async () => {
    await kokoroBrowserRuntime.synthesizeLive({
      backendBaseUrl: 'http://127.0.0.1:7800',
      text: 'The market opens at sunrise.',
      voiceId: 'hm_psi',
      language: 'en',
      speed: 1.0,
    });

    expect(generateMock).toHaveBeenCalledWith(
      'The market opens at sunrise.',
      expect.objectContaining({
        voice: 'am_michael',
        speed: 1,
      }),
    );
  });

  it('transliterates Devanagari Hindi before tokenizing the Kokoro Hindi path', async () => {
    await kokoroBrowserRuntime.synthesizeLive({
      backendBaseUrl: 'http://127.0.0.1:7800',
      text: 'नमस्ते, यह आवाज २ है।',
      voiceId: 'hf_alpha',
      language: 'hi',
      speed: 1.0,
    });

    expect(tokenizerMock).toHaveBeenCalledWith(
      'namaste, yaha aavaaja do hai.',
      expect.objectContaining({ truncation: true }),
    );
  });
});
