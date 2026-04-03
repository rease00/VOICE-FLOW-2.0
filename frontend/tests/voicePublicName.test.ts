import { describe, expect, it } from 'vitest';

import { resolvePublicVoiceLabel } from '../src/shared/voices/voicePublicName';

describe('resolvePublicVoiceLabel', () => {
  it('restores the previously used public label for technical voice tokens', () => {
    expect(resolvePublicVoiceLabel('Fenrir', 'Fenrir', 'Arjun India Male')).toBe('Arjun India Male');
    expect(resolvePublicVoiceLabel('Kore', 'Kore', 'Meera India Female')).toBe('Meera India Female');
  });

  it('keeps existing public labels intact', () => {
    expect(resolvePublicVoiceLabel('Arjun India Male', 'Fenrir', 'v1')).toBe('Arjun India Male');
    expect(resolvePublicVoiceLabel('Meera India Female', 'Kore', 'v2')).toBe('Meera India Female');
  });
});
