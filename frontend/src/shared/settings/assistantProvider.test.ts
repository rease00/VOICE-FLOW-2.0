import { describe, expect, it } from 'vitest';
import type { GenerationSettings } from '../../../types';
import {
  normalizeAssistantProviderControlsEnabled,
  normalizePreferUserGeminiKey,
  resolveAssistantProviderRouting,
} from './assistantProvider';
import {
  resolveAssistantTextDispatchPlan,
  resolveTextModelCandidates,
  STUDIO_CAST_TEXT_MODELS,
} from '../../../services/geminiService';

const baseSettings = (): GenerationSettings => ({
  voiceId: 'Fenrir',
  speed: 1,
  pitch: 'Medium',
  language: 'Auto',
  engine: 'PRIME',
  helperProvider: 'GEMINI',
  geminiApiKey: '',
  perplexityApiKey: '',
  localLlmUrl: 'http://localhost:5000',
  assistantProviderControlsEnabled: true,
  preferUserGeminiKey: false,
});

describe('assistant provider settings normalization', () => {
  it('applies fallback defaults for missing values', () => {
    expect(normalizeAssistantProviderControlsEnabled(undefined, true)).toBe(true);
    expect(normalizeAssistantProviderControlsEnabled(undefined, false)).toBe(false);
    expect(normalizePreferUserGeminiKey(undefined, false)).toBe(false);
    expect(normalizePreferUserGeminiKey(undefined, true)).toBe(true);
  });

  it('forces GEMINI route when provider controls are disabled', () => {
    const routing = resolveAssistantProviderRouting({
      ...baseSettings(),
      helperProvider: 'PERPLEXITY',
      assistantProviderControlsEnabled: false,
      preferUserGeminiKey: true,
    });
    expect(routing.controlsEnabled).toBe(false);
    expect(routing.provider).toBe('GEMINI');
    expect(routing.preferUserGeminiKey).toBe(false);
  });

  it('keeps selected provider when controls are enabled', () => {
    const routing = resolveAssistantProviderRouting({
      ...baseSettings(),
      helperProvider: 'LOCAL',
      assistantProviderControlsEnabled: true,
    });
    expect(routing.controlsEnabled).toBe(true);
    expect(routing.provider).toBe('LOCAL');
  });
});

describe('assistant dispatch plan', () => {
  it('routes controls OFF to runtime Gemini only', () => {
    const plan = resolveAssistantTextDispatchPlan({
      ...baseSettings(),
      helperProvider: 'PERPLEXITY',
      assistantProviderControlsEnabled: false,
      preferUserGeminiKey: true,
    });
    expect(plan.provider).toBe('GEMINI');
    expect(plan.usePerplexity).toBe(false);
    expect(plan.useRuntimeGemini).toBe(true);
    expect(plan.useUserGeminiKey).toBe(false);
  });

  it('uses personal key path for GEMINI when enabled', () => {
    const plan = resolveAssistantTextDispatchPlan({
      ...baseSettings(),
      helperProvider: 'GEMINI',
      assistantProviderControlsEnabled: true,
      preferUserGeminiKey: true,
    });
    expect(plan.usePerplexity).toBe(false);
    expect(plan.useUserGeminiKey).toBe(true);
    expect(plan.useRuntimeGemini).toBe(false);
  });

  it('uses runtime slot set for GEMINI when personal key toggle is OFF', () => {
    const plan = resolveAssistantTextDispatchPlan({
      ...baseSettings(),
      helperProvider: 'GEMINI',
      assistantProviderControlsEnabled: true,
      preferUserGeminiKey: false,
    });
    expect(plan.usePerplexity).toBe(false);
    expect(plan.useUserGeminiKey).toBe(false);
    expect(plan.useRuntimeGemini).toBe(true);
  });

  it('keeps perplexity path when controls are ON and provider is PERPLEXITY', () => {
    const plan = resolveAssistantTextDispatchPlan({
      ...baseSettings(),
      helperProvider: 'PERPLEXITY',
      assistantProviderControlsEnabled: true,
      preferUserGeminiKey: false,
    });
    expect(plan.usePerplexity).toBe(true);
    expect(plan.useRuntimeGemini).toBe(false);
    expect(plan.useUserGeminiKey).toBe(false);
  });

  it('keeps local flow unchanged when controls are ON', () => {
    const plan = resolveAssistantTextDispatchPlan({
      ...baseSettings(),
      helperProvider: 'LOCAL',
      assistantProviderControlsEnabled: true,
      preferUserGeminiKey: false,
    });
    expect(plan.provider).toBe('LOCAL');
    expect(plan.usePerplexity).toBe(false);
    expect(plan.useRuntimeGemini).toBe(true);
  });

  it('uses runtime-safe Gemini text candidates led by Gemini 2.5 Flash Lite', () => {
    expect(resolveTextModelCandidates()).toEqual([
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-3-flash',
      'gemma-3-27b',
      'gemma-3-12b',
      'gemma-3-4b',
      'gemma-3-2b',
      'gemma-3-1b',
    ]);
    expect(STUDIO_CAST_TEXT_MODELS).toEqual([
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.5-flash-lite',
      'gemini-3-flash',
    ]);
  });
});

