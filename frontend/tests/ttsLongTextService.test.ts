import { describe, expect, it } from 'vitest';
import {
  buildLongTextChunks,
  buildSentenceAlignedCharWindows,
  buildSentenceAlignedWordWindows,
  getChunkProfile,
  isPrimaryTtsEngine,
  resolveLiveChunkRequest,
} from '../services/ttsLongTextService';

const buildSentence = (count: number, prefix: string): string =>
  `${Array.from({ length: count }, (_, index) => `${prefix}${String(index).padStart(2, '0')}`).join(' ')}.`;

describe('ttsLongTextService', () => {
  it('keeps a slightly oversized PRIME sentence intact instead of splitting mid-sentence', () => {
    const profile = getChunkProfile('PRIME', 'en');
    const sentence = buildSentence(250, 'segment');

    expect(sentence.length).toBeGreaterThan(profile.targetCharCap);
    expect(sentence.length).toBeLessThanOrEqual(profile.hardCharCap);

    const chunks = buildLongTextChunks({
      engine: 'PRIME',
      language: 'en',
      text: sentence,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe(sentence);
  });

  it('keeps a slightly oversized sentence window intact when it stays within overflow tolerance', () => {
    const sentence = buildSentence(55, 'window');
    const windows = buildSentenceAlignedWordWindows(sentence, 40);

    expect(windows).toHaveLength(1);
    expect(windows[0]?.text).toBe(sentence);
    expect(windows[0]?.wordCount).toBe(55);
  });

  it('uses a 400-word default cap when building sentence-aligned word windows', () => {
    const text = Array.from({ length: 850 }, (_, index) => `w${index}`).join(' ');
    const windows = buildSentenceAlignedWordWindows(text);

    expect(windows).toHaveLength(3);
    expect(windows.map((item) => item.wordCount)).toEqual([400, 400, 50]);
    expect(windows.every((item) => item.wordCount <= 400)).toBe(true);
  });

  it('never slices a long single word in the middle', () => {
    const longWord = 'supercalifragilisticexpialidocious'.repeat(8);
    const chunks = buildLongTextChunks({
      engine: 'DUNO',
      language: 'en',
      text: longWord,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe(longWord);
  });

  it('keeps DUNO on the primary chunking path', () => {
    expect(isPrimaryTtsEngine('DUNO')).toBe(true);
    expect(getChunkProfile('DUNO', 'en')).toMatchObject({
      hardCharCap: 180,
      targetCharCap: 140,
      maxWordsPerChunk: 32,
      joinCrossfadeMs: 12,
    });
    expect(getChunkProfile('DUNO', 'hi')).toMatchObject({
      hardCharCap: 200,
      targetCharCap: 150,
      maxWordsPerChunk: 34,
      joinCrossfadeMs: 24,
    });
  });

  it('builds sentence-aligned queue windows against a per-generation char cap', () => {
    const text = [
      'The first beat lands with a clean sentence.',
      'The second beat is slightly longer and still self contained.',
      'The third beat closes the scene without cutting through the middle.',
    ].join(' ');

    const windows = buildSentenceAlignedCharWindows(text, 90);

    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0]?.text.endsWith('.')).toBe(true);
    expect(windows[windows.length - 1]?.text.startsWith('The third beat')).toBe(true);
    expect(windows.every((item) => item.charCount <= 90)).toBe(true);
  });

  it('requests sentence-safe live chunk sizes in the 100-150 range', () => {
    expect(resolveLiveChunkRequest('PRIME', 'en')).toMatchObject({
      liveChunkChars: 130,
      liveChunkWords: 22,
    });
    expect(resolveLiveChunkRequest('PRIME', 'en').liveChunkChars).toBeGreaterThanOrEqual(100);
    expect(resolveLiveChunkRequest('PRIME', 'en').liveChunkChars).toBeLessThanOrEqual(130);
    expect(resolveLiveChunkRequest('PRIME', 'en').liveChunkWords).toBeGreaterThanOrEqual(16);
    expect(resolveLiveChunkRequest('PRIME', 'en').liveChunkWords).toBeLessThanOrEqual(22);
  });
});

