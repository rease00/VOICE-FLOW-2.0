#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

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

const timestamp = Date.now();
const summaryPath = path.join(ARTIFACT_DIR, `k6-summary-${mode}-c${vus}-${timestamp}.json`);
const rawSummaryExportPath = path.join(ARTIFACT_DIR, `k6-raw-${mode}-c${vus}-${timestamp}.json`);
const verdictPath = path.join(ARTIFACT_DIR, `k6-verdict-${mode}-c${vus}-${timestamp}.json`);

const run = (command, cliArgs, env) =>
  new Promise((resolve) => {
    const child = spawn(command, cliArgs, {
      stdio: 'inherit',
      env: { ...process.env, ...env },
      shell: process.platform === 'win32',
    });
    child.on('error', (error) => {
      resolve({
        ok: false,
        code: 1,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    child.on('close', (code) => {
      resolve({
        ok: code === 0,
        code: code ?? 1,
      });
    });
  });

const readJsonFile = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
};

const main = async () => {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
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
  };

  const runResult = await run(K6_BIN, k6Args, env);
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

