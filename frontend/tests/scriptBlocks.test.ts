import { describe, expect, it } from 'vitest';
import { parseScriptToBlocks, serializeBlocksToScript } from '../services/scriptBlocks';

describe('serializeBlocksToScript', () => {
  it('keeps dialogue lines with text', () => {
    const blocks = parseScriptToBlocks('Narrator (Neutral): Hello there');
    expect(serializeBlocksToScript(blocks)).toBe('Narrator (Neutral): Hello there');
  });

  it('drops empty dialogue header lines', () => {
    const blocks = parseScriptToBlocks('Narrator (Neutral): Hello there\nNarrator (Neutral):');
    expect(serializeBlocksToScript(blocks)).toBe('Narrator (Neutral): Hello there');
  });
});
