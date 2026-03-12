import { describe, expect, it } from 'vitest';
import { resolveHistoryVoiceLabel } from '../src/shared/voices/historyVoiceLabel';

describe('resolveHistoryVoiceLabel', () => {
  it('prefers backend-provided human voiceName when available', () => {
    expect(resolveHistoryVoiceLabel({ voiceName: 'Fenrir Prime', voiceId: 'Fenrir' })).toBe('Fenrir Prime');
  });

  it('resolves legacy AI Voice labels from voiceId when possible', () => {
    expect(resolveHistoryVoiceLabel({ voiceName: 'AI Voice', voiceId: 'af_heart' })).toBe('Lyra US');
  });

  it('falls back to canonical voiceId when no mapped label exists', () => {
    expect(resolveHistoryVoiceLabel({ voiceName: '', voiceId: 'Fenrir' })).toBe('Arjun India Male');
    expect(resolveHistoryVoiceLabel({ voiceName: '', voiceId: 'fenrir' })).toBe('Arjun India Male');
    expect(resolveHistoryVoiceLabel({ voiceName: '', voiceId: 'custom_voice_token' })).toBe('custom_voice_token');
  });

  it('returns Unknown voice when both fields are empty', () => {
    expect(resolveHistoryVoiceLabel({})).toBe('Unknown voice');
  });
});

