import { describe, expect, it } from 'vitest';
import {
  formatReaderMultiSpeakerMode,
  getReaderEffectiveMultiSpeakerMode,
  resolveReaderDraftMultiSpeakerMode,
} from '../src/features/reader/model/multiSpeaker';

describe('reader multi-speaker model', () => {
  it('uses single mode when multi-speaker is off', () => {
    expect(resolveReaderDraftMultiSpeakerMode({
      multiSpeakerEnabled: false,
      previewText: 'Narrator: Hello.',
      castMemory: { Narrator: 'v1' },
    })).toBe('single');
  });

  it('switches to grouped mode for multi-speaker scripts', () => {
    expect(resolveReaderDraftMultiSpeakerMode({
      multiSpeakerEnabled: true,
      previewText: 'Alice: Ready?\\nBob: Always.',
      castMemory: { Alice: 'v1', Bob: 'v2' },
    })).toBe('studio_pair_groups');
  });

  it('respects session fallback mode labels', () => {
    const mode = getReaderEffectiveMultiSpeakerMode(
      {
        multiSpeakerEnabled: true,
        effectiveMultiSpeakerMode: 'line_map',
      },
      {
        multiSpeakerEnabled: true,
        previewText: 'Alice: Ready?\\nBob: Always.',
        castMemory: { Alice: 'v1', Bob: 'v2' },
      }
    );
    expect(mode).toBe('line_map');
    expect(formatReaderMultiSpeakerMode(mode)).toBe('Reader line map');
  });
});
