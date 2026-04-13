import { describe, expect, it } from 'vitest';

import { buildReaderModernizePrompt, DEFAULT_TRANSLATION_MODEL } from '../src/server/vertexTextService';

describe('reader modernize prompt', () => {
  it('uses the low-cost flash-lite model default', () => {
    expect(DEFAULT_TRANSLATION_MODEL).toContain('flash-lite');
  });

  it('locks in the contemporary audiobook rewrite policy without injecting slang', () => {
    const prompt = buildReaderModernizePrompt({
      text: 'The gentleman spoke in formal prose.',
      targetLanguage: 'Hindi',
    });

    expect(prompt).toContain('contemporary Hindi');
    expect(prompt).toContain('Preserve names, plot facts, scene intent');
    expect(prompt).toContain('Keep slang only when the source already contains slang.');
    expect(prompt).toContain('Do not inject new slang into neutral or formal narration.');
    expect(prompt).toContain('<text>');
  });
});
