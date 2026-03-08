import { describe, expect, it } from 'vitest';
import {
  formatReaderMultiSpeakerMode,
  getReaderEffectiveMultiSpeakerMode,
  resolveReaderDraftMultiSpeakerMode,
} from '../src/features/reader/model/multiSpeaker';

describe('reader multi-speaker model', () => {
  it('uses single-speaker mode when the toggle is off', () => {
    expect(resolveReaderDraftMultiSpeakerMode({
      multiSpeakerEnabled: false,
      previewText: 'Narrator: Hello there.',
      castMemory: { Narrator: 'v22' },
    })).toBe('single');
  });

  it('uses studio grouped mode for qualified multi-speaker dialogue', () => {
    expect(resolveReaderDraftMultiSpeakerMode({
      multiSpeakerEnabled: true,
      previewText: 'Alice: Ready?\nBob: Always.\nAlice: Then move.',
      castMemory: { Alice: 'v21', Bob: 'v22' },
    })).toBe('studio_pair_groups');
  });

  it('returns reader line-map mode when the session reports grouped fallback', () => {
    const mode = getReaderEffectiveMultiSpeakerMode(
      {
        multiSpeakerEnabled: true,
        effectiveMultiSpeakerMode: 'line_map',
      },
      {
        multiSpeakerEnabled: true,
        previewText: 'Alice: Ready?\nBob: Always.',
        castMemory: { Alice: 'v21', Bob: 'v22' },
      }
    );
    expect(mode).toBe('line_map');
    expect(formatReaderMultiSpeakerMode(mode)).toBe('Reader line map');
  });
});
