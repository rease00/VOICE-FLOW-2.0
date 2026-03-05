import { describe, expect, it } from 'vitest';
import { shouldAutoplayFirstLiveChunk } from '../components/AudioPlayer';

describe('shouldAutoplayFirstLiveChunk', () => {
  it('returns true only when first live chunk is waiting and autoplay is enabled', () => {
    expect(shouldAutoplayFirstLiveChunk({
      autoPlayOnFirstChunk: true,
      activeSourceType: 'none',
      isPlaying: false,
      liveQueueSize: 1,
    })).toBe(true);
  });

  it('returns false when autoplay is disabled', () => {
    expect(shouldAutoplayFirstLiveChunk({
      autoPlayOnFirstChunk: false,
      activeSourceType: 'none',
      isPlaying: false,
      liveQueueSize: 2,
    })).toBe(false);
  });

  it('returns false after playback source is already active', () => {
    expect(shouldAutoplayFirstLiveChunk({
      autoPlayOnFirstChunk: true,
      activeSourceType: 'live',
      isPlaying: false,
      liveQueueSize: 3,
    })).toBe(false);
  });
});
