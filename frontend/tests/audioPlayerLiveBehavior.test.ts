import { describe, expect, it } from 'vitest';
import {
  advanceLivePlaybackState,
  appendLivePlaybackChunks,
  createLivePlaybackState,
  resetLivePlaybackState,
  resolveLivePlaybackSessionKey,
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

  it('promotes the first contiguous live chunk immediately and queues the next chunk for the same session', () => {
    const appended = appendLivePlaybackChunks(createLivePlaybackState(), [
      { index: 0, sessionKey: 'job-1:1', url: 'blob:first', revokeOnRelease: true },
      { index: 1, sessionKey: 'job-1:1', url: 'blob:second', revokeOnRelease: true },
    ]);

    expect(appended.revokedUrls).toEqual([]);
    expect(appended.state.currentEntry).toEqual({
      index: 0,
      url: 'blob:first',
      revokeOnRelease: true,
    });
    expect(appended.state.queuedEntries).toEqual([
      {
        index: 1,
        url: 'blob:second',
        revokeOnRelease: true,
      },
    ]);
    expect(appended.state.nextIndex).toBe(2);
  });

  it('resets a prior stream when a new session starts at chunk index zero', () => {
    const firstSession = appendLivePlaybackChunks(createLivePlaybackState(), [
      { index: 0, sessionKey: 'job-1:1', url: 'blob:old-0', revokeOnRelease: true },
      { index: 1, sessionKey: 'job-1:1', url: 'blob:old-1', revokeOnRelease: true },
    ]).state;

    const nextSession = appendLivePlaybackChunks(firstSession, [
      { index: 0, sessionKey: 'job-2:1', url: 'blob:new-0', revokeOnRelease: true },
    ]);

    expect(nextSession.revokedUrls).toEqual(['blob:old-0', 'blob:old-1']);
    expect(nextSession.state.currentEntry).toEqual({
      index: 0,
      url: 'blob:new-0',
      revokeOnRelease: true,
    });
    expect(nextSession.state.queuedEntries).toEqual([]);
    expect(nextSession.state.sessionKey).toBe('job-2:1');
    expect(nextSession.state.nextIndex).toBe(1);
  });

  it('revokes consumed and reset live URLs so repeated runs do not leak object URLs', () => {
    const appended = appendLivePlaybackChunks(createLivePlaybackState(), [
      { index: 0, sessionKey: 'job-9', url: 'blob:a', revokeOnRelease: true },
      { index: 1, sessionKey: 'job-9', url: 'blob:b', revokeOnRelease: true },
    ]);
    const advanced = advanceLivePlaybackState(appended.state);
    const reset = resetLivePlaybackState(advanced.state);

    expect(advanced.revokedUrls).toEqual(['blob:a']);
    expect(reset.revokedUrls).toEqual(['blob:b']);
  });

  it('builds a stable live session key from job id and session epoch', () => {
    expect(resolveLivePlaybackSessionKey({ jobId: 'job-3', sessionEpoch: 2 })).toBe('job-3:2');
    expect(resolveLivePlaybackSessionKey({ jobId: 'job-3', sessionEpoch: 0 })).toBe('job-3');
  });
});
