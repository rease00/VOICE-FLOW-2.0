import { describe, expect, it } from 'vitest';
import {
  READER_BILLING_RULE,
  getReaderDeleteCountdownLabel,
  shouldRunReaderBackgroundPolling,
  shouldTriggerReaderPanelPrefetch,
  shouldTriggerReaderWindowPrefetch,
} from '../src/features/reader/model/session';

describe('reader session model', () => {
  it('exposes billing text and prefetch gates', () => {
    expect(READER_BILLING_RULE).toBe('1 char = 1 VF');
    expect(shouldTriggerReaderWindowPrefetch({ consumedChars: 500, scheduledWindowEndChar: 1500 })).toBe(true);
    expect(shouldTriggerReaderWindowPrefetch({ consumedChars: 100, scheduledWindowEndChar: 1500 })).toBe(false);
    expect(shouldTriggerReaderPanelPrefetch({ currentPanelIndex: 5, scheduledPanelCount: 10 })).toBe(true);
    expect(shouldTriggerReaderPanelPrefetch({ currentPanelIndex: 4, scheduledPanelCount: 10 })).toBe(false);
  });

  it('formats countdown and visibility-gated polling', () => {
    expect(getReaderDeleteCountdownLabel(180000, 0)).toBe('03:00');
    expect(shouldRunReaderBackgroundPolling({ sessionId: 'reader_1', workspaceMode: 'playback', visibilityState: 'visible' })).toBe(true);
    expect(shouldRunReaderBackgroundPolling({ sessionId: 'reader_1', workspaceMode: 'playback', visibilityState: 'hidden' })).toBe(false);
  });
});
