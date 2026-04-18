import { describe, expect, it } from 'vitest';
import { shouldAutoplayFirstLiveChunk, shouldAutoplayGeneratedAudio } from '../components/audioPlayerAutoplay';

describe('shouldAutoplayFirstLiveChunk', () => {
  it('returns true only when a fresh live chunk becomes the active source and autoplay is enabled', () => {
    expect(shouldAutoplayFirstLiveChunk({
      autoPlayOnFirstChunk: true,
      activeSourceType: 'live',
      currentLiveIndex: 0,
      isPlaying: false,
      lastAutoplayedLiveIndex: -1,
    })).toBe(true);
  });

  it('returns false when autoplay is disabled', () => {
    expect(shouldAutoplayFirstLiveChunk({
      autoPlayOnFirstChunk: false,
      activeSourceType: 'live',
      currentLiveIndex: 0,
      isPlaying: false,
      lastAutoplayedLiveIndex: -1,
    })).toBe(false);
  });

  it('returns false after the current live chunk was already auto-played once', () => {
    expect(shouldAutoplayFirstLiveChunk({
      autoPlayOnFirstChunk: true,
      activeSourceType: 'live',
      currentLiveIndex: 3,
      isPlaying: false,
      lastAutoplayedLiveIndex: 3,
    })).toBe(false);
  });
});

describe('shouldAutoplayGeneratedAudio', () => {
  it('returns true when a fresh final output is ready and autoplay is enabled', () => {
    expect(shouldAutoplayGeneratedAudio({
      autoPlayGeneratedAudio: true,
      activeSourceType: 'final',
      activeUrl: 'blob:latest',
      finalAudioUrl: 'blob:latest',
      autoplayNonce: 2,
      lastConsumedAutoplayNonce: 1,
    })).toBe(true);
  });

  it('returns false when the same autoplay nonce was already consumed', () => {
    expect(shouldAutoplayGeneratedAudio({
      autoPlayGeneratedAudio: true,
      activeSourceType: 'final',
      activeUrl: 'blob:latest',
      finalAudioUrl: 'blob:latest',
      autoplayNonce: 3,
      lastConsumedAutoplayNonce: 3,
    })).toBe(false);
  });

  it('returns false for non-final playback sources', () => {
    expect(shouldAutoplayGeneratedAudio({
      autoPlayGeneratedAudio: true,
      activeSourceType: 'live',
      activeUrl: 'blob:chunk-1',
      finalAudioUrl: 'blob:latest',
      autoplayNonce: 1,
      lastConsumedAutoplayNonce: 0,
    })).toBe(false);
  });
});
