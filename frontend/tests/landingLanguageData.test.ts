import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../constants';
import { MarketingLanding } from '../src/features/landing/MarketingLanding';
import {
  DEFAULT_UI_BRAND_THEME,
  UI_BRAND_THEME_CONFIGS,
  UI_BRAND_THEME_ORDER,
  resolveUiBrandThemeId,
} from '../src/shared/theme/brandThemes';

describe('landing multilingual data', () => {
  it('keeps the shared language catalog at the configured breadth', () => {
    expect(LANGUAGES).toHaveLength(83);

    const rtlCodes = LANGUAGES.filter((entry) => entry.rtl).map((entry) => entry.code);
    expect(rtlCodes).toEqual(['ur', 'ar', 'he', 'fa', 'ps']);

    const sampledLanguages = ['en', 'en-US', 'es', 'ar', 'ja'];
    for (const code of sampledLanguages) {
      const language = LANGUAGES.find((entry) => entry.code === code);
      expect(language?.name).toEqual(expect.any(String));
      expect(String(language?.name || '').trim()).not.toHaveLength(0);
    }
  });

  it('keeps the landing routes tied to the real demo asset paths', () => {
    const singleVoiceHtml = renderToStaticMarkup(React.createElement(MarketingLanding, { activePage: 'single-voice' }));
    const primeScenesHtml = renderToStaticMarkup(React.createElement(MarketingLanding, { activePage: 'prime-scenes' }));
    const directionHtml = renderToStaticMarkup(React.createElement(MarketingLanding, { activePage: 'direction' }));
    const readerHtml = renderToStaticMarkup(React.createElement(MarketingLanding, { activePage: 'reader' }));

    expect(singleVoiceHtml).toContain('data-testid="landing-single-speaker"');
    expect(singleVoiceHtml).toContain('/audio/vector-demo/');
    expect(singleVoiceHtml).toContain('Single voice');
    expect(singleVoiceHtml).toContain('data-audio-player="vf-marketing"');

    expect(primeScenesHtml).toContain('data-testid="landing-multi-speaker"');
    expect(primeScenesHtml).toContain('/audio/vector-multi-demo/');
    expect(primeScenesHtml).toContain('Prime scene');

    expect(directionHtml).toContain('data-testid="landing-ai-director"');
    expect(directionHtml).toContain('data-testid="landing-ai-director-prompt"');

    expect(readerHtml).toContain('data-testid="landing-reader-playback"');
    expect(readerHtml).toContain('data-testid="landing-reader-virtual-book"');
    expect(readerHtml).toContain('The Lighthouse Ledger');
    expect(readerHtml).toContain('Chapter 01');
    expect(readerHtml).toContain('Chapter 02');
    expect(readerHtml).toContain('/audio/reader-demo/chapter-01-fog-over-meridian-bay.wav');
    expect(readerHtml).toContain('/audio/reader-demo/chapter-02-the-second-signal.wav');
    expect(readerHtml).toContain('/audio/reader-demo/');
    expect(readerHtml).toContain('/images/reader-demo-poster.svg');
    expect(readerHtml).toContain('Open Reader in App');
  });

  it('keeps shared brand theme configuration deterministic', () => {
    expect(UI_BRAND_THEME_ORDER).toEqual(['neon', 'aurora', 'sunset', 'emerald']);
    expect(resolveUiBrandThemeId('invalid-theme')).toBe(DEFAULT_UI_BRAND_THEME);
    expect(Object.keys(UI_BRAND_THEME_CONFIGS)).toEqual(UI_BRAND_THEME_ORDER);

    for (const themeId of UI_BRAND_THEME_ORDER) {
      const theme = UI_BRAND_THEME_CONFIGS[themeId];
      expect(theme.id).toBe(themeId);
      expect(theme.label).toEqual(expect.any(String));
      expect(theme.description).toEqual(expect.any(String));
      expect(theme.accent).toEqual(expect.any(String));
      expect(theme.modes.dark.glow).toEqual(expect.any(String));
      expect(theme.modes.dark.backdrop).toEqual(expect.any(String));
      expect(theme.modes.dark.surface).toEqual(expect.any(String));
      expect(theme.modes.light.glow).toEqual(expect.any(String));
      expect(theme.modes.light.backdrop).toEqual(expect.any(String));
      expect(theme.modes.light.surface).toEqual(expect.any(String));
    }
  });
});
