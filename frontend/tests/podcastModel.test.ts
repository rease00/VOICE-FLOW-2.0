import { describe, expect, it } from 'vitest';
import {
  clampPodcastDurationSec,
  clampPodcastSpeakerCount,
  estimatePodcastChars,
  estimatePodcastVf,
  PODCAST_BILLING_RATE,
  PODCAST_STANDARD_SCRIPT_WINDOW_CHARS,
} from '../src/features/podcast/model/podcast';

describe('podcast model', () => {
  it('clamps live mode to 2-4 speakers and 30 minutes', () => {
    expect(clampPodcastSpeakerCount('live', 1)).toBe(2);
    expect(clampPodcastSpeakerCount('live', 8)).toBe(4);
    expect(clampPodcastDurationSec('live', 30)).toBe(60);
    expect(clampPodcastDurationSec('live', 9999)).toBe(1800);
  });

  it('clamps standard mode to 2-6 speakers and 60 minutes', () => {
    expect(clampPodcastSpeakerCount('standard', 1)).toBe(2);
    expect(clampPodcastSpeakerCount('standard', 9)).toBe(6);
    expect(clampPodcastDurationSec('standard', 30)).toBe(60);
    expect(clampPodcastDurationSec('standard', 9999)).toBe(3600);
  });

  it('uses the 3000-char floor and GEM 1.5 VF rate for standard estimates', () => {
    const chars = estimatePodcastChars('standard', 120);
    const vf = estimatePodcastVf('standard', 120);

    expect(chars).toBe(PODCAST_STANDARD_SCRIPT_WINDOW_CHARS);
    expect(vf).toBe(chars * PODCAST_BILLING_RATE);
  });
});
