import { describe, expect, it } from 'vitest';
import { resolveDirectorPromptProfile } from '../services/geminiService';

describe('resolveDirectorPromptProfile', () => {
  it('falls back to the default conservative director pass', () => {
    const profile = resolveDirectorPromptProfile();

    expect(profile.modeId).toBe('default');
    expect(profile.modeLabel).toBe('Default');
    expect(profile.requestedTone).toBe('neutral');
    expect(profile.temperature).toBe(0.2);
    expect(profile.extraInstructions.join(' ')).toContain('DEFAULT MODE');
  });

  it('enables stronger emotional direction when expressive mode is on', () => {
    const profile = resolveDirectorPromptProfile({ expressiveEmotion: true });

    expect(profile.modeId).toBe('expressive_emotion');
    expect(profile.modeLabel).toBe('Expressive Emotion');
    expect(profile.requestedTone).toBe('dramatic');
    expect(profile.extraInstructions.join(' ')).toContain('EXPRESSIVE EMOTION MODE');
  });

  it('switches to the auto rewrite director pass when auto mode is on', () => {
    const profile = resolveDirectorPromptProfile({ autoRewrite: true });

    expect(profile.modeId).toBe('auto');
    expect(profile.modeLabel).toBe('Auto');
    expect(profile.userPromptLead).toContain('Auto-rewrite');
    expect(profile.extraInstructions.join(' ')).toContain('AUTO REWRITE MODE');
  });

  it('combines auto rewrite and expressive emotion when both toggles are active', () => {
    const profile = resolveDirectorPromptProfile({
      expressiveEmotion: true,
      autoRewrite: true,
    });

    expect(profile.modeId).toBe('auto_expressive_emotion');
    expect(profile.modeLabel).toBe('Auto + Expressive Emotion');
    expect(profile.requestedTone).toBe('dramatic');
    expect(profile.extraInstructions).toHaveLength(2);
    expect(profile.temperature).toBeGreaterThan(0.24);
  });
});
