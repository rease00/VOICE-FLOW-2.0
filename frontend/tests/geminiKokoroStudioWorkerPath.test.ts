import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  synthesizeKokoroStudioInWorkerMock,
  loadKokoroBrowserRuntimeModuleMock,
  emitGatewayProgressMock,
  emitGatewayAudioChunkMock,
  fakeAudioContext,
} = vi.hoisted(() => {
  const synthesizeMock = vi.fn();
  const loadRuntimeMock = vi.fn();
  const emitProgress = vi.fn();
  const emitChunk = vi.fn();

  const fakeContext = {
    createBuffer: vi.fn((_channels: number, length: number, sampleRate: number) => {
      const data = new Float32Array(length);
      const channels = [data];
      return {
        sampleRate,
        length,
        numberOfChannels: 1,
        _data: data,
        copyToChannel: (source: Float32Array) => {
          data.set(source.slice(0, length));
        },
        getChannelData: (channelIndex: number) => channels[channelIndex] || channels[0] || new Float32Array(0),
      } as unknown as AudioBuffer;
    }),
  };

  return {
    synthesizeKokoroStudioInWorkerMock: synthesizeMock,
    loadKokoroBrowserRuntimeModuleMock: loadRuntimeMock,
    emitGatewayProgressMock: emitProgress,
    emitGatewayAudioChunkMock: emitChunk,
    fakeAudioContext: fakeContext,
  };
});

vi.mock('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {},
  Modality: {
    AUDIO: 'AUDIO',
  },
}));

vi.mock('../services/kokoroStudioWorkerClient', () => ({
  synthesizeKokoroStudioInWorker: (...args: unknown[]) => synthesizeKokoroStudioInWorkerMock(...args),
}));

vi.mock('../services/loadKokoroBrowserRuntime', () => ({
  loadKokoroBrowserRuntimeModule: (...args: unknown[]) => loadKokoroBrowserRuntimeModuleMock(...args),
}));

vi.mock('../services/ttsGatewayJobService', () => ({
  emitGatewayAudioChunk: (...args: unknown[]) => emitGatewayAudioChunkMock(...args),
  emitGatewayProgress: (...args: unknown[]) => emitGatewayProgressMock(...args),
  extractGatewayJobId: vi.fn(),
  pollTtsGatewayJobForAudio: vi.fn(),
  TTS_GATEWAY_AUDIO_CHUNK_EVENT: 'voiceflow:tts-gateway-audio-chunk',
  TTS_GATEWAY_JOB_PROGRESS_EVENT: 'voiceflow:tts-gateway-job-progress',
}));

vi.mock('../src/shared/audio/audioContext', () => ({
  getSharedAudioContext: () => fakeAudioContext,
}));

describe('generateSpeech studio kokoro worker path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('btoa', (value: string) => Buffer.from(value, 'binary').toString('base64'));
    vi.stubGlobal('atob', (value: string) => Buffer.from(value, 'base64').toString('binary'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses worker-backed Studio path, emits live events, and avoids main-thread runtime loader', async () => {
    synthesizeKokoroStudioInWorkerMock.mockImplementation(async (_payload: unknown, options: any) => {
      options?.onProgress?.({
        progressPct: 46,
        stage: 'Streaming Kokoro WebGPU audio...',
        threadBudget: 2,
      });
      options?.onChunk?.({
        index: 0,
        text: 'Hello world',
        durationMs: 420,
        sampleRate: 24000,
        contentType: 'audio/wav',
        audioBase64: 'UklGRgABAABXQVZFZm10IA==',
      });
      return {
        sampleRate: 24000,
        mergedAudio: new Float32Array([0.2, -0.2, 0.1, 0.05]),
        threadBudget: 2,
      };
    });

    const { generateSpeech } = await import('../services/geminiService');
    const settings = {
      voiceId: 'af_heart',
      speed: 1,
      pitch: 'Medium',
      language: 'en',
      engine: 'KOKORO',
      helperProvider: 'GEMINI',
      mediaBackendUrl: 'http://127.0.0.1:7800',
    } as any;

    const result = await generateSpeech(
      'Hello world',
      'af_heart',
      settings,
      'speech',
      undefined,
      { context: 'studio', preferLiveChunks: true, preferBrowserKokoro: true },
    );

    expect(synthesizeKokoroStudioInWorkerMock).toHaveBeenCalledTimes(1);
    expect(loadKokoroBrowserRuntimeModuleMock).not.toHaveBeenCalled();
    expect(emitGatewayProgressMock).toHaveBeenCalled();
    expect(emitGatewayAudioChunkMock).toHaveBeenCalled();
    expect(emitGatewayAudioChunkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'audio/wav',
        audioBase64: 'UklGRgABAABXQVZFZm10IA==',
      }),
    );
    expect((result as any)._data).toBeInstanceOf(Float32Array);
    const received = Array.from((result as any)._data as Float32Array);
    const expected = [0.2, -0.2, 0.1, 0.05];
    expect(received).toHaveLength(expected.length);
    received.forEach((value, index) => {
      expect(value).toBeCloseTo(expected[index] || 0, 5);
    });
  });

  it('fails fast without backend fallback when browser kokoro execution is disabled', async () => {
    vi.stubEnv('VITE_ENABLE_BROWSER_KOKORO', 'false');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy as any);
    const { generateSpeech } = await import('../services/geminiService');
    const settings = {
      voiceId: 'af_heart',
      speed: 1,
      pitch: 'Medium',
      language: 'en',
      engine: 'KOKORO',
      helperProvider: 'GEMINI',
      mediaBackendUrl: 'http://127.0.0.1:7800',
      kokoroTtsServiceUrl: 'http://127.0.0.1:7820',
    } as any;

    await expect(
      generateSpeech(
        'Hello world',
        'af_heart',
        settings,
        'speech',
        undefined,
        { context: 'dubbing', preferLiveChunks: true, preferBrowserKokoro: true },
      ),
    ).rejects.toThrow(/requires WebGPU/i);

    expect(synthesizeKokoroStudioInWorkerMock).not.toHaveBeenCalled();
    expect(loadKokoroBrowserRuntimeModuleMock).not.toHaveBeenCalled();
    const attemptedKokoroBackendRoute = fetchSpy.mock.calls.some((call: any[]) =>
      String(call?.[0] || '').includes('/api/kokoro/synthesize'),
    );
    expect(attemptedKokoroBackendRoute).toBe(false);
  });
});
