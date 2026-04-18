import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetUniversalTtsRateLimitState } from '../src/server/tts/userRateLimit';

const parseDialogueMock = vi.hoisted(() => vi.fn());
const sanitizeTextMock = vi.hoisted(() => vi.fn((value: string) => value));
const validateInputMock = vi.hoisted(() => vi.fn(() => ({ ok: true })));
const compressToRunsMock = vi.hoisted(() => vi.fn());
const resolveVoiceMock = vi.hoisted(() => vi.fn(async () => 'Kore'));
const resolveVoiceSyncMock = vi.hoisted(() => vi.fn(() => 'Kore'));
const streamAudioNovelBidiMock = vi.hoisted(() => vi.fn());
const synthesizeAudioNovelRunMock = vi.hoisted(() => vi.fn());

vi.mock('../src/server/audioNovel/input.ts', () => ({
  parseDialogue: (...args: unknown[]) => parseDialogueMock(...args),
  sanitizeText: (...args: unknown[]) => sanitizeTextMock(...args),
  validateInput: (...args: unknown[]) => validateInputMock(...args),
}));

vi.mock('../src/server/audioNovel/compress.ts', () => ({
  compressToRuns: (...args: unknown[]) => compressToRunsMock(...args),
}));

vi.mock('../src/server/audioNovel/voice.ts', () => ({
  resolveVoice: (...args: unknown[]) => resolveVoiceMock(...args),
  resolveVoiceSync: (...args: unknown[]) => resolveVoiceSyncMock(...args),
}));

vi.mock('../src/server/audioNovel/synthesizer.ts', () => ({
  getAudioNovelSilenceBuffer: () => Buffer.alloc(480),
  streamAudioNovelBidi: (...args: unknown[]) => streamAudioNovelBidiMock(...args),
  synthesizeAudioNovelRun: (...args: unknown[]) => synthesizeAudioNovelRunMock(...args),
}));

describe('audio novel live streaming transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUniversalTtsRateLimitState();
    parseDialogueMock.mockReturnValue([
      { speaker: 'Narrator', emotion: 'narration', text: 'Hello world', index: 0 },
    ]);
    compressToRunsMock.mockReturnValue([
      {
        runIndex: 0,
        speaker: 'Narrator',
        voice: 'Kore',
        emotion: 'narration',
        mergedText: 'Hello world',
        rawLines: ['Hello world'],
        lineIndices: [0],
        firstLine: 0,
        lastLine: 0,
        charCount: 11,
      },
    ]);
    streamAudioNovelBidiMock.mockImplementation(async (_runs, onChunk) => {
      onChunk(Buffer.alloc(1024, 1));
      return { responseChunkCount: 1, totalBytes: 1024 };
    });
    synthesizeAudioNovelRunMock.mockResolvedValue(Buffer.alloc(1024, 2));
  });

  afterEach(() => {
    resetUniversalTtsRateLimitState();
    vi.resetModules();
  });

  it('uses bidi streaming for single-voice live playback', async () => {
    const sent: Array<Buffer | Record<string, unknown>> = [];
    const { streamAudioNovelLive } = await import('../src/server/audioNovel/service');

    await streamAudioNovelLive('user-bidi', 'Hello world', 'book-1', 'published', (payload) => {
      sent.push(payload);
    });

    expect(streamAudioNovelBidiMock).toHaveBeenCalledTimes(1);
    expect(synthesizeAudioNovelRunMock).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({
      status: 'start',
      totalRuns: 1,
      transport: 'bidi',
    });
    expect(sent.some((payload) => Buffer.isBuffer(payload))).toBe(true);
  });

  it('falls back to run-by-run synthesis for multi-voice playback', async () => {
    resolveVoiceMock.mockImplementation(async (speaker: string) => speaker === 'Hero' ? 'Fenrir' : 'Kore');
    compressToRunsMock.mockReturnValue([
      {
        runIndex: 0,
        speaker: 'Narrator',
        voice: 'Kore',
        emotion: 'narration',
        mergedText: 'Hello world',
        rawLines: ['Hello world'],
        lineIndices: [0],
        firstLine: 0,
        lastLine: 0,
        charCount: 11,
      },
      {
        runIndex: 1,
        speaker: 'Hero',
        voice: 'Fenrir',
        emotion: 'dramatic',
        mergedText: 'Another line',
        rawLines: ['Another line'],
        lineIndices: [1],
        firstLine: 1,
        lastLine: 1,
        charCount: 12,
      },
    ]);

    const sent: Array<Buffer | Record<string, unknown>> = [];
    const { streamAudioNovelLive } = await import('../src/server/audioNovel/service');

    await streamAudioNovelLive('user-run', 'Hello world\nAnother line', 'book-1', 'published', (payload) => {
      sent.push(payload);
    });

    expect(streamAudioNovelBidiMock).not.toHaveBeenCalled();
    expect(synthesizeAudioNovelRunMock).toHaveBeenCalledTimes(2);
    expect(sent[0]).toMatchObject({
      status: 'start',
      totalRuns: 2,
      transport: 'run',
    });
    expect(sent.some((payload) => !Buffer.isBuffer(payload) && (payload as { type?: string }).type === 'run-meta')).toBe(true);
  });

  it('skips published cast lookups for non-published reader books so live playback can start immediately', async () => {
    const sent: Array<Buffer | Record<string, unknown>> = [];
    const { streamAudioNovelLive } = await import('../src/server/audioNovel/service');

    await streamAudioNovelLive('user-public', 'Hello world', '84', 'gutenberg', (payload) => {
      sent.push(payload);
    });

    expect(resolveVoiceMock).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({
      status: 'start',
      transport: 'bidi',
    });
  });
});
