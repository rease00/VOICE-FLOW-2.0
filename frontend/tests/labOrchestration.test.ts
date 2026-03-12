import { describe, expect, it } from 'vitest';

import { getLabCapabilityProfile } from '../src/features/lab/model/capabilities';
import { DEFAULT_LAB_RUNTIME_DEFAULTS, resolveLabExportExecutionMode, resolveLabRuntimeState } from '../src/features/lab/model/orchestration';

const fakeAudioContext = class FakeAudioContext {} as unknown as typeof AudioContext;
const fakeIndexedDb = {} as IDBFactory;
const fakeOffscreenCanvas = class FakeOffscreenCanvas {} as unknown as typeof OffscreenCanvas;

describe('lab orchestration runtime state', () => {
  it('prefers WebGPU on strong hardware when policy allows it', () => {
    const capabilities = getLabCapabilityProfile({
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

    const runtime = resolveLabRuntimeState({
      capabilities,
      defaults: {
        ...DEFAULT_LAB_RUNTIME_DEFAULTS,
        labPerformanceMode: 'balanced',
      },
      timelineDurationMs: 60_000,
    });

    expect(runtime.effectiveBrowserMode).toBe('webgpu_active');
    expect(runtime.previewQualityLevel).toBe('high');
    expect(runtime.autoPreviewAllowed).toBe(true);
  });

  it('drops to conservative preview when the timeline exceeds the safe local window', () => {
    const capabilities = getLabCapabilityProfile({
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

    const runtime = resolveLabRuntimeState({
      capabilities,
      defaults: DEFAULT_LAB_RUNTIME_DEFAULTS,
      timelineDurationMs: capabilities.maxRecommendedDurationMs + 1_000,
    });

    expect(runtime.previewQualityLevel).toBe('low');
    expect(runtime.autoPreviewAllowed).toBe(false);
    expect(runtime.degradedReason).toBe('long_timeline');
  });

  it('labels conservative policy separately from actual CPU fallback', () => {
    const capabilities = getLabCapabilityProfile({
      navigatorLike: {
        hardwareConcurrency: 10,
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

    const runtime = resolveLabRuntimeState({
      capabilities,
      defaults: DEFAULT_LAB_RUNTIME_DEFAULTS,
      timelineDurationMs: 30_000,
    });

    expect(runtime.runtimeBadge).toBe('Conservative mode');
    expect(runtime.runtimeBadgeState).toBe('conservative');
  });

  it('surfaces backend queue pressure without disabling local editing mode entirely', () => {
    const capabilities = getLabCapabilityProfile({
      navigatorLike: {
        hardwareConcurrency: 8,
        deviceMemory: 8,
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

    const runtime = resolveLabRuntimeState({
      capabilities,
      defaults: DEFAULT_LAB_RUNTIME_DEFAULTS,
      timelineDurationMs: 90_000,
      backendQueueActive: true,
    });

    expect(runtime.degradedReason).toBe('backend_queue');
    expect(runtime.runtimeBadge).toBe('Queued on backend');
    expect(runtime.heavyToolsEnabled).toBe(true);
  });

  it('routes larger exports to backend queue finalization', () => {
    const capabilities = getLabCapabilityProfile({
      navigatorLike: {
        hardwareConcurrency: 8,
        deviceMemory: 8,
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

    const runtime = resolveLabRuntimeState({
      capabilities,
      defaults: {
        ...DEFAULT_LAB_RUNTIME_DEFAULTS,
        labPerformanceMode: 'balanced',
      },
      timelineDurationMs: 150_000,
    });

    const route = resolveLabExportExecutionMode({
      capabilities,
      defaults: DEFAULT_LAB_RUNTIME_DEFAULTS,
      runtimeState: runtime,
      timelineDurationMs: 150_000,
      visualClipCount: 12,
    });

    expect(route).toBe('backend_queue');
  });
});
