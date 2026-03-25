import type {
  KokoroStudioWorkerErrorCode,
  KokoroStudioWorkerInitPayload,
  KokoroStudioWorkerRequest,
  KokoroStudioWorkerResponse,
  KokoroStudioWorkerSynthesizePayload,
} from './kokoroStudioWorkerContracts';

export type KokoroStudioWorkerClientState = 'idle' | 'warming' | 'ready' | 'unsupported';

export interface KokoroStudioWorkerSynthesisResult {
  sampleRate: number;
  mergedAudio: Float32Array;
  threadBudget: number;
}

interface KokoroStudioWorkerPendingTask<TValue> {
  resolve: (value: TValue) => void;
  reject: (reason?: unknown) => void;
  onProgress?: (payload: { progressPct: number; stage: string; threadBudget: number }) => void;
  onChunk?: (payload: { index: number; text: string; durationMs: number; sampleRate: number; contentType: 'audio/wav'; audioBase64: string }) => void;
  cleanup?: () => void;
}

const UNSUPPORTED_BROWSER_MESSAGE =
  'Basic WebGPU runtime is unavailable in this environment. Enable WebGPU in a secure Chromium-based browser and retry.';

const createRequestId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const createAbortError = (): DOMException => new DOMException('Aborted', 'AbortError');

const isBrowserWorkerAvailable = (): boolean => (
  typeof Worker !== 'undefined'
  && typeof window !== 'undefined'
  && typeof window.URL !== 'undefined'
);

export class KokoroStudioWorkerClientError extends Error {
  code: KokoroStudioWorkerErrorCode;
  recoverable: boolean;

  constructor(code: KokoroStudioWorkerErrorCode, message: string, recoverable = false) {
    super(message);
    this.name = 'KokoroStudioWorkerClientError';
    this.code = code;
    this.recoverable = recoverable;
  }
}

class KokoroStudioWorkerClient {
  private worker: Worker | null = null;

  private pending = new Map<string, KokoroStudioWorkerPendingTask<unknown>>();

  private state: KokoroStudioWorkerClientState = 'idle';

  private getStateSnapshot(): KokoroStudioWorkerClientState {
    return this.state;
  }

  private setState(nextState: KokoroStudioWorkerClientState): void {
    this.state = nextState;
  }

  private ensureWorker(): Worker {
    if (!isBrowserWorkerAvailable()) {
      this.setState('unsupported');
      throw new KokoroStudioWorkerClientError('UNSUPPORTED_BROWSER', UNSUPPORTED_BROWSER_MESSAGE, true);
    }
    if (this.worker) return this.worker;

    const worker = new Worker(new URL('./workers/kokoroStudio.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<KokoroStudioWorkerResponse>) => this.handleWorkerMessage(event.data);
    worker.onerror = (event: ErrorEvent) => {
      const message = String(event?.message || 'Kokoro Studio worker crashed.');
      this.rejectAll(new KokoroStudioWorkerClientError('RUNTIME_ERROR', message, true));
      this.recycleWorker();
      this.setState('idle');
    };
    this.worker = worker;
    return worker;
  }

  private handleWorkerMessage(message: KokoroStudioWorkerResponse): void {
    const requestId = String(message?.requestId || '').trim();
    if (!requestId) return;
    const task = this.pending.get(requestId);
    if (!task) return;

    if (message.type === 'progress') {
      task.onProgress?.(message.payload);
      return;
    }
    if (message.type === 'chunk') {
      task.onChunk?.(message.payload);
      return;
    }

    this.pending.delete(requestId);
    task.cleanup?.();

    if (message.type === 'error') {
      const code = message.error.code;
      if (code === 'UNSUPPORTED_BROWSER') {
        this.setState('unsupported');
      } else if (code !== 'ABORTED') {
        this.setState('idle');
      }
      if (code === 'ABORTED') {
        task.reject(createAbortError());
        return;
      }
      const fallbackMessage = code === 'UNSUPPORTED_BROWSER'
        ? UNSUPPORTED_BROWSER_MESSAGE
        : 'Kokoro Studio worker failed.';
      task.reject(new KokoroStudioWorkerClientError(code, message.error.message || fallbackMessage, Boolean(message.error.recoverable)));
      return;
    }

    if (message.type === 'init-done') {
      this.setState('ready');
      task.resolve(message.payload);
      return;
    }

    this.setState('ready');
    const mergedAudio = new Float32Array(message.payload.mergedAudio);
    task.resolve({
      sampleRate: message.payload.sampleRate,
      mergedAudio,
      threadBudget: message.payload.threadBudget,
    } satisfies KokoroStudioWorkerSynthesisResult);
  }

  private rejectAll(error: unknown): void {
    const entries = [...this.pending.entries()];
    this.pending.clear();
    entries.forEach(([, task]) => {
      task.cleanup?.();
      task.reject(error);
    });
  }

  private recycleWorker(): void {
    if (!this.worker) return;
    this.worker.terminate();
    this.worker = null;
  }

  private abortAndRecycle(targetRequestId: string): void {
    const worker = this.worker;
    if (worker) {
      const cancelEnvelope: KokoroStudioWorkerRequest = {
        type: 'cancel',
        requestId: createRequestId('kokoro_cancel'),
        targetRequestId,
      };
      try {
        worker.postMessage(cancelEnvelope);
      } catch {
        // Best effort; worker is terminated below.
      }
    }
    this.recycleWorker();
    this.setState('idle');
    this.rejectAll(createAbortError());
  }

  private runTask<TValue>(
    request: KokoroStudioWorkerRequest,
    options?: {
      signal?: AbortSignal;
      onProgress?: KokoroStudioWorkerPendingTask<TValue>['onProgress'];
      onChunk?: KokoroStudioWorkerPendingTask<TValue>['onChunk'];
    },
  ): Promise<TValue> {
    const worker = this.ensureWorker();
    const requestId = String(request.requestId || '').trim();
    if (!requestId) {
      return Promise.reject(new KokoroStudioWorkerClientError('RUNTIME_ERROR', 'Worker request id is missing.', true));
    }
    return new Promise<TValue>((resolve, reject) => {
      const task: KokoroStudioWorkerPendingTask<TValue> = {
        resolve,
        reject,
        ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
        ...(options?.onChunk ? { onChunk: options.onChunk } : {}),
      };

      if (options?.signal) {
        if (options.signal.aborted) {
          reject(createAbortError());
          return;
        }
        const onAbort = () => {
          this.abortAndRecycle(requestId);
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
        task.cleanup = () => {
          options.signal?.removeEventListener('abort', onAbort);
        };
      }

      this.pending.set(requestId, task as KokoroStudioWorkerPendingTask<unknown>);
      worker.postMessage(request);
    });
  }

  async warmup(payload: KokoroStudioWorkerInitPayload, signal?: AbortSignal): Promise<void> {
    this.setState('warming');
    await this.runTask<{ threadBudget: number }>(
      {
        type: 'init',
        requestId: createRequestId('kokoro_init'),
        payload,
      },
      { ...(signal ? { signal } : {}) },
    );
  }

  async synthesizeLive(
    payload: KokoroStudioWorkerSynthesizePayload,
    options?: {
      signal?: AbortSignal;
      onProgress?: (payload: { progressPct: number; stage: string; threadBudget: number }) => void;
      onChunk?: (payload: { index: number; text: string; durationMs: number; sampleRate: number; contentType: 'audio/wav'; audioBase64: string }) => void;
    },
  ): Promise<KokoroStudioWorkerSynthesisResult> {
    this.setState('warming');
    const result = await this.runTask<KokoroStudioWorkerSynthesisResult>(
      {
        type: 'synthesize',
        requestId: createRequestId('kokoro_synth'),
        payload,
      },
      {
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
        ...(options?.onChunk ? { onChunk: options.onChunk } : {}),
      },
    );
    return result;
  }

  getState(): KokoroStudioWorkerClientState {
    return this.getStateSnapshot();
  }
}

const client = new KokoroStudioWorkerClient();

export const synthesizeKokoroStudioInWorker = (
  payload: KokoroStudioWorkerSynthesizePayload,
  options?: {
    signal?: AbortSignal;
    onProgress?: (payload: { progressPct: number; stage: string; threadBudget: number }) => void;
    onChunk?: (payload: { index: number; text: string; durationMs: number; sampleRate: number; contentType: 'audio/wav'; audioBase64: string }) => void;
  },
): Promise<KokoroStudioWorkerSynthesisResult> => {
  return client.synthesizeLive(payload, options);
};

export const warmupKokoroStudioWorker = (
  payload: KokoroStudioWorkerInitPayload,
  signal?: AbortSignal,
): Promise<void> => {
  return client.warmup(payload, signal);
};

export const getKokoroStudioWorkerState = (): KokoroStudioWorkerClientState => {
  return client.getState();
};

export const isKokoroStudioWorkerSupported = (): boolean => isBrowserWorkerAvailable();
