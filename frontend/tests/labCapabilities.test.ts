import { describe, expect, it } from 'vitest';

import { getLabCapabilityProfile } from '../src/features/lab/model/capabilities';

const fakeAudioContext = class FakeAudioContext {} as unknown as typeof AudioContext;
const fakeIndexedDb = {} as IDBFactory;
const fakeOffscreenCanvas = class FakeOffscreenCanvas {} as unknown as typeof OffscreenCanvas;

describe('lab capability profile', () => {
  it('disables advanced tools on low-tier devices', () => {
    const profile = getLabCapabilityProfile({
      navigatorLike: {
        hardwareConcurrency: 2,
        deviceMemory: 2,
      },
      windowLike: {
        AudioContext: fakeAudioContext,
        indexedDB: fakeIndexedDb,
      },
      workerSupported: true,
      ffmpegSupported: true,
    });

    expect(profile.tier).toBe('low');
    expect(profile.audioEditingEnabled).toBe(true);
    expect(profile.sourceSeparationEnabled).toBe(false);
    expect(profile.videoImportEnabled).toBe(false);
    expect(profile.autoPreviewEnabled).toBe(false);
    expect(profile.workerThreadCap).toBe(1);
    expect(profile.browserKokoroEligible).toBe(false);
    expect(profile.waveformDetail).toBe('reduced');
  });

  it('enables full audio editing on standard devices', () => {
    const profile = getLabCapabilityProfile({
      navigatorLike: {
        hardwareConcurrency: 6,
        deviceMemory: 8,
      },
      windowLike: {
        AudioContext: fakeAudioContext,
        indexedDB: fakeIndexedDb,
      },
      workerSupported: true,
      ffmpegSupported: true,
    });

    expect(profile.tier).toBe('standard');
    expect(profile.audioEditingEnabled).toBe(true);
    expect(profile.sourceSeparationEnabled).toBe(true);
    expect(profile.videoImportEnabled).toBe(true);
    expect(profile.autoPreviewEnabled).toBe(true);
    expect(profile.heavyToolsEnabled).toBe(true);
    expect(profile.workerThreadCap).toBe(2);
    expect(profile.browserKokoroEligible).toBe(true);
  });

  it('prefers high tier when WebGPU is available on strong hardware', () => {
    const profile = getLabCapabilityProfile({
      navigatorLike: {
        hardwareConcurrency: 12,
        deviceMemory: 16,
        gpu: {},
      },
      windowLike: {
        AudioContext: fakeAudioContext,
        indexedDB: fakeIndexedDb,
        OffscreenCanvas: fakeOffscreenCanvas,
      },
      workerSupported: true,
      ffmpegSupported: true,
    });

    expect(profile.tier).toBe('high');
    expect(profile.webGpuSupported).toBe(true);
    expect(profile.sourceSeparationEnabled).toBe(true);
    expect(profile.offscreenCanvasSupported).toBe(true);
    expect(profile.workerThreadCap).toBe(4);
    expect(profile.browserKokoroEligible).toBe(true);
    expect(profile.waveformDetail).toBe('full');
  });

  it('downgrades heavy tools when runtime metrics show a slow startup path', () => {
    const profile = getLabCapabilityProfile({
      navigatorLike: {
        hardwareConcurrency: 12,
        deviceMemory: 16,
        gpu: {},
      },
      windowLike: {
        AudioContext: fakeAudioContext,
        indexedDB: fakeIndexedDb,
        OffscreenCanvas: fakeOffscreenCanvas,
      },
      workerSupported: true,
      ffmpegSupported: true,
      runtimeMetrics: {
        hydrationMs: 2100,
        previewRenderMs: 2600,
      },
    });

    expect(profile.tier).toBe('low');
    expect(profile.runtimeGuardrails.degraded).toBe(true);
    expect(profile.autoPreviewEnabled).toBe(false);
    expect(profile.heavyToolsEnabled).toBe(false);
  });
});
