// Lazy-loaded heavy Kokoro browser runtime implementation.
import { KokoroTTS } from 'kokoro-js';
import { env as transformersEnv } from '@huggingface/transformers';
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
  skipRuntimePrime?: boolean;
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
  device: 'webgpu';
  dtype: 'q8';
}

const DEFAULT_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DEFAULT_MODEL_REVISION = 'main';
const MODEL_ID = String(import.meta.env.VITE_KOKORO_MODEL_REPO_ID || DEFAULT_MODEL_ID).trim() || DEFAULT_MODEL_ID;
const MODEL_REVISION = String(import.meta.env.VITE_KOKORO_MODEL_REVISION || DEFAULT_MODEL_REVISION).trim() || DEFAULT_MODEL_REVISION;
const DEFAULT_VOICE_ID = 'af_heart';
const DEFAULT_SAMPLE_RATE = 24000;
const DEFAULT_IDLE_MS = 120_000;
const UI_YIELD_TIMEOUT_MS = 16;
const UI_YIELD_TEXT_THRESHOLD_CHARS = 360;
const KOKORO_FIRST_CHUNK_TARGET_WORDS = 14;
const KOKORO_FIRST_CHUNK_HARD_CAP_WORDS = 24;
const KOKORO_STREAM_CHUNK_TARGET_WORDS = 30;
const KOKORO_STREAM_CHUNK_HARD_CAP_WORDS = 45;
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
const KOKORO_MODEL_CACHE_VERSION = String(import.meta.env.VITE_KOKORO_MODEL_CACHE_VERSION || 'kokoro-webgpu-q8-v1').trim() || 'kokoro-webgpu-q8-v1';
const KOKORO_VOICE_CACHE = `kokoro-voices-${KOKORO_MODEL_CACHE_VERSION}`;
const KOKORO_MODEL_CACHE = `kokoro-model-${KOKORO_MODEL_CACHE_VERSION}`;
const KOKORO_CORE_MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model_quantized.onnx',
] as const;

const encodeRepoPath = (repoId: string): string => (
  String(repoId || '')
    .split('/')
    .map((token) => encodeURIComponent(token))
    .join('/')
);

const trimTrailingSlash = (value: string): string => String(value || '').replace(/\/+$/, '');

const joinUrl = (baseUrl: string, relativePath: string): string => (
  `${trimTrailingSlash(baseUrl)}/${String(relativePath || '').replace(/^\/+/, '')}`
);

const DEFAULT_MODEL_ASSET_BASE_URL = `https://huggingface.co/${encodeRepoPath(MODEL_ID)}/resolve/${encodeURIComponent(MODEL_REVISION)}`;
const MODEL_ASSET_BASE_URL = trimTrailingSlash(
  String(import.meta.env.VITE_KOKORO_MODEL_ASSET_BASE_URL || '').trim() || DEFAULT_MODEL_ASSET_BASE_URL
);
const MODEL_FILE_PATH = 'onnx/model_quantized.onnx';
const KOKORO_VOICE_ASSET_URL_PREFIX = `${MODEL_ASSET_BASE_URL}/voices/`;

const buildVersionedCacheKey = (url: string): string => {
  const cacheToken = encodeURIComponent(`${MODEL_ID}@${MODEL_REVISION}:${KOKORO_MODEL_CACHE_VERSION}`);
  return `${url}${url.includes('?') ? '&' : '?'}vf_kokoro_cache=${cacheToken}`;
};
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

const countWords = (text: string): number => {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
};

const normalizeChunkText = (value: string): string => (
  String(value || '').replace(/\s+/g, ' ').trim()
);

const splitIntoSentenceUnits = (text: string): string[] => {
  const rawLines = String(text || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return rawLines.flatMap((line) => (
    line.match(/[^.!?]+[.!?]?/g)?.map((item) => normalizeChunkText(item)).filter(Boolean) || []
  ));
};

const splitIntoClauseUnits = (text: string): string[] => (
  normalizeChunkText(text)
    .split(/(?<=[,;:])\s+/)
    .map((item) => normalizeChunkText(item))
    .filter(Boolean)
);

const splitByWordCap = (text: string, maxWords: number): string[] => {
  const safeMax = Math.max(1, Math.floor(Number(maxWords) || 1));
  const words = normalizeChunkText(text).split(' ').filter(Boolean);
  if (words.length <= safeMax) {
    return words.length > 0 ? [words.join(' ')] : [];
  }
  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += safeMax) {
    const chunk = words.slice(index, index + safeMax).join(' ').trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
};

const splitOversizedUnitForStream = (unit: string, hardCapWords: number): string[] => {
  const normalized = normalizeChunkText(unit);
  if (!normalized) return [];
  if (countWords(normalized) <= hardCapWords) return [normalized];

  const clauses = splitIntoClauseUnits(normalized);
  if (clauses.length > 1) {
    return clauses.flatMap((clause) => {
      if (countWords(clause) <= hardCapWords) return [clause];
      return splitByWordCap(clause, hardCapWords);
    });
  }
  return splitByWordCap(normalized, hardCapWords);
};

const packUnitsByWordBudget = (
  units: string[],
  targetWords: number,
  hardCapWords: number,
): string[] => {
  const safeTarget = Math.max(1, Math.floor(Number(targetWords) || 1));
  const safeHardCap = Math.max(safeTarget, Math.floor(Number(hardCapWords) || safeTarget));
  const chunks: string[] = [];
  let current = '';
  let currentWords = 0;

  const commitCurrent = (): void => {
    const normalized = normalizeChunkText(current);
    if (!normalized) return;
    chunks.push(normalized);
    current = '';
    currentWords = 0;
  };

  for (const rawUnit of units) {
    const unit = normalizeChunkText(rawUnit);
    if (!unit) continue;
    const unitWords = countWords(unit);
    if (unitWords <= 0) continue;
    if (!current) {
      current = unit;
      currentWords = unitWords;
      continue;
    }
    const mergedWords = currentWords + unitWords;
    if (currentWords < safeTarget && mergedWords <= safeHardCap) {
      current = `${current} ${unit}`.trim();
      currentWords = mergedWords;
      continue;
    }
    commitCurrent();
    current = unit;
    currentWords = unitWords;
  }

  commitCurrent();
  return chunks;
};

const planSentenceSafeLiveChunks = (text: string): string[] => {
  const normalizedText = normalizeChunkText(text);
  if (!normalizedText) return [];

  const sentenceUnits = splitIntoSentenceUnits(normalizedText);
  if (sentenceUnits.length <= 0) {
    return splitByWordCap(normalizedText, KOKORO_STREAM_CHUNK_HARD_CAP_WORDS);
  }

  const [firstSentence, ...remainingSentences] = sentenceUnits;
  const firstCandidate = normalizeChunkText(firstSentence || '');
  const firstChunkPieces = (() => {
    if (!firstCandidate) return [];
    const firstWords = countWords(firstCandidate);
    if (firstWords <= KOKORO_FIRST_CHUNK_HARD_CAP_WORDS) {
      return [firstCandidate];
    }
    const clauses = splitIntoClauseUnits(firstCandidate);
    if (clauses.length > 1) {
      return packUnitsByWordBudget(
        clauses.flatMap((clause) => splitOversizedUnitForStream(clause, KOKORO_FIRST_CHUNK_HARD_CAP_WORDS)),
        KOKORO_FIRST_CHUNK_TARGET_WORDS,
        KOKORO_FIRST_CHUNK_HARD_CAP_WORDS,
      );
    }
    return splitByWordCap(firstCandidate, KOKORO_FIRST_CHUNK_HARD_CAP_WORDS);
  })();

  const firstChunk = firstChunkPieces[0] || firstCandidate;
  const carryOverUnits = firstChunkPieces.slice(1);
  const streamUnits = [...carryOverUnits, ...remainingSentences]
    .flatMap((unit) => splitOversizedUnitForStream(unit, KOKORO_STREAM_CHUNK_HARD_CAP_WORDS));
  const streamChunks = packUnitsByWordBudget(
    streamUnits,
    KOKORO_STREAM_CHUNK_TARGET_WORDS,
    KOKORO_STREAM_CHUNK_HARD_CAP_WORDS,
  );
  const output = [firstChunk, ...streamChunks].map((chunk) => normalizeChunkText(chunk)).filter(Boolean);
  return output.length > 0 ? output : [normalizedText];
};

export const __kokoroBrowserRuntimePlannerTestOnly = {
  planSentenceSafeLiveChunks,
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

const yieldToBrowser = async (): Promise<void> => {
  if (typeof window === 'undefined') {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return;
  }
  await new Promise<void>((resolve) => {
    const browserWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    };
    if (typeof browserWindow.requestIdleCallback === 'function') {
      browserWindow.requestIdleCallback(() => resolve(), { timeout: UI_YIELD_TIMEOUT_MS });
      return;
    }
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    window.setTimeout(() => resolve(), 0);
  });
};

export const shouldUseBrowserKokoroExecution = (
  engine: string,
  context: 'studio' | 'preview' | 'dubbing' | undefined,
): boolean => {
  if (!isBrowserKokoroExecutionEnabled()) return false;
  const normalizedEngine = String(engine || '').trim().toUpperCase();
  if (normalizedEngine !== 'KOKORO') return false;
  void context;
  return true;
};

class KokoroBrowserRuntime {
  private model: KokoroTTS | null = null;
  private loadingPromise: Promise<KokoroTTS> | null = null;
  private runtimeState: KokoroBrowserRuntimeState = 'cold';
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUsedAtMs = 0;
  private lastPrimeStatus: KokoroPrimeStatus | null = null;
  private primedModelAssetKeys = new Set<string>();
  private modelPrimePromises = new Map<string, Promise<void>>();
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

  private configureTransformersEnv(_backendBaseUrl?: string): void {
    transformersEnv.allowLocalModels = false;
    transformersEnv.allowRemoteModels = true;
    transformersEnv.remoteHost = `${MODEL_ASSET_BASE_URL}/`;
    transformersEnv.remotePathTemplate = '';
    transformersEnv.localModelPath = '/models/';
    transformersEnv.useBrowserCache = true;
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
    if (!this.supportsWebGpuExecution()) {
      throw new Error('Kokoro requires WebGPU support in a secure browser context.');
    }
    return { device: 'webgpu', dtype: 'q8' };
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

  private buildPrimeStatus(options: {
    ok: boolean;
    available: boolean;
    ready: boolean;
    missing: string[];
    detail: string;
  }): KokoroPrimeStatus {
    return {
      ok: options.ok,
      available: options.available,
      repoId: MODEL_ID,
      revision: MODEL_REVISION,
      modelPath: MODEL_ASSET_BASE_URL,
      fileCount: KOKORO_CORE_MODEL_FILES.length,
      totalBytes: 0,
      ready: options.ready,
      missing: options.missing,
      hash: KOKORO_MODEL_CACHE_VERSION,
      fetchedAt: new Date().toISOString(),
      detail: options.detail,
      runtime: {
        device: 'webgpu',
        dtype: 'q8',
        modelFile: MODEL_FILE_PATH,
      },
    };
  }

  private async primeModelAsset(relativePath: string): Promise<void> {
    const safeRelativePath = String(relativePath || '').trim().replace(/^\/+/, '');
    if (!safeRelativePath) return;
    const assetUrl = joinUrl(MODEL_ASSET_BASE_URL, safeRelativePath);
    const modelAssetKey = `${assetUrl}|${KOKORO_MODEL_CACHE_VERSION}`;
    if (this.primedModelAssetKeys.has(modelAssetKey)) return;
    const pendingPrime = this.modelPrimePromises.get(modelAssetKey);
    if (pendingPrime) {
      await pendingPrime;
      return;
    }

    const cacheKey = buildVersionedCacheKey(assetUrl);
    const primePromise = (async () => {
      if (typeof caches !== 'undefined') {
        const cache = await caches.open(KOKORO_MODEL_CACHE);
        const cached = await cache.match(cacheKey);
        if (cached) {
          this.primedModelAssetKeys.add(modelAssetKey);
          return;
        }
        const response = await fetch(assetUrl, {
          method: 'GET',
          headers: { Accept: '*/*' },
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new Error(`Kokoro model asset unavailable for ${safeRelativePath}: ${response.status} ${detail.slice(0, 160)}`);
        }
        await cache.put(cacheKey, response.clone());
      } else {
        const response = await fetch(assetUrl, {
          method: 'GET',
          headers: { Accept: '*/*' },
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new Error(`Kokoro model asset unavailable for ${safeRelativePath}: ${response.status} ${detail.slice(0, 160)}`);
        }
      }
      this.primedModelAssetKeys.add(modelAssetKey);
    })();

    this.modelPrimePromises.set(modelAssetKey, primePromise);
    try {
      await primePromise;
    } finally {
      if (this.modelPrimePromises.get(modelAssetKey) === primePromise) {
        this.modelPrimePromises.delete(modelAssetKey);
      }
    }
  }

  private async primeCoreModelAssets(): Promise<void> {
    for (const relativePath of KOKORO_CORE_MODEL_FILES) {
      await this.primeModelAsset(relativePath);
    }
  }

  private async fetchPrimeStatus(): Promise<KokoroPrimeStatus> {
    try {
      await this.primeCoreModelAssets();
      const status = this.buildPrimeStatus({
        ok: true,
        available: true,
        ready: true,
        missing: [],
        detail: 'Kokoro WebGPU model assets ready.',
      });
      this.lastPrimeStatus = status;
      return status;
    } catch (error: unknown) {
      const detail = error instanceof Error
        ? error.message
        : 'Failed to fetch Kokoro WebGPU model assets.';
      const status = this.buildPrimeStatus({
        ok: false,
        available: false,
        ready: false,
        missing: [...KOKORO_CORE_MODEL_FILES],
        detail,
      });
      this.lastPrimeStatus = status;
      return status;
    }
  }

  private async primeVoiceAsset(voiceId: string): Promise<void> {
    const safeVoiceId = String(voiceId || '').trim();
    if (!safeVoiceId) return;

    const voiceCacheKey = `${MODEL_ASSET_BASE_URL}|${safeVoiceId}|${KOKORO_MODEL_CACHE_VERSION}`;
    if (this.primedVoiceAssetKeys.has(voiceCacheKey)) return;
    const pendingPrime = this.voicePrimePromises.get(voiceCacheKey);
    if (pendingPrime) {
      await pendingPrime;
      return;
    }

    const voiceUrl = `${KOKORO_VOICE_ASSET_URL_PREFIX}${encodeURIComponent(safeVoiceId)}.bin`;
    const cacheKey = buildVersionedCacheKey(voiceUrl);
    const primePromise = (async () => {
      if (typeof caches !== 'undefined') {
        const cache = await caches.open(KOKORO_VOICE_CACHE);
        const cached = await cache.match(cacheKey);
        if (cached) {
          this.primedVoiceAssetKeys.add(voiceCacheKey);
          return;
        }
        const response = await fetch(voiceUrl, {
          method: 'GET',
          headers: { Accept: 'application/octet-stream' },
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new Error(`Kokoro voice asset unavailable for ${safeVoiceId}: ${response.status} ${detail.slice(0, 120)}`);
        }
        await cache.put(cacheKey, response.clone());
      } else {
        const response = await fetch(voiceUrl, {
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
    this.configureTransformersEnv(backendBaseUrl);
    const status = await this.fetchPrimeStatus();
    if (!status.available || !status.ready) {
      const missing = Array.isArray(status.missing) && status.missing.length > 0
        ? ` Missing: ${status.missing.join(', ')}`
        : '';
      throw new Error(status.detail || `Kokoro WebGPU model assets are not ready.${missing}`);
    }
    const targetVoiceId = canonicalizeVoiceId(voiceId) || DEFAULT_VOICE_ID;
    await this.primeVoiceAsset(targetVoiceId);
    return status;
  }

  async ensureReady(options: KokoroEnsureReadyOptions = {}): Promise<KokoroTTS> {
    options.signal?.throwIfAborted?.();
    this.clearSuspendTimer();
    this.configureTransformersEnv(options.backendBaseUrl);
    const targetVoiceId = canonicalizeVoiceId(options.voiceId) || DEFAULT_VOICE_ID;
    if (options.skipRuntimePrime !== true) {
      const status = await this.fetchPrimeStatus();
      if (!status.available || !status.ready) {
        const missing = Array.isArray(status.missing) && status.missing.length > 0
          ? ` Missing: ${status.missing.join(', ')}`
          : '';
        throw new Error(status.detail || `Kokoro WebGPU model assets are not ready.${missing}`);
      }
    }
    options.signal?.throwIfAborted?.();
    const voicePrimePromise = this.primeVoiceAsset(targetVoiceId);

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

    this.configureTransformersEnv(options.backendBaseUrl);
    const tts = await this.ensureReady({
      ...(options.backendBaseUrl ? { backendBaseUrl: options.backendBaseUrl } : {}),
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
    await this.primeVoiceAsset(selectedVoice);
    const textChunks = planSentenceSafeLiveChunks(prepared.preparedText);

    const chunks: KokoroLiveChunk[] = [];
    const mergedParts: Float32Array[] = [];
    const totalChunks = Math.max(1, textChunks.length);
    const shouldYieldBetweenChunks = safeText.length >= UI_YIELD_TEXT_THRESHOLD_CHARS || textChunks.length >= 4;

    options.onProgress?.(12, 'Preparing local ONNX WebGPU runtime...');

    for (let index = 0; index < textChunks.length; index += 1) {
      if (options.signal?.aborted) throw abortError();
      if (shouldYieldBetweenChunks && index > 0) {
        await yieldToBrowser();
      }
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
      const stage = index === 0 ? 'First live chunk ready.' : 'Streaming Kokoro WebGPU audio...';
      options.onProgress?.(Math.max(18, Math.min(96, progress)), stage);
      if (shouldYieldBetweenChunks && index < textChunks.length - 1) {
        await yieldToBrowser();
      }
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

  async resetForTests(): Promise<void> {
    await this.suspend();
    this.runtimeState = 'cold';
    this.lastUsedAtMs = 0;
    this.lastPrimeStatus = null;
    this.primedModelAssetKeys.clear();
    this.modelPrimePromises.clear();
    this.primedVoiceAssetKeys.clear();
    this.voicePrimePromises.clear();
    this.browserExecutionConfigOverride = null;
  }
}

export const kokoroBrowserRuntime = new KokoroBrowserRuntime();
export const __kokoroBrowserRuntimeTestOnly = {
  reset: async (): Promise<void> => {
    await kokoroBrowserRuntime.resetForTests();
  },
};
