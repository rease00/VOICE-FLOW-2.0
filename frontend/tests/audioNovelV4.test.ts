import { describe, expect, it } from 'vitest';

import { compressToRuns } from '../src/server/audioNovel/compress';
import { parseDialogue, sanitizeText, splitLongLine, validateEmotion } from '../src/server/audioNovel/input';

describe('audio novel v4 primitives', () => {
  it('sanitizes markup and parses fallback dialogue levels', () => {
    const input = sanitizeText('<b>[hero|ANGRY]: Hello</b>\nNarrator: Calm line\nPlain paragraph.');
    const parsed = parseDialogue(input);

    expect(parsed).toEqual([
      { speaker: 'Hero', emotion: 'angry', text: 'Hello', index: 0 },
      { speaker: 'Narrator', emotion: 'narration', text: 'Calm line', index: 1 },
      { speaker: 'Narrator', emotion: 'narration', text: 'Plain paragraph.', index: 2 },
    ]);
  });

  it('splits long lines and falls back unknown emotions to narration', () => {
    const chunks = splitLongLine('One. Two. Three.', 6);
    expect(chunks.length).toBeGreaterThan(1);
    expect(validateEmotion('mystery')).toBe('narration');
  });

  it('compresses same-speaker runs while preserving voice resolution input', () => {
    const lines = parseDialogue('[Hero|happy]: Hi\n[Hero|happy]: Again\n[Villain]: No');
    const runs = compressToRuns(lines, (speaker) => `${speaker}-voice`);

    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      speaker: 'Hero',
      emotion: 'happy',
      voice: 'Hero-voice',
      firstLine: 0,
      lastLine: 1,
    });
    expect(runs[0]?.rawLines).toEqual(['Hi', 'Again']);
    expect(runs[1]?.speaker).toBe('Villain');
  });
});
