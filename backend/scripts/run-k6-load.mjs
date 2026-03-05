#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildAuditHeaders, classifyAuditFailure, fetchJsonWithTimeout, parseBool } from './lib/audit-helpers.mjs';
import { probeCommand, runCommand } from './lib/process-runner.mjs';

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'load');
const SCRIPT_PATH = path.join(ROOT, 'scripts', 'loadtest-tts-concurrency.k6.js');
const K6_BIN = String(process.env.VF_K6_BIN || 'k6').trim() || 'k6';

const asInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

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
const vus = Math.max(1, asInt(args.get('vus') || process.env.VF_LOAD_VUS, 50));
const duration = String(args.get('duration') || process.env.VF_LOAD_DURATION || '30s');
const mode = String(args.get('mode') || process.env.VF_LOAD_MODE || 'mixed').toLowerCase();
const pollMs = Math.max(100, asInt(args.get('poll-ms') || process.env.VF_LOAD_POLL_MS, 350));
const timeoutMs = Math.max(1_000, asInt(args.get('timeout-ms') || process.env.VF_LOAD_JOB_TIMEOUT_MS, 120_000));
const syncWaitMs = Math.max(0, asInt(args.get('sync-wait-ms') || process.env.VF_LOAD_SYNC_WAIT_MS, 3_000));
const uid = String(args.get('uid') || process.env.VF_LOAD_UID || 'k6_load_user').trim() || 'k6_load_user';
const baseUrl = String(args.get('base-url') || process.env.VF_MEDIA_BACKEND_URL || 'http://127.0.0.1:7800').trim().replace(/\/+$/, '');
const requireK6 = parseBool(args.get('require-k6') ?? process.env.VF_REQUIRE_K6, false);
const queueSampleMs = Math.max(250, asInt(args.get('queue-sample-ms') || process.env.VF_LOAD_QUEUE_SAMPLE_MS, 1000));
const maxQueueDepth = Math.max(1, asInt(args.get('max-queue-depth') || process.env.VF_LOAD_MAX_QUEUE_DEPTH, Math.max(100, vus * 4)));
const maxOldestQueuedAgeMs = Math.max(
  1,
  asInt(args.get('max-oldest-age-ms') || process.env.VF_LOAD_MAX_OLDEST_QUEUED_AGE_MS, Math.max(timeoutMs, 120_000))
);

const timestamp = Date.now();
const summaryPath = path.join(ARTIFACT_DIR, `k6-summary-${mode}-c${vus}-${timestamp}.json`);
const rawSummaryExportPath = path.join(ARTIFACT_DIR, `k6-raw-${mode}-c${vus}-${timestamp}.json`);
const verdictPath = path.join(ARTIFACT_DIR, `k6-verdict-${mode}-c${vus}-${timestamp}.json`);

const readJsonFile = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
};

const percentile = (values, ratio) => {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * ratio)));
  return Number(sorted[index] || 0);
};

const parseQueueMetrics = (payload) => {
  const queue = payload && typeof payload === 'object' ? payload.queue : null;
  const telemetry = payload && typeof payload === 'object' ? payload.telemetry : null;
  return {
    depthTotal: Math.max(0, Number(queue && queue.total ? queue.total : 0) || 0),
    oldestAgeMs: Math.max(0, Number(telemetry && telemetry.oldestQueuedAgeMs ? telemetry.oldestQueuedAgeMs : 0) || 0),
  };
};

const main = async () => {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });

  const k6Probe = await probeCommand(K6_BIN, ['version']);
  if (!k6Probe.available) {
    const reason = 'SKIPPED_K6_MISSING';
    const passed = !requireK6;
    const summaryPayload = {
      schemaVersion: '1.0.0',
      generatedAt: new Date().toISOString(),
      target: {
        baseUrl,
        mode,
        uid,
        vus,
        duration,
      },
      metrics: null,
      verdict: {
        passed,
        reasons: passed ? [reason] : [`${reason}_STRICT`],
      },
      skipped: {
        tool: 'k6',
        error: k6Probe.error || 'k6 binary not found in PATH',
      },
    };
    await fs.writeFile(summaryPath, `${JSON.stringify(summaryPayload, null, 2)}\n`, 'utf8');

    const verdictPayload = {
      schemaVersion: '1.0.0',
      generatedAt: new Date().toISOString(),
      config: {
        mode,
        vus,
        duration,
        pollMs,
        timeoutMs,
        syncWaitMs,
        uid,
        requireK6,
        queueSampleMs,
        maxQueueDepth,
        maxOldestQueuedAgeMs,
      },
      artifacts: {
        summaryPath: path.relative(ROOT, summaryPath).replace(/\\/g, '/'),
        rawSummaryExportPath: path.relative(ROOT, rawSummaryExportPath).replace(/\\/g, '/'),
      },
      verdict: {
        passed,
        reasons: summaryPayload.verdict.reasons,
      },
      k6: {
        exitCode: 1,
        launchError: k6Probe.error || 'k6 binary not found in PATH',
        skipped: true,
      },
    };

    await fs.writeFile(verdictPath, `${JSON.stringify(verdictPayload, null, 2)}\n`, 'utf8');
    console.log(`[run-k6-load] summary: ${path.relative(ROOT, summaryPath).replace(/\\/g, '/')}`);
    console.log(`[run-k6-load] verdict: ${path.relative(ROOT, verdictPath).replace(/\\/g, '/')}`);
    console.log(`[run-k6-load] skipped: k6 binary missing (require=${requireK6 ? 'on' : 'off'})`);
    if (!passed) process.exit(1);
    return;
  }

  const { headers: queueProbeHeaders } = buildAuditHeaders(
    { Accept: 'application/json' },
    { scriptName: `test:load:k6:c${vus}`, defaultDevUid: uid }
  );

  const queueTelemetry = [];
  let queueSamplerActive = true;
  let queueSamplerInFlight = false;
  const sampleQueueMetrics = async (phase = 'interval') => {
    if (!queueSamplerActive || queueSamplerInFlight) return;
    queueSamplerInFlight = true;
    try {
      const probe = await fetchJsonWithTimeout(
        `${baseUrl}/admin/tts/queue/metrics`,
        {
          method: 'GET',
          headers: queueProbeHeaders,
        },
        Math.min(timeoutMs, 15_000),
      );
      if (!probe.ok) {
        queueTelemetry.push({
          at: new Date().toISOString(),
          phase,
          ok: false,
          status: probe.status,
          classification: classifyAuditFailure(probe),
        });
        return;
      }
      const parsed = parseQueueMetrics(probe.payload);
      queueTelemetry.push({
        at: new Date().toISOString(),
        phase,
        ok: true,
        status: probe.status,
        depthTotal: parsed.depthTotal,
        oldestAgeMs: parsed.oldestAgeMs,
      });
    } finally {
      queueSamplerInFlight = false;
    }
  };

  await sampleQueueMetrics('start');
  const queueSamplerTimer = setInterval(() => {
    void sampleQueueMetrics('interval');
  }, queueSampleMs);

  const k6Args = ['run', SCRIPT_PATH, '--summary-export', rawSummaryExportPath];
  const env = {
    VF_MEDIA_BACKEND_URL: baseUrl,
    VF_LOAD_VUS: String(vus),
    VF_LOAD_DURATION: duration,
    VF_LOAD_MODE: mode,
    VF_LOAD_UID: uid,
    VF_LOAD_POLL_MS: String(pollMs),
    VF_LOAD_JOB_TIMEOUT_MS: String(timeoutMs),
    VF_LOAD_SYNC_WAIT_MS: String(syncWaitMs),
    VF_K6_SUMMARY_PATH: summaryPath,
    AUDIT_BEARER_TOKEN: String(process.env.AUDIT_BEARER_TOKEN || ''),
    AUDIT_ALLOW_DEV_UID: String(process.env.AUDIT_ALLOW_DEV_UID || ''),
    AUDIT_DEV_UID: String(process.env.AUDIT_DEV_UID || ''),
    AUDIT_REQUIRE_AUTH: String(process.env.AUDIT_REQUIRE_AUTH || ''),
  };

  let runResult;
  try {
    runResult = await runCommand(K6_BIN, k6Args, {
      env,
      stdio: 'inherit',
    });
  } finally {
    queueSamplerActive = false;
    clearInterval(queueSamplerTimer);
    await sampleQueueMetrics('end');
  }
  let summaryPayload = null;
  let verdictReasons = [];
  let passed = runResult.ok;

  try {
    summaryPayload = await readJsonFile(summaryPath);
    const reasons = summaryPayload?.verdict?.reasons;
    verdictReasons = Array.isArray(reasons) ? reasons.map((entry) => String(entry)) : [];
    passed = passed && Boolean(summaryPayload?.verdict?.passed !== false) && verdictReasons.length === 0;
  } catch (error) {
    verdictReasons.push(`summary_read_failed:${error instanceof Error ? error.message : String(error)}`);
    passed = false;
  }

  if (!runResult.ok && runResult.error) {
    verdictReasons.push(`k6_launch_failed:${runResult.error}`);
  } else if (!runResult.ok) {
    verdictReasons.push(`k6_exit_code_${runResult.code}`);
  }

  const queueDepthValues = queueTelemetry
    .map((sample) => Number(sample.depthTotal || 0))
    .filter((value) => Number.isFinite(value));
  const queueOldestAgeValues = queueTelemetry
    .map((sample) => Number(sample.oldestAgeMs || 0))
    .filter((value) => Number.isFinite(value));
  const queueSummary = {
    sampleCount: queueTelemetry.length,
    maxDepth: queueDepthValues.length ? Math.max(...queueDepthValues) : 0,
    p95Depth: percentile(queueDepthValues, 0.95),
    lastDepth: queueDepthValues.length ? Number(queueDepthValues[queueDepthValues.length - 1] || 0) : 0,
    maxOldestAgeMs: queueOldestAgeValues.length ? Math.max(...queueOldestAgeValues) : 0,
    p95OldestAgeMs: percentile(queueOldestAgeValues, 0.95),
    lastOldestAgeMs: queueOldestAgeValues.length ? Number(queueOldestAgeValues[queueOldestAgeValues.length - 1] || 0) : 0,
    fetchErrors: queueTelemetry.filter((sample) => !sample.ok).length,
  };
  if (queueSummary.maxDepth > maxQueueDepth) {
    verdictReasons.push(`queue_depth_exceeded:${queueSummary.maxDepth}>${maxQueueDepth}`);
  }
  if (queueSummary.maxOldestAgeMs > maxOldestQueuedAgeMs) {
    verdictReasons.push(`queue_oldest_age_exceeded:${queueSummary.maxOldestAgeMs}>${maxOldestQueuedAgeMs}`);
  }
  if (queueSummary.sampleCount === 0 || queueSummary.fetchErrors > 0) {
    verdictReasons.push(`queue_telemetry_incomplete:samples=${queueSummary.sampleCount}:errors=${queueSummary.fetchErrors}`);
  }
  if (summaryPayload && typeof summaryPayload === 'object') {
    summaryPayload.queue = {
      thresholds: {
        maxDepth: maxQueueDepth,
        maxOldestAgeMs: maxOldestQueuedAgeMs,
      },
      summary: queueSummary,
      samples: queueTelemetry.slice(-200),
    };
    summaryPayload.verdict = {
      ...(summaryPayload.verdict || {}),
      passed: verdictReasons.length === 0,
      reasons: verdictReasons,
    };
    await fs.writeFile(summaryPath, `${JSON.stringify(summaryPayload, null, 2)}\n`, 'utf8');
  }
  passed = passed && verdictReasons.length === 0;

  const verdictPayload = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    config: {
      baseUrl,
      mode,
      vus,
      duration,
      pollMs,
      timeoutMs,
      syncWaitMs,
      uid,
      requireK6,
      queueSampleMs,
      maxQueueDepth,
      maxOldestQueuedAgeMs,
    },
    artifacts: {
      summaryPath: path.relative(ROOT, summaryPath).replace(/\\/g, '/'),
      rawSummaryExportPath: path.relative(ROOT, rawSummaryExportPath).replace(/\\/g, '/'),
    },
    verdict: {
      passed,
      reasons: verdictReasons,
    },
    queue: {
      thresholds: {
        maxDepth: maxQueueDepth,
        maxOldestAgeMs: maxOldestQueuedAgeMs,
      },
      summary: queueSummary,
      samples: queueTelemetry.slice(-200),
    },
    k6: {
      exitCode: runResult.code,
      launchError: runResult.error || null,
    },
  };

  await fs.writeFile(verdictPath, `${JSON.stringify(verdictPayload, null, 2)}\n`, 'utf8');

  console.log(`[run-k6-load] summary: ${path.relative(ROOT, summaryPath).replace(/\\/g, '/')}`);
  console.log(`[run-k6-load] verdict: ${path.relative(ROOT, verdictPath).replace(/\\/g, '/')}`);
  console.log(`[run-k6-load] passed: ${passed}`);
  console.log(
    `[run-k6-load] queue maxDepth=${queueSummary.maxDepth} maxOldestAgeMs=${queueSummary.maxOldestAgeMs} ` +
    `samples=${queueSummary.sampleCount}`,
  );

  if (!passed) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
