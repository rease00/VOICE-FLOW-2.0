// Lazy-loaded heavy Kokoro browser runtime implementation.
import { KokoroTTS } from 'kokoro-js';
import { env as transformersEnv } from '@huggingface/transformers';
import { resolveApiBaseUrl } from '../src/shared/api/config';
import { isBrowserKokoroExecutionEnabled } from './kokoroBrowserRuntimeFlags';

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

interface KokoroExecutionConfig {
  device: 'wasm';
  dtype: 'q8' | 'fp32';
}

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const MODEL_STATUS_PATH = '/models/kokoro/status';
const DEFAULT_VOICE_ID = 'af_heart';
const DEFAULT_SAMPLE_RATE = 24000;
const DEFAULT_IDLE_MS = 120_000;
const PRIME_STATUS_TTL_MS = 60_000;
const HINDI_VOICES = new Set(['hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi']);
const FEMALE_VOICES = new Set(['af_heart', 'af_bella', 'af_nova', 'af_sarah', 'bf_emma', 'bf_isabella', 'hf_alpha', 'hf_beta']);
const MALE_VOICES = new Set(['am_fenrir', 'am_michael', 'am_onyx', 'am_echo', 'bm_george', 'bm_fable', 'hm_omega', 'hm_psi']);
const HINDI_LANGUAGE_HINTS = new Set(['hi', 'hin', 'hindi', 'hinglish', 'hi-latn', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'pa', 'or', 'ur', 'ne', 'si']);
const KOKORO_HINDI_COMPATIBLE_VOICES = new Map<string, string>([
  ['af_heart', 'hf_alpha'],
  ['af_bella', 'hf_beta'],
  ['af_nova', 'hf_alpha'],
  ['af_sarah', 'hf_beta'],
  ['bf_emma', 'hf_alpha'],
  ['bf_isabella', 'hf_beta'],
  ['am_fenrir', 'hm_omega'],
  ['am_michael', 'hm_psi'],
  ['am_onyx', 'hm_omega'],
  ['am_echo', 'hm_psi'],
  ['bm_george', 'hm_omega'],
  ['bm_fable', 'hm_psi'],
]);
const KOKORO_ENGLISH_COMPATIBLE_VOICES = new Map<string, string>([
  ['hf_alpha', 'af_heart'],
  ['hf_beta', 'af_bella'],
  ['hm_omega', 'am_fenrir'],
  ['hm_psi', 'am_michael'],
]);
const KOKORO_VOICE_CACHE = 'kokoro-voices';
const HUGGING_FACE_VOICE_URL_PREFIX = `https://huggingface.co/${MODEL_ID}/resolve/main/voices/`;
const VIRAMA = '\u094d';
const ANUSVARA = '\u0902';
const CHANDRABINDU = '\u0901';
const VISARGA = '\u0903';

const DEVANAGARI_TO_ROMAN: Record<string, string> = {
  '\u0905': 'a',
  '\u0906': 'aa',
  '\u0907': 'i',
  '\u0908': 'ii',
  '\u0909': 'u',
  '\u090a': 'uu',
  '\u090f': 'e',
  '\u0910': 'ai',
  '\u0913': 'o',
  '\u0914': 'au',
  '\u090b': 'ri',
  '\u0915': 'k',
  '\u0916': 'kh',
  '\u0917': 'g',
  '\u0918': 'gh',
  '\u0919': 'ng',
  '\u091a': 'ch',
  '\u091b': 'chh',
  '\u091c': 'j',
  '\u091d': 'jh',
  '\u091e': 'ny',
  '\u091f': 't',
  '\u0920': 'th',
  '\u0921': 'd',
  '\u0922': 'dh',
  '\u0923': 'n',
  '\u0924': 't',
  '\u0925': 'th',
  '\u0926': 'd',
  '\u0927': 'dh',
  '\u0928': 'n',
  '\u092a': 'p',
  '\u092b': 'ph',
  '\u092c': 'b',
  '\u092d': 'bh',
  '\u092e': 'm',
  '\u092f': 'y',
  '\u0930': 'r',
  '\u0932': 'l',
  '\u0935': 'v',
  '\u0936': 'sh',
  '\u0937': 'sh',
  '\u0938': 's',
  '\u0939': 'h',
  '\u0958': 'q',
  '\u0959': 'kh',
  '\u095a': 'gh',
  '\u095b': 'z',
  '\u095c': 'r',
  '\u095d': 'rh',
  '\u095e': 'f',
  '\u095f': 'y',
};

const DEVANAGARI_MATRAS: Record<string, string> = {
  '\u093e': 'aa',
  '\u093f': 'i',
  '\u0940': 'ii',
  '\u0941': 'u',
  '\u0942': 'uu',
  '\u0943': 'ri',
  '\u0947': 'e',
  '\u0948': 'ai',
  '\u094b': 'o',
  '\u094c': 'au',
  '\u0946': 'e',
  '\u094a': 'o',
};

const DEVANAGARI_INDEPENDENT_VOWELS = new Set([
  '\u0905',
  '\u0906',
  '\u0907',
  '\u0908',
  '\u0909',
  '\u090a',
  '\u090f',
  '\u0910',
  '\u0913',
  '\u0914',
  '\u090b',
]);

const HINDI_DIGITS: Record<string, string> = {
  '0': 'shunya',
  '1': 'ek',
  '2': 'do',
  '3': 'teen',
  '4': 'chaar',
  '5': 'paanch',
  '6': 'chhe',
  '7': 'saat',
  '8': 'aath',
  '9': 'nau',
};

const abortError = (): DOMException => new DOMException('Aborted', 'AbortError');

const normalizeVoiceLookupToken = (value: string): string => (
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
);

const KOKORO_VOICE_ALIASES: Array<[string, string]> = [
  ['af_heart', 'af_heart'],
  ['lyra us', 'af_heart'],
  ['af_bella', 'af_bella'],
  ['kaia us', 'af_bella'],
  ['af_nova', 'af_nova'],
  ['mira us', 'af_nova'],
  ['af_sarah', 'af_sarah'],
  ['zoya us', 'af_sarah'],
  ['am_fenrir', 'am_fenrir'],
  ['rian us', 'am_fenrir'],
  ['am_michael', 'am_michael'],
  ['lucan us', 'am_michael'],
  ['am_onyx', 'am_onyx'],
  ['soren us', 'am_onyx'],
  ['am_echo', 'am_echo'],
  ['darian us', 'am_echo'],
  ['bf_emma', 'bf_emma'],
  ['elara uk', 'bf_emma'],
  ['bf_isabella', 'bf_isabella'],
  ['cora uk', 'bf_isabella'],
  ['bm_george', 'bm_george'],
  ['alden uk', 'bm_george'],
  ['bm_fable', 'bm_fable'],
  ['osric uk', 'bm_fable'],
  ['hf_alpha', 'hf_alpha'],
  ['kavya in', 'hf_alpha'],
  ['hf_beta', 'hf_beta'],
  ['isha in', 'hf_beta'],
  ['hm_omega', 'hm_omega'],
  ['aarav in', 'hm_omega'],
  ['hm_psi', 'hm_psi'],
  ['veer in', 'hm_psi'],
];

const KOKORO_VOICE_ALIAS_TO_ID = new Map<string, string>(
  KOKORO_VOICE_ALIASES.map(([alias, voiceId]) => [normalizeVoiceLookupToken(alias), voiceId])
);

const canonicalizeVoiceId = (candidateVoiceId?: string): string => {
  const raw = String(candidateVoiceId || '').trim();
  if (!raw) return '';
  const normalized = normalizeVoiceLookupToken(raw);
  return KOKORO_VOICE_ALIAS_TO_ID.get(normalized) || raw;
};

const normalizeLanguageHint = (language?: string): string => {
  const raw = String(language || '').trim().toLowerCase();
  if (!raw) return '';
  const dashSplit = raw.split('-', 1)[0] || raw;
  const base = dashSplit.split('_', 1)[0] || dashSplit;
  if (HINDI_LANGUAGE_HINTS.has(raw) || HINDI_LANGUAGE_HINTS.has(base)) return 'hi';
  if (raw.startsWith('en') || base === 'en' || raw === 'english') return 'en';
  return base;
};

const isHindiLanguageHint = (language?: string): boolean => (
  normalizeLanguageHint(language) === 'hi'
);

const resolveCompatibleVoiceId = (
  candidateVoiceId?: string,
  languageHint?: string,
  isHindiText = false,
): string => {
  const voiceId = canonicalizeVoiceId(candidateVoiceId) || DEFAULT_VOICE_ID;
  if (isHindiText || isHindiLanguageHint(languageHint)) {
    if (HINDI_VOICES.has(voiceId)) return voiceId;
    const mapped = KOKORO_HINDI_COMPATIBLE_VOICES.get(voiceId);
    if (mapped) return mapped;
    if (MALE_VOICES.has(voiceId)) return 'hm_omega';
    return 'hf_alpha';
  }
  if (normalizeLanguageHint(languageHint) === 'en' && HINDI_VOICES.has(voiceId)) {
    const mapped = KOKORO_ENGLISH_COMPATIBLE_VOICES.get(voiceId);
    if (mapped) return mapped;
    if (FEMALE_VOICES.has(voiceId)) return 'af_heart';
    return 'am_fenrir';
  }
  return voiceId;
};

const containsDevanagari = (text: string): boolean => /[\u0900-\u097F]/.test(text);

const normalizeHindiText = (text: string): string => (
  String(text || '')
    .normalize('NFC')
    .replace(/[\u200c\u200d]/g, '')
    .replace(/\u0964|\u0965/g, '. ')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
);

const expandDigitsForHindiRomanization = (text: string): string => (
  text.replace(/[0-9\u0966-\u096f]/g, (digit) => {
    if (digit >= '0' && digit <= '9') return HINDI_DIGITS[digit] || digit;
    const normalizedDigit = String(digit.codePointAt(0)! - 0x0966);
    return HINDI_DIGITS[normalizedDigit] || digit;
  })
);

const transliterateHindiToRoman = (text: string): string => {
  const source = expandDigitsForHindiRomanization(text);
  let output = '';

  for (let index = 0; index < source.length; index += 1) {
    const ch = source[index]!;

    if (ch === ANUSVARA || ch === CHANDRABINDU) {
      output += 'n';
      continue;
    }
    if (ch === VISARGA) {
      output += 'h';
      continue;
    }

    const base = DEVANAGARI_TO_ROMAN[ch];
    if (!base) {
      output += ch;
      continue;
    }

    if (DEVANAGARI_INDEPENDENT_VOWELS.has(ch)) {
      output += base;
      continue;
    }

    const next = source[index + 1];
    if (next === VIRAMA) {
      output += base;
      index += 1;
      continue;
    }

    const matra = next ? DEVANAGARI_MATRAS[next] : undefined;
    if (matra) {
      output += `${base}${matra}`;
      index += 1;
      continue;
    }

    output += `${base}a`;
  }

  return output
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
};

const prepareTextForKokoro = (text: string): { preparedText: string; isHindi: boolean } => {
  const normalized = normalizeHindiText(text);
  if (!containsDevanagari(normalized)) {
    return { preparedText: normalized, isHindi: false };
  }
  return {
    preparedText: transliterateHindiToRoman(normalized),
    isHindi: true,
  };
};

const splitUnitByWords = (unit: string, maxLen: number): string[] => {
  const words = unit.split(/\s+/).map((word) => word.trim()).filter(Boolean);
  if (words.length <= 1) return [unit];

  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    const candidate = `${current} ${word}`.trim();
    if (candidate.length <= maxLen) {
      current = candidate;
      continue;
    }
    chunks.push(current);
    current = word;
  }

  if (current) chunks.push(current);
  return chunks.filter(Boolean);
};

const splitOversizedUnit = (unit: string, maxLen: number): string[] => {
  const normalized = String(unit || '').trim();
  if (!normalized) return [];
  if (normalized.length <= maxLen) return [normalized];

  const punctuationSegments = normalized
    .split(/(?<=[,;:])\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (punctuationSegments.length > 1) {
    return punctuationSegments.flatMap((segment) => splitOversizedUnit(segment, maxLen));
  }

  return splitUnitByWords(normalized, maxLen);
};

const splitForStableTokenization = (text: string, isHindi: boolean): string[] => {
  const rawUnits = text.match(/[^.!?\n]+[.!?]?/g)?.map((item) => item.trim()).filter(Boolean) || [text];
  const maxLen = isHindi ? 96 : 110;
  const units = rawUnits.flatMap((unit) => splitOversizedUnit(unit, maxLen));
  const chunks: string[] = [];
  let current = '';

  for (const unit of units) {
    if (!current) {
      current = unit;
      continue;
    }
    const candidate = `${current} ${unit}`.trim();
    if (candidate.length <= maxLen) {
      current = candidate;
      continue;
    }
    chunks.push(current);
    current = unit;
  }

  if (current) chunks.push(current);
  return chunks.filter((chunk) => chunk.length > 0);
};

const isBuiltInVoice = (tts: KokoroTTS, voiceId: string): boolean => (
  Object.prototype.hasOwnProperty.call(tts.voices || {}, voiceId)
);

const hasValidAudio = (audio: any): boolean => (
  Boolean(
    (audio?.audio instanceof Float32Array && audio.audio.length > 0)
    || (audio?.data instanceof Float32Array && audio.data.length > 0),
  )
);

const mergeChunkAudio = (parts: Float32Array[]): Float32Array => {
  const total = parts.reduce((sum, item) => sum + item.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  parts.forEach((part) => {
    merged.set(part, offset);
    offset += part.length;
  });
  return merged;
};

export const shouldUseBrowserKokoroExecution = (
  engine: string,
  context: 'studio' | 'preview' | 'dubbing' | undefined,
): boolean => {
  if (!isBrowserKokoroExecutionEnabled()) return false;
  const normalizedEngine = String(engine || '').trim().toUpperCase();
  if (normalizedEngine !== 'KOKORO') return false;
  return context === 'studio' || context === 'preview';
};

class KokoroBrowserRuntime {
  private model: KokoroTTS | null = null;
  private loadingPromise: Promise<KokoroTTS> | null = null;
  private runtimeState: KokoroBrowserRuntimeState = 'cold';
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUsedAtMs = 0;
  private lastPrimeStatus: KokoroPrimeStatus | null = null;
  private primeStatusCache: { backendBaseUrl: string; fetchedAtMs: number; status: KokoroPrimeStatus } | null = null;
  private primeStatusPromise: { backendBaseUrl: string; promise: Promise<KokoroPrimeStatus> } | null = null;
  private primedVoiceAssetKeys = new Set<string>();
  private voicePrimePromises = new Map<string, Promise<void>>();
  private browserExecutionConfigOverride: KokoroExecutionConfig | null = null;

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

  private configureTransformersEnv(backendBaseUrl?: string): string {
    const resolvedBackendBase = resolveApiBaseUrl(backendBaseUrl).replace(/\/+$/, '');
    transformersEnv.allowLocalModels = true;
    transformersEnv.allowRemoteModels = false;
    transformersEnv.localModelPath = `${resolvedBackendBase}/models/`;
    transformersEnv.useBrowserCache = true;
    return resolvedBackendBase;
  }

  private touch(): void {
    this.lastUsedAtMs = Date.now();
  }

  private supportsWebGpuExecution(): boolean {
    const navigatorGpu = typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & { gpu?: unknown }).gpu;
    return (
      typeof window !== 'undefined'
      && window.isSecureContext !== false
      && Boolean(navigatorGpu)
    );
  }

  private resolveExecutionConfig(): KokoroExecutionConfig {
    if (this.browserExecutionConfigOverride) {
      return this.browserExecutionConfigOverride;
    }
    return { device: 'wasm', dtype: 'q8' };
  }

  private async loadModelWithBestAvailableDevice(): Promise<KokoroTTS> {
    const preferred = this.resolveExecutionConfig();
    const attempts: KokoroExecutionConfig[] = [preferred];
    let lastError: unknown = null;

    for (const config of attempts) {
      try {
        const model = await KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: config.dtype,
          device: config.device,
        });
        this.browserExecutionConfigOverride = config;
        return model;
      } catch (error: unknown) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Kokoro browser runtime could not initialize.');
  }

  private ensureVoiceId(tts: KokoroTTS, candidateVoiceId?: string): string {
    const requested = canonicalizeVoiceId(candidateVoiceId);
    if (requested) {
      return requested;
    }
    const available = Object.keys(tts.voices || {});
    if (available.includes(DEFAULT_VOICE_ID)) return DEFAULT_VOICE_ID;
    return available[0] || DEFAULT_VOICE_ID;
  }

  private async fetchPrimeStatus(backendBaseUrl?: string): Promise<KokoroPrimeStatus> {
    const resolvedBackendBase = resolveApiBaseUrl(backendBaseUrl).replace(/\/+$/, '');
    const cached = this.primeStatusCache;
    if (
      cached
      && cached.backendBaseUrl === resolvedBackendBase
      && (Date.now() - cached.fetchedAtMs) < PRIME_STATUS_TTL_MS
      && cached.status.available
      && cached.status.ready
    ) {
      this.lastPrimeStatus = cached.status;
      return cached.status;
    }
    if (
      this.primeStatusPromise
      && this.primeStatusPromise.backendBaseUrl === resolvedBackendBase
    ) {
      const status = await this.primeStatusPromise.promise;
      this.lastPrimeStatus = status;
      return status;
    }
    const pendingPromise = (async () => {
      const response = await fetch(`${resolvedBackendBase}${MODEL_STATUS_PATH}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => 'Unknown error');
        throw new Error(`Kokoro model status request failed (${response.status}): ${String(detail || '').slice(0, 240)}`);
      }
      const payload = await response.json() as KokoroPrimeStatus;
      this.primeStatusCache = {
        backendBaseUrl: resolvedBackendBase,
        fetchedAtMs: Date.now(),
        status: payload,
      };
      this.lastPrimeStatus = payload;
      return payload;
    })();
    this.primeStatusPromise = {
      backendBaseUrl: resolvedBackendBase,
      promise: pendingPromise,
    };
    try {
      return await pendingPromise;
    } finally {
      if (this.primeStatusPromise?.promise === pendingPromise) {
        this.primeStatusPromise = null;
      }
    }
  }

  private async primeVoiceAsset(backendBaseUrl: string, voiceId: string): Promise<void> {
    const safeVoiceId = String(voiceId || '').trim();
    if (!safeVoiceId) return;

    const voiceCacheKey = `${backendBaseUrl}|${safeVoiceId}`;
    if (this.primedVoiceAssetKeys.has(voiceCacheKey)) return;
    const pendingPrime = this.voicePrimePromises.get(voiceCacheKey);
    if (pendingPrime) {
      await pendingPrime;
      return;
    }

    const cacheKey = `${HUGGING_FACE_VOICE_URL_PREFIX}${encodeURIComponent(safeVoiceId)}.bin`;
    const primePromise = (async () => {
      if (typeof caches !== 'undefined') {
        const cache = await caches.open(KOKORO_VOICE_CACHE);
        const cached = await cache.match(cacheKey);
        if (cached) {
          this.primedVoiceAssetKeys.add(voiceCacheKey);
          return;
        }
        const response = await fetch(`${backendBaseUrl}/models/${MODEL_ID}/voices/${encodeURIComponent(safeVoiceId)}.bin`, {
          method: 'GET',
          headers: { Accept: 'application/octet-stream' },
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new Error(`Kokoro voice asset unavailable for ${safeVoiceId}: ${response.status} ${detail.slice(0, 120)}`);
        }
        await cache.put(cacheKey, response.clone());
      } else {
        const response = await fetch(`${backendBaseUrl}/models/${MODEL_ID}/voices/${encodeURIComponent(safeVoiceId)}.bin`, {
          method: 'GET',
          headers: { Accept: 'application/octet-stream' },
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new Error(`Kokoro voice asset unavailable for ${safeVoiceId}: ${response.status} ${detail.slice(0, 120)}`);
        }
      }
      this.primedVoiceAssetKeys.add(voiceCacheKey);
    })();

    this.voicePrimePromises.set(voiceCacheKey, primePromise);
    try {
      await primePromise;
    } finally {
      if (this.voicePrimePromises.get(voiceCacheKey) === primePromise) {
        this.voicePrimePromises.delete(voiceCacheKey);
      }
    }
  }

  private async generateWithTokenizerFallback(
    tts: KokoroTTS,
    preparedText: string,
    voice: string,
    speed: number,
  ): Promise<any | null> {
    const tokenizer = (tts as any).tokenizer;
    const generateFromIds = (tts as any).generate_from_ids;
    if (!tokenizer || typeof generateFromIds !== 'function') return null;

    const encoded = await tokenizer(preparedText, { truncation: true });
    const inputIds = encoded?.input_ids;
    const dims = inputIds?.dims;
    const tokenCount = Array.isArray(dims) && dims.length > 0 ? Number(dims[dims.length - 1]) : 0;
    if (!tokenCount || tokenCount <= 2) return null;

    return await generateFromIds.call(tts, inputIds, { voice, speed });
  }

  private async synthesizeChunk(
    tts: KokoroTTS,
    chunkText: string,
    voice: string,
    speed: number,
    isHindi: boolean,
  ): Promise<Float32Array> {
    let audio: any = null;
    const builtIn = isBuiltInVoice(tts, voice);
    if (builtIn && !isHindi) {
      audio = await tts.generate(chunkText, { voice: voice as any, speed });
    } else {
      audio = await this.generateWithTokenizerFallback(tts, chunkText, voice, speed);
    }

    if (!hasValidAudio(audio) && isHindi) {
      const fallback = await this.generateWithTokenizerFallback(tts, chunkText, voice, speed);
      if (fallback) {
        audio = fallback;
      }
    }

    if (!hasValidAudio(audio)) {
      throw new Error(`Kokoro local synthesis returned empty audio for voice ${voice}.`);
    }

    const source = (audio.audio instanceof Float32Array ? audio.audio : audio.data) as Float32Array;
    const copy = new Float32Array(source.length);
    copy.set(source);
    return copy;
  }

  async primeAssets(backendBaseUrl?: string, voiceId?: string): Promise<KokoroPrimeStatus> {
    const resolvedBackendBase = this.configureTransformersEnv(backendBaseUrl);
    const status = await this.fetchPrimeStatus(resolvedBackendBase);
    if (!status.available || !status.ready) {
      const missing = Array.isArray(status.missing) && status.missing.length > 0
        ? ` Missing: ${status.missing.join(', ')}`
        : '';
      throw new Error(status.detail || `Kokoro local mirror is not ready.${missing}`);
    }
    const targetVoiceId = canonicalizeVoiceId(voiceId) || DEFAULT_VOICE_ID;
    await this.primeVoiceAsset(resolvedBackendBase, targetVoiceId);
    return status;
  }

  async ensureReady(options: KokoroEnsureReadyOptions = {}): Promise<KokoroTTS> {
    options.signal?.throwIfAborted?.();
    this.clearSuspendTimer();
    const resolvedBackendBase = this.configureTransformersEnv(options.backendBaseUrl);
    const targetVoiceId = canonicalizeVoiceId(options.voiceId) || DEFAULT_VOICE_ID;
    const status = await this.fetchPrimeStatus(resolvedBackendBase);
    if (!status.available || !status.ready) {
      const missing = Array.isArray(status.missing) && status.missing.length > 0
        ? ` Missing: ${status.missing.join(', ')}`
        : '';
      throw new Error(status.detail || `Kokoro local mirror is not ready.${missing}`);
    }
    options.signal?.throwIfAborted?.();
    const voicePrimePromise = this.primeVoiceAsset(resolvedBackendBase, targetVoiceId);

    if (this.model) {
      await voicePrimePromise;
      this.runtimeState = 'ready';
      this.touch();
      return this.model;
    }

    if (this.loadingPromise) {
      const [pending] = await Promise.all([this.loadingPromise, voicePrimePromise]);
      this.runtimeState = 'ready';
      this.touch();
      return pending;
    }

    this.runtimeState = 'warming';
    const pendingLoad = this.loadModelWithBestAvailableDevice();
    this.loadingPromise = pendingLoad;

    try {
      const [model] = await Promise.all([pendingLoad, voicePrimePromise]);
      this.model = model;
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

    const resolvedBackendBase = this.configureTransformersEnv(options.backendBaseUrl);
    const tts = await this.ensureReady({
      backendBaseUrl: resolvedBackendBase,
      voiceId: options.voiceId,
      speed: options.speed,
      ...(options.language ? { language: options.language } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    const voiceId = this.ensureVoiceId(tts, options.voiceId);
    const speed = Math.max(0.75, Math.min(1.35, Number(options.speed || 1.0)));
    const prepared = prepareTextForKokoro(safeText);
    const selectedVoice = resolveCompatibleVoiceId(voiceId, options.language, prepared.isHindi);
    const useHindiVoicePath = prepared.isHindi || isHindiLanguageHint(options.language) || HINDI_VOICES.has(selectedVoice);
    await this.primeVoiceAsset(resolvedBackendBase, selectedVoice);
    const textChunks = splitForStableTokenization(prepared.preparedText, useHindiVoicePath);

    const chunks: KokoroLiveChunk[] = [];
    const mergedParts: Float32Array[] = [];
    const totalChunks = Math.max(1, textChunks.length);

    options.onProgress?.(12, 'Preparing local ONNX CPU runtime...');

    for (let index = 0; index < textChunks.length; index += 1) {
      if (options.signal?.aborted) throw abortError();
      const chunkText = textChunks[index]!;
      const chunkAudio = await this.synthesizeChunk(tts, chunkText, selectedVoice, speed, useHindiVoicePath);
      const durationMs = Math.round((chunkAudio.length / DEFAULT_SAMPLE_RATE) * 1000);
      const chunk: KokoroLiveChunk = {
        index,
        text: chunkText,
        phonemes: '',
        audioData: chunkAudio,
        sampleRate: DEFAULT_SAMPLE_RATE,
        durationMs,
      };
      chunks.push(chunk);
      mergedParts.push(chunkAudio);
      options.onChunk?.(chunk);
      const progress = 18 + Math.round(((index + 1) / totalChunks) * 72);
      const stage = index === 0 ? 'First live chunk ready.' : 'Streaming Kokoro CPU audio...';
      options.onProgress?.(Math.max(18, Math.min(96, progress)), stage);
    }

    if (chunks.length === 0) {
      throw new Error('Kokoro produced no audio chunks.');
    }

    this.runtimeState = 'ready';
    this.touch();

    return {
      sampleRate: DEFAULT_SAMPLE_RATE,
      mergedAudio: mergeChunkAudio(mergedParts),
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
