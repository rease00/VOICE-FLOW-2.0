import { describe, expect, it } from 'vitest';
import {
  getReaderDeleteCountdownLabel,
  READER_BILLING_RULE,
  shouldTriggerReaderPanelPrefetch,
  shouldTriggerReaderWindowPrefetch,
} from '../src/features/reader/model/session';

describe('reader session model', () => {
  it('uses the visible billing rule text', () => {
    expect(READER_BILLING_RULE).toBe('1 char = 1.5 VF');
  });

  it('triggers the next text window when 500 chars remain', () => {
    expect(shouldTriggerReaderWindowPrefetch({ consumedChars: 500, scheduledWindowEndChar: 1000 })).toBe(true);
    expect(shouldTriggerReaderWindowPrefetch({ consumedChars: 499, scheduledWindowEndChar: 1000 })).toBe(false);
  });

  it('triggers the next panel batch at panel five within a ten-panel batch', () => {
    expect(shouldTriggerReaderPanelPrefetch({ currentPanelIndex: 5, scheduledPanelCount: 10 })).toBe(true);
    expect(shouldTriggerReaderPanelPrefetch({ currentPanelIndex: 4, scheduledPanelCount: 10 })).toBe(false);
  });

  it('formats the delete countdown as mm:ss', () => {
    expect(getReaderDeleteCountdownLabel(180000, 0)).toBe('03:00');
    expect(getReaderDeleteCountdownLabel(61000, 0)).toBe('01:01');
  });
});
