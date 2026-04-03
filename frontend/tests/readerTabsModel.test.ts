import { describe, expect, it } from 'vitest';
import {
  coerceReaderHomeTab,
  coerceReaderTab,
  getReaderHomeTabLabel,
  getReaderTabs,
  READER_HOME_TABS,
  resolveImportedDefaultTab,
  shouldShowCastTab,
  shouldShowTranslateTab,
} from '../src/features/reader/model/tabs';

describe('reader tab model', () => {
  it('enforces tab ordering for novels and comics', () => {
    expect(getReaderTabs({
      mode: 'novel',
      multiSpeakerEnabled: true,
      speakerCount: 3,
      translationSupported: true,
      sourceLanguage: 'en',
      playbackLanguage: 'hi',
    })).toEqual(['read', 'settings', 'scripts', 'saved']);

    expect(getReaderTabs({
      mode: 'comic',
      multiSpeakerEnabled: true,
      speakerCount: 4,
      translationSupported: true,
      sourceLanguage: 'ja',
      playbackLanguage: 'en',
    })).toEqual(['panels', 'settings', 'scripts', 'saved']);
  });

  it('gates cast tab by multi-speaker flag and speaker count', () => {
    expect(shouldShowCastTab({ multiSpeakerEnabled: true, speakerCount: 2 })).toBe(true);
    expect(shouldShowCastTab({ multiSpeakerEnabled: true, speakerCount: 1 })).toBe(false);
    expect(shouldShowCastTab({ multiSpeakerEnabled: false, speakerCount: 8 })).toBe(false);
  });

  it('gates translate tab by translation support or language mismatch', () => {
    expect(shouldShowTranslateTab({
      translationSupported: true,
      sourceLanguage: 'en',
      playbackLanguage: 'en',
    })).toBe(true);
    expect(shouldShowTranslateTab({
      translationSupported: false,
      sourceLanguage: 'en',
      playbackLanguage: 'hi',
    })).toBe(true);
    expect(shouldShowTranslateTab({
      translationSupported: false,
      sourceLanguage: 'en',
      playbackLanguage: 'en',
    })).toBe(false);
  });

  it('falls back to available tabs and imported defaults', () => {
    const tabs = ['read', 'settings', 'scripts', 'saved'] as const;
    expect(coerceReaderTab('cast', [...tabs], 'novel')).toBe('settings');
    expect(coerceReaderTab('settings', [...tabs], 'novel')).toBe('settings');
    expect(coerceReaderTab('text', ['panels', 'settings', 'scripts', 'saved'], 'comic')).toBe('scripts');
    expect(coerceReaderTab('savedaudio', [...tabs], 'novel')).toBe('saved');

    expect(resolveImportedDefaultTab({
      mode: 'novel',
      imported: true,
      lowConfidence: false,
      availableTabs: ['read', 'settings', 'scripts', 'saved'],
    })).toBe('read');

    expect(resolveImportedDefaultTab({
      mode: 'novel',
      imported: true,
      lowConfidence: true,
      availableTabs: ['read', 'settings', 'scripts', 'saved'],
    })).toBe('scripts');

    expect(resolveImportedDefaultTab({
      mode: 'comic',
      imported: true,
      lowConfidence: false,
      availableTabs: ['panels', 'settings', 'scripts', 'saved'],
    })).toBe('scripts');
  });

  it('normalizes reader home tabs and labels', () => {
    expect(READER_HOME_TABS).toEqual(['novels', 'library', 'imported']);
    expect(coerceReaderHomeTab('Imported')).toBe('imported');
    expect(coerceReaderHomeTab('unknown', 'library')).toBe('library');
    expect(getReaderHomeTabLabel('library')).toBe('Library');
  });
});
