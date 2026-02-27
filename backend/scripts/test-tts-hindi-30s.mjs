#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const TARGET_SECONDS = Number(process.env.VF_TTS_AUDIT_TARGET_SECONDS || 30);
const MIN_SECONDS = Number(process.env.VF_TTS_AUDIT_MIN_SECONDS || 24);
const MAX_SECONDS = Number(process.env.VF_TTS_AUDIT_MAX_SECONDS || 36);
const CHARS_PER_SECOND = Number(process.env.VF_TTS_AUDIT_CHARS_PER_SEC || 15);
const REQUEST_TIMEOUT_MS = Number(process.env.VF_TTS_AUDIT_TIMEOUT_MS || 180_000);
const MEDIA_BACKEND_URL = (process.env.VF_MEDIA_BACKEND_URL || 'http://127.0.0.1:7800').replace(/\/+$/, '');
const SWITCH_TIMEOUT_MS = Number(process.env.VF_TTS_AUDIT_SWITCH_TIMEOUT_MS || 90_000);
const SWITCH_POLL_MS = Number(process.env.VF_TTS_AUDIT_SWITCH_POLL_MS || 1_200);
const SKIP_RUNTIME_SWITCH = ['1', 'true', 'yes'].includes((process.env.VF_TTS_AUDIT_SKIP_SWITCH || '').trim().toLowerCase());

const REPORT_BASENAME = TARGET_SECONDS === 30 ? 'tts_hi_30s_report.json' : `tts_hi_${TARGET_SECONDS}s_report.json`;
const REPORT_PATH = path.join(ARTIFACT_DIR, REPORT_BASENAME);

const CORE_EMOTIONS = ['Neutral', 'Happy', 'Sad', 'Angry', 'Calm', 'Excited'];

const BASE_HINDI_TEXT = `नमस्ते, यह हिंदी आवाज़ गुणवत्ता जाँच है।
आज हम स्पष्ट उच्चारण, प्राकृतिक विराम और बोलने की लय की जाँच कर रहे हैं।
अगर आप यह वाक्य साफ़ सुन पा रहे हैं, तो मॉडल सही तरीके से काम कर रहा है।
अब मैं कुछ सामान्य शब्द बोल रही हूँ: सुबह की चाय, हल्की बारिश, बच्चों की हँसी और शाम की ठंडी हवा।
कृपया इस ऑडियो की स्पष्टता और प्राकृतिकता पर ध्यान दें।`;

const normalizeWhitespace = (text) => String(text || '').replace(/\s+/g, ' ').trim();

const buildHindiTestText = (targetSeconds, charsPerSecond) => {
  const safeSeconds = Number.isFinite(targetSeconds) && targetSeconds > 0 ? targetSeconds : 30;
  const safeCps = Number.isFinite(charsPerSecond) && charsPerSecond > 0 ? charsPerSecond : 15;
  const baseText = normalizeWhitespace(BASE_HINDI_TEXT);
  const targetChars = Math.max(baseText.length, Math.round(safeSeconds * safeCps));
  if (baseText.length >= targetChars) return baseText;

  const chunks = [];
  while (normalizeWhitespace(chunks.join(' ')).length < targetChars) {
    chunks.push(baseText);
  }
  return normalizeWhitespace(chunks.join(' '));
};

const HINDI_TEST_TEXT = buildHindiTestText(TARGET_SECONDS, CHARS_PER_SECOND);

const parseListEnv = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const resolveRuntimeUrls = (primaryEnv, fallbackEnv, fallback) => {
  const primary = parseListEnv(primaryEnv);
  if (primary.length > 0) return primary;
  const secondary = parseListEnv(fallbackEnv);
  if (secondary.length > 0) return secondary;
  return [fallback];
};

const ENGINE_CONFIGS = [
  {
    id: 'GEMINI_RUNTIME',
    switchEngine: 'GEM',
    runtimeUrls: resolveRuntimeUrls(process.env.VF_TTS_AUDIT_GEMINI_URLS, process.env.VF_GEMINI_RUNTIME_URL, 'http://127.0.0.1:7810'),
    synthPath: '/synthesize',
    buildPayload: ({ text, emotion }) => ({
      text,
      voiceName: process.env.VF_TTS_AUDIT_GEMINI_VOICE || 'Sulafat',
      voice_id: process.env.VF_TTS_AUDIT_GEMINI_VOICE || 'Sulafat',
      language: 'hi',
      emotion,
      speed: 1.0,
    }),
  },
  {
    id: 'KOKORO_RUNTIME',
    switchEngine: 'KOKORO',
    runtimeUrls: resolveRuntimeUrls(process.env.VF_TTS_AUDIT_KOKORO_URLS, process.env.VF_KOKORO_RUNTIME_URL, 'http://127.0.0.1:7820'),
    synthPath: '/synthesize',
    buildPayload: ({ text, emotion }) => ({
      text,
      voiceId: process.env.VF_TTS_AUDIT_KOKORO_VOICE || 'hf_alpha',
      voice_id: process.env.VF_TTS_AUDIT_KOKORO_VOICE || 'hf_alpha',
      language: 'hi',
      emotion,
      speed: 1.0,
    }),
  },
];

const round3 = (value) => Math.round(Number(value || 0) * 1000) / 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithTimeout = async (url, init, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const readU16 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);
const readU32 = (bytes, offset) =>
  bytes[offset] |
  (bytes[offset + 1] << 8) |
  (bytes[offset + 2] << 16) |
  (bytes[offset + 3] << 24);

const decodeWavDuration = (buffer) => {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (bytes.length < 44) throw new Error('WAV too small.');
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Invalid WAV header.');
  }

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataSize = 0;

  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString('ascii', offset, offset + 4);
    const chunkSize = readU32(bytes, offset + 4);
    const chunkStart = offset + 8;
    if (chunkStart + chunkSize > bytes.length) break;

    if (chunkId === 'fmt ') {
      channels = readU16(bytes, chunkStart + 2);
      sampleRate = readU32(bytes, chunkStart + 4);
      bitsPerSample = readU16(bytes, chunkStart + 14);
    } else if (chunkId === 'data') {
      dataSize = chunkSize;
      break;
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (!sampleRate || !channels || !bitsPerSample || !dataSize) {
    throw new Error('WAV metadata missing required fields.');
  }

  const bytesPerSample = Math.max(1, bitsPerSample / 8);
  const durationSeconds = dataSize / (sampleRate * channels * bytesPerSample);
  return {
    durationSeconds,
    sampleRate,
    channels,
    bitsPerSample,
  };
};

const buildEmotionText = (emotion) => {
  const label = String(emotion || 'Neutral').trim();
  return `भाव ${label}: ${HINDI_TEST_TEXT}`;
};

const parseJsonSafe = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const switchRuntimeEngine = async (engine) => {
  const started = Date.now();
  const response = await fetchWithTimeout(
    `${MEDIA_BACKEND_URL}/tts/engines/switch`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine, gpu: false }),
    },
    SWITCH_TIMEOUT_MS
  );

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const detail = typeof payload === 'string' ? payload : JSON.stringify(payload);
    throw new Error(`runtime switch failed (${response.status}): ${detail}`);
  }

  const baseUrl = String(payload?.runtimeUrl || '').trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('runtime switch response missing runtimeUrl.');

  const deadline = Date.now() + SWITCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const health = await fetchWithTimeout(`${baseUrl}/health`, { method: 'GET' }, Math.min(8_000, SWITCH_POLL_MS + 3000));
      if (health.ok) {
        return {
          baseUrl,
          waitElapsedMs: Date.now() - started,
          switchPayload: payload,
        };
      }
    } catch {
      // wait and retry
    }
    await sleep(SWITCH_POLL_MS);
  }

  throw new Error(`runtime did not become healthy in ${Math.round(SWITCH_TIMEOUT_MS / 1000)}s: ${baseUrl}`);
};

const resolveRuntimeBase = async (runtimeUrls, preferredBaseUrl) => {
  const candidates = [preferredBaseUrl, ...runtimeUrls]
    .map((item) => String(item || '').trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const seen = new Set();
  const unique = candidates.filter((item) => {
    if (seen.has(item)) return false;
    seen.add(item);
    return true;
  });

  const failures = [];
  for (const baseUrl of unique) {
    try {
      const health = await fetchWithTimeout(`${baseUrl}/health`, { method: 'GET' }, 8_000);
      if (health.ok) return { baseUrl, failures };
      failures.push({ baseUrl, reason: `health_status_${health.status}` });
    } catch (error) {
      failures.push({ baseUrl, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { baseUrl: null, failures };
};

const runEngineAudit = async (config, emotion, runtimeSession) => {
  const started = Date.now();
  const baseUrl = runtimeSession.baseUrl;
  const text = buildEmotionText(emotion);
  const payload = config.buildPayload({ text, emotion });

  const response = await fetchWithTimeout(
    `${baseUrl}${config.synthPath}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    REQUEST_TIMEOUT_MS
  );

  if (!response.ok) {
    const detail = await parseJsonSafe(response);
    return {
      engine: config.id,
      emotion,
      status: 'failed',
      reason: `synthesis_failed_${response.status}`,
      detail,
      elapsedMs: Date.now() - started,
    };
  }

  const wavBytes = Buffer.from(await response.arrayBuffer());
  if (wavBytes.length < 100) {
    return {
      engine: config.id,
      emotion,
      status: 'failed',
      reason: 'empty_audio',
      elapsedMs: Date.now() - started,
    };
  }

  const wav = decodeWavDuration(wavBytes);
  const durationSeconds = Number(wav.durationSeconds || 0);
  const durationOk = durationSeconds >= MIN_SECONDS && durationSeconds <= MAX_SECONDS;

  const wavPath = path.join(
    ARTIFACT_DIR,
    `${config.id.toLowerCase()}_${emotion.toLowerCase().replace(/[^a-z0-9]+/g, '-')}_hi_${TARGET_SECONDS}s.wav`
  );
  await fs.writeFile(wavPath, wavBytes);

  return {
    engine: config.id,
    emotion,
    status: durationOk ? 'passed' : 'failed',
    reason: durationOk ? '' : `duration_out_of_range_${MIN_SECONDS}_${MAX_SECONDS}`,
    elapsedMs: Date.now() - started,
    wav: path.relative(ROOT, wavPath),
    bytes: wavBytes.length,
    durationSeconds: round3(durationSeconds),
    sampleRate: wav.sampleRate,
    channels: wav.channels,
    bitsPerSample: wav.bitsPerSample,
  };
};

const main = async () => {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });

  const results = [];

  for (const config of ENGINE_CONFIGS) {
    let runtimeSession = { ok: true, baseUrl: null, reason: '', runtimeSwitch: null, probes: [] };

    try {
      if (!SKIP_RUNTIME_SWITCH) {
        const switched = await switchRuntimeEngine(config.switchEngine);
        runtimeSession.runtimeSwitch = switched;
      }
    } catch (error) {
      runtimeSession.ok = false;
      runtimeSession.reason = error instanceof Error ? error.message : String(error);
    }

    if (runtimeSession.ok) {
      const base = await resolveRuntimeBase(config.runtimeUrls, runtimeSession.runtimeSwitch?.baseUrl || null);
      runtimeSession.baseUrl = base.baseUrl;
      runtimeSession.probes = base.failures;
      if (!base.baseUrl) {
        runtimeSession.ok = false;
        runtimeSession.reason = 'runtime_unreachable';
      }
    }

    if (!runtimeSession.ok) {
      for (const emotion of CORE_EMOTIONS) {
        results.push({
          engine: config.id,
          emotion,
          status: 'failed',
          reason: runtimeSession.reason,
          runtimeSwitch: runtimeSession.runtimeSwitch,
          probes: runtimeSession.probes,
          elapsedMs: 0,
        });
      }
      continue;
    }

    for (const emotion of CORE_EMOTIONS) {
      const entry = await runEngineAudit(config, emotion, runtimeSession);
      entry.runtimeSwitch = runtimeSession.runtimeSwitch;
      entry.probes = runtimeSession.probes;
      results.push(entry);
      console.log(`${entry.engine} | emotion=${emotion} | ${entry.status.toUpperCase()} | ${entry.reason || `${entry.durationSeconds}s`}`);
    }
  }

  const byEngine = {};
  for (const result of results) {
    if (!byEngine[result.engine]) {
      byEngine[result.engine] = { total: 0, passed: 0, failed: 0 };
    }
    byEngine[result.engine].total += 1;
    if (result.status === 'passed') byEngine[result.engine].passed += 1;
    else byEngine[result.engine].failed += 1;
  }

  const failed = results.filter((item) => item.status !== 'passed');
  const report = {
    timestamp: new Date().toISOString(),
    profile: TARGET_SECONDS === 30 ? 'hindi-30s-tts-audit' : `hindi-${TARGET_SECONDS}s-tts-audit`,
    targetSeconds: TARGET_SECONDS,
    durationBandSeconds: [MIN_SECONDS, MAX_SECONDS],
    charsPerSecond: CHARS_PER_SECOND,
    runtimes: {
      GEMINI_RUNTIME: ENGINE_CONFIGS[0].runtimeUrls,
      KOKORO_RUNTIME: ENGINE_CONFIGS[1].runtimeUrls,
    },
    skipRuntimeSwitch: SKIP_RUNTIME_SWITCH,
    emotions: CORE_EMOTIONS,
    results,
    summary: {
      total: results.length,
      failed: failed.length,
      passed: results.length - failed.length,
      passedAll: failed.length === 0,
      byEngine,
    },
  };

  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Report: ${path.relative(ROOT, REPORT_PATH)}`);
  console.log(`Passed: ${report.summary.passedAll}`);

  if (!report.summary.passedAll) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error('TTS Hindi audit failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
