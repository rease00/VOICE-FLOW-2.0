import { describe, expect, it } from 'vitest';
import {
  getReaderAudioSyncFallbackDelay,
  getReaderDeleteCountdownLabel,
  READER_BILLING_RULE,
  shouldRunReaderBackgroundPolling,
  shouldTriggerReaderPanelPrefetch,
  shouldTriggerReaderWindowPrefetch,
} from '../src/features/reader/model/session';

describe('reader session model', () => {
  it('uses the visible billing rule text', () => {
    expect(READER_BILLING_RULE).toBe('1 char = 1.5 VF');
  });

  it('triggers the next text window when 1000 chars remain in a 1500-char window', () => {
    expect(shouldTriggerReaderWindowPrefetch({ consumedChars: 500, scheduledWindowEndChar: 1500 })).toBe(true);
    expect(shouldTriggerReaderWindowPrefetch({ consumedChars: 499, scheduledWindowEndChar: 1500 })).toBe(false);
  });

  it('triggers the next panel batch at panel five within a ten-panel batch', () => {
    expect(shouldTriggerReaderPanelPrefetch({ currentPanelIndex: 5, scheduledPanelCount: 10 })).toBe(true);
    expect(shouldTriggerReaderPanelPrefetch({ currentPanelIndex: 4, scheduledPanelCount: 10 })).toBe(false);
  });

  it('formats the delete countdown as mm:ss', () => {
    expect(getReaderDeleteCountdownLabel(180000, 0)).toBe('03:00');
    expect(getReaderDeleteCountdownLabel(61000, 0)).toBe('01:01');
  });

  it('prefers emotion-aware pacing for audio-sync fallback delays', () => {
    expect(getReaderAudioSyncFallbackDelay({ emotionAwareReadMs: 4200, estimatedReadMs: 3600 })).toBe(4550);
    expect(getReaderAudioSyncFallbackDelay({ estimatedReadMs: 2800 })).toBe(3150);
    expect(getReaderAudioSyncFallbackDelay({})).toBe(5550);
  });

  it('suspends background reader polling when playback is hidden or inactive', () => {
    expect(shouldRunReaderBackgroundPolling({ sessionId: 'reader_1', workspaceMode: 'playback', visibilityState: 'visible' })).toBe(true);
    expect(shouldRunReaderBackgroundPolling({ sessionId: 'reader_1', workspaceMode: 'playback', visibilityState: 'hidden' })).toBe(false);
    expect(shouldRunReaderBackgroundPolling({ sessionId: 'reader_1', workspaceMode: 'browse', visibilityState: 'visible' })).toBe(false);
    expect(shouldRunReaderBackgroundPolling({ sessionId: '', workspaceMode: 'playback', visibilityState: 'visible' })).toBe(false);
  });
});
