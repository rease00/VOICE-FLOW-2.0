import { describe, expect, it } from 'vitest';

import { __kokoroBrowserRuntimePlannerTestOnly } from '../services/kokoroBrowserRuntime.impl';

const countWords = (text: string): number => String(text || '').trim().split(/\s+/).filter(Boolean).length;
const normalize = (text: string): string => String(text || '').replace(/\s+/g, ' ').trim();

describe('kokoro sentence-safe live chunk planner', () => {
  it('keeps the first chunk sentence-aligned when the first sentence fits the first chunk hard cap', () => {
    const source = 'VoiceFlow now streams faster without changing speech pace. The second sentence should remain for later chunks.';
    const chunks = __kokoroBrowserRuntimePlannerTestOnly.planSentenceSafeLiveChunks(source);
    expect(chunks[0]).toBe('VoiceFlow now streams faster without changing speech pace.');
  });

  it('splits an oversized first sentence at clause punctuation before word-boundary fallback', () => {
    const source = [
      'When the studio starts a long opening line, we keep clause pacing natural, we avoid dumping everything at once, we preserve sentence rhythm for listeners, and we still begin playback quickly for the first audible response.',
      'This follow-up sentence should remain in later chunks.',
    ].join(' ');
    const chunks = __kokoroBrowserRuntimePlannerTestOnly.planSentenceSafeLiveChunks(source);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toContain(',');
    expect(countWords(chunks[0] || '')).toBeLessThanOrEqual(24);
  });

  it('never creates mid-word splits when clause punctuation is unavailable', () => {
    const source = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega finalword';
    const chunks = __kokoroBrowserRuntimePlannerTestOnly.planSentenceSafeLiveChunks(source);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => !chunk.includes('\n'))).toBe(true);
    expect(normalize(chunks.join(' '))).toBe(normalize(source));
  });

  it('produces ordered bounded chunks across long multi-sentence input with punctuation preserved', () => {
    const source = [
      'The first sentence is short and should lead.',
      'The second sentence keeps things flowing in natural cadence.',
      'The third sentence continues the stream so playback feels immediate.',
      'The fourth sentence verifies chunk ordering and punctuation boundaries stay intact.',
      'The fifth sentence closes the test for long studio text.',
    ].join(' ');
    const chunks = __kokoroBrowserRuntimePlannerTestOnly.planSentenceSafeLiveChunks(source);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(normalize(chunks.join(' '))).toBe(normalize(source));
    chunks.forEach((chunk, index) => {
      const words = countWords(chunk);
      const hardCap = index === 0 ? 24 : 45;
      expect(words).toBeLessThanOrEqual(hardCap);
      expect(words).toBeGreaterThan(0);
    });
  });
});
