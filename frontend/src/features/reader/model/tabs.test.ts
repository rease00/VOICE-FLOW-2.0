import { describe, expect, it } from 'vitest';
import {
  coerceReaderTab,
  getReaderTabLabel,
  getReaderTabs,
  resolveImportedDefaultTab,
} from './tabs';

describe('reader tabs model', () => {
  const tabs = getReaderTabs({
    mode: 'novel',
    multiSpeakerEnabled: false,
    speakerCount: 1,
    translationSupported: false,
  });

  it('keeps the compact tab set focused on reading, settings, scripts, and saved audio', () => {
    expect(tabs).toEqual(['read', 'settings', 'scripts', 'saved']);
    expect(getReaderTabLabel('saved')).toBe('Saved Audio');
  });

  it('maps legacy reader tabs into the consolidated settings and scripts views', () => {
    expect(coerceReaderTab('voices', tabs, 'novel')).toBe('settings');
    expect(coerceReaderTab('cast', tabs, 'novel')).toBe('settings');
    expect(coerceReaderTab('text', tabs, 'novel')).toBe('scripts');
    expect(coerceReaderTab('translate', tabs, 'novel')).toBe('settings');
  });

  it('prefers scripts for imported low-confidence sessions', () => {
    expect(resolveImportedDefaultTab({
      mode: 'novel',
      imported: true,
      lowConfidence: true,
      availableTabs: tabs,
    })).toBe('scripts');
  });
});
