#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseBool } from './lib/audit-helpers.mjs';
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
const requireK6 = parseBool(args.get('require-k6') ?? process.env.VF_REQUIRE_K6, false);

const timestamp = Date.now();
const summaryPath = path.join(ARTIFACT_DIR, `k6-summary-${mode}-c${vus}-${timestamp}.json`);
const rawSummaryExportPath = path.join(ARTIFACT_DIR, `k6-raw-${mode}-c${vus}-${timestamp}.json`);
const verdictPath = path.join(ARTIFACT_DIR, `k6-verdict-${mode}-c${vus}-${timestamp}.json`);

const readJsonFile = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
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

  const k6Args = ['run', SCRIPT_PATH, '--summary-export', rawSummaryExportPath];
  const env = {
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

  const runResult = await runCommand(K6_BIN, k6Args, {
    env,
    stdio: 'inherit',
  });
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
    },
    artifacts: {
      summaryPath: path.relative(ROOT, summaryPath).replace(/\\/g, '/'),
      rawSummaryExportPath: path.relative(ROOT, rawSummaryExportPath).replace(/\\/g, '/'),
    },
    verdict: {
      passed,
      reasons: verdictReasons,
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

  if (!passed) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
