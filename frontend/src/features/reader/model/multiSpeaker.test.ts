import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../services/geminiService', () => ({
  parseMultiSpeakerScript: (previewText: string) => ({
    speakersList: String(previewText || '').includes('Alice') && String(previewText || '').includes('Bob')
      ? ['Alice', 'Bob']
      : [],
  }),
}));

import {
  resolveReaderCastDraft,
  resolveReaderDraftMultiSpeakerMode,
} from './multiSpeaker';

describe('reader multi-speaker model', () => {
  it('fills missing speaker voices with the narrator fallback when multi-speaker is on', () => {
    const castDraft = resolveReaderCastDraft({
      castDraft: { Alice: 'voice-a' },
      detectedSpeakers: ['Alice', 'Bob'],
      narratorVoiceId: 'narrator-voice',
      multiSpeakerEnabled: true,
    });

    expect(castDraft).toEqual({
      Alice: 'voice-a',
      Bob: 'narrator-voice',
    });
  });

  it('keeps the draft compact when multi-speaker is off', () => {
    const castDraft = resolveReaderCastDraft({
      castDraft: { Alice: 'voice-a' },
      detectedSpeakers: ['Alice', 'Bob'],
      narratorVoiceId: 'narrator-voice',
      multiSpeakerEnabled: false,
    });

    expect(castDraft).toEqual({ Alice: 'voice-a' });
  });

  it('promotes speaker-rich previews into a multi-speaker mode', () => {
    expect(resolveReaderDraftMultiSpeakerMode({
      multiSpeakerEnabled: true,
      previewText: 'Alice: hello\nBob: world',
      castMemory: { Alice: 'voice-a' },
    })).toBe('studio_pair_groups');
  });
});
