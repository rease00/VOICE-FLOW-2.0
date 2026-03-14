import { describe, expect, it, vi } from 'vitest';
import {
  buildLivePodcastSubmitRequest,
  buildStandardPodcastSubmitRequest,
  createPodcastEntitlementRefreshInvoker,
  normalizePodcastLanguage,
  PODCAST_LANGUAGE_OPTIONS,
  resolvePodcastLanguageOptions,
  resolvePodcastErrorMessage,
  shouldAutoRunDirectorAtStart,
} from '../src/features/podcast/model/podcastRuntime';

const SAMPLE_CAST = [
  { id: 'host', name: 'HOST', role: 'anchor', voice: 'Puck', persona: 'Lead the show.' },
  { id: 'guest', name: 'GUEST', role: 'skeptic', voice: 'Kore', persona: 'Challenge assumptions.' },
] as const;

describe('podcast runtime model', () => {
  it('builds live payload with language, optional seed script, and director model', () => {
    const payload = buildLivePodcastSubmitRequest({
      topic: 'Live topic',
      durationSec: 180,
      speakerCount: 2,
      cast: [...SAMPLE_CAST],
      pacingStyle: 'fast-paced debate',
      language: 'hi',
      seedScript: 'HOST (Curious): Namaste!',
      directorModel: 'gemini-3.1-flash-lite-preview',
    });

    expect(payload.language).toBe('hi');
    expect(payload.seedScript).toBe('HOST (Curious): Namaste!');
    expect(payload.directorModel).toBe('gemini-3.1-flash-lite-preview');
  });

  it('builds standard payload with language and optional seed script', () => {
    const payload = buildStandardPodcastSubmitRequest({
      engine: 'NEURAL2',
      topic: 'Standard topic',
      durationSec: 900,
      speakerCount: 2,
      cast: [...SAMPLE_CAST],
      pacingStyle: 'conversational deep dive',
      language: 'es',
      seedScript: 'HOST (Warm): Hola y bienvenidos.',
      directorModel: 'gemini-3.1-flash-lite-preview',
      autoSave: true,
      includeTranscript: true,
      audioFormat: 'wav',
      scriptWindowChars: 3000,
    });

    expect(payload.language).toBe('es');
    expect(payload.seedScript).toBe('HOST (Warm): Hola y bienvenidos.');
    expect(payload.directorModel).toBe('gemini-3.1-flash-lite-preview');
  });

  it('auto-runs director only when script is empty', () => {
    expect(shouldAutoRunDirectorAtStart('')).toBe(true);
    expect(shouldAutoRunDirectorAtStart('   ')).toBe(true);
    expect(shouldAutoRunDirectorAtStart('HOST: We already have a script.')).toBe(false);
  });

  it('refreshes entitlements on accepted/terminal events with cooldown debounce', async () => {
    const refresh = vi.fn(async () => undefined);
    const invoker = createPodcastEntitlementRefreshInvoker(refresh, 1000);
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(1000);
    await invoker('accepted');
    nowSpy.mockReturnValue(1500);
    await invoker('completed');
    nowSpy.mockReturnValue(2501);
    await invoker('failed');
    nowSpy.mockReturnValue(4000);
    await invoker('cancelled');

    expect(refresh).toHaveBeenCalledTimes(3);
    nowSpy.mockRestore();
  });

  it('renders human-readable podcast errors from object payloads', () => {
    const message = resolvePodcastErrorMessage(
      {
        detail: {
          error: 'request_id is already associated with a different user.',
          errorCode: 'REQUEST_ID_CONFLICT',
          reason: 'request_id_owner_conflict',
        },
      },
      'Podcast generation failed.'
    );

    expect(message).toContain('request_id is already associated with a different user.');
    expect(message).toContain('REQUEST_ID_CONFLICT');
    expect(message).not.toContain('[object Object]');
  });

  it('accepts 3-letter and extended language tags', () => {
    expect(normalizePodcastLanguage('fil')).toBe('fil');
    expect(normalizePodcastLanguage('zh-Hant')).toBe('zh-hant');
    expect(normalizePodcastLanguage('bad token')).toBe('en');
  });

  it('uses full language catalog when engine reports multilingual support', () => {
    const options = resolvePodcastLanguageOptions(
      {
        engines: {
          GEM: { languages: ['multilingual'] },
        },
      } as any,
      'GEM'
    );

    expect(options.length).toBeGreaterThan(PODCAST_LANGUAGE_OPTIONS.length);
    expect(options.some((option) => option.value === 'fil')).toBe(true);
    expect(options.some((option) => option.value === 'de')).toBe(true);
  });

  it('uses engine-declared language set when explicit list is provided', () => {
    const options = resolvePodcastLanguageOptions(
      {
        engines: {
          KOKORO: { languages: ['en', 'hi'] },
        },
      } as any,
      'KOKORO'
    );

    expect(options.map((option) => option.value)).toEqual(['en', 'hi']);
  });
});
