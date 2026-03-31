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

  it('keeps the landing page tied to the real demo asset paths and canonical anchors', () => {
    const html = renderToStaticMarkup(React.createElement(MarketingLanding));

    expect(html).toContain('href="#single-speaker"');
    expect(html).toContain('href="#multi-speaker"');
    expect(html).toContain('href="#voice-cloning"');
    expect(html).toContain('href="#ai-director"');
    expect(html).toContain('href="#reader-playback"');
    expect(html).toContain('/audio/vector-demo/en-us.wav');
    expect(html).toContain('/audio/vector-multi-demo/en-roundtable.wav');
    expect(html).toContain('/audio/vector-multi-demo/ar-documentary.wav');
    expect(html).toContain('/audio/openvoice-demo/reference.wav');
    expect(html).toContain('/audio/openvoice-demo/rendered.wav');
    expect(html).toContain('Single-speaker system');
    expect(html).toContain('Prime multi-speaker scenes');
    expect(html).toContain('Voice cloning proof');
    expect(html).toContain('AI Director');
    expect(html).toContain('Live prompt contract');
    expect(html).toContain('Reader playback');
    expect(html).toContain('href="/billing"');
    expect(html).toContain('data-audio-player="vf-marketing"');
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
      expect(theme.glow).toEqual(expect.any(String));
      expect(theme.backdrop).toEqual(expect.any(String));
      expect(theme.surface).toEqual(expect.any(String));
    }
  });
});
