#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { classifyAuditFailure, isTransientFailureClass, normalizeBaseUrl, withBoundedRetry } from './lib/audit-helpers.mjs';

const ROOT = process.cwd();
const MODE = process.argv.includes('--mode')
  ? String(process.argv[process.argv.indexOf('--mode') + 1] || 'smoke').toLowerCase()
  : 'smoke';

const REPORT_PATH = path.join(ROOT, 'artifacts', 'tts_longtext_5000_audit_report.json');
const GEM_URL = normalizeBaseUrl(process.env.VF_GEMINI_RUNTIME_URL, 'http://127.0.0.1:7810');
const KOKORO_URL = normalizeBaseUrl(process.env.VF_KOKORO_RUNTIME_URL, 'http://127.0.0.1:7820');
const REQUEST_TIMEOUT_MS = Number(process.env.VF_TTS_LONGTEXT_TIMEOUT_MS || 240000);
const KOKORO_REQUEST_TIMEOUT_MS = Math.max(
  REQUEST_TIMEOUT_MS,
  Number(process.env.VF_TTS_LONGTEXT_KOKORO_TIMEOUT_MS || 300000),
);
const KOKORO_MAX_WORDS_PER_REQUEST = Math.max(
  200,
  Number(process.env.VF_TTS_LONGTEXT_KOKORO_MAX_WORDS_PER_REQUEST || 1400),
);
const GEMINI_QUOTA_PREFLIGHT_WORDS = Math.max(
  12,
  Number(process.env.VF_TTS_LONGTEXT_GEMINI_QUOTA_PREFLIGHT_WORDS || 80),
);
const GEMINI_QUOTA_PREFLIGHT_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.VF_TTS_LONGTEXT_GEMINI_QUOTA_PREFLIGHT_TIMEOUT_MS || 30_000),
);
const ALLOW_PREFLIGHT_FAILURE = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.VF_TTS_LONGTEXT_ALLOW_PREFLIGHT_FAILURE || '').trim().toLowerCase(),
);
const RETRY_MAX = Math.max(0, Number(process.env.VF_TTS_LONGTEXT_RETRY_MAX || 2));
const RETRY_BASE_MS = Math.max(100, Number(process.env.VF_TTS_LONGTEXT_RETRY_BASE_MS || 800));

const EN_UNITS = [
  'One day Mohan asked his mother for fresh vegetables.',
  'She replied that the market trip keeps him active.',
  'He smiled and promised to walk quickly and return.',
];

const HI_UNITS = [
  '\u090f\u0915 \u0926\u093f\u0928 \u092e\u094b\u0939\u0928 \u0915\u0940 \u092e\u093e\u0901 \u0928\u0947 \u0909\u0938\u0947 \u0938\u092c\u094d\u091c\u093c\u0940 \u0932\u0947\u0928\u0947 \u092d\u0947\u091c\u093e\u0964',
  '\u092e\u094b\u0939\u0928 \u0928\u0947 \u0939\u0901\u0938\u0924\u0947 \u0939\u0941\u090f \u0915\u0939\u093e \u0915\u093f \u0935\u0939 \u091c\u0932\u094d\u0926\u0940 \u0932\u094c\u091f \u0906\u090f\u0917\u093e\u0964',
  '\u092e\u093e\u0901 \u0928\u0947 \u092a\u094d\u092f\u093e\u0930 \u0938\u0947 \u0915\u0939\u093e \u0915\u093f \u0930\u093e\u0938\u094d\u0924\u0947 \u092e\u0947\u0902 \u0927\u094d\u092f\u093e\u0928 \u0930\u0916\u0928\u093e\u0964',
];

const ENGINES = {
  GEM: {
    url: `${GEM_URL}/synthesize`,
    voice: 'Fenrir',
    language: { en: 'en', hi: 'hi' },
  },
  KOKORO: {
    url: `${KOKORO_URL}/synthesize`,
    voice: 'hf_alpha',
    language: { en: 'en', hi: 'hi' },
  },
};

const LONGTEXT_ENGINES = String(process.env.VF_TTS_LONGTEXT_ENGINES || "GEM,KOKORO")
  .split(",")
  .map((item) => String(item || "").trim().toUpperCase())
  .filter(Boolean);
const ACTIVE_ENGINES = Array.from(new Set(LONGTEXT_ENGINES.length > 0 ? LONGTEXT_ENGINES : ["GEM", "KOKORO"]))
  .filter((engine) => Object.prototype.hasOwnProperty.call(ENGINES, engine));
const PRIMARY_GEM_ENGINE = ACTIVE_ENGINES.find((engine) => engine !== "KOKORO") || ACTIVE_ENGINES[0] || "GEM";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const countWords = (text) =>
  String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

const buildTextToWords = (units, targetWords) => {
  const safeTarget = Math.max(1, Number(targetWords) || 1);
  const words = [];
  let index = 0;
  while (words.length < safeTarget) {
    const unit = units[index % units.length];
    words.push(...unit.split(/\s+/).filter(Boolean));
    index += 1;
  }
  return words.slice(0, safeTarget).join(' ');
};

const readU16 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);
const readU32 = (bytes, offset) =>
  (bytes[offset]) |
  (bytes[offset + 1] << 8) |
  (bytes[offset + 2] << 16) |
  (bytes[offset + 3] << 24);

const parseWav = (buffer) => {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (bytes.length < 44) throw new Error('WAV too small');
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Invalid WAV header');
  }
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString('ascii', offset, offset + 4);
    const chunkSize = readU32(bytes, offset + 4);
    const chunkDataStart = offset + 8;
    if (chunkDataStart + chunkSize > bytes.length) break;
    if (chunkId === 'fmt ') {
      channels = readU16(bytes, chunkDataStart + 2);
      sampleRate = readU32(bytes, chunkDataStart + 4);
      bitsPerSample = readU16(bytes, chunkDataStart + 14);
    } else if (chunkId === 'data') {
      dataSize = chunkSize;
      break;
    }
    offset = chunkDataStart + chunkSize + (chunkSize % 2);
  }
  if (!sampleRate || !channels || !bitsPerSample || !dataSize) {
    throw new Error('WAV missing required chunks');
  }
  const bytesPerSample = Math.max(1, bitsPerSample / 8);
  const duration = dataSize / (sampleRate * channels * bytesPerSample);
  return { sampleRate, channels, bitsPerSample, dataSize, duration };
};

const parseErrorDetail = async (response) => {
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  try {
    if (type.includes('application/json')) {
      const payload = await response.json();
      return payload?.detail ?? payload ?? null;
    }
    const text = await response.text();
    return text || null;
  } catch {
    return null;
  }
};

const sanitizeErrorDetail = (detail) => {
  if (!detail || typeof detail !== 'object') return detail;
  const clone = JSON.parse(JSON.stringify(detail));
  if (clone && typeof clone === 'object') {
    delete clone.keyAttempts;
    delete clone.modelAttempts;
    delete clone.keyStates;
    if (typeof clone.summary === 'string' && clone.summary.length > 240) {
      clone.summary = `${clone.summary.slice(0, 240)}...`;
    }
    if (typeof clone.error === 'string' && clone.error.length > 240) {
      clone.error = `${clone.error.slice(0, 240)}...`;
    }
  }
  return clone;
};

const classifyTransportError = (error, timeoutMs) => {
  const name = String(error?.name || '');
  const message = String(error?.message || '');
  if (name.toLowerCase() === 'aborterror' || message.toLowerCase().includes('aborted')) {
    return {
      code: 'REQUEST_TIMEOUT',
      message: `request timed out after ${timeoutMs}ms`,
    };
  }
  return {
    code: 'NETWORK_ERROR',
    message: message || 'network request failed',
  };
};

const extractErrorCode = (error) => {
  if (!error || typeof error !== 'object') return '';
  const direct = String(error.errorCode || error.code || '').trim();
  if (direct) return direct.toUpperCase();
  const nested = error.detail;
  if (nested && typeof nested === 'object') {
    const nestedCode = String(nested.errorCode || nested.code || '').trim();
    if (nestedCode) return nestedCode.toUpperCase();
  }
  return '';
};

const toLowerText = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.toLowerCase();
  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return String(value).toLowerCase();
  }
};

const isQuotaBlockedFailure = ({ status, failureClass, error }) => {
  const failureToken = String(failureClass || '').trim().toLowerCase();
  const code = extractErrorCode(error);
  const detailText = toLowerText(error);
  if (failureToken === 'quota_or_throttle' || status === 429) return true;
  if (code.includes('RATE_LIMIT') || code.includes('QUOTA') || code.includes('OVERLOADED') || code.includes('API_KEY_MISSING')) {
    return true;
  }
  return (
    detailText.includes('quota') ||
    detailText.includes('rate limit') ||
    detailText.includes('all keys rate limited') ||
    detailText.includes('pool overloaded')
  );
};

const normalizeLongtextFailureClass = (result) => {
  if (!result || result.ok) return 'ok';
  const status = Number(result.status || 0);
  const failureToken = String(result.failureClass || '').trim().toLowerCase();
  if (isQuotaBlockedFailure({ status, failureClass: failureToken, error: result.error })) return 'quota_blocked';
  if (failureToken === 'timeout') return 'timeout';
  if (failureToken === 'backend_unavailable') return 'backend_unavailable';
  if (failureToken === 'backend_error') return 'backend_error';
  if (failureToken === 'auth') return 'auth_error';
  if (failureToken === 'quality_regression') return 'quality_regression';
  if (failureToken === 'client_error') return 'client_error';
  if (status >= 500) return 'backend_error';
  if (status >= 400) return 'client_error';
  return 'unknown';
};

const buildChunkWordPlan = (totalWords, maxWordsPerChunk) => {
  const safeTotal = Math.max(1, Number(totalWords) || 1);
  const safeChunk = Math.max(1, Number(maxWordsPerChunk) || safeTotal);
  const chunks = [];
  let remaining = safeTotal;
  while (remaining > 0) {
    const take = Math.min(safeChunk, remaining);
    chunks.push(take);
    remaining -= take;
  }
  return chunks;
};

const summarizeErrorForLog = (error) => {
  if (!error) return '-';
  if (typeof error === 'string') {
    return error.length > 200 ? `${error.slice(0, 200)}...` : error;
  }
  if (typeof error !== 'object') return String(error);
  const code = error.errorCode || error.code || null;
  const classification = error.classification || null;
  const retryAfterMs = Number(error.retryAfterMs || 0) || undefined;
  const status = Number(error.status || 0) || undefined;
  const message = String(error.error || error.message || error.summary || '').slice(0, 200) || undefined;
  return JSON.stringify({ code, classification, status, retryAfterMs, message });
};

const postJsonWithTimeout = async (url, payload, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const runRuntimePreflight = async () => {
  const runtimes = [
    { name: 'GEM', url: `${GEM_URL}/health` },
    { name: 'KOKORO', url: `${KOKORO_URL}/health` },
  ];
  const checks = [];

  for (const runtime of runtimes) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(runtime.url, { method: 'GET', signal: controller.signal }).finally(() => clearTimeout(timer));
      checks.push({
        name: runtime.name,
        ok: response.ok,
        status: response.status,
        classification: response.ok ? 'ok' : classifyAuditFailure({ status: response.status, payload: await parseErrorDetail(response) }),
      });
    } catch (error) {
      checks.push({
        name: runtime.name,
        ok: false,
        status: 0,
        classification: classifyAuditFailure({ status: 0, payload: error instanceof Error ? error.message : String(error) }),
      });
    }
  }

  return {
    ok: checks.every((entry) => entry.ok),
    checks,
  };
};

const synthesizeSingle = async ({
  engine,
  language,
  words,
  traceId,
  timeoutMs,
  retryMax = RETRY_MAX,
}) => {
  const runtime = ENGINES[engine];
  const unitBank = language === 'hi' ? HI_UNITS : EN_UNITS;
  const text = buildTextToWords(unitBank, words);
  const normalizedWords = countWords(text);
  const languageCode = runtime.language[language];

  const payload = engine === 'GEM'
    ? {
        text,
        voiceName: runtime.voice,
        voice_id: runtime.voice,
        language: languageCode,
        speed: 1.0,
        trace_id: traceId,
      }
    : {
        text,
        voiceId: runtime.voice,
        voice_id: runtime.voice,
        language: languageCode,
        speed: 1.0,
        trace_id: traceId,
      };

  const started = Date.now();
  return withBoundedRetry(
    async () => {
      let response;
      try {
        response = await postJsonWithTimeout(runtime.url, payload, timeoutMs);
      } catch (error) {
        const elapsedMs = Date.now() - started;
        const transport = classifyTransportError(error, timeoutMs);
        return {
          ok: false,
          status: 0,
          error: transport,
          elapsedMs,
          wordCount: normalizedWords,
          failureClass: classifyAuditFailure({ status: 0, payload: transport }),
        };
      }

      const elapsedMs = Date.now() - started;
      if (!response.ok) {
        const detail = sanitizeErrorDetail(await parseErrorDetail(response));
        return {
          ok: false,
          status: response.status,
          error: detail,
          elapsedMs,
          wordCount: normalizedWords,
          failureClass: classifyAuditFailure({ status: response.status, payload: detail }),
        };
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      const wav = parseWav(bytes);
      const wordsPerSec = normalizedWords / Math.max(0.001, wav.duration);
      const qualityOk = bytes.length > 100 && wav.duration > 0.3 && wordsPerSec > 0.15 && wordsPerSec < 9.0;
      return {
        ok: qualityOk,
        status: 200,
        elapsedMs,
        bytes: bytes.length,
        wordCount: normalizedWords,
        durationSec: Number(wav.duration.toFixed(3)),
        wordsPerSec: Number(wordsPerSec.toFixed(3)),
        sampleRate: wav.sampleRate,
        channels: wav.channels,
        bitsPerSample: wav.bitsPerSample,
        failureClass: qualityOk ? null : 'quality_regression',
      };
    },
    {
      maxRetries: retryMax,
      baseDelayMs: RETRY_BASE_MS,
      shouldRetry: (result) => !result.ok && isTransientFailureClass(String(result.failureClass || '')),
    }
  );
};

const synthesize = async ({ engine, language, words, traceId }) => {
  const timeoutMs = engine === 'KOKORO' ? KOKORO_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  if (engine !== 'KOKORO' || words <= KOKORO_MAX_WORDS_PER_REQUEST) {
    return synthesizeSingle({ engine, language, words, traceId, timeoutMs });
  }

  const wordChunks = buildChunkWordPlan(words, KOKORO_MAX_WORDS_PER_REQUEST);
  const chunkResults = [];
  let totalElapsedMs = 0;
  let totalBytes = 0;
  let totalWordCount = 0;
  let totalDurationSec = 0;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;

  for (let index = 0; index < wordChunks.length; index += 1) {
    const chunkWords = wordChunks[index];
    const chunkTraceId = `${traceId}_chunk_${index + 1}`;
    // Keep retries tightly bounded for chunked long-text calls to control gate duration.
    // eslint-disable-next-line no-await-in-loop
    const chunk = await synthesizeSingle({
      engine,
      language,
      words: chunkWords,
      traceId: chunkTraceId,
      timeoutMs,
      retryMax: Math.min(1, RETRY_MAX),
    });
    chunkResults.push({
      index: index + 1,
      traceId: chunkTraceId,
      words: chunkWords,
      ok: chunk.ok,
      status: chunk.status,
      failureClass: chunk.failureClass || null,
    });

    if (!chunk.ok) {
      return {
        ...chunk,
        engine,
        language,
        chunked: true,
        chunkIndex: index + 1,
        chunkCount: wordChunks.length,
        chunkWordPlan: wordChunks,
        chunkResults,
      };
    }

    totalElapsedMs += Number(chunk.elapsedMs || 0);
    totalBytes += Number(chunk.bytes || 0);
    totalWordCount += Number(chunk.wordCount || 0);
    totalDurationSec += Number(chunk.durationSec || 0);
    sampleRate = Number(chunk.sampleRate || sampleRate || 0);
    channels = Number(chunk.channels || channels || 0);
    bitsPerSample = Number(chunk.bitsPerSample || bitsPerSample || 0);
  }

  const wordsPerSec = totalWordCount / Math.max(0.001, totalDurationSec);
  return {
    ok: true,
    status: 200,
    elapsedMs: totalElapsedMs,
    bytes: totalBytes,
    wordCount: totalWordCount,
    durationSec: Number(totalDurationSec.toFixed(3)),
    wordsPerSec: Number(wordsPerSec.toFixed(3)),
    sampleRate,
    channels,
    bitsPerSample,
    failureClass: null,
    chunked: true,
    chunkCount: wordChunks.length,
    chunkWordPlan: wordChunks,
    chunkResults,
  };
};

const runGeminiQuotaPrecheck = async () => {
  const traceId = `vf_longtxt_quota_precheck_${Date.now().toString(36)}`;
  const result = await synthesizeSingle({
    engine: PRIMARY_GEM_ENGINE,
    language: 'en',
    words: GEMINI_QUOTA_PREFLIGHT_WORDS,
    traceId,
    timeoutMs: GEMINI_QUOTA_PREFLIGHT_TIMEOUT_MS,
    retryMax: 0,
  });
  return {
    ...result,
    traceId,
    words: GEMINI_QUOTA_PREFLIGHT_WORDS,
    timeoutMs: GEMINI_QUOTA_PREFLIGHT_TIMEOUT_MS,
    classification: normalizeLongtextFailureClass(result),
  };
};

const runSmoke = async (report) => {
  for (const engine of ACTIVE_ENGINES) {
    for (const language of ['hi', 'en']) {
      const traceId = `vf_longtxt_${engine.toLowerCase()}_${language}_${Date.now().toString(36)}`;
      const result = await synthesize({
        engine,
        language,
        words: 5000,
        traceId,
      });
      report.tests.push({
        kind: 'smoke-5000',
        engine,
        language,
        expected: 'success',
        ...result,
        classification: normalizeLongtextFailureClass(result),
      });
      await sleep(200);
    }
  }
};

const runMatrix = async (report) => {
  for (const engine of ACTIVE_ENGINES) {
    for (const words of [4999, 5000, 5001]) {
      const traceId = `vf_longtxt_${engine.toLowerCase()}_${words}_${Date.now().toString(36)}`;
      const result = await synthesize({
        engine,
        language: 'hi',
        words,
        traceId,
      });
      const expected = words <= 5000 ? 'success' : 'http_400';
      const ok = words <= 5000 ? result.ok : result.status === 400;
      report.tests.push({
        kind: 'matrix-boundary',
        engine,
        language: 'hi',
        words,
        expected,
        ...result,
        assertionOk: ok,
        classification: ok ? 'ok' : normalizeLongtextFailureClass(result),
      });
      await sleep(200);
    }
  }
};

const main = async () => {
  const startedAt = new Date().toISOString();
  const preflight = await runRuntimePreflight();
  const report = {
    startedAt,
    mode: MODE,
    preflight,
    retry: {
      max: RETRY_MAX,
      baseMs: RETRY_BASE_MS,
    },
    tuning: {
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      kokoroRequestTimeoutMs: KOKORO_REQUEST_TIMEOUT_MS,
      kokoroMaxWordsPerRequest: KOKORO_MAX_WORDS_PER_REQUEST,
      geminiQuotaPrecheckWords: GEMINI_QUOTA_PREFLIGHT_WORDS,
      geminiQuotaPrecheckTimeoutMs: GEMINI_QUOTA_PREFLIGHT_TIMEOUT_MS,
      engines: ACTIVE_ENGINES,
      quotaPrecheckEngine: PRIMARY_GEM_ENGINE,
      allowPrecheckFailure: ALLOW_PREFLIGHT_FAILURE,
    },
    runtimes: {
      GEM: GEM_URL,
      KOKORO: KOKORO_URL,
    },
    tests: [],
    quotaPrecheck: null,
    verdict: null,
    passed: false,
  };

  if (!preflight.ok) {
    report.finishedAt = new Date().toISOString();
    report.failed = 0;
    report.passed = false;
    report.failureReason = 'runtime_preflight_failure';
    await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
    await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    console.log(`Long-text report written to ${path.relative(ROOT, REPORT_PATH).replace(/\\/g, '/')}`);
    console.log(`Mode: ${MODE}`);
    for (const check of preflight.checks.filter((entry) => !entry.ok)) {
      console.log(`[FAIL] preflight ${check.name} status=${check.status} class=${check.classification}`);
    }
    process.exit(1);
  }

  const quotaPrecheck = await runGeminiQuotaPrecheck();
  report.quotaPrecheck = quotaPrecheck;
  if (!quotaPrecheck.ok) {
    const precheckClass = String(quotaPrecheck.classification || 'unknown');
    const precheckReliability = new Set(['timeout', 'backend_unavailable', 'backend_error', 'quality_regression']);
    const isReliabilityFailure = precheckReliability.has(precheckClass);
    const isQuotaFailure = precheckClass === 'quota_blocked';
    if (ALLOW_PREFLIGHT_FAILURE) {
      report.precheckBypassed = {
        enabled: true,
        failureClass: precheckClass,
        status: quotaPrecheck.status,
        error: quotaPrecheck.error || null,
      };
      console.log(
        `[WARN] gemini quota precheck class=${quotaPrecheck.classification} status=${quotaPrecheck.status} ` +
        `error=${summarizeErrorForLog(quotaPrecheck.error)}; continuing because VF_TTS_LONGTEXT_ALLOW_PREFLIGHT_FAILURE=1`
      );
    } else {
    report.finishedAt = new Date().toISOString();
    report.failed = 0;
    report.passed = false;
    report.failureReason = precheckClass || 'quota_precheck_failed';
    report.verdict = {
      passed: false,
      gateFailureClass: precheckClass || 'quota_precheck_failed',
      reliabilityFailures: isReliabilityFailure ? 1 : 0,
      quotaBlockedFailures: isQuotaFailure ? 1 : 0,
      policyFailures: (!isReliabilityFailure && !isQuotaFailure) ? 1 : 0,
      byClass: {
        [precheckClass]: 1,
      },
    };
    await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
    await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    console.log(`Long-text report written to ${path.relative(ROOT, REPORT_PATH).replace(/\\/g, '/')}`);
    console.log(`Mode: ${MODE}`);
    console.log(
      `[FAIL] gemini quota precheck class=${quotaPrecheck.classification} status=${quotaPrecheck.status} ` +
      `error=${summarizeErrorForLog(quotaPrecheck.error)}`
    );
    process.exit(1);
    }
  }

  if (MODE === 'matrix') {
    await runSmoke(report);
    await runMatrix(report);
  } else {
    await runSmoke(report);
  }

  const failed = report.tests.filter((test) => {
    if (test.kind === 'matrix-boundary') {
      return test.assertionOk === false;
    }
    return !test.ok;
  });
  const byClass = failed.reduce((acc, test) => {
    const token = String(test.classification || normalizeLongtextFailureClass(test) || 'unknown');
    acc[token] = Number(acc[token] || 0) + 1;
    return acc;
  }, {});
  const reliabilityFailureClasses = new Set(['timeout', 'backend_unavailable', 'backend_error', 'quality_regression']);
  const reliabilityFailures = Object.entries(byClass).reduce(
    (sum, [token, count]) => (reliabilityFailureClasses.has(token) ? sum + Number(count || 0) : sum),
    0
  );
  const quotaBlockedFailures = Number(byClass.quota_blocked || 0);
  const policyFailures = failed.length - reliabilityFailures - quotaBlockedFailures;
  const gateFailureClass = failed.length === 0
    ? 'none'
    : (quotaBlockedFailures > 0
      ? 'quota_blocked'
      : (reliabilityFailures > 0 ? 'runtime_reliability' : 'policy_failure'));
  report.failed = failed.length;
  report.passed = failed.length === 0;
  report.finishedAt = new Date().toISOString();
  report.verdict = {
    passed: report.passed,
    gateFailureClass,
    reliabilityFailures,
    quotaBlockedFailures,
    policyFailures: Math.max(0, policyFailures),
    byClass,
  };

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  console.log(`Long-text report written to ${path.relative(ROOT, REPORT_PATH).replace(/\\/g, '/')}`);
  console.log(`Mode: ${MODE}`);
  console.log(`Passed: ${report.passed}`);
  if (!report.passed) {
    for (const entry of failed.slice(0, 12)) {
      console.log(
        `[FAIL] ${entry.kind} ${entry.engine} ${entry.language || ''} words=${entry.words || entry.wordCount || '-'} ` +
        `status=${entry.status} class=${entry.classification || normalizeLongtextFailureClass(entry)} ` +
        `error=${summarizeErrorForLog(entry.error)}`
      );
    }
    console.log(
      `[FAIL] verdict class=${gateFailureClass} reliability=${reliabilityFailures} quota_blocked=${quotaBlockedFailures} ` +
      `policy=${Math.max(0, policyFailures)}`
    );
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
