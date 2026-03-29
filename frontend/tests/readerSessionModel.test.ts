import { describe, expect, it } from 'vitest';
import {
  getReaderDeleteCountdownLabel,
  resolveReaderBillingDisplay,
  shouldRunReaderBackgroundPolling,
  shouldTriggerReaderPanelPrefetch,
  shouldTriggerReaderWindowPrefetch,
} from '../src/features/reader/model/session';

describe('reader session model', () => {
  it('reads billing text from the backend session payload and preserves prefetch gates', () => {
    expect(resolveReaderBillingDisplay({
      billing: {
        vfPerChar: 2,
        rule: '2 chars = 1 VF',
        label: 'Reader billing synced from backend',
      },
    } as never)).toEqual({
      vfPerChar: 2,
      rule: '2 chars = 1 VF',
      label: 'Reader billing synced from backend',
    });
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
