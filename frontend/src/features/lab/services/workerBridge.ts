interface WorkerRequestEnvelope {
  requestId: string;
}

interface WorkerProgressEnvelope extends WorkerRequestEnvelope {
  type: 'progress';
  payload: {
    progressPct: number;
    message: string;
    runtime?: string;
  };
}

interface WorkerErrorEnvelope extends WorkerRequestEnvelope {
  type: 'error';
  error: string;
}

type WorkerTerminalEnvelope = WorkerRequestEnvelope & { type: string };
type WorkerResponseEnvelope = WorkerProgressEnvelope | WorkerErrorEnvelope | WorkerTerminalEnvelope;

type PendingTask<TResponse extends WorkerTerminalEnvelope> = {
  resolve: (value: TResponse) => void;
  reject: (reason?: unknown) => void;
  onProgress?: (payload: WorkerProgressEnvelope['payload']) => void;
  abortCleanup?: () => void;
};

export class WorkerBridge<
  TRequest extends WorkerRequestEnvelope,
  TResponse extends WorkerResponseEnvelope,
  TTerminal extends Extract<TResponse, WorkerTerminalEnvelope>
> {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingTask<TTerminal>>();

  constructor(private readonly createWorker: () => Worker) {}

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = (event: MessageEvent<TResponse>) => {
      const payload = event.data;
      const requestId = String(payload?.requestId || '').trim();
      if (!requestId) return;
      const task = this.pending.get(requestId);
      if (!task) return;
      if (payload.type === 'progress') {
        task.onProgress?.((payload as WorkerProgressEnvelope).payload);
        return;
      }
      this.pending.delete(requestId);
      if (payload.type === 'error') {
        task.abortCleanup?.();
        task.reject(new Error((payload as WorkerErrorEnvelope).error || 'Worker task failed.'));
        return;
      }
      task.abortCleanup?.();
      task.resolve(payload as unknown as TTerminal);
    };
    worker.onerror = (error) => {
      const message = error.message || 'Worker execution failed.';
      const pending = Array.from(this.pending.values());
      this.pending.clear();
      pending.forEach((task) => {
        task.abortCleanup?.();
        task.reject(new Error(message));
      });
    };
    this.worker = worker;
    return worker;
  }

  run(
    request: TRequest,
    options?: {
      onProgress?: (payload: WorkerProgressEnvelope['payload']) => void;
      signal?: AbortSignal;
    }
  ): Promise<TTerminal> {
    const worker = this.ensureWorker();
    const requestId = String(request.requestId || '').trim();
    if (!requestId) {
      return Promise.reject(new Error('Worker request is missing requestId.'));
    }

    return new Promise<TTerminal>((resolve, reject) => {
      const task: PendingTask<TTerminal> = { resolve, reject };
      if (options?.onProgress) {
        task.onProgress = options.onProgress;
      }
      if (options?.signal) {
        if (options.signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        const onAbort = () => {
          this.pending.delete(requestId);
          task.abortCleanup?.();
          reject(new DOMException('Aborted', 'AbortError'));
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
        task.abortCleanup = () => {
          options.signal?.removeEventListener('abort', onAbort);
        };
      }
      this.pending.set(requestId, task);
      worker.postMessage(request);
    });
  }

  terminate(): void {
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }
}
