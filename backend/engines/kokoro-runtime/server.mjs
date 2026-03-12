#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  CHUNKING_PROFILES,
  MAX_WORDS_PER_REQUEST,
  SEGMENTATION_PROFILE,
  chunkTextForTts,
  countWords,
  resolveChunkProfile,
} from './segmentation.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const WORKSPACE_ROOT = path.resolve(BACKEND_ROOT, '..');
const ENV_FILES = [path.join(BACKEND_ROOT, '.env'), path.join(WORKSPACE_ROOT, '.env')];

function parseEnvValue(rawValue) {
  const trimmed = String(rawValue || '').trim();
  if (!trimmed) return '';
  const quote = trimmed[0];
  const isQuoted =
    (quote === '"' && trimmed.endsWith('"')) || (quote === "'" && trimmed.endsWith("'"));
  if (!isQuoted) return trimmed;

  let inner = trimmed.slice(1, -1);
  if (quote === '"') {
    inner = inner
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return inner;
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const equalsIndex = normalized.indexOf('=');
    if (equalsIndex <= 0) continue;
    const key = normalized.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] && String(process.env[key]).trim()) continue;
    process.env[key] = parseEnvValue(normalized.slice(equalsIndex + 1));
  }
}

for (const envPath of ENV_FILES) {
  loadDotEnv(envPath);
}

const APP_NAME = 'kokoro-runtime';
const HOST = String(process.env.VF_KOKORO_RUNTIME_HOST || process.env.VF_BACKEND_HOST || '127.0.0.1').trim() || '127.0.0.1';
const PORT = Number(process.env.VF_KOKORO_RUNTIME_PORT || process.env.PORT || 7820);
const MODEL_ID = String(process.env.VF_KOKORO_MODEL_REPO_ID || 'onnx-community/Kokoro-82M-v1.0-ONNX').trim() || 'onnx-community/Kokoro-82M-v1.0-ONNX';
const MODEL_REVISION = String(process.env.VF_KOKORO_MODEL_REVISION || 'main').trim() || 'main';
const KOKORO_DEVICE = 'cpu';
const REQUESTED_KOKORO_DTYPE = String(process.env.KOKORO_MODEL_DTYPE || 'q8').trim().toLowerCase() || 'q8';
if (REQUESTED_KOKORO_DTYPE !== 'q8') {
  console.warn(
    `[kokoro-runtime] KOKORO_MODEL_DTYPE="${REQUESTED_KOKORO_DTYPE}" is unsupported in this workspace; forcing "q8".`,
  );
}
const KOKORO_DTYPE = 'q8';
const KOKORO_MODEL_FILE = 'onnx/model_quantized.onnx';
const KOKORO_SAMPLE_RATE = Math.max(8000, Number(process.env.KOKORO_SAMPLE_RATE || 24000));
const KOKORO_SYNTH_MAX_MS = Math.max(10_000, Number(process.env.KOKORO_SYNTH_MAX_MS || 180000));
const KOKORO_BATCH_MAX_ITEMS = Math.max(1, Number(process.env.KOKORO_BATCH_MAX_ITEMS || 64));
const KOKORO_BATCH_DEFAULT_PARALLEL = Math.max(
  1,
  Number(process.env.KOKORO_BATCH_DEFAULT_PARALLEL || process.env.KOKORO_BATCH_MAX_PARALLEL || 2),
);
const KOKORO_BATCH_MAX_PARALLEL = Math.max(
  KOKORO_BATCH_DEFAULT_PARALLEL,
  Number(process.env.KOKORO_BATCH_MAX_PARALLEL || process.env.KOKORO_BATCH_PARALLEL_LIMIT || 6),
);
const KOKORO_MAX_ACTIVE_SYNTH = Math.max(
  1,
  Number(process.env.KOKORO_MAX_ACTIVE_SYNTH || KOKORO_BATCH_DEFAULT_PARALLEL || 2),
);
const LOCAL_MODEL_MIRROR_ROOT = path.resolve(
  String(process.env.VF_LOCAL_MODEL_MIRROR_DIR || path.join(BACKEND_ROOT, 'models')).trim() || path.join(BACKEND_ROOT, 'models'),
);
const KOKORO_MODEL_DIR = path.resolve(LOCAL_MODEL_MIRROR_ROOT, MODEL_ID);
const REQUIRED_MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  KOKORO_MODEL_FILE,
  'voices/af_heart.bin',
  'voices/hf_alpha.bin',
];
const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];
const LOCALHOST_CORS_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

const FRONTEND_NODE_MODULES = path.join(WORKSPACE_ROOT, 'frontend', 'node_modules');
const KOKORO_PACKAGE_ENTRY = path.join(FRONTEND_NODE_MODULES, 'kokoro-js', 'dist', 'kokoro.js');
const TRANSFORMERS_PACKAGE_ENTRY = path.join(
  FRONTEND_NODE_MODULES,
  '@huggingface',
  'transformers',
  'dist',
  'transformers.node.mjs',
);

const VOICE_IDS = [
  'af_heart',
  'af_bella',
  'af_nova',
  'af_sarah',
  'am_fenrir',
  'am_michael',
  'am_onyx',
  'am_echo',
  'bf_emma',
  'bf_isabella',
  'bm_george',
  'bm_fable',
  'hf_alpha',
  'hf_beta',
  'hm_omega',
  'hm_psi',
];

const VOICE_META = {
  af_heart: { name: 'Heart', accent: 'American English', gender: 'Female', lang: 'a' },
  af_bella: { name: 'Bella', accent: 'American English', gender: 'Female', lang: 'a' },
  af_nova: { name: 'Nova', accent: 'American English', gender: 'Female', lang: 'a' },
  af_sarah: { name: 'Sarah', accent: 'American English', gender: 'Female', lang: 'a' },
  am_fenrir: { name: 'Fenrir', accent: 'American English', gender: 'Male', lang: 'a' },
  am_michael: { name: 'Michael', accent: 'American English', gender: 'Male', lang: 'a' },
  am_onyx: { name: 'Onyx', accent: 'American English', gender: 'Male', lang: 'a' },
  am_echo: { name: 'Echo', accent: 'American English', gender: 'Male', lang: 'a' },
  bf_emma: { name: 'Emma', accent: 'British English', gender: 'Female', lang: 'b' },
  bf_isabella: { name: 'Isabella', accent: 'British English', gender: 'Female', lang: 'b' },
  bm_george: { name: 'George', accent: 'British English', gender: 'Male', lang: 'b' },
  bm_fable: { name: 'Fable', accent: 'British English', gender: 'Male', lang: 'b' },
  hf_alpha: { name: 'Hindi Alpha', accent: 'Hindi', gender: 'Female', lang: 'h' },
  hf_beta: { name: 'Hindi Beta', accent: 'Hindi', gender: 'Female', lang: 'h' },
  hm_omega: { name: 'Hindi Omega', accent: 'Hindi', gender: 'Male', lang: 'h' },
  hm_psi: { name: 'Hindi Psi', accent: 'Hindi', gender: 'Male', lang: 'h' },
};

const HINDI_VOICES = new Set(['hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi']);
const VIRAMA = '\u094d';
const ANUSVARA = '\u0902';
const CHANDRABINDU = '\u0901';
const VISARGA = '\u0903';
const HINDI_DIGIT_WORDS = {
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

const DEVANAGARI_TO_ROMAN = {
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

const DEVANAGARI_MATRAS = {
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

function parseCorsOrigins(envVar) {
  const raw = String(process.env[envVar] || '').trim();
  if (!raw) return DEFAULT_CORS_ORIGINS;
  const values = raw.split(',').map((item) => item.trim()).filter(Boolean);
  return values.length > 0 ? values : DEFAULT_CORS_ORIGINS;
}

const ALLOWED_CORS_ORIGINS = new Set(parseCorsOrigins('VF_CORS_ORIGINS'));

function matchesCorsOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_CORS_ORIGINS.has(origin)) return true;
  return LOCALHOST_CORS_ORIGIN_REGEX.test(origin);
}

function newTraceId() {
  return `kokoro_${Date.now().toString(16)}_${crypto.randomBytes(3).toString('hex')}`;
}

function normalizeTraceId(value) {
  const token = String(value || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '');
  return token ? token.slice(0, 96) : newTraceId();
}

function emitStageEvent(traceId, stage, status, detail) {
  const payload = {
    event: 'synthesis_stage',
    engine: APP_NAME,
    trace_id: traceId,
    stage,
    status,
    ts: Date.now(),
  };
  if (detail) payload.detail = detail;
  console.log(JSON.stringify(payload));
}

function containsDevanagari(text) {
  return /[\u0900-\u097F]/.test(String(text || ''));
}

function normalizeHindiText(text) {
  return String(text || '')
    .normalize('NFC')
    .replace(/[\u200c\u200d]/g, '')
    .replace(/\u0964|\u0965/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandDigitsForHindiRomanization(text) {
  return String(text || '').replace(/[0-9]/g, (digit) => HINDI_DIGIT_WORDS[digit] || digit);
}

function transliterateHindiToRoman(text) {
  const source = expandDigitsForHindiRomanization(text);
  let output = '';
  for (let index = 0; index < source.length; index += 1) {
    const ch = source[index];
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
}

function resolveLangForVoice(voiceId) {
  const meta = VOICE_META[voiceId];
  if (meta?.lang) return meta.lang;
  if (voiceId.startsWith('bf_') || voiceId.startsWith('bm_')) return 'b';
  if (voiceId.startsWith('hf_') || voiceId.startsWith('hm_')) return 'h';
  return 'a';
}

function resolveLanguage(text, voiceId, languageHint) {
  const hint = String(languageHint || '').trim().toLowerCase();
  if (hint.startsWith('hi')) return 'h';
  if (containsDevanagari(text)) return 'h';
  return resolveLangForVoice(voiceId);
}

function resolveVoiceId(voiceId, langCode) {
  const requested = String(voiceId || '').trim();
  const safeRequested = requested || (langCode === 'h' ? 'hf_alpha' : langCode === 'b' ? 'bf_emma' : 'af_heart');
  if (langCode === 'h' && !HINDI_VOICES.has(safeRequested)) return 'hf_alpha';
  if (langCode === 'b' && HINDI_VOICES.has(safeRequested)) return 'bf_emma';
  if (langCode === 'a' && HINDI_VOICES.has(safeRequested)) return 'af_heart';
  return safeRequested;
}

function normalizeRuntimeText(text, langCode) {
  let cleaned = normalizeHindiText(text)
    .replace(/\u200c/g, '')
    .replace(/\u200d/g, '')
    .replace(/\u0964/g, '. ')
    .replace(/\u0965/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();

  if (langCode === 'h') {
    cleaned = cleaned.replace(/[0-9\u0966-\u096f]/g, (digit) => {
      if (digit >= '0' && digit <= '9') return HINDI_DIGIT_WORDS[digit] || digit;
      const code = digit.charCodeAt(0);
      if (code >= 0x0966 && code <= 0x096f) {
        return HINDI_DIGIT_WORDS[String(code - 0x0966)] || digit;
      }
      return digit;
    });
  }
  return cleaned;
}

function prepareSegmentText(text, langCode) {
  const normalized = normalizeRuntimeText(text, langCode);
  if (langCode !== 'h') return normalized;
  return containsDevanagari(normalized) ? transliterateHindiToRoman(normalized) : normalized;
}

function clampSpeed(speed) {
  return Math.max(0.75, Math.min(1.35, Number(speed || 1.0)));
}

function pauseMsForText(text, langCode) {
  const token = String(text || '').trim();
  if (!token) return 0;
  if (/[.!?\u0964\u0965]\s*$/.test(token)) return langCode === 'h' ? 130 : 110;
  if (/[,;:]\s*$/.test(token)) return langCode === 'h' ? 65 : 50;
  return langCode === 'h' ? 34 : 25;
}

function pauseArray(pauseMs) {
  const safeMs = Math.max(0, Number(pauseMs || 0));
  if (!safeMs) return null;
  const sampleCount = Math.max(1, Math.floor((KOKORO_SAMPLE_RATE * safeMs) / 1000));
  return new Float32Array(sampleCount);
}

function mergeWithCrossfade(chunks, crossfadeMs) {
  if (!chunks.length) return { merged: new Float32Array(1), mergeStrategy: 'concatenate' };
  let merged = chunks[0].data;
  let mergeStrategy = 'concatenate';
  const crossfadeSamples = Math.max(0, Math.floor((KOKORO_SAMPLE_RATE * Math.max(0, crossfadeMs)) / 1000));

  for (const chunk of chunks.slice(1)) {
    const next = chunk.data;
    if (!next?.length) continue;
    if (!merged.length) {
      merged = next;
      continue;
    }
    if (crossfadeSamples <= 0 || chunk.isPause) {
      const combined = new Float32Array(merged.length + next.length);
      combined.set(merged, 0);
      combined.set(next, merged.length);
      merged = combined;
      continue;
    }

    const overlap = Math.min(crossfadeSamples, merged.length, next.length);
    if (overlap <= 0) {
      const combined = new Float32Array(merged.length + next.length);
      combined.set(merged, 0);
      combined.set(next, merged.length);
      merged = combined;
      continue;
    }

    const out = new Float32Array(merged.length + next.length - overlap);
    out.set(merged.subarray(0, merged.length - overlap), 0);
    const fadeStart = merged.length - overlap;
    for (let index = 0; index < overlap; index += 1) {
      const fadeOut = 1 - (index / overlap);
      const fadeIn = 1 - fadeOut;
      out[fadeStart + index] = (merged[fadeStart + index] * fadeOut) + (next[index] * fadeIn);
    }
    out.set(next.subarray(overlap), fadeStart + overlap);
    merged = out;
    mergeStrategy = 'overlap_add_crossfade';
  }

  return { merged, mergeStrategy };
}

function encodeWav(audioData, sampleRate) {
  const floatData = audioData instanceof Float32Array ? audioData : new Float32Array(audioData || []);
  const dataSize = floatData.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let offset = 0;
  const writeString = (value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
    offset += value.length;
  };

  writeString('RIFF');
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * 2, true);
  offset += 4;
  view.setUint16(offset, 2, true);
  offset += 2;
  view.setUint16(offset, 16, true);
  offset += 2;
  writeString('data');
  view.setUint32(offset, dataSize, true);
  offset += 4;

  for (let index = 0; index < floatData.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, floatData[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return Buffer.from(buffer);
}

class Semaphore {
  constructor(maxActive) {
    this.maxActive = Math.max(1, Number(maxActive || 1));
    this.active = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.active < this.maxActive) {
      this.active += 1;
      return () => this.release();
    }
    return await new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve(() => this.release());
      });
    });
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}

const synthesisSemaphore = new Semaphore(KOKORO_MAX_ACTIVE_SYNTH);

async function withTimeout(promiseFactory, timeoutMs, detailFactory) {
  let timeoutHandle = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(Object.assign(new Error('Kokoro synthesis timed out.'), { detail: detailFactory?.() || null }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promiseFactory(), timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

let runtimeModulesPromise = null;

async function loadRuntimeModules() {
  if (runtimeModulesPromise) return runtimeModulesPromise;
  runtimeModulesPromise = (async () => {
    if (!fs.existsSync(KOKORO_PACKAGE_ENTRY)) {
      throw new Error(`kokoro-js package missing at ${KOKORO_PACKAGE_ENTRY}`);
    }
    if (!fs.existsSync(TRANSFORMERS_PACKAGE_ENTRY)) {
      throw new Error(`transformers package missing at ${TRANSFORMERS_PACKAGE_ENTRY}`);
    }
    const [{ KokoroTTS }, { env: transformersEnv }] = await Promise.all([
      import(pathToFileURL(KOKORO_PACKAGE_ENTRY).href),
      import(pathToFileURL(TRANSFORMERS_PACKAGE_ENTRY).href),
    ]);
    return { KokoroTTS, transformersEnv };
  })();
  return runtimeModulesPromise;
}

function validateMirrorFiles() {
  const missing = [];
  for (const relPath of REQUIRED_MODEL_FILES) {
    const target = path.resolve(KOKORO_MODEL_DIR, relPath);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      missing.push(relPath);
    }
  }
  return missing;
}

class KokoroNodeRuntime {
  constructor() {
    this.ready = false;
    this.error = null;
    this.tts = null;
    this.loadingPromise = null;
  }

  async warm() {
    if (this.tts) {
      this.ready = true;
      return this.tts;
    }
    if (this.loadingPromise) {
      return await this.loadingPromise;
    }

    this.loadingPromise = (async () => {
      const missing = validateMirrorFiles();
      if (missing.length > 0) {
        throw new Error(`Kokoro local mirror missing required files: ${missing.join(', ')}`);
      }
      const { KokoroTTS, transformersEnv } = await loadRuntimeModules();
      transformersEnv.allowLocalModels = true;
      transformersEnv.allowRemoteModels = false;
      transformersEnv.localModelPath = `${LOCAL_MODEL_MIRROR_ROOT}${path.sep}`;

      const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: KOKORO_DTYPE,
        device: KOKORO_DEVICE,
      });
      this.tts = tts;
      this.ready = true;
      this.error = null;
      return tts;
    })();

    try {
      return await this.loadingPromise;
    } catch (error) {
      this.ready = false;
      this.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.loadingPromise = null;
    }
  }

  async generateWithTokenizerFallback(tts, preparedText, voice, speed) {
    const tokenizer = tts?.tokenizer;
    const generateFromIds = tts?.generate_from_ids;
    if (!tokenizer || typeof generateFromIds !== 'function') return null;
    const encoded = await tokenizer(preparedText, { truncation: true });
    const inputIds = encoded?.input_ids;
    const dims = inputIds?.dims;
    const tokenCount = Array.isArray(dims) && dims.length > 0 ? Number(dims[dims.length - 1]) : 0;
    if (!tokenCount || tokenCount <= 2) return null;
    return await generateFromIds.call(tts, inputIds, { voice, speed });
  }

  async synthesize(text, voiceId, speed, languageHint, traceId) {
    const release = await synthesisSemaphore.acquire();
    try {
      const tts = await this.warm();
      const rawText = String(text || '').trim();
      if (!rawText) {
        const detail = { error: 'validation_error', message: 'text is empty' };
        throw Object.assign(new Error('text is empty'), { statusCode: 400, detail });
      }

      const wordCount = countWords(rawText);
      if (wordCount > MAX_WORDS_PER_REQUEST) {
        const detail = {
          error: 'word_limit_exceeded',
          maxWordsPerRequest: MAX_WORDS_PER_REQUEST,
          actualWords: wordCount,
        };
        throw Object.assign(new Error('word limit exceeded'), { statusCode: 400, detail });
      }

      const safeTraceId = normalizeTraceId(traceId);
      const targetLang = resolveLanguage(rawText, voiceId, languageHint);
      const selectedVoice = resolveVoiceId(voiceId, targetLang);
      const normalizedText = normalizeRuntimeText(rawText, targetLang);
      const segments = chunkTextForTts(normalizedText, targetLang);
      const chunkProfile = resolveChunkProfile(targetLang, normalizedText);
      const joinCrossfadeMs = Number(chunkProfile.joinCrossfadeMs || 0);
      const chunkMaxChars = Number(chunkProfile.hardCharCap || 0);
      const safeSpeed = clampSpeed(speed);
      const synthesizedChunks = [];
      let phonemeChars = 0;
      let pauseInsertions = 0;

      emitStageEvent(safeTraceId, 'preprocess', 'start', {
        voiceId: selectedVoice,
        textChars: rawText.length,
        segments: segments.length,
      });

      const merged = await withTimeout(async () => {
        for (let index = 0; index < segments.length; index += 1) {
          const segment = segments[index];
          const preparedSegment = prepareSegmentText(segment, targetLang);
          phonemeChars += preparedSegment.length;
          emitStageEvent(safeTraceId, 'chunk', 'start', {
            index,
            total: segments.length,
            chars: preparedSegment.length,
          });

          const builtInVoice = Object.prototype.hasOwnProperty.call(tts.voices || {}, selectedVoice);
          let audio = null;
          if (builtInVoice && targetLang !== 'h') {
            audio = await tts.generate(preparedSegment, { voice: selectedVoice, speed: safeSpeed });
          } else {
            audio = await this.generateWithTokenizerFallback(tts, preparedSegment, selectedVoice, safeSpeed);
          }
          if (!(audio?.audio instanceof Float32Array) && !(audio?.data instanceof Float32Array)) {
            const fallback = await this.generateWithTokenizerFallback(tts, preparedSegment, selectedVoice, safeSpeed);
            if (fallback) audio = fallback;
          }

          const audioData = audio?.audio instanceof Float32Array
            ? audio.audio
            : audio?.data instanceof Float32Array
              ? audio.data
              : null;
          if (!audioData || audioData.length <= 0) {
            throw new Error(`Kokoro returned empty audio for segment ${index + 1}.`);
          }

          const copy = new Float32Array(audioData.length);
          copy.set(audioData);
          synthesizedChunks.push({ data: copy, isPause: false });

          const pause = index < segments.length - 1 ? pauseArray(pauseMsForText(segment, targetLang)) : null;
          if (pause) {
            synthesizedChunks.push({ data: pause, isPause: true });
            pauseInsertions += 1;
          }
          emitStageEvent(safeTraceId, 'chunk', 'done', {
            index,
            total: segments.length,
            samples: copy.length,
          });
        }

        return mergeWithCrossfade(synthesizedChunks, joinCrossfadeMs);
      }, KOKORO_SYNTH_MAX_MS, () => ({
        error: 'synthesis_timeout',
        trace_id: safeTraceId,
        timeoutMs: KOKORO_SYNTH_MAX_MS,
      }));

      const diagnostics = {
        impl: 'kokoro-onnx-node',
        lang_code: targetLang,
        voice: selectedVoice,
        segments: segments.length,
        chunk_profile: chunkProfile,
        chunk_max_chars: chunkMaxChars,
        phoneme_chars: phonemeChars,
        word_count: wordCount,
        sample_rate: KOKORO_SAMPLE_RATE,
        chunkCount: segments.length,
        chunkMaxChars: chunkMaxChars,
        joinCrossfadeMs,
        pauseInsertions,
        mergeStrategy: merged.mergeStrategy,
      };

      emitStageEvent(safeTraceId, 'completed', 'ok', {
        lang: targetLang,
        segments: segments.length,
        wordCount,
        sampleRate: KOKORO_SAMPLE_RATE,
      });

      return {
        wavBuffer: encodeWav(merged.merged, KOKORO_SAMPLE_RATE),
        meta: diagnostics,
        traceId: safeTraceId,
      };
    } catch (error) {
      const statusCode = Number(error?.statusCode || 0);
      const detail = error?.detail || null;
      if (traceId) {
        emitStageEvent(normalizeTraceId(traceId), 'failed', 'error', {
          error: detail || (error instanceof Error ? error.message : String(error)),
        });
      }
      if (statusCode) throw error;
      if (detail?.error === 'synthesis_timeout') {
        throw Object.assign(new Error('Kokoro synthesis timed out.'), { statusCode: 504, detail });
      }
      throw Object.assign(
        new Error(error instanceof Error ? error.message : String(error)),
        { statusCode: 500, detail: { message: error instanceof Error ? error.message : String(error) } },
      );
    } finally {
      release();
    }
  }
}

const kokoroRuntime = new KokoroNodeRuntime();
void kokoroRuntime.warm().catch((error) => {
  console.error(`[kokoro-runtime] warmup failed: ${error instanceof Error ? error.message : String(error)}`);
});

function buildHealthPayload() {
  if (kokoroRuntime.ready) {
    return {
      ok: true,
      engine: APP_NAME,
      device: 'cpu',
      device_mode: KOKORO_DEVICE,
      impl: 'kokoro-onnx-node',
      hindi: true,
      voices: VOICE_IDS.length,
      modelVariant: KOKORO_DTYPE,
    };
  }
  return {
    ok: false,
    status: 'unhealthy',
    engine: APP_NAME,
    device: 'cpu',
    device_mode: KOKORO_DEVICE,
    impl: 'kokoro-onnx-node',
    hindi: true,
    voices: VOICE_IDS.length,
    modelVariant: KOKORO_DTYPE,
    error: kokoroRuntime.error || 'Kokoro runtime init failed.',
  };
}

function buildVoicesPayload() {
  return {
    voices: VOICE_IDS.map((voiceId) => {
      const meta = VOICE_META[voiceId] || {};
      return {
        voice_id: voiceId,
        voice: voiceId,
        name: meta.name || voiceId,
        language: meta.lang === 'h' ? 'hi' : 'en',
        accent: meta.accent || 'Unknown',
        gender: meta.gender || 'Unknown',
      };
    }),
  };
}

function buildCapabilitiesPayload() {
  return {
    engine: 'KOKORO',
    runtime: APP_NAME,
    ready: Boolean(kokoroRuntime.ready),
    languages: ['en', 'hi'],
    speed: { min: 0.75, max: 1.35, default: 1.0 },
    supportsEmotion: false,
    supportsStyle: false,
    supportsSpeakerWav: false,
    supportsBatchSynthesis: true,
    batchEndpoint: '/synthesize/batch',
    batchMaxItems: KOKORO_BATCH_MAX_ITEMS,
    batchDefaultParallelism: KOKORO_BATCH_DEFAULT_PARALLEL,
    batchMaxParallelism: KOKORO_BATCH_MAX_PARALLEL,
    model: 'kokoro-onnx-node',
    voiceCount: VOICE_IDS.length,
    emotionCount: 0,
    metadata: {
      deviceMode: KOKORO_DEVICE,
      sampleRate: KOKORO_SAMPLE_RATE,
      maxWordsPerRequest: MAX_WORDS_PER_REQUEST,
      segmentationProfile: SEGMENTATION_PROFILE,
      supportsBatchSynthesis: true,
      batchEndpoint: '/synthesize/batch',
      batchMaxItems: KOKORO_BATCH_MAX_ITEMS,
      batchDefaultParallelism: KOKORO_BATCH_DEFAULT_PARALLEL,
      batchMaxParallelism: KOKORO_BATCH_MAX_PARALLEL,
      chunking: {
        hi: CHUNKING_PROFILES.hi,
        default: CHUNKING_PROFILES.default,
      },
      runtimeImpl: 'node',
      modelVariant: KOKORO_DTYPE,
      modelFile: KOKORO_MODEL_FILE,
      modelRevision: MODEL_REVISION,
      mirrorPath: KOKORO_MODEL_DIR,
    },
  };
}

function applyCorsHeaders(req, res) {
  const origin = String(req.headers.origin || '').trim();
  if (matchesCorsOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, x-dev-uid, Idempotency-Key');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(req, res, statusCode, payload, extraHeaders = {}) {
  applyCorsHeaders(req, res);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

function sendBytes(req, res, statusCode, buffer, extraHeaders = {}) {
  applyCorsHeaders(req, res);
  res.writeHead(statusCode, {
    'Content-Type': 'audio/wav',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(buffer);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
      const total = chunks.reduce((sum, item) => sum + item.length, 0);
      if (total > 10 * 1024 * 1024) {
        reject(new Error('Request body too large.'));
      }
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function mapWithConcurrency(items, concurrency, worker) {
  const safeConcurrency = Math.max(1, Math.min(Number(concurrency || 1), items.length || 1));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: safeConcurrency }, () => runWorker()));
  return results;
}

const server = http.createServer(async (req, res) => {
  try {
    applyCorsHeaders(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(req, res, 200, buildHealthPayload());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/voices') {
      sendJson(req, res, 200, buildVoicesPayload());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/capabilities') {
      sendJson(req, res, 200, buildCapabilitiesPayload());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/synthesize') {
      const payload = await readJsonBody(req);
      const traceId = normalizeTraceId(payload.trace_id || payload.traceId);
      try {
        const result = await kokoroRuntime.synthesize(
          payload.text,
          payload.voiceId || payload.voice_id || 'hf_alpha',
          payload.speed,
          payload.language,
          traceId,
        );
        const diagnostics = {
          chunkCount: Number(result.meta.chunkCount || 0),
          chunkMaxChars: Number(result.meta.chunkMaxChars || 0),
          joinCrossfadeMs: Number(result.meta.joinCrossfadeMs || 0),
          pauseInsertions: Number(result.meta.pauseInsertions || 0),
          mergeStrategy: String(result.meta.mergeStrategy || 'concatenate'),
        };
        sendBytes(req, res, 200, result.wavBuffer, {
          'X-VoiceFlow-Trace-Id': result.traceId,
          'X-VoiceFlow-Diagnostics': encodeURIComponent(JSON.stringify(diagnostics)),
        });
      } catch (error) {
        const statusCode = Number(error?.statusCode || 500);
        const detail = error?.detail || { message: error instanceof Error ? error.message : String(error) };
        sendJson(req, res, statusCode, { detail });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/synthesize/batch') {
      const payload = await readJsonBody(req);
      const items = Array.isArray(payload.items) ? payload.items : [];
      if (items.length === 0) {
        sendJson(req, res, 400, { detail: 'items must contain at least one request.' });
        return;
      }
      if (items.length > KOKORO_BATCH_MAX_ITEMS) {
        sendJson(req, res, 400, {
          detail: {
            error: 'batch_limit_exceeded',
            maxItems: KOKORO_BATCH_MAX_ITEMS,
            actualItems: items.length,
          },
        });
        return;
      }

      const requestedParallelism = payload.parallelism == null ? KOKORO_BATCH_DEFAULT_PARALLEL : Number(payload.parallelism);
      if (requestedParallelism < 1) {
        sendJson(req, res, 400, { detail: 'parallelism must be >= 1.' });
        return;
      }
      if (requestedParallelism > KOKORO_BATCH_MAX_PARALLEL) {
        sendJson(req, res, 400, {
          detail: {
            error: 'parallelism_limit_exceeded',
            maxParallelism: KOKORO_BATCH_MAX_PARALLEL,
            requestedParallelism,
          },
        });
        return;
      }

      const effectiveParallelism = Math.max(1, Math.min(requestedParallelism, items.length));
      const results = await mapWithConcurrency(items, effectiveParallelism, async (item, index) => {
        const itemTraceId = normalizeTraceId(item.trace_id || item.traceId);
        emitStageEvent(itemTraceId, 'batch_item', 'start', { index, parallelism: effectiveParallelism });
        try {
          const result = await kokoroRuntime.synthesize(
            item.text,
            item.voiceId || item.voice_id || 'hf_alpha',
            item.speed,
            item.language,
            itemTraceId,
          );
          emitStageEvent(itemTraceId, 'batch_item', 'done', {
            index,
            bytes: result.wavBuffer.length,
            segments: result.meta.segments,
          });
          return {
            index,
            id: item.id,
            ok: true,
            audioBase64: result.wavBuffer.toString('base64'),
            contentType: 'audio/wav',
            trace_id: result.traceId,
            meta: result.meta,
          };
        } catch (error) {
          const statusCode = Number(error?.statusCode || 500);
          const detail = error?.detail || { message: error instanceof Error ? error.message : String(error) };
          emitStageEvent(itemTraceId, 'batch_item', 'error', {
            index,
            statusCode,
            error: detail,
          });
          return {
            index,
            id: item.id,
            ok: false,
            trace_id: itemTraceId,
            error: {
              statusCode,
              ...(typeof detail === 'object' && detail !== null ? detail : { error: String(detail) }),
            },
          };
        }
      });

      const succeeded = results.filter((item) => item.ok).length;
      const failed = results.length - succeeded;
      sendJson(req, res, 200, {
        ok: failed === 0,
        engine: APP_NAME,
        summary: {
          requested: items.length,
          succeeded,
          failed,
          parallelismUsed: effectiveParallelism,
        },
        items: results,
      });
      return;
    }

    sendJson(req, res, 404, { detail: 'Not found.' });
  } catch (error) {
    sendJson(req, res, 500, {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[kokoro-runtime] listening on http://${HOST}:${PORT}`);
});
