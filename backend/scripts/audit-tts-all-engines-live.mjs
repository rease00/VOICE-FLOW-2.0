#!/usr/bin/env node
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  buildAuditHeaders,
  classifyAuditFailure,
  normalizeBaseUrl,
} from './lib/audit-helpers.mjs';

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'load');
const BACKEND_URL = normalizeBaseUrl(process.env.VF_MEDIA_BACKEND_URL, 'http://127.0.0.1:7800');
const REQUEST_TIMEOUT_MS = Math.max(10_000, Number(process.env.VF_TTS_LIVE_AUDIT_TIMEOUT_MS || 120_000));
const JOB_POLL_TIMEOUT_MS = Math.max(15_000, Number(process.env.VF_TTS_LIVE_AUDIT_JOB_TIMEOUT_MS || 180_000));
const JOB_POLL_INTERVAL_MS = Math.max(250, Number(process.env.VF_TTS_LIVE_AUDIT_POLL_MS || 1200));
const LIVE_CHUNK_CHARS = Math.max(72, Number(process.env.VF_TTS_LIVE_AUDIT_CHUNK_CHARS || 96));
const AUDIT_UID = String(process.env.VF_TTS_AUDIT_UID || 'local_admin').trim() || 'local_admin';
const AUDIT_TEXT =
  String(
    process.env.VF_TTS_LIVE_AUDIT_TEXT ||
      'Clara’s eyes snapped open. A tear tracked through her reflection in the glass. "That’s it," she whispered. "How much?"'
  ).trim() ||
  'Clara’s eyes snapped open. A tear tracked through her reflection in the glass. "That’s it," she whispered. "How much?"';
const ASR_SCRIPT_PATH = path.join(SCRIPT_DIR, 'transcribe-audio-asr.py');
const DEFAULT_ASR_PYTHON =
  process.platform === 'win32'
    ? path.join(ROOT, '.venvs', 'media-backend', 'Scripts', 'python.exe')
    : path.join(ROOT, '.venvs', 'media-backend', 'bin', 'python');
const ASR_WHISPER_MODEL = String(process.env.VF_WHISPER_MODEL || 'tiny').trim() || 'tiny';
const ASR_WHISPER_DEVICE = String(process.env.VF_WHISPER_DEVICE || 'cpu').trim() || 'cpu';
const ASR_WHISPER_COMPUTE = String(process.env.VF_WHISPER_COMPUTE || 'int8').trim() || 'int8';
const ASR_MIN_NON_EN_COVERAGE = Math.max(0, Math.min(1, Number(process.env.VF_TTS_AUDIT_MIN_NON_EN_COVERAGE || 0.55)));
const PYTHON_BIN_CANDIDATES = Array.from(
  new Set(
    [
      process.env.VF_PYTHON_BIN,
      DEFAULT_ASR_PYTHON,
      process.platform === 'win32' ? 'python' : 'python3',
      process.platform === 'win32' ? 'py' : 'python',
      'python',
    ]
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  )
);

const { headers: AUTH_HEADERS, auth: AUTH } = buildAuditHeaders(
  { Accept: 'application/json' },
  { scriptName: 'audit:tts:all-engines:live', defaultDevUid: AUDIT_UID }
);

const ENGINES = [
  {
    engine: 'VECTOR',
    voiceName: String(process.env.VF_TTS_AUDIT_VECTOR_VOICE || 'Fenrir').trim() || 'Fenrir',
    language: String(process.env.VF_TTS_AUDIT_VECTOR_LANGUAGE || 'en').trim() || 'en',
  },
  {
    engine: 'PRIME',
    voiceName: String(process.env.VF_TTS_AUDIT_PRIME_VOICE || process.env.VF_TTS_AUDIT_GEM_VOICE || 'Fenrir').trim() || 'Fenrir',
    language: String(process.env.VF_TTS_AUDIT_PRIME_LANGUAGE || process.env.VF_TTS_AUDIT_GEM_LANGUAGE || 'en').trim() || 'en',
  },
];

const nowStamp = new Date().toISOString().replace(/[:.]/g, '-');
const REPORT_PATH = path.join(ARTIFACT_DIR, `live-tts-all-engines-audit-${nowStamp}.json`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithTimeout = async (url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const parseJsonText = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const responseHeadersToObject = (headers) => {
  const out = {};
  if (!headers) return out;
  headers.forEach((value, key) => {
    out[String(key || '').toLowerCase()] = String(value || '');
  });
  return out;
};

const pickHeaders = (headers) => {
  const source = headers || {};
  const keys = [
    'content-type',
    'x-voiceflow-trace-id',
    'x-vf-live-stream',
    'x-vf-live-chunks',
    'x-vf-post-tts-conversion',
    'x-vf-post-tts-profile',
    'x-vf-post-tts-model',
    'x-vf-request-id',
    'x-vf-job-id',
  ];
  const out = {};
  for (const key of keys) {
    if (source[key]) out[key] = source[key];
  }
  return out;
};

const contentTypeIsAudio = (contentType) => {
  const token = String(contentType || '').trim().toLowerCase();
  return token.includes('audio/') || token.includes('application/octet-stream');
};

const readU16 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);
const readU32 = (bytes, offset) =>
  bytes[offset] |
  (bytes[offset + 1] << 8) |
  (bytes[offset + 2] << 16) |
  (bytes[offset + 3] << 24);

const decodeWavDuration = (buffer) => {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (bytes.length < 44) throw new Error('wav_too_small');
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('invalid_wav_header');
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
    throw new Error('wav_metadata_missing');
  }

  const bytesPerSample = Math.max(1, bitsPerSample / 8);
  return {
    durationSeconds: dataSize / (sampleRate * channels * bytesPerSample),
    sampleRate,
    channels,
    bitsPerSample,
  };
};

const round3 = (value) => Math.round(Number(value || 0) * 1000) / 1000;
const round4 = (value) => Math.round(Number(value || 0) * 10000) / 10000;

const isEnglishLanguage = (value) => String(value || '').trim().toLowerCase().startsWith('en');

const pickObject = (value) => (value && typeof value === 'object' ? value : null);

const resolveEngineCapabilities = (payload, engine) => {
  const source = pickObject(payload);
  if (!source) return null;
  const directEngines = pickObject(source.engines);
  if (directEngines && pickObject(directEngines[engine])) return directEngines[engine];
  const directCapabilities = pickObject(source.capabilities);
  if (directCapabilities && pickObject(directCapabilities[engine])) return directCapabilities[engine];
  if (pickObject(source[engine])) return source[engine];
  return null;
};

const resolveEngineProvider = (engineStatus, engineCapabilities, engine) => {
  const capabilityMeta = pickObject(engineCapabilities?.metadata) || {};
  const runtimeCapabilities = pickObject(engineStatus?.runtimeCapabilities) || {};
  const runtimeMeta = pickObject(runtimeCapabilities.metadata) || {};
  const provider =
    String(
      capabilityMeta.provider ||
      engineCapabilities?.provider ||
      runtimeMeta.provider ||
      runtimeCapabilities.provider ||
      engineStatus?.provider ||
      ''
    ).trim() || 'hosted';
  const providerPreference =
    capabilityMeta.providerPreference ||
    engineCapabilities?.provider_preference ||
    runtimeMeta.providerPreference ||
    runtimeCapabilities.providerPreference ||
    engineStatus?.provider_preference ||
    ['hosted'];
  const deviceMode =
    String(
      capabilityMeta.deviceMode ||
      engineCapabilities?.device_mode ||
      runtimeMeta.deviceMode ||
      runtimeCapabilities.deviceMode ||
      engineStatus?.device_mode ||
      ''
    ).trim() || 'remote';
  return {
    provider,
    providerPreference: Array.isArray(providerPreference) ? providerPreference : [providerPreference].filter(Boolean),
    deviceMode,
  };
};

const runAsrAudit = async (audioPath, language, expectedText) => {
  let lastError = null;
  for (const pythonBin of PYTHON_BIN_CANDIDATES) {
    try {
      const args = [
        ASR_SCRIPT_PATH,
        '--audio-path',
        audioPath,
        '--language',
        String(language || 'en'),
        '--expected-text',
        expectedText,
        '--whisper-model',
        ASR_WHISPER_MODEL,
        '--whisper-device',
        ASR_WHISPER_DEVICE,
        '--whisper-compute',
        ASR_WHISPER_COMPUTE,
      ];
      const { stdout } = await execFileAsync(pythonBin, args, {
        cwd: ROOT,
        maxBuffer: 8 * 1024 * 1024,
      });
      return JSON.parse(String(stdout || '{}'));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('asr_exec_failed');
};

const extractJobId = (payload, headers) => {
  const fromPayload = String(payload?.jobId || payload?.requestId || '').trim();
  if (fromPayload) return fromPayload;
  return String(headers['x-vf-job-id'] || headers['x-vf-request-id'] || '').trim();
};

const fetchJson = async (url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  try {
    const response = await fetchWithTimeout(url, init, timeoutMs);
    const raw = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      payload: parseJsonText(raw),
      headers: responseHeadersToObject(response.headers),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      payload: { error: error instanceof Error ? error.message : String(error) },
      headers: {},
      networkError: true,
    };
  }
};

const makePayload = (config, requestId) => ({
  engine: config.engine,
  text: AUDIT_TEXT,
  language: config.language,
  stream: true,
  live_chunk_chars: LIVE_CHUNK_CHARS,
  request_id: requestId,
  ...(config.voiceId ? { voice_id: config.voiceId, voiceId: config.voiceId } : {}),
  ...(config.voiceName ? { voiceName: config.voiceName } : {}),
});

const pollJobUntilTerminal = async (jobId) => {
  const startedAt = Date.now();
  let firstPlayableChunkMs = null;
  let maxPlayableChunks = 0;
  let maxPlayableDurationMs = 0;
  let lastStatus = 'queued';

  while ((Date.now() - startedAt) < JOB_POLL_TIMEOUT_MS) {
    const probe = await fetchJson(
      `${BACKEND_URL}/tts/jobs/${encodeURIComponent(jobId)}?includeResult=1&includeChunks=1&chunkCursor=0&chunkLimit=8&includeChunkAudio=0`,
      {
        method: 'GET',
        headers: AUTH_HEADERS,
      },
      REQUEST_TIMEOUT_MS
    );
    if (!probe.ok) {
      throw new Error(
        `job_poll_failed status=${probe.status} class=${classifyAuditFailure(probe)} detail=${JSON.stringify(probe.payload || '').slice(0, 320)}`
      );
    }

    const payload = probe.payload || {};
    lastStatus = String(payload.status || '').trim().toLowerCase() || 'queued';
    const live = payload.live && typeof payload.live === 'object' ? payload.live : {};
    const playableChunks = Math.max(0, Number(live.playableChunks || 0));
    const playableDurationMs = Math.max(0, Number(live.playableDurationMs || 0));
    if (playableChunks > 0 && firstPlayableChunkMs === null) {
      firstPlayableChunkMs = Date.now() - startedAt;
    }
    maxPlayableChunks = Math.max(maxPlayableChunks, playableChunks);
    maxPlayableDurationMs = Math.max(maxPlayableDurationMs, playableDurationMs);

    if (lastStatus === 'completed') {
      const result = payload.result && typeof payload.result === 'object' ? payload.result : {};
      const audioBase64 = String(result.audioBase64 || '').trim();
      if (!audioBase64) {
        throw new Error(`job_completed_without_audio jobId=${jobId}`);
      }
      const audioBytes = Buffer.from(audioBase64, 'base64');
      return {
        ok: true,
        jobId,
        status: lastStatus,
        elapsedMs: Date.now() - startedAt,
        firstPlayableChunkMs,
        maxPlayableChunks,
        maxPlayableDurationMs,
        traceId: String(payload.traceId || result.headers?.['x-voiceflow-trace-id'] || '').trim(),
        headers: pickHeaders(responseHeadersToObject(new Headers(result.headers || {}))),
        audioBytes,
      };
    }

    if (lastStatus === 'failed' || lastStatus === 'cancelled') {
      return {
        ok: false,
        jobId,
        status: lastStatus,
        elapsedMs: Date.now() - startedAt,
        firstPlayableChunkMs,
        maxPlayableChunks,
        maxPlayableDurationMs,
        error: payload.error || payload,
      };
    }

    await sleep(JOB_POLL_INTERVAL_MS);
  }

  throw new Error(`job_timeout jobId=${jobId} timeoutMs=${JOB_POLL_TIMEOUT_MS} lastStatus=${lastStatus}`);
};

const submitJob = async (config) => {
  const requestId = `audit_${config.engine.toLowerCase()}_${Date.now()}`;
  const response = await fetchWithTimeout(
    `${BACKEND_URL}/tts/jobs`,
    {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'Content-Type': 'application/json',
        Accept: 'application/json, audio/wav',
      },
      body: JSON.stringify(makePayload(config, requestId)),
    },
    REQUEST_TIMEOUT_MS
  );

  const headers = responseHeadersToObject(response.headers);
  const contentType = String(headers['content-type'] || '');
  if (response.status === 200 && contentTypeIsAudio(contentType)) {
    const audioBytes = Buffer.from(await response.arrayBuffer());
    return {
      ok: true,
      direct: true,
      requestId,
      jobId: String(headers['x-vf-job-id'] || headers['x-vf-request-id'] || requestId).trim(),
      headers: pickHeaders(headers),
      traceId: String(headers['x-voiceflow-trace-id'] || '').trim(),
      audioBytes,
      firstPlayableChunkMs: null,
      maxPlayableChunks: 0,
      maxPlayableDurationMs: 0,
      elapsedMs: 0,
    };
  }

  const raw = await response.text();
  const payload = parseJsonText(raw);
  if (!response.ok && response.status !== 202) {
    return {
      ok: false,
      direct: false,
      requestId,
      status: 'failed',
      error: payload,
      responseStatus: response.status,
      headers: pickHeaders(headers),
    };
  }

  const jobId = extractJobId(payload, headers);
  if (!jobId) {
    throw new Error(`accepted_without_job_id detail=${String(raw).slice(0, 320)}`);
  }

  const terminal = await pollJobUntilTerminal(jobId);
  return {
    ...terminal,
    direct: false,
    requestId,
  };
};

const auditEngine = async (config, engineStatus, engineCapabilities) => {
  const startedAt = Date.now();
  const providerState = resolveEngineProvider(engineStatus, engineCapabilities, config.engine);
  const result = {
    engine: config.engine,
    request: {
      language: config.language,
      voiceId: config.voiceId || null,
      voiceName: config.voiceName || null,
      stream: true,
      liveChunkChars: LIVE_CHUNK_CHARS,
    },
    statusProbe: engineStatus || null,
    capabilities: engineCapabilities || null,
    expectedText: AUDIT_TEXT,
    normalizedExpectedText: null,
    normalizedTranscript: null,
    transcript: null,
    transcriptLanguage: null,
    exactMatch: false,
    coverageRatio: null,
    similarityRatio: null,
    firstPlayableChunkMs: null,
    provider: providerState.provider,
    providerPreference: providerState.providerPreference,
    deviceMode: providerState.deviceMode,
    ok: false,
    elapsedMs: 0,
  };

  try {
    const submitted = await submitJob(config);
    result.elapsedMs = Date.now() - startedAt;
    result.jobId = submitted.jobId || null;
    result.requestId = submitted.requestId || null;
    result.traceId = submitted.traceId || null;
    result.delivery = submitted.direct ? 'sync' : 'job';
    result.headers = pickHeaders(submitted.headers || {});
    result.firstPlayableChunkMs = submitted.firstPlayableChunkMs;
    result.live = {
      firstPlayableChunkMs: submitted.firstPlayableChunkMs,
      playableChunks: submitted.maxPlayableChunks || 0,
      playableDurationMs: submitted.maxPlayableDurationMs || 0,
    };

    if (!submitted.ok) {
      result.error = submitted.error || { error: 'TTS job failed.' };
      result.status = String(submitted.status || 'failed');
      return result;
    }

    if (!(submitted.audioBytes instanceof Uint8Array) || submitted.audioBytes.byteLength < 100) {
      result.status = 'failed';
      result.error = { error: 'audio_too_small', bytes: submitted.audioBytes?.byteLength || 0 };
      return result;
    }

    const wav = decodeWavDuration(submitted.audioBytes);
    const artifactPath = path.join(ARTIFACT_DIR, `audit-${config.engine.toLowerCase()}-${nowStamp}.wav`);
    await fs.writeFile(artifactPath, submitted.audioBytes);
    const asr = await runAsrAudit(artifactPath, config.language, AUDIT_TEXT);
    result.transcript = String(asr.transcript || '').trim() || null;
    result.transcriptLanguage = String(asr.transcriptLanguage || '').trim() || null;
    result.normalizedExpectedText = String(asr.normalizedExpectedText || '').trim() || null;
    result.normalizedTranscript = String(asr.normalizedTranscript || '').trim() || null;
    result.exactMatch = Boolean(asr.exactMatch);
    result.coverageRatio = round4(asr.coverageRatio || 0);
    result.similarityRatio = round4(asr.similarityRatio || 0);

    result.audio = {
      bytes: submitted.audioBytes.byteLength,
      durationSeconds: round3(wav.durationSeconds),
      sampleRate: wav.sampleRate,
      channels: wav.channels,
      bitsPerSample: wav.bitsPerSample,
      file: path.relative(ROOT, artifactPath).replace(/\\/g, '/'),
    };
    const asrPassed = isEnglishLanguage(config.language)
      ? Boolean(asr.exactMatch)
      : Number(asr.coverageRatio || 0) >= ASR_MIN_NON_EN_COVERAGE;
    if (!asrPassed) {
      result.status = 'failed';
      result.error = {
        error: isEnglishLanguage(config.language) ? 'asr_exact_match_failed' : 'asr_coverage_too_low',
        transcript: result.transcript,
        normalizedTranscript: result.normalizedTranscript,
        exactMatch: result.exactMatch,
        coverageRatio: result.coverageRatio,
      };
      return result;
    }

    result.ok = true;
    result.status = 'passed';
    return result;
  } catch (error) {
    result.elapsedMs = Date.now() - startedAt;
    result.status = 'failed';
    result.error = { error: error instanceof Error ? error.message : String(error) };
    return result;
  }
};

const main = async () => {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });

  const statusProbe = await fetchJson(
    `${BACKEND_URL}/tts/engines/status`,
    { method: 'GET', headers: AUTH_HEADERS },
    12_000
  );
  const capabilitiesProbe = await fetchJson(
    `${BACKEND_URL}/tts/engines/capabilities`,
    { method: 'GET', headers: AUTH_HEADERS },
    12_000
  );

  const statusByEngine = statusProbe.ok && statusProbe.payload?.engines && typeof statusProbe.payload.engines === 'object'
    ? statusProbe.payload.engines
    : {};

  const capabilitiesByEngine = capabilitiesProbe.ok
    ? {
        VECTOR: resolveEngineCapabilities(capabilitiesProbe.payload, 'VECTOR'),
        PRIME: resolveEngineCapabilities(capabilitiesProbe.payload, 'PRIME'),
      }
    : {};

  const results = [];
  for (const config of ENGINES) {
    const entry = await auditEngine(
      config,
      statusByEngine?.[config.engine] || null,
      capabilitiesByEngine?.[config.engine] || null,
    );
    results.push(entry);
    const summary = entry.ok
      ? `${entry.audio?.durationSeconds || 0}s firstChunk=${entry.firstPlayableChunkMs ?? 'n/a'}ms asr=${entry.exactMatch ? 'exact' : round4(entry.coverageRatio || 0)}`
      : JSON.stringify(entry.error || {}).slice(0, 220);
    console.log(`[audit:tts:all-engines:live] ${config.engine} ${entry.status} ${summary}`);
  }

  const passed = results.filter((item) => item.ok).length;
  const failed = results.length - passed;
  const report = {
    timestamp: new Date().toISOString(),
    backendUrl: BACKEND_URL,
    auth: {
      mode: AUTH.mode,
      tokenPresent: Boolean(AUTH.tokenPresent),
      allowDevUid: Boolean(AUTH.allowDevUid),
      devUid: String(AUTH.devUid || '').trim() || null,
    },
    preflight: {
      enginesStatus: {
        ok: statusProbe.ok,
        status: statusProbe.status,
        payload: statusProbe.payload,
      },
      capabilities: {
        ok: capabilitiesProbe.ok,
        status: capabilitiesProbe.status,
        payload: capabilitiesProbe.payload,
      },
    },
    sample: {
      textChars: AUDIT_TEXT.length,
      liveChunkChars: LIVE_CHUNK_CHARS,
      expectedText: AUDIT_TEXT,
    },
    results,
    summary: {
      total: results.length,
      passed,
      failed,
      passedAll: failed === 0,
    },
  };

  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: failed === 0, output: REPORT_PATH, summary: report.summary }, null, 2));
  if (failed > 0) process.exit(1);
};

main().catch(async (error) => {
  const detail = error instanceof Error ? error.message : String(error);
  const report = {
    timestamp: new Date().toISOString(),
    backendUrl: BACKEND_URL,
    auth: {
      mode: AUTH.mode,
      tokenPresent: Boolean(AUTH.tokenPresent),
      allowDevUid: Boolean(AUTH.allowDevUid),
      devUid: String(AUTH.devUid || '').trim() || null,
    },
    error: detail,
  };
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.error(detail);
  process.exit(1);
});
