import { describe, expect, it } from 'vitest';
import { resolveHistoryVoiceLabel } from '../src/shared/voices/historyVoiceLabel.ts';

describe('resolveHistoryVoiceLabel', () => {
  it('prefers canonical public labels when a runtime voiceId is available', () => {
    expect(resolveHistoryVoiceLabel({ voiceName: 'Fenrir Prime', voiceId: 'Fenrir' })).toBe('Arjun India Male');
  });

  it('maps runtime tokens to public labels', () => {
    expect(resolveHistoryVoiceLabel({ voiceName: 'Fenrir', voiceId: 'Fenrir' })).toBe('Arjun India Male');
    expect(resolveHistoryVoiceLabel({ voiceName: 'Kore', voiceId: 'Kore' })).toBe('Meera India Female');
    expect(resolveHistoryVoiceLabel({ voiceName: 'Achird', voiceId: 'Achird' })).toBe('Adi India Boy');
    expect(resolveHistoryVoiceLabel({ voiceName: 'am_fenrir' })).toBe('Rian US');
  });

  it('resolves legacy AI Voice labels from voiceId when possible', () => {
    expect(resolveHistoryVoiceLabel({ voiceName: 'AI Voice', voiceId: 'af_heart' })).toBe('Lyra US');
  });

  it('falls back to canonical voiceId when no mapped label exists', () => {
    expect(resolveHistoryVoiceLabel({ voiceName: '', voiceId: 'Fenrir' })).toBe('Arjun India Male');
    expect(resolveHistoryVoiceLabel({ voiceName: '', voiceId: 'fenrir' })).toBe('Arjun India Male');
  });

  it('returns the raw voiceName when no mapped label exists and no voiceId resolves', () => {
    expect(resolveHistoryVoiceLabel({ voiceName: 'Narrator Prime' })).toBe('Narrator Prime');
  });

  it('returns the raw voiceId when only an unmapped technical token is present', () => {
    expect(resolveHistoryVoiceLabel({ voiceName: '', voiceId: 'custom_voice_token' })).toBe('custom_voice_token');
  });

  it('returns Unknown voice when both fields are empty', () => {
    expect(resolveHistoryVoiceLabel({})).toBe('Unknown voice');
  });
});

