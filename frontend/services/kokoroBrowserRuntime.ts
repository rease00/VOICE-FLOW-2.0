import { KokoroTTS } from 'kokoro-js';
import { env as transformersEnv } from '@huggingface/transformers';
import { resolveApiBaseUrl } from '../src/shared/api/config';

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
}

interface KokoroEnsureReadyOptions {
  backendBaseUrl?: string;
  voiceId?: string;
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

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DEFAULT_VOICE_ID = 'af_heart';
const DEFAULT_SAMPLE_RATE = 24000;
const DEFAULT_IDLE_MS = 30_000;
const MODEL_STATUS_PATH = '/models/kokoro/status';

const abortError = (): DOMException => new DOMException('Aborted', 'AbortError');

export const shouldUseBrowserKokoroExecution = (
  engine: string,
  context: 'studio' | 'preview' | 'dubbing' | undefined,
  executionMode: 'browser_webgpu' | 'backend_runtime' | undefined
): boolean => {
  const normalizedEngine = String(engine || '').trim().toUpperCase();
  if (normalizedEngine !== 'KOKORO') return false;
  if (executionMode === 'backend_runtime') return false;
  return context === 'studio' || context === 'preview';
};

class KokoroBrowserRuntime {
  private model: KokoroTTS | null = null;
  private loadingPromise: Promise<KokoroTTS> | null = null;
  private runtimeState: KokoroBrowserRuntimeState = 'cold';
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUsedAtMs: number = 0;
  private lastPrimeStatus: KokoroPrimeStatus | null = null;

  getState(): KokoroBrowserRuntimeState {
    return this.runtimeState;
  }

  getLastUsedAtMs(): number {
    return this.lastUsedAtMs;
  }

  getLastPrimeStatus(): KokoroPrimeStatus | null {
    return this.lastPrimeStatus;
  }

  clearSuspendTimer(): void {
    if (!this.suspendTimer) return;
    clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
  }

  private assertWebGpuAvailable(): void {
    const hasNavigator = typeof navigator !== 'undefined';
    const hasGpu = hasNavigator && typeof (navigator as any).gpu !== 'undefined';
    if (!hasGpu) {
      throw new Error('Kokoro requires WebGPU. Switch engine or use a WebGPU-enabled browser.');
    }
  }

  private configureTransformersEnv(backendBaseUrl?: string): string {
    const resolvedBackendBase = resolveApiBaseUrl(backendBaseUrl).replace(/\/+$/, '');
    const localModelPath = `${resolvedBackendBase}/models/`;

    transformersEnv.allowLocalModels = true;
    transformersEnv.allowRemoteModels = false;
    transformersEnv.localModelPath = localModelPath;
    transformersEnv.useBrowserCache = true;

    return resolvedBackendBase;
  }

  private ensureVoiceId(tts: KokoroTTS, candidateVoiceId?: string): string {
    const safeCandidate = String(candidateVoiceId || '').trim();
    const available = Object.keys(tts.voices || {});
    if (safeCandidate && available.includes(safeCandidate)) return safeCandidate;
    if (available.includes(DEFAULT_VOICE_ID)) return DEFAULT_VOICE_ID;
    return available[0] || DEFAULT_VOICE_ID;
  }

  private async fetchPrimeStatus(backendBaseUrl?: string): Promise<KokoroPrimeStatus> {
    const resolvedBackendBase = resolveApiBaseUrl(backendBaseUrl).replace(/\/+$/, '');
    const response = await fetch(`${resolvedBackendBase}${MODEL_STATUS_PATH}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => 'Unknown error');
      throw new Error(`Kokoro model status request failed (${response.status}): ${String(detail || '').slice(0, 240)}`);
    }
    const payload = await response.json() as KokoroPrimeStatus;
    this.lastPrimeStatus = payload;
    return payload;
  }

  private touch(): void {
    this.lastUsedAtMs = Date.now();
  }

  async primeAssets(backendBaseUrl?: string): Promise<KokoroPrimeStatus> {
    this.assertWebGpuAvailable();
    this.configureTransformersEnv(backendBaseUrl);

    const status = await this.fetchPrimeStatus(backendBaseUrl);
    if (!status.available || !status.ready) {
      const missing = Array.isArray(status.missing) && status.missing.length > 0
        ? ` Missing: ${status.missing.join(', ')}`
        : '';
      throw new Error(
        status.detail || `Kokoro local mirror is not ready.${missing} Run backend sync script first.`
      );
    }
    return status;
  }

  async ensureReady(options: KokoroEnsureReadyOptions = {}): Promise<KokoroTTS> {
    options.signal?.throwIfAborted?.();
    this.assertWebGpuAvailable();
    this.clearSuspendTimer();
    this.configureTransformersEnv(options.backendBaseUrl);

    if (this.model) {
      this.runtimeState = 'ready';
      this.touch();
      return this.model;
    }

    if (this.loadingPromise) {
      const pendingModel = await this.loadingPromise;
      this.runtimeState = 'ready';
      this.touch();
      return pendingModel;
    }

    this.runtimeState = 'warming';
    this.loadingPromise = (async () => {
      const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: 'fp32',
        device: 'webgpu',
      });
      return tts;
    })();

    try {
      this.model = await this.loadingPromise;
      this.runtimeState = 'ready';
      this.touch();
      return this.model;
    } finally {
      this.loadingPromise = null;
    }
  }

  async synthesizeLive(options: KokoroSynthesizeLiveOptions): Promise<KokoroSynthesizeLiveResult> {
    const safeText = String(options.text || '').trim();
    if (!safeText) throw new Error('Kokoro text is empty.');
    if (options.signal?.aborted) throw abortError();

    await this.primeAssets(options.backendBaseUrl);
    const tts = await this.ensureReady(options);
    const voiceId = this.ensureVoiceId(tts, options.voiceId);
    const speed = Math.max(0.7, Math.min(1.5, Number(options.speed || 1.0)));

    options.onProgress?.(12, 'Preparing Kokoro WebGPU runtime...');

    const chunks: KokoroLiveChunk[] = [];
    let index = 0;

    const stream = tts.stream(safeText, { voice: voiceId as any, speed });
    for await (const part of stream) {
      if (options.signal?.aborted) throw abortError();

      const rawAudio = part?.audio as any;
      const data = rawAudio?.data instanceof Float32Array ? rawAudio.data : null;
      const sampleRate = Number(rawAudio?.sampling_rate || DEFAULT_SAMPLE_RATE);
      if (!data || data.length <= 0) continue;

      const copy = new Float32Array(data.length);
      copy.set(data);
      const durationMs = Math.round((copy.length / Math.max(1, sampleRate)) * 1000);
      const chunk: KokoroLiveChunk = {
        index,
        text: String(part?.text || '').trim(),
        phonemes: String(part?.phonemes || '').trim(),
        audioData: copy,
        sampleRate,
        durationMs,
      };
      chunks.push(chunk);
      options.onChunk?.(chunk);
      const progress = Math.max(18, Math.min(97, 18 + index * 12));
      options.onProgress?.(progress, index === 0 ? 'First live chunk ready.' : 'Streaming Kokoro audio...');
      index += 1;
    }

    if (chunks.length === 0) {
      throw new Error('Kokoro produced no audio chunks.');
    }

    const sampleRate = chunks[0]?.sampleRate || DEFAULT_SAMPLE_RATE;
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.audioData.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk.audioData, offset);
      offset += chunk.audioData.length;
    }

    this.runtimeState = 'ready';
    this.touch();

    return {
      sampleRate,
      mergedAudio: merged,
      chunks,
    };
  }

  scheduleSuspend(idleMs = DEFAULT_IDLE_MS): void {
    const safeIdleMs = Math.max(1_000, Math.floor(Number(idleMs) || DEFAULT_IDLE_MS));
    this.clearSuspendTimer();
    this.suspendTimer = setTimeout(() => {
      void this.suspend();
    }, safeIdleMs);
  }

  async suspend(): Promise<void> {
    this.clearSuspendTimer();
    if (!this.model) {
      this.runtimeState = 'suspended';
      return;
    }

    const ttsAny = this.model as any;
    try {
      const modelAny = ttsAny?.model;
      if (modelAny && typeof modelAny.dispose === 'function') {
        await modelAny.dispose();
      }
      const tokenizerAny = ttsAny?.tokenizer;
      if (tokenizerAny && typeof tokenizerAny.dispose === 'function') {
        await tokenizerAny.dispose();
      }
    } catch {
      // Best-effort cleanup.
    } finally {
      this.model = null;
      this.runtimeState = 'suspended';
    }
  }
}

export const kokoroBrowserRuntime = new KokoroBrowserRuntime();
