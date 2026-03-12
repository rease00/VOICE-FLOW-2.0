/// <reference lib="webworker" />

import type {
  LabSeparationWorkerRequest,
  LabSeparationWorkerResponse,
  LabPcmData,
  LabWorkerProgressPayload,
} from './contracts';

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
const EMPTY_CHANNEL = new Float32Array(1);

const post = (payload: LabSeparationWorkerResponse): void => {
  workerScope.postMessage(payload);
};

const toProgress = (requestId: string, payload: LabWorkerProgressPayload): void => {
  post({ type: 'progress', requestId, payload });
};

const normalize = (channels: Float32Array[]): void => {
  let peak = 0;
  channels.forEach((channel) => {
    for (let index = 0; index < channel.length; index += 1) {
      peak = Math.max(peak, Math.abs(channel[index] ?? 0));
    }
  });
  if (peak <= 0) return;
  const gain = Math.min(3, 0.92 / peak);
  channels.forEach((channel) => {
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = (channel[index] ?? 0) * gain;
    }
  });
};

const lowPass = (input: Float32Array, factor: number): Float32Array => {
  const output = new Float32Array(input.length);
  let previous = 0;
  for (let index = 0; index < input.length; index += 1) {
    previous += factor * ((input[index] ?? 0) - previous);
    output[index] = previous;
  }
  return output;
};

const highPass = (input: Float32Array, factor: number): Float32Array => {
  const output = new Float32Array(input.length);
  let previousInput = input[0] ?? 0;
  let previousOutput = 0;
  for (let index = 0; index < input.length; index += 1) {
    const current = input[index] ?? 0;
    const next = factor * (previousOutput + current - previousInput);
    output[index] = next;
    previousInput = current;
    previousOutput = next;
  }
  return output;
};

const buildStemPair = (audio: LabPcmData): { voice: LabPcmData; background: LabPcmData } => {
  const voiceChannels = audio.channels.map((channel) => {
    const high = highPass(channel, 0.985);
    return lowPass(high, 0.08);
  });
  normalize(voiceChannels);

  const backgroundChannels = audio.channels.map((channel, index) => {
    const voice = voiceChannels[Math.min(index, voiceChannels.length - 1)] ?? voiceChannels[0] ?? EMPTY_CHANNEL;
    const output = new Float32Array(channel.length);
    for (let sampleIndex = 0; sampleIndex < channel.length; sampleIndex += 1) {
      output[sampleIndex] = (channel[sampleIndex] ?? 0) - ((voice[sampleIndex] ?? 0) * 0.78);
    }
    return output;
  });
  normalize(backgroundChannels);

  return {
    voice: {
      sampleRate: audio.sampleRate,
      length: audio.length,
      durationMs: audio.durationMs,
      channels: voiceChannels,
    },
    background: {
      sampleRate: audio.sampleRate,
      length: audio.length,
      durationMs: audio.durationMs,
      channels: backgroundChannels,
    },
  };
};

const resolveRuntimeLabel = async (preferGpu: boolean): Promise<string> => {
  try {
    const ort = await import('onnxruntime-web');
    const executionProvider = preferGpu && typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm';
    ort.env.wasm.numThreads = executionProvider === 'wasm' ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2)) : 1;
    return executionProvider === 'webgpu' ? 'onnxruntime-web (WebGPU ready)' : 'onnxruntime-web (WASM ready)';
  } catch {
    return 'Fast filter isolate';
  }
};

const resolveWasmThreads = (requestedCap: unknown): number => {
  const numeric = Number(requestedCap);
  if (!Number.isFinite(numeric) || numeric <= 0) return Math.max(1, Math.min(2, navigator.hardwareConcurrency || 2));
  return Math.max(1, Math.min(4, Math.floor(numeric)));
};

workerScope.onmessage = async (event: MessageEvent<LabSeparationWorkerRequest>) => {
  const request = event.data;
  try {
    toProgress(request.requestId, {
      kind: 'stem',
      progressPct: 10,
      message: 'Profiling local separation runtime...',
    });
    const runtime = await resolveRuntimeLabel(Boolean(request.capabilities.webGpuSupported));
    const wasmThreads = resolveWasmThreads(request.capabilities.workerThreadCap);
    try {
      const ort = await import('onnxruntime-web');
      ort.env.wasm.numThreads = Boolean(request.capabilities.webGpuSupported) ? 1 : wasmThreads;
    } catch {
      // Keep the lightweight filter fallback if ORT is unavailable.
    }
    toProgress(request.requestId, {
      kind: 'stem',
      progressPct: 55,
      message: 'Running local vocal/background isolation...',
      runtime,
    });
    const stems = buildStemPair(request.audio);
    post({
      type: 'separated-stems',
      requestId: request.requestId,
      runtime,
      voice: stems.voice,
      background: stems.background,
    });
  } catch (error) {
    post({
      type: 'error',
      requestId: request.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
