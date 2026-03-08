export type KokoroBrowserRuntimeState = 'cold' | 'warming' | 'ready' | 'suspended';

export interface KokoroLiveChunk {
  index: number;
  text: string;
  phonemes: string;
  audioData: Float32Array;
  sampleRate: number;
  durationMs: number;
}

export interface KokoroPrimeStatus {
  ok: boolean;
  available: boolean;
  repoId: string;
  revision: string;
  modelPath: string;
  fileCount: number;
  totalBytes: number;
  ready: boolean;
  missing: string[];
  hash: string;
  fetchedAt: string;
  detail?: string;
  runtime?: {
    device?: string;
    dtype?: string;
    modelFile?: string;
  };
}

interface KokoroEnsureReadyOptions {
  backendBaseUrl?: string;
  voiceId?: string;
  language?: string;
  speed?: number;
  signal?: AbortSignal;
}

interface KokoroSynthesizeLiveOptions extends KokoroEnsureReadyOptions {
  text: string;
  voiceId: string;
  speed: number;
  onChunk?: (chunk: KokoroLiveChunk) => void;
  onProgress?: (progress: number, stage: string) => void;
}

interface KokoroSynthesizeLiveResult {
  sampleRate: number;
  mergedAudio: Float32Array;
  chunks: KokoroLiveChunk[];
}

interface KokoroBrowserRuntimeLike {
  getState(): KokoroBrowserRuntimeState;
  getLastUsedAtMs(): number;
  getLastPrimeStatus(): KokoroPrimeStatus | null;
  primeAssets(backendBaseUrl?: string, voiceId?: string): Promise<KokoroPrimeStatus>;
  ensureReady(options?: KokoroEnsureReadyOptions): Promise<unknown>;
  synthesizeLive(options: KokoroSynthesizeLiveOptions): Promise<KokoroSynthesizeLiveResult>;
  scheduleSuspend(idleMs?: number): void;
  suspend(): Promise<void>;
}

type KokoroRuntimeModule = typeof import('./kokoroBrowserRuntime.impl');

export {
  isBrowserKokoroExecutionEnabled,
  shouldUseBrowserKokoroExecution,
} from './kokoroBrowserRuntimeFlags';

let runtimeModulePromise: Promise<KokoroRuntimeModule> | null = null;
let loadedRuntime: KokoroBrowserRuntimeLike | null = null;
let cachedState: KokoroBrowserRuntimeState = 'cold';
let cachedLastUsedAtMs = 0;
let cachedPrimeStatus: KokoroPrimeStatus | null = null;

const syncSnapshot = (runtime: KokoroBrowserRuntimeLike | null): void => {
  if (!runtime) return;
  cachedState = runtime.getState();
  cachedLastUsedAtMs = runtime.getLastUsedAtMs();
  cachedPrimeStatus = runtime.getLastPrimeStatus();
};

const getLoadedRuntime = (): KokoroBrowserRuntimeLike | null => {
  if (!loadedRuntime) return null;
  syncSnapshot(loadedRuntime);
  return loadedRuntime;
};

const loadRuntimeModule = async (): Promise<KokoroBrowserRuntimeLike> => {
  if (!runtimeModulePromise) {
    runtimeModulePromise = import('./kokoroBrowserRuntime.impl');
  }
  const runtimeModule = await runtimeModulePromise;
  loadedRuntime = runtimeModule.kokoroBrowserRuntime as KokoroBrowserRuntimeLike;
  syncSnapshot(loadedRuntime);
  return loadedRuntime;
};

const withRuntime = async <T>(callback: (runtime: KokoroBrowserRuntimeLike) => Promise<T> | T): Promise<T> => {
  const runtime = await loadRuntimeModule();
  const result = await callback(runtime);
  syncSnapshot(runtime);
  return result;
};

export const kokoroBrowserRuntime: KokoroBrowserRuntimeLike = {
  getState(): KokoroBrowserRuntimeState {
    return getLoadedRuntime()?.getState() || cachedState;
  },
  getLastUsedAtMs(): number {
    return getLoadedRuntime()?.getLastUsedAtMs() || cachedLastUsedAtMs;
  },
  getLastPrimeStatus(): KokoroPrimeStatus | null {
    return getLoadedRuntime()?.getLastPrimeStatus() || cachedPrimeStatus;
  },
  async primeAssets(backendBaseUrl?: string, voiceId?: string): Promise<KokoroPrimeStatus> {
    return withRuntime(async (runtime) => {
      const status = await runtime.primeAssets(backendBaseUrl, voiceId);
      cachedPrimeStatus = status;
      return status;
    });
  },
  async ensureReady(options: KokoroEnsureReadyOptions = {}): Promise<unknown> {
    cachedState = 'warming';
    return withRuntime((runtime) => runtime.ensureReady(options));
  },
  async synthesizeLive(options: KokoroSynthesizeLiveOptions): Promise<KokoroSynthesizeLiveResult> {
    cachedState = 'warming';
    return withRuntime((runtime) => runtime.synthesizeLive(options));
  },
  scheduleSuspend(idleMs?: number): void {
    const runtime = getLoadedRuntime();
    if (!runtime) return;
    runtime.scheduleSuspend(idleMs);
    syncSnapshot(runtime);
  },
  async suspend(): Promise<void> {
    const runtime = getLoadedRuntime();
    if (!runtime && !runtimeModulePromise) {
      cachedState = 'suspended';
      cachedLastUsedAtMs = 0;
      cachedPrimeStatus = null;
      return;
    }
    await withRuntime((activeRuntime) => activeRuntime.suspend());
  },
};
