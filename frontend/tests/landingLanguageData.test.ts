import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../constants';
import {
  LANDING_MULTI_DEMOS,
  LANDING_SINGLE_DEMOS,
  LANDING_THEME_CONFIGS,
  LANDING_THEME_ORDER,
} from '../src/landing/landingContent';
import { VECTOR_DEMO_AUDIO_ENTRIES } from '../src/landing/vectorDemoAudioManifest';
import { VECTOR_MULTI_SPEAKER_DEMO_ENTRIES, VECTOR_MULTI_SPEAKER_DEMO_SELECTION_NOTE } from '../src/landing/vectorMultiSpeakerDemoManifest';
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

  it('keeps the curated five-market multi-speaker proof intact', () => {
    expect(VECTOR_MULTI_SPEAKER_DEMO_SELECTION_NOTE).toContain('Five high-reach language demos');
    expect(VECTOR_MULTI_SPEAKER_DEMO_ENTRIES).toHaveLength(5);

    const expectedIds = ['en-roundtable', 'zh-briefing', 'hi-audiobook', 'es-culture', 'ar-documentary'];
    expect(VECTOR_MULTI_SPEAKER_DEMO_ENTRIES.map((entry) => entry.id)).toEqual(expectedIds);

    for (const entry of VECTOR_MULTI_SPEAKER_DEMO_ENTRIES) {
      expect(entry.summary).toEqual(expect.any(String));
      expect(entry.direction).toEqual(expect.any(String));
      expect(entry.translation).toEqual(expect.any(String));
      expect(entry.castSummary).toEqual(expect.any(String));
      expect(entry.cast).toHaveLength(3);
      expect(entry.lines).toHaveLength(6);
      expect(entry.audioSrc).toMatch(/^\/demo\/vector-multi\/.+\.wav$/);
      expect(existsSync(resolve(process.cwd(), 'public', entry.audioSrc.slice(1)))).toBe(true);
    }
  });

  it('keeps the single-speaker demo rail broad and playable', () => {
    expect(VECTOR_DEMO_AUDIO_ENTRIES).toHaveLength(15);

    const featuredIds = ['en-us', 'hi', 'es', 'fr', 'ar'];
    for (const id of featuredIds) {
      const demo = VECTOR_DEMO_AUDIO_ENTRIES.find((entry) => entry.id === id);
      expect(demo, `expected featured single-speaker demo ${id} to exist`).toBeDefined();
      expect(demo?.language).toEqual(expect.any(String));
      expect(demo?.country).toEqual(expect.any(String));
      expect(demo?.scenario).toEqual(expect.any(String));
      expect(demo?.emotion).toEqual(expect.any(String));
      expect(demo?.style).toEqual(expect.any(String));
      expect(demo?.translation).toEqual(expect.any(String));
      expect(demo?.audioSrc).toMatch(/^\/demo\/vector\/.+\.wav$/);
      expect(existsSync(resolve(process.cwd(), 'public', String(demo?.audioSrc || '').slice(1)))).toBe(true);
    }

    expect(VECTOR_DEMO_AUDIO_ENTRIES.some((entry) => entry.rtl)).toBe(true);
  });

  it('keeps landing cue metadata and themes deterministic', () => {
    expect(UI_BRAND_THEME_ORDER).toEqual(['neon', 'aurora', 'sunset', 'emerald']);
    expect(LANDING_THEME_ORDER).toBe(UI_BRAND_THEME_ORDER);
    expect(LANDING_THEME_CONFIGS).toBe(UI_BRAND_THEME_CONFIGS);
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

    expect(LANDING_SINGLE_DEMOS).toHaveLength(5);
    expect(LANDING_MULTI_DEMOS).toHaveLength(5);

    for (const demo of [...LANDING_SINGLE_DEMOS, ...LANDING_MULTI_DEMOS]) {
      expect(demo.emotionStyle.trim()).not.toHaveLength(0);
      expect(demo.emotionCue.trim()).not.toHaveLength(0);
      expect(demo.performanceCue.trim()).not.toHaveLength(0);
      expect(demo.emotionCue).not.toContain('Placeholder');
      expect(demo.performanceCue).not.toContain('Placeholder');
    }

    for (const demo of LANDING_MULTI_DEMOS) {
      expect(demo.emotionCue.length).toBeGreaterThan(48);
      expect(demo.performanceCue.length).toBeGreaterThan(48);
      expect(demo.performanceCue).toContain('Lead with');
    }
  });
});
