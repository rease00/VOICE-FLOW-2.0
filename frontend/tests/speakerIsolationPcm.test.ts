import { describe, expect, it } from 'vitest';

import {
  buildLinear16WavFromPcm,
  buildSilencePcm,
  splitWavIntoLinePcmSegments,
} from '../src/server/studio/speakerIsolationPcm';

const SAMPLE_RATE = 24_000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

const buildTonePcm = (frames: number, amplitude: number): Buffer => {
  const safeFrames = Math.max(0, Math.floor(frames));
  const buffer = Buffer.alloc(safeFrames * 2);
  for (let index = 0; index < safeFrames; index += 1) {
    buffer.writeInt16LE(amplitude, index * 2);
  }
  return buffer;
};

const sumLength = (buffers: Buffer[]): number => buffers.reduce((total, buffer) => total + buffer.length, 0);

describe('speakerIsolationPcm', () => {
  it('falls back to weighted split when no silence boundaries are available', () => {
    const pcm = buildTonePcm(SAMPLE_RATE, 1200);
    const wav = buildLinear16WavFromPcm(pcm, SAMPLE_RATE, CHANNELS, BITS_PER_SAMPLE);

    const result = splitWavIntoLinePcmSegments(wav, 3, {
      weights: [1, 2, 1],
    });

    expect(result.usedFallback).toBe(true);
    expect(result.segments).toHaveLength(3);
    expect(sumLength(result.segments)).toBe(pcm.length);
  });

  it('uses silence cuts when long pauses separate lines', () => {
    const toneA = buildTonePcm(Math.floor(SAMPLE_RATE * 0.2), 1200);
    const pause = buildSilencePcm(400, SAMPLE_RATE, CHANNELS, BITS_PER_SAMPLE);
    const toneB = buildTonePcm(Math.floor(SAMPLE_RATE * 0.2), 1400);
    const toneC = buildTonePcm(Math.floor(SAMPLE_RATE * 0.2), 1000);
    const pcm = Buffer.concat([toneA, pause, toneB, pause, toneC]);
    const wav = buildLinear16WavFromPcm(pcm, SAMPLE_RATE, CHANNELS, BITS_PER_SAMPLE);

    const result = splitWavIntoLinePcmSegments(wav, 3);

    expect(result.usedFallback).toBe(false);
    expect(result.silenceCutCount).toBeGreaterThanOrEqual(2);
    expect(result.segments).toHaveLength(3);
    expect(result.segments.every((segment) => segment.length > 0)).toBe(true);
    expect(sumLength(result.segments)).toBe(pcm.length);
  });

  it('keeps segmentation stable for very short lines', () => {
    const shortLineA = buildTonePcm(Math.floor(SAMPLE_RATE * 0.03), 800);
    const tinyPause = buildSilencePcm(60, SAMPLE_RATE, CHANNELS, BITS_PER_SAMPLE);
    const shortLineB = buildTonePcm(Math.floor(SAMPLE_RATE * 0.03), 900);
    const shortLineC = buildTonePcm(Math.floor(SAMPLE_RATE * 0.03), 1000);
    const pcm = Buffer.concat([shortLineA, tinyPause, shortLineB, tinyPause, shortLineC]);
    const wav = buildLinear16WavFromPcm(pcm, SAMPLE_RATE, CHANNELS, BITS_PER_SAMPLE);

    const result = splitWavIntoLinePcmSegments(wav, 3, {
      weights: [shortLineA.length, shortLineB.length, shortLineC.length],
      minSilenceMs: 120,
    });

    expect(result.segments).toHaveLength(3);
    expect(sumLength(result.segments)).toBe(pcm.length);
    expect(result.segments[0]?.length).toBeGreaterThan(0);
    expect(result.segments[1]?.length).toBeGreaterThan(0);
    expect(result.segments[2]?.length).toBeGreaterThan(0);
  });
});
