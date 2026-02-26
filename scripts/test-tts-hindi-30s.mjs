#!/usr/bin/env node
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const REQUEST_TIMEOUT_MS = Number(process.env.VF_TTS_AUDIT_TIMEOUT_MS || 180_000);
const XTTS_REQUEST_TIMEOUT_MS = Number(process.env.VF_TTS_AUDIT_XTTS_TIMEOUT_MS || 1_800_000);
const ASR_LOAD_TIMEOUT_MS = Number(process.env.VF_TTS_AUDIT_ASR_LOAD_TIMEOUT_MS || 120_000);
const ASR_MODE = (process.env.VF_TTS_AUDIT_ASR_MODE || 'backend').toLowerCase();
const MEDIA_BACKEND_URL = (process.env.VF_MEDIA_BACKEND_URL || 'http://127.0.0.1:7800').replace(/\/+$/, '');
const SWITCH_TIMEOUT_MS = Number(process.env.VF_TTS_AUDIT_SWITCH_TIMEOUT_MS || 90_000);
const SWITCH_POLL_MS = Number(process.env.VF_TTS_AUDIT_SWITCH_POLL_MS || 1_200);
const SKIP_RUNTIME_SWITCH = ['1', 'true', 'yes']
  .includes((process.env.VF_TTS_AUDIT_SKIP_SWITCH || '').trim().toLowerCase());
const TARGET_SECONDS = Number(process.env.VF_TTS_AUDIT_TARGET_SECONDS || 30);
const MIN_SECONDS = Number(process.env.VF_TTS_AUDIT_MIN_SECONDS || 24);
const MAX_SECONDS = Number(process.env.VF_TTS_AUDIT_MAX_SECONDS || 36);
const CHARS_PER_SECOND = Number(process.env.VF_TTS_AUDIT_CHARS_PER_SEC || 15);
const DURATION_LOW_RATIO = Number(process.env.VF_TTS_AUDIT_DURATION_LOW_RATIO || 0.6);
const DURATION_HIGH_RATIO = Number(process.env.VF_TTS_AUDIT_DURATION_HIGH_RATIO || 1.8);
const MIN_CHAR_ACCURACY = Number(process.env.VF_TTS_AUDIT_MIN_CHAR_ACCURACY || 0.45);
const MIN_WORD_ACCURACY = Number(process.env.VF_TTS_AUDIT_MIN_WORD_ACCURACY || 0.3);
const ASR_MODEL_ID = process.env.VF_TTS_AUDIT_ASR_MODEL || 'Xenova/whisper-tiny';

const REPORT_BASENAME =
  TARGET_SECONDS === 30 ? 'tts_hi_30s_report.json' : `tts_hi_${TARGET_SECONDS}s_report.json`;
const PROFILE_BASE =
  TARGET_SECONDS === 30 ? 'hindi-30s-tts-audit' : `hindi-${TARGET_SECONDS}s-tts-audit`;
const PROFILE_EMOTIONS = `${PROFILE_BASE}-emotions`;
const REPORT_PATH = path.join(ARTIFACT_DIR, REPORT_BASENAME);
const XTTS_EMOTION_MANIFEST = process.env.VF_XTTS_EMOTION_MANIFEST
  ? path.resolve(process.env.VF_XTTS_EMOTION_MANIFEST)
  : path.join(ROOT, 'artifacts', 'voice-assets', 'xtts', 'emotions', 'emotion_manifest.json');

const CORE_EMOTIONS = ['Neutral', 'Happy', 'Sad', 'Angry', 'Calm', 'Excited'];
const XTTS_MIN_PASS_RATE = Number(process.env.VF_TTS_AUDIT_XTTS_MIN_PASS_RATE || 0.95);
const NON_XTTS_MIN_PASS_RATE = Number(process.env.VF_TTS_AUDIT_NON_XTTS_MIN_PASS_RATE || 0.9);
const XTTS_HIGH_TENSION_CAP = Number(process.env.VF_TTS_AUDIT_XTTS_HIGH_TENSION_CAP || 0.18);
const XTTS_NON_LINGUISTIC_CAP = Number(process.env.VF_TTS_AUDIT_XTTS_NON_LINGUISTIC_CAP || 0.16);
const NON_LINGUISTIC_TARGET_SECONDS = Number(process.env.VF_TTS_AUDIT_NON_LING_TARGET_SECONDS || 3);
const NON_LINGUISTIC_MIN_SECONDS = Number(process.env.VF_TTS_AUDIT_NON_LING_MIN_SECONDS || 1.2);
const NON_LINGUISTIC_MAX_SECONDS = Number(process.env.VF_TTS_AUDIT_NON_LING_MAX_SECONDS || 8);

const BASE_HINDI_TEST_TEXT = `नमस्ते, यह हिंदी आवाज़ गुणवत्ता जाँच है।
आज हम स्पष्ट उच्चारण, प्राकृतिक विराम और बोलने की लय की जाँच कर रहे हैं।
अगर आप यह वाक्य साफ़ सुन पा रहे हैं, तो मॉडल सही तरीके से काम कर रहा है।
अब मैं कुछ सामान्य शब्द बोल रही हूँ: सुबह की चाय, हल्की बारिश, बच्चों की हँसी और शाम की ठंडी हवा।
अंत में, कृपया इस ऑडियो को पूरा सुनें और बताइए कि स्पष्टता, गति और प्राकृतिकता कैसी लगी।`;

const normalizeWhitespace = (text) => (text || '').replace(/\s+/g, ' ').trim();
const HINDI_SECTION_WORDS = ['एक', 'दो', 'तीन', 'चार', 'पांच', 'छह', 'सात', 'आठ'];

const buildHindiTestText = (targetSeconds, charsPerSecond) => {
  const target = Number.isFinite(targetSeconds) && targetSeconds > 0 ? targetSeconds : 30;
  const cps = Number.isFinite(charsPerSecond) && charsPerSecond > 0 ? charsPerSecond : 15;
  const baseText = BASE_HINDI_TEST_TEXT.trim();
  const baseLength = normalizeWhitespace(baseText).length;
  const targetChars = Math.round(target * cps);

  if (!baseLength || targetChars <= baseLength) return baseText;

  const repeatCount = Math.min(8, Math.max(1, Math.ceil(targetChars / baseLength)));
  const parts = [];
  for (let i = 0; i < repeatCount; i += 1) {
    const sectionWord = HINDI_SECTION_WORDS[i] || String(i + 1);
    const header = repeatCount > 1 ? `खंड ${sectionWord}:\n` : '';
    parts.push(`${header}${baseText}`);
  }
  return parts.join('\n\n');
};

const HINDI_TEST_TEXT = buildHindiTestText(TARGET_SECONDS, CHARS_PER_SECOND);

const CUSTOM_EMOTION_LABELS = (process.env.VF_TTS_AUDIT_EMOTIONS || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const EMOTION_MAP = {
  neutral: 'शांत',
  calm: 'शांत',
  happy: 'प्रसन्न',
  joyful: 'प्रसन्न',
  excited: 'उत्साहित',
  sad: 'उदास',
  angry: 'क्रोधित',
  intense: 'तीव्र',
  hopeful: 'आशावान',
  serious: 'गंभीर',
};

const normalizeEmotionLabel = (label) => label.trim();
const emotionToHindi = (label) => EMOTION_MAP[label.toLowerCase()] || label;
const buildEmotionTag = (label) => `भाव: ${emotionToHindi(label)} (${label})`;
const NON_LINGUISTIC_EMOTION_HINTS = new Set([
  'laughing',
  'crying',
  'sighing',
  'coughing',
  'yawning',
  'throat_clearing',
  'sneezing',
  'moaning',
  'screaming',
  'panting',
  'breathless',
  'gasping',
]);
const NON_LINGUISTIC_STYLE_HINTS = new Set(['rapid_breath', 'fast_breath', 'burst', 'release', 'sleepy', 'reset', 'staccato', 'piercing']);

const normalizeEmotionKey = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '_');

const isNonLinguisticEmotionDescriptor = (descriptor) => {
  if (descriptor?.non_linguistic) return true;
  const language = String(descriptor?.language || '').trim().toLowerCase();
  const sourceDataset = String(descriptor?.source_dataset || '').trim().toLowerCase();
  if (
    language.includes('non-linguistic') ||
    language.includes('non linguistic') ||
    language.includes('nonverbal') ||
    sourceDataset === 'openslr99' ||
    sourceDataset === 'openslr_99'
  ) {
    return true;
  }
  const idKey = normalizeEmotionKey(descriptor?.id || descriptor?.emotion_ref_id);
  const emotionKey = normalizeEmotionKey(descriptor?.emotion);
  const styleKey = normalizeEmotionKey(descriptor?.style);
  return (
    NON_LINGUISTIC_EMOTION_HINTS.has(idKey) ||
    NON_LINGUISTIC_EMOTION_HINTS.has(emotionKey) ||
    NON_LINGUISTIC_EMOTION_HINTS.has(normalizeEmotionKey(descriptor?.emotion_ref_id)) ||
    NON_LINGUISTIC_STYLE_HINTS.has(styleKey)
  );
};

const NON_LINGUISTIC_SHORT_PROMPTS = {
  laughing: 'हा हा... अरे यह तो मजेदार है!',
  crying: 'मुझे बहुत दुख हो रहा है...',
  sighing: 'हाय... चलो फिर से कोशिश करते हैं।',
  coughing: 'खां... खां... पानी देना।',
  yawning: 'हम्म... बहुत नींद आ रही है।',
  throat_clearing: 'अंह-अंह... अब शुरू करते हैं।',
  sneezing: 'आछीं... माफ कीजिए!',
  moaning: 'आह... संभलकर चलो।',
  screaming: 'आआह! बचाओ!',
  panting: 'हह... हह... मैं दौड़कर आया हूँ।',
  breathless: 'हह... रुकिए... सांस फूल रही है।',
  gasping: 'हांफ... ये क्या हुआ!',
};

const buildTextWithEmotion = (label, engineId, descriptor) => {
  const normalizedId = normalizeEmotionKey(descriptor?.id || descriptor?.emotion_ref_id || label);
  const isNonLinguistic = engineId === 'XTTS_RUNTIME' && isNonLinguisticEmotionDescriptor(descriptor);
  if (isNonLinguistic) {
    return NON_LINGUISTIC_SHORT_PROMPTS[normalizedId] || NON_LINGUISTIC_SHORT_PROMPTS[normalizeEmotionKey(label)] || 'अरे... ये क्या हुआ!';
  }
  if (engineId === 'XTTS_RUNTIME') {
    // XTTS emotion transfer should come from reference conditioning, not spoken metadata tags.
    return HINDI_TEST_TEXT;
  }
  return `${buildEmotionTag(label)}\n${HINDI_TEST_TEXT}`;
};

const resolveXttsEmotionStrength = (emotionDescriptor) => {
  const baseStrength = Number(process.env.VF_TTS_AUDIT_XTTS_EMOTION_STRENGTH || 0.35);
  if (isNonLinguisticEmotionDescriptor(emotionDescriptor)) {
    return Math.min(baseStrength, XTTS_NON_LINGUISTIC_CAP);
  }
  const lower = String(emotionDescriptor?.emotion || '').toLowerCase();
  const isHighTension =
    lower.includes('anxious') ||
    lower.includes('fearful') ||
    lower.includes('terrified') ||
    lower.includes('panic') ||
    lower.includes('nervous') ||
    lower.includes('angry') ||
    lower.includes('furious') ||
    lower.includes('rage');
  if (!isHighTension) return baseStrength;
  return Math.min(baseStrength, XTTS_HIGH_TENSION_CAP);
};

const loadXttsEmotionManifest = async () => {
  try {
    const raw = await fs.readFile(XTTS_EMOTION_MANIFEST, 'utf8');
    const payload = JSON.parse(raw);
    const entries = Array.isArray(payload) ? payload : (Array.isArray(payload?.entries) ? payload.entries : []);
    return entries
      .map((entry) => {
        const id = String(entry?.id || entry?.emotion_ref_id || '').trim();
        if (!id) return null;
        return {
          id,
          emotion: String(entry?.emotion || entry?.name || id).trim(),
          style: String(entry?.style || 'default').trim(),
          emotion_ref_id: String(entry?.emotion_ref_id || id).trim(),
          language: String(entry?.language || '').trim(),
          source_dataset: String(entry?.source_dataset || '').trim(),
          non_linguistic: Boolean(entry?.non_linguistic),
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

const round3 = (value) => Math.round(value * 1000) / 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);

const loadTransformers = async () => {
  try {
    const mod = await import('@huggingface/transformers');
    return {
      pipeline: mod.pipeline,
      env: mod.env,
      runtimeVariant: 'node',
    };
  } catch (error) {
    const fallback = await import('../node_modules/@huggingface/transformers/dist/transformers.web.js');
    return {
      pipeline: fallback.pipeline,
      env: fallback.env,
      runtimeVariant: `web-fallback: ${error?.message || String(error)}`,
    };
  }
};

const loadAsrPipelineWithRetry = async (pipelineFn, modelId, retries = 4, timeoutMs = 120_000) => {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await withTimeout(
        pipelineFn('automatic-speech-recognition', modelId),
        timeoutMs,
        `ASR model load attempt ${attempt}`
      );
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        console.warn(`[asr] load attempt ${attempt} failed: ${error?.message || error}`);
        await sleep(3000 * attempt);
      }
    }
  }
  throw lastError;
};

const readU32 = (bytes, offset) =>
  bytes[offset] |
  (bytes[offset + 1] << 8) |
  (bytes[offset + 2] << 16) |
  (bytes[offset + 3] << 24);

const readU16 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);

const decodeWav = (bytes) => {
  if (bytes.length < 44) throw new Error('WAV too small.');
  const riff = Buffer.from(bytes.slice(0, 4)).toString('ascii');
  const wave = Buffer.from(bytes.slice(8, 12)).toString('ascii');
  if (riff !== 'RIFF' || wave !== 'WAVE') throw new Error('Invalid WAV header.');

  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataStart = -1;
  let dataSize = 0;

  while (offset + 8 <= bytes.length) {
    const chunkId = Buffer.from(bytes.slice(offset, offset + 4)).toString('ascii');
    const chunkSize = readU32(bytes, offset + 4);
    const chunkDataStart = offset + 8;
    const nextOffset = chunkDataStart + chunkSize + (chunkSize % 2);

    if (chunkId === 'fmt ') {
      if (chunkSize < 16) throw new Error('Invalid fmt chunk.');
      audioFormat = readU16(bytes, chunkDataStart);
      channels = readU16(bytes, chunkDataStart + 2);
      sampleRate = readU32(bytes, chunkDataStart + 4);
      bitsPerSample = readU16(bytes, chunkDataStart + 14);
    } else if (chunkId === 'data') {
      dataStart = chunkDataStart;
      dataSize = chunkSize;
      break;
    }

    offset = nextOffset;
  }

  if (dataStart < 0 || dataStart + dataSize > bytes.length) throw new Error('Missing/invalid data chunk.');
  if (!sampleRate || !channels || !bitsPerSample) throw new Error('Missing audio format metadata.');
  if (channels !== 1) throw new Error(`Expected mono WAV, got ${channels} channels.`);

  let pcm;
  if (audioFormat === 1 && bitsPerSample === 16) {
    const sampleCount = dataSize / 2;
    pcm = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      const lo = bytes[dataStart + i * 2];
      const hi = bytes[dataStart + i * 2 + 1];
      const value = (hi << 8) | lo;
      const signed = value >= 0x8000 ? value - 0x10000 : value;
      pcm[i] = signed / 32768;
    }
  } else if (audioFormat === 3 && bitsPerSample === 32) {
    const sampleCount = dataSize / 4;
    pcm = new Float32Array(sampleCount);
    const view = new DataView(bytes.buffer, bytes.byteOffset + dataStart, dataSize);
    for (let i = 0; i < sampleCount; i += 1) {
      pcm[i] = view.getFloat32(i * 4, true);
    }
  } else {
    throw new Error(`Unsupported WAV format audioFormat=${audioFormat}, bits=${bitsPerSample}.`);
  }

  return { pcm, sampleRate };
};

const resampleLinear = (input, srcRate, dstRate) => {
  if (srcRate === dstRate) return input;
  const ratio = srcRate / dstRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, input.length - 1);
    const frac = pos - left;
    output[i] = input[left] * (1 - frac) + input[right] * frac;
  }
  return output;
};

const normalizeHindi = (text) =>
  (text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const levenshteinDistance = (a, b) => {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const del = dp[i - 1][j] + 1;
      const ins = dp[i][j - 1] + 1;
      const sub = dp[i - 1][j - 1] + cost;
      dp[i][j] = Math.min(del, ins, sub);
    }
  }
  return dp[rows - 1][cols - 1];
};

const charAccuracy = (expected, actual) => {
  if (!expected.length) return 0;
  const dist = levenshteinDistance([...expected], [...actual]);
  return Math.max(0, 1 - dist / expected.length);
};

const wordAccuracy = (expected, actual) => {
  const expectedWords = expected.length ? expected.split(' ') : [];
  const actualWords = actual.length ? actual.split(' ') : [];
  if (!expectedWords.length) return 0;
  const dist = levenshteinDistance(expectedWords, actualWords);
  return Math.max(0, 1 - dist / expectedWords.length);
};

const estimateDurationSeconds = (text) => {
  const length = (text || '').length;
  if (!length || !Number.isFinite(CHARS_PER_SECOND) || CHARS_PER_SECOND <= 0) {
    return TARGET_SECONDS;
  }
  return Math.max(3, Math.ceil(length / CHARS_PER_SECOND));
};

const durationBandForText = (text) => {
  const target = estimateDurationSeconds(text);
  const low = Math.max(3, Math.floor(target * DURATION_LOW_RATIO));
  const high = Math.max(low + 1, Math.ceil(target * DURATION_HIGH_RATIO));
  return { target, low, high };
};

const durationBandForDescriptor = (text, descriptor) => {
  if (!isNonLinguisticEmotionDescriptor(descriptor)) {
    return durationBandForText(text);
  }
  const low = Math.max(0.6, Number.isFinite(NON_LINGUISTIC_MIN_SECONDS) ? NON_LINGUISTIC_MIN_SECONDS : 1.2);
  const high = Math.max(low + 0.3, Number.isFinite(NON_LINGUISTIC_MAX_SECONDS) ? NON_LINGUISTIC_MAX_SECONDS : 8);
  const target = Number.isFinite(NON_LINGUISTIC_TARGET_SECONDS) ? NON_LINGUISTIC_TARGET_SECONDS : 3;
  return { target, low, high };
};

const fetchWithTimeout = async (url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
};

const fetchWithRetry = async (
  url,
  init,
  attempts = 2,
  delayMs = 1500,
  timeoutMs = REQUEST_TIMEOUT_MS
) => {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchWithTimeout(url, init, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
};

const postJsonBufferWithTimeout = (url, payload, timeoutMs = REQUEST_TIMEOUT_MS) =>
  new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      reject(new Error(`Invalid URL: ${url}`));
      return;
    }

    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const isHttps = target.protocol === 'https:';
    const transport = isHttps ? https : http;

    const req = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port ? Number(target.port) : (isHttps ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: '*/*',
          'Content-Length': body.length,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on('end', () => {
          const status = Number(res.statusCode || 0);
          resolve({
            ok: status >= 200 && status < 300,
            status,
            body: Buffer.concat(chunks),
          });
        });
      }
    );

    req.on('error', reject);

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
      });
    } else {
      req.setTimeout(0);
    }

    req.write(body);
    req.end();
  });

const postJsonWithRetry = async (
  url,
  payload,
  attempts = 2,
  delayMs = 1500,
  timeoutMs = REQUEST_TIMEOUT_MS
) => {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await postJsonBufferWithTimeout(url, payload, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
};

const parseTextPayload = (text) => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
};

const getRuntimeCandidates = (envName, defaults) => {
  const raw = (process.env[envName] || '').trim();
  const envValues = raw
    ? raw.split(',').map((entry) => entry.trim()).filter(Boolean)
    : [];
  const merged = [...envValues, ...defaults];
  return [...new Set(merged.map((value) => value.replace(/\/+$/, '')))];
};

const resolveGeminiApiKey = () => {
  const candidates = [
    process.env.API_KEY,
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
  ];
  for (const candidate of candidates) {
    const value = (candidate || '').trim();
    if (value) return value;
  }
  return '';
};

const ENGINE_CONFIGS = [
  {
    id: 'GEMINI_RUNTIME',
    switchEngine: 'GEM',
    runtimeEnv: 'VF_TTS_AUDIT_GEMINI_URLS',
    runtimeDefaults: ['http://127.0.0.1:7810'],
    healthPath: '/health',
    synthPath: '/synthesize',
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    buildPayload: ({ apiKey, text }) => {
      const payload = {
        text,
        voiceName: process.env.VF_TTS_AUDIT_GEMINI_VOICE || 'Sulafat',
        speed: 1.0,
      };
      if (apiKey) payload.apiKey = apiKey;
      return payload;
    },
  },
  {
    id: 'KOKORO_RUNTIME',
    switchEngine: 'KOKORO',
    runtimeEnv: 'VF_TTS_AUDIT_KOKORO_URLS',
    runtimeDefaults: ['http://127.0.0.1:7820'],
    healthPath: '/health',
    synthPath: '/synthesize',
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    buildPayload: ({ text }) => ({
      text,
      voiceId: process.env.VF_TTS_AUDIT_KOKORO_VOICE || 'hf_alpha',
      speed: 1.0,
      language: 'hi',
    }),
  },
  {
    id: 'XTTS_RUNTIME',
    switchEngine: 'XTTS',
    runtimeEnv: 'VF_TTS_AUDIT_XTTS_URLS',
    runtimeDefaults: ['http://127.0.0.1:7860'],
    healthPath: '/health',
    voicesPath: '/v1/voices',
    synthPath: '/v1/text-to-speech',
    requestTimeoutMs: XTTS_REQUEST_TIMEOUT_MS,
    buildPayload: ({ text, emotionDescriptor }) => ({
      text,
      voice: process.env.VF_TTS_AUDIT_XTTS_VOICE || 'Aarav',
      voice_id: process.env.VF_TTS_AUDIT_XTTS_VOICE_ID || 'xtts_in_m_adult_01',
      language: process.env.VF_TTS_AUDIT_XTTS_LANGUAGE || 'hi',
      emotion: emotionDescriptor?.emotion || undefined,
      style: emotionDescriptor?.style || undefined,
      emotion_ref_id: emotionDescriptor?.emotion_ref_id || undefined,
      emotion_strength: resolveXttsEmotionStrength(emotionDescriptor),
      speed: 1.0,
      stream: false,
      response_format: 'wav',
    }),
  },
];

const SKIP_ENGINE_IDS = new Set(
  (process.env.VF_TTS_AUDIT_SKIP_ENGINES || '')
    .split(',')
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean)
);
const ACTIVE_ENGINE_CONFIGS = ENGINE_CONFIGS.filter((config) => !SKIP_ENGINE_IDS.has(config.id));

const probeRuntime = async (baseUrl, healthPath) => {
  const response = await fetchWithTimeout(`${baseUrl}${healthPath}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }, 6_000);

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`health ${response.status}: ${detail}`);
  }
};

const resolveRuntimeBase = async (config, preferredBaseUrl) => {
  const candidates = [
    ...(preferredBaseUrl ? [preferredBaseUrl.replace(/\/+$/, '')] : []),
    ...getRuntimeCandidates(config.runtimeEnv, config.runtimeDefaults),
  ];
  const uniqueCandidates = [...new Set(candidates)];
  const failures = [];
  for (const baseUrl of uniqueCandidates) {
    try {
      await probeRuntime(baseUrl, config.healthPath);
      return { baseUrl, failures };
    } catch (error) {
      failures.push({ baseUrl, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { baseUrl: null, failures };
};

const verifyVoiceRegistry = async (baseUrl, pathName, timeoutMs = 10_000) => {
  const response = await fetchWithTimeout(`${baseUrl}${pathName}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }, timeoutMs);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`voices ${response.status}: ${detail}`);
  }
  const payload = await response.json();
  const list = Array.isArray(payload?.voices) ? payload.voices : [];
  if (!list.length) throw new Error('voices list is empty.');
  return list.length;
};

const parseJsonSafe = async (response) => {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
};

const extractBaseFromHealthUrl = (healthUrl) => {
  try {
    const parsed = new URL(healthUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
};

const waitForRuntimeOnline = async (healthUrl, timeoutMs = SWITCH_TIMEOUT_MS) => {
  const startedAt = Date.now();
  let lastReason = 'runtime not reachable yet';
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const probe = await fetchWithTimeout(healthUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }, 8_000);
      if (probe.ok) {
        return { ok: true, elapsedMs: Date.now() - startedAt, detail: 'Runtime online' };
      }
      const detail = await parseJsonSafe(probe);
      lastReason = typeof detail === 'string' ? detail : JSON.stringify(detail);
    } catch (error) {
      lastReason = error?.message || String(error);
    }
    await sleep(SWITCH_POLL_MS);
  }

  return {
    ok: false,
    elapsedMs: Date.now() - startedAt,
    detail: `Runtime did not report healthy within ${Math.round(timeoutMs / 1000)}s (${lastReason})`,
  };
};

const switchRuntimeEngine = async (engine) => {
  const response = await fetchWithTimeout(`${MEDIA_BACKEND_URL}/tts/engines/switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ engine, gpu: false }),
  }, 70_000);

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const detail = typeof payload === 'string' ? payload : payload?.detail || JSON.stringify(payload);
    throw new Error(`switch ${engine} failed (${response.status}): ${detail}`);
  }

  const healthUrl = typeof payload?.healthUrl === 'string' && payload.healthUrl.trim()
    ? payload.healthUrl.trim()
    : null;

  if (!healthUrl) {
    throw new Error(`switch ${engine} succeeded but healthUrl was missing in response`);
  }

  const waited = await waitForRuntimeOnline(healthUrl, SWITCH_TIMEOUT_MS);
  if (!waited.ok) {
    throw new Error(waited.detail);
  }

  return {
    switchPayload: payload,
    healthUrl,
    baseUrl: extractBaseFromHealthUrl(healthUrl),
    waitElapsedMs: waited.elapsedMs,
  };
};

const createBackendAsr = async () => {
  const healthRes = await fetchWithTimeout(`${MEDIA_BACKEND_URL}/health`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }, 10_000);

  if (!healthRes.ok) {
    const detail = await healthRes.text();
    throw new Error(`Media backend health failed (${healthRes.status}): ${detail}`);
  }

  const health = await parseJsonSafe(healthRes);
  const usingFallback = Boolean(health?.whisper?.error);

  return {
    provider: 'backend',
    runtimeVariant: 'media-backend',
    model: usingFallback ? 'google-speech-recognition-fallback' : 'faster-whisper',
    transcribe: async (wavBytes) => {
      const form = new FormData();
      form.append('file', new Blob([wavBytes], { type: 'audio/wav' }), 'tts_audit.wav');
      form.append('language', 'hi');
      form.append('task', 'transcribe');

      const response = await fetchWithTimeout(`${MEDIA_BACKEND_URL}/video/transcribe`, {
        method: 'POST',
        body: form,
      }, REQUEST_TIMEOUT_MS);

      const payload = await parseJsonSafe(response);
      if (!response.ok) {
        const detail = typeof payload === 'string' ? payload : JSON.stringify(payload);
        throw new Error(`Media backend ASR failed (${response.status}): ${detail}`);
      }

      if (Array.isArray(payload?.segments) && payload.segments.length > 0) {
        return payload.segments.map((seg) => String(seg?.text || '').trim()).filter(Boolean).join(' ');
      }
      if (typeof payload?.script === 'string' && payload.script.trim()) {
        return payload.script
          .split('\n')
          .map((line) => line.split(':').slice(1).join(':').trim())
          .filter(Boolean)
          .join(' ');
      }
      return '';
    },
  };
};

const createTransformersAsr = async () => {
  const { pipeline, env, runtimeVariant } = await loadTransformers();
  env.allowRemoteModels = true;
  env.allowLocalModels = false;
  env.useBrowserCache = false;

  const transcriber = await loadAsrPipelineWithRetry(pipeline, ASR_MODEL_ID, 4, ASR_LOAD_TIMEOUT_MS);
  return {
    provider: 'transformers',
    runtimeVariant,
    model: ASR_MODEL_ID,
    transcribe: async (wavBytes) => {
      const decoded = decodeWav(wavBytes);
      const resampled = resampleLinear(decoded.pcm, decoded.sampleRate, 16_000);
      const result = await transcriber(resampled, {
        language: 'hindi',
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      return typeof result?.text === 'string' ? result.text.trim() : '';
    },
  };
};

const createAsrClient = async () => {
  let transformersError = null;

  if (ASR_MODE === 'auto' || ASR_MODE === 'transformers') {
    try {
      return await createTransformersAsr();
    } catch (error) {
      transformersError = error;
      if (ASR_MODE === 'transformers') throw error;
      console.warn(`[asr] transformers failed, falling back to backend: ${error?.message || error}`);
    }
  }

  if (ASR_MODE === 'auto' || ASR_MODE === 'backend') {
    try {
      return await createBackendAsr();
    } catch (backendError) {
      if (ASR_MODE === 'backend') throw backendError;
      const left = transformersError?.message || String(transformersError || 'unknown');
      const right = backendError?.message || String(backendError);
      throw new Error(`ASR unavailable. transformers: ${left}; backend: ${right}`);
    }
  }

  throw new Error(`Invalid VF_TTS_AUDIT_ASR_MODE="${ASR_MODE}". Use auto|transformers|backend.`);
};

const warmupRuntimeIfNeeded = async (config, baseUrl, apiKey) => {
  if (config.id !== 'XTTS_RUNTIME') {
    return { skipped: true };
  }

  const warmupPayload = config.buildPayload({
    apiKey,
    text: 'नमस्ते। यह वार्मअप अनुरोध है।',
    emotionDescriptor: {
      emotion: 'Neutral',
      style: 'default',
      emotion_ref_id: '',
    },
  });

  const synth = await postJsonWithRetry(
    `${baseUrl}${config.synthPath}`,
    warmupPayload,
    2,
    1000,
    Math.min(config.requestTimeoutMs || REQUEST_TIMEOUT_MS, 120_000)
  );
  if (!synth.ok) {
    const detailPayload = parseTextPayload(synth.body.toString('utf8'));
    const detail = typeof detailPayload === 'string' ? detailPayload : JSON.stringify(detailPayload);
    throw new Error(`XTTS warmup synthesis failed (${synth.status}): ${detail}`);
  }
  if (!synth.body || synth.body.length === 0) {
    throw new Error('XTTS warmup returned empty audio bytes.');
  }
  return { skipped: false, ok: true, bytes: synth.body.length };
};

const prepareRuntimeSession = async (config) => {
  const session = {
    ok: true,
    baseUrl: null,
    runtimeSwitch: undefined,
    voiceCount: undefined,
    warmup: undefined,
    probes: [],
    reason: '',
  };

  let preferredBaseUrl = null;
  if (config.switchEngine && !SKIP_RUNTIME_SWITCH) {
    try {
      const switched = await switchRuntimeEngine(config.switchEngine);
      preferredBaseUrl = switched.baseUrl;
      session.runtimeSwitch = {
        engine: config.switchEngine,
        healthUrl: switched.healthUrl,
        waitElapsedMs: switched.waitElapsedMs,
        state: switched.switchPayload?.state || 'online',
      };
    } catch (error) {
      session.ok = false;
      session.reason = `Runtime switch failed: ${error instanceof Error ? error.message : String(error)}`;
      return session;
    }
  } else if (config.switchEngine && SKIP_RUNTIME_SWITCH) {
    session.runtimeSwitch = {
      engine: config.switchEngine,
      state: 'skipped',
      detail: 'Runtime switch skipped (VF_TTS_AUDIT_SKIP_SWITCH=1)',
    };
  }

  const baseResolution = await resolveRuntimeBase(config, preferredBaseUrl);
  if (!baseResolution.baseUrl) {
    session.ok = false;
    session.reason = 'Runtime unreachable after switch.';
    session.probes = baseResolution.failures;
    return session;
  }

  session.baseUrl = baseResolution.baseUrl;
  session.probes = baseResolution.failures;
  if (config.voicesPath) {
    try {
      session.voiceCount = await verifyVoiceRegistry(
        session.baseUrl,
        config.voicesPath,
        Math.min(config.requestTimeoutMs || REQUEST_TIMEOUT_MS, 180_000)
      );
    } catch (error) {
      session.ok = false;
      session.reason = error instanceof Error ? error.message : String(error);
      return session;
    }
  }

  try {
    const apiKey = resolveGeminiApiKey();
    session.warmup = await warmupRuntimeIfNeeded(config, session.baseUrl, apiKey);
  } catch (error) {
    session.ok = false;
    session.reason = error instanceof Error ? error.message : String(error);
    return session;
  }

  return session;
};

const runEngineAudit = async (
  config,
  asrClient,
  normalizedTarget,
  apiKey,
  emotionLabel,
  targetText,
  emotionDescriptor,
  runtimeSession = null
) => {
  const startedAt = Date.now();
  const nonLinguistic = config.id === 'XTTS_RUNTIME' && isNonLinguisticEmotionDescriptor(emotionDescriptor);
  const emotionSlug = emotionLabel
    ? normalizeEmotionLabel(emotionLabel).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    : 'neutral';
  const durationBand = durationBandForDescriptor(targetText, emotionDescriptor);
  const result = {
    engine: config.id,
    emotion: emotionLabel,
    status: 'failed',
    elapsedMs: 0,
  };
  if (nonLinguistic) {
    result.nonLinguistic = true;
  }
  if (runtimeSession?.runtimeSwitch) {
    result.runtimeSwitch = runtimeSession.runtimeSwitch;
  }
  if (runtimeSession?.warmup) {
    result.runtimeWarmup = runtimeSession.warmup;
  }
  if (Array.isArray(runtimeSession?.probes) && runtimeSession.probes.length > 0) {
    result.probes = runtimeSession.probes;
  }

  let baseUrl = runtimeSession?.baseUrl || null;
  if (!baseUrl) {
    const baseResolution = await resolveRuntimeBase(config, null);
    if (!baseResolution.baseUrl) {
      result.status = 'failed';
      result.reason = 'Runtime unreachable after switch.';
      result.probes = baseResolution.failures;
      result.elapsedMs = Date.now() - startedAt;
      return result;
    }
    baseUrl = baseResolution.baseUrl;
    result.probes = baseResolution.failures;
  }
  result.baseUrl = baseUrl;

  try {
    if (typeof runtimeSession?.voiceCount === 'number') {
      result.voiceCount = runtimeSession.voiceCount;
    } else if (config.voicesPath) {
      result.voiceCount = await verifyVoiceRegistry(
        baseUrl,
        config.voicesPath,
        Math.min(config.requestTimeoutMs || REQUEST_TIMEOUT_MS, 180_000)
      );
    }

    const payload = config.buildPayload({ apiKey, text: targetText, emotionDescriptor });
    const synth = await postJsonWithRetry(
      `${baseUrl}${config.synthPath}`,
      payload,
      2,
      1500,
      config.requestTimeoutMs || REQUEST_TIMEOUT_MS
    );

    if (!synth.ok) {
      const detailPayload = parseTextPayload(synth.body.toString('utf8'));
      const detail = typeof detailPayload === 'string' ? detailPayload : JSON.stringify(detailPayload);
      const lower = detail.toLowerCase();
      result.status = 'failed';
      if (
        config.id === 'GEMINI_RUNTIME' &&
        (lower.includes('api key') || lower.includes('apikey') || lower.includes('unauthorized') || lower.includes('missing key'))
      ) {
        result.status = 'skipped_missing_api_key';
        result.reason = 'Gemini runtime key missing. Configure runtime server key or set API_KEY/GEMINI_API_KEY.';
      } else {
        result.reason = `Synthesis failed (${synth.status}): ${detail}`;
      }
      result.elapsedMs = Date.now() - startedAt;
      return result;
    }

    const wavBytes = new Uint8Array(synth.body);
    if (wavBytes.length === 0) {
      result.status = 'failed';
      result.reason = 'Synthesis returned zero-length audio bytes.';
      result.elapsedMs = Date.now() - startedAt;
      return result;
    }
    const wavPath = path.join(
      ARTIFACT_DIR,
      `${config.id.toLowerCase()}_${emotionSlug || 'neutral'}_hi_${TARGET_SECONDS}s.wav`
    );
    await fs.writeFile(wavPath, wavBytes);

    const decoded = decodeWav(wavBytes);
    const durationSeconds = decoded.pcm.length / decoded.sampleRate;
    const durationOk = durationSeconds >= durationBand.low && durationSeconds <= durationBand.high;
    let accuracyOk = true;
    let transcript = null;
    let normalizedTranscript = null;
    let cAcc = null;
    let wAcc = null;
    if (!nonLinguistic) {
      transcript = await asrClient.transcribe(wavBytes);
      normalizedTranscript = normalizeHindi(transcript);
      cAcc = charAccuracy(normalizedTarget, normalizedTranscript);
      wAcc = wordAccuracy(normalizedTarget, normalizedTranscript);
      accuracyOk = cAcc >= MIN_CHAR_ACCURACY && wAcc >= MIN_WORD_ACCURACY;
    }

    result.wav = path.relative(ROOT, wavPath);
    result.durationSeconds = round3(durationSeconds);
    result.durationTargetSeconds = durationBand.target;
    result.durationBand = [durationBand.low, durationBand.high];
    if (transcript !== null) result.transcript = transcript;
    if (normalizedTranscript !== null) result.normalizedTranscript = normalizedTranscript;
    result.charAccuracy = typeof cAcc === 'number' ? round3(cAcc) : null;
    result.wordAccuracy = typeof wAcc === 'number' ? round3(wAcc) : null;
    result.durationOk = durationOk;
    result.accuracyOk = accuracyOk;
    result.status = durationOk && accuracyOk ? 'passed' : 'failed';
    if (result.status === 'failed') {
      const reasons = [];
      if (!durationOk) reasons.push(`duration out of range (${durationBand.low}-${durationBand.high}s)`);
      if (!accuracyOk && !nonLinguistic) {
        reasons.push(`accuracy below threshold (char>=${MIN_CHAR_ACCURACY}, word>=${MIN_WORD_ACCURACY})`);
      }
      result.reason = reasons.join('; ');
    }
    result.elapsedMs = Date.now() - startedAt;
    return result;
  } catch (error) {
    result.status = 'failed';
    result.reason = error instanceof Error ? error.message : String(error);
    result.elapsedMs = Date.now() - startedAt;
    return result;
  }
};

const main = async () => {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });

  if (!ACTIVE_ENGINE_CONFIGS.length) {
    throw new Error('No active engines selected for audit. Adjust VF_TTS_AUDIT_SKIP_ENGINES.');
  }

  const asrClient = await createAsrClient();
  const apiKey = resolveGeminiApiKey();
  const xttsManifestEmotions = await loadXttsEmotionManifest();

  const coreEmotionDescriptors = CORE_EMOTIONS.map((emotion) => ({
    id: emotion.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    emotion,
    style: 'default',
    emotion_ref_id: '',
  }));

  const xttsEmotionDescriptors = (CUSTOM_EMOTION_LABELS.length > 0
    ? CUSTOM_EMOTION_LABELS.map((emotion) => ({
        id: emotion.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        emotion,
        style: 'default',
        emotion_ref_id: '',
        language: '',
        source_dataset: '',
        non_linguistic: NON_LINGUISTIC_EMOTION_HINTS.has(normalizeEmotionKey(emotion)),
      }))
    : xttsManifestEmotions.length > 0
      ? xttsManifestEmotions
      : coreEmotionDescriptors
  ).map((entry) => ({
    id: String(entry.id || entry.emotion).trim(),
    emotion: normalizeEmotionLabel(String(entry.emotion || entry.id)),
    style: String(entry.style || 'default').trim(),
    emotion_ref_id: String(entry.emotion_ref_id || entry.id || '').trim(),
    language: String(entry.language || '').trim(),
    source_dataset: String(entry.source_dataset || '').trim(),
    non_linguistic: isNonLinguisticEmotionDescriptor(entry),
  }));

  const results = [];
  for (const config of ACTIVE_ENGINE_CONFIGS) {
    const emotionDescriptors = config.id === 'XTTS_RUNTIME' ? xttsEmotionDescriptors : coreEmotionDescriptors;
    console.log(`\n=== Engine: ${config.id} | Emotions: ${emotionDescriptors.length} ===`);

    const runtimeSession = await prepareRuntimeSession(config);
    if (!runtimeSession.ok) {
      for (const descriptor of emotionDescriptors) {
        const emotionLabel = normalizeEmotionLabel(descriptor.emotion);
        const failure = {
          engine: config.id,
          emotion: emotionLabel,
          status: 'failed',
          reason: runtimeSession.reason || 'Runtime preparation failed.',
          runtimeSwitch: runtimeSession.runtimeSwitch,
          probes: runtimeSession.probes,
          elapsedMs: 0,
        };
        results.push(failure);
        console.log([
          failure.engine,
          `emotion=${emotionLabel}`,
          failure.status.toUpperCase(),
          failure.reason,
        ].filter(Boolean).join(' | '));
      }
      continue;
    }

    for (const descriptor of emotionDescriptors) {
      const emotionLabel = normalizeEmotionLabel(descriptor.emotion);
      const targetText = buildTextWithEmotion(emotionLabel, config.id, descriptor);
      const normalizedTarget = isNonLinguisticEmotionDescriptor(descriptor)
        ? ''
        : normalizeHindi(targetText);
      const engineResult = await runEngineAudit(
        config,
        asrClient,
        normalizedTarget,
        apiKey,
        emotionLabel,
        targetText,
        descriptor,
        runtimeSession
      );
      results.push(engineResult);
      const summaryParts = [
        engineResult.engine,
        `emotion=${emotionLabel}`,
        engineResult.status.toUpperCase(),
        typeof engineResult.durationSeconds === 'number' ? `${engineResult.durationSeconds}s` : '',
        typeof engineResult.charAccuracy === 'number' ? `char=${engineResult.charAccuracy}` : '',
        typeof engineResult.wordAccuracy === 'number' ? `word=${engineResult.wordAccuracy}` : '',
        engineResult.reason || '',
      ].filter(Boolean);
      console.log(summaryParts.join(' | '));
    }
  }

  const passedCount = results.filter((entry) => entry.status === 'passed').length;
  const skippedCount = results.filter((entry) => entry.status === 'skipped_missing_api_key').length;
  const failedCount = results.length - passedCount - skippedCount;

  const byEmotion = {};
  const byEngine = {};
  for (const entry of results) {
    const emotionKey = entry.emotion || 'Neutral';
    if (!byEmotion[emotionKey]) {
      byEmotion[emotionKey] = { total: 0, passed: 0, failed: 0, skipped: 0, passedAll: false };
    }
    if (!byEngine[entry.engine]) {
      byEngine[entry.engine] = { total: 0, passed: 0, failed: 0, skipped: 0 };
    }

    byEmotion[emotionKey].total += 1;
    byEngine[entry.engine].total += 1;

    if (entry.status === 'passed') {
      byEmotion[emotionKey].passed += 1;
      byEngine[entry.engine].passed += 1;
    } else if (entry.status === 'skipped_missing_api_key') {
      byEmotion[emotionKey].skipped += 1;
      byEngine[entry.engine].skipped += 1;
    } else {
      byEmotion[emotionKey].failed += 1;
      byEngine[entry.engine].failed += 1;
    }
  }
  for (const key of Object.keys(byEmotion)) {
    byEmotion[key].passedAll = byEmotion[key].failed === 0;
  }

  const xttsResults = results.filter((entry) => entry.engine === 'XTTS_RUNTIME');
  const xttsPassed = xttsResults.filter((entry) => entry.status === 'passed').length;
  const xttsPassRate = xttsResults.length ? xttsPassed / xttsResults.length : 0;

  const nonXttsResults = results.filter((entry) => entry.engine !== 'XTTS_RUNTIME');
  const nonXttsEvaluated = nonXttsResults.filter((entry) => entry.status !== 'skipped_missing_api_key');
  const nonXttsPassed = nonXttsEvaluated.filter((entry) => entry.status === 'passed').length;
  const nonXttsPassRate = nonXttsEvaluated.length ? nonXttsPassed / nonXttsEvaluated.length : 0;
  const nonXttsGatePassed = nonXttsEvaluated.length === 0 || nonXttsPassRate >= NON_XTTS_MIN_PASS_RATE;

  const report = {
    timestamp: new Date().toISOString(),
    profile: PROFILE_EMOTIONS,
    asrModel: asrClient.model,
    asrProvider: asrClient.provider,
    emotions: {
      xtts: xttsEmotionDescriptors.map((entry) => entry.emotion),
      core: CORE_EMOTIONS,
    },
    manifests: {
      xttsEmotionManifest: path.relative(ROOT, XTTS_EMOTION_MANIFEST),
      xttsEmotionManifestCount: xttsManifestEmotions.length,
    },
    baseText: HINDI_TEST_TEXT,
    thresholds: {
      baseDurationBandSeconds: [MIN_SECONDS, MAX_SECONDS],
      durationRatios: {
        charsPerSecond: CHARS_PER_SECOND,
        low: DURATION_LOW_RATIO,
        high: DURATION_HIGH_RATIO,
      },
      nonLinguisticDurationBandSeconds: [NON_LINGUISTIC_MIN_SECONDS, NON_LINGUISTIC_MAX_SECONDS],
      xttsNonLinguisticStrengthCap: XTTS_NON_LINGUISTIC_CAP,
      minCharAccuracy: MIN_CHAR_ACCURACY,
      minWordAccuracy: MIN_WORD_ACCURACY,
      xttsPassRateMin: XTTS_MIN_PASS_RATE,
      nonXttsPassRateMin: NON_XTTS_MIN_PASS_RATE,
    },
    runtimeVariant: asrClient.runtimeVariant,
    skippedEngines: [...SKIP_ENGINE_IDS],
    results,
    summary: {
      total: results.length,
      passed: passedCount,
      failed: failedCount,
      skipped: skippedCount,
      passedAll: failedCount === 0,
      emotions: byEmotion,
      engines: byEngine,
      passGates: {
        xtts: {
          passRate: round3(xttsPassRate),
          threshold: XTTS_MIN_PASS_RATE,
          passed: xttsPassRate >= XTTS_MIN_PASS_RATE,
          total: xttsResults.length,
          passedCount: xttsPassed,
        },
        nonXttsCore: {
          passRate: round3(nonXttsPassRate),
          threshold: NON_XTTS_MIN_PASS_RATE,
          passed: nonXttsGatePassed,
          total: nonXttsEvaluated.length,
          passedCount: nonXttsPassed,
        },
      },
    },
  };

  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Report: ${path.relative(ROOT, REPORT_PATH)}`);
  console.log(`Passed: ${report.summary.passedAll}`);

  if (
    !report.summary.passedAll ||
    !report.summary.passGates.xtts.passed ||
    !report.summary.passGates.nonXttsCore.passed
  ) {
    process.exitCode = 1;
  }
};

main().catch(async (error) => {
  const failReport = {
    timestamp: new Date().toISOString(),
    profile: PROFILE_BASE,
    error: error instanceof Error ? error.message : String(error),
  };
  try {
    await fs.mkdir(ARTIFACT_DIR, { recursive: true });
    await fs.writeFile(REPORT_PATH, JSON.stringify(failReport, null, 2), 'utf8');
  } catch {
    // ignore secondary failure
  }
  console.error('TTS Hindi audit failed.');
  console.error(error);
  process.exitCode = 1;
});
