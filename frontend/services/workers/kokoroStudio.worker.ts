/// <reference lib="webworker" />

import { kokoroBrowserRuntime, type KokoroLiveChunk } from '../kokoroBrowserRuntime.impl';
import {
  type KokoroStudioWorkerErrorCode,
  type KokoroStudioWorkerInitPayload,
  type KokoroStudioWorkerRequest,
  type KokoroStudioWorkerResponse,
  type KokoroStudioWorkerSynthesizePayload,
} from '../kokoroStudioWorkerContracts';
import { resolveKokoroStudioThreadBudget } from '../kokoroStudioWorkerPolicy';

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
const KOKORO_WORKER_IDLE_MS = 300_000;

let activeRequestId = '';
let lastThreadBudget = 1;
const cancelledRequestIds = new Set<string>();

const createUnsupportedBrowserMessage = (): string => (
  'Basic browser runtime is unavailable in this environment. Reload the tab, close heavy tabs, and update to the latest Chromium-based browser.'
);

const createRuntimeError = (
  code: KokoroStudioWorkerErrorCode,
  message: string,
  recoverable = false,
) => ({
  code,
  message: String(message || 'Kokoro Studio worker failed.').trim(),
  recoverable,
});

const post = (payload: KokoroStudioWorkerResponse, transfer?: Transferable[]): void => {
  if (Array.isArray(transfer) && transfer.length > 0) {
    workerScope.postMessage(payload, transfer);
    return;
  }
  workerScope.postMessage(payload);
};

const isAbortError = (error: unknown): boolean => {
  const name = String((error as any)?.name || '').trim().toLowerCase();
  const message = String((error as any)?.message || '').trim().toLowerCase();
  return name === 'aborterror' || message.includes('aborted');
};

const assertNotCancelled = (requestId: string): void => {
  if (!cancelledRequestIds.has(requestId)) return;
  throw new DOMException('Aborted', 'AbortError');
};

const applyThreadBudget = async (): Promise<number> => {
  const threadBudget = resolveKokoroStudioThreadBudget(workerScope.navigator?.hardwareConcurrency);
  try {
    const ort = await import('onnxruntime-web');
    if (ort?.env?.wasm) {
      ort.env.wasm.numThreads = threadBudget;
    }
  } catch {
    throw createRuntimeError('UNSUPPORTED_BROWSER', createUnsupportedBrowserMessage(), true);
  }
  lastThreadBudget = threadBudget;
  return threadBudget;
};

const writeAscii = (view: DataView, offset: number, value: string): number => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
  return offset + value.length;
};

const float32ToWav = (source: Float32Array, sampleRate: number): ArrayBuffer => {
  const frameCount = Math.max(0, source.length);
  const channelCount = 1;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataBytes = frameCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  let offset = 0;

  offset = writeAscii(view, offset, 'RIFF');
  view.setUint32(offset, 36 + dataBytes, true); offset += 4;
  offset = writeAscii(view, offset, 'WAVE');
  offset = writeAscii(view, offset, 'fmt ');
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, channelCount, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, byteRate, true); offset += 4;
  view.setUint16(offset, blockAlign, true); offset += 2;
  view.setUint16(offset, bytesPerSample * 8, true); offset += 2;
  offset = writeAscii(view, offset, 'data');
  view.setUint32(offset, dataBytes, true); offset += 4;

  for (let index = 0; index < frameCount; index += 1) {
    const sample = Math.max(-1, Math.min(1, source[index] || 0));
    const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(offset, Math.round(pcm), true);
    offset += 2;
  }
  return buffer;
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)));
  }
  return workerScope.btoa(binary);
};

const ensureReady = async (
  requestId: string,
  payload: KokoroStudioWorkerInitPayload,
): Promise<number> => {
  assertNotCancelled(requestId);
  const threadBudget = await applyThreadBudget();
  assertNotCancelled(requestId);
  await kokoroBrowserRuntime.ensureReady({
    backendBaseUrl: payload.backendBaseUrl,
    voiceId: payload.voiceId,
    ...(payload.language ? { language: payload.language } : {}),
    ...(typeof payload.speed === 'number' ? { speed: payload.speed } : {}),
  });
  return threadBudget;
};

const emitChunk = (requestId: string, chunk: KokoroLiveChunk): void => {
  const source = chunk.audioData instanceof Float32Array ? chunk.audioData : new Float32Array(0);
  const sampleRate = Math.max(1, Math.floor(Number(chunk.sampleRate || 0) || 1));
  const wavBuffer = float32ToWav(source, sampleRate);
  const audioBase64 = arrayBufferToBase64(wavBuffer);
  post(
    {
      type: 'chunk',
      requestId,
      payload: {
        index: Math.max(0, Math.floor(Number(chunk.index || 0))),
        text: String(chunk.text || ''),
        durationMs: Math.max(0, Math.floor(Number(chunk.durationMs || 0))),
        sampleRate,
        contentType: 'audio/wav',
        audioBase64,
      },
    },
  );
};

const handleInitRequest = async (requestId: string, payload: KokoroStudioWorkerInitPayload): Promise<void> => {
  const threadBudget = await ensureReady(requestId, payload);
  assertNotCancelled(requestId);
  post({
    type: 'init-done',
    requestId,
    payload: {
      threadBudget,
    },
  });
};

const handleSynthesizeRequest = async (
  requestId: string,
  payload: KokoroStudioWorkerSynthesizePayload,
): Promise<void> => {
  assertNotCancelled(requestId);
  const threadBudget = await ensureReady(requestId, payload);
  assertNotCancelled(requestId);

  const safeText = String(payload.text || '').trim();
  if (!safeText) {
    throw createRuntimeError('RUNTIME_ERROR', 'Input text is empty.', true);
  }

  const result = await kokoroBrowserRuntime.synthesizeLive({
    text: safeText,
    voiceId: String(payload.voiceId || '').trim() || 'af_heart',
    speed: Number(payload.speed || 1) || 1,
    ...(payload.language ? { language: payload.language } : {}),
    backendBaseUrl: payload.backendBaseUrl,
    onProgress: (progress, stage) => {
      if (cancelledRequestIds.has(requestId)) return;
      post({
        type: 'progress',
        requestId,
        payload: {
          progressPct: Math.max(1, Math.min(99, Math.round(Number(progress || 0)))),
          stage: String(stage || 'Generating audio...'),
          threadBudget,
        },
      });
    },
    onChunk: (chunk) => {
      if (cancelledRequestIds.has(requestId)) return;
      emitChunk(requestId, chunk);
    },
  });
  assertNotCancelled(requestId);

  kokoroBrowserRuntime.scheduleSuspend(KOKORO_WORKER_IDLE_MS);
  const merged = result.mergedAudio instanceof Float32Array ? result.mergedAudio : new Float32Array(0);
  post(
    {
      type: 'done',
      requestId,
      payload: {
        sampleRate: Math.max(1, Math.floor(Number(result.sampleRate || 0) || 1)),
        mergedAudio: merged.buffer,
        threadBudget: Number.isFinite(lastThreadBudget) ? lastThreadBudget : threadBudget,
      },
    },
    [merged.buffer],
  );
};

workerScope.onmessage = async (event: MessageEvent<KokoroStudioWorkerRequest>) => {
  const request = event.data;
  const requestId = String(request?.requestId || '').trim();
  if (!requestId) return;

  if (request.type === 'cancel') {
    const targetRequestId = String(request.targetRequestId || '').trim();
    if (targetRequestId) {
      cancelledRequestIds.add(targetRequestId);
    }
    return;
  }

  if (activeRequestId && activeRequestId !== requestId) {
    post({
      type: 'error',
      requestId,
      error: createRuntimeError(
        'RUNTIME_ERROR',
        'Another Kokoro Studio job is already running in this worker.',
        true,
      ),
    });
    return;
  }

  activeRequestId = requestId;
  try {
    if (request.type === 'init') {
      await handleInitRequest(requestId, request.payload);
      return;
    }
    await handleSynthesizeRequest(requestId, request.payload);
  } catch (error: unknown) {
    if (isAbortError(error) || cancelledRequestIds.has(requestId)) {
      post({
        type: 'error',
        requestId,
        error: createRuntimeError('ABORTED', 'Kokoro Studio synthesis was cancelled.', true),
      });
      return;
    }
    const workerError = error as { code?: string; message?: string; recoverable?: boolean };
    if (
      workerError
      && typeof workerError === 'object'
      && typeof workerError.code === 'string'
      && typeof workerError.message === 'string'
    ) {
      const safeCode = workerError.code === 'UNSUPPORTED_BROWSER'
        ? 'UNSUPPORTED_BROWSER'
        : workerError.code === 'ABORTED'
          ? 'ABORTED'
          : 'RUNTIME_ERROR';
      post({
        type: 'error',
        requestId,
        error: createRuntimeError(safeCode, workerError.message, Boolean(workerError.recoverable)),
      });
      return;
    }
    post({
      type: 'error',
      requestId,
      error: createRuntimeError(
        'RUNTIME_ERROR',
        error instanceof Error ? error.message : 'Kokoro Studio worker crashed.',
        true,
      ),
    });
  } finally {
    cancelledRequestIds.delete(requestId);
    if (activeRequestId === requestId) {
      activeRequestId = '';
    }
  }
};
