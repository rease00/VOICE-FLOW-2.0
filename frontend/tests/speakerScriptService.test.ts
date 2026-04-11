import { describe, expect, it } from 'vitest';
import { injectDirectorTagsPreservingFormat } from '../services/speakerScriptService';

describe('speakerScriptService injectDirectorTagsPreservingFormat', () => {
  it('does not let a title-like first line steal the fallback tag block for speaker lines', () => {
    const source = 'मोहन: चलो चलते हैं.';
    const directed = 'हिंदी मजेदार कहानी (Elderly Gentle): मोहन और उसका मोबाइल';

    const patched = injectDirectorTagsPreservingFormat(source, directed);

    expect(patched.text).toBe('[मोहन] (Neutral): चलो चलते हैं.');
    expect(patched.patchedLineCount).toBe(1);
  });
});
