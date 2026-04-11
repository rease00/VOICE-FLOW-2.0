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

    expect(html).toContain('id="landing-home"');
    expect(html).toContain('id="single-speaker"');
    expect(html).toContain('id="multi-speaker"');
    expect(html).toContain('id="voice-cloning"');
    expect(html).toContain('id="ai-director"');
    expect(html).toContain('id="writing-playback"');
    expect(html).toContain('/audio/vector-demo/en-us.wav');
    expect(html).toContain('/audio/vector-multi-demo/en-weekend-plan.wav');
    expect(html).toContain('/audio/vector-multi-demo/fr-city-tour.wav');
    expect(html).toContain('/audio/openvoice-demo/reference.wav');
    expect(html).toContain('/audio/openvoice-demo/rendered.wav');
    expect(html).toContain('Single voice');
    expect(html).toContain('Prime scenes');
    expect(html).toContain('Clone proof');
    expect(html).toContain('AI Director');
    expect(html).toContain('Prompt contract');
    expect(html).toContain('Writing');
    expect(html).toContain('href="/billing"');
    expect(html).toContain('data-audio-player="vf-marketing"');
    expect(html).toContain('vf-marketing-stat-grid--five-up');
    expect(html).toContain('vf-marketing-audio-grid--five-up');
    expect(html).toContain('vf-marketing-scene-grid--five-up');
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

