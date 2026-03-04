#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildAuditHeaders,
  classifyAuditFailure,
  fetchJsonWithTimeout,
  isTransientFailureClass,
  normalizeBaseUrl,
  withBoundedRetry,
} from './lib/audit-helpers.mjs';

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'load');
const DEFAULT_BASE_URL = normalizeBaseUrl(process.env.VF_MEDIA_BACKEND_URL, 'http://127.0.0.1:7800');

const asInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

const buildExactLengthText = (seed, chars) => {
  const safeChars = Math.max(20, Number(chars) || 20);
  const unit = String(seed || 'voiceflow load test payload').trim() || 'voiceflow load test payload';
  let out = unit;
  while (out.length < safeChars) {
    out = `${out} ${unit}`;
  }
  if (out.length > safeChars) {
    return out.slice(0, safeChars);
  }
  return out;
};

const nowIso = () => new Date().toISOString();

const parseArgs = (argv) => {
  const map = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '');
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || String(next).startsWith('--')) {
      map.set(key, '1');
      continue;
    }
    map.set(key, String(next));
    i += 1;
  }
  return map;
};

const args = parseArgs(process.argv.slice(2));
const mode = String(args.get('mode') || process.env.VF_LOAD_MODE || 'mixed').trim().toLowerCase();
const concurrency = Math.max(1, asInt(args.get('concurrency') || process.env.VF_LOAD_CONCURRENCY, 50));
const requestsTotal = Math.max(concurrency, asInt(args.get('requests') || process.env.VF_LOAD_REQUESTS, 50));
const timeoutMs = Math.max(1_000, asInt(args.get('timeout-ms') || process.env.VF_LOAD_TIMEOUT_MS, 120_000));
const pollMs = Math.max(100, asInt(args.get('poll-ms') || process.env.VF_LOAD_POLL_MS, 350));
const syncWaitMs = Math.max(0, asInt(args.get('sync-wait-ms') || process.env.VF_LOAD_SYNC_WAIT_MS, 3_000));
const textChars = Math.max(20, asInt(args.get('chars') || process.env.VF_LOAD_TEXT_CHARS, 100));
const baseUrl = normalizeBaseUrl(args.get('base-url') || DEFAULT_BASE_URL, DEFAULT_BASE_URL);
const uid = String(args.get('uid') || process.env.VF_LOAD_UID || 'load_test_user').trim() || 'load_test_user';
const minCompletionRate = Number.parseFloat(String(args.get('min-completion-rate') || process.env.VF_LOAD_MIN_COMPLETION_RATE || '1'));
const retryMax = Math.max(0, asInt(args.get('retry-max') || process.env.VF_LOAD_RETRY_MAX, 2));
const retryBaseMs = Math.max(100, asInt(args.get('retry-base-ms') || process.env.VF_LOAD_RETRY_BASE_MS, 650));

const splitRaw = String(args.get('engine-split') || process.env.VF_LOAD_ENGINE_SPLIT || 'gem=0.6,kokoro=0.4').toLowerCase();
const splitTokens = splitRaw
  .split(',')
  .map((token) => token.trim())
  .filter(Boolean);
let gemWeight = 0.6;
let kokoroWeight = 0.4;
for (const token of splitTokens) {
  const [k, v] = token.split('=');
  const value = Number.parseFloat(String(v || ''));
  if (!Number.isFinite(value) || value < 0) continue;
  if (k === 'gem') gemWeight = value;
  if (k === 'kokoro') kokoroWeight = value;
}
const weightSum = gemWeight + kokoroWeight;
if (weightSum <= 0) {
  gemWeight = 0.5;
  kokoroWeight = 0.5;
}
const gemRatio = gemWeight / (gemWeight + kokoroWeight);

const { headers: authHeaders, auth: authContext } = buildAuditHeaders(
  { Accept: 'application/json' },
  { scriptName: 'test:load:50:node', defaultDevUid: uid }
);

const headers = {
  ...authHeaders,
  'Content-Type': 'application/json',
};

const pickEngine = (index) => {
  const frac = (index % 100) / 100;
  return frac < gemRatio ? 'GEM' : 'KOKORO';
};

const pickModeForRequest = (index) => {
  if (mode === 'jobs' || mode === 'sync') return mode;
  return index % 2 === 0 ? 'jobs' : 'sync';
};

const requestWithTimeout = async (url, init, reqTimeoutMs = timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), reqTimeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
};

const parseBody = async (response) => {
  if (!response) return null;
  const type = String(response.headers.get('content-type') || '').toLowerCase();
  try {
    if (type.includes('application/json')) return await response.json();
    const text = await response.text();
    return text ? { text } : null;
  } catch {
    return null;
  }
};

const classifyFailure = (statusCode, payload) => classifyAuditFailure({ status: statusCode, payload });

const runPreflight = async () => {
  const checks = [];
  const targets = [
    { name: 'health', url: `${baseUrl}/health` },
    { name: 'enginesStatus', url: `${baseUrl}/tts/engines/status` },
    { name: 'queueMetrics', url: `${baseUrl}/admin/tts/queue/metrics` },
  ];

  for (const target of targets) {
    const result = await fetchJsonWithTimeout(
      target.url,
      {
        method: 'GET',
        headers: authHeaders,
      },
      Math.min(timeoutMs, 15_000),
    );

    checks.push({
      name: target.name,
      ok: result.ok,
      status: result.status,
      classification: classifyAuditFailure(result),
      detail: result.ok ? '' : JSON.stringify(result.payload || '').slice(0, 500),
    });
  }

  return {
    ok: checks.every((entry) => entry.ok),
    checks,
  };
};

const terminalFromStatus = (status) => {
  const token = String(status || '').trim().toLowerCase();
  if (token === 'completed' || token === 'failed' || token === 'cancelled') return token;
  return null;
};

const pollJobUntilTerminal = async (jobId, deadlineMs) => {
  const started = Date.now();
  let attempts = 0;
  while (Date.now() < deadlineMs) {
    attempts += 1;
    const response = await requestWithTimeout(`${baseUrl}/tts/jobs/${encodeURIComponent(jobId)}`, {
      method: 'GET',
      headers,
    }, Math.min(timeoutMs, 30_000));
    const body = await parseBody(response);
    const jobStatus = terminalFromStatus(body?.status);
    if (!response.ok) {
      return {
        ok: false,
        terminalStatus: 'failed',
        statusCode: response.status,
        errorCode: body?.error?.errorCode || body?.detail?.errorCode || null,
        reason: body?.error?.reason || body?.detail?.reason || 'status_poll_failed',
        failureClass: classifyFailure(response.status, body),
        attempts,
        elapsedMs: Date.now() - started,
      };
    }
    if (jobStatus === 'completed') {
      return {
        ok: true,
        terminalStatus: 'completed',
        statusCode: 200,
        attempts,
        elapsedMs: Date.now() - started,
      };
    }
    if (jobStatus === 'failed' || jobStatus === 'cancelled') {
      const errorPayload = body?.error || null;
      return {
        ok: false,
        terminalStatus: jobStatus,
        statusCode: Number(body?.statusCode || 500),
        errorCode: errorPayload?.errorCode || null,
        reason: errorPayload?.reason || jobStatus,
        failureClass: classifyFailure(Number(body?.statusCode || 500), body),
        attempts,
        elapsedMs: Date.now() - started,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return {
    ok: false,
    terminalStatus: 'timeout',
    statusCode: 0,
    errorCode: 'JOB_TIMEOUT',
    reason: 'terminal_poll_timeout',
    failureClass: 'timeout',
    attempts,
    elapsedMs: Date.now() - started,
  };
};

const makePayload = (engine, requestId) => {
  const text = engine === 'GEM'
    ? buildExactLengthText('Load test payload for Gemini runtime queue hardening.', textChars)
    : buildExactLengthText('Load test payload for Kokoro runtime queue hardening.', textChars);
  if (engine === 'GEM') {
    return {
      engine,
      text,
      voice_id: 'Fenrir',
      request_id: requestId,
    };
  }
  return {
    engine,
    text,
    voice_id: 'hf_alpha',
    request_id: requestId,
  };
};

const runJobsPath = async (engine, requestId) => {
  const started = Date.now();
  const payload = makePayload(engine, requestId);
  const response = await requestWithTimeout(`${baseUrl}/tts/jobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const body = await parseBody(response);
  const elapsedMs = Date.now() - started;
  if (!response.ok) {
    return {
      ok: false,
      mode: 'jobs',
      engine,
      requestId,
      statusCode: response.status,
      elapsedMs,
      accepted: false,
      terminalStatus: 'failed',
      errorCode: body?.detail?.errorCode || body?.errorCode || null,
      reason: body?.detail?.reason || body?.reason || 'submit_failed',
      failureClass: classifyFailure(response.status, body),
      responseBody: body,
    };
  }

  const immediateStatus = terminalFromStatus(body?.status);
  if (immediateStatus === 'completed') {
    return {
      ok: true,
      mode: 'jobs',
      engine,
      requestId,
      statusCode: response.status,
      elapsedMs,
      accepted: true,
      terminalStatus: 'completed',
      pollAttempts: 0,
      responseBody: body,
    };
  }

  const jobId = String(body?.jobId || body?.requestId || requestId).trim() || requestId;
  const poll = await pollJobUntilTerminal(jobId, Date.now() + timeoutMs);
  return {
    ok: poll.ok,
    mode: 'jobs',
    engine,
    requestId,
    jobId,
    statusCode: response.status,
    elapsedMs: Date.now() - started,
    accepted: true,
    terminalStatus: poll.terminalStatus,
    pollAttempts: poll.attempts,
    pollElapsedMs: poll.elapsedMs,
    errorCode: poll.errorCode || null,
    reason: poll.reason || null,
    failureClass: poll.failureClass || null,
  };
};

const runSyncPath = async (engine, requestId) => {
  const started = Date.now();
  const payload = makePayload(engine, requestId);
  const response = await requestWithTimeout(`${baseUrl}/tts/synthesize?wait_ms=${encodeURIComponent(String(syncWaitMs))}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const body = await parseBody(response);
  const elapsedMs = Date.now() - started;

  if (response.status >= 500) {
    return {
      ok: false,
      mode: 'sync',
      engine,
      requestId,
      statusCode: response.status,
      elapsedMs,
      accepted: false,
      terminalStatus: 'failed',
      errorCode: body?.detail?.errorCode || body?.errorCode || null,
      reason: body?.detail?.reason || body?.reason || 'sync_5xx',
      failureClass: classifyFailure(response.status, body),
      responseBody: body,
    };
  }

  if (response.status === 200) {
    return {
      ok: true,
      mode: 'sync',
      engine,
      requestId,
      statusCode: response.status,
      elapsedMs,
      accepted: true,
      terminalStatus: 'completed',
    };
  }

  if (response.status === 202) {
    const jobId = String(body?.jobId || body?.requestId || requestId).trim() || requestId;
    const poll = await pollJobUntilTerminal(jobId, Date.now() + timeoutMs);
    return {
      ok: poll.ok,
      mode: 'sync',
      engine,
      requestId,
      statusCode: response.status,
      elapsedMs: Date.now() - started,
      accepted: true,
      jobId,
      terminalStatus: poll.terminalStatus,
      pollAttempts: poll.attempts,
      pollElapsedMs: poll.elapsedMs,
      errorCode: poll.errorCode || null,
      reason: poll.reason || null,
      failureClass: poll.failureClass || null,
    };
  }

  return {
    ok: false,
    mode: 'sync',
    engine,
    requestId,
    statusCode: response.status,
    elapsedMs,
    accepted: false,
    terminalStatus: 'failed',
    errorCode: body?.detail?.errorCode || body?.errorCode || null,
    reason: body?.detail?.reason || body?.reason || 'unexpected_sync_status',
    failureClass: classifyFailure(response.status, body),
    responseBody: body,
  };
};

const runOne = async (index) => {
  const requestMode = pickModeForRequest(index);
  const engine = pickEngine(index);
  const requestId = `load_${requestMode}_${engine.toLowerCase()}_${Date.now().toString(36)}_${index}`;

  return withBoundedRetry(
    async () => {
      try {
        if (requestMode === 'jobs') return await runJobsPath(engine, requestId);
        return await runSyncPath(engine, requestId);
      } catch (error) {
        return {
          ok: false,
          mode: requestMode,
          engine,
          requestId,
          statusCode: 0,
          elapsedMs: 0,
          accepted: false,
          terminalStatus: 'failed',
          errorCode: error?.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
          reason: error instanceof Error ? error.message : String(error),
          failureClass: error?.name === 'AbortError' ? 'timeout' : 'backend_unavailable',
        };
      }
    },
    {
      maxRetries: retryMax,
      baseDelayMs: retryBaseMs,
      shouldRetry: (result) => !result.ok && isTransientFailureClass(String(result.failureClass || '')),
    }
  );
};

const percentile = (values, ratio) => {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * ratio)));
  return Number(sorted[index] || 0);
};

const summarize = (results, startedAt, finishedAt, preflight) => {
  const statusCodes = {};
  const terminal = { completed: 0, failed: 0, cancelled: 0, timeout: 0, unknown: 0 };
  const latencyValues = [];
  const modes = { jobs: 0, sync: 0 };
  const engines = { GEM: 0, KOKORO: 0 };
  let http5xx = 0;
  let failures = 0;
  let accepted = 0;

  for (const item of results) {
    const statusCode = Number(item.statusCode || 0);
    const statusKey = String(statusCode || 0);
    statusCodes[statusKey] = Number(statusCodes[statusKey] || 0) + 1;
    if (statusCode >= 500) http5xx += 1;
    if (!item.ok) failures += 1;
    if (item.accepted) accepted += 1;
    latencyValues.push(Number(item.elapsedMs || 0));
    const modeKey = String(item.mode || 'sync');
    if (modeKey === 'jobs' || modeKey === 'sync') modes[modeKey] += 1;
    const engineKey = String(item.engine || 'GEM').toUpperCase();
    if (engineKey === 'GEM' || engineKey === 'KOKORO') engines[engineKey] += 1;
    const terminalStatus = String(item.terminalStatus || '').toLowerCase();
    if (terminalStatus in terminal) {
      terminal[terminalStatus] += 1;
    } else {
      terminal.unknown += 1;
    }
  }

  const completed = terminal.completed;
  const completionRate = results.length > 0 ? completed / results.length : 0;
  const failureReasons = [];
  if (http5xx > 0) failureReasons.push(`Detected ${http5xx} server-side 5xx responses.`);
  if (completionRate < minCompletionRate) {
    failureReasons.push(`Completion rate ${completionRate.toFixed(3)} is below threshold ${minCompletionRate.toFixed(3)}.`);
  }
  if (terminal.failed > 0 || terminal.timeout > 0 || terminal.cancelled > 0) {
    failureReasons.push(
      `Terminal failures observed (failed=${terminal.failed}, timeout=${terminal.timeout}, cancelled=${terminal.cancelled}).`,
    );
  }

  return {
    schemaVersion: '1.0.0',
    startedAt,
    finishedAt,
    target: {
      baseUrl,
      uid,
      authMode: authContext.mode,
    },
    config: {
      mode,
      concurrency,
      requests: requestsTotal,
      timeoutMs,
      pollMs,
      syncWaitMs,
      textChars,
      engineSplit: {
        gem: Number(gemRatio.toFixed(4)),
        kokoro: Number((1 - gemRatio).toFixed(4)),
      },
      minCompletionRate,
      retryMax,
      retryBaseMs,
    },
    preflight,
    totals: {
      requests: results.length,
      accepted,
      completed,
      failures,
      completionRate: Number(completionRate.toFixed(4)),
      http5xx,
      statusCodes,
      modes,
      engines,
      terminal,
    },
    latencyMs: {
      avg: latencyValues.length ? Number((latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length).toFixed(2)) : 0,
      p50: percentile(latencyValues, 0.5),
      p95: percentile(latencyValues, 0.95),
      p99: percentile(latencyValues, 0.99),
      max: latencyValues.length ? Math.max(...latencyValues) : 0,
    },
    verdict: {
      passed: failureReasons.length === 0,
      reasons: failureReasons,
    },
    failures: results
      .filter((item) => !item.ok)
      .slice(0, 200)
      .map((item) => ({
        mode: item.mode,
        engine: item.engine,
        requestId: item.requestId,
        jobId: item.jobId,
        statusCode: item.statusCode,
        terminalStatus: item.terminalStatus,
        errorCode: item.errorCode || null,
        reason: item.reason || null,
        failureClass: item.failureClass || null,
        attempts: Number(item.attempts || 1),
        elapsedMs: item.elapsedMs,
      })),
  };
};

const main = async () => {
  const startedAt = nowIso();
  const preflight = await runPreflight();
  if (!preflight.ok) {
    const finishedAt = nowIso();
    const report = summarize([], startedAt, finishedAt, preflight);
    report.verdict.passed = false;
    report.verdict.reasons = [
      'preflight_failure',
      ...preflight.checks.filter((entry) => !entry.ok).map((entry) => `${entry.name}:${entry.classification}:${entry.status}`),
    ];

    await fs.mkdir(ARTIFACT_DIR, { recursive: true });
    const artifactName = String(args.get('artifact') || `node-load-${mode}-c${concurrency}-${Date.now()}.json`);
    const artifactPath = path.join(ARTIFACT_DIR, artifactName);
    await fs.writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    console.error('[loadtest-node] preflight failed.');
    for (const check of preflight.checks.filter((entry) => !entry.ok)) {
      console.error(`[loadtest-node][preflight] ${check.name} status=${check.status} class=${check.classification}`);
    }
    process.exitCode = 1;
    return;
  }

  let nextIndex = 0;
  const results = [];
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= requestsTotal) return;
      const outcome = await runOne(currentIndex);
      results.push(outcome);
    }
  });

  await Promise.all(workers);
  const finishedAt = nowIso();
  const report = summarize(results, startedAt, finishedAt, preflight);

  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  const artifactName = String(args.get('artifact') || `node-load-${mode}-c${concurrency}-${Date.now()}.json`);
  const artifactPath = path.join(ARTIFACT_DIR, artifactName);
  await fs.writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const relativePath = path.relative(ROOT, artifactPath).replace(/\\/g, '/');
  console.log(`[loadtest-node] report: ${relativePath}`);
  console.log(`[loadtest-node] passed: ${report.verdict.passed}`);
  console.log(
    `[loadtest-node] completionRate=${report.totals.completionRate} http5xx=${report.totals.http5xx} p95=${report.latencyMs.p95}ms`,
  );

  if (!report.verdict.passed) {
    for (const reason of report.verdict.reasons) {
      console.error(`[loadtest-node][FAIL] ${reason}`);
    }
    process.exitCode = 1;
    return;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
