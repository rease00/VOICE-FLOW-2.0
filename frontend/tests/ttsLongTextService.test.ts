import { describe, expect, it } from 'vitest';
import {
  buildLongTextChunks,
  buildSentenceAlignedCharWindows,
  buildSentenceAlignedWordWindows,
  getChunkProfile,
  resolveLiveChunkRequest,
} from '../services/ttsLongTextService';

const buildSentence = (count: number, prefix: string): string =>
  `${Array.from({ length: count }, (_, index) => `${prefix}${String(index).padStart(2, '0')}`).join(' ')}.`;

describe('ttsLongTextService', () => {
  it('keeps a slightly oversized GEM sentence intact instead of splitting mid-sentence', () => {
    const profile = getChunkProfile('GEM', 'en');
    const sentence = buildSentence(32, 'segment');

    expect(sentence.length).toBeGreaterThan(profile.targetCharCap);
    expect(sentence.length).toBeLessThanOrEqual(profile.hardCharCap);

    const chunks = buildLongTextChunks({
      engine: 'GEM',
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

  it('never slices a long single word in the middle', () => {
    const longWord = 'supercalifragilisticexpialidocious'.repeat(8);
    const chunks = buildLongTextChunks({
      engine: 'KOKORO',
      language: 'en',
      text: longWord,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe(longWord);
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
    expect(resolveLiveChunkRequest('GEM', 'en')).toEqual({
      liveChunkChars: 150,
      liveChunkWords: 26,
    });
    expect(resolveLiveChunkRequest('GEM', 'en').liveChunkChars).toBeGreaterThanOrEqual(100);
    expect(resolveLiveChunkRequest('GEM', 'en').liveChunkChars).toBeLessThanOrEqual(150);
    expect(resolveLiveChunkRequest('GEM', 'en').liveChunkWords).toBeGreaterThanOrEqual(16);
    expect(resolveLiveChunkRequest('GEM', 'en').liveChunkWords).toBeLessThanOrEqual(26);
  });
});
