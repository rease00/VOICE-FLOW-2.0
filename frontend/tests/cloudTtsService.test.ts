import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const streamingSynthesizeMock = vi.hoisted(() => vi.fn());
const synthesizeSpeechMock = vi.hoisted(() => vi.fn());

vi.mock('../src/server/googleCredentials', () => ({
  resolveCloudTtsApiEndpoint: () => 'texttospeech.googleapis.com',
  resolveCloudTtsCredentialPool: () => [{
    projectId: 'test-project',
    clientEmail: 'tts@example.com',
    privateKey: 'test-key',
    source: 'test',
  }],
}));

vi.mock('../src/server/tts/runtimePolicy', () => ({
  getModelPolicyForEngine: (engine: 'VECTOR' | 'PRIME') => ({
    primary: engine === 'PRIME' ? 'gemini-2.5-pro-tts' : 'gemini-2.5-flash-tts',
  }),
}));

vi.mock('@google-cloud/text-to-speech', () => ({
  TextToSpeechClient: vi.fn().mockImplementation(() => ({
    streamingSynthesize: (...args: unknown[]) => streamingSynthesizeMock(...args),
    synthesizeSpeech: (...args: unknown[]) => synthesizeSpeechMock(...args),
  })),
}));

describe('cloudTtsService bidi helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    synthesizeSpeechMock.mockResolvedValue([{
      audioContent: Buffer.alloc(256, 1),
    }]);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('builds byte-aware bidi input chunks without exceeding the configured cap', async () => {
    const { buildBidirectionalTextChunks } = await import('../services/cloudTtsService');
    const text = [
      'मोहन और उसका मोबाइल बहुत प्यारा था।',
      'वह हर वाक्य को स्क्रीन पर देखते हुए बोलता था।',
      'लेकिन बैटरी 1% पर आते ही कहानी बदल गई।',
    ].join(' ');

    const chunks = buildBidirectionalTextChunks(text, { maxBytesPerChunk: 90 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.byteCount <= 256)).toBe(true);
    expect(chunks.map((chunk) => chunk.text).join(' ')).toContain('मोहन');
  });

  it('aggregates bidi PCM output into a valid wav buffer', async () => {
    const { aggregateLinear16PcmToWav } = await import('../services/cloudTtsService');
    const wav = aggregateLinear16PcmToWav([
      Buffer.alloc(8, 1),
      Buffer.alloc(12, 2),
    ]);

    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.length).toBe(44 + 20);
  });

  it('streams bidi audio chunks and returns aggregate metadata', async () => {
    const { EventEmitter } = await import('node:events');
    streamingSynthesizeMock.mockImplementation(() => {
      const stream = new EventEmitter() as EventEmitter & {
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      stream.write = vi.fn();
      stream.end = vi.fn(() => {
        queueMicrotask(() => {
          stream.emit('data', { audioContent: Buffer.alloc(24, 9) });
          stream.emit('data', { audioContent: Buffer.alloc(12, 7) });
          stream.emit('end');
        });
      });
      return stream;
    });

    const { streamBidirectionalSynthesize } = await import('../services/cloudTtsService');
    const onChunk = vi.fn();
    const result = await streamBidirectionalSynthesize({
      text: 'Hello world. Another line.',
      voice: 'Kore',
      language: 'en-US',
      engine: 'VECTOR',
      inputChunks: [
        { index: 0, text: 'Hello world.', charCount: 12, byteCount: 12 },
        { index: 1, text: 'Another line.', charCount: 13, byteCount: 13 },
      ],
      onChunk,
    });

    expect(streamingSynthesizeMock).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(result.responseChunkCount).toBe(2);
    expect(result.totalBytes).toBe(36);
    expect(result.pcmChunks).toHaveLength(2);
    expect(result.wavChunks[0]?.subarray(0, 4).toString('ascii')).toBe('RIFF');
  });
});
