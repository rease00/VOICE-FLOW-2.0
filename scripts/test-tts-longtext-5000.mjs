#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const MODE = process.argv.includes('--mode')
  ? String(process.argv[process.argv.indexOf('--mode') + 1] || 'smoke').toLowerCase()
  : 'smoke';

const REPORT_PATH = path.join(ROOT, 'artifacts', 'tts_longtext_5000_audit_report.json');
const GEM_URL = String(process.env.VF_GEMINI_RUNTIME_URL || 'http://127.0.0.1:7810').replace(/\/+$/, '');
const KOKORO_URL = String(process.env.VF_KOKORO_RUNTIME_URL || 'http://127.0.0.1:7820').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = Number(process.env.VF_TTS_LONGTEXT_TIMEOUT_MS || 240000);

const EN_UNITS = [
  'One day Mohan asked his mother for fresh vegetables.',
  'She replied that the market trip keeps him active.',
  'He smiled and promised to walk quickly and return.',
];

const HI_UNITS = [
  'एक दिन मोहन की माँ ने उसे सब्ज़ी लेने भेजा।',
  'मोहन ने हँसते हुए कहा कि वह जल्दी लौट आएगा।',
  'माँ ने प्यार से कहा कि रास्ते में ध्यान रखना।',
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

const synthesize = async ({ engine, language, words, traceId }) => {
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
  const response = await postJsonWithTimeout(runtime.url, payload);
  const elapsedMs = Date.now() - started;
  if (!response.ok) {
    const detail = await parseErrorDetail(response);
    return {
      ok: false,
      status: response.status,
      error: detail,
      elapsedMs,
      wordCount: normalizedWords,
    };
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const wav = parseWav(bytes);
  const wordsPerSec = normalizedWords / Math.max(0.001, wav.duration);
  return {
    ok: bytes.length > 100 && wav.duration > 0.3 && wordsPerSec > 0.15 && wordsPerSec < 9.0,
    status: 200,
    elapsedMs,
    bytes: bytes.length,
    wordCount: normalizedWords,
    durationSec: Number(wav.duration.toFixed(3)),
    wordsPerSec: Number(wordsPerSec.toFixed(3)),
    sampleRate: wav.sampleRate,
    channels: wav.channels,
    bitsPerSample: wav.bitsPerSample,
  };
};

const runSmoke = async (report) => {
  for (const engine of ['GEM', 'KOKORO']) {
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
      });
      await sleep(200);
    }
  }
};

const runMatrix = async (report) => {
  for (const engine of ['GEM', 'KOKORO']) {
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
      });
      await sleep(200);
    }
  }
};

const main = async () => {
  const startedAt = new Date().toISOString();
  const report = {
    startedAt,
    mode: MODE,
    runtimes: {
      GEM: GEM_URL,
      KOKORO: KOKORO_URL,
    },
    tests: [],
    passed: false,
  };

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
  report.failed = failed.length;
  report.passed = failed.length === 0;
  report.finishedAt = new Date().toISOString();

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  console.log(`Long-text report written to ${path.relative(ROOT, REPORT_PATH).replace(/\\/g, '/')}`);
  console.log(`Mode: ${MODE}`);
  console.log(`Passed: ${report.passed}`);
  if (!report.passed) {
    for (const entry of failed.slice(0, 12)) {
      console.log(
        `[FAIL] ${entry.kind} ${entry.engine} ${entry.language || ''} words=${entry.words || entry.wordCount || '-'} ` +
        `status=${entry.status} error=${typeof entry.error === 'string' ? entry.error : JSON.stringify(entry.error)}`
      );
    }
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
