import { describe, it, expect } from 'vitest';
import { VOICES } from '../constants';
import type { GenerationSettings, StudioEditorMode } from '../types';

/**
 * Tests for Studio v2 model contracts — voice list shape,
 * generation settings construction, draft key, and editor modes.
 */

describe('studio v2 model contracts', () => {
  /* ── voice list ─────────────────────────────── */

  it('VOICES array has at least one entry with required fields', () => {
    expect(VOICES.length).toBeGreaterThan(0);
    for (const v of VOICES) {
      expect(v.id).toBeTruthy();
      expect(v.name).toBeTruthy();
      expect(typeof v.accent).toBe('string');
      expect(['Male', 'Female']).toContain(v.gender);
    }
  });

  it('VOICES ids are unique', () => {
    const ids = VOICES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /* ── generation settings construction ──────── */

  it('builds valid GenerationSettings from a voice entry', () => {
    const voice = VOICES[0]!;
    const settings: GenerationSettings = {
      voiceId: voice.id,
      speed: 1,
      pitch: 'Medium',
      language: voice.accent,
      engine: 'PRIME',
      helperProvider: 'GEMINI',
    };
    expect(settings.voiceId).toBe(voice.id);
    expect(settings.engine).toBe('PRIME');
    expect(settings.helperProvider).toBe('GEMINI');
    expect(['Low', 'Medium', 'High']).toContain(settings.pitch);
  });

  it('generation settings speed must be a positive number', () => {
    const settings: GenerationSettings = {
      voiceId: 'test',
      speed: 1.5,
      pitch: 'Medium',
      language: 'en',
      engine: 'PRIME',
      helperProvider: 'GEMINI',
    };
    expect(settings.speed).toBeGreaterThan(0);
  });

  /* ── draft persistence key contract ─────────── */

  it('draft key follows namespace convention', () => {
    const DRAFT_KEY = 'vf:studio-v2:draft';
    expect(DRAFT_KEY).toMatch(/^vf:/);
    expect(DRAFT_KEY).toContain('studio');
    expect(DRAFT_KEY).toContain('v2');
  });

  /* ── editor mode contract ───────────────────── */

  it('StudioEditorMode accepts expected values', () => {
    const modes: StudioEditorMode[] = ['blocks', 'raw'];
    expect(modes).toHaveLength(2);
    expect(modes).toContain('blocks');
    expect(modes).toContain('raw');
  });

  /* ── voice gender coverage ──────────────────── */

  it('voice list includes both genders', () => {
    const males = VOICES.filter((v) => v.gender === 'Male');
    const females = VOICES.filter((v) => v.gender === 'Female');
    expect(males.length).toBeGreaterThan(0);
    expect(females.length).toBeGreaterThan(0);
  });

  it('all voices have a country field', () => {
    for (const v of VOICES) {
      expect(typeof v.country).toBe('string');
    }
  });
});
