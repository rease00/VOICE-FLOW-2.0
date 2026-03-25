import { describe, expect, it } from 'vitest';
import {
  resolveSequentialLiveChunkIndexes,
  shouldHoldLiveElapsedBetweenChunks,
  shouldShowElapsedOnlyLiveTimeline,
} from '../components/audioPlayerLiveHelpers';

describe('AudioPlayer live behavior helpers', () => {
  it('holds elapsed time while live generation is still active between chunks', () => {
    expect(shouldHoldLiveElapsedBetweenChunks({
      isGenerating: true,
      isLiveStreaming: true,
      hasFinalAudio: false,
    })).toBe(true);

    expect(shouldHoldLiveElapsedBetweenChunks({
      isGenerating: false,
      isLiveStreaming: true,
      hasFinalAudio: false,
    })).toBe(true);

    expect(shouldHoldLiveElapsedBetweenChunks({
      isGenerating: false,
      isLiveStreaming: false,
      hasFinalAudio: false,
    })).toBe(false);

    expect(shouldHoldLiveElapsedBetweenChunks({
      isGenerating: true,
      isLiveStreaming: true,
      hasFinalAudio: true,
    })).toBe(false);
  });

  it('dequeues live chunks in strict contiguous index order', () => {
    const firstDrain = resolveSequentialLiveChunkIndexes({
      pendingIndexes: [2, 0, 4, 1],
      nextIndex: 0,
    });
    expect(firstDrain.readyIndexes).toEqual([0, 1, 2]);
    expect(firstDrain.nextIndex).toBe(3);

    const secondDrain = resolveSequentialLiveChunkIndexes({
      pendingIndexes: [5, 3, 4, 9],
      nextIndex: firstDrain.nextIndex,
    });
    expect(secondDrain.readyIndexes).toEqual([3, 4, 5]);
    expect(secondDrain.nextIndex).toBe(6);
  });

  it('shows elapsed-only timeline in live mode and restores full timeline for final playback', () => {
    expect(shouldShowElapsedOnlyLiveTimeline({
      isLiveMode: true,
      activeSourceType: 'live',
      audioUrl: null,
    })).toBe(true);

    expect(shouldShowElapsedOnlyLiveTimeline({
      isLiveMode: true,
      activeSourceType: 'live',
      audioUrl: 'https://example.com/final.wav',
    })).toBe(true);

    expect(shouldShowElapsedOnlyLiveTimeline({
      isLiveMode: true,
      activeSourceType: 'final',
      audioUrl: 'https://example.com/final.wav',
    })).toBe(false);
  });
});
