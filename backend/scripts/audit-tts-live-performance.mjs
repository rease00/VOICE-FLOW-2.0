#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_BASE_URL = String(process.env.VF_MEDIA_BACKEND_URL || 'http://127.0.0.1:7800').replace(/\/+$/, '');
const DEFAULT_UID = String(process.env.VF_LIVE_AUDIT_UID || 'local_admin').trim() || 'local_admin';
const DEFAULT_CONCURRENCY = 50;
const DEFAULT_REQUESTS = 200;
const DEFAULT_REQUEST_TIMEOUT_MS = 120000;
const DEFAULT_JOB_TIMEOUT_MS = 120000;
const DEFAULT_POLL_MS = 350;
const DEFAULT_SEED = 20260301;
const DEFAULT_STRICT_RVC = true;

const ARTIFACT_PATH = path.join('artifacts', 'load', 'live_tts_performance_audit.json');
const GEM_FALLBACK_RUNTIME_VOICES = ['achernar', 'charon', 'kore', 'fenrir', 'achird', 'aoede'];
const KOKORO_FALLBACK_VOICE_ID = 'hf_alpha';
const SCHEMA_VERSION = '1.0.0';

const SCENARIOS = [
  { id: 'A', share: 0.30, endpoint: 'synthesize', engine: 'GEM', voiceMode: 'single' },
  { id: 'B', share: 0.20, endpoint: 'synthesize', engine: 'GEM', voiceMode: 'multi' },
  { id: 'C', share: 0.25, endpoint: 'synthesize', engine: 'KOKORO', voiceMode: 'single' },
  { id: 'D', share: 0.15, endpoint: 'jobs', engine: 'GEM', voiceMode: 'single' },
  { id: 'E', share: 0.10, endpoint: 'jobs', engine: 'KOKORO', voiceMode: 'single' },
];

const parseBool = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  const token = String(value).trim().toLowerCase();
  if (!token) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(token)) return true;
  if (['0', 'false', 'no', 'off'].includes(token)) return false;
  return fallback;
};

const parseIntSafe = (value, fallback, min = 1) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, parsed);
};

const parseArgs = (argv) => {
  const out = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '');
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || String(next).startsWith('--')) {
      out.set(key, '1');
      continue;
    }
    out.set(key, String(next));
    i += 1;
  }
  return out;
};

const args = parseArgs(process.argv.slice(2));

const CONFIG = {
  baseUrl: String(args.get('base-url') || process.env.VF_MEDIA_BACKEND_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
  uid: String(args.get('uid') || process.env.VF_LIVE_AUDIT_UID || DEFAULT_UID).trim() || DEFAULT_UID,
  concurrency: parseIntSafe(args.get('concurrency') || process.env.VF_LIVE_AUDIT_CONCURRENCY, DEFAULT_CONCURRENCY),
  requests: parseIntSafe(args.get('requests') || process.env.VF_LIVE_AUDIT_REQUESTS, DEFAULT_REQUESTS),
  requestTimeoutMs: parseIntSafe(
    args.get('request-timeout-ms') || process.env.VF_LIVE_AUDIT_REQUEST_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
    1000,
  ),
  jobTimeoutMs: parseIntSafe(
    args.get('job-timeout-ms') || process.env.VF_LIVE_AUDIT_JOB_TIMEOUT_MS,
    DEFAULT_JOB_TIMEOUT_MS,
    1000,
  ),
  pollMs: parseIntSafe(args.get('poll-ms') || process.env.VF_LIVE_AUDIT_POLL_MS, DEFAULT_POLL_MS, 100),
  seed: parseIntSafe(args.get('seed') || process.env.VF_LIVE_AUDIT_SEED, DEFAULT_SEED, 1),
  strictRvc: parseBool(args.get('strict-rvc') ?? process.env.VF_LIVE_AUDIT_STRICT_RVC, DEFAULT_STRICT_RVC),
};

const nowIso = () => new Date().toISOString();

const createRng = (seedInput) => {
  let state = Number(seedInput) >>> 0;
  if (state === 0) state = 0x1f123bb5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 0xffffffff);
  };
};

const percentile = (numbers, pct) => {
  const vals = (numbers || []).filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!vals.length) return 0;
  const clamped = Math.min(1, Math.max(0, Number(pct) || 0));
  const idx = clamped * (vals.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return vals[lo];
  const ratio = idx - lo;
  return vals[lo] + ((vals[hi] - vals[lo]) * ratio);
};

const summaryStats = (numbers) => {
  const vals = (numbers || []).filter((n) => Number.isFinite(n));
  if (!vals.length) return { count: 0, p50: 0, p95: 0, p99: 0, max: 0, avg: 0 };
  const sum = vals.reduce((acc, n) => acc + n, 0);
  return {
    count: vals.length,
    avg: Number((sum / vals.length).toFixed(2)),
    p50: Number(percentile(vals, 0.5).toFixed(2)),
    p95: Number(percentile(vals, 0.95).toFixed(2)),
    p99: Number(percentile(vals, 0.99).toFixed(2)),
    max: Number(Math.max(...vals).toFixed(2)),
  };
};

const normalizeHeaders = (headersLike) => {
  const out = {};
  if (!headersLike) return out;
  if (headersLike instanceof Headers) {
    headersLike.forEach((value, key) => {
      out[String(key || '').toLowerCase()] = String(value ?? '');
    });
    return out;
  }
  if (typeof headersLike === 'object') {
    for (const [key, value] of Object.entries(headersLike)) {
      out[String(key || '').toLowerCase()] = String(value ?? '');
    }
  }
  return out;
};

const headers = {
  'Content-Type': 'application/json',
  Accept: 'application/json, audio/wav',
  'x-dev-uid': CONFIG.uid,
};

const authOnlyHeaders = {
  Accept: 'application/json',
  'x-dev-uid': CONFIG.uid,
};

const withTimeout = async (url, init = {}, timeoutMs = CONFIG.requestTimeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const parseBody = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const extractJobId = (body, responseHeaders, fallbackRequestId) => {
  if (body && typeof body === 'object') {
    const fromBody = String(body.jobId || body.requestId || body.id || '').trim();
    if (fromBody) return fromBody;
  }
  const normalizedHeaders = normalizeHeaders(responseHeaders);
  const fromHeader = String(normalizedHeaders['x-vf-job-id'] || normalizedHeaders['x-vf-request-id'] || '').trim();
  if (fromHeader) return fromHeader;
  return String(fallbackRequestId || '').trim();
};

const resolveGemRuntimeVoice = (voice) => {
  const runtimeVoice = String(voice?.voice || '').trim();
  if (runtimeVoice) return runtimeVoice;
  const mapped = String(voice?.mapped_name || voice?.name || '').trim();
  if (mapped) return mapped;
  return 'Fenrir';
};

const resolveKokoroVoiceId = (voice) => {
  return String(voice?.voice_id || voice?.voice || '').trim() || KOKORO_FALLBACK_VOICE_ID;
};

const uniqueBy = (items, keyFn) => {
  const out = [];
  const seen = new Set();
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
};

const chooseScenario = (requestIndex, totalRequests = CONFIG.requests) => {
  const safeTotal = Math.max(1, Number(totalRequests) || 1);
  const position = (Math.max(0, requestIndex) + 0.5) / safeTotal;
  let cumulative = 0;
  for (const scenario of SCENARIOS) {
    cumulative += scenario.share;
    if (position <= cumulative) return scenario;
  }
  return SCENARIOS[SCENARIOS.length - 1];
};

const buildSinglePayload = ({
  requestId,
  scenario,
  gemVoices,
  kokoroVoices,
  rng,
}) => {
  if (scenario.engine === 'GEM') {
    const pick = gemVoices.length
      ? gemVoices[Math.floor(rng() * gemVoices.length)] || gemVoices[0]
      : { voice: GEM_FALLBACK_RUNTIME_VOICES[0], voice_id: GEM_FALLBACK_RUNTIME_VOICES[0] };
    const runtimeVoice = resolveGemRuntimeVoice(pick);
    return {
      engine: 'GEM',
      request_id: requestId,
      text: 'Live performance audit single-speaker request for GEM runtime.',
      voice_id: runtimeVoice,
      voiceName: runtimeVoice,
      language: 'en',
      stream: true,
    };
  }

  const pick = kokoroVoices.length
    ? kokoroVoices[Math.floor(rng() * kokoroVoices.length)] || kokoroVoices[0]
    : { voice_id: KOKORO_FALLBACK_VOICE_ID };
  const voiceId = resolveKokoroVoiceId(pick);
  return {
    engine: 'KOKORO',
    request_id: requestId,
    text: 'Live performance audit single-speaker request for KOKORO runtime.',
    voice_id: voiceId,
    language: 'en',
    stream: true,
  };
};

const buildGemMultiPayload = ({
  requestId,
  gemVoices,
  rng,
}) => {
  const available = gemVoices.length
    ? gemVoices
    : GEM_FALLBACK_RUNTIME_VOICES.map((voice) => ({ voice, voice_id: `fallback_${voice}` }));
  const first = available[Math.floor(rng() * available.length)] || available[0];
  let second = available[Math.floor(rng() * available.length)] || available[0];
  if (available.length > 1) {
    const firstId = resolveGemRuntimeVoice(first).toLowerCase();
    let guard = 0;
    while (resolveGemRuntimeVoice(second).toLowerCase() === firstId && guard < 8) {
      second = available[Math.floor(rng() * available.length)] || available[0];
      guard += 1;
    }
  }

  const voiceA = resolveGemRuntimeVoice(first);
  const voiceB = resolveGemRuntimeVoice(second);
  const lines = [
    { lineIndex: 0, speaker: 'Narrator', text: 'Welcome to the live performance multi-speaker audit.' },
    { lineIndex: 1, speaker: 'Guest', text: 'We are validating chunk delivery and conversion timings.' },
    { lineIndex: 2, speaker: 'Narrator', text: 'Each line should preserve order and speaker mapping.' },
    { lineIndex: 3, speaker: 'Guest', text: 'The queue metrics should reflect stable live playback readiness.' },
    { lineIndex: 4, speaker: 'Narrator', text: 'Strict post TTS RVC must remain enabled for every completion.' },
    { lineIndex: 5, speaker: 'Guest', text: 'This closes the live audit scenario for multi-speaker mode.' },
  ];

  return {
    engine: 'GEM',
    request_id: requestId,
    text: lines.map((line) => `${line.speaker}: ${line.text}`).join('\n'),
    voice_id: voiceA,
    voiceName: voiceA,
    speaker_voices: [
      { speaker: 'Narrator', voiceName: voiceA },
      { speaker: 'Guest', voiceName: voiceB },
    ],
    multi_speaker_mode: 'studio_pair_groups',
    multi_speaker_max_concurrency: 2,
    multi_speaker_retry_once: true,
    multi_speaker_line_map: lines,
    language: 'en',
    stream: true,
  };
};

const buildPayload = ({ requestIndex, requestId, scenario, gemVoices, kokoroVoices }) => {
  const rng = createRng(CONFIG.seed + (requestIndex * 2654435761));
  if (scenario.engine === 'GEM' && scenario.voiceMode === 'multi') {
    return buildGemMultiPayload({ requestId, gemVoices, rng });
  }
  return buildSinglePayload({ requestId, scenario, gemVoices, kokoroVoices, rng });
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildRequestId = (index, scenario) =>
  `live_audit_${String(scenario.id).toLowerCase()}_${String(index)}_${crypto.randomUUID().slice(0, 8)}`;

const parseJsonMaybe = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const parseErrorText = (payload) => {
  if (typeof payload === 'string') return payload.slice(0, 500);
  if (payload && typeof payload === 'object') {
    try {
      return JSON.stringify(payload).slice(0, 500);
    } catch {
      return String(payload).slice(0, 500);
    }
  }
  return '';
};

const numeric = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '') return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num;
};

const responseHeadersToObject = (responseHeaders) => {
  const out = {};
  if (!(responseHeaders instanceof Headers)) return out;
  responseHeaders.forEach((value, key) => {
    out[String(key || '').toLowerCase()] = String(value ?? '');
  });
  return out;
};

const getHeadersFromResult = (result) => normalizeHeaders(result?.headers || {});

const getPostTtsHeaders = (headersObj) => {
  const headersNorm = normalizeHeaders(headersObj || {});
  return {
    conversion: String(headersNorm['x-vf-post-tts-conversion'] || '').trim(),
    profile: String(headersNorm['x-vf-post-tts-profile'] || '').trim(),
    model: String(headersNorm['x-vf-post-tts-model'] || '').trim(),
  };
};

const isStrictRvcPass = (headersObj) => {
  let post = { conversion: '', profile: '', model: '' };
  if (headersObj && typeof headersObj === 'object') {
    const directConversion = String(headersObj.conversion || '').trim();
    const directProfile = String(headersObj.profile || '').trim();
    const directModel = String(headersObj.model || '').trim();
    if (directConversion || directProfile || directModel) {
      post = {
        conversion: directConversion,
        profile: directProfile,
        model: directModel,
      };
    } else {
      post = getPostTtsHeaders(headersObj);
    }
  } else {
    post = getPostTtsHeaders(headersObj);
  }
  return post.conversion === 'rvc' && Boolean(post.profile) && Boolean(post.model);
};

const fetchJsonGet = async (url, timeoutMs = CONFIG.requestTimeoutMs, reqHeaders = authOnlyHeaders) => {
  try {
    const response = await withTimeout(
      url,
      {
        method: 'GET',
        headers: reqHeaders,
      },
      timeoutMs,
    );
    const payload = await parseBody(response);
    return {
      ok: response.ok,
      status: response.status,
      payload,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      payload: {
        error: error instanceof Error ? error.message : String(error),
        reason: 'network_fetch_failed',
        url,
      },
    };
  }
};

const fetchPreflight = async () => {
  const checks = [];

  const health = await fetchJsonGet(`${CONFIG.baseUrl}/health`);
  checks.push({
    name: 'health',
    ok: health.ok,
    status: health.status,
    detail: health.ok ? '' : parseErrorText(health.payload),
  });

  const status = await fetchJsonGet(`${CONFIG.baseUrl}/tts/engines/status`);
  checks.push({
    name: 'enginesStatus',
    ok: status.ok,
    status: status.status,
    detail: status.ok ? '' : parseErrorText(status.payload),
  });

  const gemVoicesRes = await fetchJsonGet(`${CONFIG.baseUrl}/tts/engines/voices?engine=GEM`);
  checks.push({
    name: 'gemVoices',
    ok: gemVoicesRes.ok,
    status: gemVoicesRes.status,
    detail: gemVoicesRes.ok ? '' : parseErrorText(gemVoicesRes.payload),
  });

  const kokoroVoicesRes = await fetchJsonGet(`${CONFIG.baseUrl}/tts/engines/voices?engine=KOKORO`);
  checks.push({
    name: 'kokoroVoices',
    ok: kokoroVoicesRes.ok,
    status: kokoroVoicesRes.status,
    detail: kokoroVoicesRes.ok ? '' : parseErrorText(kokoroVoicesRes.payload),
  });

  const queueBefore = await fetchJsonGet(`${CONFIG.baseUrl}/admin/tts/queue/metrics`);
  checks.push({
    name: 'queueMetricsBefore',
    ok: queueBefore.ok,
    status: queueBefore.status,
    detail: queueBefore.ok ? '' : parseErrorText(queueBefore.payload),
  });

  const gemVoices = Array.isArray(gemVoicesRes.payload?.voices) ? gemVoicesRes.payload.voices : [];
  const kokoroVoices = Array.isArray(kokoroVoicesRes.payload?.voices) ? kokoroVoicesRes.payload.voices : [];
  const preflightOk =
    health.ok &&
    status.ok &&
    gemVoicesRes.ok &&
    kokoroVoicesRes.ok &&
    queueBefore.ok;

  return {
    preflightOk,
    checks,
    health: health.payload,
    enginesStatus: status.payload,
    gemVoices: uniqueBy(gemVoices, (voice) => String(voice?.voice_id || '').trim().toLowerCase()),
    kokoroVoices: uniqueBy(kokoroVoices, (voice) => String(voice?.voice_id || '').trim().toLowerCase()),
    adminQueueMetricsBefore: queueBefore.payload,
  };
};

const extractJobIdFromSubmit = ({ body, responseHeaders, fallbackRequestId }) => {
  const headerValues = normalizeHeaders(responseHeaders);
  const bodyId = String(body?.jobId || body?.requestId || body?.id || '').trim();
  if (bodyId) return bodyId;
  const headerId = String(headerValues['x-vf-job-id'] || headerValues['x-vf-request-id'] || '').trim();
  if (headerId) return headerId;
  return String(fallbackRequestId || '').trim();
};

const pollJobForLive = async ({ jobId, submitStartedAtMs }) => {
  const deadline = Date.now() + CONFIG.jobTimeoutMs;
  let cursor = 0;
  let polls = 0;
  const seenChunkIndexes = new Set();
  const queueAges = [];
  const queueDepths = [];
  let firstChunkLatencyMs = null;
  let chunkCount = 0;
  let playableChunksMax = 0;
  let playableDurationMsMax = 0;

  while (Date.now() < deadline) {
    polls += 1;
    const url = `${CONFIG.baseUrl}/tts/jobs/${encodeURIComponent(jobId)}?includeResult=1&includeChunks=1&chunkCursor=${encodeURIComponent(String(cursor))}&chunkLimit=2&includeChunkAudio=0`;
    const response = await withTimeout(
      url,
      {
        method: 'GET',
        headers: authOnlyHeaders,
      },
      CONFIG.requestTimeoutMs,
    );
    const payload = await parseBody(response);
    if (!response.ok) {
      return {
        terminalState: 'failed',
        completed: false,
        failed: true,
        cancelled: false,
        timedOut: false,
        submitAccepted: true,
        jobId,
        polls,
        submitLatencyMs: 0,
        firstChunkLatencyMs,
        completionLatencyMs: Date.now() - submitStartedAtMs,
        chunkCount,
        liveChunkSeenBeforeComplete: firstChunkLatencyMs !== null,
        queueAgeMaxMs: queueAges.length ? Math.max(...queueAges) : 0,
        queueDepthMax: queueDepths.length ? Math.max(...queueDepths) : 0,
        playableChunksMax,
        playableDurationMsMax,
        statusCode: response.status,
        error: parseErrorText(payload),
        postTtsHeaders: {
          conversion: '',
          profile: '',
          model: '',
        },
      };
    }

    const queueAgeMs = numeric(payload?.queueAgeMs, 0);
    const queueDepthAtRead = numeric(payload?.queueDepthAtRead, 0);
    if (queueAgeMs > 0) queueAges.push(queueAgeMs);
    if (queueDepthAtRead >= 0) queueDepths.push(queueDepthAtRead);

    const live = payload?.live && typeof payload.live === 'object' ? payload.live : null;
    if (live) {
      playableChunksMax = Math.max(playableChunksMax, numeric(live.playableChunks, 0));
      playableDurationMsMax = Math.max(playableDurationMsMax, numeric(live.playableDurationMs, 0));
    }

    const chunks = Array.isArray(payload?.chunks) ? payload.chunks : [];
    if (chunks.length > 0) {
      for (const chunk of chunks) {
        const chunkIndex = Number(chunk?.index);
        if (!Number.isFinite(chunkIndex)) continue;
        const key = Math.round(chunkIndex);
        if (seenChunkIndexes.has(key)) continue;
        seenChunkIndexes.add(key);
      }
      chunkCount = seenChunkIndexes.size;
      if (firstChunkLatencyMs === null && chunkCount > 0) {
        firstChunkLatencyMs = Date.now() - submitStartedAtMs;
      }
      const cursorNext = Number(payload?.chunkCursorNext);
      if (Number.isFinite(cursorNext) && cursorNext > cursor) {
        cursor = Math.round(cursorNext);
      } else {
        const maxChunkIndex = chunks.reduce((maxVal, item) => {
          const idx = Number(item?.index);
          if (!Number.isFinite(idx)) return maxVal;
          return Math.max(maxVal, Math.round(idx));
        }, -1);
        if (maxChunkIndex >= 0) {
          cursor = Math.max(cursor, maxChunkIndex + 1);
        }
      }
    } else {
      const cursorNext = Number(payload?.chunkCursorNext);
      if (Number.isFinite(cursorNext) && cursorNext > cursor) {
        cursor = Math.round(cursorNext);
      }
    }

    const statusRaw = String(payload?.status || '').trim().toLowerCase();
    if (statusRaw === 'completed') {
      const completionLatencyMs = Date.now() - submitStartedAtMs;
      const result = payload?.result && typeof payload.result === 'object' ? payload.result : {};
      const resultHeaders = getHeadersFromResult(result);
      let post = getPostTtsHeaders(resultHeaders);
      if ((!post.conversion || !post.profile || !post.model) && jobId) {
        const refreshUrl = `${CONFIG.baseUrl}/tts/jobs/${encodeURIComponent(jobId)}?includeResult=1`;
        const refresh = await fetchJsonGet(refreshUrl, CONFIG.requestTimeoutMs, authOnlyHeaders);
        if (refresh.ok) {
          const refreshedResult =
            refresh.payload?.result && typeof refresh.payload.result === 'object' ? refresh.payload.result : {};
          const refreshedHeaders = getHeadersFromResult(refreshedResult);
          const refreshedPost = getPostTtsHeaders(refreshedHeaders);
          if (refreshedPost.conversion || refreshedPost.profile || refreshedPost.model) {
            post = refreshedPost;
          }
        }
      }
      return {
        terminalState: 'completed',
        completed: true,
        failed: false,
        cancelled: false,
        timedOut: false,
        submitAccepted: true,
        jobId,
        polls,
        submitLatencyMs: 0,
        firstChunkLatencyMs,
        completionLatencyMs,
        chunkCount,
        liveChunkSeenBeforeComplete: firstChunkLatencyMs !== null,
        queueAgeMaxMs: queueAges.length ? Math.max(...queueAges) : 0,
        queueDepthMax: queueDepths.length ? Math.max(...queueDepths) : 0,
        playableChunksMax,
        playableDurationMsMax,
        statusCode: 200,
        error: '',
        postTtsHeaders: post,
      };
    }
    if (statusRaw === 'failed') {
      return {
        terminalState: 'failed',
        completed: false,
        failed: true,
        cancelled: false,
        timedOut: false,
        submitAccepted: true,
        jobId,
        polls,
        submitLatencyMs: 0,
        firstChunkLatencyMs,
        completionLatencyMs: Date.now() - submitStartedAtMs,
        chunkCount,
        liveChunkSeenBeforeComplete: firstChunkLatencyMs !== null,
        queueAgeMaxMs: queueAges.length ? Math.max(...queueAges) : 0,
        queueDepthMax: queueDepths.length ? Math.max(...queueDepths) : 0,
        playableChunksMax,
        playableDurationMsMax,
        statusCode: numeric(payload?.statusCode, 500),
        error: parseErrorText(payload?.error || payload),
        postTtsHeaders: {
          conversion: '',
          profile: '',
          model: '',
        },
      };
    }
    if (statusRaw === 'cancelled') {
      return {
        terminalState: 'cancelled',
        completed: false,
        failed: false,
        cancelled: true,
        timedOut: false,
        submitAccepted: true,
        jobId,
        polls,
        submitLatencyMs: 0,
        firstChunkLatencyMs,
        completionLatencyMs: Date.now() - submitStartedAtMs,
        chunkCount,
        liveChunkSeenBeforeComplete: firstChunkLatencyMs !== null,
        queueAgeMaxMs: queueAges.length ? Math.max(...queueAges) : 0,
        queueDepthMax: queueDepths.length ? Math.max(...queueDepths) : 0,
        playableChunksMax,
        playableDurationMsMax,
        statusCode: numeric(payload?.statusCode, 409),
        error: parseErrorText(payload?.error || payload),
        postTtsHeaders: {
          conversion: '',
          profile: '',
          model: '',
        },
      };
    }

    await sleep(CONFIG.pollMs);
  }

  return {
    terminalState: 'timeout',
    completed: false,
    failed: false,
    cancelled: false,
    timedOut: true,
    submitAccepted: true,
    jobId,
    polls,
    submitLatencyMs: 0,
    firstChunkLatencyMs,
    completionLatencyMs: CONFIG.jobTimeoutMs,
    chunkCount,
    liveChunkSeenBeforeComplete: firstChunkLatencyMs !== null,
    queueAgeMaxMs: queueAges.length ? Math.max(...queueAges) : 0,
    queueDepthMax: queueDepths.length ? Math.max(...queueDepths) : 0,
    playableChunksMax,
    playableDurationMsMax,
    statusCode: 0,
    error: `job_timeout_${CONFIG.jobTimeoutMs}ms`,
    postTtsHeaders: {
      conversion: '',
      profile: '',
      model: '',
    },
  };
};

const runScenarioRequest = async ({ requestIndex, scenario, gemVoices, kokoroVoices }) => {
  const requestId = buildRequestId(requestIndex, scenario);
  const payload = buildPayload({
    requestIndex,
    requestId,
    scenario,
    gemVoices,
    kokoroVoices,
  });
  const submitUrl =
    scenario.endpoint === 'synthesize'
      ? `${CONFIG.baseUrl}/tts/synthesize?wait_ms=0`
      : `${CONFIG.baseUrl}/tts/jobs`;

  const submitStartedAtMs = Date.now();
  try {
    const response = await withTimeout(
      submitUrl,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      },
      CONFIG.requestTimeoutMs,
    );
    const submitLatencyMs = Date.now() - submitStartedAtMs;
    const responseHeaders = responseHeadersToObject(response.headers);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();

    if (response.status === 200 && contentType.includes('audio/')) {
      const post = getPostTtsHeaders(responseHeaders);
      return {
        requestIndex,
        requestId,
        scenarioId: scenario.id,
        endpoint: scenario.endpoint,
        engine: scenario.engine,
        voiceMode: scenario.voiceMode,
        submitAccepted: true,
        submitLatencyMs,
        firstChunkLatencyMs: null,
        completionLatencyMs: submitLatencyMs,
        chunkCount: 0,
        liveChunkSeenBeforeComplete: false,
        queueAgeMaxMs: 0,
        queueDepthMax: 0,
        terminalState: 'completed',
        statusCode: 200,
        jobId: extractJobIdFromSubmit({ body: null, responseHeaders, fallbackRequestId: requestId }),
        polls: 0,
        playableChunksMax: 0,
        playableDurationMsMax: 0,
        postTtsHeaders: post,
        error: '',
      };
    }

    const body = await parseJsonMaybe(response);
    if (!(response.status === 200 || response.status === 202)) {
      return {
        requestIndex,
        requestId,
        scenarioId: scenario.id,
        endpoint: scenario.endpoint,
        engine: scenario.engine,
        voiceMode: scenario.voiceMode,
        submitAccepted: false,
        submitLatencyMs,
        firstChunkLatencyMs: null,
        completionLatencyMs: 0,
        chunkCount: 0,
        liveChunkSeenBeforeComplete: false,
        queueAgeMaxMs: 0,
        queueDepthMax: 0,
        terminalState: 'failed',
        statusCode: response.status,
        jobId: '',
        polls: 0,
        playableChunksMax: 0,
        playableDurationMsMax: 0,
        postTtsHeaders: { conversion: '', profile: '', model: '' },
        error: parseErrorText(body),
      };
    }

    const bodyStatus = String(body?.status || '').trim().toLowerCase();
    const immediateResultHeaders =
      bodyStatus === 'completed'
        ? getHeadersFromResult(body?.result && typeof body.result === 'object' ? body.result : {})
        : {};

    if (bodyStatus === 'completed') {
      let immediatePost = getPostTtsHeaders(immediateResultHeaders);
      if ((!immediatePost.conversion || !immediatePost.profile || !immediatePost.model)) {
        const refreshUrl = `${CONFIG.baseUrl}/tts/jobs/${encodeURIComponent(extractJobIdFromSubmit({ body, responseHeaders, fallbackRequestId: requestId }))}?includeResult=1`;
        const refresh = await fetchJsonGet(refreshUrl, CONFIG.requestTimeoutMs, authOnlyHeaders);
        if (refresh.ok) {
          const refreshedResult =
            refresh.payload?.result && typeof refresh.payload.result === 'object' ? refresh.payload.result : {};
          const refreshedHeaders = getHeadersFromResult(refreshedResult);
          const refreshedPost = getPostTtsHeaders(refreshedHeaders);
          if (refreshedPost.conversion || refreshedPost.profile || refreshedPost.model) {
            immediatePost = refreshedPost;
          }
        }
      }
      return {
        requestIndex,
        requestId,
        scenarioId: scenario.id,
        endpoint: scenario.endpoint,
        engine: scenario.engine,
        voiceMode: scenario.voiceMode,
        submitAccepted: true,
        submitLatencyMs,
        firstChunkLatencyMs: null,
        completionLatencyMs: submitLatencyMs,
        chunkCount: 0,
        liveChunkSeenBeforeComplete: false,
        queueAgeMaxMs: numeric(body?.queueAgeMs, 0),
        queueDepthMax: numeric(body?.queueDepthAtRead, 0),
        terminalState: 'completed',
        statusCode: 200,
        jobId: extractJobIdFromSubmit({ body, responseHeaders, fallbackRequestId: requestId }),
        polls: 0,
        playableChunksMax: numeric(body?.live?.playableChunks, 0),
        playableDurationMsMax: numeric(body?.live?.playableDurationMs, 0),
        postTtsHeaders: immediatePost,
        error: '',
      };
    }

    const jobId = extractJobIdFromSubmit({ body, responseHeaders, fallbackRequestId: requestId });
    if (!jobId) {
      return {
        requestIndex,
        requestId,
        scenarioId: scenario.id,
        endpoint: scenario.endpoint,
        engine: scenario.engine,
        voiceMode: scenario.voiceMode,
        submitAccepted: false,
        submitLatencyMs,
        firstChunkLatencyMs: null,
        completionLatencyMs: 0,
        chunkCount: 0,
        liveChunkSeenBeforeComplete: false,
        queueAgeMaxMs: 0,
        queueDepthMax: 0,
        terminalState: 'failed',
        statusCode: response.status,
        jobId: '',
        polls: 0,
        playableChunksMax: 0,
        playableDurationMsMax: 0,
        postTtsHeaders: { conversion: '', profile: '', model: '' },
        error: 'missing_job_id_on_async_accept',
      };
    }

    const polled = await pollJobForLive({ jobId, submitStartedAtMs });
    return {
      requestIndex,
      requestId,
      scenarioId: scenario.id,
      endpoint: scenario.endpoint,
      engine: scenario.engine,
      voiceMode: scenario.voiceMode,
      submitAccepted: true,
      submitLatencyMs,
      firstChunkLatencyMs: polled.firstChunkLatencyMs,
      completionLatencyMs: polled.completionLatencyMs,
      chunkCount: polled.chunkCount,
      liveChunkSeenBeforeComplete: polled.liveChunkSeenBeforeComplete,
      queueAgeMaxMs: polled.queueAgeMaxMs,
      queueDepthMax: polled.queueDepthMax,
      terminalState: polled.terminalState,
      statusCode: polled.statusCode,
      jobId,
      polls: polled.polls,
      playableChunksMax: polled.playableChunksMax,
      playableDurationMsMax: polled.playableDurationMsMax,
      postTtsHeaders: polled.postTtsHeaders,
      error: polled.error,
    };
  } catch (error) {
    return {
      requestIndex,
      requestId,
      scenarioId: scenario.id,
      endpoint: scenario.endpoint,
      engine: scenario.engine,
      voiceMode: scenario.voiceMode,
      submitAccepted: false,
      submitLatencyMs: Date.now() - submitStartedAtMs,
      firstChunkLatencyMs: null,
      completionLatencyMs: 0,
      chunkCount: 0,
      liveChunkSeenBeforeComplete: false,
      queueAgeMaxMs: 0,
      queueDepthMax: 0,
      terminalState: error?.name === 'AbortError' ? 'timeout' : 'failed',
      statusCode: 0,
      jobId: '',
      polls: 0,
      playableChunksMax: 0,
      playableDurationMsMax: 0,
      postTtsHeaders: { conversion: '', profile: '', model: '' },
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const runStagedAudit = async ({ gemVoices, kokoroVoices }) => {
  const results = new Array(CONFIG.requests);
  let cursor = 0;

  const workers = Array.from({ length: CONFIG.concurrency }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= CONFIG.requests) break;
      const scenario = chooseScenario(index, CONFIG.requests);
      results[index] = await runScenarioRequest({
        requestIndex: index,
        scenario,
        gemVoices,
        kokoroVoices,
      });
    }
  });
  await Promise.all(workers);
  return results.filter(Boolean);
};

const computeScenarioSummary = (items) => {
  const byScenario = {};
  for (const scenario of SCENARIOS) {
    const subset = items.filter((item) => item.scenarioId === scenario.id);
    const started = subset.length;
    const completed = subset.filter((item) => item.terminalState === 'completed').length;
    const failed = subset.filter((item) => item.terminalState === 'failed').length;
    const cancelled = subset.filter((item) => item.terminalState === 'cancelled').length;
    const timedOut = subset.filter((item) => item.terminalState === 'timeout').length;
    byScenario[scenario.id] = {
      endpoint: scenario.endpoint,
      engine: scenario.engine,
      voiceMode: scenario.voiceMode,
      shareTarget: scenario.share,
      started,
      completed,
      failed,
      cancelled,
      timedOut,
      completionRate: started > 0 ? Number((completed / started).toFixed(4)) : 0,
      firstChunkLatencyMs: summaryStats(subset.map((item) => numeric(item.firstChunkLatencyMs, NaN))),
      completionLatencyMs: summaryStats(subset.map((item) => numeric(item.completionLatencyMs, NaN))),
      chunkCount: summaryStats(subset.map((item) => numeric(item.chunkCount, NaN))),
    };
  }
  return byScenario;
};

const buildReport = ({
  startedAt,
  finishedAt,
  preflight,
  results,
  adminQueueMetricsAfter,
}) => {
  const totalStarted = results.length;
  const completed = results.filter((item) => item.terminalState === 'completed');
  const failed = results.filter((item) => item.terminalState === 'failed');
  const cancelled = results.filter((item) => item.terminalState === 'cancelled');
  const timedOut = results.filter((item) => item.terminalState === 'timeout');
  const completionRate = totalStarted > 0 ? completed.length / totalStarted : 0;
  const timeoutRate = totalStarted > 0 ? timedOut.length / totalStarted : 0;
  const failedOrCancelledRate = totalStarted > 0 ? (failed.length + cancelled.length) / totalStarted : 0;

  const completedWithLiveChunk = completed.filter((item) => item.liveChunkSeenBeforeComplete).length;
  const liveFirstChunkObservedRate = completed.length > 0 ? completedWithLiveChunk / completed.length : 0;

  const rvcPassCompleted = completed.filter((item) => isStrictRvcPass(item.postTtsHeaders)).length;
  const postTtsRvcRate = completed.length > 0 ? rvcPassCompleted / completed.length : 0;

  const submitLatencies = results.map((item) => numeric(item.submitLatencyMs, NaN));
  const firstChunkLatencies = completed
    .map((item) => numeric(item.firstChunkLatencyMs, NaN))
    .filter((value) => Number.isFinite(value));
  const completionLatencies = completed.map((item) => numeric(item.completionLatencyMs, NaN));

  const chunkCounts = completed.map((item) => numeric(item.chunkCount, NaN));
  const queueAges = results.map((item) => numeric(item.queueAgeMaxMs, NaN));
  const queueDepths = results.map((item) => numeric(item.queueDepthMax, NaN));

  const hardFails = [];
  const warnings = [];
  if (!preflight.preflightOk) {
    hardFails.push('preflight_failure');
  }
  if (completionRate < 0.96) hardFails.push(`completionRate<0.96 (${completionRate.toFixed(4)})`);
  if (liveFirstChunkObservedRate < 0.95) {
    hardFails.push(`liveFirstChunkObservedRate<0.95 (${liveFirstChunkObservedRate.toFixed(4)})`);
  }
  if (timeoutRate > 0.02) hardFails.push(`timeoutRate>0.02 (${timeoutRate.toFixed(4)})`);
  if (failedOrCancelledRate > 0.03) {
    hardFails.push(`failedOrCancelledRate>0.03 (${failedOrCancelledRate.toFixed(4)})`);
  }
  if (CONFIG.strictRvc && completed.length > 0 && postTtsRvcRate < 1.0) {
    hardFails.push(`postTtsRvcRate<1.0 (${postTtsRvcRate.toFixed(4)})`);
  }

  const firstChunkStats = summaryStats(firstChunkLatencies);
  const completionStats = summaryStats(completionLatencies);
  const queueAgeStats = summaryStats(queueAges);

  if (firstChunkStats.p95 > 7000) warnings.push(`p95FirstChunkLatencyMs>7000 (${firstChunkStats.p95})`);
  if (completionStats.p95 > 45000) warnings.push(`p95CompletionLatencyMs>45000 (${completionStats.p95})`);
  if (queueAgeStats.p95 > 12000) warnings.push(`p95QueueAgeMs>12000 (${queueAgeStats.p95})`);
  const adminLiveP95 = numeric(adminQueueMetricsAfter?.telemetry?.liveFirstChunkLatencyMs?.p95, 0);
  if (adminLiveP95 > 7000) {
    warnings.push(`adminTelemetry.liveFirstChunkLatencyMs.p95>7000 (${adminLiveP95})`);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: finishedAt,
    runWindow: {
      startedAt,
      finishedAt,
      elapsedMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
    },
    target: {
      baseUrl: CONFIG.baseUrl,
      uid: CONFIG.uid,
      concurrency: CONFIG.concurrency,
      requests: CONFIG.requests,
      seed: CONFIG.seed,
      strictRvc: CONFIG.strictRvc,
      pollMs: CONFIG.pollMs,
      requestTimeoutMs: CONFIG.requestTimeoutMs,
      jobTimeoutMs: CONFIG.jobTimeoutMs,
    },
    preflight: {
      ok: preflight.preflightOk,
      checks: preflight.checks,
      engines: preflight.enginesStatus?.engines || {},
      voiceCounts: {
        GEM: preflight.gemVoices.length,
        KOKORO: preflight.kokoroVoices.length,
      },
    },
    scenarios: computeScenarioSummary(results),
    totals: {
      started: totalStarted,
      completed: completed.length,
      failed: failed.length,
      cancelled: cancelled.length,
      timedOut: timedOut.length,
      completionRate: Number(completionRate.toFixed(4)),
      timeoutRate: Number(timeoutRate.toFixed(4)),
      failedOrCancelledRate: Number(failedOrCancelledRate.toFixed(4)),
    },
    latencyMs: {
      submit: summaryStats(submitLatencies),
      firstChunk: firstChunkStats,
      completion: completionStats,
    },
    chunkMetrics: {
      liveChunkSeenBeforeComplete: completedWithLiveChunk,
      liveFirstChunkObservedRate: Number(liveFirstChunkObservedRate.toFixed(4)),
      liveChunkCount: summaryStats(chunkCounts),
    },
    rvcMetrics: {
      strictMode: CONFIG.strictRvc,
      completedWithRvcHeaders: rvcPassCompleted,
      postTtsRvcRate: Number(postTtsRvcRate.toFixed(4)),
    },
    queueSignals: {
      queueAgeMs: queueAgeStats,
      queueDepthAtRead: summaryStats(queueDepths),
    },
    adminQueueMetricsBefore: preflight.adminQueueMetricsBefore,
    adminQueueMetricsAfter,
    adminTelemetry: {
      liveFirstChunkLatencyMs: adminQueueMetricsAfter?.telemetry?.liveFirstChunkLatencyMs || null,
      liveChunkCount: adminQueueMetricsAfter?.telemetry?.liveChunkCount || null,
      liveChunkRvcLatencyMs: adminQueueMetricsAfter?.telemetry?.liveChunkRvcLatencyMs || null,
    },
    warnings,
    failures: hardFails,
    verdict: {
      passed: hardFails.length === 0,
      hardFailReasons: hardFails,
      warnReasons: warnings,
    },
  };
};

const main = async () => {
  const startedAt = nowIso();
  const preflight = await fetchPreflight();
  let results = [];

  if (preflight.preflightOk) {
    results = await runStagedAudit({
      gemVoices: preflight.gemVoices,
      kokoroVoices: preflight.kokoroVoices,
    });
  }

  const queueAfterRes = await fetchJsonGet(`${CONFIG.baseUrl}/admin/tts/queue/metrics`);
  const adminQueueMetricsAfter = queueAfterRes.ok ? queueAfterRes.payload : null;
  if (!queueAfterRes.ok) {
    preflight.checks.push({
      name: 'queueMetricsAfter',
      ok: false,
      status: queueAfterRes.status,
      detail: parseErrorText(queueAfterRes.payload),
    });
  }

  const report = buildReport({
    startedAt,
    finishedAt: nowIso(),
    preflight,
    results,
    adminQueueMetricsAfter,
  });

  await fs.mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await fs.writeFile(ARTIFACT_PATH, JSON.stringify(report, null, 2), 'utf8');

  const completionRatePct = (report.totals.completionRate * 100).toFixed(2);
  const rvcPct = (report.rvcMetrics.postTtsRvcRate * 100).toFixed(2);
  const oneLine =
    `[audit:tts:live] completion=${completionRatePct}% firstChunkP95=${report.latencyMs.firstChunk.p95}ms ` +
    `completionP95=${report.latencyMs.completion.p95}ms strictRvc=${rvcPct}% verdict=${report.verdict.passed ? 'passed' : 'failed'}`;
  console.log(oneLine);
  console.log(`artifact=${ARTIFACT_PATH.replace(/\\/g, '/')}`);

  if (!report.verdict.passed) {
    for (const reason of report.verdict.hardFailReasons.slice(0, 12)) {
      console.error(`[audit:tts:live][HARD-FAIL] ${reason}`);
    }
    process.exitCode = 1;
    return;
  }
  if (report.verdict.warnReasons.length > 0) {
    for (const reason of report.verdict.warnReasons.slice(0, 12)) {
      console.warn(`[audit:tts:live][WARN] ${reason}`);
    }
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
