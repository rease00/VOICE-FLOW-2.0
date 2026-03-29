import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  authFetchMock,
  issueTtsV2SessionKeyMock,
  emitGatewayProgressMock,
  emitGatewayAudioChunkMock,
  fakeAudioContext,
  getSessionClonedVoicesMock,
} = vi.hoisted(() => {
  const authFetch = vi.fn();
  const issueTtsV2SessionKey = vi.fn();
  const emitGatewayProgress = vi.fn();
  const emitGatewayAudioChunk = vi.fn();
  const getSessionClonedVoices = vi.fn(() => []);
  const fakeContext = {
    decodeAudioData: vi.fn(async (bytes: ArrayBuffer) => ({
      sampleRate: 24000,
      length: bytes.byteLength,
      numberOfChannels: 1,
      _bytes: bytes,
      getChannelData: () => new Float32Array([0.2, -0.2, 0.1, 0.05]),
      copyToChannel: vi.fn(),
    })),
  };
  return {
    authFetchMock: authFetch,
    issueTtsV2SessionKeyMock: issueTtsV2SessionKey,
    emitGatewayProgressMock: emitGatewayProgress,
    emitGatewayAudioChunkMock: emitGatewayAudioChunk,
    fakeAudioContext: fakeContext,
    getSessionClonedVoicesMock: getSessionClonedVoices,
  };
});

const makeAudioResponse = (bytes: Uint8Array) => ({
  ok: true,
  status: 200,
  headers: new Headers({
    'content-type': 'audio/wav',
    'x-vf-trace-id': 'trace-123',
    'x-vf-post-tts-conversion': 'disabled_for_duno',
  }),
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  json: async () => ({}),
  text: async () => '',
});

vi.mock('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {},
  Modality: {
    AUDIO: 'AUDIO',
  },
}));

vi.mock('../services/authHttpClient', () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
}));

vi.mock('../src/shared/api/gatewayClient', () => ({
  cancelTtsJob: vi.fn(),
  extractAudioFromVideo: vi.fn(),
  issueTtsV2SessionKey: (...args: unknown[]) => issueTtsV2SessionKeyMock(...args),
}));

vi.mock('../services/clonedVoiceSessionStore', () => ({
  getSessionClonedVoices: () => getSessionClonedVoicesMock(),
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

describe('generateSpeech DUNO backend gateway path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('btoa', (value: string) => Buffer.from(value, 'binary').toString('base64'));
    vi.stubGlobal('atob', (value: string) => Buffer.from(value, 'base64').toString('binary'));
    issueTtsV2SessionKeyMock.mockResolvedValue('session-key');
    authFetchMock.mockImplementation(async () => makeAudioResponse(new Uint8Array(256).fill(1)) as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('routes DUNO generation through the backend TTS gateway', async () => {
    const { generateSpeech } = await import('../services/geminiService');
    const settings = {
      voiceId: 'af_heart',
      speed: 1,
      pitch: 'Medium',
      language: 'en',
      engine: 'DUNO',
      helperProvider: 'GEMINI',
      mediaBackendUrl: 'http://127.0.0.1:7800',
    } as any;

    const result = await generateSpeech(
      'Hello world',
      'af_heart',
      settings,
      'speech',
      undefined,
      { context: 'studio', preferLiveChunks: true },
    );

    expect(issueTtsV2SessionKeyMock).toHaveBeenCalledTimes(1);
    expect(authFetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = authFetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/tts/v2/jobs');
    expect(init.method).toBe('POST');
    const payload = JSON.parse(String(init.body || '{}'));
    expect(payload.engine).toBe('DUNO');
    expect(payload.post_tts_disable).toBe(true);
    expect(payload.stream).toBe(true);

    expect((result as any)._bytes).toBeInstanceOf(ArrayBuffer);
    expect((result as any).sampleRate).toBe(24000);
    expect(emitGatewayProgressMock).not.toHaveBeenCalled();
    expect(emitGatewayAudioChunkMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported engine tokens', async () => {
    const { generateSpeech } = await import('../services/geminiService');
    const settings = {
      voiceId: 'af_heart',
      speed: 1,
      pitch: 'Medium',
      language: 'en',
      engine: 'UNSUPPORTED_ENGINE',
      helperProvider: 'GEMINI',
      mediaBackendUrl: 'http://127.0.0.1:7800',
    } as any;

    await expect(generateSpeech(
      'Hello again',
      'af_heart',
      settings,
      'speech',
      undefined,
      { context: 'asyncJob', preferLiveChunks: true },
    )).rejects.toThrow(/Unsupported TTS engine/i);
    expect(issueTtsV2SessionKeyMock).not.toHaveBeenCalled();
    expect(authFetchMock).not.toHaveBeenCalled();
  });

  it('routes DUNO generation through the backend TTS gateway without OpenVoice fallback', async () => {
    getSessionClonedVoicesMock.mockReturnValue([
      {
        id: 'clone-one',
        name: 'Clone One',
        geminiVoiceName: 'Clone One',
        originalSampleUrl: 'https://example.test/original.wav',
        dateCreated: Date.now(),
        description: 'session clone',
        referenceAudioUrl: 'https://example.test/reference.wav',
        sourceVoiceId: 'af_heart',
        sourceVoiceName: 'af_heart',
        sourceVoiceEngine: 'DUNO',
      },
    ]);

    const { generateSpeech } = await import('../services/geminiService');
    const settings = {
      voiceId: 'clone-one',
      speed: 1,
      pitch: 'Medium',
      language: 'en',
      engine: 'DUNO',
      helperProvider: 'GEMINI',
      mediaBackendUrl: 'http://127.0.0.1:7800',
    } as any;

    const result = await generateSpeech(
      'Hello DUNO world',
      'Clone One',
      settings,
      'speech',
      undefined,
      { context: 'studio', preferLiveChunks: true },
    );

    expect(issueTtsV2SessionKeyMock).toHaveBeenCalledTimes(1);
    expect(authFetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = authFetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/tts/v2/jobs');
    expect(init.method).toBe('POST');
    const payload = JSON.parse(String(init.body || '{}'));
    expect(payload.engine).toBe('DUNO');
    expect(payload.post_tts_disable).toBe(true);
    expect(payload.stream).toBe(true);

    expect((result as any)._bytes).toBeInstanceOf(ArrayBuffer);
    expect((result as any).sampleRate).toBe(24000);
  });
});

