import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationSettings } from '../types';

const authFetchMock = vi.hoisted(() => vi.fn());
const createTtsJobMock = vi.hoisted(() => vi.fn());
const decodeAudioDataMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());
const googleGenAIConstructorMock = vi.hoisted(() => vi.fn(() => ({
  models: {
    generateContent: vi.fn(),
  },
})));

vi.mock('@google/genai', () => ({
  GoogleGenAI: googleGenAIConstructorMock,
  Modality: { AUDIO: 'AUDIO' },
}));

vi.mock('../services/authHttpClient', () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
}));

vi.mock('../src/shared/api/gatewayClient', () => ({
  createTtsJob: (...args: unknown[]) => createTtsJobMock(...args),
  extractAudioFromVideo: vi.fn(),
}));

vi.mock('../services/ttsGatewayJobService', () => ({
  pollTtsGatewayJobForAudio: vi.fn(),
}));

const baseSettings: GenerationSettings = {
  voiceId: 'v1',
  speed: 1,
  pitch: 'Medium',
  language: 'English',
  engine: 'PRIME',
  helperProvider: 'GEMINI',
  mediaBackendUrl: 'http://127.0.0.1:7800',
  multiSpeakerEnabled: false,
  emotion: 'Neutral',
};

const createTestAudioBuffer = (length = 240, sampleRate = 24000): AudioBuffer => {
  const channels = [new Float32Array(length)];
  channels[0]?.fill(0.1);
  return {
    numberOfChannels: 1,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (channel: number) => channels[channel] || new Float32Array(length),
    copyToChannel: (source: Float32Array, channel: number, offset = 0) => {
      channels[channel]?.set(source, offset);
    },
  } as unknown as AudioBuffer;
};

describe('generateSpeech public engine routing', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    class TestAudioContext {
      state = 'running';

      decodeAudioData(...args: unknown[]) {
        return decodeAudioDataMock(...args);
      }

      createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
        const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
        return {
          numberOfChannels,
          length,
          sampleRate,
          duration: length / sampleRate,
          getChannelData: (channel: number) => channels[channel] || new Float32Array(length),
          copyToChannel: (source: Float32Array, channel: number, offset = 0) => {
            channels[channel]?.set(source, offset);
          },
        } as unknown as AudioBuffer;
      }

      resume() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('window', {
      AudioContext: TestAudioContext,
      webkitAudioContext: TestAudioContext,
      dispatchEvent: vi.fn(() => true),
    } as unknown as Window);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://example.com/reference.wav') {
        return new Response(new Uint8Array(256), {
          status: 200,
          headers: { 'content-type': 'audio/wav' },
        });
      }
      return new Response(new Uint8Array(256), {
        status: 200,
        headers: { 'content-type': 'audio/wav' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    decodeAudioDataMock.mockResolvedValue(createTestAudioBuffer());
    createTtsJobMock.mockResolvedValue({
      id: 'job-1',
      jobId: 'job-1',
      status: 'completed',
      traceId: 'trace-1',
      result: {
        audioBase64: Buffer.from(new Uint8Array(256)).toString('base64'),
        headers: {
          'content-type': 'audio/wav',
          'x-vf-post-tts-profile': 'prime',
        },
      },
    });
    authFetchMock.mockResolvedValue(new Response(JSON.stringify({
      audioBase64: Buffer.from(new Uint8Array(128)).toString('base64'),
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['PRIME', 'PRIME'],
    ['VECTOR', 'VECTOR'],
  ] as const)('routes %s through the gateway job flow', async (engine, expectedEngine) => {
    const { generateSpeech } = await import('../services/geminiService');

    const result = await generateSpeech(
      'Studio launch validation for shared queue routing.',
      'Fenrir',
      {
        ...baseSettings,
        engine,
      },
      'speech',
      undefined,
      {
        context: 'studio',
        requestId: `request-${engine.toLowerCase()}`,
      }
    );

    expect(result.sampleRate).toBe(24000);
    expect(createTtsJobMock).toHaveBeenCalledTimes(1);
    const [payload, options] = createTtsJobMock.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(payload).toEqual(expect.objectContaining({
      text: 'Studio launch validation for shared queue routing.',
      engine: expectedEngine,
    }));
    expect(String(payload.voice_id || payload.voiceName || '').toLowerCase()).toBe('fenrir');
    expect(options).toEqual(expect.objectContaining({ baseUrl: expect.any(String) }));
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1);
    expect(googleGenAIConstructorMock).not.toHaveBeenCalled();
  });

  it('preserves speaker VC routing by forcing segmented synthesis and invoking OpenVoice clone', async () => {
    const { generateSpeech } = await import('../services/geminiService');

    const baseBuffer = createTestAudioBuffer(240, 24000);
    const cloneBuffer = createTestAudioBuffer(320, 24000);
    const secondSegmentBuffer = createTestAudioBuffer(280, 24000);
    decodeAudioDataMock
      .mockResolvedValueOnce(baseBuffer)
      .mockResolvedValueOnce(cloneBuffer)
      .mockResolvedValueOnce(secondSegmentBuffer);

    const result = await generateSpeech(
      'Narrator: This line should use the clone.\nGuide: This line should stay native.',
      'Fenrir',
      {
        ...baseSettings,
        engine: 'PRIME',
        multiSpeakerEnabled: true,
      },
      'speech',
      undefined,
      {
        context: 'studio',
        requestId: 'request-clone',
        speakerVcReferenceMap: {
          Narrator: {
            referenceAudioUrl: 'https://example.com/reference.wav',
            sourceVoiceId: 'v1',
            sourceVoiceName: 'Narrator',
            sourceVoiceEngine: 'PRIME',
          },
        },
      }
    );

    expect(result.sampleRate).toBe(24000);
    expect(createTtsJobMock).toHaveBeenCalledTimes(2);
    createTtsJobMock.mock.calls.forEach(([payload]) => {
      expect(payload).toEqual(expect.objectContaining({
        engine: 'PRIME',
      }));
    });
    expect(authFetchMock).toHaveBeenCalledTimes(1);
    expect(authFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/voice-clone/openvoice'),
      expect.objectContaining({ method: 'POST' }),
      { requireAuth: true }
    );
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('https://example.com/reference.wav');
    expect(googleGenAIConstructorMock).not.toHaveBeenCalled();
  });
});
