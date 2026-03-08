#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeBaseUrl } from './lib/audit-helpers.mjs';

const ROOT = process.cwd();
const WORKSPACE_ROOT = path.resolve(ROOT, '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const REPORT_PATH = path.join(ARTIFACT_DIR, 'gemini_key_burst_live_report.json');
const ALLOCATOR_CONFIG_PATH = path.join(ROOT, 'config', 'gemini_allocator_limits.json');
const RUNTIME_LOG_PATHS = [
  path.join(ROOT, '.runtime', 'logs', 'gemini-runtime-bench.log'),
  path.join(ROOT, '.runtime', 'logs', 'gemini-runtime.log'),
];
const ENV_FILE_CANDIDATES = [path.join(ROOT, '.env'), path.join(WORKSPACE_ROOT, '.env')];

const BACKEND_URL = normalizeBaseUrl(process.env.VF_MEDIA_BACKEND_URL, 'http://127.0.0.1:7800');
const TEST_UID = String(process.env.VF_KEY_BURST_TEST_UID || 'local_admin').trim() || 'local_admin';
const WAIT_MS = parseIntegerInRange(process.env.VF_KEY_BURST_WAIT_MS, 45_000, 0, 60_000);
const REQUEST_TIMEOUT_MS = parseIntegerInRange(process.env.VF_KEY_BURST_REQUEST_TIMEOUT_MS, 90_000, 5_000, 180_000);
const JOB_POLL_TIMEOUT_MS = parseIntegerInRange(process.env.VF_KEY_BURST_JOB_TIMEOUT_MS, 120_000, 10_000, 300_000);
const JOB_POLL_INTERVAL_MS = parseIntegerInRange(process.env.VF_KEY_BURST_JOB_POLL_MS, 1_200, 200, 5_000);
const REQUEST_COUNT = parseIntegerInRange(process.env.VF_KEY_BURST_REQUESTS, 8, 2, 20);
const FORCED_MODEL = normalizeModelId(
  process.env.VF_KEY_BURST_MODEL || 'gemini-2.5-flash-preview-tts'
);
const FORCED_ENGINE = String(process.env.VF_KEY_BURST_ENGINE || 'GEM').trim().toUpperCase() || 'GEM';
const TEST_MODE = normalizeTestMode(process.env.VF_KEY_BURST_MODE || 'single');
const AUTH_EMAIL = String(
  process.env.VF_KEY_BURST_ADMIN_EMAIL ||
    process.env.VF_KEY_BURST_EMAIL ||
    process.env.AUDIT_EMAIL ||
    ''
).trim();
const AUTH_PASSWORD = String(
  process.env.VF_KEY_BURST_ADMIN_PASSWORD ||
    process.env.VF_KEY_BURST_PASSWORD ||
    process.env.AUDIT_PASSWORD ||
    ''
).trim();

const GEM_FALLBACK_RUNTIME_VOICES = ['fenrir', 'kore', 'aoede', 'charon', 'leda', 'achernar'];
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

class ProbeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ProbeError';
    this.details = details;
  }
}

function parseIntegerInRange(raw, fallback, min, max) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function parseBool(raw, fallback = false) {
  if (raw === undefined || raw === null) return fallback;
  const token = String(raw).trim().toLowerCase();
  if (!token) return fallback;
  if (TRUTHY.has(token)) return true;
  if (FALSY.has(token)) return false;
  return fallback;
}

function normalizeTestMode(raw) {
  const token = String(raw || '').trim().toLowerCase();
  return token === 'grouped' ? 'grouped' : 'single';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeHeaders(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [key, value] of Object.entries(input)) {
    out[String(key || '').toLowerCase()] = String(value ?? '');
  }
  return out;
}

function responseHeadersToObject(headers) {
  const out = {};
  headers.forEach((value, key) => {
    out[String(key || '').toLowerCase()] = String(value ?? '');
  });
  return out;
}

function truncateText(value, maxLen = 220) {
  const text = String(value ?? '');
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 3))}...`;
}

function normalizeModelId(value) {
  const raw = String(value || '').trim();
  if (raw.toLowerCase().startsWith('models/')) return raw.slice(7).trim();
  return raw;
}

function buildRequestId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

function decodeDiagnosticsHeader(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(decodeURIComponent(text));
  } catch {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}

function parseJsonText(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function envValue(envMap, name) {
  const direct = String(process.env[name] || '').trim();
  if (direct) return direct;
  return String(envMap[name] || '').trim();
}

async function readEnvFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const values = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      values[key] = value;
    }
    return values;
  } catch {
    return {};
  }
}

async function loadMergedEnv() {
  const merged = {};
  for (const candidate of ENV_FILE_CANDIDATES) {
    const values = await readEnvFile(candidate);
    for (const [key, value] of Object.entries(values)) {
      merged[key] = value;
    }
  }
  return merged;
}

async function fetchWithTimeout(url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, headers = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const res = await fetchWithTimeout(
    url,
    {
      method: 'GET',
      headers,
    },
    timeoutMs
  );
  const text = await res.text();
  const payload = parseJsonText(text);
  if (!res.ok) {
    throw new ProbeError(
      `${url} -> ${res.status} ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`,
      {
        statusCode: res.status,
        headers: responseHeadersToObject(res.headers),
        body: payload,
      }
    );
  }
  return payload;
}

async function signInWithPassword(firebaseApiKey, email, password) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(firebaseApiKey)}`;
  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    },
    REQUEST_TIMEOUT_MS
  );
  const text = await response.text();
  const payload = parseJsonText(text);
  if (!response.ok) {
    throw new ProbeError(
      `Firebase sign-in failed (${response.status}) ${truncateText(typeof payload === 'string' ? payload : JSON.stringify(payload), 800)}`,
      { statusCode: response.status, body: payload }
    );
  }
  const idToken = String(payload?.idToken || '').trim();
  const localId = String(payload?.localId || '').trim();
  if (!idToken || !localId) {
    throw new ProbeError('Firebase sign-in succeeded but did not return idToken/localId.', {
      body: payload,
    });
  }
  return {
    idToken,
    uid: localId,
    email: String(payload?.email || email).trim().toLowerCase(),
  };
}

async function resolveAuthContext(envMap) {
  const requireAuth = parseBool(envValue(envMap, 'AUDIT_REQUIRE_AUTH'), true);
  const allowDevUid = parseBool(envValue(envMap, 'AUDIT_ALLOW_DEV_UID'), false);
  const tokenRaw = envValue(envMap, 'AUDIT_BEARER_TOKEN');
  if (tokenRaw) {
    return {
      mode: 'bearer',
      headers: {
        Accept: 'application/json, audio/wav',
        Authorization: tokenRaw.toLowerCase().startsWith('bearer ') ? tokenRaw : `Bearer ${tokenRaw}`,
      },
      bearerSource: 'env',
    };
  }

  const firebaseApiKey =
    String(process.env.VF_KEY_BURST_FIREBASE_API_KEY || '').trim() ||
    envValue(envMap, 'VITE_FIREBASE_API_KEY');
  if (firebaseApiKey && AUTH_EMAIL && AUTH_PASSWORD) {
    const session = await signInWithPassword(firebaseApiKey, AUTH_EMAIL, AUTH_PASSWORD);
    return {
      mode: 'firebase_password',
      headers: {
        Accept: 'application/json, audio/wav',
        Authorization: `Bearer ${session.idToken}`,
      },
      firebaseEmail: session.email,
      firebaseUid: session.uid,
      firebaseApiKeyPresent: true,
    };
  }

  if (allowDevUid) {
    return {
      mode: 'dev_uid',
      headers: {
        Accept: 'application/json, audio/wav',
        'x-dev-uid': TEST_UID,
      },
      devUid: TEST_UID,
    };
  }

  if (requireAuth) {
    throw new ProbeError(
      'Missing live-test auth. Provide AUDIT_BEARER_TOKEN, or VF_KEY_BURST_ADMIN_EMAIL and VF_KEY_BURST_ADMIN_PASSWORD.'
    );
  }

  return {
    mode: 'none',
    headers: {
      Accept: 'application/json, audio/wav',
    },
  };
}

async function fetchProfileSummary(headers) {
  const payload = await fetchJson(`${BACKEND_URL}/account/profile`, headers, REQUEST_TIMEOUT_MS);
  const profile = payload?.profile && typeof payload.profile === 'object' ? payload.profile : {};
  return {
    ok: Boolean(payload?.ok),
    requiredUserId: Boolean(payload?.requiredUserId),
    suggestedUserId: String(payload?.suggestedUserId || '').trim(),
    uid: String(profile.uid || '').trim(),
    userId: String(profile.userId || '').trim(),
    status: String(profile.status || '').trim(),
  };
}

function chooseGemVoicePair(voicesPayload) {
  const voices = Array.isArray(voicesPayload?.voices) ? voicesPayload.voices : [];
  const runtimeVoices = [];
  const seen = new Set();
  for (const voice of voices) {
    if (!voice || typeof voice !== 'object') continue;
    const runtimeVoice = String(voice.voice || voice.mapped_name || voice.name || '').trim().toLowerCase();
    if (!runtimeVoice || seen.has(runtimeVoice)) continue;
    seen.add(runtimeVoice);
    runtimeVoices.push(runtimeVoice);
    if (runtimeVoices.length >= 2) return runtimeVoices;
  }
  for (const fallbackVoice of GEM_FALLBACK_RUNTIME_VOICES) {
    if (seen.has(fallbackVoice)) continue;
    runtimeVoices.push(fallbackVoice);
    seen.add(fallbackVoice);
    if (runtimeVoices.length >= 2) return runtimeVoices;
  }
  if (runtimeVoices.length < 2) {
    throw new ProbeError('Could not determine two GEM runtime voices for live key-burst test.');
  }
  return runtimeVoices.slice(0, 2);
}

function extractJobId(payload, headers) {
  if (payload && typeof payload === 'object') {
    const jobId = String(payload.jobId || payload.requestId || payload.id || '').trim();
    if (jobId) return jobId;
  }
  return String(headers['x-vf-job-id'] || headers['x-vf-request-id'] || '').trim();
}

async function pollJobUntilComplete(jobId, headers) {
  const deadline = Date.now() + JOB_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await fetchWithTimeout(
      `${BACKEND_URL}/tts/jobs/${encodeURIComponent(jobId)}?includeResult=1`,
      {
        method: 'GET',
        headers,
      },
      REQUEST_TIMEOUT_MS
    );
    const text = await response.text();
    const payload = parseJsonText(text);
    if (!response.ok) {
      throw new ProbeError(
        `poll ${jobId} -> ${response.status} ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`,
        {
          statusCode: response.status,
          headers: responseHeadersToObject(response.headers),
          body: payload,
          jobId,
        }
      );
    }
    const status = String(payload?.status || '').trim().toLowerCase();
    if (status === 'completed') {
      const result = payload?.result && typeof payload.result === 'object' ? payload.result : {};
      return {
        statusCode: 200,
        headers: normalizeHeaders(result.headers || {}),
        body: result,
        jobId,
      };
    }
    if (status === 'failed' || status === 'cancelled') {
      throw new ProbeError(`job ${jobId} ended with status=${status}`, {
        statusCode: 200,
        headers: normalizeHeaders(payload?.result?.headers || {}),
        body: payload,
        jobId,
      });
    }
    await sleep(JOB_POLL_INTERVAL_MS);
  }
  throw new ProbeError(`job ${jobId} did not complete within ${JOB_POLL_TIMEOUT_MS}ms`, { jobId });
}

async function synthesizeOnce(payload, authHeaders) {
  const response = await fetchWithTimeout(
    `${BACKEND_URL}/tts/synthesize?wait_ms=${encodeURIComponent(String(WAIT_MS))}`,
    {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
    REQUEST_TIMEOUT_MS
  );
  const headers = responseHeadersToObject(response.headers);
  const contentType = String(headers['content-type'] || '').toLowerCase();
  if (response.status === 200 && contentType.includes('audio/')) {
    await response.arrayBuffer();
    return { statusCode: 200, headers, body: null, jobId: '' };
  }
  const text = await response.text();
  const payloadBody = parseJsonText(text);
  if (response.status === 202) {
    const jobId = extractJobId(payloadBody, headers);
    if (!jobId) {
      throw new ProbeError(`202 accepted but no job id returned. body=${JSON.stringify(payloadBody)}`, {
        statusCode: response.status,
        headers,
        body: payloadBody,
      });
    }
    return pollJobUntilComplete(jobId, authHeaders);
  }
  throw new ProbeError(
    `synthesize failed (${response.status}) ${truncateText(typeof payloadBody === 'string' ? payloadBody : JSON.stringify(payloadBody), 1200)}`,
    {
      statusCode: response.status,
      headers,
      body: payloadBody,
    }
  );
}

async function readAllocatorConfig() {
  const raw = await fs.readFile(ALLOCATOR_CONFIG_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const models = Array.isArray(parsed?.models) ? parsed.models : [];
  const byId = new Map();
  for (const item of models) {
    const id = normalizeModelId(item?.id);
    if (!id) continue;
    byId.set(id, Number(item?.rpm || 0));
  }
  return byId;
}

function effectiveTtsRpm(modelId, allocatorRpmByModel) {
  const envOverride = Number(process.env.GEMINI_TTS_ALLOCATOR_RPM || '');
  if (Number.isFinite(envOverride) && envOverride > 0) return Math.round(envOverride);
  const modelRpm = Number(allocatorRpmByModel.get(normalizeModelId(modelId)) || 0);
  return modelRpm > 0 ? modelRpm : 1;
}

function buildPairSample(index) {
  const left = String.fromCharCode(65 + ((index * 2) % 26));
  const right = String.fromCharCode(65 + ((index * 2 + 1) % 26));
  return {
    pairLabel: `${left}${right}`,
    speakers: [left, right],
    lineMap: [
      {
        lineIndex: 0,
        speaker: left,
        text: `Burst probe line ${index + 1} from speaker ${left}.`,
      },
      {
        lineIndex: 1,
        speaker: right,
        text: `Burst probe reply ${index + 1} from speaker ${right}.`,
      },
    ],
  };
}

function buildSingleSpeakerText(sample, index) {
  return [
    `Burst probe request ${index + 1}.`,
    `Label ${sample.pairLabel}.`,
    `This request should stay on the same allocator key until the RPM burst is exhausted.`,
  ].join(' ');
}

function buildSynthesizePayload(sample, index, voiceA, voiceB) {
  const payload = {
    engine: FORCED_ENGINE,
    request_id: buildRequestId(`gem_key_burst_${sample.pairLabel.toLowerCase()}`),
    voiceName: voiceA,
    voice_id: voiceA,
    language: 'en',
  };
  if (TEST_MODE === 'grouped') {
    payload.text = sample.lineMap.map((line) => `${line.speaker}: ${line.text}`).join('\n');
    payload.multi_speaker_mode = 'studio_pair_groups';
    payload.multi_speaker_max_concurrency = 1;
    payload.multi_speaker_retry_once = true;
    payload.speaker_voices = [
      { speaker: sample.speakers[0], voiceName: voiceA },
      { speaker: sample.speakers[1], voiceName: voiceB },
    ];
    payload.multi_speaker_line_map = sample.lineMap;
  } else {
    payload.text = buildSingleSpeakerText(sample, index);
  }
  if (FORCED_MODEL) {
    payload.model = FORCED_MODEL;
    payload.modelCandidates = [FORCED_MODEL];
  }
  return payload;
}

function buildRuns(samples, keyField = 'burstKeySelectionIndex') {
  const runs = [];
  for (const sample of samples) {
    const fallbackKeyIndex = sample?.keySelectionIndex;
    const keyIndex =
      typeof sample?.[keyField] === 'number' && Number.isFinite(sample[keyField])
        ? sample[keyField]
        : fallbackKeyIndex;
    if (typeof keyIndex !== 'number' || !Number.isFinite(keyIndex)) continue;
    const current = runs[runs.length - 1];
    if (current && current.keySelectionIndex === keyIndex) {
      current.items.push(sample);
      continue;
    }
    runs.push({
      keySelectionIndex: Math.round(keyIndex),
      items: [sample],
    });
  }
  return runs.map((run) => {
    const first = run.items[0] || {};
    return {
      keySelectionIndex: run.keySelectionIndex,
      count: run.items.length,
      rpm: Number(first.rpm || 1),
      model: String(first.model || ''),
      pairLabels: run.items.map((item) => String(item.pairLabel || '')),
    };
  });
}

async function readRuntimeTraceSummaries(traceIds) {
  const wanted = new Set(
    traceIds
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  if (wanted.size === 0) return new Map();

  const summaries = new Map();
  for (const runtimeLogPath of RUNTIME_LOG_PATHS) {
    let raw = '';
    try {
      raw = await fs.readFile(runtimeLogPath, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) continue;
      let entry = null;
      try {
        entry = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      const traceId = String(entry.trace_id || entry.traceId || '').trim();
      if (!wanted.has(traceId)) continue;
      const detail = entry.detail && typeof entry.detail === 'object' ? entry.detail : {};
      const current = summaries.get(traceId) || {};
      const keySelectionIndex = Number(detail.keySelectionIndex);
      if (Number.isFinite(keySelectionIndex)) {
        current.keySelectionIndex = Math.round(keySelectionIndex);
      }
      const keyPoolSize = Number(detail.keyPoolSize);
      if (Number.isFinite(keyPoolSize) && keyPoolSize > 0) {
        current.keyPoolSize = Math.round(keyPoolSize);
      }
      const model = String(detail.model || '').trim();
      if (model) current.model = model;
      const speechMode = String(detail.speechMode || detail.speechModeUsed || '').trim();
      if (speechMode) current.speechModeUsed = speechMode;
      const status = String(entry.status || '').trim().toLowerCase();
      if (status === 'ok') current.completed = true;
      summaries.set(traceId, current);
    }
  }
  return summaries;
}

function appendRequestResult(report, index, sample, payload, result, allocatorRpmByModel) {
  const diagnostics = decodeDiagnosticsHeader(result.headers['x-voiceflow-diagnostics']);
  const diagnosticsKeySelection = diagnostics?.keySelectionIndex;
  const diagnosticsKeyPoolSize = Number(diagnostics?.keyPoolSize);
  const initialKeySelection =
    typeof diagnostics?.initialKeySelectionIndex === 'number' && Number.isFinite(diagnostics.initialKeySelectionIndex)
      ? Math.round(diagnostics.initialKeySelectionIndex)
      : null;
  const attemptKeySelectionIndexes = Array.isArray(diagnostics?.attemptKeySelectionIndexes)
    ? diagnostics.attemptKeySelectionIndexes
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.round(value))
    : [];
  const attemptErrorKinds = Array.isArray(diagnostics?.attemptErrorKinds)
    ? diagnostics.attemptErrorKinds.map((value) => String(value || '').trim().toLowerCase())
    : [];
  const attemptStatuses = Array.isArray(diagnostics?.attemptStatuses)
    ? diagnostics.attemptStatuses.map((value) => String(value || '').trim().toLowerCase())
    : [];
  const model = String(result.headers['x-voiceflow-model'] || diagnostics?.model || '').trim();
  const traceId = String(result.headers['x-voiceflow-trace-id'] || diagnostics?.traceId || '').trim();
  const speechModeUsed = String(
    result.headers['x-voiceflow-speech-mode'] || diagnostics?.speechModeUsed || ''
  ).trim();
  const finalKeySelectionIndex =
    typeof diagnosticsKeySelection === 'number' && Number.isFinite(diagnosticsKeySelection)
      ? Math.round(diagnosticsKeySelection)
      : null;
  report.requests.push({
    requestNumber: index + 1,
    pairLabel: sample.pairLabel,
    mode: TEST_MODE,
    requestId: String(payload.request_id || '').trim(),
    speakers: sample.speakers,
    model,
    rpm: effectiveTtsRpm(model || FORCED_MODEL || '', allocatorRpmByModel),
    speechModeUsed,
    traceId,
    jobId: String(result.jobId || '').trim(),
    status: 'completed',
    keySelectionIndex: finalKeySelectionIndex,
    initialKeySelectionIndex: initialKeySelection,
    burstKeySelectionIndex: initialKeySelection ?? finalKeySelectionIndex,
    attemptKeySelectionIndexes,
    attemptErrorKinds,
    attemptStatuses,
    keyPoolSize:
      Number.isFinite(diagnosticsKeyPoolSize) && diagnosticsKeyPoolSize > 0
        ? Math.round(diagnosticsKeyPoolSize)
        : null,
  });
}

function appendRequestFailure(report, index, sample, payload, error) {
  const details = error instanceof ProbeError ? error.details || {} : {};
  const headers = normalizeHeaders(details.headers || {});
  const diagnostics = decodeDiagnosticsHeader(headers['x-voiceflow-diagnostics']);
  const detailBody = details.body?.detail && typeof details.body.detail === 'object' ? details.body.detail : {};
  const initialKeySelection =
    typeof diagnostics?.initialKeySelectionIndex === 'number' && Number.isFinite(diagnostics.initialKeySelectionIndex)
      ? Math.round(diagnostics.initialKeySelectionIndex)
      : null;
  const finalKeySelectionIndex =
    typeof diagnostics?.keySelectionIndex === 'number' && Number.isFinite(diagnostics.keySelectionIndex)
      ? Math.round(diagnostics.keySelectionIndex)
      : null;
  report.requests.push({
    requestNumber: index + 1,
    pairLabel: sample.pairLabel,
    mode: TEST_MODE,
    requestId: String(payload.request_id || '').trim(),
    speakers: sample.speakers,
    model: String(headers['x-voiceflow-model'] || diagnostics?.model || FORCED_MODEL || '').trim(),
    rpm: null,
    speechModeUsed: String(headers['x-voiceflow-speech-mode'] || diagnostics?.speechModeUsed || '').trim(),
    traceId: String(
      headers['x-voiceflow-trace-id'] ||
        diagnostics?.traceId ||
        detailBody.trace_id ||
        detailBody.traceId ||
        ''
    ).trim(),
    jobId: String(details.jobId || '').trim(),
    status: 'failed',
    keySelectionIndex: finalKeySelectionIndex,
    initialKeySelectionIndex: initialKeySelection,
    burstKeySelectionIndex: initialKeySelection ?? finalKeySelectionIndex,
    attemptKeySelectionIndexes: Array.isArray(diagnostics?.attemptKeySelectionIndexes)
      ? diagnostics.attemptKeySelectionIndexes
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
          .map((value) => Math.round(value))
      : [],
    attemptErrorKinds: Array.isArray(diagnostics?.attemptErrorKinds)
      ? diagnostics.attemptErrorKinds.map((value) => String(value || '').trim().toLowerCase())
      : [],
    attemptStatuses: Array.isArray(diagnostics?.attemptStatuses)
      ? diagnostics.attemptStatuses.map((value) => String(value || '').trim().toLowerCase())
      : [],
    keyPoolSize: Number.isFinite(Number(diagnostics?.keyPoolSize)) ? Math.round(Number(diagnostics.keyPoolSize)) : null,
    error: error instanceof Error ? error.message : String(error),
  });
}

async function enrichRequestsFromRuntime(report, allocatorRpmByModel) {
  const runtimeTraceSummaries = await readRuntimeTraceSummaries(report.requests.map((item) => item.traceId));
  for (const item of report.requests) {
    const summary = runtimeTraceSummaries.get(String(item.traceId || '').trim()) || {};
    if ((item.keySelectionIndex === null || item.keySelectionIndex === undefined) && Number.isFinite(summary.keySelectionIndex)) {
      item.keySelectionIndex = Math.round(summary.keySelectionIndex);
    }
    if ((item.burstKeySelectionIndex === null || item.burstKeySelectionIndex === undefined) && Number.isFinite(item.initialKeySelectionIndex)) {
      item.burstKeySelectionIndex = Math.round(item.initialKeySelectionIndex);
    }
    if ((item.burstKeySelectionIndex === null || item.burstKeySelectionIndex === undefined) && Number.isFinite(summary.keySelectionIndex)) {
      item.burstKeySelectionIndex = Math.round(summary.keySelectionIndex);
    }
    if ((!item.keyPoolSize || item.keyPoolSize <= 0) && Number.isFinite(summary.keyPoolSize)) {
      item.keyPoolSize = Math.round(summary.keyPoolSize);
    }
    if (!item.model && summary.model) {
      item.model = String(summary.model);
    }
    if (!item.speechModeUsed && summary.speechModeUsed) {
      item.speechModeUsed = String(summary.speechModeUsed);
    }
    if (!item.model && FORCED_MODEL) {
      item.model = FORCED_MODEL;
    }
    if (!Number.isFinite(Number(item.rpm))) {
      item.rpm = effectiveTtsRpm(item.model || FORCED_MODEL || '', allocatorRpmByModel);
    }
  }
}

function evaluateRuns(report) {
  const completedRequests = report.requests.filter(
    (item) => item.status === 'completed' && typeof item.burstKeySelectionIndex === 'number'
  );
  report.runs = buildRuns(completedRequests, 'burstKeySelectionIndex');
  report.finalRuns = buildRuns(completedRequests, 'keySelectionIndex');
  if (report.runs.length === 0) {
    report.failures.push('No burst keySelectionIndex values were returned in live diagnostics.');
    return;
  }

  for (let index = 0; index < report.runs.length; index += 1) {
    const run = report.runs[index];
    if (!Number.isFinite(run.rpm) || run.rpm <= 0) {
      report.failures.push(`Run ${index + 1} missing a valid RPM value.`);
      continue;
    }
    if (run.count > run.rpm) {
      report.failures.push(
        `Run ${index + 1} stayed on key ${run.keySelectionIndex} for ${run.count} requests, exceeding rpm burst ${run.rpm}.`
      );
    }
    const finalRun = index === report.runs.length - 1;
    if (!finalRun && run.count !== run.rpm) {
      report.failures.push(
        `Run ${index + 1} on key ${run.keySelectionIndex} ended after ${run.count} requests, expected ${run.rpm}.`
      );
    }
  }

  if (report.runs.length >= 2) {
    for (let index = 1; index < report.runs.length; index += 1) {
      if (report.runs[index].keySelectionIndex === report.runs[index - 1].keySelectionIndex) {
        report.failures.push(`Adjacent key runs ${index} and ${index + 1} resolved to the same key index.`);
      }
    }
  } else if (REQUEST_COUNT > 1) {
    report.warnings.push('Only one key run was observed. This can happen if the pool has a single healthy key.');
  }

  for (const item of completedRequests) {
    if (
      typeof item.initialKeySelectionIndex === 'number' &&
      typeof item.keySelectionIndex === 'number' &&
      item.initialKeySelectionIndex !== item.keySelectionIndex
    ) {
      report.warnings.push(
        `Request ${item.requestNumber} (${item.pairLabel}) started on key ${item.initialKeySelectionIndex} and completed on key ${item.keySelectionIndex}.`
      );
    }
  }
}

async function main() {
  const envMap = await loadMergedEnv();
  const allocatorRpmByModel = await readAllocatorConfig();
  const report = {
    startedAt: new Date().toISOString(),
    backendUrl: BACKEND_URL,
    authMode: '',
    testMode: TEST_MODE,
    requestCount: REQUEST_COUNT,
    waitMs: WAIT_MS,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    jobPollTimeoutMs: JOB_POLL_TIMEOUT_MS,
    forcedEngine: FORCED_ENGINE,
    forcedModel: FORCED_MODEL || null,
    requests: [],
    runs: [],
    finalRuns: [],
    warnings: [],
    failures: [],
    passed: false,
  };

  try {
    const authContext = await resolveAuthContext(envMap);
    report.authMode = authContext.mode;
    if (authContext.firebaseEmail) report.authEmail = authContext.firebaseEmail;
    if (authContext.firebaseUid) report.authUid = authContext.firebaseUid;
    if (authContext.devUid) report.authUid = authContext.devUid;

    const [health, gemVoicesPayload, profile] = await Promise.all([
      fetchJson(`${BACKEND_URL}/health`),
      fetchJson(`${BACKEND_URL}/tts/engines/voices?engine=GEM`, authContext.headers),
      fetchProfileSummary(authContext.headers),
    ]);
    report.healthOk = Boolean(health?.ok);
    report.profile = profile;
    if (profile.requiredUserId) {
      throw new ProbeError(
        `Authenticated user ${profile.uid || authContext.firebaseUid || ''} still requires userId before TTS can run.`
      );
    }

    const [voiceA, voiceB] = chooseGemVoicePair(gemVoicesPayload);
    report.voicePair = [voiceA, voiceB];

    for (let index = 0; index < REQUEST_COUNT; index += 1) {
      const sample = buildPairSample(index);
      const payload = buildSynthesizePayload(sample, index, voiceA, voiceB);
      try {
        const result = await synthesizeOnce(payload, authContext.headers);
        appendRequestResult(report, index, sample, payload, result, allocatorRpmByModel);
      } catch (error) {
        appendRequestFailure(report, index, sample, payload, error);
        report.failures.push(
          `Request ${index + 1} (${sample.pairLabel}) failed: ${error instanceof Error ? error.message : String(error)}`
        );
        break;
      }
    }
  } catch (error) {
    report.failures.push(error instanceof Error ? error.message : String(error));
  } finally {
    await enrichRequestsFromRuntime(report, allocatorRpmByModel);
    evaluateRuns(report);
    report.finishedAt = new Date().toISOString();
    report.passed = report.failures.length === 0;

    await fs.mkdir(ARTIFACT_DIR, { recursive: true });
    await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(`Report written: ${path.relative(ROOT, REPORT_PATH).replace(/\\/g, '/')}`);
  console.log(`Passed: ${report.passed}`);
  console.log(`Mode: ${report.testMode}`);
  console.log(`Auth: ${report.authMode}`);
  console.log(`Observed burst key sequence: ${report.requests.map((item) => String(item.burstKeySelectionIndex)).join(', ')}`);
  console.log(`Observed final key sequence: ${report.requests.map((item) => String(item.keySelectionIndex)).join(', ')}`);
  console.log(`Observed burst runs: ${report.runs.map((run) => `${run.keySelectionIndex}x${run.count}(rpm=${run.rpm})`).join(' | ')}`);
  console.log(`Observed final runs: ${report.finalRuns.map((run) => `${run.keySelectionIndex}x${run.count}(rpm=${run.rpm})`).join(' | ')}`);
  console.log(`Warnings: ${report.warnings.length}`);
  console.log(`Failures: ${report.failures.length}`);
  if (report.failures.length > 0) {
    for (const failure of report.failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
